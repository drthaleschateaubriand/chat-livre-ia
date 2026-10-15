import { useEffect, useRef, useState } from 'react'
import { sttSupported, startListening } from '../lib/speech'

export function Composer({ busy, onSend, onStop, lang, autofocus }: { busy: boolean; onSend: (t: string) => void; onStop: () => void; lang: string; autofocus?: boolean }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const rec = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])

  useEffect(() => { if (autofocus && window.matchMedia('(min-width: 768px)').matches) ta.current?.focus() }, [autofocus])

  function submit() {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setText('')
  }

  return (
    <div className="pb-safe pl-safe pr-safe border-t border-zinc-200 bg-white/90 px-3 pt-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea ref={ta} data-testid="composer" rows={1} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) { e.preventDefault(); submit() } }}
          placeholder="Escreva sua mensagem…" enterKeyHint="send"
          className="max-h-48 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-zinc-400" />
        {sttSupported() && (
          <button type="button" aria-label="Ditar por voz" title="Ditar por voz" onClick={() => {
            if (listening) { rec.current?.stop(); return }
            setListening(true)
            const base = text ? text + ' ' : ''
            rec.current = startListening(lang, (t) => setText(base + t), () => setListening(false))
          }} className={`h-10 w-10 shrink-0 rounded-xl text-lg ${listening ? 'animate-pulse bg-red-100 dark:bg-red-950' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>🎤</button>
        )}
        {busy ? (
          <button type="button" onClick={onStop} data-testid="stop" aria-label="Parar" className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900">■</button>
        ) : (
          <button type="button" onClick={submit} disabled={!text.trim()} data-testid="send" aria-label="Enviar" className="h-10 w-10 shrink-0 rounded-xl bg-indigo-600 text-lg text-white transition hover:bg-indigo-700 disabled:opacity-40">↑</button>
        )}
      </div>
      <p className="mx-auto mt-1 max-w-3xl pb-1 text-center text-[11px] text-zinc-400">IAs gratuitas podem errar e têm limites de uso. Confira informações importantes.</p>
    </div>
  )
}
