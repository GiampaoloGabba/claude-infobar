import { expect, test } from 'claude-code/testing'

import { RINFRESCO_CODEX_MS, decidiCodex, leggiCache, limitiDaSessione, limitiDaUsage, scadenzaJwt } from '../hooks/codex'

const RESET = 1794149395
const RESET_ISO = new Date(RESET * 1000).toISOString()

test("la risposta di wham/usage diventa la finestra settimanale, senza inventare quella di 5 ore", async () => {
  const testo = JSON.stringify({
    plan_type: 'pro',
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: 12, limit_window_seconds: 604800, reset_after_seconds: 595867, reset_at: RESET },
      secondary_window: null,
    },
  })
  expect(limitiDaUsage(testo)).toEqual([{ kind: 'seven_day', percentUsed: 12, resetsAt: RESET_ISO }])
})

test('con due finestre la prima di 5 ore resta five_hour', async () => {
  const testo = JSON.stringify({
    rate_limit: {
      primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: RESET },
      secondary_window: { used_percent: 7, limit_window_seconds: 604800, reset_at: RESET },
    },
  })
  expect(limitiDaUsage(testo).map(l => l.kind)).toEqual(['five_hour', 'seven_day'])
})

test("dal file di sessione vale l'ultimo rate_limits scritto", async () => {
  const riga = (pct: number) =>
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: {}, rate_limits: { primary: { used_percent: pct, window_minutes: 10080, resets_at: RESET }, secondary: null } },
    })
  const testo = [riga(3), JSON.stringify({ type: 'response_item', payload: { text: 'ciao' } }), riga(9), '{rotta', ''].join('\n')

  expect(limitiDaSessione(testo)).toEqual([{ kind: 'seven_day', percentUsed: 9, resetsAt: RESET_ISO }])
  expect(limitiDaSessione('{"type":"session_meta"}\n')).toBe(null)
})

test('la scadenza del token si legge dal JWT senza verificarlo', async () => {
  const parte = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  expect(scadenzaJwt(`${parte({ alg: 'none' })}.${parte({ exp: 1700000000 })}.firma`)).toBe(1700000000)
  expect(scadenzaJwt('non-un-jwt')).toBe(null)
  expect(scadenzaJwt(`a.${parte({ sub: 'x' })}.b`)).toBe(null)
})

test("una sola sessione chiede: le altre usano il dato fresco o aspettano chi sta chiedendo", async () => {
  const ora = 10 * RINFRESCO_CODEX_MS
  const cache = (at: number, occupatoFino = 0) => ({ at, occupatoFino, limiti: [], vistoAlle: at })

  expect(decidiCodex(null, ora)).toBe('chiedi')
  expect(decidiCodex(cache(ora - RINFRESCO_CODEX_MS + 1000), ora)).toBe('usa')
  expect(decidiCodex(cache(ora - RINFRESCO_CODEX_MS, ora + 30_000), ora)).toBe('aspetta')
  expect(decidiCodex(cache(ora - RINFRESCO_CODEX_MS, ora - 1), ora)).toBe('chiedi')
  expect(leggiCache('non json')).toBe(null)
  expect(leggiCache(JSON.stringify({ at: 1, occupatoFino: 0, limiti: [] }))).toEqual({ at: 1, occupatoFino: 0, limiti: [], vistoAlle: null })
})
