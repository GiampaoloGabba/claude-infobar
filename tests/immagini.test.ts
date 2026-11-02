import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { letturaPngGrande } from '../hooks/file'
import { decodeImage, formatOf, imageSize } from '../hooks/formati'
import { inflateZlib } from '../hooks/inflate'
import { fitCells, fitRow, imageNumbers, pngSize } from '../hooks/layout'
import type { Thumbnail } from '../hooks/pixels'
import { decodePng } from '../hooks/png'
import { fromBase64, rasterCells } from '../hooks/raster'

// 40 x 20 RGBA, rosso sopra e blu sotto, compresso da Pillow.
const ROSSO_SU_BLU =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAQElEQVR4nO3VsQ0AIBDDQOP9d35GoMRC3ASWUmQNDGESJ3ESJ3ESJ3ESJ3ESt2D+kzw9scRJnMRJnMRJnLcDTjaOZAQjGy3nBAAAAABJRU5ErkJggg=='

// Generati con Pillow: 64 x 32, rosso in alto a sinistra, verde in basso a sinistra, blu a destra.
const JPEG_BASELINE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAgAEADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50r8MP9UwoAKACgDwKv8AcY/x0CgAoAKAPfa/w5P9iwoAKACgDwKv9xj/AB0CgAoAKAP1Dr/nMP4aCgAoAKAPy8r/AKMz+5QoAKACgD9Q6/5zD+GgoAKACgD8vK/6Mz+5QoAKACgD/9k='
const JPEG_PROGRESSIVO =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAgAEADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAgGB//EABgBAQADAQAAAAAAAAAAAAAAAAAHCAkG/9oADAMBAAIQAxAAAAHnI4W1IGBF46dAVCM5oMAl4aMzmB//xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAEFAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/AQ//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/AQ//xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAY/AgP/xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAE/IQP/2gAMAwEAAgADAAAAEP8A8IL30IL/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/EA//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/EA//xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAE/EAP/2Q=='
const JPEG_RESTART =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAgAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAB/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/0PnSiiivww/1TP/R/Peiiiv9Uz4c/9L896KKK/1TPhz/0+7ooor+Hz/OI//U7uiiiv4fP84j/9X896KKK/1TPhz/1vz3ooor/VM+HP/Z'
// Salvato ruotato di 90° in senso antiorario, con l'orientamento EXIF 6 che lo raddrizza.
const JPEG_RUOTATO =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD896KKK/1TPhwooooAKKKKACiiigD32iiiv8OT/Ys+xqKKK/Ej/mPPjmiiiv20/wCnA+xqKKK/Ej/mPP/Z'
// Lo stesso disegno a 256 x 128, progressivo.
const JPEG_GRANDE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCACAAQADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAgGB//EABgBAQEBAQEAAAAAAAAAAAAAAAAIBwkG/9oADAMBAAIQAxAAAAHnI8LVIAAAAAAGBFxx0AAAAAABvhDligAAAAAAYEXHHQAAAAAAG+EOWKAAAAAABgRccdAAAAAAAb4Q5YoAAAAAAGBFxx0AAAAAABUI5zYYAAAAAABLw6M7mAAAAAABUI5zYYAAAAAABLw6M7mAAAAAABUI5zYYAAAAAABLw6M7mAAAAAABUI5zYYAAAAAABLw6M7mAAAAAAB//xAAUEAEAAAAAAAAAAAAAAAAAAACQ/9oACAEBAAEFAgA//8QAFBEBAAAAAAAAAAAAAAAAAAAAcP/aAAgBAwEBPwEA/8QAFBEBAAAAAAAAAAAAAAAAAAAAcP/aAAgBAgEBPwEA/8QAFBABAAAAAAAAAAAAAAAAAAAAkP/aAAgBAQAGPwIAP//EABQQAQAAAAAAAAAAAAAAAAAAAJD/2gAIAQEAAT8hAD//2gAMAwEAAgADAAAAEP8A/wD/AP8A/wD/AAgggggggv8A/wD/AP8A/wD/AAgggggggv8A/wD/AP8A/wD/AAgggggggv8A/wD/AP8A/wD/AAgggggggvfffffffQgggggggvfffffffQgggggggvfffffffQgggggggvfffffffQgggggggv/EABQRAQAAAAAAAAAAAAAAAAAAAHD/2gAIAQMBAT8QAP/EABQRAQAAAAAAAAAAAAAAAAAAAHD/2gAIAQIBAT8QAP/EABQQAQAAAAAAAAAAAAAAAAAAAJD/2gAIAQEAAT8QAD//2Q=='
// 8 x 8 interlacciato: metà sinistra rossa, destra trasparente, ultima riga blu; il secondo fotogramma è verde.
const GIF_DUE_FOTOGRAMMI =
  'R0lGODlhCAAIAIEAAP8AAAAA/wAAAAAAACH5BAUAAAIALAAAAAAIAAgAAAgeAAEIBCCgoICBBA0iNHhwIMOFCh1GFMgwgMWLFgMCACH5BAUAAAEALAAAAAAIAAgAgQD/AAAAAAAAAAAAAAgPAAEIHEiwoMGDCBMqTBgQADs='
