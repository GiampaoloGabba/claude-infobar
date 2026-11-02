import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { comandoEditor, rigaModificata, scegliEditor } from '../hooks/editor'
import { etichettaUrl, urlNelTesto } from '../hooks/url'

const BS = String.fromCharCode(92)
const nativo = (p: string) => p.replaceAll('/', BS)
const posix = (p: string) => p.replaceAll(BS, '/')

test('la riga da aprire è la prima cambiata, non l\'inizio del contesto del diff', () => {
  expect(rigaModificata([{ newStart: 40, lines: [' a', ' b', ' c', '-x', '+y', ' d'] }])).toBe(43)
  expect(rigaModificata([{ newStart: 1, lines: ['+prima riga'] }])).toBe(1)
  expect(rigaModificata([])).toBe(1)
  expect(rigaModificata(undefined)).toBe(1)
})

test('l\'editor: quello scelto, poi l\'IDE del terminale, poi Rider per .NET e VS Code per il resto', () => {
  const entrambi = ['rider', 'code'] as const
  expect(scegliEditor('a.ts', 'rider', {}, [])).toBe('rider')
  expect(scegliEditor('a.cs', 'no', {}, entrambi)).toBeNull()
  expect(scegliEditor('a.ts', 'auto', { terminalEmulator: 'JetBrains-JediTerm' }, entrambi)).toBe('rider')
  expect(scegliEditor('a.cs', 'auto', { termProgram: 'vscode' }, entrambi)).toBe('code')
  expect(scegliEditor('src/Program.cs', 'auto', {}, entrambi)).toBe('rider')
  expect(scegliEditor('App.razor', undefined, {}, entrambi)).toBe('rider')
  expect(scegliEditor('src/app.ts', 'auto', {}, entrambi)).toBe('code')
  expect(scegliEditor('Program.cs', 'auto', {}, ['code'])).toBe('code')
  expect(scegliEditor('app.ts', 'auto', {}, [])).toBeNull()
})

test('il comando apre il file alla riga, su Windows passando da ShellExecute', () => {
  const rider = 'E:/Script/Rider.cmd'
  expect(comandoEditor('rider', rider, 'E:/repo/Program.cs', 42, true)).toEqual([
    'rundll32.exe',
    'shell32.dll,ShellExec_RunDLL',
    rider,
    '--line',
    '42',
    nativo('E:/repo/Program.cs'),
  ])
  expect(comandoEditor('code', 'code', 'E:/repo/app.ts', 7, true)).toEqual([
    'rundll32.exe',
    'shell32.dll,ShellExec_RunDLL',
    'code',
    '-g',
    `${nativo('E:/repo/app.ts')}:7`,
  ])
  expect(comandoEditor('cursor', 'cursor', '/w/app.ts', 7, false)).toEqual(['cursor', '-g', '/w/app.ts:7'])
})

test('gli URL dell\'output: senza colori, senza punteggiatura finale, senza quelli già nel comando', () => {
  const vite = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n'
  expect(urlNelTesto(vite)).toEqual(['http://localhost:5173/'])
  expect(urlNelTesto('Docs: see https://example.com/guide. Or (https://example.com/faq),')).toEqual([
    'https://example.com/guide',
    'https://example.com/faq',
  ])
  expect(urlNelTesto('{"url":"https://api.example.com/v1"}', 'curl https://api.example.com/v1')).toEqual([])
  expect(urlNelTesto('http://a.it http://b.it http://c.it http://d.it')).toHaveLength(3)
})

test('le etichette degli URL: PR per numero, host e percorso per il resto', () => {
  expect(etichettaUrl('https://github.com/o/r/pull/42')).toBe('PR #42')
  expect(etichettaUrl('https://gitlab.com/o/r/-/merge_requests/7')).toBe('PR #7')
  expect(etichettaUrl('https://github.com/o/r/pull/new/feature-x')).toBe('nuova PR')
  expect(etichettaUrl('http://localhost:5173/')).toBe('localhost:5173')
  expect(etichettaUrl(`https://example.com/${'a'.repeat(80)}`)).toHaveLength(50)
})

type Ospite = { comandi: string[][]; file: Record<string, string> }

