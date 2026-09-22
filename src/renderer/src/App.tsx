import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Sidebar, type ViewId } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { TransferBar } from './components/TransferBar'
import { UpdateBanner } from './components/UpdateBanner'
import { Button, Card, Spinner } from './components/ui'
import { api } from './lib/api'
import { useStore } from './lib/store'
import { Accounts } from './views/Accounts'
import { Assistant } from './views/Assistant'
import { Home } from './views/Home'
import { Mods } from './views/Mods'
import { Performance } from './views/Performance'
import { SettingsView } from './views/SettingsView'

export function App() {
  const ready = useStore((s) => s.ready)
  const bootstrap = useStore((s) => s.bootstrap)
  const instances = useStore((s) => s.instances)
  const activeId = useStore((s) => s.activeId)
  const running = useStore((s) => s.running)
  const toast = useStore((s) => s.toast)

  const [view, setView] = useState<ViewId>('home')
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = instances.find((i) => i.id === activeId) ?? instances[0] ?? null

  return (
    <div className="flex h-full flex-col">
      <TitleBar onSearch={() => setPaletteOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onChange={setView}
          instanceName={active?.name}
          instanceMeta={active ? `${active.minecraftVersion} · ${active.loader}` : 'no instance yet'}
          running={running}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 pt-5">
            <UpdateBanner />
            <TransferBar onOpenConsole={() => setView('home')} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
            {!ready ? (
              <div className="flex h-full items-center justify-center gap-3 text-sm text-mist-400">
                <Spinner /> Starting Puxl…
              </div>
            ) : (
              <div key={view} className="rise-in mx-auto max-w-[1500px]">
                {view === 'home' ? <Home /> : null}
                {view === 'mods' ? <Mods /> : null}
                {view === 'performance' ? <Performance /> : null}
                {view === 'accounts' ? <Accounts /> : null}
                {view === 'assistant' ? <Assistant onOpenSettings={() => setView('settings')} /> : null}
                {view === 'settings' ? <SettingsView /> : null}
              </div>
            )}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={setView}
        onInstallMod={(projectId) => {
          if (!active) {
            toast('error', 'Create an instance first', 'Mods install into an instance.')
            setView('home')
            return
          }
          setView('mods')
          void api.mods
            .install(active.id, projectId)
            .then((result) => toast('success', `Installed ${result.installed.length} mod(s)`))
            .catch((err: unknown) => toast('error', 'Install failed', err instanceof Error ? err.message : String(err)))
        }}
      />

      <Toasts />
    </div>
  )
}

export function ErrorBoundaryFallback({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="max-w-lg space-y-4 p-6">
        <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
        <p className="text-sm leading-relaxed text-mist-400">{message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload Puxl
        </Button>
      </Card>
    </div>
  )
}
