import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput, UiPressArgument } from 'claude-code'

import type { MessaggioUtente } from '../types'
import { segnaAperto } from './pannelli'
import { type Pezzo, segna } from './testi'

export const PANNELLO_MESSAGGI = 'messaggi'

const messaggi = atom({ plugin: 'infobar', key: 'messaggi' } as const, [] as MessaggioUtente[])
const filtroMessaggi = atom({ plugin: 'infobar', key: 'filtroMessaggi' } as const, '')
const sessioneMessaggi = atom({ plugin: 'infobar', key: 'sessioneMessaggi' } as const, null as string | null)
const versioneCampo = atom({ plugin: 'infobar', key: 'versioneCampoMessaggi' } as const, 0)
const evidenziato = atom({ plugin: 'infobar', key: 'messaggioEvidenziato' } as const, false)

const MAX_MESSAGGI = 1000
// I messaggi visti in un disegno si salvano a gruppi: una sessione ripresa ne disegna decine di fila.
const RACCOLTA_MS = 50
const ORIGINI = new Set(['composer', 'bridge', 'unclassified'])
// Quanto resta acceso il messaggio a cui il pannello ti ha portato: basta a trovarlo con l'occhio.
const LAMPEGGIO_MS = 1200
const SFONDO_LAMPEGGIO = 'warning'

const inAttesa: MessaggioUtente[] = []
let raccolta = false
// L'ora in cui hai inviato ogni prompt, per testo: la riga del transcript non la porta.
const inviati = new Map<string, number>()
// Le risposte si legano al tuo messaggio che le precede: conta l'ordine in cui le righe compaiono la prima
// volta, non quello dei ridisegni (uno scroll ridisegna righe vecchie).
const visti = new Set<string>()
let ultimoUtente: string | null = null
let ultimoTesto = ''
const bloccoDi = new Map<string, { utente: string; ordine: number }>()
const risposte = new Map<string, { ordine: number; testo: string }>()
let ordine = 0

/** La prima riga non vuota del messaggio, senza spazi ripetuti. */
export function primaRiga(testo: string): string {
  return (testo.split('\n').find(r => r.trim()) ?? '').replace(/\s+/g, ' ').trim()
}

