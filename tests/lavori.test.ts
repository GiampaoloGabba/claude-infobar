import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { coda, conAgenti, conRiepilogo, notificaLavoro, pota } from '../hooks/lavori'
import { comandoOutput } from '../hooks/editor'
import { fileOutputNelTesto } from '../hooks/sessione'
import type { Lavoro } from '../types'

const MIN = 60_000

const shell = (id: string, extra: Partial<Lavoro> = {}): Lavoro => ({
  id,
  tipo: 'shell',
  descrizione: `cmd ${id}`,
  inizio: 0,
  stato: 'in corso',
  ...extra,
})

test('il riepilogo di fine turno aggiunge i lavori nuovi e chiude quelli spariti, lasciando stare i subagent', () => {
  const prima = [shell('a', { inizio: 100 }), shell('b'), { ...shell('ag'), tipo: 'subagent' }]
  const dopo = conRiepilogo(
    prima,
    [
      { id: 'a', type: 'shell', status: 'running', description: 'cmd a', command: 'pnpm dev' },
      { id: 'w', type: 'workflow', status: 'running', description: 'review', name: 'review-changes' },
      { id: 'x', type: 'subagent', status: 'running', description: 'esplora' },
    ],
    5000,
  )
  expect(dopo.find(l => l.id === 'a')).toMatchObject({ stato: 'in corso', inizio: 100, comando: 'pnpm dev' })
  expect(dopo.find(l => l.id === 'b')).toMatchObject({ stato: 'finito', fine: 5000 })
  expect(dopo.find(l => l.id === 'w')).toMatchObject({ tipo: 'workflow', descrizione: 'review-changes', stato: 'in corso', inizio: 5000 })
  expect(dopo.find(l => l.id === 'ag')?.stato).toBe('in corso')
  expect(dopo.find(l => l.id === 'x')).toBeUndefined()
})

test('dagli agenti: quelli in corso entrano, quelli finiti chiudono il loro lavoro con l\'esito', () => {
  const prima = [{ ...shell('ag1'), tipo: 'subagent' }]
  const dopo = conAgenti(
    prima,
    [
      { id: 'ag1', description: 'review', status: 'failed' },
      { id: 'ag2', description: 'esplora', status: 'running' },
      { id: 'ag3', description: 'vecchio', status: 'completed' },
    ],
    7000,
  )
  expect(dopo.find(l => l.id === 'ag1')).toMatchObject({ stato: 'fallito', fine: 7000 })
  expect(dopo.find(l => l.id === 'ag2')).toMatchObject({ tipo: 'subagent', stato: 'in corso' })
  expect(dopo.find(l => l.id === 'ag3')).toBeUndefined()
})

test('la notifica di fine di un lavoro dice quale e come è finito', () => {
  const notifica = (status: string) => `<task-notification>\n<task-id>bx1</task-id>\n<status>${status}</status>\n</task-notification>`
  expect(notificaLavoro(notifica('completed'))).toEqual({ id: 'bx1', stato: 'completato' })
  expect(notificaLavoro(notifica('failed'))).toEqual({ id: 'bx1', stato: 'fallito' })
  expect(notificaLavoro(notifica('killed'))).toEqual({ id: 'bx1', stato: 'fermato' })
  expect(notificaLavoro('ciao')).toBeNull()
})

test('la coda dell\'output: le ultime righe non vuote, senza colori', () => {
  expect(coda('uno\n\x1b[32mdue\x1b[0m\n\ntre   \nquattro\n\n')).toEqual(['due', 'tre', 'quattro'])
  expect(coda('')).toEqual([])
})

test('i lavori finiti spariscono dopo dieci minuti, quelli in corso mai', () => {
  const ora = 60 * MIN
  const lista = [shell('vivo', { inizio: 0 }), shell('fresco', { stato: 'completato', fine: ora - 5 * MIN }), shell('vecchio', { stato: 'completato', fine: ora - 11 * MIN })]
  expect(pota(lista, ora).map(l => l.id)).toEqual(['vivo', 'fresco'])
})

