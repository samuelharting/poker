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
    relaxed: 0.012 * spreadSign,
    fist: -0.03 * spreadSign,
    open: 0.14 * spreadSign,
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
  finger(-0.0315, [0.037, 0.023, 0.018], 0.0111, [0.26, 0.46, 0.26], [0.62, 0.95, 0.5], [-0.12, -0.18, -0.08], -1),
  finger(-0.0105, [0.041, 0.026, 0.019], 0.0113, [0.36, 0.56, 0.3], [0.7, 0.8, 0.45], [-0.06, -0.1, -0.05], -0.35),
  finger(0.0105, [0.038, 0.024, 0.018], 0.0107, [0.5, 0.64, 0.33], [0.8, 0.85, 0.45], [0.12, 0.1, 0.05], 0.35),
  finger(0.0305, [0.029, 0.018, 0.016], 0.0094, [0.66, 0.72, 0.36], [0.95, 0.9, 0.4], [0.2, 0.18, 0.1], 1),
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
  open: { yaw: [0.92, -0.08, 0], curl: [0, 0, 0.02] },
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

function part(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, mask: readonly [number, number, number], shade: Shade = 1) {
  const piece = geometry.clone()
  piece.applyMatrix4(matrix)
  const position = piece.getAttribute('position')
  const count = position.count
  const colors = new Float32Array(count * 3)
  const shades = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = mask[0]
    colors[index * 3 + 1] = mask[1]
    colors[index * 3 + 2] = mask[2]
    shades[index] = typeof shade === 'number' ? shade : shade(position.getX(index), position.getY(index), position.getZ(index))
  }
  piece.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  piece.setAttribute('shade', new THREE.BufferAttribute(shades, 1))
  piece.deleteAttribute('uv')
  return piece
}

/** A bone from the origin to z = -length (a tapered tube along -Z). */
function boneGeometry(length: number, radiusStart: number, radiusEnd: number) {
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, 9, 1, true)
  // Cylinder axis is Y: lay it along -Z, base (wide end) at the origin.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, 0, -length / 2)
  return geometry
}

