import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput, Timer } from 'claude-code'

import type { FileGit, StatoGit } from '../types'
import { apriInEditor, editorPer } from './editor'
import { diffNuovo, eAnnidato, fileDaStatus, primaRigaDelDiff, righeDaNumstat, soloBlocchi } from './git'
import { segnaAperto } from './pannelli'
import { normalizzaPercorso, paroleRicerca, segna } from './testi'

export const PANNELLO_MODIFICHE = 'modifiche'

const statoGit = atom({ plugin: 'infobar', key: 'statoGit' } as const, null as StatoGit)
const diffAperti = atom({ plugin: 'infobar', key: 'diffAperti' } as const, [] as string[])
const testiDiff = atom({ plugin: 'infobar', key: 'testiDiff' } as const, {} as Record<string, string>)
const filtroModifiche = atom({ plugin: 'infobar', key: 'filtroModifiche' } as const, '')
const versioneCampo = atom({ plugin: 'infobar', key: 'versioneCampoModifiche' } as const, 0)

// I tool che possono cambiare file: dopo uno di questi lo stato di git si rilegge.
const TOOL_CHE_SCRIVONO = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell'])
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

async function leggiStato($: EngineInterface): Promise<StatoGit> {
  const cwd = await $.session.cwd()
  const radiceEsito = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 }).catch(() => null)
  if (!radiceEsito || radiceEsito.exitCode !== 0) return null
  const radice = normalizzaPercorso(radiceEsito.stdout.trim())
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
  return { radice, file, aggiornatoAlle: await $.clock.now() }
}

let inLettura = false
let ancora = false
let attesa: Timer | null = null
let timer: Timer | null = null

