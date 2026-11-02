import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { accorciaCoppia, siglaEffort, descriviLimite, effortDaImpostazioni, formattaDurata, limitiSalvati, gitdirDaFile, nomeCartella, nomeModello, orario, ramoDaHead } from '../hooks/testi'

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

test('un workflow in background compare nella barra come lavoro in corso', async ($, on) => {
  mock.clock(on)
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['banda del motore'] }))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 't1', type: 'workflow', status: 'running', description: 'review', name: 'review-changes' }],
  })

  const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: '◷ 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeUndefined()
})

test('la riga sopra il prompt mostra stato e autorizzazioni', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['banda del motore'] }))
  await $.command.run(cmd('autonomo'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'infobar', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
    const nelTerminale = surface === 'terminal'
    expect((await ui.find({ type: 'Text', text: /✓/ })) !== undefined).toBe(nelTerminale)
    expect((await ui.find({ type: 'Text', text: /autonomo/ })) !== undefined).toBe(nelTerminale)
    expect(await ui.find({ type: 'Text', text: /banda del motore/ })).toBeDefined()
    await ui.unmount()
  }
})

test('effort dalle impostazioni: prima quello del modello, poi quello generale', () => {
  const impostazioni = { effortLevel: 'xhigh', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }
  expect(effortDaImpostazioni(impostazioni, 'claude-opus-5-5')).toBe('high')
  expect(effortDaImpostazioni(impostazioni, 'claude-opus-5-5[1m]')).toBe('high')
  expect(effortDaImpostazioni(impostazioni, 'claude-sonnet-5-5')).toBe('xhigh')
  expect(effortDaImpostazioni({ effortLevel: 'boh' }, 'claude-opus-5-5')).toBeNull()
  expect(effortDaImpostazioni({}, 'claude-opus-5-5')).toBeNull()
})

test('dopo una compattazione la barra si rilegge e mostra il contesto rimasto', async ($, on) => {
  mock.clock(on)
  let fase = 'prima'
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('session.model', () => ({ value: fase === 'prima' ? 'claude-sonnet-5-5' : 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  const riassunto = { role: 'user' as const, text: 'riassunto', toolUses: [] }
  on('session.compact', () => ({ messages: [riassunto], tokensBefore: 800_000, tokensAfter: 120_000 }))
  on('classic.SessionStart', () => ({}))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))

  fase = 'dopo'
  await $.session.compact({ trigger: 'manual', messages: [riassunto] })
  await $.classic.SessionStart({ source: 'compact' })

  const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /12%/ })).toBeDefined()
  await ui.unmount()
})

test('quando la seconda riga non ci sta, la barra del contesto sparisce e resta la percentuale', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  const riassunto = { role: 'user' as const, text: 'riassunto', toolUses: [] }
  on('session.compact', () => ({ messages: [riassunto], tokensBefore: 800_000, tokensAfter: 120_000 }))
  on('classic.SessionStart', () => ({}))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  await $.session.compact({ trigger: 'manual', messages: [riassunto] })
  await $.classic.SessionStart({ source: 'compact' })

  for (const [columns, conBarra] of [[20, false], [40, true]] as const) {
    const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', viewport: { columns, rows: 40 }, props: { hasSurvey: false, bodyColumns: columns } as never })
    expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /░/ })) !== undefined).toBe(conBarra)
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
    .toEqual({ etichetta: '5h', percentuale: 20, mancano: '2h 40m', colore: 'success' })
  expect(descriviLimite({ kind: 'seven_day', percentUsed: 58, resetsAt: tra(31 * h) }, ora).mancano).toBe('1g 7h')
  expect(descriviLimite({ kind: 'five_hour', percentUsed: 60, resetsAt: tra(4 * h) }, ora).colore).toBe('warning')
  expect(descriviLimite({ kind: 'seven_day', percentUsed: 80, resetsAt: tra(h) }, ora).colore).toBe('error')
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

test("con una sola finestra l'etichetta sparisce, con più finestre resta", async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('session.measure', () => ({ changed: [] }))
  const banda = () => $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })

  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 5 }], changed: ['rateLimits'] })
  const sola = await banda()
  expect(await sola.find({ type: 'Text', text: /7d/ })).toBeUndefined()
  expect(await sola.find({ type: 'Text', text: /^5%$/ })).toBeDefined()
  await sola.unmount()

  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 5 }, { kind: 'seven_day_opus', percentUsed: 9 }],
    changed: ['rateLimits'],
  })
  const due = await banda()
  expect(await due.find({ type: 'Text', text: / \| 7d $/ })).toBeDefined()
  expect(await due.find({ type: 'Text', text: / \| 7d opus $/ })).toBeDefined()
  await due.unmount()
})

