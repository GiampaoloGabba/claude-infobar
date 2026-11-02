import { decodeGif, gifSize } from './gif'
import { decodeJpeg, jpegSize } from './jpeg'
import type { Size } from './layout'
import type { Thumbnail } from './pixels'
import { decodePng } from './png'

export type Format = 'png' | 'jpeg' | 'gif' | 'webp'

/** The extensions Claude Code saves pasted images under, by format. */
export const EXTENSIONS: Record<string, Format> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' }

export function formatOf(bytes: Uint8Array): Format | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  return null
}

/** The picture's size as shown, read from its header alone. */
export function imageSize(bytes: Uint8Array, format: Format): Size | null {
  switch (format) {
    case 'png': {
      if (bytes.length < 24) return null
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const width = view.getUint32(16)
      const height = view.getUint32(20)
      return width > 0 && height > 0 ? { width, height } : null
    }
    case 'jpeg':
      return jpegSize(bytes)
    case 'gif':
      return gifSize(bytes)
    case 'webp':
      return webpSize(bytes)
  }
}

/** Decodes to RGBA shrunk to fit `maxWidth` x `maxHeight`; throws where it can't, WebP included. */
export function decodeImage(bytes: Uint8Array, format: Format, maxWidth: number, maxHeight: number): Thumbnail {
  switch (format) {
    case 'png':
      return decodePng(bytes, maxWidth, maxHeight)
    case 'jpeg':
      return decodeJpeg(bytes, maxWidth, maxHeight)
    case 'gif':
      return decodeGif(bytes, maxWidth, maxHeight)
    case 'webp':
      throw new Error('WebP is not decoded')
  }
}

function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 30) return null
  const chunk = ascii(bytes, 12, 4)
  const u24 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)
  if (chunk === 'VP8X') return { width: u24(24) + 1, height: u24(27) + 1 }
  if (chunk === 'VP8L') {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ') return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
  return null
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}
