import { expect, mock, test } from 'claude-code/testing'

import { descriviLimite, formattaDurata, gitdirDaFile, nomeCartella, nomeModello, orario, ramoDaHead } from '../hooks/testi'

const cmd = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

test('un rate limit programma la ripresa un minuto dopo il reset della finestra piena', async ($, on) => {
  const clock = mock.clock(on)
  const resetsAt = new Date(clock.now() + 2 * 3600_000).toISOString()
  on('classic.StopFailure', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 100, resetsAt },
      { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(clock.now() + 5 * 86_400_000).toISOString() },
    ],
  } }))

  await $.classic.StopFailure({ error: 'rate_limit' })

  const { text } = await $.command.run(cmd('ripresa'))
  expect(text).toContain(`Ripresa automatica alle ${orario(Date.parse(resetsAt) + 60_000)} (limite di utilizzo`)
})

test('un errore di fatturazione non programma riprese', async ($, on) => {
  mock.clock(on)
  on('classic.StopFailure', () => ({}))
  await $.classic.StopFailure({ error: 'billing_error' })

  const { text } = await $.command.run(cmd('ripresa'))
  expect(text).toBe('Nessuna ripresa programmata.')
})

test('le autorizzazioni entrano nel system prompt come sezione di sessione', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))

  await $.command.run(cmd('autorizza', 'db'))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })

  const mia = sections.find(s => s.id === 'infobar:autorizzazioni')
  expect(mia?.scope).toBe('session')
  expect(mia?.text).toContain('compresa la produzione')
})

test('/compatta rifiuta mentre gira un workflow in background', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 't1', type: 'workflow', status: 'running', description: 'review', name: 'review-changes' }],
  })

  const { text } = await $.command.run(cmd('compatta'))

  expect(text).toContain('Non compatto')
  expect(text).toContain('1 workflow')
})

test('la riga sopra il prompt mostra stato e autorizzazioni', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['banda del motore'] }))
  await $.command.run(cmd('autonomo'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'infobar', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
    expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /autonomo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /banda del motore/ })).toBeDefined()
    await ui.unmount()
  }
})

test('intestazione: nome del modello, branch e worktree', () => {
  expect(nomeModello('claude-opus-5-5')).toBe('Opus 5.5')
  expect(nomeModello('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(nomeModello('Opus 5.5')).toBe('Opus 5.5')
  expect(ramoDaHead('ref: refs/heads/feature/x\n')).toBe('feature/x')
  expect(ramoDaHead('0123456789abcdef0123\n')).toBe('0123456')
  expect(gitdirDaFile('gitdir: E:\\repo\\.git\\worktrees\\wt\n', 'E:/repo/wt')).toBe('E:/repo/.git/worktrees/wt')
  expect(gitdirDaFile('gitdir: ../.git/worktrees/wt', '/Users/me/wt')).toBe('/Users/me/wt/../.git/worktrees/wt')
  expect(nomeCartella('C:\\Users\\me\\Progetto\\')).toBe('Progetto')
})

test('limiti: etichette, tempo al reset e colore per percentuale', () => {
  const ora = Date.parse('2026-10-03T10:00:00Z')
  const tra = (ms: number) => new Date(ora + ms).toISOString()
  const h = 3600_000
  expect(descriviLimite({ kind: 'five_hour', percentUsed: 20, resetsAt: tra(2 * h + 40 * 60_000) }, ora))
    .toEqual({ etichetta: '5h', percentuale: 20, mancano: '2h 40m', colore: 'green' })
  expect(descriviLimite({ kind: 'seven_day', percentUsed: 58, resetsAt: tra(31 * h) }, ora).mancano).toBe('1g 7h')
  expect(descriviLimite({ kind: 'five_hour', percentUsed: 60, resetsAt: tra(4 * h) }, ora).colore).toBe('yellow')
  expect(descriviLimite({ kind: 'seven_day', percentUsed: 80, resetsAt: tra(h) }, ora).colore).toBe('red')
  expect(descriviLimite({ kind: 'seven_day_opus', percentUsed: 10 }, ora).etichetta).toBe('7d opus')
  expect(formattaDurata(45 * 60_000)).toBe('45m')
})

test('la prima riga mostra i limiti di utilizzo', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('classic.Stop', () => ({}))
  on('session.measure', () => ({ changed: [] }))
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }], changed: ['rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: /20%/ })).toBeDefined()
  await ui.unmount()
})
