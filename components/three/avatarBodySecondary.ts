import * as THREE from 'three'
import type { AvatarAccessorySet } from './avatarCustomization'

/**
 * Secondary motion: things that ride on the head but are not part of it lag
 * behind it. The hat is a spring-damper driven by the head's angular
 * acceleration (a nod makes the brim dip a moment later and bounce once; a
 * head shake swings it), pivoting about the crown so it stays seated.
 *
 * The hat's meshes are baked into merged meshes by the room (draw-call
 * budget), so the hat is every object under the head accessories group tagged
 * `userData.accessoryKind === 'hat'`. Glasses stay rigid on the face.
 *
 * Hair is skinned rigidly to the Head bone in these models, so it cannot lag
 * without extra bones; only accessories move here.
 */

interface HatPiece {
  object: THREE.Object3D
  basePosition: THREE.Vector3
  baseQuaternion: THREE.Quaternion
}

interface HatState {
  pieces: HatPiece[]
  pivot: THREE.Vector3
  signature: number
  previousHead: THREE.Quaternion
  previousOmega: THREE.Vector3
  angle: THREE.Vector3
  velocity: THREE.Vector3
  primed: boolean
}

const states = new WeakMap<object, HatState>()

const headQuaternion = new THREE.Quaternion()
const delta = new THREE.Quaternion()
const omega = new THREE.Vector3()
const accel = new THREE.Vector3()
const offsetQuaternion = new THREE.Quaternion()
const offsetEuler = new THREE.Euler()
const pivotVector = new THREE.Vector3()
const box = new THREE.Box3()
const pieceBox = new THREE.Box3()
const center = new THREE.Vector3()

/** Spring stiffness (rad/s), damping ratio and the most the hat may swing (rad). */
const HAT_OMEGA = 15
const HAT_ZETA = 0.3
const HAT_MAX = 0.2
/** How strongly the head's angular acceleration throws the hat. */
const HAT_GAIN = 1.1

function createState(): HatState {
  return {
    pieces: [],
    pivot: new THREE.Vector3(),
    signature: -1,
    previousHead: new THREE.Quaternion(),
    previousOmega: new THREE.Vector3(),
    angle: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    primed: false,
  }
}

/** The hat group and its baked meshes: everything tagged as a hat under the head group. */
function collectHat(group: THREE.Object3D, state: HatState) {
  state.pieces.length = 0
  box.makeEmpty()
  group.updateMatrixWorld(true)
  for (const child of group.children) {
    if (child.userData.accessoryKind !== 'hat') continue
    // Empty hat groups (everything baked away) have nothing to move.
    if (!(child as THREE.Mesh).isMesh && child.children.length === 0) continue
    state.pieces.push({ object: child, basePosition: child.position.clone(), baseQuaternion: child.quaternion.clone() })
    pieceBox.setFromObject(child)
    if (!pieceBox.isEmpty()) box.union(pieceBox)
  }
  if (state.pieces.length === 0 || box.isEmpty()) {
    state.pieces.length = 0
    return
  }
  // Pivot: the crown, bottom-centre of the hat, in the head group's frame.
  center.set((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.15, (box.min.z + box.max.z) / 2)
  group.worldToLocal(state.pivot.copy(center))
}

function integrateAxis(angle: THREE.Vector3, velocity: THREE.Vector3, force: THREE.Vector3, axis: 'x' | 'y' | 'z', h: number) {
  const a = force[axis] - 2 * HAT_ZETA * HAT_OMEGA * velocity[axis] - HAT_OMEGA * HAT_OMEGA * angle[axis]
  velocity[axis] += a * h
  angle[axis] += velocity[axis] * h
  if (angle[axis] > HAT_MAX) {
    angle[axis] = HAT_MAX
    velocity[axis] = Math.min(0, velocity[axis])
  } else if (angle[axis] < -HAT_MAX) {
    angle[axis] = -HAT_MAX
    velocity[axis] = Math.max(0, velocity[axis])
  }
}

/** Advances the hat spring and applies it. Call after the head bone is final for the frame. */
export function updateHatSecondary(
  set: AvatarAccessorySet | null,
  head: THREE.Object3D | undefined,
  dt: number,
  reducedMotion: boolean
) {
  const group = set?.groups[0]
  if (!set || !group || !head) return
  let state = states.get(set)
  if (!state) {
    state = createState()
    states.set(set, state)
  }
  // The room bakes accessory meshes a few frames after they are created, so
  // re-collect whenever the set of children changes.
  const signature = group.children.length
  if (signature !== state.signature) {
    // Put any earlier offset back before re-reading the base transforms.
    for (const piece of state.pieces) {
      piece.object.position.copy(piece.basePosition)
      piece.object.quaternion.copy(piece.baseQuaternion)
    }
    state.signature = signature
    collectHat(group, state)
  }
  head.getWorldQuaternion(headQuaternion)
  if (!state.primed) {
    state.previousHead.copy(headQuaternion)
    state.primed = true
    return
  }
  if (state.pieces.length === 0) return
  const step = Math.min(0.05, Math.max(0.0005, dt))
  // Head angular velocity in its own frame: previous^-1 * now.
  delta.copy(state.previousHead).invert().multiply(headQuaternion)
  if (delta.w < 0) {
    delta.x = -delta.x
    delta.y = -delta.y
    delta.z = -delta.z
    delta.w = -delta.w
  }
  const half = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z)
  const rotation = 2 * Math.atan2(half, delta.w)
  if (half > 1e-7) omega.set(delta.x, delta.y, delta.z).multiplyScalar(rotation / half / step)
  else omega.set(0, 0, 0)
  accel.subVectors(omega, state.previousOmega).multiplyScalar(1 / step)
  state.previousOmega.copy(omega)
  state.previousHead.copy(headQuaternion)
  if (reducedMotion) {
    state.angle.set(0, 0, 0)
    state.velocity.set(0, 0, 0)
  } else {
    // Pitch and roll matter most; yaw swings a little.
    accel.multiplyScalar(-HAT_GAIN)
    accel.x = Math.max(-45, Math.min(45, accel.x))
    accel.y = Math.max(-45, Math.min(45, accel.y)) * 0.4
    accel.z = Math.max(-45, Math.min(45, accel.z))
    const h = step / 2
    for (let sub = 0; sub < 2; sub += 1) {
      integrateAxis(state.angle, state.velocity, accel, 'x', h)
      integrateAxis(state.angle, state.velocity, accel, 'y', h)
      integrateAxis(state.angle, state.velocity, accel, 'z', h)
    }
  }
  // One NaN (a degenerate head quaternion) must never poison the spring.
  if (!Number.isFinite(state.angle.x + state.angle.y + state.angle.z + state.velocity.x + state.velocity.y + state.velocity.z)) {
    state.angle.set(0, 0, 0)
    state.velocity.set(0, 0, 0)
    state.previousOmega.set(0, 0, 0)
  }
  // Pivot about the crown: pos' = P + R (base - P); quat' = R * baseQuat.
  offsetEuler.set(state.angle.x, state.angle.y, state.angle.z, 'XYZ')
  offsetQuaternion.setFromEuler(offsetEuler)
  for (const piece of state.pieces) {
    pivotVector.copy(piece.basePosition).sub(state.pivot).applyQuaternion(offsetQuaternion).add(state.pivot)
    piece.object.position.copy(pivotVector)
    piece.object.quaternion.copy(offsetQuaternion).multiply(piece.baseQuaternion)
  }
}
