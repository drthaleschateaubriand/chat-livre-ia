import { clearSession, loadSession, saveSession } from './session'
import type { SessionTokens } from '../types'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? ''
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? ''
export const FN = `${SUPABASE_URL}/functions/v1`

export class ApiError extends Error {
  status: number
  code: string
  retryAfter?: number
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

function baseHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (KEY) h.apikey = KEY
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function parse(res: Response) {
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* não-JSON */ }
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? `Erro ${res.status}`, json?.retry_after)
  }
  return json
}

export function tokensFromResponse(j: any): SessionTokens {
  return { access: j.access_token, refresh: j.refresh_token, accessExp: Date.now() + (j.access_expires_in ?? 900) * 1000, persistent: !!j.persistent }
}

let refreshing: Promise<SessionTokens | null> | null = null

/** Renova o token (single-flight; com Web Locks entre abas quando disponível). */
async function refresh(): Promise<SessionTokens | null> {
  if (refreshing) return refreshing
  const run = async (): Promise<SessionTokens | null> => {
    const before = loadSession()
    if (!before) return null
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = loadSession()
      if (!cur) return null
      // outra aba já renovou?
      if (cur.refresh !== before.refresh && cur.accessExp > Date.now() + 30_000) return cur
      const res = await fetch(`${FN}/auth/refresh`, { method: 'POST', headers: baseHeaders(), body: JSON.stringify({ refresh_token: cur.refresh }) })
      if (res.status === 409) { await new Promise((r) => setTimeout(r, 600)); continue }
      if (res.status === 401) { clearSession(); return null }
      if (!res.ok) throw new ApiError(res.status, 'refresh_failed', 'Não foi possível renovar a sessão.')
      const t = tokensFromResponse(await res.json())
      saveSession(t)
      return t
    }
    return loadSession()
  }
  refreshing = (async () => {
    try {
      const locks = (navigator as any).locks
      return locks ? await locks.request('cli-refresh', run) : await run()
    } finally { refreshing = null }
  })()
  return refreshing
}

export async function getAccessToken(): Promise<string> {
  let s = loadSession()
  if (!s) throw new ApiError(401, 'unauthorized', 'Sessão encerrada.')
  if (s.accessExp - Date.now() < 30_000) {
    s = await refresh()
    if (!s) throw new ApiError(401, 'unauthorized', 'Sessão encerrada.')
  }
  return s.access
}

async function authed(path: string, body: unknown, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken()
  const res = await fetch(`${FN}/${path}`, { method: 'POST', headers: baseHeaders(token), body: JSON.stringify(body), ...init })
  if (res.status === 401 && retry) {
    const j = await res.clone().json().catch(() => null)
    if (j?.error === 'token_expired') {
      const s = await refresh()
      if (s) return authed(path, body, init, false)
    }
    if (j?.error === 'unauthorized') clearSession()
  }
  return res
}

export async function post(fn: string, action: string, body: Record<string, unknown> = {}, auth = true) {
  if (!auth) {
    return parse(await fetch(`${FN}/${fn}/${action}`, { method: 'POST', headers: baseHeaders(), body: JSON.stringify(body) }))
  }
  return parse(await authed(fn === 'data' ? 'data' : `${fn}/${action}`, fn === 'data' ? { action, ...body } : body))
}

export const data = (action: string, body: Record<string, unknown> = {}) => post('data', action, body)

export interface StreamHandlers {
  onEvent: (event: string, data: any) => void
  signal?: AbortSignal
}

/** POST /chat/send com leitura de SSE. */
export async function streamChat(body: Record<string, unknown>, h: StreamHandlers): Promise<void> {
  const res = await authed('chat/send', body, { signal: h.signal })
  if (!res.ok || !res.body) await parse(res)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let ev = 'message'
      let d = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim()
        else if (line.startsWith('data:')) d += line.slice(5).trim()
      }
      if (d) { try { h.onEvent(ev, JSON.parse(d)) } catch { /* ignora bloco inválido */ } }
    }
  }
}
