import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { comandoAnteprimaMosaic } from '../hooks/apri'

const CLI = 'C:\\Program Files\\Mosaic\\mosaic.exe'
const IMMAGINI = 'png,jpg,jpeg,gif,bmp,tif,tiff,ico,webp'

type Esito = { exitCode: number } | { deny: string }

function ospite(on: On) {
  const o = { mosaic: { exitCode: 0 } as Esito, comandi: [] as { argv: string[]; timeoutMs?: number }[] }
  const env: Record<string, string> = { OS: 'Windows_NT', MOSAICMANAGER_CLI: CLI, MOSAICMANAGER_PREVIEW: IMMAGINI }
  mock.clock(on)
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('process.run', ($, e) => {
    o.comandi.push({ argv: [...e.argv], timeoutMs: e.init?.timeoutMs })
    const esito = e.argv[0] === CLI ? o.mosaic : { exitCode: 1 }
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
