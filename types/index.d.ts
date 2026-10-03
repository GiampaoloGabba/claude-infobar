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
      autorizzazioni: string[]
      immagini: ImmagineIncollata[]
    }
  }
}
