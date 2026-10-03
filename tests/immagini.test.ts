import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { inflateZlib } from '../hooks/inflate'
import { fitCells, fitRow, imageNumbers, pngSize } from '../hooks/layout'
import { decodeThumbnail } from '../hooks/png'
import { fromBase64, rasterCells } from '../hooks/raster'

// 40 x 20 RGBA, rosso sopra e blu sotto, compresso da Pillow.
const ROSSO_SU_BLU =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAQElEQVR4nO3VsQ0AIBDDQOP9d35GoMRC3ASWUmQNDGESJ3ESJ3ESJ3ESJ3ESt2D+kzw9scRJnMRJnMRJnLcDTjaOZAQjGy3nBAAAAABJRU5ErkJggg=='

function testataPng(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return btoa(String.fromCharCode(...bytes))
}

function cella(celle: string, indice: number): number[] {
  const parole = new Uint32Array(fromBase64(celle).buffer)
  return [...parole.subarray(indice * 3, indice * 3 + 3)]
}

test('i numeri delle immagini vengono dal prompt, senza doppioni e in ordine', () => {
  expect(imageNumbers('guarda [Image #2] e [Image #1] e ancora [Image #2]')).toEqual([2, 1])
  expect(imageNumbers('[Image 1] [image #3] #4')).toEqual([])
})

test('le dimensioni del PNG si leggono dall\'intestazione IHDR', () => {
  expect(pngSize(testataPng(1630, 632))).toEqual({ width: 1630, height: 632 })
  expect(pngSize(btoa('\xff\xd8\xff\xe0 questo è un jpeg, non un png...'))).toBeNull()
})

test('le miniature tengono le proporzioni e la riga sta nella banda', () => {
  expect(fitCells({ width: 500, height: 500 })).toEqual({ columns: 12, rows: 6 })
  expect(fitCells({ width: 3000, height: 500 })).toEqual({ columns: 32, rows: 3 })
  expect(fitCells({ width: 100, height: 2000 })).toEqual({ columns: 4, rows: 6 })
  const quadrata = { width: 500, height: 500 }
  expect(fitRow([quadrata], 7, 120)).toEqual([{ columns: 8, rows: 4 }])
  expect(fitRow([quadrata, quadrata, quadrata], 20, 40)).toEqual([
    { columns: 10, rows: 5 },
    { columns: 10, rows: 5 },
    { columns: 10, rows: 5 },
  ])
})

test('inflate legge i blocchi non compressi e rifiuta un flusso corto', () => {
  const stored = Uint8Array.of(0x78, 0x01, 0x01, 3, 0, 0xfc, 0xff, 7, 8, 9, 0, 0, 0, 0)
  expect([...inflateZlib(stored, 3)]).toEqual([7, 8, 9])
  expect(() => inflateZlib(stored, 4)).toThrow()
})

test('un PNG diventa una miniatura con i suoi colori e le sue proporzioni', () => {
  const miniatura = decodeThumbnail(fromBase64(ROSSO_SU_BLU), 10, 10)
  expect([miniatura.width, miniatura.height]).toEqual([10, 5])
  expect([...miniatura.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255])
  expect([...miniatura.rgba.subarray(miniatura.rgba.length - 4)]).toEqual([0, 0, 255, 255])
  expect(() => decodeThumbnail(fromBase64(testataPng(10, 10)), 10, 10)).toThrow()
})

test('i mezzi blocchi mettono davanti il pixel sopra e lasciano la trasparenza al terminale', () => {
  const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0)
  const celle = rasterCells({ width: 2, height: 2, rgba }, 2, 1)
  expect(cella(celle, 0)).toEqual([0x2580, 0xff0000, 0x0000ff])
  expect(cella(celle, 1)).toEqual([0x20, 0x01000000, 0x01000000])
})

const BANDA = {
  plugin: 'infobar',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 22, bodyColumns: 120, scroll: { offset: 0, bodyRows: 22 }, view: {} },
} as const

const SUGGERIMENTO = {
  plugin: 'infobar',
  component: 'PromptHint',
  viewport: { columns: 120, rows: 40 },
  props: { isDraft: true, isWorking: false, hint: '(shift+tab to cycle)' },
} as const

type Ospite = {
  env: Record<string, string>
  root: string
  file: Record<string, string>
  bozza: string
  chiamate: Record<string, number>
  comandi: string[][]
}

