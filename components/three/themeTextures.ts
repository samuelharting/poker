import * as THREE from 'three'
import { drawSuit, type FeltLayout } from './sceneTextures'
import type { FeltPalette, NeonSpec, ThemeTextureKind } from './tableThemes'

/**
 * Canvas-painted textures for the table themes. Like the lounge's own art,
 * nothing ships as an image: every surface is drawn at runtime. Unlike the
 * lounge's cached textures, these belong to the active theme, so each one is
 * pushed into a `sink` and disposed when the theme is switched away.
 *
 * Without a DOM (unit tests) every painter returns a 1x1 placeholder so theme
 * builders stay runnable.
 */

export type TextureSink = THREE.Texture[]

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

interface PaintOptions {
  repeat?: readonly [number, number]
  /** Colour data (default) or linear data such as bump and roughness. */
  linear?: boolean
  anisotropy?: number
}

function paint(
  sink: TextureSink,
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  options: PaintOptions = {}
): THREE.Texture {
  let texture: THREE.Texture
  if (typeof document === 'undefined') {
    texture = new THREE.DataTexture(new Uint8Array([24, 24, 28, 255]), 1, 1)
    texture.needsUpdate = true
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context) draw(context, width, height)
    texture = new THREE.CanvasTexture(canvas)
  }
  texture.colorSpace = options.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace
  texture.anisotropy = options.anisotropy ?? 8
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(options.repeat[0], options.repeat[1])
  }
  // Static transform: no per-frame uv matrix rebuild (call updateMatrix after changing repeat).
  texture.matrixAutoUpdate = false
  texture.updateMatrix()
  sink.push(texture)
  return texture
}

function displayFont() {
  if (typeof document === 'undefined') return "'Arial Black', sans-serif"
  const variable = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
  return variable ? `${variable}, 'Arial Black', sans-serif` : "'Arial Black', sans-serif"
}

// ---------------------------------------------------------------------------
// Felt

