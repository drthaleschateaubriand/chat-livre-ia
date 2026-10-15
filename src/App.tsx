import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogProvider, Conversation, Message, Preferences, SessionTokens } from './types'
import { ApiError, data, streamChat } from './services/api'
import { clearSession, loadSession, onSessionChange, saveSession } from './services/session'
import * as auth from './services/auth'
import { AuthScreen, type Reveal } from './components/AuthScreen'
import { CodeReveal } from './components/CodeReveal'
import { Sidebar } from './components/Sidebar'
import { ChatView, type ChatError, type StreamState } from './components/ChatView'
import { SettingsModal } from './components/SettingsModal'
import { speak } from './lib/speech'
import { takeLinkFromLocation } from './lib/qr'

// Antes de qualquer render: se a URL traz #/login?c=…, guarda o código e limpa o fragmento da barra de endereço.
takeLinkFromLocation()

const DEFAULT_PREFS: Preferences = { theme: 'system', font_size: 'md', language: 'pt-BR', memory_enabled: true, default_model: 'auto', auto_speak: false, allow_paid_auto: false }
const FONT_PX = { sm: '14px', md: '16px', lg: '18px' }

function applyPrefs(p: Preferences) {
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.setProperty('--msg-fs', FONT_PX[p.font_size])
  document.documentElement.lang = p.language
  try { localStorage.setItem('cli.theme', p.theme) } catch { /* ignore */ }
}

function routeId(): string | null {
  const m = /^#\/c\/([0-9a-f-]{36})/i.exec(location.hash)
  return m ? m[1].toLowerCase() : null
}

export default function App() {
  const [session, setSession] = useState<SessionTokens | null>(loadSession())
  const [reveal, setReveal] = useState<Reveal | null>(null)
  useEffect(() => onSessionChange(() => setSession(loadSession())), [])

  if (reveal) {
    return <CodeReveal code={reveal.code} onConfirm={() => { saveSession(reveal.tokens); setReveal(null) }} />
  }
  if (!session) return <AuthScreen onReveal={setReveal} />
  return <Main key={session.refresh.slice(0, 8) /* remonta ao trocar de sessão */ } />
}

