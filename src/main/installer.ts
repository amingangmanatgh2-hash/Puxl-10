import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { downloadMany } from './net'
import { ensureDirs, paths } from './paths'
import {
  buildDownloadPlan,
  clientJarPath,
  ensureClientJar,
  extractNatives,
  fetchManifest,
  fetchVersionDetails,
  findClientJarOwner,
  loadLocalVersion,
  nativesDir,
  resolveInherited,
  versionDir,
  versionJsonPath,
  type VersionDetails
} from './mojang'
import { installFabric, installQuilt, listLoaderVersions, runForgeInstaller, type LoaderId } from './loaders'
import { ensureInstanceDirs, type Instance } from './instances'
import { pickJava, installManagedJava, requiredJavaMajor } from './java'
import type { LauncherSettings } from './store'

export interface InstallProgress {
  stage: string
  detail: string
  current: number
  total: number
  pct: number
}

export interface InstallResult {
  versionId: string
  details: VersionDetails
  javaPath: string
  javaMajor: number
}

export type ProgressFn = (p: InstallProgress) => void

async function writeVersionJson(id: string, json: unknown): Promise<void> {
  const dir = versionDir(id)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(versionJsonPath(id), JSON.stringify(json, null, 2))
}

/** Make sure the vanilla version json (and client jar) exist on disk. */
export async function ensureVanilla(mcVersion: string, onProgress: ProgressFn): Promise<VersionDetails> {
  const local = await loadLocalVersion(mcVersion)
  if (local && local.downloads?.client) {
    await ensureClientJar(mcVersion, local).catch(() => null)
    return local
  }

  onProgress({ stage: 'manifest', detail: `Resolving ${mcVersion}`, current: 0, total: 1, pct: 0.02 })
  const manifest = await fetchManifest()
  const entry = manifest.versions.find((v) => v.id === mcVersion)
  if (!entry) throw new Error(`Minecraft ${mcVersion} was not found in the version manifest`)

  const details = await fetchVersionDetails(entry)
  await writeVersionJson(mcVersion, details)
  return details
}

export interface EnsureOptions {
  instance: Instance
  settings: LauncherSettings
  onProgress?: ProgressFn
  onLog?: (line: string) => void
  /** Skip the (slow) asset pass when assets are already present. */
  skipAssetsIfComplete?: boolean
}

/**
 * Idempotent install: vanilla base, loader, libraries, natives and assets.
 * Running it twice does nothing the second time thanks to checksum skipping.
 */
