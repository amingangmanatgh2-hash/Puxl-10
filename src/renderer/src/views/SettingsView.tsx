import { FolderOpen, Globe2, Info, KeyRound, Network, Plus, RefreshCw, Rocket, Save, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatBytes, formatSpeed } from '../lib/format'
import { useStore } from '../lib/store'
import type { UpdateState } from '../lib/types'
import { Badge, Button, Card, Field, ProgressBar, SectionTitle, Select, Slider, Switch, TextInput } from '../components/ui'

export function SettingsView() {
  const { settings, saveSettings, toast, paths, appVersion, hardware } = useStore()
  const [draft, setDraft] = useState(settings)
  const [verify, setVerify] = useState<{ ok: boolean; message: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [probe, setProbe] = useState<{ url: string; routes: string[] } | null>(null)
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [portable, setPortable] = useState(false)

  useEffect(() => setDraft(settings), [settings])
  useEffect(() => {
    void api.system.diskUsage().then(setUsage).catch(() => setUsage({}))
  }, [])

  useEffect(() => {
    void api.update.state().then(setUpdate).catch(() => undefined)
    void api.update.isPortable().then(setPortable).catch(() => undefined)
    return api.update.onState(setUpdate)
  }, [])

  if (!draft) return null

  const patch = (values: Partial<typeof draft>): void => setDraft({ ...draft, ...values })

  const save = async (): Promise<void> => {
    try {
      await saveSettings({
        rootDir: draft.rootDir,
        mirrorMode: draft.mirrorMode,
        proxyUrl: draft.proxyUrl,
        customMirrors: draft.customMirrors,
        allowInsecureTLS: draft.allowInsecureTLS,
        downloadConcurrency: draft.downloadConcurrency,
        defaultMemoryMb: draft.defaultMemoryMb,
        defaultJvmArgs: draft.defaultJvmArgs,
        autoTune: draft.autoTune,
        closeOnLaunch: draft.closeOnLaunch,
        minimizeToTray: draft.minimizeToTray,
        openConsoleOnLaunch: draft.openConsoleOnLaunch,
        geminiApiKey: draft.geminiApiKey,
        geminiBaseUrl: draft.geminiBaseUrl,
        geminiModel: draft.geminiModel,
        geminiProxyUrl: draft.geminiProxyUrl,
        msClientId: draft.msClientId
      })
      toast('success', 'Settings saved')
    } catch (err) {
      toast('error', 'Could not save settings', err instanceof Error ? err.message : String(err))
    }
  }

  const testRoute = async (): Promise<void> => {
    setChecking(true)
    try {
      const routes = await api.system.resolveUrl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
      setProbe({ url: 'piston-meta.mojang.com', routes })
      toast('info', `${routes.length} route(s) will be tried`, 'First working one wins; failed files retry automatically.')
    } catch (err) {
      toast('error', 'Route check failed', err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const totalDisk = Object.values(usage).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Settings"
        description="Launcher-wide options. Per-instance memory, arguments and graphics live on the Performance page."
        action={
          <Button variant="primary" icon={<Save style={{ width: 15, height: 15 }} />} onClick={() => void save()}>
            Save settings
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <FolderOpen style={{ width: 17, height: 17 }} className="text-brand-400" /> General
          </h3>

          <Field label="Game storage" hint={draft.rootDir}>
            <div className="flex gap-2">
              <TextInput value={draft.rootDir} onChange={(v) => patch({ rootDir: v })} />
              <Button
                variant="outline"
                onClick={() =>
                  void api.settings.pickRoot().then((next) => {
                    if (next) {
                      patch({ rootDir: next })
                      toast('success', 'Storage folder changed', 'New downloads go to the new folder.')
                    }
                  })
                }
              >
                Browse
              </Button>
            </div>
          </Field>

          <Slider
            label="Default memory for new instances"
            value={draft.defaultMemoryMb}
            min={2048}
            max={hardware ? Math.max(4096, Math.min(32768, hardware.memoryMb - 2048)) : 16384}
            step={512}
            suffix=" MB"
            onChange={(v) => patch({ defaultMemoryMb: v })}
            hint={hardware ? `Recommended on this machine: ${hardware.recommendedMemoryMb} MB` : undefined}
          />

          <Field label="Default JVM arguments" hint="Empty means Puxl's tuned G1GC flag set only.">
            <TextInput value={draft.defaultJvmArgs} onChange={(v) => patch({ defaultJvmArgs: v })} placeholder="-XX:+UseZGC" />
          </Field>

          <Slider
            label="Parallel downloads"
            value={draft.downloadConcurrency}
            min={1}
            max={24}
            onChange={(v) => patch({ downloadConcurrency: v })}
            hint="Lower this if your connection drops files; raise it on fast links."
          />

          <div className="space-y-3 border-t border-white/5 pt-4">
            <Switch checked={draft.autoTune} onChange={(v) => patch({ autoTune: v })} label="Auto-tune new instances" description="Sets memory and graphics from a hardware scan." />
            <Switch checked={draft.closeOnLaunch} onChange={(v) => patch({ closeOnLaunch: v })} label="Minimize the launcher when the game starts" />
            <Switch checked={draft.minimizeToTray} onChange={(v) => patch({ minimizeToTray: v })} label="Keep Puxl running in the tray" description="Closing the window hides it instead of quitting." />
            <Switch checked={draft.openConsoleOnLaunch} onChange={(v) => patch({ openConsoleOnLaunch: v })} label="Open the console on launch" />
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Network style={{ width: 17, height: 17 }} className="text-aqua-400" /> Network & downloads
          </h3>

          <Field label="Mirror mode" hint="Controls which host is tried first for Mojang, Forge and GitHub files.">
            <Select
              value={draft.mirrorMode}
              onChange={(v) => patch({ mirrorMode: v })}
              options={[
                { value: 'auto', label: 'Auto — official first, mirrors on failure' },
                { value: 'iran', label: 'Mirrors first — best for restricted networks' },
                { value: 'direct', label: 'Direct only — official servers' }
              ]}
            />
          </Field>

          <Field
            label="Proxy URL"
            hint="Used for every download and API call. Example: http://127.0.0.1:10809 or socks5://127.0.0.1:1080. Only use a proxy you are allowed to use."
          >
            <TextInput value={draft.proxyUrl} onChange={(v) => patch({ proxyUrl: v })} placeholder="(none)" />
          </Field>

          <Field label="Custom mirrors" hint="Any URL containing the match text is rewritten to the replacement. Checked before the built-in mirrors.">
            <div className="space-y-2">
              {draft.customMirrors.map((rule, index) => (
                <div key={index} className="flex items-center gap-2">
                  <TextInput
                    value={rule.match}
                    onChange={(v) => {
                      const next = [...draft.customMirrors]
                      next[index] = { ...rule, match: v }
                      patch({ customMirrors: next })
                    }}
                    placeholder="https://piston-meta.mojang.com"
                  />
                  <TextInput
                    value={rule.replace}
                    onChange={(v) => {
                      const next = [...draft.customMirrors]
                      next[index] = { ...rule, replace: v }
                      patch({ customMirrors: next })
                    }}
                    placeholder="https://my-mirror.example"
                  />
                  <Button variant="ghost" onClick={() => patch({ customMirrors: draft.customMirrors.filter((_, i) => i !== index) })}>
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="subtle" icon={<Plus style={{ width: 12, height: 12 }} />} onClick={() => patch({ customMirrors: [...draft.customMirrors, { match: '', replace: '' }] })}>
                Add rule
              </Button>
            </div>
          </Field>

          <Switch
            checked={draft.allowInsecureTLS}
            onChange={(v) => patch({ allowInsecureTLS: v })}
            label="Ignore TLS errors (last resort)"
            description="Only for ISPs that intercept HTTPS. It weakens your security — prefer a mirror or proxy instead."
          />

          <div className="flex items-center gap-2">
            <Button variant="outline" loading={checking} icon={<Globe2 style={{ width: 14, height: 14 }} />} onClick={() => void testRoute()}>
              Show download routes
            </Button>
          </div>

          {probe ? (
            <div className="rounded-xl border border-white/5 bg-ink-950/60 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-mist-400">Routes for {probe.url}</p>
              <ol className="space-y-1 font-mono text-[11px] text-mist-300">
                {probe.routes.map((route, index) => (
                  <li key={route} className="truncate">
                    {index + 1}. {route}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>

        <Card className="space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <KeyRound style={{ width: 17, height: 17 }} className="text-brand-400" /> Assistant
          </h3>

          <Field label="Gemini API key" hint="Stored locally in settings.json. Create one free at aistudio.google.com/app/apikey.">
            <TextInput value={draft.geminiApiKey} onChange={(v) => patch({ geminiApiKey: v })} placeholder="AIza…" />
          </Field>

          <Field
            label="API base URL"
            hint="Point this at your own relay/Worker if generativelanguage.googleapis.com is blocked. Must speak the Gemini v1beta API."
          >
            <TextInput value={draft.geminiBaseUrl} onChange={(v) => patch({ geminiBaseUrl: v })} />
          </Field>

          <Field label="Model">
            <TextInput value={draft.geminiModel} onChange={(v) => patch({ geminiModel: v })} placeholder="gemini-2.5-flash" />
          </Field>

          <Field label="Assistant-only proxy" hint="Overrides the general proxy for chat requests. Leave empty to reuse the network proxy.">
            <TextInput value={draft.geminiProxyUrl} onChange={(v) => patch({ geminiProxyUrl: v })} placeholder="(use global proxy)" />
          </Field>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              icon={<RefreshCw style={{ width: 14, height: 14 }} />}
              onClick={() => {
                void saveSettings({ geminiApiKey: draft.geminiApiKey, geminiBaseUrl: draft.geminiBaseUrl, geminiModel: draft.geminiModel, geminiProxyUrl: draft.geminiProxyUrl })
                  .then(() =>
                    api.assistant
                      .verify()
                      .then(setVerify)
                      .catch((err: unknown) => setVerify({ ok: false, message: err instanceof Error ? err.message : String(err) }))
                  )
              }}
            >
              Save & test key
            </Button>
            {verify ? <Badge tone={verify.ok ? 'success' : 'danger'}>{verify.message}</Badge> : null}
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Rocket style={{ width: 17, height: 17 }} className="text-aqua-400" /> Launcher updates
          </h3>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="brand">v{update?.currentVersion ?? appVersion}</Badge>
            {update?.status === 'current' ? <Badge tone="success">up to date</Badge> : null}
            {update?.status === 'checking' ? <Badge tone="brand">checking…</Badge> : null}
            {update?.status === 'available' ? <Badge tone="aqua">v{update.release.version} available</Badge> : null}
            {update?.status === 'ready' ? <Badge tone="success">ready to install</Badge> : null}
            {update?.status === 'error' ? <Badge tone="danger">check failed</Badge> : null}
            {portable ? <Badge tone="warn">portable build</Badge> : null}
          </div>

          {update?.status === 'available' || update?.status === 'ready' ? (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed text-mist-300">
              <p className="font-medium text-white">{update.release.tag}</p>
              {update.release.notes ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-mist-400">{update.release.notes}</p> : null}
            </div>
          ) : null}

          {update?.status === 'downloading' ? (
            <div className="space-y-2">
              <ProgressBar value={update.total ? update.received / update.total : 0} />
              <p className="font-mono text-[11px] text-mist-400">
                {formatBytes(update.received)} / {formatBytes(update.total)} · {formatSpeed(update.speed)}
              </p>
            </div>
          ) : null}

          {update?.status === 'error' ? (
            <p className="text-xs leading-relaxed text-amber-300">
              {update.message}
              <br />
              If GitHub is unreachable from your network, set a proxy above — the update check uses it too.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              icon={<RefreshCw style={{ width: 14, height: 14 }} />}
              loading={updateBusy && update?.status !== 'available'}
              onClick={() => {
                setUpdateBusy(true)
                void api.update
                  .check()
                  .then((next) => {
                    setUpdate(next)
                    if (next.status === 'current') toast('success', 'Puxl is up to date')
                    if (next.status === 'available') toast('info', `Puxl ${next.release.version} is available`)
                    if (next.status === 'error') toast('error', 'Update check failed', next.message)
                  })
                  .finally(() => setUpdateBusy(false))
              }}
            >
              Check now
            </Button>

            {update?.status === 'available' ? (
              <Button
                variant="primary"
                loading={updateBusy}
                onClick={() => {
                  setUpdateBusy(true)
                  void api.update
                    .download()
                    .then(() => toast('success', 'Update downloaded'))
                    .catch((err: unknown) => toast('error', 'Download failed', err instanceof Error ? err.message : String(err)))
                    .finally(() => setUpdateBusy(false))
                }}
              >
                Download update
              </Button>
            ) : null}

            {update?.status === 'ready' ? (
              <Button
                variant="primary"
                loading={updateBusy}
                onClick={() => {
                  setUpdateBusy(true)
                  void api.update
                    .install()
                    .then(() => toast('info', portable ? 'Portable build: installer revealed' : 'Restarting to install'))
                    .finally(() => setUpdateBusy(false))
                }}
              >
                Restart &amp; install
              </Button>
            ) : null}

            <Button variant="subtle" onClick={() => void api.update.openRelease()}>
              Release page
            </Button>
          </div>

          <Switch
            checked={draft.checkLauncherUpdates}
            onChange={(v) => patch({ checkLauncherUpdates: v })}
            label="Check for updates on startup"
            description="Runs a few seconds after launch and respects the proxy above. Dev builds never self-update."
          />

          <p className="text-[11px] leading-relaxed text-mist-400/70">
            Updates are downloaded through the same mirrored, resumable downloader as game files, so a GitHub proxy
            works here too. The portable build cannot replace itself — Puxl reveals the new installer instead.
          </p>
        </Card>

        <Card className="space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldAlert style={{ width: 17, height: 17 }} className="text-amber-300" /> Accounts & scope
          </h3>

          <Field
            label="Microsoft application id"
            hint="Create a free app at portal.azure.com → App registrations, add a Mobile & desktop platform, enable “Allow public client flows”, then paste the Application (client) ID here."
          >
            <TextInput value={draft.msClientId} onChange={(v) => patch({ msClientId: v })} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-mist-400">
            Puxl is a launcher, not a cheat client. It contains no combat modules, no world manipulation, no HWID
            spoofer and no anti-cheat bypass, and it never will. Playing on a server means accepting that server's rules.
          </div>
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Info style={{ width: 17, height: 17 }} className="text-mist-400" /> About & storage
        </h3>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(paths).map(([key, value]) => (
            <button
              key={key}
              onClick={() => void api.system.openPath(value)}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition-colors hover:border-brand-400/40"
            >
              <p className="text-xs uppercase tracking-wide text-mist-400">{key}</p>
              <p className="mt-1 truncate text-xs text-mist-200" title={value}>
                {value}
              </p>
              <p className="mt-1 font-mono text-[11px] text-mist-400">{formatBytes(usage[key] ?? 0)}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
          <div className="text-xs text-mist-400">
            <p>
              Puxl Launcher {appVersion || '1.0.0'} · {hardware?.os.platform} {hardware?.os.release} · {hardware?.os.arch}
            </p>
            <p className="mt-0.5">Total storage used: {formatBytes(totalDisk)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="subtle" onClick={() => void api.system.openPath(paths.logs ?? '')}>
              Open logs
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void api.settings.reset().then(() => {
                  toast('success', 'Settings reset to defaults')
                  window.location.reload()
                })
              }
            >
              Reset settings
            </Button>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-mist-400/70">
          Puxl Launcher is not affiliated with Mojang, Microsoft or Modrinth. Minecraft is a trademark of Mojang Synergies
          AB. Game files are downloaded from Mojang's public launcher endpoints (or the mirrors you configure), and mods
          from the Modrinth API.
        </p>
      </Card>
    </div>
  )
}
