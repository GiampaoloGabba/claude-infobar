import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const CASA = 'C:/Users/g'
const CSWAP = `${CASA}/.local/bin/cswap.exe`

const LISTA = JSON.stringify({
  accounts: [
    { number: 1, email: 'g@gmail.com', alias: 'personal', active: false, usageStatus: 'relogin_required' },
    {
      number: 3,
      email: 'info@evolutionlab.it',
      alias: 'mini',
      active: true,
      usageStatus: 'ok',
      usage: { fiveHour: { pct: 56, clock: '21:10' }, sevenDay: { pct: 5, clock: 'Nov 8 00:00' } },
    },
  ],
})

const FILE: Record<string, string> = {
  [CSWAP]: '',
  [`${CASA}/.claude.json`]: JSON.stringify({ oauthAccount: { emailAddress: 'info@evolutionlab.it' } }),
  [`${CASA}/.claude-canevari/.claude.json`]: JSON.stringify({ oauthAccount: { emailAddress: 'info@canevari.it' } }),
  [`${CASA}/.claude-swap-backup/sequence.json`]: JSON.stringify({
    accounts: {
      '1': { email: 'g@gmail.com', alias: 'personal' },
      '2': { email: 'info@canevari.it', alias: 'canevari' },
      '3': { email: 'info@evolutionlab.it', alias: 'mini' },
    },
  }),
}

type Comando = { argv: string[]; env: Record<string, string> | undefined }

function ospite(on: On, env: Record<string, string>) {
  const comandi: Comando[] = []
  const aperti: string[] = []
  const norm = (p: string) => p.replaceAll('\\', '/')
  on('env.get', ($, e) => ({ value: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\g', ...env }[e.name] }))
  on('fs.exists', ($, e) => ({ value: norm(e.path) in FILE || norm(e.path) === `${CASA}/.claude-swap-backup` }))
  on('fs.stat', ($, e) => {
    if (!(norm(e.path) in FILE)) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', ($, e) => ({ value: FILE[norm(e.path)] ?? '' }))
  on('process.run', ($, e) => {
    comandi.push({ argv: [...e.argv], env: e.init?.env })
    const stdout = e.argv[1] === 'list' ? LISTA : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => (aperti.push(e.id), { value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  return { comandi, aperti }
}

const PANNELLO = {
  plugin: 'infobar',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'account',
  viewport: { columns: 60, rows: 40 },
  props: {
    title: 'Account',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const account = (args: string) => ({ command: 'account', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

test("su un'istanza con nome il pannello evidenzia il suo account, non ha switch e /account non cambia niente", async ($, on) => {
  mock.clock(on)
  const o = ospite(on, { CLAUDE_CONFIG_DIR: String.raw`C:\Users\g\.claude-canevari` })

  const ui = await $.ui.mount(PANNELLO)
  await ui.press({ key: 'aggiorna-conti' })
  expect(await ui.find({ text: /^Istanza canevari:/ })).toBeDefined()
  expect(await ui.find({ text: 'login da rifare' })).toBeDefined()
  expect(await ui.findAll({ type: 'Button', text: 'switch' })).toHaveLength(0)

  const { text } = await $.command.run(account('personal'))
  expect(text).toContain('account è fisso')
  expect(o.comandi.some(c => c.argv[1] === 'switch')).toBe(false)
})

test('sul principale lo switch lancia cswap con CLAUDE_CONFIG_DIR vuota', async ($, on) => {
  mock.clock(on)
  const o = ospite(on, {})

  const ui = await $.ui.mount(PANNELLO)
  await ui.press({ key: 'aggiorna-conti' })
  expect(await ui.find({ key: 'switch-3' })).toBeUndefined()

  await ui.press({ key: 'switch-1' })
  const switch1 = o.comandi.find(c => c.argv[1] === 'switch')
  expect(switch1).toEqual({ argv: [CSWAP, 'switch', '1'], env: { CLAUDE_CONFIG_DIR: '' } })
})

test("una sessione con il login dell'app che l'ha avviata non apre il pannello e non fa switch", async ($, on) => {
  mock.clock(on)
  const o = ospite(on, { CLAUDE_CODE_OAUTH_TOKEN: 'tok' })

  const { text } = await $.command.run(account('personal'))
  expect(text).toContain('login')
  expect(o.aperti).toEqual([])
  expect(o.comandi).toEqual([])
})
