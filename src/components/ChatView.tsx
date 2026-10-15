import { useEffect, useRef } from 'react'
import type { Agent, CatalogProvider, Conversation, Message } from '../types'
import { MessageItem } from './MessageItem'
import { Markdown } from './Markdown'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { AgentPicker, agentLabel } from './AgentPicker'
import { conversationToMarkdown, conversationToText, download, safeName } from '../lib/exporters'

export interface StreamState {
  convId: string | null
  text: string
  phase: 'connecting' | 'streaming'
  notice: string
  continuing: boolean
}

export interface ChatError { message: string; retryAfter?: number; canRetry: boolean }

export function ChatView(p: {
  conversation: Conversation | null
  messages: Message[]
  loading: boolean
  stream: StreamState | null
  error: ChatError | null
  model: string
  catalog: CatalogProvider[] | null
  lang: string
  onModel: (v: string) => void
  onLoadCatalog: () => void
  onSend: (t: string) => void
  onStop: () => void
  onRegenerate: () => void
  onContinue: () => void
  onMenu: () => void
  agents: Agent[]
  agentId: string | null
  onAgent: (id: string | null) => void
  onManageAgents: () => void
}) {
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const h = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
    el.addEventListener('scroll', h, { passive: true })
    return () => el.removeEventListener('scroll', h)
  }, [])
  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [p.messages, p.stream?.text, p.error])
  useEffect(() => { stick.current = true; bottom.current?.scrollIntoView({ block: 'end' }) }, [p.conversation?.id])

  const busy = !!p.stream
  const empty = p.messages.length === 0 && !p.stream
  const lastAssistantIdx = (() => { for (let i = p.messages.length - 1; i >= 0; i--) if (p.messages[i].role === 'assistant') return i; return -1 })()

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="pt-safe pl-safe pr-safe flex items-center gap-1 border-b border-zinc-200 bg-white/90 px-2 py-1.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <button onClick={p.onMenu} aria-label="Abrir menu" data-testid="menu-btn" className="h-10 w-10 rounded-lg text-xl hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800">☰</button>
        <ModelPicker value={p.model} catalog={p.catalog} onChange={p.onModel} onOpen={p.onLoadCatalog} />
        <AgentPicker agents={p.agents} activeId={p.agentId} onChange={p.onAgent} onManage={p.onManageAgents} forNew={!p.conversation} />
        <div className="min-w-0 flex-1 truncate px-2 text-center text-sm text-zinc-500">{p.conversation?.title ?? ''}</div>
        {p.conversation && p.messages.length > 0 && (
          <details className="relative">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Exportar conversa">⤓</summary>
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => download(`${safeName(p.conversation!.title)}.md`, conversationToMarkdown(p.conversation!, p.messages), 'text/markdown')}>Exportar Markdown</button>
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => download(`${safeName(p.conversation!.title)}.txt`, conversationToText(p.conversation!, p.messages))}>Exportar TXT</button>
            </div>
          </details>
        )}
      </header>

      <div ref={box} className="scroll-thin pl-safe pr-safe flex-1 overflow-y-auto overscroll-contain" data-testid="scroll">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {empty && !p.loading && (
            <div className="mt-[12vh] text-center">
              <div className="text-4xl">💬</div>
              <h2 className="mt-3 text-2xl font-semibold">Como posso ajudar hoje?</h2>
              <p className="mt-2 text-sm text-zinc-500">Pergunte qualquer coisa. O modo Automático escolhe o melhor modelo gratuito disponível.</p>
              {p.agentId && <p data-testid="agent-banner" className="mt-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">Agente ativo: {agentLabel(p.agents.find((a) => a.id === p.agentId))}</p>}
            </div>
          )}
          {p.loading && <div className="text-center text-sm text-zinc-500">Carregando conversa…</div>}
          {p.messages.map((m, i) => (
            <MessageItem key={m.id} m={m} isLast={i === lastAssistantIdx && i === p.messages.length - 1} busy={busy} lang={p.lang} onRegenerate={p.onRegenerate} onContinue={p.onContinue} />
          ))}
          {p.stream && (
            <div data-testid="streaming">
              {p.stream.text ? <div className="caret"><Markdown text={p.stream.text} /></div> : (
                <div className="flex items-center gap-2 text-sm text-zinc-500"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />{p.stream.notice || 'Pensando…'}</div>
              )}
              {p.stream.text && p.stream.notice && <div className="mt-1 text-xs text-amber-600">{p.stream.notice}</div>}
            </div>
          )}
          {p.error && (
            <div role="alert" data-testid="chat-error" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <p>{p.error.message}</p>
              {p.error.canRetry && !busy && <button onClick={p.onRegenerate} className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700">Tentar novamente</button>}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <Composer busy={busy} onSend={p.onSend} onStop={p.onStop} lang={p.lang} autofocus />
    </div>
  )
}