/** The printed felt in a theme's colours. Same layout and UVs as the stock felt. */
export function createThemedFeltTexture(sink: TextureSink, layout: FeltLayout, palette: FeltPalette) {
  const width = 2048
  const height = Math.round(width * (layout.semiZ / layout.semiX))
  return paint(sink, width, height, (context) => {
    const toX = (worldX: number) => ((worldX + layout.semiX) / (layout.semiX * 2)) * width
    const toY = (worldZ: number) => ((worldZ + layout.semiZ) / (layout.semiZ * 2)) * height
    const scaleX = width / (layout.semiX * 2)
    const scaleY = height / (layout.semiZ * 2)
    const random = seededRandom(0x7e17)

    const pool = context.createRadialGradient(width / 2, height * 0.46, height * 0.08, width / 2, height / 2, width * 0.56)
    pool.addColorStop(0, palette.pool[0])
    pool.addColorStop(0.55, palette.pool[1])
    pool.addColorStop(1, palette.pool[2])
    context.fillStyle = pool
    context.fillRect(0, 0, width, height)

    context.globalAlpha = 0.07
    for (let fibre = 0; fibre < 20000; fibre += 1) {
      context.fillStyle = random() > 0.5 ? '#ffffff' : '#000008'
      context.fillRect(random() * width, random() * height, 1 + random() * 3, 1)
    }
    context.globalAlpha = 1

    for (let blotch = 0; blotch < 50; blotch += 1) {
      const bx = random() * width
      const by = random() * height
      const br = width * (0.03 + random() * 0.06)
      const blot = context.createRadialGradient(bx, by, 0, bx, by, br)
      blot.addColorStop(0, random() > 0.5 ? `rgba(${palette.highlight}, 0.05)` : `rgba(${palette.shade}, 0.07)`)
      blot.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.fillStyle = blot
      context.fillRect(bx - br, by - br, br * 2, br * 2)
    }

    // Pinstripe just inside the rail, then the betting line.
    context.strokeStyle = `rgba(${palette.line}, 0.3)`
    context.lineWidth = 3
    context.beginPath()
    context.ellipse(width / 2, height / 2, width / 2 - 34, height / 2 - 34, 0, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = `rgba(${palette.shade}, 0.35)`
    context.lineWidth = 10
    context.beginPath()
    context.ellipse(width / 2, height / 2, width / 2 - 48, height / 2 - 48, 0, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = `rgba(${palette.line}, 0.6)`
    context.lineWidth = 7
    context.beginPath()
    context.ellipse(width / 2, height / 2, layout.lineX * scaleX, layout.lineZ * scaleY, 0, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = `rgba(${palette.line}, 0.22)`
    context.lineWidth = 3
    context.beginPath()
    context.ellipse(width / 2, height / 2, layout.lineX * scaleX + 22, layout.lineZ * scaleY + 22, 0, 0, Math.PI * 2)
    context.stroke()

    const cardW = layout.cardWidth * scaleX
    const cardH = layout.cardDepth * scaleY
    context.fillStyle = `rgba(${palette.shade}, 0.14)`
    for (const worldX of layout.boardXs) {
      const x = toX(worldX) - cardW / 2
      const y = toY(layout.boardZ) - cardH / 2
      const r = cardW * 0.1
      context.beginPath()
      context.moveTo(x + r, y)
      context.arcTo(x + cardW, y, x + cardW, y + cardH, r)
      context.arcTo(x + cardW, y + cardH, x, y + cardH, r)
      context.arcTo(x, y + cardH, x, y, r)
      context.arcTo(x, y, x + cardW, y, r)
      context.closePath()
      context.fill()
    }

    // Crest and table name, faint enough that chips and cards stay the brightest things.
    const crestY = toY(layout.boardZ) + cardH / 2 + height * 0.14
    const crestRadius = height * 0.05
    const crestCenterY = crestY - height * 0.035
    context.strokeStyle = `rgba(${palette.accent}, 0.26)`
    context.lineWidth = 5
    context.beginPath()
    context.arc(width / 2, crestCenterY, crestRadius, 0, Math.PI * 2)
    context.stroke()
    context.lineWidth = 2
    context.beginPath()
    context.arc(width / 2, crestCenterY, crestRadius * 0.8, 0, Math.PI * 2)
    context.stroke()
    drawSuit(context, 'spades', width / 2, crestCenterY + 2, crestRadius * 0.95, `rgba(${palette.accent}, 0.26)`)
    for (const side of [-1, 1]) {
      context.strokeStyle = `rgba(${palette.accent}, 0.2)`
      context.lineWidth = 3
      context.beginPath()
      context.moveTo(width / 2 + side * crestRadius * 1.35, crestCenterY)
      context.lineTo(width / 2 + side * crestRadius * 4.2, crestCenterY)
      context.stroke()
      drawSuit(context, side < 0 ? 'hearts' : 'diamonds', width / 2 + side * crestRadius * 4.6, crestCenterY, crestRadius * 0.42, `rgba(${palette.accent}, 0.2)`)
    }
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const fontSize = height * 0.03
    context.font = `700 ${fontSize}px ${displayFont()}`
    const tracking = fontSize * 0.3
    const letters = [...palette.label]
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
      context.fillStyle = `rgba(${palette.shade}, 0.24)`
      context.fillText(letter, 0.7, 1.2)
      context.fillStyle = `rgba(${palette.accent}, 0.5)`
      context.fillText(letter, 0, 0)
      context.restore()
    })
    const crestTopY = toY(layout.boardZ) - cardH / 2 - height * 0.12
    for (const [index, suit] of (['spades', 'hearts', 'clubs', 'diamonds'] as const).entries()) {
      drawSuit(context, suit, width / 2 + (index - 1.5) * height * 0.06, crestTopY, height * 0.036, `rgba(${palette.accent}, 0.18)`)
    }

    const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, width * 0.52)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, `rgba(${palette.shade}, 0.5)`)
    context.fillStyle = vignette
    context.fillRect(0, 0, width, height)
  })
}

// ---------------------------------------------------------------------------
// Neon, glints, posters

/** Neon tube lettering in the theme's glow. Transparent background. */
export function createThemedNeonTexture(sink: TextureSink, spec: Pick<NeonSpec, 'text' | 'glow' | 'core'>) {
  return paint(sink, 1024, 256, (context) => {
    context.clearRect(0, 0, 1024, 256)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const size = spec.text.length > 11 ? 88 : 104
    context.font = `800 ${size}px ${displayFont()}`
    context.shadowColor = spec.glow
    context.shadowBlur = 22
    context.strokeStyle = spec.glow
    context.lineWidth = 7
    context.strokeText(spec.text, 512, 132)
    context.shadowBlur = 0
    context.fillStyle = spec.core
    context.fillText(spec.text, 512, 132)
  })
}

/** A soft four-point star used by the twinkling glints (chandelier crystals, stars). */
export function createSparkleTexture(sink: TextureSink) {
  return paint(sink, 64, 64, (context) => {
    context.clearRect(0, 0, 64, 64)
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 22)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 64, 64)
    context.strokeStyle = 'rgba(255,255,255,0.9)'
    context.lineCap = 'round'
    for (const [dx, dy, len, w] of [[1, 0, 30, 1.6], [0, 1, 30, 1.6], [0.7, 0.7, 14, 1], [0.7, -0.7, 14, 1]] as const) {
      context.lineWidth = w
      context.beginPath()
      context.moveTo(32 - dx * len, 32 - dy * len)
      context.lineTo(32 + dx * len, 32 + dy * len)
      context.stroke()
    }
  })
}

