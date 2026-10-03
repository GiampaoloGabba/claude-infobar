import type { Thumbnail } from './png'

const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20
const DEFAULT_COLOR = 0x01000000

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

/**
 * `Raster` cells drawing the thumbnail over `columns` x `rows` cells, two pixels per cell
 * (an upper half block in the top pixel's color over the bottom pixel's), for terminals
 * without the kitty graphics protocol. Transparent pixels show the terminal's background.
 */
export function rasterCells(thumbnail: Thumbnail, columns: number, rows: number): string {
  const pixels = resample(thumbnail, columns, rows * 2)
  const words = new Uint32Array(columns * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const top = pixels[row * 2 * columns + column]!
      const bottom = pixels[(row * 2 + 1) * columns + column]!
      const i = (row * columns + column) * 3
      if (top === DEFAULT_COLOR && bottom === DEFAULT_COLOR) {
        words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], i)
      } else if (top === DEFAULT_COLOR) {
        words.set([LOWER_HALF, bottom, DEFAULT_COLOR], i)
      } else {
        words.set([UPPER_HALF, top, bottom], i)
      }
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

// Box-averages the thumbnail to `width` x `height` colors, `DEFAULT_COLOR` where mostly transparent.
function resample({ width, height, rgba }: Thumbnail, targetWidth: number, targetHeight: number): Uint32Array {
  const colors = new Uint32Array(targetWidth * targetHeight)
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * height) / targetHeight)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / targetHeight))
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * width) / targetWidth)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / targetWidth))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * width + x) * 4
          const a = rgba[p + 3]!
          r += rgba[p]! * a
          g += rgba[p + 1]! * a
          b += rgba[p + 2]! * a
          alpha += a
          count++
        }
      }
      colors[ty * targetWidth + tx] =
        alpha < count * 128
          ? DEFAULT_COLOR
          : (Math.round(r / alpha) << 16) | (Math.round(g / alpha) << 8) | Math.round(b / alpha)
    }
  }
  return colors
}