// 4 x 2: metà sinistra rossa opaca, destra trasparente.
const PNG_TRASPARENTE =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFUlEQVR4nGP4z8DwH4QZoIAJxoABAHXOA/+HXAe/AAAAAElFTkSuQmCC'
const WEBP =
  'UklGRjQAAABXRUJQVlA4TCcAAAAvH8ADABcgEEjaH3qN+RcQFPk/2vwHXwoEAoRJk1YNRPQ/qgA+1RcA'
const ROSSO = [255, 0, 0, 255]
const VERDE = [0, 255, 0, 255]
const BLU = [0, 0, 255, 255]
const TRASPARENTE = [0, 0, 0, 0]

function pixel(t: Thumbnail, x: number, y: number): number[] {
  return [...t.rgba.subarray((y * t.width + x) * 4, (y * t.width + x) * 4 + 4)]
}

// Il JPEG perde qualche unità per canale: ogni valore entro 8 dall'atteso vale l'atteso.
function circa(valori: number[], attesi: number[]): number[] {
  return valori.map((v, i) => (Math.abs(v - attesi[i]!) <= 8 ? attesi[i]! : v))
}

function quadranti(t: Thumbnail) {
  const [x0, x1] = [Math.floor(t.width / 8), Math.floor((t.width * 7) / 8)]
  const [y0, y1] = [Math.floor(t.height / 8), Math.floor((t.height * 7) / 8)]
  expect(circa(pixel(t, x0, y0), ROSSO)).toEqual(ROSSO)
  expect(circa(pixel(t, x0, y1), VERDE)).toEqual(VERDE)
  expect(circa(pixel(t, x1, y0), BLU)).toEqual(BLU)
  expect(circa(pixel(t, x1, y1), BLU)).toEqual(BLU)
}

function testataPng(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return btoa(String.fromCharCode(...bytes))
}

function cella(celle: string, indice: number): number[] {
  const parole = new Uint32Array(fromBase64(celle).buffer)
  return [...parole.subarray(indice * 3, indice * 3 + 3)]
}

test('i numeri delle immagini vengono dal prompt, senza doppioni e in ordine', () => {
  expect(imageNumbers('guarda [Image #2] e [Image #1] e ancora [Image #2]')).toEqual([2, 1])
  expect(imageNumbers('[Image 1] [image #3] #4')).toEqual([])
})

test('le dimensioni del PNG si leggono dall\'intestazione IHDR', () => {
  expect(pngSize(testataPng(1630, 632))).toEqual({ width: 1630, height: 632 })
  expect(pngSize(btoa('\xff\xd8\xff\xe0 questo è un jpeg, non un png...'))).toBeNull()
})

test('le miniature tengono le proporzioni e la riga sta nella banda', () => {
  expect(fitCells({ width: 500, height: 500 })).toEqual({ columns: 12, rows: 6 })
  expect(fitCells({ width: 3000, height: 500 })).toEqual({ columns: 32, rows: 3 })
  expect(fitCells({ width: 100, height: 2000 })).toEqual({ columns: 4, rows: 6 })
  const quadrata = { width: 500, height: 500 }
  expect(fitRow([quadrata], 7, 120)).toEqual([{ columns: 8, rows: 4 }])
  expect(fitRow([quadrata, quadrata, quadrata], 20, 40)).toEqual([
    { columns: 10, rows: 5 },
    { columns: 10, rows: 5 },
    { columns: 10, rows: 5 },
  ])
})

test('inflate legge i blocchi non compressi e rifiuta un flusso corto', () => {
  const stored = Uint8Array.of(0x78, 0x01, 0x01, 3, 0, 0xfc, 0xff, 7, 8, 9, 0, 0, 0, 0)
  expect([...inflateZlib(stored, 3)]).toEqual([7, 8, 9])
  expect(() => inflateZlib(stored, 4)).toThrow()
})

