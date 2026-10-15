import type { SessionTokens } from '../types'

const KEY = 'cli.session'
const listeners = new Set<() => void>()

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
  return read(localStorage) ?? read(sessionStorage)
}

export function saveSession(t: SessionTokens) {
  const keep = t.persistent ? localStorage : sessionStorage
  const other = t.persistent ? sessionStorage : localStorage
  other.removeItem(KEY)
  keep.setItem(KEY, JSON.stringify(t))
  listeners.forEach((l) => l())
}

export function clearSession() {
  localStorage.removeItem(KEY)
  sessionStorage.removeItem(KEY)
  listeners.forEach((l) => l())
}

export function onSessionChange(fn: () => void) {
  listeners.add(fn)
  const storage = (e: StorageEvent) => { if (e.key === KEY) fn() }
  window.addEventListener('storage', storage)
  return () => { listeners.delete(fn); window.removeEventListener('storage', storage) }
}