/** A radial glow (floor pools, bulb halos). RGB is "r, g, b". */
export function createRadialGlowTexture(sink: TextureSink, rgb: string, alpha: number) {
  return paint(sink, 256, 256, (context) => {
    const glow = context.createRadialGradient(128, 128, 0, 128, 128, 128)
    glow.addColorStop(0, `rgba(${rgb}, ${alpha})`)
    glow.addColorStop(0.5, `rgba(${rgb}, ${alpha * 0.35})`)
    glow.addColorStop(1, `rgba(${rgb}, 0)`)
    context.fillStyle = glow
    context.fillRect(0, 0, 256, 256)
  })
}

export interface AtlasRect { x: number; y: number; w: number; h: number }
export const BASEMENT_ATLAS_SIZE = 1024
export const BASEMENT_ATLAS: Readonly<Record<'posterA' | 'posterB' | 'dartboard' | 'pennant' | 'calendar', AtlasRect>> = {
  posterA: { x: 0, y: 0, w: 400, h: 560 },
  posterB: { x: 420, y: 0, w: 400, h: 560 },
  dartboard: { x: 0, y: 580, w: 360, h: 360 },
  pennant: { x: 380, y: 580, w: 360, h: 200 },
  calendar: { x: 760, y: 580, w: 240, h: 330 },
}

/** The basement's wall dressing in one atlas: two posters, a dartboard, a pennant and a calendar. */
export function createBasementAtlasTexture(sink: TextureSink) {
  return paint(sink, BASEMENT_ATLAS_SIZE, BASEMENT_ATLAS_SIZE, (context) => {
    const family = displayFont()
    context.fillStyle = '#222'
    context.fillRect(0, 0, BASEMENT_ATLAS_SIZE, BASEMENT_ATLAS_SIZE)

    // Poster A: retro hold'em night.
    const a = BASEMENT_ATLAS.posterA
    const skyA = context.createLinearGradient(0, a.y, 0, a.y + a.h)
    skyA.addColorStop(0, '#1a3a5e')
    skyA.addColorStop(1, '#0c1b2e')
    context.fillStyle = skyA
    context.fillRect(a.x, a.y, a.w, a.h)
    context.strokeStyle = '#e8c872'
    context.lineWidth = 8
    context.strokeRect(a.x + 14, a.y + 14, a.w - 28, a.h - 28)
    drawSuit(context, 'spades', a.x + a.w / 2, a.y + 230, 190, '#f0d58a')
    context.textAlign = 'center'
    context.fillStyle = '#f6ecd0'
    context.font = `800 46px ${family}`
    context.fillText('TEXAS', a.x + a.w / 2, a.y + 410)
    context.fillText("HOLD'EM", a.x + a.w / 2, a.y + 462)
    context.fillStyle = '#e8c872'
    context.font = `600 20px ${family}`
    context.fillText('FRIDAY NIGHTS', a.x + a.w / 2, a.y + 506)

    // Poster B: lucky sevens.
    const b = BASEMENT_ATLAS.posterB
    const skyB = context.createLinearGradient(0, b.y, 0, b.y + b.h)
    skyB.addColorStop(0, '#7a1a1e')
    skyB.addColorStop(1, '#3a0c10')
    context.fillStyle = skyB
    context.fillRect(b.x, b.y, b.w, b.h)
    for (let ray = 0; ray < 16; ray += 1) {
      const angle = (ray / 16) * Math.PI * 2
      context.strokeStyle = 'rgba(255, 210, 120, 0.12)'
      context.lineWidth = 16
      context.beginPath()
      context.moveTo(b.x + b.w / 2, b.y + 240)
      context.lineTo(b.x + b.w / 2 + Math.cos(angle) * 360, b.y + 240 + Math.sin(angle) * 360)
      context.stroke()
    }
    context.fillStyle = '#ffd36a'
    context.font = `800 300px ${family}`
    context.fillText('7', b.x + b.w / 2, b.y + 360)
    context.fillStyle = '#fff1d0'
    context.font = `800 40px ${family}`
    context.fillText('FEELING LUCKY?', b.x + b.w / 2, b.y + 484)
    context.strokeStyle = '#ffd36a'
    context.lineWidth = 6
    context.strokeRect(b.x + 14, b.y + 14, b.w - 28, b.h - 28)

    // Dartboard.
    const d = BASEMENT_ATLAS.dartboard
    const cx = d.x + d.w / 2
    const cy = d.y + d.h / 2
    context.fillStyle = '#1b1410'
    context.beginPath()
    context.arc(cx, cy, d.w / 2 - 2, 0, Math.PI * 2)
    context.fill()
    for (let segment = 0; segment < 20; segment += 1) {
      const start = (segment / 20) * Math.PI * 2 - Math.PI / 2 - Math.PI / 20
      const end = start + Math.PI / 10
      for (const [inner, outer, evenColor, oddColor] of [
        [0.18, 0.55, '#e8dcc0', '#16120e'],
        [0.55, 0.62, '#2f8f4e', '#c0302c'],
        [0.62, 0.9, '#e8dcc0', '#16120e'],
        [0.9, 0.97, '#2f8f4e', '#c0302c'],
      ] as const) {
        context.fillStyle = segment % 2 === 0 ? evenColor : oddColor
        context.beginPath()
        context.arc(cx, cy, (d.w / 2) * outer, start, end)
        context.arc(cx, cy, (d.w / 2) * inner, end, start, true)
        context.closePath()
        context.fill()
      }
    }
    context.fillStyle = '#2f8f4e'
    context.beginPath()
    context.arc(cx, cy, d.w * 0.09, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#c0302c'
    context.beginPath()
    context.arc(cx, cy, d.w * 0.04, 0, Math.PI * 2)
    context.fill()

    // Pennant.
    const p = BASEMENT_ATLAS.pennant
    context.fillStyle = '#c0572a'
    context.beginPath()
    context.moveTo(p.x, p.y)
    context.lineTo(p.x + p.w, p.y + p.h / 2)
    context.lineTo(p.x, p.y + p.h)
    context.closePath()
    context.fill()
    context.fillStyle = '#f1e2b8'
    context.font = `800 54px ${family}`
    context.textAlign = 'left'
    context.fillText('ALL IN', p.x + 26, p.y + p.h / 2 + 18)

    // Wall calendar.
    const c = BASEMENT_ATLAS.calendar
    context.fillStyle = '#efe6d2'
    context.fillRect(c.x, c.y, c.w, c.h)
    context.fillStyle = '#a02a2a'
    context.fillRect(c.x, c.y, c.w, 70)
    context.fillStyle = '#fff'
    context.textAlign = 'center'
    context.font = `800 30px ${family}`
    context.fillText('POKER', c.x + c.w / 2, c.y + 44)
    context.fillStyle = '#403a30'
    context.font = `600 20px ${family}`
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const day = row * 7 + col + 1
        if (day > 31) continue
        context.fillText(String(day), c.x + 22 + col * 33, c.y + 108 + row * 40)
      }
    }
    context.strokeStyle = '#c02a2a'
    context.lineWidth = 4
    context.beginPath()
    context.arc(c.x + 22 + 4 * 33, c.y + 100 + 2 * 40, 17, 0, Math.PI * 2)
    context.stroke()
  })
}

