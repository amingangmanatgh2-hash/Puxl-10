import {
  BadgeCheck,
  Ban,
  Boxes,
  Download,
  ExternalLink,
  FilePlus2,
  Gauge,
  Image,
  Layers,
  PackagePlus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatNumber, relativeTime } from '../lib/format'
import { useStore } from '../lib/store'
import { Badge, Button, Card, EmptyState, ProgressBar, SectionTitle, Select, Spinner, Switch, Tabs, TextInput } from '../components/ui'
import type { InstalledMod, ModVersion, SearchHit } from '../lib/types'

type Tab = 'installed' | 'browse' | 'performance' | 'content' | 'packs'
type ContentKind = 'resourcepack' | 'shader'

export function Mods() {
  const { instances, activeId, settings } = useStore()
  const instance = instances.find((i) => i.id === activeId) ?? instances[0] ?? null

  const [tab, setTab] = useState<Tab>('installed')
  const [mods, setMods] = useState<InstalledMod[]>([])

  const reload = async (): Promise<void> => {
    if (!instance) return
    try {
      setMods(await api.mods.list(instance.id))
    } catch {
      setMods([])
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id])

  if (!instance) {
    return (
      <EmptyState
        icon={<Boxes style={{ width: 22, height: 22 }} />}
        title="Create an instance first"
        description="Mods belong to an instance. Make one on the Instances page, then come back to install Sodium and friends."
      />
    )
  }

  const modded = instance.loader !== 'vanilla'

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Mods & content"
        description={`Managing ${instance.name} — Minecraft ${instance.minecraftVersion}${modded ? ` · ${instance.loader}` : ' · vanilla (no loader)'}`}
        action={
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'installed', label: 'Installed', count: mods.length },
              { id: 'browse', label: 'Browse' },
              { id: 'performance', label: 'Performance', icon: <Gauge style={{ width: 14, height: 14 }} /> },
              { id: 'content', label: 'Textures & shaders' },
              { id: 'packs', label: 'Modpacks' }
            ]}
          />
        }
      />

      {!modded && tab !== 'content' ? (
        <Card className="flex items-start gap-3 border-amber-400/30 bg-amber-500/5 p-4">
          <Ban style={{ width: 16, height: 16 }} className="mt-0.5 text-amber-300" />
          <div className="text-sm text-mist-300">
            <p className="font-medium text-amber-200">This instance has no mod loader</p>
            <p className="mt-0.5 text-xs leading-relaxed text-mist-400">
              Vanilla Minecraft cannot load mods. Create an instance with Fabric, Quilt, Forge or NeoForge to use this page.
            </p>
          </div>
        </Card>
      ) : null}

      {tab === 'installed' ? <InstalledTab instanceId={instance.id} mods={mods} reload={reload} /> : null}
      {tab === 'browse' ? <BrowseTab instanceId={instance.id} loader={instance.loader} gameVersion={instance.minecraftVersion} onInstalled={reload} /> : null}
      {tab === 'performance' ? <PerformanceTab instanceId={instance.id} loader={instance.loader} gameVersion={instance.minecraftVersion} onInstalled={reload} /> : null}
      {tab === 'content' ? <ContentTab instanceId={instance.id} gameVersion={instance.minecraftVersion} /> : null}
      {tab === 'packs' ? <PacksTab instanceId={instance.id} onInstalled={reload} /> : null}

      <p className="text-center text-[11px] text-mist-400/70">
        Mod metadata and downloads come from the Modrinth API. Mirrors and proxy settings live in Settings → Network
        {settings?.mirrorMode === 'iran' ? ' (mirrors first is on)' : ''}.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Installed
 * ------------------------------------------------------------------ */

