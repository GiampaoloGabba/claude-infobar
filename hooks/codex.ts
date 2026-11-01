import type { Limite } from '../types'

/** Una finestra di Codex nel formato dei limiti di Claude: `five_hour`/`seven_day` per durata, altrimenti in minuti. */
function limite(percentuale: unknown, resetSecondi: unknown, durataSecondi: unknown): Limite | null {
  if (typeof percentuale !== 'number' || typeof resetSecondi !== 'number') return null
  const kind = durataSecondi === 18_000 ? 'five_hour' : durataSecondi === 604_800 ? 'seven_day' : `${Math.round(Number(durataSecondi) / 60)}m`
  return { kind, percentUsed: percentuale, resetsAt: new Date(resetSecondi * 1000).toISOString() }
}

/** La risposta di `GET chatgpt.com/backend-api/wham/usage`. */
export function limitiDaUsage(testo: string): Limite[] {
  const dati = JSON.parse(testo) as { rate_limit?: Record<string, any> | null }
  const r = dati.rate_limit ?? {}
  return [r.primary_window, r.secondary_window]
    .map(f => (f ? limite(f.used_percent, f.reset_at, f.limit_window_seconds) : null))
    .filter((l): l is Limite => l !== null)
}

/** L'ultimo `rate_limits` scritto in un file di sessione di Codex (`rollout-*.jsonl`), o null. */
export function limitiDaSessione(testo: string): Limite[] | null {
  const righe = testo.split('\n')
  for (let i = righe.length - 1; i >= 0; i--) {
    const riga = righe[i]
    if (!riga?.includes('"rate_limits"')) continue
    try {
      const trovato = cercaRateLimits(JSON.parse(riga))
      if (!trovato) continue
      return [trovato.primary, trovato.secondary]
        .map(f => (f ? limite(f.used_percent, f.resets_at, typeof f.window_minutes === 'number' ? f.window_minutes * 60 : null) : null))
        .filter((l): l is Limite => l !== null)
    } catch {
      continue
    }
  }
  return null
}

function cercaRateLimits(nodo: unknown): Record<string, any> | null {
  if (!nodo || typeof nodo !== 'object') return null
  const o = nodo as Record<string, unknown>
  if (o.rate_limits && typeof o.rate_limits === 'object') return o.rate_limits as Record<string, any>
  for (const v of Object.values(o)) {
    const trovato = cercaRateLimits(v)
    if (trovato) return trovato
  }
  return null
}

/** Il campo `exp` (secondi) di un JWT, senza verificarlo; null se illeggibile. */
export function scadenzaJwt(token: string): number | null {
  const parte = token.split('.')[1]
  if (!parte) return null
  try {
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=')
    const exp = (JSON.parse(atob(base64)) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

/** Il file che le sessioni di Claude condividono, così una sola chiama l'endpoint. */
export type CacheCodex = {
  /** Quando il dato è stato preso. */
  at: number
  /** Fino a quando una sessione sta già chiedendo: le altre aspettano. */
  occupatoFino: number
  limiti: Limite[]
  /** Di quando è il dato: uguale a `at` se viene dall'endpoint, la data del file se da una sessione di Codex. */
  vistoAlle: number | null
}

export const RINFRESCO_CODEX_MS = 5 * 60_000

export function leggiCache(testo: string): CacheCodex | null {
  try {
    const c = JSON.parse(testo) as Partial<CacheCodex>
    if (typeof c.at !== 'number' || typeof c.occupatoFino !== 'number' || !Array.isArray(c.limiti)) return null
    return { at: c.at, occupatoFino: c.occupatoFino, limiti: c.limiti, vistoAlle: typeof c.vistoAlle === 'number' ? c.vistoAlle : null }
  } catch {
    return null
  }
}

/** Cosa fare con la cache: usarla, aspettare chi sta già chiedendo, o chiedere. */
export function decidiCodex(cache: CacheCodex | null, ora: number): 'usa' | 'aspetta' | 'chiedi' {
  if (cache && ora - cache.at < RINFRESCO_CODEX_MS) return 'usa'
  if (cache && cache.occupatoFino > ora) return 'aspetta'
  return 'chiedi'
}
