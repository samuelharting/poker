import * as THREE from 'three'
import type { GripSpec } from './firstPersonHandMesh'
import { createGripHand, disposeGripHand, setGripInk, setGripPose, type GripHand } from './firstPersonGripHand'
import { createDrinkProp, disposeDrinkProp, DRINK_DURATION, type DrinkKind, type DrinkProp } from './drinkProps'

/**
 * The local player's own drink, seen first-person: the hero's own hand and sleeve
 * (the resting hands' mesh, posed around the glass: see firstPersonGripHand.ts,
 * mirrored into a left hand) bring the glass up from the bottom-left,
 * tip it back for a few gulps while the level drops, then lower it away.
 * Everything lives in camera space, so it is always framed the same way.
 */

export interface FirstPersonDrink {
  root: THREE.Group
  kind: DrinkKind | null
  colorKey: string
  prop: DrinkProp | null
  hand: THREE.Group | null
  /** The glass-holding hand (two draw calls: the hand and its ink hull). */
  grip: GripHand | null
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
  liquid: THREE.Mesh | null
  foam: THREE.Mesh | null
  liquidBase: { y: number; height: number }
}

export interface FirstPersonDrinkInput {
  /** Seconds since the hero's latest drink started, or null when not drinking. */
  elapsed: number | null
  kind: DrinkKind
  skinColor: string
  sleeveColor: string
  drunkLevel: number
  time: number
  reducedMotion: boolean
  /** Render height in pixels (the ink outline stays about a pixel and a half wide). */
  renderHeight?: number
}

/** Glass rim sits at the group origin so tipping pivots at the lips. */
const RIM_OFFSET: Record<DrinkKind, number> = { beer: 0.24, water: 0.22 }

interface DrinkGrip {
  spec: GripSpec
  /** Hand space -> glass space. */
  scale: number
  yaw: number
  /** Height of the middle of the finger stack, and the grip axis x (the mug's handle). */
  height: number
  axisX: number
}

/**
 * How the hand holds each glass. The beer is held by its handle (a fist closed
 * around the bar, thumb up along the glass); the water is wrapped around its
 * body, fingers behind the glass and the thumb on the near side. Radii are in
 * hand units (the mug's handle bar is 0.0125 thick, the tumbler about 0.07 wide
 * at the grip).
 */
const DRINK_GRIP: Record<DrinkKind, DrinkGrip> = {
  beer: {
    spec: { radius: 0.0074, axis: [-0.027, -0.054], thumb: { yaw: [0.3, -0.1, 0], curl: [0.8, 0.7, 0.5] }, wristBend: 0.5 },
    scale: 1.7,
    yaw: 0.4,
    height: 0.115,
    axisX: 0.172,
  },
  water: {
    spec: { radius: 0.04375, axis: [-0.065, -0.07], thumb: { yaw: [0.8, -0.25, 0], curl: [0.6, 0.45, 0.3] }, wristBend: 0.5 },
    scale: 1.6,
    yaw: 0.45,
    height: 0.105,
    axisX: 0,
  },
}

// Rim anchors as (screen x, screen y in -1..1, camera-space depth), turned
// into camera space every frame from the lens, so the framing holds at any
// aspect. The drink is held in the LEFT hand over the empty near rail left of
// the hole cards and above the Beer/Water buttons: clear of the board, the
// pot, the hole cards and every HUD panel on the right (action tray,
// pre-action bar, show/muck), at 1440x900 and 1024x700 alike.
const OFF_SCREEN = new THREE.Vector3(-0.42, -1.45, -0.62)
const HOLD = new THREE.Vector3(-0.36, -0.44, -0.66)
const MOUTH = new THREE.Vector3(-0.35, -0.44, -0.62)
/** After the last gulp the glass goes straight down and out, no bob back up. */
const LOWER_SECONDS = 0.45
/** A modest tip: the glass bottom stays below the rim on screen instead of swinging up over the table. */
const MOUTH_TIP = 1.12
const VIEW_SCALE = 0.48
/** The view only nods a little with the sip (the room scales this further). */
const HEAD_TILT_SCALE = 0.3

