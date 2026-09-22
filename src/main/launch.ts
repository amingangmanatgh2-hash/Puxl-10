import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { paths } from './paths'
import {
  clientJarPath,
  findClientJarOwner,
  flattenArguments,
  loadLocalVersion,
  nativesDir,
  resolveInherited,
  resolveLibraries,
  type FeatureSet,
  type VersionDetails
} from './mojang'
import { ensureInstanceDirs, gameDirOf, type Instance } from './instances'
import { installManagedJava, pickJava, probeJava, requiredJavaMajor } from './java'
import { tuneJvmArgs, type HardwareProfile } from './perf'
import type { LauncherSettings } from './store'

export interface LaunchAccount {
  name: string
  uuid: string
  accessToken: string
  userType: 'msa' | 'legacy' | 'mojang'
  xuid?: string
}

export interface LaunchOptions {
  instance: Instance
  settings: LauncherSettings
  account: LaunchAccount
  hardware: HardwareProfile
  onLog: (line: string) => void
  onExit: (code: number | null) => void
  onSpawn?: (pid: number) => void
}

export interface PreparedLaunch {
  command: string
  args: string[]
  javaPath: string
  env: NodeJS.ProcessEnv
  gameDir: string
}

function offlineUuid(name: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function classpathSeparator(): string {
  return process.platform === 'win32' ? ';' : ':'
}

/**
 * Resolves the classpath, natives folder and argument list for a version.
 * Exposed separately so the UI can show the exact command that will run.
 */
export async function prepareLaunch(opts: LaunchOptions): Promise<PreparedLaunch> {
  const { instance, settings, account } = opts
  const gameDir = ensureInstanceDirs(instance)

  const raw = await loadLocalVersion(instance.versionId)
  if (!raw) throw new Error(`Instance "${instance.name}" is not installed yet`)
  const details: VersionDetails = raw.inheritsFrom ? await resolveInherited(raw) : raw

  const requiredMajor = requiredJavaMajor(instance.minecraftVersion, details.javaVersion?.majorVersion)
  const java = await pickJava(requiredMajor, instance.javaPath || undefined)
  let javaPath = java.install?.path
  if (!javaPath) {
    opts.onLog(`[puxl] no Java ${requiredMajor} found, downloading one...\n`)
    javaPath = (await installManagedJava(requiredMajor, (msg) => opts.onLog(`[puxl] ${msg}\n`))).path
  }

  const features: FeatureSet = {
    has_custom_resolution: true,
    is_demo_user: false,
    has_quick_plays_support: false
  }

  const libs = resolveLibraries(details.libraries ?? [], features).filter((l) => !l.isNative)
  const classpathEntries = libs.map((l) => path.join(paths().libraries, l.path)).filter((p) => fs.existsSync(p))

  const jarOwner = await findClientJarOwner(raw)
  const jar = clientJarPath(jarOwner)
  if (fs.existsSync(jar)) classpathEntries.push(jar)

  const sep = classpathSeparator()
  const classpath = classpathEntries.join(sep)
  const nativeFolder = nativesDir(instance.id, instance.versionId)
  fs.mkdirSync(nativeFolder, { recursive: true })

  const replacements: Record<string, string> = {
    auth_player_name: account.name,
    version_name: details.id,
    game_directory: gameDir,
    assets_root: paths().assets,
    game_assets: path.join(paths().assets, 'virtual', 'legacy'),
    assets_index_name: details.assetIndex?.id ?? details.assets ?? 'legacy',
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    auth_session: `token:${account.accessToken || '0'}`,
    clientid: 'puxl',
    auth_xuid: account.xuid ?? '',
    user_type: account.userType,
    user_properties: '{}',
    version_type: details.type ?? 'release',
    natives_directory: nativeFolder,
    launcher_name: 'puxl',
    launcher_version: '1.0.0',
    classpath,
    classpath_separator: sep,
    library_directory: paths().libraries,
    primary_jar: jar,
    resolution_width: String(instance.width || 1280),
    resolution_height: String(instance.height || 720),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: ''
  }

  const substitute = (value: string): string => value.replace(/\$\{([^}]+)\}/g, (_, key: string) => replacements[key] ?? '')

  const jvmArgs: string[] = []
  const memory = Math.max(512, instance.memoryMb || settings.defaultMemoryMb)
  jvmArgs.push(`-Xmx${memory}M`, `-Xms${Math.min(memory, 2048)}M`)

  const tuned = tuneJvmArgs(opts.hardware, memory)
  for (const arg of tuned) if (!jvmArgs.includes(arg)) jvmArgs.push(arg)

  if (settings.defaultJvmArgs?.trim()) jvmArgs.push(...settings.defaultJvmArgs.trim().split(/\s+/))
  if (instance.jvmArgs?.trim()) jvmArgs.push(...instance.jvmArgs.trim().split(/\s+/))

  const jsonJvm = flattenArguments(details.arguments?.jvm, features).map(substitute).filter(Boolean)
  for (const arg of jsonJvm) {
    if (arg.startsWith('-Xmx') || arg.startsWith('-Xms') || arg.startsWith('-Djava.library.path')) continue
    jvmArgs.push(arg)
  }

  if (!jvmArgs.some((a) => a.startsWith('-Djava.library.path'))) {
    jvmArgs.push(`-Djava.library.path=${nativeFolder}`)
  }

  const logConfig = details.logging?.client?.file
  if (logConfig) {
    const cfgPath = path.join(paths().cache, 'log_configs', logConfig.id)
    if (fs.existsSync(cfgPath)) jvmArgs.push(`-Dlog4j.configurationFile=${cfgPath}`)
  }

  if (process.platform === 'darwin') {
    const minor = Number.parseInt(instance.minecraftVersion.split('.')[1] ?? '0', 10)
    if (minor >= 13 && !jvmArgs.includes('-XstartOnFirstThread')) jvmArgs.push('-XstartOnFirstThread')
  }

  jvmArgs.push('-Dpuxl.launcher=1')

  const classPathArg = classpath || jar
  jvmArgs.push('-cp', classPathArg, details.mainClass)

  const gameArgs: string[] = []
  if (details.arguments?.game) {
    gameArgs.push(...flattenArguments(details.arguments.game, features).map(substitute).filter(Boolean))
  } else if (details.minecraftArguments) {
    gameArgs.push(...details.minecraftArguments.split(/\s+/).map(substitute).filter(Boolean))
  }

  if (instance.width) gameArgs.push('--width', String(instance.width))
  if (instance.height) gameArgs.push('--height', String(instance.height))
  if (instance.fullscreen) gameArgs.push('--fullscreen')
  if (instance.gameArgs?.trim()) gameArgs.push(...instance.gameArgs.trim().split(/\s+/))

  const args = [...jvmArgs, ...gameArgs]
  const command = `${quote(javaPath)} ${args.map(quote).join(' ')}`

  return { command, args, javaPath, env: process.env, gameDir }
}

