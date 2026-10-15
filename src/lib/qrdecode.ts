// Decodificação de QR: BarcodeDetector nativo quando existir; senão jsQR (carregado sob demanda).
type Detector = { detect: (src: CanvasImageSource | ImageBitmap) => Promise<{ rawValue: string }[]> }

let detectorPromise: Promise<Detector | null> | null = null
export function getDetector(): Promise<Detector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
        if (!BD) return null
        const fmts = (await BD.getSupportedFormats?.()) ?? ['qr_code']
        if (!fmts.includes('qr_code')) return null
        return new BD({ formats: ['qr_code'] })
      } catch { return null }
    })()
  }
  return detectorPromise
}

export async function decodeImageData(img: ImageData): Promise<string | null> {
  const { default: jsQR } = await import('jsqr')
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return r?.data ?? null
}

/** Decodifica um canvas (quadro de vídeo ou imagem). */
export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const det = await getDetector()
  if (det) {
    try {
      const r = await det.detect(canvas)
      if (r[0]?.rawValue) return r[0].rawValue
    } catch { /* cai para o jsQR */ }
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
}

/** Decodifica um arquivo de imagem (QR salvo na galeria/prints). */
export async function decodeFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  try {
    // tenta em escala reduzida/ampliada para tolerar imagens enormes ou minúsculas
    for (const maxSide of [1600, 800, 400]) {
      const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s))
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height) // fundo branco para PNG com transparência
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      const t = await decodeCanvas(c)
      if (t) return t
    }
    return null
  } finally { bmp.close?.() }
}
