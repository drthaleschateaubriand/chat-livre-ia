import { ApiError } from '../services/api'

export const OFFICIAL_URL = 'https://drthaleschateaubriand.github.io/chat-livre-ia/'

export type LoginErrorKind = 'invalid' | 'rate_limit' | 'network' | 'timeout' | 'server' | 'forbidden' | 'format' | 'other'

export interface LoginError { kind: LoginErrorKind; message: string }

function wait(sec?: number): string {
  const s = Math.max(1, Math.round(sec ?? 60))
  if (s < 90) return `${s} segundos`
  const m = Math.ceil(s / 60)
  return m >= 120 ? `${Math.ceil(m / 60)} horas` : `${m} minutos`
}

/** Traduz qualquer falha do login em uma mensagem que diz o MOTIVO real (código errado × limite × rede/CORS × servidor). */
export function describeLoginError(ex: unknown): LoginError {
  if (ex instanceof ApiError) {
    if (ex.status === 429) return { kind: 'rate_limit', message: `Muitas tentativas. Por segurança, o acesso foi pausado: aguarde ${wait(ex.retryAfter)} e tente de novo. (O código não foi julgado errado.)` }
    if (ex.status === 401) return { kind: 'invalid', message: 'Código não encontrado. Confira se digitou os 19 dígitos certos. Se você pediu um código novo (redefinição), o código antigo deixa de valer: use o mais recente.' }
    if (ex.status === 403) return { kind: 'forbidden', message: `O servidor recusou este endereço do app. Abra o app pelo endereço oficial: ${OFFICIAL_URL}` }
    if (ex.status === 400) return { kind: 'format', message: ex.message || 'Código em formato inválido.' }
    if (ex.status >= 500) return { kind: 'server', message: `O servidor está com problema agora (erro ${ex.status}). Seu código não foi recusado: tente de novo em instantes.` }
    return { kind: 'other', message: ex.message || `Falha ao entrar (erro ${ex.status}).` }
  }
  if (ex instanceof DOMException && (ex.name === 'TimeoutError' || ex.name === 'AbortError')) {
    return { kind: 'timeout', message: 'O servidor demorou demais para responder. Verifique a internet e tente de novo.' }
  }
  const msg = ex instanceof Error ? ex.message : String(ex ?? '')
  // fetch que não chegou ao servidor: Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError…" — também é o que aparece em bloqueio de CORS
  if (ex instanceof TypeError || /failed to fetch|load failed|network ?error|networkerror|fetch/i.test(msg)) {
    return { kind: 'network', message: `Não foi possível falar com o servidor (sem internet, bloqueio de rede/VPN/anúncios, ou o app foi aberto por um endereço não oficial). Verifique a conexão e use ${OFFICIAL_URL}` }
  }
  return { kind: 'other', message: msg || 'Falha ao entrar.' }
}
