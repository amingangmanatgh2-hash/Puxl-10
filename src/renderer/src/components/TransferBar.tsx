import { Download, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatBytes, formatSpeed } from '../lib/format'
import { useStore } from '../lib/store'
import { ProgressBar } from './ui'

export function TransferBar({ onOpenConsole }: { onOpenConsole: () => void }) {
  const transfers = useStore((s) => s.transfers)
  const installing = useStore((s) => s.installing)
  const [hiddenIds, setHiddenIds] = useState<string[]>([])

  const active = useMemo(
    () => Object.values(transfers).filter((t) => t.state === 'running' || t.state === 'retrying'),
    [transfers]
  )

  if (installing) {
    return (
      <button
        onClick={onOpenConsole}
        className="no-drag flex items-center gap-3 rounded-xl border border-brand-400/30 bg-brand-500/10 px-3 py-1.5 text-xs text-mist-200 transition-colors hover:border-brand-400/60"
        title="Open the console for details"
      >
        <span className="font-medium text-white">{installing.stage}</span>
        <span className="max-w-[240px] truncate text-mist-400">{installing.detail}</span>
        <div className="w-32">
          <ProgressBar value={installing.pct} />
        </div>
        <span className="font-mono text-[11px] text-brand-400">{Math.round(installing.pct * 100)}%</span>
      </button>
    )
  }

  const visible = active.filter((t) => !hiddenIds.includes(t.id))
  if (visible.length === 0) return null

  const received = visible.reduce((sum, t) => sum + t.received, 0)
  const expected = visible.reduce((sum, t) => sum + Math.max(t.total, t.received), 0)
  const speed = visible.reduce((sum, t) => sum + t.speed, 0)

  return (
    <div className="no-drag flex items-center gap-3 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-mist-300">
      <Download style={{ width: 14, height: 14 }} className="text-aqua-400" />
      <span className="font-medium text-mist-200">{visible.length} downloading</span>
      <div className="w-32">
        <ProgressBar value={expected ? received / expected : 0} />
      </div>
      <span className="font-mono text-[11px] text-mist-400">
        {formatBytes(received)} / {formatBytes(expected)} · {formatSpeed(speed)}
      </span>
      <button
        onClick={() => setHiddenIds((ids) => [...ids, ...visible.map((t) => t.id)])}
        title="Hide this panel (downloads continue)"
        className="rounded-md p-0.5 text-mist-400 transition-colors hover:text-white"
      >
        <X style={{ width: 13, height: 13 }} />
      </button>
    </div>
  )
}
