import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { classNames } from '../lib/format'

/* ----------------------------- primitives ----------------------------- */

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'

export function Button({
  children,
  onClick,
  variant = 'outline',
  size = 'md',
  disabled,
  loading,
  icon,
  className,
  title,
  type = 'button'
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  icon?: ReactNode
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-gradient-to-r from-brand-500 to-brand-600 text-white hover:from-brand-400 hover:to-brand-500 glow-brand border border-brand-400/30',
    ghost: 'text-mist-300 hover:text-white hover:bg-white/5 border border-transparent',
    outline: 'glass-soft text-mist-200 hover:border-brand-400/40 hover:text-white',
    subtle: 'bg-white/5 text-mist-300 hover:bg-white/10 border border-white/5',
    danger: 'bg-red-500/15 text-red-200 border border-red-400/30 hover:bg-red-500/25'
  }
  const sizes = {
    sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
    md: 'h-10 px-4 text-sm rounded-xl gap-2',
    lg: 'h-12 px-6 text-base rounded-2xl gap-2.5'
  }
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={classNames(
        'inline-flex select-none items-center justify-center font-medium transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({
  children,
  className,
  hover,
  onClick
}: {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={classNames('glass rounded-2xl', hover && 'card-hover cursor-pointer', className)}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: ReactNode
  tone?: 'default' | 'brand' | 'success' | 'warn' | 'danger' | 'aqua'
  className?: string
}) {
  const tones = {
    default: 'bg-white/5 text-mist-400 border-white/10',
    brand: 'bg-brand-500/15 text-brand-400 border-brand-400/30',
    aqua: 'bg-aqua-500/15 text-aqua-400 border-aqua-400/30',
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    danger: 'bg-red-500/15 text-red-300 border-red-400/30'
  }
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}) {
  const toggle = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={classNames(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-brand-400/50 bg-brand-500/70' : 'border-white/10 bg-white/5'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className={classNames(
          'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow',
          checked ? 'left-[22px]' : 'left-0.5'
        )}
        style={{ height: 18, width: 18 }}
      />
    </button>
  )

  if (!label) return toggle
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-mist-200">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">{description}</span> : null}
      </span>
      {toggle}
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  suffix,
  hint
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (next: number) => void
  label: string
  suffix?: string
  hint?: string
}) {
  const percent = ((value - min) / Math.max(1, max - min)) * 100
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-mist-200">{label}</span>
        <span className="font-mono text-sm text-brand-400">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(124,92,255,0.35)]"
        style={{
          background: `linear-gradient(90deg, var(--color-brand-500) ${percent}%, rgba(255,255,255,0.08) ${percent}%)`
        }}
      />
      {hint ? <p className="text-xs text-mist-400">{hint}</p> : null}
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-mist-400">{label}</div>
      {children}
      {hint ? <p className="text-xs text-mist-400/80">{hint}</p> : null}
    </div>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
  onEnter
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  type?: string
  className?: string
  onEnter?: () => void
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.()
      }}
      className={classNames(
        'h-10 w-full rounded-xl border border-white/10 bg-ink-900/70 px-3 text-sm text-mist-200 placeholder:text-mist-400/60 transition-colors focus:border-brand-400/60 focus:bg-ink-900',
        className
      )}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={classNames(
        'h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-ink-900/70 px-3 text-sm text-mist-200 transition-colors focus:border-brand-400/60',
        className
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-ink-850">
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={classNames('h-2 w-full overflow-hidden rounded-full bg-white/5', className)}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-400 to-aqua-400"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  footer
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
  footer?: ReactNode
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={classNames('glass relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-3xl', width)}
          >
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-mist-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer ? <div className="border-t border-white/5 px-6 py-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs
}: {
  value: T
  onChange: (next: T) => void
  tabs: { id: T; label: string; icon?: ReactNode; count?: number }[]
}) {
  return (
    <div className="no-drag flex items-center gap-1 rounded-xl border border-white/5 bg-white/5 p-1">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={classNames(
              'relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition-colors',
              active ? 'text-white' : 'text-mist-400 hover:text-mist-200'
            )}
          >
            {active ? (
              <motion.span
                layoutId={`tab-${tabs.map((t) => t.id).join('-')}`}
                className="absolute inset-0 rounded-lg bg-brand-500/25 ring-1 ring-brand-400/40"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined ? (
                <span className="rounded-md bg-white/10 px-1.5 text-[10px] text-mist-300">{tab.count}</span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-400">{icon}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-mist-400">{description}</p>
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={classNames('h-4 w-4 animate-spin text-brand-400', className)} />
}

export function SectionTitle({
  title,
  description,
  action
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-mist-400">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
