import { post, tokensFromResponse } from './api'
import { clearSession, saveSession } from './session'
import { solvePow } from '../lib/pow'
import type { DeviceSession } from '../types'

export async function login(code: string, persistent: boolean) {
  const j = await post('auth', 'login', { code, persistent }, false)
  saveSession(tokensFromResponse(j))
}

/** Cria a conta. Retorna o código (mostrado UMA vez) e os tokens, que só são salvos após a confirmação do usuário. */
export async function register(persistent: boolean, onProgress?: (n: number) => void) {
  const ch = await post('auth', 'challenge', {}, false)
  const nonce = await solvePow(ch.challenge, ch.bits, onProgress)
  const j = await post('auth', 'register', { pow_challenge: ch.challenge, pow_nonce: nonce, website: '', persistent }, false)
  return { code: j.code as string, tokens: tokensFromResponse(j) }
}

export async function logout() {
  try { await post('auth', 'logout') } catch { /* mesmo offline, limpa localmente */ }
  clearSession()
}

export async function logoutAll() {
  await post('auth', 'logout-all')
  clearSession()
}

export async function listDevices(): Promise<DeviceSession[]> {
  return (await post('auth', 'sessions')).sessions
}

export async function revokeDevice(id: string) {
  return post('auth', 'revoke-session', { id })
}
