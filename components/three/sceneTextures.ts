import * as THREE from 'three'
import { getSuitInk, type SuitColorMode } from '@/lib/suitColors'

/**
 * Canvas-painted textures for the stylized desktop room. Everything is drawn at
 * runtime so the scene ships no image assets, and every texture is cached so
 * repeated cards/chips share one GPU upload.
 */

export type CardSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

export const CARD_ASPECT = 88 / 63
const CARD_TEXTURE_WIDTH = 512
const CARD_TEXTURE_HEIGHT = Math.round(CARD_TEXTURE_WIDTH * CARD_ASPECT)

export type { SuitColorMode } from '@/lib/suitColors'

const textureCache = new Map<string, THREE.CanvasTexture>()
const redrawers = new Map<string, () => void>()
let fontsHooked = false

function getDisplayFontFamily() {
  if (typeof document === 'undefined') return 'Arial Black, sans-serif'
  const variable = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-unbounded')
    .trim()
  return variable ? `${variable}, 'Arial Black', sans-serif` : "'Arial Black', sans-serif"
}

function hookFontsReady() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return
  fontsHooked = true
  void document.fonts.ready.then(() => {
    for (const [key, redraw] of redrawers) {
      redraw()
      const texture = textureCache.get(key)
      if (texture) texture.needsUpdate = true
    }
  })
}

function cachedCanvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  options: { repeat?: boolean; colorSpace?: THREE.ColorSpace } = {}
) {
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable for scene textures.')

  const redraw = () => {
    context.clearRect(0, 0, width, height)
    draw(context, width, height)
  }
  redraw()
  redrawers.set(key, redraw)
  hookFontsReady()

  const texture = new THREE.CanvasTexture(canvas)
  texture.name = key
  // Cached for every table and seat: per-object disposal (disposeObject) must leave it alone.
  texture.userData.shared = true
  texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
  // Static transform: skip the per-material, per-frame uv matrix rebuild.
  // Callers that set repeat/offset afterwards must call texture.updateMatrix().
  texture.matrixAutoUpdate = false
  texture.updateMatrix()
  textureCache.set(key, texture)
  return texture
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

/** Draws a suit pip centred on (x, y) with the given height. */
export function drawSuit(
  context: CanvasRenderingContext2D,
  suit: CardSuit,
  x: number,
  y: number,
  size: number,
  color = getSuitInk(suit)
) {
  const s = size / 2
  context.save()
  context.translate(x, y)
  context.fillStyle = color
  context.beginPath()
  switch (suit) {
    case 'hearts':
      context.moveTo(0, s * 0.95)
      context.bezierCurveTo(-s * 0.25, s * 0.62, -s * 1.02, s * 0.2, -s * 0.98, -s * 0.36)
      context.bezierCurveTo(-s * 0.94, -s * 0.96, -s * 0.18, -s * 1.02, 0, -s * 0.46)
      context.bezierCurveTo(s * 0.18, -s * 1.02, s * 0.94, -s * 0.96, s * 0.98, -s * 0.36)
      context.bezierCurveTo(s * 1.02, s * 0.2, s * 0.25, s * 0.62, 0, s * 0.95)
      break
    case 'diamonds':
      context.moveTo(0, -s)
      context.quadraticCurveTo(s * 0.34, -s * 0.34, s * 0.78, 0)
      context.quadraticCurveTo(s * 0.34, s * 0.34, 0, s)
      context.quadraticCurveTo(-s * 0.34, s * 0.34, -s * 0.78, 0)
      context.quadraticCurveTo(-s * 0.34, -s * 0.34, 0, -s)
      break
    case 'spades':
      context.moveTo(0, -s)
      context.bezierCurveTo(s * 0.3, -s * 0.52, s * 1.02, -s * 0.2, s * 0.96, s * 0.3)
      context.bezierCurveTo(s * 0.9, s * 0.74, s * 0.36, s * 0.8, s * 0.08, s * 0.46)
      context.quadraticCurveTo(s * 0.14, s * 0.84, s * 0.4, s * 1)
      context.lineTo(-s * 0.4, s * 1)
      context.quadraticCurveTo(-s * 0.14, s * 0.84, -s * 0.08, s * 0.46)
      context.bezierCurveTo(-s * 0.36, s * 0.8, -s * 0.9, s * 0.74, -s * 0.96, s * 0.3)
      context.bezierCurveTo(-s * 1.02, -s * 0.2, -s * 0.3, -s * 0.52, 0, -s)
      break
    case 'clubs': {
      const r = s * 0.42
      context.arc(0, -s * 0.5, r, 0, Math.PI * 2)
      context.moveTo(-s * 0.46 + r, s * 0.08)
      context.arc(-s * 0.46, s * 0.08, r, 0, Math.PI * 2)
      context.moveTo(s * 0.46 + r, s * 0.08)
      context.arc(s * 0.46, s * 0.08, r, 0, Math.PI * 2)
      // Fill the joint where the three lobes meet (they leave a small hole there).
      context.moveTo(s * 0.3, -s * 0.02)
      context.arc(0, -s * 0.02, s * 0.3, 0, Math.PI * 2)
      context.fill()
      context.beginPath()
      context.moveTo(-s * 0.12, -s * 0.05)
      context.quadraticCurveTo(-s * 0.06, s * 0.72, -s * 0.42, s * 1)
      context.lineTo(s * 0.42, s * 1)
      context.quadraticCurveTo(s * 0.06, s * 0.72, s * 0.1, s * 0.05)
      break
    }
  }
  context.closePath()
  context.fill()
  context.restore()
}

function paintCardBase(context: CanvasRenderingContext2D, width: number, height: number) {
  const radius = width * 0.09
  // Stock-coloured ground under the printed face: the mesh edge and its rounded
  // corners run a hair past the artwork, and transparent (black) texels there
  // read as a dark outline around every card.
  context.fillStyle = '#ebe2cb'
  context.fillRect(0, 0, width, height)
  roundedRectPath(context, 1, 1, width - 2, height - 2, radius)
  const face = context.createLinearGradient(0, 0, width, height)
  face.addColorStop(0, '#fffdf6')
  face.addColorStop(1, '#f3e9d2')
  context.fillStyle = face
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = 'rgba(80, 60, 30, 0.22)'
  context.stroke()
  // Paper: fine fibre flecks and a faint worn edge, so a card is stock, not a flat sticker.
  context.save()
  roundedRectPath(context, 1, 1, width - 2, height - 2, radius)
  context.clip()
  const random = seededRandom(0x9a9e12)
  for (let fleck = 0; fleck < 1400; fleck += 1) {
    const light = random() > 0.55
    context.fillStyle = light ? 'rgba(255, 255, 255, 0.35)' : 'rgba(120, 95, 50, 0.07)'
    const length = 2 + random() * 5
    context.save()
    context.translate(random() * width, random() * height)
    context.rotate(random() * Math.PI)
    context.fillRect(0, 0, length, 0.9)
    context.restore()
  }
  const wear = context.createLinearGradient(0, 0, 0, height)
  wear.addColorStop(0, 'rgba(120, 95, 50, 0.1)')
  wear.addColorStop(0.06, 'rgba(120, 95, 50, 0)')
  wear.addColorStop(0.94, 'rgba(120, 95, 50, 0)')
  wear.addColorStop(1, 'rgba(120, 95, 50, 0.12)')
  context.fillStyle = wear
  context.fillRect(0, 0, width, height)
  context.restore()
}

/**
 * A rounded, high-contrast card face: jumbo rank plus a suit pip in the top
 * corner, a big centre pip and a smaller mirrored index. Textures are cached per
 * suit-color mode so toggling four-color suits just swaps maps.
 */
export function getCardFaceTexture(rank: string, suit: CardSuit, mode: SuitColorMode = 'two') {
  return cachedCanvasTexture(`card-face-${mode}-${rank}-${suit}`, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT, (context, width, height) => {
    paintCardBase(context, width, height)
    const color = getSuitInk(suit, mode)
    const label = rank === 'T' ? '10' : rank
    const font = getDisplayFontFamily()

    context.fillStyle = color
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    const wide = label.length > 1
    const indexSize = wide ? width * 0.28 : width * 0.34
    // One index column (rank over a small pip), repeated rotated 180deg in the
    // opposite corner, with a single centred pip between them: the classic
    // balanced layout, so nothing crowds the corners or drifts off-centre.
    const drawIndex = () => {
      context.font = `800 ${indexSize}px ${font}`
      context.fillText(label, width * 0.19, height * 0.2)
      drawSuit(context, suit, width * 0.19, height * 0.285, width * 0.17, color)
    }
    drawIndex()
    drawSuit(context, suit, width * 0.5, height * 0.5, width * 0.42, color)

    context.save()
    context.translate(width, height)
    context.rotate(Math.PI)
    drawIndex()
    context.restore()
  })
}

/** Stylized ruby card back with a cream frame, lattice and brass medallion. */
export function getCardBackTexture() {
  return cachedCanvasTexture('card-back', CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT, (context, width, height) => {
    const radius = width * 0.09
    context.fillStyle = '#efe4cb'
    context.fillRect(0, 0, width, height)
    roundedRectPath(context, 1, 1, width - 2, height - 2, radius)
    context.fillStyle = '#fff4de'
    context.fill()

    const inset = width * 0.07
    roundedRectPath(context, inset, inset, width - inset * 2, height - inset * 2, radius * 0.6)
    const body = context.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#c9303f')
    body.addColorStop(1, '#8e1a2b')
    context.fillStyle = body
    context.fill()

    context.save()
    context.clip()
    context.strokeStyle = 'rgba(255, 214, 150, 0.22)'
    context.lineWidth = 3
    const step = width * 0.11
    for (let offset = -height; offset < width + height; offset += step) {
      context.beginPath()
      context.moveTo(offset, 0)
      context.lineTo(offset + height, height)
      context.moveTo(offset, height)
      context.lineTo(offset + height, 0)
      context.stroke()
    }
    context.restore()

    context.lineWidth = 4
    context.strokeStyle = 'rgba(255, 226, 170, 0.75)'
    roundedRectPath(context, inset * 1.6, inset * 1.6, width - inset * 3.2, height - inset * 3.2, radius * 0.45)
    context.stroke()

    const cx = width / 2
    const cy = height / 2
    const medallion = context.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, width * 0.24)
    medallion.addColorStop(0, '#ffe7ad')
    medallion.addColorStop(0.7, '#d9a441')
    medallion.addColorStop(1, '#9c6f22')
    context.fillStyle = medallion
    context.beginPath()
    context.arc(cx, cy, width * 0.2, 0, Math.PI * 2)
    context.fill()
    context.lineWidth = 3
    context.strokeStyle = '#6d4a13'
    context.stroke()
    drawSuit(context, 'spades', cx, cy + 2, width * 0.2, '#5a1320')
  })
}

