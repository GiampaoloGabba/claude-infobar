import type { EngineInterface, ProcessSpawnRequest, Timer } from 'claude-code'

import { fromBase64 } from './raster'

/** Il file più grande che `$.fs.read` accetta: oltre rifiuta la lettura. */
export const MAX_LETTURA = 4 * 1024 * 1024

type Letto = { dimensione: number; modificato: number; testo: string }

const letti = new Map<string, Letto>()

/**
 * Il testo di un file che si rilegge spesso (l'output di un lavoro): prima un `stat`, e il file si rilegge
 * solo se dimensione o ora di modifica sono cambiate. Null se il file non c'è; testo vuoto se è troppo grande
 * per leggerlo, e chi chiama lo capisce dalla dimensione.
 */
export async function leggiSeCambiato($: EngineInterface, file: string): Promise<{ testo: string; dimensione: number } | null> {
  const stat = await $.fs.stat(file).catch(() => null)
  if (stat?.kind !== 'file') {
    letti.delete(file)
    return null
  }
  const vecchio = letti.get(file)
  if (vecchio && vecchio.dimensione === stat.size && vecchio.modificato === stat.mtimeMs) return vecchio
  const testo = stat.size > MAX_LETTURA ? '' : await $.fs.read(file)
  const nuovo = { dimensione: stat.size, modificato: stat.mtimeMs, testo }
  letti.set(file, nuovo)
  return nuovo
}

type VariabiliTerminale = Partial<
  Record<'KITTY_WINDOW_ID' | 'GHOSTTY_RESOURCES_DIR' | 'TERM_PROGRAM' | 'SSH_CONNECTION' | 'SSH_CLIENT' | 'SSH_TTY', string>
>

// Decodificare 26 MB di PNG costa quanto uno screenshot 4K da 4,6 MB, circa 1-2 s.
export const MAX_LETTURA_PROCESSO = 32 * 1024 * 1024
const ATTESA_PROCESSO_MS = 10_000

// Via SSH il percorso è sul server e il terminale sul PC; Mosaic Manager per sicurezza non legge mai file per percorso.
function terminaleLeggeIlPercorso(env: VariabiliTerminale): boolean {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.TERM_PROGRAM === 'MosaicManager') return false
  return Boolean(env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR) || ['kitty', 'ghostty', 'WezTerm'].includes(env.TERM_PROGRAM ?? '')
}

/** Per un PNG oltre ciò che `$.fs.read` legge: dal percorso al terminale, letto da un processo figlio, o niente. */
export function letturaPngGrande(dimensione: number, env: VariabiliTerminale): 'percorso' | 'processo' | 'troppo' {
  if (terminaleLeggeIlPercorso(env)) return 'percorso'
  return dimensione > MAX_LETTURA_PROCESSO ? 'troppo' : 'processo'
}

// Il percorso passa come argomento o variabile d'ambiente, mai dentro il testo dello script.
async function comandoBase64($: EngineInterface, path: string): Promise<ProcessSpawnRequest> {
  if ((await $.env.get('OS')) === 'Windows_NT')
    return {
      argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '[Convert]::ToBase64String([IO.File]::ReadAllBytes($env:INFOBAR_PNG))'],
      env: { INFOBAR_PNG: path.replaceAll('/', '\\') },
    }
  // Il base64 di macOS vuole il file dopo -i; per GNU -i riguarda solo la decodifica.
  const darwin = (await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin'
  return { argv: darwin ? ['base64', '-i', path] : ['base64', path] }
}

/** I byte di un file oltre i 4 MiB, in base64 da un processo figlio; undefined se manca, fallisce o non finisce in tempo. */
export async function leggiConProcesso($: EngineInterface, path: string): Promise<Uint8Array | undefined> {
  const richiesta = await comandoBase64($, path).catch(() => undefined)
  if (!richiesta) return undefined
  const figlio = $.process.spawn(richiesta)
  const raccolta = (async () => {
    let base64 = ''
    for await (const { stream, text } of figlio) {
      if (stream !== 'stdout') continue
      base64 += text.replace(/\s+/g, '')
      if (base64.length > (MAX_LETTURA_PROCESSO / 3) * 4 + 4) return undefined
    }
    const { code } = await figlio.result
    return code === 0 && base64 ? fromBase64(base64) : undefined
  })().catch(() => undefined)
  let timer: Timer | undefined
  const scaduta = new Promise<undefined>(resolve => (timer = $.clock.after(ATTESA_PROCESSO_MS, () => resolve(undefined))))
  try {
    return await Promise.race([raccolta, scaduta])
  } finally {
    timer?.cancel()
    void figlio.return({ code: null, signal: null }).catch(() => {})
  }
}