function ospite(on: On): Ospite {
  const o: Ospite = { comandi: [], file: {} }
  const env: Record<string, string> = { OS: 'Windows_NT', TEMP: 'C:\\Temp' }
  on('env.get', ($, e) => ({ value: env[e.name] }))
  const trovati: Record<string, string> = { rider: `${nativo('E:/Script/Rider.cmd')}\r\n${nativo('E:/Script/rider')}\r\n` }
  on('process.run', ($, e) => {
    o.comandi.push([...e.argv])
    const [comando, nome = ''] = e.argv
    const stdout = comando === 'where.exe' ? (trovati[nome] ?? '') : ''
    const exitCode = comando === 'where.exe' && !stdout ? 1 : 0
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: 'E:\\work' }))
  on('session.cwd', () => ({ value: 'E:\\work' }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('fs.exists', ($, e) => ({ value: Object.keys(o.file).some(p => p === posix(e.path) || p.startsWith(`${posix(e.path)}/`)) }))
  on('fs.read', ($, e) => {
    const contenuto = o.file[posix(e.path)]
    return contenuto === undefined ? { deny: 'ENOENT' } : { value: contenuto }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))
  return o
}

function rigaRisultato(tool: string, tool_use_id: string, output: unknown) {
  return {
    plugin: 'infobar',
    component: 'ToolResult',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id, tool, output, isErrored: false },
  } as never
}

test('sotto una Edit di codice c\'è il link all\'editor, sulla riga cambiata', { options: { editor: 'rider' } }, async ($, on) => {
  mock.clock(on)
  const o = ospite(on)
  const output = { filePath: 'E:/work/src/Program.cs', structuredPatch: [{ newStart: 10, lines: [' a', ' b', '+c'] }] }
  const ui = await $.ui.mount(rigaRisultato('Edit', 'e1', output))
  expect(await ui.find({ type: 'Text', text: '↗ Rider ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Program.cs:12' })).toBeDefined()
  await ui.press({ key: 'apri-e1' })
  expect(o.comandi.at(-1)).toEqual([
    'rundll32.exe',
    'shell32.dll,ShellExec_RunDLL',
    nativo('E:/Script/Rider.cmd'),
    '--line',
    '12',
    nativo('E:/work/src/Program.cs'),
  ])
})

test('con editor "no" il codice non ha link, i documenti sì', { options: { editor: 'no' } }, async ($, on) => {
  mock.clock(on)
  ospite(on)
  const codice = await $.ui.mount(rigaRisultato('Edit', 'e1', { filePath: 'E:/work/app.ts', structuredPatch: [] }))
  expect(await codice.find({ type: 'Button' })).toBeUndefined()
  const documento = await $.ui.mount(rigaRisultato('Write', 'w1', { filePath: 'E:/work/note.md', structuredPatch: [] }))
  expect(await documento.find({ type: 'Button', key: 'apri-w1' })).toBeDefined()
})

test('un URL nell\'output di un comando diventa un link che apre il browser', async ($, on) => {
  mock.clock(on)
  const o = ospite(on)
  on('tool.call', () => ({
    result: { stdout: 'remote: Create a pull request:\nremote:   https://github.com/o/r/pull/new/feat\n', stderr: '', interrupted: false },
  }))
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat', tool_use_id: 'b1' } as never)

  const ui = await $.ui.mount(rigaRisultato('Bash', 'b1', { stdout: '' }))
  expect(await ui.find({ type: 'Text', text: 'nuova PR' })).toBeDefined()
  await ui.press({ key: 'apri-b1-url-0' })
  expect(o.comandi.at(-1)).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'https://github.com/o/r/pull/new/feat'])
})

test('un server in background: il link compare quando il suo output stampa l\'indirizzo', async ($, on) => {
  const clock = mock.clock(on)
  const o = ospite(on)
  const output = 'C:/Temp/claude/E--work/sess-1/tasks/bg1.output'
  o.file[output] = '> vite\n'
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  await $.tool.call({ tool: 'Bash', command: 'pnpm dev', run_in_background: true, tool_use_id: 'b2' } as never)

  await clock.advance(3000)
  expect(await (await $.ui.mount(rigaRisultato('Bash', 'b2', { stdout: '' }))).find({ type: 'Button' })).toBeUndefined()

  o.file[output] += '  ➜  Local:   http://localhost:5173/\n'
  await clock.advance(1000)
  const ui = await $.ui.mount(rigaRisultato('Bash', 'b2', { stdout: '' }))
  expect(await ui.find({ type: 'Text', text: 'localhost:5173' })).toBeDefined()
})
