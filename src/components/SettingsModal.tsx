import { useCallback, useEffect, useState } from 'react'
import type { CatalogProvider, DeviceSession, Memory, Preferences, UsageRow } from '../types'
import { data } from '../services/api'
import * as auth from '../services/auth'
import { download } from '../lib/exporters'
import { formatCode, normalizeCode } from '../lib/code'
import { QrCard } from './QrCard'

type Tab = 'appearance' | 'models' | 'memory' | 'devices' | 'qr' | 'data'
const TABS: [Tab, string][] = [['appearance', 'Aparência'], ['models', 'Modelos'], ['memory', 'Memória'], ['devices', 'Dispositivos'], ['qr', 'QR de acesso'], ['data', 'Dados']]

export function SettingsModal({ prefs, onPrefs, onClose, onLoggedOut }: {
  prefs: Preferences
  onPrefs: (patch: Partial<Preferences>) => void
  onClose: () => void
  onLoggedOut: () => void
}) {
  const [tab, setTab] = useState<Tab>('appearance')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Ajustes" data-testid="settings" onClick={(e) => e.stopPropagation()}
        className="pb-safe flex h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-zinc-900 sm:h-[80vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">Ajustes</h2>
          <button onClick={onClose} aria-label="Fechar" className="h-9 w-9 rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
        </div>
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{l}</button>
          ))}
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-4 text-sm">
          {tab === 'appearance' && <Appearance prefs={prefs} onPrefs={onPrefs} />}
          {tab === 'models' && <Models prefs={prefs} onPrefs={onPrefs} />}
          {tab === 'memory' && <Memories prefs={prefs} onPrefs={onPrefs} />}
          {tab === 'devices' && <Devices onLoggedOut={onLoggedOut} />}
          {tab === 'qr' && <QrTab />}
          {tab === 'data' && <DataTab />}
        </div>
      </div>
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
      {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`rounded-md px-3 py-1.5 ${value === v ? 'bg-white shadow dark:bg-zinc-700' : 'text-zinc-500'}`}>{l}</button>)}
    </div>
  )
}