/** I messaggi che contengono tutte le parole del filtro, maiuscole o no; `#12` cerca il numero. */
export function filtra(lista: readonly MessaggioUtente[], filtro: string): { m: MessaggioUtente; n: number }[] {
  const numerati = lista.map((m, i) => ({ m, n: i + 1 }))
  const parole = filtro.toLowerCase().split(/\s+/).filter(Boolean)
  if (!parole.length) return numerati
  return numerati.filter(({ m, n }) => parole.every(p => (/^#\d+$/.test(p) ? `#${n}` === p : m.testo.toLowerCase().includes(p))))
}

/**
 * Aggiunge all'elenco i messaggi nuovi e aggiorna le risposte. Il terminale disegna un messaggio appena
 * inviato due volte, con due id: la seconda copia, uguale all'ultima dell'elenco, ne prende il posto.
 */
export function unisci(lista: readonly MessaggioUtente[], nuovi: readonly MessaggioUtente[], testi: ReadonlyMap<string, string>): MessaggioUtente[] {
  let risultato = [...lista]
  for (const m of nuovi) {
    if (risultato.some(x => x.id === m.id)) continue
    const ultimo = risultato.at(-1)
    if (ultimo && ultimo.testo.trim() === m.testo.trim()) risultato[risultato.length - 1] = { ...m, ora: m.ora ?? ultimo.ora, risposta: m.risposta ?? ultimo.risposta }
    else risultato.push(m)
  }
  if (risultato.length > MAX_MESSAGGI) risultato = risultato.slice(-MAX_MESSAGGI)
  return risultato.map(m => {
    const risposta = testi.get(m.id)
    return risposta !== undefined && risposta !== m.risposta ? { ...m, risposta } : m
  })
}

function salva($: EngineInterface) {
  if (raccolta) return
  raccolta = true
  $.clock.after(RACCOLTA_MS, async () => {
    raccolta = false
    const nuovi = inAttesa.splice(0)
    const testi = new Map([...risposte].map(([id, r]) => [id, r.testo]))
    await update($, messaggi, lista => {
      const unita = unisci(lista, nuovi, testi)
      return unita.length === lista.length && unita.every((m, i) => m === lista[i]) ? lista : unita
    })
  })
}

function nota($: EngineInterface, id: string, testo: string) {
  if (!testo.trim() || visti.has(id)) return
  visti.add(id)
  // La seconda copia di un messaggio appena inviato: le sue risposte passano all'id nuovo.
  if (ultimoUtente && ultimoTesto === testo.trim()) {
    const prima = ultimoUtente
    for (const b of bloccoDi.values()) if (b.utente === prima) b.utente = id
    const vecchia = risposte.get(prima)
    if (vecchia) risposte.set(id, vecchia)
  }
  ultimoUtente = id
  ultimoTesto = testo.trim()
  inAttesa.push({ id, testo, ora: inviati.get(testo.trim()) ?? null, risposta: null })
  salva($)
}

// La risposta di un messaggio è il suo ultimo blocco di testo: quello che chiude il turno.
function notaRisposta($: EngineInterface, id: string, testo: string) {
  if (!testo.trim()) return
  let blocco = bloccoDi.get(id)
  if (!blocco) {
    if (!ultimoUtente) return
    blocco = { utente: ultimoUtente, ordine: ordine++ }
    bloccoDi.set(id, blocco)
  }
  const attuale = risposte.get(blocco.utente)
  if (attuale && (attuale.ordine > blocco.ordine || (attuale.ordine === blocco.ordine && attuale.testo === testo))) return
  risposte.set(blocco.utente, { ordine: blocco.ordine, testo })
  salva($)
}

async function vaiA($: EngineInterface, m: MessaggioUtente) {
  const esito = await $.ui.scroll({ to: { requestId: m.id }, block: 'start' }).catch((errore: unknown) => ({
    deny: errore instanceof Error ? errore.message : String(errore),
  }))
  if (esito.deny) {
    // Una riga che il transcript non ha più (un /rewind, una copia provvisoria): esce dall'elenco.
    if (/nothing drawn/i.test(esito.deny)) {
      await update($, messaggi, lista => lista.filter(x => x.id !== m.id))
      $.ui.toast("Quel messaggio non c'è più nel transcript.")
    } else $.ui.toast(`Non riesco a portarti al messaggio: ${esito.deny}`)
    return
  }
  // Anche se era già a video: il lampeggio dice quale è.
  const acceso = memberOf(evidenziato, { requestId: m.id })
  await update($, acceso, () => true)
  $.clock.after(LAMPEGGIO_MS, () => update($, acceso, () => false))
}

async function copia($: EngineInterface, testo: string, cosa: string, press: UiPressArgument) {
  const esito = await $.ui.copy({ text: testo, surface: press.surface })
  $.ui.toast(esito.isCopied ? `${cosa} copiato.` : `Copia non riuscita (${esito.reason})`, { timeoutMs: 2500 })
}

export async function quantiMessaggi($: EngineInterface): Promise<number> {
  return (await read($, messaggi)).length
}

async function azzera($: EngineInterface) {
  await update($, filtroMessaggi, () => '')
  await update($, versioneCampo, v => v + 1)
  // Dopo l'azzeramento si riparte a cercare: la tastiera torna nel campo, ridisegnato con la chiave nuova.
  const campo = await read($, versioneCampo)
  await $.ui.focus({ requestId: PANNELLO_MESSAGGI, key: `cerca-${campo}` }).catch(() => undefined)
}

export async function apriMessaggi($: EngineInterface) {
  // Prima di tutto l'apertura: solo una chiamata fatta subito dopo il clic o il comando conta come tua, e un
  // pannello aperto da solo in un terminale sotto le 144 colonne resta in attesa invece di comparire.
  const aperto = await $.ui.open({ id: PANNELLO_MESSAGGI, title: 'Messaggi', focus: true })
  if (!aperto.isPlaced) {
    $.ui.toast(`Il pannello dei messaggi non si apre: ${aperto.reason}`)
    return
  }
  segnaAperto(PANNELLO_MESSAGGI)
  // A ogni apertura il campo riparte con la tastiera: autoFocus vale solo per la sua prima versione.
  await update($, versioneCampo, () => 0)
  // Aperto da un clic sulla barra, il pannello non prende la tastiera da sé (ce l'ha la barra): la si chiede.
  await $.ui.focus({ requestId: PANNELLO_MESSAGGI, key: 'cerca-0' }).catch(() => undefined)
}

const AZZERA = '✕ azzera'
const AZIONE_TESTO = '⧉ testo'
const AZIONE_RISPOSTA = '⧉ risposta'

function orario(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function taglia(testo: string, max: number) {
  return testo.length <= max ? testo : `${testo.slice(0, Math.max(1, max - 1))}…`
}


/**
 * Cosa mostrare di un messaggio in `max` caratteri: senza ricerca la prima riga; cercando, il pezzo intorno
 * alla prima parola trovata, che inizia poco prima di lei, con le parole cercate segnate.
 */
export function estratto(testo: string, filtro: string, max: number): Pezzo[] {
  const parole = filtro.toLowerCase().split(/\s+/).filter(p => p && !/^#\d+$/.test(p))
  const piatto = testo.replace(/\s+/g, ' ').trim()
  const basso = piatto.toLowerCase()
  const primo = parole.map(p => basso.indexOf(p)).filter(i => i >= 0).sort((a, b) => a - b)[0]
  let riga: string
  if (primo === undefined) riga = taglia(primaRiga(testo), max)
  else if (primo + (parole.find(p => basso.startsWith(p, primo))?.length ?? 0) <= max - 1) riga = taglia(piatto, max)
  else {
    // Un po' di contesto prima della parola: abbastanza da capire la frase, senza spingerla in fondo.
    const inizio = Math.max(0, primo - Math.floor(max / 4))
    const resto = piatto.slice(inizio)
    riga = `…${resto.length > max - 1 ? `${resto.slice(0, max - 2)}…` : resto}`
  }
  return segna(riga, parole)
}

export async function disegnaMessaggi($: EngineInterface, e: RenderInput<'Pane'>) {
  const lista = await read($, messaggi)
  const filtro = await read($, filtroMessaggi)
  const campo = await read($, versioneCampo)
  const larghezza = Math.max(30, e.props.bodyColumns - 2)
  const elementi = $.ui.resolve(e)
  if (!('Input' in elementi)) return <elementi.Text dimColor>Il pannello dei messaggi c'è solo nel terminale.</elementi.Text>
  const { Box, Button, Input, Text } = elementi
  // I più recenti in cima: di solito si torna a qualcosa di poco fa.
  const trovati = filtra(lista, filtro).reverse()
  const cifre = String(lista.length).length + 1

  return (
    <Box flexDirection="column">
      {/* Prima del campo non compare né sparisce niente mentre scrivi: un elemento in più lì sposta il fuoco
          fuori dal campo, e le lettere successive finiscono nel prompt. */}
      <Box marginTop={1}>
        <Text bold color="warning">{filtro.trim() ? `MESSAGGI · ${trovati.length} di ${lista.length}` : `MESSAGGI · ${lista.length}`}</Text>
      </Box>
      {/* Invio svuota il campo da sé: a ogni Invio il campo si ridisegna con una chiave nuova, che lo riparte
          dal filtro, così la parola cercata resta scritta lì. */}
      <Input
        key={`cerca-${campo}`}
        placeholder="cerca nei tuoi messaggi (#12 per numero)"
        value={filtro}
        autoFocus={campo === 0 ? true : undefined}
        onInput={(valore: string) => void update($, filtroMessaggi, () => valore)}
        // Invio porta la tastiera sui risultati, come una palette: frecce per scegliere, Invio per saltare.
        onSubmit={async (valore: string) => {
          if (valore.trim()) await update($, filtroMessaggi, () => valore)
          await update($, versioneCampo, v => v + 1)
          const primo = trovati[0]
          if (primo) await $.ui.focus({ requestId: PANNELLO_MESSAGGI, key: `msg-${primo.m.id}` }).catch(() => undefined)
        }}
      />
      <Box flexDirection="row">
        <Text dimColor>{'─'.repeat(Math.max(1, larghezza - (filtro.trim() ? AZZERA.length + 1 : 0)))}</Text>
        {filtro.trim() ? (
          <Button key="azzera" plain onPress={() => azzera($)}>
            <Text color="suggestion">{` ${AZZERA}`}</Text>
          </Button>
        ) : null}
      </Box>
      {!lista.length ? (
        <Text dimColor>Nessun messaggio ancora: compaiono man mano che il transcript li mostra.</Text>
      ) : !trovati.length ? (
        <Text dimColor>Nessun messaggio contiene queste parole.</Text>
      ) : (
        trovati.map(({ m, n }) => {
          const prefisso = `${`#${n}`.padStart(cifre)}  ${m.ora === null ? '     ' : orario(m.ora)}  `
          // Le azioni compaiono solo con il puntatore sulla riga, sopra la sua fine: il testo ha tutta la larghezza.
          return (
            <Box key={`riga-${m.id}`} flexDirection="column">
              <Button key={`msg-${m.id}`} plain onPress={() => vaiA($, m)}>
                <Text dimColor>{prefisso}</Text>
                {estratto(m.testo, filtro, larghezza - prefisso.length).map((pezzo, i) =>
                  pezzo.trovato ? (
                    <Text key={`p${i}`} color="warning" bold>{pezzo.testo}</Text>
                  ) : (
                    <Text key={`p${i}`}>{pezzo.testo}</Text>
                  ),
                )}
              </Button>
              <Box position="absolute" top={0} right={0} flexDirection="row" display="none" hover={{ display: 'flex' }}>
                <Text>{'  '}</Text>
                <Button key={`copia-msg-${m.id}`} plain onPress={(press: UiPressArgument) => copia($, m.testo, 'Messaggio', press)}>
                  <Text color="suggestion" inverse>{` ${AZIONE_TESTO} `}</Text>
                </Button>
                {m.risposta ? <Text>{' '}</Text> : null}
                {m.risposta ? (
                  <Button key={`copia-risp-${m.id}`} plain onPress={(press: UiPressArgument) => copia($, m.risposta!, 'Risposta', press)}>
                    <Text color="suggestion" inverse>{` ${AZIONE_RISPOSTA} `}</Text>
                  </Button>
                ) : null}
              </Box>
            </Box>
          )
        })
      )}
    </Box>
  )
}

/** Il prompt che hai appena inviato: la sua ora la riga del transcript non la porta. */
export async function messaggioInviato($: EngineInterface, testo: string) {
  inviati.set(testo.trim(), await $.clock.now())
}

/** All'avvio di una sessione: dopo /clear o una ripresa l'elenco riparte, e una ripresa lo riempie ridisegnando. */
export async function nuovaSessioneMessaggi($: EngineInterface) {
  const sessione = await $.session.id()
  if ((await read($, sessioneMessaggi)) === sessione) return
  await update($, sessioneMessaggi, () => sessione)
  await update($, messaggi, () => [])
  visti.clear()
  bloccoDi.clear()
  risposte.clear()
  ultimoUtente = null
  ultimoTesto = ''
}

/** Raccoglie i tuoi messaggi dal transcript del terminale e disegna il pannello che porta a ciascuno. */
export function registraMessaggi(on: On) {
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, async ($, e, next) => {
    if (ORIGINI.has(e.props.origin.kind) && !e.props.from) nota($, e.requestId, e.props.text)
    if (!(await read($, memberOf(evidenziato, { requestId: e.requestId })))) return next(e)
    // Per il lampeggio la riga la disegna la mod: quella del motore ha uno sfondo suo che coprirebbe il colore.
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" marginTop={1} backgroundColor={SFONDO_LAMPEGGIO}>
        {e.props.text.split('\n').map((r, i) => (
          <Text key={`r${i}`} color="inverseText" bold>{`${i === 0 ? '❯ ' : '  '}${r}`}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, ($, e, next) => {
    if (!e.props.isSummary) notaRisposta($, e.requestId, e.props.text)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANNELLO_MESSAGGI }, async ($, e) => disegnaMessaggi($, e))
}
