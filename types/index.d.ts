export type Attivita = { tipo: string; descrizione: string }

export type Limite = { kind: string; percentUsed: number; resetsAt?: string }

export type Ripresa = { at: number; motivo: string; tentativi: number }

export type ImmagineIncollata = {
  n: number
  /** Percorso assoluto del PNG in cache; null se non si trova. */
  path: string | null
  /** Dimensioni in pixel; null se ignote, e il riquadro prende una forma predefinita. */
  size: { width: number; height: number } | null
  /**
   * Copia RGBA ridotta (base64) disegnata a mezzi blocchi colorati, presente solo dove il terminale
   * non sa disegnare il PNG; null se non si è potuta decodificare.
   */
  thumbnail?: { width: number; height: number; rgba: string } | null
}

export type FinestraConto = { pct: number; clock: string }

export type Conto = {
  numero: number
  nome: string
  attivo: boolean
  /** `usageStatus` di cswap: `ok`, `relogin_required`, `token_expired`, ... */
  stato: string
  cinqueOre: FinestraConto | null
  settimana: FinestraConto | null
}

export type StatoConti = {
  conti: Conto[]
  aggiornatiAlle: number
  errore: string | null
  /** Cosa sta facendo cswap adesso; null se è fermo. */
  occupato: string | null
}

/** I limiti di Codex; `vistoAlle` solo se il dato è vecchio (preso da un file di sessione). */
export type UsoCodex = { limiti: Limite[]; vistoAlle: number | null }

/** L'account mostrato nella barra: `fisso` se la sessione gira su un profilo CLAUDE_CONFIG_DIR dedicato. */
export type ContoSessione = { nome: string; fisso: boolean }

declare module 'claude-code' {
  interface PluginState {
    'infobar': {
      modello: string | null
      effort: string | null
      cartella: string | null
      branch: string | null
      percent: number | null
      tokens: number | null
      avvisato: number
      turnoAttivo: boolean
      agenti: Attivita[]
      inBackground: Attivita[]
      ripresa: Ripresa | null
      tentativi: number
      agentiFalliti: string[]
      limiti: Limite[]
      /** Quando sono stati visti i limiti mostrati, se vengono da una sessione precedente; null se aggiornati. */
      limitiVistiAlle: number | null
      autorizzazioni: string[]
      immagini: ImmagineIncollata[]
      conti: StatoConti
      contoSessione: ContoSessione | null
      usoCodex: UsoCodex | null
    }
  }
}
