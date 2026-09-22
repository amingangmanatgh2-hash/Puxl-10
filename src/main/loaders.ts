import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fetchJsonMirrored, fetchTextMirrored, downloadFile, downloadMany, type BatchTask } from './net'
import { paths, safeName } from './paths'
import {
  fetchManifest,
  loadLocalVersion,
  resolveInherited,
  resolveLibraries,
  versionDir,
  versionJsonPath,
  type ManifestEntry,
  type VersionDetails
} from './mojang'

export type LoaderId = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface LoaderVersion {
  version: string
  stable: boolean
  /** Minecraft versions this loader build supports (only when listing globally). */
  gameVersions?: string[]
}

export interface LoaderPlan {
  /** Directory name under `versions/` holding the merged version json. */
  versionId: string
  /** Loader libraries that must be downloaded before launch. */
  libraries: string[]
  /** True when the loader requires running a jar-based installer with Java. */
  needsInstaller: boolean
}

/* ------------------------------------------------------------------ *
 * Fabric
 * ------------------------------------------------------------------ */

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'

interface FabricLoaderEntry {
  loader: { version: string; stable: boolean; build: number }
  intermediary: { version: string }
  launcherMeta: { libraries: Record<string, unknown> }
}

export async function listFabricLoaders(gameVersion?: string): Promise<LoaderVersion[]> {
  const url = gameVersion ? `${FABRIC_META}/versions/loader/${gameVersion}` : `${FABRIC_META}/versions/loader`
  const data = await fetchJsonMirrored<FabricLoaderEntry[]>(url)
  return (data ?? []).map((entry) => ({ version: entry.loader.version, stable: Boolean(entry.loader.stable) }))
}

export async function listQuiltLoaders(gameVersion?: string): Promise<LoaderVersion[]> {
  const url = gameVersion ? `${QUILT_META}/versions/loader/${gameVersion}` : `${QUILT_META}/versions/loader`
  const data = await fetchJsonMirrored<{ loader: { version: string } }[]>(url)
  return (data ?? []).map((entry) => ({ version: entry.loader.version, stable: true }))
}

