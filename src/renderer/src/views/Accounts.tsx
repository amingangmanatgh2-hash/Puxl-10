import { CheckCircle2, Copy, KeyRound, LogIn, ShieldCheck, Trash2, UserRound, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { classNames, relativeTime } from '../lib/format'
import { useStore } from '../lib/store'
import type { AccountView } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, SectionTitle, Spinner, TextInput } from '../components/ui'

export function Accounts() {
  const { toast, settings } = useStore()
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [activeId, setActiveId] = useState('')
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number } | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    const data = await api.accounts.list()
    setAccounts(data.accounts)
    setActiveId(data.activeId)
  }

  useEffect(() => {
    void reload()
  }, [])

  const addOffline = async (): Promise<void> => {
    const error = await api.accounts.validateName(name.trim())
    setNameError(error)
    if (error) return
    setBusy(true)
    try {
      await api.accounts.addOffline(name.trim())
      await reload()
      setName('')
      toast('success', 'Offline account added', 'Use it for singleplayer, LAN and servers with online-mode=false.')
    } catch (err) {
      toast('error', 'Could not add the account', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startMicrosoft = async (): Promise<void> => {
    setBusy(true)
    try {
      const info = await api.accounts.msBegin()
      setDevice(info)
      setWaiting(true)
      void api.accounts
        .msPoll(info.deviceCode, info.interval, info.expiresIn, info.verificationUri)
        .then(async (account) => {
          await reload()
          setDevice(null)
          toast('success', `Signed in as ${account.name}`)
        })
        .catch((err: unknown) => {
          setDevice(null)
          toast('error', 'Microsoft sign-in failed', err instanceof Error ? err.message : String(err))
        })
        .finally(() => setWaiting(false))
    } catch (err) {
      toast('error', 'Could not start sign-in', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Accounts" description="Offline profiles for local play, or a real Microsoft account for online servers." />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<UserRound style={{ width: 22, height: 22 }} />}
          title="No accounts yet"
          description="Add an offline profile to play singleplayer instantly, or sign in with Microsoft to join online servers."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((account) => (
            <Card
              key={account.id}
              hover
              onClick={() => void api.accounts.setActive(account.id).then(reload)}
              className={classNames('flex items-center gap-4 p-4', account.id === activeId && 'ring-1 ring-brand-400/50')}
            >
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500/40 to-aqua-500/20">
                {account.skinUrl ? (
                  <img src={account.skinUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound style={{ width: 20, height: 20 }} className="text-white" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-white">{account.name}</span>
                  {account.id === activeId ? <Badge tone="success">active</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-mist-400">
                  {account.type === 'microsoft' ? 'Microsoft account' : 'Offline profile'} · added {relativeTime(account.addedAt)}
                </p>
                <p className="truncate font-mono text-[10px] text-mist-400/70">{account.uuid}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void api.accounts.remove(account.id).then(async () => {
                    await reload()
                    toast('info', 'Account removed')
                  })
                }}
              >
                <Trash2 style={{ width: 14, height: 14 }} />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Wifi style={{ width: 17, height: 17 }} className="text-aqua-400" /> Offline profile
          </h3>
          <p className="text-sm leading-relaxed text-mist-400">
            No password, no internet account. Names must be 3–16 characters of letters, numbers or underscores. Works in
            singleplayer, LAN worlds, and servers running with <span className="font-mono text-xs">online-mode=false</span>.
          </p>
          <Field label="Username" hint={nameError ?? 'Offline UUIDs are generated deterministically from the name — that is how vanilla servers identify you.'}>
            <TextInput
              value={name}
              onChange={(value) => {
                setName(value)
                setNameError(null)
              }}
              placeholder="Steve_the_second"
              onEnter={() => void addOffline()}
            />
          </Field>
          <Button variant="primary" loading={busy} disabled={!name.trim()} icon={<UserRound style={{ width: 15, height: 15 }} />} onClick={() => void addOffline()}>
            Add offline profile
          </Button>
        </Card>

        <Card className="space-y-4 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldCheck style={{ width: 17, height: 17 }} className="text-brand-400" /> Microsoft account
          </h3>
          <p className="text-sm leading-relaxed text-mist-400">
            Device-code sign-in: you enter a short code on Microsoft's own page, and Puxl polls until you approve. Your
            password never touches the launcher.
          </p>

          {!settings?.msClientId ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
              This build ships without an Azure application id on purpose — borrowing someone else's would be
              impersonation. Create a free app at portal.azure.com, enable “Allow public client flows”, then paste the
              application (client) id under Settings → Accounts.
            </div>
          ) : null}

          {device ? (
            <div className="space-y-3 rounded-xl border border-brand-400/30 bg-brand-500/10 p-4">
              <p className="text-xs text-mist-300">Enter this code on Microsoft's page:</p>
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xl font-semibold tracking-[0.25em] text-white">{device.userCode}</span>
                <Button size="sm" variant="subtle" icon={<Copy style={{ width: 12, height: 12 }} />} onClick={() => void navigator.clipboard.writeText(device.userCode)}>
                  Copy
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => void api.system.openExternal(device.verificationUri)}>
                Open {device.verificationUri}
              </Button>
              {waiting ? (
                <p className="flex items-center gap-2 text-xs text-mist-300">
                  <Spinner /> Waiting for approval…
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            variant="primary"
            loading={busy && !device}
            disabled={waiting}
            icon={<LogIn style={{ width: 15, height: 15 }} />}
            onClick={() => void startMicrosoft()}
          >
            Sign in with Microsoft
          </Button>

          <div className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-mist-400">
            <KeyRound style={{ width: 13, height: 13 }} className="mt-0.5 shrink-0 text-mist-400" />
            Tokens are stored locally under your Puxl folder with owner-only permissions and refreshed automatically before
            each launch.
          </div>

          {accounts.some((a) => a.type === 'microsoft') ? (
            <p className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 style={{ width: 13, height: 13 }} /> A Microsoft account is linked.
            </p>
          ) : null}
        </Card>
      </div>

      <p className="text-center text-[11px] text-mist-400/70">
        Puxl cannot and does not bypass bans, HWID checks or anti-cheat systems, and it will not help you return to a server you were removed from.
      </p>
    </div>
  )
}
