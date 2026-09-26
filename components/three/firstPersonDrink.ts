import * as THREE from 'three'
import { createDrinkProp, disposeDrinkProp, DRINK_DURATION, type DrinkKind, type DrinkProp } from './drinkProps'

/**
 * The local player's own drink, seen first-person: a toon hand and sleeve
 * (in the hero's avatar colours) bring the glass up from the bottom-right,
 * tip it back for a few gulps while the level drops, then lower it away.
 * Everything lives in camera space, so it is always framed the same way.
 */

export interface FirstPersonDrink {
  root: THREE.Group
  kind: DrinkKind | null
  colorKey: string
  prop: DrinkProp | null
  hand: THREE.Group | null
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
}

/** Glass rim sits at the group origin so tipping pivots at the lips. */
const RIM_OFFSET: Record<DrinkKind, number> = { beer: 0.24, water: 0.22 }
const GLASS_RADIUS: Record<DrinkKind, number> = { beer: 0.1, water: 0.075 }

// Rim positions in camera space (camera looks down -Z).
// Rises left of the action tray, sips low and off-centre so the board stays readable.
const OFF_SCREEN = new THREE.Vector3(0.3, -0.72, -0.62)
const HOLD = new THREE.Vector3(0.12, -0.1, -0.68)
const MOUTH = new THREE.Vector3(0.03, -0.3, -0.52)
const MOUTH_TIP = 1.95
const VIEW_SCALE = 0.78

const scratch = new THREE.Vector3()

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
    materials: [],
    geometries: [],
    liquid: null,
    foam: null,
    liquidBase: { y: 0, height: 1 },
  }
}

function toonRamp() {
  const texture = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

function clearModel(drink: FirstPersonDrink) {
  disposeDrinkProp(drink.prop)
  drink.prop = null
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

  const prop = createDrinkProp(kind)
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

  const ramp = toonRamp()
  // The hand sits in the chair's shadow; a little self-light keeps it readable.
  const lit = (color: string, glow: number) =>
    new THREE.MeshToonMaterial({ color, gradientMap: ramp, emissive: color, emissiveIntensity: glow })
  const skin = lit(skinColor, 0.32)
  const sleeve = lit(sleeveColor, 0.22)
  const cuff = lit('#f4efe6', 0.25)
  drink.materials.push(skin, sleeve, cuff)

  const hand = new THREE.Group()
  hand.position.y = -RIM_OFFSET[kind]
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    drink.geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    hand.add(mesh)
    return mesh
  }

  const radius = GLASS_RADIUS[kind]
  // Four curled fingers wrap the camera-facing side of the glass.
  const fingerHeights = [0.07, 0.105, 0.14, 0.172]
  fingerHeights.forEach((height, index) => {
    const arc = 1.75 - index * 0.14
    const finger = add(new THREE.TorusGeometry(radius + 0.013, 0.0145 - index * 0.0008, 7, 12, arc), skin)
    finger.rotation.x = Math.PI / 2
    finger.rotation.z = -0.12
    finger.position.y = height
    // Fingertip knuckle so the curl reads as fingers, not rings.
    const tip = add(new THREE.SphereGeometry(0.0155 - index * 0.0008, 8, 6), skin)
    tip.position.set(Math.cos(arc - 0.12) * (radius + 0.013), height, Math.sin(arc - 0.12) * (radius + 0.013))
  })
  // Palm and thumb on the outer (right) side.
  const palm = add(new THREE.SphereGeometry(1, 14, 10), skin)
  palm.scale.set(0.034, 0.068, 0.056)
  palm.position.set(radius + 0.03, 0.12, -0.012)
  const thumb = add(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), skin)
  thumb.position.set(radius * 0.72, 0.2, radius * 0.55)
  thumb.rotation.set(0.2, 0, -1.05)

  // Wrist, cuff and sleeve run down-right toward the edge of the screen.
  const armDirection = new THREE.Vector3(0.62, -0.62, 0.48).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const alongArm = new THREE.Quaternion().setFromUnitVectors(up, armDirection)
  const wristStart = new THREE.Vector3(radius + 0.05, 0.09, -0.01)
  const segment = (length: number, radiusTop: number, radiusBottom: number, offset: number, material: THREE.Material) => {
    const mesh = add(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 14), material)
    mesh.quaternion.copy(alongArm)
    mesh.position.copy(wristStart).addScaledVector(armDirection, offset + length / 2)
    return mesh
  }
  segment(0.07, 0.028, 0.032, 0, skin)
  segment(0.03, 0.05, 0.05, 0.06, cuff)
  segment(0.75, 0.056, 0.07, 0.085, sleeve)

  hand.traverse(object => {
    object.castShadow = false
    object.receiveShadow = false
  })
  drink.root.add(hand)
  drink.hand = hand
}

const easeOutBack = (t: number) => {
  const c = 1.5
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeIn = (t: number) => t * t * t
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
  drink.root.scale.setScalar(VIEW_SCALE)

  const raiseEnd = 0.5
  const toMouthEnd = 0.85
  const sipEnd = 1.85
  const fromMouthEnd = 2.15
  let tip = 0
  let drain = 0
  let headTilt = 0
  const position = drink.root.position

  if (elapsed < raiseEnd) {
    position.lerpVectors(OFF_SCREEN, HOLD, easeOutBack(clamp01(elapsed / raiseEnd)))
  } else if (elapsed < toMouthEnd) {
    const t = easeInOut((elapsed - raiseEnd) / (toMouthEnd - raiseEnd))
    position.lerpVectors(HOLD, MOUTH, t)
    tip = t * MOUTH_TIP
    headTilt = t
  } else if (elapsed < sipEnd) {
    const t = (elapsed - toMouthEnd) / (sipEnd - toMouthEnd)
    position.copy(MOUTH)
    // Three gulps: small extra tips that pump the glass.
    const gulp = input.reducedMotion ? 0 : Math.max(0, Math.sin(t * Math.PI * 3)) * 0.12
    tip = MOUTH_TIP + gulp
    position.y += gulp * 0.05
    drain = t
    headTilt = 1
  } else if (elapsed < fromMouthEnd) {
    const t = easeInOut((elapsed - sipEnd) / (fromMouthEnd - sipEnd))
    position.lerpVectors(MOUTH, HOLD, t)
    tip = (1 - t) * MOUTH_TIP
    drain = 1
    headTilt = 1 - t
  } else {
    const t = easeIn((elapsed - fromMouthEnd) / (DRINK_DURATION - fromMouthEnd))
    position.lerpVectors(HOLD, OFF_SCREEN, t)
    drain = 1
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
  drink.root.rotation.set(tip, 0, 0.18 * (1 - tip / MOUTH_TIP) + wobble * Math.sin(input.time * 2.2) * 0.08)

  const remaining = 1 - drain * 0.45
  if (drink.liquid) {
    const { y, height } = drink.liquidBase
    drink.liquid.scale.y = remaining
    drink.liquid.position.y = y + (height * remaining) / 2
    if (drink.foam) drink.foam.position.y = y + height * remaining + 0.012
  }
  return headTilt
}

export function disposeFirstPersonDrink(drink: FirstPersonDrink | null) {
  if (!drink) return
  clearModel(drink)
  drink.root.removeFromParent()
}
