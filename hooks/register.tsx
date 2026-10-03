import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { Attivita, ImmagineIncollata, Ripresa } from '../types'
import { fitRow, imageNumbers, pngSize } from './layout'
import { decodeThumbnail } from './png'
import { fromBase64, rasterCells, toBase64 } from './raster'
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
const immagini = atom({ plugin: 'infobar', key: 'immagini' } as const, [] as ImmagineIncollata[])

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

// Copre la miniatura più grande (32 x 6 celle = 32 x 12 pixel a mezzi blocchi) con margine per la media.
const LATO_MINIATURA = 64
// Un'immagine citata nel prompt ma non ancora su disco si cerca di nuovo a questi intervalli, poi si lascia stare.
const RITENTA_MS = [250, 1000, 3000]

type Anteprima = 'immagini' | 'blocchi'

// Decisa in session.start; un ridisegno della riga di suggerimento può chiedere una sincronizzazione prima.
let fissaAnteprima: (anteprima: Anteprima) => void = () => {}
const anteprima = new Promise<Anteprima>(resolve => (fissaAnteprima = resolve))
let trovata: { sessione: string; cartella: string } | undefined
let radici: string[] | undefined
// I numeri delle immagini disegnate, così un prompt invariato non tocca né il disco né lo stato;
// undefined finché il disegno è incompleto o, dopo un reload, sconosciuto.
let chiaveMostrata: string | undefined
// I numeri il cui file mancava: le modifiche al prompt non tornano sul disco fino al prossimo tentativo.
let chiaveMancante: string | undefined
let ricerche = 0
let inAttesa: { bozza: string; ritenta: boolean } | undefined
let sincronizzando = false
const descritte = new Map<string, Omit<ImmagineIncollata, 'n'>>()

async function terminaleConImmagini($: EngineInterface): Promise<boolean> {
  if ((await $.env.get('TMUX')) || (await $.env.get('STY'))) return false
  if ((await $.env.get('KITTY_WINDOW_ID')) || (await $.env.get('GHOSTTY_RESOURCES_DIR'))) return true
  if (await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) return true
  const programma = await $.env.get('TERM_PROGRAM')
  if (programma === 'ghostty' || programma === 'kitty' || programma === 'WezTerm') return true
  const term = (await $.env.get('TERM')) ?? ''
  return term.includes('kitty') || term.includes('ghostty')
}

// Claude Code salva ogni incolla in <tmp>/<progetto>/<sessione>/images/<n>.png: <tmp> è %TEMP%\claude
// su Windows e /tmp/claude-<uid> altrove, salvo CLAUDE_CODE_TMPDIR.
async function radiciTemp($: EngineInterface): Promise<string[]> {
  const configurata = await $.env.get('CLAUDE_CODE_TMPDIR')
  if (configurata) return [normalizzaPercorso(configurata), `${normalizzaPercorso(configurata)}/claude`]
  if ((await $.env.get('OS')) === 'Windows_NT') {
    const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMP'))
    return temp ? [`${normalizzaPercorso(temp)}/claude`] : []
  }
  const uid = await $.process.run(['id', '-u']).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  )
  return uid ? [`/tmp/claude-${uid}`] : []
}

// La cartella del progetto prende il nome dalla directory in cui è partita la sessione, che nel frattempo
// può essere cambiata: prima si prova il nome ricavato da quella attuale, poi si cerca per id di sessione.
async function cartellaImmagini($: EngineInterface): Promise<string | undefined> {
  const sessione = await $.session.id()
  if (trovata?.sessione === sessione) return trovata.cartella
  radici ??= await radiciTemp($)
  const progetto = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
  for (const radice of radici) {
    const ipotesi = `${radice}/${progetto}/${sessione}/images`
    if (await $.fs.exists(ipotesi)) return (trovata = { sessione, cartella: ipotesi }).cartella
  }
  for (const radice of radici) {
    for (const voce of await $.fs.list(radice).catch(() => [])) {
      const cartella = `${radice}/${voce.name}/${sessione}/images`
      if (voce.kind === 'dir' && (await $.fs.exists(cartella))) return (trovata = { sessione, cartella }).cartella
    }
  }
  return undefined
}

async function descrivi($: EngineInterface, cartella: string | undefined, n: number): Promise<ImmagineIncollata> {
  const path = `${cartella}/${n}.png`
  const giaVista = descritte.get(path)
  if (giaVista) return { n, ...giaVista }
  if (cartella === undefined || !(await $.fs.exists(path))) return { n, path: null, size: null }

  // Oltre i 4 MiB che $.fs.read concede: si disegna comunque dal file, solo senza proporzioni.
  const base64 = await $.fs.read(path, { as: 'bytes' }).then(
    r => r.base64,
    () => undefined,
  )
  const size = base64 === undefined ? null : pngSize(base64)
  if (base64 !== undefined && size === null) return { n, path: null, size: null }

  let immagine: Omit<ImmagineIncollata, 'n'> = { path, size }
  if ((await anteprima) === 'blocchi') {
    let thumbnail: ImmagineIncollata['thumbnail'] = null
    if (base64 !== undefined) {
      try {
        const decodificata = decodeThumbnail(fromBase64(base64), LATO_MINIATURA, LATO_MINIATURA)
        thumbnail = { width: decodificata.width, height: decodificata.height, rgba: toBase64(decodificata.rgba) }
      } catch {
        // PNG interlacciato o danneggiato: il riquadro mostra il tag al posto della miniatura.
      }
    }
    immagine = { ...immagine, thumbnail }
  }
  descritte.set(path, immagine)
  return { n, ...immagine }
}

