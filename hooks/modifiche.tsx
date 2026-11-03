import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput, Timer } from 'claude-code'

import type { FileGit, StatoGit, WorktreeGit } from '../types'
import { apriInEditor, editorPer } from './editor'
import { diffNuovo, eAnnidato, fileDaStatus, primaRigaDelDiff, righeDaNumstat, soloBlocchi, worktreeDaLista } from './git'
import { segnaAperto } from './pannelli'
import { nomeCartella, normalizzaPercorso, paroleRicerca, segna } from './testi'

export const PANNELLO_MODIFICHE = 'modifiche'

const statoGit = atom({ plugin: 'infobar', key: 'statoGit' } as const, null as StatoGit)
const diffAperti = atom({ plugin: 'infobar', key: 'diffAperti' } as const, [] as string[])
const testiDiff = atom({ plugin: 'infobar', key: 'testiDiff' } as const, {} as Record<string, string>)
const filtroModifiche = atom({ plugin: 'infobar', key: 'filtroModifiche' } as const, '')
const versioneCampo = atom({ plugin: 'infobar', key: 'versioneCampoModifiche' } as const, 0)

const toccati = atom(
  { plugin: 'infobar', key: 'toccatiSessione' } as const,
  { sessione: null, file: [], ricostruito: false } as { sessione: string | null; file: string[]; ricostruito: boolean },
)

// I tool che possono cambiare file: dopo uno di questi lo stato di git si rilegge.
const TOOL_CHE_SCRIVONO = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell'])
export const TOOL_DI_FILE = new Set(['Write', 'Edit', 'NotebookEdit'])
export const TOOL_DI_SHELL = new Set(['Bash', 'PowerShell'])
// Più modifiche ravvicinate (un turno che scrive dieci file) diventano una lettura sola.
const ATTESA_MS = 800
const AGGIORNA_PANNELLO_MS = 5000
// Un diff più lungo nel pannello non si legge: il resto si guarda nell'editor.
const RIGHE_DIFF = 300
// I file nuovi non hanno numstat: le righe si contano leggendoli, ma non all'infinito.
const NUOVI_CONTATI = 100
// Con pochi file la ricerca è solo una riga in più: compare da questi in su.
const FILE_PER_RICERCA = 8
const AZZERA = '✕ azzera'

/** I file il cui percorso (o quello di prima, se rinominato) contiene tutte le parole cercate. */
export function filtraFile(file: readonly FileGit[], filtro: string): FileGit[] {
  const parole = paroleRicerca(filtro)
  if (!parole.length) return [...file]
  return file.filter(f => parole.every(p => f.path.toLowerCase().includes(p) || !!f.da?.toLowerCase().includes(p)))
}

// Senza lock opzionali git non tocca l'indice mentre legge: non intralcia un commit tuo o di Claude.
async function git($: EngineInterface, radice: string, argomenti: string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', radice, ...argomenti], { timeoutMs: 15_000 })
}

async function leggiFile($: EngineInterface, radice: string): Promise<FileGit[] | null> {
  const status = await git($, radice, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status.exitCode !== 0) return null
  const file = fileDaStatus(status.stdout).filter(f => !eAnnidato(f))
  // Senza commit HEAD non c'è: i conteggi restano vuoti, l'elenco no.
  const numstat = await git($, radice, ['diff', 'HEAD', '--numstat', '-z']).catch(() => null)
  const conti = numstat?.exitCode === 0 ? righeDaNumstat(numstat.stdout) : new Map()
  let nuoviContati = 0
  for (const f of file) {
    const c = conti.get(f.path)
    if (c) Object.assign(f, c)
    else if (f.stato === 'nuovo' && nuoviContati++ < NUOVI_CONTATI) {
      const testo = await $.fs.read(`${radice}/${f.path}`).catch(() => null)
      if (testo !== null) Object.assign(f, { aggiunte: diffNuovo(testo).split('\n').length - 1, tolte: 0 })
    }
  }
  return file
}

