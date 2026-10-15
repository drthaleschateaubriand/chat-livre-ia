import { post, tokensFromResponse } from './api'
import { clearSession, saveSession } from './session'
import type { DeviceSession } from '../types'

export async function login(code: string, persistent: boolean) {
  const j = await post('auth', 'login', { code, persistent }, false)
  saveSession(tokensFromResponse(j))
}

/** Confirma, no servidor, que o código digitado é o da conta desta sessão (mesmos limites do login). Não cria sessão. */
export async function verifyCode(code: string) {
  await post('auth', 'verify-code', { code })
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
