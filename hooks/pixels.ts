/** A small RGBA picture, row-major, 4 bytes per pixel. */
export type Thumbnail = { width: number; height: number; rgba: Uint8Array }

/** The size `width` x `height` takes once scaled down, never up, to fit `maxWidth` x `maxHeight`. */
export function fitSize(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Box-averages a decoded picture down to fit `maxWidth` x `maxHeight`, keeping its aspect ratio. */
export function shrink(picture: Thumbnail, maxWidth: number, maxHeight: number): Thumbnail {
  const { width, height, rgba } = picture
  const target = fitSize(width, height, maxWidth, maxHeight)
  if (target.width === width && target.height === height) return picture
  const out = new Uint8Array(target.width * target.height * 4)
  for (let ty = 0; ty < target.height; ty++) {
    const y0 = Math.floor((ty * height) / target.height)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / target.height))
    for (let tx = 0; tx < target.width; tx++) {
      const x0 = Math.floor((tx * width) / target.width)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / target.width))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      for (let y = y0; y < y1; y++) {
        for (let p = (y * width + x0) * 4, end = (y * width + x1) * 4; p < end; p += 4) {
          // Premultiplied, so a transparent pixel's color doesn't bleed into its neighbours.
          const a = rgba[p + 3]!
          r += rgba[p]! * a
          g += rgba[p + 1]! * a
          b += rgba[p + 2]! * a
          alpha += a
        }
      }
      if (alpha === 0) continue
      const o = (ty * target.width + tx) * 4
      out[o] = Math.round(r / alpha)
      out[o + 1] = Math.round(g / alpha)
      out[o + 2] = Math.round(b / alpha)
      out[o + 3] = Math.round(alpha / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { ...target, rgba: out }
}
