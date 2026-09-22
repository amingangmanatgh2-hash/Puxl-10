import { Cpu, Gauge, HardDrive, MemoryStick, MonitorPlay, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { classNames, formatBytes } from '../lib/format'
import { useStore } from '../lib/store'
import { GRAPHICS_PRESETS } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, ProgressBar, SectionTitle, Slider, TextInput } from '../components/ui'

export function Performance() {
  const { instances, activeId, hardware, toast, refreshInstances, saveSettings, settings, health, refreshHealth } = useStore()
  const instance = instances.find((i) => i.id === activeId) ?? instances[0] ?? null

  const [memory, setMemory] = useState(instance?.memoryMb ?? 4096)
  const [jvmArgs, setJvmArgs] = useState(instance?.jvmArgs ?? '')
  const [preset, setPreset] = useState<string>(instance?.perfPreset ?? 'balanced')
  const [options, setOptions] = useState<Record<string, string>>({})
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!instance) return
    setMemory(instance.memoryMb)
    setJvmArgs(instance.jvmArgs)
    setPreset(instance.perfPreset ?? 'balanced')
    void api.instances.options(instance.id).then(setOptions).catch(() => setOptions({}))
  }, [instance?.id, instance])

  useEffect(() => {
    void api.system.diskUsage().then(setUsage).catch(() => setUsage({}))
  }, [])

  if (!instance || !hardware) {
    return (
      <EmptyState
        icon={<Gauge style={{ width: 22, height: 22 }} />}
        title="Nothing to tune yet"
        description="Create an instance first — performance settings apply per instance, so two profiles can have completely different memory and graphics settings."
      />
    )
  }

  const presetLabel = GRAPHICS_PRESETS.find((p) => p.id === preset)?.title ?? preset

  const saveMemoryAndArgs = async (): Promise<void> => {
    setBusy('save')
    try {
      await api.instances.update(instance.id, { memoryMb: memory, jvmArgs })
      await refreshInstances()
      toast('success', 'Instance tuning saved')
    } catch (err) {
      toast('error', 'Could not save', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const applyPreset = async (next: string): Promise<void> => {
    setPreset(next)
    setBusy('preset')
    try {
      await api.instances.applyPreset(instance.id, next)
      await api.instances.update(instance.id, { perfPreset: next })
      await refreshInstances()
      setOptions(await api.instances.options(instance.id))
      toast('success', `${GRAPHICS_PRESETS.find((p) => p.id === next)?.title ?? next} applied`, 'Written into options.txt — restart the game to see it.')
    } catch (err) {
      toast('error', 'Could not apply the preset', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const optimizeEverything = async (): Promise<void> => {
    setBusy('optimize')
    try {
      await api.instances.update(instance.id, { memoryMb: hardware.recommendedMemoryMb })
      await refreshInstances()
      setMemory(hardware.recommendedMemoryMb)
      const targetPreset = hardware.tier === 'low' ? 'max-fps' : hardware.tier === 'ultra' ? 'quality' : 'balanced'
      await api.instances.applyPreset(instance.id, targetPreset)
      await api.instances.update(instance.id, { perfPreset: targetPreset })
      setPreset(targetPreset)

      if (instance.loader !== 'vanilla') {
        const result = await api.mods.installPerfPack(instance.id, false)
        toast('success', 'Optimised', `${result.installed.length} performance mod(s) installed, memory set to ${hardware.recommendedMemoryMb} MB, ${GRAPHICS_PRESETS.find((p) => p.id === targetPreset)?.title} graphics applied.`)
      } else {
        toast('success', 'Optimised', `Memory set to ${hardware.recommendedMemoryMb} MB and ${GRAPHICS_PRESETS.find((p) => p.id === targetPreset)?.title} graphics applied. Mods need a modded instance.`)
      }
      await refreshInstances()
      await refreshHealth(instance.id)
    } catch (err) {
      toast('error', 'Optimisation failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const totalDisk = Object.values(usage).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Performance"
        description={`Tuning ${instance.name}. Everything here is per instance and can be reverted at any time.`}
        action={
          <Button variant="primary" loading={busy === 'optimize'} icon={<Wand2 style={{ width: 15, height: 15 }} />} onClick={() => void optimizeEverything()}>
            Optimise everything
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Cpu style={{ width: 16, height: 16 }} className="text-brand-400" /> Processor
          </div>
          <p className="text-sm text-mist-300">{hardware.cpu.model}</p>
          <p className="text-xs text-mist-400">
            {hardware.cpu.threads} threads · {hardware.cpu.speedGhz.toFixed(1)} GHz
          </p>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <MemoryStick style={{ width: 16, height: 16 }} className="text-aqua-400" /> Memory
          </div>
          <p className="text-sm text-mist-300">{Math.round(hardware.memoryMb / 1024)} GB total</p>
          <div className="space-y-1">
            <ProgressBar value={1 - hardware.freeMemoryMb / Math.max(1, hardware.memoryMb)} />
            <p className="text-xs text-mist-400">{formatBytes(hardware.freeMemoryMb * 1024 * 1024)} free right now</p>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <MonitorPlay style={{ width: 16, height: 16 }} className="text-flame-500" /> Graphics
          </div>
          {hardware.gpus.length === 0 ? (
            <p className="text-sm text-mist-400">No discrete GPU detected — the game will use integrated graphics.</p>
          ) : (
            hardware.gpus.map((gpu) => (
              <div key={gpu.model}>
                <p className="truncate text-sm text-mist-300">{gpu.model}</p>
                <p className="text-xs text-mist-400">
                  {gpu.vendor}
                  {gpu.vramMb ? ` · ${Math.round(gpu.vramMb / 1024)} GB VRAM` : ''}
                  {gpu.dedicated ? ' · dedicated' : ' · integrated'}
                </p>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card className="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Sparkles style={{ width: 17, height: 17 }} className="text-brand-400" /> Hardware tier
          </h3>
          <Badge tone={hardware.tier === 'low' ? 'warn' : hardware.tier === 'ultra' ? 'aqua' : 'brand'}>
            {hardware.tier} · score {hardware.score}
          </Badge>
        </div>

        <Slider
          label="Allocated memory"
          value={memory}
          min={1024}
          max={Math.max(4096, Math.min(32768, hardware.memoryMb - 1024))}
          step={512}
          suffix=" MB"
          onChange={setMemory}
          hint={`Recommended for this machine: ${hardware.recommendedMemoryMb} MB. Leave at least 2 GB for Windows and your browser.`}
        />

        <Field label="Extra JVM arguments" hint="Applied after Puxl's tuned G1GC flags. For example -XX:+UseZGC -XX:+ZGenerational">
          <TextInput value={jvmArgs} onChange={setJvmArgs} placeholder="(empty)" />
        </Field>

        <div className="flex items-center gap-3">
          <Button variant="outline" loading={busy === 'save'} onClick={() => void saveMemoryAndArgs()}>
            Save memory & arguments
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMemory(hardware.recommendedMemoryMb)
              setJvmArgs('')
            }}
          >
            Reset to recommended
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="text-lg font-semibold text-white">Graphics preset — currently {presetLabel}</h3>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {GRAPHICS_PRESETS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => void applyPreset(entry.id)}
              className={classNames(
                'rounded-xl border p-3 text-left transition-colors',
                preset === entry.id ? 'border-brand-400/50 bg-brand-500/15' : 'border-white/8 bg-white/[0.02] hover:border-white/20'
              )}
            >
              <div className="text-sm font-medium text-white">{entry.title}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-mist-400">{entry.blurb}</div>
            </button>
          ))}
        </div>

        {Object.keys(options).length > 0 ? (
          <div className="rounded-xl border border-white/5 bg-ink-950/60 p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-mist-400">Current options.txt values</p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] text-mist-300 md:grid-cols-4">
              {['renderDistance', 'simulationDistance', 'maxFps', 'graphicsMode', 'particles', 'ao', 'entityShadows', 'cloudStatus', 'guiScale', 'fov']
                .filter((key) => options[key] !== undefined)
                .map((key) => (
                  <div key={key} className="flex justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1">
                    <span className="text-mist-400">{key}</span>
                    <span>{options[key]}</span>
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-mist-400/80">
              In-game graphics settings are the source of truth — Minecraft rewrites this file when you change them in-game.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <HardDrive style={{ width: 17, height: 17 }} className="text-aqua-400" /> Disk usage
          </h3>
          <p className="text-sm text-mist-400">Puxl stores shared files once, so extra instances cost very little.</p>
          <div className="space-y-2">
            {Object.entries(usage).map(([dir, bytes]) => (
              <div key={dir} className="flex items-center gap-3">
                <span className="w-24 text-xs text-mist-400">{dir}</span>
                <div className="flex-1">
                  <ProgressBar value={totalDisk ? bytes / totalDisk : 0} />
                </div>
                <span className="w-20 text-right font-mono text-xs text-mist-300">{formatBytes(bytes)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3 text-sm">
            <span className="text-mist-400">Total</span>
            <span className="font-mono text-white">{formatBytes(totalDisk)}</span>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="text-lg font-semibold text-white">Health checks</h3>
          {health.length === 0 ? (
            <p className="text-sm text-mist-400">No problems detected for this instance.</p>
          ) : (
            <div className="space-y-2">
              {health.map((check) => (
                <div key={check.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={check.level === 'ok' ? 'success' : check.level === 'warn' ? 'warn' : 'danger'}>{check.level}</Badge>
                    <span className="text-sm text-white">{check.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-mist-400">{check.detail}</p>
                  {check.fix ? <p className="mt-1 text-xs text-brand-400">{check.fix}</p> : null}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="subtle" onClick={() => void refreshHealth(instance.id)}>
              Re-run checks
            </Button>
            <label className="flex items-center gap-2 text-xs text-mist-400">
              <input
                type="checkbox"
                checked={settings?.autoTune ?? true}
                onChange={(e) => void saveSettings({ autoTune: e.target.checked })}
                className="accent-brand-500"
              />
              Auto-tune new instances
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}