async function installMetaLoader(
  kind: 'fabric' | 'quilt',
  gameVersion: string,
  loaderVersion: string
): Promise<{ versionId: string; json: VersionDetails }> {
  const base = kind === 'fabric' ? FABRIC_META : QUILT_META
  const profileUrl = `${base}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`
  const profile = await fetchJsonMirrored<VersionDetails>(profileUrl)
  const versionId = safeName(profile.id || `${kind}-loader-${loaderVersion}-${gameVersion}`)

  const dir = versionDir(versionId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(versionJsonPath(versionId), JSON.stringify(profile, null, 2))

  // Pull in the loader libraries so the first launch works offline-safe.
  const libs = resolveLibraries(profile.libraries ?? [], {})
  const tasks: BatchTask[] = libs
    .filter((l) => l.url && !l.isNative)
    .map((l) => ({ url: l.url, dest: path.join(paths().libraries, l.path), sha1: l.sha1, size: l.size, label: l.artifact }))

  await downloadMany(tasks, 8)
  return { versionId, json: profile }
}

export async function installFabric(gameVersion: string, loaderVersion: string) {
  return installMetaLoader('fabric', gameVersion, loaderVersion)
}

export async function installQuilt(gameVersion: string, loaderVersion: string) {
  return installMetaLoader('quilt', gameVersion, loaderVersion)
}

/* ------------------------------------------------------------------ *
 * Forge / NeoForge — both ship a working CLI installer jar.
 * ------------------------------------------------------------------ */

const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

/** Reads a maven-metadata.xml and returns the versions inside it. */
export async function listForgeVersions(gameVersion: string): Promise<LoaderVersion[]> {
  const url = `${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`
  const xml = await fetchTextMirrored(url).catch(() => '')
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  return versions
    .filter((v) => v.startsWith(`${gameVersion}-`))
    .map((v) => ({ version: v.slice(gameVersion.length + 1), stable: !/beta|pre/i.test(v) }))
    .reverse()
}

export async function listNeoForgeVersions(gameVersion: string): Promise<LoaderVersion[]> {
  const data = await fetchJsonMirrored<{ versions: string[] }>(
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
  ).catch(() => ({ versions: [] as string[] }))
  const wanted = neoForgePrefix(gameVersion)
  return (data.versions ?? [])
    .filter((v) => v.startsWith(wanted))
    .map((v) => ({ version: v, stable: true }))
    .reverse()
}

/** NeoForge versions are prefixed with the Minecraft minor version (1.21.1 -> 21.1.x). */
function neoForgePrefix(gameVersion: string): string {
  const [major, minor, patch] = gameVersion.split('.').map((n) => Number.parseInt(n, 10) || 0)
  if (major !== 1) return `${major}.${minor}.`
  return patch ? `${minor}.${patch}.` : `${minor}.0.`
}

export interface InstallerRunResult {
  ok: boolean
  log: string
  versionId?: string
}

export async function runForgeInstaller(opts: {
  kind: 'forge' | 'neoforge'
  gameVersion: string
  loaderVersion: string
  javaExe: string
  onLog?: (chunk: string) => void
}): Promise<InstallerRunResult> {
  const { kind, gameVersion, loaderVersion } = opts
  const fullVersion = kind === 'forge' ? `${gameVersion}-${loaderVersion}` : loaderVersion
  const artifact = kind === 'forge' ? 'forge' : 'neoforge'
  const repo = kind === 'forge' ? FORGE_MAVEN : NEOFORGE_MAVEN
  const installerUrl = `${repo}/net/${kind === 'forge' ? 'minecraftforge' : 'neoforged'}/${artifact}/${fullVersion}/${artifact}-${fullVersion}-installer.jar`

  const jar = path.join(paths().cache, 'installers', `${artifact}-${fullVersion}-installer.jar`)
  await downloadFile(installerUrl, jar, { label: `${artifact} installer ${fullVersion}` })

  // The installers read the vanilla version json out of the launcher root.
  const args = ['-jar', jar, '--installClient', paths().root]

  return await new Promise<InstallerRunResult>((resolve) => {
    let log = ''
    const child = spawn(opts.javaExe, args, { windowsHide: true })
    const push = (chunk: Buffer) => {
      const text = chunk.toString()
      log += text
      opts.onLog?.(text)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    child.on('error', (err) => resolve({ ok: false, log: `${log}\n${err.message}` }))
    child.on('close', async (code) => {
      if (code !== 0) return resolve({ ok: false, log })
      // Find the newly written version json (forge-<mc>-<loader> or neoforge-<ver>).
      const dirs = await fsp.readdir(paths().versions).catch(() => [] as string[])
      const guess = dirs.find((d) => d === (kind === 'forge' ? `forge-${fullVersion}` : `neoforge-${fullVersion}`) || d.includes(fullVersion))
      resolve({ ok: true, log, versionId: guess })
    })
  })
}

/* ------------------------------------------------------------------ *
 * Helpers shared with the installer
 * ------------------------------------------------------------------ */

export async function listLoaderVersions(loader: LoaderId, gameVersion: string): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'fabric':
      return listFabricLoaders(gameVersion)
    case 'quilt':
      return listQuiltLoaders(gameVersion)
    case 'forge':
      return listForgeVersions(gameVersion)
    case 'neoforge':
      return listNeoForgeVersions(gameVersion)
    default:
      return [{ version: 'vanilla', stable: true }]
  }
}

export async function manifestEntryFor(id: string): Promise<ManifestEntry | null> {
  const manifest = await fetchManifest()
  return manifest.versions.find((v) => v.id === id) ?? null
}

export async function localInstallState(instanceId: string, gameVersion?: string) {
  const json = await loadLocalVersion(instanceId)
  if (!json) return { installed: false as const }
  const resolved = await resolveInherited(json, undefined).catch(() => json)
  const client = resolved.downloads?.client
  const clientPath = gameVersion ? path.join(versionDir(instanceId), `${instanceId}.jar`) : ''
  return {
    installed: true as const,
    json: resolved,
    hasClient: client?.url ? fs.existsSync(clientPath) : true
  }
}
