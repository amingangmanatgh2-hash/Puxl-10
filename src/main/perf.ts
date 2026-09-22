import os from 'node:os'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app } from 'electron'

export interface GpuInfo {
  model: string
  vendor: string
  vramMb?: number
  dedicated: boolean
}

export interface HardwareProfile {
  cpu: { model: string; cores: number; threads: number; speedGhz: number }
  memoryMb: number
  freeMemoryMb: number
  gpus: GpuInfo[]
  os: { platform: string; release: string; arch: string }
  tier: 'low' | 'mid' | 'high' | 'ultra'
  recommendedMemoryMb: number
  score: number
}

function execText(cmd: string, args: string[], timeout = 6000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

async function windowsGpus(): Promise<GpuInfo[]> {
  const out = await execText('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,VideoProcessor,PNPDeviceID | ConvertTo-Json -Compress'
  ])
  if (!out.trim()) return []
  try {
    const parsed = JSON.parse(out) as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .map((raw) => {
        const item = raw as { Name?: string; AdapterRAM?: number | string; VideoProcessor?: string }
        const name = item.Name ?? item.VideoProcessor ?? 'Unknown GPU'
        const vram = Number(item.AdapterRAM ?? 0)
        return {
          model: name,
          vendor: vendorFromName(name),
          // WMI reports a signed 32-bit value, so anything <=0 is meaningless.
          vramMb: vram > 0 ? Math.round(vram / 1024 / 1024) : undefined,
          dedicated: /nvidia|geforce|radeon|rtx|gtx|rx |arc /i.test(name)
        }
      })
      .filter((g) => g.model)
  } catch {
    return []
  }
}

async function macGpus(): Promise<GpuInfo[]> {
  const out = await execText('system_profiler', ['SPDisplaysDataType', '-json'])
  try {
    const parsed = JSON.parse(out) as { SPDisplaysDataType?: { sppci_model?: string; spdisplays_vram?: string }[] }
    return (parsed.SPDisplaysDataType ?? []).map((g) => ({
      model: g.sppci_model ?? 'Apple GPU',
      vendor: vendorFromName(g.sppci_model ?? ''),
      vramMb: g.spdisplays_vram ? Number.parseInt(g.spdisplays_vram, 10) || undefined : undefined,
      dedicated: /radeon|nvidia/i.test(g.sppci_model ?? '')
    }))
  } catch {
    return []
  }
}

async function linuxGpus(): Promise<GpuInfo[]> {
  const out = await execText('sh', ['-c', "lspci | grep -Ei 'vga|3d|display'"])
  return out
    .split(/\r?\n/)
    .map((line) => line.replace(/^.*:\s*/, '').trim())
    .filter(Boolean)
    .map((model) => ({
      model,
      vendor: vendorFromName(model),
      dedicated: /nvidia|geforce|radeon|rtx|gtx/i.test(model)
    }))
}

function vendorFromName(name: string): string {
  if (/nvidia|geforce|rtx|gtx|quadro/i.test(name)) return 'NVIDIA'
  if (/amd|radeon|rx \d|vega/i.test(name)) return 'AMD'
  if (/intel|iris|uhd|hd graphics/i.test(name)) return 'Intel'
  if (/apple/i.test(name)) return 'Apple'
  return 'Unknown'
}

function scoreHardware(hw: Omit<HardwareProfile, 'tier' | 'recommendedMemoryMb' | 'score'>): number {
  let score = 0
  const threads = hw.cpu.threads
  score += Math.min(40, threads * 3)
  score += Math.min(20, hw.memoryMb / 1024)
  const best = hw.gpus.find((g) => g.dedicated) ?? hw.gpus[0]
  if (best) {
    if (/rtx (4|5)\d{3}|rx (7|9)\d{3}/i.test(best.model)) score += 40
    else if (/rtx (2|3)\d{3}|rx (5|6)\d{3}|radeon pro/i.test(best.model)) score += 28
    else if (/gtx (10|16)\d{2}|rx (4|5)\d{2}/i.test(best.model)) score += 18
    else if (/iris|vega|apple m\d|arc/i.test(best.model)) score += 14
    else if (/intel|uhd|hd graphics/i.test(best.model)) score += 4
    else score += 8
  }
  return Math.round(score)
}

