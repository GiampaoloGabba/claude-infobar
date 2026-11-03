import type { FileGit } from '../types'
import { normalizzaPercorso } from './testi'

/**
 * Un repository dentro il repository (un worktree degli agenti di Claude Code, un clone): git status lo elenca
 * come una cartella sola, con la barra in fondo, senza guardarci dentro. Non è una modifica da committare.
 */
export function eAnnidato(f: FileGit): boolean {
  return f.path.endsWith('/')
}

/**
 * I file di `git status --porcelain=v1 -z`: ogni voce è `XY percorso`, e per una rinomina o una copia segue
 * il percorso di prima come campo a sé.
 */
export function fileDaStatus(uscita: string): FileGit[] {
  const campi = uscita.split('\0')
  const file: FileGit[] = []
  for (let i = 0; i < campi.length; i++) {
    const voce = campi[i]!
    if (voce.length < 4) continue
    const x = voce[0]!
    const y = voce[1]!
    const path = voce.slice(3)
    const rinomina = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    const da = rinomina ? campi[++i] : undefined
    file.push({ path, stato: statoDa(x, y), aggiunte: null, tolte: null, ...(da ? { da } : {}) })
  }
  return file
}

function statoDa(x: string, y: string): FileGit['stato'] {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflitto'
  if (x === '?' || x === 'A') return 'nuovo'
  if (x === 'D' || y === 'D') return 'eliminato'
  if (x === 'R' || x === 'C' || y === 'R' || y === 'C') return 'rinominato'
  return 'modificato'
}

/** I worktree di `git worktree list --porcelain`, senza quelli la cui cartella non c'è più. */
export function worktreeDaLista(uscita: string): { radice: string; head: string; branch: string | null }[] {
  const lista = []
  for (const blocco of uscita.split(/\r?\n\r?\n/)) {
    const campi = new Map(
      blocco.split(/\r?\n/).map(riga => {
        const spazio = riga.indexOf(' ')
        return spazio < 0 ? ([riga, ''] as const) : ([riga.slice(0, spazio), riga.slice(spazio + 1)] as const)
      }),
    )
    const radice = campi.get('worktree')
    if (!radice || campi.has('bare') || campi.has('prunable')) continue
    lista.push({
      radice: normalizzaPercorso(radice),
      head: campi.get('HEAD') ?? '',
      branch: campi.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
    })
  }
  return lista
}

/**
 * Le righe aggiunte e tolte di `git diff --numstat -z`, per percorso: `aggiunte\ttolte\tpercorso`, o per una
 * rinomina `aggiunte\ttolte\t` seguito dal percorso di prima e da quello nuovo; `-` per un file binario.
 */
export function righeDaNumstat(uscita: string): Map<string, { aggiunte: number | null; tolte: number | null }> {
  const campi = uscita.split('\0')
  const conti = new Map<string, { aggiunte: number | null; tolte: number | null }>()
  for (let i = 0; i < campi.length; i++) {
    const m = campi[i]!.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s)
    if (!m) continue
    const path = m[3] ? m[3] : (campi[(i += 2)] ?? '')
    if (!path) continue
    conti.set(path, { aggiunte: m[1] === '-' ? null : Number(m[1]), tolte: m[2] === '-' ? null : Number(m[2]) })
  }
  return conti
}

/** La prima riga del file nuovo toccata da un diff unificato; 1 se il diff non ne tocca. */
export function primaRigaDelDiff(diff: string): number {
  let riga: number | null = null
  for (const linea of diff.split('\n')) {
    const blocco = linea.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (blocco) {
      if (riga !== null) break
      riga = Number(blocco[1])
      continue
    }
    if (riga === null) continue
    if (linea.startsWith('+') || linea.startsWith('-')) return Math.max(1, riga)
    riga++
  }
  return 1
}

/** Il diff dai blocchi in poi: le righe di intestazione (`diff --git`, `index`, `---`, `+++`) non servono a disegnarlo. */
export function soloBlocchi(diff: string): string {
  const inizio = diff.indexOf('\n@@')
  if (diff.startsWith('@@')) return diff.trimEnd()
  return inizio >= 0 ? diff.slice(inizio + 1).trimEnd() : ''
}

/** Il diff di un file nuovo, non ancora tracciato: tutte le sue righe aggiunte. */
export function diffNuovo(testo: string): string {
  const righe = testo.replace(/\r\n/g, '\n').split('\n')
  if (righe.at(-1) === '') righe.pop()
  if (!righe.length) return ''
  return [`@@ -0,0 +1,${righe.length} @@`, ...righe.map(r => `+${r}`)].join('\n')
}
