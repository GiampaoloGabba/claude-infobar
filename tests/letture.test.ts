import { expect, mock, test } from 'claude-code/testing'
import type { On, ToolGroupCall } from 'claude-code'

import { accorcia, daAprire, percorsiNelComando } from '../hooks/letture'
import { fromBase64 } from '../hooks/raster'

// 40 x 20 RGBA, rosso sopra e blu sotto.
const ROSSO_SU_BLU =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAQElEQVR4nO3VsQ0AIBDDQOP9d35GoMRC3ASWUmQNDGESJ3ESJ3ESJ3ESJ3ESt2D+kzw9scRJnMRJnMRJnLcDTjaOZAQjGy3nBAAAAABJRU5ErkJggg=='

const PATH = 'V:/Temp/qf-tab.png'

function lettura(id: string, file: Record<string, unknown>, path = PATH) {
  return {
    tool_use_id: id,
    tool: 'Read',
    input: { file_path: path },
    output: { type: 'image', file },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  }
}

const PNG = { base64: ROSSO_SU_BLU, type: 'image/png', originalSize: 120 }

function gruppo(calls: ToolGroupCall[]) {
  return {
    plugin: 'infobar',
    component: 'ToolGroup',
    viewport: { columns: 120, rows: 40 },
    props: { calls, isActive: false, isExpanded: false, isCallsOnly: true },
  } as const
}

