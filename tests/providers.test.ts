import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderManager, cooldownFor, parseModelPref, type FailureInfo, type StateStore } from '../supabase/functions/_shared/providers/manager.ts'
import { buildProviders } from '../supabase/functions/_shared/providers/registry.ts'
import { parseDuration, parseRetryAfter } from '../supabase/functions/_shared/providers/openai_compat.ts'
import { ProviderError, type ChatMessage, type Provider, type StreamOptions, type StreamPart } from '../supabase/functions/_shared/providers/types.ts'

class MemStore implements StateStore {
  cd: Record<string, number> = {}
  ok: string[] = []
  fails: { key: string; f: FailureInfo }[] = []
  now = () => Date.now()
  async cooldowns() { return { ...this.cd } }
  async success(p: string, m: string) { this.ok.push(`${p}|${m}`) }
  async failure(p: string, m: string, f: FailureInfo) {
    const key = f.scope === 'provider' ? `${p}|*` : `${p}|${m}`
    this.cd[key] = this.now() + f.cooldownMs
    this.fails.push({ key, f })
  }
}

function fake(id: string, rank: number, behavior: (model: string) => Promise<StreamPart[]> | StreamPart[] | ProviderError, opts: { anonymous?: boolean } = {}): Provider {
  return {
    id, name: id, keyUrl: null, anonymous: !!opts.anonymous, note: '',
    configured: (k) => !!opts.anonymous || !!k,
    listModels: async () => [{ provider: id, id: `${id}-m`, label: id, rank }],
    async *stream(model: string, _m: ChatMessage[], _k: string | null, _o: StreamOptions) {
      const r = await behavior(model)
      if (r instanceof ProviderError) throw r
      for (const p of r) yield p
    },
  }
}
const msgs: ChatMessage[] = [{ role: 'user', content: 'oi' }]
const text = (t: string): StreamPart[] => [{ type: 'delta', text: t }, { type: 'usage', tin: 5, tout: 3 }]
async function collect(m: ProviderManager, pref: string | null = 'auto') {
  const ev = []
  for await (const e of m.run(msgs, pref)) ev.push(e)
  return ev
}