const PANNELLO = {
  plugin: 'infobar',
  component: 'Pane',
  requestId: 'lavori',
  surface: 'terminal',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Lavori in background', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const BS = String.fromCharCode(92)
const posix = (p: string) => p.replaceAll(BS, '/')
const CARTELLA = 'C:/Temp/claude/E--work/sess-1/tasks'

type Ospite = { fermati: unknown[]; comandi: string[][]; file: Record<string, string>; tasks: string; letture: Record<string, number> }

function ospite(on: On, sessione = 'sess-1'): Ospite {
  const o: Ospite = { fermati: [], comandi: [], file: {}, tasks: CARTELLA, letture: {} }
  const env: Record<string, string> = { OS: 'Windows_NT', TEMP: `C:${BS}Temp` }
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('session.id', () => ({ value: sessione }))
  on('fs.list', ($, e) => {
    const sotto = `${posix(e.path)}/`
    const nomi = new Set(Object.keys(o.file).filter(f => f.startsWith(sotto)).map(f => f.slice(sotto.length).split('/')[0]!))
    return { value: [...nomi].map(name => ({ name, kind: 'dir' })) } as never
  })
  on('session.root', () => ({ value: `E:${BS}work` }))
  on('fs.exists', ($, e) => ({ value: Object.keys(o.file).some(p => p === posix(e.path) || p.startsWith(`${posix(e.path)}/`)) }))
  on('fs.stat', ($, e) => {
    const contenuto = o.file[posix(e.path)]
    return contenuto === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: contenuto.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    o.letture[posix(e.path)] = (o.letture[posix(e.path)] ?? 0) + 1
    const contenuto = o.file[posix(e.path)]
    return contenuto === undefined ? { deny: 'ENOENT' } : { value: contenuto }
  })
  on('process.run', ($, e) => {
    o.comandi.push([...e.argv])
    const trovato = e.argv[0] === 'where.exe' && e.argv[1] === 'code'
    return { value: { exitCode: e.argv[0] === 'where.exe' && !trovato ? 1 : 0, stdout: trovato ? 'code\r\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.Stop', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.cwd', () => ({ value: `E:${BS}work` }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('tool.call', ($, e) => {
    if (e.tool !== 'Bash') return (o.fermati.push(e), { result: { message: 'stopped' } })
    const id = 'b9'
    const file = `${o.tasks.replaceAll('/', BS)}${BS}${id}.output`
    return {
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id },
      text: `Command running in background with ID: ${id}. Output is being written to: ${file}`,
    } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'lavori' }] }) as never)
  on('agent.list', () => ({ value: [] }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))
  return o
}

test('il pannello elenca i lavori; "ferma" chiede conferma e al secondo clic chiama TaskStop', async ($, on) => {
  mock.clock(on)
  const o = ospite(on)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'server di sviluppo', command: 'pnpm dev' },
      { id: 'w1', type: 'workflow', status: 'running', description: 'review', name: 'review-changes' },
    ],
  } as never)

  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'IN CORSO · 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ server di sviluppo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'pnpm dev' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⚙ review-changes' })).toBeDefined()

  await ui.press({ key: 'ferma-b1' })
  expect(o.fermati).toEqual([])
  expect(await ui.find({ type: 'Text', text: ' ■ ferma? clicca di nuovo ' })).toBeDefined()

  await ui.press({ key: 'ferma-b1' })
  expect(o.fermati).toMatchObject([{ tool: 'TaskStop', task_id: 'b1' }])
  expect(await ui.find({ type: 'Text', text: 'FINITI · 1' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ferma-b1' })).toBeUndefined()
})

test('la conferma di "ferma" scade da sola', async ($, on) => {
  const clock = mock.clock(on)
  const o = ospite(on)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'server', command: 'pnpm dev' }],
  } as never)
  const ui = await $.ui.mount(PANNELLO)
  await ui.press({ key: 'ferma-b1' })
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: ' ■ ferma? clicca di nuovo ' })).toBeUndefined()
  await ui.press({ key: 'ferma-b1' })
  expect(o.fermati).toEqual([])
})

test('l\'output si apre dentro il pannello, anche di un lavoro finito, e "apri" lo porta nell\'editor in fondo', async ($, on) => {
  mock.clock(on)
  const o = ospite(on)
  o.file[`${CARTELLA}/b1.output`] = 'riga 1\nriga 2\nriga 3\nriga 4\n'
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'build', command: 'pnpm build' }],
  } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await $.command.run({ command: 'lavori', args: '' } as never)

  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'riga 1' })).toBeUndefined()
  await ui.press({ key: 'output-b1' })
  expect(await ui.find({ type: 'Text', text: 'riga 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'riga 4' })).toBeDefined()
  await ui.press({ key: 'output-b1' })
  expect(await ui.find({ type: 'Text', text: 'riga 1' })).toBeUndefined()

  await ui.press({ key: 'apri-b1' })
  expect(o.comandi.at(-1)).toEqual(['rundll32.exe', 'shell32.dll,ShellExec_RunDLL', 'code', '-g', `C:${BS}Temp${BS}claude${BS}E--work${BS}sess-1${BS}tasks${BS}b1.output:5`])
})

test('senza file di output niente pulsanti di output', async ($, on) => {
  mock.clock(on)
  ospite(on)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'w1', type: 'workflow', status: 'running', description: 'review', name: 'review' }],
  } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Button', key: 'output-w1' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'ferma-w1' })).toBeDefined()
})

