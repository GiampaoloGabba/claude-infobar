import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { Attivita, Ripresa } from '../types'
import {
  AUTONOMO,
  ISTRUZIONI_COMPATTAZIONE,
  LIVELLI_EFFORT,
  barra,
  coloreEffort,
  coloreLivello,
  coloreModello,
  descriviLimite,
  formattaToken,
  genitore,
  gitdirDaFile,
  istanteRipresa,
  nomeCartella,
  nomeModello,
  normalizzaPercorso,
  orario,
  promptRipresa,
  ramoDaHead,
  riepilogoAttivita,
  sezioneAutorizzazioni,
  testoAutorizzazione,
} from './testi'

const P = 'infobar'
const modello = atom({ plugin: 'infobar', key: 'modello' } as const, null)
const effort = atom({ plugin: 'infobar', key: 'effort' } as const, null)
const cartella = atom({ plugin: 'infobar', key: 'cartella' } as const, null)
const branch = atom({ plugin: 'infobar', key: 'branch' } as const, null)
const percent = atom({ plugin: 'infobar', key: 'percent' } as const, null)
const tokens = atom({ plugin: 'infobar', key: 'tokens' } as const, null)
const avvisato = atom({ plugin: 'infobar', key: 'avvisato' } as const, 0)
const turnoAttivo = atom({ plugin: 'infobar', key: 'turnoAttivo' } as const, false)
const agenti = atom({ plugin: 'infobar', key: 'agenti' } as const, [])
const inBackground = atom({ plugin: 'infobar', key: 'inBackground' } as const, [])
const ripresa = atom({ plugin: 'infobar', key: 'ripresa' } as const, null)
const tentativi = atom({ plugin: 'infobar', key: 'tentativi' } as const, 0)
const agentiFalliti = atom({ plugin: 'infobar', key: 'agentiFalliti' } as const, [])
const limiti = atom({ plugin: 'infobar', key: 'limiti' } as const, [])
const autorizzazioni = atom({ plugin: 'infobar', key: 'autorizzazioni' } as const, [])

const SOGLIE = [85, 70]
const MAX_TENTATIVI = 4

async function attivitaInCorso($: EngineInterface): Promise<Attivita[]> {
  return [...(await read($, agenti)), ...(await read($, inBackground))]
}

let fileHead: string | null = null
let timerRipresa: Timer | null = null

async function trovaHead($: EngineInterface): Promise<string | null> {
  for (let dir: string | null = normalizzaPercorso(await $.session.cwd()); dir; dir = genitore(dir)) {
    const git = `${dir}/.git`
    if (!(await $.fs.exists(git))) continue
    if ((await $.fs.stat(git)).kind === 'dir') return `${git}/HEAD`
    const gitdir = gitdirDaFile(await $.fs.read(git), dir)
    return gitdir ? `${gitdir}/HEAD` : null
  }
  return null
}

async function aggiornaBranch($: EngineInterface) {
  const ramo = fileHead ? ramoDaHead(await $.fs.read(fileHead).catch(() => '')) : null
  if ((await read($, branch)) !== ramo) await update($, branch, () => ramo)
}

async function aggiornaIntestazione($: EngineInterface) {
  const nome = nomeModello(await $.session.model())
  if ((await read($, modello)) !== nome) await update($, modello, () => nome)
  await aggiornaBranch($)
}

async function aggiornaAgenti($: EngineInterface) {
  const attivi = (await $.agent.list())
    .filter(a => a.status === 'running' || a.status === 'pending')
    .map(a => ({ tipo: 'agent', descrizione: a.description }))
  if (JSON.stringify(await read($, agenti)) !== JSON.stringify(attivi)) await update($, agenti, () => attivi)
}

async function registraLimiti($: EngineInterface, finestre: readonly SessionRateLimit[]) {
  const nuovi = finestre.map(f => ({ kind: f.kind, percentUsed: f.percentUsed, resetsAt: f.resetsAt }))
  if (JSON.stringify(await read($, limiti)) !== JSON.stringify(nuovi)) await update($, limiti, () => nuovi)
}

async function registraContesto($: EngineInterface, context: SessionContextUsage): Promise<number | null> {
  const p = context.percent
  if (p === undefined) return null
  if ((await read($, percent)) !== p) await update($, percent, () => p)
  const t = context.tokens ?? null
  if ((await read($, tokens)) !== t) await update($, tokens, () => t)
  return p
}

