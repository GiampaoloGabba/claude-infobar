import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

type Blocco = { lines?: unknown }

/** Righe aggiunte e tolte di una Write o di una Edit; null dove il risultato non ha un diff da riassumere. */
export function contaRighe(tool: string, output: unknown): { aggiunte: number; tolte: number; nuovo: boolean } | null {
  const o = output as { type?: unknown; content?: unknown; structuredPatch?: unknown } | null | undefined
  if (!o || !Array.isArray(o.structuredPatch)) return null
  if (tool === 'Write' && o.type === 'create') {
    const testo = typeof o.content === 'string' ? o.content.replace(/\r?\n+$/, '') : ''
    return { aggiunte: testo ? testo.split(/\r?\n/).length : 0, tolte: 0, nuovo: true }
  }
  let aggiunte = 0
  let tolte = 0
  for (const b of o.structuredPatch as Blocco[])
    for (const l of Array.isArray(b?.lines) ? b.lines : []) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) aggiunte++
      else if (l.startsWith('-')) tolte++
    }
  return { aggiunte, tolte, nuovo: false }
}

const aperte = atom({ plugin: 'infobar', key: 'modificheAperte' } as const, false)

type Elementi = ReturnType<EngineInterface['ui']['resolve']>

// Aperto, il contenuto può essere lungo: un secondo pulsante in fondo evita di risalire per chiuderlo.
function chiudiInFondo({ Box, Button, Text }: Elementi, chiave: string, alterna: () => unknown, rientro: number) {
  return (
    <Box paddingLeft={rientro}>
      <Button key={`${chiave}-fondo`} plain onPress={alterna}>
        <Text color="suggestion">▴ </Text>
        <Text dimColor>chiudi</Text>
      </Button>
    </Box>
  )
}

/** Le righe cambiate in una cella: senza le righe uguali in testa e in coda, come basta a un conteggio. */
export function contaCella(output: unknown): { aggiunte: number; tolte: number; modo: 'insert' | 'delete' | 'replace' } | null {
  const o = output as { new_source?: unknown; old_source?: unknown; edit_mode?: unknown; error?: unknown } | null | undefined
  if (!o || o.error || typeof o.new_source !== 'string') return null
  const righe = (t: unknown) => (typeof t === 'string' && t ? t.replace(/\r?\n+$/, '').split(/\r?\n/) : [])
  const nuove = righe(o.new_source)
  const vecchie = righe(o.old_source)
  if (o.edit_mode === 'insert') return { aggiunte: nuove.length, tolte: 0, modo: 'insert' }
  if (o.edit_mode === 'delete') return { aggiunte: 0, tolte: vecchie.length, modo: 'delete' }
  let testa = 0
  while (testa < nuove.length && testa < vecchie.length && nuove[testa] === vecchie[testa]) testa++
  let coda = 0
  while (coda < nuove.length - testa && coda < vecchie.length - testa && nuove[nuove.length - 1 - coda] === vecchie[vecchie.length - 1 - coda]) coda++
  return { aggiunte: nuove.length - testa - coda, tolte: vecchie.length - testa - coda, modo: 'replace' }
}

type Pezzo = { testo: string; colore?: string; dim?: boolean }

/** Le righe aggiunte e tolte di un comando che ha cambiato file, come Claude Code le elenca sotto il suo output. */
export function fileDelComando(output: unknown): { file: number; aggiunte: number; tolte: number; conflitti: boolean } | null {
  const o = output as { stdout?: unknown; bashEditDiff?: { files?: unknown; moreFiles?: unknown; unavailable?: unknown; skipped?: unknown } } | null | undefined
  const d = o?.bashEditDiff
  if (!d || d.unavailable || d.skipped || !Array.isArray(d.files) || !d.files.length) return null
  let aggiunte = 0
  let tolte = 0
  for (const f of d.files as { hunks?: unknown }[]) {
    const c = contaRighe('Edit', { structuredPatch: Array.isArray(f?.hunks) ? f.hunks : [] })!
    aggiunte += c.aggiunte
    tolte += c.tolte
  }
  const file = d.files.length + (typeof d.moreFiles === 'number' ? d.moreFiles : 0)
  return { file, aggiunte, tolte, conflitti: typeof o?.stdout === 'string' && /^CONFLICT\b/m.test(o.stdout) }
}