test('la notifica di fine chiude il lavoro con il suo esito, anche dopo il riepilogo, e la barra non lo conta più', async ($, on) => {
  mock.clock(on)
  ospite(on)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'test lunghi', command: 'pnpm test' },
      { id: 'b2', type: 'shell', status: 'running', description: 'lint', command: 'pnpm lint' },
    ],
  } as never)
  const banda = () =>
    $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await (await banda()).find({ type: 'Text', text: '◷ 2' })).toBeDefined()

  const notifica = (id: string, status: string) =>
    $.prompt.submit({
      text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`,
      wait: false,
      origin: { kind: 'task-notification' },
    } as never)
  await notifica('b1', 'failed')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await notifica('b2', 'completed')

  expect(await (await banda()).find({ type: 'Text', text: /◷/ })).toBeUndefined()
  const pannello = await $.ui.mount(PANNELLO)
  expect(await pannello.find({ type: 'Text', text: '✗ ' })).toBeDefined()
  expect(await pannello.find({ type: 'Text', text: /completato/ })).toBeDefined()
  expect(await pannello.find({ type: 'Text', text: /finito/ })).toBeUndefined()
})

test("dopo /clear l'output resta nella cartella della prima sessione: il percorso lo dice Claude Code all'avvio", async ($, on) => {
  mock.clock(on)
  const o = ospite(on, 'sess-2')
  o.file[`${CARTELLA}/b9.output`] = 'pronto\n'
  o.file['C:/Temp/claude/E--work/sess-2/images/1.png'] = ''
  await $.tool.call({ tool: 'Bash', command: 'pnpm dev', description: 'server', run_in_background: true } as never)
  await $.command.run({ command: 'lavori', args: '' } as never)

  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: '$ server' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '│ pronto' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'output-b9' })).toBeDefined()
})

test('un lavoro che Claude ferma con TaskStop esce subito dal conto della barra', async ($, on) => {
  mock.clock(on)
  ospite(on)
  await $.tool.call({ tool: 'Bash', command: 'pnpm dev', description: 'server', run_in_background: true } as never)
  const banda = () =>
    $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await (await banda()).find({ type: 'Text', text: '◷ 1' })).toBeDefined()

  await $.tool.call({ tool: 'TaskStop', task_id: 'b9' } as never)
  expect(await (await banda()).find({ type: 'Text', text: /◷/ })).toBeUndefined()
})

test("il percorso dell'output si legge dal testo di Claude Code, anche con spazi nel nome", () => {
  const win = `C:${BS}Users${BS}Mario Rossi${BS}AppData${BS}Local${BS}Temp${BS}claude${BS}C--x${BS}s1${BS}tasks${BS}b7.output`
  expect(fileOutputNelTesto(`Command running in background with ID: b7. Output is being written to: ${win}`)).toBe(win)
  expect(fileOutputNelTesto('<output-file>/tmp/claude-501/-w/s1/tasks/b8.output</output-file>')).toBe('/tmp/claude-501/-w/s1/tasks/b8.output')
  expect(fileOutputNelTesto('Command completed')).toBeNull()
})

test('a pannello aperto un output che non cambia non si rilegge', async ($, on) => {
  const clock = mock.clock(on)
  const o = ospite(on)
  const file = `${CARTELLA}/b1.output`
  o.file[file] = 'giro 1\n'
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'contatore', command: 'node conta.js' }],
  } as never)
  await $.command.run({ command: 'lavori', args: '' } as never)
  const lettePrima = o.letture[file] ?? 0
  await clock.advance(6000)
  expect(o.letture[file]).toBe(lettePrima)

  o.file[file] += 'giro 2\n'
  await clock.advance(2000)
  expect(o.letture[file]).toBe(lettePrima + 1)
})

test("l'output si apre con l'editor, con Notepad++ in monitoraggio o con un comando proprio", () => {
  const file = 'C:/Temp/claude/x/tasks/b1.output'
  const nativo = file.replaceAll('/', BS)
  const shell = ['rundll32.exe', 'shell32.dll,ShellExec_RunDLL']
  expect(comandoOutput(undefined, file, 9, true)).toBeNull()
  expect(comandoOutput('editor', file, 9, true)).toBeNull()
  expect(comandoOutput('notepad++', file, 9, true)).toEqual([...shell, 'notepad++.exe', '-monitor', '-n9', nativo])
  expect(comandoOutput('"C:/Tools/Log Viewer/lv.exe" --tail {file}', file, 9, true)).toEqual([...shell, 'C:/Tools/Log Viewer/lv.exe', '--tail', nativo])
  expect(comandoOutput('subl', file, 9, true)).toEqual([...shell, 'subl', nativo])
  expect(comandoOutput('less +{riga} {file}', '/tmp/b1.output', 9, false)).toEqual(['less', '+9', '/tmp/b1.output'])
})
