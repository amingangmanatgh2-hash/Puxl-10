import { AlertTriangle, Bot, FileWarning, KeyRound, Send, Settings2, Sparkles, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { classNames } from '../lib/format'
import { useStore } from '../lib/store'
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner, Switch, TextInput } from '../components/ui'

interface Message {
  role: 'user' | 'model'
  text: string
  streaming?: boolean
}

const SUGGESTIONS = [
  'Why does my game crash after adding mods?',
  'How do I get more FPS on a weak laptop?',
  'Which mods does the performance pack install?',
  'Downloads keep failing — what should I change?',
  'Explain the difference between Fabric and NeoForge'
]

export function Assistant({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { toast, instances, activeId, settings } = useStore()
  const instance = instances.find((i) => i.id === activeId) ?? instances[0] ?? null

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [includeLogs, setIncludeLogs] = useState(false)
  const [usedContext, setUsedContext] = useState<string[]>([])
  const [mode, setMode] = useState<'gemini' | 'offline' | null>(null)
  const [verify, setVerify] = useState<{ ok: boolean; message: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return api.assistant.onChunk(({ text }) => {
      setMessages((current) => {
        if (current.length === 0) return current
        const next = [...current]
        const last = next[next.length - 1]
        if (last.role === 'model' && last.streaming) next[next.length - 1] = { ...last, text: last.text + text }
        return next
      })
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const nextMessages: Message[] = [...messages, { role: 'user', text: trimmed }]
    setMessages([...nextMessages, { role: 'model', text: '', streaming: true }])
    setInput('')
    setBusy(true)
    try {
      const reply = await api.assistant.ask(
        nextMessages.map((m) => ({ role: m.role, text: m.text })),
        { instanceId: instance?.id, includeLogs }
      )
      setMessages((current) => {
        const next = [...current]
        const last = next[next.length - 1]
        if (last.role === 'model' && last.streaming) next[next.length - 1] = { role: 'model', text: reply.text, streaming: false }
        return next
      })
      setUsedContext(reply.usedContext)
      setMode(reply.mode)
    } catch (err) {
      setMessages((current) => {
        const next = [...current]
        const last = next[next.length - 1]
        if (last.role === 'model' && last.streaming) {
          next[next.length - 1] = { role: 'model', text: `Request failed: ${err instanceof Error ? err.message : String(err)}`, streaming: false }
        }
        return next
      })
      toast('error', 'Assistant request failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const explainCrash = async (): Promise<void> => {
    if (!instance) return
    setBusy(true)
    try {
      const report = await api.assistant.crash(instance.id)
      setMessages((current) => [...current, { role: 'model', text: report, streaming: false }])
    } catch (err) {
      toast('error', 'Could not read the crash reports', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <SectionTitle
        title="Assistant"
        description="Grounded in this launcher: it reads your instance settings, mod list, game log and crash reports."
        action={
          <div className="flex items-center gap-2">
            {mode ? <Badge tone={mode === 'gemini' ? 'aqua' : 'warn'}>{mode === 'gemini' ? 'Gemini connected' : 'offline knowledge base'}</Badge> : null}
            <Button variant="outline" icon={<Settings2 style={{ width: 14, height: 14 }} />} onClick={onOpenSettings}>
              Assistant settings
            </Button>
          </div>
        }
      />

      {!settings?.geminiApiKey ? (
        <Card className="flex items-start gap-3 border-amber-400/30 bg-amber-500/5 p-4">
          <KeyRound style={{ width: 16, height: 16 }} className="mt-0.5 text-amber-300" />
          <div className="text-sm text-mist-300">
            <p className="font-medium text-amber-200">No Gemini API key saved</p>
            <p className="mt-0.5 text-xs leading-relaxed text-mist-400">
              The assistant still answers from a built-in knowledge base about crashes, FPS, mods, Java and downloads. Add a
              key (and, if Google is blocked on your network, a proxy or relay URL) in Settings → Assistant for free-form
              conversation.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void api.system.openExternal('https://aistudio.google.com/app/apikey')}>
                Get a free key
              </Button>
              <Button
                size="sm"
                variant="subtle"
                loading={busy}
                onClick={() =>
                  void api.assistant
                    .verify()
                    .then(setVerify)
                    .catch((err: unknown) => setVerify({ ok: false, message: err instanceof Error ? err.message : String(err) }))
                }
              >
                Check connection
              </Button>
            </div>
            {verify ? (
              <p className={classNames('mt-2 text-xs', verify.ok ? 'text-emerald-300' : 'text-amber-300')}>{verify.message}</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <EmptyState
              icon={<Bot style={{ width: 22, height: 22 }} />}
              title="Ask anything about your setup"
              description={
                instance
                  ? `I can see ${instance.name} (${instance.minecraftVersion}, ${instance.loader}), its mod list, and its logs when you allow it.`
                  : 'Create an instance and I can start reading its logs and mod list to give concrete answers.'
              }
              action={
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-mist-300 transition-colors hover:border-brand-400/40 hover:text-white"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            messages.map((message, index) => (
              <div key={index} className={classNames('flex gap-3', message.role === 'user' && 'flex-row-reverse')}>
                <div
                  className={classNames(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                    message.role === 'user' ? 'bg-white/10 text-mist-200' : 'bg-gradient-to-br from-brand-500 to-aqua-500 text-white'
                  )}
                >
                  {message.role === 'user' ? <User style={{ width: 15, height: 15 }} /> : <Sparkles style={{ width: 15, height: 15 }} />}
                </div>
                <div
                  className={classNames(
                    'max-w-[76%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed',
                    message.role === 'user' ? 'bg-brand-500/20 text-mist-100' : 'glass-soft text-mist-200'
                  )}
                >
                  {message.text || (message.streaming ? <Spinner className="h-3.5 w-3.5" /> : '')}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Switch
              checked={includeLogs}
              onChange={setIncludeLogs}
              label="Include latest.log and the newest crash report"
              description="Only read when you press send — nothing leaves your machine otherwise."
            />
            <Button size="sm" variant="subtle" icon={<FileWarning style={{ width: 13, height: 13 }} />} disabled={!instance} onClick={() => void explainCrash()}>
              Read crash report
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <TextInput
              value={input}
              onChange={setInput}
              placeholder="Ask about crashes, FPS, mods, Java, downloads…"
              onEnter={() => void send(input)}
            />
            <Button variant="primary" loading={busy} icon={<Send style={{ width: 15, height: 15 }} />} onClick={() => void send(input)}>
              Send
            </Button>
          </div>

          {usedContext.length > 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mist-400/80">
              <AlertTriangle style={{ width: 11, height: 11 }} />
              Sent to the model: {usedContext.join(', ')}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
