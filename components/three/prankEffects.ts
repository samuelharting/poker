import * as THREE from 'three'
import type { PrankEvent } from '@/lib/pranks'
import { popIconMarkup, type PopIconKind } from './popIcons'
import { FELT_TOP_Y } from './tableArt'
import {
  CHIP_BONK_REACT_SECONDS,
  CHIP_FLICK_GESTURE_SECONDS,
  CHIP_FLIGHT_SECONDS,
  CHIP_IMPACT_AT,
  CHIP_LAUNCH_AT,
  CHIP_TOTAL_SECONDS,
  getCheersRaise,
  getShotLocalTime,
  getShotTotalSeconds,
  SHOT_ARRIVE_AT,
  SHOT_DOWN_AT,
  SHOT_MOUTH_AT,
  SHOT_SHUDDER_END,
  SHOT_SLAM_AT,
} from './prankTimeline'

/**
 * Desktop 3D presentation of the table pranks, pictures only:
 * - a shot glass slides across the felt (from the buyer, or from the middle
 *   for a house shot), the target grabs it, throws it back, slams it upside
 *   down and shudders; the hero gets it first-person with a jolt and a warm
 *   flash;
 * - a flicked chip arcs from the flicker's fingers, bonks the target on the
 *   head (💥), bounces, spins and settles on the felt; aimed at the hero it
 *   flies at the lens with a jolt and a star-crack flash (kept small and in
 *   the corner while it is the hero's turn);
 * - icon pops over a seat for house-rule drinks (beer, double beer, water,
 *   shot), drawn as SVG (see popIcons.ts) so they never depend on emoji fonts.
 * Everything is driven by server events; nothing here changes game state.
 */

type Vec3 = [number, number, number]

/** The subset of a seat runtime the pranks need. */
export interface PrankSeat {
  playerId: string
  isHero: boolean
  root: THREE.Group
  anchors: { drinkRest: Vec3; stack: Vec3 }
  avatar: { bones: ReadonlyMap<string, THREE.Bone> } | null
  passedOut: boolean
  lastPose: { drinkLift: number } | null
}

export interface SeatPrankInput {
  shotElapsed: number | null
  cheersRaise: number
  bonkElapsed: number | null
  chipFlick: { elapsed: number; target: Vec3 } | null
}

interface ShotGlass {
  group: THREE.Group
  liquid: THREE.Mesh
  shadow: THREE.Mesh
}

interface ShotPrank {
  id: string
  targetId: string
  startedAt: number
  cheers: boolean
  glass: ShotGlass
  from: THREE.Vector3
  to: THREE.Vector3
  toHero: boolean
  popped: boolean
  flashed: boolean
}

interface FlickPrank {
  id: string
  fromId: string
  targetId: string
  startedAt: number
  chip: THREE.Mesh
  launch: THREE.Vector3 | null
  position: THREE.Vector3
  velocity: THREE.Vector3
  impacted: boolean
  resting: boolean
  toHero: boolean
  fromHero: boolean
  peripheral: boolean
}

interface Pop {
  element: HTMLElement
  startedAt: number
  life: number
  /** Follow a seat's head, a fixed world point, or a fixed screen spot. */
  seatId: string | null
  world: THREE.Vector3 | null
  screen: { x: number; y: number } | null
}

interface HeroShot {
  startedAt: number
  cheers: boolean
}

export interface PrankRuntime {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  host: HTMLElement
  shots: Map<string, ShotPrank>
  flicks: Map<string, FlickPrank>
  pops: Pop[]
  flashes: Array<{ element: HTMLElement; removeAt: number }>
  seen: Set<string>
  heroShot: HeroShot | null
  firstPerson: FirstPersonShot
  shake: { startedAt: number; strength: number; duration: number }
  createChip: () => THREE.Mesh
  glassMaterials: THREE.Material[]
  glassGeometries: THREE.BufferGeometry[]
}

/** Stale events (e.g. replayed on reconnect) are ignored. */
const STALE_EVENT_MS = 6_000
const POP_SECONDS = 1.3
/** Where house shots are poured from: the middle of the felt. */
const HOUSE_POUR_FROM = new THREE.Vector3(0, FELT_TOP_Y, -0.7)

/** Props are drawn larger than life so they read from the hero's chair across the table. */
const GLASS_SCALE = 2
const CHIP_SCALE = 1.8

const scratch = new THREE.Vector3()

