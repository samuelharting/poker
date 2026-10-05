import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * One cel-shaded hand and forearm as a SINGLE mesh: palm, thumb, four fingers,
 * wrist, cuff and sleeve merged into one geometry, with the finger shapes stored
 * as morph targets (relaxed is the base; fist, open, pinch and a small
 * "flutter" for idle drift are blended in). Skin, sleeve and cuff colours come
 * from a vertex-colour mask and three uniforms, so a profile change never
 * rebuilds geometry and both hands share one material: the whole rig is two
 * draw calls. Shading is done in the fragment shader (the avatars' three-tone
 * ramp with a warm shadow band and a pixel-wide ink outline), so the hands read
 * the same in every pose and never depend on the room lights.
 *
 * Local frame (right hand, palm down): the wrist is the origin, the fingers
 * point -Z, the thumb is on -X and the forearm runs back along +Z.
 */

/** Hands are drawn a bit smaller than life so they stay low-profile. */
export const HAND_SCALE = 0.66

export const HAND_MORPH = { fist: 0, open: 1, pinch: 2, flutter: 3 } as const

type Shape = 'relaxed' | 'fist' | 'open' | 'pinch' | 'flutter'
const SHAPES: Shape[] = ['relaxed', 'fist', 'open', 'pinch', 'flutter']

type Curl3 = [number, number, number]

interface FingerSpec {
  x: number
  lengths: Curl3
  radius: number
  /** Curl (rad) at the knuckle, middle and tip joints per shape. */
  curl: Record<Shape, Curl3>
  /** Sideways fan (rad) per shape. */
  spread: Record<Shape, number>
}

/** Where the fingers leave the palm (z). */
const PALM_END = -0.088

const finger = (
  x: number,
  lengths: Curl3,
  radius: number,
  relaxed: Curl3,
  pinch: Curl3,
  flutter: Curl3,
  spreadSign: number
): FingerSpec => ({
  x,
  lengths,
  radius,
  curl: { relaxed, fist: [1.5, 1.8, 1.1], open: [-0.06, 0.02, 0], pinch, flutter },
  spread: {
    relaxed: 0.04 * spreadSign,
    fist: -0.03 * spreadSign,
    open: 0.17 * spreadSign,
    pinch: 0.02 * spreadSign,
    flutter: 0.02 * spreadSign,
  },
})

/**
 * Each finger rests with its own curl (a natural cascade, the little finger
 * curling most) so the hand never looks like a mitten. `flutter` is a delta on
 * the relaxed shape: index and middle lift while ring and little finger tuck.
 */
const FINGERS: FingerSpec[] = [
  finger(-0.0315, [0.037, 0.023, 0.018], 0.0111, [0.18, 0.34, 0.2], [0.62, 0.95, 0.5], [-0.12, -0.18, -0.08], -1),
  finger(-0.0105, [0.041, 0.026, 0.019], 0.0113, [0.24, 0.42, 0.24], [0.7, 0.8, 0.45], [-0.06, -0.1, -0.05], -0.35),
  finger(0.0105, [0.038, 0.024, 0.018], 0.0107, [0.32, 0.5, 0.26], [0.8, 0.85, 0.45], [0.12, 0.1, 0.05], 0.35),
  finger(0.0305, [0.029, 0.018, 0.016], 0.0094, [0.42, 0.56, 0.28], [0.95, 0.9, 0.4], [0.2, 0.18, 0.1], 1),
]

interface ThumbSpec {
  /** Yaw toward -X (rad) and curl toward the palm (rad) at the metacarpal, knuckle and tip joints. */
  yaw: Curl3
  curl: Curl3
}
const THUMB_BASE = new THREE.Vector3(-0.028, -0.008, -0.026)
const THUMB_LENGTHS: Curl3 = [0.042, 0.031, 0.026]
const THUMB_RADII: Curl3 = [0.0145, 0.0128, 0.0114]
const THUMB: Record<Shape, ThumbSpec> = {
  // Rests alongside the index finger, a little out from the hand and slightly curled in.
  relaxed: { yaw: [0.3, -0.16, -0.04], curl: [0.14, 0.22, 0.36] },
  // Wraps over the first two fingers.
  fist: { yaw: [0.2, -0.62, -0.42], curl: [0.28, 0.72, 0.9] },
  open: { yaw: [0.72, -0.06, 0], curl: [0.06, 0.04, 0.06] },
  // The tip meets the index fingertip.
  pinch: { yaw: [0.24, -0.18, -0.02], curl: [0.38, 0.3, 0.3] },
  flutter: { yaw: [0.58, -0.3, -0.1], curl: [0.14, 0.24, 0.36] },
}

/** Vertex-colour mask channel: which uniform colour a vertex takes. */
const SKIN = [1, 0, 0] as const
const SLEEVE = [0, 1, 0] as const
const CUFF = [0, 0, 1] as const

