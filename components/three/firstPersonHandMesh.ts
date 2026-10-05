import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * One toon hand and forearm as a SINGLE mesh: palm, thumb, four fingers, wrist,
 * cuff and sleeve merged into one geometry, with the finger shapes stored as
 * morph targets (relaxed is the base; fist, open and pinch are blended in).
 * Skin, sleeve and cuff colours come from a vertex-colour mask and three
 * uniforms, so a profile change never rebuilds geometry and both hands share
 * one material: the whole rig is two draw calls.
 *
 * Local frame (right hand, palm down): the wrist is the origin, the fingers
 * point -Z, the thumb is on -X and the forearm runs back along +Z.
 */

/** Hands are drawn a bit smaller than life so they stay low-profile. */
export const HAND_SCALE = 0.66

export const HAND_MORPH = { fist: 0, open: 1, pinch: 2 } as const

type Shape = 'relaxed' | 'fist' | 'open' | 'pinch'
const SHAPES: Shape[] = ['relaxed', 'fist', 'open', 'pinch']

interface FingerSpec {
  x: number
  lengths: [number, number, number]
  radius: number
  /** Curl (rad) at the knuckle, middle and tip joints per shape. */
  curl: Record<Shape, [number, number, number]>
  /** Sideways fan (rad) per shape. */
  spread: Record<Shape, number>
}

const PALM_END = -0.092

const finger = (
  x: number,
  lengths: [number, number, number],
  radius: number,
  relaxed: [number, number, number],
  pinch: [number, number, number],
  spreadSign: number
): FingerSpec => ({
  x,
  lengths,
  radius,
  curl: { relaxed, fist: [1.45, 1.75, 1.05], open: [-0.08, 0, 0], pinch },
  spread: { relaxed: 0.03 * spreadSign, fist: -0.02 * spreadSign, open: 0.12 * spreadSign, pinch: 0.02 * spreadSign },
})

const FINGERS: FingerSpec[] = [
  finger(-0.031, [0.04, 0.024, 0.02], 0.0098, [0.32, 0.5, 0.26], [0.62, 0.95, 0.5], -1),
  finger(-0.0105, [0.044, 0.027, 0.021], 0.01, [0.4, 0.55, 0.28], [0.7, 0.8, 0.45], -0.35),
  finger(0.0105, [0.04, 0.025, 0.02], 0.0094, [0.5, 0.6, 0.3], [0.8, 0.85, 0.45], 0.35),
  finger(0.03, [0.032, 0.02, 0.018], 0.0082, [0.62, 0.65, 0.32], [0.95, 0.9, 0.4], 1),
]

interface ThumbSpec {
  yaw: [number, number]
  curl: [number, number]
}
const THUMB: Record<Shape, ThumbSpec> = {
  relaxed: { yaw: [0.78, -0.1], curl: [0.12, 0.22] },
  fist: { yaw: [0.15, -0.75], curl: [0.55, 0.75] },
  open: { yaw: [1.0, 0.05], curl: [0, 0.02] },
  pinch: { yaw: [0.42, -0.34], curl: [0.42, 0.42] },
}

/** Vertex-colour mask channel: which uniform colour a vertex takes. */
const SKIN = [1, 0, 0] as const
const SLEEVE = [0, 1, 0] as const
const CUFF = [0, 0, 1] as const

const tmpA = new THREE.Matrix4()
const tmpB = new THREE.Matrix4()

function part(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, mask: readonly [number, number, number]) {
  const piece = geometry.clone()
  piece.applyMatrix4(matrix)
  const count = piece.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = mask[0]
    colors[index * 3 + 1] = mask[1]
    colors[index * 3 + 2] = mask[2]
  }
  piece.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  piece.deleteAttribute('uv')
  return piece
}

/** A bone from the origin to z = -length (a tapered tube along -Z). */
function boneGeometry(length: number, radiusStart: number, radiusEnd: number) {
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, 8, 1, true)
  // Cylinder axis is Y: lay it along -Z, base (wide end) at the origin.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, 0, -length / 2)
  return geometry
}

function jointGeometry(radius: number) {
  return new THREE.SphereGeometry(radius, 8, 6)
}

