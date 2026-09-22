import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent, ProxyAgent, fetch, setGlobalDispatcher, type Dispatcher } from 'undici'
import type { MirrorMode } from './store'

/* ------------------------------------------------------------------ *
 * Progress hub — every transfer reports into here, the UI listens.
 * ------------------------------------------------------------------ */

export interface TransferProgress {
  id: string
  label: string
  url: string
  received: number
  total: number
  speed: number
  state: 'queued' | 'running' | 'done' | 'failed' | 'retrying'
  error?: string
}

type ProgressListener = (p: TransferProgress) => void
const listeners = new Set<ProgressListener>()

export function onTransferProgress(cb: ProgressListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(p: TransferProgress): void {
  for (const l of listeners) {
    try {
      l(p)
    } catch {
      /* never let a listener break a download */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Mirror resolution — the reason this launcher works on Iranian ISPs.
 * ------------------------------------------------------------------ */

export interface MirrorHint {
  /** Minecraft version, needed to rewrite piston-data object URLs to BMCLAPI endpoints. */
  version?: string
}

const BMCLAPI = 'https://bmclapi2.bangbang93.com'
const BMCLAPI_FALLBACK = 'https://bmclapi.bangbang93.com'

/** Reverse proxies that prefix any URL, commonly used to reach GitHub from Iran/China. */
export const GITHUB_PROXIES = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/']

export interface MirrorConfig {
  mode: MirrorMode
  custom: { match: string; replace: string }[]
}

let mirrorConfig: MirrorConfig = { mode: 'auto', custom: [] }

export function setMirrorConfig(cfg: MirrorConfig): void {
  mirrorConfig = cfg
}

function bmclapiFor(url: string, hint?: MirrorHint): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname
  const p = u.pathname

  if (host === 'piston-meta.mojang.com' || host === 'launchermeta.mojang.com') {
    // .../v1/packages/<sha>/<version>.json  ->  /version/<version>/json
    const pkg = p.match(/^\/v1\/packages\/[0-9a-f]{40}\/(.+)\.json$/i)
    if (pkg) return `${BMCLAPI}/version/${encodeURIComponent(pkg[1])}/json`
    return `${BMCLAPI}${p}`
  }
  if (host === 'piston-data.mojang.com' || host === 'launcher.mojang.com') {
    if (hint?.version) {
      if (p.endsWith('/client.jar')) return `${BMCLAPI}/version/${encodeURIComponent(hint.version)}/client`
      if (p.endsWith('/server.jar')) return `${BMCLAPI}/version/${encodeURIComponent(hint.version)}/server`
    }
    if (p.startsWith('/v1/objects/')) return `${BMCLAPI}${p.replace('/v1/objects/', '/objects/')}`
    return `${BMCLAPI}${p}`
  }
  if (host === 'resources.download.minecraft.net') return `${BMCLAPI}/assets${p}`
  if (host === 'libraries.minecraft.net' || host === 'maven.minecraftforge.net' || host === 'files.minecraftforge.net') {
    return `${BMCLAPI}/maven${p}`
  }
  if (host === 'maven.fabricmc.net' || host === 'meta.fabricmc.net' || host === 'maven.quiltmc.org' || host === 'meta.quiltmc.org') {
    // BMCLAPI mirrors the Fabric/Quilt maven trees under /maven, and the meta
    // APIs are reachable through the generic object passthrough.
    if (host.startsWith('maven') && host.includes('fabric')) return `${BMCLAPI}/maven${p}`
    if (host.startsWith('maven') && host.includes('quilt')) return `${BMCLAPI}/maven${p}`
    return `${BMCLAPI}${p}`
  }
  return null
}

function githubProxyFor(url: string): string | null {
  try {
    const host = new URL(url).hostname
    if (host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'objects.githubusercontent.com' || host === 'codeload.github.com') {
      return `${GITHUB_PROXIES[0]}${url}`
    }
  } catch {
    /* ignore */
  }
  return null
}

function applyCustom(url: string): string[] {
  const out: string[] = []
  for (const rule of mirrorConfig.custom) {
    if (!rule.match || !rule.replace) continue
    if (url.includes(rule.match)) out.push(url.split(rule.match).join(rule.replace))
  }
  return out
}

/** Returns every candidate URL for a resource, best-first, de-duplicated. */
export function resolveUrls(url: string, hint?: MirrorHint): string[] {
  const mirrors: string[] = []
  const direct = [url]

  const bm = bmclapiFor(url, hint)
  if (bm) mirrors.push(bm, bm.replace(BMCLAPI, BMCLAPI_FALLBACK))

  const custom = applyCustom(url)
  mirrors.push(...custom)

  const gh = githubProxyFor(url)
  if (gh) {
    for (const proxy of GITHUB_PROXIES) mirrors.push(`${proxy}${url}`)
    void gh
  }

  const ordered =
    mirrorConfig.mode === 'direct' ? [...direct, ...mirrors] : mirrorConfig.mode === 'iran' ? [...mirrors, ...direct] : [...direct, ...mirrors]

  return [...new Set(ordered)].filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

let insecure = false

export function configureNetwork(opts: { proxyUrl?: string; allowInsecureTLS?: boolean }): void {
  insecure = opts.allowInsecureTLS ?? false
  const proxy = opts.proxyUrl?.trim()
  let dispatcher: Dispatcher
  if (proxy) {
    dispatcher = new ProxyAgent({
      uri: proxy,
      requestTls: insecure ? { rejectUnauthorized: false } : undefined,
      proxyTls: insecure ? { rejectUnauthorized: false } : undefined
    })
  } else {
    dispatcher = new Agent({ connect: insecure ? { rejectUnauthorized: false } : {} })
  }
  setGlobalDispatcher(dispatcher)
}

/** Standalone helper so the assistant can use its own proxy. */
export async function fetchWithProxy(
  url: string,
  init: { proxyUrl?: string; [key: string]: unknown } = {}
): Promise<Response> {
  const { proxyUrl, ...rest } = init
  // undici's own RequestInit differs from the DOM one that TypeScript merges in
  // from @types/node, so the payload is passed through opaquely.
  if (!proxyUrl) return (await fetch(url, rest as never)) as unknown as Response
  const dispatcher = new ProxyAgent({ uri: proxyUrl })
  return (await fetch(url, { ...rest, dispatcher } as never)) as unknown as Response
}

export const USER_AGENT = 'PuxlLauncher/1.0 (+https://github.com/amingangmanatgh2-hash/Puxl-10)'

export async function fetchJson<T>(url: string, init: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000)
  } as never)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

/** JSON fetch that walks the mirror list until one answers. */
export async function fetchJsonMirrored<T>(url: string, hint?: MirrorHint): Promise<T> {
  const candidates = resolveUrls(url, hint)
  let lastError: unknown = new Error(`no route to ${url}`)
  for (const candidate of candidates) {
    try {
      return await fetchJson<T>(candidate)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (c) => hash.update(c))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function fileSha1(file: string): Promise<string | null> {
  try {
    return await sha1File(file)
  } catch {
    return null
  }
}

export interface DownloadOptions {
  label?: string
  /** Expected sha1, verified after transfer; a mismatch triggers a retry from scratch. */
  sha1?: string
  /** Expected byte size, used for progress bars and to skip already-complete files. */
  size?: number
  hint?: MirrorHint
  signal?: AbortSignal
  /** Allow Range-resume of a partial file. */
  resume?: boolean
  attempts?: number
}

/**
 * Download `url` to `dest` with mirror fallback, retry, resume and integrity check.
 * Safe to call concurrently for different destinations.
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const id = dest
  const label = opts.label || path.basename(dest)
  const attempts = Math.max(1, opts.attempts ?? 3)
  const candidates = resolveUrls(url, opts.hint)
  const useResume = opts.resume !== false

  await fsp.mkdir(path.dirname(dest), { recursive: true })

  if (opts.sha1) {
    const existing = fs.existsSync(dest) ? await fileSha1(dest) : null
    if (existing && existing.toLowerCase() === opts.sha1.toLowerCase()) {
      emit({ id, label, url, received: opts.size ?? 0, total: opts.size ?? 0, speed: 0, state: 'done' })
      return
    }
  } else if (opts.size && fs.existsSync(dest)) {
    try {
      if ((await fsp.stat(dest)).size === opts.size) {
        emit({ id, label, url, received: opts.size, total: opts.size, speed: 0, state: 'done' })
        return
      }
    } catch {
      /* ignore */
    }
  }

  let lastError: unknown = new Error('download failed')

  for (let attempt = 0; attempt < attempts; attempt++) {
    const target = candidates[Math.min(attempt, candidates.length - 1)]
    let startAt = 0
    if (useResume && fs.existsSync(dest)) {
      try {
        startAt = (await fsp.stat(dest)).size
      } catch {
        startAt = 0
      }
    }
    try {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT }
      if (startAt > 0) headers.range = `bytes=${startAt}-`

      const res = await fetch(target, { headers, signal: opts.signal } as never)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const partial = res.status === 206
      const already = partial ? startAt : 0
      if (!partial) startAt = 0

      const declared = Number(res.headers.get('content-length') ?? 0)
      const total = opts.size ?? (declared ? declared + already : 0)

      let received = already
      let windowBytes = 0
      const started = Date.now()

      const sink = fs.createWriteStream(dest, { flags: partial ? 'a' : 'w' })
      const source = Readable.fromWeb(res.body as never)
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        windowBytes += chunk.length
        const elapsed = Math.max(1, Date.now() - started) / 1000
        emit({
          id,
          label,
          url: target,
          received,
          total,
          speed: windowBytes / elapsed,
          state: 'running'
        })
      })

      await pipeline(source, sink)

      if (opts.sha1) {
        const got = await sha1File(dest)
        if (got.toLowerCase() !== opts.sha1.toLowerCase()) {
          throw new Error(`checksum mismatch (${got.slice(0, 8)} != ${opts.sha1.slice(0, 8)})`)
        }
      }
      if (opts.size && opts.size > 0) {
        const actual = (await fsp.stat(dest)).size
        if (actual !== opts.size) throw new Error(`size mismatch (${actual} != ${opts.size})`)
      }

      emit({ id, label, url: target, received: total || received, total: total || received, speed: 0, state: 'done' })
      return
    } catch (err) {
      lastError = err
      if (opts.signal?.aborted) throw err
      emit({
        id,
        label,
        url: target,
        received: 0,
        total: opts.size ?? 0,
        speed: 0,
        state: attempt === attempts - 1 ? 'failed' : 'retrying',
        error: err instanceof Error ? err.message : String(err)
      })
      // A checksum failure means the partial file is garbage — drop it.
      if (err instanceof Error && err.message.startsWith('checksum')) {
        await fsp.rm(dest, { force: true })
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface BatchTask extends DownloadOptions {
  url: string
  dest: string
}

/** Run downloads with a bounded worker pool; never rejects, failures land in the result list. */
export async function downloadMany(
  tasks: BatchTask[],
  concurrency: number,
  onDone?: (done: number, total: number) => void
): Promise<{ url: string; dest: string; error?: string }[]> {
  const results: { url: string; dest: string; error?: string }[] = []
  let index = 0
  let done = 0
  const workers = Math.max(1, Math.min(concurrency, tasks.length))

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = index++
        if (i >= tasks.length) return
        const task = tasks[i]
        try {
          await downloadFile(task.url, task.dest, task)
          results.push({ url: task.url, dest: task.dest })
        } catch (err) {
          results.push({ url: task.url, dest: task.dest, error: err instanceof Error ? err.message : String(err) })
        } finally {
          done++
          onDone?.(done, tasks.length)
        }
      }
    })
  )

  return results
}

export async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) } as never)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** Text fetch that walks the mirror list until one answers. */
export async function fetchTextMirrored(url: string, hint?: MirrorHint): Promise<string> {
  const candidates = resolveUrls(url, hint)
  let lastError: unknown = new Error(`no route to ${url}`)
  for (const candidate of candidates) {
    try {
      return await fetchText(candidate)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
