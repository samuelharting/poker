import * as THREE from 'three'

/**
 * The mouth: ONE dynamic vertex-coloured mesh (a single draw) holding
 *   upper lip (3 rows) | teeth | dark cavity | tongue | lower lip (3 rows)
 * as stacked bands across 13 columns. Mouth corners can lift independently
 * (smirks), the jaw slides sideways, lips press thin or pout, and the gap opens
 * to reveal a row of teeth and a tongue. The mesh hugs the face: each column is
 * placed at the measured skin depth, so it never floats or sinks.
 */

export interface MouthShape {
  /** Corner lift, -1 frown .. +1 smile (character-left / character-right of the mesh, i.e. -x / +x). */
  cornerL: number
  cornerR: number
  /** 0 closed .. 1 wide open. */
  open: number
  /** Width scale (1 = resting). */
  width: number
  /** 0..1 thin pressed lips. */
  press: number
  /** 0..1 pursed / pouting lips. */
  purse: number
  /** 0..1 upper teeth shown. */
  teeth: number
  /** -1..1 sideways jaw shift. */
  shift: number
}

const COLS = 13
const BANDS = {
  upperLip: { rows: 3 },
  teeth: { rows: 2 },
  cavity: { rows: 2 },
  tongue: { rows: 2 },
  lowerLip: { rows: 3 },
}
const ROWS_TOTAL = BANDS.upperLip.rows + BANDS.teeth.rows + BANDS.cavity.rows + BANDS.tongue.rows + BANDS.lowerLip.rows
const VERTS = ROWS_TOTAL * COLS

export interface FaceMouth {
  mesh: THREE.Mesh
  positions: THREE.BufferAttribute
  colors: THREE.BufferAttribute
  /** Half width of the resting mouth (Head units). */
  halfWidth: number
  /** Lip thickness scale (Head units). */
  lip: number
  /** Skin depth (along forward) per column at the mouth, baked. */
  colDepth: Float32Array
  origin: THREE.Vector3
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  /** Last written shape/colour signature, to skip redundant uploads. */
  last: Float32Array
  lipColor: THREE.Color
  skinColor: THREE.Color
  /** When facial hair sits over the mouth, lips blend towards it. */
  hairColor: THREE.Color | null
  toneAmount: number
  /** A moustache/beard sits over the mouth: keep the mouth tame so it never pokes past it. */
  facialHair: boolean
}

const CAVITY = new THREE.Color('#2a0c0c')
const TEETH = new THREE.Color('#ece6d6')
const TONGUE = new THREE.Color('#b0545a')
const LINE = new THREE.Color('#3a1512')
const ROSE = new THREE.Color('#a8474c')

function bandStart(band: keyof typeof BANDS) {
  let row = 0
  for (const key of Object.keys(BANDS) as Array<keyof typeof BANDS>) {
    if (key === band) return row
    row += BANDS[key].rows
  }
  return row
}

const START = {
  upperLip: bandStart('upperLip'),
  teeth: bandStart('teeth'),
  cavity: bandStart('cavity'),
  tongue: bandStart('tongue'),
  lowerLip: bandStart('lowerLip'),
}

export function createMouthGeometry() {
  const geometry = new THREE.BufferGeometry()
  const positions = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3)
  const colors = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3)
  const normals = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3)
  positions.setUsage(THREE.DynamicDrawUsage)
  colors.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positions)
  geometry.setAttribute('color', colors)
  geometry.setAttribute('normal', normals)
  const indices: number[] = []
  const strip = (firstRow: number, rows: number) => {
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < COLS - 1; c += 1) {
        const a = (firstRow + r) * COLS + c
        const b = a + 1
        const d = a + COLS
        const e = d + 1
        indices.push(a, d, b, b, d, e)
      }
    }
  }
  strip(START.upperLip, BANDS.upperLip.rows)
  strip(START.teeth, BANDS.teeth.rows)
  strip(START.cavity, BANDS.cavity.rows)
  strip(START.tongue, BANDS.tongue.rows)
  strip(START.lowerLip, BANDS.lowerLip.rows)
  geometry.setIndex(indices)
  return { geometry, positions, colors, normals }
}