function Main() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(routeId())
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [stream, setStream] = useState<StreamState | null>(null)
  const [error, setError] = useState<ChatError | null>(null)
  const [catalog, setCatalog] = useState<CatalogProvider[] | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const streamRef = useRef<{ convId: string | null; ctrl: AbortController } | null>(null)
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  const loggedOut = useCallback(() => { clearSession() }, [])

  // bootstrap
  useEffect(() => {
    data('bootstrap').then((j) => {
      if (j.preferences) { setPrefs(j.preferences); applyPrefs(j.preferences) }
      setConvs(j.conversations)
    }).catch((e) => { if (!(e instanceof ApiError && e.status === 401)) flash('Não foi possível carregar seus dados. Verifique a conexão.') })
  }, [])

  // roteamento por hash
  useEffect(() => {
    const h = () => setActiveId(routeId())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const go = (id: string | null) => { location.hash = id ? `#/c/${id}` : '#/' }

  const loadMessages = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const j = await data('conv.messages', { id })
      if (activeRef.current !== id || streamRef.current) return
      setMessages((old) => {
        const same = old.length === j.messages.length && old[old.length - 1]?.id === j.messages[j.messages.length - 1]?.id && old[old.length - 1]?.content === j.messages[j.messages.length - 1]?.content
        return same ? old : j.messages
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { go(null); setMessages([]) }
    } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => {
    setError(null)
    if (streamRef.current && streamRef.current.convId === activeId) return // conversa recém-criada em streaming
    if (!activeId) { setMessages([]); return }
    setMessages([])
    loadMessages(activeId)
  }, [activeId, loadMessages])

  // sincronização entre dispositivos: ao focar, ao voltar online e a cada 20 s
  const refreshList = useCallback(async () => {
    try {
      const j = await data('conv.list')
      setConvs((old) => (JSON.stringify(old) === JSON.stringify(j.conversations) ? old : j.conversations))
      if (activeRef.current && !streamRef.current) loadMessages(activeRef.current, true)
    } catch { /* offline: tenta depois */ }
  }, [loadMessages])
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible') refreshList() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', vis)
    window.addEventListener('online', vis)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshList() }, 20000)
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); window.removeEventListener('online', vis); clearInterval(t) }
  }, [refreshList])

  const updatePrefs = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyPrefs(next)
    data('prefs.update', patch as Record<string, unknown>).catch(() => flash('Não foi possível salvar a preferência.'))
  }
  useEffect(() => {
    if (prefs.theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const h = () => applyPrefs(prefsRef.current)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [prefs.theme])

  const loadCatalog = useCallback(() => { data('models.list').then((j) => setCatalog(j.catalog)).catch(() => {}) }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  // --- envio / streaming ---
  const run = useCallback(async (mode: 'send' | 'regenerate' | 'continue', content?: string) => {
    if (streamRef.current) return
    const convId = activeRef.current
    const ctrl = new AbortController()
    streamRef.current = { convId, ctrl }
    setError(null)
    setStream({ convId, text: '', phase: 'connecting', notice: '', continuing: mode === 'continue' })
    if (mode === 'send') setMessages((m) => [...m, { id: 'tmp-' + Date.now(), role: 'user', content: content!, created_at: new Date().toISOString(), pending: true }])
    if (mode === 'regenerate') setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' ? m.slice(0, -1) : m))
    let acc = ''
    let raf = 0
    const flush = () => { raf = 0; setStream((s) => (s ? { ...s, text: acc, phase: 'streaming' } : s)) }
    let finished = false
    try {
      await streamChat({ conversation_id: convId ?? undefined, mode, content, model: prefsRef.current.default_model }, {
        signal: ctrl.signal,
        onEvent: (ev, d) => {
          if (ev === 'meta') {
            if (d.user_message) setMessages((m) => m.map((x) => (x.pending ? d.user_message : x)))
            if (d.conversation_id && streamRef.current) {
              streamRef.current.convId = d.conversation_id
              if (!convId) { activeRef.current = d.conversation_id; go(d.conversation_id) }
              setConvs((old) => (old.some((c) => c.id === d.conversation_id) ? old : [{ id: d.conversation_id, title: d.title, pinned: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...old]))
            }
          } else if (ev === 'attempt') setStream((s) => (s && !acc ? { ...s, notice: `Consultando ${d.provider}…` } : s))
          else if (ev === 'delta') { acc += d.t; if (!raf) raf = requestAnimationFrame(flush) }
          else if (ev === 'reset') { acc = ''; setStream((s) => (s ? { ...s, text: '', notice: 'Trocando de modelo…' } : s)) }
          else if (ev === 'fallback') setStream((s) => (s ? { ...s, notice: `${d.provider} indisponível (${d.kind === 'rate_limit' ? 'limite atingido' : d.kind}); tentando outro modelo…` } : s))
          else if (ev === 'done') {
            finished = true
            const msg = d.message as Message
            setMessages((m) => (mode === 'continue' ? m.map((x) => (x.id === msg.id ? msg : x)) : [...m.filter((x) => x.id !== msg.id), msg]))
            if (prefsRef.current.auto_speak) speak(msg.content, prefsRef.current.language)
          } else if (ev === 'error') {
            setError({ message: d.message, retryAfter: d.retry_after, canRetry: true })
          }
        },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        if (e instanceof ApiError && e.status === 429) setError({ message: `Muitas mensagens em pouco tempo. Aguarde ${e.retryAfter ?? 30}s.`, retryAfter: e.retryAfter, canRetry: false })
        else if (!(e instanceof ApiError && e.status === 401)) setError({ message: e instanceof Error ? e.message : 'Falha de conexão.', canRetry: mode !== 'send' || true })
      }
    } finally {
      if (raf) cancelAnimationFrame(raf)
      const id = streamRef.current?.convId ?? convId
      streamRef.current = null
      setStream(null)
      if (!finished && id) loadMessages(id, true) // recupera o que o servidor gravou (ex.: parada manual)
      refreshList()
    }
  }, [loadMessages, refreshList])

  const doDelete = async (id: string) => {
    try { await data('conv.delete', { id }); setConvs((c) => c.filter((x) => x.id !== id)); if (activeRef.current === id) go(null) } catch { flash('Não foi possível excluir.') }
  }
  const doRename = async (id: string, title: string) => {
    setConvs((c) => c.map((x) => (x.id === id ? { ...x, title } : x)))
    try { await data('conv.rename', { id, title }) } catch { flash('Não foi possível renomear.'); refreshList() }
  }
  const doPin = async (id: string, pinned: boolean) => {
    setConvs((c) => c.map((x) => (x.id === id ? { ...x, pinned } : x)))
    try { await data('conv.pin', { id, pinned }) } catch { flash('Não foi possível fixar.'); refreshList() }
  }

  const conversation = convs.find((c) => c.id === activeId) ?? null

  return (
    <div className="h-screen-dvh flex overflow-hidden">
      <Sidebar conversations={convs} activeId={activeId} open={menuOpen} onClose={() => setMenuOpen(false)}
        onNew={() => go(null)} onSelect={go} onRename={doRename} onPin={doPin} onDelete={doDelete}
        onSettings={() => setSettings(true)} onLogout={async () => { await auth.logout() }} />
      <ChatView conversation={conversation} messages={messages} loading={loading} stream={stream} error={error}
        model={prefs.default_model} catalog={catalog} lang={prefs.language}
        onModel={(v) => updatePrefs({ default_model: v })} onLoadCatalog={loadCatalog}
        onSend={(t) => run('send', t)} onStop={() => streamRef.current?.ctrl.abort()}
        onRegenerate={() => run('regenerate')} onContinue={() => run('continue')} onMenu={() => setMenuOpen(true)} />
      {settings && <SettingsModal prefs={prefs} onPrefs={updatePrefs} onClose={() => setSettings(false)} onLoggedOut={loggedOut} />}
      {toast && <div role="status" className="pb-safe fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
    </div>
  )
}
