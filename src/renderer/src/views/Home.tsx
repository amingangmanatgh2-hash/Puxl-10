import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  FolderOpen,
  Info,
  ListTree,
  Play,
  Plus,
  RefreshCw,
  Square,
  Terminal,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { classNames, relativeTime } from '../lib/format'
import { useStore } from '../lib/store'
import { GRAPHICS_PRESETS, LOADERS, type Instance, type LoaderVersion, type VersionSummary } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Modal, ProgressBar, SectionTitle, Select, Slider, Switch, TextInput } from '../components/ui'

export function Home() {
  const { instances, activeId, setActive, hardware, running, runningInstanceId, toast, launch, kill, install, installing, refreshInstances, health, logs, refreshHealth, settings } =
    useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Instance | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [installed, setInstalled] = useState<Record<string, { installed: boolean; reason?: string }>>({})
  const [busy, setBusy] = useState(false)

  const active = instances.find((i) => i.id === activeId) ?? instances[0] ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result: Record<string, { installed: boolean; reason?: string }> = {}
      for (const instance of instances) {
        try {
          result[instance.id] = await api.instances.installed(instance.id)
        } catch {
          result[instance.id] = { installed: false, reason: 'check failed' }
        }
      }
      if (!cancelled) setInstalled(result)
    })()
    return () => {
      cancelled = true
    }
  }, [instances])

  const handlePlay = async (instance: Instance): Promise<void> => {
    if (running) {
      await kill()
      return
    }
    setActive(instance.id)
    if (!installed[instance.id]?.installed) {
      toast('info', 'Installing first', 'Puxl will download the game files, then launch.')
      await install(instance.id)
    }
    await launch(instance.id)
    if (settings?.openConsoleOnLaunch) setConsoleOpen(true)
  }

  const removeInstance = async (instance: Instance): Promise<void> => {
    setBusy(true)
    try {
      await api.instances.remove(instance.id, true)
      await refreshInstances()
      toast('success', 'Instance removed', `${instance.name} and its game folder were deleted.`)
    } catch (err) {
      toast('error', 'Could not remove instance', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Instances"
        description="Every profile keeps its own mods, settings, worlds and memory allocation."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={<RefreshCw style={{ width: 15, height: 15 }} />} onClick={() => void refreshInstances()}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus style={{ width: 15, height: 15 }} />} onClick={() => setShowCreate(true)}>
              New instance
            </Button>
          </div>
        }
      />

      {active ? (
        <Card className="relative overflow-hidden p-6">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
            style={{ background: `radial-gradient(circle, ${active.accent}, transparent 65%)` }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-2xl font-semibold text-white">{active.name}</h1>
                <Badge tone="brand">Minecraft {active.minecraftVersion}</Badge>
                <Badge tone="aqua">{active.loader}</Badge>
                {installed[active.id]?.installed ? <Badge tone="success">installed</Badge> : <Badge tone="warn">needs install</Badge>}
              </div>
              <p className="mt-2 text-sm text-mist-400">
                {active.memoryMb} MB RAM · {active.width}×{active.height} · last played {relativeTime(active.lastPlayed)}
              </p>
              {hardware ? (
                <p className="mt-1 text-xs text-mist-400/80">
                  {hardware.cpu.threads} threads · {Math.round(hardware.memoryMb / 1024)} GB RAM ·{' '}
                  {hardware.gpus[0]?.model ?? 'unknown GPU'}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" icon={<FolderOpen style={{ width: 15, height: 15 }} />} onClick={() => void api.instances.openFolder(active.id)}>
                Folder
              </Button>
              <Button
                variant={running ? 'danger' : 'primary'}
                size="lg"
                loading={installing?.instanceId === active.id}
                icon={running ? <Square style={{ width: 15, height: 15 }} /> : <Play style={{ width: 16, height: 16 }} />}
                onClick={() => void handlePlay(active)}
              >
                {running ? 'Stop game' : installed[active.id]?.installed ? 'Play' : 'Install & play'}
              </Button>
            </div>
          </div>

          {installing && installing.instanceId === active.id ? (
            <div className="relative mt-6 space-y-2">
              <div className="flex items-center justify-between text-xs text-mist-400">
                <span className="font-medium text-mist-200">{installing.stage}</span>
                <span>{installing.detail}</span>
              </div>
              <ProgressBar value={installing.pct} />
            </div>
          ) : null}
        </Card>
      ) : (
        <EmptyState
          icon={<ListTree style={{ width: 22, height: 22 }} />}
          title="No instances yet"
          description="Create your first profile: pick a Minecraft version, choose a mod loader like Fabric or NeoForge, and Puxl downloads everything that is needed."
          action={
            <Button variant="primary" icon={<Plus style={{ width: 15, height: 15 }} />} onClick={() => setShowCreate(true)}>
              Create instance
            </Button>
          }
        />
      )}

      {health.length > 0 && active ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {health.map((check) => (
            <Card key={check.id} className="flex items-start gap-3 p-4">
              <span
                className={classNames(
                  'mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg',
                  check.level === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : check.level === 'warn' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'
                )}
              >
                {check.level === 'ok' ? (
                  <CheckCircle2 style={{ width: 15, height: 15 }} />
                ) : check.level === 'warn' ? (
                  <AlertTriangle style={{ width: 15, height: 15 }} />
                ) : (
                  <AlertTriangle style={{ width: 15, height: 15 }} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{check.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-mist-400">{check.detail}</p>
                {check.fix ? <p className="mt-1 text-xs leading-relaxed text-brand-400">{check.fix}</p> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {instances.map((instance) => (
          <Card
            key={instance.id}
            hover
            className={classNames('relative p-5', instance.id === activeId && 'ring-1 ring-brand-400/40')}
            onClick={() => setActive(instance.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white">{instance.name}</h3>
                <p className="mt-1 text-xs text-mist-400">
                  {instance.minecraftVersion} · {instance.loader}
                  {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
                </p>
              </div>
              <span className="h-8 w-8 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${instance.accent}, transparent)` }} />
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge>{instance.memoryMb} MB</Badge>
              {instance.perfPreset ? <Badge tone="brand">{instance.perfPreset}</Badge> : null}
              {installed[instance.id]?.installed ? <Badge tone="success">ready</Badge> : <Badge tone="warn">not installed</Badge>}
              {runningInstanceId === instance.id ? <Badge tone="aqua">running</Badge> : null}
            </div>

            <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant={runningInstanceId === instance.id ? 'danger' : 'primary'}
                icon={runningInstanceId === instance.id ? <Square style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
                onClick={() => void handlePlay(instance)}
              >
                {runningInstanceId === instance.id ? 'Stop' : 'Play'}
              </Button>
              <Button size="sm" variant="subtle" icon={<ChevronDown style={{ width: 12, height: 12 }} />} onClick={() => setEditing(instance)}>
                Manage
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                icon={<Trash2 style={{ width: 12, height: 12 }} />}
                onClick={() => void removeInstance(instance)}
                title="Delete instance and its files"
              />
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <button
          onClick={() => setConsoleOpen((open) => !open)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-mist-200">
            <Terminal style={{ width: 15, height: 15 }} className="text-aqua-400" />
            Console
            {running ? <Badge tone="success">live</Badge> : null}
          </span>
          <span className="flex items-center gap-3 text-xs text-mist-400">
            {logs.length} lines
            <ChevronDown style={{ width: 14, height: 14 }} className={classNames('transition-transform', consoleOpen && 'rotate-180')} />
          </span>
        </button>
        <AnimatePresence initial={false}>
          {consoleOpen ? (
            <motion.div initial={{ height: 0 }} animate={{ height: 240 }} exit={{ height: 0 }} className="overflow-hidden border-t border-white/5">
              <pre className="h-[240px] overflow-auto bg-ink-950/80 p-4 font-mono text-[11px] leading-relaxed text-mist-300">
                {logs.length === 0 ? 'The game log will appear here after you press Play.' : logs.join('')}
              </pre>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>

      <CreateInstanceModal open={showCreate} onClose={() => setShowCreate(false)} />
      <ManageInstanceModal instance={editing} onClose={() => setEditing(null)} onSaved={() => void refreshHealth(editing?.id)} />
    </div>
  )
}

function CreateInstanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, hardware, toast, refreshInstances, setActive } = useStore()
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [name, setName] = useState('')
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'>('fabric')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [memory, setMemory] = useState(settings?.defaultMemoryMb ?? 4096)
  const [preset, setPreset] = useState<'max-fps' | 'competitive' | 'balanced' | 'quality' | 'cinematic'>('balanced')
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [installingNow, setInstallingNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    setLoadingVersions(true)
    void (async () => {
      try {
        const list = await api.system.versions(false)
        setVersions(list)
        setMcVersion((current) => current || list[0]?.id || '')
      } catch (err) {
        toast('error', 'Could not load Minecraft versions', err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingVersions(false)
      }
    })()
    if (hardware && settings?.autoTune) setMemory(hardware.recommendedMemoryMb)
  }, [open, hardware, settings?.autoTune, toast])

  useEffect(() => {
    if (!open || !mcVersion || loader === 'vanilla') {
      setLoaderVersions([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await api.instances.loaders(loader, mcVersion)
        if (cancelled) return
        setLoaderVersions(list)
        setLoaderVersion(list[0]?.version ?? '')
      } catch {
        if (!cancelled) {
          setLoaderVersions([])
          setLoaderVersion('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, loader, mcVersion])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = needle ? versions.filter((v) => v.id.toLowerCase().includes(needle)) : versions
    return list.slice(0, 80)
  }, [versions, search])

  const create = async (): Promise<void> => {
    if (!name.trim()) {
      toast('error', 'Name your instance first')
      return
    }
    if (!mcVersion) {
      toast('error', 'Pick a Minecraft version')
      return
    }
    if (loader !== 'vanilla' && !loaderVersion) {
      toast('error', `No ${loader} build found for ${mcVersion}`, 'Try another loader or a different Minecraft version.')
      return
    }
    setBusy(true)
    try {
      const instance = await api.instances.create({
        name: name.trim(),
        minecraftVersion: mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
        memoryMb: memory,
        width,
        height,
        perfPreset: preset
      })
      await refreshInstances()
      setActive(instance.id)
      onClose()
      toast('success', 'Instance created', installingNow ? 'Downloading the files now…' : 'Press Play when you are ready.')
      if (installingNow) {
        const { install } = useStore.getState()
        await install(instance.id)
      }
    } catch (err) {
      toast('error', 'Could not create the instance', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New instance"
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-4">
          <Switch checked={installingNow} onChange={setInstallingNow} label="Download game files right away" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void create()}>
              Create instance
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <TextInput value={name} onChange={setName} placeholder="My survival world" />
          </Field>
          <Field label="Minecraft version" hint={loadingVersions ? 'Loading the version list…' : `${versions.length} releases available`}>
            <TextInput value={search} onChange={setSearch} placeholder="Filter versions, e.g. 1.21" />
          </Field>
        </div>

        <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5 bg-ink-900/50 p-2">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {filtered.map((version) => (
              <button
                key={version.id}
                onClick={() => setMcVersion(version.id)}
                className={classNames(
                  'rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                  version.id === mcVersion ? 'bg-brand-500/25 text-white ring-1 ring-brand-400/40' : 'text-mist-300 hover:bg-white/5'
                )}
              >
                {version.id}
                {version.type !== 'release' ? <span className="ml-1 text-[10px] text-amber-300">{version.type}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <Field label="Mod loader">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {LOADERS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setLoader(entry.id)}
                className={classNames(
                  'rounded-xl border p-3 text-left transition-colors',
                  loader === entry.id ? 'border-brand-400/50 bg-brand-500/15' : 'border-white/8 bg-white/[0.02] hover:border-white/20'
                )}
              >
                <div className="text-sm font-medium text-white">{entry.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-mist-400">{entry.blurb}</div>
              </button>
            ))}
          </div>
        </Field>

        {loader !== 'vanilla' ? (
          <Field
            label={`${loader} version`}
            hint={loaderVersions.length === 0 ? `No builds published for ${mcVersion} yet.` : `${loaderVersions.length} builds available`}
          >
            <Select
              value={loaderVersion}
              onChange={setLoaderVersion}
              options={
                loaderVersions.length > 0
                  ? loaderVersions.slice(0, 60).map((v) => ({ value: v.version, label: v.stable ? v.version : `${v.version} (beta)` }))
                  : [{ value: '', label: 'none available' }]
              }
            />
          </Field>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2">
          <Slider
            label="Memory"
            value={memory}
            min={2048}
            max={hardware ? Math.max(4096, Math.min(32768, hardware.memoryMb - 2048)) : 16384}
            step={512}
            suffix=" MB"
            onChange={setMemory}
            hint={hardware ? `Recommended for your hardware: ${hardware.recommendedMemoryMb} MB` : undefined}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width">
              <TextInput value={String(width)} onChange={(v) => setWidth(Number(v) || 1280)} type="number" />
            </Field>
            <Field label="Height">
              <TextInput value={String(height)} onChange={(v) => setHeight(Number(v) || 720)} type="number" />
            </Field>
          </div>
        </div>

        <Field label="Graphics preset" hint="Written into options.txt on first launch — you can change it any time.">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {GRAPHICS_PRESETS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setPreset(entry.id)}
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
        </Field>
      </div>
    </Modal>
  )
}

function ManageInstanceModal({
  instance,
  onClose,
  onSaved
}: {
  instance: Instance | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast, refreshInstances, hardware, saveSettings, settings } = useStore()
  const [draft, setDraft] = useState<Instance | null>(instance)
  const [busy, setBusy] = useState(false)
  const [command, setCommand] = useState('')

  useEffect(() => setDraft(instance), [instance])
  if (!draft) return null

  const patch = (values: Partial<Instance>): void => setDraft({ ...draft, ...values })

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.instances.update(draft.id, {
        name: draft.name,
        memoryMb: draft.memoryMb,
        jvmArgs: draft.jvmArgs,
        gameArgs: draft.gameArgs,
        javaPath: draft.javaPath,
        width: draft.width,
        height: draft.height,
        fullscreen: draft.fullscreen,
        accent: draft.accent,
        modsEnabled: draft.modsEnabled,
        notes: draft.notes
      })
      await refreshInstances()
      onSaved()
      toast('success', 'Instance updated')
      onClose()
    } catch (err) {
      toast('error', 'Could not save', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const showCommand = async (): Promise<void> => {
    try {
      const prepared = await api.launch.prepare(draft.id)
      setCommand(prepared.command)
    } catch (err) {
      toast('error', 'Could not build the launch command', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open={Boolean(instance)}
      onClose={onClose}
      title={`Manage — ${draft.name}`}
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between">
          <Button variant="subtle" icon={<Terminal style={{ width: 14, height: 14 }} />} onClick={() => void showCommand()}>
            Show launch command
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <TextInput value={draft.name} onChange={(v) => patch({ name: v })} />
          </Field>
          <Field label="Accent colour" hint="Used for the instance card gradient">
            <TextInput value={draft.accent} onChange={(v) => patch({ accent: v })} />
          </Field>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm text-mist-300">
          <div className="flex items-center gap-2 text-mist-200">
            <Info style={{ width: 14, height: 14 }} className="text-brand-400" />
            {draft.minecraftVersion} · {draft.loader}
            {draft.loaderVersion ? ` ${draft.loaderVersion}` : ''} · version id <span className="font-mono text-xs">{draft.versionId}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-mist-400">
            Changing the loader or Minecraft version means creating a new instance — that keeps existing worlds and mods untouched.
          </p>
        </div>

        <Slider
          label="Memory"
          value={draft.memoryMb}
          min={1024}
          max={hardware ? Math.max(4096, Math.min(32768, hardware.memoryMb - 1024)) : 16384}
          step={512}
          suffix=" MB"
          onChange={(v) => patch({ memoryMb: v })}
          hint={hardware ? `Installed: ${Math.round(hardware.memoryMb / 1024)} GB · recommended ${hardware.recommendedMemoryMb} MB` : undefined}
        />

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Width">
            <TextInput type="number" value={String(draft.width)} onChange={(v) => patch({ width: Number(v) || 1280 })} />
          </Field>
          <Field label="Height">
            <TextInput type="number" value={String(draft.height)} onChange={(v) => patch({ height: Number(v) || 720 })} />
          </Field>
          <Field label="Java path" hint="Empty = automatic">
            <TextInput value={draft.javaPath} onChange={(v) => patch({ javaPath: v })} placeholder="auto" />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Extra JVM arguments">
            <TextInput value={draft.jvmArgs} onChange={(v) => patch({ jvmArgs: v })} placeholder="-XX:+UseZGC" />
          </Field>
          <Field label="Extra game arguments">
            <TextInput value={draft.gameArgs} onChange={(v) => patch({ gameArgs: v })} placeholder="--server play.example.net" />
          </Field>
        </div>

        <Field label="Graphics preset" hint="Applies instantly to this instance's options.txt">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {GRAPHICS_PRESETS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  patch({ perfPreset: entry.id })
                  void api.instances.applyPreset(draft.id, entry.id).then(() => toast('success', `${entry.title} applied`))
                }}
                className={classNames(
                  'rounded-xl border p-3 text-left text-xs transition-colors',
                  draft.perfPreset === entry.id ? 'border-brand-400/50 bg-brand-500/15 text-white' : 'border-white/8 text-mist-300 hover:border-white/20'
                )}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </Field>

        <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <Switch
            checked={draft.fullscreen}
            onChange={(v) => patch({ fullscreen: v })}
            label="Start in fullscreen"
            description="Adds --fullscreen to the launch arguments."
          />
          <Switch
            checked={draft.modsEnabled}
            onChange={(v) => patch({ modsEnabled: v })}
            label="Mods enabled"
            description="When off, Puxl keeps the mods folder but skips installing new mods into it."
          />
          <Switch
            checked={settings?.closeOnLaunch ?? false}
            onChange={(v) => void saveSettings({ closeOnLaunch: v })}
            label="Minimize launcher when the game starts"
          />
        </div>

        <Field label="Notes">
          <TextInput value={draft.notes ?? ''} onChange={(v) => patch({ notes: v })} placeholder="Anything you want to remember about this profile" />
        </Field>

        {command ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-mist-400">Launch command</span>
              <Button
                size="sm"
                variant="subtle"
                icon={<Copy style={{ width: 12, height: 12 }} />}
                onClick={() => void navigator.clipboard.writeText(command)}
              >
                Copy
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-xl bg-ink-950/80 p-3 font-mono text-[10px] leading-relaxed text-mist-300">{command}</pre>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}


