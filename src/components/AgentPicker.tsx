import { useEffect, useRef, useState } from 'react'
import type { Agent } from '../types'

export function agentLabel(a: Agent | null | undefined): string {
  return a ? `${a.emoji ? a.emoji + ' ' : ''}${a.name}` : 'Sem agente'
}

/** Seletor de agente no cabeçalho: vale para a conversa aberta (trocar/remover) ou para a próxima conversa nova. */
export function AgentPicker({ agents, activeId, onChange, onManage, forNew }: {
  agents: Agent[]
  activeId: string | null
  onChange: (id: string | null) => void
  onManage: () => void
  forNew: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open])
  const cur = agents.find((a) => a.id === activeId) ?? null
  const pick = (id: string | null) => { onChange(id); setOpen(false) }

  return (
    <div className="relative" ref={ref}>
      <button data-testid="agent-picker" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
        title={cur ? `Agente ativo: ${cur.name}` : 'Escolher agente'}
        className={`flex max-w-[7rem] items-center gap-1 truncate rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 sm:max-w-[14rem] ${cur ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : ''}`}>
        <span className="truncate" data-testid="agent-active">{cur ? agentLabel(cur) : '🤖 Agente'}</span> <span className="text-xs opacity-60">▾</span>
      </button>
      {open && (
        <div role="listbox" data-testid="agent-menu" className="scroll-thin fixed left-2 right-2 top-14 z-30 max-h-[70dvh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-1 sm:w-80 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="px-3 pb-1 pt-1.5 text-xs text-zinc-500">{forNew ? 'Agente da próxima conversa' : 'Agente desta conversa'}</div>
          <button role="option" aria-selected={!cur} onClick={() => pick(null)} data-testid="agent-none" className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${!cur ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
            <div className="font-medium">Sem agente</div>
            <div className="text-xs text-zinc-500">Comportamento padrão do assistente.</div>
          </button>
          {agents.map((a) => (
            <button key={a.id} role="option" aria-selected={a.id === activeId} onClick={() => pick(a.id)} data-testid={`agent-opt-${a.id}`}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${a.id === activeId ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
              <div className="truncate font-medium">{agentLabel(a)}</div>
              {a.description && <div className="truncate text-xs text-zinc-500">{a.description}</div>}
            </button>
          ))}
          {agents.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">Você ainda não criou agentes.</div>}
          <button onClick={() => { setOpen(false); onManage() }} data-testid="agent-manage" className="mt-1 w-full rounded-lg border-t border-zinc-100 px-3 py-2 text-left text-sm text-indigo-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-indigo-300 dark:hover:bg-zinc-800">⚙️ Gerenciar agentes…</button>
        </div>
      )}
    </div>
  )
}