function Appearance({ prefs, onPrefs }: { prefs: Preferences; onPrefs: (p: Partial<Preferences>) => void }) {
  return (
    <div className="space-y-5">
      <div><div className="mb-2 font-medium">Tema</div><Seg value={prefs.theme} onChange={(v) => onPrefs({ theme: v })} options={[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']]} /></div>
      <div><div className="mb-2 font-medium">Tamanho da fonte das mensagens</div><Seg value={prefs.font_size} onChange={(v) => onPrefs({ font_size: v })} options={[['sm', 'Pequena'], ['md', 'Média'], ['lg', 'Grande']]} /></div>
      <div>
        <div className="mb-2 font-medium">Idioma da IA e da voz</div>
        <select value={prefs.language} onChange={(e) => onPrefs({ language: e.target.value })} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
          <option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option>
        </select>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={prefs.auto_speak} onChange={(e) => onPrefs({ auto_speak: e.target.checked })} /> Ler respostas em voz alta automaticamente</label>
    </div>
  )
}

function Models({ prefs, onPrefs }: { prefs: Preferences; onPrefs: (p: Partial<Preferences>) => void }) {
  const [cat, setCat] = useState<CatalogProvider[] | null>(null)
  const [usage, setUsage] = useState<UsageRow[]>([])
  useEffect(() => { data('models.list').then((j) => { setCat(j.catalog); setUsage(j.usage) }).catch(() => setCat([])) }, [])
  const fmt = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="space-y-4">
      <p className="text-zinc-600 dark:text-zinc-400">Os provedores do modo Automático são <b>gratuitos</b>, mas com <b>limites</b> (por minuto/dia) definidos por cada provedor — nada aqui é ilimitado. Quando um modelo falha ou atinge o limite, o app troca sozinho para o próximo. O provedor <b>xAI Grok</b> é <b>opcional e pago</b> (só existe se o dono do app gravar uma chave com créditos).</p>
      {cat?.some((p) => p.paid && p.configured) && (
        <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <input data-testid="allow-paid-auto" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={prefs.allow_paid_auto} onChange={(e) => onPrefs({ allow_paid_auto: e.target.checked })} />
          <span><b>Permitir provedores com possível custo no Automático</b> (padrão: desligado). Se ligado, o Grok (xAI) é usado só <i>depois</i> que todos os gratuitos falharem e <b>pode gerar cobrança</b> na conta xAI do dono da chave. Há um teto diário de segurança. Escolher um modelo Grok manualmente também usa o provedor pago.</span>
        </label>
      )}
      <div>
        <div className="mb-1 font-medium">Modelo padrão</div>
        <select data-testid="default-model" value={prefs.default_model} onChange={(e) => onPrefs({ default_model: e.target.value })} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
          <option value="auto">Automático (recomendado)</option>
          {cat?.filter((p) => p.configured).map((p) => <optgroup key={p.provider} label={p.name}>{p.models.map((m) => <option key={m.id} value={`${m.provider}|${m.id}`}>{m.label}</option>)}</optgroup>)}
        </select>
      </div>
      {!cat && <p>Carregando…</p>}
      {cat?.map((p) => {
        const rows = usage.filter((u) => u.provider === p.provider)
        const req = rows.reduce((a, r) => a + r.requests, 0)
        const tok = rows.reduce((a, r) => a + Number(r.tokens_in) + Number(r.tokens_out), 0)
        const lim = rows.find((r) => r.limit_info)?.limit_info
        return (
          <div key={p.provider} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800" data-testid={`provider-${p.provider}`}>
            <div className="flex items-center justify-between">
              <b>{p.name}</b>
              <span className={`rounded px-2 py-0.5 text-xs ${p.configured ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-zinc-200 dark:bg-zinc-700'}`}>{p.configured ? (p.anonymous ? 'ativo (anônimo)' : 'ativo') : 'não configurado'}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{p.note}</p>
            {p.paid && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Opcional, requer chave com créditos; pode gerar cobrança na conta xAI do dono da chave.</p>}
            {!p.configured && p.keyUrl && <p className="mt-1 text-xs">O dono do app precisa cadastrar uma chave {p.paid ? '(com créditos)' : 'grátis'} em <a className="text-indigo-600 underline" href={p.keyUrl} target="_blank" rel="noopener noreferrer">{p.keyUrl}</a>.</p>}
            {p.configured && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {p.models.map((m) => <li key={m.id}>• {m.label}{m.unverified ? <span className="text-zinc-400"> (catálogo estático)</span> : null}{m.cooldownUntil ? <span className="text-amber-600"> — em pausa até {fmt(m.cooldownUntil)}</span> : null}</li>)}
              </ul>
            )}
            <p className="mt-2 text-xs text-zinc-500">Hoje (UTC, todos os usuários): {req} requisição(ões), ~{tok} tokens{rows.some((r) => r.rate_limited) ? `, ${rows.reduce((a, r) => a + r.rate_limited, 0)} limite(s) atingido(s)` : ''}.
              {lim?.['x-ratelimit-remaining-requests'] ? ` Restante informado pelo provedor: ${lim['x-ratelimit-remaining-requests']} req.` : ''}</p>
          </div>
        )
      })}
    </div>
  )
}

function Memories({ prefs, onPrefs }: { prefs: Preferences; onPrefs: (p: Partial<Preferences>) => void }) {
  const [list, setList] = useState<Memory[]>([])
  const [text, setText] = useState('')
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => data('mem.list').then((j) => setList(j.memories)).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-4">
      <p className="text-zinc-600 dark:text-zinc-400">Memórias são fatos que <b>você</b> pede para a IA lembrar (ex.: "prefiro respostas curtas"). São separadas do histórico e podem ser editadas ou apagadas.</p>
      <label className="flex items-center gap-2"><input data-testid="memory-toggle" type="checkbox" className="h-5 w-5" checked={prefs.memory_enabled} onChange={(e) => onPrefs({ memory_enabled: e.target.checked })} /> Usar memórias nas respostas da IA</label>
      <div className="flex gap-2">
        <input data-testid="memory-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Nova memória…" className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        <button data-testid="memory-add" className="rounded-lg bg-indigo-600 px-4 text-white disabled:opacity-50" disabled={!text.trim()} onClick={async () => { try { setErr(''); await data('mem.create', { content: text }); setText(''); load() } catch (e) { setErr((e as Error).message) } }}>Adicionar</button>
      </div>
      {err && <p className="text-red-600">{err}</p>}
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className="flex items-start gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            {edit?.id === m.id ? (
              <>
                <input value={edit.text} onChange={(e) => setEdit({ id: m.id, text: e.target.value })} maxLength={500} className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" />
                <button className="px-2" onClick={async () => { await data('mem.update', { id: m.id, content: edit.text }); setEdit(null); load() }}>💾</button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 break-words py-1">{m.content}</span>
                <button aria-label="Editar" className="px-2" onClick={() => setEdit({ id: m.id, text: m.content })}>✏️</button>
                <button aria-label="Excluir" className="px-2" onClick={async () => { await data('mem.delete', { id: m.id }); load() }}>🗑️</button>
              </>
            )}
          </li>
        ))}
        {!list.length && <li className="text-zinc-500">Nenhuma memória ainda.</li>}
      </ul>
    </div>
  )
}

