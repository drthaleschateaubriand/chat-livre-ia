import { useEffect, useState } from 'react'
import { formatCode } from '../lib/code'
import { copyText } from '../lib/clipboard'
import { download } from '../lib/exporters'
import { QrCard } from './QrCard'

export function CodeReveal({ code, onConfirm }: { code: string; onConfirm: () => void }) {
  const [ack, setAck] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  return (
    <div className="h-screen-dvh pt-safe pb-safe flex items-center justify-center overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-indigo-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold">Seu código de acesso</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Guarde-o agora. <b>Esta é a única vez que ele aparece.</b></p>
        <div data-testid="code-reveal" className="my-4 select-all rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50 p-4 text-center font-mono text-xl font-bold tracking-widest text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">
          {formatCode(code)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={async () => { await copyText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="rounded-lg border border-zinc-300 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            {copied ? 'Copiado ✓' : '📋 Copiar'}
          </button>
          <button onClick={() => download('chat-livre-ia-codigo.txt', `CHAT LIVRE IA — meu código de acesso\n\n${formatCode(code)}\n\nGuarde este arquivo em local seguro. Não há recuperação do código.\n`)} className="rounded-lg border border-zinc-300 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            ⬇️ Baixar .txt
          </button>
        </div>
        <div className="mt-4"><QrCard code={code} /></div>
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ <b>Não há recuperação.</b> Quem tiver este código acessa sua conta; se você perdê-lo, perde o acesso às conversas. Não existe e-mail ou telefone para redefinir.
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input data-testid="ack" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5" />
          <span>Anotei meu código em um lugar seguro.</span>
        </label>
        <button data-testid="ack-continue" disabled={!ack} onClick={onConfirm} className="mt-4 w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40">
          Continuar para o chat
        </button>
      </div>
    </div>
  )
}
