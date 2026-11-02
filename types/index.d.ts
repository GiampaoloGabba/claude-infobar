export type Attivita = { tipo: string; descrizione: string }

/** Un lavoro in background della sessione: comando, subagent, workflow, Monitor. */
export type Lavoro = {
  id: string
  /** `shell`, `subagent`, `workflow`, `monitor`, o il tipo che riporta Claude Code. */
  tipo: string
  descrizione: string
  /** La riga di comando, per i comandi. */
  comando?: string
  /** Quando la mod l'ha visto la prima volta: per quelli scoperti a fine turno, un po' dopo la partenza. */
  inizio: number
  stato: 'in corso' | 'completato' | 'fallito' | 'fermato' | 'finito'
  fine?: number
}

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
      /**
       * Per riga del transcript (il suo requestId): `firma:chiave` del pulsante di copia appena premuto, che
       * per due secondi dice "copiato"; null altrimenti. Una riga per valore, così si ridisegna solo lei.
       */
      copiato: StateFamily<string | null>
      /** I testi delle ultime risposte finite: il loro ultimo blocco ha la riga di copia anche se è breve. */
      risposteFinite: string[]
      /** Per chiamata di Bash o PowerShell (il tool_use_id): i documenti scritti e gli URL dell'output. */
      trovatiComandi: StateFamily<{ prodotti: string[]; url: string[] }>
      modello: string | null
      effort: string | null
      cartella: string | null
      branch: string | null
      percent: number | null
      tokens: number | null
      avvisato: number
      turnoAttivo: boolean
      lavori: Lavoro[]
      /**
       * L'output dei lavori che ne hanno uno, per id: il file, le ultime righe e, per quelli aperti nel
       * pannello, le ultime 40. Si legge solo a pannello aperto, dal timer: il disegno non tocca il disco.
       */
      outputLavori: Record<string, { file: string; coda: string[]; intero?: string[] }>
      /** Il lavoro su cui è stato premuto "ferma" una volta: il secondo clic lo ferma. */
      fermaChiesto: string | null
      /** Cambia ogni pochi secondi a pannello aperto, perché le durate si aggiornino. */
      battito: number
      /** I lavori di cui il pannello mostra l'output per intero. */
      outputAperti: string[]
      /** Cosa è andato storto nell'ultimo aggiornamento del pannello, e dove ha cercato l'output. */
      diagnosiLavori: string | null
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