function jointGeometry(radius: number) {
  return new THREE.SphereGeometry(radius, 9, 7)
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
    // 0 at the wrist end, 1 across the knuckles.
    const t = Math.min(1, Math.max(0, (-z) / 0.1))
    const width = 0.68 + 0.36 * smoothstep(0.05, 0.85, t)
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

function buildShape(shape: Shape): Built {
  const pieces: THREE.BufferGeometry[] = []
  const identity = tmpA.identity().clone()
  // Flutter is stored as a delta on the relaxed shape: the curls add up.
  const addDelta = shape === 'flutter'
  const curlOf = (spec: FingerSpec, joint: number) =>
    addDelta ? spec.curl.relaxed[joint]! + spec.curl.flutter[joint]! : spec.curl[shape][joint]!
  const fingertip = new THREE.Vector3()
  const thumbTip = new THREE.Vector3()

  // Back of the hand, the heel of the palm and the thumb-side pad.
  const underside = (_x: number, y: number) => (y < -0.004 ? 0.84 : 0.97)
  pieces.push(part(palmGeometry(), new THREE.Matrix4().makeTranslation(0, -0.002, -0.046), SKIN, underside))
  const thenar = new THREE.SphereGeometry(1, 9, 7)
  thenar.scale(0.0205, 0.0135, 0.031)
  pieces.push(part(thenar, new THREE.Matrix4().makeTranslation(-0.028, -0.008, -0.036), SKIN, 0.86))
  const hypothenar = new THREE.SphereGeometry(1, 8, 6)
  hypothenar.scale(0.0135, 0.0105, 0.028)
  pieces.push(part(hypothenar, new THREE.Matrix4().makeTranslation(0.031, -0.007, -0.04), SKIN, 0.86))

  // Fingers: three tapered bones with a ball at each joint, a visible knuckle on the back of the hand.
  FINGERS.forEach((spec, fingerIndex) => {
    const chain = new THREE.Matrix4().makeTranslation(spec.x, 0, PALM_END)
    chain.multiply(tmpB.makeRotationY(spec.spread[shape]))
    const knuckle = jointGeometry(spec.radius * 1.2)
    pieces.push(part(knuckle, new THREE.Matrix4().makeTranslation(spec.x, 0.0035, PALM_END + 0.004), SKIN, 0.98))
    knuckle.dispose()
    for (let joint = 0; joint < 3; joint += 1) {
      chain.multiply(tmpB.makeRotationX(-curlOf(spec, joint)))
      const r0 = spec.radius * (1 - joint * 0.07)
      const r1 = spec.radius * (1 - (joint + 1) * 0.07 - (joint === 2 ? 0.14 : 0))
      const rootShade = joint === 0 ? 0.9 : joint === 1 ? 0.96 : 1
      const joinBall = jointGeometry(r0 * 1.0)
      pieces.push(part(joinBall, chain, SKIN, rootShade))
      joinBall.dispose()
      const bone = boneGeometry(spec.lengths[joint]!, r0, r1)
      pieces.push(part(bone, chain, SKIN, rootShade))
      bone.dispose()
      chain.multiply(tmpB.makeTranslation(0, 0, -spec.lengths[joint]!))
    }
    const tip = jointGeometry(spec.radius * 0.62)
    pieces.push(part(tip, chain, SKIN))
    tip.dispose()
    if (fingerIndex === 0) fingertip.setFromMatrixPosition(chain)
  })

  // Thumb: metacarpal along the edge of the palm, then two phalanges that rest beside the index finger.
  const thumb = THUMB[shape]
  const chain = new THREE.Matrix4().makeTranslation(THUMB_BASE.x, THUMB_BASE.y, THUMB_BASE.z)
  for (let joint = 0; joint < 3; joint += 1) {
    chain.multiply(tmpB.makeRotationY(thumb.yaw[joint]!))
    chain.multiply(tmpB.makeRotationX(-thumb.curl[joint]!))
    const r0 = THUMB_RADII[joint]!
    const r1 = joint === 2 ? r0 * 0.82 : THUMB_RADII[joint + 1]!
    const joinBall = jointGeometry(r0 * 1.05)
    pieces.push(part(joinBall, chain, SKIN, joint === 0 ? 0.9 : 0.98))
    joinBall.dispose()
    const bone = boneGeometry(THUMB_LENGTHS[joint]!, r0, r1)
    pieces.push(part(bone, chain, SKIN, joint === 0 ? 0.9 : 0.98))
    bone.dispose()
    chain.multiply(tmpB.makeTranslation(0, 0, -THUMB_LENGTHS[joint]!))
  }
  const thumbCap = jointGeometry(THUMB_RADII[2] * 0.82)
  pieces.push(part(thumbCap, chain, SKIN))
  thumbCap.dispose()
  thumbTip.setFromMatrixPosition(chain)

  // Wrist, a shirt cuff and a jacket sleeve run back toward the lens (+Z) and out of the bottom of the view.
  // After the turn a cylinder's top is the +Z (lens) end: the sleeve widens toward the camera.
  const alongZ = (length: number, radiusNear: number, radiusFar: number, start: number, radial: number) => {
    const geometry = new THREE.CylinderGeometry(radiusFar, radiusNear, length, radial, 1, false)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0, start + length / 2)
    return geometry
  }
  const wrist = alongZ(0.07, 0.026, 0.029, 0, 12)
  pieces.push(part(wrist, identity, SKIN, 0.95))
  wrist.dispose()
  const cuff = alongZ(0.036, 0.0315, 0.0325, 0.05, 14)
  pieces.push(part(cuff, identity, CUFF, 0.98))
  cuff.dispose()
  // The sleeve darkens with distance so it sinks into the shadow at the bottom of the view.
  const sleeve = alongZ(0.62, 0.0405, 0.058, 0.082, 16)
  pieces.push(part(sleeve, identity, SLEEVE, (_x, _y, z) => 0.96 - 0.62 * smoothstep(0.09, 0.62, z)))
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

export interface HandColors {
  skin: THREE.Color
  sleeve: THREE.Color
  cuff: THREE.Color
}

/** Outline thickness in render pixels (the avatars' ink line at this size). */
const INK_PIXELS = 1.05

/** The cel look (three tones, warm shadow, soft rim, pixel-wide ink), after the colour is known. */
const CEL_FRAGMENT = `#include <opaque_fragment>
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
    // Constant-width ink outline: handFacing^2 falls off linearly in screen space toward a silhouette.
    float handQ = handFacing * handFacing;
    float handEdgePx = handQ / max(fwidth(handQ), 1e-4);
    float handInk = 1.0 - smoothstep(uInkPixels - 0.9, uInkPixels + 0.6, handEdgePx);
    handColor = mix(handColor, vec3(0.07, 0.04, 0.03), handInk);
    gl_FragColor = vec4(handColor, diffuseColor.a);
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
      .replace('#include <opaque_fragment>', CEL_FRAGMENT)
  }
  material.customProgramCacheKey = () => 'first-person-hand-v2'
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
      .replace('#include <opaque_fragment>', CEL_FRAGMENT)
  }
  material.customProgramCacheKey = () => 'first-person-cel-v1'
  return material
}
