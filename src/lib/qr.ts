// QR de login: o QR codifica um link com o código no FRAGMENTO (#...), que o navegador nunca envia ao servidor
// nem inclui em logs/Referer. O QR EQUIVALE AO CÓDIGO: quem o tiver acessa a conta.
import { normalizeCode, validateCode } from './code'

export type QrParse = { ok: true; code: string } | { ok: false; message: string }

/** URL base do app (origem + subcaminho), sempre terminando em "/". */
export function appBaseUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${location.origin}${base.endsWith('/') ? base : base + '/'}`
}

/** Link que o QR codifica: <app>/#/login?c=<19 dígitos>. */
export function buildLoginUrl(code: string, base: string = appBaseUrl()): string {
  return `${base}#/login?c=${normalizeCode(code)}`
}

function fromFragment(fragment: string): string | null {
  // fragment sem o '#': "/login?c=123" (também aceita "login?c=123")
  const m = /^\/?login\?(.*)$/i.exec(fragment)
  if (!m) return null
  return new URLSearchParams(m[1]).get('c')
}

/** Interpreta o conteúdo de um QR (link do app ou os próprios dígitos do código) e valida o código. */
export function parseQrPayload(text: string): QrParse {
  const t = String(text ?? '').trim()
  if (!t || t.length > 600) return { ok: false, message: 'QR code não reconhecido.' }
  let raw: string | null = null
  const hash = t.indexOf('#')
  if (hash >= 0) raw = fromFragment(t.slice(hash + 1))
  else if (/^[\d\s\-.\u00a0]+$/.test(t)) raw = t // QR com só os dígitos do código
  if (raw === null) return { ok: false, message: 'Este QR code não é um QR de login do CHAT LIVRE IA.' }
  const v = validateCode(raw)
  if (!v.ok) return { ok: false, message: 'O QR code não contém um código de acesso válido.' }
  return { ok: true, code: v.code }
}

/** Lê o código de um fragmento de URL (ex.: location.hash). Retorna null se não for um link de login. */
export function parseLoginHash(hash: string): QrParse | null {
  if (!/^#\/?login\?/i.test(hash)) return null
  const raw = fromFragment(hash.replace(/^#/, ''))
  if (raw === null) return { ok: false, message: 'Link de login inválido.' }
  const v = validateCode(raw)
  return v.ok ? { ok: true, code: v.code } : { ok: false, message: 'O link não contém um código de acesso válido.' }
}

let pendingLink: QrParse | null | undefined
/**
 * Chamada UMA vez na carga da página: se a URL tem #/login?c=..., guarda o resultado e LIMPA o fragmento
 * (history.replaceState) imediatamente, para que o código não permaneça na barra de endereço nem no histórico.
 */
export function takeLinkFromLocation(): QrParse | null {
  if (pendingLink !== undefined) return pendingLink
  pendingLink = parseLoginHash(location.hash)
  if (pendingLink !== null) history.replaceState(null, '', location.pathname + location.search)
  return pendingLink
}
/** Entrega o link capturado ao componente de login (uma única vez). */
export function consumeLink(): QrParse | null {
  const r = takeLinkFromLocation()
  pendingLink = null
  return r
}
