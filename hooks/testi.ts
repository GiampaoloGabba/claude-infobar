import type { Attivita, Limite } from '../types'

export const AUTONOMO =
  "Modalità autonoma: porta a termine tutto il lavoro concordato senza fermarti a chiedere conferme. Non fermarti finché restano passi del piano; le istanze nuove di principi già decisi si eseguono. Fermati solo per decisioni genuinamente nuove (prendile, registrale e proponile per ratifica a fine lavoro) o per azioni irreversibili non coperte da altre autorizzazioni. I comandi lunghi vanno in background."

const ALIAS: Record<string, string> = {
  db: 'Lettura e scrittura su tutti i database, compresa la produzione.',
  prod: 'Operazioni su risorse e database di produzione.',
  deploy: 'Lanciare i deploy e aggiornare la configurazione degli ambienti.',
  commit: 'Committare sul branch corrente senza chiedere conferma a ogni messaggio.',
  push: 'Fare push sul remoto senza chiedere conferma a ogni messaggio.',
}

export function testoAutorizzazione(args: string): string {
  const t = args.trim()

  return ALIAS[t.toLowerCase()] ?? t
}

export function sezioneAutorizzazioni(lista: readonly string[]): string {
  const voci = lista.map(a => `- ${a}`).join('\n')

  return `# Autorizzazioni di sessione

L'utente ha dato queste autorizzazioni con il comando /autorizza in questa sessione. Valgono fino a revoca (/revoca), anche dopo la compattazione e anche per i subagent: non chiedere di nuovo conferma per ciò che vi rientra. Quando coprono commit, push o altre operazioni git, sono la conferma esplicita dell'utente per tutta la sessione e superano eventuali regole che chiedono una conferma a ogni messaggio.

${voci}`
}

export const ISTRUZIONI_COMPATTAZIONE = `Nel riassunto conserva sempre, in modo esplicito: l'obiettivo in corso e cosa resta da fare, passo per passo; le decisioni prese dall'utente e i vincoli che ha espresso (cosa NON fare compreso); lo stato di git (branch, worktree, cosa è committato e cosa no); i subagent, workflow e comandi in background ancora attivi con i loro id; orari o riprese programmate; i file e gli issue su cui si sta lavorando.`

export function riepilogoAttivita(lista: readonly Attivita[]): string {
  const conteggi = new Map<string, number>()
  for (const a of lista) conteggi.set(a.tipo, (conteggi.get(a.tipo) ?? 0) + 1)

  return [...conteggi].map(([tipo, n]) => `${n} ${tipo}`).join(', ')
}

export function promptRipresa(motivo: string, falliti: readonly string[]): string {
  const agenti = falliti.length
    ? ` Questi subagent si sono fermati per lo stesso errore: riesumali o rilanciali perché finiscano il loro compito: ${falliti.join('; ')}.`
    : ''

  return `Ripresa automatica dopo ${motivo}: riprendi il lavoro esattamente da dove si era interrotto, senza ripetere ciò che è già fatto.${agenti} Controlla anche workflow e comandi in background interrotti e rilanciali se serve.`
}

type Finestra = { percentUsed: number; resetsAt?: string }

export function istanteRipresa(finestre: readonly Finestra[], ora: number): number | null {
  const reset = finestre
    .filter(f => f.percentUsed >= 99 && f.resetsAt)
    .map(f => Date.parse(f.resetsAt as string))
    .filter(t => !Number.isNaN(t) && t > ora)

  return reset.length ? Math.max(...reset) + 60_000 : null
}

export function orario(ms: number): string {
  const d = new Date(ms)
  const due = (n: number) => String(n).padStart(2, '0')

  return `${due(d.getHours())}:${due(d.getMinutes())}`
}

export function formattaToken(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
}

export function barra(p: number, larghezza = 10): string {
  const piene = Math.min(larghezza, Math.max(p > 0 ? 1 : 0, Math.floor((p * larghezza) / 100)))

  return '█'.repeat(piene) + '░'.repeat(larghezza - piene)
}

export function nomeModello(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id
  const [, famiglia = '', maggiore, minore] = m

  return `${famiglia.charAt(0).toUpperCase()}${famiglia.slice(1)} ${maggiore}${minore ? `.${minore}` : ''}`
}

