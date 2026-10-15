import { useState } from 'react'
import type { Message } from '../types'
import { Markdown } from './Markdown'
import { copyText } from '../lib/clipboard'
import { speak, stopSpeaking, ttsSupported } from '../lib/speech'

const PROVIDER_NAMES: Record<string, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', pollinations: 'Pollinations', xai: 'Grok (xAI)' }

export function MessageItem({ m, isLast, busy, lang, onRegenerate, onContinue }: {
  m: Message; isLast: boolean; busy: boolean; lang: string; onRegenerate: () => void; onContinue: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  if (m.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="msg-user">
        <div className="msg-text max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white sm:max-w-[75%]">{m.content}</div>
      </div>
    )
  }
  return (
    <div className="group" data-testid="msg-assistant">
      <Markdown text={m.content} />
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <button className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={async () => { await copyText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          {copied ? 'Copiado ✓' : '📋 Copiar'}
        </button>
        {isLast && !busy && (
          <>
            <button data-testid="regenerate" className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onRegenerate}>🔄 Regenerar</button>
            <button data-testid="continue" className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onContinue}>➡️ Continuar</button>
          </>
        )}
        {ttsSupported() && (
          <button className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { if (speaking) { stopSpeaking(); setSpeaking(false) } else { speak(m.content, lang); setSpeaking(true) } }}>
            {speaking ? '⏹️ Parar' : '🔊 Ouvir'}
          </button>
        )}
        {m.model && (
          <span className="ml-auto text-[11px] opacity-70" title={`${m.provider}/${m.model}`} data-testid="msg-model">
            {PROVIDER_NAMES[m.provider ?? ''] ?? m.provider} · {m.model.split('/').pop()}{m.fallback_used ? ' · modelo alternativo' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
