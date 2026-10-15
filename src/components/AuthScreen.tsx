import { useEffect, useState } from 'react'
import { formatCode, normalizeCode, validateCode } from '../lib/code'
import * as auth from '../services/auth'
import { ApiError } from '../services/api'
import type { SessionTokens } from '../types'
import { consumeLink } from '../lib/qr'
import { QrScanner } from './QrScanner'

export interface Reveal { code: string; tokens: SessionTokens }

export function AuthScreen({ onReveal }: { onReveal: (r: Reveal) => void }) {
  const [tab, setTab] = useState<'login' | 'create'>('login')
  const [code, setCode] = useState('')
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(0)

  const [scanning, setScanning] = useState(false)
  const [linking, setLinking] = useState(false)

  async function loginWith(c: string) {
    setErr('')
    setBusy(true)
    try {
      await auth.login(c, keep)
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 429) setErr(`Muitas tentativas. Aguarde ${Math.ceil((ex.retryAfter ?? 60) / 60)} min e tente de novo.`)
      else setErr(ex instanceof Error ? ex.message : 'Falha ao entrar.')
    } finally { setBusy(false); setLinking(false) }
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const v = validateCode(code)
    if (!v.ok) { setErr(v.message); return }
    await loginWith(v.code)
  }

  // Link de QR aberto diretamente (câmera nativa do celular): #/login?c=… já foi limpo da URL em takeLinkFromLocation()
  useEffect(() => {
    const l = consumeLink()
    if (!l) return
    if (l.ok) { setLinking(true); void loginWith(l.code) } else setErr(l.message + ' Digite o código manualmente.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doCreate() {
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const r = await auth.register(keep, setProgress)
      onReveal(r)
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 429) setErr(`Limite de criação de contas atingido. Tente de novo em ${Math.ceil((ex.retryAfter ?? 600) / 60)} min.`)
      else setErr(ex instanceof Error ? ex.message : 'Falha ao criar a conta.')
    } finally { setBusy(false) }
  }

  return (
    <div className="h-screen-dvh pt-safe pb-safe pl-safe pr-safe flex items-center justify-center overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-indigo-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-5 text-center">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl shadow" />
          <h1 className="text-2xl font-bold tracking-tight">CHAT LIVRE IA</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Converse com IAs gratuitas. Sem e-mail, sem telefone: só um código numérico.</p>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800" role="tablist">
          {(['login', 'create'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setErr('') }}
              className={`rounded-md py-2 font-medium transition ${tab === t ? 'bg-white shadow dark:bg-zinc-700' : 'text-zinc-500'}`}>
              {t === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        {tab === 'login' ? (
          <form onSubmit={doLogin} className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="code">Seu código de 19 dígitos</label>
            <input id="code" data-testid="code-input" inputMode="numeric" pattern="[0-9 \-]*" autoComplete="off" autoCorrect="off" spellCheck={false}
              value={code} onChange={(e) => setCode(formatCode(e.target.value.replace(/[^\d\s-]/g, '')))} placeholder="0000 0000 0000 0000 000" maxLength={30}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-center font-mono text-lg tracking-wider outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-4 w-4" /> Manter conectado neste dispositivo (30 dias)</label>
            {linking && <p role="status" data-testid="qr-linking" className="rounded-md bg-indigo-50 p-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">Entrando com o link do QR code…</p>}
            {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
            <button disabled={busy || normalizeCode(code).length < 18} data-testid="login-btn" className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setErr(''); setScanning(true) }} data-testid="qr-login-btn" className="w-full rounded-lg border border-zinc-300 py-3 font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              📷 Entrar com QR code
            </button>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Vamos gerar um <b>código secreto de 19 dígitos</b>. Ele é a sua única chave de acesso e será mostrado <b>uma única vez</b>.</p>
            <p className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">⚠️ Não existe recuperação. Se você perder o código, pode perder o acesso às suas conversas para sempre.</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-4 w-4" /> Manter conectado neste dispositivo (30 dias)</label>
            {/* honeypot: invisível para humanos */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" className="hidden" />
            {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
            <button onClick={doCreate} disabled={busy} data-testid="create-btn" className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {busy ? `Verificando… ${progress ? Math.min(99, Math.round(progress / 400)) + '%' : ''}` : 'Gerar meu código'}
            </button>
          </div>
        )}
      </div>
      {scanning && <QrScanner onClose={() => setScanning(false)} onCode={(c) => { setScanning(false); void loginWith(c) }} />}
    </div>
  )
}
