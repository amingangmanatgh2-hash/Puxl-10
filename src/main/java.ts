import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { fetchJsonMirrored, downloadFile, downloadMany, type BatchTask } from './net'
import { paths, safeName } from './paths'

const RUNTIME_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
const ADOPTIUM = 'https://api.adoptium.net/v3'

export interface JavaInstall {
  path: string
  major: number
  fullVersion: string
  vendor: string
  source: 'managed' | 'system' | 'jvm-arg' | 'detected'
}

function parseJavaVersion(output: string): { major: number; full: string } | null {
  const m = output.match(/version "([^"]+)"/) ?? output.match(/version (\S+)/)
  if (!m) return null
  const raw = m[1]
  const parts = raw.split(/[._-]/)
  let major = Number.parseInt(parts[0], 10)
  if (major === 1) major = Number.parseInt(parts[1] ?? '0', 10)
  if (!Number.isFinite(major) || major <= 0) return null
  return { major, full: raw }
}

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

export function probeJava(exe: string, timeoutMs = 8000): Promise<JavaInstall | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(exe)) return resolve(null)
    const child = spawn(exe, ['-XshowSettings:properties', '-version'], { windowsHide: true })
    let out = ''
    const done = (result: JavaInstall | null) => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(result)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    const push = (buf: Buffer) => {
      out += buf.toString()
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    child.on('error', () => {
      clearTimeout(timer)
      done(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const parsed = parseJavaVersion(out)
      if (!parsed) return resolve(null)
      const vendor = out.match(/java\.vendor\s*=\s*(.+)/)?.[1]?.trim() ?? 'Unknown'
      resolve({ path: exe, major: parsed.major, fullVersion: parsed.full, vendor, source: 'detected' })
    })
  })
}

/** Scans the handful of places a Java install realistically lives. */
export async function detectSystemJavas(): Promise<JavaInstall[]> {
  const candidates = new Set<string>()

  if (process.env.JAVA_HOME) {
    candidates.add(path.join(process.env.JAVA_HOME, 'bin', javaExecutableName()))
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFiles86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local')

  const searchDirs: { dir: string; depth: number }[] = [
    { dir: path.join(paths().root, 'runtime'), depth: 3 },
    { dir: path.join(paths().root, 'java'), depth: 3 },
    { dir: path.join(programFiles, 'Java'), depth: 2 },
    { dir: path.join(programFiles, 'Eclipse Adoptium'), depth: 2 },
    { dir: path.join(programFiles, 'Microsoft'), depth: 2 },
    { dir: path.join(programFiles, 'Zulu'), depth: 2 },
    { dir: path.join(programFiles, 'BellSoft'), depth: 2 },
    { dir: path.join(programFiles, 'Amazon Corretto'), depth: 2 },
    { dir: path.join(programFiles, 'Semeru'), depth: 2 },
    { dir: path.join(programFiles86, 'Java'), depth: 2 },
    { dir: path.join(localAppData, 'Programs', 'Eclipse Adoptium'), depth: 2 },
    { dir: path.join(home, '.jdks'), depth: 2 },
    { dir: '/usr/lib/jvm', depth: 2 },
    { dir: '/Library/Java/JavaVirtualMachines', depth: 4 }
  ]

  const walk = async (dir: string, depth: number, exeName: string): Promise<void> => {
    if (depth < 0) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase()) candidates.add(full)
      else if (entry.isDirectory()) {
        if (entry.name === 'bin') {
          candidates.add(path.join(full, javaExecutableName()))
        } else if (depth > 0) {
          await walk(full, depth - 1, exeName)
          // macOS bundles: Contents/Home/bin/java
          const macExe = path.join(full, 'Contents', 'Home', 'bin', javaExecutableName())
          if (fs.existsSync(macExe)) candidates.add(macExe)
        }
      }
    }
  }

  for (const { dir, depth } of searchDirs) {
    await walk(dir, depth, javaExecutableName())
  }

  // `java` on PATH.
  await new Promise<void>((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['java'], (err, stdout) => {
      if (!err && stdout) {
        for (const line of stdout.split(/\r?\n/)) {
          if (line.trim()) candidates.add(line.trim())
        }
      }
      resolve()
    })
  })

  const results: JavaInstall[] = []
  for (const exe of candidates) {
    if (!exe.toLowerCase().includes('java')) continue
    const probed = await probeJava(exe)
    if (probed && !results.some((r) => r.path === probed.path)) results.push(probed)
  }
  return results.sort((a, b) => b.major - a.major)
}