async function leggiStato($: EngineInterface): Promise<StatoGit> {
  const cwd = await $.session.cwd()
  const radiceEsito = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 }).catch(() => null)
  if (!radiceEsito || radiceEsito.exitCode !== 0) return null
  const radice = normalizzaPercorso(radiceEsito.stdout.trim())
  const file = await leggiFile($, radice)
  return file && { radice, file, altri: [], aggiornatoAlle: await $.clock.now() }
}

const stessoPercorso = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Un agente può lavorare in un worktree accanto (`git worktree add ../repo-x`) mentre la sessione resta qui.
async function leggiAltri($: EngineInterface, radice: string): Promise<WorktreeGit[]> {
  const lista = await git($, radice, ['worktree', 'list', '--porcelain'])
  if (lista.exitCode !== 0) return []
  const tutti = worktreeDaLista(lista.stdout)
  const qui = tutti.find(w => stessoPercorso(w.radice, radice))?.head
  const altri: WorktreeGit[] = []
  for (const w of tutti) {
    if (stessoPercorso(w.radice, radice)) continue
    const file = await leggiFile($, w.radice).catch(() => null)
    if (!file) continue
    const conta = qui ? await git($, w.radice, ['rev-list', '--count', `${qui}..${w.head}`]).catch(() => null) : null
    const commit = conta?.exitCode === 0 ? Number(conta.stdout.trim()) || 0 : 0
    if (file.length || commit) altri.push({ radice: w.radice, branch: w.branch, file, commit })
  }
  return altri
}

/** Il tree della sessione e gli altri, con il prefisso che distingue i diff aperti di file con lo stesso percorso. */
function gruppi(stato: NonNullable<StatoGit>) {
  return [
    { radice: stato.radice, prefisso: '', file: stato.file },
    ...stato.altri.map(w => ({ radice: w.radice, prefisso: `${w.radice}::`, file: w.file })),
  ]
}

let inLettura = false
let ancora = false
let attesa: Timer | null = null
let timer: Timer | null = null
let comandiInCorso = 0
let dopoComando = false
let altriLettiPrima = false

const chiaveFile = (path: string) => normalizzaPercorso(path).toLowerCase()
const firma = (f: FileGit) => `${f.stato}:${f.aggiunte}:${f.tolte}:${f.da ?? ''}`

async function toccatiDellaSessione($: EngineInterface) {
  const sessione = await $.session.id()
  const t = await read($, toccati)
  if (t.sessione === sessione) return t
  // /clear o una ripresa nello stesso processo: l'elenco di prima è di un'altra sessione.
  const nuovo = { sessione, file: [], ricostruito: false }
  await update($, toccati, () => nuovo)
  return nuovo
}

async function segnaToccati($: EngineInterface, paths: readonly string[]) {
  const t = await toccatiDellaSessione($)
  const nuovi = [...new Set(paths.map(chiaveFile))].filter(p => !t.file.includes(p))
  if (nuovi.length) await update($, toccati, v => ({ ...v, file: [...v.file, ...nuovi] }))
}

/** Un file scritto da Write, Edit o NotebookEdit, anche da un subagent. */
export async function fileToccato($: EngineInterface, path: string) {
  await segnaToccati($, [path])
}

/** Un comando di shell che parte: finché gira, quello che git vede cambiare è suo. */
export function comandoIniziato() {
  comandiInCorso++
}

export function comandoFinito() {
  comandiInCorso = Math.max(0, comandiInCorso - 1)
  dopoComando = true
}

// Una sessione ripresa riparte senza elenco: le Write e le Edit della conversazione principale stanno nel transcript.
// Una volta sola, all'apertura del pannello; quelle dei subagent e dei comandi di prima non si ricostruiscono.
async function ricostruisciToccati($: EngineInterface) {
  const t = await toccatiDellaSessione($)
  if (t.ricostruito) return
  await update($, toccati, v => ({ ...v, ricostruito: true }))
  const messaggi = await $.session.messages().catch(() => [])
  const paths: string[] = []
  for (const m of messaggi)
    for (const u of m.toolUses) {
      if (u.isError || !TOOL_DI_FILE.has(u.tool)) continue
      const path = u.input.file_path ?? u.input.notebook_path
      if (typeof path === 'string') paths.push(path)
    }
  await segnaToccati($, paths)
}

