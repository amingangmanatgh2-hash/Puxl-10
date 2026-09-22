import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useStore } from '../lib/store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const icon =
            toast.kind === 'error' ? (
              <AlertTriangle style={{ width: 16, height: 16 }} className="text-red-300" />
            ) : toast.kind === 'success' ? (
              <CheckCircle2 style={{ width: 16, height: 16 }} className="text-emerald-300" />
            ) : (
              <Info style={{ width: 16, height: 16 }} className="text-brand-400" />
            )
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="glass pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-2xl"
            >
              <div className="mt-0.5">{icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{toast.title}</p>
                {toast.detail ? <p className="mt-0.5 break-words text-xs leading-relaxed text-mist-400">{toast.detail}</p> : null}
              </div>
              <button onClick={() => dismiss(toast.id)} className="rounded-md p-1 text-mist-400 hover:bg-white/5 hover:text-white">
                <X style={{ width: 14, height: 14 }} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