async function compatta(
  $: EngineInterface,
  e: RenderInput<'ToolResult'>,
  riassunto: Pezzo[],
  etichetta: string,
  next: () => Promise<RenderElement>,
) {
  const id = e.props.tool_use_id
  const elementi = $.ui.resolve(e)
  const { Box, Button, Text } = elementi
  const stato = memberOf(aperte, { requestId: id })
  const aperta = await read($, stato)
  const alterna = () => update($, stato, v => !v)
  // Il ⎿ lo disegna il renderer del risultato, non il motore attorno: al suo posto va rifatto.
  const testa = (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{'  ⎿'}</Text>
      <Button key={`diff-${id}`} plain onPress={alterna}>
        <Text color="suggestion">{aperta ? '▾ ' : '▸ '}</Text>
        {riassunto.map(p => (
          <Text key={p.testo} color={p.colore} dimColor={p.dim}>{p.testo}</Text>
        ))}
        <Text dimColor>{aperta ? '  chiudi' : `  ${etichetta}`}</Text>
      </Button>
    </Box>
  )
  if (!aperta) return testa
  return (
    <Box flexDirection="column">
      {testa}
      {await next()}
      {chiudiInFondo(elementi, `diff-${id}`, alterna, 5)}
    </Box>
  )
}

const plurale = (n: number, uno: string, tanti: string) => `${n} ${n === 1 ? uno : tanti}`

function diffCompatto($: EngineInterface, e: RenderInput<'ToolResult'>, next: () => Promise<RenderElement>) {
  const conti = contaRighe(e.props.tool, e.props.output)
  if (!conti || conti.aggiunte + conti.tolte === 0) return next()
  if (conti.nuovo)
    return compatta($, e, [{ testo: 'nuovo', colore: 'success' }, { testo: ` · ${plurale(conti.aggiunte, 'riga', 'righe')}`, dim: true }], 'contenuto', next)
  return compatta($, e, [{ testo: `+${conti.aggiunte}`, colore: 'success' }, { testo: ` −${conti.tolte}`, colore: 'error' }], 'diff', next)
}

function cellaCompatta($: EngineInterface, e: RenderInput<'ToolResult'>, next: () => Promise<RenderElement>) {
  const conti = contaCella(e.props.output)
  if (!conti || conti.aggiunte + conti.tolte === 0) return next()
  if (conti.modo === 'insert')
    return compatta($, e, [{ testo: 'nuova cella', colore: 'success' }, { testo: ` · ${plurale(conti.aggiunte, 'riga', 'righe')}`, dim: true }], 'contenuto', next)
  if (conti.modo === 'delete')
    return compatta($, e, [{ testo: 'cella tolta', colore: 'error' }, { testo: ` · ${plurale(conti.tolte, 'riga', 'righe')}`, dim: true }], 'contenuto', next)
  return compatta($, e, [{ testo: `+${conti.aggiunte}`, colore: 'success' }, { testo: ` −${conti.tolte}`, colore: 'error' }], 'diff', next)
}

// Un git merge o un checkout elencano sotto l'output ogni file che hanno toccato: una riga per file, oltre alle loro.
function comandoCompatto($: EngineInterface, e: RenderInput<'ToolResult'>, next: () => Promise<RenderElement>) {
  const conti = fileDelComando(e.props.output)
  if (!conti) return next()
  return compatta(
    $,
    e,
    [
      { testo: plurale(conti.file, 'file cambiato', 'file cambiati') },
      { testo: `  +${conti.aggiunte}`, colore: 'success' },
      { testo: ` −${conti.tolte}`, colore: 'error' },
      ...(conti.conflitti ? [{ testo: '  ✗ conflitti', colore: 'error' }] : []),
    ],
    'dettagli',
    next,
  )
}

/**
 * Nel transcript del terminale il diff di Write, Edit e NotebookEdit, e l'elenco dei file che un comando ha cambiato, diventano
 * una riga che un clic apre lì dov'è. Con ctrl+o (isExpanded) resta com'è.
 */
export function registraCompatte(on: On) {
  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    const { tool, isErrored, isExpanded } = e.props
    if (isErrored || isExpanded) return next(e)
    if (tool === 'Write' || tool === 'Edit') return diffCompatto($, e, () => next(e))
    if (tool === 'NotebookEdit') return cellaCompatta($, e, () => next(e))
    if (tool === 'Bash' || tool === 'PowerShell') return comandoCompatto($, e, () => next(e))
    return next(e)
  })
}