export async function detectHardware(): Promise<HardwareProfile> {
  const cpus = os.cpus()
  const model = cpus[0]?.model?.trim() ?? 'Unknown CPU'
  const speedGhz = (cpus[0]?.speed ?? 0) / 1000
  const memoryMb = Math.round(os.totalmem() / 1024 / 1024)
  const freeMemoryMb = Math.round(os.freemem() / 1024 / 1024)

  let gpus: GpuInfo[] = []
  if (process.platform === 'win32') gpus = await windowsGpus()
  else if (process.platform === 'darwin') gpus = await macGpus()
  else gpus = await linuxGpus()

  if (gpus.length === 0) {
    try {
      const info = (await app.getGPUInfo('basic')) as { auxAttributes?: Record<string, string> }
      const renderer = info?.auxAttributes?.glRenderer ?? info?.auxAttributes?.deviceName ?? ''
      if (renderer) gpus = [{ model: renderer, vendor: vendorFromName(renderer), dedicated: /nvidia|radeon|rtx|gtx/i.test(renderer) }]
    } catch {
      /* headless / blocked GPU info */
    }
  }

  const base = {
    cpu: { model, cores: cpus.length, threads: cpus.length, speedGhz },
    memoryMb,
    freeMemoryMb,
    gpus,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() }
  }
  const score = scoreHardware(base)
  const tier: HardwareProfile['tier'] = score >= 70 ? 'ultra' : score >= 50 ? 'high' : score >= 28 ? 'mid' : 'low'
  const recommendedMemoryMb = recommendMemory(memoryMb, tier)

  return { ...base, tier, score, recommendedMemoryMb }
}

export function recommendMemory(memoryMb: number, tier: HardwareProfile['tier'] = 'mid'): number {
  // Leave plenty for the OS and the rest of the desktop.
  const usable = Math.max(2048, memoryMb - 4096)
  const byTier = tier === 'ultra' ? 8192 : tier === 'high' ? 6144 : tier === 'mid' ? 4096 : 2048
  const chosen = Math.min(byTier, usable, 16384)
  return Math.max(2048, Math.round(chosen / 512) * 512)
}

/* ------------------------------------------------------------------ *
 * JVM tuning
 * ------------------------------------------------------------------ */

export function tuneJvmArgs(hw: HardwareProfile, memoryMb: number): string[] {
  const args: string[] = [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dfile.encoding=UTF-8',
    '-Djava.awt.headless=false'
  ]

  if (memoryMb <= 3072) {
    // Small heaps do better without the aggressive region sizing above.
    return ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=120', '-XX:+DisableExplicitGC', '-Dfile.encoding=UTF-8']
  }

  if (hw.cpu.threads <= 4) {
    args.push('-XX:ParallelGCThreads=2', '-XX:ConcGCThreads=1')
  } else {
    const threads = Math.max(8, Math.min(hw.cpu.threads, 12))
    args.push(`-XX:ParallelGCThreads=${threads}`)
  }

  // Mojang's bundled LWJGL in some versions leaks through the default stack size.
  args.push('-Xss1M')

  return args
}

/* ------------------------------------------------------------------ *
 * In-game graphics presets (options.txt)
 * ------------------------------------------------------------------ */

export type GraphicsPreset = 'max-fps' | 'competitive' | 'balanced' | 'quality' | 'cinematic'

interface OptionValue {
  [key: string]: string | number | boolean
}

export const PRESET_LABELS: Record<GraphicsPreset, { title: string; description: string }> = {
  'max-fps': { title: 'Max FPS', description: 'Everything reduced for the highest possible frame rate on weak hardware.' },
  competitive: { title: 'Competitive', description: 'PvP oriented: clear vision, no clouds, no bob, high FPS.' },
  balanced: { title: 'Balanced', description: 'Sensible defaults with a few free performance wins.' },
  quality: { title: 'Quality', description: 'Chunkier render distance and nicer lighting for singleplayer.' },
  cinematic: { title: 'Cinematic', description: 'Looks first: max visuals, expects a strong GPU.' }
}

const COMMON_PERF: OptionValue = {
  ao: 'false',
  entityShadows: 'false',
  entityDistanceScaling: '0.6',
  particles: '2',
  cloudStatus: 'false',
  graphicsMode: '0',
  enableVsync: 'false',
  mipmapLevels: '4',
  pauseOnLostFocus: 'false',
  bobView: 'false',
  syncChunkWrites: 'true',
  glDebugVerbosity: '0',
  maxAnisotropy: '0',
  prioritizeChunkUpdates: '0'
}