export const CHIP_DENOMINATIONS = [
  { body: '#e2505c', spot: '#fff4de', rim: '#8e1a2b' },
  { body: '#3f7fe0', spot: '#fff4de', rim: '#1d3f7a' },
  { body: '#1faa76', spot: '#fff4de', rim: '#0b5e47' },
  { body: '#23272e', spot: '#f2c766', rim: '#0a0c10' },
  { body: '#8e6cf0', spot: '#fff4de', rim: '#4a33a0' },
] as const

/** Chip side band: body colour with the classic rectangular edge spots. */
export function getChipEdgeTexture(index: number) {
  const style = CHIP_DENOMINATIONS[index % CHIP_DENOMINATIONS.length]!
  return cachedCanvasTexture(`chip-edge-${index}`, 256, 32, (context, width, height) => {
    context.fillStyle = style.body
    context.fillRect(0, 0, width, height)
    // Six slim inlay stripes with a hairline seam top and bottom: reads as a
    // moulded chip edge, and stays a stripe (not a checkerboard) in a stack.
    context.fillStyle = style.spot
    const spots = 6
    for (let spot = 0; spot < spots; spot += 1) {
      const pitch = width / spots
      context.fillRect(spot * pitch + pitch * 0.32, 4, pitch * 0.36, height - 8)
    }
    context.fillStyle = style.rim
    context.fillRect(0, 0, width, 4)
    context.fillRect(0, height - 4, width, 4)
    context.fillStyle = 'rgba(0,0,0,0.18)'
    context.fillRect(0, 0, width, 3)
    context.fillRect(0, height - 3, width, 3)
  })
}

/** Chip face: rim spots, inner ring and a centred inlay disc. */
export function getChipFaceTexture(index: number) {
  const style = CHIP_DENOMINATIONS[index % CHIP_DENOMINATIONS.length]!
  return cachedCanvasTexture(`chip-face-${index}`, 256, 256, (context, width) => {
    const c = width / 2
    context.fillStyle = style.body
    context.beginPath()
    context.arc(c, c, c, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = style.spot
    for (let spot = 0; spot < 8; spot += 1) {
      const angle = (spot / 8) * Math.PI * 2
      context.save()
      context.translate(c + Math.cos(angle) * c * 0.84, c + Math.sin(angle) * c * 0.84)
      context.rotate(angle)
      context.fillRect(-c * 0.1, -c * 0.16, c * 0.2, c * 0.32)
      context.restore()
    }

    context.strokeStyle = style.spot
    context.lineWidth = c * 0.05
    context.setLineDash([c * 0.12, c * 0.08])
    context.beginPath()
    context.arc(c, c, c * 0.58, 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])

    // Ivory inlay (never paper white): it sits under the key spot on every
    // chip on the table and was the brightest thing in the frame.
    const inlay = context.createRadialGradient(c - c * 0.09, c - c * 0.09, 2, c, c, c * 0.5)
    inlay.addColorStop(0, '#eee3c6')
    inlay.addColorStop(1, '#d8c9a4')
    context.fillStyle = inlay
    context.beginPath()
    context.arc(c, c, c * 0.44, 0, Math.PI * 2)
    context.fill()
    // Moulded ring around the inlay and a fine outer rim line.
    context.lineWidth = c * 0.03
    context.strokeStyle = style.rim
    context.beginPath()
    context.arc(c, c, c * 0.455, 0, Math.PI * 2)
    context.stroke()
    context.lineWidth = c * 0.025
    context.strokeStyle = 'rgba(0, 0, 0, 0.28)'
    context.beginPath()
    context.arc(c, c, c * 0.985, 0, Math.PI * 2)
    context.stroke()
    // Inner spade mark on the inlay and a ring of tiny pips.
    drawSuit(context, 'spades', c, c + c * 0.02, c * 0.3, style.rim)
    context.fillStyle = style.rim
    for (let pip = 0; pip < 24; pip += 1) {
      const angle = (pip / 24) * Math.PI * 2
      context.beginPath()
      context.arc(c + Math.cos(angle) * c * 0.36, c + Math.sin(angle) * c * 0.36, c * 0.014, 0, Math.PI * 2)
      context.fill()
    }
    // Fine mould grain so the plastic is not perfectly flat colour.
    const random = seededRandom(0xc41b + index)
    for (let speck = 0; speck < 900; speck += 1) {
      context.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)'
      context.fillRect(random() * width, random() * width, 1.5, 1.5)
    }
  })
}