/** Sotto un gruppo chiuso (`Listed 1 directory`), quante chiamate sono fallite: la riga del gruppo non lo dice. */
export function registraFalliti(on: On) {
  on('ui.render', { component: 'ToolGroup', surface: 'terminal' }, async ($, e, next) => {
    const { calls, isExpanded, isActive } = e.props
    const falliti = calls.filter(c => c.isErrored).length
    if (!falliti || isExpanded || isActive) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Su una riga sua: il gruppo può avere righe sue (un'azione bloccata) e occupare tutta la larghezza.
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text>
          <Text dimColor>{'  ⎿ '}</Text>
          <Text color="error">{`✗ ${falliti} ${falliti === 1 ? 'fallito' : 'falliti'}`}</Text>
        </Text>
      </Box>
    )
  })
}

type Domanda = { question?: unknown; header?: unknown }

/** Le domande con la risposta data, nell'ordine in cui sono state fatte; null dove non c'è niente da riordinare. */
export function risposteDate(output: unknown): { titolo: string; domanda: string; risposta: string; note?: string }[] | null {
  const o = output as { questions?: unknown; answers?: unknown; annotations?: unknown } | null | undefined
  if (!o || !Array.isArray(o.questions) || !o.answers || typeof o.answers !== 'object') return null
  const risposte = o.answers as Record<string, unknown>
  const note = (o.annotations ?? {}) as Record<string, { notes?: unknown } | undefined>
  const righe = (o.questions as Domanda[]).flatMap(q => {
    if (typeof q?.question !== 'string') return []
    const r = risposte[q.question]
    if (typeof r !== 'string' && typeof r !== 'number') return []
    const n = note[q.question]?.notes
    return [
      {
        titolo: typeof q.header === 'string' ? q.header : '',
        domanda: q.question,
        risposta: String(r),
        ...(typeof n === 'string' && n.trim() ? { note: n.trim() } : {}),
      },
    ]
  })
  return righe.length ? righe : null
}

/** Le domande di un AskUserQuestion rifiutato, dal suo input; null se non è un rifiuto o non ce ne sono. */
export function domandeRifiutate(input: unknown, output: unknown): { titolo: string; domanda: string }[] | null {
  // Il testo è quello che legge il modello: gli altri errori (un input non valido) restano a Claude Code.
  if (typeof output !== 'string' || !/doesn.t want to proceed/i.test(output)) return null
  const q = (input as { questions?: unknown } | null | undefined)?.questions
  if (!Array.isArray(q)) return null
  const righe = (q as Domanda[]).flatMap(d =>
    typeof d?.question === 'string' ? [{ titolo: typeof d.header === 'string' ? d.header : '', domanda: d.question }] : [],
  )
  return righe.length ? righe : null
}

/** Le risposte alle domande di Claude: per ognuna la domanda in grigio e, sotto, la risposta in evidenza. */
export function registraRisposte(on: On) {
  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    if (e.props.tool !== 'AskUserQuestion' || e.props.isErrored || e.props.isExpanded) return next(e)
    const righe = risposteDate(e.props.output)
    if (!righe) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // La riga di intestazione, pallino compreso, fa parte del risultato che qui si sostituisce: va rifatta.
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>● </Text>
          <Text>{righe.length === 1 ? 'La tua risposta:' : 'Le tue risposte:'}</Text>
        </Text>
        {righe.map((r, i) => (
          <Box key={`d${i}`} flexDirection="row">
            <Text dimColor>{i === 0 ? '  ⎿ ' : '    '}</Text>
            <Box flexDirection="column" flexShrink={1}>
              <Text>
                {r.titolo ? <Text color="suggestion" bold>{`${r.titolo}  `}</Text> : null}
                <Text dimColor>{r.domanda}</Text>
              </Text>
              <Text bold>{`→ ${r.risposta}`}</Text>
              {r.note ? <Text dimColor>{`  ${r.note}`}</Text> : null}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })

  // Il risultato di un rifiuto è solo il testo per il modello: le domande stanno nell'input, che ha la riga.
  on('ui.render', { component: 'ToolUse', surface: 'terminal' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'AskUserQuestion' || !p.isErrored || p.isRunning || p.isInterrupted || p.isExpanded) return next(e)
    const righe = domandeRifiutate(p.input, p.output)
    if (!righe) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>● </Text>
          <Text>{righe.length === 1 ? 'Domanda rifiutata:' : 'Domande rifiutate:'}</Text>
        </Text>
        {righe.map((r, i) => (
          <Box key={`r${i}`} flexDirection="row">
            <Text dimColor>{i === 0 ? '  ⎿ ' : '    '}</Text>
            <Text>
              {r.titolo ? <Text color="suggestion" bold>{`${r.titolo}  `}</Text> : null}
              <Text dimColor>{r.domanda}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
