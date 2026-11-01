import type { EngineInterface } from 'claude-code'

const RE_URL = /https?:\/\/[^\s"'`<>()[\]{}|\\^]+/gi
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const MAX_URL = 3

/** Gli URL nell'output di un comando, senza quelli già scritti nel comando (un curl non ha niente di nuovo da aprire). */
export function urlNelTesto(testo: string, comando = ''): string[] {
  const visti = new Set<string>()
  for (const [grezzo] of testo.replace(ANSI, '').matchAll(RE_URL)) {
    const url = grezzo.replace(/[.,;:!?'"]+$/, '')
    if (!comando.includes(url)) visti.add(url)
    if (visti.size === MAX_URL) break
  }
  return [...visti]
}

export function etichettaUrl(url: string): string {
  const parti = url.match(/^https?:\/\/([^/?#]+)([^?#]*)/i)
  if (!parti) return url
  const [, host, percorso = ''] = parti
  const pr = percorso.match(/\/(?:pull|merge_requests)\/(\d+)/)
  if (pr) return `PR #${pr[1]}`
  if (/\/pull\/new\//.test(percorso)) return 'nuova PR'
  const testo = `${host}${percorso === '/' ? '' : percorso}`
  return testo.length > 50 ? `${testo.slice(0, 49)}…` : testo
}

export async function apriUrl($: EngineInterface, url: string) {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  let argv: string[]
  if (windows) argv = ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
  else argv = [(await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', url]
  const esito = await $.process.run(argv).catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${url}: ${esito.message}`)
}
