import * as THREE from 'three'

/**
 * The face overlay: ONE transparent, vertex-coloured mesh holding
 *   - two shaped brows (tapered hair ribbons that bend and move independently),
 *   - soft skin decals: cheek blush, under-eye bags, oily sheen on nose, forehead
 *     and cheekbones, an overall pallor wash,
 *   - crease lines: nasolabial folds, glabella furrow, nose wrinkle.
 * All decals are soft radial/line sprites from a single canvas atlas, placed on the
 * measured skin surface. Only vertex colours (alpha = strength) change per frame,
 * brow vertices move when the brows do. One draw call for the whole set.
 */

const ATLAS_W = 512
const ATLAS_H = 256
/** UV rectangles inside the atlas (pixel coords, y down). */
const RECT = {
  brow: { x: 0, y: 0, w: 384, h: 64 },
  blob: { x: 0, y: 64, w: 128, h: 128 },
  line: { x: 128, y: 64, w: 256, h: 64 },
}

let atlas: THREE.CanvasTexture | null = null
let atlasUsers = 0

export function acquireOverlayAtlas() {
  atlasUsers += 1
  if (atlas) return atlas
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  canvas.height = ATLAS_H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H)

  // Brow hair: a soft dense core with ragged, streaky edges.
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const { x: bx, y: by, w: bw, h: bh } = RECT.brow
  const core = ctx.createLinearGradient(0, by, 0, by + bh)
  core.addColorStop(0, 'rgba(255,255,255,0)')
  core.addColorStop(0.28, 'rgba(255,255,255,0.86)')
  core.addColorStop(0.5, 'rgba(255,255,255,1)')
  core.addColorStop(0.72, 'rgba(255,255,255,0.86)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  // Taper: the core narrows towards the tail (right side).
  for (let x = 0; x < bw; x += 2) {
    const t = x / bw
    const half = bh * (0.36 - 0.2 * t * t)
    ctx.globalAlpha = 0.9 * (1 - Math.min(1, Math.max(0, (t - 0.8) / 0.18)) ** 2 * 0.95)
    ctx.fillRect(bx + x, by + bh / 2 - half, 2.2, half * 2)
  }
  ctx.globalAlpha = 1
  ctx.lineCap = 'round'
  for (let i = 0; i < 760; i += 1) {
    // Strokes stay inside the body of the brow (0.04..0.86) so no detached dash trails past the tail.
    const t = 0.04 + rand() * 0.82
    const x = bx + t * bw
    const spread = bh * (0.46 - 0.2 * t)
    const y = by + bh / 2 + (rand() - 0.5) * 2 * spread * (0.4 + 0.8 * rand())
    const len = 12 + rand() * 26
    const angle = -0.16 - (y - (by + bh / 2)) / bh * 0.35 + (rand() - 0.5) * 0.18
    ctx.strokeStyle = `rgba(255,255,255,${0.28 + rand() * 0.6})`
    ctx.lineWidth = 1.2 + rand() * 1.7
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  // Fade the far tail and the very ends so the ribbon ends are soft.
  const fade = ctx.createLinearGradient(bx, 0, bx + bw, 0)
  fade.addColorStop(0, 'rgba(0,0,0,0.35)')
  fade.addColorStop(0.08, 'rgba(0,0,0,0)')
  fade.addColorStop(0.88, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,0.9)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = fade
  ctx.fillRect(bx, by, bw, bh)
  ctx.globalCompositeOperation = 'source-over'

  // Soft radial blob.
  const { x: ox, y: oy, w: ow, h: oh } = RECT.blob
  const radial = ctx.createRadialGradient(ox + ow / 2, oy + oh / 2, 0, ox + ow / 2, oy + oh / 2, ow / 2)
  radial.addColorStop(0, 'rgba(255,255,255,1)')
  radial.addColorStop(0.35, 'rgba(255,255,255,0.7)')
  radial.addColorStop(0.7, 'rgba(255,255,255,0.22)')
  radial.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = radial
  ctx.fillRect(ox, oy, ow, oh)

  // Soft crease line: gaussian across, tapered along.
  const { x: lx, y: ly, w: lw, h: lh } = RECT.line
  const lineImage = ctx.createImageData(lw, lh)
  for (let x = 0; x < lw; x += 1) {
    const along = Math.sin(Math.PI * (x / lw)) ** 0.7
    for (let y = 0; y < lh; y += 1) {
      const v = (y / lh - 0.5) * 2
      const o = (y * lw + x) * 4
      lineImage.data[o] = 255
      lineImage.data[o + 1] = 255
      lineImage.data[o + 2] = 255
      lineImage.data[o + 3] = Math.round(255 * Math.exp(-v * v * 9) * along)
    }
  }
  ctx.putImageData(lineImage, lx, ly)

  atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 4
  atlas.generateMipmaps = true
  atlas.minFilter = THREE.LinearMipmapLinearFilter
  atlas.needsUpdate = true
  return atlas
}

export function releaseOverlayAtlas() {
  atlasUsers = Math.max(0, atlasUsers - 1)
  if (atlasUsers === 0 && atlas) {
    atlas.dispose()
    atlas = null
  }
}

function uv(rect: { x: number; y: number; w: number; h: number }, u: number, v: number, out: Float32Array, o: number) {
  out[o] = (rect.x + u * rect.w) / ATLAS_W
  out[o + 1] = 1 - (rect.y + v * rect.h) / ATLAS_H
}

const BLOB_GRID = 4
const BROW_COLS = 9
const BROW_VERTS = BROW_COLS * 2

export interface OverlayBrow {
  side: 1 | -1
  /** Rest centre of the brow (face-plane coords) and its length/thickness. */
  cx: number
  cy: number
  length: number
  thickness: number
  vertexStart: number
  /** Baked surface depth at 3 heights for each column. */
  depth: Float32Array
  heights: number[]
}

export type DecalKind =
  | 'blushA' | 'blushB' | 'bagA' | 'bagB' | 'nose' | 'forehead' | 'cheekA' | 'cheekB' | 'pallor'
  | 'creaseA' | 'creaseB' | 'furrow' | 'noseWrinkle'

export interface OverlayDecal {
  kind: DecalKind
  vertexStart: number
  vertexCount: number
  color: THREE.Color
  alpha: number
}

export interface DecalSpec {
  kind: DecalKind
  /** Face-plane centre, half extents (x, y) and rotation (radians, about the face normal). */
  x: number
  y: number
  hw: number
  hh: number
  rot: number
  /** 'blob' soft radial or 'line' crease strip. */
  sprite: 'blob' | 'line'
  color: string
}

export interface FaceOverlay {
  mesh: THREE.Mesh
  positions: THREE.BufferAttribute
  colors: THREE.BufferAttribute
  brows: OverlayBrow[]
  decals: Map<DecalKind, OverlayDecal>
  /** Decals in insertion order (allocation-free iteration). */
  decalList: OverlayDecal[]
  decalKinds: DecalKind[]
  /** Shape signature of the brows, to skip redundant uploads. */
  lastBrow: Float32Array
  lastColor: Float32Array
  basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }
  browColor: THREE.Color
  radius: number
}