test('un PNG diventa una miniatura con i suoi colori e le sue proporzioni', () => {
  const miniatura = decodePng(fromBase64(ROSSO_SU_BLU), 10, 10)
  expect([miniatura.width, miniatura.height]).toEqual([10, 5])
  expect(pixel(miniatura, 0, 0)).toEqual(ROSSO)
  expect(pixel(miniatura, 9, 4)).toEqual(BLU)
  expect(() => decodePng(fromBase64(testataPng(10, 10)), 10, 10)).toThrow()
})

test('un PNG trasparente resta trasparente, e il nero dei pixel vuoti non sporca il rosso', () => {
  const intera = decodePng(fromBase64(PNG_TRASPARENTE), 4, 2)
  expect([pixel(intera, 0, 0), pixel(intera, 3, 1)]).toEqual([ROSSO, TRASPARENTE])
  const ridotta = decodePng(fromBase64(PNG_TRASPARENTE), 1, 1)
  expect(pixel(ridotta, 0, 0)).toEqual([255, 0, 0, 128])
})

test('un JPEG baseline, progressivo o con i marker di restart dà i colori disegnati, anche ridotto', () => {
  for (const jpeg of [JPEG_BASELINE, JPEG_PROGRESSIVO, JPEG_RESTART]) {
    const bytes = fromBase64(jpeg)
    expect(imageSize(bytes, 'jpeg')).toEqual({ width: 64, height: 32 })
    const intera = decodeImage(bytes, 'jpeg', 320, 120)
    expect([intera.width, intera.height]).toEqual([64, 32])
    quadranti(intera)
    const ridotta = decodeImage(bytes, 'jpeg', 16, 16)
    expect([ridotta.width, ridotta.height]).toEqual([16, 8])
    quadranti(ridotta)
  }
})

test('un JPEG grande otto volte la miniatura si decodifica dai soli coefficienti DC', () => {
  const miniatura = decodeImage(fromBase64(JPEG_GRANDE), 'jpeg', 32, 32)
  expect([miniatura.width, miniatura.height]).toEqual([32, 16])
  quadranti(miniatura)
})

test("l'orientamento EXIF raddrizza il JPEG e le sue dimensioni", () => {
  const bytes = fromBase64(JPEG_RUOTATO)
  expect(imageSize(bytes, 'jpeg')).toEqual({ width: 64, height: 32 })
  const miniatura = decodeImage(bytes, 'jpeg', 320, 120)
  expect([miniatura.width, miniatura.height]).toEqual([64, 32])
  quadranti(miniatura)
})

test('di una GIF conta il primo fotogramma, interlacciato e con la sua trasparenza', () => {
  const bytes = fromBase64(GIF_DUE_FOTOGRAMMI)
  const intera = decodeImage(bytes, 'gif', 8, 8)
  expect([pixel(intera, 1, 1), pixel(intera, 6, 1), pixel(intera, 1, 7), pixel(intera, 6, 7)]).toEqual([ROSSO, TRASPARENTE, BLU, BLU])
  expect(pixel(intera, 1, 6)).toEqual(ROSSO)
  // Ridotta a 4 x 4, l'angolo in basso a destra è metà trasparente e metà blu: blu a mezza opacità, non blu scurito.
  const ridotta = decodeImage(bytes, 'gif', 4, 4)
  expect([pixel(ridotta, 0, 0), pixel(ridotta, 3, 0), pixel(ridotta, 3, 3)]).toEqual([ROSSO, TRASPARENTE, [0, 0, 255, 128]])
})

test('il formato si riconosce dai byte; il WebP dà le dimensioni ma non si decodifica', () => {
  expect([JPEG_BASELINE, GIF_DUE_FOTOGRAMMI, PNG_TRASPARENTE, WEBP].map(b => formatOf(fromBase64(b)))).toEqual(['jpeg', 'gif', 'png', 'webp'])
  expect(formatOf(fromBase64(btoa('BM questo è una bitmap')))).toBeNull()
  expect(imageSize(fromBase64(WEBP), 'webp')).toEqual({ width: 32, height: 16 })
  expect(() => decodeImage(fromBase64(WEBP), 'webp', 32, 16)).toThrow()
})

