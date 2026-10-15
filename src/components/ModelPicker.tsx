import { useEffect, useRef, useState } from 'react'
import type { CatalogProvider } from '../types'

export function modelLabel(catalog: CatalogProvider[] | null, value: string): string {
  if (value === 'auto' || !catalog) return 'Automático'
  const [p, ...rest] = value.split('|')
  const id = rest.join('|')
  const m = catalog.find((c) => c.provider === p)?.models.find((x) => x.id === id)
  return m ? m.label : id
}

export function ModelPicker({ value, catalog, onChange, onOpen }: { value: string; catalog: CatalogProvider[] | null; onChange: (v: string) => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open])

  const fmt = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="relative" ref={ref}>
      <button data-testid="model-picker" onClick={() => { if (!open) onOpen(); setOpen(!open) }}
        className="flex max-w-[11rem] items-center gap-1 truncate rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 sm:max-w-xs">
        <span className="truncate">{modelLabel(catalog, value)}</span> <span className="text-xs opacity-60">▾</span>
      </button>
      {open && (
        <div className="scroll-thin absolute left-0 z-30 mt-1 max-h-[70dvh] w-72 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <button onClick={() => { onChange('auto'); setOpen(false) }} className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${value === 'auto' ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
            <div className="font-medium">Automático ✨</div>
            <div className="text-xs text-zinc-500">Escolhe o melhor modelo disponível e troca sozinho se um falhar.</div>
          </button>
          {!catalog && <div className="p-3 text-sm text-zinc-500">Carregando modelos…</div>}
          {catalog?.map((p) => (
            <div key={p.provider} className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-800">
              <div className="flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <span>{p.name}</span>
                {!p.configured && <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] normal-case dark:bg-zinc-700">não configurado</span>}
                {p.configured && p.paid && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] normal-case text-amber-800 dark:bg-amber-950 dark:text-amber-200">pago</span>}
              </div>
              {p.paid && <div className="px-3 pb-1 text-[11px] text-amber-700 dark:text-amber-300">Opcional, requer chave com créditos; pode gerar cobrança na conta xAI do dono da chave.</div>}
              {p.models.map((m) => {
                const v = `${m.provider}|${m.id}`
                const disabled = !p.configured
                return (
                  <button key={v} disabled={disabled} onClick={() => { onChange(v); setOpen(false) }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 ${value === v ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
                    <span className="truncate">{m.label}</span>
                    {m.cooldownUntil && p.configured && <span className="ml-2 shrink-0 text-[10px] text-amber-600">pausa até {fmt(m.cooldownUntil)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
