import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fetchJsonMirrored, downloadFile, type BatchTask } from './net'
import { paths, safeName } from './paths'
import type { LauncherSettings } from './store'

export const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export interface ManifestEntry {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  time: string
  releaseTime: string
  sha1: string
  complianceLevel?: number
}

export interface Manifest {
  latest: { release: string; snapshot: string }
  versions: ManifestEntry[]
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

export interface Downloads {
  artifact?: { path?: string; sha1: string; size: number; url: string }
  classifiers?: Record<string, { path?: string; sha1: string; size: number; url: string }>
}

export interface Library {
  name: string
  downloads?: Downloads
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
  url?: string
  checksums?: string[]
  clientreq?: boolean
  serverreq?: boolean
}

export interface ArgumentNode {
  rules?: Rule[]
  value: string | string[]
}

export interface VersionDetails {
  id: string
  type?: string
  mainClass: string
  inheritsFrom?: string
  assets: string
  assetIndex?: { id: string; sha1: string; size?: number; totalSize?: number; url: string }
  downloads: Record<string, { sha1: string; size: number; url: string }>
  libraries: Library[]
  javaVersion?: { component: string; majorVersion: number }
  arguments?: { game?: (string | ArgumentNode)[]; jvm?: (string | ArgumentNode)[] }
  minecraftArguments?: string
  logging?: Record<string, { file: { id: string; sha1: string; size: number; url: string }; argument: string; type: string }>
  complianceLevel?: number
  releaseTime?: string
  time?: string
}

/* ------------------------------------------------------------------ *
 * Rule evaluation
 * ------------------------------------------------------------------ */

export interface FeatureSet {
  is_demo_user?: boolean
  has_custom_resolution?: boolean
  has_quick_plays_support?: boolean
  is_quick_play_singleplayer?: boolean
  is_quick_play_multiplayer?: boolean
  is_quick_play_realms?: boolean
  [key: string]: boolean | undefined
}

export type OsName = 'windows' | 'osx' | 'linux'

export function currentOs(): OsName {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

export function currentArch(): string {
  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'arm64') return 'arm64'
  return 'x86'
}

function ruleMatches(rule: Rule, features: FeatureSet): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOs()) return false
    if (rule.os.arch && rule.os.arch !== currentArch() && !(rule.os.arch === 'x86' && currentArch() === 'x86_64')) return false
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(process.getSystemVersion?.() ?? '')) return false
      } catch {
        /* ignore bad regex from a modpack */
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      const actual = Boolean(features[key])
      if (actual !== expected) return false
    }
  }
  return true
}

export function rulesAllow(rules: Rule[] | undefined, features: FeatureSet): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow'
  }
  return allowed
}

export function flattenArguments(nodes: (string | ArgumentNode)[] | undefined, features: FeatureSet): string[] {
  const out: string[] = []
  if (!nodes) return out
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push(node)
      continue
    }
    if (rulesAllow(node.rules, features)) {
      if (Array.isArray(node.value)) out.push(...node.value)
      else out.push(node.value)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Version json handling
 * ------------------------------------------------------------------ */

export function versionDir(instanceId: string, rootOverride?: string): string {
  return path.join(rootOverride ?? paths().versions, safeName(instanceId))
}

export function versionJsonPath(instanceId: string, rootOverride?: string): string {
  return path.join(versionDir(instanceId, rootOverride), `${safeName(instanceId)}.json`)
}

export async function loadLocalVersion(instanceId: string, rootOverride?: string): Promise<VersionDetails | null> {
  const file = versionJsonPath(instanceId, rootOverride)
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as VersionDetails
  } catch {
    return null
  }
}

/**
 * Merge a loader's version json with the vanilla json it inherits from,
 * following the same inheritance rules as the official launcher.
 */
