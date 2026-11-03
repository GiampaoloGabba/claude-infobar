import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { contaRighe } from '../hooks/compatte'

const EDIT = {
  filePath: 'E:/repo/app.ts',
  structuredPatch: [
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+B', '+C', ' d'] },
    { oldStart: 20, oldLines: 2, newStart: 21, newLines: 1, lines: ['-x', ' y'] },
  ],
}

function riga(tool: string, output: unknown, extra: Record<string, unknown> = {}) {
  return {
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'e1', tool, output, isErrored: false, ...extra },
  } as never
}

test('le righe si contano dai blocchi del diff, e un file creato conta tutte le sue', () => {
  expect(contaRighe('Edit', EDIT)).toEqual({ aggiunte: 2, tolte: 2, nuovo: false })
  expect(contaRighe('Write', { type: 'create', content: 'uno\ndue\ntre\n', structuredPatch: [] })).toEqual({ aggiunte: 3, tolte: 0, nuovo: true })
  expect(contaRighe('Edit', { filePath: 'x' })).toBeNull()
})

test('il diff di una Edit è una riga con i conteggi, e un clic lo apre e lo richiude', { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['DIFF DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('Edit', EDIT))
  expect(await ui.find({ type: 'Text', text: '+2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeUndefined()
  await ui.press({ key: 'diff-e1' })
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeDefined()
  await ui.press({ key: 'diff-e1-fondo' })
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeUndefined()
})

test('con ctrl+o, in errore o con l\'opzione a no il diff resta quello del motore', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['DIFF DEL MOTORE'] }))
  for (const extra of [{ isExpanded: true }, { isErrored: true }]) {
    const ui = await $.ui.mount(riga('Edit', EDIT, extra))
    expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeDefined()
  }
})

test('con modificheCompatte a no il diff resta aperto', { options: { modificheCompatte: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['DIFF DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('Edit', EDIT))
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'diff-e1' })).toBeUndefined()
})


function gruppo(isErrored: boolean, extra: Record<string, unknown> = {}) {
  const call = { tool_use_id: 'g1', tool: 'Bash', input: { command: 'ls' }, output: { stdout: '' }, isRunning: false, isErrored, isInterrupted: false }
  return {
    plugin: 'infobar',
    component: 'ToolGroup',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { calls: [call], isActive: false, isExpanded: false, isCallsOnly: !isErrored, ...extra },
  } as never
}

const motore = (on: On) => on('ui.render', () => ({ type: 'Text', props: {}, children: ['Listed 1 directory'] }))

test('accanto al gruppo chiuso si vede quante chiamate sono fallite, e solo lì', { options: { editor: 'no' } }, async ($, on) => {
  motore(on)
  expect(await (await $.ui.mount(gruppo(true))).find({ type: 'Text', text: '  ✗ 1 fallito' })).toBeDefined()
  for (const montato of [gruppo(false), gruppo(true, { isExpanded: true }), gruppo(true, { isActive: true })])
    expect(await (await $.ui.mount(montato)).find({ type: 'Text', text: '  ✗ 1 fallito' })).toBeUndefined()
})
