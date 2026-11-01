import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Limite, UsoCodex } from '../types'
import { decidiCodex, leggiCache, limitiDaSessione, limitiDaUsage, scadenzaJwt } from './codex'
import type { CacheCodex } from './codex'

const usoCodex = atom({ plugin: 'infobar', key: 'usoCodex' } as const, null)

/** Le finestre di Codex da mostrare: quelle già azzerate cadono, il valore salvato è di prima del reset. */
export async function codexDaMostrare($: EngineInterface, ora: number): Promise<UsoCodex | null> {
  const uso = await read($, usoCodex)
  const limiti = uso?.limiti.filter(f => !f.resetsAt || Date.parse(f.resetsAt) > ora) ?? []
  return uso && limiti.length ? { ...uso, limiti } : null
}

type PercorsiCodex = { auth: string; sessioni: string; cache: string }
let percorsi: PercorsiCodex | null | undefined
// Il file di sessione si rilegge solo quando cambia: può pesare qualche centinaio di KB.
let ultimaSessione: { file: string; mtimeMs: number; limiti: Limite[] | null } | undefined

async function trovaPercorsi($: EngineInterface): Promise<PercorsiCodex | null> {
  if (percorsi !== undefined) return percorsi
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const casa = ((isWindows ? await $.env.get('USERPROFILE') : undefined) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const codexHome = ((await $.env.get('CODEX_HOME')) ?? `${casa}/.codex`).replace(/\\/g, '/').replace(/\/+$/, '')
  const temp = ((isWindows ? await $.env.get('TEMP') : undefined) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/\\/g, '/').replace(/\/+$/, '')
  percorsi = (await $.fs.exists(`${codexHome}/auth.json`))
    ? { auth: `${codexHome}/auth.json`, sessioni: `${codexHome}/sessions`, cache: `${temp}/claude-infobar/codex-usage.json` }
    : null
  return percorsi
}

// Il token si legge e basta: lo rinnova Codex, che possiede auth.json. Rinnovarlo da qui ruoterebbe il
// refresh token sotto i piedi di Codex e ne romperebbe il login. Scaduto, si ripiega sui file di sessione.
async function chiediEndpoint($: EngineInterface, p: PercorsiCodex, ora: number): Promise<Limite[] | null> {
  const auth = JSON.parse(await $.fs.read(p.auth)) as { tokens?: { access_token?: string; account_id?: string } }
  const token = auth.tokens?.access_token
  if (!token) return null
  const exp = scadenzaJwt(token)
  if (exp !== null && exp * 1000 < ora + 60_000) return null
  const risposta = await $.http.fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'claude-infobar',
      ...(auth.tokens?.account_id ? { 'ChatGPT-Account-Id': auth.tokens.account_id } : {}),
    },
  })
  return risposta.ok ? limitiDaUsage(risposta.text) : null
}

async function ultimaCartella($: EngineInterface, cartella: string): Promise<string | null> {
  const nomi = (await $.fs.list(cartella).catch(() => [])).filter(v => v.kind === 'dir').map(v => v.name).sort()
  return nomi.length ? `${cartella}/${nomi[nomi.length - 1]}` : null
}

/** L'ultimo valore scritto da Codex sul disco: il file di sessione più recente che ne contiene uno. */
async function leggiSessioni($: EngineInterface, p: PercorsiCodex): Promise<{ limiti: Limite[]; vistoAlle: number } | null> {
  let giorno = p.sessioni
  for (let i = 0; i < 3 && giorno; i++) giorno = (await ultimaCartella($, giorno)) ?? ''
  if (!giorno) return null
  const file = (await $.fs.list(giorno).catch(() => []))
    .filter(v => v.kind === 'file' && v.name.startsWith('rollout-') && v.name.endsWith('.jsonl'))
    .map(v => `${giorno}/${v.name}`)
    .sort()
    .reverse()
    .slice(0, 5)
  for (const percorso of file) {
    const stat = await $.fs.stat(percorso).catch(() => null)
    if (!stat) continue
    if (ultimaSessione?.file !== percorso || ultimaSessione.mtimeMs !== stat.mtimeMs) {
      ultimaSessione = { file: percorso, mtimeMs: stat.mtimeMs, limiti: limitiDaSessione(await $.fs.read(percorso).catch(() => '')) }
    }
    if (ultimaSessione.limiti?.length) return { limiti: ultimaSessione.limiti, vistoAlle: stat.mtimeMs }
  }
  return null
}

async function pubblica($: EngineInterface, cache: CacheCodex) {
  const nuovo: UsoCodex | null = cache.limiti.length ? { limiti: cache.limiti, vistoAlle: cache.at === cache.vistoAlle ? null : cache.vistoAlle } : null
  if (JSON.stringify(await read($, usoCodex)) !== JSON.stringify(nuovo)) await update($, usoCodex, () => nuovo)
}

/**
 * Tutte le sessioni di Claude passano di qui ogni minuto, ma l'endpoint lo chiama una sola: chi trova il dato
 * vecchio scrive nel file condiviso che sta chiedendo, le altre aspettano e poi riusano il risultato.
 */
export async function aggiornaCodex($: EngineInterface) {
  const p = await trovaPercorsi($)
  if (!p) return
  const ora = await $.clock.now()
  const cache = leggiCache(await $.fs.read(p.cache).catch(() => ''))
  const scelta = decidiCodex(cache, ora)
  if (scelta === 'usa' && cache) return pubblica($, cache)
  if (scelta === 'aspetta') return cache ? pubblica($, cache) : undefined

  await $.fs.write(p.cache, JSON.stringify({ ...(cache ?? { limiti: [], vistoAlle: null }), at: cache?.at ?? 0, occupatoFino: ora + 60_000 }))
  const dalServer = await chiediEndpoint($, p, ora).catch(() => null)
  const nuovo: CacheCodex = dalServer
    ? { at: ora, occupatoFino: 0, limiti: dalServer, vistoAlle: ora }
    : await leggiSessioni($, p).then(
        s => ({ at: ora, occupatoFino: 0, limiti: s?.limiti ?? cache?.limiti ?? [], vistoAlle: s?.vistoAlle ?? cache?.vistoAlle ?? null }),
        () => ({ at: ora, occupatoFino: 0, limiti: cache?.limiti ?? [], vistoAlle: cache?.vistoAlle ?? null }),
      )
  await $.fs.write(p.cache, JSON.stringify(nuovo))
  await pubblica($, nuovo)
}
