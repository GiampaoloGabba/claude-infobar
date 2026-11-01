import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import { apri } from './apri'
import { type Size, fitCells, pngSize } from './layout'

export type Anteprima = 'immagini' | 'blocchi' | 'etichette'

/** Un file che Claude ha letto (un'immagine) o prodotto (un documento), da aprire con un clic. */
export type FileDaAprire = {
  id: string
  /** Null dove non si sa, come nella riga di risultato di una lettura in una sessione ripresa. */
  path: string | null
  /** Il PNG che ha visto Claude, in base64; null per un documento e per JPEG, GIF e WebP. */
  png: string | null
  size: Size | null
}

type Chiamata = { tool: string; tool_use_id?: string; input: unknown; output?: unknown; isErrored?: boolean }

// Un'Image con i byte inline ne accetta al massimo 2 MiB decodificati.
const MAX_PNG_INLINE = 2 * 1024 * 1024
// I documenti di testo che Claude scrive con Write o Edit; il codice no, quello si guarda nell'editor.
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

function immagineLetta(chiamata: Chiamata, path: string | null): FileDaAprire | null {
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
  return id ? { id, path, png, size } : null
}

// Le Read di documenti restano fuori: Claude rilegge CLAUDE.md e README di continuo e i link sarebbero rumore.
function documentoScritto(chiamata: Chiamata): FileDaAprire | null {
  const path = stringa((chiamata.output as { filePath?: unknown } | null | undefined)?.filePath) ?? percorsoInput(chiamata)
  if (!path || !DOCUMENTO_TESTO.test(path)) return null
  return { id: chiamata.tool_use_id ?? path, path, png: null, size: null }
}

/**
 * I file da offrire sotto la riga del tool: un'immagine letta (se `immagini`), un documento scritto o
 * modificato, o quelli che un comando ha prodotto (`prodotti`, trovati da tool.call quando è finito).
 */
export function daAprire(chiamata: Chiamata, immagini = true, prodotti: readonly string[] = []): FileDaAprire[] {
  if (chiamata.isErrored || chiamata.output === undefined) return []
  if (chiamata.tool === 'Read') {
    const letta = immagini ? immagineLetta(chiamata, percorsoInput(chiamata)) : null
    return letta ? [letta] : []
  }
  if (chiamata.tool === 'Write' || chiamata.tool === 'Edit') {
    const scritto = documentoScritto(chiamata)
    return scritto ? [scritto] : []
  }
  return prodotti.map((path, i) => ({ id: `${chiamata.tool_use_id ?? 'comando'}-${i}`, path, png: null, size: null }))
}

// Le righe del transcript non portano quello che serve: l'output di Read non ha il percorso, e cosa ha
// prodotto un comando si sa solo guardando il disco quando è finito. Lo lascia qui tool.call.
const percorsi = new Map<string, string>()
const prodottiDa = new Map<string, string[]>()

function nomeFile(path: string | null): string {
  return path?.split(/[\\/]/).pop() || 'immagine'
}

function conLink(
  $: EngineInterface,
  e: RenderInput<'ToolGroup' | 'ToolResult'>,
  sopra: RenderElement,
  files: FileDaAprire[],
  modo: Anteprima | null,
): RenderElement {
  if (e.surface !== 'terminal') return sopra
  const { Box, Button, Image, Text } = $.ui.resolve(e)

  const riquadro = (file: FileDaAprire) => {
    const { path, png } = file
    const nome = nomeFile(path)
    const link = path ? (
      <Button key={`apri-${file.id}`} plain onPress={() => apri($, path)}>
        <Text color="cyan" bold>{'↗ apri '}</Text>
        <Text color="cyan">{nome}</Text>
      </Button>
    ) : (
      <Text dimColor>{nome}</Text>
    )
    // A mezzi blocchi uno screenshot non si legge: nel transcript solo l'immagine vera, dove il terminale la sa disegnare.
    if (modo !== 'immagini' || !png) return <Box key={file.id}>{link}</Box>

    const { columns, rows } = fitCells(file.size)
    return (
      <Box key={file.id} flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
        <Image
          key={`lettura-${file.id}`}
          source={png.length * 0.75 <= MAX_PNG_INLINE || !path ? { png } : { file: path, format: 'png' }}
          columns={columns}
          rows={rows}
          alt={`[${nome}]`}
        />
        {link}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {sopra}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        {files.map(riquadro)}
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

async function conProdotti<R>($: EngineInterface, id: string, comando: string, inBackground: boolean | undefined, esegui: () => Promise<R>) {
  const inizio = await $.clock.now()
  const esito = await esegui()
  try {
    // Un comando in background non ha ancora prodotto niente quando la chiamata torna.
    if (esito && typeof esito === 'object' && 'result' in esito && !('isError' in esito && esito.isError) && !inBackground) {
      const prodotti = await cercaProdotti($, comando, inizio)
      if (prodotti.length) prodottiDa.set(id, prodotti)
    }
  } catch {
    // Il link è un di più: il risultato del comando non dipende da lui.
  }
  return esito
}

/**
 * Sotto le immagini lette e i documenti prodotti, nel transcript del terminale, un clic per aprire il file con
 * il programma di sistema (e l'immagine, dove il terminale la disegna). `anteprima` null: niente immagini.
 * Il desktop ha già i suoi: i matcher tengono fuori ogni superficie che non sia il terminale.
 */
export function registraLetture(on: On, anteprima: Promise<Anteprima> | null) {
  // Si aspetta la scelta del disegno solo se c'è un'immagine da disegnare: i soli link non ne dipendono.
  const modo = async (files: FileDaAprire[]) => (anteprima && files.some(f => f.png) ? await anteprima : null)

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

  on('tool.call', { tool: 'Bash' }, ($, e, next) => conProdotti($, e.tool_use_id, e.command, e.run_in_background, () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => conProdotti($, e.tool_use_id, e.command, e.run_in_background, () => next(e)))

  const daMostrare = (c: Chiamata) => daAprire(c, anteprima !== null, c.tool_use_id ? prodottiDa.get(c.tool_use_id) : undefined)

  // Le chiamate raggruppate ("Read 1 file, ran 2 shell commands"): i link vanno sotto il gruppo, chiuso o aperto.
  on('ui.render', { component: 'ToolGroup', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    const files = e.props.calls.flatMap(daMostrare)
    return files.length ? conLink($, e, sopra, files, await modo(files)) : sopra
  })

  // Una chiamata fuori da un gruppo ha la sua riga di risultato ("└ Read image (95.7KB)", il diff di una Edit).
  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    const files = daMostrare({ ...e.props, input: { file_path: percorsi.get(e.props.tool_use_id) } })
    return files.length ? conLink($, e, sopra, files, await modo(files)) : sopra
  })
}
