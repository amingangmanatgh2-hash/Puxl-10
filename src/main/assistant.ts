import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fetchWithProxy, fetchJson } from './net'
import { loadSettings } from './store'
import { gameDirOf, getInstance, listInstances } from './instances'
import { PERF_MODS } from './perf'

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

export interface AssistantContext {
  instanceId?: string
  includeLogs?: boolean
  extra?: string
}

export interface AssistantReply {
  text: string
  mode: 'gemini' | 'offline'
  usedContext: string[]
}

const SYSTEM_PROMPT = `You are the built-in assistant of Puxl Launcher, a Minecraft: Java Edition launcher for Windows.
You help with: installing game versions and loaders (Vanilla, Fabric, Quilt, Forge, NeoForge), mod management through Modrinth,
performance tuning (Sodium, Lithium, Embeddium and friends), shader packs, memory/JVM arguments, Java runtimes, crash reports,
and download problems on restricted networks (mirrors, proxies).

Ground rules:
- Only describe features the launcher really has. Never invent settings that do not exist.
- Be concrete: give exact setting names, file paths, or mod names.
- Answer in the same language the user wrote in (Persian/Farsi users get Persian answers).
- Keep answers short: a few sentences or a short numbered list. No filler, no marketing.
- If the user's problem needs a log or crash report you do not have, say which button produces it.`

/* ------------------------------------------------------------------ *
 * Context building
 * ------------------------------------------------------------------ */

async function tailOfFile(file: string, lines: number): Promise<string> {
  try {
    const stat = await fsp.stat(file)
    const readSize = Math.min(stat.size, 64 * 1024)
    const handle = await fsp.open(file, 'r')
    const buffer = Buffer.alloc(readSize)
    await handle.read(buffer, 0, readSize, Math.max(0, stat.size - readSize))
    await handle.close()
    return buffer.toString('utf8').split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

async function buildContext(ctx: AssistantContext): Promise<{ block: string; used: string[] }> {
  const used: string[] = []
  const parts: string[] = []
  const settings = loadSettings()

  const instance = ctx.instanceId ? getInstance(ctx.instanceId) : listInstances()[0] ?? null
  if (instance) {
    used.push('instance')
    parts.push(
      `Active instance: name="${instance.name}", Minecraft ${instance.minecraftVersion}, loader=${instance.loader}${
        instance.loaderVersion ? ` ${instance.loaderVersion}` : ''
      }, memory=${instance.memoryMb} MB, game dir=${gameDirOf(instance)}`
    )

    const modsDir = path.join(gameDirOf(instance), 'mods')
    try {
      const mods = (await fsp.readdir(modsDir)).filter((f) => f.endsWith('.jar'))
      used.push('mods')
      parts.push(`Installed mods (${mods.length}): ${mods.slice(0, 60).join(', ')}${mods.length > 60 ? ', …' : ''}`)
    } catch {
      /* no mods folder */
    }

    if (ctx.includeLogs) {
      const latest = await tailOfFile(path.join(gameDirOf(instance), 'logs', 'latest.log'), 120)
      if (latest) {
        used.push('game log')
        parts.push(`Tail of latest.log:\n${latest}`)
      }
      const crashesDir = path.join(gameDirOf(instance), 'crash-reports')
      try {
        const files = (await fsp.readdir(crashesDir)).filter((f) => f.endsWith('.txt')).sort().reverse()
        if (files[0]) {
          const crash = await tailOfFile(path.join(crashesDir, files[0]), 80)
          if (crash) {
            used.push('crash report')
            parts.push(`Newest crash report (${files[0]}):\n${crash}`)
          }
        }
      } catch {
        /* no crashes, good */
      }
    }
  }

  parts.push(
    `Launcher settings: mirrorMode=${settings.mirrorMode}, proxy=${settings.proxyUrl ? 'configured' : 'none'}, concurrency=${settings.downloadConcurrency}, autoTune=${settings.autoTune}`
  )
  if (ctx.extra) parts.push(ctx.extra)

  return { block: parts.join('\n\n'), used }
}

/* ------------------------------------------------------------------ *
 * Gemini transport
 * ------------------------------------------------------------------ */

interface GeminiPart {
  text?: string
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[]
  error?: { message?: string }
}

function endpoint(base: string, model: string, stream: boolean): string {
  const clean = base.replace(/\/$/, '')
  return `${clean}/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
}

export async function askAssistant(opts: {
  messages: ChatMessage[]
  context?: AssistantContext
  onChunk?: (text: string) => void
}): Promise<AssistantReply> {
  const settings = loadSettings()
  const { block, used } = await buildContext(opts.context ?? {})

  if (!settings.geminiApiKey.trim()) {
    const text = offlineAnswer(opts.messages.at(-1)?.text ?? '', block)
    opts.onChunk?.(text)
    return { text, mode: 'offline', usedContext: used }
  }

  const body = {
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n--- current context ---\n${block}` }] },
    contents: opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024, topP: 0.95 }
  }

  const proxy = settings.geminiProxyUrl.trim() || settings.proxyUrl.trim()
  const bases = [settings.geminiBaseUrl.trim() || 'https://generativelanguage.googleapis.com']
  // A second attempt through the generic proxy when the direct route is filtered.
  if (!proxy && settings.mirrorMode !== 'direct') bases.push('https://generativelanguage.googleapis.com')

  let lastError: unknown = null
  for (const base of bases) {
    try {
      const text = await callGemini(base, settings.geminiModel || 'gemini-2.5-flash', settings.geminiApiKey, body, proxy, opts.onChunk)
      return { text, mode: 'gemini', usedContext: used }
    } catch (err) {
      lastError = err
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  const hint = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)
    ? '\n\n(Network could not reach Google. Set a proxy URL in Settings → Assistant, or use a relay base URL such as your own Cloudflare Worker that forwards /v1beta to generativelanguage.googleapis.com.)'
    : ''
  throw new Error(`${message}${hint}`)
}

