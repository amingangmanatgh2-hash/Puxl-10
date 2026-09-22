export type LoaderKind = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface Instance {
  id: string
  name: string
  minecraftVersion: string
  loader: LoaderKind
  loaderVersion?: string
  versionId: string
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

export interface LauncherSettings {
  rootDir: string
  mirrorMode: 'direct' | 'auto' | 'iran'
  proxyUrl: string
  customMirrors: { match: string; replace: string }[]
  allowInsecureTLS: boolean
  downloadConcurrency: number
  defaultMemoryMb: number
  defaultJvmArgs: string
  autoTune: boolean
  closeOnLaunch: boolean
  minimizeToTray: boolean
  openConsoleOnLaunch: boolean
  geminiApiKey: string
  geminiBaseUrl: string
  geminiModel: string
  geminiProxyUrl: string
  msClientId: string
  activeInstanceId: string
  checkLauncherUpdates: boolean
  [key: string]: unknown
}

export interface HardwareProfile {
  cpu: { model: string; cores: number; threads: number; speedGhz: number }
  memoryMb: number
  freeMemoryMb: number
  gpus: { model: string; vendor: string; vramMb?: number; dedicated: boolean }[]
  os: { platform: string; release: string; arch: string }
  tier: 'low' | 'mid' | 'high' | 'ultra'
  recommendedMemoryMb: number
  score: number
}

export interface InstalledMod {
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
  dependencies?: string[]
  updateAvailable?: string
  updateVersionId?: string
  fromPack?: string
}

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
  client_side?: string
}

export interface SearchResponse {
  hits: SearchHit[]
  offset: number
  limit: number
  total_hits: number
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
  files: { filename: string; url: string; size: number; primary: boolean; hashes: { sha1: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[]
}

export interface AccountView {
  id: string
  type: 'offline' | 'microsoft'
  name: string
  uuid: string
  addedAt: number
  lastUsed?: number
  skinUrl?: string
}

export interface HealthCheck {
  id: string
  level: 'ok' | 'warn' | 'error'
  title: string
  detail: string
  fix?: string
}

export interface InstallProgress {
  instanceId?: string
  stage: string
  detail: string
  current: number
  total: number
  pct: number
}

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

export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface VersionSummary {
  id: string
  type: string
  releaseTime: string
}

export const LOADERS: { id: LoaderKind; label: string; blurb: string }[] = [
  { id: 'fabric', label: 'Fabric', blurb: 'Lightweight, fastest mod updates' },
  { id: 'neoforge', label: 'NeoForge', blurb: 'Modern Forge fork for 1.20.2+' },
  { id: 'forge', label: 'Forge', blurb: 'Classic modloader, huge catalogue' },
  { id: 'quilt', label: 'Quilt', blurb: 'Fabric-compatible fork' },
  { id: 'vanilla', label: 'Vanilla', blurb: 'No mod loader' }
]

export const GRAPHICS_PRESETS = [
  { id: 'max-fps', title: 'Max FPS', blurb: 'Lowest settings, highest frame rate' },
  { id: 'competitive', title: 'Competitive', blurb: 'PvP clarity, no clouds or bob' },
  { id: 'balanced', title: 'Balanced', blurb: 'Good looks with free performance' },
  { id: 'quality', title: 'Quality', blurb: 'Bigger render distance' },
  { id: 'cinematic', title: 'Cinematic', blurb: 'Maximum visuals' }
] as const
