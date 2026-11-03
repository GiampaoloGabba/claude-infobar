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

async function diffCompatto($: EngineInterface, e: RenderInput<'ToolResult'>, next: () => Promise<RenderElement>) {
  const { tool, tool_use_id: id, output } = e.props
  const conti = contaRighe(tool, output)
  if (!conti || conti.aggiunte + conti.tolte === 0) return next()
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
        {conti.nuovo ? <Text color="success">nuovo</Text> : <Text color="success">{`+${conti.aggiunte}`}</Text>}
        {conti.nuovo ? (
          <Text dimColor>{` · ${conti.aggiunte} ${conti.aggiunte === 1 ? 'riga' : 'righe'}`}</Text>
        ) : (
          <Text color="error">{` −${conti.tolte}`}</Text>
        )}
        <Text dimColor>{aperta ? '  chiudi' : conti.nuovo ? '  contenuto' : '  diff'}</Text>
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

/**
 * Nel transcript del terminale il diff di Write ed Edit diventa una riga che un clic apre lì dov'è. Con ctrl+o
 * (isExpanded) resta com'è.
 */
export function registraCompatte(on: On) {
  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    const { tool, isErrored, isExpanded } = e.props
    if (isErrored || isExpanded || (tool !== 'Write' && tool !== 'Edit')) return next(e)
    return diffCompatto($, e, () => next(e))
  })
}

/** Accanto alla riga di un gruppo chiuso (`Listed 1 directory`), quante chiamate sono fallite: Claude Code non lo dice. */
export function registraFalliti(on: On) {
  on('ui.render', { component: 'ToolGroup', surface: 'terminal' }, async ($, e, next) => {
    const { calls, isExpanded, isActive } = e.props
    const falliti = calls.filter(c => c.isErrored).length
    // Mentre gira la riga del gruppo occupa tutta la larghezza: l'avviso finirebbe sul bordo destro.
    if (!falliti || isExpanded || isActive) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // La riga del gruppo ha un margine sopra: allineato in fondo, l'avviso sta sulla riga del testo.
    return (
      <Box flexDirection="row" alignItems="flex-end">
        {await next(e)}
        <Text color="error">{`  ✗ ${falliti} ${falliti === 1 ? 'fallito' : 'falliti'}`}</Text>
      </Box>
    )
  })
}
