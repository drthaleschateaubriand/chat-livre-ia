import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { buildLoginUrl, parseLoginHash, parseQrPayload, takeLinkFromLocation, consumeLink } from '../src/lib/qr.ts'
import { generateCode, formatCode } from '../src/lib/code.ts'

const BASE = 'https://drthaleschateaubriand.github.io/chat-livre-ia/'
const CODE = '4829175036481927305'.slice(0, 19)

function render(text: string, scale = 8, margin = 4) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = q.modules.size
  const W = (n + margin * 2) * scale
  const data = new Uint8ClampedArray(W * W * 4).fill(255)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!q.modules.get(x, y)) continue
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + margin) * scale + dy) * W + (x + margin) * scale + dx) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
    }
  }
  return { data, W }
}

describe('link do QR de login', () => {
  it('usa o FRAGMENTO (#), nunca query string', () => {
    const u = buildLoginUrl(formatCode(CODE), BASE)
    expect(u).toBe(`${BASE}#/login?c=${CODE}`)
    expect(new URL(u).search).toBe('')
    expect(new URL(u).hash).toContain(CODE)
  })
  it('parse do link (e dos dígitos puros, com espaços/hífens)', () => {
    expect(parseQrPayload(buildLoginUrl(CODE, BASE))).toEqual({ ok: true, code: CODE })
    expect(parseQrPayload(`  ${BASE}#/login?c=${formatCode(CODE)} `)).toMatchObject({ ok: true, code: CODE })
    expect(parseQrPayload(CODE)).toEqual({ ok: true, code: CODE })
    expect(parseQrPayload(CODE.replace(/(\d{4})/g, '$1-'))).toMatchObject({ ok: true, code: CODE })
    expect(parseQrPayload('http://localhost:5173/#login?c=' + CODE)).toEqual({ ok: true, code: CODE })
  })
  it('rejeita QR que não é de login, código curto/previsível, query string e lixo', () => {
    for (const bad of ['', 'olá', 'https://example.com', 'https://example.com/#/outra?c=' + CODE, `${BASE}?c=${CODE}`, `${BASE}#/login?c=123`, `${BASE}#/login?c=0000000000000000000`, `${BASE}#/login`, `${BASE}#/login?c=${CODE}abcd`, '1'.repeat(700)]) {
      expect(parseQrPayload(bad).ok, bad.slice(0, 40)).toBe(false)
    }
  })
  it('parseLoginHash só reage a #/login?c=', () => {
    expect(parseLoginHash('#/c/abc')).toBeNull()
    expect(parseLoginHash('')).toBeNull()
    expect(parseLoginHash(`#/login?c=${CODE}`)).toEqual({ ok: true, code: CODE })
    expect(parseLoginHash('#/login?c=12')).toMatchObject({ ok: false })
    expect(parseLoginHash('#/login')).toBeNull() // sem ?c= não é link de código
  })
  it('takeLinkFromLocation LIMPA o fragmento da URL (history.replaceState) e entrega o código uma única vez', () => {
    const calls: unknown[][] = []
    ;(globalThis as any).location = { hash: `#/login?c=${CODE}`, pathname: '/chat-livre-ia/', search: '' }
    ;(globalThis as any).history = { replaceState: (...a: unknown[]) => calls.push(a) }
    expect(takeLinkFromLocation()).toEqual({ ok: true, code: CODE })
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toBe('/chat-livre-ia/') // sem fragmento
    expect(consumeLink()).toEqual({ ok: true, code: CODE })
    expect(consumeLink()).toBeNull() // já consumido
  })
})

describe('QR gerado de verdade é decodificável', () => {
  it('QR do link decodifica (jsQR) e o parse devolve o mesmo código; vários códigos aleatórios', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode()
      const url = buildLoginUrl(code, BASE)
      const { data, W } = render(url)
      const r = jsQR(data, W, W)
      expect(r?.data).toBe(url)
      expect(parseQrPayload(r!.data)).toEqual({ ok: true, code })
    }
  })
  it('tolera escala pequena (imagem reduzida)', () => {
    const url = buildLoginUrl(CODE, BASE)
    const { data, W } = render(url, 3, 3)
    expect(jsQR(data, W, W)?.data).toBe(url)
  })
})