// Senza comandi git in più: i file la cui riga di status è cambiata dalla lettura di prima.
function cambiati(prima: NonNullable<StatoGit>, stato: NonNullable<StatoGit>, conAltri: boolean): string[] {
  const vecchi = new Map<string, string>()
  const elenca = (s: NonNullable<StatoGit>) => (conAltri ? gruppi(s) : gruppi({ ...s, altri: [] }))
  for (const g of elenca(prima)) for (const f of g.file) vecchi.set(chiaveFile(`${g.radice}/${f.path}`), firma(f))
  const diversi: string[] = []
  for (const g of elenca(stato))
    for (const f of g.file) {
      const k = chiaveFile(`${g.radice}/${f.path}`)
      if (vecchi.get(k) !== firma(f)) diversi.push(k)
    }
  return diversi
}

async function aggiorna($: EngineInterface) {
  if (inLettura) {
    ancora = true
    return
  }
  inLettura = true
  try {
    do {
      ancora = false
      const delComando = comandiInCorso > 0 || dopoComando
      dopoComando = false
      const stato = await leggiStato($).catch(() => null)
      const prima = await read($, statoGit)
      // A pannello chiuso nessuno li guarda, e a ogni tool sarebbero troppi comandi git.
      const aperto = await pannelloModificheAperto($).catch(() => false)
      if (stato) stato.altri = aperto ? await leggiAltri($, stato.radice).catch(() => []) : (prima?.altri ?? [])
      if (delComando && prima && stato && stato.radice === prima.radice) await segnaToccati($, cambiati(prima, stato, aperto && altriLettiPrima))
      altriLettiPrima = aperto
      const uguale =
        JSON.stringify(prima?.file) === JSON.stringify(stato?.file) &&
        JSON.stringify(prima?.altri) === JSON.stringify(stato?.altri) &&
        prima?.radice === stato?.radice
      if (!uguale) await update($, statoGit, () => stato)
      for (const k of await read($, diffAperti)) await leggiDiff($, k)
    } while (ancora)
  } finally {
    inLettura = false
  }
}

/** Dopo un tool che può aver cambiato file, o un prompt (i file li cambi anche tu): lo stato si rilegge. */
export function forseModificati($: EngineInterface, tool?: string) {
  if (tool && !TOOL_CHE_SCRIVONO.has(tool)) return
  attesa?.cancel()
  attesa = $.clock.after(ATTESA_MS, () => void aggiorna($))
}

export async function fileModificati($: EngineInterface): Promise<number | null> {
  const stato = await read($, statoGit)
  return stato ? stato.file.length : null
}

async function diffDi($: EngineInterface, radice: string, f: FileGit): Promise<string> {
  if (f.stato === 'nuovo') return diffNuovo((await $.fs.read(`${radice}/${f.path}`).catch(() => '')) ?? '')
  const esito = await git($, radice, ['diff', 'HEAD', '--no-color', '--', f.path]).catch(() => null)
  return esito?.exitCode === 0 ? soloBlocchi(esito.stdout) : ''
}

async function leggiDiff($: EngineInterface, chiave: string) {
  const stato = await read($, statoGit)
  const gruppo = stato && gruppi(stato).find(g => g.file.some(f => g.prefisso + f.path === chiave))
  const f = gruppo?.file.find(x => gruppo.prefisso + x.path === chiave)
  const diff = gruppo && f ? await diffDi($, gruppo.radice, f) : ''
  const righe = diff.split('\n')
  const testo = righe.length > RIGHE_DIFF ? righe.slice(0, RIGHE_DIFF).join('\n') : diff
  if ((await read($, testiDiff))[chiave] !== testo) await update($, testiDiff, t => ({ ...t, [chiave]: testo }))
}

