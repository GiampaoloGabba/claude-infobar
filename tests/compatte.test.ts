import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { contaCella, contaRighe, domandeRifiutate, fileDelComando, risposteDate } from '../hooks/compatte'

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
  expect(await (await $.ui.mount(gruppo(true))).find({ type: 'Text', text: '✗ 1 fallito' })).toBeDefined()
  for (const montato of [gruppo(false), gruppo(true, { isExpanded: true }), gruppo(true, { isActive: true })])
    expect(await (await $.ui.mount(montato)).find({ type: 'Text', text: '✗ 1 fallito' })).toBeUndefined()
})

const NL = String.fromCharCode(10)

const MERGE = {
  stdout: 'Auto-merging a.cs' + NL + 'CONFLICT (content): Merge conflict in a.cs' + NL,
  stderr: '',
  interrupted: false,
  bashEditDiff: {
    files: [
      { filePath: 'a.cs', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-x', '+y', '+z'] }] },
      { filePath: 'b.md', hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+w'] }] },
    ],
    moreFiles: 2,
  },
}

test('dei file cambiati da un comando si contano file e righe, e i conflitti di git', () => {
  expect(fileDelComando(MERGE)).toEqual({ file: 4, aggiunte: 3, tolte: 1, conflitti: true })
  expect(fileDelComando({ ...MERGE, stdout: 'Fast-forward' })?.conflitti).toBe(false)
  expect(fileDelComando({ stdout: 'ciao', stderr: '' })).toBeNull()
  expect(fileDelComando({ ...MERGE, bashEditDiff: { ...MERGE.bashEditDiff, unavailable: true } })).toBeNull()
})

test("un comando che ha cambiato file è una riga, e un clic apre l'output del motore", { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['OUTPUT DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('Bash', MERGE))
  expect(await ui.find({ type: 'Text', text: '4 file cambiati' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ✗ conflitti' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'OUTPUT DEL MOTORE' })).toBeUndefined()
  await ui.press({ key: 'diff-e1' })
  expect(await ui.find({ type: 'Text', text: 'OUTPUT DEL MOTORE' })).toBeDefined()
})

test("un comando che non ha cambiato file resta com'è", { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['OUTPUT DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('Bash', { stdout: ['a', 'b', 'c', 'd', 'e', 'f'].join(NL), stderr: '', interrupted: false }))
  expect(await ui.find({ type: 'Text', text: 'OUTPUT DEL MOTORE' })).toBeDefined()
})

test('in una cella contano solo le righe cambiate; una cella nuova o tolta conta tutte le sue', () => {
  const vecchia = ['import x', 'a = 1', 'b = 2', 'print(a)'].join(NL)
  const nuova = ['import x', 'a = 10', 'b = 20', 'c = 30', 'print(a)'].join(NL)
  expect(contaCella({ new_source: nuova, old_source: vecchia, edit_mode: 'replace' })).toEqual({ aggiunte: 3, tolte: 2, modo: 'replace' })
  expect(contaCella({ new_source: nuova, edit_mode: 'insert' })).toEqual({ aggiunte: 5, tolte: 0, modo: 'insert' })
  expect(contaCella({ new_source: '', old_source: vecchia, edit_mode: 'delete' })).toEqual({ aggiunte: 0, tolte: 4, modo: 'delete' })
  expect(contaCella({ new_source: nuova, edit_mode: 'replace', error: 'cella non trovata' })).toBeNull()
})

test('il diff di una cella è una riga, e un clic lo apre', { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['DIFF DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('NotebookEdit', { new_source: 'a' + NL + 'b', old_source: 'a', edit_mode: 'replace', cell_type: 'code' }))
  expect(await ui.find({ type: 'Text', text: '+1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeUndefined()
  await ui.press({ key: 'diff-e1' })
  expect(await ui.find({ type: 'Text', text: 'DIFF DEL MOTORE' })).toBeDefined()
})

const DOMANDE = {
  questions: [
    { question: 'Che forma preferisci?', header: 'Filtri', options: [], multiSelect: false },
    { question: 'Anche nelle connessioni?', header: 'Ovunque', options: [], multiSelect: false },
    { question: 'Senza risposta?', header: 'Altro', options: [], multiSelect: false },
  ],
  answers: { 'Che forma preferisci?': "Tutto nell'imbuto", 'Anche nelle connessioni?': 'Sì' },
  annotations: { 'Anche nelle connessioni?': { notes: 'ma non nei chip' } },
}

test('le risposte si riordinano per domanda, con le note, e senza le domande non risposte', () => {
  expect(risposteDate(DOMANDE)).toEqual([
    { titolo: 'Filtri', domanda: 'Che forma preferisci?', risposta: "Tutto nell'imbuto" },
    { titolo: 'Ovunque', domanda: 'Anche nelle connessioni?', risposta: 'Sì', note: 'ma non nei chip' },
  ])
  expect(risposteDate({ questions: DOMANDE.questions, answers: {} })).toBeNull()
})

test('ogni risposta sta sotto la sua domanda; con ctrl+o resta quella di Claude Code', { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['RISPOSTE DEL MOTORE'] }))
  const ui = await $.ui.mount(riga('AskUserQuestion', DOMANDE))
  expect(await ui.find({ type: 'Text', text: "→ Tutto nell'imbuto" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'RISPOSTE DEL MOTORE' })).toBeUndefined()
  const espanso = await $.ui.mount(riga('AskUserQuestion', DOMANDE, { isExpanded: true }))
  expect(await espanso.find({ type: 'Text', text: 'RISPOSTE DEL MOTORE' })).toBeDefined()
})

const RIFIUTO = "The user doesn't want to proceed with this tool use. The tool use was rejected."

function chiamata(input: unknown, output: unknown, extra: Record<string, unknown> = {}) {
  return {
    plugin: 'infobar',
    component: 'ToolUse',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'q1', tool: 'AskUserQuestion', input, output, isRunning: false, isErrored: true, isInterrupted: false, ...extra },
  } as never
}

test('un rifiuto elenca le domande fatte; un altro errore no', () => {
  expect(domandeRifiutate(DOMANDE, RIFIUTO)).toEqual([
    { titolo: 'Filtri', domanda: 'Che forma preferisci?' },
    { titolo: 'Ovunque', domanda: 'Anche nelle connessioni?' },
    { titolo: 'Altro', domanda: 'Senza risposta?' },
  ])
  expect(domandeRifiutate(DOMANDE, '<tool_use_error>InputValidationError</tool_use_error>')).toBeNull()
})

test('le domande rifiutate sono una riga per domanda; con ctrl+o resta quella di Claude Code', { options: { editor: 'no' } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['RIFIUTO DEL MOTORE'] }))
  const ui = await $.ui.mount(chiamata(DOMANDE, RIFIUTO))
  expect(await ui.find({ type: 'Text', text: 'Domande rifiutate:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Senza risposta?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'RIFIUTO DEL MOTORE' })).toBeUndefined()
  const espanso = await $.ui.mount(chiamata(DOMANDE, RIFIUTO, { isExpanded: true }))
  expect(await espanso.find({ type: 'Text', text: 'RIFIUTO DEL MOTORE' })).toBeDefined()
})