export async function resolveInherited(details: VersionDetails, rootOverride?: string): Promise<VersionDetails> {
  if (!details.inheritsFrom) return details
  const parent = await loadLocalVersion(details.inheritsFrom, rootOverride)
  if (!parent) throw new Error(`missing parent version ${details.inheritsFrom}`)
  const resolvedParent = await resolveInherited(parent, rootOverride)

  const mergedArgs = (a?: (string | ArgumentNode)[], b?: (string | ArgumentNode)[]) => {
    if (!a && !b) return undefined
    return [...(b ?? []), ...(a ?? [])]
  }

  const libraries = [...resolvedParent.libraries]
  for (const lib of details.libraries ?? []) {
    const idx = libraries.findIndex((l) => l.name.split('@')[0] === lib.name.split('@')[0])
    if (idx >= 0) libraries[idx] = lib
    else libraries.push(lib)
  }

  return {
    ...resolvedParent,
    ...details,
    id: details.id,
    mainClass: details.mainClass || resolvedParent.mainClass,
    assets: details.assets || resolvedParent.assets,
    assetIndex: details.assetIndex ?? resolvedParent.assetIndex,
    downloads: { ...resolvedParent.downloads, ...details.downloads },
    javaVersion: details.javaVersion ?? resolvedParent.javaVersion,
    libraries,
    arguments: {
      game: mergedArgs(details.arguments?.game, resolvedParent.arguments?.game),
      jvm: mergedArgs(details.arguments?.jvm, resolvedParent.arguments?.jvm)
    },
    logging: details.logging ?? resolvedParent.logging,
    minecraftArguments: details.minecraftArguments ?? resolvedParent.minecraftArguments
  }
}

/**
 * The version json that actually owns the client jar. Loader json files inherit
 * from vanilla, and the official launcher resolves the jar from the ancestor.
 */
export async function findClientJarOwner(details: VersionDetails, rootOverride?: string): Promise<string> {
  if (details.downloads?.client?.url) return details.id
  if (details.inheritsFrom) {
    const parent = await loadLocalVersion(details.inheritsFrom, rootOverride)
    if (parent) return findClientJarOwner(parent, rootOverride)
    return details.inheritsFrom
  }
  return details.id
}

export async function fetchManifest(): Promise<Manifest> {
  return fetchJsonMirrored<Manifest>(VERSION_MANIFEST)
}

export async function fetchVersionDetails(entry: ManifestEntry): Promise<VersionDetails> {
  return fetchJsonMirrored<VersionDetails>(entry.url, { version: entry.id })
}

/* ------------------------------------------------------------------ *
 * Libraries / natives resolution
 * ------------------------------------------------------------------ */

export interface ResolvedLibrary {
  group: string
  artifact: string
  version: string
  classifier?: string
  path: string
  url: string
  sha1?: string
  size?: number
  isNative: boolean
  extractExclude: string[]
}

/** Maven repos a version json may reference, keyed by the group-id prefix they own. */
const MAVEN_REPOS: { prefix: string; base: string }[] = [
  { prefix: 'net.fabricmc', base: 'https://maven.fabricmc.net/' },
  { prefix: 'org.quiltmc', base: 'https://maven.quiltmc.org/repository/release/' },
  { prefix: 'org.quiltmc.quilt-json5', base: 'https://maven.quiltmc.org/repository/release/' },
  { prefix: 'net.minecraftforge', base: 'https://maven.minecraftforge.net/' },
  { prefix: 'net.neoforged', base: 'https://maven.neoforged.net/releases/' },
  { prefix: 'cpw.mods', base: 'https://maven.minecraftforge.net/' },
  { prefix: 'org.spongepowered', base: 'https://repo.spongepowered.org/repository/maven-public/' },
  { prefix: 'com.electronwill', base: 'https://repo1.maven.org/maven2/' },
  { prefix: 'org.jetbrains', base: 'https://repo1.maven.org/maven2/' },
  { prefix: 'org.ow2', base: 'https://repo1.maven.org/maven2/' },
  { prefix: 'com.github', base: 'https://jitpack.io/' }
]

function mavenPath(group: string, artifact: string, version: string, classifier?: string): string {
  const g = group.replace(/\./g, '/')
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  return `${g}/${artifact}/${version}/${file}`
}

/** Best guess at which maven repo hosts a given group id. */
export function defaultMavenUrl(group: string): string {
  for (const repo of MAVEN_REPOS) {
    if (group === repo.prefix || group.startsWith(`${repo.prefix}.`)) return repo.base
  }
  // Mojang's own artifacts (lwjgl, apache, google, datalogics, ...) live on libraries.minecraft.net.
  return 'https://libraries.minecraft.net/'
}