const tmpA = new THREE.Matrix4()
const tmpB = new THREE.Matrix4()

type Shade = number | ((x: number, y: number, z: number) => number)

/**
 * `ink` scales the silhouette hull on this piece (see createHandHullMaterial):
 * pieces that sit in a crease (the knuckle ridge, the thumb pads) push it out
 * less, so it never pokes through the skin there as stray black notches.
 */
function part(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, mask: readonly [number, number, number], shade: Shade = 1, ink = 1) {
  const piece = geometry.clone()
  piece.applyMatrix4(matrix)
  const position = piece.getAttribute('position')
  const count = position.count
  const colors = new Float32Array(count * 3)
  const shades = new Float32Array(count)
  const inks = new Float32Array(count).fill(ink)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = mask[0]
    colors[index * 3 + 1] = mask[1]
    colors[index * 3 + 2] = mask[2]
    shades[index] = typeof shade === 'number' ? shade : shade(position.getX(index), position.getY(index), position.getZ(index))
  }
  piece.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  piece.setAttribute('shade', new THREE.BufferAttribute(shades, 1))
  piece.setAttribute('ink', new THREE.BufferAttribute(inks, 1))
  piece.deleteAttribute('uv')
  return piece
}

function jointGeometry(radius: number) {
  return new THREE.SphereGeometry(radius, 9, 7)
}

/** One cross-section of a swept tube: its frame (the section lies in the frame's XY plane, the tube runs along -Z). */
interface Ring {
  m: THREE.Matrix4
  /** Half-width (x) and half-height (y): fingers are a little wider than they are thick. */
  rx: number
  ry: number
  /** Baked shade on the back (+y) and the pad side (-y) of the section. */
  top: number
  under: number
  /** How much darker the flanks are (0 = none). */
  side?: number
  /** Silhouette hull scale at this section (0 where it is buried in a crease; default 1). */
  ink?: number
}

const TUBE_SIDES = 10
/** Length of the wrist tube (m) the bend is spread over. */
const WRIST_ARC = 0.092
const ringPoint = new THREE.Vector3()

/**
 * A smooth tube through `rings`, closed with a rounded cap after the last one
 * (`cap` long along the last ring's -Z). One continuous surface per digit, so
 * the joints bend like skin instead of reading as a string of beads, and the
 * shared normals give the ink hull a clean silhouette. Same topology for every
 * shape (the morph targets need it).
 */
