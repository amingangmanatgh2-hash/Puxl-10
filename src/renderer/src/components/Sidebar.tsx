import { motion } from 'framer-motion'
import { Boxes, Gauge, Home, MessageSquare, Package, Settings as SettingsIcon, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { classNames } from '../lib/format'

export type ViewId = 'home' | 'mods' | 'performance' | 'accounts' | 'assistant' | 'settings'

const ITEMS: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Instances', icon: <Home style={{ width: 18, height: 18 }} /> },
  { id: 'mods', label: 'Mods', icon: <Package style={{ width: 18, height: 18 }} /> },
  { id: 'performance', label: 'Performance', icon: <Gauge style={{ width: 18, height: 18 }} /> },
  { id: 'accounts', label: 'Accounts', icon: <UserRound style={{ width: 18, height: 18 }} /> },
  { id: 'assistant', label: 'Assistant', icon: <MessageSquare style={{ width: 18, height: 18 }} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon style={{ width: 18, height: 18 }} /> }
]

export function Sidebar({
  view,
  onChange,
  instanceName,
  instanceMeta,
  running
}: {
  view: ViewId
  onChange: (view: ViewId) => void
  instanceName?: string
  instanceMeta?: string
  running: boolean
}) {
  return (
    <nav className="flex w-[224px] shrink-0 flex-col gap-1 border-r border-white/5 bg-ink-900/30 p-3 backdrop-blur-xl">
      <div className="mb-2 rounded-2xl border border-white/5 bg-white/[0.03] p-3">
        <div className="flex items-center gap-2">
          <Boxes style={{ width: 15, height: 15 }} className="text-brand-400" />
          <span className="truncate text-sm font-medium text-white">{instanceName ?? 'No instance'}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={classNames(
              'h-1.5 w-1.5 rounded-full',
              running ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70' : 'bg-mist-500'
            )}
          />
          <span className="truncate text-[11px] text-mist-400">{running ? 'Game running' : instanceMeta ?? 'ready'}</span>
        </div>
      </div>

      {ITEMS.map((item) => {
        const active = item.id === view
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={classNames(
              'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
              active ? 'text-white' : 'text-mist-400 hover:bg-white/5 hover:text-mist-200'
            )}
          >
            {active ? (
              <motion.span
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-500/30 to-transparent ring-1 ring-brand-400/30"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative flex items-center gap-3">
              {item.icon}
              {item.label}
            </span>
          </button>
        )
      })}

      <div className="mt-auto rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-mist-400">
        Free and open source. Mods come from Modrinth, game files from Mojang or your configured mirrors.
      </div>
    </nav>
  )
}
