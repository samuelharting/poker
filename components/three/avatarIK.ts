import * as THREE from 'three'

/**
 * Minimal analytic two-bone IK for the rigged avatars' arms.
 *
 * Instead of guessing per-rig rotation axes, each hand is given a target in
 * world space. The elbow is placed with the law of cosines, bent toward a pole
 * direction, and each bone is swung (shortest rotation) so its child joint
 * lands on the solved point. Existing twist from the idle clip is preserved.
 */

const boneWorld = new THREE.Vector3()
const childWorld = new THREE.Vector3()
const currentDirection = new THREE.Vector3()
const desiredDirection = new THREE.Vector3()
const swing = new THREE.Quaternion()
const boneWorldQuaternion = new THREE.Quaternion()
const parentWorldQuaternion = new THREE.Quaternion()
const identityQuaternion = new THREE.Quaternion()
const basisZ = new THREE.Vector3()
const basisY = new THREE.Vector3()

/** Rotates `bone` so that `child` points at `target` (all in world space). */
export function aimBoneAt(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, weight = 1) {
  bone.getWorldPosition(boneWorld)
  child.getWorldPosition(childWorld)
  currentDirection.subVectors(childWorld, boneWorld)
  desiredDirection.subVectors(target, boneWorld)
  if (currentDirection.lengthSq() < 1e-10 || desiredDirection.lengthSq() < 1e-10) return
  currentDirection.normalize()
  desiredDirection.normalize()
  swing.setFromUnitVectors(currentDirection, desiredDirection)
  if (weight < 1) swing.slerp(identityQuaternion, 1 - weight)

  bone.getWorldQuaternion(boneWorldQuaternion)
  boneWorldQuaternion.premultiply(swing)
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorldQuaternion)
    bone.quaternion.copy(parentWorldQuaternion.invert().multiply(boneWorldQuaternion))
  } else {
    bone.quaternion.copy(boneWorldQuaternion)
  }
  bone.updateMatrixWorld(true)
}

/** Fraction of full arm length the IK will extend to (soft elbows). */
export const ARM_MAX_EXTENSION = 0.9

/**
 * How far past a comfortable reach `target` is from the chain's shoulder, in
 * world units (0 when it is within reach).
 */
export function getArmOvershoot(chain: ArmChain, target: THREE.Vector3): number {
  chain.upper.getWorldPosition(shoulder)
  chain.lower.getWorldPosition(elbow)
  chain.hand.getWorldPosition(wrist)
  const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist)
  return Math.max(0, shoulder.distanceTo(target) - length * ARM_MAX_EXTENSION)
}

const frameCurrentX = new THREE.Vector3()
const frameCurrentY = new THREE.Vector3()
const frameDesiredX = new THREE.Vector3()
const frameDesiredY = new THREE.Vector3()
const frameBasis = new THREE.Matrix4()
const frameCurrentQ = new THREE.Quaternion()
const frameDesiredQ = new THREE.Quaternion()
const frameDelta = new THREE.Quaternion()
const framePoint = new THREE.Vector3()
const frameOrigin = new THREE.Vector3()

function basisQuaternion(primary: THREE.Vector3, secondary: THREE.Vector3, out: THREE.Quaternion) {
  const x = primary.normalize()
  const z = basisZ.crossVectors(x, secondary).normalize()
  const y = basisY.crossVectors(z, x)
  frameBasis.makeBasis(x, y, z)
  return out.setFromRotationMatrix(frameBasis)
}

/**
 * Rotates `bone` (in world space, about its own origin) so the direction from
 * it to `primaryChild` points along `desiredPrimary` and the direction from
 * `sideA` to `sideB` lines up with `desiredSide` as closely as possible.
 * Used to orient hands (fingers up, knuckles out) independent of the forearm.
 */
