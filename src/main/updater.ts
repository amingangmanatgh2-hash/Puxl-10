import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app, shell } from 'electron'
import { downloadFile, fetchJsonMirrored, GITHUB_PROXIES } from './net'
import { paths } from './paths'
import { loadSettings } from './store'

export const REPO = { owner: 'amingangmanatgh2-hash', repo: 'Puxl-10' }

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface ReleaseInfo {
  version: string
  tag: string
  notes: string
  pageUrl: string
  publishedAt: string
  assets: ReleaseAsset[]
}

export type UpdateState =
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking'; currentVersion: string }
  | { status: 'current'; currentVersion: string }
  | { status: 'available'; currentVersion: string; release: ReleaseInfo; asset: ReleaseAsset | null }
  | { status: 'downloading'; currentVersion: string; release: ReleaseInfo; asset: ReleaseAsset; received: number; total: number; speed: number }
  | { status: 'ready'; currentVersion: string; release: ReleaseInfo; asset: ReleaseAsset; file: string }
  | { status: 'error'; currentVersion: string; message: string }

/* ------------------------------------------------------------------ *
 * Pure helpers (unit tested in scripts/smoke.ts)
 * ------------------------------------------------------------------ */

/** Numeric comparison of dotted versions; prerelease suffixes sort lower. @returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): { nums: number[]; pre: string } => {
    const clean = value.trim().replace(/^v/i, '')
    const [core, ...rest] = clean.split('-')
    const nums = core.split('.').map((part) => {
      const match = part.match(/^\d+/)
      return match ? Number.parseInt(match[0], 10) : 0
    })
    return { nums, pre: rest.join('-') }
  }

  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.nums.length, right.nums.length)
  for (let i = 0; i < length; i++) {
    const x = left.nums[i] ?? 0
    const y = right.nums[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  // 1.1.0 > 1.1.0-beta, 1.1.0-beta.2 > 1.1.0-beta.1
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre > right.pre ? 1 : -1
}

/** Picks the installer a Windows user should download, preferring the setup exe. */
export function pickInstallerAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const exes = assets.filter((asset) => /\.exe$/i.test(asset.name))
  return (
    exes.find((asset) => /setup/i.test(asset.name)) ??
    exes.find((asset) => !/portable/i.test(asset.name)) ??
    exes[0] ??
    null
  )
}

/**
 * Release API endpoints, official first then GitHub reverse proxies for restricted
 * networks. `PUXL_RELEASE_API` overrides everything — point it at your own mirror,
 * a self-hosted copy of the release json, or your own relay.
 */
export function releaseApiUrls(): string[] {
  const override = process.env.PUXL_RELEASE_API?.trim()
  if (override) return [override]

  const official = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`
  const list = [official]
  for (const proxy of GITHUB_PROXIES) list.push(`${proxy}${official}`)
  // Some proxies only forward raw/release hosts; the page itself is always a fallback.
  list.push(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases?per_page=1`)
  return [...new Set(list)]
}

export function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
}

export function currentVersion(): string {
  return app.getVersion()
}

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

let state: UpdateState = { status: 'idle', currentVersion: '0.0.0' }
const listeners = new Set<(next: UpdateState) => void>()

