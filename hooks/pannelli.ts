import type { EngineInterface, On } from 'claude-code'

// I pannelli aperti da questo plugin, tenuti in memoria e non chiesti a $.ui.panes(): l'apertura deve venire
// subito dopo il clic, perché Claude Code la conti come tua e la mostri anche in un terminale stretto.
const aperti = new Set<string>()

export function segnaAperto(id: string) {
  aperti.add(id)
}

/**
 * Il clic su un pulsante della barra: apre il suo pannello; se è già quello mostrato lo chiude, se è una
 * scheda dietro un'altra lo porta davanti.
 */
export async function alterna($: EngineInterface, id: string, apri: () => Promise<unknown>) {
  if (!aperti.has(id)) return apri()
  const pannello = (await $.ui.panes()).find(p => p.id === id)
  if (!pannello) {
    aperti.delete(id)
    return apri()
  }
  if (pannello.isShown) return $.ui.close({ id })
  return $.ui.open({ id, focus: true })
}

/** Un pannello chiuso, da chiunque: il prossimo clic lo riapre. */
export function registraPannelli(on: On) {
  on('ui.close', ($, e, next) => {
    aperti.delete(e.id)
    return next(e)
  })
}