// ---------------------------------------------------------------------------
// Surfaces

function marbleSlab(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  base: string,
  vein: string,
  random: () => number,
  veins: number,
  gold = 0
) {
  context.save()
  context.beginPath()
  context.rect(x, y, size, size)
  context.clip()
  context.fillStyle = base
  context.fillRect(x, y, size, size)
  for (let cloud = 0; cloud < 14; cloud += 1) {
    const cx = x + random() * size
    const cy = y + random() * size
    const radius = size * (0.12 + random() * 0.3)
    const blot = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
    blot.addColorStop(0, `rgba(${vein}, ${0.03 + random() * 0.05})`)
    blot.addColorStop(1, `rgba(${vein}, 0)`)
    context.fillStyle = blot
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  }
  context.lineCap = 'round'
  for (let index = 0; index < veins + gold; index += 1) {
    const isGold = index >= veins
    let px = x + random() * size
    let py = y + random() * size
    let angle = random() * Math.PI * 2
    const width = isGold ? 1 + random() * 1.4 : 0.6 + random() * 1.8
    context.strokeStyle = isGold
      ? `rgba(214, 170, 82, ${0.35 + random() * 0.3})`
      : `rgba(${vein}, ${0.12 + random() * 0.3})`
    context.lineWidth = width
    context.beginPath()
    context.moveTo(px, py)
    for (let step = 0; step < 46; step += 1) {
      angle += (random() - 0.5) * 0.9
      px += Math.cos(angle) * (size / 38)
      py += Math.sin(angle) * (size / 38)
      context.lineTo(px, py)
    }
    context.stroke()
  }
  context.restore()
}