function tubeGeometry(rings: Ring[], cap: number, mask: readonly [number, number, number]) {
  const sides = TUBE_SIDES
  const count = rings.length * sides + 1
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const shades = new Float32Array(count)
  const inks = new Float32Array(count)
  let vertex = 0
  const write = (point: THREE.Vector3, shade: number, ink: number) => {
    positions[vertex * 3] = point.x
    positions[vertex * 3 + 1] = point.y
    positions[vertex * 3 + 2] = point.z
    colors[vertex * 3] = mask[0]
    colors[vertex * 3 + 1] = mask[1]
    colors[vertex * 3 + 2] = mask[2]
    shades[vertex] = shade
    inks[vertex] = ink
    vertex += 1
  }
  for (const ring of rings) {
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2
      const up = Math.sin(angle)
      const across = Math.cos(angle)
      ringPoint.set(across * ring.rx, up * ring.ry, 0).applyMatrix4(ring.m)
      // The flanks of a digit sit a shade darker, so neighbouring fingers read as
      // separate (a painted valley between them) instead of one paddle.
      const flank = 1 - (ring.side ?? 0) * smoothstep(0.62, 0.98, Math.abs(across))
      write(ringPoint, (ring.under + (ring.top - ring.under) * smoothstep(-0.55, 0.45, up)) * flank, ring.ink ?? 1)
    }
  }
  const last = rings[rings.length - 1]!
  ringPoint.set(0, 0, -cap).applyMatrix4(last.m)
  write(ringPoint, last.top, last.ink ?? 1)
  const indices: number[] = []
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = ring * sides + side
      const d = ring * sides + ((side + 1) % sides)
      const b = a + sides
      const c = d + sides
      indices.push(a, b, c, a, c, d)
    }
  }
  const pole = count - 1
  const lastStart = (rings.length - 1) * sides
  for (let side = 0; side < sides; side += 1) indices.push(lastStart + side, pole, lastStart + ((side + 1) % sides))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('shade', new THREE.BufferAttribute(shades, 1))
  geometry.setAttribute('ink', new THREE.BufferAttribute(inks, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The rounded tip after the last ring: a few shrinking sections so the cap is a dome, not a cone. */
function pushTipRings(rings: Ring[], end: THREE.Matrix4, rx: number, ry: number, top: number, under: number) {
  for (const angle of [0.55, 1.0, 1.32]) {
    const m = end.clone().multiply(tmpB.makeTranslation(0, 0, -Math.sin(angle) * rx * 0.95))
    rings.push({ m, rx: rx * Math.cos(angle), ry: ry * Math.cos(angle), top, under, side: 0.1 })
  }
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** The back of the hand: a rounded slab that is narrow at the wrist and wide across the knuckles. */
function palmGeometry() {
  const palm = new THREE.SphereGeometry(1, 14, 10)
  palm.scale(0.0465, 0.0172, 0.0505)
  const position = palm.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    const z = position.getZ(index)
    // -1 across the knuckles, +1 at the wrist end.
    const zn = z / 0.0505
    // Narrow at the wrist; toward the knuckles the section squares off (an ellipsoid
    // would taper to a point there and leave the outer finger roots poking out of
    // its sides, with gaps that show the dark inside of the hull).
    const front = Math.max(0, -zn)
    const square = 1 / Math.max(0.5, Math.sqrt(Math.max(0, 1 - front * front)))
    const width = (0.7 + 0.3 * smoothstep(1, -0.2, zn)) * (1 + 0.8 * (square - 1))
    position.setY(index, position.getY(index) * (1 + 0.45 * (square - 1)))
    const x = position.getX(index) * width
    // A shallow arch over the metacarpals.
    const arch = 0.0035 * (1 - Math.min(1, Math.abs(x) / 0.045) ** 2)
    position.setX(index, x)
    if (position.getY(index) > 0) position.setY(index, position.getY(index) + arch)
  }
  palm.computeVertexNormals()
  return palm
}

interface Built {
  geometry: THREE.BufferGeometry
  fingertip: THREE.Vector3
  thumbTip: THREE.Vector3
}

/** An explicit pose (the glass grip): curls and fan per finger, the thumb, and a bend of the forearm at the wrist. */
interface PoseOverride {
  curls: readonly Curl3[]
  spreads: readonly number[]
  thumb: ThumbSpec
  /** Forearm bend (rad) about the wrist, toward the little-finger side (+X). */
  wristBend?: number
}

function buildShape(shape: Shape, pose?: PoseOverride): Built {
  const pieces: THREE.BufferGeometry[] = []
  const identity = tmpA.identity().clone()
  // Flutter is stored as a delta on the relaxed shape: the curls add up.
  const addDelta = shape === 'flutter'
  const curlOf = (spec: FingerSpec, joint: number) =>
    pose ? pose.curls[FINGERS.indexOf(spec)]![joint]! : addDelta ? spec.curl.relaxed[joint]! + spec.curl.flutter[joint]! : spec.curl[shape][joint]!
  const wristBend = pose?.wristBend ?? 0
  const fingertip = new THREE.Vector3()
  const thumbTip = new THREE.Vector3()

  // Back of the hand, the heel of the palm and the thumb-side pad.
  const underside = (_x: number, y: number) => (y < -0.004 ? 0.84 : 0.97)
  pieces.push(part(palmGeometry(), new THREE.Matrix4().makeTranslation(0, -0.002, -0.046), SKIN, underside))
  const thenar = new THREE.SphereGeometry(1, 9, 7)
  thenar.scale(0.0205, 0.0135, 0.031)
  pieces.push(part(thenar, new THREE.Matrix4().makeTranslation(-0.028, -0.008, -0.036), SKIN, 0.86, 0.6))
  const hypothenar = new THREE.SphereGeometry(1, 8, 6)
  hypothenar.scale(0.0135, 0.0105, 0.028)
  pieces.push(part(hypothenar, new THREE.Matrix4().makeTranslation(0.031, -0.007, -0.04), SKIN, 0.86, 0.6))
  // One smooth ridge across the knuckles fills the web between the finger roots (separate
  // knuckle balls left dark notches there that read as dirt, not as fingers).
  const knuckles = new THREE.SphereGeometry(1, 14, 7)
  knuckles.scale(0.0435, 0.0128, 0.0145)
  pieces.push(part(knuckles, new THREE.Matrix4().makeTranslation(-0.001, 0.0005, PALM_END + 0.003).multiply(tmpB.makeRotationY(-0.06)), SKIN, (_x, y) => (y < -0.004 ? 0.86 : 0.98), 0.35))

  // Fingers: one smooth tube each, swept through the three joints (each joint's
  // section turned half-way between the bones it joins, so the bend is a curve),
  // slightly flattened sections and a
  // domed tip. Each finger tapers from the knuckle to the tip.
  FINGERS.forEach((spec, fingerIndex) => {
    const chain = new THREE.Matrix4().makeTranslation(spec.x, 0, PALM_END)
    chain.multiply(tmpB.makeRotationY(pose ? pose.spreads[fingerIndex]! : spec.spread[shape]))
    const r = spec.radius
    // Width / thickness of the section along the finger: knuckle, mid-phalanges, the two finger joints, the tip.
    const radiusAt = (u: number) => r * (1 - 0.2 * u + 0.035 * Math.max(0, 1 - Math.abs(u - 0.47) / 0.08) + 0.03 * Math.max(0, 1 - Math.abs(u - 0.78) / 0.07))
    const total = spec.lengths[0]! + spec.lengths[1]! + spec.lengths[2]!
    const rings: Ring[] = []
    // Buried root inside the palm, so the finger grows out of it without a seam.
    rings.push({ m: chain.clone().multiply(tmpB.makeTranslation(0, -0.002, 0.022)), rx: r * 1.12, ry: r * 0.86, top: 0.97, under: 0.84, ink: 0 })
    let along = 0
    for (let joint = 0; joint < 3; joint += 1) {
      const curl = curlOf(spec, joint)
      const length = spec.lengths[joint]!
      const u0 = along / total
      const root = joint === 0 ? 0.93 : 1
      // The joint section, turned half-way into the bend.
      const half = chain.clone().multiply(tmpB.makeRotationX(-curl / 2))
      rings.push({ m: half, rx: radiusAt(u0) * 1.1, ry: radiusAt(u0) * 0.9, top: root, under: 0.86, side: joint === 0 ? 0.12 : 0.26, ink: joint === 0 ? 0.35 : 1 })
      chain.multiply(tmpB.makeRotationX(-curl))
      for (const f of [0.34, 0.68]) {
        const u = (along + length * f) / total
        rings.push({ m: chain.clone().multiply(tmpB.makeTranslation(0, 0, -length * f)), rx: radiusAt(u) * 1.08, ry: radiusAt(u) * 0.86, top: 1, under: 0.88, side: 0.26, ink: joint === 0 && f < 0.5 ? 0.8 : 1 })
      }
      chain.multiply(tmpB.makeTranslation(0, 0, -length))
      along += length
    }
    const tipRx = radiusAt(1) * 1.06
    const tipRy = radiusAt(1) * 0.84
    rings.push({ m: chain.clone(), rx: tipRx, ry: tipRy, top: 1, under: 0.9, side: 0.2 })
    pushTipRings(rings, chain, tipRx, tipRy, 1, 0.92)
    const tube = tubeGeometry(rings, tipRx * 0.95 * (1 - Math.sin(1.32)) + 0.0005, SKIN)
    pieces.push(tube)
    if (fingerIndex === 0) fingertip.setFromMatrixPosition(chain.clone().multiply(tmpB.makeTranslation(0, 0, -tipRx * 0.5)))
  })

  // Thumb: the same kind of tube, from inside the thenar pad (metacarpal along
  // the edge of the palm) through two phalanges that rest beside the index finger.
  const thumb = pose ? pose.thumb : THUMB[shape]
  const chain = new THREE.Matrix4().makeTranslation(THUMB_BASE.x, THUMB_BASE.y, THUMB_BASE.z)
  const thumbRings: Ring[] = []
  thumbRings.push({ m: chain.clone().multiply(tmpB.makeRotationY(thumb.yaw[0]!)).multiply(tmpB.makeTranslation(0, 0, 0.012)), rx: THUMB_RADII[0] * 1.05, ry: THUMB_RADII[0] * 0.92, top: 0.92, under: 0.84, ink: 0 })
  for (let joint = 0; joint < 3; joint += 1) {
    const r0 = THUMB_RADII[joint]!
    const half = chain.clone().multiply(tmpB.makeRotationY(thumb.yaw[joint]! / 2)).multiply(tmpB.makeRotationX(-thumb.curl[joint]! / 2))
    if (joint > 0) thumbRings.push({ m: half, rx: r0 * 1.06, ry: r0 * 0.92, top: 0.98, under: 0.88 })
    chain.multiply(tmpB.makeRotationY(thumb.yaw[joint]!))
    chain.multiply(tmpB.makeRotationX(-thumb.curl[joint]!))
    const length = THUMB_LENGTHS[joint]!
    const r1 = joint === 2 ? r0 * 0.84 : THUMB_RADII[joint + 1]!
    for (const f of [0.3, 0.68]) {
      const rr = r0 + (r1 - r0) * f
      // The metacarpal is mostly pad: wide and low.
      const flat = joint === 0 ? 0.86 : 0.9
      thumbRings.push({ m: chain.clone().multiply(tmpB.makeTranslation(0, 0, -length * f)), rx: rr * 1.06, ry: rr * flat, top: joint === 0 ? 0.92 : 0.99, under: 0.86, ink: joint === 0 ? (f < 0.5 ? 0.45 : 0.75) : 1 })
    }
    chain.multiply(tmpB.makeTranslation(0, 0, -length))
  }
  const thumbTipR = THUMB_RADII[2] * 0.84
  thumbRings.push({ m: chain.clone(), rx: thumbTipR * 1.04, ry: thumbTipR * 0.88, top: 1, under: 0.9 })
  pushTipRings(thumbRings, chain, thumbTipR * 1.04, thumbTipR * 0.88, 1, 0.92)
  pieces.push(tubeGeometry(thumbRings, thumbTipR * 1.04 * 0.95 * (1 - Math.sin(1.32)) + 0.0005, SKIN))
  thumbTip.setFromMatrixPosition(chain.clone().multiply(tmpB.makeTranslation(0, 0, -thumbTipR * 0.5)))

  // Wrist, a shirt cuff and a jacket sleeve run back toward the lens (+Z) and out of the bottom of the view.
  // After the turn a cylinder's top is the +Z (lens) end: the sleeve widens toward the camera.
  // Every section is an oval (wider than it is deep), like a real wrist and forearm.
  const alongZ = (length: number, radiusNear: number, radiusFar: number, start: number, radial: number, depth: number) => {
    const geometry = new THREE.CylinderGeometry(radiusFar, radiusNear, length, radial, 1, false)
    geometry.rotateX(Math.PI / 2)
    geometry.scale(1, depth, 1)
    geometry.translate(0, -0.002, start + length / 2)
    return geometry
  }
  // The wrist: a smooth oval tube from inside the heel of the hand to inside the cuff,
  // a little narrower than the palm and filling out toward the forearm (rings run from the
  // cuff toward the hand, the direction tubeGeometry sweeps in).
  // A bent wrist (the glass grip) sweeps the same rings along a circular arc about the inner end.
  const bendFrame = (z: number) => {
    const frame = new THREE.Matrix4().makeTranslation(0, -0.002, z)
    if (!wristBend) return frame
    const arc = Math.max(0, z + 0.022)
    const kappa = wristBend / WRIST_ARC
    const phi = kappa * arc
    frame.makeTranslation((1 - Math.cos(phi)) / kappa, -0.002, -0.022 + Math.sin(phi) / kappa)
    return frame.multiply(tmpB.makeRotationY(phi))
  }
  const wristRing = (z: number, rx: number, ry: number, ink = 1): Ring => ({ m: bendFrame(z), rx, ry, top: 0.95, under: 0.86, ink })
  pieces.push(tubeGeometry([
    wristRing(0.07, 0.0328, 0.0228),
    wristRing(0.035, 0.0312, 0.0212),
    wristRing(0.006, 0.0298, 0.0196, 0.8),
    wristRing(-0.022, 0.028, 0.0165, 0),
  ], 0, SKIN))
  // The cuff and sleeve ride rigidly on the far end of the wrist.
  const forearm = bendFrame(0.07).multiply(new THREE.Matrix4().makeTranslation(0, 0.002, -0.07))
  const cuff = alongZ(0.036, 0.0352, 0.0362, 0.05, 16, 0.76)
  pieces.push(part(cuff, identity, CUFF, 0.98).applyMatrix4(forearm))
  cuff.dispose()
  // The sleeve darkens with distance so it sinks into the shadow at the bottom of the view.
  const sleeve = alongZ(0.62, 0.0445, 0.064, 0.082, 18, 0.8)
  pieces.push(part(sleeve, identity, SLEEVE, (_x, _y, z) => 0.96 - 0.62 * smoothstep(0.09, 0.62, z)).applyMatrix4(forearm))
  sleeve.dispose()

  const merged = mergeGeometries(pieces, false)
  pieces.forEach(piece => piece.dispose())
  if (!merged) throw new Error('first-person hand geometry failed to merge')
  return { geometry: merged, fingertip, thumbTip }
}

/** Fingertip and thumb-tip positions (hand space) of a shape, for tests and tuning. */
export function getHandShapeTips(shape: Shape): { index: THREE.Vector3; thumb: THREE.Vector3 } {
  const built = buildShape(shape)
  built.geometry.dispose()
  return { index: built.fingertip.clone(), thumb: built.thumbTip.clone() }
}

/** The hand with its finger morph targets; dispose the geometry when done. */
export function buildHandGeometry(): THREE.BufferGeometry {
  const shapes = SHAPES.map(shape => buildShape(shape).geometry)
  const base = shapes[0]!
  const basePosition = base.getAttribute('position')
  const baseNormal = base.getAttribute('normal')
  const positions: THREE.BufferAttribute[] = []
  const normals: THREE.BufferAttribute[] = []
  for (let index = 1; index < shapes.length; index += 1) {
    const position = shapes[index]!.getAttribute('position')
    const normal = shapes[index]!.getAttribute('normal')
    const dp = new Float32Array(position.count * 3)
    const dn = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count * 3; i += 1) {
      dp[i] = (position.array[i] as number) - (basePosition.array[i] as number)
      dn[i] = (normal.array[i] as number) - (baseNormal.array[i] as number)
    }
    positions.push(new THREE.BufferAttribute(dp, 3))
    normals.push(new THREE.BufferAttribute(dn, 3))
  }
  base.morphAttributes.position = positions
  base.morphAttributes.normal = normals
  base.morphTargetsRelative = true
  for (let index = 1; index < shapes.length; index += 1) shapes[index]!.dispose()
  base.computeBoundingSphere()
  return base
}

// ---------------------------------------------------------------------------
// The glass grip
// ---------------------------------------------------------------------------

/**
 * What the glass-holding hand wraps: a vertical cylinder (the glass, or the bar
 * of a mug handle) described in hand space. The hand is built "thumb up, palm
 * toward the glass": its X axis runs along the cylinder, the fingers lie one
 * above the other and each curls around it.
 */
export interface GripSpec {
  /** Radius of the cylinder (hand-space units, metres at hand scale 1). */
  radius: number
  /** Where the cylinder's axis crosses the hand's YZ plane: y (negative is toward the palm side) and z (negative is toward the fingers). */
  axis: readonly [number, number]
  /** The thumb joints for this grip (the thumb is posed by hand, the fingers are solved). */
  thumb: ThumbSpec
  /** Fan of the fingers (rad). */
  spread?: number
  /** Bend of the forearm at the wrist (rad, toward the little-finger side). */
  wristBend?: number
}

/** Finger joint positions in the hand's (y, z) plane and the curls that put them on the cylinder. */
export interface GripWrap {
  curl: Curl3
  /** Knuckle, first joint, second joint and tip centre lines. */
  points: Array<[number, number]>
  /** Distance the finger centre lines keep from the cylinder axis. */
  distance: number
}

/** Joint positions (hand (y, z) plane) of a finger with these curls, from the knuckle. */
function fingerPoints(lengths: Curl3, curl: Curl3): Array<[number, number]> {
  const points: Array<[number, number]> = [[0, PALM_END]]
  let heading = 0
  for (let joint = 0; joint < 3; joint += 1) {
    heading += curl[joint]!
    const last = points[joint]!
    // Heading `a` points from -Z toward -Y: (y, z) = (-sin a, -cos a).
    points.push([last[0] - Math.sin(heading) * lengths[joint]!, last[1] - Math.cos(heading) * lengths[joint]!])
  }
  return points
}

/**
 * Curls that lay one finger's joints on a circle of radius `distance` about
 * `center` (the cylinder axis in the hand's (y, z) plane), so the bones wrap the
 * glass instead of cutting through it. A small direct search: the finger is a
 * three-link chain, the circle a target for its three free joints, and a joint
 * inside the circle (in the glass) costs more than one outside it.
 */
function wrapFinger(spec: FingerSpec, center: readonly [number, number], distance: number): GripWrap {
  const loss = (curl: Curl3) => {
    const points = fingerPoints(spec.lengths, curl)
    let total = 0
    for (let joint = 1; joint <= 3; joint += 1) {
      const error = Math.hypot(points[joint]![0] - center[0], points[joint]![1] - center[1]) - distance
      total += (error < 0 ? 4 : 1) * error * error
    }
    // Stay near a natural fist-like curl when several answers fit.
    return total + 1e-6 * (curl[0] * curl[0] + curl[1] * curl[1] + curl[2] * curl[2])
  }
  let best: Curl3 = [0.9, 0.9, 0.6]
  let bestLoss = Number.POSITIVE_INFINITY
  for (let c0 = 0; c0 <= 1.9; c0 += 0.1) {
    for (let c1 = 0; c1 <= 1.9; c1 += 0.1) {
      for (let c2 = 0; c2 <= 1.5; c2 += 0.1) {
        const value = loss([c0, c1, c2])
        if (value < bestLoss) { bestLoss = value; best = [c0, c1, c2] }
      }
    }
  }
  for (let step = 0.05; step > 0.0004; step *= 0.6) {
    for (let pass = 0; pass < 6; pass += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        for (const sign of [-1, 1]) {
          const next: Curl3 = [best[0], best[1], best[2]]
          next[axis] = Math.max(0, next[axis]! + sign * step)
          const value = loss(next)
          if (value < bestLoss) { bestLoss = value; best = next }
        }
      }
    }
  }
  return { curl: best, points: fingerPoints(spec.lengths, best), distance }
}