function ospite(on: On, init: Omit<Ospite, 'chiamate' | 'comandi'>): Ospite {
  const o: Ospite = { ...init, chiamate: {}, comandi: [] }
  const conta = (nome: string) => (o.chiamate[nome] = (o.chiamate[nome] ?? 0) + 1)
  // Il motore passa agli hook fs percorsi nativi: su un host Windows barre rovesciate e /tmp sul disco corrente.
  const posix = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:(?=\/tmp\/)/, '')
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: o.root }))
  on('env.get', ($, e) => ({ value: o.env[e.name] }))
  on('process.run', ($, e) => (o.comandi.push([...e.argv]), {
    value: { exitCode: 0, stdout: '501\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('prompt.read', () => {
    conta('prompt.read')
    return { value: { text: o.bozza, cursor: o.bozza.length } }
  })
  on('fs.exists', ($, e) => {
    conta('fs.exists')
    const chiesto = posix(e.path)
    return { value: Object.keys(o.file).some(p => p === chiesto || p.startsWith(`${chiesto}/`)) }
  })
  on('fs.list', () => {
    conta('fs.list')
    return { value: [] }
  })
  on('fs.read', ($, e) => {
    conta('fs.read')
    return { value: { base64: o.file[posix(e.path)] ?? '' } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['banda del motore'] }))
  return o
}

test('un incolla compare quando si ridisegna il suggerimento, senza polling', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = '/tmp/claude-501/-work/sess-1/images'
  const o = ospite(on, { env: {}, root: '/work', file: { [`${cartella}/1.png`]: testataPng(800, 400) }, bozza: '' })

  await clock.advance(10_000)
  expect(o.chiamate['prompt.read'] ?? 0).toBe(0)

  o.bozza = 'guarda [Image #1] [Image #2]'
  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { file: `${cartella}/1.png`, format: 'png' }, columns: 24, rows: 6 })
  expect(await ui.find({ type: 'Text', text: 'nessuna anteprima' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'banda del motore' })).toBeDefined()
  await ui.unmount()

  // #2 non arriva mai: qualche tentativo, poi il disco resta in pace.
  await clock.advance(10_000)
  expect(o.chiamate['fs.list'] ?? 0).toBe(0)
  const esistenzeDopoTentativi = o.chiamate['fs.exists']
  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)
  expect(o.chiamate['fs.exists']).toBe(esistenzeDopoTentativi)

  o.bozza = ''
  await $.prompt.submit({ text: 'guarda [Image #1] [Image #2]', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1)
  const dopo = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await dopo.find({ type: 'Image' })).toBeUndefined()
})

test('su Windows la cache è in %TEMP%\\claude e "apri" usa explorer', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Users/me/AppData/Local/Temp/claude/C--work-app/sess-1/images'
  const o = ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' },
    root: 'C:\\work\\app',
    file: { [`${cartella}/1.png`]: testataPng(800, 400) },
    bozza: '[Image #1]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { file: `${cartella}/1.png` } })
  expect(o.chiamate['fs.list'] ?? 0).toBe(0)

  await ui.press({ key: 'apri-1' })
  expect(o.comandi).toEqual([['explorer.exe', `${cartella.replaceAll('/', '\\')}\\1.png`]])
})

test('a blocchi l\'immagine diventa una griglia di mezzi blocchi colorati', { options: { anteprime: 'blocchi' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Temp/claude/C--work/sess-1/images'
  ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Temp' },
    root: 'C:\\work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU },
    bozza: '[Image #1]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props).toMatchObject({ columns: 24, rows: 6 })
  const celle = raster?.props.cells as string
  expect(cella(celle, 0)).toEqual([0x2580, 0xff0000, 0xff0000])
  expect(cella(celle, 24 * 6 - 1)).toEqual([0x2580, 0x0000ff, 0x0000ff])
})

test('con anteprime "no" la banda non tocca il disco', { options: { anteprime: 'no' } }, async ($, on) => {
  const clock = mock.clock(on)
  const o = ospite(on, { env: {}, root: '/work', file: {}, bozza: '[Image #1]' })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(o.chiamate['prompt.read'] ?? 0).toBe(0)
  expect(o.chiamate['fs.exists'] ?? 0).toBe(0)
})

test('a etichette restano solo i tag cliccabili e i file non si leggono', { options: { anteprime: 'etichette' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Temp/claude/C--work/sess-1/images'
  const o = ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Temp' },
    root: 'C:\\work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU },
    bozza: '[Image #1] [Image #2]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'apri-1' }))?.props).toMatchObject({ label: 'Image #1', hotkey: '1' })
  expect(await ui.find({ type: 'Text', text: 'Image #2 (non trovata)' })).toBeDefined()
  expect(o.chiamate['fs.read'] ?? 0).toBe(0)

  await ui.press({ key: 'apri-1' })
  expect(o.comandi).toEqual([['explorer.exe', `${cartella.replaceAll('/', '\\')}\\1.png`]])
})