export function createMouth(options: {
  geometry: THREE.BufferGeometry
  positions: THREE.BufferAttribute
  colors: THREE.BufferAttribute
  normals: THREE.BufferAttribute
  material: THREE.Material
  halfWidth: number
  lip: number
  origin: THREE.Vector3
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  colDepth: Float32Array
  skinColor: THREE.Color
  hairColor: THREE.Color | null
  toneAmount: number
  facialHair?: boolean
}): FaceMouth {
  const mesh = new THREE.Mesh(options.geometry, options.material)
  mesh.name = 'cartoon-mouth'
  mesh.frustumCulled = false
  const normals = options.normals.array as Float32Array
  for (let i = 0; i < VERTS; i += 1) {
    normals[i * 3] = options.forward.x
    normals[i * 3 + 1] = options.forward.y
    normals[i * 3 + 2] = options.forward.z
  }
  options.normals.needsUpdate = true
  return {
    mesh,
    positions: options.positions,
    colors: options.colors,
    halfWidth: options.halfWidth,
    lip: options.lip,
    colDepth: options.colDepth,
    origin: options.origin.clone(),
    forward: options.forward,
    right: options.right,
    up: options.up,
    last: new Float32Array(16).fill(99),
    lipColor: new THREE.Color(),
    skinColor: options.skinColor.clone(),
    hairColor: options.hairColor,
    toneAmount: options.toneAmount,
    facialHair: Boolean(options.facialHair),
  }
}

// Per-column constants (the shape function is evaluated for 13 columns every update).
const COL_U = new Float32Array(COLS)
const COL_EDGE = new Float32Array(COLS)
const COL_AU_POW = new Float32Array(COLS)
const COL_EDGE_POW = new Float32Array(COLS)
const COL_BOW = new Float32Array(COLS)
const COL_SQUARE = new Float32Array(COLS)
for (let c = 0; c < COLS; c += 1) {
  const u = (c / (COLS - 1)) * 2 - 1
  const au = Math.abs(u)
  COL_U[c] = u
  COL_EDGE[c] = 1 - au * au
  COL_AU_POW[c] = Math.pow(au, 2.1)
  COL_EDGE_POW[c] = Math.pow(Math.max(1 - au * au, 0), 0.75)
  COL_BOW[c] = 1 - 0.28 * Math.exp(-u * u * 40)
  COL_SQUARE[c] = au
}

const ROWS_Y = new Float32Array(12)
const scratchColor = new THREE.Color()

function setColor(array: Float32Array, row: number, color: THREE.Color, scale = 1) {
  for (let c = 0; c < COLS; c += 1) {
    const o = (row * COLS + c) * 3
    array[o] = color.r * scale
    array[o + 1] = color.g * scale
    array[o + 2] = color.b * scale
  }
}

function setRow(array: Float32Array, row: number, r: number, g: number, b: number) {
  for (let c = 0; c < COLS; c += 1) {
    const o = (row * COLS + c) * 3
    array[o] = r
    array[o + 1] = g
    array[o + 2] = b
  }
}

function writeColors(mouth: FaceMouth, skin: THREE.Color) {
  const array = mouth.colors.array as Float32Array
  mouth.skinColor.copy(skin)
  // Lips: skin pushed towards a rose tone, or towards facial hair when there is some.
  const lip = mouth.lipColor.copy(skin).lerp(ROSE, 0.3 + 0.4 * mouth.toneAmount)
  if (mouth.hairColor) lip.lerp(mouth.hairColor, 0.7).multiplyScalar(0.85)
  const outer = scratchColor.copy(lip).lerp(mouth.hairColor ?? skin, mouth.hairColor ? 0.7 : 0.5)
  const outerR = outer.r
  const outerG = outer.g
  const outerB = outer.b
  // Upper lip: skin-blend, lip, deeper inner edge.
  setRow(array, START.upperLip, outerR, outerG, outerB)
  setRow(array, START.upperLip + 1, lip.r * 0.94, lip.g * 0.94, lip.b * 0.94)
  setRow(array, START.upperLip + 2, lip.r * 0.66, lip.g * 0.62, lip.b * 0.62)
  // Lower lip: deeper inner edge, brighter fuller middle, skin-blend below.
  setRow(array, START.lowerLip, lip.r * 0.7, lip.g * 0.66, lip.b * 0.66)
  setRow(array, START.lowerLip + 1, Math.min(1, lip.r * 1.12), Math.min(1, lip.g * 1.1), Math.min(1, lip.b * 1.1))
  setRow(array, START.lowerLip + 2, outerR, outerG, outerB)
  setColor(array, START.teeth, TEETH)
  setColor(array, START.teeth + 1, TEETH, 0.9)
  setColor(array, START.cavity, CAVITY)
  setColor(array, START.cavity + 1, LINE)
  setColor(array, START.tongue, TONGUE, 0.8)
  setColor(array, START.tongue + 1, TONGUE, 1)
  mouth.colors.needsUpdate = true
}

