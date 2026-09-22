import path from 'node:path'
import { app, BrowserWindow, Menu, Tray, nativeImage, shell, clipboard, dialog } from 'electron'
import { ensureDirs, paths } from './paths'
import { loadSettings } from './store'
import { registerIpc, setMainWindow } from './ipc'
import { gameProcess } from './launch'

const isDev = !app.isPackaged
let tray: Tray | null = null
let quitting = false

function createWindow(): BrowserWindow {
  const settings = loadSettings()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0b0b14',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
    if (settings.minimizeToTray) win.setSkipTaskbar(false)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', (event) => {
    if (!quitting && loadSettings().minimizeToTray && !gameProcess.running) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => setMainWindow(null))

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createTray(win: BrowserWindow): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../resources/tray.png'))
  try {
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  } catch {
    return
  }
  tray.setToolTip('Puxl Launcher')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Puxl',
        click: () => {
          win.show()
          win.focus()
        }
      },
      {
        label: 'Open game folder',
        click: () => shell.openPath(paths().root)
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => {
    win.show()
    win.focus()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    ensureDirs()
    registerIpc()
    const win = createWindow()
    setMainWindow(win)
    createTray(win)

    // Ctrl/Cmd+Shift+L copies the launch command for support requests.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Puxl',
          submenu: [
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            {
              label: 'Copy last log line',
              click: () => clipboard.writeText(String(process.env.PUXL_LAST_LOG ?? ''))
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' }
      ])
    )

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const next = createWindow()
        setMainWindow(next)
      }
    })
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  process.on('uncaughtException', (err) => {
    if (app.isReady() && !isDev) {
      dialog.showErrorBox('Puxl hit an unexpected error', err.stack ?? err.message)
    }
    // eslint-disable-next-line no-console
    console.error(err)
  })
}
