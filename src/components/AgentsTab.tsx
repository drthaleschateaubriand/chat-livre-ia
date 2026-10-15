import { useEffect, useState } from 'react'
import type { Agent, CatalogProvider } from '../types'
import { ApiError, data } from '../services/api'
import { AGENT_LIMITS, EXAMPLE_AGENTS, draftOf, validateDraft, type AgentDraft } from '../lib/agents'

function Counter({ n, max }: { n: number; max: number }) {
  return <span data-testid="char-count" className={`text-xs tabular-nums ${n > max ? 'font-semibold text-red-600' : n > max * 0.9 ? 'text-amber-600' : 'text-zinc-500'}`}>{n}/{max}</span>
}

export function AgentsTab({ agents, onAgents, onChanged }: {
  agents: Agent[]
  onAgents: (list: Agent[]) => void
  /** conversas podem ter mudado (ex.: agente excluído) */
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(draftOf(null))
  const [errors, setErrors] = useState<Partial<Record<keyof AgentDraft, string>>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [cat, setCat] = useState<CatalogProvider[] | null>(null)
  useEffect(() => { data('models.list').then((j) => setCat(j.catalog)).catch(() => setCat([])) }, [])

  const reload = async () => { const j = await data('agent.list'); onAgents(j.agents) }
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível concluir. Verifique a conexão.')

  const start = (a?: Agent) => { setEditing(a ? a.id : 'new'); setDraft(draftOf(a)); setErrors({}); setMsg('') }
  const cancel = () => { setEditing(null); setErrors({}); setMsg('') }
  const patch = (p: Partial<AgentDraft>) => { setDraft((d) => ({ ...d, ...p })); setErrors({}) }

  const save = async () => {
    const e = validateDraft(draft)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true); setMsg('')
    try {
      const body = { ...draft, name: draft.name.trim(), emoji: draft.emoji.trim() || null }
      if (editing === 'new') await data('agent.create', body)
      else await data('agent.update', { ...body, id: editing })
      await reload(); onChanged(); setEditing(null)
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const duplicate = async (a: Agent) => { setBusy(true); setMsg(''); try { await data('agent.duplicate', { id: a.id }); await reload() } catch (e) { fail(e) } finally { setBusy(false) } }
  const remove = async (a: Agent) => { setBusy(true); setMsg(''); try { await data('agent.delete', { id: a.id }); setConfirmDel(null); await reload(); onChanged() } catch (e) { fail(e) } finally { setBusy(false) } }
  const addExamples = async () => {
    setBusy(true); setMsg('')
    try {
      const have = new Set(agents.map((a) => a.name.toLowerCase()))
      let n = 0
      for (const ex of EXAMPLE_AGENTS) {
        if (have.has(ex.name.toLowerCase())) continue
        await data('agent.create', { ...ex }); n++
      }
      await reload()
      setMsg(n ? `${n} exemplo${n > 1 ? 's' : ''} adicionado${n > 1 ? 's' : ''}.` : 'Os exemplos já estão na sua lista.')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const modelOptions = (cat ?? []).filter((p) => p.configured).flatMap((p) => p.models.map((m) => ({ v: `${m.provider}|${m.id}`, l: `${p.name.replace(/ \(.*$/, '')} · ${m.label}${p.paid ? ' (pago)' : ''}` })))
  if (draft.preferred_model !== 'auto' && !modelOptions.some((o) => o.v === draft.preferred_model)) modelOptions.push({ v: draft.preferred_model, l: draft.preferred_model })

  if (editing) {
    const nI = draft.instructions.length
    const field = 'w-full rounded-lg border bg-white px-3 py-2 dark:bg-zinc-950'
    const border = (k: keyof AgentDraft) => (errors[k] ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700')
    return (
      <div className="space-y-3" data-testid="agent-form">
        <h3 className="text-base font-semibold">{editing === 'new' ? 'Novo agente' : 'Editar agente'}</h3>
        <div className="grid grid-cols-[4.5rem_1fr] gap-2">
          <label className="block"><span className="mb-1 block font-medium">Ícone</span>
            <input data-testid="agent-emoji" value={draft.emoji} onChange={(e) => patch({ emoji: e.target.value })} maxLength={AGENT_LIMITS.emoji} placeholder="🤖" aria-label="Emoji ou ícone" className={`${field} ${border('emoji')} text-center text-lg`} />
          </label>
          <label className="block"><span className="mb-1 flex justify-between font-medium">Nome <Counter n={draft.name.length} max={AGENT_LIMITS.name} /></span>
            <input data-testid="agent-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Ex.: Tradutor PT-EN" aria-invalid={!!errors.name} className={`${field} ${border('name')}`} />
          </label>
        </div>
        {(errors.name || errors.emoji) && <p role="alert" className="text-xs text-red-600">{errors.name ?? errors.emoji}</p>}
        <label className="block"><span className="mb-1 flex justify-between font-medium">Descrição curta <Counter n={draft.description.length} max={AGENT_LIMITS.description} /></span>
          <input data-testid="agent-desc" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Opcional" className={`${field} ${border('description')}`} />
        </label>
        {errors.description && <p role="alert" className="text-xs text-red-600">{errors.description}</p>}
        <label className="block"><span className="mb-1 flex justify-between font-medium">Instruções <Counter n={nI} max={AGENT_LIMITS.instructions} /></span>
          <textarea data-testid="agent-instructions" value={draft.instructions} onChange={(e) => patch({ instructions: e.target.value })} rows={9} aria-invalid={!!errors.instructions}
            placeholder="Como a IA deve se comportar nas conversas com este agente (papel, tom, formato…)." className={`${field} ${border('instructions')} text-base sm:text-sm`} />
        </label>
        {errors.instructions && <p role="alert" data-testid="agent-error" className="text-xs text-red-600">{errors.instructions}</p>}
        <label className="block"><span className="mb-1 block font-medium">Modelo preferido <span className="font-normal text-zinc-500">(só vale com a conversa em Automático)</span></span>
          <select data-testid="agent-model" value={draft.preferred_model} onChange={(e) => patch({ preferred_model: e.target.value })} className={`${field} ${border('preferred_model')}`}>
            <option value="auto">Automático ✨</option>
            {modelOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-zinc-500">Modelos pagos continuam exigindo a permissão em Ajustes → Modelos; o agente não a contorna.</span>
        </label>
        <p className="text-xs text-zinc-500">As instruções são só texto do prompt: não mudam limites nem regras de segurança do servidor.</p>
        {msg && <p role="alert" className="text-xs text-red-600">{msg}</p>}
        <div className="flex gap-2">
          <button data-testid="agent-save" disabled={busy} onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
          <button onClick={cancel} disabled={busy} className="rounded-lg px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="agents-tab">
      <p className="text-zinc-600 dark:text-zinc-400">Agentes são <b>personas com instruções salvas</b>: a IA passa a se comportar sempre do mesmo jeito nas conversas que usam o agente. Escolha o agente ao começar uma conversa (ou troque/remova depois) pelo botão no cabeçalho.</p>
      <div className="flex flex-wrap gap-2">
        <button data-testid="agent-new" onClick={() => start()} disabled={agents.length >= AGENT_LIMITS.perUser} className="rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">+ Novo agente</button>
        <button data-testid="agent-examples" onClick={addExamples} disabled={busy || agents.length >= AGENT_LIMITS.perUser} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Adicionar exemplos</button>
      </div>
      {msg && <p role="status" data-testid="agent-msg" className="text-xs text-zinc-600 dark:text-zinc-400">{msg}</p>}
      {agents.length === 0 && <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-zinc-500 dark:border-zinc-700">Nenhum agente ainda. Crie o seu ou adicione 3 exemplos (Tradutor PT-EN, Revisor de texto e Explicador simples).</p>}
      <ul className="space-y-2">
        {agents.map((a) => (
          <li key={a.id} data-testid={`agent-item-${a.id}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start gap-2">
              <div className="text-2xl leading-none">{a.emoji ?? '🤖'}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" data-testid="agent-item-name">{a.name}</div>
                {a.description && <div className="text-xs text-zinc-500">{a.description}</div>}
                <div className="mt-0.5 text-[11px] text-zinc-400">{a.instructions.length} caracteres de instruções · modelo: {a.preferred_model === 'auto' ? 'Automático' : a.preferred_model.replace('|', ' · ')}</div>
              </div>
            </div>
            {confirmDel === a.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span>Excluir “{a.name}”? As conversas ficam, só deixam de ter agente.</span>
                <button data-testid="agent-del-confirm" disabled={busy} onClick={() => remove(a)} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">Excluir</button>
                <button onClick={() => setConfirmDel(null)} className="rounded-lg px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <button data-testid="agent-edit" onClick={() => start(a)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Editar</button>
                <button data-testid="agent-dup" disabled={busy || agents.length >= AGENT_LIMITS.perUser} onClick={() => duplicate(a)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Duplicar</button>
                <button data-testid="agent-del" onClick={() => setConfirmDel(a.id)} className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">Excluir</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">{agents.length}/{AGENT_LIMITS.perUser} agentes. Os agentes entram na exportação dos seus dados.</p>
    </div>
  )
}