function quote(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value
  return process.platform === 'win32' ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, "'\\''")}'`
}

export class GameProcess {
  private child: ChildProcess | null = null
  private startedAt = 0
  private lastDurationMs = 0

  get pid(): number | undefined {
    return this.child?.pid
  }

  get running(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null)
  }

  /** Milliseconds the current run has been alive (0 when nothing is running). */
  get uptimeMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0
  }

  /** Duration of the previous session, for playtime accounting after exit. */
  get lastRunMs(): number {
    return this.lastDurationMs
  }

  async start(opts: LaunchOptions): Promise<PreparedLaunch> {
    if (this.running) throw new Error('A game is already running')
    const prepared = await prepareLaunch(opts)

    opts.onLog(`[puxl] java: ${prepared.javaPath}\n`)
    opts.onLog(`[puxl] cwd: ${prepared.gameDir}\n`)
    opts.onLog(`[puxl] java ${prepared.args.filter((a) => a.startsWith('-Xm')).join(' ')}\n`)

    const child = spawn(prepared.javaPath, prepared.args, {
      cwd: prepared.gameDir,
      windowsHide: false,
      env: { ...process.env, PUXL_LAUNCHER: '1' }
    })
    this.child = child
    this.startedAt = Date.now()
    opts.onSpawn?.(child.pid ?? 0)

    child.stdout?.on('data', (b: Buffer) => opts.onLog(b.toString()))
    child.stderr?.on('data', (b: Buffer) => opts.onLog(b.toString()))
    child.on('error', (err) => opts.onLog(`[puxl] launch error: ${err.message}\n`))
    child.on('close', (code) => {
      this.lastDurationMs = this.startedAt ? Date.now() - this.startedAt : 0
      this.child = null
      this.startedAt = 0
      opts.onExit(code)
    })

    return prepared
  }

  kill(): void {
    if (!this.child) return
    try {
      if (process.platform === 'win32' && this.child.pid) {
        spawn('taskkill', ['/pid', String(this.child.pid), '/f', '/t'], { windowsHide: true })
      } else {
        this.child.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }
  }
}

export const gameProcess = new GameProcess()

export { offlineUuid, probeJava, gameDirOf }