export function orientBoneFrame(
  bone: THREE.Object3D,
  primaryChild: THREE.Object3D,
  sideA: THREE.Object3D,
  sideB: THREE.Object3D,
  desiredPrimary: THREE.Vector3,
  desiredSide: THREE.Vector3,
  weight = 1
) {
  if (weight <= 0.001) return
  bone.getWorldPosition(frameOrigin)
  frameCurrentX.copy(primaryChild.getWorldPosition(framePoint)).sub(frameOrigin)
  frameCurrentY.copy(sideB.getWorldPosition(framePoint)).sub(sideA.getWorldPosition(frameOrigin))
  bone.getWorldPosition(frameOrigin)
  if (frameCurrentX.lengthSq() < 1e-12 || frameCurrentY.lengthSq() < 1e-12) return
  frameDesiredX.copy(desiredPrimary)
  frameDesiredY.copy(desiredSide)
  if (frameDesiredX.lengthSq() < 1e-10 || frameDesiredY.lengthSq() < 1e-10) return
  basisQuaternion(frameCurrentX, frameCurrentY, frameCurrentQ)
  basisQuaternion(frameDesiredX, frameDesiredY, frameDesiredQ)
  frameDelta.copy(frameDesiredQ).multiply(frameCurrentQ.invert())
  if (weight < 1) frameDelta.slerp(identityQuaternion, 1 - weight)
  bone.getWorldQuaternion(boneWorldQuaternion)
  boneWorldQuaternion.premultiply(frameDelta)
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorldQuaternion)
    bone.quaternion.copy(parentWorldQuaternion.invert().multiply(boneWorldQuaternion))
  } else {
    bone.quaternion.copy(boneWorldQuaternion)
  }
  bone.updateMatrixWorld(true)
}

const shoulder = new THREE.Vector3()
const elbow = new THREE.Vector3()
const wrist = new THREE.Vector3()
const toTarget = new THREE.Vector3()
const bendAxis = new THREE.Vector3()
const elbowTarget = new THREE.Vector3()
const clampedTarget = new THREE.Vector3()

export interface ArmChain {
  upper: THREE.Bone
  lower: THREE.Bone
  hand: THREE.Bone
}

export function getArmChain(upper?: THREE.Bone, lower?: THREE.Bone, hand?: THREE.Bone): ArmChain | null {
  return upper && lower && hand ? { upper, lower, hand } : null
}

/**
 * Solves the arm so the wrist reaches `target`, bending the elbow toward
 * `pole`. `weight` blends from the incoming animated pose to the solved pose.
 * Segment lengths are read from the live joints, so rig scale never matters.
 */
export function solveArmIK(chain: ArmChain, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  if (weight <= 0.001) return
  const { upper, lower, hand } = chain
  upper.updateMatrixWorld(true)
  upper.getWorldPosition(shoulder)
  lower.getWorldPosition(elbow)
  hand.getWorldPosition(wrist)
  const a = shoulder.distanceTo(elbow)
  const b = elbow.distanceTo(wrist)
  if (a < 1e-5 || b < 1e-5) return

  toTarget.subVectors(target, shoulder)
  // Never lock the elbow straight: a slightly bent arm reads relaxed, and the
  // renderer leans the torso in for anything further away.
  const reach = Math.max(Math.abs(a - b) + 1e-3, Math.min(toTarget.length(), (a + b) * ARM_MAX_EXTENSION))
  toTarget.normalize()
  clampedTarget.copy(shoulder).addScaledVector(toTarget, reach)

  const along = (a * a - b * b + reach * reach) / (2 * reach)
  const height = Math.sqrt(Math.max(0, a * a - along * along))
  bendAxis.subVectors(pole, shoulder)
  bendAxis.addScaledVector(toTarget, -bendAxis.dot(toTarget))
  if (bendAxis.lengthSq() < 1e-8) bendAxis.set(0, -1, 0)
  bendAxis.normalize()
  elbowTarget.copy(shoulder).addScaledVector(toTarget, along).addScaledVector(bendAxis, height)

  aimBoneAt(upper, lower, elbowTarget, weight)
  lower.updateMatrixWorld(true)
  aimBoneAt(lower, hand, clampedTarget, weight)
}