test('limiti salvati: restano solo le finestre non ancora azzerate', () => {
  const ora = Date.parse('2026-10-05T10:00:00Z')
  const finestre = [
    { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-05T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 70, resetsAt: '2026-10-05T09:00:00Z' },
    { kind: 'seven_day_opus', percentUsed: 10 },
  ]
  expect(limitiSalvati({ at: 5, finestre }, ora)).toEqual({ at: 5, finestre: [finestre[0]] })
  expect(limitiSalvati({ at: 5, finestre: [finestre[1]] }, ora)).toBeNull()
  expect(limitiSalvati('rotto', ora)).toBeNull()
  expect(limitiSalvati(finestre, ora)).toBeNull()
})

function sessione(on: On, uso: { tokens?: number; stima?: number; limiti?: unknown[] }) {
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: {
        window: 1_000_000,
        ...(uso.tokens !== undefined && { tokens: uso.tokens, percent: Math.round(uso.tokens / 10_000) }),
        ...(e?.breakdown && uso.stima !== undefined && { breakdown: { totalTokens: uso.stima } as never }),
      },
      rateLimits: (uso.limiti ?? []) as never,
    },
  }))
}

test('dopo /clear contesto stimato e limiti ricordati dalla sessione precedente', async ($, on) => {
  const clock = mock.clock(on)
  const futuro = new Date(clock.now() + 3600_000).toISOString()
  const passato = new Date(clock.now() - 3600_000).toISOString()
  const visti = clock.now() - 2 * 3600_000
  mock.store(on, {
    limiti: { at: visti, finestre: [{ kind: 'five_hour', percentUsed: 33, resetsAt: futuro }, { kind: 'seven_day', percentUsed: 90, resetsAt: passato }] },
  })
  sessione(on, { stima: 50_000 })
  on('session.measure', () => ({ changed: [] }))

  await $.classic.SessionStart({ source: 'clear' })

  const banda = () => $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  const prima = await banda()
  expect(await prima.find({ type: 'Text', text: /^5%$/ })).toBeDefined()
  expect((await prima.find({ type: 'Text', text: /^33%$/ }))?.props).toMatchObject({ color: 'success' })
  expect(await prima.find({ type: 'Text', text: /90%/ })).toBeUndefined()
  expect(await prima.find({ type: 'Text', text: / · 2h fa$/ })).toBeDefined()
  await prima.unmount()

  // La prima risposta porta i limiti veri: tornano a colori e l'età sparisce.
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 33, resetsAt: futuro }], changed: ['rateLimits'] })
  const dopo = await banda()
  expect((await dopo.find({ type: 'Text', text: /^33%$/ }))?.props).toMatchObject({ color: 'success' })
  expect(await dopo.find({ type: 'Text', text: / fa$/ })).toBeUndefined()
  await dopo.unmount()
})

test('una sessione ripresa mostra i token esatti dell\'ultima risposta', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  sessione(on, { stima: 50_000 })

  await $.classic.SessionStart({ source: 'resume', context_tokens: 420_000 })

  const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: /^42%$/ })).toBeDefined()
  await ui.unmount()
})

test('dopo /compact il contesto non torna al valore di prima', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  sessione(on, { tokens: 800_000 })
  const riassunto = { role: 'user' as const, text: 'riassunto', toolUses: [] }
  on('session.compact', () => ({ messages: [riassunto], tokensAfter: 100_000 }))

  await $.session.compact({ trigger: 'manual', messages: [riassunto] })
  await $.classic.SessionStart({ source: 'compact' })

  const ui = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: /^10%$/ })).toBeDefined()
  await ui.unmount()
})

test('cartella e branch si accorciano togliendo dal più lungo, senza scendere sotto il minimo', () => {
  expect(accorciaCoppia(14, 4, 30)).toEqual([14, 4])
  expect(accorciaCoppia(20, 10, 24)).toEqual([14, 10])
  expect(accorciaCoppia(20, 20, 30)).toEqual([15, 15])
  expect(accorciaCoppia(20, 20, 10)).toEqual([8, 8])
})

test('l\'effort in due lettere, e un livello sconosciuto com\'è', () => {
  expect(['low', 'medium', 'high', 'xhigh', 'max', 'boh'].map(siglaEffort)).toEqual(['lw', 'md', 'hi', 'xh', 'mx', 'boh'])
})
