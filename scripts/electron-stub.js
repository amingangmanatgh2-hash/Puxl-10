/**
 * Minimal stand-in for the `electron` module so the main-process logic can be
 * exercised from plain Node during `npm run smoke`.
 */
const os = require('node:os')
const path = require('node:path')

const appData = process.platform === 'win32' ? process.env.APPDATA : path.join(os.homedir(), 'Library', 'Application Support')

module.exports = {
  app: {
    getPath: (name) => {
      if (name === 'appData') return appData || os.homedir()
      if (name === 'userData') return path.join(appData || os.homedir(), 'PuxlLauncher')
      if (name === 'logs') return os.tmpdir()
      return os.homedir()
    },
    getVersion: () => '1.0.0-smoke',
    getGPUInfo: async () => ({ auxAttributes: { glRenderer: 'Puxl Smoke Renderer' } }),
    isPackaged: false,
    whenReady: async () => undefined,
    on: () => undefined,
    quit: () => undefined
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showErrorBox: () => undefined
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => undefined
  },
  clipboard: { writeText: () => undefined },
  ipcMain: { handle: () => undefined },
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) },
  Tray: class {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
  BrowserWindow: class {}
}