/** Rewrites geometry (and colours if the skin tone moved) when the shape changed enough. */
export function updateMouth(mouth: FaceMouth, shape: MouthShape, skin: THREE.Color) {
  if (mouth.facialHair) {
    shape.width = Math.min(shape.width, 1.12)
    shape.open = Math.min(shape.open, 0.7)
    shape.cornerL *= 0.9
    shape.cornerR *= 0.9
  }
  const last = mouth.last
  const skinSig = skin.r * 3 + skin.g * 5 + skin.b * 7
  const delta =
    Math.abs(last[0]! - shape.cornerL) + Math.abs(last[1]! - shape.cornerR) + Math.abs(last[2]! - shape.open) +
    Math.abs(last[3]! - shape.width) + Math.abs(last[4]! - shape.press) + Math.abs(last[5]! - shape.purse) +
    Math.abs(last[6]! - shape.teeth) + Math.abs(last[7]! - shape.shift)
  const skinMoved = Math.abs(last[8]! - skinSig) > 0.004
  if (delta < 0.012 && !skinMoved) return
  last[0] = shape.cornerL
  last[1] = shape.cornerR
  last[2] = shape.open
  last[3] = shape.width
  last[4] = shape.press
  last[5] = shape.purse
  last[6] = shape.teeth
  last[7] = shape.shift
  if (skinMoved) {
    last[8] = skinSig
    writeColors(mouth, skin)
  }

  const array = mouth.positions.array as Float32Array
  const W = mouth.halfWidth * shape.width * (1 - 0.22 * shape.purse)
  const T = mouth.lip
  const openH = W * 0.62 * shape.open
  const pressK = 1 - shape.press * 0.5
  const purseK = 1 + shape.purse * 0.55
  const fx = mouth.forward
  const rx = mouth.right
  const ux = mouth.up
  const shift = shape.shift * W * 0.1
  const origin = mouth.origin
  // Column x offsets; the corners of a smile pull outwards a touch.
  for (let c = 0; c < COLS; c += 1) {
    const u = COL_U[c]!
    const au = COL_SQUARE[c]!
    const edge = COL_EDGE[c]!
    const lift = shape.cornerL + (shape.cornerR - shape.cornerL) * ((u + 1) * 0.5)
    const pull = 1 + 0.06 * Math.max(0, u < 0 ? shape.cornerL : shape.cornerR) * au
    const x = u * W * pull + shift * edge
    // Seam: corners lift or sag, the middle stays put; a very slight dip so a
    // resting mouth is not a ruler.
    const seam = lift * COL_AU_POW[c]! * W * 0.46 - edge * T * 0.06 * (1 - shape.open)
    const gap = openH * COL_EDGE_POW[c]!
    const yTopCav = seam + gap * 0.42 + T * 0.055
    const yBotCav = seam - gap * 0.58 - T * 0.055
    const cavity = yTopCav - yBotCav
    // Lip thickness: fuller in the middle, tapering to the corners (cupid's bow dip on the upper).
    const bow = COL_BOW[c]!
    const tU = T * (0.62 + 0.55 * edge) * bow * pressK * purseK
    const tL = T * (0.72 + 0.85 * edge) * pressK * purseK
    const toothH = Math.min(cavity * 0.5, T * 0.95) * Math.min(1, shape.open * 2.2 + shape.teeth)
    const toothVisible = shape.teeth > 0.02 || shape.open > 0.06
    const tongueH = Math.min(cavity * 0.42, cavity * 0.6 * Math.min(1, shape.open * 1.6)) * (1 - au * au)

    const depth = mouth.colDepth[c]!
    const rowsY = ROWS_Y
    const yTeeth = yTopCav - (toothVisible ? toothH : 0)
    // upper lip outer, mid, inner
    rowsY[0] = yTopCav + tU
    rowsY[1] = yTopCav + tU * 0.5
    rowsY[2] = yTopCav
    // teeth
    rowsY[3] = yTopCav
    rowsY[4] = yTeeth
    // cavity
    rowsY[5] = yTeeth
    rowsY[6] = yBotCav + tongueH
    // tongue
    rowsY[7] = yBotCav + tongueH
    rowsY[8] = yBotCav
    // lower lip inner, mid, outer
    rowsY[9] = yBotCav
    rowsY[10] = yBotCav - tL * 0.5
    rowsY[11] = yBotCav - tL
    for (let r = 0; r < ROWS_TOTAL; r += 1) {
      const y = rowsY[r]!
      const o = (r * COLS + c) * 3
      // Head-space point = origin + right*x + up*y + forward*(depthOffset).
      // `depth` is the absolute depth along forward; origin already sits at depth 0 along forward.
      array[o] = origin.x + rx.x * x + ux.x * y + fx.x * depth
      array[o + 1] = origin.y + rx.y * x + ux.y * y + fx.y * depth
      array[o + 2] = origin.z + rx.z * x + ux.z * y + fx.z * depth
    }
  }
  mouth.positions.needsUpdate = true
}
