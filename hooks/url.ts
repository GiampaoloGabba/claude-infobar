import type { EngineInterface } from 'claude-code'

const RE_URL = /https?:\/\/[^\s"'`<>()[\]{}|\\^]+/gi
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const MAX_URL = 3

// Programmi che stampano il contenuto di file: gli URL del loro output sono scritti nei file (codice, test,
// log), non indirizzi che il comando ha appena creato.
const LETTORI = new Set([
  'cat', 'head', 'tail', 'sed', 'awk', 'grep', 'egrep', 'fgrep', 'rg', 'less', 'more', 'type', 'jq', 'find', 'ls',
  'diff', 'get-content', 'gc', 'select-string', 'sls', 'get-childitem', 'gci', 'dir',
])
const GIT_LETTORI = new Set(['diff', 'log', 'show', 'blame', 'grep', 'cat-file'])

// URL che sono nomi, non pagine: schemi e namespace dentro JSON, XML e SVG, licenze nelle intestazioni, segnaposto
// degli esempi. Escono da qualunque comando che stampi dati (sqlite3, node -e, un'API) e non c'è niente da aprire.
const IDENTIFICATORI =
  /^https?:\/\/(?:[^/?#]*\.)?(?:json-schema\.org|json\.schemastore\.org|w3\.org|schema\.org|purl\.org|xmlns\.com|ns\.adobe\.com|schemas\.(?:microsoft|openxmlformats|android|xmlsoap)\.(?:com|org)|opensource\.org|apache\.org\/licenses|gnu\.org\/licenses|creativecommons\.org\/licenses|example\.(?:com|org|net))(?:[/?#:]|$)|\.(?:xsd|dtd)(?:[?#]|$)/i

/** Se il comando stampa il contenuto di file: basta un pezzo (tra ; && ||) che cominci con uno di quei programmi. */
export function stampaFile(comando: string): boolean {
  return comando.split(/;|&&|\|\||\r?\n/).some(pezzo => {
    // Del pezzo conta il primo programma: in `git push | tail -2` l'output è quello di git.
    const [programma = '', sotto = ''] = pezzo.split('|')[0]!.trim().split(/\s+/)
    const nome = programma.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
    return LETTORI.has(nome) || (nome === 'git' && GIT_LETTORI.has(sotto))
  })
}

/**
 * Gli URL nell'output di un comando, senza quelli già scritti nel comando (un curl non ha niente di nuovo da aprire),
 * senza il suggerimento di aprire una PR che git stampa a ogni push e niente del tutto per i comandi che stampano file.
 */
export function urlNelTesto(testo: string, comando = ''): string[] {
  if (stampaFile(comando)) return []
  const visti = new Set<string>()
  for (const [grezzo] of testo.replace(ANSI, '').matchAll(RE_URL)) {
    const url = grezzo.replace(/[.,;:!?'"]+$/, '')
    if (!comando.includes(url) && !/\/pull\/new\//.test(url) && !IDENTIFICATORI.test(url)) visti.add(url)
    if (visti.size === MAX_URL) break
  }
  return [...visti]
}

function chiave(url: string): { host: string; percorso: string } | null {
  const parti = url.match(/^https?:\/\/([^/?#]+)([^?#]*)/i)
  if (!parti) return null
  return { host: parti[1]!.toLowerCase(), percorso: parti[2]!.replace(/\.git$/i, '').replace(/\/+$/, '') }
}

/**
 * Gli URL da mostrare insieme, senza doppioni (`/` finale e `.git` non contano) e senza quelli che sono solo un
 * pezzo di percorso di un altro (il profilo `github.com/o` accanto al repository `github.com/o/r`). La radice di
 * un host resta: `localhost:5173` accanto a `localhost:5173/admin` è la pagina del server, non un di più.
 */
export function urlDaTenere(urls: readonly string[]): string[] {
  const chiavi = urls.map(chiave)
  return urls.filter((_, i) => {
    const k = chiavi[i]
    if (!k) return true
    return !chiavi.some((altra, j) => {
      if (!altra || j === i || altra.host !== k.host) return false
      if (altra.percorso === k.percorso) return j < i
      return k.percorso !== '' && altra.percorso.startsWith(`${k.percorso}/`)
    })
  })
}

export function etichettaUrl(url: string): string {
  const parti = url.match(/^https?:\/\/([^/?#]+)([^?#]*)/i)
  if (!parti) return url
  const [, host, percorso = ''] = parti
  const pr = percorso.match(/\/(?:pull|merge_requests)\/(\d+)/)
  if (pr) return `PR #${pr[1]}`
  const pulito = percorso.replace(/\.git$/i, '')
  const testo = `${host}${pulito === '/' ? '' : pulito}`
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
