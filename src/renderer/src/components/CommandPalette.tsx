import { AnimatePresence, motion } from 'framer-motion'
import { Boxes, CornerDownLeft, Gauge, Loader2, Package, Search, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { classNames, formatNumber } from '../lib/format'
import { useStore } from '../lib/store'
import type { SearchHit } from '../lib/types'
import type { ViewId } from './Sidebar'

interface PaletteItem {
  id: string
  label: string
  hint?: string
  group: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onInstallMod
}: {
  open: boolean
  onClose: () => void
  onNavigate: (view: ViewId) => void
  onInstallMod: (projectId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const instances = useStore((s) => s.instances)
  const setActive = useStore((s) => s.setActive)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setHits([])
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 3) {
      setHits([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const response = await api.mods.search({ query: query.trim(), limit: 6, projectType: 'mod' })
        if (!cancelled) setHits(response.hits)
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, open])

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = []
    const needle = query.trim().toLowerCase()

    for (const instance of instances) {
      if (needle && !instance.name.toLowerCase().includes(needle) && !instance.minecraftVersion.includes(needle)) continue
      list.push({
        id: `instance-${instance.id}`,
        label: instance.name,
        hint: `${instance.minecraftVersion} · ${instance.loader}`,
        group: 'Instances',
        icon: <Boxes style={{ width: 15, height: 15 }} className="text-brand-400" />,
        run: () => setActive(instance.id)
      })
    }

    const views: { id: ViewId; label: string; hint: string; icon: ReactNode }[] = [
      { id: 'home', label: 'Instances', hint: 'Create, edit and launch profiles', icon: <Boxes style={{ width: 15, height: 15 }} /> },
      { id: 'mods', label: 'Mods & content', hint: 'Browse Modrinth, manage jars', icon: <Package style={{ width: 15, height: 15 }} /> },
      { id: 'performance', label: 'Performance', hint: 'FPS tuning, memory, presets', icon: <Gauge style={{ width: 15, height: 15 }} /> },
      { id: 'accounts', label: 'Accounts', hint: 'Microsoft and offline logins', icon: <UserRound style={{ width: 15, height: 15 }} /> },
      { id: 'settings', label: 'Settings', hint: 'Network, mirrors, proxy, assistant', icon: <SettingsIcon style={{ width: 15, height: 15 }} /> }
    ]
    for (const view of views) {
      if (needle && !view.label.toLowerCase().includes(needle)) continue
      list.push({ id: `view-${view.id}`, label: view.label, hint: view.hint, group: 'Go to', icon: view.icon, run: () => onNavigate(view.id) })
    }

    if (settings) {
      const toggleable: { label: string; key: 'autoTune' | 'closeOnLaunch' | 'minimizeToTray' | 'allowInsecureTLS' | 'openConsoleOnLaunch'; hint: string }[] = [
        { label: 'Auto tune new instances', key: 'autoTune', hint: 'Match settings to your hardware' },
        { label: 'Close launcher on launch', key: 'closeOnLaunch', hint: 'Free memory while playing' },
        { label: 'Keep launcher in tray', key: 'minimizeToTray', hint: 'Hide instead of quitting' },
        { label: 'Allow insecure TLS', key: 'allowInsecureTLS', hint: 'Only for broken ISP interception' },
        { label: 'Open console on launch', key: 'openConsoleOnLaunch', hint: 'Show the game log automatically' }
      ]
      for (const entry of toggleable) {
        if (needle && !entry.label.toLowerCase().includes(needle)) continue
        list.push({
          id: `toggle-${entry.key}`,
          label: `${settings[entry.key] ? 'Turn off' : 'Turn on'} — ${entry.label}`,
          hint: entry.hint,
          group: 'Settings',
          icon: <SettingsIcon style={{ width: 15, height: 15 }} className="text-aqua-400" />,
          run: () => void saveSettings({ [entry.key]: !settings[entry.key] })
        })
      }
    }

    return list.slice(0, 12)
  }, [instances, query, settings, onNavigate, setActive, saveSettings])

  const flat = useMemo(
    () => [
      ...items,
      ...hits.map((hit) => ({
        id: `hit-${hit.project_id}`,
        label: hit.title,
        hint: hit.description,
        group: 'Modrinth',
        icon: <Package style={{ width: 15, height: 15 }} className="text-aqua-400" />,
        run: () => onInstallMod(hit.project_id)
      }))
    ],
    [items, hits, onInstallMod]
  )

  useEffect(() => setCursor(0), [query])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => Math.min(flat.length - 1, c + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flat[cursor]
      if (item) {
        item.run()
        onClose()
      }
    } else if (event.key === 'Escape') {
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="glass relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
              <Search style={{ width: 18, height: 18 }} className="text-brand-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search instances, settings, and Modrinth mods…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-mist-400/70"
              />
              {searching ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin text-mist-400" /> : null}
              <kbd className="rounded-md border border-white/10 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-mist-400">esc</kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto py-2">
              {flat.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-mist-400">
                  {query.length >= 3 ? 'Nothing matched. Try another word.' : 'Type at least 3 characters to search Modrinth.'}
                </p>
              ) : (
                flat.map((item, index) => {
                  const previous = flat[index - 1]
                  const showHeader = !previous || previous.group !== item.group
                  return (
                    <div key={item.id}>
                      {showHeader ? (
                        <div className="px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-mist-400/70">
                          {item.group}
                        </div>
                      ) : null}
                      <button
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => {
                          item.run()
                          onClose()
                        }}
                        className={classNames(
                          'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
                          index === cursor ? 'bg-brand-500/15' : 'hover:bg-white/5'
                        )}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">{item.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-white">{item.label}</span>
                          {item.hint ? <span className="block truncate text-xs text-mist-400">{item.hint}</span> : null}
                        </span>
                        {index === cursor ? <CornerDownLeft style={{ width: 14, height: 14 }} className="text-mist-400" /> : null}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {hits.length > 0 ? (
              <div className="border-t border-white/5 px-5 py-2 text-[11px] text-mist-400">
                Press Enter to install the highlighted mod into the active instance. Downloads show {formatNumber(hits[0].downloads)} total.
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
