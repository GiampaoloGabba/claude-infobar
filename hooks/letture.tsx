import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import { apri } from './apri'
import { NOMI_EDITOR, apriInEditor, editorPer, rigaModificata } from './editor'
import { type Size, fitCells, pngSize } from './layout'
import { lavoroAvviato } from './lavori'
import { leggiSeCambiato } from './file'
import { fileOutputLavoro, fileOutputNelTesto, ricordaFileOutput } from './sessione'
import { apriUrl, etichettaUrl, urlNelTesto } from './url'

export type Anteprima = 'immagini' | 'blocchi' | 'etichette'

/**
 * Un link sotto la riga di un tool: un file da aprire con il programma di sistema (un'immagine letta, un
 * documento prodotto), un file di codice da aprire nell'editor alla riga cambiata, o un URL.
 */
export type Link = {
  id: string
  tipo: 'file' | 'editor' | 'url'
  /** Il percorso o l'URL; null dove non si sa, come nella riga di risultato di una lettura in una sessione ripresa. */
  destinazione: string | null
  riga?: number
  /** Il PNG che ha visto Claude, in base64; null dove non c'è un'immagine da disegnare. */
  png: string | null
  size: Size | null
}

type Chiamata = { tool: string; tool_use_id?: string; input: unknown; output?: unknown; isErrored?: boolean }

/** Quello che le righe del transcript non portano e tool.call ha trovato quando la chiamata è finita. */
export type Trovati = { prodotti?: readonly string[]; url?: readonly string[] }

// Un'Image con i byte inline ne accetta al massimo 2 MiB decodificati.
const MAX_PNG_INLINE = 2 * 1024 * 1024
// I documenti di testo che Claude scrive con Write o Edit e che si aprono con il programma di sistema;
// gli altri file sono codice, e quelli vanno nell'editor.
const DOCUMENTO_TESTO = /\.(md|markdown|txt|csv|tsv|html?|svg)$/i
// Quelli che produce con uno script: binari (PDF, Office, OpenDocument) e di testo, ma niente immagini,
// che di solito sono screenshot e Claude rilegge subito con Read, dove il link c'è già.
const ESTENSIONI_PRODOTTI = 'pdf|docx?|xlsx|xlsm|xls|pptx?|odt|ods|odp|rtf|epub|md|markdown|txt|csv|tsv|html?|svg'
const PERCORSO_PRODOTTO = new RegExp(
  `"([^"]+\\.(?:${ESTENSIONI_PRODOTTI}))"|'([^']+\\.(?:${ESTENSIONI_PRODOTTI}))'|([^\\s"'<>|;&()=,]+\\.(?:${ESTENSIONI_PRODOTTI}))(?![\\w.])`,
  'gi',
)
// Margine per i file system che arrotondano l'ora di modifica (FAT, SMB) e per un orologio che salta di poco.
const TOLLERANZA_MS = 2000
// Un server lanciato in background stampa il suo indirizzo quando è pronto: si guarda il suo output per due minuti.
const SORVEGLIANZA_MS = 120_000
const MAX_OUTPUT_URL = 1024 * 1024

function stringa(valore: unknown): string | null {
  return typeof valore === 'string' ? valore : null
}

function percorsoInput(chiamata: Chiamata): string | null {
  return stringa((chiamata.input as { file_path?: unknown } | null | undefined)?.file_path)
}

/** I percorsi di documenti citati in un comando, nell'ordine e senza doppioni; esistano o no. */
export function percorsiNelComando(comando: string): string[] {
  const visti = new Set<string>()
  for (const m of comando.matchAll(PERCORSO_PRODOTTO)) visti.add((m[1] ?? m[2] ?? m[3])!)
  return [...visti]
}

function assoluto(path: string, cwd: string): string {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path)) return path
  return `${cwd.replace(/[\\/]+$/, '')}/${path.replace(/^\.[\\/]/, '')}`
}

function immagineLetta(chiamata: Chiamata): Link | null {
  const path = percorsoInput(chiamata)
  const output = chiamata.output as { type?: unknown; file?: Record<string, unknown> } | null | undefined
  if (output?.type !== 'image' || !output.file) return null
  const { base64, type, dimensions } = output.file as {
    base64?: unknown
    type?: unknown
    dimensions?: { displayWidth?: number; displayHeight?: number }
  }
  if (typeof base64 !== 'string') return null
  const png = type === 'image/png' ? base64 : null
  const size =
    dimensions?.displayWidth && dimensions.displayHeight
      ? { width: dimensions.displayWidth, height: dimensions.displayHeight }
      : png
        ? pngSize(png)
        : null
  const id = chiamata.tool_use_id ?? path
  return id ? { id, tipo: 'file', destinazione: path, png, size } : null
}

