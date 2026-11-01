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
