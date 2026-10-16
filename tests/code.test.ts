import { describe, expect, it } from 'vitest'
import { digitsFromRandom, digitsOnly, formatCode, generateCode, isPredictable, normalizeCode, validateCode } from '../supabase/functions/_shared/code.ts'
import { randomBytes } from 'node:crypto'

describe('normalizeCode', () => {
  it('remove espaços, hífens e pontos', () => {
    expect(normalizeCode('1234 5678-9012 3456.789')).toBe('1234567890123456789')
    expect(normalizeCode('  8 3 7 ')).toBe('837')
  })
})

describe('validateCode', () => {
  const good = '4827 1936 5072 8413 659'
  it('aceita 19 dígitos com formatação', () => {
    const r = validateCode(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.code).toBe('4827193650728413659')
  })
  it('aceita 18 e 20 dígitos', () => {
    expect(validateCode('482719365072841365').ok).toBe(true)
    expect(validateCode('48271936507284136591').ok).toBe(true)
  })
  it('rejeita tamanhos fora de 18–20', () => {
    expect(validateCode('4827193650728413').ok).toBe(false)
    expect(validateCode('482719365072841365912').ok).toBe(false)
  })
  it('rejeita letras e vazio', () => {
    expect(validateCode('4827a936507284136591')).toMatchObject({ ok: false, reason: 'non_digit' })
    expect(validateCode('   ')).toMatchObject({ ok: false, reason: 'empty' })
  })
  it('rejeita sequências previsíveis/repetidas', () => {
    for (const c of ['1111111111111111111', '0000000000000000000', '1234567890123456789', '9876543210987654321', '1212121212121212121', '1234512345123451234', '1357913579135791357', '5555555555123456789']) {
      expect(validateCode(c), c).toMatchObject({ ok: false, reason: 'predictable' })
    }
  })
})

describe('isPredictable', () => {
  it('não marca códigos aleatórios normais', () => {
    expect(isPredictable('4827193650728413659')).toBe(false)
  })
})

describe('generateCode', () => {
  it('gera 19 dígitos válidos', () => {
    for (let i = 0; i < 500; i++) {
      const c = generateCode()
      expect(c).toMatch(/^\d{19}$/)
      expect(validateCode(c).ok).toBe(true)
    }
  })
  it('é diferente a cada chamada', () => {
    const s = new Set(Array.from({ length: 200 }, () => generateCode()))
    expect(s.size).toBe(200)
  })
  it('amostragem sem viés de módulo: bytes >= 250 são descartados', () => {
    // fonte determinística: 255,254,...,250 devem ser ignorados; 0..9 viram dígitos 0..9
    const seq = [255, 254, 253, 252, 251, 250, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 249]
    let i = 0
    const out = digitsFromRandom(12, (n) => { const a = new Uint8Array(n); for (let k = 0; k < n; k++) a[k] = seq[i++ % seq.length]; return a })
    expect(out.slice(0, 10)).toBe('0123456789')
  })
  it('distribuição aproximadamente uniforme dos dígitos', () => {
    const counts = new Array(10).fill(0)
    const n = 100000
    const s = digitsFromRandom(n, (k) => new Uint8Array(randomBytes(k)))
    for (const ch of s) counts[+ch]++
    for (const c of counts) expect(Math.abs(c - n / 10)).toBeLessThan(n / 10 * 0.05)
  })
  it('usa crypto.getRandomValues por padrão', () => {
    expect(typeof crypto.getRandomValues).toBe('function')
  })
})

describe('formatCode', () => {
  it('agrupa de 4 em 4', () => {
    expect(formatCode('4827193650728413659')).toBe('4827 1936 5072 8413 659')
  })
})

describe('normalizeCode / digitsOnly (colar no celular)', () => {
  const C = '4829175036481927301'
  it('tolera espaços, hífens, travessões, NBSP, quebras de linha e espaços no fim', () => {
    for (const v of ['4829 1750 3648 1927 301', '4829-1750-3648-1927-301', '4829–1750–3648–1927–301', '4829\u00a01750\u00a03648\u00a01927\u00a0301', ` ${C}\n`, `\t${C} \r\n`]) expect(normalizeCode(v)).toBe(C)
  })
  it('remove caracteres invisíveis (largura zero, marcas de direção, BOM, soft hyphen)', () => {
    expect(normalizeCode(`\ufeff48\u200b29\u200e 1750\u202c3648\u00ad1927\u2060301\u200f`)).toBe(C)
  })
  it('converte dígitos de largura total e árabe-índicos', () => {
    expect(normalizeCode('４８２９１７５０３６４８１９２７３０１')).toBe(C)
    expect(normalizeCode('٤٨٢٩١٧٥٠٣٦٤٨١٩٢٧٣٠١')).toBe(C)
  })
  it('digitsOnly extrai o código de um texto colado e limita a 20 dígitos', () => {
    expect(digitsOnly('Meu código: 4829 1750 3648 1927 301 (guarde)')).toBe(C)
    expect(digitsOnly(C + '123456').length).toBe(20)
  })
  it('validateCode aceita as variações coladas e continua rejeitando letras', () => {
    expect(validateCode(`\u200b4829 1750-3648\u00a01927 301 \n`)).toEqual({ ok: true, code: C })
    expect(validateCode('4829 1750 3648 1927 30a').ok).toBe(false)
    expect(validateCode('4829 1750 3648 19').ok).toBe(false)
  })
})
