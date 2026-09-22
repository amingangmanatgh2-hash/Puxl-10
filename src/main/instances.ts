import fs from 'node:fs'
import path from 'node:path'
import { paths, safeName } from './paths'

export type LoaderKind = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface Instance {
  id: string
  name: string
  minecraftVersion: string
  loader: LoaderKind
  loaderVersion?: string
  /** Directory name under `versions/` that holds the runnable version json. */
  versionId: string
  /** Custom game directory; empty means `<root>/instances/<id>`. */
  gameDirOverride?: string
  memoryMb: number
  jvmArgs: string
  gameArgs: string
  javaPath: string
  width: number
  height: number
  fullscreen: boolean
  icon: string
  accent: string
  createdAt: number
  lastPlayed?: number
  playTimeMs: number
  modsEnabled: boolean
  perfPreset?: string
  notes?: string
}

export interface InstanceStore {
  instances: Instance[]
}

const STORE_FILE = () => path.join(paths().root, 'instances.json')

export function gameDirOf(instance: Instance): string {
  if (instance.gameDirOverride?.trim()) return instance.gameDirOverride
  return path.join(paths().instances, safeName(instance.id))
}

export function modsDirOf(instance: Instance): string {
  return path.join(gameDirOf(instance), 'mods')
}

export function readStore(): InstanceStore {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE(), 'utf8')) as InstanceStore
    if (Array.isArray(raw.instances)) return raw
  } catch {
    /* first run */
  }
  return { instances: [] }
}

export function writeStore(store: InstanceStore): void {
  const file = STORE_FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2))
  fs.renameSync(tmp, file)
}

export function listInstances(): Instance[] {
  return readStore().instances
}

export function getInstance(id: string): Instance | null {
  return listInstances().find((i) => i.id === id) ?? null
}

function slug(name: string): string {
  const base = safeName(name).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_.]/g, '')
  return base || 'instance'
}

export function newInstanceId(name: string): string {
  const existing = new Set(listInstances().map((i) => i.id))
  let candidate = slug(name)
  let n = 2
  while (existing.has(candidate)) candidate = `${slug(name)}-${n++}`
  return candidate
}

export function defaultInstance(partial: Partial<Instance> & { name: string; minecraftVersion: string }): Instance {
  const id = partial.id ?? newInstanceId(partial.name)
  const loader: LoaderKind = partial.loader ?? 'fabric'
  const versionId =
    partial.versionId ??
    (loader === 'vanilla'
      ? partial.minecraftVersion
      : loader === 'fabric' || loader === 'quilt'
        ? partial.loaderVersion
          ? `${loader}-loader-${partial.loaderVersion}-${partial.minecraftVersion}`
          : partial.minecraftVersion
        : partial.loaderVersion
          ? `${loader}-${partial.minecraftVersion}-${partial.loaderVersion}`
          : partial.minecraftVersion)

  return {
    id,
    name: partial.name,
    minecraftVersion: partial.minecraftVersion,
    loader,
    loaderVersion: partial.loaderVersion,
    versionId,
    gameDirOverride: partial.gameDirOverride ?? '',
    memoryMb: partial.memoryMb ?? 4096,
    jvmArgs: partial.jvmArgs ?? '',
    gameArgs: partial.gameArgs ?? '',
    javaPath: partial.javaPath ?? '',
    width: partial.width ?? 1280,
    height: partial.height ?? 720,
    fullscreen: partial.fullscreen ?? false,
    icon: partial.icon ?? 'grass',
    accent: partial.accent ?? '#7c5cff',
    createdAt: partial.createdAt ?? Date.now(),
    lastPlayed: partial.lastPlayed,
    playTimeMs: partial.playTimeMs ?? 0,
    modsEnabled: partial.modsEnabled ?? true,
    perfPreset: partial.perfPreset,
    notes: partial.notes
  }
}

export function addInstance(instance: Instance): Instance {
  const store = readStore()
  store.instances.unshift(instance)
  writeStore(store)
  return instance
}

export function updateInstance(id: string, patch: Partial<Instance>): Instance | null {
  const store = readStore()
  const idx = store.instances.findIndex((i) => i.id === id)
  if (idx < 0) return null
  store.instances[idx] = { ...store.instances[idx], ...patch, id: store.instances[idx].id }
  writeStore(store)
  return store.instances[idx]
}

export function deleteInstance(id: string, removeFiles: boolean): boolean {
  const store = readStore()
  const target = store.instances.find((i) => i.id === id)
  if (!target) return false
  store.instances = store.instances.filter((i) => i.id !== id)
  writeStore(store)
  if (removeFiles) {
    const dir = gameDirOf(target)
    try {
      if (dir.startsWith(paths().instances)) fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  return true
}

export function duplicateInstance(id: string, name: string): Instance | null {
  const source = getInstance(id)
  if (!source) return null
  const copy = defaultInstance({ ...source, id: undefined, name, createdAt: Date.now(), lastPlayed: undefined, playTimeMs: 0 })
  addInstance(copy)
  try {
    fs.cpSync(gameDirOf(source), gameDirOf(copy), { recursive: true })
  } catch {
    /* a missing game dir is fine */
  }
  return copy
}

export function ensureInstanceDirs(instance: Instance): string {
  const dir = gameDirOf(instance)
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'logs', 'screenshots']) {
    try {
      fs.mkdirSync(path.join(dir, sub), { recursive: true })
    } catch {
      /* ignore */
    }
  }
  return dir
}