async function callGemini(
  base: string,
  model: string,
  apiKey: string,
  body: unknown,
  proxy: string,
  onChunk?: (t: string) => void
): Promise<string> {
  const url = endpoint(base, model, Boolean(onChunk))
  const res = (await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, accept: onChunk ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
    proxyUrl: proxy || undefined
  })) as unknown as Response

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as GeminiResponse
      if (json.error?.message) detail = json.error.message
    } catch {
      /* keep the status code */
    }
    throw new Error(detail)
  }

  if (!onChunk || !res.body) {
    const json = (await res.json()) as GeminiResponse
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  }

  // Parse the SSE stream by hand so a partial chunk never breaks the UI.
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as GeminiResponse
        const piece = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
        if (piece) {
          full += piece
          onChunk(piece)
        }
      } catch {
        /* skip malformed frames */
      }
    }
  }
  return full
}

export async function verifyAssistantKey(): Promise<{ ok: boolean; message: string }> {
  const settings = loadSettings()
  const key = settings.geminiApiKey.trim()
  if (!key) return { ok: false, message: 'No API key saved yet.' }
  try {
    const list = await fetchJson<{ models?: { name: string }[] }>(
      `${(settings.geminiBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')}/v1beta/models`,
      { headers: { 'x-goog-api-key': key } }
    )
    const count = list.models?.length ?? 0
    return { ok: true, message: `Key works — ${count} models available.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed.' }
  }
}

/* ------------------------------------------------------------------ *
 * Offline knowledge base — keeps the assistant useful without a key.
 * ------------------------------------------------------------------ */

const KB: { match: RegExp; answer: (ctx: string) => string }[] = [
  {
    match: /out of memory|java\.lang\.outofmemory|heap space|فراموشی حافظه|رم کم/i,
    answer: () =>
      'You are out of heap. Open the instance → Performance tab and raise Memory to roughly half of your installed RAM (never more than total minus 4 GB), then relaunch. If it still happens with a big modpack, check the health panel — it flags over-allocation before launch.'
  },
  {
    match: /exit code|crash|کرش|کرش میکنه|بسته میشه|بسته می‌شود/i,
    answer: (ctx) =>
      `Crash reports live in <instance>/crash-reports/. The newest "Caused by" line names the mod at fault. Common fixes: remove the mod named there, update it, or check the mod list against your loader/version.\n\n${ctx ? 'Context I have:\n' + ctx.slice(0, 400) : ''}`
  },
  {
    match: /mod (not found|incompatible)|نسخه ناسازگار|مود کار نمیکنه|مود کار نمی‌کند/i,
    answer: () =>
      'A mod must match both your loader (Fabric/Forge/Quilt/NeoForge) and your exact Minecraft version. In Mods → Browse, the search is already filtered to your instance, so anything it shows will load. For jars you added by hand, check the file name for the version.'
  },
  {
    match: /fps|lag|stutter|لگ|فریم|افت فریم/i,
    answer: (ctx) =>
      `Do these in order:\n1. Mods → Performance pack → Install (Sodium, Lithium, FerriteCore…).\n2. Performance tab → apply the "Competitive" or "Max FPS" graphics preset.\n3. Keep render distance at 8–12 chunks.\n4. Make sure the game runs on the dedicated GPU.\n${ctx ? '\nCurrent state:\n' + ctx.slice(0, 400) : ''}`
  },
  {
    match: /sodium|shader|شیدر|آیریس|iris/i,
    answer: () =>
      'Sodium replaces the renderer (fabric/quilt). For shaders add Iris alongside it, then drop a .zip into shaderpacks/ — the Mods → Content tab installs those too. On Forge/NeoForge the equivalents are Embeddium (+ Oculus for shaders).'
  },
  {
    match: /download|دانلود|نصب نمیشه|نصب نمی‌شود|net |اینترنت/i,
    answer: () =>
      'Downloads: Settings → Network. Set Mirror mode to "Mirrors first" for Iran-friendly routing, and if your ISP still blocks things give Puxl the address of a proxy you are allowed to use. Failed files retry automatically and resume from where they stopped.'
  },
  {
    match: /java|جاوا/i,
    answer: () =>
      'Java is handled for you: Puxl detects installed runtimes and downloads the correct major version (8, 17 or 21) from Mojang when needed. To force a specific one, set the path in the instance → Advanced tab.'
  },
  {
    match: /server|سرور|multiplayer|مولتی/i,
    answer: () =>
      'Use Direct Connect with the server address. Make sure your mod set matches the server (some servers require specific client mods, others forbid them), and keep the Minecraft version identical.'
  }
]

export function offlineAnswer(question: string, contextBlock: string): string {
  for (const entry of KB) {
    if (entry.match.test(question)) return entry.answer(contextBlock)
  }
  const perf = PERF_MODS.slice(0, 4).map((m) => m.name).join(', ')
  return [
    'The assistant is running in offline mode because no Gemini API key is saved.',
    '',
    'What I can still do: read your instance state, mod list, game log and crash reports, and answer common problems.',
    'For free-form questions, add a key in Settings → Assistant. If Google is unreachable from your network, put a proxy URL next to it — Puxl sends assistant traffic through it.',
    '',
    `Popular performance mods for your loader: ${perf}.`,
    '',
    'Ask me about crashes, FPS, mod compatibility, downloads, Java or memory and I will answer from the built-in knowledge base.'
  ].join('\n')
}

/** Reads a crash report and produces a structured explanation. */
export async function explainCrash(instanceId: string): Promise<string> {
  const instance = getInstance(instanceId)
  if (!instance) return 'Instance not found.'
  const dir = path.join(gameDirOf(instance), 'crash-reports')
  let file: string | null = null
  try {
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.txt')).sort().reverse()
    file = files[0] ? path.join(dir, files[0]) : null
  } catch {
    /* nothing to read */
  }
  if (!file) return 'No crash reports found for this instance — that means the last exit was clean.'

  const report = await fsp.readFile(file, 'utf8').catch(() => '')
  const causedBy = report.match(/Caused by:.*/g)?.slice(-3).join('\n') ?? 'no "Caused by" line found'
  const suspected = report.match(/Suspected Mods?:.*/)?.[0] ?? ''
  const description = report.match(/Description:.*/)?.[0] ?? ''
  const exitLine = report.match(/Exit Code:.*/)?.[0] ?? ''
  if (!fs.existsSync(file)) return 'Crash report disappeared while reading it.'

  return [
    `Newest report: ${path.basename(file)}`,
    description,
    exitLine,
    suspected,
    '',
    'Causes:',
    causedBy,
    '',
    'Send this to the assistant with the Gemini key enabled to get a fix, or act on the suspected mod: update it, or disable it and relaunch.'
  ]
    .filter(Boolean)
    .join('\n')
}