/** The solved finger curls for a grip (for the geometry and for tests). */
export function solveGripWrap(spec: GripSpec): GripWrap[] {
  return FINGERS.map(finger => wrapFinger(finger, spec.axis, spec.radius + finger.radius * 0.9 + 0.0008))
}

const scaleCurl = (curl: Curl3, factor: number): Curl3 => [curl[0] * factor, curl[1] * factor, curl[2] * factor]
const scaleThumb = (thumb: ThumbSpec, factor: number): ThumbSpec => ({ yaw: thumb.yaw, curl: scaleCurl(thumb.curl, factor) })

/** Morph targets of the grip hand: a slack hold, a squeeze, the index and thumb lifted off, and the little fingers tapping. */
export const GRIP_MORPH = { loose: 0, tight: 1, lift: 2, tap: 3 } as const

type GripVariant = keyof typeof GRIP_MORPH | 'grip'

function gripPose(spec: GripSpec, variant: GripVariant): PoseOverride {
  const wraps = solveGripWrap(spec)
  const spread = spec.spread ?? 0.02
  const factor = (finger: number) => {
    switch (variant) {
      case 'loose': return 0.55
      case 'tight': return 1.1
      case 'lift': return finger === 0 ? 0.2 : finger === 1 ? 0.6 : 1
      case 'tap': return finger >= 2 ? 0.45 : 1
      default: return 1
    }
  }
  return {
    curls: wraps.map((wrap, index) => scaleCurl(wrap.curl, factor(index))),
    spreads: wraps.map((_wrap, index) => (variant === 'loose' ? 1.8 : 1) * spread * [-1, -0.35, 0.35, 1][index]!),
    thumb: variant === 'loose' ? scaleThumb(spec.thumb, 0.55) : variant === 'tight' ? scaleThumb(spec.thumb, 1.08) : variant === 'lift' ? scaleThumb(spec.thumb, 0.3) : spec.thumb,
    wristBend: spec.wristBend ?? 0,
  }
}