export interface FeltLayout {
  /** Felt ellipse semi-axes in world units. */
  semiX: number
  semiZ: number
  /** Betting line ellipse semi-axes. */
  lineX: number
  lineZ: number
  /** Board card guide centres (world X) and size. */
  boardXs: readonly number[]
  boardZ: number
  cardWidth: number
  cardDepth: number
}

/**
 * The printed felt: radial light pool, woven fibre noise, gold betting line,
 * card guides, a crest and table name. UVs map the felt ellipse bounding box.
 */
export function getFeltTexture(layout: FeltLayout) {
  const width = 2048
  const height = Math.round(width * (layout.semiZ / layout.semiX))
  return cachedCanvasTexture('felt-print', width, height, (context) => {
    const toX = (worldX: number) => ((worldX + layout.semiX) / (layout.semiX * 2)) * width
    const toY = (worldZ: number) => ((worldZ + layout.semiZ) / (layout.semiZ * 2)) * height
    const scaleX = width / (layout.semiX * 2)
    const scaleY = height / (layout.semiZ * 2)

    const pool = context.createRadialGradient(width / 2, height * 0.46, height * 0.08, width / 2, height / 2, width * 0.56)
    pool.addColorStop(0, '#1caf80')
    pool.addColorStop(0.55, '#128c66')
    pool.addColorStop(1, '#0a5541')
    context.fillStyle = pool
    context.fillRect(0, 0, width, height)

    let seed = 0x5eed
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    context.globalAlpha = 0.07
    for (let fibre = 0; fibre < 26000; fibre += 1) {
      const x = random() * width
      const y = random() * height
      context.fillStyle = random() > 0.5 ? '#ffffff' : '#00140e'
      context.fillRect(x, y, 1 + random() * 3, 1)
    }
    context.globalAlpha = 1

    // Low-frequency cloth mottling and a few worn patches where hands rest.
    for (let blotch = 0; blotch < 70; blotch += 1) {
      const bx = random() * width
      const by = random() * height
      const br = width * (0.03 + random() * 0.06)
      const blot = context.createRadialGradient(bx, by, 0, bx, by, br)
      const light = random() > 0.5
      blot.addColorStop(0, light ? 'rgba(120, 255, 200, 0.045)' : 'rgba(0, 20, 12, 0.06)')
      blot.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.fillStyle = blot
      context.fillRect(bx - br, by - br, br * 2, br * 2)
    }

    // Printed pinstripe just inside the rail, like a casino layout's border.
    context.save()
    context.strokeStyle = 'rgba(255, 223, 150, 0.28)'
    context.lineWidth = 3
    context.beginPath()
    context.ellipse(width / 2, height / 2, width / 2 - 34, height / 2 - 34, 0, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = 'rgba(0, 30, 20, 0.35)'
    context.lineWidth = 10
    context.beginPath()
    context.ellipse(width / 2, height / 2, width / 2 - 48, height / 2 - 48, 0, 0, Math.PI * 2)
    context.stroke()
    context.restore()

    context.save()
    context.strokeStyle = 'rgba(255, 223, 150, 0.55)'
    context.lineWidth = 7
    context.beginPath()
    context.ellipse(width / 2, height / 2, layout.lineX * scaleX, layout.lineZ * scaleY, 0, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = 'rgba(255, 223, 150, 0.2)'
    context.lineWidth = 3
    context.beginPath()
    context.ellipse(width / 2, height / 2, layout.lineX * scaleX + 22, layout.lineZ * scaleY + 22, 0, 0, Math.PI * 2)
    context.stroke()
    context.restore()

    // Board slot outlines live in 3D (cardMeshes' slotOutlines) so they never
    // double up with a printed guide; the felt only carries a soft dish under them.
    const cardW = layout.cardWidth * scaleX
    const cardH = layout.cardDepth * scaleY
    for (const worldX of layout.boardXs) {
      roundedRectPath(context, toX(worldX) - cardW / 2, toY(layout.boardZ) - cardH / 2, cardW, cardH, cardW * 0.1)
      context.fillStyle = 'rgba(0, 24, 16, 0.12)'
      context.fill()
    }

    const font = getDisplayFontFamily()
    const crestY = toY(layout.boardZ) + cardH / 2 + height * 0.14
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    // Printed house crest: a gold medallion ring with a spade and the game name
    // on a gentle arc beneath. Faint, so chips and cards stay the brightest
    // things on the felt.
    const crestRadius = height * 0.05
    const crestCenterY = crestY - height * 0.035
    context.strokeStyle = 'rgba(255, 226, 160, 0.24)'
    context.lineWidth = 5
    context.beginPath()
    context.arc(width / 2, crestCenterY, crestRadius, 0, Math.PI * 2)
    context.stroke()
    context.lineWidth = 2
    context.beginPath()
    context.arc(width / 2, crestCenterY, crestRadius * 0.8, 0, Math.PI * 2)
    context.stroke()
    drawSuit(context, 'spades', width / 2, crestCenterY + 2, crestRadius * 0.95, 'rgba(255, 226, 160, 0.24)')
    for (const side of [-1, 1]) {
      context.strokeStyle = 'rgba(255, 226, 160, 0.2)'
      context.lineWidth = 3
      context.beginPath()
      context.moveTo(width / 2 + side * crestRadius * 1.35, crestCenterY)
      context.lineTo(width / 2 + side * crestRadius * 4.2, crestCenterY)
      context.stroke()
      drawSuit(context, side < 0 ? 'hearts' : 'diamonds', width / 2 + side * crestRadius * 4.6, crestCenterY, crestRadius * 0.42, 'rgba(255, 226, 160, 0.2)')
    }
    // The room already says POKER NIGHT (neon + HUD); the felt just names the
    // game. Embroidered look: a dark drop under a warm gold fill, wide tracking
    // and a straight baseline so it reads from the seat.
    const label = 'NO LIMIT HOLD’EM'
    const fontSize = height * 0.03
    context.font = `700 ${fontSize}px ${font}`
    const tracking = fontSize * 0.3
    const letters = [...label]
    const widths = letters.map(letter => context.measureText(letter).width + tracking)
    const total = widths.reduce((sum, value) => sum + value, 0) - tracking
    const baseY = crestCenterY + crestRadius * 1.9
    let cursor = -total / 2
    letters.forEach((letter, index) => {
      const advance = widths[index]!
      const mid = cursor + (advance - tracking) / 2
      cursor += advance
      context.save()
      context.translate(width / 2 + mid, baseY)
      // Embroidered, not extruded: a faint, tight shade under a softer gold fill.
      context.fillStyle = 'rgba(0, 28, 18, 0.22)'
      context.fillText(letter, 0.7, 1.2)
      context.fillStyle = 'rgba(255, 228, 165, 0.5)'
      context.fillText(letter, 0, 0)
      context.restore()
    })

    const crestTopY = toY(layout.boardZ) - cardH / 2 - height * 0.12
    for (const [index, suit] of (['spades', 'hearts', 'clubs', 'diamonds'] as const).entries()) {
      drawSuit(
        context,
        suit,
        width / 2 + (index - 1.5) * height * 0.06,
        crestTopY,
        height * 0.036,
        'rgba(255, 236, 190, 0.18)'
      )
    }

    const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, width * 0.52)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0, 20, 14, 0.5)')
    context.fillStyle = vignette
    context.fillRect(0, 0, width, height)
  })
}

