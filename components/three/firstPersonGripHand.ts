import * as THREE from 'three'
import {
  buildGripHandGeometry,
  createHandHullMaterial,
  createHandMaterial,
  getHullWidth,
  GRIP_MORPH,
  HAND_SCALE,
  handSkinColor,
  type GripSpec,
  type HandColors,
  type HandHullMaterial,
} from './firstPersonHandMesh'

/**
 * The hand that holds a first-person glass (beer, water, the hero's shot): the
 * very same hand as the resting hands (firstPersonHandMesh.ts: same tubes, skin
 * from the hero profile, cel ramp, back-face ink hull) posed around the glass.
 * Two draw calls: the hand and its ink hull. It is built as a RIGHT hand in the
 * glass's frame (glass axis along +Y, the palm on the +X side); the beer and
 * the water mirror the whole drink for a left hand.
 */

export interface GripHandOptions {
  /** The cylinder the hand wraps, in hand-space units (see GripSpec). */
  spec: GripSpec
  /** Hand-space to glass-space scale. */
  scale: number
  /** Turn of the hand about the glass axis (rad): the back of the hand shows toward the lens. */
  yaw: number
  /** Where on the glass the middle of the finger stack sits, and the grip axis x (a mug's handle is off to the side). */
  height: number
  axisX?: number
  skin: THREE.ColorRepresentation
  sleeve: THREE.ColorRepresentation
}

export interface GripHand {
  group: THREE.Group
  mesh: THREE.Mesh
  ink: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.MeshToonMaterial
  hull: HandHullMaterial
  colors: HandColors
  scale: number
}

/** Hand space -> glass space: thumb up, palm toward the glass (-X), forearm toward the lens (+Z). */
const GLASS_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)
const yawAxis = new THREE.Vector3(0, 1, 0)
const scratchAxis = new THREE.Vector3()

/** The same lift (and floor for very dark skin) the resting hands' skin gets (firstPersonHands.ts). */
export function gripSkinColor(skin: THREE.ColorRepresentation, out = new THREE.Color()) {
  return handSkinColor(skin, out)
}

export function createGripHand(options: GripHandOptions): GripHand {
  const colors: HandColors = {
    skin: gripSkinColor(options.skin),
    sleeve: new THREE.Color(options.sleeve),
    cuff: new THREE.Color('#f4efe6'),
  }
  const geometry = buildGripHandGeometry(options.spec)
  const material = createHandMaterial(colors)
  const hull = createHandHullMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'first-person-grip-hand'
  const ink = new THREE.Mesh(geometry, hull.material)
  ink.name = 'first-person-grip-hand-ink'
  for (const part of [mesh, ink]) {
    part.frustumCulled = false
    part.castShadow = false
    part.receiveShadow = false
  }
  mesh.renderOrder = 9
  ink.renderOrder = 8
  mesh.add(ink)
  const group = new THREE.Group()
  group.name = 'first-person-grip'
  group.add(mesh)
  // Rotate the hand into the glass's frame, then move it so its grip axis is the glass axis.
  group.quaternion.setFromAxisAngle(yawAxis, options.yaw).multiply(GLASS_FRAME)
  group.scale.setScalar(options.scale)
  const [axisY, axisZ] = options.spec.axis
  scratchAxis.set(0, axisY * options.scale, axisZ * options.scale).applyQuaternion(group.quaternion)
  group.position.set(options.axisX ?? 0, options.height, 0).sub(scratchAxis)
  return { group, mesh, ink, geometry, material, hull, colors, scale: options.scale }
}

export interface GripPose {
  loose?: number
  tight?: number
  lift?: number
  tap?: number
}

/** Blends the grip morph targets (loose, tight, lift, tap) on the hand and its ink hull. */
export function setGripPose(hand: GripHand, pose: GripPose) {
  const influences = hand.mesh.morphTargetInfluences
  const inkInfluences = hand.ink.morphTargetInfluences
  if (!influences || !inkInfluences) return
  influences[GRIP_MORPH.loose] = pose.loose ?? 0
  influences[GRIP_MORPH.tight] = pose.tight ?? 0
  influences[GRIP_MORPH.lift] = pose.lift ?? 0
  influences[GRIP_MORPH.tap] = pose.tap ?? 0
  for (let index = 0; index < influences.length; index += 1) inkInfluences[index] = influences[index]!
}

export function setGripColors(hand: GripHand, skin: THREE.ColorRepresentation, sleeve: THREE.ColorRepresentation) {
  gripSkinColor(skin, hand.colors.skin)
  hand.colors.sleeve.set(sleeve)
}

/**
 * Keeps the silhouette ink about a pixel and a half wide: `worldScale` is the
 * hand's total scale from hand space to camera space (its own scale times the
 * drink's), `depth` the metres from the lens.
 */
export function setGripInk(hand: GripHand, worldScale: number, renderHeightPx: number, depth: number, tanHalfFov: number) {
  hand.hull.width.value = (getHullWidth(1.5, renderHeightPx, depth, tanHalfFov) * HAND_SCALE) / Math.max(1e-4, worldScale)
}

export function disposeGripHand(hand: GripHand | null) {
  if (!hand) return
  hand.group.removeFromParent()
  hand.geometry.dispose()
  hand.material.gradientMap?.dispose()
  hand.material.dispose()
  hand.hull.material.dispose()
}
