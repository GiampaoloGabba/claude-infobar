import { type Thumbnail, fitSize, shrink } from './pixels'

type Size = { width: number; height: number }

const ZIGZAG = Uint8Array.of(
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35,
  42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
)

// Samples per block side: the full 8, or a reduced IDCT at 1/2, 1/4 and 1/8 (the DC coefficient alone).
type Scale = 1 | 2 | 4 | 8
const SCALES: readonly Scale[] = [1, 2, 4, 8]

// IDCT basis for n samples per side, COS[n][x * n + u]: the 8-sample basis C(u) / 2 * cos((2x + 1) u π / 16)
// averaged over each group of 8 / n samples. The IDCT is linear, so a reduced block is exactly the box
// average of the full one, for a fraction of the work.
const COS = Object.fromEntries(
  SCALES.map(n => [
    n,
    Float64Array.from({ length: n * n }, (_, i) => {
      const group = 8 / n
      const u = i % n
      let sum = 0
      for (let x = Math.floor(i / n) * group, end = x + group; x < end; x++) sum += Math.cos(((2 * x + 1) * u * Math.PI) / 16)
      return (((u === 0 ? Math.SQRT1_2 : 1) / 2) * sum) / group
    }),
  ]),
) as Record<Scale, Float64Array>

// Indexed by the next 16 bits of the stream: code length << 8 | symbol, 0 where no code starts.
type Huffman = Uint32Array

type Component = {
  id: number
  h: number
  v: number
  quant: number
  blocksPerLine: number
  blocksPerColumn: number
  // Blocks per line as stored, padded to whole MCUs.
  stride: number
  // 64 coefficients per block, in natural order; just the DC one when decoding at 1/8.
  coefficients: Int16Array
  dcTable: Huffman | undefined
  acTable: Huffman | undefined
  pred: number
}

type Frame = {
  width: number
  height: number
  progressive: boolean
  components: Component[]
  maxH: number
  maxV: number
  mcusPerLine: number
  mcusPerColumn: number
}

type Header = Size & { orientation: number }

/** Width and height as the picture is shown (EXIF orientation applied), or null when the bytes aren't a JPEG. */
export function jpegSize(bytes: Uint8Array): Size | null {
  try {
    const header = readHeader(bytes)
    return header && orientedSize(header)
  } catch {
    return null
  }
}

/**
 * Decodes a baseline or progressive JPEG and shrinks it to fit `maxWidth` x `maxHeight`.
 * The inverse DCT runs at the smallest scale that still covers the target: a picture at least
 * 8 times the target comes from its DC coefficients alone, and a progressive file's AC scans
 * are then skipped unread.
 */