const scratch = new THREE.Vector3()
const holdAt = new THREE.Vector3()
const mouthAt = new THREE.Vector3()
const offAt = new THREE.Vector3()

/** Screen anchor -> camera space for the drink's parent camera. */
function anchorToCamera(anchor: THREE.Vector3, camera: THREE.Object3D | null, out: THREE.Vector3) {
  const lens = camera as THREE.PerspectiveCamera | null
  const tanHalf = Math.tan(THREE.MathUtils.degToRad((lens?.isPerspectiveCamera ? lens.fov : 60) / 2))
  const aspect = lens?.isPerspectiveCamera ? lens.aspect : 1.6
  const depth = -anchor.z
  return out.set(anchor.x * depth * tanHalf * aspect, anchor.y * depth * tanHalf, anchor.z)
}

export function createFirstPersonDrink(camera: THREE.Camera): FirstPersonDrink {
  const root = new THREE.Group()
  root.name = 'first-person-drink'
  root.visible = false
  root.renderOrder = 10
  camera.add(root)
  return {
    root,
    kind: null,
    colorKey: '',
    prop: null,
    hand: null,
    grip: null,
    materials: [],
    geometries: [],
    liquid: null,
    foam: null,
    liquidBase: { y: 0, height: 1 },
  }
}

function clearModel(drink: FirstPersonDrink) {
  disposeDrinkProp(drink.prop)
  drink.prop = null
  disposeGripHand(drink.grip)
  drink.grip = null
  drink.hand?.removeFromParent()
  drink.hand = null
  drink.materials.forEach(material => {
    const map = (material as THREE.MeshToonMaterial).gradientMap
    map?.dispose()
    material.dispose()
  })
  drink.geometries.forEach(geometry => geometry.dispose())
  drink.materials = []
  drink.geometries = []
  drink.liquid = null
  drink.foam = null
}

function buildModel(drink: FirstPersonDrink, kind: DrinkKind, skinColor: string, sleeveColor: string) {
  clearModel(drink)
  drink.kind = kind
  drink.colorKey = `${kind}|${skinColor}|${sleeveColor}`

  const prop = createDrinkProp(kind, { firstPerson: true })
  prop.group.visible = true
  // Rim at the origin: tipping the root pivots the glass at the lips.
  prop.group.position.y = -RIM_OFFSET[kind]
  prop.group.traverse(object => {
    object.castShadow = false
    object.receiveShadow = false
  })
  drink.root.add(prop.group)
  drink.prop = prop

  const meshes = prop.group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
  // createDrinkProp adds glass, liquid, then foam/lemon, in that order.
  drink.liquid = meshes[1] ?? null
  drink.foam = kind === 'beer' ? meshes[2] ?? null : null
  if (drink.liquid) {
    const params = (drink.liquid.geometry as THREE.CylinderGeometry).parameters
    drink.liquidBase = { y: drink.liquid.position.y - params.height / 2, height: params.height }
  }

  // The resting hands' own mesh, shader and ink, posed around the glass, in the profile's colours.
  const config = DRINK_GRIP[kind]
  const grip = createGripHand({ ...config, skin: skinColor, sleeve: sleeveColor })
  const hand = new THREE.Group()
  hand.position.y = -RIM_OFFSET[kind]
  hand.add(grip.group)
  drink.root.add(hand)
  drink.hand = hand
  drink.grip = grip
}