test('i mezzi blocchi mettono davanti il pixel sopra e lasciano la trasparenza al terminale', () => {
  const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0)
  const celle = rasterCells({ width: 2, height: 2, rgba }, 2, 1)
  expect(cella(celle, 0)).toEqual([0x2580, 0xff0000, 0x0000ff])
  expect(cella(celle, 1)).toEqual([0x20, 0x01000000, 0x01000000])
})

const BANDA = {
  plugin: 'infobar',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 22, bodyColumns: 120, scroll: { offset: 0, bodyRows: 22 }, view: {} },
} as const

const SUGGERIMENTO = {
  plugin: 'infobar',
  component: 'PromptHint',
  viewport: { columns: 120, rows: 40 },
  props: { isDraft: true, isWorking: false, hint: '(shift+tab to cycle)' },
} as const

type Ospite = {
  env: Record<string, string>
  root: string
  file: Record<string, string>
  // Le dimensioni che fs.list dichiara al posto di quelle dei byte, per i file oltre ciò che si può leggere.
  dimensioni?: Record<string, number>
  lettura?: Promise<void>
  bozza: string
  chiamate: Record<string, number>
  comandi: string[][]
}

function ospite(on: On, init: Omit<Ospite, 'chiamate' | 'comandi'>): Ospite {
  const o: Ospite = { ...init, chiamate: {}, comandi: [] }
  const conta = (nome: string) => (o.chiamate[nome] = (o.chiamate[nome] ?? 0) + 1)
  // Il motore passa agli hook fs percorsi nativi: su un host Windows barre rovesciate e /tmp sul disco corrente.
  const posix = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:(?=\/tmp\/)/, '')
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: o.root }))
  on('env.get', ($, e) => ({ value: o.env[e.name] }))
  on('process.run', ($, e) => (o.comandi.push([...e.argv]), {
    value: { exitCode: 0, stdout: '501\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('prompt.read', () => {
    conta('prompt.read')
    return { value: { text: o.bozza, cursor: o.bozza.length } }
  })
  on('fs.exists', ($, e) => {
    conta('fs.exists')
    const chiesto = posix(e.path)
    return { value: Object.keys(o.file).some(p => p === chiesto || p.startsWith(`${chiesto}/`)) }
  })
  on('fs.list', ($, e) => {
    conta('fs.list')
    const cartella = posix(e.path ?? '')
    const voci = Object.entries(o.file)
      .filter(([p]) => p.slice(0, p.lastIndexOf('/')) === cartella)
      .map(([p, base64]) => ({
        name: p.slice(p.lastIndexOf('/') + 1),
        kind: 'file' as const,
        size: o.dimensioni?.[p] ?? Math.floor((base64.length * 3) / 4),
        mtimeMs: 0,
        isLink: false,
      }))
    return { value: voci }
  })
  on('fs.read', async ($, e) => {
    conta('fs.read')
    await o.lettura
    return { value: { base64: o.file[posix(e.path)] ?? '' } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['banda del motore'] }))
  return o
}

test('un incolla compare quando si ridisegna il suggerimento, senza polling', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = '/tmp/claude-501/-work/sess-1/images'
  const o = ospite(on, { env: {}, root: '/work', file: { [`${cartella}/1.png`]: ROSSO_SU_BLU }, bozza: '' })

  await clock.advance(10_000)
  expect(o.chiamate['prompt.read'] ?? 0).toBe(0)

  o.bozza = 'guarda [Image #1] [Image #2]'
  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  // Il riquadro c'è subito; la miniatura arriva quando la decodifica, su un timer suo, ha finito.
  const prima = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await prima.find({ type: 'Image' })).toBeUndefined()
  expect(await prima.find({ type: 'Text', text: '…' })).toBeDefined()
  await prima.unmount()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const immagine = await ui.find({ type: 'Image' })
  expect(immagine?.props).toMatchObject({ source: { width: 40, height: 20 }, columns: 24, rows: 6 })
  const { rgba } = immagine?.props.source as { rgba: string }
  expect([...fromBase64(rgba).subarray(0, 4)]).toEqual(ROSSO)
  expect(await ui.find({ type: 'Text', text: 'nessuna anteprima' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'banda del motore' })).toBeDefined()
  await ui.unmount()

  // #2 non arriva mai: qualche tentativo, poi il disco resta in pace.
  await clock.advance(10_000)
  const elenchiDopoTentativi = o.chiamate['fs.list']
  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)
  expect(o.chiamate['fs.list']).toBe(elenchiDopoTentativi)

  o.bozza = ''
  await $.prompt.submit({ text: 'guarda [Image #1] [Image #2]', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1)
  const dopo = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await dopo.find({ type: 'Image' })).toBeUndefined()
})