/** Managed runtimes downloaded by Puxl live in `<root>/java/<component>`. */
export async function listManagedJavas(): Promise<JavaInstall[]> {
  const base = paths().java
  let entries: string[] = []
  try {
    entries = await fsp.readdir(base)
  } catch {
    return []
  }
  const found: JavaInstall[] = []
  for (const entry of entries) {
    const exe = findJavaIn(path.join(base, entry))
    if (!exe) continue
    const probed = await probeJava(exe)
    if (probed) found.push({ ...probed, source: 'managed' })
  }
  return found
}

export function findJavaIn(dir: string): string | null {
  const direct = path.join(dir, 'bin', javaExecutableName())
  if (fs.existsSync(direct)) return direct
  // Mojang runtime layout is also `bin/`, but some archives nest one level.
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const nested = path.join(dir, entry.name, 'bin', javaExecutableName())
      if (fs.existsSync(nested)) return nested
      const mac = path.join(dir, entry.name, 'Contents', 'Home', 'bin', javaExecutableName())
      if (fs.existsSync(mac)) return mac
    }
  } catch {
    /* ignore */
  }
  return null
}

export interface JavaChoice {
  install: JavaInstall | null
  /** True when this version needs a runtime we do not have yet. */
  needsDownload: boolean
  requiredMajor: number
}

export async function pickJava(requiredMajor: number, preferredPath?: string): Promise<JavaChoice> {
  if (preferredPath) {
    const probed = await probeJava(preferredPath)
    if (probed) return { install: { ...probed, source: 'jvm-arg' }, needsDownload: false, requiredMajor }
  }
  const managed = await listManagedJavas()
  const exactManaged = managed.find((j) => j.major === requiredMajor)
  if (exactManaged) return { install: exactManaged, needsDownload: false, requiredMajor }

  const system = await detectSystemJavas()
  // Newer runtimes run older game versions fine; the reverse is not true.
  const compatible = system.filter((j) => j.major >= requiredMajor).sort((a, b) => a.major - b.major)
  if (compatible[0]) return { install: compatible[0], needsDownload: false, requiredMajor }

  return { install: null, needsDownload: true, requiredMajor }
}

/* ------------------------------------------------------------------ *
 * Managed runtime download (Mojang java-runtime manifest, Adoptium fallback)
 * ------------------------------------------------------------------ */

interface RuntimeManifest {
  [platform: string]: {
    [component: string]: { manifest: { url: string; sha1: string; size: number }; version: { name: string } }[]
  }
}

interface RuntimeFileManifest {
  files: Record<
    string,
    {
      type: 'file' | 'directory' | 'link'
      executable?: boolean
      target?: string
      downloads?: { raw?: { url: string; sha1?: string; size?: number }; lzma?: { url: string } }
    }
  >
}

function platformKey(): string {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac-os' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'
  return `${os}-${arch}`
}

function componentFor(major: number): string {
  if (major <= 8) return 'jre-legacy'
  if (major === 16) return 'java-runtime-alpha'
  if (major === 17) return 'java-runtime-gamma'
  if (major === 21) return 'java-runtime-delta'
  return `java-runtime-${major}`
}

