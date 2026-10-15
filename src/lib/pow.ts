/** Proof-of-work simples (SHA-256 com N bits zero) para dificultar criação automatizada de contas. */
export async function solvePow(challenge: string, bits: number, onProgress?: (n: number) => void): Promise<string> {
  const enc = new TextEncoder()
  for (let n = 0; ; n++) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${n}`)))
    let z = 0
    for (const b of h) {
      if (b === 0) { z += 8; continue }
      z += Math.clz32(b) - 24
      break
    }
    if (z >= bits) return String(n)
    if (n % 4000 === 0) {
      onProgress?.(n)
      await new Promise((r) => setTimeout(r, 0)) // deixa a UI respirar
    }
  }
}