/** Small tileable leather grain used as a bump map on the rail. */
export function getLeatherBumpTexture() {
  return cachedCanvasTexture('leather-bump', 256, 256, (context, width, height) => {
    context.fillStyle = '#808080'
    context.fillRect(0, 0, width, height)
    let seed = 0x1ea7
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let blob = 0; blob < 900; blob += 1) {
      const shade = Math.round(96 + random() * 80)
      context.fillStyle = `rgb(${shade},${shade},${shade})`
      context.beginPath()
      context.arc(random() * width, random() * height, 1 + random() * 3.2, 0, Math.PI * 2)
      context.fill()
    }
  }, { repeat: true, colorSpace: THREE.NoColorSpace })
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Fine tileable cloth weave, used as a bump map on the felt at a high repeat. */
export function getFeltWeaveTexture() {
  return cachedCanvasTexture('felt-weave', 64, 64, (context, width, height) => {
    context.fillStyle = '#808080'
    context.fillRect(0, 0, width, height)
    // Over-under twill: alternating short horizontal and vertical threads.
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const over = ((x + y) / 4) % 2 === 0
        context.fillStyle = over ? '#9c9c9c' : '#6a6a6a'
        context.fillRect(x, y, over ? 4 : 2, over ? 2 : 4)
      }
    }
    const random = seededRandom(0xfe17)
    context.globalAlpha = 0.35
    for (let speck = 0; speck < 260; speck += 1) {
      context.fillStyle = random() > 0.5 ? '#b0b0b0' : '#505050'
      context.fillRect(random() * width, random() * height, 1, 1)
    }
    context.globalAlpha = 1
  }, { repeat: true, colorSpace: THREE.NoColorSpace })
}

/**
 * Padded leather rail wrap. U runs around the table (one tile per 1.6 world
 * units), V runs across the cushion from the felt lip (0) to the underside (1).
 * Painted: oxblood leather grain, a seam between padded panels, and two rows
 * of cream saddle stitching.
 */
