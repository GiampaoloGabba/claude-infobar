import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { diffNuovo, eAnnidato, fileDaStatus, primaRigaDelDiff, righeDaNumstat, soloBlocchi, worktreeDaLista } from '../hooks/git'
import { filtraFile } from '../hooks/modifiche'

const Z = String.fromCharCode(0)
const T = String.fromCharCode(9)

// Catturati da un repository vero: c.txt rinominato, d.txt eliminato, src/a.ts modificato, un file nuovo con spazio.
const STATUS = ['R  c2.txt', 'c.txt', ' D d.txt', ' M src/a.ts', '?? src/con spazio.ts', '?? .claude/worktrees/agent-a1/', ''].join(Z)
const NUMSTAT = [`0${T}0${T}`, 'c.txt', 'c2.txt', `0${T}1${T}d.txt`, `2${T}1${T}src/a.ts`, ''].join(Z)
const DIFF_A = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index fb85c0a..2c6d4c5 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' uno',
  '-due',
  '+DUE',
  ' tre',
  '+quattro',
  '',
].join('\n')

test('git status: nuovi, modificati, eliminati e rinominati con il nome di prima', () => {
  expect(fileDaStatus(STATUS).filter(f => !eAnnidato(f))).toEqual([
    { path: 'c2.txt', stato: 'rinominato', aggiunte: null, tolte: null, da: 'c.txt' },
    { path: 'd.txt', stato: 'eliminato', aggiunte: null, tolte: null },
    { path: 'src/a.ts', stato: 'modificato', aggiunte: null, tolte: null },
    { path: 'src/con spazio.ts', stato: 'nuovo', aggiunte: null, tolte: null },
  ])
  expect(fileDaStatus(['UU conflitto.ts', 'A  aggiunto.ts', ''].join(Z)).map(f => f.stato)).toEqual(['conflitto', 'nuovo'])
  expect(fileDaStatus('')).toEqual([])
})

test('git diff --numstat: righe per file, anche dopo una rinomina, e niente numeri per i binari', () => {
  const conti = righeDaNumstat(NUMSTAT)
  expect(conti.get('c2.txt')).toEqual({ aggiunte: 0, tolte: 0 })
  expect(conti.get('d.txt')).toEqual({ aggiunte: 0, tolte: 1 })
  expect(conti.get('src/a.ts')).toEqual({ aggiunte: 2, tolte: 1 })
  expect(righeDaNumstat([`-${T}-${T}logo.png`, ''].join(Z)).get('logo.png')).toEqual({ aggiunte: null, tolte: null })
})

test('dal diff: i soli blocchi da disegnare e la prima riga cambiata', () => {
  expect(soloBlocchi(DIFF_A).split('\n')[0]).toBe('@@ -1,3 +1,4 @@')
  expect(primaRigaDelDiff(DIFF_A)).toBe(2)
  expect(primaRigaDelDiff('@@ -10,3 +10,3 @@\n a\n b\n-c\n+C')).toBe(12)
  expect(primaRigaDelDiff('')).toBe(1)
  expect(diffNuovo('a\nb\n')).toBe('@@ -0,0 +1,2 @@\n+a\n+b')
})

const RADICE = 'E:/work'

function ospite(on: On, inRepo = true) {
  const comandi: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('session.cwd', () => ({ value: 'E:\\work\\src' }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('fs.read', ($, e) => (e.path.replaceAll('\\', '/').endsWith('con spazio.ts') ? { value: 'nuovo file\ncon tre\nrighe\n' } : { deny: 'ENOENT' }))
  on('process.run', ($, e) => {
    comandi.push([...e.argv])
    const args = e.argv.join(' ')
    const risposta = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args.includes('rev-parse')) return inRepo ? risposta(`${RADICE}\n`) : risposta('', 128)
    if (args.includes(' status ')) return risposta(STATUS)
    if (args.includes('--numstat')) return risposta(NUMSTAT)
    if (args.includes('src/a.ts')) return risposta(DIFF_A)
    return risposta('', 1)
  })
  on('tool.call', () => ({ result: { filePath: 'E:/work/src/a.ts' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'modifiche' }] }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return comandi
}

const PANNELLO = {
  plugin: 'infobar',
  component: 'Pane',
  requestId: 'modifiche',
  surface: 'terminal',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'File modificati', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const BANDA = { plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never

test('dopo una scrittura di Claude la barra conta i file da committare, e il pannello li elenca con il diff', async ($, on) => {
  const clock = mock.clock(on)
  const comandi = ospite(on)
  await $.tool.call({ tool: 'Edit', file_path: 'E:/work/src/a.ts', old_string: 'due', new_string: 'DUE' } as never)
  await clock.advance(1000)

  expect(await (await $.ui.mount(BANDA)).find({ type: 'Text', text: ' ✎ 4' })).toBeDefined()
  expect(comandi.find(c => c.includes('status'))).toEqual(['git', '--no-optional-locks', '-C', RADICE, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])

  await $.command.run({ command: 'modifiche', args: '' } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'FILE MODIFICATI · 4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ← c.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+2' })).toBeDefined()

  await ui.press({ key: 'diff-src/a.ts' })
  expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ format: 'diff', source: soloBlocchi(DIFF_A) })
})

test('un file nuovo conta le sue righe; un tool che non scrive non rilegge git', async ($, on) => {
  const clock = mock.clock(on)
  const comandi = ospite(on)
  await $.tool.call({ tool: 'Read', file_path: 'E:/work/x.ts' } as never)
  await clock.advance(1000)
  expect(comandi.some(c => c.includes('status'))).toBe(false)

  await $.tool.call({ tool: 'Write', file_path: 'E:/work/src/con spazio.ts', content: 'x' } as never)
  await clock.advance(1000)
  await $.command.run({ command: 'modifiche', args: '' } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: '+3' })).toBeDefined()
})

