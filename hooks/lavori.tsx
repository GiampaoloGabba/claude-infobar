import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, RenderInput, Timer } from 'claude-code'

import type { Attivita, Lavoro } from '../types'
import { apriTesto } from './apri'
import { apriInEditor, comandoOutput, editorPer } from './editor'
import { MAX_LETTURA, leggiSeCambiato } from './file'
import { fileOutputLavoro, fileOutputNelTesto, ricordaFileOutput } from './sessione'
import { formattaDurata } from './testi'

export const PANNELLO_LAVORI = 'lavori'

const lavori = atom({ plugin: 'infobar', key: 'lavori' } as const, [] as Lavoro[])
type OutputLavoro = { file: string; coda: string[]; intero?: string[] }
const outputLavori = atom({ plugin: 'infobar', key: 'outputLavori' } as const, {} as Record<string, OutputLavoro>)
const fermaChiesto = atom({ plugin: 'infobar', key: 'fermaChiesto' } as const, null as string | null)
const battito = atom({ plugin: 'infobar', key: 'battito' } as const, 0)
const outputAperti = atom({ plugin: 'infobar', key: 'outputAperti' } as const, [] as string[])
const diagnosiLavori = atom({ plugin: 'infobar', key: 'diagnosiLavori' } as const, null as string | null)

// Un lavoro finito resta in grigio per un po', così si vede anche cosa è appena terminato.
const FINITI_PER_MS = 10 * 60_000
const AGGIORNA_MS = 2000
const RIGHE_CODA = 3
const RIGHE_OUTPUT = 40
const CONFERMA_FERMA_MS = 4000
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

type Riepilogo = { id: string; type: string; status: string; description: string; command?: string; name?: string }

const inCorso = (l: Lavoro) => l.stato === 'in corso'

function inserisci(lista: readonly Lavoro[], nuovo: Lavoro): Lavoro[] {
  const vecchio = lista.find(l => l.id === nuovo.id)
  if (!vecchio) return [...lista, nuovo]
  return lista.map(l => (l.id === nuovo.id ? { ...nuovo, inizio: vecchio.inizio, comando: nuovo.comando ?? vecchio.comando } : l))
}

function chiudi(l: Lavoro, stato: Lavoro['stato'], ora: number): Lavoro {
  return inCorso(l) ? { ...l, stato, fine: ora } : l
}

// La notifica di fine può arrivare dopo il riepilogo di fine turno, che sa solo che il lavoro non c'è più:
// l'esito vero prende il posto di quello generico, la fine resta quella già vista.
function conEsito(l: Lavoro, stato: Lavoro['stato'], ora: number): Lavoro {
  return l.stato === 'finito' ? { ...l, stato } : chiudi(l, stato, ora)
}

/**
 * I lavori dopo il riepilogo di fine turno, che elenca quelli ancora attivi (i subagent no: per quelli c'è
 * l'elenco degli agenti). Uno che c'era e non c'è più è finito, senza sapere come.
 */
export function conRiepilogo(lista: readonly Lavoro[], riepilogo: readonly Riepilogo[], ora: number): Lavoro[] {
  const attivi = riepilogo.filter(t => t.type !== 'subagent')
  let nuova = lista.map(l => (l.tipo !== 'subagent' && !attivi.some(t => t.id === l.id) ? chiudi(l, 'finito', ora) : l))
  for (const t of attivi)
    nuova = inserisci(nuova, {
      id: t.id,
      tipo: t.type,
      descrizione: t.name ?? t.description,
      ...(t.command ? { comando: t.command } : {}),
      inizio: ora,
      stato: 'in corso',
    })
  return nuova
}

const STATO_AGENTE: Record<AgentInfo['status'], Lavoro['stato']> = {
  pending: 'in corso',
  running: 'in corso',
  waiting: 'in corso',
  idle: 'in corso',
  completed: 'completato',
  failed: 'fallito',
  killed: 'fermato',
}

/** I subagent dall'elenco degli agenti, che sa anche come sono finiti. */
export function conAgenti(lista: readonly Lavoro[], agenti: readonly Pick<AgentInfo, 'id' | 'description' | 'status'>[], ora: number): Lavoro[] {
  let nuova = [...lista]
  for (const a of agenti) {
    const stato = STATO_AGENTE[a.status]
    const vecchio = nuova.find(l => l.id === a.id)
    if (!vecchio && stato !== 'in corso') continue
    if (vecchio && !inCorso(vecchio)) continue
    nuova = inserisci(nuova, { id: a.id, tipo: 'subagent', descrizione: a.description, inizio: ora, stato, ...(stato === 'in corso' ? {} : { fine: ora }) })
  }
  return nuova
}

