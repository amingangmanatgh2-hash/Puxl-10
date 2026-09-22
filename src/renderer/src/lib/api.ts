import type {
  AccountView,
  HealthCheck,
  HardwareProfile,
  InstallProgress,
  Instance,
  InstalledMod,
  LauncherSettings,
  LoaderVersion,
  ModVersion,
  SearchResponse,
  TransferProgress,
  VersionSummary
} from './types'

interface Bridge {
  settings: {
    get(): Promise<LauncherSettings>
    save(patch: Partial<LauncherSettings>): Promise<LauncherSettings>
    reset(): Promise<LauncherSettings>
    pickRoot(): Promise<string | null>
  }
  system: {
    info(): Promise<{
      appVersion: string
      electron: string
      chrome: string
      node: string
      platform: string
      arch: string
      paths: Record<string, string>
      hardware: HardwareProfile
    }>
    openPath(target: string): Promise<string>
    openExternal(url: string): Promise<void>
    health(instanceId?: string): Promise<HealthCheck[]>
    versions(includeSnapshots?: boolean): Promise<VersionSummary[]>
    diskUsage(): Promise<Record<string, number>>
    resolveUrl(url: string): Promise<string[]>
  }
  instances: {
    list(): Promise<Instance[]>
    get(id: string): Promise<Instance | null>
    create(payload: Partial<Instance> & { name: string; minecraftVersion: string }): Promise<Instance>
    update(id: string, patch: Partial<Instance>): Promise<Instance>
    remove(id: string, removeFiles: boolean): Promise<boolean>
    duplicate(id: string, name: string): Promise<Instance | null>
    installed(id: string): Promise<{ installed: boolean; reason?: string }>
    applyPreset(id: string, preset: string): Promise<boolean>
    options(id: string): Promise<Record<string, string>>
    loaders(loader: string, mcVersion: string): Promise<LoaderVersion[]>
    openFolder(id: string, sub?: string): Promise<string>
  }
  install: {
    start(id: string): Promise<{ versionId: string; javaMajor: number }>
    onProgress(handler: (payload: InstallProgress) => void): () => void
  }
  launch: {
    prepare(id: string): Promise<{ command: string; javaPath: string; gameDir: string }>
    start(id: string): Promise<{ command: string }>
    kill(): Promise<boolean>
    status(): Promise<{ running: boolean; pid?: number; uptimeMs: number }>
    onLog(handler: (payload: { instanceId: string; line: string }) => void): () => void
    onExit(handler: (payload: { instanceId: string; code: number | null }) => void): () => void
    onStarted(handler: (payload: { instanceId: string; pid: number }) => void): () => void
  }
  mods: {
    list(instanceId: string): Promise<InstalledMod[]>
    search(query: Record<string, unknown>): Promise<SearchResponse>
    project(id: string): Promise<{
      id: string
      slug: string
      title: string
      description: string
      body?: string
      icon_url?: string
      downloads: number
      followers: number
      categories: string[]
      loaders: string[]
      game_versions: string[]
      source_url?: string
      issues_url?: string
      gallery?: { url: string; title?: string }[]
    }>
    versions(id: string, loader?: string, gameVersion?: string): Promise<ModVersion[]>
    install(instanceId: string, projectId: string): Promise<{ installed: InstalledMod[]; skipped: { title: string; reason: string }[] }>
    uninstall(instanceId: string, fileName: string): Promise<InstalledMod[]>
    toggle(instanceId: string, fileName: string, enabled: boolean): Promise<InstalledMod[]>
    addFile(instanceId: string): Promise<InstalledMod[]>
    checkUpdates(instanceId: string): Promise<InstalledMod[]>
    update(instanceId: string, fileName: string): Promise<{ installed: InstalledMod[]; skipped: { title: string; reason: string }[] }>
    listContent(instanceId: string, kind: string): Promise<string[]>
    installContent(instanceId: string, projectId: string, kind: string): Promise<{ file: string }>
    deleteContent(instanceId: string, kind: string, fileName: string): Promise<string[]>
    installPack(instanceId: string): Promise<{ name: string; installed: number; failed: number; summary: string } | null>
    installPackFromUrl(instanceId: string, url: string): Promise<{ name: string; installed: number; failed: number; summary: string }>
    perfList(instanceId: string): Promise<
      { slug: string; name: string; why: string; loaders: string[]; optional?: boolean }[]
    >
    installPerfPack(instanceId: string, includeOptional: boolean): Promise<{ installed: string[]; skipped: { title: string; reason: string }[] }>
  }
  accounts: {
    list(): Promise<{ accounts: AccountView[]; activeId: string }>
    validateName(name: string): Promise<string | null>
    addOffline(name: string): Promise<AccountView>
    remove(id: string): Promise<boolean>
    setActive(id: string): Promise<boolean>
    msBegin(): Promise<{ userCode: string; verificationUri: string; expiresIn: number; interval: number; deviceCode: string; message: string }>
    msPoll(deviceCode: string, interval: number, expiresIn: number, verificationUri: string): Promise<AccountView>
  }
  assistant: {
    ask(
      messages: { role: 'user' | 'model'; text: string }[],
      context: { instanceId?: string; includeLogs?: boolean }
    ): Promise<{ text: string; mode: 'gemini' | 'offline'; usedContext: string[] }>
    verify(): Promise<{ ok: boolean; message: string }>
    crash(instanceId: string): Promise<string>
    onChunk(handler: (payload: { text: string }) => void): () => void
  }
  transfers: {
    onProgress(handler: (payload: TransferProgress) => void): () => void
  }
  window: {
    minimize(): Promise<boolean>
    toggleMaximize(): Promise<boolean>
    close(): Promise<boolean>
    state(): Promise<{ maximized: boolean; fullscreen: boolean }>
  }
}

declare global {
  interface Window {
    puxl: Bridge
  }
}

export const api: Bridge = typeof window !== 'undefined' ? window.puxl : ({} as Bridge)
export type { Bridge }