function paintHighRollerFloor(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0xca51)
  const half = width / 2
  const slabs: Array<[number, number, string, string, number]> = [
    [0, 0, '#0b0b10', '200, 200, 215', 9],
    [half, 0, '#1b1a22', '215, 205, 190', 8],
    [0, half, '#1b1a22', '215, 205, 190', 8],
    [half, half, '#0b0b10', '200, 200, 215', 9],
  ]
  for (const [x, y, base, vein, count] of slabs) marbleSlab(context, x, y, half, base, vein, random, count, 2)
  // Gold grout between the slabs.
  context.fillStyle = '#b98f3e'
  context.fillRect(half - 2, 0, 4, height)
  context.fillRect(0, half - 2, width, 4)
  context.fillRect(0, 0, width, 3)
  context.fillRect(0, 0, 3, height)
}

function paintHighRollerWall(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0xb1ac)
  marbleSlab(context, 0, 0, width, '#0d0d12', '205, 205, 220', random, 16, 3)
  // A framed panel: double gold line with corner notches.
  for (const [inset, line, alpha] of [[30, 6, 0.9], [52, 2.5, 0.55]] as const) {
    context.strokeStyle = `rgba(226, 182, 96, ${alpha})`
    context.lineWidth = line
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2)
  }
  context.fillStyle = 'rgba(226, 182, 96, 0.9)'
  for (const [cx, cy] of [[30, 30], [width - 30, 30], [30, height - 30], [width - 30, height - 30]] as const) {
    context.beginPath()
    context.moveTo(cx, cy - 16)
    context.lineTo(cx + 16, cy)
    context.lineTo(cx, cy + 16)
    context.lineTo(cx - 16, cy)
    context.closePath()
    context.fill()
  }
}

function paintHighRollerWainscot(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0x7a1e)
  const base = context.createLinearGradient(0, 0, 0, height)
  base.addColorStop(0, '#15151c')
  base.addColorStop(1, '#0a0a0f')
  context.fillStyle = base
  context.fillRect(0, 0, width, height)
  context.globalAlpha = 0.07
  for (let index = 0; index < 700; index += 1) {
    context.fillStyle = random() > 0.5 ? '#fff' : '#000'
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1)
  }
  context.globalAlpha = 1
  context.strokeStyle = 'rgba(226, 182, 96, 0.9)'
  context.lineWidth = 4
  context.strokeRect(26, 26, width - 52, height - 52)
  context.strokeStyle = 'rgba(226, 182, 96, 0.45)'
  context.lineWidth = 2
  context.strokeRect(40, 40, width - 80, height - 80)
  context.fillStyle = 'rgba(226, 182, 96, 0.85)'
  context.beginPath()
  context.moveTo(width / 2, height / 2 - 22)
  context.lineTo(width / 2 + 22, height / 2)
  context.lineTo(width / 2, height / 2 + 22)
  context.lineTo(width / 2 - 22, height / 2)
  context.closePath()
  context.fill()
}

function paintHighRollerCeiling(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = '#17120d'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = 'rgba(226, 182, 96, 0.85)'
  context.lineWidth = 5
  context.strokeRect(18, 18, width - 36, height - 36)
  context.lineWidth = 2
  context.strokeRect(36, 36, width - 72, height - 72)
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.3)
  glow.addColorStop(0, 'rgba(255, 214, 140, 0.6)')
  glow.addColorStop(1, 'rgba(255, 214, 140, 0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)
}

