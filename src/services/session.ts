import type { SessionTokens } from '../types'

const KEY = 'cli.session'
const listeners = new Set<() => void>()
/** Último recurso quando o navegador bloqueia localStorage/sessionStorage (ex.: alguns modos privados): vale só nesta aba. */
let memory: SessionTokens | null = null

function read(store: Storage): SessionTokens | null {
  try {
    const raw = store.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionTokens) : null
  } catch {
    return null
  }
}

/** Sessão persistente fica em localStorage ("manter conectado"); sessão curta em sessionStorage. */
export function loadSession(): SessionTokens | null {
  let ls: SessionTokens | null = null
  let ss: SessionTokens | null = null
  try { ls = read(localStorage) } catch { /* bloqueado */ }
  try { ss = read(sessionStorage) } catch { /* bloqueado */ }
  return ls ?? ss ?? memory
}

export function saveSession(t: SessionTokens) {
  const raw = JSON.stringify(t)
  const order = t.persistent ? ['local', 'session'] : ['session', 'local']
  let saved = false
  for (const which of order) {
    try {
      const st = which === 'local' ? localStorage : sessionStorage
      const other = which === 'local' ? sessionStorage : localStorage
      st.setItem(KEY, raw)
      try { other.removeItem(KEY) } catch { /* ignora */ }
      saved = true
      break
    } catch { /* cota/bloqueio: tenta o próximo armazenamento */ }
  }
  memory = saved ? null : t // sem armazenamento: mantém só em memória (a sessão some ao fechar a aba)
  listeners.forEach((l) => l())
}

export function clearSession() {
  memory = null
  try { localStorage.removeItem(KEY) } catch { /* ignora */ }
  try { sessionStorage.removeItem(KEY) } catch { /* ignora */ }
  listeners.forEach((l) => l())
}

export function onSessionChange(fn: () => void) {
  listeners.add(fn)
  const storage = (e: StorageEvent) => { if (e.key === KEY) fn() }
  window.addEventListener('storage', storage)
  return () => { listeners.delete(fn); window.removeEventListener('storage', storage) }
}
