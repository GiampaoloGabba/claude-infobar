import type { EngineInterface } from 'claude-code'

import { normalizzaPercorso } from './testi'

let trovata: { sessione: string; cartella: string } | undefined
let radici: string[] | undefined

// Claude Code tiene i file della sessione in <tmp>/<progetto>/<sessione>: images/<n>.png le immagini
// incollate, tasks/<id>.output l'output dei comandi in background. <tmp> è %TEMP%\claude su Windows e
// /tmp/claude-<uid> altrove, salvo CLAUDE_CODE_TMPDIR.
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
export async function cartellaSessione($: EngineInterface): Promise<string | undefined> {
  const sessione = await $.session.id()
  if (trovata?.sessione === sessione) return trovata.cartella
  radici ??= await radiciTemp($)
  const progetto = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
  for (const radice of radici) {
    const ipotesi = `${radice}/${progetto}/${sessione}`
    if (await $.fs.exists(ipotesi)) return (trovata = { sessione, cartella: ipotesi }).cartella
  }
  for (const radice of radici) {
    for (const voce of await $.fs.list(radice).catch(() => [])) {
      const cartella = `${radice}/${voce.name}/${sessione}`
      if (voce.kind === 'dir' && (await $.fs.exists(cartella))) return (trovata = { sessione, cartella }).cartella
    }
  }
  return undefined
}

// Dopo /clear o una ripresa l'id di sessione cambia, ma Claude Code continua a scrivere l'output dei comandi
// in background nella cartella della prima sessione del processo. La cartella giusta la dice Claude Code
// stesso, nel testo con cui un comando parte in background e nelle notifiche di fine: la si ricorda da lì.
let cartellaTasks: string | undefined

/** Ricorda la cartella degli output da un percorso `.../tasks/<id>.output` dato da Claude Code. */
export function ricordaFileOutput(path: string) {
  const cartella = normalizzaPercorso(path).replace(/\/[^/]+$/, '')
  if (cartella.endsWith('/tasks')) cartellaTasks = cartella
}

/** Il percorso di un file di output nel testo di Claude Code (avvio in background, notifica), se c'è. */
export function fileOutputNelTesto(testo: string): string | null {
  return testo.match(/(?:[A-Za-z]:[\\/]|\/)[^"'<>\n]*?[\\/]tasks[\\/][^"'<>\\/\n]+?\.output/)?.[0] ?? null
}

async function esiste($: EngineInterface, path: string) {
  return $.fs.exists(path).catch(() => false)
}

/** Il file di output di un lavoro in background, o null se non c'è (ancora, o non più). */
export async function fileOutputLavoro($: EngineInterface, id: string): Promise<string | null> {
  if (cartellaTasks && (await esiste($, `${cartellaTasks}/${id}.output`))) return `${cartellaTasks}/${id}.output`
  const sessione = await cartellaSessione($)
  if (sessione && (await esiste($, `${sessione}/tasks/${id}.output`))) return `${sessione}/tasks/${id}.output`
  return null
}