async function mostraDiff($: EngineInterface, chiave: string) {
  if ((await read($, diffAperti)).includes(chiave)) {
    await update($, diffAperti, a => a.filter(x => x !== chiave))
    return
  }
  await leggiDiff($, chiave)
  await update($, diffAperti, a => [...a, chiave])
}

async function apriFile($: EngineInterface, radice: string, f: FileGit, opzioneEditor: string | undefined) {
  const path = `${radice}/${f.path}`
  const editor = await editorPer($, path, opzioneEditor === 'no' ? 'auto' : opzioneEditor)
  if (!editor) return
  const riga = f.stato === 'nuovo' ? 1 : primaRigaDelDiff(await diffDi($, radice, f))
  await apriInEditor($, editor, path, riga)
}

export async function pannelloModificheAperto($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANNELLO_MODIFICHE)
}

export async function apriModifiche($: EngineInterface) {
  // L'apertura per prima: conta come tua solo se viene subito dopo il clic o il comando.
  const aperto = await $.ui.open({ id: PANNELLO_MODIFICHE, title: 'File modificati', focus: true })
  if (aperto.isPlaced) segnaAperto(PANNELLO_MODIFICHE)
  await update($, versioneCampo, () => 0)
  await $.ui.focus({ requestId: PANNELLO_MODIFICHE, key: 'cerca-0' }).catch(() => undefined)
  await ricostruisciToccati($).catch(() => undefined)
  await aggiorna($)
  // A pannello aperto si rilegge anche ogni pochi secondi: le modifiche fatte fuori da Claude non avvisano.
  timer ??= $.clock.every(AGGIORNA_PANNELLO_MS, async () => {
    if (await pannelloModificheAperto($)) return aggiorna($)
    timer?.cancel()
    timer = null
  })
}

const SEGNO: Record<FileGit['stato'], { segno: string; colore: string }> = {
  nuovo: { segno: '+', colore: 'success' },
  modificato: { segno: '~', colore: 'warning' },
  eliminato: { segno: '−', colore: 'error' },
  rinominato: { segno: '→', colore: 'suggestion' },
  conflitto: { segno: '!', colore: 'error' },
}