let glowTexture: THREE.CanvasTexture | null = null
/** Soft round glow shared by the flying chip and the shot glass. */
function getGlowTexture() {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

function createGlow(color: string, size: number) {
  const material = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.setScalar(size)
  sprite.renderOrder = 2
  return sprite
}
const scratchB = new THREE.Vector3()

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

function createGlassMaterials() {
  const glass = new THREE.MeshStandardMaterial({
    color: '#f6fbff',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    emissive: '#8fb5c9',
    emissiveIntensity: 0.18,
  })
  const base = new THREE.MeshStandardMaterial({ color: '#e8f3f7', roughness: 0.12, transparent: true, opacity: 0.7 })
  // Whiskey: warm amber with a glow so it reads from across the table.
  const liquid = new THREE.MeshStandardMaterial({ color: '#d8861c', emissive: '#b85b00', emissiveIntensity: 0.85, roughness: 0.25 })
  const shadow = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false })
  return { glass, base, liquid, shadow }
}

function createShotGlass(runtime: PrankRuntime): ShotGlass {
  if (runtime.glassMaterials.length === 0) {
    const materials = createGlassMaterials()
    runtime.glassMaterials.push(materials.glass, materials.base, materials.liquid, materials.shadow)
    runtime.glassGeometries.push(
      new THREE.CylinderGeometry(0.085, 0.066, 0.16, 20, 1, true),
      new THREE.CylinderGeometry(0.066, 0.066, 0.035, 20),
      new THREE.CylinderGeometry(0.075, 0.064, 0.1, 20),
      new THREE.CircleGeometry(0.12, 20)
    )
  }
  const [glassMaterial, baseMaterial, liquidMaterial, shadowMaterial] = runtime.glassMaterials as [
    THREE.Material, THREE.Material, THREE.Material, THREE.Material,
  ]
  const [wallGeometry, baseGeometry, liquidGeometry, shadowGeometry] = runtime.glassGeometries as [
    THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry,
  ]
  const group = new THREE.Group()
  group.name = 'prank-shot-glass'
  const wall = new THREE.Mesh(wallGeometry, glassMaterial)
  wall.position.y = 0.08
  const base = new THREE.Mesh(baseGeometry, baseMaterial)
  base.position.y = 0.0175
  const liquid = new THREE.Mesh(liquidGeometry, liquidMaterial)
  liquid.position.y = 0.085
  group.add(wall, base, liquid)
  const glow = createGlow('#ffb347', 0.34)
  glow.position.y = 0.09
  glow.material.opacity = 0.45
  group.add(glow)
  group.traverse(object => { object.castShadow = false; object.receiveShadow = false })
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
  shadow.rotation.x = -Math.PI / 2
  shadow.renderOrder = 1
  runtime.scene.add(group, shadow)
  return { group, liquid, shadow }
}

function removeShotGlass(glass: ShotGlass) {
  glass.group.removeFromParent()
  glass.shadow.removeFromParent()
}

// ---------------------------------------------------------------------------
// First-person shot (the hero's own)
// ---------------------------------------------------------------------------

interface FirstPersonShot {
  root: THREE.Group
  liquid: THREE.Mesh | null
  colorKey: string
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
}

function createFirstPersonShot(camera: THREE.Camera): FirstPersonShot {
  const root = new THREE.Group()
  root.name = 'first-person-shot'
  root.visible = false
  root.renderOrder = 11
  camera.add(root)
  return { root, liquid: null, colorKey: '', materials: [], geometries: [] }
}