const easeOutBack = (t: number) => {
  const c = 1.5
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * Poses the first-person drink for this frame. Returns how far the head tips
 * back (0..1) so the camera can pitch up with the sip.
 */
export function updateFirstPersonDrink(drink: FirstPersonDrink, input: FirstPersonDrinkInput): number {
  const { elapsed } = input
  if (elapsed === null || elapsed < 0 || elapsed >= DRINK_DURATION) {
    drink.root.visible = false
    return 0
  }
  const colorKey = `${input.kind}|${input.skinColor}|${input.sleeveColor}`
  if (drink.colorKey !== colorKey || !drink.prop) buildModel(drink, input.kind, input.skinColor, input.sleeveColor)
  drink.root.visible = true
  // Mirrored: a left hand, handle on the left (three flips the winding for negative scale).
  drink.root.scale.set(-VIEW_SCALE, VIEW_SCALE, VIEW_SCALE)
  anchorToCamera(HOLD, drink.root.parent, holdAt)
  anchorToCamera(MOUTH, drink.root.parent, mouthAt)
  anchorToCamera(OFF_SCREEN, drink.root.parent, offAt)

  const raiseEnd = 0.45
  const toMouthEnd = 0.75
  const sipEnd = 1.45
  const lowerEnd = Math.min(DRINK_DURATION, sipEnd + LOWER_SECONDS)
  if (elapsed >= lowerEnd) {
    drink.root.visible = false
    return 0
  }
  let tip = 0
  let drain = 0
  let headTilt = 0
  const position = drink.root.position

  if (elapsed < raiseEnd) {
    position.lerpVectors(offAt, holdAt, easeOutBack(clamp01(elapsed / raiseEnd)))
  } else if (elapsed < toMouthEnd) {
    const t = easeInOut((elapsed - raiseEnd) / (toMouthEnd - raiseEnd))
    position.lerpVectors(holdAt, mouthAt, t)
    tip = t * MOUTH_TIP
    headTilt = t
  } else if (elapsed < sipEnd) {
    const t = (elapsed - toMouthEnd) / (sipEnd - toMouthEnd)
    position.copy(mouthAt)
    // Two gulps: small extra tips that pump the glass.
    const gulp = input.reducedMotion ? 0 : Math.max(0, Math.sin(t * Math.PI * 2)) * 0.1
    tip = MOUTH_TIP + gulp
    position.y += gulp * 0.05
    drain = t
    headTilt = 1
  } else {
    const t = easeInOut((elapsed - sipEnd) / (lowerEnd - sipEnd))
    position.lerpVectors(mouthAt, offAt, t)
    tip = (1 - t) * MOUTH_TIP
    drain = 1
    headTilt = 1 - t
  }

  // Drunk hands wander.
  const wobble = input.reducedMotion ? 0 : Math.min(1, input.drunkLevel / 8)
  if (wobble > 0) {
    scratch.set(
      Math.sin(input.time * 3.1) * 0.02,
      Math.sin(input.time * 4.3 + 1.1) * 0.014,
      0
    ).multiplyScalar(wobble)
    position.add(scratch)
  }
  drink.root.rotation.set(tip, 0, -0.18 * (1 - tip / MOUTH_TIP) + wobble * Math.sin(input.time * 2.2) * 0.08)

  // The fingers settle on the glass as it arrives, squeeze a little as it is tipped, and let go as it is lowered.
  const grip = drink.grip
  if (grip) {
    const lens = drink.root.parent as THREE.PerspectiveCamera | null
    const tanHalf = Math.tan(THREE.MathUtils.degToRad((lens?.isPerspectiveCamera ? lens.fov : 60) / 2))
    setGripInk(grip, grip.scale * VIEW_SCALE, input.renderHeight ?? 720, -HOLD.z, tanHalf)
    const arriving = elapsed < raiseEnd ? 1 - easeInOut(clamp01(elapsed / raiseEnd)) : 0
    const releasing = elapsed > sipEnd ? easeInOut(clamp01((elapsed - sipEnd) / (lowerEnd - sipEnd))) : 0
    setGripPose(grip, { loose: 0.5 * arriving + 0.3 * releasing, tight: input.reducedMotion ? 0 : 0.5 * headTilt })
  }

  const remaining = 1 - drain * 0.45
  if (drink.liquid) {
    const { y, height } = drink.liquidBase
    drink.liquid.scale.y = remaining
    drink.liquid.position.y = y + (height * remaining) / 2
    if (drink.foam) drink.foam.position.y = y + height * remaining + 0.012
  }
  return headTilt * HEAD_TILT_SCALE
}

export function disposeFirstPersonDrink(drink: FirstPersonDrink | null) {
  if (!drink) return
  clearModel(drink)
  drink.root.removeFromParent()
}
