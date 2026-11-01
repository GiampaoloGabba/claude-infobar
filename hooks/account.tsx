import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Conto, ContoSessione, FinestraConto, StatoConti } from '../types'
import { STATO_CONTO, aliasDaSequenza, contiDaCswap, emailDaConfig, profiloFisso } from './conti'
import { coloreLivello } from './testi'

export const PANNELLO_CONTI = 'account'
// L'endpoint dei consumi di cswap risponde 429 se interrogato spesso, e ogni sessione aperta ha questo timer.
const VECCHI_MS = 5 * 60_000

const VUOTO: StatoConti = { conti: [], aggiornatiAlle: 0, errore: null, occupato: null }
const conti = atom({ plugin: 'infobar', key: 'conti' } as const, VUOTO)
export const contoSessione = atom({ plugin: 'infobar', key: 'contoSessione' } as const, null)

type Percorsi = { casa: string; principale: string; cswap: string | null; isWindows: boolean }

let percorsi: Percorsi | undefined
// Il .claude.json pesa centinaia di KB: si rilegge solo quando cambia.
let ultimaLettura: { file: string; mtimeMs: number; risultato: ContoSessione | null } | undefined

async function trovaPercorsi($: EngineInterface): Promise<Percorsi> {
  if (percorsi) return percorsi
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const casa = ((isWindows ? await $.env.get('USERPROFILE') : undefined) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const locale = `${casa}/.local/bin/cswap${isWindows ? '.exe' : ''}`
  const cswap = (await $.fs.exists(locale)) ? locale : (await $.fs.exists(`${casa}/.claude-swap-backup`)) ? 'cswap' : null
  percorsi = { casa, principale: `${casa}/.claude`, cswap, isWindows }
  return percorsi
}

export async function conCswap($: EngineInterface) {
  return (await trovaPercorsi($)).cswap !== null
}

/** Ricava l'account della sessione dai file locali, senza chiamare cswap né la rete. */
async function calcolaContoSessione($: EngineInterface): Promise<ContoSessione | null> {
  const p = await trovaPercorsi($)
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const fisso = profiloFisso(configDir, p.principale, p.isWindows)
  const file = fisso ? `${configDir!.trim().replace(/\\/g, '/').replace(/\/+$/, '')}/.claude.json` : `${p.casa}/.claude.json`

  let risultato: ContoSessione | null = fisso ? { nome: fisso, fisso: true } : null
  const stat = await $.fs.stat(file).catch(() => null)
  if (stat && ultimaLettura?.file === file && ultimaLettura.mtimeMs === stat.mtimeMs) {
    risultato = ultimaLettura.risultato
  } else if (stat) {
    const email = emailDaConfig(await $.fs.read(file).catch(() => ''))
    const sequenza = p.cswap ? await $.fs.read(`${p.casa}/.claude-swap-backup/sequence.json`).catch(() => '') : ''
    const alias = email && sequenza ? aliasDaSequenza(sequenza, email) : null
    if (alias) risultato = { nome: alias, fisso: Boolean(fisso) }
    ultimaLettura = { file, mtimeMs: stat.mtimeMs, risultato }
  }
  return risultato
}

export async function aggiornaContoSessione($: EngineInterface) {
  const risultato = await calcolaContoSessione($)
  const prima = await read($, contoSessione)
  if (JSON.stringify(prima) !== JSON.stringify(risultato)) await update($, contoSessione, () => risultato)
}

// Chi disegna prima che session.start abbia scritto lo stato lo calcola da sé; la lettura dello stato
// resta, così il ridisegno arriva quando il timer lo aggiorna.
async function contoDaMostrare($: EngineInterface) {
  return (await read($, contoSessione)) ?? (await calcolaContoSessione($))
}

// Una sessione su profilo fisso passa il suo CLAUDE_CONFIG_DIR ai figli, e process.run può solo sovrascrivere
// le variabili, non toglierle. Vuota è ciò che cswap legge come profilo principale; il percorso esplicito di
// ~/.claude no: cswap cercherebbe ~/.claude/.claude.json invece di ~/.claude.json e non vedrebbe l'account attivo.
async function cswap($: EngineInterface, args: string[]) {
  const p = await trovaPercorsi($)
  return $.process.run([p.cswap ?? 'cswap', ...args], { env: { CLAUDE_CONFIG_DIR: '' }, timeoutMs: 90_000 })
}

const ultimaRiga = (testo: string) => testo.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''

export async function aggiornaConti($: EngineInterface) {
  if ((await read($, conti)).occupato) return
  await update($, conti, s => ({ ...s, occupato: 'aggiorno…' }))
  try {
    const r = await cswap($, ['list', '--json'])
    if (r.exitCode !== 0) throw new Error(ultimaRiga(r.stderr) || `cswap list: exit ${r.exitCode}`)
    const lista = contiDaCswap(r.stdout)
    const alle = await $.clock.now()
    await update($, conti, () => ({ conti: lista, aggiornatiAlle: alle, errore: null, occupato: null }))
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message : String(errore)
    await update($, conti, s => ({ ...s, errore: messaggio, occupato: null }))
  }
}

export async function passaA($: EngineInterface, destinazione: string): Promise<string> {
  const sessione = await contoDaMostrare($)
  if (sessione?.fisso) return `Istanza ${sessione.nome}: l'account è fisso, lo switch si fa dal profilo principale.`
  if ((await read($, conti)).occupato) return 'cswap è già al lavoro, riprova tra poco.'
  await update($, conti, s => ({ ...s, occupato: `switch a ${destinazione}…` }))
  let esito: string
  try {
    const r = await cswap($, ['switch', destinazione])
    esito = r.exitCode === 0
      ? `Profilo principale passato a ${destinazione}.`
      : `Switch a ${destinazione} non riuscito: ${ultimaRiga(r.stderr) || ultimaRiga(r.stdout) || `exit ${r.exitCode}`}`
  } catch (errore) {
    esito = `Switch a ${destinazione} non riuscito: ${errore instanceof Error ? errore.message : String(errore)}`
  }
  await update($, conti, s => ({ ...s, occupato: null }))
  $.ui.toast(esito)
  await aggiornaContoSessione($)
  await aggiornaConti($)
  return esito
}

export async function pannelloAperto($: EngineInterface) {
  return (await $.ui.panes()).some(pannello => pannello.id === PANNELLO_CONTI)
}

export async function aggiornaContiSeVecchi($: EngineInterface) {
  const s = await read($, conti)
  if ((await $.clock.now()) - s.aggiornatiAlle >= VECCHI_MS) await aggiornaConti($)
}

export async function apriConti($: EngineInterface) {
  await $.ui.open({ id: PANNELLO_CONTI, title: 'Account' })
  void aggiornaContiSeVecchi($)
}

const oraMinuti = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const testoQui = (sessione: ContoSessione | null) =>
  sessione?.fisso ? `Istanza ${sessione.nome}: account fisso, lo switch si fa dal principale` : 'Qui: principale, segue lo switch'

// Su un'istanza con nome lo switch non la toccherebbe (cambia solo ~/.claude): niente pulsanti, e in evidenza
// c'è l'account dell'istanza invece di quello attivo sul principale.
const evidenziato = (c: Conto, sessione: ContoSessione | null) => (sessione?.fisso ? c.nome === sessione.nome : c.attivo)
const etichettaEvidenza = (sessione: ContoSessione | null) => (sessione?.fisso ? 'questa istanza' : 'attivo')

const testoAggiornamento = (s: StatoConti) =>
  s.occupato ?? (s.aggiornatiAlle ? `aggiornato alle ${oraMinuti(s.aggiornatiAlle)}` : '')

const TEMA_LIVELLO: Record<string, 'success' | 'warning' | 'error'> = { green: 'success', yellow: 'warning', red: 'error' }

// Il desktop disegna testi proporzionali, pulsanti veri e colori del tema: la versione a caratteri del
// terminale lì sembra una schermata incollata.
function disegnaContiDesktop($: EngineInterface, e: RenderInput, s: StatoConti, sessione: ContoSessione | null) {
  const { Box, Text, Button } = $.ui.resolve(e)

  const uso = (etichetta: string, f: FinestraConto | null) =>
    f ? (
      <Text size="footnote" color="subtle">
        {`${etichetta} `}
        <Text weight="semibold" color={TEMA_LIVELLO[coloreLivello(f.pct)]}>{`${f.pct}%`}</Text>
        {f.clock ? ` · reset ${f.clock}` : ''}
      </Text>
    ) : null

  return (
    <Box flexDirection="column" gap="md" padding="sm">
      <Text size="footnote" color="subtle">{testoQui(sessione)}</Text>
      {s.conti.length === 0 && !s.errore && <Text color="subtle">Nessun dato ancora.</Text>}
      {s.conti.map(c => (
        <Box key={`conto-${c.numero}`} flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Text weight={evidenziato(c, sessione) ? 'semibold' : 'regular'} color={evidenziato(c, sessione) ? 'success' : undefined}>{c.nome}</Text>
              {evidenziato(c, sessione) && <Text size="caption" weight="semibold" color="success">{etichettaEvidenza(sessione)}</Text>}
            </Box>
            {!c.attivo && !sessione?.fisso && (
              <Button key={`switch-${c.numero}`} variant="secondary" label="Switch" onPress={() => void passaA($, String(c.numero))} />
            )}
          </Box>
          {c.stato === 'ok' ? (
            <Box flexDirection="row" gap="md">
              {uso('5h', c.cinqueOre)}
              {uso('7d', c.settimana)}
            </Box>
          ) : (
            <Text size="footnote" color="warning">{STATO_CONTO[c.stato] ?? c.stato}</Text>
          )}
        </Box>
      ))}
      {s.errore && <Text size="footnote" color="error">{`Errore: ${s.errore}`}</Text>}
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Button key="aggiorna-conti" hotkey="r" label="Aggiorna" onPress={() => void aggiornaConti($)} />
        <Text size="caption" color="subtle">{testoAggiornamento(s)}</Text>
      </Box>
    </Box>
  )
}

export async function disegnaConti($: EngineInterface, e: RenderInput) {
  const s = await read($, conti)
  const sessione = await contoDaMostrare($)
  if (e.surface !== 'terminal') return disegnaContiDesktop($, e, s, sessione)
  const { Box, Text, Button } = $.ui.resolve(e)

  const uso = (etichetta: string, f: FinestraConto | null) =>
    f ? (
      <Text>
        <Text dimColor>{`${etichetta} `}</Text>
        <Text color={coloreLivello(f.pct)}>{`${f.pct}%`}</Text>
        <Text dimColor>{f.clock ? ` ↻ ${f.clock}   ` : '   '}</Text>
      </Text>
    ) : null

  return (
    <Box flexDirection="column">
      <Text dimColor>{testoQui(sessione)}</Text>
      <Text> </Text>
      {s.conti.length === 0 && !s.errore && <Text dimColor>Nessun dato ancora.</Text>}
      {s.conti.map(c => (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text bold={evidenziato(c, sessione)} color={evidenziato(c, sessione) ? 'green' : undefined} dimColor={!evidenziato(c, sessione)}>
              {`${evidenziato(c, sessione) ? '●' : '○'} ${c.nome}`}
            </Text>
            <Text>{'  '}</Text>
            {evidenziato(c, sessione) ? (
              <Text bold color="black" backgroundColor="green">{` ${etichettaEvidenza(sessione).toUpperCase()} `}</Text>
            ) : sessione?.fisso ? null : (
              <Button key={`switch-${c.numero}`} label="switch" onPress={() => void passaA($, String(c.numero))} />
            )}
          </Box>
          {c.stato === 'ok' ? (
            <Text>
              {'  '}
              {uso('5h', c.cinqueOre)}
              {uso('7d', c.settimana)}
            </Text>
          ) : (
            <Text color="yellow">{`  ${STATO_CONTO[c.stato] ?? c.stato}`}</Text>
          )}
        </Box>
      ))}
      {s.errore && <Text color="red">{`Errore: ${s.errore}`}</Text>}
      <Box flexDirection="row">
        <Button key="aggiorna-conti" hotkey="r" label="aggiorna" onPress={() => void aggiornaConti($)} />
        <Text dimColor>{`  ${testoAggiornamento(s)}`}</Text>
      </Box>
    </Box>
  )
}

/** L'account tra le etichette tenui a destra sotto il prompt del desktop, al posto di una riga in più. */
export async function etichettaContoDesktop($: EngineInterface, e: RenderInput, modi: readonly string[]) {
  const sessione = await contoDaMostrare($)
  if (!sessione) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" gap="sm" alignItems="center">
      {modi.length ? <Text size="caption" color="subtle">{modi.join(' & ')}</Text> : null}
      <Button key="conto" plain dimColor onPress={() => void apriConti($)}>
        <Text size="caption">{`${sessione.nome}${sessione.fisso ? ' ⚑' : ' ▾'}`}</Text>
      </Button>
    </Box>
  )
}

/** Il pulsante con l'account della sessione; null se non c'è niente da mostrare. */
export async function pulsanteConto($: EngineInterface, e: RenderInput) {
  const sessione = await read($, contoSessione)
  if (!sessione) return null
  const { Text, Button } = $.ui.resolve(e)
  return (
    <Button key="conto" plain onPress={() => void apriConti($)}>
      <Text bold color={sessione.fisso ? 'magenta' : 'green'}>{sessione.nome}</Text>
      <Text dimColor>{sessione.fisso ? ' ⚑' : ' ▾'}</Text>
    </Button>
  )
}
