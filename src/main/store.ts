import fs from 'node:fs'
import path from 'node:path'
import { paths, ensureDirs, setRootOverride } from './paths'
import { configureNetwork, setMirrorConfig } from './net'

export type MirrorMode = 'direct' | 'auto' | 'iran'

export interface LauncherSettings {
  /** Where game data (versions/libraries/assets/instances) is stored. */
  rootDir: string
  /** `direct` = stock Mojang/Modrinth, `auto` = stock then mirrors on failure, `iran` = mirrors first. */
  mirrorMode: MirrorMode
  /** Optional http(s)/socks proxy for every outbound request. */
  proxyUrl: string
  /** Extra user supplied mirror prefixes, applied to any matching host. */
  customMirrors: { match: string; replace: string }[]
  /** Disable TLS verification (last resort for broken corporate/ISP interception). */
  allowInsecureTLS: boolean
  /** Parallel download workers. */
  downloadConcurrency: number
  /** Global default RAM (MB) for new instances. */
  defaultMemoryMb: number
  /** Default JVM arguments for new instances. */
  defaultJvmArgs: string
  /** Automatically tune JVM flags + in-game options when an instance is created. */
  autoTune: boolean
  /** Close the launcher when the game starts. */
  closeOnLaunch: boolean
  /** Keep the launcher in the tray instead of quitting. */
  minimizeToTray: boolean
  /** Show the raw game log window automatically after launch. */
  openConsoleOnLaunch: boolean
  /** Gemini API key for the built-in assistant. */
  geminiApiKey: string
  /** Google Generative Language base URL (override for proxies / mirrors). */
  geminiBaseUrl: string
  /** Model id used by the assistant. */
  geminiModel: string
  /** Proxy used only for assistant traffic. Falls back to `proxyUrl` when empty. */
  geminiProxyUrl: string
  /** Azure application (client) id used for Microsoft account login. */
  msClientId: string
  /** Last used instance id. */
  activeInstanceId: string
  /** Checking for launcher updates from GitHub releases. */
  checkLauncherUpdates: boolean
  [key: string]: unknown
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  rootDir: '',
  mirrorMode: 'auto',
  proxyUrl: '',
  customMirrors: [],
  allowInsecureTLS: false,
  downloadConcurrency: 8,
  defaultMemoryMb: 4096,
  defaultJvmArgs: '',
  autoTune: true,
  closeOnLaunch: false,
  minimizeToTray: true,
  openConsoleOnLaunch: true,
  geminiApiKey: '',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  geminiModel: 'gemini-2.5-flash',
  geminiProxyUrl: '',
  msClientId: '',
  activeInstanceId: '',
  checkLauncherUpdates: true
}

const SETTINGS_FILE = () => path.join(paths().root, 'settings.json')

let memo: LauncherSettings | null = null

/**
 * Pushes the parts of the settings that the network/download layer needs into it.
 * Called on every load and save so the UI can never drift from what actually runs.
 */
export function applyNetworkSettings(settings: LauncherSettings): void {
  setRootOverride(settings.rootDir || null)
  setMirrorConfig({ mode: settings.mirrorMode, custom: settings.customMirrors ?? [] })
  configureNetwork({ proxyUrl: settings.proxyUrl, allowInsecureTLS: settings.allowInsecureTLS })
}

export function loadSettings(): LauncherSettings {
  if (memo) return memo
  ensureDirs()
  let disk: Partial<LauncherSettings> = {}
  try {
    disk = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) as Partial<LauncherSettings>
  } catch {
    disk = {}
  }
  const merged: LauncherSettings = { ...DEFAULT_SETTINGS, ...disk }
  if (!merged.rootDir) merged.rootDir = paths().root
  if (!path.isAbsolute(merged.rootDir)) merged.rootDir = paths().root
  memo = merged
  ensureDirs()
  applyNetworkSettings(merged)
  return merged
}

export function saveSettings(patch: Partial<LauncherSettings>): LauncherSettings {
  const next: LauncherSettings = { ...loadSettings(), ...patch }
  memo = next
  applyNetworkSettings(next)
  ensureDirs()
  const file = SETTINGS_FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, file)
  return next
}

export function resetSettings(): LauncherSettings {
  memo = null
  setRootOverride(null)
  const file = SETTINGS_FILE()
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* ignore */
  }
  return loadSettings()
}