export function decodeJpeg(bytes: Uint8Array, maxWidth: number, maxHeight: number): Thumbnail {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG')
  const quant: Int32Array[] = []
  const dcTables: Huffman[] = []
  const acTables: Huffman[] = []
  let frame: Frame | undefined
  let scale: Scale = 8
  let restartInterval = 0
  let orientation = 1
  let adobeTransform = -1

  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = bytes[pos + 1]!
    if (marker === 0xff || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos++
      continue
    }
    if (marker === 0xd9) break
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    const start = pos + 4
    const end = pos + 2 + length
    if (end > bytes.length) throw new Error('truncated JPEG')
    pos = end

    switch (marker) {
      case 0xdb:
        for (let p = start; p < end; ) {
          const precision = bytes[p]! >> 4
          const table = new Int32Array(64)
          for (let k = 0; k < 64; k++) table[ZIGZAG[k]!] = precision ? (bytes[p + 1 + k * 2]! << 8) | bytes[p + 2 + k * 2]! : bytes[p + 1 + k]!
          quant[bytes[p]! & 15] = table
          p += 1 + (precision ? 128 : 64)
        }
        break
      case 0xc4:
        for (let p = start; p < end; ) {
          const index = bytes[p]!
          const counts = bytes.subarray(p + 1, p + 17)
          const total = counts.reduce((sum, n) => sum + n, 0)
          const table = buildHuffman(counts, bytes.subarray(p + 17, p + 17 + total))
          if (index >> 4) acTables[index & 15] = table
          else dcTables[index & 15] = table
          p += 17 + total
        }
        break
      case 0xdd:
        restartInterval = (bytes[start]! << 8) | bytes[start + 1]!
        break
      case 0xe1:
        orientation = exifOrientation(bytes.subarray(start, end)) ?? orientation
        break
      case 0xee:
        if (String.fromCharCode(...bytes.subarray(start, start + 5)) === 'Adobe') adobeTransform = bytes[start + 11] ?? 0
        break
      case 0xc0:
      case 0xc1:
      case 0xc2: {
        frame = readFrame(bytes, start, marker === 0xc2)
        const shown = orientation >= 5 ? { width: frame.height, height: frame.width } : frame
        const target = fitSize(shown.width, shown.height, maxWidth, maxHeight)
        scale = SCALES.find(n => Math.ceil((shown.width * n) / 8) >= target.width && Math.ceil((shown.height * n) / 8) >= target.height) ?? 8
        for (const c of frame.components) c.coefficients = new Int16Array(c.stride * frame.mcusPerColumn * c.v * (scale === 1 ? 1 : 64))
        break
      }
      case 0xda: {
        if (!frame) throw new Error('scan before frame')
        const count = bytes[start]!
        const components: Component[] = []
        for (let i = 0; i < count; i++) {
          const c = frame.components.find(c => c.id === bytes[start + 1 + i * 2])
          if (!c) throw new Error('bad scan component')
          const tables = bytes[start + 2 + i * 2]!
          c.dcTable = dcTables[tables >> 4]
          c.acTable = acTables[tables & 15]
          components.push(c)
        }
        const p = start + 1 + count * 2
        const scan = { start: bytes[p]!, end: bytes[p + 1]!, high: bytes[p + 2]! >> 4, low: bytes[p + 2]! & 15 }
        pos = scale === 1 && frame.progressive && scan.start > 0 ? skipEntropy(bytes, end) : decodeScan(bytes, end, frame, components, scan, restartInterval, scale === 1)
        break
      }
      default:
        if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) throw new Error('unsupported JPEG')
    }
  }
  if (!frame) throw new Error('JPEG without frame')

  const picture = toRgba(frame, quant, scale, adobeTransform)
  const fitted = shrink(picture, orientation >= 5 ? maxHeight : maxWidth, orientation >= 5 ? maxWidth : maxHeight)
  return orient(fitted, orientation)
}

function readHeader(bytes: Uint8Array): Header | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let orientation = 1
  for (let pos = 2; pos + 4 <= bytes.length; ) {
    if (bytes[pos] !== 0xff) return null
    const marker = bytes[pos + 1]!
    if (marker === 0xff) {
      pos++
      continue
    }
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    if (marker === 0xe1) orientation = exifOrientation(bytes.subarray(pos + 4, pos + 2 + length)) ?? orientation
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[pos + 5]! << 8) | bytes[pos + 6]!
      const width = (bytes[pos + 7]! << 8) | bytes[pos + 8]!
      return width > 0 && height > 0 ? { width, height, orientation } : null
    }
    pos += 2 + length
  }
  return null
}

function orientedSize({ width, height, orientation }: Header): Size {
  return orientation >= 5 ? { width: height, height: width } : { width, height }
}

function exifOrientation(app1: Uint8Array): number | undefined {
  if (String.fromCharCode(...app1.subarray(0, 4)) !== 'Exif' || app1.length < 14) return undefined
  const tiff = app1.subarray(6)
  const little = tiff[0] === 0x49
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > tiff.length) return undefined
  const entries = view.getUint16(ifd, little)
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return undefined
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little)
      return value >= 1 && value <= 8 ? value : undefined
    }
  }
  return undefined
}