function buildFirstPersonShot(fp: FirstPersonShot, skinColor: string, sleeveColor: string) {
  fp.root.clear()
  fp.materials.forEach(material => material.dispose())
  fp.geometries.forEach(geometry => geometry.dispose())
  fp.materials = []
  fp.geometries = []
  fp.colorKey = `${skinColor}|${sleeveColor}`
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3) => {
    fp.geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    fp.root.add(mesh)
    return mesh
  }
  const lit = (color: string, glow: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.6, ...extra })
    fp.materials.push(material)
    return material
  }
  const glass = lit('#f6fbff', 0.2, { transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.1 })
  const liquid = lit('#d8861c', 0.7)
  const skin = lit(skinColor, 0.3)
  const sleeve = lit(sleeveColor, 0.2)
  // Glass rim sits at the origin so tipping pivots at the lips. The fist
  // grips the bottom half so the whiskey shows above the knuckles.
  add(new THREE.CylinderGeometry(0.058, 0.046, 0.11, 18, 1, true), glass, [0, -0.055, 0])
  add(new THREE.CylinderGeometry(0.046, 0.046, 0.024, 18), glass, [0, -0.1, 0])
  fp.liquid = add(new THREE.CylinderGeometry(0.052, 0.044, 0.07, 18), liquid, [0, -0.06, 0])
  const fingerHeights = [-0.1, -0.085, -0.07]
  fingerHeights.forEach((height, index) => {
    const finger = add(new THREE.TorusGeometry(0.056, 0.011, 6, 12, 1.7), skin, [0, height, 0])
    finger.rotation.x = Math.PI / 2
    finger.rotation.z = 0.5 - index * 0.05
  })
  const palm = add(new THREE.SphereGeometry(1, 12, 10), skin, [0.062, -0.085, -0.004])
  palm.scale.set(0.03, 0.04, 0.044)
  const thumb = add(new THREE.CapsuleGeometry(0.011, 0.03, 4, 8), skin, [0.04, -0.05, 0.035])
  thumb.rotation.set(0.3, 0, -0.9)
  // Just a cuff: a long forearm would sweep across the view as the glass tips.
  const cuff = add(new THREE.CylinderGeometry(0.034, 0.04, 0.12, 12), sleeve, [0.1, -0.15, 0.03])
  cuff.rotation.set(0.2, 0, 0.7)
  fp.root.traverse(object => { object.castShadow = false; object.receiveShadow = false })
}

const FP_OFF = new THREE.Vector3(0.24, -0.62, -0.62)
const FP_HOLD = new THREE.Vector3(0.1, -0.16, -0.6)
const FP_MOUTH = new THREE.Vector3(0.02, -0.2, -0.36)
const FP_CHEERS = new THREE.Vector3(0.02, 0.02, -0.72)
const FP_SLAM = new THREE.Vector3(0.12, -0.7, -0.55)

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}
const easeOutCubic = (value: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3)

/** Poses the hero's first-person shot; returns how far the head tips back (0..1). */
function updateFirstPersonShot(runtime: PrankRuntime, time: number, colors: { skin: string; sleeve: string }): number {
  const fp = runtime.firstPerson
  const shot = runtime.heroShot
  if (!shot) {
    fp.root.visible = false
    return 0
  }
  const elapsed = time - shot.startedAt
  const local = getShotLocalTime(elapsed, shot.cheers)
  const raise = getCheersRaise(elapsed, shot.cheers)
  if (local < SHOT_ARRIVE_AT - 0.05 || local > SHOT_SLAM_AT + 0.15) {
    fp.root.visible = false
    if (elapsed > getShotTotalSeconds(shot.cheers)) runtime.heroShot = null
    return 0
  }
  const key = `${colors.skin}|${colors.sleeve}`
  if (fp.colorKey !== key) buildFirstPersonShot(fp, colors.skin, colors.sleeve)
  fp.root.visible = true
  const position = fp.root.position
  let tip = 0
  let tilt = 0
  if (local < SHOT_MOUTH_AT - 0.25) {
    position.lerpVectors(FP_OFF, FP_HOLD, easeOutCubic((local - SHOT_ARRIVE_AT + 0.05) / 0.3))
  } else if (local < SHOT_MOUTH_AT) {
    const t = smooth((local - (SHOT_MOUTH_AT - 0.25)) / 0.25)
    position.lerpVectors(FP_HOLD, FP_MOUTH, t)
    tip = t * 1.2
    tilt = t * 0.5
  } else if (local < SHOT_DOWN_AT) {
    const t = smooth((local - SHOT_MOUTH_AT) / (SHOT_DOWN_AT - SHOT_MOUTH_AT))
    position.copy(FP_MOUTH)
    position.y += 0.05 * t
    tip = 1.2 + 0.7 * t
    tilt = 0.5 + 0.5 * t
  } else {
    // Slam: the empty glass comes down hard and out of view.
    const t = smooth((local - SHOT_DOWN_AT) / (SHOT_SLAM_AT - SHOT_DOWN_AT + 0.1))
    position.lerpVectors(FP_MOUTH, FP_SLAM, t)
    tip = 1.9 * (1 - t) + 0.15 * t
    tilt = 1 - t
  }
  if (raise > 0) {
    position.lerp(FP_CHEERS, raise)
    tip *= 1 - raise
  }
  fp.root.rotation.set(tip, 0, 0.15 * (1 - Math.min(1, tip)))
  if (fp.liquid) fp.liquid.visible = local < SHOT_DOWN_AT - 0.1
  return tilt
}