function ospite(on: On) {
  const comandi: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('process.run', ($, e) => (comandi.push([...e.argv]), {
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Read 1 file, ran 2 shell commands'] }))
  return comandi
}

test('solo le letture riuscite di immagini hanno un\'anteprima', () => {
  expect(daAprire(lettura('a', { ...PNG, dimensions: { displayWidth: 1600, displayHeight: 1160 } }))).toEqual([
    { id: 'a', tipo: 'file', destinazione: PATH, png: ROSSO_SU_BLU, size: { width: 1600, height: 1160 }, dati: { base64: ROSSO_SU_BLU, formato: 'png' } },
  ])
  expect(daAprire(lettura('b', PNG))[0]?.size).toEqual({ width: 40, height: 20 })
  expect(daAprire(lettura('c', { base64: '/9j/4AAQ', type: 'image/jpeg', originalSize: 9 }))).toMatchObject([{ id: 'c', png: null, dati: { formato: 'jpeg' } }])
  expect(daAprire(lettura('w', { base64: 'UklGRg', type: 'image/webp', originalSize: 9 }))[0]?.dati).toBeUndefined()
  expect(daAprire({ ...lettura('d', PNG), isErrored: true })).toEqual([])
  expect(daAprire({ ...lettura('e', PNG), output: { type: 'text', file: { content: 'ciao' } } })).toEqual([])
  expect(daAprire({ ...lettura('f', PNG), tool: 'Bash' })).toEqual([])
})

test('sotto un gruppo con una lettura di immagine compare la miniatura, e un clic apre il file', { options: { anteprime: 'immagini' } }, async ($, on) => {
  mock.clock(on)
  const comandi = ospite(on)
  const bash = { tool_use_id: 'b', tool: 'Bash', input: { command: 'ls' }, output: { stdout: '' }, isRunning: false, isErrored: false, isInterrupted: false }

  const ui = await $.ui.mount({ ...gruppo([bash, lettura('r1', PNG)]), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Read 1 file, ran 2 shell commands' })).toBeDefined()
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { png: ROSSO_SU_BLU } })

  await ui.press({ key: 'apri-r1' })
  expect(comandi).toEqual([['explorer.exe', 'V:\\Temp\\qf-tab.png']])
})

test('dove il terminale non disegna immagini resta solo il link', { options: { anteprime: 'blocchi' } }, async ($, on) => {
  mock.clock(on)
  const comandi = ospite(on)
  const ui = await $.ui.mount({ ...gruppo([lettura('r1', PNG)]), surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'qf-tab.png' })).toBeDefined()
  await ui.press({ key: 'apri-r1' })
  expect(comandi).toEqual([['explorer.exe', 'V:\\Temp\\qf-tab.png']])
})

test('con miniatureLette la lettura a blocchi mostra prima … e poi i mezzi blocchi', { options: { anteprime: 'blocchi', miniatureLette: 'si' } }, async ($, on) => {
  const clock = mock.clock(on)
  ospite(on)
  const prima = await $.ui.mount({ ...gruppo([lettura('r1', PNG)]), surface: 'terminal' })
  expect(await prima.find({ type: 'Raster' })).toBeUndefined()
  expect(await prima.find({ type: 'Text', text: '…' })).toBeDefined()
  await prima.unmount()

  await clock.advance(100)
  const ui = await $.ui.mount({ ...gruppo([lettura('r1', PNG)]), surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster' })
  const { columns, rows, cells } = raster?.props as { columns: number; rows: number; cells: string }
  const parole = new Uint32Array(fromBase64(cells).buffer)
  expect([...parole.subarray(0, 3)]).toEqual([0x2580, 0xff0000, 0xff0000])
  const ultima = (columns * rows - 1) * 3
  expect([...parole.subarray(ultima, ultima + 3)]).toEqual([0x2580, 0x0000ff, 0x0000ff])
  expect(await ui.find({ type: 'Button', key: 'apri-r1' })).toBeDefined()
})

test('un JPEG ha solo il clic per aprirlo', { options: { anteprime: 'immagini' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  const jpeg = lettura('r1', { base64: '/9j/4AAQ', type: 'image/jpeg', originalSize: 9 }, 'V:/Temp/foto.jpg')
  const ui = await $.ui.mount({ ...gruppo([jpeg]), surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apri-r1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'foto.jpg' })).toBeDefined()
})

test('fuori dal terminale e con anteprime "no" il gruppo resta com\'è', { options: { anteprime: 'no' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...gruppo([lettura('r1', PNG)]), surface })
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  }
})

test('sul desktop nessuna anteprima', { options: { anteprime: 'immagini' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  const ui = await $.ui.mount({ ...gruppo([lettura('r1', PNG)]), surface: 'desktop' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apri-r1' })).toBeUndefined()
})

function scrittura(tool: 'Write' | 'Edit', id: string, path: string) {
  return { tool_use_id: id, tool, input: { file_path: path }, output: { filePath: path }, isErrored: false }
}

test('i documenti scritti o modificati si aprono col sistema, il codice nell\'editor, le letture di documenti no', () => {
  expect(daAprire(scrittura('Write', 'w', 'E:/repo/docs/piano.md'))).toEqual([
    { id: 'w', tipo: 'file', destinazione: 'E:/repo/docs/piano.md', png: null, size: null },
  ])
  expect(daAprire(scrittura('Edit', 'e', 'E:/repo/README.MARKDOWN'))[0]).toMatchObject({ tipo: 'file', destinazione: 'E:/repo/README.MARKDOWN' })
  expect(daAprire(scrittura('Write', 't', 'V:/Temp/dati.csv'))[0]).toMatchObject({ tipo: 'file', destinazione: 'V:/Temp/dati.csv' })
  expect(daAprire(scrittura('Edit', 'x', 'E:/repo/src/app.ts'))).toEqual([
    { id: 'x', tipo: 'editor', destinazione: 'E:/repo/src/app.ts', riga: 1, png: null, size: null },
  ])
  expect(daAprire({ ...scrittura('Edit', 'f', 'E:/repo/piano.md'), isErrored: true })).toEqual([])
  expect(daAprire({ ...scrittura('Write', 'r', 'E:/repo/piano.md'), output: undefined })).toEqual([])
  expect(daAprire({ ...lettura('m', PNG, 'E:/repo/CLAUDE.md'), output: { type: 'text', file: { content: '# x' } } })).toEqual([])
})

test("sotto il diff di un markdown modificato c'è il link, anche con anteprime 'no'", { options: { anteprime: 'no' } }, async ($, on) => {
  mock.clock(on)
  const comandi = ospite(on)
  const ui = await $.ui.mount({
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'e1', tool: 'Edit', output: { filePath: 'E:/repo/docs/piano.md' }, isErrored: false },
  } as never)
  expect(await ui.find({ type: 'Text', text: 'piano.md' })).toBeDefined()
  await ui.press({ key: 'apri-e1' })
  expect(comandi).toEqual([['explorer.exe', 'E:\\repo\\docs\\piano.md']])
})

test('nei comandi si trovano i percorsi dei documenti, quotati, dopo un = o nudi', () => {
  expect(
    percorsiNelComando(
      `python make.py --out=report.pdf && soffice --convert-to pdf "V:/Temp/Piano lavori.docx" -o 'out dir/tab.xlsx'; cat x.pdf.bak; ls *.png`,
    ),
  ).toEqual(['report.pdf', 'V:/Temp/Piano lavori.docx', 'out dir/tab.xlsx'])
  expect(percorsiNelComando('git status && pnpm build')).toEqual([])
})

test('sotto un comando compaiono i documenti che ha scritto, non quelli vecchi o mancanti', async ($, on) => {
  const clock = mock.clock(on)
  const comandi = ospite(on)
  await clock.advance(1_000_000)
  const ora = clock.now()
  const mtime: Record<string, number> = { 'E:/work/report.pdf': ora + 500, 'E:/work/vecchio.docx': ora - 3_600_000 }
  on('session.cwd', () => ({ value: 'E:/work' }))
  // Il motore passa agli hook fs percorsi nativi: su un host Windows con le barre rovesciate.
  on('fs.stat', ($, e) => {
    const quando = mtime[e.path.replaceAll(String.fromCharCode(92), '/')]
    return quando === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: 10, mtimeMs: quando, isLink: false } }
  })
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'PowerShell', command: 'python make.py report.pdf vecchio.docx manca.xlsx', tool_use_id: 'p1' } as never)
  const ui = await $.ui.mount({
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: 'p1', tool: 'PowerShell', output: { stdout: '' }, isErrored: false },
  } as never)
  expect(await ui.find({ type: 'Text', text: 'report.pdf' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'vecchio.docx' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'manca.xlsx' })).toBeUndefined()
  await ui.press({ key: 'apri-p1-0' })
  expect(comandi.at(-1)).toEqual(['explorer.exe', 'E:' + String.fromCharCode(92) + 'work' + String.fromCharCode(92) + 'report.pdf'])
})