/** Relative morph targets (position and normal) from a base shape's geometry. */
function addMorphTargets(base: THREE.BufferGeometry, targets: THREE.BufferGeometry[]) {
  const basePosition = base.getAttribute('position')
  const baseNormal = base.getAttribute('normal')
  const positions: THREE.BufferAttribute[] = []
  const normals: THREE.BufferAttribute[] = []
  for (const target of targets) {
    const position = target.getAttribute('position')
    const normal = target.getAttribute('normal')
    const dp = new Float32Array(position.count * 3)
    const dn = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count * 3; i += 1) {
      dp[i] = (position.array[i] as number) - (basePosition.array[i] as number)
      dn[i] = (normal.array[i] as number) - (baseNormal.array[i] as number)
    }
    positions.push(new THREE.BufferAttribute(dp, 3))
    normals.push(new THREE.BufferAttribute(dn, 3))
    target.dispose()
  }
  base.morphAttributes.position = positions
  base.morphAttributes.normal = normals
  base.morphTargetsRelative = true
}

/**
 * The hand of the glass grip: the same palm, finger and thumb tubes, wrist, cuff
 * and sleeve as the resting hands, posed around a cylinder (see GripSpec) and
 * with four morph targets (GRIP_MORPH). Four targets, like the resting hands, so
 * it draws with the very same shader program. Dispose the geometry when done.
 */
