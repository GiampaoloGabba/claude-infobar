import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { comandoAnteprimaMosaic, comandoNotaMosaic } from '../hooks/apri'

const CLI = 'C:\\Program Files\\Mosaic\\mosaic.exe'
const IMMAGINI = 'png,jpg,jpeg,gif,bmp,tif,tiff,ico,webp'

type Esito = { exitCode: number } | { deny: string }

function ospite(on: On) {
  const o = {
    mosaic: { exitCode: 0 } as Esito,
    comandi: [] as { argv: string[]; timeoutMs?: number }[],
    env: { OS: 'Windows_NT', MOSAICMANAGER_CLI: CLI, MOSAICMANAGER_PREVIEW: IMMAGINI, MOSAICMANAGER_PREVIEW_NOTES: '1' } as Record<string, string>,
    superfici: ['terminal'] as string[],
    attesa: null as Promise<void> | null,
    clock: mock.clock(on),
  }
  on('env.get', ($, e) => ({ value: o.env[e.name] }))
  on('session.surfaces', () => ({ value: o.superfici }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('process.run', async ($, e) => {
    o.comandi.push({ argv: [...e.argv], timeoutMs: e.init?.timeoutMs })
    const esito = e.argv[0] === CLI ? o.mosaic : { exitCode: 1 }
    if (e.argv[0] === CLI && o.attesa) await o.attesa
    if ('deny' in esito) return esito
    return { value: { exitCode: esito.exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Read 1 file'] }))
  return o
}

const LETTURA_JPEG = {
  plugin: 'infobar',
  component: 'ToolGroup',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: {
    calls: [{
      tool_use_id: 'r1',
      tool: 'Read',
      input: { file_path: 'V:/Temp/foto.jpg' },
      output: { type: 'image', file: { base64: '/9j/4AAQ', type: 'image/jpeg', originalSize: 9 } },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    }],
    isActive: false,
    isExpanded: false,
    isCallsOnly: true,
  },
} as const

test("l'Anteprima di Mosaic si prova solo con le due variabili e un'estensione del suo elenco", () => {
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'V:/Temp/schermata.png')).toEqual([CLI, 'preview', 'V:/Temp/schermata.png'])
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'C:\\Users\\g\\Foto.JPEG')).toEqual([CLI, 'preview', 'C:\\Users\\g\\Foto.JPEG'])
  expect(comandoAnteprimaMosaic(CLI, 'png, md', 'E:/repo/piano.md')).toEqual([CLI, 'preview', 'E:/repo/piano.md'])
  expect(comandoAnteprimaMosaic(undefined, IMMAGINI, 'V:/Temp/a.png')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, undefined, 'V:/Temp/a.png')).toBeNull()
  expect(comandoAnteprimaMosaic('', IMMAGINI, 'V:/Temp/a.png')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, '', 'V:/Temp/a.png')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'E:/work/report.pdf')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'E:/repo/piano.md')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'V:/cartella.png/file')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, 'png,', 'V:/Temp/file.')).toBeNull()
  expect(comandoAnteprimaMosaic(CLI, IMMAGINI, 'V:/Temp/foto.png.pdf')).toBeNull()
})

test("se l'Anteprima prende l'immagine explorer non parte, e Mosaic ha al massimo 3 secondi", { options: { anteprime: 'immagini' } }, async ($, on) => {
  const o = ospite(on)
  const ui = await $.ui.mount(LETTURA_JPEG)
  await ui.press({ key: 'apri-r1' })
  expect(o.comandi).toEqual([{ argv: [CLI, 'preview', 'V:/Temp/foto.jpg'], timeoutMs: 3000 }])
})

// Il motore rifiuta process.run allo stesso modo per un avvio fallito e per il tempo scaduto: il deny copre entrambi.
test("se Mosaic la rifiuta, non risponde o non parte, l'immagine si apre come fuori da Mosaic", { options: { anteprime: 'immagini' } }, async ($, on) => {
  const o = ospite(on)
  const ui = await $.ui.mount(LETTURA_JPEG)
  for (const esito of [{ exitCode: 3 }, { exitCode: 4 }, { exitCode: 2 }, { deny: 'ENOENT' }]) {
    o.mosaic = esito
    o.comandi = []
    await ui.press({ key: 'apri-r1' })
    expect(o.comandi.map(c => c.argv)).toEqual([[CLI, 'preview', 'V:/Temp/foto.jpg'], ['explorer.exe', 'V:\\Temp\\foto.jpg']])
  }
})