function screenshotCreato(on: On, ora: number, stdout = '') {
  on('session.cwd', () => ({ value: 'V:/Temp' }))
  on('fs.stat', ($, e) =>
    e.path.replaceAll(String.fromCharCode(92), '/') === PATH
      ? { value: { kind: 'file', size: 120, mtimeMs: ora + 500, isLink: false } }
      : { deny: 'ENOENT' },
  )
  on('fs.read', () => ({ value: { base64: ROSSO_SU_BLU } }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }))
}

test('un file dal nome composto mentre il comando gira si trova nell\'output, ma non da chi elenca file', { options: { anteprime: 'blocchi' } }, async ($, on) => {
  const clock = mock.clock(on)
  ospite(on)
  screenshotCreato(on, clock.now(), 'FullName : V:\\Temp\\qf-tab.png\r\nLength   : 2020594\r\n')
  const composto = `$path = 'V:\\Temp\\shot-' + (Get-Date -Format 'HHmmss') + '.png'; $bmp.Save($path); Get-Item $path | Format-List`
  await $.tool.call({ tool: 'PowerShell', command: composto, tool_use_id: 'p1' } as never)
  await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem V:\\Temp', tool_use_id: 'p2' } as never)

  const riga = (id: string, command: string) => ({ tool_use_id: id, tool: 'PowerShell', input: { command }, output: { stdout: '' }, isRunning: false, isErrored: false, isInterrupted: false })
  const ui = await $.ui.mount({ ...gruppo([riga('p1', composto), riga('p2', 'Get-ChildItem V:\\Temp')]), surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'apri-p1-0' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'apri-p2-0' })).toBeUndefined()
})

const SCREENSHOT = `$bmp.Save('${PATH}', [System.Drawing.Imaging.ImageFormat]::Png)`
const comandoScreenshot = { tool_use_id: 'p1', tool: 'PowerShell', input: { command: SCREENSHOT }, output: { stdout: '' }, isRunning: false, isErrored: false, isInterrupted: false }

test('un\'immagine creata da un comando ha il link e la miniatura letta dal disco', { options: { anteprime: 'blocchi', miniatureLette: 'si' } }, async ($, on) => {
  const clock = mock.clock(on)
  const comandi = ospite(on)
  screenshotCreato(on, clock.now())
  await $.tool.call({ tool: 'PowerShell', command: SCREENSHOT, tool_use_id: 'p1' } as never)

  await (await $.ui.mount({ ...gruppo([comandoScreenshot]), surface: 'terminal' })).unmount()
  await clock.advance(100)
  const ui = await $.ui.mount({ ...gruppo([comandoScreenshot]), surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster' })
  const parole = new Uint32Array(fromBase64((raster?.props as { cells: string }).cells).buffer)
  expect([...parole.subarray(0, 3)]).toEqual([0x2580, 0xff0000, 0xff0000])
  await ui.press({ key: 'apri-p1-0' })
  expect(comandi.at(-1)).toEqual(['explorer.exe', 'V:\\Temp\\qf-tab.png'])
})

test('creata e poi letta nello stesso gruppo, l\'immagine ha un link solo', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  ospite(on)
  screenshotCreato(on, clock.now())
  await $.tool.call({ tool: 'PowerShell', command: SCREENSHOT, tool_use_id: 'p1' } as never)

  const ui = await $.ui.mount({ ...gruppo([comandoScreenshot, lettura('r1', PNG, 'V:\\Temp\\qf-tab.png')]), surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'apri-p1-0' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apri-r1' })).toBeDefined()
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { png: ROSSO_SU_BLU } })
})

test('un nome lungo si accorcia dal mezzo, con la coda e l\'estensione', () => {
  expect(accorcia('screenshot-20261102-143616.png', 20)).toBe('screenshot…43616.png')
  expect(accorcia('prova.png', 20)).toBe('prova.png')
  expect(accorcia('a'.repeat(30), 10)).toBe(`${'a'.repeat(6)}…aaa`)
})

test('sotto l\'immagine solo la freccia e il nome, stretto quanto il riquadro', { options: { anteprime: 'immagini' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  const lungo = 'V:/Temp/screenshot-di-una-finestra-molto-lunga-20261102-143616.png'
  const ui = await $.ui.mount({ ...gruppo([lettura('r1', PNG, lungo)]), surface: 'terminal' })
  const { columns } = (await ui.find({ type: 'Image' }))?.props as { columns: number }
  expect(await ui.find({ type: 'Text', text: '↗ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: accorcia('screenshot-di-una-finestra-molto-lunga-20261102-143616.png', Math.max(columns - 2, 16)) })).toBeDefined()
})