function paintBasementPaneling(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0xba5e)
  const planks = 10
  const plankWidth = width / planks
  for (let plank = 0; plank < planks; plank += 1) {
    const x = plank * plankWidth
    const tone = random()
    const r = Math.round(92 + tone * 40)
    const g = Math.round(58 + tone * 26)
    const b = Math.round(34 + tone * 16)
    const shade = context.createLinearGradient(x, 0, x + plankWidth, 0)
    shade.addColorStop(0, `rgb(${r - 10}, ${g - 8}, ${b - 6})`)
    shade.addColorStop(0.5, `rgb(${r}, ${g}, ${b})`)
    shade.addColorStop(1, `rgb(${r - 12}, ${g - 9}, ${b - 7})`)
    context.fillStyle = shade
    context.fillRect(x, 0, plankWidth, height)
    // Grain: long, slightly wavy vertical streaks.
    for (let streak = 0; streak < 26; streak += 1) {
      const sx = x + 4 + random() * (plankWidth - 8)
      const amplitude = 1 + random() * 2.5
      const phase = random() * Math.PI * 2
      context.strokeStyle = random() > 0.5 ? 'rgba(30, 14, 6, 0.22)' : 'rgba(190, 130, 80, 0.12)'
      context.lineWidth = 0.7 + random() * 1.4
      context.beginPath()
      for (let y = 0; y <= height; y += 24) {
        const offset = Math.sin((y / height) * Math.PI * 5 + phase) * amplitude
        if (y === 0) context.moveTo(sx + offset, y)
        else context.lineTo(sx + offset, y)
      }
      context.stroke()
    }
    // A knot or two.
    if (random() > 0.45) {
      const kx = x + plankWidth * (0.3 + random() * 0.4)
      const ky = height * (0.1 + random() * 0.8)
      const knot = context.createRadialGradient(kx, ky, 1, kx, ky, 16)
      knot.addColorStop(0, 'rgba(24, 10, 4, 0.8)')
      knot.addColorStop(0.5, 'rgba(60, 30, 14, 0.5)')
      knot.addColorStop(1, 'rgba(60, 30, 14, 0)')
      context.fillStyle = knot
      context.save()
      context.translate(kx, ky)
      context.scale(0.7, 1.5)
      context.translate(-kx, -ky)
      context.fillRect(kx - 18, ky - 18, 36, 36)
      context.restore()
    }
    // V-groove between boards.
    context.fillStyle = 'rgba(8, 3, 1, 0.78)'
    context.fillRect(x, 0, 3, height)
    context.fillStyle = 'rgba(220, 170, 120, 0.16)'
    context.fillRect(x + 3, 0, 1.5, height)
  }
  // Age: darker toward the bottom (damp) and uneven stains.
  const damp = context.createLinearGradient(0, height * 0.7, 0, height)
  damp.addColorStop(0, 'rgba(10, 4, 0, 0)')
  damp.addColorStop(1, 'rgba(10, 4, 0, 0.35)')
  context.fillStyle = damp
  context.fillRect(0, height * 0.7, width, height * 0.3)
  for (let stain = 0; stain < 10; stain += 1) {
    const sx = random() * width
    const sy = random() * height
    const radius = 40 + random() * 90
    const blot = context.createRadialGradient(sx, sy, 0, sx, sy, radius)
    blot.addColorStop(0, 'rgba(20, 8, 2, 0.14)')
    blot.addColorStop(1, 'rgba(20, 8, 2, 0)')
    context.fillStyle = blot
    context.fillRect(sx - radius, sy - radius, radius * 2, radius * 2)
  }
}

function paintBasementFloor(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0xf100)
  // Painted concrete: warm grey with fine speckle.
  context.fillStyle = '#413d37'
  context.fillRect(0, 0, width, height)
  for (let speck = 0; speck < 90000; speck += 1) {
    const light = random() > 0.5
    context.fillStyle = light ? 'rgba(255, 245, 230, 0.05)' : 'rgba(0, 0, 0, 0.07)'
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 2)
  }
  for (let stain = 0; stain < 40; stain += 1) {
    const sx = random() * width
    const sy = random() * height
    const radius = 30 + random() * 160
    const blot = context.createRadialGradient(sx, sy, 0, sx, sy, radius)
    blot.addColorStop(0, random() > 0.5 ? 'rgba(10, 8, 6, 0.16)' : 'rgba(150, 140, 120, 0.07)')
    blot.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = blot
    context.fillRect(sx - radius, sy - radius, radius * 2, radius * 2)
  }
  // Hairline cracks and a control joint.
  context.strokeStyle = 'rgba(8, 6, 4, 0.5)'
  context.lineWidth = 2
  for (const row of [0.22, 0.78]) {
    context.beginPath()
    context.moveTo(0, height * row)
    context.lineTo(width, height * row)
    context.stroke()
  }
  context.lineWidth = 1.2
  for (let crack = 0; crack < 8; crack += 1) {
    let px = random() * width
    let py = random() * height
    context.beginPath()
    context.moveTo(px, py)
    for (let step = 0; step < 26; step += 1) {
      px += (random() - 0.5) * 36
      py += (random() - 0.2) * 30
      context.lineTo(px, py)
    }
    context.stroke()
  }
  // The area rug under the table: oval, banded border, faded diamond field.
  const cx = width / 2
  const cy = height / 2
  const unit = width / 40
  const rx = 9.2 * unit
  const ry = 7.3 * unit
  context.save()
  context.translate(cx, cy)
  const ellipse = (scale: number, fill: string) => {
    context.fillStyle = fill
    context.beginPath()
    context.ellipse(0, 0, rx * scale, ry * scale, 0, 0, Math.PI * 2)
    context.fill()
  }
  ellipse(1.04, 'rgba(0, 0, 0, 0.35)')
  ellipse(1, '#4a2420')
  ellipse(0.94, '#8c6a3a')
  ellipse(0.9, '#5a2a24')
  ellipse(0.84, '#6e3a2a')
  context.beginPath()
  context.ellipse(0, 0, rx * 0.84, ry * 0.84, 0, 0, Math.PI * 2)
  context.clip()
  context.strokeStyle = 'rgba(214, 170, 100, 0.32)'
  context.lineWidth = 3
  const step = unit * 1.3
  for (let offset = -rx * 2; offset < rx * 2; offset += step) {
    context.beginPath()
    context.moveTo(offset, -ry)
    context.lineTo(offset + ry, 0)
    context.lineTo(offset, ry)
    context.lineTo(offset - ry, 0)
    context.closePath()
    context.stroke()
  }
  // Wear and fading.
  for (let wear = 0; wear < 5000; wear += 1) {
    context.fillStyle = random() > 0.5 ? 'rgba(255, 230, 190, 0.06)' : 'rgba(0, 0, 0, 0.08)'
    context.fillRect((random() - 0.5) * rx * 2, (random() - 0.5) * ry * 2, 2 + random() * 5, 1.5)
  }
  context.restore()
}