test('un markdown dentro Mosaic si apre come sempre, senza chiedere a Mosaic', { options: { anteprime: 'no' } }, async ($, on) => {
  const o = ospite(on)
  const ui = await $.ui.mount({
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'e1', tool: 'Edit', output: { filePath: 'E:/repo/docs/piano.md' }, isErrored: false },
  } as never)
  await ui.press({ key: 'apri-e1' })
  expect(o.comandi.map(c => c.argv)).toEqual([['explorer.exe', 'E:\\repo\\docs\\piano.md']])
})

const PNG_LETTO = { type: 'image', file: { base64: 'iVBORw0KGgo', type: 'image/png', originalSize: 8 } }

// La nota parte senza che nessuno la aspetti: si lasciano girare le promesse in coda prima di guardare.
async function svuota() {
  for (let i = 0; i < 5000; i++) await Promise.resolve()
}

test('la nota a Mosaic chiede le due variabili, tiene solo le estensioni accettate e al massimo 50 percorsi', () => {
  expect(comandoNotaMosaic(CLI, '1', IMMAGINI, 'made', ['V:/Temp/a.png', 'E:/work/report.pdf', 'C:\\Users\\g\\Foto.JPG'])).toEqual([
    CLI, 'preview', '--note', 'made', 'V:/Temp/a.png', 'C:\\Users\\g\\Foto.JPG',
  ])
  expect(comandoNotaMosaic(CLI, '1', IMMAGINI, 'read', ['V:/Temp/a.png'])).toEqual([CLI, 'preview', '--note', 'read', 'V:/Temp/a.png'])
  expect(comandoNotaMosaic(undefined, '1', IMMAGINI, 'read', ['V:/Temp/a.png'])).toBeNull()
  expect(comandoNotaMosaic(CLI, undefined, IMMAGINI, 'read', ['V:/Temp/a.png'])).toBeNull()
  expect(comandoNotaMosaic(CLI, '', IMMAGINI, 'read', ['V:/Temp/a.png'])).toBeNull()
  expect(comandoNotaMosaic(CLI, '1', undefined, 'read', ['V:/Temp/a.png'])).toBeNull()
  expect(comandoNotaMosaic(CLI, '1', IMMAGINI, 'made', ['E:/work/report.pdf', 'E:/repo/piano.md'])).toBeNull()
  const tanti = Array.from({ length: 60 }, (_, i) => `V:/Temp/shot-${i}.png`)
  expect(comandoNotaMosaic(CLI, '1', IMMAGINI, 'made', tanti)).toEqual([CLI, 'preview', '--note', 'made', ...tanti.slice(0, 50)])
})

test("un'immagine letta va a Mosaic anche con le anteprime spente, e la lettura non aspetta la nota", { options: { anteprime: 'no' } }, async ($, on) => {
  const o = ospite(on)
  let rilascia = () => {}
  o.attesa = new Promise<void>(r => (rilascia = r))
  on('tool.call', () => ({ result: PNG_LETTO }))
  const esito = await $.tool.call({ tool: 'Read', file_path: 'V:/Temp/schermata.png', tool_use_id: 'r1' } as never)
  expect(esito).toMatchObject({ result: PNG_LETTO })
  await svuota()
  expect(o.comandi).toEqual([{ argv: [CLI, 'preview', '--note', 'read', 'V:/Temp/schermata.png'], timeoutMs: 3000 }])
  rilascia()
})

test('niente nota per un file che non è un\'immagine, senza MOSAICMANAGER_PREVIEW_NOTES o fuori dal terminale', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const o = ospite(on)
  const risposta = 'V:/Temp/codex/last-message.md'
  let risultato: unknown = { type: 'text', file: { filePath: risposta, content: '# esito', numLines: 1 } }
  on('tool.call', () => ({ result: risultato }))
  o.env.MOSAICMANAGER_PREVIEW = 'png,md'
  await $.tool.call({ tool: 'Read', file_path: risposta, tool_use_id: 'r1' } as never)
  await svuota()
  risultato = PNG_LETTO
  delete o.env.MOSAICMANAGER_PREVIEW_NOTES
  await $.tool.call({ tool: 'Read', file_path: 'V:/Temp/schermata.png', tool_use_id: 'r2' } as never)
  await svuota()
  o.env.MOSAICMANAGER_PREVIEW_NOTES = '1'
  o.superfici = ['desktop']
  await $.tool.call({ tool: 'Read', file_path: 'V:/Temp/schermata.png', tool_use_id: 'r3' } as never)
  await svuota()
  expect(o.comandi).toEqual([])
})

