import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownToLine, Download, ExternalLink, Rocket, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatBytes, formatSpeed } from '../lib/format'
import { useStore } from '../lib/store'
import type { UpdateState } from '../lib/types'
import { Button, ProgressBar } from './ui'

export function UpdateBanner() {
  const toast = useStore((s) => s.toast)
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [portable, setPortable] = useState(false)

  useEffect(() => {
    void api.update.state().then(setState).catch(() => undefined)
    void api.update.isPortable().then(setPortable).catch(() => undefined)
    return api.update.onState(setState)
  }, [])

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.update.download()
      toast('success', 'Update downloaded', 'Restart Puxl to finish installing.')
    } catch (err) {
      toast('error', 'Update download failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.update.install()
      if (portable) toast('info', 'Portable build', 'The installer was revealed in its folder — replace your portable exe with it.')
      else toast('info', 'Restarting to install', 'Puxl will close and apply the update now.')
    } catch (err) {
      toast('error', 'Could not install the update', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const visible = state?.status === 'available' || state?.status === 'downloading' || state?.status === 'ready'
  const release = state && 'release' in state ? state.release : null

  return (
    <AnimatePresence>
      {visible && release ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="no-drag flex items-center gap-3 rounded-xl border border-aqua-400/30 bg-aqua-500/10 px-3 py-1.5 text-xs text-mist-200"
        >
          <Rocket style={{ width: 14, height: 14 }} className="text-aqua-400" />
          <span className="font-medium text-white">Puxl {release.version}</span>
          <span className="text-mist-400">is available (you have {state.currentVersion})</span>

          {state.status === 'downloading' ? (
            <>
              <div className="w-28">
                <ProgressBar value={state.total ? state.received / state.total : 0} />
              </div>
              <span className="font-mono text-[11px] text-mist-400">
                {formatBytes(state.received)} / {formatBytes(state.total)} · {formatSpeed(state.speed)}
              </span>
            </>
          ) : null}

          {state.status === 'available' ? (
            <Button size="sm" variant="primary" loading={busy} icon={<Download style={{ width: 12, height: 12 }} />} onClick={() => void download()}>
              Download
            </Button>
          ) : null}

          {state.status === 'ready' ? (
            <Button size="sm" variant="primary" loading={busy} icon={<RotateCw style={{ width: 12, height: 12 }} />} onClick={() => void install()}>
              Restart &amp; update
            </Button>
          ) : null}

          <button
            onClick={() => void api.update.openRelease()}
            title="Open the release page"
            className="rounded-md p-1 text-mist-400 transition-colors hover:text-white"
          >
            {state.status === 'downloading' ? <ArrowDownToLine style={{ width: 13, height: 13 }} /> : <ExternalLink style={{ width: 13, height: 13 }} />}
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