export function optionsForPreset(preset: GraphicsPreset): OptionValue {
  switch (preset) {
    case 'max-fps':
      return {
        ...COMMON_PERF,
        renderDistance: '6',
        simulationDistance: '5',
        maxFps: '260',
        graphicsMode: '0',
        ao: 'false',
        particles: '2',
        biomeBlendRadius: '1',
        screenEffectScale: '0.0',
        fovEffectScale: '0.0',
        darknessEffectScale: '0.0',
        damageTiltStrength: '0.0'
      }
    case 'competitive':
      return {
        ...COMMON_PERF,
        renderDistance: '10',
        simulationDistance: '8',
        maxFps: '300',
        fov: '0.0',
        gamma: '1.0',
        fullscreen: 'true',
        showSubtitles: 'false',
        autoJump: 'false',
        toggleCrouch: 'false',
        mainHand: 'right'
      }
    case 'balanced':
      return { ...COMMON_PERF, renderDistance: '12', simulationDistance: '8', maxFps: '200', ao: 'true', entityShadows: 'true' }
    case 'quality':
      return {
        ...COMMON_PERF,
        renderDistance: '16',
        simulationDistance: '12',
        maxFps: '144',
        ao: 'true',
        entityShadows: 'true',
        particles: '0',
        graphicsMode: '1',
        cloudStatus: 'true'
      }
    case 'cinematic':
      return {
        ...COMMON_PERF,
        renderDistance: '24',
        simulationDistance: '16',
        maxFps: '120',
        ao: 'true',
        entityShadows: 'true',
        particles: '0',
        graphicsMode: '1',
        cloudStatus: 'true',
        mipmapLevels: '4',
        biomeBlendRadius: '5'
      }
  }
}

/** Merges a preset into an existing options.txt without touching unrelated keys. */
export async function applyGraphicsPreset(gameDir: string, preset: GraphicsPreset, extra: OptionValue = {}): Promise<void> {
  const file = path.join(gameDir, 'options.txt')
  const values = { ...optionsForPreset(preset), ...extra }
  const lines: string[] = []
  let existing: string[] = []
  try {
    existing = (await fsp.readFile(file, 'utf8')).split(/\r?\n/)
  } catch {
    existing = []
  }

  const handled = new Set<string>()
  for (const line of existing) {
    const idx = line.indexOf(':')
    if (idx <= 0) {
      if (line.trim()) lines.push(line)
      continue
    }
    const key = line.slice(0, idx)
    if (key in values) {
      lines.push(`${key}:${values[key]}`)
      handled.add(key)
    } else {
      lines.push(line)
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (!handled.has(key)) lines.push(`${key}:${value}`)
  }

  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, `${lines.filter((l) => l.trim() !== '').join('\n')}\n`)
}