export function resolveLibraries(libs: Library[], features: FeatureSet): ResolvedLibrary[] {
  const out: ResolvedLibrary[] = []
  const nativesKey = `natives-${currentOs() === 'windows' ? 'windows' : currentOs() === 'osx' ? 'macos' : 'linux'}`

  for (const lib of libs) {
    if (!rulesAllow(lib.rules, features)) continue

    const [group, artifact, version, classifier] = lib.name.split('@')[0].split(':')
    if (!group || !artifact || !version) continue

    const extractExclude = lib.extract?.exclude ?? []

    // Old-style natives (with a `natives` classifier map).
    const legacyClassifier = lib.natives?.[currentOs() === 'osx' ? 'osx' : currentOs()]
    if (legacyClassifier) {
      const dl = lib.downloads?.classifiers?.[legacyClassifier]
      if (dl) {
        out.push({
          group,
          artifact,
          version,
          classifier: legacyClassifier,
          path: dl.path ?? mavenPath(group, artifact, version, legacyClassifier.replace('${arch}', currentArch().replace('x86_64', '64').replace('x86', '32'))),
          url: dl.url,
          sha1: dl.sha1,
          size: dl.size,
          isNative: true,
          extractExclude
        })
      }
      // Some very old versions also ship the plain jar; keep it on the classpath.
      const plain = lib.downloads?.artifact
      if (plain?.url) {
        out.push({
          group,
          artifact,
          version,
          classifier,
          path: plain.path ?? mavenPath(group, artifact, version, classifier),
          url: plain.url,
          sha1: plain.sha1,
          size: plain.size,
          isNative: false,
          extractExclude: []
        })
      }
      continue
    }

    const artifactDl = lib.downloads?.artifact
    const pathGuess = artifactDl?.path ?? mavenPath(group, artifact, version, classifier)
    const isNativeJar = pathGuess.includes(`-${nativesKey}.jar`) || Boolean(classifier && classifier.startsWith('natives-'))
    const declaredRepo = lib.url ? (/^https?:\/\//.test(lib.url) ? lib.url : `https://${lib.url}`).replace(/\/$/, '') : defaultMavenUrl(group)
    const url = artifactDl?.url ?? `${declaredRepo}/${mavenPath(group, artifact, version, classifier)}`

    out.push({
      group,
      artifact,
      version,
      classifier,
      path: pathGuess,
      url,
      sha1: artifactDl?.sha1,
      size: artifactDl?.size,
      isNative: isNativeJar,
      extractExclude: isNativeJar ? extractExclude : []
    })
  }

  return out
}

/**
 * Forge's version json ships libraries without `downloads` blocks that only
 * exist on Forge's own maven; this fills in the URL so they can be fetched.
 */
export function libraryUrl(lib: Library): string | null {
  if (lib.downloads?.artifact?.url) return lib.downloads.artifact.url
  if (lib.downloads?.classifiers) {
    const key = `natives-${currentOs() === 'windows' ? 'windows' : currentOs() === 'osx' ? 'macos' : 'linux'}`
    const dl = lib.downloads.classifiers[key]
    if (dl?.url) return dl.url
  }
  const [group, artifact, version] = lib.name.split('@')[0].split(':')
  if (!group || !artifact || !version) return null
  if (!lib.url) return null
  const base = /^https?:\/\//.test(lib.url) ? `${lib.url.replace(/\/$/, '')}/` : `https://${lib.url.replace(/\/$/, '')}/`
  return `${base}${mavenPath(group, artifact, version)}`
}

/* ------------------------------------------------------------------ *
 * Downloads: client jar + libraries + natives + assets
 * ------------------------------------------------------------------ */

export function clientJarPath(versionId: string, rootOverride?: string): string {
  return path.join(versionDir(versionId, rootOverride), `${safeName(versionId)}.jar`)
}

export function nativesDir(instanceId: string, versionId: string, rootOverride?: string): string {
  return path.join(rootOverride ?? paths().natives, safeName(instanceId), safeName(versionId))
}

export interface DownloadPlanResult {
  tasks: BatchTask[]
  natives: ResolvedLibrary[]
  clientJar: string
  assetIndexPath: string
  assetsDir: string
  gameDir: string
}

export async function buildDownloadPlan(opts: {
  /** Instance/version being installed — owns the natives folder. */
  instanceId: string
  /** Version that owns the client jar (usually the vanilla ancestor). */
  clientJarOwner?: string
  gameDir: string
  details: VersionDetails
  settings: LauncherSettings
  features?: FeatureSet
  skipAssets?: boolean
}): Promise<DownloadPlanResult> {
  const P = paths()
  const features: FeatureSet = { has_custom_resolution: true, ...(opts.features ?? {}) }
  const tasks: BatchTask[] = []
  const hint = { version: opts.details.id }

  const clientDl = opts.details.downloads?.client
  const clientJar = clientJarPath(opts.clientJarOwner ?? opts.instanceId)
  if (clientDl?.url) {
    tasks.push({
      url: clientDl.url,
      dest: clientJar,
      sha1: clientDl.sha1,
      size: clientDl.size,
      label: `client ${opts.details.id}`,
      hint
    })
  }

  const libs = resolveLibraries(opts.details.libraries ?? [], features)
  const natives: ResolvedLibrary[] = []
  for (const lib of libs) {
    if (lib.isNative) natives.push(lib)
    if (!lib.url) continue
    tasks.push({
      url: lib.url,
      dest: path.join(P.libraries, lib.path),
      sha1: lib.sha1,
      size: lib.size,
      label: `${lib.artifact}-${lib.version}${lib.classifier ? `:${lib.classifier}` : ''}`
    })
  }

  // Log4j config for old versions (avoids the 1.7-1.12 vulnerability).
  const logging = opts.details.logging?.client?.file
  if (logging?.url) {
    tasks.push({
      url: logging.url,
      dest: path.join(P.cache, 'log_configs', logging.id),
      sha1: logging.sha1,
      size: logging.size,
      label: 'log4j config'
    })
  }

  const assetIndex = opts.details.assetIndex
  const assetsDir = P.assets
  let assetIndexPath = ''
  if (assetIndex?.url) {
    assetIndexPath = path.join(P.assetIndexes, `${assetIndex.id}.json`)
    tasks.push({
      url: assetIndex.url,
      dest: assetIndexPath,
      sha1: assetIndex.sha1,
      size: assetIndex.size,
      label: `assets index ${assetIndex.id}`,
      hint
    })

    if (!opts.skipAssets) {
      const index = await loadAssetIndex(assetIndex.id)
      if (index) {
        for (const object of Object.values(index.objects)) {
          const dir = object.hash.slice(0, 2)
          tasks.push({
            url: `https://resources.download.minecraft.net/${dir}/${object.hash}`,
            dest: path.join(assetsDir, 'objects', dir, object.hash),
            sha1: object.hash,
            size: object.size,
            label: `asset ${object.hash.slice(0, 8)}`
          })
        }
        // Pre-1.7 versions read a flat `assets/virtual/legacy` tree.
        if (index.virtual || index.map_to_resources) {
          const legacyFolder = typeof index.virtual === 'string' ? index.virtual : 'legacy'
          const virtualDir = path.join(assetsDir, typeof index.virtual === 'string' ? 'virtual' : 'resources', legacyFolder)
          for (const [name, object] of Object.entries(index.objects)) {
            const dir = object.hash.slice(0, 2)
            tasks.push({
              url: `https://resources.download.minecraft.net/${dir}/${object.hash}`,
              dest: path.join(virtualDir, name),
              sha1: object.hash,
              size: object.size,
              label: `legacy asset ${name}`
            })
          }
        }
      }
    }
  }

  return { tasks, natives, clientJar, assetIndexPath, assetsDir, gameDir: opts.gameDir }
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export async function loadAssetIndex(id: string): Promise<AssetIndex | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(paths().assetIndexes, `${id}.json`), 'utf8')) as AssetIndex
  } catch {
    return null
  }
}