export function getRailLeatherTexture() {
  return cachedCanvasTexture('rail-leather', 512, 256, (context, width, height) => {
    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#2c1210')
    base.addColorStop(0.18, '#4a1d1a')
    base.addColorStop(0.5, '#5a2420')
    base.addColorStop(0.82, '#431a17')
    base.addColorStop(1, '#1e0c0a')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)

    const random = seededRandom(0x1ea7)
    for (let blob = 0; blob < 1600; blob += 1) {
      const light = random() > 0.5
      context.fillStyle = light ? 'rgba(255, 210, 190, 0.05)' : 'rgba(0, 0, 0, 0.1)'
      context.beginPath()
      context.arc(random() * width, random() * height, 0.8 + random() * 2.4, 0, Math.PI * 2)
      context.fill()
    }

    // Panel seam: a soft pinched crease where two padded panels meet.
    // Narrow, crisp crease with a lit lip on the pad side: reads as a sewn
    // panel join rather than a dark smudge.
    const seam = context.createLinearGradient(0, 0, 5, 0)
    seam.addColorStop(0, 'rgba(0,0,0,0.42)')
    seam.addColorStop(0.5, 'rgba(0,0,0,0.16)')
    seam.addColorStop(0.8, 'rgba(255,200,170,0.08)')
    seam.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = seam
    context.fillRect(0, 0, 5, height)
    const seamEnd = context.createLinearGradient(width - 5, 0, width, 0)
    seamEnd.addColorStop(0, 'rgba(0,0,0,0)')
    seamEnd.addColorStop(0.2, 'rgba(255,200,170,0.08)')
    seamEnd.addColorStop(0.5, 'rgba(0,0,0,0.16)')
    seamEnd.addColorStop(1, 'rgba(0,0,0,0.42)')
    context.fillStyle = seamEnd
    context.fillRect(width - 5, 0, 5, height)

    for (const v of [0.2, 0.74]) {
      const y = v * height
      // Fine, tonal saddle stitching: a shallow groove with short thread dashes
      // that read as texture up close and not as a dashed guide line from afar.
      context.fillStyle = 'rgba(0, 0, 0, 0.3)'
      context.fillRect(0, y - 2.5, width, 1.5)
      context.fillStyle = 'rgba(214, 186, 140, 0.6)'
      for (let x = 2; x < width; x += 8) context.fillRect(x, y - 0.8, 4.5, 1.8)
    }
  }, { repeat: true })
}

/** Walnut veneer for the table apron: horizontal grain with lacquer banding. */
export function getWalnutTexture() {
  return cachedCanvasTexture('walnut-apron', 512, 256, (context, width, height) => {
    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#6b3d22')
    base.addColorStop(0.5, '#56301b')
    base.addColorStop(1, '#3c2114')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0x3a1ee7)
    for (let line = 0; line < 140; line += 1) {
      const y = random() * height
      const amplitude = 0.5 + random() * 1.5
      const phase = random() * Math.PI * 2
      context.strokeStyle = random() > 0.5 ? 'rgba(30, 14, 6, 0.28)' : 'rgba(150, 90, 50, 0.16)'
      context.lineWidth = 0.6 + random() * 1.6
      context.beginPath()
      for (let x = 0; x <= width; x += 16) {
        const offset = Math.sin((x / width) * Math.PI * 4 + phase) * amplitude
        if (x === 0) context.moveTo(x, y + offset)
        else context.lineTo(x, y + offset)
      }
      context.stroke()
    }
    // Brass-coloured inlay lines near the top lip and the kick band.
    for (const [v, color] of [[0.16, 'rgba(226, 186, 102, 0.7)'], [0.9, 'rgba(226, 186, 102, 0.55)']] as const) {
      context.fillStyle = color
      context.fillRect(0, v * height, width, 3)
    }
  }, { repeat: true })
}

/**
 * Button-tufted (chesterfield) upholstery tile: diamond creases with a button
 * at every crossing. Neutral grey so the per-chair colour tints it.
 */
export function getTuftedLeatherTexture(bump = false) {
  return cachedCanvasTexture(bump ? 'tufted-bump' : 'tufted-color', 128, 128, (context, width, height) => {
    // Pillow shading inside each diamond: bright centre, darker toward creases.
    context.fillStyle = bump ? '#707070' : '#b8b8b8'
    context.fillRect(0, 0, width, height)
    const centres: Array<[number, number]> = [[width / 2, height / 2], [0, 0], [width, 0], [0, height], [width, height]]
    const buttons: Array<[number, number]> = [[width / 2, 0], [0, height / 2], [width, height / 2], [width / 2, height]]
    for (const [x, y] of centres) {
      const pillow = context.createRadialGradient(x, y, 2, x, y, width * 0.52)
      pillow.addColorStop(0, bump ? '#e8e8e8' : '#ffffff')
      pillow.addColorStop(0.7, bump ? '#8a8a8a' : '#d6d6d6')
      pillow.addColorStop(1, bump ? '#404040' : '#9a9a9a')
      context.fillStyle = pillow
      context.beginPath()
      context.moveTo(x, y - height / 2)
      context.lineTo(x + width / 2, y)
      context.lineTo(x, y + height / 2)
      context.lineTo(x - width / 2, y)
      context.closePath()
      context.fill()
    }
    context.strokeStyle = bump ? '#2a2a2a' : 'rgba(40, 40, 40, 0.55)'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(width / 2, 0)
    context.lineTo(width, height / 2)
    context.lineTo(width / 2, height)
    context.lineTo(0, height / 2)
    context.closePath()
    context.stroke()
    for (const [x, y] of buttons) {
      const button = context.createRadialGradient(x - 1, y - 1, 0.5, x, y, 6)
      button.addColorStop(0, bump ? '#303030' : '#8a8a8a')
      button.addColorStop(0.6, bump ? '#101010' : '#3c3c3c')
      button.addColorStop(1, bump ? '#505050' : 'rgba(60,60,60,0)')
      context.fillStyle = button
      context.beginPath()
      context.arc(x, y, 6, 0, Math.PI * 2)
      context.fill()
    }
  }, { repeat: true, colorSpace: bump ? THREE.NoColorSpace : THREE.SRGBColorSpace })
}