function paintBasementCeiling(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0xce11)
  context.fillStyle = '#2b2824'
  context.fillRect(0, 0, width, height)
  for (let speck = 0; speck < 4000; speck += 1) {
    context.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1)
  }
  context.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  context.lineWidth = 6
  context.strokeRect(0, 0, width, height)
  context.strokeStyle = 'rgba(180, 170, 150, 0.12)'
  context.lineWidth = 2
  context.strokeRect(6, 6, width - 12, height - 12)
}

function paintSkyline(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0x5c11)
  const sky = context.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#06031a')
  sky.addColorStop(0.3, '#150a40')
  sky.addColorStop(0.5, '#3a1068')
  sky.addColorStop(0.62, '#8a1f86')
  sky.addColorStop(0.72, '#ff4f9e')
  sky.addColorStop(0.79, '#ffa070')
  sky.addColorStop(1, '#2a0f3f')
  context.fillStyle = sky
  context.fillRect(0, 0, width, height)
  // Stars.
  for (let star = 0; star < 220; star += 1) {
    const y = random() * height * 0.5
    context.fillStyle = `rgba(255, 255, 255, ${0.2 + random() * 0.6})`
    context.fillRect(random() * width, y, 1 + random() * 1.5, 1 + random() * 1.5)
  }
  // Moon.
  const moonX = width * 0.82
  const moonY = height * 0.2
  const moon = context.createRadialGradient(moonX, moonY, 10, moonX, moonY, 150)
  moon.addColorStop(0, 'rgba(255, 230, 250, 0.55)')
  moon.addColorStop(1, 'rgba(255, 230, 250, 0)')
  context.fillStyle = moon
  context.fillRect(moonX - 150, moonY - 150, 300, 300)
  context.fillStyle = '#ffe9f6'
  context.beginPath()
  context.arc(moonX, moonY, 34, 0, Math.PI * 2)
  context.fill()

  const horizon = height * 0.8
  const layers: Array<{ color: string; windows: number; minH: number; maxH: number; minW: number; maxW: number; alpha: number }> = [
    { color: '#2a1252', windows: 0.55, minH: 0.12, maxH: 0.36, minW: 50, maxW: 120, alpha: 0.5 },
    { color: '#170a38', windows: 0.7, minH: 0.1, maxH: 0.42, minW: 70, maxW: 160, alpha: 0.75 },
    { color: '#0a0522', windows: 0.85, minH: 0.06, maxH: 0.3, minW: 90, maxW: 210, alpha: 0.95 },
  ]
  const windowColors = ['106, 240, 255', '255, 122, 216', '255, 216, 154', '180, 140, 255']
  for (const layer of layers) {
    let x = -40
    while (x < width) {
      const w = layer.minW + random() * (layer.maxW - layer.minW)
      const h = height * (layer.minH + random() * (layer.maxH - layer.minH))
      context.fillStyle = layer.color
      context.fillRect(x, horizon - h, w, height - (horizon - h))
      // Roof details.
      if (random() > 0.6) {
        context.fillRect(x + w * 0.4, horizon - h - 22, 5, 22)
        context.fillStyle = 'rgba(255, 60, 90, 0.95)'
        context.fillRect(x + w * 0.4 - 1, horizon - h - 26, 7, 5)
      }
      // Lit windows on a grid.
      const cell = 14 + Math.round(layer.alpha * 6)
      for (let wx = x + 8; wx < x + w - 8; wx += cell) {
        for (let wy = horizon - h + 10; wy < horizon + 40; wy += cell + 6) {
          if (random() > layer.windows * 0.5) continue
          context.fillStyle = `rgba(${windowColors[Math.floor(random() * windowColors.length)]}, ${0.35 + random() * 0.6})`
          context.fillRect(wx, wy, cell * 0.5, cell * 0.6)
        }
      }
      // A neon billboard now and then.
      if (layer.alpha > 0.7 && random() > 0.75) {
        const neon = random() > 0.5 ? '#35e8ff' : '#ff3fb4'
        context.fillStyle = neon
        context.shadowColor = neon
        context.shadowBlur = 24
        context.fillRect(x + w * 0.2, horizon - h * 0.7, w * 0.6, 12)
        context.shadowBlur = 0
      }
      x += w + random() * 8
    }
  }
  // Street haze at the base of the wall.
  const haze = context.createLinearGradient(0, horizon - 30, 0, height)
  haze.addColorStop(0, 'rgba(255, 80, 180, 0)')
  haze.addColorStop(1, 'rgba(255, 80, 180, 0.28)')
  context.fillStyle = haze
  context.fillRect(0, horizon - 30, width, height - horizon + 30)
}