async function aggiornaContesto($: EngineInterface, context: SessionContextUsage) {
  const p = await registraContesto($, context)
  if (p === null) return
  const gia = await read($, avvisato)
  if (p < 50 && gia) await update($, avvisato, () => 0)
  const soglia = SOGLIE.find(s => p >= s && gia < s)
  if (!soglia) return
  await update($, avvisato, () => soglia)
  const occupati = await attivitaInCorso($)
  $.ui.toast(
    occupati.length
      ? `Contesto al ${p}%: compatta appena finiscono ${riepilogoAttivita(occupati)}.`
      : `Contesto al ${p}%: buon momento per /compatta.`,
    { timeoutMs: 8000 },
  )
}

async function armaRipresa($: EngineInterface) {
  timerRipresa?.cancel()
  timerRipresa = null
  const r = await read($, ripresa)
  if (!r) return
  const attesa = Math.max(0, r.at - (await $.clock.now()))
  timerRipresa = $.clock.after(attesa, () => void eseguiRipresa($))
}

async function eseguiRipresa($: EngineInterface) {
  const r = await read($, ripresa)
  if (!r) return
  if (await read($, turnoAttivo)) {
    timerRipresa = $.clock.after(30_000, () => void eseguiRipresa($))
    return
  }
  const falliti = await read($, agentiFalliti)
  await update($, ripresa, () => null)
  await update($, agentiFalliti, () => [])
  await $.prompt.submit({ text: promptRipresa(r.motivo, falliti), asUser: true })
}

async function programmaRipresa($: EngineInterface, motivo: string, at: number) {
  const n = (await read($, tentativi)) + 1
  if (n > MAX_TENTATIVI) {
    $.ui.toast(`Ripresa automatica sospesa dopo ${MAX_TENTATIVI} tentativi (${motivo}).`, { timeoutMs: 10_000 })
    return
  }
  await update($, tentativi, () => n)
  const r: Ripresa = { at, motivo, tentativi: n }
  await update($, ripresa, () => r)
  await armaRipresa($)
  $.ui.toast(`${motivo}: riprendo da solo alle ${orario(at)} (/ripresa annulla per fermarla).`, { timeoutMs: 10_000 })
}