export async function disegnaModifiche($: EngineInterface, e: RenderInput<'Pane'>, opzioneEditor: string | undefined) {
  const stato = await read($, statoGit)
  const aperti = await read($, diffAperti)
  const testi = await read($, testiDiff)
  const filtro = await read($, filtroModifiche)
  const campo = await read($, versioneCampo)
  const sessione = await read($, toccati)
  const larghezza = Math.max(30, e.props.bodyColumns - 2)
  const elementi = $.ui.resolve(e)
  if (!('Input' in elementi)) return <elementi.Text dimColor>Il pannello dei file modificati c'è solo nel terminale.</elementi.Text>
  const { Box, Text, Button, Code, Input } = elementi

  if (!stato)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="warning">FILE MODIFICATI</Text>
        <Text dimColor>{'─'.repeat(larghezza)}</Text>
        <Text dimColor>La cartella della sessione non è in un repository git.</Text>
      </Box>
    )

  const parole = paroleRicerca(filtro)
  const visibili = filtraFile(stato.file, filtro)
  const tutti = gruppi(stato).flatMap(g => g.file)
  const conRicerca = tutti.length >= FILE_PER_RICERCA || parole.length > 0
  const pezzi = (testo: string, colore?: string, extra: { bold?: boolean; dimColor?: boolean } = {}) =>
    segna(testo, parole).map((p, i) =>
      p.trovato ? (
        <Text key={`t${i}`} color="warning" bold>{p.testo}</Text>
      ) : (
        <Text key={`t${i}`} color={colore} {...extra}>{p.testo}</Text>
      ),
    )
  const totaleDi = (file: readonly FileGit[]) =>
    file.reduce((t, f) => ({ aggiunte: t.aggiunte + (f.aggiunte ?? 0), tolte: t.tolte + (f.tolte ?? 0) }), { aggiunte: 0, tolte: 0 })
  const totale = totaleDi(stato.file)
  // I conteggi in colonna: larghi quanto il più largo, così si leggono dall'alto in basso.
  const testoConti = (f: FileGit) => (f.aggiunte === null && f.tolte === null ? '' : `+${f.aggiunte ?? 0} −${f.tolte ?? 0}`)
  const largConti = Math.max(0, ...tutti.map(f => testoConti(f).length))
  const rigaFile = (f: FileGit, radice: string, prefisso: string) => {
    const chiave = prefisso + f.path
    const { segno, colore } = SEGNO[f.stato]
    const taglio = f.path.lastIndexOf('/')
    const nome = taglio >= 0 ? f.path.slice(taglio + 1) : f.path
    const cartella = taglio >= 0 ? f.path.slice(0, taglio) : ''
    const conti = testoConti(f)
    return (
      <Box key={`file-${chiave}`} flexDirection="column">
        <Box flexDirection="row">
          {/* Solo il percorso cede quando lo spazio manca: conteggi e pulsanti restano interi. */}
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">
              <Text color={colore} bold>{`${segno} `}</Text>
              <Text>{pezzi(nome, undefined, { bold: true })}</Text>
              {cartella ? <Text dimColor>{'  '}</Text> : null}
              {cartella ? <Text>{pezzi(cartella, undefined, { dimColor: true })}</Text> : null}
              {f.da ? <Text dimColor>{`  ← ${f.da}`}</Text> : null}
              {f.stato === 'conflitto' ? <Text color="error">{'  conflitto'}</Text> : null}
            </Text>
          </Box>
          <Box flexShrink={0} flexDirection="row" columnGap={2} marginLeft={2}>
            <Box width={largConti} justifyContent="flex-end">
              {conti ? (
                <Text>
                  <Text color="success">{`+${f.aggiunte ?? 0}`}</Text>
                  <Text color="error">{` −${f.tolte ?? 0}`}</Text>
                </Text>
              ) : null}
            </Box>
            <Button key={`diff-${chiave}`} plain onPress={() => mostraDiff($, chiave)}>
              <Text color="suggestion">{aperti.includes(chiave) ? '▴ diff' : '▾ diff'}</Text>
            </Button>
            <Box width={6}>
              {f.stato !== 'eliminato' ? (
                <Button key={`editor-${chiave}`} plain onPress={() => apriFile($, radice, f, opzioneEditor)}>
                  <Text color="suggestion">↗ apri</Text>
                </Button>
              ) : null}
            </Box>
          </Box>
        </Box>
        {aperti.includes(chiave) ? (
          <Box borderStyle="single" borderDimColor paddingX={1}>
            {testi[chiave] ? (
              <Code source={testi[chiave]!} format="diff" path={f.path} wrap="truncate-end" />
            ) : (
              <Text dimColor>nessuna differenza di testo</Text>
            )}
          </Box>
        ) : null}
      </Box>
    )
  }

  const dellaSessione = new Set(sessione.file)
  const divisi = (file: FileGit[], radice: string) => {
    const nostri = file.filter(f => dellaSessione.has(chiaveFile(`${radice}/${f.path}`)))
    return { nostri, resto: file.filter(f => !nostri.includes(f)) }
  }
  // Le intestazioni solo dove la sessione ha toccato qualcosa: senza, l'elenco resta com'era.
  const elenco = (file: FileGit[], radice: string, prefisso: string) => {
    const { nostri, resto } = divisi(file, radice)
    if (!nostri.length) return resto.map(f => rigaFile(f, radice, prefisso))
    return [
      <Text key={`sessione-${prefisso}`} color="suggestion" bold>{`questa sessione · ${nostri.length}`}</Text>,
      ...nostri.map(f => rigaFile(f, radice, prefisso)),
      ...(resto.length ? [<Text key={`resto-${prefisso}`} dimColor bold>{`altri · ${resto.length}`}</Text>] : []),
      ...resto.map(f => rigaFile(f, radice, prefisso)),
    ]
  }
  const inOrdine = (file: FileGit[], radice: string) => {
    const { nostri, resto } = divisi(file, radice)
    return [...nostri, ...resto]
  }

  const altri = stato.altri
    .map(w => ({ ...w, visibili: filtraFile(w.file, filtro) }))
    .filter(w => w.visibili.length || !parole.length)
  const primaChiave =
    inOrdine(visibili, stato.radice)[0]?.path ?? altri.flatMap(w => inOrdine(w.visibili, w.radice).map(f => `${w.radice}::${f.path}`))[0]

  const sezioneWorktree = (w: (typeof altri)[number]) => {
    const conti = totaleDi(w.file)
    return (
      <Box key={`worktree-${w.radice}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text bold color="warning">{w.branch ?? 'HEAD staccata'}</Text>
            <Text dimColor>{`  ${nomeCartella(w.radice)}`}</Text>
            {w.file.length ? <Text bold color="warning">{` · ${parole.length ? `${w.visibili.length} di ${w.file.length}` : w.file.length}`}</Text> : null}
          </Text>
          {w.file.length ? (
            <Box flexShrink={0} marginLeft={2}>
              <Text>
                <Text color="success">{`+${conti.aggiunte}`}</Text>
                <Text color="error">{` −${conti.tolte}`}</Text>
              </Text>
            </Box>
          ) : null}
        </Box>
        {w.commit ? <Text dimColor>{w.commit === 1 ? '1 commit non nel branch corrente' : `${w.commit} commit non nel branch corrente`}</Text> : null}
        {elenco(w.visibili, w.radice, `${w.radice}::`)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text bold color="warning">{parole.length ? `FILE MODIFICATI · ${visibili.length} di ${stato.file.length}` : `FILE MODIFICATI · ${stato.file.length}`}</Text>
        {stato.file.length ? (
          <Text>
            <Text color="success">{`+${totale.aggiunte}`}</Text>
            <Text color="error">{` −${totale.tolte}`}</Text>
          </Text>
        ) : null}
      </Box>
      {/* Come nei messaggi: Invio svuota il campo da sé, che si ridisegna con il filtro dentro; e prima del campo
          non compare niente mentre scrivi, o il fuoco scappa nel prompt. */}
      {conRicerca ? (
        <Input
          key={`cerca-${campo}`}
          placeholder="cerca tra i file (cartella, nome)"
          value={filtro}
          autoFocus={campo === 0 ? true : undefined}
          onInput={(valore: string) => void update($, filtroModifiche, () => valore)}
          onSubmit={async (valore: string) => {
            if (valore.trim()) await update($, filtroModifiche, () => valore)
            await update($, versioneCampo, v => v + 1)
            if (primaChiave) await $.ui.focus({ requestId: PANNELLO_MODIFICHE, key: `diff-${primaChiave}` }).catch(() => undefined)
          }}
        />
      ) : null}
      <Box flexDirection="row">
        <Text dimColor>{'─'.repeat(Math.max(1, larghezza - (parole.length ? AZZERA.length + 1 : 0)))}</Text>
        {parole.length ? (
          <Button
            key="azzera"
            plain
            onPress={async () => {
              await update($, filtroModifiche, () => '')
              await update($, versioneCampo, v => v + 1)
              // Dopo l'azzeramento si riparte a cercare: la tastiera torna nel campo, ridisegnato con la chiave nuova.
              const nuovo = await read($, versioneCampo)
              await $.ui.focus({ requestId: PANNELLO_MODIFICHE, key: `cerca-${nuovo}` }).catch(() => undefined)
            }}
          >
            <Text color="suggestion">{` ${AZZERA}`}</Text>
          </Button>
        ) : null}
      </Box>
      {!stato.file.length ? (
        <Text dimColor>Nessuna modifica da committare.</Text>
      ) : visibili.length ? (
        elenco(visibili, stato.radice, '')
      ) : altri.length ? null : (
        <Text dimColor>Nessun file contiene queste parole nel percorso.</Text>
      )}
      {altri.map(sezioneWorktree)}
    </Box>
  )
}
