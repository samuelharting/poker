import * as THREE from 'three'

/**
 * Hair secondary motion.
 *
 * In these rigs the hair is its own skinned mesh bound 100% to the Head bone,
 * so it cannot lag on its own. At template load (once per model) the hair
 * vertices are re-weighted between the Head bone and one extra joint slot:
 * roots, the parting and anything on the face (beard, moustache, sideburns in
 * front of the ears) stay on the Head, while hanging ends, a ponytail or the
 * tips of a crest shift onto the new slot. Each instance then appends a
 * `HairSway` bone (a child of Head, identity at rest, so the bind pose is
 * untouched) to its shared skeleton. Because the joint lives in the skeleton,
 * the ink outline hull, the shadow pass and the face shading all follow it
 * with no shader changes and no extra draw calls or bone-texture uploads.
 *
 * Each frame the sway bone is a small rotation about the hair's root (pivot),
 * driven by a damped spring: the hair lags the head's angular acceleration (a
 * nod flicks the ends a moment later) and hangs toward gravity when the head
 * tilts. Everything is capped to a few degrees so it never clips the face.
 */

/** Head-local bind units to seat-ish units (bone scale 100 x root scale ~2.34). */
const UNIT = 234

type SwayMode = 'hang' | 'ponytail' | 'crest'

interface HairSwayConfig {
  material: string
  mode: SwayMode
  /** Rotation pivot (seat-ish units, head-local): the hair's root. */
  pivot: [number, number, number]
  /** Most the sway may rotate (rad) about x / z; yaw gets a third. */
  maxAngle: number
  omega: number
  zeta: number
  /** Fraction of the head's tilt the ends hang back toward vertical. */
  gravity: number
  /** Response to the head's angular acceleration (rad per rad/s^2 before the spring). */
  gain: number
  /**
   * Fractions of maxAngle allowed for a forward swing (-x: the ends toward the
   * neck) and a sideways one (z: one side's ends toward the skull). Hair that
   * lies on the head only lifts away from it; free ends swing both ways.
   */
  forward: number
  side: number
}

const CONFIGS: Record<string, HairSwayConfig | undefined> = {
  adventurer: { material: 'Hair', mode: 'hang', pivot: [0, 0.55, -0.04], maxAngle: 0.1, omega: 9.5, zeta: 0.42, gravity: 0.3, gain: 0.9, forward: 0.3, side: 0.45 },
  business_man: { material: 'Hair', mode: 'hang', pivot: [0, 0.55, -0.02], maxAngle: 0.05, omega: 13, zeta: 0.5, gravity: 0.18, gain: 0.7, forward: 0.3, side: 0.45 },
  hoodie: { material: 'Hair', mode: 'hang', pivot: [0, 0.55, -0.02], maxAngle: 0.05, omega: 13, zeta: 0.5, gravity: 0.18, gain: 0.7, forward: 0.3, side: 0.45 },
  casual: { material: 'Hair', mode: 'ponytail', pivot: [0, 0.27, -0.26], maxAngle: 0.26, omega: 7.5, zeta: 0.34, gravity: 0.45, gain: 1.2, forward: 0.6, side: 1 },
  punk: { material: 'Red', mode: 'crest', pivot: [0, 0.3, 0], maxAngle: 0.08, omega: 15, zeta: 0.3, gravity: 0, gain: 0.8, forward: 1, side: 1 },
}

export const HAIR_SWAY_BONE = 'HairSway'

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * How much of a hair vertex follows the sway bone (0 = pinned to the head).
 * Coordinates are head-local in seat-ish units: +y up, +z toward the face.
 */
export function hairSwayWeight(mode: SwayMode, x: number, y: number, z: number): number {
  if (mode === 'crest') {
    // Mohawk: the crest's tips move, its base on the scalp does not. The small
    // red bits on the face (piercings) sit low and in front: pinned.
    if (y < 0.22) return 0
    const r = Math.hypot(x, y - 0.2, z)
    return smoothstep(0.36, 0.64, r)
  }
  // Nothing on the face moves: beard, moustache, sideburns in front of the
  // ears, and the fringe above the eyes (keeps it off the brows and glasses).
  const face = smoothstep(0.02, 0.14, z) * (1 - smoothstep(0.4, 0.5, y))
  const fringe = smoothstep(0.12, 0.24, z)
  const pinned = Math.max(face, fringe)
  if (mode === 'ponytail') {
    // The tail behind the head swings; a little of the lower back hair with it.
    const tail = smoothstep(-0.27, -0.44, z)
    const nape = smoothstep(0.42, 0.12, y) * smoothstep(0.0, -0.22, z) * 0.35
    return Math.max(tail, nape) * (1 - pinned)
  }
  // Hanging hair: the lower it hangs below the crown the more it moves, most at the back.
  const hang = smoothstep(0.52, 0.12, y)
  const back = 0.45 + 0.55 * smoothstep(0.05, -0.24, z)
  return hang * back * (1 - pinned)
}

