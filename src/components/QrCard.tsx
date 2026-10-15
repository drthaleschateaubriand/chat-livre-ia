import { useEffect, useState } from 'react'
import { buildLoginUrl } from '../lib/qr'

/** Mostra o QR de login (equivale ao código!) com botão para salvar a imagem. */
export function QrCard({ code }: { code: string }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(buildLoginUrl(code), { errorCorrectionLevel: 'M', margin: 3, width: 512, color: { dark: '#000000', light: '#ffffff' } }),
    ).then((u) => { if (alive) setUrl(u) }).catch(() => { if (alive) setErr('Não foi possível gerar o QR code.') })
    return () => { alive = false }
  }, [code])
  return (
    <div data-testid="qr-card" className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      <div className="mb-2 font-semibold">QR code de acesso</div>
      {err && <p role="alert" className="text-red-600">{err}</p>}
      {url ? <img data-testid="qr-img" src={url} alt="QR code de login" className="mx-auto h-56 w-56 max-w-full rounded-lg bg-white p-1" /> : !err && <div className="mx-auto h-56 w-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />}
      {url && (
        <a data-testid="qr-download" href={url} download="chat-livre-ia-qr-de-acesso.png" className="mt-3 block rounded-lg border border-zinc-300 py-2.5 text-center font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">⬇️ Baixar imagem do QR</a>
      )}
      <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        ⚠️ <b>Este QR code equivale ao seu código.</b> Quem o tiver (foto, print, arquivo) acessa a sua conta. Guarde-o como guardaria o código e não o compartilhe. Para entrar: tela de login → “Entrar com QR code”, ou abra o QR com a câmera do celular.
      </p>
    </div>
  )
}
