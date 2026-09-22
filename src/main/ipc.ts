import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { onTransferProgress, resolveUrls } from './net'
import { ensureDirs, paths } from './paths'
import { applyNetworkSettings, DEFAULT_SETTINGS, loadSettings, resetSettings, saveSettings, type LauncherSettings } from './store'
import { fetchManifest, loadLocalVersion } from './mojang'
import {
  addInstance,
  deleteInstance,
  duplicateInstance,
  gameDirOf,
  getInstance,
  listInstances,
  modsDirOf,
  newInstanceId,
  defaultInstance,
  updateInstance,
  type Instance
} from './instances'
import { ensureInstalled, isInstalled } from './installer'
import { listLoaderVersions } from './loaders'
import { gameProcess, prepareLaunch } from './launch'
import {
  runHealthChecks,
  detectHardware,
  applyGraphicsPreset,
  readOptions,
  perfModsFor,
  type GraphicsPreset,
  type HardwareProfile
} from './perf'
import {
  addLocalMod,
  checkModUpdates,
  deleteContent,
  deleteMod,
  getProject,
  getProjectVersions,
  installContent,
  installMod,
  installModpack,
  listContent,
  listInstalledMods,
  searchProjects,
  setModEnabled,
  updateMod,
  type SearchQuery
} from './mods'
import {
  addOfflineAccount,
  beginMicrosoftLogin,
  ensureFreshAccount,
  getActiveAccount,
  pollMicrosoftLogin,
  readAccounts,
  removeAccount,
  setActiveAccount,
  validateName
} from './accounts'
import { askAssistant, explainCrash, verifyAssistantKey, type ChatMessage } from './assistant'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function hardware(): Promise<HardwareProfile> {
  return detectHardware()
}

async function resolveInstance(id?: string): Promise<Instance> {
  const instance = (id ? getInstance(id) : null) ?? listInstances()[0]
  if (!instance) throw new Error('No instance yet — create one first.')
  return instance
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** Every handler returns a discriminated union so the renderer never sees an unhandled rejection. */
function handle(channel: string, fn: (...args: never[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return ok(await fn(...(args as never[])))
    } catch (err) {
      return fail(err)
    }
  })
}