export function buildGripHandGeometry(spec: GripSpec): THREE.BufferGeometry {
  const base = buildShape('relaxed', gripPose(spec, 'grip')).geometry
  const targets = (Object.keys(GRIP_MORPH) as Array<keyof typeof GRIP_MORPH>)
    .sort((a, b) => GRIP_MORPH[a] - GRIP_MORPH[b])
    .map(variant => buildShape('relaxed', gripPose(spec, variant)).geometry)
  addMorphTargets(base, targets)
  base.computeBoundingSphere()
  return base
}

export interface HandColors {
  skin: THREE.Color
  sleeve: THREE.Color
  cuff: THREE.Color
}

/** Outline thickness in render pixels (the avatars' ink line at this size). */
const INK_PIXELS = 1.05

/**
 * The cel look (three tones, warm shadow, soft rim), after the colour is known.
 * `ink` adds a pixel-wide outline from the surface normal (flat one-piece meshes
 * only: on the multi-segment hand it also inks every joint, so the hands get a
 * hull outline instead).
 */
const celFragment = (ink: boolean) => `#include <opaque_fragment>
  {
    vec3 handN = normalize(vNormal);
    vec3 handV = normalize(vViewPosition);
    // Key light from the upper left in front of the hand; three painted tones with soft steps.
    float handNL = dot(handN, normalize(vec3(-0.34, 0.66, 0.68)));
    float handMid = smoothstep(-0.12, 0.02, handNL);
    float handHigh = smoothstep(0.42, 0.56, handNL);
    float handTone = mix(mix(0.56, 0.8, handMid), 0.97, handHigh);
    vec3 handAlbedo = diffuseColor.rgb * vShade;
    // Cel shadows lean warm and a little red, like the avatars' painted skin.
    vec3 handShadowTint = mix(vec3(0.9, 0.74, 0.8), vec3(1.0), handMid);
    vec3 handColor = handAlbedo * handTone * handShadowTint;
    // A soft rim lifts the sleeve and fingers off the dark rail.
    float handFacing = clamp(abs(dot(handN, handV)), 0.0, 1.0);
    handColor += handAlbedo * pow(1.0 - handFacing, 3.0) * 0.1;
${ink ? `    // Constant-width ink outline: handFacing^2 falls off linearly in screen space toward a silhouette.
    float handQ = handFacing * handFacing;
    float handEdgePx = handQ / max(fwidth(handQ), 1e-4);
    float handInk = 1.0 - smoothstep(uInkPixels - 0.9, uInkPixels + 0.6, handEdgePx);
    handColor = mix(handColor, vec3(0.07, 0.04, 0.03), handInk);
