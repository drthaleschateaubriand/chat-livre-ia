import { useEffect, useRef, useState } from 'react'
import { parseQrPayload } from '../lib/qr'
import { decodeCanvas, decodeFile } from '../lib/qrdecode'

/** Leitor de QR de login: câmera (BarcodeDetector ou jsQR), imagem da galeria, ou voltar a digitar. */
export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('Abrindo a câmera…')
  const [camOk, setCamOk] = useState(false)
  const [fatal, setFatal] = useState('')
  const [info, setInfo] = useState('') // resultado da leitura de imagem (tem prioridade sobre o aviso da câmera)
  const done = useRef(false)

  const handleText = (t: string): boolean => {
    const p = parseQrPayload(t)
    if (p.ok) { if (!done.current) { done.current = true; onCode(p.code) } return true }
    setMsg(p.message); setInfo(p.message)
    return false
  }

  useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    let timer: number | undefined
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setFatal('Este navegador/conexão não permite usar a câmera. Escolha uma imagem do QR ou digite o código.'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (e) {
        const n = (e as DOMException)?.name
        setFatal(n === 'NotAllowedError' || n === 'SecurityError'
          ? 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador, escolha uma imagem do QR salva na galeria ou digite o código.'
          : n === 'NotFoundError' || n === 'OverconstrainedError'
            ? 'Nenhuma câmera encontrada. Escolha uma imagem do QR ou digite o código.'
            : 'Não foi possível abrir a câmera. Escolha uma imagem do QR ou digite o código.')
        return
      }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current!
      v.srcObject = stream
      await v.play().catch(() => {})
      setCamOk(true); setMsg('Aponte a câmera para o QR code de login.')
      const c = document.createElement('canvas')
      let busy = false
      timer = window.setInterval(async () => {
        if (busy || done.current || v.readyState < 2 || !v.videoWidth) return
        busy = true
        try {
          const s = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight))
          c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s)
          c.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0, c.width, c.height)
          const t = await decodeCanvas(c)
          if (t) handleText(t)
        } catch { /* quadro ruim: tenta o próximo */ }
        busy = false
      }, 250)
    })()
    return () => { stop = true; if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(f: File | undefined) {
    if (!f) return
    setMsg('Lendo a imagem…'); setInfo('Lendo a imagem…')
    try {
      const t = await decodeFile(f)
      if (!t) { const m = 'Não encontrei um QR code nesta imagem. Tente outra imagem, mais nítida e sem cortes.'; setMsg(m); setInfo(m) }
      else handleText(t)
    } catch { setMsg('Não consegui abrir esta imagem.'); setInfo('Não consegui abrir esta imagem.') }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="Ler QR code" data-testid="qr-scanner">
      <div className="pb-safe w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between"><b>Entrar com QR code</b><button onClick={onClose} aria-label="Fechar" className="h-9 w-9 rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button></div>
        {!fatal && <video ref={video} playsInline muted data-testid="qr-video" className={`aspect-square w-full rounded-xl bg-black object-cover ${camOk ? '' : 'opacity-40'}`} />}
        <p data-testid="qr-msg" role={fatal || info ? 'alert' : 'status'} className={`mt-2 rounded-md p-2 text-sm ${fatal || info ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-zinc-600 dark:text-zinc-300'}`}>{info || fatal || msg}</p>
        <input ref={file} data-testid="qr-file" type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <div className="mt-3 grid gap-2">
          <button onClick={() => file.current?.click()} className="rounded-lg border border-zinc-300 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">🖼️ Escolher imagem do QR (galeria)</button>
          <button onClick={onClose} data-testid="qr-type" className="rounded-lg border border-zinc-300 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">⌨️ Digitar o código</button>
        </div>
      </div>
    </div>
  )
}