describe('ProviderManager', () => {
  it('escolhe o melhor modelo configurado (menor rank) e registra uso', async () => {
    const store = new MemStore()
    const m = new ProviderManager({ providers: [fake('b', 20, () => text('B')), fake('a', 10, () => text('A'))], getKey: async () => 'k', store })
    const ev = await collect(m)
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ provider: 'a', fallbackUsed: false })
    expect(store.ok).toEqual(['a|a-m'])
  })

  it('pula provedores sem chave ("não configurado") e usa o anônimo', async () => {
    const store = new MemStore()
    const m = new ProviderManager({
      providers: [fake('groq', 10, () => text('G')), fake('poll', 90, () => text('P'), { anonymous: true })],
      getKey: async () => null, store,
    })
    const ev = await collect(m)
    expect(ev.filter((e) => e.type === 'attempt')).toHaveLength(1)
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ provider: 'poll' })
  })

  it('FALLBACK: 429 no primeiro troca para o próximo e aplica cooldown (circuit breaker)', async () => {
    const store = new MemStore()
    const m = new ProviderManager({
      providers: [fake('a', 10, () => new ProviderError('rate_limit', 'HTTP 429', 429, 120)), fake('b', 20, () => text('B'))],
      getKey: async () => 'k', store,
    })
    const ev = await collect(m)
    expect(ev.map((e) => e.type)).toEqual(['attempt', 'fallback', 'attempt', 'delta', 'done'])
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ provider: 'b', fallbackUsed: true })
    expect(store.fails[0].f).toMatchObject({ kind: 'rate_limit', status: 429, cooldownMs: 120_000, explicit: true })
    // 2ª chamada: 'a' está em cooldown e NEM é tentado (sem repetir chamadas)
    const ev2 = await collect(m)
    expect(ev2.filter((e) => e.type === 'attempt')).toEqual([{ type: 'attempt', provider: 'b', model: 'b-m' }])
  })

  it('FALLBACK: 5xx, timeout e erro de rede também trocam de provedor', async () => {
    for (const kind of ['server', 'timeout', 'network'] as const) {
      const store = new MemStore()
      const m = new ProviderManager({ providers: [fake('a', 10, () => new ProviderError(kind, 'x', kind === 'server' ? 503 : null)), fake('b', 20, () => text('B'))], getKey: async () => 'k', store })
      const ev = await collect(m)
      expect(ev.find((e) => e.type === 'done'), kind).toMatchObject({ provider: 'b' })
    }
  })

  it('erro de autenticação põe o provedor INTEIRO em cooldown', async () => {
    const store = new MemStore()
    const m = new ProviderManager({ providers: [fake('a', 10, () => new ProviderError('auth', '401', 401)), fake('b', 20, () => text('B'))], getKey: async () => 'k', store })
    await collect(m)
    expect(Object.keys(store.cd)).toContain('a|*')
  })

  it('falha no meio da resposta: emite reset e continua no próximo, mantendo o contexto', async () => {
    const seen: ChatMessage[][] = []
    const a = fake('a', 10, () => [])
    a.stream = async function* (_m, messages) { seen.push(messages); yield { type: 'delta', text: 'parcial' } as StreamPart; throw new ProviderError('network', 'cortou') }
    const b = fake('b', 20, () => text('completo'))
    const orig = b.stream.bind(b)
    b.stream = (model, messages, k, o) => { seen.push(messages); return orig(model, messages, k, o) }
    const m = new ProviderManager({ providers: [a, b], getKey: async () => 'k', store: new MemStore() })
    const ev = await collect(m)
    expect(ev.map((e) => e.type)).toEqual(['attempt', 'delta', 'reset', 'fallback', 'attempt', 'delta', 'done'])
    expect(seen[1]).toEqual(msgs) // mesmo contexto
  })

  it('COTAS ESGOTADAS: todos falham => evento exhausted com retryAfter', async () => {
    const store = new MemStore()
    const m = new ProviderManager({
      providers: [fake('a', 10, () => new ProviderError('rate_limit', '429', 429, 300)), fake('b', 20, () => new ProviderError('rate_limit', '429', 429, 600))],
      getKey: async () => 'k', store,
    })
    const ev = await collect(m)
    const last = ev[ev.length - 1]
    expect(last.type).toBe('exhausted')
    if (last.type === 'exhausted') {
      expect(last.tried).toHaveLength(2)
      expect(last.retryAfterS).toBeGreaterThanOrEqual(299)
      expect(last.retryAfterS).toBeLessThanOrEqual(300)
    }
    // e na chamada seguinte nem tenta ninguém
    const ev2 = await collect(m)
    expect(ev2.map((e) => e.type)).toEqual(['exhausted'])
  })

  it('preferência manual vem primeiro; se falhar, cai para o automático', async () => {
    const store = new MemStore()
    const m = new ProviderManager({ providers: [fake('a', 10, () => text('A')), fake('b', 20, () => new ProviderError('server', '500', 500))], getKey: async () => 'k', store })
    const ev = await collect(m, 'b|b-m')
    expect(ev.filter((e) => e.type === 'attempt').map((e) => (e as { provider: string }).provider)).toEqual(['b', 'a'])
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ provider: 'a', fallbackUsed: true })
  })

  it('cooldown expira com o tempo', async () => {
    const store = new MemStore()
    let t = 1_000_000
    store.now = () => t
    const m = new ProviderManager({ providers: [fake('a', 10, () => new ProviderError('rate_limit', '429', 429, 60)), fake('b', 20, () => text('B'))], getKey: async () => 'k', store, now: () => t })
    await collect(m)
    t += 61_000
    const plan = await m.plan('auto')
    expect(plan.candidates.map((c) => c.p.id)).toEqual(['a', 'b'])
  })

  it('catálogo marca não configurados e em pausa', async () => {
    const store = new MemStore()
    store.cd['a|a-m'] = Date.now() + 60_000
    const m = new ProviderManager({ providers: [fake('a', 10, () => text('A')), fake('b', 20, () => text('B'))], getKey: async (id) => (id === 'a' ? 'k' : null), store })
    const cat = await m.catalog()
    expect(cat[0].models[0].available).toBe(false)
    expect(cat[0].models[0].cooldownUntil).not.toBeNull()
    expect(cat[1].configured).toBe(false)
  })
})

