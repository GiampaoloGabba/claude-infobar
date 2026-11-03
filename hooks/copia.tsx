import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

export type BloccoDiCodice = { lingua: string; testo: string }
export type ModoCopia = 'sempre' | 'hover'

const RECINTO = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n([\s\S]*?)^ {0,3}\2[`~]*[ \t]*$/gm
const CONFERMA_MS = 2000

/** I blocchi di codice recintati di un markdown, nell'ordine, senza l'ultimo a capo. */
export function blocchiDiCodice(markdown: string): BloccoDiCodice[] {
  return [...markdown.matchAll(RECINTO)].map(m => ({ lingua: m[3] ?? '', testo: (m[4] ?? '').replace(/\n$/, '') }))
}

const RIGA_TABELLA = /^ {0,3}\|.*\|[ \t]*$/
const SEPARATORE_TABELLA = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/

/** Le tabelle markdown fuori dai blocchi di codice, nell'ordine: intestazione, separatore e righe. */
export function tabelle(markdown: string): string[] {
  // Una tabella dentro un blocco di codice si copia già con lui.
  const righe = markdown.replace(RECINTO, m => '\n'.repeat(m.split('\n').length - 1)).split(/\r?\n/)
  const trovate: string[] = []
  for (let i = 0; i + 1 < righe.length; i++) {
    if (!RIGA_TABELLA.test(righe[i]!) || !SEPARATORE_TABELLA.test(righe[i + 1]!)) continue
    let fine = i + 2
    while (fine < righe.length && RIGA_TABELLA.test(righe[fine]!)) fine++
    trovate.push(righe.slice(i, fine).map(r => r.trim()).join('\n'))
    i = fine - 1
  }
  return trovate
}

/** Il nome del pulsante di ogni blocco: la lingua, `codice` senza; numerato solo dove due si chiamerebbero uguale. */
export function etichetteBlocchi(blocchi: readonly BloccoDiCodice[]): string[] {
  const nomi = blocchi.map(b => b.lingua || 'codice')
  const visti = new Map<string, number>()
  return nomi.map(nome => {
    if (nomi.filter(n => n === nome).length === 1) return nome
    const n = (visti.get(nome) ?? 0) + 1
    visti.set(nome, n)
    return `${nome} ${n}`
  })
}

// Un messaggio del transcript non ha un id: lo si riconosce dal testo.
function firma(testo: string): string {
  let h = 0
  for (let i = 0; i < testo.length; i++) h = (Math.imul(h, 31) + testo.charCodeAt(i)) | 0
  return `${testo.length}:${h}`
}

// Il pulsante appena premuto, che per un attimo dice "copiato": un valore per riga, così il clic ridisegna
// solo la sua. Più blocchi di una risposta condividono la riga (il messaggio): il valore dice anche quale.
const copiato = atom({ plugin: 'infobar', key: 'copiato' } as const, null as string | null)
const risposteFinite = atom({ plugin: 'infobar', key: 'risposteFinite' } as const, [] as string[])

async function copia($: EngineInterface, riga: string, testo: string, chi: string, press: UiPressArgument) {
  const esito = await $.ui.copy({ text: testo, surface: press.surface })
  if (!esito.isCopied) {
    $.ui.toast(`Copia non riuscita (${esito.reason})`, { timeoutMs: 4000 })
    return
  }
  const suo = memberOf(copiato, { requestId: riga })
  await update($, suo, () => chi)
  $.clock.after(CONFERMA_MS, async () => {
    if ((await read($, suo)) === chi) await update($, suo, () => null)
  })
}

type Pulsante = { chiave: string; etichetta: string; testo: string }

// Le ultime risposte finite: il loro ultimo blocco ha sempre la riga, anche se è una frase sola.
const FINALI_TENUTE = 50
let attiva = false

/**
 * Da turn.complete: la risposta appena finita, il cui ultimo blocco riceve ora la sua riga di pulsanti.
 */
export async function rispostaFinita($: EngineInterface, testo: string) {
  if (!attiva || !testo.trim()) return
  await update($, risposteFinite, l => [...l, testo].slice(-FINALI_TENUTE))
}

/** Se il blocco chiude una risposta finita: le risposte sono il testo di turn.complete, che finisce con lui. */
export function chiudeRisposta(blocco: string, risposte: readonly string[]): boolean {
  const testo = blocco.trim()
  return testo !== '' && risposte.some(r => r.trim().endsWith(testo))
}

async function pulsanti$($: EngineInterface, e: RenderInput<'AssistantMessage' | 'ToolUse'>, id: string, lista: Pulsante[]) {
  if (e.surface !== 'terminal') return []
  const { Button, Text } = $.ui.resolve(e)
  const premuto = await read($, memberOf(copiato, e))
  return lista.map(p => {
    const chi = `${id}:${p.chiave}`
    return (
      <Button key={p.chiave} plain dimColor={premuto !== chi} onPress={(press: UiPressArgument) => copia($, e.requestId, p.testo, chi, press)}>
        {premuto === chi ? <Text color="success">{'✓ copiato'}</Text> : <Text>{`⧉ ${p.etichetta}`}</Text>}
      </Button>
    )
  })
}

/** La riga dei pulsanti sotto il blocco, allineata al testo: si vede a quale messaggio appartiene. */
async function rigaSotto($: EngineInterface, e: RenderInput<'AssistantMessage'>, sopra: RenderElement, id: string, lista: Pulsante[]): Promise<RenderElement> {
  if (e.surface !== 'terminal') return sopra
  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {sopra}
      <Box flexDirection="row" columnGap={2} paddingLeft={2}>
        {await pulsanti$($, e, id, lista)}
      </Box>
    </Box>
  )
}

/**
 * I pulsanti sopra l'ultima riga, a destra, senza righe in più: per un comando, dove stanno sulla sua stessa
 * riga, e per le risposte nel modo `hover`, dove compaiono solo con il puntatore sul messaggio.
 */
async function aDestra(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage' | 'ToolUse'>,
  sopra: RenderElement,
  id: string,
  lista: Pulsante[],
  soloHover: boolean,
): Promise<RenderElement> {
  if (e.surface !== 'terminal') return sopra
  const { Box } = $.ui.resolve(e)
  const nascosti = soloHover ? ({ display: 'none', hover: { display: 'flex' } } as const) : {}
  return (
    <Box key="copia" flexDirection="column">
      {sopra}
      <Box position="absolute" bottom={0} right={0} flexDirection="row" columnGap={1} {...nascosti}>
        {await pulsanti$($, e, id, lista)}
      </Box>
    </Box>
  )
}

export function registraCopia(on: On, modo: ModoCopia) {
  attiva = true
  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    const { text } = e.props
    if (e.props.isSummary || !text.trim()) return sopra
    const blocchi = blocchiDiCodice(text)
    const etichette = etichetteBlocchi(blocchi)
    const tab = tabelle(text)
    const lista = [
      { chiave: 'copia-testo', etichetta: 'copia', testo: text },
      ...blocchi.map((b, i) => ({ chiave: `copia-codice-${i}`, etichetta: etichette[i]!, testo: b.testo })),
      ...tab.map((t, i) => ({ chiave: `copia-tabella-${i}`, etichetta: tab.length === 1 ? 'tabella' : `tabella ${i + 1}`, testo: t })),
    ]
    if (modo === 'hover') return aDestra($, e, sopra, firma(text), lista, true)
    if (chiudeRisposta(text, await read($, risposteFinite))) return rigaSotto($, e, sopra, firma(text), lista)
    // A metà lavoro il testo non lo copia nessuno: restano solo codice e tabelle, se ci sono.
    const pezzi = lista.slice(1)
    return pezzi.length ? rigaSotto($, e, sopra, firma(text), pezzi) : sopra
  })

  on('ui.render', { component: 'ToolUse', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    if (e.props.tool !== 'Bash' && e.props.tool !== 'PowerShell') return sopra
    const comando = (e.props.input as { command?: unknown } | null)?.command
    if (typeof comando !== 'string' || !comando.trim()) return sopra
    return aDestra($, e, sopra, e.props.tool_use_id, [{ chiave: 'copia-comando', etichetta: 'copia comando', testo: comando }], modo === 'hover')
  })
}