export function onUpdateState(listener: (next: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUpdateState(): UpdateState {
  return state
}

function setState(next: UpdateState): void {
  state = next
  for (const listener of listeners) {
    try {
      listener(next)
    } catch {
      /* a broken listener must not break the updater */
    }
  }
}

export function initUpdater(): void {
  setState({ status: 'idle', currentVersion: currentVersion() })
}

async function fetchRelease(): Promise<ReleaseInfo> {
  let lastError: unknown = new Error('could not reach GitHub releases')
  for (const url of releaseApiUrls()) {
    try {
      const raw = await fetchJsonMirrored<Record<string, unknown>>(url, undefined, { timeoutMs: 15_000 })
      const entry = Array.isArray(raw) ? (raw[0] as Record<string, unknown>) : raw
      if (!entry || !entry.tag_name) throw new Error('unexpected release payload')
      const assets = ((entry.assets as Record<string, unknown>[]) ?? []).map((asset) => ({
        name: String(asset.name ?? ''),
        url: String(asset.browser_download_url ?? ''),
        size: Number(asset.size ?? 0)
      }))
      return {
        version: String(entry.tag_name).replace(/^v/i, ''),
        tag: String(entry.tag_name),
        notes: String(entry.body ?? ''),
        pageUrl: String(entry.html_url ?? `https://github.com/${REPO.owner}/${REPO.repo}/releases`),
        publishedAt: String(entry.published_at ?? ''),
        assets
      }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function checkForUpdates(): Promise<UpdateState> {
  const version = currentVersion()
  setState({ status: 'checking', currentVersion: version })
  try {
    const release = await fetchRelease()
    if (compareVersions(release.version, version) <= 0) {
      setState({ status: 'current', currentVersion: version })
      return state
    }
    const asset = pickInstallerAsset(release.assets)
    setState({ status: 'available', currentVersion: version, release, asset })
    return state
  } catch (err) {
    setState({ status: 'error', currentVersion: version, message: err instanceof Error ? err.message : String(err) })
    return state
  }
}

function downloadTarget(release: ReleaseInfo, asset: ReleaseAsset): string {
  const safe = asset.name.replace(/[^A-Za-z0-9._-]/g, '_')
  return path.join(paths().cache, 'updates', `${release.version}-${safe}`)
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status !== 'available') throw new Error('No update is available to download right now.')
  const { release, asset } = state
  if (!asset) throw new Error('This release has no installer attached. Use "Open release page" instead.')

  const target = downloadTarget(release, asset)
  setState({
    status: 'downloading',
    currentVersion: state.currentVersion,
    release,
    asset,
    received: 0,
    total: asset.size,
    speed: 0
  })

  try {
    await downloadFile(asset.url, target, {
      label: `Puxl ${release.version}`,
      size: asset.size,
      // Progress is reported through the shared transfer hub; mirror the headline
      // numbers into the update state so the settings card can render them too.
      onProgress: (received, total, speed) => {
        setState({ status: 'downloading', currentVersion: currentVersion(), release, asset, received, total, speed })
      }
    })
    setState({ status: 'ready', currentVersion: currentVersion(), release, asset, file: target })
    return state
  } catch (err) {
    setState({ status: 'error', currentVersion: currentVersion(), message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export async function installUpdate(): Promise<void> {
  if (state.status !== 'ready') throw new Error('The update has not been downloaded yet.')
  const file = state.file
  if (!fs.existsSync(file)) throw new Error('The downloaded installer is gone. Download it again.')
  if (isPortableBuild()) {
    // A portable copy cannot replace itself; show the file so the user can swap it in.
    shell.showItemInFolder(file)
    return
  }

  const child = spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  // Give the installer a moment to start before the app closes its files.
  setTimeout(() => app.quit(), 1500)
}

export async function openReleasePage(): Promise<void> {
  const url =
    state.status === 'available' || state.status === 'downloading' || state.status === 'ready'
      ? state.release.pageUrl
      : `https://github.com/${REPO.owner}/${REPO.repo}/releases`
  await shell.openExternal(url)
}

/** Startup check, skipped in development and when the user turned it off. */
export function scheduleStartupCheck(delayMs = 6000): void {
  const settings = loadSettings()
  if (!settings.checkLauncherUpdates) return
  if (!app.isPackaged) return
  setTimeout(() => {
    void checkForUpdates()
  }, delayMs)
}

export async function clearDownloadedUpdates(): Promise<void> {
  await fsp.rm(path.join(paths().cache, 'updates'), { recursive: true, force: true }).catch(() => undefined)
}