interface PreparedHair {
  slot: number
  headIndex: number
  config: HairSwayConfig
}

/**
 * Re-weights a model's hair between Head and a new joint slot. Call once per
 * loaded template (the geometry is shared by every instance of the model).
 */
export function prepareHairSwayTemplate(modelKey: string, scene: THREE.Object3D) {
  const config = CONFIGS[modelKey]
  if (!config) return
  scene.updateMatrixWorld(true)
  const matrix = new THREE.Matrix4()
  const v = new THREE.Vector3()
  scene.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!material || material.name !== config.material) return
    const geometry = mesh.geometry
    if (geometry.userData.hairSway) return
    const skinIndex = geometry.getAttribute('skinIndex')
    const skinWeight = geometry.getAttribute('skinWeight')
    const position = geometry.getAttribute('position')
    if (!skinIndex || !skinWeight || !position) return
    const bones = mesh.skeleton.bones
    const headIndex = bones.findIndex(bone => bone.name === 'Head')
    if (headIndex < 0) return
    // Only hair that is rigidly on the head (all of it in these rigs).
    for (let i = 0; i < skinIndex.count; i += 1) {
      for (let k = 0; k < 4; k += 1) {
        const w = skinWeight.getComponent(i, k)
        if (w > 0.001 && skinIndex.getComponent(i, k) !== headIndex) return
      }
    }
    const slot = bones.length
    matrix.multiplyMatrices(mesh.skeleton.boneInverses[headIndex]!, mesh.bindMatrix)
    const indices = new Uint16Array(skinIndex.count * 4)
    const weights = new Float32Array(skinIndex.count * 4)
    let moving = 0
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix).multiplyScalar(UNIT)
      const w = Math.min(1, Math.max(0, hairSwayWeight(config.mode, v.x, v.y, v.z)))
      indices[i * 4] = headIndex
      indices[i * 4 + 1] = slot
      weights[i * 4] = 1 - w
      weights[i * 4 + 1] = w
      if (w > 0.01) moving += 1
    }
    if (moving === 0) return
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
    const prepared: PreparedHair = { slot, headIndex, config }
    geometry.userData.hairSway = prepared
  })
}

interface SwayState {
  bone: THREE.Bone
  config: HairSwayConfig
  pivot: THREE.Vector3
  previousHead: THREE.Quaternion
  previousOmega: THREE.Vector3
  angle: THREE.Vector3
  velocity: THREE.Vector3
  primed: boolean
}

const swayByHead = new WeakMap<THREE.Object3D, SwayState | null>()

/**
 * Appends the sway bone to every skeleton whose hair geometry was re-weighted
 * (once per instance, before the first render). Returns the bone or null.
 */
export function attachHairSway(model: THREE.Object3D): THREE.Bone | null {
  let sway: THREE.Bone | null = null
  const done = new Set<THREE.Skeleton>()
  model.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    const prepared = mesh.geometry.userData.hairSway as PreparedHair | undefined
    if (!prepared) return
    const skeleton = mesh.skeleton
    if (done.has(skeleton)) return
    const head = skeleton.bones[prepared.headIndex]
    if (!head || head.name !== 'Head') return
    if (!sway) {
      sway = new THREE.Bone()
      sway.name = HAIR_SWAY_BONE
      head.add(sway)
      swayByHead.set(head, {
        bone: sway,
        config: prepared.config,
        pivot: new THREE.Vector3(...prepared.config.pivot).divideScalar(UNIT),
        previousHead: new THREE.Quaternion(),
        previousOmega: new THREE.Vector3(),
        angle: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        primed: false,
      })
    }
    if (skeleton.bones.length === prepared.slot) {
      skeleton.bones.push(sway)
      // Skeleton.clone() shares the boneInverses ARRAY with the template (and
      // every other instance): copy it before growing it. The sway bone is an
      // identity child of Head, so the head's bind inverse keeps the rest pose exact.
      const inverses = skeleton.boneInverses.slice(0, prepared.slot)
      inverses.push(inverses[prepared.headIndex]!.clone())
      skeleton.boneInverses = inverses
      skeleton.boneMatrices = new Float32Array(skeleton.bones.length * 16)
      if (skeleton.boneTexture) {
        skeleton.boneTexture.dispose()
        skeleton.boneTexture = null
      }
    } else if (skeleton.bones[prepared.slot] !== sway) {
      // Unexpected layout: pin the extra slot to the head rather than read garbage.
      skeleton.bones[prepared.slot] = head
    }
    done.add(skeleton)
  })
  return sway
}