async function aggiorna($: EngineInterface) {
  if (inLettura) {
    ancora = true
    return
  }
  inLettura = true
  try {
    do {
      ancora = false
      const stato = await leggiStato($).catch(() => null)
      const prima = await read($, statoGit)
      const uguale = JSON.stringify(prima?.file) === JSON.stringify(stato?.file) && prima?.radice === stato?.radice
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

async function leggiDiff($: EngineInterface, path: string) {
  const stato = await read($, statoGit)
  const f = stato?.file.find(x => x.path === path)
  const diff = stato && f ? await diffDi($, stato.radice, f) : ''
  const righe = diff.split('\n')
  const testo = righe.length > RIGHE_DIFF ? righe.slice(0, RIGHE_DIFF).join('\n') : diff
  if ((await read($, testiDiff))[path] !== testo) await update($, testiDiff, t => ({ ...t, [path]: testo }))
}

async function mostraDiff($: EngineInterface, path: string) {
  if ((await read($, diffAperti)).includes(path)) {
    await update($, diffAperti, a => a.filter(x => x !== path))
    return
  }
  await leggiDiff($, path)
  await update($, diffAperti, a => [...a, path])
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
  await aggiorna($)
  // A pannello aperto si rilegge anche ogni pochi secondi: le modifiche fatte fuori da Claude non avvisano.
  timer ??= $.clock.every(AGGIORNA_PANNELLO_MS, async () => {
    if (await pannelloModificheAperto($)) return aggiorna($)
    timer?.cancel()
    timer = null
  })
}

const SEGNO: Record<FileGit['stato'], { segno: string; colore: string }> = {
  nuovo: { segno: '+', colore: 'green' },
  modificato: { segno: '~', colore: 'yellow' },
  eliminato: { segno: '−', colore: 'red' },
  rinominato: { segno: '→', colore: 'cyan' },
  conflitto: { segno: '!', colore: 'red' },
}

export async function disegnaModifiche($: EngineInterface, e: RenderInput<'Pane'>, opzioneEditor: string | undefined) {
  const stato = await read($, statoGit)
  const aperti = await read($, diffAperti)
  const testi = await read($, testiDiff)
  const filtro = await read($, filtroModifiche)
  const campo = await read($, versioneCampo)
  const larghezza = Math.max(30, e.props.bodyColumns - 2)
  const elementi = $.ui.resolve(e)
  if (!('Input' in elementi)) return <elementi.Text dimColor>Il pannello dei file modificati c'è solo nel terminale.</elementi.Text>
  const { Box, Text, Button, Code, Input } = elementi

  if (!stato)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="yellow">FILE MODIFICATI</Text>
        <Text dimColor>{'─'.repeat(larghezza)}</Text>
        <Text dimColor>La cartella della sessione non è in un repository git.</Text>
      </Box>
    )

  const parole = paroleRicerca(filtro)
  const visibili = filtraFile(stato.file, filtro)
  const conRicerca = stato.file.length >= FILE_PER_RICERCA || parole.length > 0
  const pezzi = (testo: string, colore?: string, extra: { bold?: boolean; dimColor?: boolean } = {}) =>
    segna(testo, parole).map((p, i) =>
      p.trovato ? (
        <Text key={`t${i}`} color="yellow" bold>{p.testo}</Text>
      ) : (
        <Text key={`t${i}`} color={colore} {...extra}>{p.testo}</Text>
      ),
    )
  const totale = stato.file.reduce((t, f) => ({ aggiunte: t.aggiunte + (f.aggiunte ?? 0), tolte: t.tolte + (f.tolte ?? 0) }), { aggiunte: 0, tolte: 0 })
  // I conteggi in colonna: larghi quanto il più largo, così si leggono dall'alto in basso.
  const testoConti = (f: FileGit) => (f.aggiunte === null && f.tolte === null ? '' : `+${f.aggiunte ?? 0} −${f.tolte ?? 0}`)
  const largConti = Math.max(0, ...stato.file.map(f => testoConti(f).length))
  const righe = []
  for (const f of visibili) {
    const { segno, colore } = SEGNO[f.stato]
    const taglio = f.path.lastIndexOf('/')
    const nome = taglio >= 0 ? f.path.slice(taglio + 1) : f.path
    const cartella = taglio >= 0 ? f.path.slice(0, taglio) : ''
    const conti = testoConti(f)
    righe.push(
      <Box key={`file-${f.path}`} flexDirection="column">
        <Box flexDirection="row">
          {/* Solo il percorso cede quando lo spazio manca: conteggi e pulsanti restano interi. */}
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">
              <Text color={colore} bold>{`${segno} `}</Text>
              <Text>{pezzi(nome, undefined, { bold: true })}</Text>
              {cartella ? <Text dimColor>{'  '}</Text> : null}
              {cartella ? <Text>{pezzi(cartella, undefined, { dimColor: true })}</Text> : null}
              {f.da ? <Text dimColor>{`  ← ${f.da}`}</Text> : null}
              {f.stato === 'conflitto' ? <Text color="red">{'  conflitto'}</Text> : null}
            </Text>
          </Box>
          <Box flexShrink={0} flexDirection="row" columnGap={2} marginLeft={2}>
            <Box width={largConti} justifyContent="flex-end">
              {conti ? (
                <Text>
                  <Text color="green">{`+${f.aggiunte ?? 0}`}</Text>
                  <Text color="red">{` −${f.tolte ?? 0}`}</Text>
                </Text>
              ) : null}
            </Box>
            <Button key={`diff-${f.path}`} plain onPress={() => mostraDiff($, f.path)}>
              <Text color="cyan">{aperti.includes(f.path) ? '▴ diff' : '▾ diff'}</Text>
            </Button>
            <Box width={6}>
              {f.stato !== 'eliminato' ? (
                <Button key={`editor-${f.path}`} plain onPress={() => apriFile($, stato.radice, f, opzioneEditor)}>
                  <Text color="cyan">↗ apri</Text>
                </Button>
              ) : null}
            </Box>
          </Box>
        </Box>
        {aperti.includes(f.path) ? (
          <Box borderStyle="single" borderDimColor paddingX={1}>
            {testi[f.path] ? (
              <Code source={testi[f.path]!} format="diff" path={f.path} wrap="truncate-end" />
            ) : (
              <Text dimColor>nessuna differenza di testo</Text>
            )}
          </Box>
        ) : null}
      </Box>,
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text bold color="yellow">{parole.length ? `FILE MODIFICATI · ${visibili.length} di ${stato.file.length}` : `FILE MODIFICATI · ${stato.file.length}`}</Text>
        {stato.file.length ? (
          <Text>
            <Text color="green">{`+${totale.aggiunte}`}</Text>
            <Text color="red">{` −${totale.tolte}`}</Text>
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
            const primo = visibili[0]
            if (primo) await $.ui.focus({ requestId: PANNELLO_MODIFICHE, key: `diff-${primo.path}` }).catch(() => undefined)
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
            <Text color="cyan">{` ${AZZERA}`}</Text>
          </Button>
        ) : null}
      </Box>
      {!stato.file.length ? (
        <Text dimColor>Nessuna modifica da committare.</Text>
      ) : visibili.length ? (
        righe
      ) : (
        <Text dimColor>Nessun file contiene queste parole nel percorso.</Text>
      )}
    </Box>
  )
}