export function registerIpc(): void {
  const settings = loadSettings()
  applyNetworkSettings(settings)

  onTransferProgress((progress) => send('transfer:progress', progress))

  /* ---------------- settings ---------------- */
  handle('settings:get', () => loadSettings())
  handle('settings:save', (patch: Partial<LauncherSettings>) => {
    const next = saveSettings(patch)
    applyNetworkSettings(next)
    return next
  })
  handle('settings:reset', () => {
    const next = resetSettings()
    applyNetworkSettings(next)
    return next
  })
  handle('settings:defaults', () => DEFAULT_SETTINGS)
  handle('settings:pickRoot', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose where Puxl stores game files',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const next = saveSettings({ rootDir: result.filePaths[0] })
    applyNetworkSettings(next)
    ensureDirs()
    return next.rootDir
  })

  /* ---------------- system ---------------- */
  handle('system:info', async () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    paths: paths(),
    hardware: await hardware()
  }))

  handle('system:openPath', async (target: string) => {
    if (!fs.existsSync(target)) await fsp.mkdir(target, { recursive: true }).catch(() => undefined)
    return shell.openPath(target)
  })

  handle('system:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened.')
    return shell.openExternal(url)
  })

  handle('system:health', async (instanceId?: string) => {
    const instance = await resolveInstance(instanceId)
    return runHealthChecks({
      gameDir: gameDirOf(instance),
      modsDir: modsDirOf(instance),
      memoryMb: instance.memoryMb,
      hardware: await hardware(),
      rootDir: paths().root
    })
  })

  handle('system:resolveUrl', (url: string) => resolveUrls(url))

  handle('system:diskUsage', async () => {
    const dirs = ['versions', 'libraries', 'assets', 'instances', 'java', 'cache'] as const
    const out: Record<string, number> = {}
    for (const dir of dirs) {
      let total = 0
      const stack = [paths()[dir]]
      while (stack.length) {
        const current = stack.pop() as string
        let entries: fs.Dirent[] = []
        try {
          entries = await fsp.readdir(current, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) stack.push(full)
          else {
            const stat = await fsp.stat(full).catch(() => null)
            if (stat) total += stat.size
          }
        }
      }
      out[dir] = total
    }
    return out
  })

  handle('system:versions', async (includeSnapshots: boolean) => {
    const manifest = await fetchManifest()
    return manifest.versions
      .filter((v) => (includeSnapshots ? true : v.type === 'release'))
      .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
  })

  /* ---------------- instances ---------------- */
  handle('instances:list', () => listInstances())
  handle('instances:get', (id: string) => getInstance(id))
  handle('instances:create', async (payload: Partial<Instance> & { name: string; minecraftVersion: string }) => {
    const settings = loadSettings()
    const hw = await hardware()
    const instance = defaultInstance({
      ...payload,
      id: payload.id ?? newInstanceId(payload.name),
      memoryMb: payload.memoryMb ?? (settings.autoTune ? hw.recommendedMemoryMb : settings.defaultMemoryMb)
    })
    addInstance(instance)
    ensureDirs()
    const dir = gameDirOf(instance)
    await fsp.mkdir(dir, { recursive: true })
    if (payload.perfPreset) await applyGraphicsPreset(dir, payload.perfPreset as GraphicsPreset)
    else if (settings.autoTune) await applyGraphicsPreset(dir, hw.tier === 'low' ? 'max-fps' : hw.tier === 'ultra' ? 'quality' : 'balanced')
    return instance
  })
  handle('instances:update', (id: string, patch: Partial<Instance>) => {
    const updated = updateInstance(id, patch)
    if (!updated) throw new Error('Instance not found')
    return updated
  })
  handle('instances:delete', (id: string, removeFiles: boolean) => deleteInstance(id, removeFiles))
  handle('instances:duplicate', (id: string, name: string) => duplicateInstance(id, name))
  handle('instances:installed', async (id: string) => {
    const instance = await resolveInstance(id)
    return isInstalled(instance)
  })
  handle('instances:applyPreset', async (id: string, preset: GraphicsPreset) => {
    const instance = await resolveInstance(id)
    await applyGraphicsPreset(gameDirOf(instance), preset)
    return true
  })
  handle('instances:options', async (id: string) => {
    const instance = await resolveInstance(id)
    return readOptions(gameDirOf(instance))
  })
  handle('instances:loaders', (loader: Instance['loader'], mcVersion: string) => listLoaderVersions(loader, mcVersion))
  handle('instances:localVersion', (id: string) => loadLocalVersion(id))
  handle('instances:openFolder', async (id: string, sub?: string) => {
    const instance = await resolveInstance(id)
    const target = sub ? path.join(gameDirOf(instance), sub) : gameDirOf(instance)
    if (!fs.existsSync(target)) await fsp.mkdir(target, { recursive: true }).catch(() => undefined)
    return shell.openPath(target)
  })

  /* ---------------- install ---------------- */
  handle('install:start', async (id: string) => {
    const instance = await resolveInstance(id)
    const settings = loadSettings()
    const result = await ensureInstalled({
      instance,
      settings,
      onProgress: (p) => send('install:progress', { instanceId: instance.id, ...p }),
      onLog: (line) => send('game:log', { instanceId: instance.id, line, stream: 'installer' })
    })
    updateInstance(instance.id, { versionId: result.versionId, javaPath: result.javaPath })
    return { versionId: result.versionId, javaMajor: result.javaMajor }
  })

  /* ---------------- launch ---------------- */
  handle('launch:prepare', async (id: string) => {
    const instance = await resolveInstance(id)
    const settings = loadSettings()
    const account = getActiveAccount()
    if (!account) throw new Error('Add an account first (Accounts panel).')
    const ready = await ensureFreshAccount(account)
    const prepared = await prepareLaunch({
      instance,
      settings,
      account: {
        name: ready.name,
        uuid: ready.uuid,
        accessToken: ready.accessToken ?? '0',
        userType: ready.type === 'microsoft' ? 'msa' : 'legacy',
        xuid: ready.xuid
      },
      hardware: await hardware(),
      onLog: () => undefined,
      onExit: () => undefined
    })
    return { command: prepared.command, javaPath: prepared.javaPath, gameDir: prepared.gameDir }
  })

  handle('launch:start', async (id: string) => {
    const instance = await resolveInstance(id)
    const settings = loadSettings()
    const account = getActiveAccount()
    if (!account) throw new Error('Add an account first (Accounts panel).')
    const ready = await ensureFreshAccount(account)

    const install = await isInstalled(instance)
    if (!install.installed) {
      await ensureInstalled({
        instance,
        settings,
        onProgress: (p) => send('install:progress', { instanceId: instance.id, ...p }),
        onLog: (line) => send('game:log', { instanceId: instance.id, line, stream: 'installer' })
      })
    }

    const prepared = await gameProcess.start({
      instance,
      settings,
      account: {
        name: ready.name,
        uuid: ready.uuid,
        accessToken: ready.accessToken ?? '0',
        userType: ready.type === 'microsoft' ? 'msa' : 'legacy',
        xuid: ready.xuid
      },
      hardware: await hardware(),
      onLog: (line) => send('game:log', { instanceId: instance.id, line }),
      onExit: (code) => {
        updateInstance(instance.id, {
          lastPlayed: Date.now(),
          playTimeMs: (instance.playTimeMs ?? 0) + gameProcess.lastRunMs
        })
        send('game:exit', { instanceId: instance.id, code })
      },
      onSpawn: (pid) => send('game:started', { instanceId: instance.id, pid })
    })

    updateInstance(instance.id, { lastPlayed: Date.now() })
    if (settings.closeOnLaunch) mainWindow?.minimize()
    return { command: prepared.command }
  })

  handle('launch:kill', () => {
    gameProcess.kill()
    return true
  })
  handle('launch:status', () => ({ running: gameProcess.running, pid: gameProcess.pid, uptimeMs: gameProcess.uptimeMs }))

  /* ---------------- mods ---------------- */
  handle('mods:list', async (id: string) => {
    const instance = await resolveInstance(id)
    return listInstalledMods(instance)
  })
  handle('mods:search', (query: SearchQuery) => searchProjects(query))
  handle('mods:project', (idOrSlug: string) => getProject(idOrSlug))
  handle('mods:versions', (idOrSlug: string, loader?: string, gameVersion?: string) =>
    getProjectVersions(idOrSlug, { loader, gameVersion })
  )
  handle('mods:install', async (instanceId: string, projectId: string) => {
    const instance = await resolveInstance(instanceId)
    return installMod(instance, projectId)
  })
  handle('mods:uninstall', async (instanceId: string, fileName: string) => {
    const instance = await resolveInstance(instanceId)
    await deleteMod(instance, fileName)
    return listInstalledMods(instance)
  })
  handle('mods:toggle', async (instanceId: string, fileName: string, enabled: boolean) => {
    const instance = await resolveInstance(instanceId)
    await setModEnabled(instance, fileName, enabled)
    return listInstalledMods(instance)
  })
  handle('mods:addFile', async (instanceId: string) => {
    const instance = await resolveInstance(instanceId)
    const options: Electron.OpenDialogOptions = {
      title: 'Add mod files',
      filters: [{ name: 'Minecraft mods', extensions: ['jar'] }],
      properties: ['openFile', 'multiSelections']
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const added = []
    for (const file of result.filePaths) added.push(await addLocalMod(instance, file))
    return added
  })
  handle('mods:checkUpdates', async (instanceId: string) => {
    const instance = await resolveInstance(instanceId)
    return checkModUpdates(instance)
  })
  handle('mods:update', async (instanceId: string, fileName: string) => {
    const instance = await resolveInstance(instanceId)
    return updateMod(instance, fileName)
  })
  handle('mods:content:list', async (instanceId: string, kind: 'resourcepack' | 'shader') => {
    const instance = await resolveInstance(instanceId)
    return listContent(instance, kind)
  })
  handle('mods:content:install', async (instanceId: string, projectId: string, kind: 'resourcepack' | 'shader') => {
    const instance = await resolveInstance(instanceId)
    return installContent(instance, projectId, kind)
  })
  handle('mods:content:delete', async (instanceId: string, kind: 'resourcepack' | 'shader', fileName: string) => {
    const instance = await resolveInstance(instanceId)
    await deleteContent(instance, kind, fileName)
    return listContent(instance, kind)
  })
  handle('mods:perfList', async (instanceId: string) => {
    const instance = await resolveInstance(instanceId)
    return perfModsFor(instance.loader, instance.minecraftVersion, true)
  })
  handle('mods:installPerfPack', async (instanceId: string, includeOptional: boolean) => {
    const instance = await resolveInstance(instanceId)
    const mods = perfModsFor(instance.loader, instance.minecraftVersion, includeOptional)
    const installed: string[] = []
    const skipped: { title: string; reason: string }[] = []
    for (const mod of mods) {
      try {
        const result = await installMod(instance, mod.slug)
        installed.push(...result.installed.map((m) => m.title))
        skipped.push(...result.skipped)
        send('install:progress', {
          instanceId: instance.id,
          stage: 'performance pack',
          detail: mod.name,
          current: installed.length,
          total: mods.length,
          pct: installed.length / Math.max(1, mods.length)
        })
      } catch (err) {
        skipped.push({ title: mod.name, reason: err instanceof Error ? err.message : 'install failed' })
      }
    }
    send('install:progress', { instanceId: instance.id, stage: 'done', detail: '', current: 1, total: 1, pct: 1 })
    return { installed, skipped }
  })
  handle('mods:installPack', async (instanceId: string) => {
    const instance = await resolveInstance(instanceId)
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a modpack',
      filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
      properties: ['openFile']
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return installModpack(instance, `file://${result.filePaths[0].replace(/\\/g, '/')}`, (msg) =>
      send('install:progress', { instanceId: instance.id, stage: 'modpack', detail: msg, current: 0, total: 1, pct: 0 })
    )
  })
  handle('mods:installPackFromUrl', async (instanceId: string, url: string) => {
    const instance = await resolveInstance(instanceId)
    return installModpack(instance, url, (msg) =>
      send('install:progress', { instanceId: instance.id, stage: 'modpack', detail: msg, current: 0, total: 1, pct: 0 })
    )
  })

  /* ---------------- accounts ---------------- */
  handle('accounts:list', () => {
    const store = readAccounts()
    return {
      accounts: store.accounts.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        uuid: a.uuid,
        addedAt: a.addedAt,
        lastUsed: a.lastUsed,
        skinUrl: a.skinUrl
      })),
      activeId: store.activeId
    }
  })
  handle('accounts:validateName', (name: string) => validateName(name))
  handle('accounts:addOffline', (name: string) => {
    const account = addOfflineAccount(name)
    return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, addedAt: account.addedAt }
  })
  handle('accounts:remove', (id: string) => {
    removeAccount(id)
    return true
  })
  handle('accounts:setActive', (id: string) => {
    setActiveAccount(id)
    return true
  })
  handle('accounts:msBegin', () => beginMicrosoftLogin())
  handle('accounts:msPoll', async (deviceCode: string, interval: number, expiresIn: number, verificationUri: string) => {
    const account = await pollMicrosoftLogin({ deviceCode, interval, expiresIn, verificationUri, userCode: '', message: '' })
    return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, addedAt: account.addedAt }
  })

  /* ---------------- assistant ---------------- */
  handle('assistant:ask', async (messages: ChatMessage[], context: { instanceId?: string; includeLogs?: boolean }) => {
    const reply = await askAssistant({
      messages,
      context,
      onChunk: (text) => send('assistant:chunk', { text })
    })
    return reply
  })
  handle('assistant:verify', () => verifyAssistantKey())
  handle('assistant:crash', async (instanceId: string) => explainCrash(instanceId))

  /* ---------------- window ---------------- */
  handle('window:minimize', () => {
    mainWindow?.minimize()
    return true
  })
  handle('window:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  handle('window:close', () => {
    mainWindow?.close()
    return true
  })
  handle('window:state', () => ({
    maximized: mainWindow?.isMaximized() ?? false,
    fullscreen: mainWindow?.isFullScreen() ?? false
  }))
}