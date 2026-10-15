// Extras de voz (Web Speech API), usados somente quando o navegador suporta.
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null }

export function sttSupported(): boolean {
  const w = window as any
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export function startListening(lang: string, onText: (t: string, final: boolean) => void, onEnd: () => void): { stop: () => void } {
  const w = window as any
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  const rec: Rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (e: any) => {
    let text = ''
    let final = false
    for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript; if (e.results[i].isFinal) final = true }
    onText(text, final)
  }
  rec.onend = onEnd
  rec.onerror = onEnd
  rec.start()
  return { stop: () => rec.stop() }
}

export function ttsSupported(): boolean {
  return 'speechSynthesis' in window
}

function plain(md: string): string {
  return md.replace(/```[\s\S]*?```/g, ' (bloco de código) ').replace(/[`*_#>|~-]+/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()
}

export function speak(text: string, lang: string) {
  if (!ttsSupported()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(plain(text))
  u.lang = lang
  speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel()
}