function InstalledTab({ instanceId, mods, reload }: { instanceId: string; mods: InstalledMod[]; reload: () => Promise<void> }) {
  const toast = useStore((s) => s.toast)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? mods.filter((m) => m.title.toLowerCase().includes(needle) || m.fileName.toLowerCase().includes(needle)) : mods
  }, [mods, query])

  const toggle = async (mod: InstalledMod, enabled: boolean): Promise<void> => {
    setBusy(mod.fileName)
    try {
      await api.mods.toggle(instanceId, mod.fileName.replace('.disabled', ''), enabled)
      await reload()
    } catch (err) {
      toast('error', 'Could not change the mod', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (mod: InstalledMod): Promise<void> => {
    setBusy(mod.fileName)
    try {
      await api.mods.uninstall(instanceId, mod.fileName.replace('.disabled', ''))
      await reload()
      toast('success', 'Mod removed', mod.title)
    } catch (err) {
      toast('error', 'Could not remove the mod', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setBusy('__updates')
    try {
      const updated = await api.mods.checkUpdates(instanceId)
      await reload()
      const count = updated.filter((m) => m.updateAvailable).length
      toast(count ? 'info' : 'success', count ? `${count} mod update(s) available` : 'Everything is up to date')
    } catch (err) {
      toast('error', 'Update check failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const update = async (mod: InstalledMod): Promise<void> => {
    setBusy(mod.fileName)
    try {
      const result = await api.mods.update(instanceId, mod.fileName.replace('.disabled', ''))
      await reload()
      toast('success', 'Mod updated', result.installed.map((m) => m.title).join(', '))
    } catch (err) {
      toast('error', 'Update failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const addFile = async (): Promise<void> => {
    try {
      const added = await api.mods.addFile(instanceId)
      await reload()
      if (added.length) toast('success', `${added.length} file(s) added`)
    } catch (err) {
      toast('error', 'Could not add the file', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search style={{ width: 15, height: 15 }} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
          <TextInput value={query} onChange={setQuery} placeholder="Filter installed mods" className="pl-9" />
        </div>
        <Button variant="outline" icon={<RefreshCw style={{ width: 14, height: 14 }} />} loading={busy === '__updates'} onClick={() => void checkUpdates()}>
          Check updates
        </Button>
        <Button variant="outline" icon={<FilePlus2 style={{ width: 14, height: 14 }} />} onClick={() => void addFile()}>
          Add jar
        </Button>
        <Button
          variant="subtle"
          icon={<ExternalLink style={{ width: 14, height: 14 }} />}
          onClick={() => void api.instances.openFolder(instanceId, 'mods')}
        >
          Open folder
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<PackagePlus style={{ width: 22, height: 22 }} />}
          title="No mods installed"
          description="Use the Browse tab to search Modrinth, or the Performance tab for a one-click Sodium + Lithium + FerriteCore setup."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((mod) => (
            <Card key={mod.fileName} className="flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                {mod.iconUrl ? (
                  <img src={mod.iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <PackagePlus style={{ width: 18, height: 18 }} className="text-mist-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{mod.title}</span>
                  {mod.updateAvailable ? <Badge tone="brand">update {mod.updateAvailable}</Badge> : null}
                  {mod.source === 'manual' ? <Badge>manual</Badge> : null}
                  {mod.fromPack ? <Badge tone="aqua">pack</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-mist-400">
                  {mod.fileName} · {(mod.size / 1024 / 1024).toFixed(1)} MB · added {relativeTime(mod.installedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {mod.updateAvailable && mod.projectId ? (
                  <Button size="sm" variant="primary" loading={busy === mod.fileName} onClick={() => void update(mod)}>
                    Update
                  </Button>
                ) : null}
                <Switch checked={mod.enabled} onChange={(next) => void toggle(mod, next)} disabled={busy === mod.fileName} />
                <Button size="sm" variant="ghost" onClick={() => void remove(mod)} title="Delete">
                  <Trash2 style={{ width: 14, height: 14 }} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Browse
 * ------------------------------------------------------------------ */

const CATEGORY_FILTERS = ['optimization', 'performance', 'library', 'adventure', 'decoration', 'technology', 'magic', 'worldgen', 'utility', 'storage']

function BrowseTab({
  instanceId,
  loader,
  gameVersion,
  onInstalled
}: {
  instanceId: string
  loader: string
  gameVersion: string
  onInstalled: () => Promise<void>
}) {
  const toast = useStore((s) => s.toast)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'>('relevance')
  const [category, setCategory] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [selected, setSelected] = useState<SearchHit | null>(null)
  const [versions, setVersions] = useState<ModVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  const run = async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await api.mods.search({
        query,
        loader,
        gameVersion,
        index: sort,
        categories: category ? [category] : undefined,
        limit: 24,
        projectType: 'mod'
      })
      setHits(response.hits)
    } catch (err) {
      toast('error', 'Search failed', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, category, loader, gameVersion])

  useEffect(() => {
    const timer = setTimeout(() => void run(), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const install = async (hit: SearchHit): Promise<void> => {
    setInstalling(hit.project_id)
    try {
      const result = await api.mods.install(instanceId, hit.project_id)
      await onInstalled()
      setSelected(null)
      toast(
        'success',
        `Installed ${hit.title}`,
        result.installed.length > 1 ? `Plus ${result.installed.length - 1} required dependency(ies).` : undefined
      )
      if (result.skipped.length) toast('info', 'Some dependencies were skipped', result.skipped.map((s) => s.title).join(', '))
    } catch (err) {
      toast('error', 'Install failed', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }

  useEffect(() => {
    if (!selected) return
    setLoadingVersions(true)
    void (async () => {
      try {
        setVersions(await api.mods.versions(selected.project_id, loader, gameVersion))
      } catch {
        setVersions([])
      } finally {
        setLoadingVersions(false)
      }
    })()
  }, [selected, loader, gameVersion])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search style={{ width: 15, height: 15 }} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
          <TextInput value={query} onChange={setQuery} placeholder={`Search ${gameVersion} ${loader} mods on Modrinth`} className="pl-9" />
        </div>
        <div className="w-44">
          <Select
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...CATEGORY_FILTERS.map((c) => ({ value: c, label: c }))]}
          />
        </div>
        <div className="w-40">
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: 'relevance', label: 'Relevance' },
              { value: 'downloads', label: 'Downloads' },
              { value: 'follows', label: 'Followers' },
              { value: 'newest', label: 'Newest' },
              { value: 'updated', label: 'Recently updated' }
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-mist-400">
          <Spinner /> Searching Modrinth…
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<Search style={{ width: 22, height: 22 }} />}
          title="No results"
          description="Search results are filtered to builds that actually run on this instance's loader and Minecraft version."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {hits.map((hit) => (
            <Card key={hit.project_id} className="flex gap-4 p-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                {hit.icon_url ? <img src={hit.icon_url} alt="" className="h-full w-full object-cover" /> : <PackagePlus style={{ width: 20, height: 20 }} className="text-mist-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-white">{hit.title}</h3>
                  {hit.author ? <span className="shrink-0 text-[11px] text-mist-400">by {hit.author}</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-mist-400">{hit.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-mist-400">
                  <span className="flex items-center gap-1">
                    <Download style={{ width: 11, height: 11 }} /> {formatNumber(hit.downloads)}
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp style={{ width: 11, height: 11 }} /> {formatNumber(hit.follows)}
                  </span>
                  {(hit.display_categories ?? hit.categories).slice(0, 2).map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" variant="primary" loading={installing === hit.project_id} icon={<Download style={{ width: 12, height: 12 }} />} onClick={() => void install(hit)}>
                    Install
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => setSelected(hit)}>
                    Details
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected ? (
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{selected.title}</h3>
              <p className="mt-1 text-sm text-mist-400">{selected.description}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>

          <div className="text-xs text-mist-400">
            Supported versions: {selected.versions.slice(0, 12).join(', ')}
            {selected.versions.length > 12 ? '…' : ''}
          </div>

          {loadingVersions ? (
            <div className="flex items-center gap-2 text-sm text-mist-400">
              <Spinner /> Loading builds for your instance…
            </div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-amber-300">No build of this project matches {gameVersion} on {loader}.</p>
          ) : (
            <div className="space-y-2">
              {versions.slice(0, 5).map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-mist-200">{version.name}</p>
                    <p className="text-[11px] text-mist-400">
                      {version.version_number} · {version.version_type} · {formatNumber(version.downloads)} downloads
                    </p>
                  </div>
                  <Badge tone={version.version_type === 'release' ? 'success' : 'warn'}>{version.version_type}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Performance pack
 * ------------------------------------------------------------------ */

function PerformanceTab({
  instanceId,
  loader,
  gameVersion,
  onInstalled
}: {
  instanceId: string
  loader: string
  gameVersion: string
  onInstalled: () => Promise<void>
}) {
  const toast = useStore((s) => s.toast)
  const [mods, setMods] = useState<{ slug: string; name: string; why: string; optional?: boolean }[]>([])
  const [includeOptional, setIncludeOptional] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setMods(await api.mods.perfList(instanceId))
      } catch {
        setMods([])
      }
    })()
  }, [instanceId])

  const installAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.mods.installPerfPack(instanceId, includeOptional)
      await onInstalled()
      toast('success', `${result.installed.length} mod(s) installed`, result.installed.slice(0, 6).join(', '))
      if (result.skipped.length) toast('info', `${result.skipped.length} skipped`, result.skipped.map((s) => `${s.title}: ${s.reason}`).join('\n'))
    } catch (err) {
      toast('error', 'Performance pack failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const required = mods.filter((m) => !m.optional)
  const optional = mods.filter((m) => m.optional)

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Sparkles style={{ width: 17, height: 17 }} className="text-aqua-400" />
              Performance pack for {loader} {gameVersion}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mist-400">
              These mods are the community standard for FPS and memory. Puxl installs them from Modrinth and pulls every
              required library automatically.
            </p>
          </div>
          <Switch checked={includeOptional} onChange={setIncludeOptional} label="Include optional" />
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {[...required, ...(includeOptional ? optional : [])].map((mod) => (
            <div key={mod.slug} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <BadgeCheck style={{ width: 15, height: 15 }} className="mt-0.5 shrink-0 text-brand-400" />
              <div>
                <p className="text-sm font-medium text-white">{mod.name}</p>
                <p className="text-xs leading-relaxed text-mist-400">{mod.why}</p>
              </div>
            </div>
          ))}
        </div>

        {!includeOptional && optional.length > 0 ? (
          <p className="text-xs text-mist-400">
            Optional extras available: {optional.map((m) => m.name).join(', ')}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button variant="primary" loading={busy} onClick={() => void installAll()}>
            Install pack ({required.length + (includeOptional ? optional.length : 0)} mods)
          </Button>
          <span className="text-xs text-mist-400">
            Already-installed mods are replaced, never duplicated.
          </span>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Textures & shaders
 * ------------------------------------------------------------------ */

function ContentTab({ instanceId, gameVersion }: { instanceId: string; gameVersion: string }) {
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<ContentKind>('shader')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [installed, setInstalled] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const reloadInstalled = async (): Promise<void> => {
    try {
      setInstalled(await api.mods.listContent(instanceId, kind))
    } catch {
      setInstalled([])
    }
  }

  useEffect(() => {
    void reloadInstalled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, kind])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await api.mods.search({ query, projectType: kind, gameVersion, limit: 18, index: 'downloads' })
        if (!cancelled) setHits(response.hits)
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 320)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, kind, gameVersion])

  const install = async (hit: SearchHit): Promise<void> => {
    setBusy(hit.project_id)
    try {
      const result = await api.mods.installContent(instanceId, hit.project_id, kind)
      await reloadInstalled()
      toast('success', `Installed ${result.file}`)
    } catch (err) {
      toast('error', 'Install failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={kind}
        onChange={setKind}
        tabs={[
          { id: 'shader', label: 'Shaders', icon: <Sparkles style={{ width: 13, height: 13 }} /> },
          { id: 'resourcepack', label: 'Resource packs', icon: <Image style={{ width: 13, height: 13 }} /> }
        ]}
      />

      {installed.length > 0 ? (
        <Card className="space-y-2 p-4">
          <p className="text-xs uppercase tracking-wide text-mist-400">Installed in this instance</p>
          <div className="flex flex-wrap gap-2">
            {installed.map((file) => (
              <span key={file} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-mist-200">
                {file}
                <button
                  onClick={() =>
                    void api.mods.deleteContent(instanceId, kind, file).then((next) => {
                      setInstalled(next)
                      toast('success', 'Removed', file)
                    })
                  }
                  className="text-mist-400 hover:text-red-300"
                >
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search style={{ width: 15, height: 15 }} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
          <TextInput value={query} onChange={setQuery} placeholder={kind === 'shader' ? 'Search shader packs (BSL, Complementary, …)' : 'Search resource packs'} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-mist-400">
          <Spinner /> Searching…
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {hits.map((hit) => (
            <Card key={hit.project_id} className="flex gap-3 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                {hit.icon_url ? <img src={hit.icon_url} alt="" className="h-full w-full object-cover" /> : <Layers style={{ width: 18, height: 18 }} className="text-mist-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium text-white">{hit.title}</h3>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-mist-400">{hit.description}</p>
                <Button size="sm" variant="primary" className="mt-2" loading={busy === hit.project_id} onClick={() => void install(hit)}>
                  Install
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Modpacks
 * ------------------------------------------------------------------ */

function PacksTab({ instanceId, onInstalled }: { instanceId: string; onInstalled: () => Promise<void> }) {
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    return api.install.onProgress((payload) => {
      if (payload.instanceId === instanceId && payload.stage === 'modpack') setProgress(payload.detail)
    })
  }, [instanceId])

  const importFile = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.mods.installPack(instanceId)
      if (result) {
        await onInstalled()
        toast('success', `Installed ${result.name}`, result.summary)
      }
    } catch (err) {
      toast('error', 'Modpack import failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-lg font-semibold text-white">Import a modpack</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mist-400">
            Download any pack as <span className="font-mono text-xs">.mrpack</span> from Modrinth and import it here. Puxl
            installs the pack's mods, configs and overrides into this instance. Java, loader and memory stay under your control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} icon={<PackagePlus style={{ width: 15, height: 15 }} />} onClick={() => void importFile()}>
            Choose .mrpack file
          </Button>
          {progress ? <span className="text-xs text-mist-400">{progress}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <TextInput value={url} onChange={setUrl} placeholder="…or paste a direct .mrpack download link" className="flex-1 min-w-[280px]" />
          <Button
            variant="outline"
            disabled={!url.trim() || busy}
            onClick={() => {
              setBusy(true)
              void api.mods
                .installPackFromUrl(instanceId, url.trim())
                .then(async (result) => {
                  await onInstalled()
                  toast('success', `Installed ${result.name}`, result.summary)
                  setUrl('')
                })
                .catch((err: unknown) => toast('error', 'Modpack import failed', err instanceof Error ? err.message : String(err)))
                .finally(() => {
                  setBusy(false)
                  setProgress('')
                })
            }}
          >
            Import from link
          </Button>
        </div>

        {busy ? <ProgressBar value={0.4} /> : null}
      </Card>
    </div>
  )
}
