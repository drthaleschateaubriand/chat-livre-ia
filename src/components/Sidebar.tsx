import { useEffect, useMemo, useState } from 'react'
import type { Conversation } from '../types'
import { data } from '../services/api'

interface SearchHit { conversation_id: string; title: string; snippet: string; updated_at: string; pinned: boolean }

function groupOf(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff <= 7) return 'Últimos 7 dias'
  if (diff <= 30) return 'Últimos 30 dias'
  return 'Mais antigas'
}

export function Sidebar(p: {
  conversations: Conversation[]
  activeId: string | null
  open: boolean
  onClose: () => void
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  onSettings: () => void
  onLogout: () => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return }
    const t = setTimeout(async () => {
      try { setHits((await data('conv.search', { q: q.trim() })).results) } catch { setHits([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const groups = useMemo(() => {
    const out: { name: string; items: Conversation[] }[] = []
    const pinned = p.conversations.filter((c) => c.pinned)
    if (pinned.length) out.push({ name: '📌 Fixadas', items: pinned })
    for (const c of p.conversations.filter((c) => !c.pinned)) {
      const g = groupOf(c.updated_at)
      let grp = out.find((x) => x.name === g)
      if (!grp) { grp = { name: g, items: [] }; out.push(grp) }
      grp.items.push(c)
    }
    return out
  }, [p.conversations])

  const item = (c: { id: string; title: string; pinned?: boolean }, snippet?: string) => (
    <div key={c.id} className={`group relative rounded-lg ${p.activeId === c.id ? 'bg-zinc-200 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}>
      {editing === c.id ? (
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
          onBlur={() => { if (title.trim() && title !== c.title) p.onRename(c.id, title.trim()); setEditing(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
          className="w-full rounded-lg border border-indigo-500 bg-white px-2 py-2 text-sm outline-none dark:bg-zinc-950" />
      ) : (
        <button data-testid="conv-item" onClick={() => { p.onSelect(c.id); p.onClose() }} className="block w-full truncate px-3 py-2.5 pr-9 text-left text-sm">
          {c.pinned && '📌 '}{c.title}
          {snippet && <span className="mt-0.5 block truncate text-xs text-zinc-500">…{snippet}…</span>}
        </button>
      )}
      {editing !== c.id && (
        <button aria-label="Mais ações" data-testid="conv-menu" onClick={() => setMenu(menu === c.id ? null : c.id)} className="absolute right-1 top-1.5 h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-300/60 dark:hover:bg-zinc-700">⋯</button>
      )}
      {menu === c.id && (
        <div className="absolute right-1 top-9 z-20 w-40 rounded-xl border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { setMenu(null); setTitle(c.title); setEditing(c.id) }}>✏️ Renomear</button>
          <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { setMenu(null); p.onPin(c.id, !c.pinned) }}>{c.pinned ? '📍 Desafixar' : '📌 Fixar'}</button>
          <button data-testid="conv-delete" className="w-full rounded-lg px-3 py-2 text-left text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { setMenu(null); if (confirm('Excluir esta conversa para sempre?')) p.onDelete(c.id) }}>🗑️ Excluir</button>
        </div>
      )}
    </div>
  )

  return (
    <>
      {p.open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={p.onClose} />}
      <aside data-testid="sidebar" className={`pt-safe pb-safe pl-safe fixed inset-y-0 left-0 z-40 flex w-[82vw] max-w-80 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:static md:z-0 md:w-72 md:max-w-none md:translate-x-0 ${p.open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="space-y-2 p-3">
          <button data-testid="new-chat" onClick={() => { p.onNew(); p.onClose() }} className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">＋ Nova conversa</button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar no histórico…" type="search" data-testid="search"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
        </div>
        <nav className="scroll-thin flex-1 space-y-3 overflow-y-auto px-2 pb-2" data-testid="conv-list">
          {hits ? (
            hits.length ? hits.map((h) => item({ id: h.conversation_id, title: h.title, pinned: h.pinned }, h.snippet)) : <p className="p-3 text-sm text-zinc-500">Nada encontrado.</p>
          ) : groups.length ? groups.map((g) => (
            <div key={g.name}>
              <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.name}</div>
              {g.items.map((c) => item(c))}
            </div>
          )) : <p className="p-3 text-sm text-zinc-500">Suas conversas aparecerão aqui.</p>}
        </nav>
        <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button data-testid="settings-btn" onClick={() => { p.onSettings(); p.onClose() }} className="rounded-lg border border-zinc-300 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">⚙️ Ajustes</button>
          <button data-testid="logout-btn" onClick={p.onLogout} className="rounded-lg border border-zinc-300 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Sair</button>
        </div>
      </aside>
    </>
  )
}