/**
 * Beer body, painted top (v=1) to bottom (v=0): pale gold under the head, deep
 * amber toward the base, with streams of tiny rising bubbles. Also used as a
 * faint emissive map so the pint glows a little like it is lit from behind.
 */
export function getBeerLiquidTexture() {
  return cachedCanvasTexture('drink-beer-liquid', 512, 256, (context, width, height) => {
    const body = context.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#fbd062')
    body.addColorStop(0.18, '#f6b532')
    body.addColorStop(0.6, '#e8901a')
    body.addColorStop(1, '#a95a0a')
    context.fillStyle = body
    context.fillRect(0, 0, width, height)
    // Warm back-lit column: brighter across the middle of the visible face.
    const across = context.createLinearGradient(0, 0, width, 0)
    across.addColorStop(0, 'rgba(120, 50, 0, 0.3)')
    across.addColorStop(0.25, 'rgba(255, 220, 130, 0.1)')
    across.addColorStop(0.5, 'rgba(120, 50, 0, 0.18)')
    across.addColorStop(0.75, 'rgba(255, 220, 130, 0.1)')
    across.addColorStop(1, 'rgba(120, 50, 0, 0.3)')
    context.fillStyle = across
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0xbee12)
    // The wrap is ~1.6x wider per pixel than tall: squash bubbles to stay round.
    const bubble = (x: number, y: number, radius: number) => {
      context.beginPath()
      context.ellipse(x, y, radius / 1.6, radius, 0, 0, Math.PI * 2)
      context.fill()
    }
    // Carbonation: thin rising threads of pinpoint bubbles.
    for (let stream = 0; stream < 34; stream += 1) {
      const x = random() * width
      const drift = (random() - 0.5) * 10
      const size = 0.8 + random() * 0.9
      const rise = 0.45 + random() * 0.55
      for (let index = 0; index < 22; index += 1) {
        const t = index / 22
        context.fillStyle = `rgba(255, 244, 205, ${0.3 + t * 0.5})`
        bubble(x + drift * t + (random() - 0.5) * 1.6, height - 6 - t * height * rise, size * (0.7 + t * 0.9))
      }
    }
    // A haze of micro bubbles and a dark heel at the glass bottom.
    for (let index = 0; index < 700; index += 1) {
      context.fillStyle = `rgba(255, 236, 180, ${0.05 + random() * 0.14})`
      bubble(random() * width, height * (0.5 + random() * 0.5), 0.6 + random() * 1)
    }
    const heel = context.createLinearGradient(0, height * 0.88, 0, height)
    heel.addColorStop(0, 'rgba(60, 20, 0, 0)')
    heel.addColorStop(1, 'rgba(60, 20, 0, 0.45)')
    context.fillStyle = heel
    context.fillRect(0, height * 0.88, width, height * 0.12)
  })
}

/** Beer head: cream foam made of visible bubble cells, a touch of amber at the base. */
export function getBeerFoamTexture() {
  return cachedCanvasTexture('drink-beer-foam', 512, 128, (context, width, height) => {
    const body = context.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#f6ead0')
    body.addColorStop(0.7, '#eddcb6')
    body.addColorStop(1, '#e4c98c')
    context.fillStyle = body
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0xf0a4)
    for (let cell = 0; cell < 900; cell += 1) {
      const x = random() * width
      const y = random() * height
      const radius = 1.4 + random() * 4
      context.fillStyle = `rgba(255, 253, 244, ${0.25 + random() * 0.4})`
      context.beginPath()
      context.ellipse(x, y, radius, radius * 0.9, 0, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = `rgba(190, 150, 84, ${0.08 + random() * 0.14})`
      context.lineWidth = 0.8
      context.stroke()
    }
  })
}

/**
 * Glass surface: condensation beads and a few run marks. RGB is the bead
 * highlight, alpha modulates the glass opacity (beads and runs read denser).
 */
export function getGlassDropletTexture() {
  return cachedCanvasTexture('drink-glass-droplets', 512, 256, (context, width, height) => {
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255, 255, 255, 0.5)'
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0xd20e)
    // Vertical sheen bands so the wall reads as curved glass.
    for (const [u, w, a] of [[0.14, 0.03, 0.5], [0.3, 0.012, 0.35], [0.66, 0.02, 0.22], [0.82, 0.025, 0.3]] as const) {
      const band = context.createLinearGradient((u - w) * width, 0, (u + w) * width, 0)
      band.addColorStop(0, 'rgba(255,255,255,0)')
      band.addColorStop(0.5, `rgba(255,255,255,${a})`)
      band.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = band
      context.fillRect((u - w) * width, 0, w * 2 * width, height)
    }
    for (let bead = 0; bead < 420; bead += 1) {
      const x = random() * width
      const y = random() * height
      const radius = 0.9 + random() * 2.2
      context.fillStyle = 'rgba(255, 255, 255, 0.95)'
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(190, 215, 228, 0.6)'
      context.beginPath()
      context.arc(x + radius * 0.25, y + radius * 0.3, radius * 0.55, 0, Math.PI * 2)
      context.fill()
    }
    for (let run = 0; run < 16; run += 1) {
      const x = random() * width
      const y = random() * height * 0.7
      const length = 24 + random() * 80
      context.strokeStyle = 'rgba(255, 255, 255, 0.7)'
      context.lineWidth = 1.3
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(x + (random() - 0.5) * 3, y + length)
      context.stroke()
      context.fillStyle = 'rgba(255, 255, 255, 0.95)'
      context.beginPath()
      context.arc(x, y + length, 2.1, 0, Math.PI * 2)
      context.fill()
    }
  })
}

