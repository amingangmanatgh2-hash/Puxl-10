import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!result || typeof result !== 'object') throw new Error(`Unexpected reply from ${channel}`)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function on<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  settings: {
    get: () => call('settings:get'),
    save: (patch: Record<string, unknown>) => call('settings:save', patch),
    reset: () => call('settings:reset'),
    defaults: () => call('settings:defaults'),
    pickRoot: () => call<string | null>('settings:pickRoot')
  },
  system: {
    info: () => call('system:info'),
    openPath: (target: string) => call('system:openPath', target),
    openExternal: (url: string) => call('system:openExternal', url),
    health: (instanceId?: string) => call('system:health', instanceId),
    versions: (includeSnapshots?: boolean) => call('system:versions', includeSnapshots),
    diskUsage: () => call('system:diskUsage'),
    resolveUrl: (url: string) => call<string[]>('system:resolveUrl', url)
  },
  instances: {
    list: () => call('instances:list'),
    get: (id: string) => call('instances:get', id),
    create: (payload: Record<string, unknown>) => call('instances:create', payload),
    update: (id: string, patch: Record<string, unknown>) => call('instances:update', id, patch),
    remove: (id: string, removeFiles: boolean) => call('instances:delete', id, removeFiles),
    duplicate: (id: string, name: string) => call('instances:duplicate', id, name),
    installed: (id: string) => call('instances:installed', id),
    applyPreset: (id: string, preset: string) => call('instances:applyPreset', id, preset),
    options: (id: string) => call('instances:options', id),
    loaders: (loader: string, mcVersion: string) => call('instances:loaders', loader, mcVersion),
    localVersion: (id: string) => call('instances:localVersion', id),
    openFolder: (id: string, sub?: string) => call('instances:openFolder', id, sub)
  },
  install: {
    start: (id: string) => call('install:start', id),
    onProgress: (handler: (payload: unknown) => void) => on('install:progress', handler)
  },
  launch: {
    prepare: (id: string) => call('launch:prepare', id),
    start: (id: string) => call('launch:start', id),
    kill: () => call('launch:kill'),
    status: () => call('launch:status'),
    onLog: (handler: (payload: { instanceId: string; line: string }) => void) => on('game:log', handler),
    onExit: (handler: (payload: { instanceId: string; code: number | null }) => void) => on('game:exit', handler),
    onStarted: (handler: (payload: { instanceId: string; pid: number }) => void) => on('game:started', handler)
  },
  mods: {
    list: (instanceId: string) => call('mods:list', instanceId),
    search: (query: Record<string, unknown>) => call('mods:search', query),
    project: (id: string) => call('mods:project', id),
    versions: (id: string, loader?: string, gameVersion?: string) => call('mods:versions', id, loader, gameVersion),
    install: (instanceId: string, projectId: string) => call('mods:install', instanceId, projectId),
    uninstall: (instanceId: string, fileName: string) => call('mods:uninstall', instanceId, fileName),
    toggle: (instanceId: string, fileName: string, enabled: boolean) => call('mods:toggle', instanceId, fileName, enabled),
    addFile: (instanceId: string) => call('mods:addFile', instanceId),
    checkUpdates: (instanceId: string) => call('mods:checkUpdates', instanceId),
    update: (instanceId: string, fileName: string) => call('mods:update', instanceId, fileName),
    listContent: (instanceId: string, kind: string) => call('mods:content:list', instanceId, kind),
    installContent: (instanceId: string, projectId: string, kind: string) =>
      call('mods:content:install', instanceId, projectId, kind),
    deleteContent: (instanceId: string, kind: string, fileName: string) =>
      call('mods:content:delete', instanceId, kind, fileName),
    installPack: (instanceId: string) => call('mods:installPack', instanceId),
    perfList: (instanceId: string) => call('mods:perfList', instanceId),
    installPerfPack: (instanceId: string, includeOptional: boolean) => call('mods:installPerfPack', instanceId, includeOptional),
    installPackFromUrl: (instanceId: string, url: string) => call('mods:installPackFromUrl', instanceId, url)
  },
  accounts: {
    list: () => call('accounts:list'),
    validateName: (name: string) => call('accounts:validateName', name),
    addOffline: (name: string) => call('accounts:addOffline', name),
    remove: (id: string) => call('accounts:remove', id),
    setActive: (id: string) => call('accounts:setActive', id),
    msBegin: () => call('accounts:msBegin'),
    msPoll: (deviceCode: string, interval: number, expiresIn: number, verificationUri: string) =>
      call('accounts:msPoll', deviceCode, interval, expiresIn, verificationUri)
  },
  assistant: {
    ask: (messages: { role: string; text: string }[], context: Record<string, unknown>) =>
      call('assistant:ask', messages, context),
    verify: () => call('assistant:verify'),
    crash: (instanceId: string) => call('assistant:crash', instanceId),
    onChunk: (handler: (payload: { text: string }) => void) => on('assistant:chunk', handler)
  },
  transfers: {
    onProgress: (handler: (payload: unknown) => void) => on('transfer:progress', handler)
  },
  window: {
    minimize: () => call('window:minimize'),
    toggleMaximize: () => call('window:toggleMaximize'),
    close: () => call('window:close'),
    state: () => call('window:state')
  }
}

contextBridge.exposeInMainWorld('puxl', api)

export type PuxlApi = typeof api