export function coloreModello(nome: string): string {
  const n = nome.toLowerCase()
  if (n.includes('opus')) return 'blueBright'
  if (n.includes('sonnet')) return '#ff8700'
  if (n.includes('haiku')) return 'green'
  return 'cyan'
}

const COLORI_EFFORT: Record<string, string> = { low: 'green', medium: 'cyan', high: 'yellow', xhigh: '#ff8700', max: 'red' }

export const coloreEffort = (livello: string) => COLORI_EFFORT[livello] ?? 'gray'

export const LIVELLI_EFFORT = Object.keys(COLORI_EFFORT)

/** I limiti salvati da una sessione precedente, con le sole finestre non ancora azzerate; null se non ne resta nessuna. */
export function limitiSalvati(salvati: unknown, ora: number): { at: number; finestre: Limite[] } | null {
  const { at, finestre } = (salvati ?? {}) as { at?: unknown; finestre?: unknown }
  if (typeof at !== 'number' || !Array.isArray(finestre)) return null
  const valide = finestre.filter(
    (l): l is Limite =>
      typeof l?.kind === 'string' &&
      typeof l.percentUsed === 'number' &&
      typeof l.resetsAt === 'string' &&
      Date.parse(l.resetsAt) > ora,
  )
  return valide.length ? { at, finestre: valide } : null
}

/** L'effort che le impostazioni danno al modello: quello del modello in modelSettings, altrimenti effortLevel. */
export function effortDaImpostazioni(impostazioni: Readonly<Record<string, unknown>>, idModello: string): string | null {
  const perModello = impostazioni.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined
  const id = idModello.replace(/\[.*\]$/, '')
  const livello = perModello?.[idModello]?.effortLevel ?? perModello?.[id]?.effortLevel ?? impostazioni.effortLevel
  return typeof livello === 'string' && LIVELLI_EFFORT.includes(livello) ? livello : null
}

export const normalizzaPercorso = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

export const nomeCartella = (p: string) => normalizzaPercorso(p).split('/').pop() || p

export function genitore(p: string): string | null {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : null
}

export function ramoDaHead(head: string): string | null {
  const t = head.trim()
  const ref = /^ref: refs\/heads\/(.+)$/.exec(t)
  if (ref) return ref[1] ?? null
  return /^[0-9a-f]{7,}$/i.test(t) ? t.slice(0, 7) : null
}

export function gitdirDaFile(contenuto: string, cartella: string): string | null {
  const m = /^gitdir:\s*(.+)$/m.exec(contenuto)
  if (!m?.[1]) return null
  const dir = normalizzaPercorso(m[1].trim())

  return /^([a-z]:)?\//i.test(dir) ? dir : `${cartella}/${dir}`
}

const FINESTRE: Record<string, { etichetta: string }> = {
  five_hour: { etichetta: '5h' },
  seven_day: { etichetta: '7d' },
}

function finestra(kind: string): { etichetta: string } {
  const nota = FINESTRE[kind]
  if (nota) return nota
  const settimanale = /^seven_day_(.+)$/.exec(kind)
  if (settimanale?.[1]) return { etichetta: `7d ${settimanale[1]}` }
  return { etichetta: kind.replace(/_/g, ' ') }
}

export function formattaDurata(ms: number): string {
  const minuti = Math.max(0, Math.round(ms / 60_000))
  const giorni = Math.floor(minuti / 1440)
  const ore = Math.floor((minuti % 1440) / 60)
  const min = minuti % 60
  if (giorni) return ore ? `${giorni}g ${ore}h` : `${giorni}g`
  if (ore) return min ? `${ore}h ${min}m` : `${ore}h`
  return `${min}m`
}

export function descriviLimite(f: { kind: string; percentUsed: number; resetsAt?: string }, ora: number) {
  const { etichetta } = finestra(f.kind)
  const reset = f.resetsAt ? Date.parse(f.resetsAt) : Number.NaN
  const mancanoMs = Number.isNaN(reset) ? null : reset - ora
  const colore = coloreLivello(f.percentUsed)

  return {
    etichetta,
    percentuale: Math.round(f.percentUsed),
    mancano: mancanoMs !== null && mancanoMs > 0 ? formattaDurata(mancanoMs) : null,
    colore,
  }
}

export const coloreLivello = (p: number) => (p >= 80 ? 'red' : p >= 50 ? 'yellow' : 'green')