test('fuori da un repository la barra non mostra niente e il pannello lo dice', async ($, on) => {
  const clock = mock.clock(on)
  ospite(on, false)
  await $.tool.call({ tool: 'Edit', file_path: 'E:/work/a.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1000)
  expect(await (await $.ui.mount(BANDA)).find({ type: 'Text', text: /✎/ })).toBeUndefined()
  await $.command.run({ command: 'modifiche', args: '' } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'La cartella della sessione non è in un repository git.' })).toBeDefined()
})

test('la ricerca tra i file vuole tutte le parole nel percorso, anche in quello di prima di una rinomina', () => {
  const file = [
    { path: 'hooks/messaggi.tsx', stato: 'modificato', aggiunte: 1, tolte: 0 },
    { path: 'tests/messaggi.test.ts', stato: 'nuovo', aggiunte: 9, tolte: 0 },
    { path: 'hooks/barra.ts', stato: 'rinominato', aggiunte: 0, tolte: 0, da: 'hooks/vecchia.ts' },
  ] as const
  expect(filtraFile(file, 'MESSAGGI').map(f => f.path)).toEqual(['hooks/messaggi.tsx', 'tests/messaggi.test.ts'])
  expect(filtraFile(file, 'hooks messaggi').map(f => f.path)).toEqual(['hooks/messaggi.tsx'])
  expect(filtraFile(file, 'vecchia').map(f => f.path)).toEqual(['hooks/barra.ts'])
  expect(filtraFile(file, '')).toHaveLength(3)
})

// Da un repository vero, più una voce staccata e una con la cartella sparita.
const WORKTREE = [
  'worktree E:/work',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree E:/work-agente',
  'HEAD bbb',
  'branch refs/heads/intestazione',
  '',
  'worktree V:/Temp/wt-base',
  'HEAD ccc',
  'detached',
  '',
  'worktree E:/work-pulito',
  'HEAD aaa',
  'branch refs/heads/pulito',
  '',
  'worktree E:/sparito',
  'HEAD ddd',
  'branch refs/heads/sparito',
  'prunable gitdir file points to non-existent location',
  '',
  '',
].join('\n')

test('dalla lista dei worktree: branch, HEAD staccata, e non quelli la cui cartella non c\'è più', () => {
  expect(worktreeDaLista(WORKTREE)).toEqual([
    { radice: 'E:/work', head: 'aaa', branch: 'main' },
    { radice: 'E:/work-agente', head: 'bbb', branch: 'intestazione' },
    { radice: 'V:/Temp/wt-base', head: 'ccc', branch: null },
    { radice: 'E:/work-pulito', head: 'aaa', branch: 'pulito' },
  ])
})

function conWorktree(on: On, panes: { id: string }[] = [{ id: 'modifiche' }]) {
  const comandi: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('session.cwd', () => ({ value: 'e:\\work' }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', ($, e) => {
    comandi.push([...e.argv])
    const args = e.argv.join(' ')
    const risposta = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args.includes('rev-parse')) return risposta('e:/work\n')
    if (args.includes('worktree list')) return risposta(WORKTREE)
    const agente = args.includes('-C E:/work-agente')
    if (args.includes('rev-list')) return risposta(agente ? '2\n' : '0\n')
    if (args.includes(' status ')) return risposta(agente ? [' M src/a.ts', ''].join(Z) : args.includes('-C e:/work ') ? [' M b.ts', ''].join(Z) : '')
    if (args.includes('--numstat')) return risposta(agente ? [`2${T}1${T}src/a.ts`, ''].join(Z) : '')
    if (agente && args.includes('src/a.ts')) return risposta(DIFF_A)
    return risposta('', 1)
  })
  on('tool.call', () => ({ result: { filePath: 'e:/work/b.ts' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: panes }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return comandi
}

test('il pannello mostra gli altri worktree con qualcosa da guardare, con il diff letto lì; la barra conta solo qui', async ($, on) => {
  const clock = mock.clock(on)
  const comandi = conWorktree(on)
  await $.tool.call({ tool: 'Edit', file_path: 'e:/work/b.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1000)
  expect(await (await $.ui.mount(BANDA)).find({ type: 'Text', text: ' ✎ 1' })).toBeDefined()

  await $.command.run({ command: 'modifiche', args: '' } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'FILE MODIFICATI · 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'intestazione' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  work-agente' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 commit non nel branch corrente' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'pulito' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'HEAD staccata' })).toBeUndefined()

  await ui.press({ key: 'diff-E:/work-agente::src/a.ts' })
  expect(comandi.at(-1)).toEqual(['git', '--no-optional-locks', '-C', 'E:/work-agente', 'diff', 'HEAD', '--no-color', '--', 'src/a.ts'])
  expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ format: 'diff', source: soloBlocchi(DIFF_A) })
})

test('a pannello chiuso gli altri worktree non si leggono', async ($, on) => {
  const clock = mock.clock(on)
  const comandi = conWorktree(on, [])
  await $.tool.call({ tool: 'Edit', file_path: 'e:/work/b.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1000)
  expect(comandi.some(c => c.includes('status'))).toBe(true)
  expect(comandi.some(c => c.includes('worktree'))).toBe(false)
})

test('con pochi file il pannello non ha il campo di ricerca', async ($, on) => {
  const clock = mock.clock(on)
  ospite(on)
  await $.tool.call({ tool: 'Edit', file_path: 'E:/work/src/a.ts', old_string: 'due', new_string: 'DUE' } as never)
  await clock.advance(1000)
  await $.command.run({ command: 'modifiche', args: '' } as never)
  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'FILE MODIFICATI · 4' })).toBeDefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
})
