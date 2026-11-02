import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { blocchiDiCodice, chiudeRisposta, etichetteBlocchi, meritaPulsanti } from '../hooks/copia'

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

test('la riga va sotto i blocchi con codice, quelli lunghi e l\'ultimo di una risposta finita', () => {
  const risposta = 'Controllo la cartella.\n\nFatto: è vuota.'
  expect(chiudeRisposta('Fatto: è vuota.', [risposta])).toBe(true)
  expect(chiudeRisposta('Controllo la cartella.', [risposta])).toBe(false)
  expect(meritaPulsanti('Ora controllo la cartella.', [])).toBe(false)
  expect(meritaPulsanti('uno\ndue\ntre', [])).toBe(true)
  expect(meritaPulsanti('Lancia:\n```sh\nls\n```', [])).toBe(true)
  expect(meritaPulsanti('Fatto: è vuota.', [risposta])).toBe(true)
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