export async function readOptions(gameDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const text = await fsp.readFile(path.join(gameDir, 'options.txt'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1)
    }
  } catch {
    /* no options yet */
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Performance mod packs (resolved against Modrinth by slug)
 * ------------------------------------------------------------------ */

export interface PerfMod {
  slug: string
  name: string
  why: string
  loaders: ('fabric' | 'quilt' | 'forge' | 'neoforge')[]
  /** Inclusive minimum Minecraft version, e.g. '1.17'. */
  minMc?: string
  /** Exclusive maximum Minecraft version. */
  maxMc?: string
  optional?: boolean
}

export const PERF_MODS: PerfMod[] = [
  { slug: 'sodium', name: 'Sodium', why: 'Rewrites the renderer — the single biggest FPS win on Fabric.', loaders: ['fabric', 'quilt'] },
  { slug: 'lithium', name: 'Lithium', why: 'Optimises the game logic without changing behaviour.', loaders: ['fabric', 'quilt'] },
  { slug: 'iris', name: 'Iris Shaders', why: 'Shader support that works alongside Sodium.', loaders: ['fabric', 'quilt'], optional: true },
  { slug: 'ferritecore', name: 'FerriteCore', why: 'Cuts memory use for block/item models.', loaders: ['fabric', 'quilt', 'forge', 'neoforge'] },
  { slug: 'krypton', name: 'Krypton', why: 'Faster networking stack — lower ping spikes.', loaders: ['fabric', 'quilt'] },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', why: 'Speeds up immediate-mode rendering (HUD, chat).', loaders: ['fabric', 'quilt'] },
  { slug: 'entityculling', name: 'EntityCulling', why: 'Skips rendering entities you cannot see.', loaders: ['fabric', 'quilt', 'forge', 'neoforge'] },
  { slug: 'moreculling', name: 'More Culling', why: 'Extra face-culling for leaves, glass and more.', loaders: ['fabric', 'quilt'] },
  { slug: 'memoryleakfix', name: 'Memory Leak Fix', why: 'Patches known vanilla memory leaks.', loaders: ['fabric', 'quilt', 'forge', 'neoforge'] },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', why: 'Drops the frame rate while the window is unfocused.', loaders: ['fabric', 'quilt'] },
  { slug: 'badoptimizations', name: 'BadOptimizations', why: 'Many micro-optimisations the others miss.', loaders: ['fabric', 'quilt'] },
  { slug: 'c2me-fabric', name: 'Concurrent Chunk Management Engine', why: 'Generates and loads chunks in parallel.', loaders: ['fabric', 'quilt'] },
  { slug: 'modernfix', name: 'ModernFix', why: 'Forge/NeoForge startup and memory fixes.', loaders: ['forge', 'neoforge'] },
  { slug: 'embeddium', name: 'Embeddium', why: 'Sodium-class renderer for Forge/NeoForge.', loaders: ['forge', 'neoforge'] },
  { slug: 'oculus', name: 'Oculus', why: 'Shader support for Forge.', loaders: ['forge'], optional: true },
  { slug: 'canary', name: 'Canary', why: 'Lithium-class logic fixes for Forge.', loaders: ['forge', 'neoforge'] },
  { slug: 'saturn', name: 'Saturn', why: 'Reduces memory usage on Forge/NeoForge.', loaders: ['forge', 'neoforge'] },
  { slug: 'starlight', name: 'Starlight', why: 'Rebuilds the light engine for older versions.', loaders: ['fabric', 'quilt', 'forge'], maxMc: '1.20.1' }
]

function mcAtLeast(version: string | undefined, min: string): boolean {
  if (!version) return true
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

function mcBelow(version: string | undefined, max: string): boolean {
  if (!version) return true
  return !mcAtLeast(version, max)
}

export function perfModsFor(loader: string, mcVersion: string, includeOptional = false): PerfMod[] {
  return PERF_MODS.filter((mod) => {
    if (!mod.loaders.includes(loader as PerfMod['loaders'][number])) return false
    if (mod.optional && !includeOptional) return false
    if (mod.minMc && !mcAtLeast(mcVersion, mod.minMc)) return false
    if (mod.maxMc && !mcBelow(mcVersion, mod.maxMc)) return false
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Self check — used before every launch so users see real problems.
 * ------------------------------------------------------------------ */

export interface HealthCheck {
  id: string
  level: 'ok' | 'warn' | 'error'
  title: string
  detail: string
  fix?: string
}

export async function runHealthChecks(opts: {
  gameDir: string
  memoryMb: number
  hardware: HardwareProfile
  rootDir: string
  modsDir: string
}): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = []

  checks.push({
    id: 'storage',
    level: fs.existsSync(opts.rootDir) ? 'ok' : 'error',
    title: 'Instance folder',
    detail: opts.rootDir,
    fix: 'Recreate the instance if this folder is missing.'
  })

  if (opts.memoryMb > opts.hardware.memoryMb - 2048) {
    checks.push({
      id: 'memory',
      level: 'warn',
      title: 'Allocated memory looks too high',
      detail: `${opts.memoryMb} MB allocated of ${opts.hardware.memoryMb} MB installed.`,
      fix: `Lower it to about ${opts.hardware.recommendedMemoryMb} MB to avoid stutter and system swapping.`
    })
  } else {
    checks.push({ id: 'memory', level: 'ok', title: 'Memory allocation', detail: `${opts.memoryMb} MB of ${opts.hardware.memoryMb} MB` })
  }

  let modCount = 0
  try {
    modCount = (await fsp.readdir(opts.modsDir)).filter((f) => f.endsWith('.jar')).length
  } catch {
    modCount = 0
  }
  checks.push({
    id: 'mods',
    level: modCount > 400 ? 'warn' : 'ok',
    title: 'Mods',
    detail: `${modCount} jar file(s) in mods/`,
    fix: modCount > 400 ? 'Very large mod folders slow startup and can exhaust memory. Consider disabling unused mods.' : undefined
  })

  const crashFile = path.join(opts.gameDir, 'crash-reports')
  if (fs.existsSync(crashFile)) {
    try {
      const reports = (await fsp.readdir(crashFile)).filter((f) => f.endsWith('.txt')).sort().reverse()
      if (reports.length > 0) {
        const latest = path.join(crashFile, reports[0])
        const stat = await fsp.stat(latest)
        if (Date.now() - stat.mtimeMs < 1000 * 60 * 60 * 24 * 3) {
          checks.push({
            id: 'crash',
            level: 'warn',
            title: 'Recent crash report',
            detail: `${reports[0]} (${new Date(stat.mtimeMs).toLocaleString()})`,
            fix: 'Ask the assistant to read it: it explains the failing mod and the fix.'
          })
        }
      }
    } catch {
      /* ignore */
    }
  }

  return checks
}