/** Extracts native jars into the instance natives folder, skipping META-INF noise. */
export async function extractNatives(natives: ResolvedLibrary[], targetDir: string): Promise<void> {
  if (natives.length === 0) return
  await fsp.mkdir(targetDir, { recursive: true })
  const unzipper = (await import('unzipper')).default
  for (const lib of natives) {
    const jar = path.join(paths().libraries, lib.path)
    if (!fs.existsSync(jar)) continue
    try {
      const dir = await unzipper.Open.file(jar)
      for (const entry of dir.files) {
        if (entry.type !== 'File') continue
        const name = entry.path
        if (name.startsWith('META-INF/')) continue
        if (lib.extractExclude.some((ex) => name.startsWith(ex))) continue
        if (name.endsWith('.git') || name.endsWith('.sha1')) continue
        const dest = path.join(targetDir, name)
        if (!dest.startsWith(targetDir)) continue // zip-slip guard
        await fsp.mkdir(path.dirname(dest), { recursive: true })
        await fsp.writeFile(dest, await entry.buffer())
      }
    } catch {
      /* a broken native jar shouldn't kill the launch */
    }
  }
}

/** Ensure the client jar exists in the folder of the version that owns it. */
export async function ensureClientJar(ownerId: string, details: VersionDetails): Promise<string | null> {
  const jar = clientJarPath(ownerId)
  const dl = details.downloads?.client
  if (!dl?.url) return fs.existsSync(jar) ? jar : null
  if (fs.existsSync(jar)) {
    const size = (await fsp.stat(jar)).size
    if (!dl.size || size === dl.size) return jar
  }
  await downloadFile(dl.url, jar, { sha1: dl.sha1, size: dl.size, label: `client ${details.id}`, hint: { version: ownerId } })
  return jar
}
