import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { blocchiDiCodice, chiudeRisposta, citazioni, etichetteBlocchi, tabelle } from '../hooks/copia'

const RISPOSTA = [
  'Lancia questo:',
  '',
  '```bash',
  'pnpm install',
  'pnpm dev',
  '```',
  '',
  'e poi:',
  '',
  '~~~',
  '{ "a": 1 }',
  '~~~',
].join('\n')

test('i blocchi di codice recintati, con backtick o tilde, con o senza lingua', () => {
  expect(blocchiDiCodice(RISPOSTA)).toEqual([
    { lingua: 'bash', testo: 'pnpm install\npnpm dev' },
    { lingua: '', testo: '{ "a": 1 }' },
  ])
  expect(blocchiDiCodice('````md\n```js\nx\n```\n````')).toEqual([{ lingua: 'md', testo: '```js\nx\n```' }])
  expect(blocchiDiCodice('solo testo con `codice` in linea')).toEqual([])
})

test('i pulsanti dei blocchi si chiamano per lingua, numerati solo se due si chiamerebbero uguale', () => {
  const b = (lingua: string) => ({ lingua, testo: '' })
  expect(etichetteBlocchi([b('bash'), b('json'), b('')])).toEqual(['bash', 'json', 'codice'])
  expect(etichetteBlocchi([b('bash'), b(''), b('bash'), b('')])).toEqual(['bash 1', 'codice 1', 'bash 2', 'codice 2'])
})

function ospite(on: On) {
  const copiati: string[] = []
  on('ui.copy', ($, e) => (copiati.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))
  return copiati
}

function messaggio(surface: 'terminal' | 'desktop', props: Record<string, unknown>) {
  return { plugin: 'infobar', component: 'AssistantMessage', surface, viewport: { columns: 120, rows: 40 }, props } as never
}