function readFrame(bytes: Uint8Array, start: number, progressive: boolean): Frame {
  if (bytes[start] !== 8) throw new Error('unsupported JPEG precision')
  const height = (bytes[start + 1]! << 8) | bytes[start + 2]!
  const width = (bytes[start + 3]! << 8) | bytes[start + 4]!
  const count = bytes[start + 5]!
  if (width === 0 || height === 0 || ![1, 3, 4].includes(count)) throw new Error('unsupported JPEG')
  const parts = Array.from({ length: count }, (_, i) => ({
    id: bytes[start + 6 + i * 3]!,
    h: bytes[start + 7 + i * 3]! >> 4,
    v: bytes[start + 7 + i * 3]! & 15,
    quant: bytes[start + 8 + i * 3]!,
  }))
  const maxH = Math.max(...parts.map(c => c.h))
  const maxV = Math.max(...parts.map(c => c.v))
  const mcusPerLine = Math.ceil(width / (8 * maxH))
  const mcusPerColumn = Math.ceil(height / (8 * maxV))
  const components = parts.map(
    (c): Component => ({
      ...c,
      blocksPerLine: Math.ceil(Math.ceil((width * c.h) / maxH) / 8),
      blocksPerColumn: Math.ceil(Math.ceil((height * c.v) / maxV) / 8),
      stride: mcusPerLine * c.h,
      coefficients: new Int16Array(0),
      dcTable: undefined,
      acTable: undefined,
      pred: 0,
    }),
  )
  return { width, height, progressive, components, maxH, maxV, mcusPerLine, mcusPerColumn }
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const table = new Uint32Array(1 << 16)
  let code = 0
  let k = 0
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]!; i++, code++) {
      const first = code << (16 - length)
      table.fill((length << 8) | symbols[k++]!, first, first + (1 << (16 - length)))
    }
    code <<= 1
  }
  return table
}

// The end of the entropy-coded data that starts at `pos`: the first marker that isn't a stuffed byte or a restart.
function skipEntropy(bytes: Uint8Array, pos: number): number {
  for (; pos + 1 < bytes.length; pos++) {
    if (bytes[pos] !== 0xff) continue
    const next = bytes[pos + 1]!
    if (next !== 0 && (next < 0xd0 || next > 0xd7) && next !== 0xff) return pos
  }
  return bytes.length
}

type Scan = { start: number; end: number; high: number; low: number }