/** Id e stato dalla notifica di fine di un lavoro (`<task-notification>`); null se il testo non lo è. */
export function notificaLavoro(testo: string): { id: string; stato: Lavoro['stato'] } | null {
  const id = testo.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
  if (!id) return null
  const grezzo = testo.match(/<status>([^<]+)<\/status>/)?.[1]?.trim().toLowerCase() ?? ''
  const stato: Lavoro['stato'] =
    grezzo === 'completed' ? 'completato' : grezzo === 'failed' ? 'fallito' : grezzo === 'killed' || grezzo === 'stopped' ? 'fermato' : 'finito'
  return { id, stato }
}

/** Le ultime righe non vuote di un output, senza colori. */
export function coda(testo: string, righe = RIGHE_CODA): string[] {
  return testo
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map(r => r.replace(/\s+$/, ''))
    .filter(Boolean)
    .slice(-righe)
}

/** Senza i finiti da troppo tempo; quelli in corso restano sempre. */
export function pota(lista: readonly Lavoro[], ora: number): Lavoro[] {
  return lista.filter(l => inCorso(l) || (l.fine ?? ora) > ora - FINITI_PER_MS)
}

async function cambia($: EngineInterface, fn: (lista: readonly Lavoro[], ora: number) => Lavoro[]) {
  const ora = await $.clock.now()
  const prima = await read($, lavori)
  const dopo = pota(fn(prima, ora), ora)
  if (JSON.stringify(prima) !== JSON.stringify(dopo)) await update($, lavori, () => dopo)
}

export async function attivitaInCorso($: EngineInterface): Promise<Attivita[]> {
  return (await read($, lavori)).filter(inCorso).map(l => ({ tipo: l.tipo === 'subagent' ? 'agent' : l.tipo, descrizione: l.descrizione }))
}

export async function lavoriInCorso($: EngineInterface): Promise<number> {
  return (await read($, lavori)).filter(inCorso).length
}

export async function lavoriDaRiepilogo($: EngineInterface, riepilogo: readonly Riepilogo[]) {
  await cambia($, (lista, ora) => conRiepilogo(lista, riepilogo, ora))
}

export async function lavoriDaAgenti($: EngineInterface) {
  const agenti = await $.agent.list()
  await cambia($, (lista, ora) => conAgenti(lista, agenti, ora))
}

export async function lavoroDaNotifica($: EngineInterface, testo: string) {
  const file = fileOutputNelTesto(testo)
  if (file) ricordaFileOutput(file)
  const notifica = notificaLavoro(testo)
  if (notifica) await cambia($, (lista, ora) => lista.map(l => (l.id === notifica.id ? conEsito(l, notifica.stato, ora) : l)))
}

/** Un lavoro fermato con TaskStop, da Claude o dal pannello: nessuna notifica lo dirà. */
export async function lavoroFermato($: EngineInterface, id: string) {
  await cambia($, (lista, ora) => lista.map(l => (l.id === id ? chiudi(l, 'fermato', ora) : l)))
}

/** Un comando appena mandato in background: compare subito, senza aspettare la fine del turno. */
export async function lavoroAvviato($: EngineInterface, id: string, descrizione: string, comando: string) {
  await cambia($, (lista, ora) => inserisci(lista, { id, tipo: 'shell', descrizione, comando, inizio: ora, stato: 'in corso' }))
}

async function fileOutput($: EngineInterface, id: string): Promise<string | null> {
  return fileOutputLavoro($, id)
}

let timer: Timer | null = null

export async function pannelloLavoriAperto($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANNELLO_LAVORI)
}

// A pannello aperto: le code dei comandi e le durate si aggiornano; chiuso, il timer si ferma.
async function aggiorna($: EngineInterface, appenaAperto = false) {
  if (!appenaAperto && !(await pannelloLavoriAperto($))) {
    timer?.cancel()
    timer = null
    const pannelli = (await $.ui.panes()).map(p => p.id).join(', ') || 'nessuno'
    await update($, diagnosiLavori, () => `aggiornamento fermo: il pannello non risulta aperto (aperti: ${pannelli})`)
    return
  }
  // Un errore qui, su un timer, non lo vedrebbe nessuno: lo scrive il pannello.
  let diagnosi: string | null = null
  try {
    await lavoriDaAgenti($)
    diagnosi = await leggiOutput($)
  } catch (errore) {
    diagnosi = `errore: ${errore instanceof Error ? errore.message : String(errore)}`
  }
  if ((await read($, diagnosiLavori)) !== diagnosi) await update($, diagnosiLavori, () => diagnosi)
  await update($, battito, n => n + 1)
}

