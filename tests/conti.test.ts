import { expect, test } from 'claude-code/testing'

import { aliasDaSequenza, contiDaCswap, emailDaConfig, profiloFisso } from '../hooks/conti'

test('un CLAUDE_CONFIG_DIR dedicato dà il nome del profilo, quello principale no', async () => {
  expect(profiloFisso('C:\\Users\\g\\.claude-canevari', 'C:/Users/g/.claude', true)).toBe('canevari')
  expect(profiloFisso('/home/g/.claude-mini/', '/home/g/.claude', false)).toBe('mini')
  expect(profiloFisso('C:\\Users\\G\\.Claude\\', 'C:/Users/g/.claude', true)).toBe(null)
  expect(profiloFisso(undefined, 'C:/Users/g/.claude', true)).toBe(null)
  expect(profiloFisso('  ', 'C:/Users/g/.claude', true)).toBe(null)
})

test('cswap list --json diventa un conto per account, con alias, attivo e stato', async () => {
  const stdout = JSON.stringify({
    activeAccountNumber: 3,
    accounts: [
      { number: 1, email: 'a@x.it', active: false, usageStatus: 'relogin_required', alias: 'personal' },
      {
        number: 3,
        email: 'b@x.it',
        active: true,
        usageStatus: 'ok',
        usage: {
          fiveHour: { pct: 37.6, clock: '21:09' },
          sevenDay: { pct: 4.0, clock: 'Nov 7 23:59' },
        },
      },
    ],
  })

  expect(contiDaCswap(stdout)).toEqual([
    { numero: 1, nome: 'personal', attivo: false, stato: 'relogin_required', cinqueOre: null, settimana: null },
    {
      numero: 3,
      nome: 'b@x.it',
      attivo: true,
      stato: 'ok',
      cinqueOre: { pct: 38, clock: '21:09' },
      settimana: { pct: 4, clock: 'Nov 7 23:59' },
    },
  ])
})

test("l'alias si trova per email senza badare alle maiuscole", async () => {
  const sequenza = JSON.stringify({
    accounts: {
      '2': { email: 'info@canevari.it', alias: 'canevari' },
      '3': { email: 'info@evolutionlab.it' },
    },
  })

  expect(aliasDaSequenza(sequenza, 'Info@Canevari.it')).toBe('canevari')
  expect(aliasDaSequenza(sequenza, 'info@evolutionlab.it')).toBe(null)
  expect(aliasDaSequenza(sequenza, 'altro@x.it')).toBe(null)
  expect(aliasDaSequenza('{rotto', 'info@canevari.it')).toBe(null)
})

test("l'email dell'account loggato viene da oauthAccount", async () => {
  expect(emailDaConfig(JSON.stringify({ oauthAccount: { emailAddress: 'info@evolutionlab.it' } }))).toBe('info@evolutionlab.it')
  expect(emailDaConfig(JSON.stringify({ projects: {} }))).toBe(null)
  expect(emailDaConfig('')).toBe(null)
})