function decodeScan(
  bytes: Uint8Array,
  dataStart: number,
  frame: Frame,
  components: Component[],
  scan: Scan,
  restartInterval: number,
  dcOnly: boolean,
): number {
  let pos = dataStart
  let bitBuf = 0
  let bitCount = 0
  let eobrun = 0

  // A marker ends the data: from there on the stream reads as zero bits and `pos` stays on it.
  const fill = () => {
    while (bitCount <= 24) {
      let byte = 0
      if (pos < bytes.length && bytes[pos] === 0xff) {
        if (bytes[pos + 1] === 0) {
          byte = 0xff
          pos += 2
        }
      } else if (pos < bytes.length) {
        byte = bytes[pos++]!
      }
      bitBuf = (bitBuf << 8) | byte
      bitCount += 8
    }
  }
  const bits = (n: number) => {
    if (n === 0) return 0
    if (bitCount < n) fill()
    bitCount -= n
    return (bitBuf >>> bitCount) & ((1 << n) - 1)
  }
  const decode = (table: Huffman | undefined) => {
    if (!table) throw new Error('missing Huffman table')
    if (bitCount < 16) fill()
    const entry = table[(bitBuf >>> (bitCount - 16)) & 0xffff]!
    if (entry === 0) throw new Error('bad Huffman code')
    bitCount -= entry >> 8
    return entry & 0xff
  }
  const receive = (n: number) => {
    const value = bits(n)
    return n > 0 && value < 1 << (n - 1) ? value - (1 << n) + 1 : value
  }

  const per = dcOnly ? 1 : 64
  const baseline = (c: Component, block: number) => {
    const offset = block * per
    const t = decode(c.dcTable)
    c.pred += receive(t)
    c.coefficients[offset] = c.pred
    for (let k = 1; k < 64; ) {
      const rs = decode(c.acTable)
      const s = rs & 15
      const r = rs >> 4
      if (s === 0) {
        if (r < 15) break
        k += 16
        continue
      }
      k += r
      if (k > 63) break
      const value = receive(s)
      if (!dcOnly) c.coefficients[offset + ZIGZAG[k]!] = value
      k++
    }
  }
  const dcFirst = (c: Component, block: number) => {
    const t = decode(c.dcTable)
    c.pred += receive(t)
    c.coefficients[block * per] = c.pred * (1 << scan.low)
  }
  const dcRefine = (c: Component, block: number) => {
    if (bits(1)) c.coefficients[block * per]! |= 1 << scan.low
  }
  const acFirst = (c: Component, block: number) => {
    if (eobrun > 0) {
      eobrun--
      return
    }
    const offset = block * 64
    for (let k = scan.start; k <= scan.end; ) {
      const rs = decode(c.acTable)
      const s = rs & 15
      const r = rs >> 4
      if (s === 0) {
        if (r < 15) {
          eobrun = (1 << r) - 1 + bits(r)
          break
        }
        k += 16
        continue
      }
      k += r
      if (k > 63) break
      c.coefficients[offset + ZIGZAG[k]!] = receive(s) * (1 << scan.low)
      k++
    }
  }
  // libjpeg's decode_mcu_AC_refine.
  const acRefine = (c: Component, block: number) => {
    const offset = block * 64
    const p1 = 1 << scan.low
    const m1 = -1 << scan.low
    const coefficients = c.coefficients
    const correct = (z: number) => {
      if (bits(1) && (coefficients[z]! & p1) === 0) coefficients[z]! += coefficients[z]! >= 0 ? p1 : m1
    }
    let k = scan.start
    if (eobrun === 0) {
      for (; k <= scan.end; k++) {
        const rs = decode(c.acTable)
        let s = rs & 15
        let r = rs >> 4
        if (s) {
          s = bits(1) ? p1 : m1
        } else if (r !== 15) {
          eobrun = (1 << r) + bits(r)
          break
        }
        while (k <= scan.end) {
          const z = offset + ZIGZAG[k]!
          if (coefficients[z] !== 0) correct(z)
          else if (--r < 0) break
          k++
        }
        if (s && k <= scan.end) coefficients[offset + ZIGZAG[k]!] = s
      }
    }
    if (eobrun > 0) {
      for (; k <= scan.end; k++) {
        const z = offset + ZIGZAG[k]!
        if (coefficients[z] !== 0) correct(z)
      }
      eobrun--
    }
  }

  const blockDecoder = !frame.progressive
    ? baseline
    : scan.start === 0
      ? scan.high === 0
        ? dcFirst
        : dcRefine
      : scan.high === 0
        ? acFirst
        : acRefine

  const single = components.length === 1
  const only = components[0]!
  const mcusPerLine = single ? only.blocksPerLine : frame.mcusPerLine
  const total = single ? only.blocksPerLine * only.blocksPerColumn : frame.mcusPerLine * frame.mcusPerColumn
  for (const c of components) c.pred = 0

  for (let mcu = 0; mcu < total; mcu++) {
    if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
      bitCount = 0
      eobrun = 0
      for (const c of components) c.pred = 0
      while (pos + 1 < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1]! >= 0xd0 && bytes[pos + 1]! <= 0xd7)) pos++
      pos += 2
    }
    const row = Math.floor(mcu / mcusPerLine)
    const column = mcu % mcusPerLine
    if (single) {
      blockDecoder(only, row * only.stride + column)
      continue
    }
    for (const c of components) {
      for (let v = 0; v < c.v; v++) {
        for (let h = 0; h < c.h; h++) blockDecoder(c, (row * c.v + v) * c.stride + column * c.h + h)
      }
    }
  }
  return skipEntropy(bytes, pos)
}