async function mostra($: EngineInterface, bozza: string, ritenta: boolean) {
  const numeri = imageNumbers(bozza)
  const chiave = numeri.join(',')
  if (chiave === chiaveMostrata) return
  if (chiave === chiaveMancante && !ritenta) return
  if (chiave !== chiaveMancante) ricerche = 0

  const cartella = numeri.length > 0 ? await cartellaImmagini($) : undefined
  const lista: ImmagineIncollata[] = []
  for (const n of numeri) lista.push(await descrivi($, cartella, n))
  await update($, immagini, () => lista)

  if (lista.every(immagine => immagine.path !== null)) {
    chiaveMostrata = chiave
    chiaveMancante = undefined
    return
  }
  chiaveMostrata = undefined
  chiaveMancante = chiave
  const attesa = RITENTA_MS[ricerche++]
  if (attesa !== undefined) $.clock.after(attesa, async () => sincronizza($, (await $.prompt.read()).text, true))
}

// Gira su un timer suo e non dentro l'hook che l'ha chiesta, così decodificare un'immagine grande
// non blocca l'editor né consuma il budget dell'hook. Le modifiche ravvicinate si fondono nell'ultima.
function sincronizza($: EngineInterface, bozza: string, ritenta = false) {
  inAttesa = { bozza, ritenta: ritenta || (inAttesa?.ritenta ?? false) }
  if (sincronizzando) return
  sincronizzando = true
  $.clock.after(0, async () => {
    try {
      while (inAttesa !== undefined) {
        const prossima = inAttesa
        inAttesa = undefined
        await mostra($, prossima.bozza, prossima.ritenta)
      }
    } finally {
      sincronizzando = false
    }
  })
}

async function comandoApertura($: EngineInterface, path: string): Promise<string[]> {
  if ((await $.env.get('OS')) === 'Windows_NT') return ['explorer.exe', path.replaceAll('/', '\\')]
  const { stdout } = await $.process.run(['uname', '-s'])
  return [stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', path]
}

// Apre l'immagine con il visualizzatore predefinito; explorer.exe esce con 1 anche quando l'ha aperta.
async function apri($: EngineInterface, path: string) {
  const esito = await comandoApertura($, path)
    .then(argv => $.process.run(argv))
    .catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path}: ${esito.message}`)
}

/** La riga di miniature sopra la barra, o null quando nel prompt non ci sono immagini. */
async function rigaImmagini($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  if (e.surface !== 'terminal') return null
  const lista = await read($, immagini)
  if (lista.length === 0) return null

  const { Box, Button, Image, Raster, Text } = $.ui.resolve(e)
  // Due righe della banda sono di infobar.
  const celle = fitRow(lista.map(immagine => immagine.size), e.props.maxRows - 2, e.props.bodyColumns)

  return (
    <Box flexDirection="row" columnGap={1}>
      {lista.map((immagine, i) => {
        const { columns, rows } = celle[i] ?? { columns: 4, rows: 1 }
        const miniatura = immagine.thumbnail
        return (
          <Box flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
            {immagine.path === null ? (
              <Box width={columns} height={rows} alignItems="center" justifyContent="center">
                <Text dimColor wrap="truncate">nessuna anteprima</Text>
              </Box>
            ) : miniatura ? (
              <Raster
                key={`immagine-${immagine.n}`}
                columns={columns}
                rows={rows}
                cells={rasterCells({ ...miniatura, rgba: fromBase64(miniatura.rgba) }, columns, rows)}
              />
            ) : miniatura === null ? (
              <Box width={columns} height={rows} alignItems="center" justifyContent="center">
                <Text dimColor wrap="truncate">[Image #{immagine.n}]</Text>
              </Box>
            ) : (
              <Image
                key={`immagine-${immagine.n}`}
                source={{ file: immagine.path, format: 'png' }}
                columns={columns}
                rows={rows}
                alt={`[Image #${immagine.n}]`}
              />
            )}
            {immagine.path === null ? (
              <Text dimColor>#{immagine.n}</Text>
            ) : (
              <Box width={columns} justifyContent="center">
                <Button
                  key={`apri-${immagine.n}`}
                  label={immagine.n <= 9 ? 'apri' : `#${immagine.n}`}
                  plain
                  dimColor
                  {...(immagine.n <= 9 && { hotkey: String(immagine.n) })}
                  onPress={() => apri($, immagine.path!)}
                />
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const scelta = options.anteprime
  const conAnteprime = scelta !== 'no'
  if (scelta === 'immagini' || scelta === 'blocchi') fissaAnteprima(scelta)

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
    if (conAnteprime) {
      if (scelta !== 'immagini' && scelta !== 'blocchi') fissaAnteprima((await terminaleConImmagini($)) ? 'immagini' : 'blocchi')
      sincronizza($, (await $.prompt.read()).text)
    }

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

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (conAnteprime) sincronizza($, box.text)
    return box
  })

  // Incollare un'immagine non solleva prompt.edit, ma la riga di suggerimento si ridisegna ("Pasting…"
  // e ritorno) con il tag [Image #n] già nel prompt: è l'unico evento che segnala l'incolla.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (conAnteprime && e.surface === 'terminal') void $.prompt.read().then(box => sincronizza($, box.text))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (conAnteprime) sincronizza($, '')
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
    // Le miniature le disegna infobar stesso: un Button arrivato da next(e) dentro l'albero di un
    // altro plugin non riceve i clic (Claude Code 2.1.288).
    const miniature = await rigaImmagini($, e)

    return (
      <Box flexDirection="column">
        {miniature}
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