test('su Windows la cache è in %TEMP%\\claude, un JPEG passa inline e "apri" usa explorer', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Users/me/AppData/Local/Temp/claude/C--work-app/sess-1/images'
  const o = ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' },
    root: 'C:\\work\\app',
    file: { [`${cartella}/1.jpg`]: JPEG_BASELINE },
    bozza: '[Image #1]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 64, height: 32 }, columns: 24, rows: 6 })

  await ui.press({ key: 'apri-1' })
  expect(o.comandi).toEqual([['explorer.exe', `${cartella.replaceAll('/', '\\')}\\1.jpg`]])
})

test('un PNG oltre i 4 MiB va al terminale per percorso solo da kitty, Ghostty o WezTerm locali, altrove lo legge un processo fino a 32 MiB', () => {
  const MiB = 1024 * 1024
  expect(letturaPngGrande(10 * MiB, { KITTY_WINDOW_ID: '1' })).toBe('percorso')
  expect(letturaPngGrande(10 * MiB, { TERM_PROGRAM: 'WezTerm' })).toBe('percorso')
  expect(letturaPngGrande(10 * MiB, { KITTY_WINDOW_ID: '1', SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22' })).toBe('processo')
  expect(letturaPngGrande(10 * MiB, { GHOSTTY_RESOURCES_DIR: '/opt/ghostty', SSH_TTY: '/dev/pts/0' })).toBe('processo')
  expect(letturaPngGrande(10 * MiB, { TERM_PROGRAM: 'MosaicManager' })).toBe('processo')
  expect(letturaPngGrande(10 * MiB, {})).toBe('processo')
  expect(letturaPngGrande(33 * MiB, { TERM_PROGRAM: 'MosaicManager' })).toBe('troppo')
  expect(letturaPngGrande(33 * MiB, { KITTY_WINDOW_ID: '1' })).toBe('percorso')
})

test('in Mosaic Manager un PNG oltre i 4 MiB lo legge base64 e diventa pixel; oltre 32 MiB resta la nota', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = '/tmp/claude-501/-work/sess-1/images'
  const o = ospite(on, {
    env: { TERM_PROGRAM: 'MosaicManager', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' },
    root: '/work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU, [`${cartella}/2.png`]: ROSSO_SU_BLU },
    dimensioni: { [`${cartella}/1.png`]: 5_000_000, [`${cartella}/2.png`]: 40_000_000 },
    bozza: '[Image #1] [Image #2]',
  })
  const lanciati: string[][] = []
  on('process.spawn', async function* ($, e) {
    lanciati.push([...e.argv])
    yield { stream: 'stdout' as const, text: `${ROSSO_SU_BLU.slice(0, 76)}\n` }
    yield { stream: 'stdout' as const, text: `${ROSSO_SU_BLU.slice(76)}\n` }
    return { value: { code: 0, signal: null } }
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const immagine = await ui.find({ type: 'Image' })
  expect(immagine?.props).toMatchObject({ source: { width: 40, height: 20 } })
  const { rgba } = immagine?.props.source as { rgba: string }
  expect([...fromBase64(rgba).subarray(0, 4)]).toEqual(ROSSO)
  expect(await ui.find({ type: 'Text', text: 'oltre 32 MiB' })).toBeDefined()
  expect(lanciati).toEqual([['base64', `${cartella}/1.png`]])
  expect(o.chiamate['fs.read'] ?? 0).toBe(0)
})

test('su Windows il percorso va a PowerShell per variabile, e se il processo fallisce o non finisce resta la nota', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Temp/claude/C--work/sess-1/images'
  ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Temp', TERM_PROGRAM: 'MosaicManager' },
    root: 'C:\\work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU, [`${cartella}/2.png`]: ROSSO_SU_BLU },
    dimensioni: { [`${cartella}/1.png`]: 5_000_000, [`${cartella}/2.png`]: 5_000_000 },
    bozza: '[Image #1] [Image #2]',
  })
  const lanciati: { argv: string[]; env?: Record<string, string> }[] = []
  on('process.spawn', async function* ($, e) {
    lanciati.push({ argv: [...e.argv], env: e.env })
    if (lanciati.length === 2) await new Promise(() => {})
    yield { stream: 'stderr' as const, text: 'Exception calling "ReadAllBytes"' }
    return { value: { code: 1, signal: null } }
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)
  await clock.advance(11_000)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text', text: 'oltre 4 MiB' })).length).toBe(2)
  expect(lanciati[0]?.argv[0]).toBe('powershell.exe')
  expect(lanciati[0]?.argv.join(' ')).not.toContain('1.png')
  expect(lanciati[0]?.env).toEqual({ INFOBAR_PNG: 'C:\\Temp\\claude\\C--work\\sess-1\\images\\1.png' })
})

test('una miniatura finita mentre si legge un altro incolla non torna a "…"', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = '/tmp/claude-501/-work/sess-1/images'
  const o = ospite(on, {
    env: { TERM_PROGRAM: 'MosaicManager' },
    root: '/work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU, [`${cartella}/2.png`]: ROSSO_SU_BLU },
    dimensioni: { [`${cartella}/1.png`]: 5_000_000 },
    bozza: '[Image #1]',
  })
  let liberaProcesso = () => {}
  const processo = new Promise<void>(resolve => (liberaProcesso = resolve))
  let liberaLettura = () => {}
  o.lettura = new Promise<void>(resolve => (liberaLettura = resolve))
  on('process.spawn', async function* () {
    await processo
    yield { stream: 'stdout' as const, text: ROSSO_SU_BLU }
    return { value: { code: 0, signal: null } }
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)
  o.bozza = '[Image #1] [Image #2]'
  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)
  liberaProcesso()
  await clock.advance(100)
  liberaLettura()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
})

test('il WebP ha la sua etichetta; oltre i 4 MiB un PNG lo legge kitty locale, un JPEG no', { options: { anteprime: 'immagini' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = '/tmp/claude-501/-work/sess-1/images'
  const o = ospite(on, {
    env: { KITTY_WINDOW_ID: '1' },
    root: '/work',
    file: { [`${cartella}/1.webp`]: WEBP, [`${cartella}/2.png`]: ROSSO_SU_BLU, [`${cartella}/3.jpeg`]: JPEG_BASELINE },
    dimensioni: { [`${cartella}/2.png`]: 5_000_000, [`${cartella}/3.jpeg`]: 5_000_000 },
    bozza: '[Image #1] [Image #2] [Image #3]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'WebP: niente anteprima' })).toBeDefined()
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { file: `${cartella}/2.png`, format: 'png' } })
  expect(await ui.find({ type: 'Text', text: 'oltre 4 MiB' })).toBeDefined()
  expect(o.chiamate['fs.read']).toBe(1)
})

test('a blocchi l\'immagine diventa una griglia di mezzi blocchi colorati', { options: { anteprime: 'blocchi' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Temp/claude/C--work/sess-1/images'
  ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Temp' },
    root: 'C:\\work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU },
    bozza: '[Image #1]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props).toMatchObject({ columns: 24, rows: 6 })
  const celle = raster?.props.cells as string
  expect(cella(celle, 0)).toEqual([0x2580, 0xff0000, 0xff0000])
  expect(cella(celle, 24 * 6 - 1)).toEqual([0x2580, 0x0000ff, 0x0000ff])
})

test('con anteprime "no" la banda non tocca il disco', { options: { anteprime: 'no' } }, async ($, on) => {
  const clock = mock.clock(on)
  const o = ospite(on, { env: {}, root: '/work', file: {}, bozza: '[Image #1]' })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(o.chiamate['prompt.read'] ?? 0).toBe(0)
  expect(o.chiamate['fs.list'] ?? 0).toBe(0)
})

test('a etichette restano solo i tag cliccabili e i file non si leggono', { options: { anteprime: 'etichette' } }, async ($, on) => {
  const clock = mock.clock(on)
  const cartella = 'C:/Temp/claude/C--work/sess-1/images'
  const o = ospite(on, {
    env: { OS: 'Windows_NT', TEMP: 'C:\\Temp' },
    root: 'C:\\work',
    file: { [`${cartella}/1.png`]: ROSSO_SU_BLU },
    bozza: '[Image #1] [Image #2]',
  })

  await (await $.ui.mount({ ...SUGGERIMENTO, surface: 'terminal' })).unmount()
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'apri-1' }))?.props).toMatchObject({ label: 'Image #1', hotkey: '1' })
  expect(await ui.find({ type: 'Text', text: 'Image #2 (non trovata)' })).toBeDefined()
  expect(o.chiamate['fs.read'] ?? 0).toBe(0)

  await ui.press({ key: 'apri-1' })
  expect(o.comandi).toEqual([['explorer.exe', `${cartella.replaceAll('/', '\\')}\\1.png`]])
})