// ---------------------------------------------------------------------------
// DOM overlays: icon pops and hit flashes (pictures only, no words)
// ---------------------------------------------------------------------------

/**
 * Pops and flashes are short-lived DOM nodes; each one also bumps a counter on
 * the stage (`data-pops-bonk="2"`) so tests can check that it played without
 * racing its fade-out.
 */
function countOnHost(runtime: PrankRuntime, key: string) {
  const dataset = runtime.host.dataset
  dataset[key] = String(Number(dataset[key] ?? 0) + 1)
}

function addPop(runtime: PrankRuntime, kind: PopIconKind, time: number, anchor: Pick<Pop, 'seatId' | 'world' | 'screen'>) {
  const element = document.createElement('div')
  const cssKind = kind === 'beer2' ? 'beer is-double' : kind
  element.className = `prank-pop-3d is-${cssKind}`
  element.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('span')
  inner.innerHTML = popIconMarkup(kind)
  element.append(inner)
  countOnHost(runtime, `pops${kind[0].toUpperCase()}${kind.slice(1)}`)
  element.style.setProperty('--pop-x', '-999px')
  element.style.setProperty('--pop-y', '-999px')
  runtime.host.append(element)
  runtime.pops.push({ element, startedAt: time, life: POP_SECONDS, ...anchor })
}

function addFlash(runtime: PrankRuntime, kind: 'shot' | 'bonk', time: number, point?: { x: number; y: number }, peripheral = false) {
  const element = document.createElement('div')
  element.className = `prank-hit-flash is-${kind}${peripheral ? ' is-peripheral' : ''}`
  element.setAttribute('aria-hidden', 'true')
  countOnHost(runtime, kind === 'shot' ? 'flashesShot' : 'flashesBonk')
  if (point && !peripheral) {
    element.style.setProperty('--hit-x', `${(point.x * 100).toFixed(1)}%`)
    element.style.setProperty('--hit-y', `${(point.y * 100).toFixed(1)}%`)
  }
  runtime.host.append(element)
  runtime.flashes.push({ element, removeAt: time + (kind === 'shot' ? 1.7 : 0.8) })
}

function headWorld(seat: PrankSeat | undefined, out: THREE.Vector3, lift = 0.12): THREE.Vector3 {
  const head = seat?.avatar?.bones.get('Head')
  if (head) {
    head.getWorldPosition(out)
    out.y += lift
    return out
  }
  if (seat) {
    seat.root.getWorldPosition(out)
    out.y += 1.6 * seat.root.scale.y + lift
    return out
  }
  return out.set(0, FELT_TOP_Y + 1.4, 0)
}

function seatLocalToWorld(seat: PrankSeat, local: Vec3, out: THREE.Vector3) {
  out.set(local[0], local[1], local[2])
  seat.root.updateMatrixWorld()
  return seat.root.localToWorld(out)
}

function handWorld(seat: PrankSeat, out: THREE.Vector3): THREE.Vector3 | null {
  const wrist = seat.avatar?.bones.get('WristR')
  if (!wrist) return null
  wrist.getWorldPosition(out)
  const knuckle = seat.avatar?.bones.get('Middle1R')
  if (knuckle) {
    knuckle.getWorldPosition(scratchB)
    out.lerp(scratchB, 0.75)
  }
  return out
}