const headQuaternion = new THREE.Quaternion()
const delta = new THREE.Quaternion()
const omega = new THREE.Vector3()
const accel = new THREE.Vector3()
const gravityLocal = new THREE.Vector3()
const offsetEuler = new THREE.Euler()
const pivotRotated = new THREE.Vector3()
const decomposePosition = new THREE.Vector3()
const decomposeScale = new THREE.Vector3()

/** Advances the hair spring. Call once per frame after the head bone is final. */
export function updateHairSway(head: THREE.Object3D | undefined, dt: number, reducedMotion: boolean) {
  if (!head) return
  let state = swayByHead.get(head)
  if (!state) return
  const { config, angle, velocity, bone } = state
  head.matrixWorld.decompose(decomposePosition, headQuaternion, decomposeScale)
  if (!state.primed || reducedMotion) {
    state.previousHead.copy(headQuaternion)
    state.previousOmega.set(0, 0, 0)
    angle.set(0, 0, 0)
    velocity.set(0, 0, 0)
    state.primed = true
    bone.position.set(0, 0, 0)
    bone.quaternion.identity()
    return
  }
  const step = Math.min(0.05, Math.max(0.001, dt))
  // Head angular velocity in its own frame.
  delta.copy(state.previousHead).invert().multiply(headQuaternion)
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
  const half = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z)
  const rotation = 2 * Math.atan2(half, delta.w)
  if (half > 1e-7) omega.set(delta.x, delta.y, delta.z).multiplyScalar(rotation / half / step)
  else omega.set(0, 0, 0)
  accel.subVectors(omega, state.previousOmega).multiplyScalar(1 / step)
  state.previousOmega.copy(omega)
  state.previousHead.copy(headQuaternion)
  accel.x = Math.max(-40, Math.min(40, accel.x))
  accel.y = Math.max(-40, Math.min(40, accel.y))
  accel.z = Math.max(-40, Math.min(40, accel.z))

  // Gravity in the head frame: hanging ends swing back toward straight down.
  gravityLocal.set(0, -1, 0).applyQuaternion(delta.copy(headQuaternion).invert())
  const down = Math.max(0.2, -gravityLocal.y)
  // (Held to 60% of the cap so a tilted head still leaves room to swing.)
  const hangMax = config.maxAngle * 0.6
  const eqX = Math.max(-hangMax * config.forward, Math.min(hangMax, config.gravity * Math.atan2(-gravityLocal.z, down)))
  const eqZ = Math.max(-hangMax * config.side, Math.min(hangMax * config.side, config.gravity * Math.atan2(gravityLocal.x, down)))

  const w = config.omega
  const k = w * w
  const c = 2 * config.zeta * w
  const g = config.gain
  const h = step / 2
  for (let sub = 0; sub < 2; sub += 1) {
    velocity.x += (k * (eqX - angle.x) - c * velocity.x - g * accel.x) * h
    velocity.y += (k * -angle.y - c * velocity.y - g * 0.4 * accel.y) * h
    velocity.z += (k * (eqZ - angle.z) - c * velocity.z - g * accel.z) * h
    angle.addScaledVector(velocity, h)
  }
  // Soft limits: past the cap the ends stop (no bounce off a wall).
  const max = config.maxAngle
  const maxForward = max * config.forward
  const maxSide = max * config.side
  if (angle.x > max) { angle.x = max; velocity.x = Math.min(0, velocity.x) }
  if (angle.x < -maxForward) { angle.x = -maxForward; velocity.x = Math.max(0, velocity.x) }
  if (angle.y > max / 3) { angle.y = max / 3; velocity.y = Math.min(0, velocity.y) }
  if (angle.y < -max / 3) { angle.y = -max / 3; velocity.y = Math.max(0, velocity.y) }
  if (angle.z > maxSide) { angle.z = maxSide; velocity.z = Math.min(0, velocity.z) }
  if (angle.z < -maxSide) { angle.z = -maxSide; velocity.z = Math.max(0, velocity.z) }
  if (!Number.isFinite(angle.x + angle.y + angle.z + velocity.x + velocity.y + velocity.z)) {
    angle.set(0, 0, 0)
    velocity.set(0, 0, 0)
    state.previousOmega.set(0, 0, 0)
  }
  // Rotate about the pivot: position = P - R P.
  offsetEuler.set(angle.x, angle.y, angle.z, 'XYZ')
  bone.quaternion.setFromEuler(offsetEuler)
  pivotRotated.copy(state.pivot).applyQuaternion(bone.quaternion)
  bone.position.copy(state.pivot).sub(pivotRotated)
}

/** Dev/test: the live sway angles for a head (null when the model has no sway). */
export function getHairSwayAngles(head: THREE.Object3D): THREE.Vector3 | null {
  return swayByHead.get(head)?.angle ?? null
}