export async function ensureInstalled(opts: EnsureOptions): Promise<InstallResult> {
  ensureDirs()
  const { instance, settings } = opts
  const progress = opts.onProgress ?? (() => undefined)
  const log = opts.onLog ?? (() => undefined)
  const gameDir = ensureInstanceDirs(instance)

  progress({ stage: 'prepare', detail: 'Checking files', current: 0, total: 1, pct: 0.01 })

  const vanilla = await ensureVanilla(instance.minecraftVersion, progress)
  let versionId = instance.minecraftVersion

  if (instance.loader !== 'vanilla' && instance.loaderVersion) {
    const expectedId = loaderVersionId(instance.loader, instance.minecraftVersion, instance.loaderVersion)
    versionId = expectedId
    const existing = await loadLocalVersion(expectedId)
    if (!existing) {
      progress({ stage: 'loader', detail: `Installing ${instance.loader} ${instance.loaderVersion}`, current: 0, total: 1, pct: 0.05 })
      log(`[puxl] installing ${instance.loader} ${instance.loaderVersion} for ${instance.minecraftVersion}\n`)

      if (instance.loader === 'fabric') {
        const res = await installFabric(instance.minecraftVersion, instance.loaderVersion)
        versionId = res.versionId
      } else if (instance.loader === 'quilt') {
        const res = await installQuilt(instance.minecraftVersion, instance.loaderVersion)
        versionId = res.versionId
      } else if (instance.loader === 'forge' || instance.loader === 'neoforge') {
        // Forge's CLI installer needs a JDK/JRE of a matching or newer major version.
        const need = requiredJavaMajor(instance.minecraftVersion, vanilla.javaVersion?.majorVersion)
        const choice = await pickJava(need, instance.javaPath || undefined)
        let javaPath = choice.install?.path
        if (!javaPath) {
          const installed = await installManagedJava(need, (msg, p) =>
            progress({ stage: 'java', detail: msg, current: p, total: 1, pct: 0.05 + p * 0.1 })
          )
          javaPath = installed.path
        }
        const result = await runForgeInstaller({
          kind: instance.loader,
          gameVersion: instance.minecraftVersion,
          loaderVersion: instance.loaderVersion,
          javaExe: javaPath,
          onLog: (chunk) => log(chunk)
        })
        if (!result.ok || !result.versionId) {
          throw new Error(`${instance.loader} installer failed:\n${result.log.slice(-2000)}`)
        }
        versionId = result.versionId
      }
    }
  }

  const raw = await loadLocalVersion(versionId)
  if (!raw) throw new Error(`version ${versionId} is missing its json`)
  const details = raw.id === versionId && !raw.inheritsFrom ? raw : await resolveInherited(raw)
  const clientJarOwner = await findClientJarOwner(raw)

  // Download everything the version needs.
  const plan = await buildDownloadPlan({
    instanceId: versionId,
    clientJarOwner,
    gameDir,
    details,
    settings,
    skipAssets: false
  })

  const total = plan.tasks.length
  progress({ stage: 'download', detail: `Downloading ${total} files`, current: 0, total, pct: 0.12 })
  log(`[puxl] ${total} files to verify/download\n`)

  let lastEmit = 0
  const failures = await downloadMany(plan.tasks, Math.max(1, settings.downloadConcurrency), (done, count) => {
    const now = Date.now()
    if (now - lastEmit < 80 && done !== count) return
    lastEmit = now
    progress({
      stage: 'download',
      detail: `Downloading ${done}/${count}`,
      current: done,
      total: count,
      pct: 0.12 + (done / Math.max(1, count)) * 0.8
    })
  })

  const fatal = failures.filter((f) => f.error)
  if (fatal.length > 0) {
    const sample = fatal.slice(0, 5).map((f) => `${path.basename(f.dest)}: ${f.error}`).join('\n')
    log(`[puxl] ${fatal.length} files failed:\n${sample}\n`)
    progress({ stage: 'download', detail: `${fatal.length} files failed`, current: total, total, pct: 0.92 })
  }

  progress({ stage: 'natives', detail: 'Extracting natives', current: 0, total: 1, pct: 0.94 })
  await extractNatives(plan.natives, nativesDir(instance.id, versionId))

  // Always make sure the vanilla client jar is on disk — Forge's launcher needs it.
  await ensureClientJar(clientJarOwner, details).catch(() => null)

  progress({ stage: 'done', detail: 'Ready to launch', current: 1, total: 1, pct: 1 })
  log('[puxl] install complete\n')

  const requiredMajor = requiredJavaMajor(instance.minecraftVersion, vanilla.javaVersion?.majorVersion)
  const java = await pickJava(requiredMajor, instance.javaPath || undefined)
  let javaPath = java.install?.path ?? ''
  if (!javaPath) {
    const installed = await installManagedJava(requiredMajor, (msg, p) =>
      progress({ stage: 'java', detail: msg, current: p, total: 1, pct: 0.95 + p * 0.04 })
    )
    javaPath = installed.path
  }

  return { versionId, details, javaPath, javaMajor: requiredMajor }
}

export function loaderVersionId(loader: LoaderId, mcVersion: string, loaderVersion: string): string {
  if (loader === 'fabric') return `fabric-loader-${loaderVersion}-${mcVersion}`
  if (loader === 'quilt') return `quilt-loader-${loaderVersion}-${mcVersion}`
  if (loader === 'forge') return `forge-${mcVersion}-${loaderVersion}`
  if (loader === 'neoforge') return `neoforge-${loaderVersion}`
  return mcVersion
}

/** Cheap check used by the UI to show the "install / play" state without a network round trip. */
export async function isInstalled(instance: Instance): Promise<{ installed: boolean; reason?: string }> {
  const versionId = instance.loader === 'vanilla' || !instance.loaderVersion
    ? instance.minecraftVersion
    : loaderVersionId(instance.loader, instance.minecraftVersion, instance.loaderVersion)

  const json = await loadLocalVersion(versionId)
  if (!json) return { installed: false, reason: 'version not installed' }

  const raw = json.inheritsFrom ? await resolveInherited(json).catch(() => json) : json
  const owner = await findClientJarOwner(json)
  const jar = clientJarPath(owner)
  const clientSize = raw.downloads?.client?.size
  if (clientSize && fs.existsSync(jar)) {
    const stat = await fsp.stat(jar)
    if (stat.size !== clientSize) return { installed: false, reason: 'client jar incomplete' }
  } else if (!fs.existsSync(jar) && raw.downloads?.client?.url) {
    return { installed: false, reason: 'client jar missing' }
  }

  const mainLib = (raw.libraries ?? []).find((l) => l.downloads?.artifact?.size)
  if (mainLib?.downloads?.artifact) {
    const libPath = path.join(paths().libraries, mainLib.downloads.artifact.path ?? '')
    if (!fs.existsSync(libPath)) return { installed: false, reason: 'libraries missing' }
  }

  return { installed: true }
}

export async function possibleLoaderVersions(loader: LoaderId, mcVersion: string) {
  return listLoaderVersions(loader, mcVersion)
}
