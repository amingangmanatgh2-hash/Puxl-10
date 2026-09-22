/**
 * Minimal stand-in for the `electron` module so the main-process logic can be
 * exercised from plain Node during `npm run smoke`, `npm run smoke:ipc` and
 * `npm run check:package`.
 */
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// Report the real launcher version so tests can assert on it.
const packageVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

const appData =
  process.env.PUXL_STUB_APPDATA ||
  (process.platform === 'win32' ? process.env.APPDATA : path.join(os.homedir(), 'Library', 'Application Support'))

// Handlers registered through ipcMain.handle land here so tests can invoke them
// exactly the way the renderer would (including the ok/error envelope).
const handlers = new Map()
global.__puxlIpcHandlers = handlers

const windows = []

class BrowserWindow {
  constructor(options = {}) {
    this.options = options
    this.maximized = false
    this.fullscreen = false
    this.destroyed = false
    this.sent = []
    this.webContents = {
      send: (channel, payload) => this.sent.push({ channel, payload }),
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
      once: () => undefined
    }
    windows.push(this)
  }

  on() {
    return this
  }

  once() {
    return this
  }

  show() {}
  hide() {}
  focus() {}
  minimize() {}
  restore() {}
  loadFile() {}
  loadURL() {}
  setSkipTaskbar() {}

  maximize() {
    this.maximized = true
  }

  unmaximize() {
    this.maximized = false
  }

  isMaximized() {
    return this.maximized
  }

  isFullScreen() {
    return this.fullscreen
  }

  isDestroyed() {
    return this.destroyed
  }

  close() {
    this.destroyed = true
  }

  static getAllWindows() {
    return windows.filter((win) => !win.destroyed)
  }
}

class Tray {
  setToolTip() {}
  setContextMenu() {}
  on() {}
  destroy() {}
}

module.exports = {
  app: {
    getPath: (name) => {
      if (name === 'appData') return appData || os.homedir()
      if (name === 'userData') return path.join(appData || os.homedir(), 'PuxlLauncher')
      if (name === 'logs') return os.tmpdir()
      return os.homedir()
    },
    getVersion: () => packageVersion,
    getGPUInfo: async () => ({ auxAttributes: { glRenderer: 'Puxl Smoke Renderer' } }),
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: async () => undefined,
    on: () => undefined,
    once: () => undefined,
    quit: () => undefined
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showErrorBox: () => undefined
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => undefined,
    showItemInFolder: () => undefined
  },
  clipboard: { writeText: () => undefined },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) },
  Tray,
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
  session: { defaultSession: { setProxy: async () => undefined } },
  BrowserWindow
}