` : ''}    gl_FragColor = vec4(handColor, diffuseColor.a);
  }`

/**
 * Cel-shaded material: the avatars' three-tone ramp (shadow, mid, lit) lifted
 * so the darkest band never goes muddy, a warm shadow tint on skin, and a
 * constant-pixel ink outline (#120a07, the avatars' ink) taken from the
 * view-space normal, so no second draw call is needed.
 */
export function createHandMaterial(colors: HandColors): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: '#ffffff',
    vertexColors: true,
    fog: false,
  })
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkin = { value: colors.skin }
    shader.uniforms.uSleeve = { value: colors.sleeve }
    shader.uniforms.uCuff = { value: colors.cuff }
    shader.uniforms.uInkPixels = { value: INK_PIXELS }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shade;\nvarying float vShade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = shade;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSkin;\nuniform vec3 uSleeve;\nuniform vec3 uCuff;\nuniform float uInkPixels;\nvarying float vShade;'
      )
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vColor.r * uSkin + vColor.g * uSleeve + vColor.b * uCuff;')
      .replace('#include <opaque_fragment>', celFragment(false))
  }
  material.customProgramCacheKey = () => 'first-person-hand-v3'
  return material
}

/**
 * The same cel look for a plain single-colour mesh (the glass-holding hand in
 * firstPersonDrink.ts), so every first-person hand shades and outlines alike.
 */