// Il file si cerca per id: dopo /clear non sta nella cartella della sessione attuale. Un lavoro senza file
// (un workflow, uno di una sessione chiusa) non ha output; un errore di lettura su un file trovato sì, ed è
// quello che il pannello dice.
async function leggiOutput($: EngineInterface): Promise<string | null> {
  const aperti = await read($, outputAperti)
  const output: Record<string, OutputLavoro> = {}
  let errore: string | null = null
  for (const l of await read($, lavori)) {
    const file = await fileOutput($, l.id)
    if (!file) continue
    const letto = await leggiSeCambiato($, file).catch((e: unknown) => {
      errore ??= `${file}: ${e instanceof Error ? e.message : String(e)}`
      return null
    })
    if (!letto) continue
    // Oltre i 4 MB una mod non può leggere il file: niente righe, ma i pulsanti per aprirlo restano.
    const troppo = letto.dimensione > MAX_LETTURA ? [`${Math.round(letto.dimensione / 1048576)} MB, troppo grande da mostrare: ↗ apri`] : null
    output[l.id] = {
      file,
      coda: inCorso(l) ? (troppo ?? coda(letto.testo)) : [],
      ...(aperti.includes(l.id) ? { intero: troppo ?? coda(letto.testo, RIGHE_OUTPUT) } : {}),
    }
  }
  if (JSON.stringify(await read($, outputLavori)) !== JSON.stringify(output)) await update($, outputLavori, () => output)
  return errore
}

async function mostraOutput($: EngineInterface, id: string) {
  await update($, outputAperti, a => (a.includes(id) ? a.filter(x => x !== id) : [...a, id]))
  await leggiOutput($)
}

export async function apriLavori($: EngineInterface) {
  await $.ui.open({ id: PANNELLO_LAVORI, title: 'Lavori in background' })
  await aggiorna($, true)
  timer ??= $.clock.every(AGGIORNA_MS, () => void aggiorna($))
}

async function ferma($: EngineInterface, l: Lavoro) {
  if ((await read($, fermaChiesto)) !== l.id) {
    await update($, fermaChiesto, () => l.id)
    $.clock.after(CONFERMA_FERMA_MS, async () => {
      if ((await read($, fermaChiesto)) === l.id) await update($, fermaChiesto, () => null)
    })
    return
  }
  await update($, fermaChiesto, () => null)
  const esito = await $.tool.call({ tool: 'TaskStop', task_id: l.id }).catch((errore: unknown) => errore)
  if (esito instanceof Error || (esito && typeof esito === 'object' && 'deny' in esito && esito.deny)) {
    $.ui.toast(`Non riesco a fermare "${l.descrizione}": ${esito instanceof Error ? esito.message : String((esito as { deny: unknown }).deny)}`)
    return
  }
  await cambia($, (lista, ora) => lista.map(x => (x.id === l.id ? chiudi(x, 'fermato', ora) : x)))
}

const ICONE: Record<string, string> = { shell: '$', subagent: '◆', workflow: '⚙', monitor: '◉' }
const COLORE_STATO: Record<Lavoro['stato'], string | undefined> = {
  'in corso': 'yellow',
  completato: 'green',
  fallito: 'red',
  fermato: undefined,
  finito: 'green',
}
const SEGNO_STATO: Record<Lavoro['stato'], string> = { 'in corso': '◷', completato: '✓', fallito: '✗', fermato: '■', finito: '✓' }

// Nell'editor, sull'ultima riga: si portano in primo piano da soli, a differenza del Blocco note lanciato
// da un processo in background, che Windows apre dietro al terminale.
export type OpzioniLavori = { editor?: string; apriOutput?: string }

async function apriOutput($: EngineInterface, file: string, opzioni: OpzioniLavori) {
  const letto = await leggiSeCambiato($, file).catch(() => null)
  // Di un file troppo grande per leggerlo le righe non si contano: una riga oltre la fine porta l'editor in fondo.
  const riga = letto && letto.dimensione > MAX_LETTURA ? 99_999_999 : Math.max(1, (letto?.testo ?? '').split('\n').length)
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const proprio = comandoOutput(opzioni.apriOutput, file, riga, windows)
  if (proprio) {
    const esito = await $.process.run(proprio).catch((errore: unknown) => errore)
    if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire l'output con "${opzioni.apriOutput}": ${esito.message}`)
    return
  }
  const editor = await editorPer($, file, opzioni.editor === 'no' ? 'auto' : opzioni.editor)
  if (editor) await apriInEditor($, editor, file, riga)
  else await apriTesto($, file)
}

