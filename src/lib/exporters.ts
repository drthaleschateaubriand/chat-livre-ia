import type { Conversation, Message } from '../types'

export function download(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safeName(s: string) {
  return s.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'conversa'
}

export function conversationToMarkdown(c: Conversation, msgs: Message[]): string {
  const lines = [`# ${c.title}`, '', `_Exportado do CHAT LIVRE IA em ${new Date().toLocaleString('pt-BR')}_`, '']
  for (const m of msgs) {
    const who = m.role === 'user' ? 'Você' : `IA${m.model ? ` (${m.provider}/${m.model})` : ''}`
    lines.push(`## ${who} — ${new Date(m.created_at).toLocaleString('pt-BR')}`, '', m.content, '')
  }
  return lines.join('\n')
}

export function conversationToText(c: Conversation, msgs: Message[]): string {
  const lines = [c.title, '='.repeat(Math.min(60, c.title.length)), '']
  for (const m of msgs) {
    const who = m.role === 'user' ? 'VOCÊ' : `IA${m.model ? ` [${m.provider}/${m.model}]` : ''}`
    lines.push(`[${new Date(m.created_at).toLocaleString('pt-BR')}] ${who}:`, m.content, '')
  }
  return lines.join('\n')
}