export function createCelMaterial(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color, fog: false })
  material.onBeforeCompile = shader => {
    shader.uniforms.uInkPixels = { value: INK_PIXELS }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uInkPixels;\nconst float vShade = 1.0;')
      .replace('#include <opaque_fragment>', celFragment(true))
  }
  material.customProgramCacheKey = () => 'first-person-cel-v1'
  return material
}

/** Depth push of the hull (metres): see createHandHullMaterial. */
export const HULL_DEPTH_BACK = 0.0035

/** The avatars' ink colour (#120a07). */
export const HAND_INK_COLOR = '#120a07'

export interface HandHullMaterial {
  material: THREE.MeshBasicMaterial
  /** How far the hull is pushed out along the normals (hand-space units). */
  width: { value: number }
  /** How far the hull's depth is pushed back from the lens (metres), so contacts between digits stay un-inked. */
  back: { value: number }
}

/**
 * The hand's silhouette ink: the same geometry again, pushed out along its
 * (morphed) normals and drawn back-faces only, like the avatars' inverted-hull
 * outline. Only the outer silhouette shows, so there are no ink lines at the
 * joints between finger segments. One extra draw call per hand.
 */
export function createHandHullMaterial(): HandHullMaterial {
  const width = { value: 0.002 }
  const back = { value: HULL_DEPTH_BACK }
  const material = new THREE.MeshBasicMaterial({ color: HAND_INK_COLOR, side: THREE.BackSide, fog: false })
  material.onBeforeCompile = shader => {
    shader.uniforms.uHullWidth = width
    shader.uniforms.uHullBack = back
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHullWidth;\nuniform float uHullBack;\nattribute float ink;')
      .replace('#include <begin_vertex>', '#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <begin_vertex>')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n  transformed += normalize(objectNormal) * uHullWidth * ink;')
      // Depth only, a few millimetres back: where the hull of one digit cuts into a
      // neighbour it is touching (thumb against the index, curled fingers in a fist) the
      // skin wins, so only real outlines stay inked, never stray notches.
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vec4 hullBack = projectionMatrix * vec4(mvPosition.xy, mvPosition.z - uHullBack, 1.0);\n  gl_Position.z = hullBack.z / hullBack.w * gl_Position.w;'
      )
  }
  material.name = 'first-person-hand-ink'
  material.customProgramCacheKey = () => 'first-person-hand-hull-v3'
  return { material, width, back }
}

/**
 * Hull push-out (hand-space units) that draws an ink line `pixels` wide on
 * screen for a hand drawn `depth` metres from the lens.
 */
export function getHullWidth(pixels: number, renderHeightPx: number, depth: number, tanHalfFov: number): number {
  const pixelsPerMetre = renderHeightPx / (2 * Math.max(0.05, depth) * tanHalfFov)
  return pixels / (pixelsPerMetre * HAND_SCALE)
}