async function annullaRipresa($: EngineInterface) {
  timerRipresa?.cancel()
  timerRipresa = null
  await update($, ripresa, () => null)
  await update($, tentativi, () => 0)
  await update($, agentiFalliti, () => [])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'compatta', description: 'Compatta solo se non ci sono lavori in corso', argumentHint: '[forza] [istruzioni]' })
    await $.command.register({ name: 'autorizza', description: 'Aggiunge un\'autorizzazione di sessione (alias: db, prod, deploy, commit, push)', argumentHint: '[testo|alias]' })
    await $.command.register({ name: 'revoca', description: 'Revoca un\'autorizzazione di sessione', argumentHint: '<n|tutte>' })
    await $.command.register({ name: 'autonomo', description: 'Attiva o disattiva la modalità autonoma di sessione' })
    await $.command.register({ name: 'ripresa', description: 'Stato della ripresa automatica dopo un limite', argumentHint: '[annulla]', immediate: true })
    const dir = nomeCartella(await $.session.cwd())
    if ((await read($, cartella)) !== dir) await update($, cartella, () => dir)
    const livelloIniziale = await $.env.get('CLAUDE_EFFORT')
    if (livelloIniziale && LIVELLI_EFFORT.includes(livelloIniziale)) await update($, effort, () => livelloIniziale)
    fileHead = await trovaHead($)
    await aggiornaIntestazione($)
    const uso = await $.session.usage()
    await registraContesto($, uso.context)
    await registraLimiti($, uso.rateLimits)
    await armaRipresa($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if ((await read($, turnoAttivo)) !== true) await update($, turnoAttivo, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      if (e.reason === 'error') {
        const agente = (await $.agent.list()).find(a => a.id === e.agentId)
        const nome = agente ? `${agente.description} (${agente.id})` : e.agentId
        await update($, agentiFalliti, l => (l.includes(nome) ? l : [...l, nome].slice(-10)))
      }
      await aggiornaAgenti($)
      return next(e)
    }
    if ((await read($, turnoAttivo)) !== false) await update($, turnoAttivo, () => false)
    if (e.reason === 'answer') if ((await read($, tentativi)) !== 0) await update($, tentativi, () => 0)
    await aggiornaIntestazione($)
    await aggiornaAgenti($)
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const esito = await next(e)
    await aggiornaAgenti($)
    return esito
  })

  on('prompt.submit', async ($, e, next) => {
    const daPersona = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (daPersona) {
      if (await read($, ripresa)) await annullaRipresa($)
      await aggiornaBranch($)
    }
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    if ((await read($, turnoAttivo)) !== false) await update($, turnoAttivo, () => false)
    const livello = e.effort?.level
    if (livello && (await read($, effort)) !== livello) await update($, effort, () => livello)
    const attivi = (e.background_tasks ?? [])
      .filter(t => t.type !== 'subagent')
      .map(t => ({ tipo: t.type, descrizione: t.name ?? t.description }))
    if (JSON.stringify(await read($, inBackground)) !== JSON.stringify(attivi)) await update($, inBackground, () => attivi)
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if ((await read($, turnoAttivo)) !== false) await update($, turnoAttivo, () => false)
    const ora = await $.clock.now()
    if (e.error === 'rate_limit') {
      const { rateLimits } = await $.session.usage()
      await programmaRipresa($, 'limite di utilizzo raggiunto', istanteRipresa(rateLimits, ora) ?? ora + 5 * 60_000)
    } else if (e.error === 'overloaded' || e.error === 'server_error') {
      await programmaRipresa($, 'errore API temporaneo', ora + 30_000)
    }
    return next(e)
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const esito = await next(e)
    const nome = nomeModello(await $.session.model())
  if ((await read($, modello)) !== nome) await update($, modello, () => nome)
    return esito
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const esito = await next(e)
    const livello = e.args.trim().toLowerCase()
    if (LIVELLI_EFFORT.includes(livello)) if ((await read($, effort)) !== livello) await update($, effort, () => livello)
    return esito
  })

  on('session.measure', async ($, e, next) => {
    await registraLimiti($, e.rateLimits)
    await aggiornaContesto($, e.context)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const esito = await next(e)
    if (!e.agentId) {
      const uso = await $.session.usage()
      await aggiornaContesto($, uso.context)
      await registraLimiti($, uso.rateLimits)
    }
    return esito
  })

  on('session.compact', async ($, e, next) => {
    const extra = [ISTRUZIONI_COMPATTAZIONE]
    const r = await read($, ripresa)
    if (r) extra.push(`È programmata una ripresa automatica alle ${orario(r.at)} (${r.motivo}).`)
    return next({ ...e, instructions: [e.instructions, ...extra].filter(Boolean).join('\n\n') })
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const lista = await read($, autorizzazioni)
    if (!lista.length) return r
    return { sections: [...r.sections, { id: `${P}:autorizzazioni`, text: sezioneAutorizzazioni(lista), scope: 'session' as const }] }
  })

  on('command.run', { command: 'compatta' }, async ($, e) => {
    const forza = /^forza\b/i.test(e.args.trim())
    const istruzioni = e.args.trim().replace(/^forza\b\s*/i, '')
    const occupati = await attivitaInCorso($)
    if (occupati.length && !forza) {
      return { text: `Non compatto: in corso ${riepilogoAttivita(occupati)} (${occupati.map(a => a.descrizione).join('; ')}). Usa /compatta forza per farlo comunque.` }
    }
    $.clock.after(0, () => {
      void $.session.compact(istruzioni ? { instructions: istruzioni } : {}).catch(() => $.ui.toast('Compattazione non riuscita: c\'è un turno in corso, riprova a fine turno.'))
    })
    return { text: 'Compatto ora.' }
  })

  on('command.run', { command: 'autorizza' }, async ($, e) => {
    const testo = testoAutorizzazione(e.args)
    if (testo) await update($, autorizzazioni, l => (l.includes(testo) ? l : [...l, testo]))
    const lista = await read($, autorizzazioni)
    return {
      text: lista.length
        ? `Autorizzazioni di sessione:\n${lista.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
        : 'Nessuna autorizzazione di sessione attiva.',
    }
  })

  on('command.run', { command: 'revoca' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'tutte') await update($, autorizzazioni, () => [])
    else {
      const n = Number(arg)
      if (!Number.isInteger(n) || n < 1) return { text: 'Uso: /revoca <numero> oppure /revoca tutte (i numeri li mostra /autorizza).' }
      await update($, autorizzazioni, l => l.filter((_, i) => i !== n - 1))
    }
    const lista = await read($, autorizzazioni)
    return { text: lista.length ? `Restano:\n${lista.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : 'Tutte le autorizzazioni di sessione sono revocate.' }
  })

  on('command.run', { command: 'autonomo' }, async $ => {
    const attivo = (await read($, autorizzazioni)).includes(AUTONOMO)
    await update($, autorizzazioni, l => (attivo ? l.filter(a => a !== AUTONOMO) : [...l, AUTONOMO]))
    return { text: attivo ? 'Modalità autonoma disattivata.' : 'Modalità autonoma attiva per questa sessione, anche dopo la compattazione.' }
  })

  on('command.run', { command: 'ripresa' }, async ($, e) => {
    const r = await read($, ripresa)
    if (e.args.trim().toLowerCase() === 'annulla') {
      await annullaRipresa($)
      return { text: r ? 'Ripresa automatica annullata.' : 'Nessuna ripresa programmata.' }
    }
    return { text: r ? `Ripresa automatica alle ${orario(r.at)} (${r.motivo}, tentativo ${r.tentativi}/${MAX_TENTATIVI}).` : 'Nessuna ripresa programmata.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const nome = await read($, modello)
    const livello = await read($, effort)
    const dir = await read($, cartella)
    const ramo = await read($, branch)
    const finestre = await read($, limiti)
    const ora = await $.clock.now()
    const p = await read($, percent)
    const t = await read($, tokens)
    const occupati = [...(await read($, agenti)), ...(await read($, inBackground))]
    const turno = await read($, turnoAttivo)
    const r = await read($, ripresa)
    const lista = await read($, autorizzazioni)
    const colore = p === null ? undefined : coloreLivello(p)
    const autonomo = lista.includes(AUTONOMO)
    const altre = lista.length - (autonomo ? 1 : 0)
    const autorizz = [autonomo ? 'autonomo' : '', altre ? `${altre} autorizz.` : ''].filter(Boolean).join(', ')
    const sotto = await next(e)

    return (
      <Box flexDirection="column">
        {sotto}
        <Box flexDirection="row">
          {nome ? <Text bold color={coloreModello(nome)}>{nome}</Text> : null}
          {livello ? <Text color={coloreEffort(livello)}>{` ${livello}`}</Text> : null}
          {dir ? <Text dimColor>{' | '}</Text> : null}
          {dir ? <Text bold color="yellow">{dir}</Text> : null}
          {ramo ? <Text color="cyan">{` (${ramo})`}</Text> : null}
        </Box>
        <Box flexDirection="row">
          <Text color={colore}>{'◐ '}</Text>
          {t === null ? null : <Text bold>{`${formattaToken(t)} `}</Text>}
          <Text color={colore}>{p === null ? '-' : `${p}%`}</Text>
          {p === null ? null : <Text color={colore}>{` ${barra(p)}`}</Text>}
          <Text>{' '}</Text>
          {occupati.length ? (
            <Text color="yellow">{`◷ ${occupati.length}`}</Text>
          ) : turno ? (
            <Text dimColor>…</Text>
          ) : (
            <Text dimColor>✓</Text>
          )}
          {autorizz ? <Text dimColor>{' | '}</Text> : null}
          {autorizz ? <Text color="cyan">{autorizz}</Text> : null}
          {r ? <Text dimColor>{' | '}</Text> : null}
          {r ? <Text color="magenta">{`ripresa ${orario(r.at)} `}</Text> : null}
          {r ? <Button key="annulla-ripresa" label="annulla" plain onPress={() => annullaRipresa($)} /> : null}
          {finestre.map(f => {
            const l = descriviLimite(f, ora)
            return (
              <Text key={f.kind}>
                <Text dimColor>{` | ${l.etichetta} `}</Text>
                <Text color={l.colore}>{`${l.percentuale}%`}</Text>
                {l.mancano ? <Text dimColor>{` ↻ ${l.mancano}`}</Text> : null}
              </Text>
            )
          })}
        </Box>
      </Box>
    )
  })
}
