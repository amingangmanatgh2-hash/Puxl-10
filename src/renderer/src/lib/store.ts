import { create } from 'zustand'
import { api } from './api'
import type {
  HealthCheck,
  HardwareProfile,
  InstallProgress,
  Instance,
  LauncherSettings,
  TransferProgress
} from './types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
}

interface State {
  ready: boolean
  settings: LauncherSettings | null
  hardware: HardwareProfile | null
  paths: Record<string, string>
  appVersion: string
  instances: Instance[]
  activeId: string
  installing: InstallProgress | null
  transfers: Record<string, TransferProgress>
  logs: string[]
  running: boolean
  runningInstanceId: string | null
  toasts: Toast[]
  health: HealthCheck[]

  bootstrap: () => Promise<void>
  setActive: (id: string) => void
  refreshInstances: () => Promise<void>
  saveSettings: (patch: Partial<LauncherSettings>) => Promise<void>
  pushLog: (line: string) => void
  clearLogs: () => void
  toast: (kind: Toast['kind'], title: string, detail?: string) => void
  dismissToast: (id: number) => void
  launch: (id: string) => Promise<void>
  kill: () => Promise<void>
  install: (id: string) => Promise<void>
  refreshHealth: (id?: string) => Promise<void>
}

let toastSeq = 1
let logBuffer: string[] = []

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  hardware: null,
  paths: {},
  appVersion: '',
  instances: [],
  activeId: '',
  installing: null,
  transfers: {},
  logs: [],
  running: false,
  runningInstanceId: null,
  toasts: [],
  health: [],

  toast: (kind, title, detail) => {
    const id = toastSeq++
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, detail }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4200)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  pushLog: (line) => {
    logBuffer = [...logBuffer, line].slice(-800)
    set({ logs: logBuffer })
  },

  clearLogs: () => {
    logBuffer = []
    set({ logs: [] })
  },

  bootstrap: async () => {
    try {
      const [settings, info, instances] = await Promise.all([api.settings.get(), api.system.info(), api.instances.list()])
      const activeId = settings.activeInstanceId && instances.some((i) => i.id === settings.activeInstanceId)
        ? settings.activeInstanceId
        : instances[0]?.id ?? ''
      set({
        settings,
        hardware: info.hardware,
        paths: info.paths,
        appVersion: info.appVersion,
        instances,
        activeId,
        ready: true
      })
      if (activeId) void get().refreshHealth(activeId)

      const status = await api.launch.status()
      set({ running: status.running })

      api.transfers.onProgress((progress) => {
        set((state) => {
          const transfers = { ...state.transfers }
          if (progress.state === 'done') delete transfers[progress.id]
          else transfers[progress.id] = progress
          return { transfers }
        })
      })

      api.install.onProgress((progress) => {
        set({ installing: progress.stage === 'done' ? null : progress })
      })

      api.launch.onLog(({ line }) => get().pushLog(line))
      api.launch.onStarted(({ instanceId }) => set({ running: true, runningInstanceId: instanceId }))
      api.launch.onExit(({ code }) => {
        set({ running: false, runningInstanceId: null })
        get().toast(code === 0 ? 'success' : 'error', code === 0 ? 'Game closed' : `Game exited with code ${code}`)
        void get().refreshHealth(get().activeId)
      })
    } catch (err) {
      set({ ready: true })
      get().toast('error', 'Startup failed', err instanceof Error ? err.message : String(err))
    }
  },

  setActive: (id) => {
    set({ activeId: id })
    void get().saveSettings({ activeInstanceId: id })
    void get().refreshHealth(id)
  },

  refreshInstances: async () => {
    const instances = await api.instances.list()
    set((state) => ({
      instances,
      activeId: instances.some((i) => i.id === state.activeId) ? state.activeId : instances[0]?.id ?? ''
    }))
  },

  saveSettings: async (patch) => {
    const settings = await api.settings.save(patch)
    set({ settings })
  },

  refreshHealth: async (id) => {
    try {
      const health = await api.system.health(id || undefined)
      set({ health })
    } catch {
      set({ health: [] })
    }
  },

  launch: async (id) => {
    try {
      get().clearLogs()
      set({ running: true, runningInstanceId: id })
      await api.launch.start(id)
    } catch (err) {
      set({ running: false, runningInstanceId: null })
      get().toast('error', 'Launch failed', err instanceof Error ? err.message : String(err))
    }
  },

  kill: async () => {
    try {
      await api.launch.kill()
    } catch (err) {
      get().toast('error', 'Could not stop the game', err instanceof Error ? err.message : String(err))
    }
  },

  install: async (id) => {
    try {
      const result = await api.install.start(id)
      await get().refreshInstances()
      get().toast('success', 'Ready to play', `Installed with Java ${result.javaMajor}`)
    } catch (err) {
      get().toast('error', 'Install failed', err instanceof Error ? err.message : String(err))
    } finally {
      set({ installing: null })
    }
  }
}))

export function activeInstance(state: State): Instance | null {
  return state.instances.find((i) => i.id === state.activeId) ?? state.instances[0] ?? null
}