function buildShape(shape: Shape): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = []
  const identity = tmpA.identity().clone()

  // Palm and the back of the hand.
  const palm = new THREE.SphereGeometry(1, 12, 8)
  palm.scale(0.043, 0.0165, 0.052)
  pieces.push(part(palm, new THREE.Matrix4().makeTranslation(0, -0.002, -0.046), SKIN))
  const pad = new THREE.SphereGeometry(1, 8, 6)
  pad.scale(0.021, 0.013, 0.03)
  pieces.push(part(pad, new THREE.Matrix4().makeTranslation(-0.03, -0.008, -0.044), SKIN))

  // Fingers: three tapered bones with a ball at each joint.
  for (const spec of FINGERS) {
    const chain = new THREE.Matrix4().makeTranslation(spec.x, 0, PALM_END)
    chain.multiply(tmpB.makeRotationY(spec.spread[shape]))
    for (let joint = 0; joint < 3; joint += 1) {
      chain.multiply(tmpB.makeRotationX(-spec.curl[shape][joint]!))
      const r0 = spec.radius * (1 - joint * 0.1)
      const r1 = spec.radius * (1 - (joint + 1) * 0.1)
      pieces.push(part(jointGeometry(r0 * 1.08), chain, SKIN))
      pieces.push(part(boneGeometry(spec.lengths[joint]!, r0, r1), chain, SKIN))
      chain.multiply(tmpB.makeTranslation(0, 0, -spec.lengths[joint]!))
    }
    pieces.push(part(jointGeometry(spec.radius * 0.72), chain, SKIN))
  }

  // Thumb: from the base of the palm, two bones.
  const thumb = THUMB[shape]
  const chain = new THREE.Matrix4().makeTranslation(-0.034, -0.006, -0.03)
  const thumbLengths = [0.036, 0.03]
  for (let joint = 0; joint < 2; joint += 1) {
    chain.multiply(tmpB.makeRotationY(thumb.yaw[joint]!))
    chain.multiply(tmpB.makeRotationX(-thumb.curl[joint]!))
    const r0 = 0.0125 - joint * 0.0018
    pieces.push(part(jointGeometry(r0 * 1.06), chain, SKIN))
    pieces.push(part(boneGeometry(thumbLengths[joint]!, r0, r0 - 0.0016), chain, SKIN))
    chain.multiply(tmpB.makeTranslation(0, 0, -thumbLengths[joint]!))
  }
  pieces.push(part(jointGeometry(0.0085), chain, SKIN))

  // Wrist, cuff and sleeve run back toward the lens (+Z), out of the bottom of the view.
  const alongZ = (length: number, radiusNear: number, radiusFar: number, start: number, radial: number) => {
    // After the turn the cylinder's top is the +Z (lens) end: the sleeve widens toward the camera.
    const geometry = new THREE.CylinderGeometry(radiusFar, radiusNear, length, radial, 1, false)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0, start + length / 2)
    return geometry
  }
  pieces.push(part(alongZ(0.07, 0.027, 0.03, 0, 10), identity, SKIN))
  pieces.push(part(alongZ(0.026, 0.033, 0.035, 0.062, 12), identity, CUFF))
  pieces.push(part(alongZ(0.62, 0.036, 0.054, 0.082, 14), identity, SLEEVE))

  const merged = mergeGeometries(pieces, false)
  pieces.forEach(piece => piece.dispose())
  if (!merged) throw new Error('first-person hand geometry failed to merge')
  return merged
}

/** The hand with its finger morph targets; dispose the geometry when done. */
export function buildHandGeometry(): THREE.BufferGeometry {
  const shapes = SHAPES.map(buildShape)
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

/** A toon material that reads the vertex-colour mask as skin / sleeve / cuff. */
export function createHandMaterial(colors: HandColors): THREE.MeshToonMaterial {
  const ramp = new THREE.DataTexture(new Uint8Array([105, 180, 255]), 3, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  const material = new THREE.MeshToonMaterial({
    color: '#ffffff',
    gradientMap: ramp,
    vertexColors: true,
    emissive: '#ffffff',
    emissiveIntensity: 0.34,
    fog: false,
  })
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkin = { value: colors.skin }
    shader.uniforms.uSleeve = { value: colors.sleeve }
    shader.uniforms.uCuff = { value: colors.cuff }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSkin;\nuniform vec3 uSleeve;\nuniform vec3 uCuff;')
      .replace(
        '#include <color_fragment>',
        'diffuseColor.rgb = vColor.r * uSkin + vColor.g * uSleeve + vColor.b * uCuff;'
      )
      // The hand sits in the chair's shadow: self-light it by its own colour.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb;')
  }
  material.customProgramCacheKey = () => 'first-person-hand'
  return material
}