test('se Mosaic rifiuta la nota o non parte, la lettura resta quella e non compare nessun avviso', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const o = ospite(on)
  const avvisi: string[] = []
  on('ui.toast', ($, e) => (avvisi.push(JSON.stringify(e)), { value: undefined }) as never)
  on('tool.call', () => ({ result: PNG_LETTO }))
  for (const esito of [{ exitCode: 2 }, { deny: 'ENOENT' }]) {
    o.mosaic = esito
    expect(await $.tool.call({ tool: 'Read', file_path: 'V:/Temp/schermata.png', tool_use_id: 'r1' } as never)).toMatchObject({ result: PNG_LETTO })
  }
  await svuota()
  expect(o.comandi.map(c => c.argv[3])).toEqual(['read', 'read'])
  expect(avvisi).toEqual([])
})

async function comandoCheCrea(on: On, o: ReturnType<typeof ospite>, creati: string[], stdout = '') {
  await o.clock.advance(1_000_000)
  const ora = o.clock.now()
  const lette: string[] = []
  on('session.cwd', () => ({ value: 'V:/Temp' }))
  on('fs.stat', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    lette.push(path)
    return creati.includes(path) ? { value: { kind: 'file', size: 10, mtimeMs: ora + 500, isLink: false } } : { deny: 'ENOENT' }
  })
  const risultato = { stdout, stderr: '', interrupted: false }
  on('tool.call', () => ({ result: risultato }))
  return { risultato, lette }
}

function nota(...paths: string[]) {
  return { argv: [CLI, 'preview', '--note', 'made', ...paths], timeoutMs: 3000 }
}

test('un comando che crea immagini manda una nota sola con quelle, non con gli altri file', { options: { anteprime: 'no' } }, async ($, on) => {
  const o = ospite(on)
  const creati = ['V:/Temp/shot-1.png', 'V:/Temp/shot-2.jpg', 'V:/Temp/report.pdf']
  const { risultato } = await comandoCheCrea(on, o, creati)
  const esito = await $.tool.call({ tool: 'PowerShell', command: `python grafici.py ${creati.join(' ')}`, tool_use_id: 'p1' } as never)
  expect(esito).toMatchObject({ result: risultato })
  await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'b1' } as never)
  await svuota()
  expect(o.comandi).toEqual([nota('V:/Temp/shot-1.png', 'V:/Temp/shot-2.jpg')])
})

test('la nota prende le estensioni di Mosaic, anche quelle che non hanno un link', { options: { anteprime: 'no' } }, async ($, on) => {
  const o = ospite(on)
  await comandoCheCrea(on, o, ['V:/Temp/shot.bmp'])
  await $.tool.call({ tool: 'PowerShell', command: 'magick schema.svg V:/Temp/shot.bmp', tool_use_id: 'p1' } as never)
  await svuota()
  expect(o.comandi).toEqual([nota('V:/Temp/shot.bmp')])
})

const COMPOSTO = `1..4 | % { $p = "V:/Temp/shot-$_-" + (Get-Date -Format 'HHmmss') + '.png'; $bmp.Save($p); $p }`

test("un'immagine stampata da uno script arriva nella nota anche oltre i tre link e dopo i documenti", { options: { anteprime: 'immagini' } }, async ($, on) => {
  const o = ospite(on)
  const shot = [1, 2, 3, 4].map(i => `V:/Temp/shot-${i}-101500.png`)
  const documenti = ['V:/Temp/a.pdf', 'V:/Temp/b.docx', 'V:/Temp/c.xlsx']
  await comandoCheCrea(on, o, [...shot, ...documenti], [...documenti, ...shot].join('\r\n'))
  await $.tool.call({ tool: 'PowerShell', command: COMPOSTO, tool_use_id: 'p1' } as never)
  await svuota()
  expect(o.comandi).toEqual([nota(...shot)])

  const ui = await $.ui.mount({
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'p1', tool: 'PowerShell', output: { stdout: '' }, isErrored: false },
  } as never)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['apri-p1-0', 'apri-p1-1', 'apri-p1-2'])
  expect(await ui.find({ type: 'Text', text: 'a.pdf' })).toBeDefined()
})

test('senza MOSAICMANAGER_PREVIEW_NOTES un comando legge il disco come sempre e non avvia processi', { options: { anteprime: 'no' } }, async ($, on) => {
  const o = ospite(on)
  delete o.env.MOSAICMANAGER_PREVIEW_NOTES
  const { lette } = await comandoCheCrea(on, o, ['V:/Temp/shot.png', 'V:/Temp/shot.bmp'])
  await $.tool.call({ tool: 'PowerShell', command: 'python cattura.py V:/Temp/shot.png V:/Temp/shot.bmp', tool_use_id: 'p1' } as never)
  await svuota()
  expect(lette).toEqual(['V:/Temp/shot.png'])
  expect(o.comandi).toEqual([])
})
