import { type Thumbnail, shrink } from './pixels'

/** Width and height of the GIF's logical screen, or null when the bytes aren't a GIF. */
export function gifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/) === null) return null
  const width = bytes[6]! | (bytes[7]! << 8)
  const height = bytes[8]! | (bytes[9]! << 8)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Decodes a GIF's first frame over its logical screen (transparent elsewhere) and shrinks it to fit. */
export function decodeGif(bytes: Uint8Array, maxWidth: number, maxHeight: number): Thumbnail {
  const size = gifSize(bytes)
  if (!size) throw new Error('not a GIF')
  const { width, height } = size
  const flags = bytes[10]!
  let pos = 13
  let palette = flags & 0x80 ? bytes.subarray(pos, (pos += 3 << ((flags & 7) + 1))) : undefined
  let transparent = -1

  while (pos < bytes.length) {
    const block = bytes[pos++]!
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = bytes[pos++]!
      if (label === 0xf9 && bytes[pos] === 4 && bytes[pos + 1]! & 1) transparent = bytes[pos + 4]!
      while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos]! + 1
      pos++
      continue
    }
    if (block !== 0x2c) throw new Error('bad GIF block')

    const left = bytes[pos]! | (bytes[pos + 1]! << 8)
    const top = bytes[pos + 2]! | (bytes[pos + 3]! << 8)
    const frameWidth = bytes[pos + 4]! | (bytes[pos + 5]! << 8)
    const frameHeight = bytes[pos + 6]! | (bytes[pos + 7]! << 8)
    const frameFlags = bytes[pos + 8]!
    pos += 9
    if (frameFlags & 0x80) palette = bytes.subarray(pos, (pos += 3 << ((frameFlags & 7) + 1)))
    if (!palette) throw new Error('GIF without palette')

    const minCodeSize = bytes[pos++]!
    let dataSize = 0
    for (let p = pos; p < bytes.length && bytes[p] !== 0; p += bytes[p]! + 1) dataSize += bytes[p]!
    const data = new Uint8Array(dataSize)
    for (let offset = 0; pos < bytes.length && bytes[pos] !== 0; pos += bytes[pos]! + 1) {
      data.set(bytes.subarray(pos + 1, pos + 1 + bytes[pos]!), offset)
      offset += bytes[pos]!
    }
    const indices = lzw(data, minCodeSize, frameWidth * frameHeight)

    const rgba = new Uint8Array(width * height * 4)
    const rows = frameFlags & 0x40 ? interlacedRows(frameHeight) : undefined
    for (let row = 0; row < frameHeight; row++) {
      const y = top + (rows ? rows[row]! : row)
      if (y >= height) continue
      for (let column = 0; column < frameWidth; column++) {
        const x = left + column
        const index = indices[row * frameWidth + column]!
        if (x >= width || index === transparent) continue
        const o = (y * width + x) * 4
        rgba[o] = palette[index * 3] ?? 0
        rgba[o + 1] = palette[index * 3 + 1] ?? 0
        rgba[o + 2] = palette[index * 3 + 2] ?? 0
        rgba[o + 3] = 255
      }
    }
    return shrink({ width, height, rgba }, maxWidth, maxHeight)
  }
  throw new Error('GIF without frames')
}

// The picture row each stored row lands on: passes every 8th row from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
function interlacedRows(height: number): Uint32Array {
  const rows = new Uint32Array(height)
  let i = 0
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
    for (let y = start; y < height; y += step) rows[i++] = y
  }
  return rows
}

function lzw(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 11) throw new Error('bad GIF code size')
  const out = new Uint8Array(pixels)
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const first = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  const clear = 1 << minCodeSize
  const end = clear + 1
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1
    suffix[i] = first[i] = i
  }

  let codeSize = minCodeSize + 1
  let next = end + 1
  let previous = -1
  let outPos = 0
  let bitBuf = 0
  let bitCount = 0
  let pos = 0

  while (outPos < pixels) {
    while (bitCount < codeSize) {
      if (pos >= data.length) return out
      bitBuf |= data[pos++]! << bitCount
      bitCount += 8
    }
    const code = bitBuf & ((1 << codeSize) - 1)
    bitBuf >>>= codeSize
    bitCount -= codeSize

    if (code === clear) {
      codeSize = minCodeSize + 1
      next = end + 1
      previous = -1
      continue
    }
    if (code === end) break
    if (previous === -1) {
      if (code >= clear) throw new Error('bad GIF code')
      out[outPos++] = code
      previous = code
      continue
    }

    const known = code < next
    if (!known && code !== next) throw new Error('bad GIF code')
    if (next < 4096) {
      prefix[next] = previous
      first[next] = first[previous]!
      suffix[next] = known ? first[code]! : first[previous]!
      next++
      if (next === 1 << codeSize && codeSize < 12) codeSize++
    }
    let depth = 0
    for (let c = code; c >= 0; c = prefix[c]!) stack[depth++] = suffix[c]!
    while (depth > 0 && outPos < pixels) out[outPos++] = stack[--depth]!
    previous = code
  }
  return out
}
