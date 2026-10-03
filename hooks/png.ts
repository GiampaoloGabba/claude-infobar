import { inflateZlib } from './inflate'

/** A small RGBA picture, row-major, 4 bytes per pixel. */
export type Thumbnail = { width: number; height: number; rgba: Uint8Array }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
// Source pixels sampled per thumbnail pixel along each axis: enough to average out
// text and edges, few enough that a 4K screenshot costs little more than its inflate.
const SAMPLES = 4

/** Decodes a PNG and box-averages it down to fit `maxWidth` x `maxHeight`, keeping its aspect ratio. */
export function decodeThumbnail(png: Uint8Array, maxWidth: number, maxHeight: number): Thumbnail {
  if (png.length < 33 || SIGNATURE.some((byte, i) => png[i] !== byte)) throw new Error('not a PNG')
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)

  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const idat: Uint8Array[] = []
  let idatSize = 0

  for (let pos = 8; pos + 8 <= png.length; ) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!)
    const data = png.subarray(pos + 8, pos + 8 + length)
    pos += 12 + length
    if (type === 'IHDR') {
      width = view.getUint32(16)
      height = view.getUint32(20)
      depth = png[24]!
      colorType = png[25]!
      if (png[28] !== 0) throw new Error('interlaced PNG')
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'tRNS') {
      transparency = data
    } else if (type === 'IDAT') {
      idat.push(data)
      idatSize += data.length
    } else if (type === 'IEND') {
      break
    }
  }

  const channels = CHANNELS[colorType]
  if (!channels || width === 0 || height === 0 || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('unsupported PNG')
  if (colorType === 3 && !palette) throw new Error('PNG without palette')

  const compressed = new Uint8Array(idatSize)
  for (let i = 0, offset = 0; i < idat.length; offset += idat[i]!.length, i++) compressed.set(idat[i]!, offset)

  const bitsPerPixel = channels * depth
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const filterStep = Math.max(1, bitsPerPixel >> 3)
  const raw = inflateZlib(compressed, height * (stride + 1))
  unfilter(raw, height, stride, filterStep)

  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const thumbWidth = Math.max(1, Math.round(width * scale))
  const thumbHeight = Math.max(1, Math.round(height * scale))
  const sums = new Float64Array(thumbWidth * thumbHeight * 4)
  const counts = new Uint32Array(thumbWidth * thumbHeight)
  const xStep = Math.max(1, Math.floor(width / (thumbWidth * SAMPLES)))
  const yStep = Math.max(1, Math.floor(height / (thumbHeight * SAMPLES)))
  const pixel = new Uint8Array(4)
  const read = pixelReader(raw, stride, depth, colorType, palette, transparency)

  for (let y = 0; y < height; y += yStep) {
    const row = Math.min(thumbHeight - 1, Math.floor((y * thumbHeight) / height)) * thumbWidth
    const rowStart = y * (stride + 1) + 1
    for (let x = 0; x < width; x += xStep) {
      read(rowStart, x, pixel)
      const cell = row + Math.min(thumbWidth - 1, Math.floor((x * thumbWidth) / width))
      // Premultiplied, so a transparent pixel's color doesn't bleed into its neighbours.
      const alpha = pixel[3]!
      sums[cell * 4]! += pixel[0]! * alpha
      sums[cell * 4 + 1]! += pixel[1]! * alpha
      sums[cell * 4 + 2]! += pixel[2]! * alpha
      sums[cell * 4 + 3]! += alpha
      counts[cell]!++
    }
  }

  const rgba = new Uint8Array(thumbWidth * thumbHeight * 4)
  for (let cell = 0; cell < counts.length; cell++) {
    const alphaSum = sums[cell * 4 + 3]!
    if (counts[cell] === 0 || alphaSum === 0) continue
    rgba[cell * 4] = Math.round(sums[cell * 4]! / alphaSum)
    rgba[cell * 4 + 1] = Math.round(sums[cell * 4 + 1]! / alphaSum)
    rgba[cell * 4 + 2] = Math.round(sums[cell * 4 + 2]! / alphaSum)
    rgba[cell * 4 + 3] = Math.round(alphaSum / counts[cell]!)
  }
  return { width: thumbWidth, height: thumbHeight, rgba }
}