function paintRooftopGlass(context: CanvasRenderingContext2D, width: number, height: number) {
  const base = context.createLinearGradient(0, 0, 0, height)
  base.addColorStop(0, '#0b0826')
  base.addColorStop(0.7, '#150b3a')
  base.addColorStop(1, '#3a0f5a')
  context.fillStyle = base
  context.fillRect(0, 0, width, height)
  // Faint skyline glow seen through the glass and diagonal reflections.
  context.fillStyle = 'rgba(255, 255, 255, 0.045)'
  for (const x of [0.12, 0.42, 0.7]) {
    context.beginPath()
    context.moveTo(width * x, 0)
    context.lineTo(width * (x + 0.1), 0)
    context.lineTo(width * (x - 0.1), height)
    context.lineTo(width * (x - 0.2), height)
    context.closePath()
    context.fill()
  }
  context.fillStyle = '#05030f'
  context.fillRect(0, 0, 6, height)
  context.fillRect(width - 6, 0, 6, height)
  context.strokeStyle = 'rgba(70, 232, 255, 0.5)'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(8, 0)
  context.lineTo(8, height)
  context.stroke()
}

function paintRooftopFloor(context: CanvasRenderingContext2D, width: number, height: number) {
  const random = seededRandom(0x4f10)
  const half = width / 2
  context.fillStyle = '#0a0919'
  context.fillRect(0, 0, width, height)
  for (const [x, y] of [[0, 0], [half, 0], [0, half], [half, half]] as const) {
    context.fillStyle = (x + y) % width === 0 ? '#0e0c20' : '#0a0818'
    context.fillRect(x + 4, y + 4, half - 8, half - 8)
  }
  context.globalAlpha = 0.5
  for (let speck = 0; speck < 1800; speck += 1) {
    context.fillStyle = random() > 0.5 ? 'rgba(120, 100, 255, 0.12)' : 'rgba(0, 0, 0, 0.3)'
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1)
  }
  context.globalAlpha = 1
  // Glowing seams: cyan one way, magenta the other.
  context.shadowBlur = 6
  context.shadowColor = '#35e8ff'
  context.fillStyle = 'rgba(53, 232, 255, 0.7)'
  context.fillRect(half - 1, 0, 2, height)
  context.fillRect(0, 0, 2, height)
  context.shadowColor = '#ff3fb4'
  context.fillStyle = 'rgba(255, 63, 180, 0.7)'
  context.fillRect(0, half - 1, width, 2)
  context.fillRect(0, 0, width, 2)
  context.shadowBlur = 0
}

const SURFACE_PAINTERS: Readonly<Record<ThemeTextureKind, {
  width: number
  height: number
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void
}>> = {
  'highroller-floor': { width: 1024, height: 1024, draw: paintHighRollerFloor },
  'highroller-wall': { width: 1024, height: 1024, draw: paintHighRollerWall },
  'highroller-wainscot': { width: 512, height: 368, draw: paintHighRollerWainscot },
  'highroller-ceiling': { width: 512, height: 512, draw: paintHighRollerCeiling },
  'basement-paneling': { width: 1024, height: 1024, draw: paintBasementPaneling },
  'basement-floor': { width: 2048, height: 2048, draw: paintBasementFloor },
  'basement-ceiling': { width: 256, height: 256, draw: paintBasementCeiling },
  'rooftop-skyline': { width: 2048, height: 896, draw: paintSkyline },
  'rooftop-glass': { width: 512, height: 512, draw: paintRooftopGlass },
  'rooftop-floor': { width: 512, height: 512, draw: paintRooftopFloor },
}

export const THEME_TEXTURE_KINDS = Object.keys(SURFACE_PAINTERS) as ThemeTextureKind[]

/** Paints one themed surface texture (own copy: safe to dispose with the theme). */
export function createSurfaceTexture(
  sink: TextureSink,
  kind: ThemeTextureKind,
  repeat?: readonly [number, number],
  anisotropy = 8
) {
  const painter = SURFACE_PAINTERS[kind]
  return paint(sink, painter.width, painter.height, painter.draw, { repeat, anisotropy })
}