test('una risposta offre di copiare il testo e ogni blocco di codice, e dice per un attimo che ha copiato', async ($, on) => {
  const clock = mock.clock(on)
  const copiati = ospite(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ reason: 'answer', answer: RISPOSTA, durationMs: 10, isAborted: false, turnId: 't1' } as never)
  const ui = await $.ui.mount(messaggio('terminal', { text: RISPOSTA, isFirstOfReply: true }))
  expect(await ui.find({ type: 'Text', text: 'riga del motore' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⧉ bash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⧉ codice' })).toBeDefined()

  await ui.press({ key: 'copia-codice-0' })
  await ui.press({ key: 'copia-testo' })
  expect(copiati).toEqual(['pnpm install\npnpm dev', RISPOSTA])

  // La stessa riga si ridisegna da sola: la conferma è il suo stato, non un ridisegno di tutto il transcript.
  expect(await ui.find({ type: 'Text', text: '✓ copiato' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⧉ bash' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: '✓ copiato' })).toBeUndefined()
})

test('niente pulsanti sui riassunti e sul desktop', async ($, on) => {
  mock.clock(on)
  ospite(on)
  const riassunto = await $.ui.mount(messaggio('terminal', { text: RISPOSTA, isFirstOfReply: false, isSummary: true }))
  expect(await riassunto.find({ type: 'Button' })).toBeUndefined()
  const desktop = await $.ui.mount(messaggio('desktop', { text: RISPOSTA, isFirstOfReply: true }))
  expect(await desktop.find({ type: 'Button' })).toBeUndefined()
})

test('con copia "no" niente pulsanti', { options: { copia: 'no' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  const ui = await $.ui.mount(messaggio('terminal', { text: RISPOSTA, isFirstOfReply: true }))
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
})

test('la riga di un comando offre di copiarlo, quella di un altro tool no', async ($, on) => {
  mock.clock(on)
  const copiati = ospite(on)
  const riga = (tool: string, input: unknown) =>
    $.ui.mount({
      plugin: 'infobar',
      component: 'ToolUse',
      surface: 'terminal',
      viewport: { columns: 120, rows: 40 },
      props: { tool_use_id: 't1', tool, input, isRunning: false, isErrored: false, isInterrupted: false },
    } as never)

  const comando = await riga('PowerShell', { command: 'Get-ChildItem -Recurse | Measure-Object' })
  await comando.press({ key: 'copia-comando' })
  expect(copiati).toEqual(['Get-ChildItem -Recurse | Measure-Object'])

  const lettura = await riga('Read', { file_path: 'E:/x.cs' })
  expect(await lettura.find({ type: 'Button' })).toBeUndefined()
})

test("un blocco chiude la risposta quando ne è la fine", () => {
  const risposta = 'Controllo la cartella.\n\nFatto: è vuota.'
  expect(chiudeRisposta('Fatto: è vuota.', [risposta])).toBe(true)
  expect(chiudeRisposta('Controllo la cartella.', [risposta])).toBe(false)
})

test('a metà lavoro solo codice e tabelle si copiano; il testo, anche lungo, no', async ($, on) => {
  mock.clock(on)
  ospite(on)
  const intermedio = (testo: string) => $.ui.mount(messaggio('terminal', { text: testo, isFirstOfReply: false }))
  expect(await (await intermedio('uno\ndue\ntre\nquattro')).find({ type: 'Button' })).toBeUndefined()
  const conCodice = await intermedio('Lancia:\n```sh\nls\n```')
  expect(await conCodice.find({ type: 'Button', key: 'copia-codice-0' })).toBeDefined()
  expect(await conCodice.find({ type: 'Button', key: 'copia-testo' })).toBeUndefined()
  const conTabella = await intermedio('| a | b |\n|---|---|\n| 1 | 2 |')
  expect(await conTabella.find({ type: 'Button', key: 'copia-tabella-0' })).toBeDefined()
})

test('una frase corta ha la riga di copia solo quando chiude la risposta', async ($, on) => {
  mock.clock(on)
  ospite(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const breve = (testo: string) => messaggio('terminal', { text: testo, isFirstOfReply: false })

  expect(await (await $.ui.mount(breve('Ora controllo.'))).find({ type: 'Button' })).toBeUndefined()

  await $.turn.complete({ reason: 'answer', answer: 'Ora controllo.\n\nTutto a posto.', durationMs: 10, isAborted: false, turnId: 't1' } as never)
  expect(await (await $.ui.mount(breve('Ora controllo.'))).find({ type: 'Button' })).toBeUndefined()
  expect(await (await $.ui.mount(breve('Tutto a posto.'))).find({ type: 'Button', key: 'copia-testo' })).toBeDefined()
})

test('le tabelle markdown si trovano intere, anche più di una, ma non dentro un blocco di codice', () => {
  const testo = [
    'Prima:',
    '',
    '| Passo | Cosa |',
    '| --- | :---: |',
    '| 1 | uno |',
    '| 2 | due |',
    '',
    '```md',
    '| a | b |',
    '|---|---|',
    '| x | y |',
    '```',
    '',
    '  | Solo | intestazione |',
    '  |------|--------------|',
    'Fine | con pipe | ma non tabella',
  ].join('\n')
  expect(tabelle(testo)).toEqual([
    '| Passo | Cosa |\n| --- | :---: |\n| 1 | uno |\n| 2 | due |',
    '| Solo | intestazione |\n|------|--------------|',
  ])
  expect(tabelle('una riga | con pipe |\nma niente separatore')).toEqual([])
})

test('le citazioni si copiano senza i ">", una per blocco, ma non quelle dentro un blocco di codice', () => {
  const testo = [
    'Mandagli questo:',
    '',
    '> Un\'altra sessione sta scrivendo SPEC.md.',
    '>',
    '> Quando committi, prendi solo le tue righe.',
    '',
    'Poi questo:',
    '>Seconda',
    '',
    '```md',
    '> dentro il codice',
    '```',
  ].join('\n')
  expect(citazioni(testo)).toEqual([
    "Un'altra sessione sta scrivendo SPEC.md.\n\nQuando committi, prendi solo le tue righe.",
    'Seconda',
  ])
})

test('una citazione ha il suo pulsante anche a metà lavoro', async ($, on) => {
  mock.clock(on)
  ospite(on)
  const ui = await $.ui.mount(messaggio('terminal', { text: 'Mandagli:\n\n> testo da incollare', isFirstOfReply: false }))
  expect(await ui.find({ type: 'Button', key: 'copia-citazione-0' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'copia-testo' })).toBeUndefined()
})