function unfilter(raw: Uint8Array, height: number, stride: number, step: number) {
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1
    const above = start - (stride + 1)
    const filter = raw[start - 1]!
    const hasAbove = y > 0
    for (let i = 0; i < stride; i++) {
      const left = i >= step ? raw[start + i - step]! : 0
      const up = hasAbove ? raw[above + i]! : 0
      let value: number
      switch (filter) {
        case 0:
          continue
        case 1:
          value = left
          break
        case 2:
          value = up
          break
        case 3:
          value = (left + up) >> 1
          break
        case 4: {
          const upLeft = hasAbove && i >= step ? raw[above + i - step]! : 0
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          value = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
          break
        }
        default:
          throw new Error('bad PNG filter')
      }
      raw[start + i] = (raw[start + i]! + value) & 0xff
    }
  }
}

type PixelReader = (rowStart: number, x: number, out: Uint8Array) => void

function pixelReader(
  raw: Uint8Array,
  stride: number,
  depth: number,
  colorType: number,
  palette: Uint8Array | undefined,
  transparency: Uint8Array | undefined,
): PixelReader {
  const max = (1 << depth) - 1
  // The sample at a channel index at the image's own depth: what tRNS keys compare against.
  const rawSample = (rowStart: number, index: number) => {
    if (depth === 8) return raw[rowStart + index]!
    if (depth === 16) return (raw[rowStart + index * 2]! << 8) | raw[rowStart + index * 2 + 1]!
    const bit = index * depth
    return (raw[rowStart + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max
  }
  // The same sample scaled to 0-255 (a palette index stays an index).
  const sample = (rowStart: number, index: number) => {
    if (depth === 8) return raw[rowStart + index]!
    if (depth === 16) return raw[rowStart + index * 2]!
    const value = rawSample(rowStart, index)
    return colorType === 3 ? value : Math.round((value * 255) / max)
  }
  const transparentGray = colorType === 0 && transparency && transparency.length >= 2 ? (transparency[0]! << 8) | transparency[1]! : -1
  const transparentRgb =
    colorType === 2 && transparency && transparency.length >= 6
      ? [(transparency[0]! << 8) | transparency[1]!, (transparency[2]! << 8) | transparency[3]!, (transparency[4]! << 8) | transparency[5]!]
      : undefined

  switch (colorType) {
    case 0:
      return (rowStart, x, out) => {
        out[0] = out[1] = out[2] = sample(rowStart, x)
        out[3] = transparentGray >= 0 && rawSample(rowStart, x) === transparentGray ? 0 : 255
      }
    case 2:
      return (rowStart, x, out) => {
        out[0] = sample(rowStart, x * 3)
        out[1] = sample(rowStart, x * 3 + 1)
        out[2] = sample(rowStart, x * 3 + 2)
        out[3] =
          transparentRgb &&
          rawSample(rowStart, x * 3) === transparentRgb[0] &&
          rawSample(rowStart, x * 3 + 1) === transparentRgb[1] &&
          rawSample(rowStart, x * 3 + 2) === transparentRgb[2]
            ? 0
            : 255
      }
    case 3:
      return (rowStart, x, out) => {
        const index = sample(rowStart, x)
        out[0] = palette![index * 3] ?? 0
        out[1] = palette![index * 3 + 1] ?? 0
        out[2] = palette![index * 3 + 2] ?? 0
        out[3] = transparency && index < transparency.length ? transparency[index]! : 255
      }
    case 4:
      return (rowStart, x, out) => {
        out[0] = out[1] = out[2] = sample(rowStart, x * 2)
        out[3] = sample(rowStart, x * 2 + 1)
      }
    default:
      return (rowStart, x, out) => {
        out[0] = sample(rowStart, x * 4)
        out[1] = sample(rowStart, x * 4 + 1)
        out[2] = sample(rowStart, x * 4 + 2)
        out[3] = sample(rowStart, x * 4 + 3)
      }
  }
}