// Le Read di documenti e di codice restano fuori: Claude rilegge CLAUDE.md e i sorgenti di continuo.
function fileScritto(chiamata: Chiamata): Link | null {
  const output = chiamata.output as { filePath?: unknown; structuredPatch?: unknown } | null | undefined
  const path = stringa(output?.filePath) ?? percorsoInput(chiamata)
  if (!path) return null
  const id = chiamata.tool_use_id ?? path
  if (DOCUMENTO_TESTO.test(path)) return { id, tipo: 'file', destinazione: path, png: null, size: null }
  return { id, tipo: 'editor', destinazione: path, riga: rigaModificata(output?.structuredPatch), png: null, size: null }
}

/** I link da mettere sotto la riga del tool. `immagini` false: niente link alle immagini lette. */
export function daAprire(chiamata: Chiamata, immagini = true, trovati: Trovati = {}): Link[] {
  if (chiamata.isErrored || chiamata.output === undefined) return []
  if (chiamata.tool === 'Read') {
    const letta = immagini ? immagineLetta(chiamata) : null
    return letta ? [letta] : []
  }
  if (chiamata.tool === 'Write' || chiamata.tool === 'Edit') {
    const scritto = fileScritto(chiamata)
    return scritto ? [scritto] : []
  }
  const base = chiamata.tool_use_id ?? 'comando'
  return [
    ...(trovati.prodotti ?? []).map((path, i): Link => ({ id: `${base}-${i}`, tipo: 'file', destinazione: path, png: null, size: null })),
    ...(trovati.url ?? []).map((url, i): Link => ({ id: `${base}-url-${i}`, tipo: 'url', destinazione: url, png: null, size: null })),
  ]
}

// Le righe del transcript non portano quello che serve: l'output di Read non ha il percorso, e cosa ha
// prodotto un comando si sa solo guardando il disco quando è finito. Lo lascia qui tool.call.
const percorsi = new Map<string, string>()
const trovatiComandi = atom({ plugin: 'infobar', key: 'trovatiComandi' } as const, { prodotti: [], url: [] } as { prodotti: string[]; url: string[] })

function nomeFile(path: string | null): string {
  return path?.split(/[\\/]/).pop() || 'immagine'
}

type Opzioni = { editor?: string }

async function conLink(
  $: EngineInterface,
  e: RenderInput<'ToolGroup' | 'ToolResult'>,
  sopra: RenderElement,
  links: Link[],
  modo: Anteprima | null,
  opzioni: Opzioni,
): Promise<RenderElement> {
  if (e.surface !== 'terminal') return sopra
  const { Box, Button, Image, Text } = $.ui.resolve(e)

  const pulsante = async (link: Link) => {
    const { destinazione: dove } = link
    if (!dove) return <Text dimColor>{nomeFile(dove)}</Text>
    let verbo = 'apri'
    let testo = nomeFile(dove)
    let azione = () => apri($, dove)
    if (link.tipo === 'url') {
      testo = etichettaUrl(dove)
      azione = () => apriUrl($, dove)
    } else if (link.tipo === 'editor') {
      const editor = await editorPer($, dove, opzioni.editor)
      if (!editor) return null
      const riga = link.riga ?? 1
      verbo = NOMI_EDITOR[editor]
      testo = `${testo}:${riga}`
      azione = () => apriInEditor($, editor, dove, riga)
    }
    return (
      <Button key={`apri-${link.id}`} plain onPress={azione}>
        <Text color="cyan" bold>{`↗ ${verbo} `}</Text>
        <Text color="cyan">{testo}</Text>
      </Button>
    )
  }

  const riquadri: RenderElement[] = []
  for (const link of links) {
    const bottone = await pulsante(link)
    if (!bottone) continue
    const { png } = link
    // A mezzi blocchi uno screenshot non si legge: nel transcript solo l'immagine vera, dove il terminale la sa disegnare.
    if (modo !== 'immagini' || !png) {
      riquadri.push(<Box key={link.id}>{bottone}</Box>)
      continue
    }
    const { columns, rows } = fitCells(link.size)
    const path = link.destinazione
    riquadri.push(
      <Box key={link.id} flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
        <Image
          key={`lettura-${link.id}`}
          source={png.length * 0.75 <= MAX_PNG_INLINE || !path ? { png } : { file: path, format: 'png' }}
          columns={columns}
          rows={rows}
          alt={`[${nomeFile(path)}]`}
        />
        {bottone}
      </Box>,
    )
  }
  if (!riquadri.length) return sopra

  return (
    <Box flexDirection="column">
      {sopra}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
        {riquadri}
      </Box>
    </Box>
  )
}

async function cercaProdotti($: EngineInterface, comando: string, inizio: number): Promise<string[]> {
  const citati = percorsiNelComando(comando)
  if (!citati.length) return []
  const cwd = await $.session.cwd()
  const prodotti: string[] = []
  for (const citato of citati) {
    const path = assoluto(citato, cwd)
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind === 'file' && stat.mtimeMs >= inizio - TOLLERANZA_MS) prodotti.push(path)
  }
  return prodotti
}