// One plane per component, `n` x `n` samples per block.
function planes(frame: Frame, quant: Int32Array[], n: Scale): Uint8Array[] {
  const basis = COS[n]
  const block = new Float64Array(n * n)
  const rows = new Float64Array(n * n)
  return frame.components.map(c => {
    const q = quant[c.quant]
    if (!q) throw new Error('missing quantization table')
    const blockRows = frame.mcusPerColumn * c.v
    if (n === 1) {
      const plane = new Uint8Array(c.stride * blockRows)
      for (let i = 0; i < plane.length; i++) plane[i] = clamp((c.coefficients[i]! * q[0]!) / 8 + 128)
      return plane
    }
    const lineSamples = c.stride * n
    const plane = new Uint8Array(lineSamples * blockRows * n)
    for (let by = 0; by < blockRows; by++) {
      for (let bx = 0; bx < c.stride; bx++) {
        const offset = (by * c.stride + bx) * 64
        for (let v = 0; v < n; v++) {
          let empty = true
          for (let u = 0; u < n; u++) {
            block[v * n + u] = c.coefficients[offset + v * 8 + u]! * q[v * 8 + u]!
            if (u > 0 && block[v * n + u] !== 0) empty = false
          }
          for (let x = 0; x < n; x++) {
            let sum = 0
            if (empty) sum = block[v * n]! * basis[x * n]!
            else for (let u = 0; u < n; u++) sum += block[v * n + u]! * basis[x * n + u]!
            rows[v * n + x] = sum
          }
        }
        for (let y = 0; y < n; y++) {
          const out = (by * n + y) * lineSamples + bx * n
          for (let x = 0; x < n; x++) {
            let sum = 0
            for (let v = 0; v < n; v++) sum += rows[v * n + x]! * basis[y * n + v]!
            plane[out + x] = clamp(sum + 128)
          }
        }
      }
    }
    return plane
  })
}

function toRgba(frame: Frame, quant: Int32Array[], n: Scale, adobeTransform: number): Thumbnail {
  const samples = planes(frame, quant, n)
  const width = Math.ceil((frame.width * n) / 8)
  const height = Math.ceil((frame.height * n) / 8)
  const rgba = new Uint8Array(width * height * 4)
  const comps = frame.components
  const lines = comps.map(c => c.stride * n)
  const columnOf = comps.map(c => Int32Array.from({ length: width }, (_, x) => Math.floor((x * c.h) / frame.maxH)))
  const ycc = comps.length === 3 ? adobeTransform !== 0 && !(comps[0]!.id === 0x52 && comps[1]!.id === 0x47) : adobeTransform === 2
  const value = [0, 0, 0, 0]

  for (let y = 0; y < height; y++) {
    const rowStarts = comps.map((c, i) => Math.floor((y * c.v) / frame.maxV) * lines[i]!)
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < comps.length; i++) value[i] = samples[i]![rowStarts[i]! + columnOf[i]![x]!]!
      const o = (y * width + x) * 4
      if (comps.length === 1) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = value[0]!
      } else {
        let [r, g, b] = value as [number, number, number]
        if (ycc) {
          const [luma, cb, cr] = value as [number, number, number]
          r = clamp(luma + 1.402 * (cr - 128))
          g = clamp(luma - 0.344136 * (cb - 128) - 0.714136 * (cr - 128))
          b = clamp(luma + 1.772 * (cb - 128))
        }
        if (comps.length === 4) {
          // Adobe writes CMYK inverted; without its marker the inks are stored as they are.
          const k = adobeTransform >= 0 ? value[3]! : 255 - value[3]!
          const ink = (n: number) => (adobeTransform >= 0 ? n : 255 - n)
          r = Math.round((ink(r) * k) / 255)
          g = Math.round((ink(g) * k) / 255)
          b = Math.round((ink(b) * k) / 255)
        }
        rgba[o] = r
        rgba[o + 1] = g
        rgba[o + 2] = b
      }
      rgba[o + 3] = 255
    }
  }
  return { width, height, rgba }
}

// Turns the picture the way EXIF orientation says it is shown.
function orient(picture: Thumbnail, orientation: number): Thumbnail {
  if (orientation <= 1 || orientation > 8) return picture
  const { width: w, height: h, rgba } = picture
  const swap = orientation >= 5
  const width = swap ? h : w
  const height = swap ? w : h
  const out = new Uint8Array(rgba.length)
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      let sx: number
      let sy: number
      switch (orientation) {
        case 2: [sx, sy] = [w - 1 - ox, oy]; break
        case 3: [sx, sy] = [w - 1 - ox, h - 1 - oy]; break
        case 4: [sx, sy] = [ox, h - 1 - oy]; break
        case 5: [sx, sy] = [oy, ox]; break
        case 6: [sx, sy] = [oy, h - 1 - ox]; break
        case 7: [sx, sy] = [w - 1 - oy, h - 1 - ox]; break
        default: [sx, sy] = [w - 1 - oy, ox]
      }
      out.set(rgba.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (oy * width + ox) * 4)
    }
  }
  return { width, height, rgba: out }
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}
