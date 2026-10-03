export type Attivita = { tipo: string; descrizione: string }

export type Limite = { kind: string; percentUsed: number; resetsAt?: string }

export type Ripresa = { at: number; motivo: string; tentativi: number }

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
    }
  }
}