export async function installManagedJava(
  major: number,
  onProgress?: (msg: string, pct: number) => void
): Promise<JavaInstall> {
  const platform = platformKey()
  const component = componentFor(major)
  const dest = path.join(paths().java, safeName(component))
  await fsp.mkdir(dest, { recursive: true })

  onProgress?.(`Fetching Java ${major} runtime manifest`, 0.02)
  const manifest = await fetchJsonMirrored<RuntimeManifest>(RUNTIME_MANIFEST)
  const platformEntry = manifest[platform]
  if (!platformEntry) throw new Error(`no Java runtime published for ${platform}`)

  let componentEntry = platformEntry[component]?.[0]
  if (!componentEntry) {
    // Any component whose published version starts with the major we want.
    for (const [name, entries] of Object.entries(platformEntry)) {
      const hit = entries.find((e) => e.version?.name?.split('.')[0] === String(major))
      if (hit) {
        componentEntry = hit
        void name
        break
      }
    }
  }
  if (!componentEntry) throw new Error(`Java ${major} is not published by Mojang for ${platform}`)

  const fileManifest = await fetchJsonMirrored<RuntimeFileManifest>(componentEntry.manifest.url)
  const tasks: BatchTask[] = []
  for (const [rel, info] of Object.entries(fileManifest.files ?? {})) {
    if (info.type !== 'file') continue
    const raw = info.downloads?.raw
    if (!raw?.url) continue
    tasks.push({
      url: raw.url,
      dest: path.join(dest, rel),
      sha1: raw.sha1,
      size: raw.size,
      label: `java ${major} ${path.basename(rel)}`
    })
  }

  let done = 0
  await downloadMany(tasks, 6, (d, total) => {
    done = d
    onProgress?.(`Downloading Java ${major} (${d}/${total})`, 0.05 + (d / Math.max(1, total)) * 0.9)
  })
  void done

  const exe = findJavaIn(dest)
  if (!exe && tasks.length === 0) {
    // Manifest had nothing usable — fall back to Temurin.
    return installAdoptiumJava(major, onProgress)
  }
  if (!exe) throw new Error('Java runtime extracted but no executable was found')

  if (process.platform !== 'win32') {
    await fsp.chmod(exe, 0o755).catch(() => undefined)
  }

  onProgress?.(`Java ${major} ready`, 1)
  const probed = await probeJava(exe)
  return (
    probed ?? { path: exe, major, fullVersion: componentEntry.version?.name ?? String(major), vendor: 'Mojang', source: 'managed' }
  )
}

export async function installAdoptiumJava(
  major: number,
  onProgress?: (msg: string, pct: number) => void
): Promise<JavaInstall> {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const url = `${ADOPTIUM}/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`
  const dest = path.join(paths().java, `temurin-${major}`)
  await fsp.mkdir(dest, { recursive: true })
  const archive = path.join(dest, `temurin-${major}.zip`)

  onProgress?.(`Downloading Java ${major} (Temurin)`, 0.1)
  await downloadFile(url, archive, { label: `Java ${major}`, attempts: 3 })
  onProgress?.('Extracting Java', 0.7)

  const unzipper = (await import('unzipper')).default
  const zip = await unzipper.Open.file(archive)
  for (const entry of zip.files) {
    if (entry.type !== 'File') continue
    const rel = entry.path.split('/').slice(1).join('/')
    if (!rel) continue
    const target = path.join(dest, rel)
    if (!target.startsWith(dest)) continue
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, await entry.buffer())
  }
  await fsp.rm(archive, { force: true }).catch(() => undefined)

  const exe = findJavaIn(dest)
  if (!exe) throw new Error('Temurin archive did not contain a Java executable')
  if (process.platform !== 'win32') await fsp.chmod(exe, 0o755).catch(() => undefined)
  onProgress?.('Java ready', 1)
  const probed = await probeJava(exe)
  return probed ?? { path: exe, major, fullVersion: String(major), vendor: 'Eclipse Adoptium', source: 'managed' }
}

/** The Java major version a given Minecraft version expects. */
export function requiredJavaMajor(mcVersion: string, fromJson?: number): number {
  if (fromJson && fromJson > 0) return fromJson
  const clean = mcVersion.replace(/^(fabric|quilt|forge|neoforge)-?/i, '').replace(/^.*?(\d+\.\d+(\.\d+)?).*$/, '$1')
  const [major, minor, patch] = clean.split('.').map((n) => Number.parseInt(n, 10) || 0)
  if (major > 1) return 21 // snapshots dated 25.x
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  if (minor >= 17) return 16
  return 8
}
