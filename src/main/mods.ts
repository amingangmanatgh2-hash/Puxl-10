import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fetchJsonMirrored, downloadFile, downloadMany, type BatchTask } from './net'
import { modsDirOf, gameDirOf, type Instance } from './instances'

const API = 'https://api.modrinth.com/v2'

export interface SearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  categories: string[]
  display_categories?: string[]
  versions: string[]
  downloads: number
  follows: number
  icon_url?: string
  author?: string
  project_type: string
  date_modified: string
  color?: number
  latest_version?: string
  license?: string
  client_side?: string
  server_side?: string
}

export interface SearchResponse {
  hits: SearchHit[]
  offset: number
  limit: number
  total_hits: number
}

export interface ModVersionFile {
  hashes: { sha1: string; sha512?: string }
  url: string
  filename: string
  primary: boolean
  size: number
  file_type?: string
}

export interface ModVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: 'release' | 'beta' | 'alpha'
  downloads: number
  date_published: string
  files: ModVersionFile[]
  dependencies: { version_id: string | null; project_id: string | null; file_name: string | null; dependency_type: string }[]
}

export interface ModProject {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  categories: string[]
  loaders: string[]
  game_versions: string[]
  downloads: number
  followers: number
  icon_url?: string
  issues_url?: string
  source_url?: string
  wiki_url?: string
  license?: { id: string; name: string }
  client_side: string
  server_side: string
  gallery?: { url: string; title?: string }[]
  color?: number
  updated: string
}

export interface SearchQuery {
  query?: string
  loader?: string
  gameVersion?: string
  categories?: string[]
  projectType?: 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'datapack'
  index?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
  limit?: number
  offset?: number
  /** Restrict to projects that also work client-side / server-side. */
  clientSideOnly?: boolean
}

