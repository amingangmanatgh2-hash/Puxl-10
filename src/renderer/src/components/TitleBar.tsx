import { Minus, Search, Square, X, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { isMac } from '../lib/format'

export function TitleBar({ onSearch }: { onSearch: () => void }) {
  const mac = isMac()
  return (
    <header className="drag-region relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-ink-900/40 px-3 backdrop-blur-xl">
      <div className="flex items-center gap-3 pl-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-aqua-500 shadow-lg shadow-brand-500/30">
          <Sparkles style={{ width: 15, height: 15 }} className="text-white" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-wide text-white">PUXL</span>
          <span className="text-[11px] uppercase tracking-[0.22em] text-mist-400">launcher</span>
        </div>
      </div>

      <button
        onClick={onSearch}
        className="no-drag group absolute left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-mist-400 transition-colors hover:border-brand-400/40 hover:text-mist-200"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <Search style={{ width: 14, height: 14 }} />
        <span>Search everything</span>
        <kbd className="rounded-md border border-white/10 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-mist-400">
          Ctrl K
        </kbd>
      </button>

      <div className="no-drag flex items-center gap-1">
        <button
          onClick={() => void api.window.minimize()}
          className="rounded-lg p-2 text-mist-400 transition-colors hover:bg-white/5 hover:text-white"
          title="Minimize"
        >
          <Minus style={{ width: 15, height: 15 }} />
        </button>
        <button
          onClick={() => void api.window.toggleMaximize()}
          className="rounded-lg p-2 text-mist-400 transition-colors hover:bg-white/5 hover:text-white"
          title="Maximize"
        >
          <Square style={{ width: 13, height: 13 }} />
        </button>
        <button
          onClick={() => void api.window.close()}
          className="rounded-lg p-2 text-mist-400 transition-colors hover:bg-red-500/80 hover:text-white"
          title="Close"
          style={mac ? { order: -1 } : undefined}
        >
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>
    </header>
  )
}