export async function disegnaLavori($: EngineInterface, e: RenderInput<'Pane'>, opzioni: OpzioniLavori = {}) {
  await read($, battito)
  const lista = await read($, lavori)
  const datiOutput = await read($, outputLavori)
  const daFermare = await read($, fermaChiesto)
  const aperti = await read($, outputAperti)
  const diagnosi = await read($, diagnosiLavori)
  const ora = await $.clock.now()
  const larghezza = Math.max(20, e.props.bodyColumns - 6)
  const { Box, Text, Button } = $.ui.resolve(e)
  const attivi = lista.filter(inCorso)
  const finiti = lista.filter(l => !inCorso(l)).sort((a, b) => (b.fine ?? 0) - (a.fine ?? 0))

  const taglia = (testo: string, max = larghezza) => (testo.length > max ? `${testo.slice(0, Math.max(1, max - 1))}…` : testo)

  const pulsanti = (l: Lavoro) => {
    const percorso = datiOutput[l.id]?.file
    const aperto = aperti.includes(l.id)
    return (
      <Box flexDirection="row" columnGap={2}>
        {percorso ? (
          <Button
            key={`output-${l.id}`}
            plain
            onPress={() => mostraOutput($, l.id)}
          >
            <Text color="cyan">{aperto ? '▴ output' : '▾ output'}</Text>
          </Button>
        ) : null}
        {percorso ? (
          <Button key={`apri-${l.id}`} plain onPress={() => apriOutput($, percorso, opzioni)}>
            <Text color="cyan">↗ apri</Text>
          </Button>
        ) : null}
        {inCorso(l) ? (
          <Button key={`ferma-${l.id}`} plain onPress={() => ferma($, l)}>
            <Text color="red" bold={daFermare === l.id} inverse={daFermare === l.id}>
              {daFermare === l.id ? ' ■ ferma? clicca di nuovo ' : '■ ferma'}
            </Text>
          </Button>
        ) : null}
      </Box>
    )
  }

  const output = (l: Lavoro) =>
    aperti.includes(l.id) ? (
      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1}>
        {(datiOutput[l.id]?.intero ?? []).length ? (
          (datiOutput[l.id]?.intero ?? []).map((r, i) => (
            <Text key={`out-${l.id}-${i}`} wrap="truncate">
              {taglia(r, larghezza - 4)}
            </Text>
          ))
        ) : (
          <Text dimColor>(vuoto)</Text>
        )}
      </Box>
    ) : null

  const riquadroInCorso = (l: Lavoro) => (
    <Box key={`lavoro-${l.id}`} flexDirection="column" borderStyle="round" borderColor="yellow" borderDimColor paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate">
          {taglia(`${ICONE[l.tipo] ?? '·'} ${l.descrizione}`, larghezza - 8)}
        </Text>
        <Text color="yellow">{formattaDurata(ora - l.inizio)}</Text>
      </Box>
      {l.comando && l.comando !== l.descrizione ? (
        <Text dimColor wrap="truncate">
          {taglia(l.comando, larghezza - 2)}
        </Text>
      ) : null}
      {aperti.includes(l.id)
        ? null
        : (datiOutput[l.id]?.coda ?? []).map((r, i) => (
            <Text key={`coda-${l.id}-${i}`} color="gray" wrap="truncate">{`│ ${taglia(r, larghezza - 4)}`}</Text>
          ))}
      {output(l)}
      {pulsanti(l)}
    </Box>
  )

  const rigaFinito = (l: Lavoro) => (
    <Box key={`lavoro-${l.id}`} flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Text wrap="truncate">
          <Text color={COLORE_STATO[l.stato]} dimColor={!COLORE_STATO[l.stato]}>{`${SEGNO_STATO[l.stato]} `}</Text>
          <Text>{taglia(`${ICONE[l.tipo] ?? '·'} ${l.descrizione}`, Math.max(12, larghezza - 40))}</Text>
          <Text dimColor>{`  ${l.stato} · ${formattaDurata(ora - (l.fine ?? ora))} fa`}</Text>
        </Text>
        {pulsanti(l)}
      </Box>
      {output(l)}
    </Box>
  )

  const titolo = (testo: string, colore: string | undefined, n: number) => (
    <Box flexDirection="column">
      <Text bold color={colore} dimColor={!colore}>{`${testo} · ${n}`}</Text>
      <Text dimColor>{'─'.repeat(Math.max(10, larghezza))}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {titolo('IN CORSO', 'yellow', attivi.length)}
      {attivi.length === 0 ? <Text dimColor>Nessun lavoro in corso.</Text> : attivi.map(riquadroInCorso)}
      {finiti.length ? (
        <Box flexDirection="column" marginTop={1}>
          {titolo('FINITI', undefined, finiti.length)}
          {finiti.map(rigaFinito)}
        </Box>
      ) : null}
      {diagnosi ? (
        <Box marginTop={1}>
          <Text color="red" wrap="wrap">{`Output non letto: ${diagnosi}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