function Devices({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [list, setList] = useState<DeviceSession[]>([])
  const load = useCallback(() => auth.listDevices().then(setList).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-3">
      <p className="text-zinc-600 dark:text-zinc-400">Dispositivos com sessão ativa neste código. Revogue os que você não reconhece.</p>
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="device">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{d.device_name}{d.current && <span className="ml-2 rounded bg-indigo-100 px-1.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">este dispositivo</span>}</div>
              <div className="text-xs text-zinc-500">Último uso: {new Date(d.last_seen_at).toLocaleString('pt-BR')} · {d.persistent ? 'conectado por 30 dias' : 'sessão curta'}</div>
            </div>
            <button className="rounded-lg border border-red-300 px-3 py-1.5 text-red-600" onClick={async () => { const r = await auth.revokeDevice(d.id); if (r.was_current) onLoggedOut(); else load() }}>Revogar</button>
          </li>
        ))}
      </ul>
      <button data-testid="logout-all" className="w-full rounded-lg bg-red-600 py-2.5 font-medium text-white" onClick={async () => { if (confirm('Sair de TODOS os dispositivos, inclusive este?')) { await auth.logoutAll(); onLoggedOut() } }}>Sair de todos os dispositivos</button>
    </div>
  )
}

function DataTab() {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 font-medium">Exportar meus dados</h3>
        <p className="mb-2 text-zinc-600 dark:text-zinc-400">Baixa um arquivo JSON com conversas, mensagens, memórias, preferências e dispositivos.</p>
        <button className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={async () => { const j = await data('export.all'); download(`chat-livre-ia-dados-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(j, null, 2), 'application/json') }}>⬇️ Exportar tudo (JSON)</button>
      </section>
      <section className="rounded-xl border border-zinc-300 p-3 dark:border-zinc-700" data-testid="private-note">
        <h3 className="mb-1 font-medium">App privado</h3>
        <p className="text-zinc-600 dark:text-zinc-400">Este app tem uma única conta (a sua). Ela não pode ser excluída pelo app, e não há criação de novas contas. Você pode apagar conversas e memórias individualmente. Se perder o código, só o dono do repositório consegue gerar um novo (sem perder o histórico).</p>
      </section>
    </div>
  )
}

function QrTab() {
  const [code, setCode] = useState('')
  const [ack, setAck] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setErr(''); setBusy(true)
    try {
      const c = normalizeCode(code)
      await auth.verifyCode(c) // o servidor confirma que é o código desta conta
      setShown(c); setCode('')
    } catch (e) { setErr((e as Error).message || 'Não foi possível confirmar o código.') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">⚠️ O QR code <b>equivale ao seu código de acesso</b>: quem o tiver entra na sua conta. Por segurança o app não guarda o seu código, então digite-o para gerar o QR.</p>
      {shown ? (
        <>
          <QrCard code={shown} />
          <button data-testid="qr-hide" onClick={() => { setShown(null); setAck(false) }} className="w-full rounded-lg border border-zinc-300 py-2.5 font-medium dark:border-zinc-700">Ocultar QR</button>
        </>
      ) : (
        <>
          <input data-testid="qr-code-input" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(formatCode(e.target.value.replace(/[^\d\s-]/g, '')))} maxLength={30} placeholder="Seu código de 19 dígitos"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-center font-mono text-lg tracking-wider dark:border-zinc-700 dark:bg-zinc-950" />
          <label className="flex items-start gap-2"><input data-testid="qr-ack" type="checkbox" className="mt-0.5 h-5 w-5" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Entendo que o QR code dá acesso total à minha conta a quem o tiver.</label>
          {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
          <button data-testid="qr-generate" disabled={busy || !ack || normalizeCode(code).length < 18} onClick={go} className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Confirmando…' : 'Mostrar meu QR code'}</button>
        </>
      )}
    </div>
  )
}