/** Water body: faint cool gradient, deeper toward the base, with a few micro bubbles. */
export function getWaterLiquidTexture() {
  return cachedCanvasTexture('drink-water-liquid', 64, 128, (context, width, height) => {
    const body = context.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#b9e6f6')
    body.addColorStop(0.5, '#86cde6')
    body.addColorStop(1, '#4a9fc4')
    context.fillStyle = body
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0x3a7e)
    for (let bubble = 0; bubble < 60; bubble += 1) {
      context.fillStyle = `rgba(255, 255, 255, ${0.15 + random() * 0.4})`
      context.beginPath()
      context.arc(random() * width, random() * height, 0.5 + random() * 1.1, 0, Math.PI * 2)
      context.fill()
    }
  })
}

/** Lemon wheel seen face-on: rind, pith and radial segments. */
export function getLemonWheelTexture() {
  return cachedCanvasTexture('drink-lemon-wheel', 128, 128, (context, width) => {
    const c = width / 2
    context.fillStyle = '#e8c322'
    context.fillRect(0, 0, width, width)
    context.fillStyle = '#f7efc0'
    context.beginPath()
    context.arc(c, c, c * 0.9, 0, Math.PI * 2)
    context.fill()
    const segments = 9
    for (let index = 0; index < segments; index += 1) {
      const a0 = (index / segments) * Math.PI * 2 + 0.05
      const a1 = ((index + 1) / segments) * Math.PI * 2 - 0.05
      const pulp = context.createRadialGradient(c, c, 4, c, c, c * 0.78)
      pulp.addColorStop(0, '#f7dc54')
      pulp.addColorStop(1, '#eec32a')
      context.fillStyle = pulp
      context.beginPath()
      context.moveTo(c + Math.cos((a0 + a1) / 2) * 6, c + Math.sin((a0 + a1) / 2) * 6)
      context.arc(c, c, c * 0.78, a0, a1)
      context.closePath()
      context.fill()
    }
    context.fillStyle = '#f7efc0'
    context.beginPath()
    context.arc(c, c, 5, 0, Math.PI * 2)
    context.fill()
  })
}

/** Tileable wool carpet pile: rows of tufted loops, used as a bump map at a very high repeat. */
export function getCarpetWeaveTexture() {
  return cachedCanvasTexture('carpet-weave', 64, 64, (context, width, height) => {
    context.fillStyle = '#808080'
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0xca9e7)
    // Staggered rows of round tufts.
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const x = column * 8 + (row % 2 ? 4 : 0) + 4
        const y = row * 8 + 4
        const shade = 150 + Math.round(random() * 50)
        const tuft = context.createRadialGradient(x, y, 0.5, x, y, 4.4)
        tuft.addColorStop(0, `rgb(${shade},${shade},${shade})`)
        tuft.addColorStop(1, 'rgb(96,96,96)')
        context.fillStyle = tuft
        context.beginPath()
        context.arc(x, y, 4.2, 0, Math.PI * 2)
        context.fill()
      }
    }
    context.globalAlpha = 0.3
    for (let speck = 0; speck < 220; speck += 1) {
      context.fillStyle = random() > 0.5 ? '#c0c0c0' : '#505050'
      context.fillRect(random() * width, random() * height, 1, 1)
    }
    context.globalAlpha = 1
  }, { repeat: true, colorSpace: THREE.NoColorSpace })
}

/**
 * Fine brushed-metal grain: long scratches that run along U (U follows the
 * table's rail), varying strongly across V. Used as a roughness and bump map.
 */
export function getBrushedMetalTexture() {
  return cachedCanvasTexture('brushed-metal', 128, 256, (context, width, height) => {
    const random = seededRandom(0xb2a55)
    for (let row = 0; row < height; row += 1) {
      const level = 118 + Math.round(random() * 60)
      context.fillStyle = `rgb(${level},${level},${level})`
      context.fillRect(0, row, width, 1)
    }
    // Long, faint scratches drifting a little across rows.
    for (let scratch = 0; scratch < 120; scratch += 1) {
      const y = random() * height
      const light = random() > 0.5
      context.strokeStyle = light ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.16)'
      context.lineWidth = 0.6 + random() * 0.8
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y + (random() - 0.5) * 1.6)
      context.stroke()
    }
  }, { repeat: true, colorSpace: THREE.NoColorSpace })
}

/** Releases every cached texture (used when the scene is torn down). */
export function disposeSceneTextures() {
  for (const texture of textureCache.values()) texture.dispose()
  textureCache.clear()
  redrawers.clear()
}