function heroCameraPoint(runtime: PrankRuntime, local: Vec3, out: THREE.Vector3) {
  out.set(local[0], local[1], local[2])
  runtime.camera.updateMatrixWorld()
  return runtime.camera.localToWorld(out)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createPrankRuntime(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  host: HTMLElement,
  createChip: () => THREE.Mesh
): PrankRuntime {
  return {
    scene,
    camera,
    host,
    shots: new Map(),
    flicks: new Map(),
    pops: [],
    flashes: [],
    seen: new Set(),
    heroShot: null,
    firstPerson: createFirstPersonShot(camera),
    shake: { startedAt: Number.NEGATIVE_INFINITY, strength: 0, duration: 0 },
    createChip,
    glassMaterials: [],
    glassGeometries: [],
  }
}

export interface PrankQueueContext {
  time: number
  reducedMotion: boolean
  seats: ReadonlyMap<string, PrankSeat>
  /** The hero is acting right now: a flick at them stays peripheral. */
  heroActing: boolean
}

/** Starts the presentation for a new server prank event (each id once). */
export function queuePrank(runtime: PrankRuntime, event: PrankEvent, context: PrankQueueContext) {
  if (runtime.seen.has(event.id)) return
  runtime.seen.add(event.id)
  if (Date.now() - event.at > STALE_EVENT_MS) return
  if (event.kind === 'shot_queued') return
  const target = context.seats.get(event.targetId)
  if (!target) return
  const { time } = context

  if (event.kind === 'shot' || event.kind === 'house_shot') {
    const cheers = event.kind === 'house_shot' && event.rule === 'cheers'
    if (context.reducedMotion) {
      addPop(runtime, 'shot', time, target.isHero ? { seatId: null, world: null, screen: { x: 0.5, y: 0.62 } } : { seatId: target.playerId, world: null, screen: null })
      return
    }
    const sender = event.kind === 'shot' ? context.seats.get(event.fromId) : undefined
    const from = new THREE.Vector3()
    if (sender) {
      seatLocalToWorld(sender, sender.anchors.stack, from)
    } else {
      from.copy(HOUSE_POUR_FROM)
    }
    const to = seatLocalToWorld(target, target.anchors.drinkRest, new THREE.Vector3())
    from.y = FELT_TOP_Y + 0.005
    to.y = FELT_TOP_Y + 0.005
    runtime.shots.set(event.id, {
      id: event.id,
      targetId: target.playerId,
      startedAt: time,
      cheers,
      glass: createShotGlass(runtime),
      from,
      to,
      toHero: target.isHero,
      popped: false,
      flashed: false,
    })
    if (target.isHero) runtime.heroShot = { startedAt: time, cheers }
    return
  }

  // Chip flick.
  const peripheral = target.isHero && context.heroActing
  if (context.reducedMotion) {
    addPop(runtime, 'bonk', time, target.isHero
      ? { seatId: null, world: null, screen: peripheral ? { x: 0.9, y: 0.14 } : { x: 0.5, y: 0.3 } }
      : { seatId: target.playerId, world: null, screen: null })
    return
  }
  const sender = context.seats.get(event.fromId)
  const chip = runtime.createChip()
  chip.scale.setScalar(CHIP_SCALE)
  // A little glint so the chip reads in flight against the dark room.
  chip.add(createGlow('#fff2c4', 0.22))
  chip.visible = false
  runtime.scene.add(chip)
  runtime.flicks.set(event.id, {
    id: event.id,
    fromId: event.fromId,
    targetId: target.playerId,
    startedAt: time,
    chip,
    launch: null,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    impacted: false,
    resting: false,
    toHero: target.isHero,
    fromHero: Boolean(sender?.isHero) || !sender,
    peripheral,
  })
}

/** Icon pop over a seat for house-rule drinks (beer, double beer, water). */
export function queueSeatPop(runtime: PrankRuntime, id: string, playerId: string, kind: PopIconKind, context: PrankQueueContext) {
  if (runtime.seen.has(id)) return
  runtime.seen.add(id)
  const seat = context.seats.get(playerId)
  if (!seat) return
  addPop(runtime, kind, context.time, seat.isHero
    ? { seatId: null, world: null, screen: { x: 0.5, y: 0.6 } }
    : { seatId: playerId, world: null, screen: null })
}

/** Animator input for one seat this frame. */
export function getSeatPrankInput(runtime: PrankRuntime, seat: PrankSeat, time: number, seats: ReadonlyMap<string, PrankSeat>): SeatPrankInput | null {
  let input: SeatPrankInput | null = null
  const ensure = () => (input ??= { shotElapsed: null, cheersRaise: 0, bonkElapsed: null, chipFlick: null })
  for (const shot of runtime.shots.values()) {
    if (shot.targetId !== seat.playerId) continue
    const elapsed = time - shot.startedAt
    const local = getShotLocalTime(elapsed, shot.cheers)
    if (local >= 0 && local <= SHOT_SHUDDER_END + 0.2) {
      ensure().shotElapsed = local
      ensure().cheersRaise = getCheersRaise(elapsed, shot.cheers)
    }
  }
  for (const flick of runtime.flicks.values()) {
    const elapsed = time - flick.startedAt
    if (flick.targetId === seat.playerId) {
      const bonk = elapsed - CHIP_IMPACT_AT
      if (bonk >= 0 && bonk <= CHIP_BONK_REACT_SECONDS) ensure().bonkElapsed = bonk
    }
    if (flick.fromId === seat.playerId && elapsed <= CHIP_FLICK_GESTURE_SECONDS) {
      headWorld(seats.get(flick.targetId), scratch)
      const local = seat.root.worldToLocal(scratch.clone())
      ensure().chipFlick = { elapsed, target: [local.x, local.y, local.z] }
    }
  }
  return input
}

export interface PrankFrame {
  time: number
  delta: number
  width: number
  height: number
  reducedMotion: boolean
  seats: ReadonlyMap<string, PrankSeat>
  heroColors: { skin: string; sleeve: string }
}

export interface PrankCameraKick {
  /** Head tipped back for the hero's own shot (0..1). */
  headTilt: number
  pitch: number
  yaw: number
  roll: number
}

const NO_KICK: PrankCameraKick = { headTilt: 0, pitch: 0, yaw: 0, roll: 0 }

function project(runtime: PrankRuntime, world: THREE.Vector3, width: number, height: number) {
  scratchB.copy(world).project(runtime.camera)
  return {
    x: (scratchB.x * 0.5 + 0.5) * width,
    y: (-scratchB.y * 0.5 + 0.5) * height,
    visible: scratchB.z < 1 && scratchB.z > -1,
  }
}

function startShake(runtime: PrankRuntime, time: number, strength: number, duration: number) {
  runtime.shake = { startedAt: time, strength, duration }
}

function updateShot(runtime: PrankRuntime, shot: ShotPrank, frame: PrankFrame) {
  const { time } = frame
  const elapsed = time - shot.startedAt
  const local = getShotLocalTime(elapsed, shot.cheers)
  const total = getShotTotalSeconds(shot.cheers)
  const { group, liquid, shadow } = shot.glass
  const seat = frame.seats.get(shot.targetId)
  if (elapsed > total || !seat) {
    removeShotGlass(shot.glass)
    runtime.shots.delete(shot.id)
    return
  }

  let scale = 1
  let inHand = false
  group.rotation.set(0, 0, 0)
  if (local < SHOT_ARRIVE_AT) {
    // Slides across the felt with a little wobble, decelerating into place.
    const t = easeOutCubic(local / SHOT_ARRIVE_AT)
    group.position.lerpVectors(shot.from, shot.to, t)
    const wobble = Math.sin(local * 26) * (1 - t) * 0.12
    group.rotation.set(wobble, local * 9 * (1 - t), wobble * 0.6)
    scale = Math.min(1, local / 0.12)
  } else if (!shot.toHero && seat.root.visible && local < SHOT_SLAM_AT) {
    const grab = smooth((local - (SHOT_ARRIVE_AT + 0.12)) / 0.22)
    const hand = handWorld(seat, scratch)
    group.position.copy(shot.to)
    if (hand && grab > 0) {
      // In the fist, tipping back with the throw.
      scratch.y -= 0.07
      group.position.lerp(scratch, grab)
      const lift = seat.lastPose?.drinkLift ?? 0
      group.rotation.set(0, seat.root.rotation.y, 0)
      group.rotateX(lift * 2.3)
      inHand = grab > 0.5
    }
  } else if (shot.toHero && local < SHOT_SLAM_AT + 0.1) {
    // Picked up first-person: the table glass hides as the camera one rises.
    group.position.copy(shot.to)
    scale = 1 - smooth((local - SHOT_ARRIVE_AT) / 0.15)
  } else {
    // Slammed upside down on the felt, a hop on impact, then it fades away.
    const since = local - SHOT_SLAM_AT
    group.position.copy(shot.to)
    group.position.y += 0.16 + Math.max(0, Math.sin(Math.min(1, since / 0.18) * Math.PI)) * 0.03
    group.rotation.set(Math.PI, seat.root.rotation.y, 0)
    scale = shot.toHero ? smooth(since / 0.3) : 1
    const fadeFrom = total - 0.7 - (shot.cheers ? 1 : 0)
    if (local > fadeFrom) scale *= 1 - smooth((local - fadeFrom) / 0.6)
  }
  if (!shot.popped && local >= SHOT_SLAM_AT) {
    shot.popped = true
    if (!shot.toHero) {
      addPop(runtime, 'shot', time, { seatId: seat.playerId, world: null, screen: null })
    }
  }
  if (shot.toHero && !shot.flashed && local >= SHOT_SLAM_AT) {
    shot.flashed = true
    startShake(runtime, time, 1, 0.45)
    addFlash(runtime, 'shot', time)
  }
  liquid.visible = local < (inHand ? SHOT_DOWN_AT - 0.1 : SHOT_SLAM_AT)
  // In a fist it is hand-sized; on the felt it is drawn big enough to read.
  const size = inHand ? 1.45 : GLASS_SCALE
  group.scale.setScalar(Math.max(0.001, scale * size))
  group.visible = scale > 0.01
  shadow.visible = group.visible && !inHand
  shadow.position.set(group.position.x, FELT_TOP_Y + 0.004, group.position.z)
  shadow.scale.setScalar(Math.max(0.001, scale * size))
}

function updateFlick(runtime: PrankRuntime, flick: FlickPrank, frame: PrankFrame) {
  const { time, delta } = frame
  const elapsed = time - flick.startedAt
  const chip = flick.chip
  if (elapsed > CHIP_TOTAL_SECONDS) {
    chip.removeFromParent()
    runtime.flicks.delete(flick.id)
    return
  }
  const sender = frame.seats.get(flick.fromId)
  const target = frame.seats.get(flick.targetId)
  const impactPoint = (out: THREE.Vector3) => flick.toHero
    ? heroCameraPoint(runtime, flick.peripheral ? [0.55, 0.32, -1.1] : [0.03, 0.06, -0.8], out)
    : headWorld(target, out, 0.14)

  if (elapsed < CHIP_LAUNCH_AT) {
    // Balanced on the flicker's fingertips while they cock the flick.
    const hand = !flick.fromHero && sender ? handWorld(sender, scratch) : null
    chip.visible = Boolean(hand) && elapsed > 0.12
    if (hand) {
      chip.position.copy(hand).add(scratchB.set(0, 0.05, 0))
      chip.rotation.set(0.4, 0, 0)
    }
    chip.scale.setScalar(CHIP_SCALE)
    return
  }
  if (!flick.launch) {
    flick.launch = new THREE.Vector3()
    const hand = !flick.fromHero && sender ? handWorld(sender, flick.launch) : null
    if (hand) flick.launch.y += 0.05
    else heroCameraPoint(runtime, [0.08, -0.3, -0.8], flick.launch)
  }
  chip.visible = true
  if (!flick.impacted) {
    const t = Math.min(1, (elapsed - CHIP_LAUNCH_AT) / CHIP_FLIGHT_SECONDS)
    const end = impactPoint(scratch)
    const distance = flick.launch.distanceTo(end)
    const control = scratchB.copy(flick.launch).lerp(end, 0.5)
    control.y += 0.5 + distance * 0.14
    // Quadratic bezier arc.
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    flick.position.set(
      flick.launch.x * a + control.x * b + end.x * c,
      flick.launch.y * a + control.y * b + end.y * c,
      flick.launch.z * a + control.z * b + end.z * c
    )
    chip.position.copy(flick.position)
    // Flying at the lens it would fill the screen: cap its apparent size.
    if (flick.toHero) chip.scale.setScalar(Math.min(CHIP_SCALE, 0.55 * runtime.camera.position.distanceTo(flick.position)))
    chip.rotation.x += delta * 30
    chip.rotation.z += delta * 8
    if (t >= 1) {
      flick.impacted = true
      if (flick.toHero) {
        const screen = project(runtime, end, 1, 1)
        addFlash(runtime, 'bonk', time, { x: screen.x, y: screen.y }, flick.peripheral)
        startShake(runtime, time, flick.peripheral ? 0.25 : 1, flick.peripheral ? 0.2 : 0.4)
        addPop(runtime, 'bonk', time, { seatId: null, world: null, screen: flick.peripheral ? { x: 0.88, y: 0.12 } : { x: screen.x, y: Math.max(0.12, screen.y - 0.08) } })
        // Drops away out of view, down onto the felt in front of the hero.
        runtime.camera.getWorldDirection(flick.velocity).multiplyScalar(0.6)
        flick.velocity.y = 0.4
      } else {
        addPop(runtime, 'bonk', time, { seatId: flick.targetId, world: null, screen: null })
        // Ricochet off the skull back toward the middle of the table.
        flick.velocity.set(-flick.position.x, 0, -flick.position.z).setY(0)
        if (flick.velocity.lengthSq() < 1e-6) flick.velocity.set(0, 0, -1)
        flick.velocity.normalize().multiplyScalar(1.6)
        flick.velocity.y = 1.7
      }
    }
    return
  }
  if (!flick.resting) {
    const dt = Math.min(0.05, delta)
    flick.velocity.y -= 9.8 * dt
    flick.position.addScaledVector(flick.velocity, dt)
    chip.rotation.x += delta * 18
    chip.rotation.y += delta * 6
    const floor = FELT_TOP_Y + 0.03
    const overFelt = Math.abs(flick.position.x) < 5.2 && Math.abs(flick.position.z + 0.3) < 3.6
    if (overFelt && flick.position.y <= floor && flick.velocity.y < 0) {
      flick.position.y = floor
      flick.velocity.y *= -0.38
      flick.velocity.x *= 0.55
      flick.velocity.z *= 0.55
      if (Math.abs(flick.velocity.y) < 0.5) {
        flick.resting = true
        flick.velocity.set(0, 0, 0)
      }
    }
    if (flick.position.y < -1) chip.visible = false
    chip.position.copy(flick.position)
  } else {
    // Settles flat on the felt, then fades.
    chip.rotation.x += (0 - chip.rotation.x) * Math.min(1, delta * 10)
    chip.rotation.z += (0 - chip.rotation.z) * Math.min(1, delta * 10)
    chip.position.y = FELT_TOP_Y + 0.025
  }
  const fadeFrom = CHIP_TOTAL_SECONDS - 0.5
  const baseScale = flick.toHero ? Math.min(CHIP_SCALE, 0.55 * runtime.camera.position.distanceTo(chip.position)) : CHIP_SCALE
  chip.scale.setScalar(baseScale * (elapsed > fadeFrom ? Math.max(0.001, 1 - (elapsed - fadeFrom) / 0.5) : 1))
}

function updatePops(runtime: PrankRuntime, frame: PrankFrame) {
  runtime.pops = runtime.pops.filter(pop => {
    const age = frame.time - pop.startedAt
    if (age > pop.life) {
      pop.element.remove()
      return false
    }
    let x = -999
    let y = -999
    if (pop.screen) {
      x = pop.screen.x * frame.width
      y = pop.screen.y * frame.height
    } else {
      const world = pop.seatId ? headWorld(frame.seats.get(pop.seatId), scratch, 0.66) : pop.world
      if (world) {
        const screen = project(runtime, world, frame.width, frame.height)
        if (screen.visible) {
          x = screen.x
          y = screen.y
        }
      }
    }
    pop.element.style.setProperty('--pop-x', `${x.toFixed(1)}px`)
    pop.element.style.setProperty('--pop-y', `${y.toFixed(1)}px`)
    return true
  })
  runtime.flashes = runtime.flashes.filter(flash => {
    if (frame.time < flash.removeAt) return true
    flash.element.remove()
    return false
  })
}

/** Advances every prank; returns the camera kick for this frame. */
export function updatePranks(runtime: PrankRuntime, frame: PrankFrame): PrankCameraKick {
  for (const shot of Array.from(runtime.shots.values())) updateShot(runtime, shot, frame)
  for (const flick of Array.from(runtime.flicks.values())) updateFlick(runtime, flick, frame)
  updatePops(runtime, frame)
  const headTilt = updateFirstPersonShot(runtime, frame.time, frame.heroColors)
  if (frame.reducedMotion) return headTilt > 0 ? { ...NO_KICK, headTilt } : NO_KICK
  const shake = runtime.shake
  const since = frame.time - shake.startedAt
  if (since < 0 || since > shake.duration) return headTilt > 0 ? { ...NO_KICK, headTilt } : NO_KICK
  const decay = Math.pow(1 - since / shake.duration, 2) * shake.strength
  return {
    headTilt,
    pitch: Math.sin(since * 57) * 0.022 * decay + 0.02 * decay,
    yaw: Math.sin(since * 43 + 1.3) * 0.016 * decay,
    roll: Math.sin(since * 38 + 0.5) * 0.02 * decay,
  }
}

export function disposePrankRuntime(runtime: PrankRuntime) {
  for (const shot of runtime.shots.values()) removeShotGlass(shot.glass)
  for (const flick of runtime.flicks.values()) flick.chip.removeFromParent()
  runtime.shots.clear()
  runtime.flicks.clear()
  runtime.pops.forEach(pop => pop.element.remove())
  runtime.flashes.forEach(flash => flash.element.remove())
  runtime.pops = []
  runtime.flashes = []
  runtime.glassMaterials.forEach(material => material.dispose())
  runtime.glassGeometries.forEach(geometry => geometry.dispose())
  const fp = runtime.firstPerson
  fp.materials.forEach(material => material.dispose())
  fp.geometries.forEach(geometry => geometry.dispose())
  fp.root.removeFromParent()
}
