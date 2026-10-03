// The mod's sandbox has no DecompressionStream, zlib or WebAssembly, so PNG's
// deflate stream is decoded here (RFC 1951), into a buffer sized up front.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// A lookup table indexed by the next `bits` input bits: each entry is symbol << 4 | code length, -1 where no code lands.
type Table = { entries: Int32Array; bits: number }

function buildTable(lengths: ArrayLike<number>): Table {
  let bits = 1
  const count = new Uint16Array(16)
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!
    count[len]!++
    if (len > bits) bits = len
  }
  count[0] = 0
  const next = new Uint16Array(16)
  for (let len = 1, code = 0; len < 16; len++) {
    code = (code + count[len - 1]!) << 1
    next[len] = code
  }
  const size = 1 << bits
  const entries = new Int32Array(size).fill(-1)
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const len = lengths[symbol]!
    if (len === 0) continue
    // Deflate packs Huffman codes most significant bit first into an LSB-first stream.
    let code = next[len]!++
    let reversed = 0
    for (let i = 0; i < len; i++, code >>= 1) reversed = (reversed << 1) | (code & 1)
    for (let i = reversed; i < size; i += 1 << len) entries[i] = (symbol << 4) | len
  }
  return { entries, bits }
}

const FIXED_LITERALS = buildTable(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)))
const FIXED_DISTANCES = buildTable(new Array(30).fill(5))

/** Inflates a zlib stream whose decompressed size is known exactly. */
export function inflateZlib(input: Uint8Array, outputSize: number): Uint8Array {
  if (input.length < 2 || (input[0]! & 0x0f) !== 8 || ((input[0]! << 8) | input[1]!) % 31 !== 0) {
    throw new Error('not a zlib stream')
  }
  if (input[1]! & 0x20) throw new Error('zlib preset dictionary')

  const out = new Uint8Array(outputSize)
  let outPos = 0
  let pos = 2
  let bitBuf = 0
  let bitCount = 0

  const need = (n: number) => {
    while (bitCount < n) {
      if (pos >= input.length + 4) throw new Error('truncated deflate stream')
      bitBuf |= (input[pos++] ?? 0) << bitCount
      bitCount += 8
    }
  }
  const take = (n: number) => {
    need(n)
    const value = bitBuf & ((1 << n) - 1)
    bitBuf >>>= n
    bitCount -= n
    return value
  }
  const decode = (table: Table) => {
    need(table.bits)
    const entry = table.entries[bitBuf & ((1 << table.bits) - 1)]!
    if (entry < 0) throw new Error('bad Huffman code')
    const len = entry & 15
    bitBuf >>>= len
    bitCount -= len
    return entry >> 4
  }

  let isFinal = false
  while (!isFinal) {
    isFinal = take(1) === 1
    const type = take(2)

    if (type === 0) {
      bitBuf >>>= bitCount & 7
      bitCount -= bitCount & 7
      pos -= bitCount >> 3
      bitBuf = 0
      bitCount = 0
      const len = input[pos]! | (input[pos + 1]! << 8)
      if (pos + 4 + len > input.length || outPos + len > outputSize) throw new Error('bad stored block')
      out.set(input.subarray(pos + 4, pos + 4 + len), outPos)
      pos += 4 + len
      outPos += len
      continue
    }
    if (type === 3) throw new Error('bad block type')

    let literals = FIXED_LITERALS
    let distances = FIXED_DISTANCES
    if (type === 2) {
      const literalCount = take(5) + 257
      const distanceCount = take(5) + 1
      const codeLengthCount = take(4) + 4
      const codeLengths = new Uint8Array(19)
      for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = take(3)
      const codeLengthTable = buildTable(codeLengths)
      const lengths = new Uint8Array(literalCount + distanceCount)
      for (let i = 0; i < lengths.length; ) {
        const symbol = decode(codeLengthTable)
        if (symbol < 16) {
          lengths[i++] = symbol
          continue
        }
        let repeat: number
        let value = 0
        if (symbol === 16) {
          if (i === 0) throw new Error('bad code lengths')
          value = lengths[i - 1]!
          repeat = 3 + take(2)
        } else if (symbol === 17) {
          repeat = 3 + take(3)
        } else {
          repeat = 11 + take(7)
        }
        if (i + repeat > lengths.length) throw new Error('bad code lengths')
        lengths.fill(value, i, i + repeat)
        i += repeat
      }
      literals = buildTable(lengths.subarray(0, literalCount))
      distances = buildTable(lengths.subarray(literalCount))
    }

    for (;;) {
      const symbol = decode(literals)
      if (symbol < 256) {
        if (outPos >= outputSize) throw new Error('output overflow')
        out[outPos++] = symbol
        continue
      }
      if (symbol === 256) break
      const lengthIndex = symbol - 257
      if (lengthIndex >= 29) throw new Error('bad length symbol')
      const length = LENGTH_BASE[lengthIndex]! + take(LENGTH_EXTRA[lengthIndex]!)
      const distanceIndex = decode(distances)
      if (distanceIndex >= 30) throw new Error('bad distance symbol')
      const distance = DIST_BASE[distanceIndex]! + take(DIST_EXTRA[distanceIndex]!)
      if (distance > outPos || outPos + length > outputSize) throw new Error('bad match')
      for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - distance]!
    }
  }

  if (outPos !== outputSize) throw new Error('short deflate stream')
  return out
}
