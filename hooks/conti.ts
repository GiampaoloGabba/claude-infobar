import type { Conto, FinestraConto } from '../types'

export const STATO_CONTO: Record<string, string> = {
  token_expired: 'token scaduto',
  relogin_required: 'login da rifare',
  no_credentials: 'credenziali mancanti',
  foreign_credential: 'credenziale di un altro account',
  keychain_unavailable: 'credenziali illeggibili',
  unavailable: 'consumi non disponibili',
  api_key: 'API key',
}

const pulisci = (percorso: string, isWindows: boolean) => {
  const p = percorso.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return isWindows ? p.toLowerCase() : p
}

/** Il nome del profilo fisso (`~/.claude-canevari` → `canevari`), o null sul profilo principale. */
export function profiloFisso(configDir: string | undefined, principale: string, isWindows: boolean): string | null {
  if (!configDir?.trim() || pulisci(configDir, isWindows) === pulisci(principale, isWindows)) return null
  const base = configDir.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? configDir
  return base.replace(/^\.claude-?/, '') || base
}

function finestra(grezza: unknown): FinestraConto | null {
  if (!grezza || typeof grezza !== 'object') return null
  const f = grezza as { pct?: unknown; clock?: unknown }
  if (typeof f.pct !== 'number') return null
  return { pct: Math.round(f.pct), clock: typeof f.clock === 'string' ? f.clock : '' }
}

/** Le righe di `cswap list --json`. */
export function contiDaCswap(stdout: string): Conto[] {
  const dati = JSON.parse(stdout) as { accounts?: unknown[] }
  return (dati.accounts ?? []).map(grezzo => {
    const a = grezzo as Record<string, any>
    return {
      numero: Number(a.number),
      nome: a.alias || a.email || `#${a.number}`,
      attivo: a.active === true,
      stato: String(a.usageStatus ?? 'unavailable'),
      cinqueOre: finestra(a.usage?.fiveHour),
      settimana: finestra(a.usage?.sevenDay),
    }
  })
}

/** L'email dell'account loggato secondo un `.claude.json`. */
export function emailDaConfig(testo: string): string | null {
  try {
    const email = (JSON.parse(testo) as { oauthAccount?: { emailAddress?: unknown } }).oauthAccount?.emailAddress
    return typeof email === 'string' && email ? email : null
  } catch {
    return null
  }
}

/** L'alias che cswap dà a un'email (`sequence.json`), o null se l'account non è registrato o non ha alias. */
export function aliasDaSequenza(testo: string, email: string): string | null {
  try {
    const conti = (JSON.parse(testo) as { accounts?: Record<string, { email?: unknown; alias?: unknown }> }).accounts ?? {}
    const conto = Object.values(conti).find(c => typeof c.email === 'string' && c.email.toLowerCase() === email.toLowerCase())
    return typeof conto?.alias === 'string' && conto.alias ? conto.alias : null
  } catch {
    return null
  }
}