describe('helpers', () => {
  it('parseModelPref', () => {
    expect(parseModelPref('auto')).toBeNull()
    expect(parseModelPref('openrouter|google/gemma:free')).toEqual({ provider: 'openrouter', model: 'google/gemma:free' })
  })
  it('cooldownFor', () => {
    expect(cooldownFor(new ProviderError('rate_limit', '', 429, null))).toMatchObject({ explicit: false, scope: 'model' })
    expect(cooldownFor(new ProviderError('auth', '', 401)).scope).toBe('provider')
  })
  it('parseDuration / parseRetryAfter', () => {
    expect(parseDuration('6h12m3.5s')).toBe(6 * 3600 + 12 * 60 + 4)
    expect(parseDuration('7.66s')).toBe(8)
    expect(parseRetryAfter(new Headers({ 'retry-after': '17' }))).toBe(17)
    expect(parseRetryAfter(new Headers({ 'x-ratelimit-reset-requests': '2m59.5s' }))).toBe(180)
  })
})

// --- Provedor OpenAI-compatível real contra um servidor HTTP local (simula 429, SSE e 5xx) ---
describe('OpenAICompatProvider (HTTP local)', () => {
  let server: Server
  let base = ''
  const hits: Record<string, number> = {}
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits[req.url!] = (hits[req.url!] ?? 0) + 1
      if (req.url === '/limited') { res.writeHead(429, { 'retry-after': '42', 'x-ratelimit-remaining-requests': '0', 'content-type': 'application/json' }); res.end('{"error":{"message":"rate limit"}}'); return }
      if (req.url === '/boom') { res.writeHead(503); res.end('x'); return }
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-ratelimit-remaining-requests': '99' })
        res.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"reasoning":"pensando"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"Olá"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":", mundo"}}]}\n\n')
        res.write('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":4}}\n\n')
        res.end('data: [DONE]\n\n')
        return
      }
      if (req.url === '/slow') { setTimeout(() => res.end(), 5000); return }
      res.writeHead(404); res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.closeAllConnections?.(); server.close() })

  const mk = (path: string) => buildProviders(undefined, { groq: base + path }).find((p) => p.id === 'groq')!
  const run = async (p: Provider, timeout = 3000) => {
    const out: StreamPart[] = []
    for await (const x of p.stream('m', msgs, 'KEY', { firstByteTimeoutMs: timeout, idleTimeoutMs: timeout })) out.push(x)
    return out
  }

  it('lê SSE, ignora raciocínio, lê usage e cabeçalhos', async () => {
    const parts = await run(mk('/ok'))
    expect(parts.filter((x) => x.type === 'delta').map((x) => (x as { text: string }).text).join('')).toBe('Olá, mundo')
    expect(parts.find((x) => x.type === 'usage')).toMatchObject({ tin: 11, tout: 4 })
    expect(parts.find((x) => x.type === 'headers')).toMatchObject({ info: { 'x-ratelimit-remaining-requests': '99' } })
  })
  it('429 vira ProviderError rate_limit com retry-after', async () => {
    await expect(run(mk('/limited'))).rejects.toMatchObject({ kind: 'rate_limit', status: 429, retryAfterS: 42 })
  })
  it('503 vira server', async () => {
    await expect(run(mk('/boom'))).rejects.toMatchObject({ kind: 'server', status: 503 })
  })
  it('timeout de primeiro byte', async () => {
    await expect(run(mk('/slow'), 300)).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('INTEGRAÇÃO: manager com Groq real-HTTP em 429 cai para outro e não repete a chamada em cooldown', async () => {
    const store = new MemStore()
    const groq = mk('/limited')
    const gem = buildProviders(undefined, { gemini: base + '/ok' }).find((p) => p.id === 'gemini')!
    const m = new ProviderManager({ providers: [groq, gem], getKey: async () => 'KEY', store })
    hits['/limited'] = 0
    const ev1 = await collect(m)
    expect(ev1.find((e) => e.type === 'done')).toMatchObject({ provider: 'gemini', fallbackUsed: true })
    const ev2 = await collect(m)
    expect(ev2.find((e) => e.type === 'done')).toMatchObject({ provider: 'gemini' })
    // 1 única chamada ao provedor limitado (os outros modelos dele são pulados na mesma requisição)
    expect(hits['/limited']).toBe(1)
    const before = hits['/limited']
    await collect(m)
    expect(hits['/limited']).toBe(before)
  })
})
