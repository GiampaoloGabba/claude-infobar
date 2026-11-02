import type { EngineInterface } from 'claude-code'

/** Quanto `$.fs.read` restituisce al massimo: di un file più grande arriva solo l'inizio. */
export const MAX_LETTURA = 4 * 1024 * 1024

type Letto = { dimensione: number; modificato: number; testo: string }

const letti = new Map<string, Letto>()

/**
 * Il testo di un file che si rilegge spesso (l'output di un lavoro): prima un `stat`, e il file si rilegge
 * solo se dimensione o ora di modifica sono cambiate. Null se il file non c'è.
 */
export async function leggiSeCambiato($: EngineInterface, file: string): Promise<{ testo: string; dimensione: number } | null> {
  const stat = await $.fs.stat(file).catch(() => null)
  if (stat?.kind !== 'file') {
    letti.delete(file)
    return null
  }
  const vecchio = letti.get(file)
  if (vecchio && vecchio.dimensione === stat.size && vecchio.modificato === stat.mtimeMs) return vecchio
  const testo = await $.fs.read(file)
  const nuovo = { dimensione: stat.size, modificato: stat.mtimeMs, testo }
  letti.set(file, nuovo)
  return nuovo
}