export async function searchProjects(q: SearchQuery): Promise<SearchResponse> {
  const facets: string[][] = []
  facets.push([`project_type:${q.projectType ?? 'mod'}`])
  if (q.loader) facets.push([`categories:${q.loader}`])
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`])
  if (q.categories?.length) facets.push(q.categories.map((c) => `categories:${c}`))
  if (q.clientSideOnly) facets.push(['client_side:required', 'client_side:optional', 'client_side:unsupported'].slice(0, 2))

  const params = new URLSearchParams({
    query: q.query ?? '',
    limit: String(q.limit ?? 24),
    offset: String(q.offset ?? 0),
    index: q.index ?? 'relevance'
  })
  if (facets.length) params.set('facets', JSON.stringify(facets))

  return fetchJsonMirrored<SearchResponse>(`${API}/search?${params.toString()}`)
}

export async function getProject(idOrSlug: string): Promise<ModProject> {
  return fetchJsonMirrored<ModProject>(`${API}/project/${encodeURIComponent(idOrSlug)}`)
}

export async function getProjectVersions(
  idOrSlug: string,
  opts: { loader?: string; gameVersion?: string } = {}
): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (opts.loader) params.set('loaders', JSON.stringify([opts.loader]))
  if (opts.gameVersion) params.set('game_versions', JSON.stringify([opts.gameVersion]))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return fetchJsonMirrored<ModVersion[]>(`${API}/project/${encodeURIComponent(idOrSlug)}/version${suffix}`)
}

export async function getVersion(id: string): Promise<ModVersion> {
  return fetchJsonMirrored<ModVersion>(`${API}/version/${id}`)
}

export async function listTags(kind: 'loader' | 'game_version' | 'category' | 'license'): Promise<unknown[]> {
  return fetchJsonMirrored<unknown[]>(`${API}/tag/${kind}`)
}

/* ------------------------------------------------------------------ *
 * Local mod registry
 * ------------------------------------------------------------------ */

export interface InstalledMod {
  /** Modrinth project id when known. */
  projectId?: string
  slug?: string
  title: string
  versionId?: string
  versionNumber?: string
  fileName: string
  enabled: boolean
  size: number
  iconUrl?: string
  source: 'modrinth' | 'manual' | 'pack'
  installedAt: number
  /** Filenames this mod depended on when installed, for safe removal. */
  dependencies?: string[]
  updateAvailable?: string
  updateVersionId?: string
  /** Set when the file came from a modpack, so a pack update can replace it. */
  fromPack?: string
}

interface Registry {
  mods: InstalledMod[]
}

function registryFile(instance: Instance): string {
  return path.join(gameDirOf(instance), 'puxl-mods.json')
}

export function readRegistry(instance: Instance): Registry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryFile(instance), 'utf8')) as Registry
    if (Array.isArray(raw.mods)) return raw
  } catch {
    /* first run */
  }
  return { mods: [] }
}

function writeRegistry(instance: Instance, registry: Registry): void {
  const file = registryFile(instance)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(registry, null, 2))
}

/** Merge the on-disk mods folder with the registry so manually dropped jars show up too. */
export async function listInstalledMods(instance: Instance): Promise<InstalledMod[]> {
  const dir = modsDirOf(instance)
  await fsp.mkdir(dir, { recursive: true })
  const registry = readRegistry(instance)
  const files = await fsp.readdir(dir)
  const known = new Map(registry.mods.map((m) => [m.fileName, m]))
  const result: InstalledMod[] = []

  for (const file of files) {
    if (file === 'puxl-mods.json') continue
    const isJar = file.endsWith('.jar')
    const isDisabled = file.endsWith('.jar.disabled')
    if (!isJar && !isDisabled) continue

    const stat = await fsp.stat(path.join(dir, file)).catch(() => null)
    const entry = known.get(file) ?? known.get(file.replace('.disabled', ''))
    if (entry) {
      result.push({ ...entry, fileName: file, enabled: isJar, size: stat?.size ?? entry.size })
    } else {
      result.push({
        title: file.replace(/\.jar(\.disabled)?$/, ''),
        fileName: file,
        enabled: isJar,
        size: stat?.size ?? 0,
        source: 'manual',
        installedAt: stat?.mtimeMs ?? Date.now()
      })
    }
  }

  // Registry entries whose files vanished are stale.
  const onDisk = new Set(result.map((m) => m.fileName.replace('.disabled', '')))
  const cleaned = registry.mods.filter((m) => onDisk.has(m.fileName.replace('.disabled', '')))
  if (cleaned.length !== registry.mods.length) writeRegistry(instance, { mods: cleaned })

  return result.sort((a, b) => a.title.localeCompare(b.title))
}

function pickPrimaryFile(version: ModVersion): ModVersionFile | null {
  return version.files.find((f) => f.primary) ?? version.files[0] ?? null
}

export interface InstallModResult {
  installed: InstalledMod[]
  skipped: { title: string; reason: string }[]
}

/**
 * Installs a Modrinth version and its required dependencies into an instance.
 * Already-satisfied dependencies are skipped, so this is safe to re-run.
 */
export async function installModVersion(
  instance: Instance,
  version: ModVersion,
  opts: { source?: InstalledMod['source']; visited?: Set<string> } = {}
): Promise<InstallModResult> {
  const visited = opts.visited ?? new Set<string>()
  const dir = modsDirOf(instance)
  await fsp.mkdir(dir, { recursive: true })

  const registry = readRegistry(instance)
  const result: InstallModResult = { installed: [], skipped: [] }

  if (visited.has(version.project_id)) return result
  visited.add(version.project_id)

  let title = version.name
  let icon: string | undefined
  let slug: string | undefined
  try {
    const project = await getProject(version.project_id)
    title = project.title
    icon = project.icon_url
    slug = project.slug
  } catch {
    /* offline-friendly: fall back to the version name */
  }

  const existing = registry.mods.find(
    (m) => m.projectId === version.project_id || m.fileName === pickPrimaryFile(version)?.filename
  )
  if (existing) {
    // Replace the old file so we never end up with two versions of one mod.
    if (existing.fileName !== pickPrimaryFile(version)?.filename) {
      await fsp.rm(path.join(dir, existing.fileName), { force: true }).catch(() => undefined)
    } else if (!existing.enabled) {
      await fsp.rename(path.join(dir, existing.fileName), path.join(dir, existing.fileName.replace('.disabled', ''))).catch(() => undefined)
    }
    registry.mods = registry.mods.filter((m) => m !== existing)
  }

  const file = pickPrimaryFile(version)
  if (!file) return { installed: [], skipped: [{ title, reason: 'this version has no downloadable file' }] }

  await downloadFile(file.url, path.join(dir, file.filename), {
    sha1: file.hashes.sha1,
    size: file.size,
    label: title
  })

  const installed: InstalledMod = {
    projectId: version.project_id,
    slug,
    title,
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    enabled: true,
    size: file.size,
    iconUrl: icon,
    source: opts.source ?? 'modrinth',
    installedAt: Date.now(),
    dependencies: version.dependencies.filter((d) => d.dependency_type === 'required').map((d) => d.project_id ?? '')
  }
  registry.mods.push(installed)
  result.installed.push(installed)

  // Required dependencies first, then embedded jars are left to the mod itself.
  for (const dep of version.dependencies) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue
    if (registry.mods.some((m) => m.projectId === dep.project_id)) continue
    try {
      const candidates = await getProjectVersions(dep.project_id, {
        loader: instance.loader === 'vanilla' ? undefined : instance.loader,
        gameVersion: instance.minecraftVersion
      })
      const chosen = candidates.find((v) => v.version_type === 'release') ?? candidates[0]
      if (!chosen) {
        result.skipped.push({ title: dep.project_id, reason: 'no compatible version found for this loader/version' })
        continue
      }
      const sub = await installModVersion(instance, chosen, { source: opts.source, visited })
      result.installed.push(...sub.installed)
      result.skipped.push(...sub.skipped)
    } catch (err) {
      result.skipped.push({ title: dep.project_id, reason: err instanceof Error ? err.message : 'dependency download failed' })
    }
  }

  writeRegistry(instance, registry)
  return result
}

export async function installMod(instance: Instance, projectIdOrSlug: string): Promise<InstallModResult> {
  const loader = instance.loader === 'vanilla' ? undefined : instance.loader
  const versions = await getProjectVersions(projectIdOrSlug, { loader, gameVersion: instance.minecraftVersion })
  if (versions.length === 0) {
    throw new Error(
      loader
        ? `No build of this project supports ${instance.minecraftVersion} on ${instance.loader}.`
        : 'No build of this project supports this Minecraft version.'
    )
  }
  const chosen = versions.find((v) => v.version_type === 'release') ?? versions[0]
  return installModVersion(instance, chosen)
}

export async function setModEnabled(instance: Instance, fileName: string, enabled: boolean): Promise<void> {
  const dir = modsDirOf(instance)
  const from = path.join(dir, enabled ? `${fileName}.disabled` : fileName)
  const to = path.join(dir, enabled ? fileName : `${fileName}.disabled`)
  if (fs.existsSync(from)) await fsp.rename(from, to)
  else if (fs.existsSync(path.join(dir, fileName)) && !enabled) await fsp.rename(path.join(dir, fileName), to)

  const registry = readRegistry(instance)
  const entry = registry.mods.find((m) => m.fileName === fileName || m.fileName === `${fileName}.disabled`)
  if (entry) {
    entry.enabled = enabled
    entry.fileName = path.basename(to)
    writeRegistry(instance, registry)
  }
}

export async function deleteMod(instance: Instance, fileName: string): Promise<void> {
  const dir = modsDirOf(instance)
  for (const candidate of [fileName, `${fileName}.disabled`]) {
    await fsp.rm(path.join(dir, candidate), { force: true }).catch(() => undefined)
  }
  const registry = readRegistry(instance)
  registry.mods = registry.mods.filter((m) => m.fileName !== fileName && m.fileName !== `${fileName}.disabled`)
  writeRegistry(instance, registry)
}

/** Adds a jar the user picked from disk. */
export async function addLocalMod(instance: Instance, sourcePath: string): Promise<InstalledMod> {
  const dir = modsDirOf(instance)
  await fsp.mkdir(dir, { recursive: true })
  const fileName = path.basename(sourcePath)
  const dest = path.join(dir, fileName)
  await fsp.copyFile(sourcePath, dest)
  const stat = await fsp.stat(dest)

  const mod: InstalledMod = {
    title: fileName.replace(/\.jar$/, ''),
    fileName,
    enabled: true,
    size: stat.size,
    source: 'manual',
    installedAt: Date.now()
  }
  const registry = readRegistry(instance)
  registry.mods = registry.mods.filter((m) => m.fileName !== fileName)
  registry.mods.push(mod)
  writeRegistry(instance, registry)
  return mod
}

/** Checks every Modrinth-sourced mod for a newer compatible build. */
export async function checkModUpdates(instance: Instance): Promise<InstalledMod[]> {
  const registry = readRegistry(instance)
  const output: InstalledMod[] = []
  for (const mod of registry.mods) {
    if (!mod.projectId || !mod.versionId) {
      output.push({ ...mod, updateAvailable: undefined })
      continue
    }
    try {
      const versions = await getProjectVersions(mod.projectId, {
        loader: instance.loader === 'vanilla' ? undefined : instance.loader,
        gameVersion: instance.minecraftVersion
      })
      const latest = versions.find((v) => v.version_type === 'release') ?? versions[0]
      if (latest && latest.id !== mod.versionId && new Date(latest.date_published) > new Date(0)) {
        output.push({ ...mod, updateAvailable: latest.version_number, updateVersionId: latest.id })
      } else {
        output.push({ ...mod, updateAvailable: undefined, updateVersionId: undefined })
      }
    } catch {
      output.push({ ...mod })
    }
  }
  const withUpdates = output.map((m) => {
    const original = registry.mods.find((r) => r.fileName === m.fileName || r.fileName === `${m.fileName}.disabled`)
    return original ? { ...original, updateAvailable: m.updateAvailable, updateVersionId: m.updateVersionId } : m
  })
  writeRegistry(instance, { mods: withUpdates })
  return withUpdates
}

export async function updateMod(instance: Instance, fileName: string): Promise<InstallModResult> {
  const registry = readRegistry(instance)
  const mod = registry.mods.find((m) => m.fileName === fileName || m.fileName === `${fileName}.disabled`)
  if (!mod?.projectId) throw new Error('This mod was not installed from Modrinth, so it cannot be auto-updated.')
  return installMod(instance, mod.projectId)
}

/* ------------------------------------------------------------------ *
 * Resource packs, shaders and worlds reuse the same download flow
 * ------------------------------------------------------------------ */

export async function installContent(
  instance: Instance,
  projectIdOrSlug: string,
  kind: 'resourcepack' | 'shader'
): Promise<{ file: string }> {
  const versions = await getProjectVersions(projectIdOrSlug, { gameVersion: instance.minecraftVersion })
  const version = versions.find((v) => v.version_type === 'release') ?? versions[0]
  if (!version) throw new Error('No compatible download found for this Minecraft version.')
  const file = pickPrimaryFile(version)
  if (!file) throw new Error('This project has no downloadable file.')

  const folder = kind === 'shader' ? 'shaderpacks' : 'resourcepacks'
  const dest = path.join(gameDirOf(instance), folder, file.filename)
  await downloadFile(file.url, dest, { sha1: file.hashes.sha1, size: file.size, label: file.filename })
  return { file: file.filename }
}

export async function listContent(instance: Instance, kind: 'resourcepack' | 'shader'): Promise<string[]> {
  const folder = path.join(gameDirOf(instance), kind === 'shader' ? 'shaderpacks' : 'resourcepacks')
  try {
    return (await fsp.readdir(folder)).filter((f) => /\.(zip|jar)$/i.test(f))
  } catch {
    return []
  }
}

export async function deleteContent(instance: Instance, kind: 'resourcepack' | 'shader', fileName: string): Promise<void> {
  const folder = path.join(gameDirOf(instance), kind === 'shader' ? 'shaderpacks' : 'resourcepacks')
  await fsp.rm(path.join(folder, path.basename(fileName)), { force: true })
}

/* ------------------------------------------------------------------ *
 * Modpacks (.mrpack)
 * ------------------------------------------------------------------ */

interface MrpackIndex {
  formatVersion: number
  name: string
  versionId: string
  files: { path: string; hashes: { sha1?: string; sha512?: string }; downloads: string[]; fileSize: number }[]
  dependencies: Record<string, string>
}

export interface ModpackInstallResult {
  name: string
  installed: number
  failed: number
  summary: string
}

/** Installs a .mrpack into an existing instance's game dir. */
export async function installModpack(
  instance: Instance,
  packUrl: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<ModpackInstallResult> {
  const unzipper = (await import('unzipper')).default
  const gameDir = gameDirOf(instance)
  const cacheFile = path.join(gameDir, `.puxl-pack-${Date.now()}.mrpack`)

  if (packUrl.startsWith('file://')) {
    // Picked from disk by the user: a plain copy, undici cannot fetch file URLs.
    const source = decodeURIComponent(packUrl.replace(/^file:\/\//, ''))
    await fsp.mkdir(gameDir, { recursive: true })
    await fsp.copyFile(source, cacheFile)
  } else {
    await downloadFile(packUrl, cacheFile, { label: 'modpack' })
  }

  const zip = await unzipper.Open.file(cacheFile)
  const indexEntry = zip.files.find((f) => f.path === 'modrinth.index.json')
  if (!indexEntry) throw new Error('This .mrpack is missing modrinth.index.json')
  const index = JSON.parse((await indexEntry.buffer()).toString('utf8')) as MrpackIndex

  const tasks: BatchTask[] = []
  for (const file of index.files ?? []) {
    if (file.path.startsWith('mods/') && !instance.modsEnabled) continue
    const url = file.downloads?.[0]
    if (!url) continue
    tasks.push({
      url,
      dest: path.join(gameDir, file.path),
      sha1: file.hashes?.sha1,
      size: file.fileSize,
      label: file.path.split('/').pop() ?? 'pack file'
    })
  }

  onProgress?.(`Downloading ${tasks.length} pack files`, 0.1)
  const results = await downloadMany(tasks, 8, (done, total) => onProgress?.(`Pack file ${done}/${total}`, 0.1 + (done / Math.max(1, total)) * 0.8))

  // Overrides always win over the index.
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const entry of zip.files) {
      if (!entry.path.startsWith(prefix) || entry.type !== 'File') continue
      const rel = entry.path.slice(prefix.length)
      if (!rel) continue
      const dest = path.join(gameDir, rel)
      if (!dest.startsWith(gameDir)) continue
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, await entry.buffer())
    }
  }

  await fsp.rm(cacheFile, { force: true }).catch(() => undefined)

  // Tag the jars that came from this pack so the UI can group them.
  const packRegistry = readRegistry(instance)
  for (const mod of packRegistry.mods) {
    if (index.files?.some((f) => f.path === `mods/${mod.fileName}`)) mod.fromPack = `${index.name} ${index.versionId}`
  }
  writeRegistry(instance, packRegistry)

  const failed = results.filter((r) => r.error).length
  return {
    name: index.name,
    installed: results.length - failed,
    failed,
    summary: `${results.length - failed} of ${index.files?.length ?? 0} files installed from ${index.name} ${index.versionId}`
  }
}
