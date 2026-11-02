import type { EngineInterface, On, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

export type BloccoDiCodice = { lingua: string; testo: string }
export type ModoCopia = 'sempre' | 'hover'

const RECINTO = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n([\s\S]*?)^ {0,3}\2[`~]*[ \t]*$/gm
const CONFERMA_MS = 2000

/** I blocchi di codice recintati di un markdown, nell'ordine, senza l'ultimo a capo. */
export function blocchiDiCodice(markdown: string): BloccoDiCodice[] {
  return [...markdown.matchAll(RECINTO)].map(m => ({ lingua: m[3] ?? '', testo: (m[4] ?? '').replace(/\n$/, '') }))
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

// Il pulsante appena premuto, che per un attimo dice "copiato".
let copiato: string | null = null

async function copia($: EngineInterface, testo: string, chi: string, press: UiPressArgument) {
  const esito = await $.ui.copy({ text: testo, surface: press.surface })
  if (!esito.isCopied) {
    $.ui.toast(`Copia non riuscita (${esito.reason})`, { timeoutMs: 4000 })
    return
  }
  copiato = chi
  $.ui.invalidate('ui.render')
  $.clock.after(CONFERMA_MS, () => {
    if (copiato !== chi) return
    copiato = null
    $.ui.invalidate('ui.render')
  })
}

type Pulsante = { chiave: string; etichetta: string; testo: string }

// Sotto un messaggio intermedio la riga dei pulsanti c'è solo se ha qualcosa che valga la pena copiare.
const RIGHE_MINIME = 3
// Le ultime risposte finite: il loro ultimo blocco ha sempre la riga, anche se è una frase sola.
const FINALI_TENUTE = 50
const finali: string[] = []
let attiva = false

/** Da turn.complete: la risposta appena finita, il cui ultimo blocco riceve ora la sua riga di pulsanti. */
export function rispostaFinita($: EngineInterface, testo: string) {
  if (!attiva || !testo.trim()) return
  finali.push(testo)
  if (finali.length > FINALI_TENUTE) finali.shift()
  $.ui.invalidate('ui.render')
}

/** Se il blocco chiude una risposta finita: le risposte sono il testo di turn.complete, che finisce con lui. */
export function chiudeRisposta(blocco: string, risposte: readonly string[]): boolean {
  const testo = blocco.trim()
  return testo !== '' && risposte.some(r => r.trim().endsWith(testo))
}

/** Se sotto un blocco di risposta va la riga dei pulsanti: con codice, lungo, o l'ultimo della risposta. */
export function meritaPulsanti(blocco: string, risposte: readonly string[]): boolean {
  return blocchiDiCodice(blocco).length > 0 || blocco.trim().split('\n').length >= RIGHE_MINIME || chiudeRisposta(blocco, risposte)
}

function pulsanti$($: EngineInterface, e: RenderInput<'AssistantMessage' | 'ToolUse'>, id: string, lista: Pulsante[]) {
  if (e.surface !== 'terminal') return []
  const { Button, Text } = $.ui.resolve(e)
  return lista.map(p => {
    const chi = `${id}:${p.chiave}`
    return (
      <Button key={p.chiave} plain dimColor={copiato !== chi} onPress={(press: UiPressArgument) => copia($, p.testo, chi, press)}>
        {copiato === chi ? <Text color="green">{'✓ copiato'}</Text> : <Text>{`⧉ ${p.etichetta}`}</Text>}
      </Button>
    )
  })
}

/** La riga dei pulsanti sotto il blocco, allineata al testo: si vede a quale messaggio appartiene. */
function rigaSotto($: EngineInterface, e: RenderInput<'AssistantMessage'>, sopra: RenderElement, id: string, lista: Pulsante[]): RenderElement {
  if (e.surface !== 'terminal') return sopra
  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {sopra}
      <Box flexDirection="row" columnGap={2} paddingLeft={2}>
        {pulsanti$($, e, id, lista)}
      </Box>
    </Box>
  )
}

/**
 * I pulsanti sopra l'ultima riga, a destra, senza righe in più: per un comando, dove stanno sulla sua stessa
 * riga, e per le risposte nel modo `hover`, dove compaiono solo con il puntatore sul messaggio.
 */
function aDestra(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage' | 'ToolUse'>,
  sopra: RenderElement,
  id: string,
  lista: Pulsante[],
  soloHover: boolean,
): RenderElement {
  if (e.surface !== 'terminal') return sopra
  const { Box } = $.ui.resolve(e)
  const nascosti = soloHover ? ({ display: 'none', hover: { display: 'flex' } } as const) : {}
  return (
    <Box key="copia" flexDirection="column">
      {sopra}
      <Box position="absolute" bottom={0} right={0} flexDirection="row" columnGap={1} {...nascosti}>
        {pulsanti$($, e, id, lista)}
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
    const lista = [
      { chiave: 'copia-testo', etichetta: 'copia', testo: text },
      ...blocchi.map((b, i) => ({ chiave: `copia-codice-${i}`, etichetta: etichette[i]!, testo: b.testo })),
    ]
    if (modo === 'hover') return aDestra($, e, sopra, firma(text), lista, true)
    return meritaPulsanti(text, finali) ? rigaSotto($, e, sopra, firma(text), lista) : sopra
  })

  on('ui.render', { component: 'ToolUse', surface: 'terminal' }, async ($, e, next) => {
    const sopra = await next(e)
    if (e.props.tool !== 'Bash' && e.props.tool !== 'PowerShell') return sopra
    const comando = (e.props.input as { command?: unknown } | null)?.command
    if (typeof comando !== 'string' || !comando.trim()) return sopra
    return aDestra($, e, sopra, e.props.tool_use_id, [{ chiave: 'copia-comando', etichetta: 'copia comando', testo: comando }], modo === 'hover')
  })
}
