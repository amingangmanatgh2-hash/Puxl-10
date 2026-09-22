import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'

/**
 * Everything Puxl downloads or creates lives under a single root, so the whole
 * install can be moved / backed up / removed without leaving breadcrumbs.
 */
export interface PuxlPaths {
  root: string
  versions: string
  libraries: string
  assets: string
  assetIndexes: string
  natives: string
  instances: string
  java: string
  cache: string
  logs: string
  tools: string
}

let cached: PuxlPaths | null = null
let rootOverride: string | null = null

export function setRootOverride(dir: string | null): void {
  rootOverride = dir
  cached = null
}

export function defaultRoot(): string {
  // Keep the data next to the OS user profile, matching vanilla Minecraft so
  // users who already own a .minecraft folder can point Puxl straight at it.
  return path.join(app.getPath('appData'), 'PuxlLauncher')
}

export function paths(): PuxlPaths {
  if (cached) return cached
  const root = rootOverride ?? defaultRoot()
  cached = {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    assetIndexes: path.join(root, 'assets', 'indexes'),
    natives: path.join(root, 'natives'),
    instances: path.join(root, 'instances'),
    java: path.join(root, 'java'),
    cache: path.join(root, 'cache'),
    logs: path.join(root, 'logs'),
    tools: path.join(root, 'tools')
  }
  return cached
}

export function ensureDirs(): void {
  for (const dir of Object.values(paths())) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* ignore */
    }
  }
}

export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+$/, '').trim() || 'instance'
}

export function tempDirName(): string {
  return path.join(os.tmpdir(), `puxl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}