export function createOverlay(options: {
  material: THREE.Material
  radius: number
  basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }
  browSpecs: Array<{ side: 1 | -1; cx: number; cy: number; length: number; thickness: number }>
  depthAt: (x: number, y: number) => number
  decalSpecs: DecalSpec[]
  browColor: THREE.Color
}): FaceOverlay {
  const { radius, basis } = options
  const browVerts = options.browSpecs.length * BROW_VERTS
  const decalVerts = options.decalSpecs.reduce((sum, spec) => sum + (spec.sprite === 'line' ? 2 * 6 : BLOB_GRID * BLOB_GRID), 0)
  const total = browVerts + decalVerts
  const positions = new THREE.BufferAttribute(new Float32Array(total * 3), 3)
  const colors = new THREE.BufferAttribute(new Float32Array(total * 4), 4)
  const uvs = new THREE.BufferAttribute(new Float32Array(total * 2), 2)
  const normals = new THREE.BufferAttribute(new Float32Array(total * 3), 3)
  positions.setUsage(THREE.DynamicDrawUsage)
  colors.setUsage(THREE.DynamicDrawUsage)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', positions)
  geometry.setAttribute('color', colors)
  geometry.setAttribute('uv', uvs)
  geometry.setAttribute('normal', normals)
  const index: number[] = []
  const uvArray = uvs.array as Float32Array
  const normalArray = normals.array as Float32Array
  for (let i = 0; i < total; i += 1) {
    normalArray[i * 3] = basis.forward.x
    normalArray[i * 3 + 1] = basis.forward.y
    normalArray[i * 3 + 2] = basis.forward.z
  }

  const brows: OverlayBrow[] = []
  let cursor = 0
  for (const spec of options.browSpecs) {
    // Sample the surface on a finer grid (5 heights) and keep the front-most depth of the
    // neighbouring columns, so the ribbon rides over the facets of a low-poly head instead of
    // sinking behind them as it moves.
    const heights = [spec.cy - radius * 0.5, spec.cy - radius * 0.15, spec.cy + radius * 0.2, spec.cy + radius * 0.65, spec.cy + radius * 1.1]
    const depth = new Float32Array(BROW_COLS * heights.length)
    const reach = radius * 0.2
    for (let c = 0; c < BROW_COLS; c += 1) {
      const s01 = c / (BROW_COLS - 1)
      const x = spec.cx + spec.side * (s01 - 0.5) * spec.length
      for (let k = 0; k < heights.length; k += 1) {
        depth[c * heights.length + k] = Math.max(
          options.depthAt(x, heights[k]!), options.depthAt(x - reach, heights[k]!), options.depthAt(x + reach, heights[k]!)
        )
      }
    }
    brows.push({ ...spec, vertexStart: cursor, depth, heights })
    for (let c = 0; c < BROW_COLS; c += 1) {
      const s = c / (BROW_COLS - 1)
      uv(RECT.brow, s, 0, uvArray, (cursor + c * 2) * 2)
      uv(RECT.brow, s, 1, uvArray, (cursor + c * 2 + 1) * 2)
      if (c < BROW_COLS - 1) {
        const a = cursor + c * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    cursor += BROW_VERTS
  }

  const decals = new Map<DecalKind, OverlayDecal>()
  const array = positions.array as Float32Array
  const place = (o: number, x: number, y: number, depth: number) => {
    array[o] = basis.right.x * x + basis.up.x * y + basis.forward.x * depth
    array[o + 1] = basis.right.y * x + basis.up.y * y + basis.forward.y * depth
    array[o + 2] = basis.right.z * x + basis.up.z * y + basis.forward.z * depth
  }
  const eps = radius * 0.06
  for (const spec of options.decalSpecs) {
    const cos = Math.cos(spec.rot)
    const sin = Math.sin(spec.rot)
    const point = (lx: number, ly: number) => {
      const x = spec.x + lx * cos - ly * sin
      const y = spec.y + lx * sin + ly * cos
      // Take the front-most surface in a small neighbourhood so the decal floats over the nose
      // slab and cheekbones instead of being clipped into hard-edged shapes.
      const reach = radius * 0.22
      const depth = Math.max(
        options.depthAt(x, y), options.depthAt(x + reach, y), options.depthAt(x - reach, y),
        options.depthAt(x, y + reach), options.depthAt(x, y - reach)
      )
      return { x, y, depth: depth + eps }
    }
    const start = cursor
    if (spec.sprite === 'blob') {
      // A small grid so the decal follows the bumps of the face (nose, cheekbones) instead of cutting into them.
      for (let j = 0; j < BLOB_GRID; j += 1) {
        for (let i = 0; i < BLOB_GRID; i += 1) {
          const u = i / (BLOB_GRID - 1)
          const v = j / (BLOB_GRID - 1)
          const p = point(-spec.hw + 2 * spec.hw * u, spec.hh - 2 * spec.hh * v)
          const vi = start + j * BLOB_GRID + i
          place(vi * 3, p.x, p.y, p.depth)
          uv(RECT.blob, u, v, uvArray, vi * 2)
          if (i < BLOB_GRID - 1 && j < BLOB_GRID - 1) {
            const a = vi
            index.push(a, a + BLOB_GRID, a + 1, a + 1, a + BLOB_GRID, a + BLOB_GRID + 1)
          }
        }
      }
      cursor += BLOB_GRID * BLOB_GRID
    } else {
      // A bent strip: 6 columns along local x, 2 rows; the bend follows `bend`.
      for (let c = 0; c < 6; c += 1) {
        const t = c / 5
        const lx = (t * 2 - 1) * spec.hw
        const bendY = Math.sin(t * Math.PI) * spec.hh * 0.5
        for (let r = 0; r < 2; r += 1) {
          const ly = (r === 0 ? 1 : -1) * spec.hh * 0.5 + bendY
          const p = point(lx, ly)
          const vi = start + c * 2 + r
          place(vi * 3, p.x, p.y, p.depth)
          uv(RECT.line, t, r, uvArray, vi * 2)
        }
        if (c < 5) {
          const a = start + c * 2
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      cursor += 12
    }
    decals.set(spec.kind, { kind: spec.kind, vertexStart: start, vertexCount: spec.sprite === 'line' ? 12 : BLOB_GRID * BLOB_GRID, color: new THREE.Color(spec.color), alpha: 0 })
  }
  geometry.setIndex(index)
  const mesh = new THREE.Mesh(geometry, options.material)
  mesh.name = 'cartoon-face-overlay'
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  positions.needsUpdate = true
  uvs.needsUpdate = true
  normals.needsUpdate = true
  return {
    mesh, positions, colors, brows, decals,
    decalList: Array.from(decals.values()),
    decalKinds: Array.from(decals.keys()),
    lastBrow: new Float32Array(16).fill(99),
    lastColor: new Float32Array(48).fill(-1),
    basis, browColor: options.browColor.clone(), radius,
  }
}

export interface BrowParams {
  /** Inner / outer height per side, -1..1 (index 0 = brows[0]). */
  inner: [number, number]
  outer: [number, number]
  arch: number
  furrow: number
  /** Extra downward push (blinks, squints) per side. */
  dip: [number, number]
  thick: number
}

function lerpDepth(depth: Float32Array, col: number, heights: number[], y: number) {
  const n = heights.length
  const o = col * n
  if (y <= heights[0]!) return depth[o]!
  for (let k = 1; k < n; k += 1) {
    if (y <= heights[k]!) {
      const t = (y - heights[k - 1]!) / (heights[k]! - heights[k - 1]!)
      // Front-most of the two neighbours (not a straight blend): never dips between facets.
      return Math.max(depth[o + k - 1]! * (1 - t) + depth[o + k]! * t, Math.min(depth[o + k - 1]!, depth[o + k]!) + Math.abs(depth[o + k]! - depth[o + k - 1]!) * 0.5)
    }
  }
  return depth[o + n - 1]!
}

const browSig = new Float32Array(9)
const browCx = new Float32Array(BROW_COLS)
const browCy = new Float32Array(BROW_COLS)

/** Rebuilds brow ribbon vertices when the brows moved enough. */
export function updateBrows(overlay: FaceOverlay, p: BrowParams) {
  const last = overlay.lastBrow
  const sig = browSig
  sig[0] = p.inner[0]; sig[1] = p.inner[1]; sig[2] = p.outer[0]; sig[3] = p.outer[1]; sig[4] = p.arch
  sig[5] = p.furrow; sig[6] = p.dip[0]; sig[7] = p.dip[1]; sig[8] = p.thick
  let delta = 0
  for (let i = 0; i < 9; i += 1) delta += Math.abs(last[i]! - sig[i]!)
  if (delta < 0.004) return
  for (let i = 0; i < 9; i += 1) last[i] = sig[i]!

  const r = overlay.radius
  const { right, up, forward } = overlay.basis
  const array = overlay.positions.array as Float32Array
  const cx = browCx
  const cy = browCy
  for (let bi = 0; bi < overlay.brows.length; bi += 1) {
    const brow = overlay.brows[bi]!
    const inner = p.inner[bi]!
    const outer = p.outer[bi]!
    const up1 = (v: number) => (v >= 0 ? v * 0.52 : v * 0.3) * r
    for (let c = 0; c < BROW_COLS; c += 1) {
      const s = c / (BROW_COLS - 1)
      const inW = Math.pow(1 - s, 1.4)
      const outW = Math.pow(s, 1.4)
      const archBase = 0.13 * r * Math.sin(Math.PI * Math.pow(s, 0.85)) * (1 + p.arch)
      const furrowIn = p.furrow * Math.pow(1 - s, 2)
      const x = brow.cx + brow.side * ((s - 0.5) * brow.length - furrowIn * 0.16 * r)
      const y = brow.cy + archBase + up1(inner) * inW + up1(outer) * outW - furrowIn * 0.1 * r - p.dip[bi]! * r * 0.1
      cx[c] = x
      cy[c] = y
    }
    for (let c = 0; c < BROW_COLS; c += 1) {
      const s = c / (BROW_COLS - 1)
      const c0 = Math.max(0, c - 1)
      const c1 = Math.min(BROW_COLS - 1, c + 1)
      let tx = (cx[c1]! - cx[c0]!) * brow.side
      let ty = cy[c1]! - cy[c0]!
      const len = Math.hypot(tx, ty) || 1
      tx /= len
      ty /= len
      // Normal pointing up in the face plane (perpendicular to the tangent).
      const nx = -ty * brow.side
      const ny = tx
      // Never thinner than 45% of the base (a steep sad brow must stay a brow, not a hairline).
      const th = Math.max(brow.thickness * 0.5 * 0.45, brow.thickness * p.thick * (1 - 0.52 * Math.pow(s, 1.25)) * (1 + 0.28 * p.furrow * (1 - s)) * 0.5)
      for (let row = 0; row < 2; row += 1) {
        const sign = row === 0 ? 1 : -1
        const x = cx[c]! + nx * th * sign
        const y = cy[c]! + ny * th * sign
        // Lift grows with how far the brow has moved from where it rests.
        const depth = lerpDepth(brow.depth, c, brow.heights, y) + r * (0.05 + 0.06 * Math.min(1, Math.abs(y - brow.cy) / r))
        const o = (brow.vertexStart + c * 2 + row) * 3
        array[o] = right.x * x + up.x * y + forward.x * depth
        array[o + 1] = right.y * x + up.y * y + forward.y * depth
        array[o + 2] = right.z * x + up.z * y + forward.z * depth
      }
    }
  }
  overlay.positions.needsUpdate = true
}

/** Writes brow tint and every decal's colour/alpha; uploads only if something changed. */
export function updateOverlayColors(overlay: FaceOverlay, alphas: Partial<Record<DecalKind, number>>, browAlpha: number, dim: number) {
  const last = overlay.lastColor
  let delta = Math.abs(last[0]! - browAlpha) + Math.abs(last[1]! - dim)
  const kinds = overlay.decalKinds
  for (let i = 0; i < kinds.length; i += 1) delta += Math.abs(last[2 + i]! - (alphas[kinds[i]!] ?? 0))
  if (delta < 0.004) return
  last[0] = browAlpha
  last[1] = dim
  for (let i = 0; i < kinds.length; i += 1) last[2 + i] = alphas[kinds[i]!] ?? 0

  const array = overlay.colors.array as Float32Array
  const browRgb = overlay.browColor
  for (const brow of overlay.brows) {
    for (let v = 0; v < BROW_VERTS; v += 1) {
      const o = (brow.vertexStart + v) * 4
      array[o] = browRgb.r * dim
      array[o + 1] = browRgb.g * dim
      array[o + 2] = browRgb.b * dim
      array[o + 3] = browAlpha
    }
  }
  for (let d = 0; d < overlay.decalList.length; d += 1) {
    const decal = overlay.decalList[d]!
    const a = alphas[decal.kind] ?? 0
    for (let v = 0; v < decal.vertexCount; v += 1) {
      const o = (decal.vertexStart + v) * 4
      array[o] = decal.color.r
      array[o + 1] = decal.color.g
      array[o + 2] = decal.color.b
      array[o + 3] = a
    }
  }
  overlay.colors.needsUpdate = true
}

export function createOverlayMaterial(atlasTexture: THREE.Texture, gradientMap: THREE.Texture | null) {
  const material = new THREE.MeshToonMaterial({
    map: atlasTexture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    gradientMap,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.name = 'avatar-face-overlay'
  return material
}