// Un valore per chiamata: quando arriva l'URL di un server in background si ridisegna solo la sua riga.
async function aggiungiTrovati($: EngineInterface, id: string, nuovi: Trovati) {
  await update($, memberOf(trovatiComandi, { requestId: id }), vecchi => ({
    prodotti: [...(nuovi.prodotti ?? vecchi.prodotti)],
    url: [...(nuovi.url ?? vecchi.url)],
  }))
}

async function sorvegliaOutput($: EngineInterface, id: string, taskId: string, comando: string) {
  const fine = (await $.clock.now()) + SORVEGLIANZA_MS
  const giro = async () => {
    const file = await fileOutputLavoro($, taskId)
    const letto = file ? await leggiSeCambiato($, file).catch(() => null) : null
    const url = letto ? urlNelTesto(letto.testo, comando) : []
    if (url.length) {
      await aggiungiTrovati($, id, { url })
      return
    }
    // Un server stampa il suo indirizzo all'inizio: oltre un mega di output senza URL non ne arriveranno.
    if ((letto?.dimensione ?? 0) > MAX_OUTPUT_URL) return
    if ((await $.clock.now()) < fine) $.clock.after(1000, giro)
  }
  $.clock.after(1000, giro)
}

// Solo le righe dei comandi leggono cosa hanno trovato: le altre non hanno niente da aspettare.
async function daMostrare($: EngineInterface, c: Chiamata, immagini: boolean): Promise<Link[]> {
  const comando = c.tool === 'Bash' || c.tool === 'PowerShell'
  const trovati = comando && c.tool_use_id ? await read($, memberOf(trovatiComandi, { requestId: c.tool_use_id })) : undefined
  return daAprire(c, immagini, trovati)
}

type EsitoComando = { result?: unknown; isError?: boolean }

async function conTrovati<R>($: EngineInterface, id: string, comando: string, descrizione: string | undefined, esegui: () => Promise<R>) {
  const inizio = await $.clock.now()
  const esito = await esegui()
  try {
    const { result, isError } = (esito ?? {}) as EsitoComando
    const output = result as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown } | undefined
    if (output && !isError) {
      const taskId = stringa(output.backgroundTaskId)
      if (taskId) {
        const file = fileOutputNelTesto((esito as { text?: unknown }).text?.toString() ?? '')
        if (file) ricordaFileOutput(file)
        await lavoroAvviato($, taskId, descrizione || comando, comando)
        void sorvegliaOutput($, id, taskId, comando)
      }
      else {
        const prodotti = await cercaProdotti($, comando, inizio)
        const url = urlNelTesto(`${stringa(output.stdout) ?? ''}\n${stringa(output.stderr) ?? ''}`, comando)
        if (prodotti.length || url.length) await aggiungiTrovati($, id, { prodotti, url })
      }
    }
  } catch {
    // Il link è un di più: il risultato del comando non dipende da lui.
  }
  return esito
}

/**
 * Sotto le righe dei tool nel transcript del terminale, i link per aprire cosa Claude ha letto, scritto o
 * avviato: immagini e documenti con il programma di sistema, il codice nell'editor, gli URL nel browser.
 * `anteprima` null: niente immagini. Il desktop ha già i suoi: i matcher tengono fuori ogni altra superficie.
 */
export function registraLetture(on: On, anteprima: Promise<Anteprima> | null, opzioni: Opzioni) {
  // Si aspetta la scelta del disegno solo se c'è un'immagine da disegnare: i soli link non ne dipendono.
  const modo = async (links: Link[]) => (anteprima && links.some(l => l.png) ? await anteprima : null)

  if (anteprima)
    on('tool.call', { tool: 'Read' }, async ($, e, next) => {
      const esito = await next(e)
      try {
        if ('result' in esito && !esito.isError && daAprire({ tool: 'Read', tool_use_id: e.tool_use_id, input: e, output: esito.result }).length)
          percorsi.set(e.tool_use_id, e.file_path)
      } catch {
        // Il link è un di più: un suo errore non deve mai toccare il risultato della lettura.
      }
      return esito
    })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => conTrovati($, e.tool_use_id, e.command, e.description, () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => conTrovati($, e.tool_use_id, e.command, e.description, () => next(e)))

  const immagini = anteprima !== null

  // Le chiamate raggruppate ("Read 1 file, ran 2 shell commands"): i link vanno sotto il gruppo, chiuso o aperto.
  on('ui.render', { component: 'ToolGroup', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    const links: Link[] = []
    for (const c of e.props.calls) links.push(...(await daMostrare($, c, immagini)))
    return links.length ? conLink($, e, sopra, links, await modo(links), opzioni) : sopra
  })

  // Una chiamata fuori da un gruppo ha la sua riga di risultato ("└ Read image (95.7KB)", il diff di una Edit).
  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    const links = await daMostrare($, { ...e.props, input: { file_path: percorsi.get(e.props.tool_use_id) } }, immagini)
    return links.length ? conLink($, e, sopra, links, await modo(links), opzioni) : sopra
  })
}
