import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, RenderInput, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { ImmagineIncollata, Ripresa } from '../types'
import {
  PANNELLO_CONTI,
  aggiornaContiSeVecchi,
  aggiornaContoSessione,
  apriConti,
  conCswap,
  disegnaConti,
  loginProprio,
  pannelloAperto,
  passaA,
  larghezzaConto,
  pulsanteConto,
} from './account'
import { apri } from './apri'
import { PANNELLO_LAVORI, apriLavori, attivitaInCorso, disegnaLavori, lavoriDaAgenti, lavoriDaRiepilogo, lavoriInCorso, lavoroDaNotifica, lavoroFermato } from './lavori'
import { alterna, registraPannelli } from './pannelli'
import { PANNELLO_MESSAGGI, apriMessaggi, messaggioInviato, nuovaSessioneMessaggi, quantiMessaggi, registraMessaggi } from './messaggi'
import { PANNELLO_MODIFICHE, apriModifiche, disegnaModifiche, fileModificati, forseModificati } from './modifiche'
import { cartellaSessione } from './sessione'
import { aggiornaCodex, codexDaMostrare } from './codex-uso'
import { registraCopia, rispostaFinita } from './copia'
import { EXTENSIONS, type Format, decodeImage, formatOf, imageSize } from './formati'
import { fitRow, imageNumbers } from './layout'
import { type Anteprima, registraLetture } from './letture'
import { fromBase64, rasterCells, toBase64 } from './raster'
import {
  AUTONOMO,
  ISTRUZIONI_COMPATTAZIONE,
  LIVELLI_EFFORT,
  accorcia,
  accorciaCoppia,
  siglaEffort,
  barra,
  coloreEffort,
  coloreLivello,
  coloreModello,
  descriviLimite,
  effortDaImpostazioni,
  limitiSalvati,
  formattaDurata,
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
const ripresa = atom({ plugin: 'infobar', key: 'ripresa' } as const, null)
const tentativi = atom({ plugin: 'infobar', key: 'tentativi' } as const, 0)
const agentiFalliti = atom({ plugin: 'infobar', key: 'agentiFalliti' } as const, [])
const limiti = atom({ plugin: 'infobar', key: 'limiti' } as const, [])
const limitiVistiAlle = atom({ plugin: 'infobar', key: 'limitiVistiAlle' } as const, null)
const autorizzazioni = atom({ plugin: 'infobar', key: 'autorizzazioni' } as const, [])
const immagini = atom({ plugin: 'infobar', key: 'immagini' } as const, [] as ImmagineIncollata[])

const SOGLIE = [85, 70]
const MAX_TENTATIVI = 4

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

// Fuori da un turno l'effort non arriva da nessun evento: lo si ricava come fa Claude Code all'avvio.
async function aggiornaEffort($: EngineInterface) {
  const daAmbiente = await $.env.get('CLAUDE_EFFORT')
  const livello =
    daAmbiente && LIVELLI_EFFORT.includes(daAmbiente)
      ? daAmbiente
      : effortDaImpostazioni(await $.settings.read(), await $.session.model())
  if (livello && (await read($, effort)) !== livello) await update($, effort, () => livello)
}

async function aggiornaTutto($: EngineInterface, conContesto = true) {
  await aggiornaIntestazione($)
  await aggiornaEffort($)
  const uso = await $.session.usage()
  if (conContesto) await registraContesto($, await contestoAttuale($, uso.context))
  if (uso.rateLimits.length) await registraLimiti($, uso.rateLimits)
  else if (!(await read($, limiti)).length) {
    const salvati = limitiSalvati(await $.store.get('limiti'), await $.clock.now())
    if (salvati) {
      await update($, limiti, () => salvati.finestre)
      await update($, limitiVistiAlle, () => salvati.at)
    }
  }
}

async function registraLimiti($: EngineInterface, finestre: readonly SessionRateLimit[]) {
  const nuovi = finestre.map(f => ({ kind: f.kind, percentUsed: f.percentUsed, resetsAt: f.resetsAt }))
  const eranoVecchi = (await read($, limitiVistiAlle)) !== null
  if (eranoVecchi) await update($, limitiVistiAlle, () => null)
  if (!eranoVecchi && JSON.stringify(await read($, limiti)) === JSON.stringify(nuovi)) return
  await update($, limiti, () => nuovi)
  // I limiti sono dell'account: la prossima sessione li mostra subito (in grigio), senza aspettare la prima risposta.
  if (nuovi.length) await $.store.set('limiti', { at: await $.clock.now(), finestre: nuovi })
}

// Prima della prima risposta Claude Code non sa quanti token ha il contesto: si stima come fa /context, in locale.
async function contestoAttuale($: EngineInterface, context: SessionContextUsage): Promise<SessionContextUsage> {
  if (context.tokens !== undefined) return context
  const totale = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.totalTokens
  return totale === undefined ? context : { ...context, tokens: totale, percent: Math.round((totale / context.window) * 100) }
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
      ? `Contesto al ${p}%: /compact appena finiscono ${riepilogoAttivita(occupati)}.`
      : `Contesto al ${p}%: buon momento per /compact.`,
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

// Il riquadro più grande è 32 x 6 celle: a 10 x 20 pixel per cella (Windows Terminal via Sixel) fanno 320 x 120.
const MARGINE_BARRA = 3
const MINIATURA_IMMAGINI = { width: 320, height: 120 }
// A mezzi blocchi lo stesso riquadro vale 32 x 12 pixel: 64 lascia margine per la media.
const MINIATURA_BLOCCHI = { width: 64, height: 64 }
// Il massimo che $.fs.read concede.
const MAX_LETTURA = 4 * 1024 * 1024
// Quanto aspetta la decodifica, perché la banda disegni prima il riquadro vuoto: decodificare tiene occupato il worker.
const RESPIRO_MS = 20
// Un'immagine citata nel prompt ma non ancora su disco si cerca di nuovo a questi intervalli, poi si lascia stare.
const RITENTA_MS = [250, 1000, 3000]

// Decisa in session.start; un ridisegno della riga di suggerimento può chiedere una sincronizzazione prima.
let risolviAnteprima: (anteprima: Anteprima) => void = () => {}
const anteprima = new Promise<Anteprima>(resolve => (risolviAnteprima = resolve))
// La stessa scelta da leggere senza attendere: dopo un reload la banda può ridisegnarsi prima di session.start.
let anteprimaDecisa: Anteprima | undefined
function fissaAnteprima(scelta: Anteprima) {
  anteprimaDecisa ??= scelta
  risolviAnteprima(scelta)
}
// I numeri delle immagini disegnate, così un prompt invariato non tocca né il disco né lo stato;
// undefined finché il disegno è incompleto o, dopo un reload, sconosciuto.
let chiaveMostrata: string | undefined
// I numeri il cui file mancava: le modifiche al prompt non tornano sul disco fino al prossimo tentativo.
let chiaveMancante: string | undefined
let ricerche = 0
let inAttesa: { bozza: string; ritenta: boolean } | undefined
let sincronizzando = false
// Per `<cartella>/<n>`, così ogni immagine si cerca, si legge e si decodifica una volta sola.
const descritte = new Map<string, Omit<ImmagineIncollata, 'n'>>()
const daDecodificare = new Map<string, { n: number; bytes: Uint8Array; formato: Format }>()
let decodificando = false

async function terminaleConImmagini($: EngineInterface): Promise<boolean> {
  if ((await $.env.get('TMUX')) || (await $.env.get('STY'))) return false
  if ((await $.env.get('KITTY_WINDOW_ID')) || (await $.env.get('GHOSTTY_RESOURCES_DIR'))) return true
  if (await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) return true
  const programma = await $.env.get('TERM_PROGRAM')
  if (programma === 'ghostty' || programma === 'kitty' || programma === 'WezTerm') return true
  const term = (await $.env.get('TERM')) ?? ''
  return term.includes('kitty') || term.includes('ghostty')
}

async function cartellaImmagini($: EngineInterface): Promise<string | undefined> {
  const sessione = await cartellaSessione($)
  return sessione && `${sessione}/images`
}

// Claude Code salva ogni immagine incollata come <n>.<estensione del suo formato>.
async function fileImmagini($: EngineInterface, cartella: string): Promise<Map<number, FsEntry>> {
  const voci = await $.fs.list(cartella).catch(() => [] as FsEntry[])
  const file = new Map<number, FsEntry>()
  for (const voce of voci) {
    const parti = /^(\d+)\.(\w+)$/.exec(voce.name)
    if (parti && voce.kind === 'file' && EXTENSIONS[parti[2]!.toLowerCase()] && !file.has(Number(parti[1]))) file.set(Number(parti[1]), voce)
  }
  return file
}

async function descrivi($: EngineInterface, cartella: string | undefined, n: number, file: Map<number, FsEntry>): Promise<ImmagineIncollata> {
  const chiave = `${cartella}/${n}`
  const giaVista = descritte.get(chiave)
  if (giaVista) return { n, ...giaVista }
  const voce = file.get(n)
  if (cartella === undefined || !voce) return { n, path: null, size: null }
  const path = `${cartella}/${voce.name}`
  const modo = await anteprima

  let immagine: Omit<ImmagineIncollata, 'n'>
  if (modo === 'etichette') {
    immagine = { path, size: null }
  } else if (voce.size > MAX_LETTURA) {
    const png = EXTENSIONS[voce.name.split('.').pop()!.toLowerCase()] === 'png'
    immagine = { path, size: null, anteprima: png && modo === 'immagini' ? { tipo: 'file' } : { tipo: 'nota', testo: 'oltre 4 MiB' } }
  } else {
    const bytes = await $.fs.read(path, { as: 'bytes' }).then(
      r => fromBase64(r.base64),
      () => undefined,
    )
    const formato = bytes && formatOf(bytes)
    const size = formato ? imageSize(bytes, formato) : null
    if (!bytes || !formato || !size) {
      immagine = { path, size: null, anteprima: { tipo: 'nota', testo: `[Image #${n}]` } }
    } else if (formato === 'webp') {
      immagine = { path, size, anteprima: { tipo: 'nota', testo: 'WebP: niente anteprima' } }
    } else {
      immagine = { path, size }
      daDecodificare.set(chiave, { n, bytes, formato })
    }
  }
  descritte.set(chiave, immagine)
  return { n, ...immagine }
}

// Una decodifica per giro di timer, ciascuna col suo aggiornamento: la prima miniatura non aspetta le altre.
function decodificaInSeguito($: EngineInterface) {
  if (decodificando || daDecodificare.size === 0) return
  decodificando = true
  $.clock.after(RESPIRO_MS, async () => {
    try {
      const [chiave, { n, bytes, formato }] = daDecodificare.entries().next().value!
      daDecodificare.delete(chiave)
      const lato = (await anteprima) === 'immagini' ? MINIATURA_IMMAGINI : MINIATURA_BLOCCHI
      let fatta: NonNullable<ImmagineIncollata['anteprima']>
      try {
        const miniatura = decodeImage(bytes, formato, lato.width, lato.height)
        fatta = { tipo: 'pixel', width: miniatura.width, height: miniatura.height, rgba: toBase64(miniatura.rgba) }
      } catch {
        // PNG interlacciato, JPEG aritmetico o file danneggiato: il riquadro mostra il tag.
        fatta = { tipo: 'nota', testo: `[Image #${n}]` }
      }
      const vista = descritte.get(chiave)
      if (!vista) return
      descritte.set(chiave, { ...vista, anteprima: fatta })
      await update($, immagini, lista =>
        lista.some(i => i.path === vista.path) ? lista.map(i => (i.path === vista.path ? { ...i, anteprima: fatta } : i)) : lista,
      )
    } finally {
      decodificando = false
      decodificaInSeguito($)
    }
  })
}

async function mostra($: EngineInterface, bozza: string, ritenta: boolean) {
  const numeri = imageNumbers(bozza)
  const chiave = numeri.join(',')
  if (chiave === chiaveMostrata) return
  if (chiave === chiaveMancante && !ritenta) return
  if (chiave !== chiaveMancante) ricerche = 0

  const cartella = numeri.length > 0 ? await cartellaImmagini($) : undefined
  const daCercare = cartella !== undefined && numeri.some(n => !descritte.has(`${cartella}/${n}`))
  const file = daCercare ? await fileImmagini($, cartella) : new Map<number, FsEntry>()
  const lista: ImmagineIncollata[] = []
  for (const n of numeri) lista.push(await descrivi($, cartella, n, file))
  await update($, immagini, () => lista)
  decodificaInSeguito($)

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

// Gira su un timer suo e non dentro l'hook che l'ha chiesta, così leggere i file non blocca
// l'editor né consuma il budget dell'hook. Le modifiche ravvicinate si fondono nell'ultima.
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

/** La riga di miniature (o di sole etichette) sopra la barra, o null quando nel prompt non ci sono immagini. */
async function rigaImmagini($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  if (e.surface !== 'terminal') return null
  const lista = await read($, immagini)
  if (lista.length === 0) return null

  const modo = anteprimaDecisa
  if (modo === undefined) return null
  const { Box, Button, Image, Raster, Text } = $.ui.resolve(e)
  if (modo === 'etichette') {
    return (
      <Box flexDirection="row" columnGap={2}>
        {lista.map(immagine =>
          immagine.path === null ? (
            <Text dimColor>{`Image #${immagine.n} (non trovata)`}</Text>
          ) : (
            <Button
              key={`apri-${immagine.n}`}
              label={`Image #${immagine.n}`}
              plain
              dimColor
              {...(immagine.n <= 9 && { hotkey: String(immagine.n) })}
              onPress={() => apri($, immagine.path!)}
            />
          ),
        )}
      </Box>
    )
  }
  // Due righe della banda sono di infobar.
  const celle = fitRow(lista.map(immagine => immagine.size), e.props.maxRows - 2, e.props.bodyColumns)

  return (
    <Box flexDirection="row" columnGap={1}>
      {lista.map((immagine, i) => {
        const { columns, rows } = celle[i] ?? { columns: 4, rows: 1 }
        const a = immagine.anteprima
        const testo = (contenuto: string) => (
          <Box width={columns} height={rows} alignItems="center" justifyContent="center">
            <Text dimColor wrap="truncate">{contenuto}</Text>
          </Box>
        )
        return (
          <Box flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
            {immagine.path === null ? (
              testo('nessuna anteprima')
            ) : a?.tipo === 'pixel' && modo === 'blocchi' ? (
              <Raster
                key={`immagine-${immagine.n}`}
                columns={columns}
                rows={rows}
                cells={rasterCells({ ...a, rgba: fromBase64(a.rgba) }, columns, rows)}
              />
            ) : a?.tipo === 'pixel' || a?.tipo === 'file' ? (
              <Image
                key={`immagine-${immagine.n}`}
                source={a.tipo === 'pixel' ? { rgba: a.rgba, width: a.width, height: a.height } : { file: immagine.path, format: 'png' }}
                columns={columns}
                rows={rows}
                alt={`[Image #${immagine.n}]`}
              />
            ) : (
              testo(a?.tipo === 'nota' ? a.testo : '…')
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
  const conAccount = options.account !== 'no'
  const conCodex = options.codex !== 'no'
  if (scelta === 'immagini' || scelta === 'blocchi' || scelta === 'etichette') fissaAnteprima(scelta)
  registraLetture(on, conAnteprime ? anteprima : null, {
    editor: typeof options.editor === 'string' ? options.editor : undefined,
    miniatureLette: options.miniatureLette === 'si',
  })
  registraMessaggi(on)
  registraPannelli(on)
  if (options.copia !== 'no') registraCopia(on, options.copia === 'hover' ? 'hover' : 'sempre')

  on('session.start', async ($, e, next) => {
    await nuovaSessioneMessaggi($)
    await $.command.register({ name: 'autorizza', description: 'Aggiunge un\'autorizzazione di sessione (alias: db, prod, deploy, commit, push)', argumentHint: '[testo|alias]' })
    await $.command.register({ name: 'revoca', description: 'Revoca un\'autorizzazione di sessione', argumentHint: '<n|tutte>' })
    await $.command.register({ name: 'autonomo', description: 'Attiva o disattiva la modalità autonoma di sessione' })
    await $.command.register({ name: 'modifiche', description: 'Apre il pannello dei file modificati e non committati nel repository git, con diff', immediate: true })
    // Il pannello lavora sul transcript del terminale: l'app desktop non lo vede.
    if ((await $.session.surfaces()).includes('terminal'))
      await $.command.register({ name: 'messaggi', description: 'Apre il pannello dei tuoi messaggi: cerca e salta a uno nel transcript', immediate: true })
    await $.command.register({ name: 'lavori', description: 'Apre il pannello dei lavori in background: comandi, subagent, workflow, con output e stop', immediate: true })
    await $.command.register({ name: 'ripresa', description: 'Stato della ripresa automatica dopo un limite', argumentHint: '[annulla]', immediate: true })
    // Dove la sessione ha un login suo (app desktop) la barra non c'è e cswap non la riguarda: niente timer.
    if ((conAccount || conCodex) && !(await loginProprio($))) {
      if (conAccount) {
        await $.command.register({ name: 'account', description: 'Account cswap: senza argomenti apre il pannello, con alias o numero fa lo switch del profilo principale', argumentHint: '[alias|numero]' })
        await aggiornaContoSessione($)
      }
      if (conCodex) void aggiornaCodex($).catch(() => undefined)
      $.clock.every(60_000, () => {
        if (conAccount) {
          void aggiornaContoSessione($)
          void pannelloAperto($).then(aperto => (aperto ? aggiornaContiSeVecchi($) : undefined))
        }
        if (conCodex) void aggiornaCodex($).catch(() => undefined)
      })
    }
    const dir = nomeCartella(await $.session.cwd())
    if ((await read($, cartella)) !== dir) await update($, cartella, () => dir)
    fileHead = await trovaHead($)
    await aggiornaTutto($)
    await armaRipresa($)
    forseModificati($)
    if (conAnteprime) {
      if (scelta !== 'immagini' && scelta !== 'blocchi' && scelta !== 'etichette') fissaAnteprima((await terminaleConImmagini($)) ? 'immagini' : 'blocchi')
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
      await lavoriDaAgenti($)
      return next(e)
    }
    if ((await read($, turnoAttivo)) !== false) await update($, turnoAttivo, () => false)
    if (e.reason === 'answer') if ((await read($, tentativi)) !== 0) await update($, tentativi, () => 0)
    await aggiornaIntestazione($)
    await lavoriDaAgenti($)
    const esito = await next(e)
    if (e.reason === 'answer') await rispostaFinita($, esito.text)
    return esito
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const esito = await next(e)
    const id = e.task_id ?? e.shell_id
    if (id && 'result' in esito && !esito.isError) await lavoroFermato($, id)
    return esito
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const esito = await next(e)
    await lavoriDaAgenti($)
    return esito
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (conAnteprime) sincronizza($, box.text)
    return box
  })

  // Incollare un'immagine non solleva prompt.edit, ma la riga di suggerimento si ridisegna ("Pasting…"
  // e ritorno) con il tag [Image #n] già nel prompt: è l'unico evento che segnala l'incolla.
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, async ($, e, next) => {
    if (conAnteprime) void $.prompt.read().then(box => sincronizza($, box.text))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (conAnteprime) sincronizza($, '')
    if (e.origin.kind === 'task-notification') await lavoroDaNotifica($, e.text)
    const daPersona = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (daPersona) forseModificati($)
    if (daPersona) await messaggioInviato($, e.text)
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
    await lavoriDaRiepilogo($, e.background_tasks ?? [])
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
    await aggiornaEffort($)
    return esito
  })

  // Dopo /compact, /clear o una ripresa la barra si rilegge tutta: niente righe vuote fino al prossimo turno.
  on('classic.SessionStart', async ($, e, next) => {
    const esito = await next(e)
    // Dopo /compact il contesto l'ha già fissato session.compact; l'ultima risposta qui è ancora quella di prima.
    if (e.source !== 'startup') await aggiornaTutto($, e.source !== 'compact')
    if (e.context_tokens !== undefined) {
      const { context } = await $.session.usage()
      const percent = Math.round((e.context_tokens / context.window) * 100)
      await aggiornaContesto($, { window: context.window, tokens: e.context_tokens, percent })
    }
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
    forseModificati($, e.tool)
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
    const esito = await next({ ...e, instructions: [e.instructions, ...extra].filter(Boolean).join('\n\n') })
    if ('tokensAfter' in esito && esito.tokensAfter !== undefined) {
      const { context } = await $.session.usage()
      const percent = Math.round((esito.tokensAfter / context.window) * 100)
      await aggiornaContesto($, { window: context.window, tokens: esito.tokensAfter, percent })
    }
    return esito
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const lista = await read($, autorizzazioni)
    if (!lista.length) return r
    return { sections: [...r.sections, { id: `${P}:autorizzazioni`, text: sezioneAutorizzazioni(lista), scope: 'session' as const }] }
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

  on('command.run', { command: 'account' }, async ($, e) => {
    if (await loginProprio($)) return { text: "Questa sessione usa il login dell'app che l'ha avviata, non ~/.claude: cswap non la riguarda." }
    if (!(await conCswap($))) return { text: 'cswap non è installato: il pannello account mostra solo i suoi account.' }
    const destinazione = e.args.trim()
    if (destinazione) return { text: await passaA($, destinazione) }
    await apriConti($)
    return { text: 'Pannello account aperto.' }
  }).catch(() => ({ text: 'Comando /account non riuscito: vedi il log di debug.' }))

  on('ui.render', { component: 'Pane', requestId: PANNELLO_CONTI }, async ($, e) => disegnaConti($, e))
  on('ui.render', { component: 'Pane', requestId: PANNELLO_LAVORI }, async ($, e) =>
    disegnaLavori($, e, {
      editor: typeof options.editor === 'string' ? options.editor : undefined,
      apriOutput: typeof options.apriOutput === 'string' ? options.apriOutput : undefined,
    }),
  )

  on('ui.render', { component: 'Pane', requestId: PANNELLO_MODIFICHE }, async ($, e) =>
    disegnaModifiche($, e, typeof options.editor === 'string' ? options.editor : undefined),
  )

  on('command.run', { command: 'modifiche' }, async $ => {
    await apriModifiche($)
    return { text: 'Pannello dei file modificati aperto.' }
  })

  on('command.run', { command: 'messaggi' }, async $ => {
    await apriMessaggi($)
    return { text: 'Pannello dei messaggi aperto.' }
  })

  on('command.run', { command: 'lavori' }, async $ => {
    await apriLavori($)
    return { text: 'Pannello dei lavori aperto.' }
  })

  // Sul desktop l'app mostra già queste informazioni a modo suo: la barra è solo per il terminale. Il filtro
  // sta nel matcher e non nel corpo, perché il desktop riserva lo spazio della banda a ogni plugin che la aggancia.
  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const nome = await read($, modello)
    const livello = await read($, effort)
    const dir = await read($, cartella)
    const ramo = await read($, branch)
    const finestre = await read($, limiti)
    const vistiAlle = await read($, limitiVistiAlle)
    const ora = await $.clock.now()
    const p = await read($, percent)
    const t = await read($, tokens)
    const occupati = await lavoriInCorso($)
    const modificati = await fileModificati($)
    const numeroMessaggi = await quantiMessaggi($)
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
    const conto = conAccount ? await pulsanteConto($, e) : null
    const codex = conCodex ? await codexDaMostrare($, ora) : null

    // Ogni riga si compatta solo quando intera non ci sta, un passo alla volta: la prima perde i `|`, poi
    // scrive l'effort in due lettere, poi accorcia cartella e branch dal mezzo; la seconda perde la barra del contesto (resta la percentuale), poi i `|`.
    // Lo spazio vero è bodyColumns (il terminale meno le cinque colonne del [-]); qualche colonna di margine
    // perché alcuni simboli (◐ ✓ ✎) un terminale li disegna larghi due.
    const colonne = (e.props.bodyColumns || Infinity) - MARGINE_BARRA
    const largConto = conto ? await larghezzaConto($) : 0
    const riga1 = (sep: string, eff: string | null, d: string | null, b: string | null) =>
      largConto +
      (nome ? (conto ? sep.length : 0) + nome.length + (eff ? 1 + eff.length : 0) : 0) +
      (d ? sep.length + d.length + (b ? 3 + b.length : 0) : 0) +
      (modificati ? 4 + String(modificati).length : 0)
    let sep1 = ' | '
    let effortMostrato = livello
    let dirMostrata = dir
    let ramoMostrato = ramo
    if (riga1(sep1, livello, dir, ramo) > colonne) {
      sep1 = ' '
      if (livello && riga1(sep1, livello, dir, ramo) > colonne) effortMostrato = siglaEffort(livello)
      const eccesso = riga1(sep1, effortMostrato, dir, ramo) - colonne
      if (eccesso > 0 && dir) {
        const [ld, lr] = accorciaCoppia(dir.length, ramo?.length ?? 0, dir.length + (ramo?.length ?? 0) - eccesso)
        dirMostrata = accorcia(dir, ld)
        ramoMostrato = ramo ? accorcia(ramo, lr) : ramo
      }
    }
    const limiteTesto = (f: (typeof finestre)[number], multi: boolean, sep: string) => {
      const l = descriviLimite(f, ora)
      return `${multi ? `${sep}${l.etichetta} ` : sep}${l.percentuale}%${l.mancano ? ` ${l.mancano}` : ''}`
    }
    const riga2 = (sep: string, conBarra: boolean) =>
      [
        '◐ ',
        t === null ? '' : `${formattaToken(t)} `,
        p === null ? '-' : `${p}%`,
        conBarra && p !== null ? ` ${barra(p)}` : '',
        ' ',
        occupati ? `◷ ${occupati}` : '✓',
        autorizz ? `${sep}${autorizz}` : '',
        r ? `${sep}ripresa ${orario(r.at)} annulla` : '',
        ...finestre.map(f => limiteTesto(f, finestre.length > 1, sep)),
        codex
          ? `${sep}codex${codex.limiti.map(f => {
              const l = descriviLimite(f, ora)
              return `${codex.limiti.length > 1 ? ` ${l.etichetta}` : ''} ${l.percentuale}%${l.mancano ? ` ${l.mancano}` : ''}`
            }).join('')}${codex.vistoAlle !== null ? ` · ${formattaDurata(ora - codex.vistoAlle)} fa` : ''}`
          : '',
        vistiAlle !== null && finestre.length ? ` · ${formattaDurata(ora - vistiAlle)} fa` : '',
        `${sep}≡${numeroMessaggi || ''}`,
      ].join('').length
    const conBarra = riga2(' | ', true) <= colonne
    const sep = conBarra || riga2(' | ', false) <= colonne ? ' | ' : ' '
    const compatta = sep === ' '

    return (
      <Box flexDirection="column">
        {miniature}
        {sotto}
        {/* Ogni pezzo resta intero: in un terminale stretto va a capo il pezzo, non le parole al suo interno. */}
        <Box flexDirection="row" flexWrap="wrap">
          {conto ? <Box key="conto" flexShrink={0}>{conto}</Box> : null}
          {nome ? (
            <Box key="modello" flexShrink={0}>
              <Text>
                {conto ? <Text dimColor>{sep1}</Text> : null}
                <Text bold color={coloreModello(nome)}>{nome}</Text>
                {livello ? <Text color={coloreEffort(livello)}>{` ${effortMostrato}`}</Text> : null}
              </Text>
            </Box>
          ) : null}
          {dir ? (
            // ✎ va a capo insieme a cartella e branch: i file modificati sono di quel repository.
            <Box key="cartella" flexShrink={0} flexDirection="row">
              <Text>
                <Text dimColor>{sep1}</Text>
                <Text bold color="yellow">{dirMostrata}</Text>
                {ramo ? <Text color="cyan">{` (${ramoMostrato})`}</Text> : null}
              </Text>
              {modificati ? (
                <Button key="modifiche" plain onPress={() => void alterna($, PANNELLO_MODIFICHE, () => apriModifiche($))}>
                  <Text color="yellow">{` ✎ ${modificati}`}</Text>
                </Button>
              ) : null}
            </Box>
          ) : modificati ? (
            <Box key="modifiche" flexShrink={0}>
              <Button key="modifiche" plain onPress={() => void alterna($, PANNELLO_MODIFICHE, () => apriModifiche($))}>
                <Text color="yellow">{` ✎ ${modificati}`}</Text>
              </Button>
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Box key="contesto" flexShrink={0}>
            <Text>
              <Text color={colore}>{'◐ '}</Text>
              {t === null ? null : <Text bold>{`${formattaToken(t)} `}</Text>}
              <Text color={colore}>{p === null ? '-' : `${p}%`}</Text>
              {p === null || !conBarra ? null : <Text color={colore}>{` ${barra(p)}`}</Text>}
              <Text>{' '}</Text>
            </Text>
          </Box>
          <Box key="turno" flexShrink={0}>
            {occupati ? (
              <Button key="lavori" plain onPress={() => void alterna($, PANNELLO_LAVORI, () => apriLavori($))}>
                <Text color="yellow">{`◷ ${occupati}`}</Text>
              </Button>
            ) : turno ? (
              <Text dimColor>…</Text>
            ) : (
              <Text dimColor>✓</Text>
            )}
          </Box>
          {autorizz ? (
            <Box key="autorizzazioni" flexShrink={0}>
              <Text>
                <Text dimColor>{sep}</Text>
                <Text color="cyan">{autorizz}</Text>
              </Text>
            </Box>
          ) : null}
          {r ? (
            <Box key="ripresa" flexShrink={0}>
              <Text>
                <Text dimColor>{sep}</Text>
                <Text color="magenta">{`ripresa ${orario(r.at)} `}</Text>
              </Text>
              <Button key="annulla-ripresa" label="annulla" plain onPress={() => annullaRipresa($)} />
            </Box>
          ) : null}
          {finestre.map(f => {
            const l = descriviLimite(f, ora)
            return (
              <Box key={`limite-${f.kind}`} flexShrink={0}>
                <Text key={f.kind}>
                  <Text dimColor>{finestre.length > 1 ? `${sep}${l.etichetta} ` : sep}</Text>
                  <Text color={l.colore}>{`${l.percentuale}%`}</Text>
                  {l.mancano ? <Text dimColor>{` ${l.mancano}`}</Text> : null}
                </Text>
              </Box>
            )
          })}
          {codex ? (
            <Box key="codex" flexShrink={0}>
              <Text key="codex">
                <Text dimColor={!compatta}>{`${sep}codex`}</Text>
                {codex.limiti.map(f => {
                  const l = descriviLimite(f, ora)
                  return (
                    <Text key={`codex-${f.kind}`}>
                      {codex.limiti.length > 1 ? <Text dimColor>{` ${l.etichetta}`}</Text> : null}
                      <Text color={l.colore}>{` ${l.percentuale}%`}</Text>
                      {l.mancano ? <Text dimColor>{` ${l.mancano}`}</Text> : null}
                    </Text>
                  )
                })}
                {codex.vistoAlle !== null ? <Text dimColor>{` · ${formattaDurata(ora - codex.vistoAlle)} fa`}</Text> : null}
              </Text>
            </Box>
          ) : null}
          {vistiAlle !== null && finestre.length ? (
            <Box key="visti" flexShrink={0}>
              <Text dimColor>{` · ${formattaDurata(ora - vistiAlle)} fa`}</Text>
            </Box>
          ) : null}
          <Box key="messaggi" flexShrink={0}>
            <Text dimColor>{sep}</Text>
            <Button key="messaggi" plain onPress={() => void alterna($, PANNELLO_MESSAGGI, () => apriMessaggi($))}>
              <Text color="cyan">{numeroMessaggi ? `≡${numeroMessaggi}` : '≡'}</Text>
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })
}
