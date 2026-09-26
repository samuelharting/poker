import * as THREE from 'three'

/**
 * Canvas-painted textures for the stylized desktop room. Everything is drawn at
 * runtime so the scene ships no image assets, and every texture is cached so
 * repeated cards/chips share one GPU upload.
 */

export type CardSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

export const CARD_ASPECT = 88 / 63
const CARD_TEXTURE_WIDTH = 256
const CARD_TEXTURE_HEIGHT = Math.round(CARD_TEXTURE_WIDTH * CARD_ASPECT)

const SUIT_COLORS: Record<CardSuit, string> = {
  spades: '#16191c',
  clubs: '#16191c',
  hearts: '#d23a44',
  diamonds: '#d23a44',
}

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
  texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
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
  color = SUIT_COLORS[suit]
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
      context.moveTo(0, -s * 0.1)
      context.fill()
      context.beginPath()
      context.moveTo(-s * 0.1, s * 0.05)
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
  roundedRectPath(context, 1, 1, width - 2, height - 2, radius)
  const face = context.createLinearGradient(0, 0, width, height)
  face.addColorStop(0, '#fffdf6')
  face.addColorStop(1, '#f3e9d2')
  context.fillStyle = face
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = 'rgba(80, 60, 30, 0.22)'
  context.stroke()
}

/** A rounded, readable card face: big corner index plus a centre pip. */
export function getCardFaceTexture(rank: string, suit: CardSuit) {
  return cachedCanvasTexture(`card-face-${rank}-${suit}`, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT, (context, width, height) => {
    paintCardBase(context, width, height)
    const color = SUIT_COLORS[suit]
    const label = rank === 'T' ? '10' : rank
    const font = getDisplayFontFamily()

    context.fillStyle = color
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    const indexSize = label.length > 1 ? width * 0.25 : width * 0.3
    context.font = `800 ${indexSize}px ${font}`
    context.fillText(label, width * 0.22, height * 0.2)
    drawSuit(context, suit, width * 0.22, height * 0.3, width * 0.17)

    drawSuit(context, suit, width * 0.58, height * 0.6, width * 0.52)

    context.save()
    context.translate(width, height)
    context.rotate(Math.PI)
    context.font = `800 ${indexSize * 0.62}px ${font}`
    context.fillText(label, width * 0.14, height * 0.12)
    context.restore()
  })
}

/** Stylized ruby card back with a cream frame, lattice and brass medallion. */
export function getCardBackTexture() {
  return cachedCanvasTexture('card-back', CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT, (context, width, height) => {
    const radius = width * 0.09
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
    context.fillStyle = style.spot
    const spots = 8
    for (let spot = 0; spot < spots; spot += 1) {
      const x = (spot + 0.5) * (width / spots) - width / spots / 4
      context.fillRect(x, 0, width / spots / 2, height)
    }
    context.fillStyle = 'rgba(0,0,0,0.18)'
    context.fillRect(0, 0, width, 3)
    context.fillRect(0, height - 3, width, 3)
  })
}

/** Chip face: rim spots, inner ring and a centred inlay disc. */
export function getChipFaceTexture(index: number) {
  const style = CHIP_DENOMINATIONS[index % CHIP_DENOMINATIONS.length]!
  return cachedCanvasTexture(`chip-face-${index}`, 128, 128, (context, width) => {
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

    const inlay = context.createRadialGradient(c - 6, c - 6, 2, c, c, c * 0.5)
    inlay.addColorStop(0, '#ffffff')
    inlay.addColorStop(1, style.spot)
    context.fillStyle = inlay
    context.beginPath()
    context.arc(c, c, c * 0.44, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = style.rim
    context.beginPath()
    context.arc(c, c, c * 0.14, 0, Math.PI * 2)
    context.fill()
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
    pool.addColorStop(0, '#1bb282')
    pool.addColorStop(0.55, '#12916b')
    pool.addColorStop(1, '#0a5a44')
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

    const cardW = layout.cardWidth * scaleX
    const cardH = layout.cardDepth * scaleY
    context.strokeStyle = 'rgba(255, 244, 222, 0.22)'
    context.lineWidth = 4
    context.setLineDash([14, 10])
    for (const worldX of layout.boardXs) {
      roundedRectPath(context, toX(worldX) - cardW / 2, toY(layout.boardZ) - cardH / 2, cardW, cardH, cardW * 0.1)
      context.stroke()
    }
    context.setLineDash([])

    const font = getDisplayFontFamily()
    const crestY = toY(layout.boardZ) + cardH / 2 + height * 0.14
    context.fillStyle = 'rgba(255, 236, 190, 0.2)'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    // The room already says POKER NIGHT (neon + HUD); the felt just names the game.
    context.font = `600 ${height * 0.03}px ${font}`
    context.fillText('NO  LIMIT  HOLD’EM', width / 2, crestY)

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

/** Releases every cached texture (used when the scene is torn down). */
export function disposeSceneTextures() {
  for (const texture of textureCache.values()) texture.dispose()
  textureCache.clear()
  redrawers.clear()
}
