import * as THREE from 'three'
import type { ThreeActionCue, ThreeTableViewModel } from './tableViewModel'
import { FELT_TOP_Y, getFeltEdgeToward } from './tableArt'
import {
  getLadyLuckMoodContext,
  hashLadyLuckSeed,
  pickLadyLuckLine,
  type LadyLuckLineContext,
} from '@/lib/ladyLuckLines'

/**
 * "Lady Luck" — a procedurally built, toon-shaded casino pool-party cocktail
 * server and hype-girl who attaches herself to whoever is on a winning streak.
 * Blonde blowout, sunglasses up, hibiscus, sporty red-and-gold swim top with
 * "LUCKY" lettering, high-waisted denim shorts, an open tropical shirt knotted
 * at the waist, platform sandals and a silver tray with a tropical cocktail.
 *
 * Bone-free rig of nested Groups (hips / torso / head / shoulder / elbow /
 * hand) animated with springs, analytic two-bone arm IK and a gesture library.
 * Everything (geometry, textures, particles) is generated in code.
 *
 * Model space: feet on y = 0, facing +Z, ~2.6 units tall at scale 1.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CompanionState = ThreeTableViewModel['companion']

/** Optional table context so she can react to the game (all fields optional). */
export interface CompanionTableContext {
  /** Changes whenever her owner acts (e.g. ThreePlayerView.actionKey). */
  ownerActionKey?: string
  /** What the owner just did (e.g. ThreePlayerView.actionCue). */
  ownerActionCue?: ThreeActionCue
  /** Other seated players' nicknames, for sassy remarks. */
  otherPlayerNames?: readonly string[]
  /** view.allInAnnouncement — she reacts to all-ins. */
  allIn?: { actionKey: string; playerId: string; nickname: string } | null
}

export interface CompanionUpdateInput {
  /** Seconds (monotonic clock). */
  time: number
  /** Seconds since the previous frame. */
  delta: number
  reducedMotion: boolean
  state: CompanionState
  /** World transform of the owner's seat root (seat faces -Z toward table center); null if owner not found. */
  ownerSeat: THREE.Object3D | null
  /** True when the owner is the local player: she stands in the lower-left foreground of the camera view instead. */
  ownerIsHero: boolean
  camera: THREE.Camera
  /** Optional: true while the owner has folded the current hand (she rolls her eyes once). */
  ownerFolded?: boolean
  /** Optional game context for her reactions and chatter. */
  table?: CompanionTableContext
}

export type CompanionGesture =
  | 'wink'
  | 'fingerGuns'
  | 'blowKiss'
  | 'hairFlip'
  | 'lean'
  | 'fan'
  | 'chaChing'
  | 'cheekKiss'
  | 'cheer'
  | 'eyeRoll'
  | 'serve'
  | 'shoulderRub'

export interface CompanionRuntime {
  group: THREE.Group
  /** @internal */
  rig: CompanionRig
  /** @internal */
  anim: CompanionAnimState
  /** @internal */
  fx: CompanionFx
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** Where she stands in seat-root space: beside the chair back. x sign is chosen per seat. */
export const COMPANION_SEAT_OFFSET = { x: 0.92, y: 0, z: 0.36 } as const
/** Where she stands for the shoulder rub: right behind the chair back. */
export const COMPANION_BEHIND_OFFSET = { x: 0, y: 0, z: 0.5 } as const
/** Seated player's head / shoulders in seat-root space (matches the avatar default anchors). */
export const COMPANION_PLAYER_HEAD = { x: 0, y: 1.52, z: -0.26 } as const
export const COMPANION_PLAYER_SHOULDER = { x: 0.24, y: 1.2, z: -0.1 } as const
/**
 * Hero placement, locked to the live camera: horizontal NDC, the NDC heights of
 * her feet and the top of her head, and her distance in front of the lens.
 * Lower-left foreground, full body, ~44% of the screen tall, clear of the left
 * nameplates (above), the board (right) and the action tray (bottom right).
 */
export const HERO_COMPANION_SCREEN = { x: -0.64, feetY: -0.8, headY: 0.04, depth: 2.1 } as const
/** Model height in local units at scale 1. */
export const COMPANION_HEIGHT = 2.6
/** Top of her hair above her soles, used for screen sizing. */
const COMPANION_VISIBLE_HEIGHT = 2.52
/** Her left arm carries the tray; her right arm does the gestures. */
const TRAY_ARM = 0
const GESTURE_ARM = 1

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let delta = (b - a) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/** Yaw (rotation about +Y, model faces +Z) that points `from` toward `to` on the ground plane. */
export function yawToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

/** Faces mostly toward the player she is flirting with, partly toward the camera so her face reads. */
export function computeCompanionYaw(
  position: THREE.Vector3,
  playerHead: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  cameraWeight = 0.45
): number {
  const towardPlayer = yawToward(position, playerHead)
  const towardCamera = yawToward(position, cameraPosition)
  return towardPlayer + angleDelta(towardPlayer, towardCamera) * cameraWeight
}

function projectToNdc(point: THREE.Vector3, camera: THREE.Camera) {
  return point.clone().project(camera)
}

/**
 * Picks which side of the chair she stands on (+1 = seat-local +X) so that, on
 * screen, she is as far as possible from the seated player's head and stays
 * inside the view.
 */
export function chooseCompanionSide(seat: THREE.Object3D, camera: THREE.Camera): 1 | -1 {
  seat.updateWorldMatrix(true, false)
  camera.updateMatrixWorld()
  const head = projectToNdc(
    seat.localToWorld(new THREE.Vector3(COMPANION_PLAYER_HEAD.x, COMPANION_PLAYER_HEAD.y, COMPANION_PLAYER_HEAD.z)),
    camera
  )
  const score = (side: 1 | -1) => {
    const chest = seat.localToWorld(
      new THREE.Vector3(COMPANION_SEAT_OFFSET.x * side, 1.6, COMPANION_SEAT_OFFSET.z)
    )
    const ndc = projectToNdc(chest, camera)
    // Horizontal screen separation matters most: side-by-side, not stacked.
    const separation = Math.abs(ndc.x - head.x)
    const offscreen = Math.max(0, Math.abs(ndc.x) - 0.9) * 6
    // Mild preference for standing behind (less chance of hiding his face).
    const behind = ndc.z > head.z ? 0.02 : 0
    return separation - offscreen + behind
  }
  return score(1) >= score(-1) ? 1 : -1
}

export interface CompanionPlacement {
  position: THREE.Vector3
  yaw: number
  scale: number
  /** Player's nearer shoulder in world space (hand-on-shoulder lean), when beside a seat. */
  shoulder: THREE.Vector3 | null
  /** Both of the player's shoulders (shoulder rub), when beside a seat. */
  shoulders: [THREE.Vector3, THREE.Vector3] | null
  /** Spot right behind the chair (shoulder rub) and the yaw she uses there. */
  behind: THREE.Vector3 | null
  behindYaw: number
  /** Player's head in world space, when known. */
  head: THREE.Vector3 | null
  /** Re-derived from the live camera every frame (no smoothing). */
  screenLocked: boolean
}

export function computeSeatCompanionPlacement(
  seat: THREE.Object3D,
  camera: THREE.Camera,
  side: 1 | -1
): CompanionPlacement {
  seat.updateWorldMatrix(true, false)
  const local = (x: number, y: number, z: number) => seat.localToWorld(new THREE.Vector3(x, y, z))
  const position = local(COMPANION_SEAT_OFFSET.x * side, COMPANION_SEAT_OFFSET.y, COMPANION_SEAT_OFFSET.z)
  const head = local(COMPANION_PLAYER_HEAD.x, COMPANION_PLAYER_HEAD.y, COMPANION_PLAYER_HEAD.z)
  const { x: sx, y: sy, z: sz } = COMPANION_PLAYER_SHOULDER
  const shoulder = local(sx * side, sy, sz)
  const shoulders: [THREE.Vector3, THREE.Vector3] = [local(sx, sy, sz), local(-sx, sy, sz)]
  const behind = local(COMPANION_BEHIND_OFFSET.x, COMPANION_BEHIND_OFFSET.y, COMPANION_BEHIND_OFFSET.z)
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3())
  const scale = seat.getWorldScale(new THREE.Vector3()).x
  return {
    position,
    yaw: computeCompanionYaw(position, head, cameraPosition),
    scale,
    shoulder,
    shoulders,
    behind,
    behindYaw: yawToward(behind, head),
    head,
    screenLocked: false,
  }
}

/**
 * Hero placement: the local player's seat is not rendered, so she stands in
 * the lower-left foreground of the live camera, full body, facing the viewer
 * and turned a little toward the table. Sized in screen space so it works for
 * any camera height, fov, aspect or drift.
 */
export function computeHeroCompanionPlacement(
  camera: THREE.Camera,
  screen: { x: number; feetY: number; headY: number; depth: number } = HERO_COMPANION_SCREEN
): CompanionPlacement {
  camera.updateMatrixWorld()
  const perspective = camera as THREE.PerspectiveCamera
  const tanHalf = perspective.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) : 0.5
  const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1.6
  const depth = screen.depth
  const feet = new THREE.Vector3(screen.x * depth * tanHalf * aspect, screen.feetY * depth * tanHalf, -depth)
    .applyMatrix4(camera.matrixWorld)
  const height = (screen.headY - screen.feetY) * depth * tanHalf
  const origin = camera.getWorldPosition(new THREE.Vector3())
  const forward = camera.getWorldDirection(new THREE.Vector3())
  const towardCamera = yawToward(feet, origin)
  const towardTable = yawToward(feet, origin.clone().addScaledVector(forward, 6))
  const yaw = towardCamera + angleDelta(towardCamera, towardTable) * 0.28
  // "You" are toward screen centre: a point to her side at head height.
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const inward = screen.x > 0 ? -1 : 1
  const scale = height / COMPANION_VISIBLE_HEIGHT
  const head = feet.clone().addScaledVector(right, inward * scale).setY(feet.y + scale * 1.6)
  return {
    position: feet,
    yaw,
    scale,
    shoulder: null,
    shoulders: null,
    behind: null,
    behindYaw: yaw,
    head,
    screenLocked: true,
  }
}

/** Where she sets the served cocktail: on the felt just inside the rail by the owner's seat, on her side. */
export function computeServeSpot(seatWorld: THREE.Vector3, companionWorld: THREE.Vector3): THREE.Vector3 {
  const { edge, normal } = getFeltEdgeToward(seatWorld.x, seatWorld.z)
  const tangent = new THREE.Vector2(-normal.y, normal.x)
  const toward = new THREE.Vector2(companionWorld.x - seatWorld.x, companionWorld.z - seatWorld.z)
  const lateral = toward.dot(tangent) >= 0 ? 1 : -1
  const spot = edge.clone().addScaledVector(normal, -0.42).addScaledVector(tangent, lateral * 0.42)
  return new THREE.Vector3(spot.x, FELT_TOP_Y, spot.y)
}

/** Deterministic PRNG. */
export function createCompanionRandom(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FLIRT_GESTURES: readonly CompanionGesture[] = [
  'wink', 'serve', 'hairFlip', 'shoulderRub', 'blowKiss', 'fingerGuns', 'lean', 'serve', 'cheekKiss', 'shoulderRub', 'fan',
]
const CHEER_GESTURES: readonly CompanionGesture[] = ['fingerGuns', 'chaChing', 'cheer', 'serve', 'hairFlip', 'shoulderRub']
const REDUCED_GESTURES: readonly CompanionGesture[] = ['wink']
/** Gestures that need a real seat next to her (not for the hero's foreground placement). */
export const SEAT_ONLY_GESTURES: readonly CompanionGesture[] = ['shoulderRub', 'lean']

/** Picks the next idle gesture for a mood, never repeating the previous one. */
export function pickCompanionGesture(
  mood: NonNullable<CompanionState>['mood'],
  random: () => number,
  previous: CompanionGesture | null,
  reducedMotion = false,
  exclude: readonly CompanionGesture[] = []
): CompanionGesture {
  const base = reducedMotion ? REDUCED_GESTURES : mood === 'cheer' ? CHEER_GESTURES : FLIRT_GESTURES
  const pool = base.filter(gesture => !exclude.includes(gesture))
  const usable = pool.length > 0 ? pool : REDUCED_GESTURES
  const choices = usable.length > 1 ? usable.filter(gesture => gesture !== previous) : usable
  return choices[Math.floor(random() * choices.length) % choices.length]!
}

export const GESTURE_DURATIONS: Record<CompanionGesture, number> = {
  wink: 1.3,
  fingerGuns: 1.9,
  blowKiss: 2.1,
  hairFlip: 1.8,
  lean: 3.6,
  fan: 2.6,
  chaChing: 2.0,
  cheekKiss: 3.0,
  cheer: 2.8,
  eyeRoll: 1.9,
  serve: 3.4,
  shoulderRub: 4.4,
}

/** Smooth keyframe interpolation: keys are [u, value] pairs sorted by u. */
export function keyframe(u: number, keys: ReadonlyArray<readonly [number, number]>): number {
  if (keys.length === 0) return 0
  if (u <= keys[0]![0]) return keys[0]![1]
  for (let index = 1; index < keys.length; index += 1) {
    const [u1, v1] = keys[index]!
    if (u <= u1) {
      const [u0, v0] = keys[index - 1]!
      const t = u1 === u0 ? 1 : (u - u0) / (u1 - u0)
      const s = t * t * (3 - 2 * t)
      return v0 + (v1 - v0) * s
    }
  }
  return keys[keys.length - 1]![1]
}

/** 0 → 1 → 0 envelope with eased attack/release, for blending a gesture over the idle pose. */
export function gestureEnvelope(u: number, attack = 0.16, release = 0.2): number {
  if (u <= 0 || u >= 1) return 0
  const a = THREE.MathUtils.smoothstep(u, 0, attack)
  const r = 1 - THREE.MathUtils.smoothstep(u, 1 - release, 1)
  return Math.min(a, r)
}

/** Critically-damped-ish spring step for a scalar. Returns [value, velocity]. */
export function springStep(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  stiffness = 120,
  damping = 16
): [number, number] {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  let x = value
  let v = velocity
  for (let step = 0; step < steps; step += 1) {
    const accel = (target - x) * stiffness - v * damping
    v += accel * h
    x += v * h
  }
  return [x, v]
}

/**
 * Analytic two-bone IK. Given the shoulder at the origin, bone lengths, a
 * target and a pole hint, returns the elbow position (in the same space).
 */
export function solveTwoBoneElbow(
  target: THREE.Vector3,
  pole: THREE.Vector3,
  upperLength: number,
  lowerLength: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const reach = upperLength + lowerLength
  const distance = THREE.MathUtils.clamp(target.length(), Math.abs(upperLength - lowerLength) + 1e-3, reach - 1e-3)
  const direction = target.lengthSq() > 1e-8 ? target.clone().normalize() : new THREE.Vector3(0, -1, 0)
  const cosAngle = THREE.MathUtils.clamp(
    (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance),
    -1,
    1
  )
  const sinAngle = Math.sqrt(1 - cosAngle * cosAngle)
  const perpendicular = pole.clone().sub(direction.clone().multiplyScalar(pole.dot(direction)))
  if (perpendicular.lengthSq() < 1e-8) {
    perpendicular.set(0, 0, -1).sub(direction.clone().multiplyScalar(-direction.z))
    if (perpendicular.lengthSq() < 1e-8) perpendicular.set(1, 0, 0)
  }
  perpendicular.normalize()
  return out
    .copy(direction)
    .multiplyScalar(cosAngle * upperLength)
    .addScaledVector(perpendicular, sinAngle * upperLength)
}

/** Current speech-bubble line for a context, deterministic per companion id + counter. */
export function companionLineFor(context: LadyLuckLineContext, companionId: string, counter: number, name?: string): string {
  return pickLadyLuckLine(context, hashLadyLuckSeed(`${companionId}:${context}`) + counter, name)
}

/** Seconds between her unprompted quips (min + random spread). */
const CHAT_GAP_MIN = 5
const CHAT_GAP_SPREAD = 5

// ---------------------------------------------------------------------------
// Procedural textures (pure data, no canvas — works in tests and workers)
// ---------------------------------------------------------------------------

function makeDataTexture(size: number, pixel: (u: number, v: number, x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size * 2 - 1
      const v = (y + 0.5) / size * 2 - 1
      const [r, g, b, a] = pixel(u, v, x, y)
      const index = (y * size + x) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = a
    }
  }
  return data
}

function toTexture(data: Uint8Array, size: number, repeat = false) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
  texture.needsUpdate = true
  return texture
}

/** Heart alpha: 1 inside, soft edge, plus a faint glow halo. v points up. */
export function heartTextureData(size = 64): Uint8Array {
  return makeDataTexture(size, (u, v) => {
    const x = u * 1.28
    const y = v * 1.28 + 0.18
    const a = x * x + y * y - 1
    const f = a * a * a - x * x * y * y * y
    const inside = 1 - THREE.MathUtils.smoothstep(f, -0.02, 0.03)
    const r = Math.hypot(u, v)
    const halo = Math.max(0, 1 - r) ** 2 * 0.35
    const alpha = Math.min(1, inside + halo)
    const core = inside > 0.5 ? 255 : 230
    return [255, core, core, Math.round(alpha * 255)]
  })
}

export function sparkleTextureData(size = 64): Uint8Array {
  return makeDataTexture(size, (u, v) => {
    const ax = Math.abs(u)
    const ay = Math.abs(v)
    const star = Math.exp(-ax * 16) * Math.exp(-ay * 2.4) + Math.exp(-ay * 16) * Math.exp(-ax * 2.4)
    const diag = Math.exp(-Math.abs(ax - ay) * 14) * Math.exp(-(ax + ay) * 3.2) * 0.45
    const core = Math.exp(-(u * u + v * v) * 30)
    const alpha = Math.min(1, star + diag + core)
    return [255, 255, 255, Math.round(alpha * 255)]
  })
}

function smokeTextureData(size = 64): Uint8Array {
  const random = createCompanionRandom(7)
  const lumps = Array.from({ length: 7 }, () => ({
    x: (random() - 0.5) * 0.8,
    y: (random() - 0.5) * 0.8,
    r: 0.35 + random() * 0.3,
  }))
  return makeDataTexture(size, (u, v) => {
    let density = 0
    for (const lump of lumps) {
      const d = Math.hypot(u - lump.x, v - lump.y) / lump.r
      density += Math.max(0, 1 - d * d)
    }
    const alpha = Math.min(1, density * 0.55) * Math.max(0, 1 - Math.hypot(u, v))
    return [255, 255, 255, Math.round(alpha * 255)]
  })
}

function lipsTextureData(size = 64): Uint8Array {
  return makeDataTexture(size, (u, v) => {
    // Upper lip: two lobes with a cupid's bow notch; lower lip: one wide lobe.
    const upperLeft = ((u + 0.3) / 0.42) ** 2 + ((v - 0.12) / 0.22) ** 2
    const upperRight = ((u - 0.3) / 0.42) ** 2 + ((v - 0.12) / 0.22) ** 2
    const lower = (u / 0.72) ** 2 + ((v + 0.12) / 0.28) ** 2
    const inside = Math.min(upperLeft, upperRight, lower)
    const seam = Math.abs(v - 0.0) < 0.035 && Math.abs(u) < 0.6 ? 0.45 : 1
    const alpha = (1 - THREE.MathUtils.smoothstep(inside, 0.85, 1)) * seam
    return [255, 255, 255, Math.round(alpha * 255)]
  })
}

function sequinTextureData(size = 128): Uint8Array {
  const random = createCompanionRandom(1337)
  const cell = 8
  const brightness = new Float32Array((size / cell) * (size / cell))
  for (let index = 0; index < brightness.length; index += 1) {
    const roll = random()
    brightness[index] = roll > 0.82 ? 1 : roll > 0.55 ? 0.35 : 0.05
  }
  return makeDataTexture(size, (_u, _v, x, y) => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const offset = cy % 2 === 0 ? 0 : cell / 2
    const lx = ((x + offset) % cell) - cell / 2 + 0.5
    const ly = (y % cell) - cell / 2 + 0.5
    const d = Math.hypot(lx, ly) / (cell * 0.5)
    const disc = Math.max(0, 1 - d * d)
    const b = brightness[cy * (size / cell) + cx]! * disc
    const value = Math.round(Math.min(1, b) * 255)
    return [value, value, value, 255]
  })
}

/** 5x7 bitmap glyphs for the "LUCKY" lettering on her swim top. */
const LUCKY_GLYPHS: Record<string, readonly string[]> = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
}

/** True when (u, v) hits a lit pixel of `text` laid out in the box (u: -w/2..w/2, v: v0..v1). */
export function hitsLuckyText(text: string, u: number, v: number, width: number, v0: number, v1: number): boolean {
  const columns = text.length * 6 - 1
  const column = Math.floor(((u + width / 2) / width) * columns)
  const row = Math.floor(((v1 - v) / (v1 - v0)) * 7)
  if (column < 0 || column >= columns || row < 0 || row >= 7) return false
  const letter = text[Math.floor(column / 6)] ?? ''
  const glyph = LUCKY_GLYPHS[letter]
  const within = column % 6
  return Boolean(glyph && within < 5 && glyph[row]![within] === '1')
}

/**
 * Sporty swim-top band texture: hot red with gold trim, a cream stripe and
 * "LUCKY" lettering centred on the front (lathe u = 0 is +Z).
 */
export function swimTopTextureData(width = 512, height = 64): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  const red = [226, 22, 44]
  const gold = [255, 201, 60]
  const cream = [255, 244, 222]
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x += 1) {
      const rawU = (x + 0.5) / width
      const u = ((rawU + 0.5) % 1) - 0.5
      let color = red
      if (v < 0.13 || v > 0.87) color = gold
      else if (Math.abs(u) < 0.17 && v > 0.26 && v < 0.74) {
        color = hitsLuckyText('LUCKY', u, v, 0.26, 0.32, 0.68) ? red : cream
      }
      const index = (y * width + x) * 4
      data[index] = color[0]!
      data[index + 1] = color[1]!
      data[index + 2] = color[2]!
      data[index + 3] = 255
    }
  }
  return data
}

/** Tileable tropical shirt print: white with red hibiscus, gold centres and green leaves. */
function shirtPrintTextureData(size = 128): Uint8Array {
  const random = createCompanionRandom(808)
  const flowers = Array.from({ length: 5 }, () => ({
    x: random(), y: random(), r: 0.09 + random() * 0.04, spin: random() * Math.PI,
  }))
  const leaves = Array.from({ length: 7 }, () => ({
    x: random(), y: random(), a: random() * Math.PI, l: 0.08 + random() * 0.05,
  }))
  const wrap = (d: number) => d - Math.round(d)
  return makeDataTexture(size, (_u, _v, px, py) => {
    const x = (px + 0.5) / size
    const y = (py + 0.5) / size
    let color: [number, number, number] = [255, 250, 240]
    for (const leaf of leaves) {
      const dx = wrap(x - leaf.x)
      const dy = wrap(y - leaf.y)
      const along = dx * Math.cos(leaf.a) + dy * Math.sin(leaf.a)
      const across = -dx * Math.sin(leaf.a) + dy * Math.cos(leaf.a)
      if ((along / leaf.l) ** 2 + (across / (leaf.l * 0.38)) ** 2 < 1) color = [46, 170, 92]
    }
    for (const flower of flowers) {
      const dx = wrap(x - flower.x)
      const dy = wrap(y - flower.y)
      const d = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx) + flower.spin
      const petal = flower.r * (0.72 + 0.28 * Math.cos(angle * 5))
      if (d < petal) color = d < flower.r * 0.22 ? [255, 206, 64] : [232, 34, 58]
    }
    return [color[0], color[1], color[2], 255]
  })
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

let sharedRamp: THREE.DataTexture | null = null
function getRamp() {
  if (sharedRamp) return sharedRamp
  const steps = new Uint8Array([84, 150, 214, 255])
  sharedRamp = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  sharedRamp.minFilter = THREE.NearestFilter
  sharedRamp.magFilter = THREE.NearestFilter
  sharedRamp.generateMipmaps = false
  sharedRamp.needsUpdate = true
  return sharedRamp
}

const PALETTE = {
  skin: '#ffc9a4',
  skinShade: '#f2a98a',
  blush: '#ff7aa2',
  hair: '#f3b63a',
  hairLight: '#fff1b8',
  swimRed: '#e2162c',
  gold: '#ffc93c',
  denim: '#3d6fbf',
  denimLight: '#7fa6de',
  shirt: '#ffffff',
  silver: '#d8dee9',
  lips: '#e8175d',
  iris: '#1f8fe8',
  pupil: '#141018',
  lash: '#1b0f14',
  brow: '#a0681f',
  lens: '#2a1330',
  petal: '#ff3d6e',
  sole: '#fff1dc',
  glass: '#e6f6ff',
  drinkTop: '#ffa531',
  drinkBottom: '#ff2f6d',
  umbrella: '#19c6b3',
  white: '#fffaf6',
  ink: '#1a0d12',
} as const

interface MaterialSet {
  skin: THREE.MeshToonMaterial
  skinShade: THREE.MeshToonMaterial
  hair: THREE.MeshToonMaterial
  hairLight: THREE.MeshToonMaterial
  swimTop: THREE.MeshToonMaterial
  red: THREE.MeshToonMaterial
  gold: THREE.MeshToonMaterial
  denim: THREE.MeshToonMaterial
  denimLight: THREE.MeshToonMaterial
  shirt: THREE.MeshToonMaterial
  silver: THREE.MeshToonMaterial
  lips: THREE.MeshToonMaterial
  eyeWhite: THREE.MeshBasicMaterial
  iris: THREE.MeshToonMaterial
  pupil: THREE.MeshBasicMaterial
  glint: THREE.MeshBasicMaterial
  lash: THREE.MeshBasicMaterial
  brow: THREE.MeshBasicMaterial
  lens: THREE.MeshToonMaterial
  petal: THREE.MeshToonMaterial
  sole: THREE.MeshToonMaterial
  glass: THREE.MeshToonMaterial
  drinkTop: THREE.MeshToonMaterial
  drinkBottom: THREE.MeshToonMaterial
  umbrella: THREE.MeshToonMaterial
  leaf: THREE.MeshToonMaterial
  blush: THREE.MeshBasicMaterial
  outline: THREE.MeshBasicMaterial
  outlineThin: THREE.MeshBasicMaterial
  sequinTexture: THREE.DataTexture
  textures: THREE.Texture[]
  all: THREE.Material[]
}

function toon(color: THREE.ColorRepresentation, lift = 0.2, extra: THREE.MeshToonMaterialParameters = {}) {
  const base = new THREE.Color(color)
  const material = new THREE.MeshToonMaterial({
    color: base,
    gradientMap: getRamp(),
    emissive: base.clone().multiplyScalar(lift),
    ...extra,
  })
  return material
}

function createOutlineMaterial(width: number) {
  const material = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.BackSide })
  material.name = 'companion-outline'
  material.onBeforeCompile = shader => {
    shader.uniforms.outlineWidth = { value: width }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed += normalize(normal) * outlineWidth;'
      )
  }
  material.customProgramCacheKey = () => `companion-outline-${width}`
  return material
}

function createMaterials(): MaterialSet {
  const sequinTexture = toTexture(sequinTextureData(128), 128, true)
  sequinTexture.repeat.set(8, 1)
  const swimTexture = new THREE.DataTexture(swimTopTextureData(512, 64), 512, 64, THREE.RGBAFormat)
  swimTexture.colorSpace = THREE.SRGBColorSpace
  swimTexture.wrapS = THREE.RepeatWrapping
  swimTexture.magFilter = THREE.LinearFilter
  swimTexture.minFilter = THREE.LinearMipmapLinearFilter
  swimTexture.generateMipmaps = true
  swimTexture.anisotropy = 4
  swimTexture.needsUpdate = true
  const printTexture = toTexture(shirtPrintTextureData(128), 128, true)
  printTexture.repeat.set(3, 2)
  const set = {
    skin: toon(PALETTE.skin, 0.34),
    skinShade: toon(PALETTE.skinShade, 0.3),
    hair: toon(PALETTE.hair, 0.22),
    hairLight: toon(PALETTE.hairLight, 0.4),
    // Hot red + gold trim with a little sequin sparkle (emissive glints bloom).
    swimTop: toon('#ffffff', 0, {
      map: swimTexture,
      emissive: new THREE.Color('#ffe7a8'),
      emissiveMap: sequinTexture,
      emissiveIntensity: 0.7,
    }),
    red: toon(PALETTE.swimRed, 0.25),
    gold: toon(PALETTE.gold, 0.38),
    denim: toon(PALETTE.denim, 0.22),
    denimLight: toon(PALETTE.denimLight, 0.26),
    shirt: toon(PALETTE.shirt, 0.18, { map: printTexture, side: THREE.DoubleSide }),
    silver: toon(PALETTE.silver, 0.36),
    lips: toon(PALETTE.lips, 0.3),
    eyeWhite: new THREE.MeshBasicMaterial({ color: PALETTE.white }),
    iris: toon(PALETTE.iris, 0.35),
    pupil: new THREE.MeshBasicMaterial({ color: PALETTE.pupil }),
    glint: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false }),
    lash: new THREE.MeshBasicMaterial({ color: PALETTE.lash }),
    brow: new THREE.MeshBasicMaterial({ color: PALETTE.brow }),
    lens: toon(PALETTE.lens, 0.15),
    petal: toon(PALETTE.petal, 0.3),
    sole: toon(PALETTE.sole, 0.3),
    glass: toon(PALETTE.glass, 0.4, { transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    drinkTop: toon(PALETTE.drinkTop, 0.4),
    drinkBottom: toon(PALETTE.drinkBottom, 0.35),
    umbrella: toon(PALETTE.umbrella, 0.3, { side: THREE.DoubleSide }),
    leaf: toon('#34b35a', 0.25),
    blush: new THREE.MeshBasicMaterial({ color: PALETTE.blush, transparent: true, opacity: 0.4, depthWrite: false }),
    outline: createOutlineMaterial(0.013),
    outlineThin: createOutlineMaterial(0.007),
    sequinTexture,
  }
  return {
    ...set,
    textures: [sequinTexture, swimTexture, printTexture],
    all: (Object.values(set) as unknown[]).filter((value): value is THREE.Material => value instanceof THREE.Material),
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Part {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

function part(
  geometry: THREE.BufferGeometry,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): Part {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale)
  )
  return { geometry, matrix }
}

/** Merges transformed parts into one geometry (position + normal + uv), baking scale so outlines stay even. */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const normalMatrix = new THREE.Matrix3()
  const vertex = new THREE.Vector3()
  const normal = new THREE.Vector3()
  let offset = 0
  for (const { geometry, matrix } of parts) {
    const source = geometry.index ? geometry : geometry
    const position = source.getAttribute('position') as THREE.BufferAttribute
    const normalAttribute = source.getAttribute('normal') as THREE.BufferAttribute | undefined
    const uv = source.getAttribute('uv') as THREE.BufferAttribute | undefined
    normalMatrix.getNormalMatrix(matrix)
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(matrix)
      positions.push(vertex.x, vertex.y, vertex.z)
      if (normalAttribute) {
        normal.fromBufferAttribute(normalAttribute, index).applyMatrix3(normalMatrix).normalize()
        normals.push(normal.x, normal.y, normal.z)
      } else {
        normals.push(0, 1, 0)
      }
      if (uv) uvs.push(uv.getX(index), uv.getY(index))
      else uvs.push(0, 0)
    }
    if (source.index) {
      for (let index = 0; index < source.index.count; index += 1) indices.push(source.index.getX(index) + offset)
    } else {
      for (let index = 0; index < position.count; index += 1) indices.push(index + offset)
    }
    offset += position.count
    geometry.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return merged
}

function sphere(radius: number, w = 20, h = 14) {
  return new THREE.SphereGeometry(radius, w, h)
}

function lathe(points: Array<[number, number]>, segments = 28) {
  // LatheGeometry normals face outward only when the profile runs bottom -> top.
  const ordered = points[0]![1] > points[points.length - 1]![1] ? [...points].reverse() : points
  return new THREE.LatheGeometry(ordered.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

/** Adds a mesh (and optional ink outline sharing its geometry) to a parent. */
function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  outline: THREE.Material | null,
  position: [number, number, number] = [0, 0, 0]
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = true
  parent.add(mesh)
  if (outline) {
    const hull = new THREE.Mesh(geometry, outline)
    hull.name = 'outline'
    hull.castShadow = false
    mesh.add(hull)
  }
  return mesh
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

interface ArmRig {
  side: 1 | -1
  shoulder: THREE.Group
  elbow: THREE.Group
  hand: THREE.Group
  upperLength: number
  lowerLength: number
}

interface EyeRig {
  group: THREE.Group
  iris: THREE.Group
  lid: THREE.Group
}

interface CompanionRig {
  model: THREE.Group
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  hairLeft: THREE.Group
  hairRight: THREE.Group
  hairBack: THREE.Group
  bangs: THREE.Group
  eyes: [EyeRig, EyeRig]
  brows: [THREE.Group, THREE.Group]
  mouth: THREE.Group
  upperLip: THREE.Mesh
  lowerLip: THREE.Mesh
  earrings: THREE.Group[]
  arms: [ArmRig, ArmRig]
  shirt: THREE.Group
  /** Round silver tray (model space, placed each frame). */
  tray: THREE.Group
  /** The tropical cocktail normally riding on the tray (model space, placed each frame). */
  cocktail: THREE.Group
  materials: MaterialSet
}

/** Model-space pivots. */
const PIVOT = {
  hips: new THREE.Vector3(0, 1.2, 0),
  torso: new THREE.Vector3(0, 1.4, 0),
  neck: new THREE.Vector3(0, 1.88, 0.0),
  shoulder: new THREE.Vector3(0.205, 1.8, -0.01),
} as const

const HEAD_CENTER_Y = 0.27 // above the neck pivot
const HEAD_RADIUS = 0.2

/** Torso skin profile (radius, y); the swim top and shirt are offset from it. */
const TORSO_PROFILE: Array<[number, number]> = [
  [0.0, 1.36],
  [0.136, 1.36],
  [0.14, 1.46],
  [0.152, 1.56],
  [0.16, 1.64],
  [0.16, 1.71],
  [0.155, 1.77],
  [0.13, 1.815],
  [0.07, 1.83],
  [0.0, 1.832],
]
const TORSO_DEPTH = 0.72

function buildLegs(model: THREE.Group, materials: MaterialSet) {
  for (const side of [1, -1] as const) {
    const leg = new THREE.Group()
    leg.position.set(side * 0.08, 0, 0)
    // Model pose: one knee angled in front of the other.
    leg.rotation.z = side === 1 ? -0.05 : 0.025
    leg.rotation.x = side === 1 ? -0.07 : 0
    model.add(leg)
    const limb = lathe(
      [
        [0.0, 0.1],
        [0.03, 0.105],
        [0.036, 0.2],
        [0.053, 0.34],
        [0.043, 0.5],
        [0.057, 0.7],
        [0.07, 0.95],
        [0.0, 1.02],
      ],
      16
    )
    limb.scale(1, 1, 0.92)
    addMesh(leg, limb, materials.skin, materials.outlineThin)

    // Foot on a chunky platform sandal with red straps.
    const foot = sphere(0.04, 14, 10)
    foot.scale(0.85, 0.6, 2.1)
    addMesh(leg, foot, materials.skin, materials.outlineThin, [0, 0.085, 0.045])
    const sole = mergeParts([
      part(new THREE.CapsuleGeometry(0.042, 0.1, 4, 12), [0, 0.034, 0.04], [Math.PI / 2, 0, 0], [1, 1, 0.85]),
      part(new THREE.BoxGeometry(0.07, 0.03, 0.07), [0, 0.06, -0.015]),
    ])
    addMesh(leg, sole, materials.sole, materials.outlineThin)
    const straps = mergeParts([
      part(new THREE.TorusGeometry(0.038, 0.011, 6, 18, Math.PI), [0, 0.078, 0.09], [0, Math.PI / 2, 0], [1, 0.9, 1.1]),
      part(new THREE.TorusGeometry(0.034, 0.009, 6, 18), [0, 0.125, 0.0], [Math.PI / 2, 0, 0], [1, 1, 0.95]),
    ])
    addMesh(leg, straps, materials.red, null)
  }
}

function buildHips(hips: THREE.Group, materials: MaterialSet) {
  const oy = -PIVOT.hips.y
  // High-waisted denim shorts with rolled cuffs and a gold button.
  const seat = lathe(
    [
      [0.0, 1.04],
      [0.165, 1.05],
      [0.192, 1.12],
      [0.194, 1.22],
      [0.178, 1.32],
      [0.152, 1.42],
      [0.146, 1.475],
      [0.0, 1.476],
    ],
    32
  )
  seat.scale(1, 1, 0.8)
  seat.translate(0, oy, 0)
  const legs = ([1, -1] as const).map(side => part(
    new THREE.CylinderGeometry(0.09, 0.096, 0.12, 20),
    [side * 0.08, 1.01 + oy, 0],
    [0, 0, side * 0.04],
    [1, 1, 0.88]
  ))
  addMesh(hips, mergeParts([{ geometry: seat, matrix: new THREE.Matrix4() }, ...legs]), materials.denim, materials.outline)
  const trim = mergeParts([
    part(new THREE.TorusGeometry(0.093, 0.016, 8, 24), [0.08, 0.955 + oy, 0], [Math.PI / 2, 0, 0], [1.02, 0.88, 1]),
    part(new THREE.TorusGeometry(0.093, 0.016, 8, 24), [-0.08, 0.955 + oy, 0], [Math.PI / 2, 0, 0], [1.02, 0.88, 1]),
    part(new THREE.TorusGeometry(0.148, 0.013, 8, 36), [0, 1.462 + oy, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]),
  ])
  addMesh(hips, trim, materials.denimLight, materials.outlineThin)
  addMesh(hips, sphere(0.014, 10, 8), materials.gold, null, [0, 1.44 + oy, 0.12])
}

function buildTorso(torso: THREE.Group, materials: MaterialSet) {
  const oy = -PIVOT.torso.y
  const body = lathe(TORSO_PROFILE, 32)
  body.scale(1, 1, TORSO_DEPTH)
  body.translate(0, oy, 0)
  addMesh(torso, body, materials.skin, materials.outline)

  // Sporty swim top: a modest band (bandeau) with gold trim and "LUCKY" on the front.
  const band = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.158, 1.575),
      new THREE.Vector2(0.166, 1.62),
      new THREE.Vector2(0.168, 1.67),
      new THREE.Vector2(0.167, 1.72),
      new THREE.Vector2(0.161, 1.765),
    ],
    40
  )
  band.scale(1.04, 1, TORSO_DEPTH * 1.08)
  band.translate(0, oy, 0)
  addMesh(torso, band, materials.swimTop, materials.outlineThin)

  // Halter straps up to the neck.
  const straps = ([1, -1] as const).map(side => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.075, 1.76 + oy, 0.105),
      new THREE.Vector3(side * 0.06, 1.83 + oy, 0.075),
      new THREE.Vector3(side * 0.045, 1.9 + oy, 0.02),
      new THREE.Vector3(side * 0.02, 1.925 + oy, -0.04),
    ])
    return { geometry: new THREE.TubeGeometry(curve, 12, 0.011, 6), matrix: new THREE.Matrix4() }
  })
  addMesh(torso, mergeParts(straps), materials.red, null)

  // Rounded shoulders and a slim neck (skin).
  const shoulders = mergeParts([
    part(new THREE.CapsuleGeometry(0.056, 0.3, 6, 16), [0, 1.8 + oy, -0.012], [0, 0, Math.PI / 2], [1, 1, 0.82]),
    part(lathe([[0.0, 1.78], [0.058, 1.78], [0.046, 1.86], [0.044, 1.95], [0.0, 1.96]], 16), [0, oy, 0.0]),
  ])
  addMesh(torso, shoulders, materials.skin, materials.outlineThin)
}

/** Open short-sleeve tropical shirt knotted at the waist. */
function buildShirt(torso: THREE.Group, materials: MaterialSet) {
  const oy = -PIVOT.torso.y
  const group = new THREE.Group()
  group.name = 'shirt'
  torso.add(group)
  const opening = 0.62
  const shell = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.168, 1.44),
      new THREE.Vector2(0.178, 1.52),
      new THREE.Vector2(0.19, 1.6),
      new THREE.Vector2(0.196, 1.68),
      new THREE.Vector2(0.192, 1.75),
      new THREE.Vector2(0.172, 1.805),
      new THREE.Vector2(0.12, 1.845),
    ],
    36,
    opening,
    Math.PI * 2 - opening * 2
  )
  // Pull the front panels in toward the knot at the waist.
  const position = shell.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    v.fromBufferAttribute(position, index)
    const phi = Math.atan2(v.x, v.z)
    const front = Math.max(0, 1 - Math.abs(phi) / 1.5)
    const low = THREE.MathUtils.clamp((1.6 - v.y) / 0.16, 0, 1)
    const pinch = 1 - front * low * 0.75
    position.setX(index, v.x * pinch)
  }
  position.needsUpdate = true
  shell.computeVertexNormals()
  shell.scale(1, 1, TORSO_DEPTH * 1.12)
  shell.translate(0, oy, 0)
  addMesh(group, shell, materials.shirt, materials.outlineThin)

  const extras = mergeParts([
    // Collar points.
    part(sphere(0.05, 12, 8), [0.085, 1.815 + oy, 0.085], [0.3, 0.5, -0.9], [1.3, 0.22, 0.75]),
    part(sphere(0.05, 12, 8), [-0.085, 1.815 + oy, 0.085], [0.3, -0.5, 0.9], [1.3, 0.22, 0.75]),
    // Knot and its two tails.
    part(sphere(0.036, 12, 10), [0, 1.455 + oy, 0.125], [0, 0, 0.3], [1.3, 1, 0.9]),
    part(new THREE.CapsuleGeometry(0.022, 0.07, 4, 8), [0.03, 1.4 + oy, 0.13], [0.1, 0, 0.45], [1, 1, 0.6]),
    part(new THREE.CapsuleGeometry(0.022, 0.06, 4, 8), [-0.035, 1.405 + oy, 0.128], [0.1, 0, -0.5], [1, 1, 0.6]),
  ])
  addMesh(group, extras, materials.shirt, materials.outlineThin)
  return group
}

function buildArm(torso: THREE.Group, materials: MaterialSet, side: 1 | -1): ArmRig {
  const upperLength = 0.3
  const lowerLength = 0.27
  const shoulder = new THREE.Group()
  shoulder.position.set(PIVOT.shoulder.x * side, PIVOT.shoulder.y - PIVOT.torso.y, PIVOT.shoulder.z)
  torso.add(shoulder)

  const upper = lathe(
    [
      [0.0, 0.03],
      [0.046, 0.0],
      [0.047, -0.08],
      [0.04, -0.2],
      [0.034, -upperLength],
      [0.0, -upperLength - 0.03],
    ],
    14
  )
  addMesh(shoulder, upper, materials.skin, materials.outlineThin)
  // Short puffed shirt sleeve.
  const sleeve = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.063, -0.14),
      new THREE.Vector2(0.066, -0.1),
      new THREE.Vector2(0.066, -0.02),
      new THREE.Vector2(0.056, 0.04),
      new THREE.Vector2(0.02, 0.07),
    ],
    16
  )
  addMesh(shoulder, sleeve, materials.shirt, materials.outlineThin)

  const elbow = new THREE.Group()
  elbow.position.set(0, -upperLength, 0)
  shoulder.add(elbow)
  const fore = lathe(
    [
      [0.0, 0.02],
      [0.033, 0.0],
      [0.034, -0.08],
      [0.025, -lowerLength + 0.01],
      [0.0, -lowerLength - 0.01],
    ],
    14
  )
  addMesh(elbow, fore, materials.skin, materials.outlineThin)
  // Gold bangles.
  const bangles = mergeParts([
    part(new THREE.TorusGeometry(0.031, 0.007, 6, 18), [0, -0.21, 0], [Math.PI / 2, 0, 0.1]),
    part(new THREE.TorusGeometry(0.03, 0.006, 6, 18), [0, -0.235, 0], [Math.PI / 2, 0.15, 0]),
  ])
  addMesh(elbow, bangles, materials.gold, null)

  const hand = new THREE.Group()
  hand.position.set(0, -lowerLength, 0)
  elbow.add(hand)
  // Cartoon hand: palm, fused fingers and a thumb.
  const palm = mergeParts([
    part(sphere(0.036, 14, 10), [0, -0.035, 0], [0, 0, 0], [0.8, 1.05, 0.48]),
    part(new THREE.CapsuleGeometry(0.013, 0.05, 4, 8), [side * -0.012, -0.085, 0.002], [0, 0, side * 0.05]),
    part(new THREE.CapsuleGeometry(0.013, 0.055, 4, 8), [side * 0.012, -0.088, 0.002], [0, 0, side * -0.04]),
    part(new THREE.CapsuleGeometry(0.012, 0.032, 4, 8), [side * -0.03, -0.04, 0.018], [0.3, 0, side * 0.7]),
  ])
  addMesh(hand, palm, materials.skin, materials.outlineThin)

  return { side, shoulder, elbow, hand, upperLength, lowerLength }
}

function buildEye(head: THREE.Group, materials: MaterialSet, side: 1 | -1): EyeRig {
  const group = new THREE.Group()
  group.position.set(side * 0.076, HEAD_CENTER_Y + 0.024, HEAD_RADIUS * 0.8)
  group.rotation.y = side * 0.32
  head.add(group)

  const white = sphere(0.055, 20, 14)
  white.scale(0.82, 1.08, 0.42)
  addMesh(group, white, materials.eyeWhite, materials.outlineThin)

  const iris = new THREE.Group()
  iris.position.set(0, -0.004, 0.018)
  group.add(iris)
  const irisDisc = sphere(0.034, 16, 12)
  irisDisc.scale(0.95, 1.12, 0.28)
  addMesh(iris, irisDisc, materials.iris, null)
  const pupil = sphere(0.018, 12, 10)
  pupil.scale(1, 1.15, 0.3)
  addMesh(iris, pupil, materials.pupil, null, [0, -0.002, 0.007])
  const glint = sphere(0.009, 8, 6)
  glint.scale(1, 1, 0.4)
  addMesh(iris, glint, materials.glint, null, [side * -0.01, 0.014, 0.011])
  const glintSmall = sphere(0.005, 8, 6)
  addMesh(iris, glintSmall, materials.glint, null, [side * 0.012, -0.012, 0.011])

  // Upper lid line + lashes with an outer flick (moves down to blink).
  const lid = new THREE.Group()
  group.add(lid)
  const lidGeometry = mergeParts([
    part(new THREE.TorusGeometry(0.047, 0.0075, 6, 20, Math.PI * 0.95), [0, 0.004, 0.012], [0, 0, Math.PI * 0.025], [1, 1.05, 1]),
    part(new THREE.ConeGeometry(0.009, 0.042, 6), [side * 0.052, 0.03, 0.01], [0, 0, side * -1.05]),
    part(new THREE.ConeGeometry(0.007, 0.03, 6), [side * 0.036, 0.048, 0.012], [0, 0, side * -0.55]),
    part(new THREE.ConeGeometry(0.006, 0.024, 6), [side * 0.012, 0.056, 0.014], [0, 0, side * -0.2]),
  ])
  addMesh(lid, lidGeometry, materials.lash, null)
  return { group, iris, lid }
}

function buildHead(head: THREE.Group, materials: MaterialSet) {
  // Face: soft heart-shaped head (wider cheeks, small chin).
  const face = sphere(HEAD_RADIUS, 28, 22)
  const facePosition = face.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let index = 0; index < facePosition.count; index += 1) {
    v.fromBufferAttribute(facePosition, index)
    const down = Math.max(0, -v.y / HEAD_RADIUS)
    // Taper toward a small chin, nudge the jaw forward a touch.
    const taper = 1 - down * down * 0.32
    facePosition.setXYZ(index, v.x * taper * 0.88, v.y * 1.1, v.z * (0.96 - down * 0.06) + down * 0.012)
  }
  face.computeVertexNormals()
  face.translate(0, HEAD_CENTER_Y, 0)
  addMesh(head, face, materials.skin, materials.outline)

  // Ears hidden by hair; nose is a small button.
  const nose = sphere(0.014, 12, 8)
  nose.scale(1, 0.8, 0.9)
  addMesh(head, nose, materials.skinShade, null, [0, HEAD_CENTER_Y - 0.045, HEAD_RADIUS * 0.94])

  // Rosy cheeks.
  for (const side of [1, -1] as const) {
    const blush = new THREE.CircleGeometry(0.032, 16)
    const cheek = addMesh(head, blush, materials.blush, null, [side * 0.11, HEAD_CENTER_Y - 0.052, HEAD_RADIUS * 0.8])
    cheek.rotation.y = side * 0.55
    cheek.scale.set(1.3, 0.8, 1)
    cheek.castShadow = false
  }

  // Beauty mark.
  addMesh(head, sphere(0.0065, 8, 6), materials.pupil, null, [-0.085, HEAD_CENTER_Y - 0.085, HEAD_RADIUS * 0.84])
}

function buildMouth(head: THREE.Group, materials: MaterialSet) {
  const mouth = new THREE.Group()
  mouth.position.set(0, HEAD_CENTER_Y - 0.095, HEAD_RADIUS * 0.86)
  mouth.rotation.x = -0.12
  head.add(mouth)
  const upper = mergeParts([
    part(sphere(0.017, 14, 10), [-0.013, 0.005, 0], [0, 0, 0.3], [1.3, 0.5, 0.6]),
    part(sphere(0.017, 14, 10), [0.013, 0.005, 0], [0, 0, -0.3], [1.3, 0.5, 0.6]),
  ])
  const upperLip = addMesh(mouth, upper, materials.lips, null)
  const lowerGeometry = sphere(0.02, 16, 10)
  lowerGeometry.scale(1.4, 0.62, 0.64)
  const lowerLip = addMesh(mouth, lowerGeometry, materials.lips, null, [0, -0.012, 0.001])
  return { mouth, upperLip, lowerLip }
}

function buildBrows(head: THREE.Group, materials: MaterialSet): [THREE.Group, THREE.Group] {
  const brows = ([1, -1] as const).map(side => {
    const brow = new THREE.Group()
    brow.position.set(side * 0.078, HEAD_CENTER_Y + 0.1, HEAD_RADIUS * 0.84)
    brow.rotation.y = side * 0.32
    head.add(brow)
    const arc = new THREE.TorusGeometry(0.05, 0.0055, 5, 14, Math.PI * 0.45)
    arc.rotateZ(Math.PI * 0.28 + side * 0.08)
    arc.translate(0, -0.038, 0)
    addMesh(brow, arc, materials.brow, null)
    return brow
  })
  return [brows[0]!, brows[1]!]
}

function buildHair(head: THREE.Group, materials: MaterialSet) {
  const y = HEAD_CENTER_Y
  // Big golden blowout; the cap sits above the brow line so the face stays open.
  const crown = mergeParts([
    part(sphere(0.222, 24, 18), [0, y + 0.075, -0.045]),
    part(sphere(0.175, 22, 16), [-0.03, y + 0.21, -0.02], [0, 0, 0.2], [1.34, 0.8, 1.14]),
    part(sphere(0.125, 18, 14), [0.19, y + 0.04, -0.01], [0, 0, 0], [0.8, 1.28, 1.0]),
    part(sphere(0.125, 18, 14), [-0.19, y + 0.04, -0.01], [0, 0, 0], [0.8, 1.28, 1.0]),
    part(sphere(0.19, 20, 16), [0, y - 0.1, -0.12], [0, 0, 0], [1.2, 1.22, 0.76]),
    part(sphere(0.16, 20, 14), [0, y - 0.31, -0.14], [0, 0, 0], [1.32, 1.0, 0.66]),
  ])
  addMesh(head, crown, materials.hair, materials.outline)

  // Glossy toon highlight streaks on the crown.
  const shine = mergeParts([
    part(sphere(0.08, 14, 10), [0.1, y + 0.3, 0.1], [0.5, 0.2, -0.5], [1.6, 0.3, 0.5]),
    part(sphere(0.06, 12, 10), [-0.13, y + 0.28, 0.1], [0.5, -0.2, 0.6], [1.5, 0.28, 0.5]),
    part(sphere(0.05, 12, 10), [0.22, y + 0.08, 0.08], [0, 0.6, -1.2], [1.5, 0.3, 0.5]),
  ])
  addMesh(head, shine, materials.hairLight, null)

  // Side-parted swoop across the forehead.
  const bangs = new THREE.Group()
  bangs.position.set(0, y + 0.15, 0.08)
  head.add(bangs)
  const bangGeometry = mergeParts([
    part(sphere(0.09, 20, 14), [-0.02, 0.03, 0.04], [0.2, 0.1, -0.25], [1.6, 0.55, 0.85]),
    part(sphere(0.075, 18, 12), [0.1, -0.02, 0.03], [0.15, 0.3, -0.7], [1.4, 0.6, 0.8]),
    part(sphere(0.06, 16, 12), [0.165, -0.11, 0.0], [0.1, 0.4, -1.2], [1.4, 0.65, 0.8]),
  ])
  addMesh(bangs, bangGeometry, materials.hair, materials.outlineThin)

  // Beachy waves on each side, flipping outward at the ends.
  const sides = ([1, -1] as const).map(side => {
    const group = new THREE.Group()
    group.position.set(side * 0.19, y - 0.04, -0.05)
    head.add(group)
    const waves = mergeParts([
      part(sphere(0.12, 18, 14), [side * 0.01, -0.07, 0.0], [0, 0, side * 0.2], [0.9, 1.2, 1.0]),
      part(sphere(0.115, 18, 14), [side * 0.045, -0.23, -0.02], [0, 0, side * -0.25], [0.95, 1.15, 0.95]),
      part(sphere(0.09, 16, 12), [side * 0.115, -0.36, -0.02], [0, 0, side * 0.9], [1.45, 0.75, 0.9]),
    ])
    addMesh(group, waves, materials.hair, materials.outlineThin)
    return group
  })

  const hairBack = new THREE.Group()
  hairBack.position.set(0, y - 0.38, -0.15)
  head.add(hairBack)
  const back = mergeParts([
    part(sphere(0.125, 18, 14), [-0.08, -0.06, 0.0], [0, 0, 0.3], [1.0, 1.2, 0.7]),
    part(sphere(0.125, 18, 14), [0.08, -0.06, 0.0], [0, 0, -0.3], [1.0, 1.2, 0.7]),
    part(sphere(0.09, 16, 12), [-0.15, -0.24, 0.02], [0, 0, -0.8], [1.4, 0.8, 0.8]),
    part(sphere(0.09, 16, 12), [0.15, -0.24, 0.02], [0, 0, 0.8], [1.4, 0.8, 0.8]),
  ])
  addMesh(hairBack, back, materials.hair, materials.outlineThin)

  return { hairLeft: sides[0]!, hairRight: sides[1]!, hairBack, bangs }
}

function buildEarrings(head: THREE.Group, materials: MaterialSet) {
  return ([1, -1] as const).map(side => {
    const group = new THREE.Group()
    group.position.set(side * 0.172, HEAD_CENTER_Y - 0.05, 0.03)
    head.add(group)
    const hoop = new THREE.TorusGeometry(0.05, 0.008, 6, 24)
    hoop.rotateY(side * 0.55)
    hoop.translate(0, -0.052, 0)
    addMesh(group, hoop, materials.gold, null)
    return group
  })
}

/** Glossy heart-ish sunglasses pushed up on the hair + a hibiscus behind the ear. */
function buildHeadAccessories(head: THREE.Group, materials: MaterialSet) {
  const y = HEAD_CENTER_Y
  const glasses = new THREE.Group()
  glasses.position.set(0, y + 0.255, 0.19)
  glasses.rotation.x = -0.32
  head.add(glasses)
  const lenses = mergeParts(([1, -1] as const).map(side => part(
    sphere(0.05, 16, 12), [side * 0.062, 0, 0], [0, 0, side * -0.25], [1.2, 0.82, 0.32]
  )))
  addMesh(glasses, lenses, materials.lens, materials.outlineThin)
  const frame = mergeParts([
    ...([1, -1] as const).map(side => part(
      new THREE.TorusGeometry(0.052, 0.009, 6, 24), [side * 0.062, 0, 0.004], [0, 0, side * -0.25], [1.2, 0.82, 1]
    )),
    part(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 6), [0, 0.012, 0.004], [0, 0, Math.PI / 2]),
  ])
  addMesh(glasses, frame, materials.gold, null)
  for (const side of [1, -1] as const) {
    addMesh(glasses, sphere(0.011, 8, 6), materials.glint, null, [side * 0.062 - 0.018, 0.016, 0.018])
  }

  // Hibiscus behind her right ear.
  const flower = new THREE.Group()
  flower.position.set(-0.235, y + 0.07, 0.09)
  flower.rotation.set(0.1, -0.8, 0.25)
  head.add(flower)
  const petals: Part[] = []
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2
    petals.push(part(sphere(0.044, 12, 8), [Math.cos(angle) * 0.045, Math.sin(angle) * 0.045, 0], [0, 0, angle], [1.2, 0.8, 0.28]))
  }
  addMesh(flower, mergeParts(petals), materials.petal, materials.outlineThin)
  addMesh(flower, sphere(0.016, 10, 8), materials.gold, null, [0, 0, 0.012])
}

/** A tropical cocktail (hurricane glass, layered sunrise, umbrella, cherry). Base at y = 0. */
function buildCocktail(materials: MaterialSet) {
  const group = new THREE.Group()
  group.name = 'cocktail'
  const glass = lathe(
    [
      [0.0, 0.0],
      [0.045, 0.0],
      [0.042, 0.012],
      [0.013, 0.02],
      [0.013, 0.045],
      [0.045, 0.08],
      [0.056, 0.135],
      [0.046, 0.19],
      [0.054, 0.25],
    ],
    20
  )
  const glassMesh = addMesh(group, glass, materials.glass, null)
  glassMesh.renderOrder = 3
  glassMesh.castShadow = false
  const bottom = lathe([[0.0, 0.05], [0.036, 0.075], [0.05, 0.12], [0.0, 0.121]], 18)
  addMesh(group, bottom, materials.drinkBottom, null)
  const top = lathe([[0.0, 0.12], [0.05, 0.12], [0.049, 0.16], [0.043, 0.19], [0.048, 0.225], [0.0, 0.226]], 18)
  addMesh(group, top, materials.drinkTop, null)
  // Orange wheel on the rim, cherry, straw and a little umbrella.
  addMesh(group, mergeParts([part(new THREE.CylinderGeometry(0.034, 0.034, 0.01, 16), [0.05, 0.245, 0], [0, 0, 1.2])]), materials.drinkTop, materials.outlineThin)
  addMesh(group, sphere(0.018, 10, 8), materials.red, materials.outlineThin, [-0.02, 0.238, 0.02])
  addMesh(group, mergeParts([part(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), [-0.015, 0.29, -0.012], [0.12, 0, 0.18])]), materials.petal, null)
  const umbrella = new THREE.Group()
  umbrella.position.set(0.018, 0.25, -0.01)
  umbrella.rotation.set(-0.35, 0, -0.4)
  group.add(umbrella)
  addMesh(umbrella, new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5).translate(0, 0.08, 0), materials.sole, null)
  const canopy = new THREE.ConeGeometry(0.08, 0.035, 10, 1, true)
  canopy.translate(0, 0.16, 0)
  addMesh(umbrella, canopy, materials.umbrella, materials.outlineThin)
  return group
}

function buildTray(materials: MaterialSet) {
  const tray = new THREE.Group()
  tray.name = 'tray'
  const disc = mergeParts([
    part(new THREE.CylinderGeometry(0.2, 0.18, 0.014, 36), [0, -0.007, 0]),
    part(new THREE.TorusGeometry(0.198, 0.011, 8, 40), [0, 0.0, 0], [Math.PI / 2, 0, 0]),
  ])
  addMesh(tray, disc, materials.silver, materials.outlineThin)
  // A bright glint strip that catches the bloom.
  const glint = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.004, 4, 20, Math.PI * 0.35), materials.glint)
  glint.rotation.set(Math.PI / 2, 0, 0.6)
  glint.position.y = 0.006
  tray.add(glint)
  return tray
}

function buildRig(): CompanionRig {
  const materials = createMaterials()
  const model = new THREE.Group()
  model.name = 'lady-luck-model'

  buildLegs(model, materials)

  const hips = new THREE.Group()
  hips.position.copy(PIVOT.hips)
  model.add(hips)
  buildHips(hips, materials)

  const torso = new THREE.Group()
  torso.position.set(0, PIVOT.torso.y - PIVOT.hips.y, 0)
  hips.add(torso)
  buildTorso(torso, materials)
  const shirt = buildShirt(torso, materials)

  const head = new THREE.Group()
  head.position.set(0, PIVOT.neck.y - PIVOT.torso.y, PIVOT.neck.z)
  torso.add(head)
  buildHead(head, materials)
  const eyes: [EyeRig, EyeRig] = [buildEye(head, materials, 1), buildEye(head, materials, -1)]
  const brows = buildBrows(head, materials)
  const { mouth, upperLip, lowerLip } = buildMouth(head, materials)
  const hair = buildHair(head, materials)
  const earrings = buildEarrings(head, materials)
  buildHeadAccessories(head, materials)

  const arms: [ArmRig, ArmRig] = [buildArm(torso, materials, 1), buildArm(torso, materials, -1)]

  const tray = buildTray(materials)
  model.add(tray)
  const cocktail = buildCocktail(materials)
  model.add(cocktail)

  return {
    model,
    hips,
    torso,
    head,
    hairLeft: hair.hairLeft,
    hairRight: hair.hairRight,
    hairBack: hair.hairBack,
    bangs: hair.bangs,
    eyes,
    brows,
    mouth,
    upperLip,
    lowerLip,
    earrings,
    arms,
    shirt,
    tray,
    cocktail,
    materials,
  }
}

// ---------------------------------------------------------------------------
// Pose + animation
// ---------------------------------------------------------------------------

const BODY_CHANNELS = [
  'bob', 'hipX', 'hipRz', 'hipRy', 'hipRx', 'torRx', 'torRz', 'torRy',
  'headRx', 'headRy', 'headRz', 'hairFlip',
  'smile', 'pout', 'kiss', 'browUp', 'browAngry', 'gazeX', 'gazeY', 'squint',
] as const
type BodyChannel = (typeof BODY_CHANNELS)[number]
type BodyPose = Record<BodyChannel, number>

interface ArmTarget {
  target: THREE.Vector3
  pole: THREE.Vector3
  handX: number
  handZ: number
}

interface PoseTargets {
  body: BodyPose
  arms: [ArmTarget, ArmTarget]
  blink: [number, number]
}

function zeroBody(): BodyPose {
  const pose = {} as BodyPose
  for (const channel of BODY_CHANNELS) pose[channel] = 0
  return pose
}

function createArmTarget(): ArmTarget {
  return { target: new THREE.Vector3(), pole: new THREE.Vector3(), handX: 0, handZ: 0 }
}

type Phase = 'hidden' | 'entering' | 'present' | 'leaving'

interface ActiveGesture {
  name: CompanionGesture
  start: number
  duration: number
  fired: Set<string>
}

interface CompanionAnimState {
  phase: Phase
  phaseStart: number
  current: NonNullable<CompanionState> | null
  pending: NonNullable<CompanionState> | null
  lastMood: NonNullable<CompanionState>['mood'] | null
  lastSince: number
  gesture: ActiveGesture | null
  lastGesture: CompanionGesture | null
  nextGestureAt: number
  nextBlinkAt: number
  blinkStart: number
  random: () => number
  body: BodyPose
  bodyVelocity: BodyPose
  arms: [ArmTarget, ArmTarget]
  armVelocity: [{ target: THREE.Vector3; pole: THREE.Vector3 }, { target: THREE.Vector3; pole: THREE.Vector3 }]
  side: 1 | -1
  sideForOwner: string | null
  placement: CompanionPlacement | null
  position: THREE.Vector3
  positionReady: boolean
  yaw: number
  line: string | null
  lineUntil: number
  lineCounter: number
  time: number
  ownerFolded: boolean
  exitFast: boolean
  enteredBurst: boolean
  fxPuffed: boolean
  /** x sign (in her own frame) of the side the player is on. */
  playerSide: 1 | -1
  queuedGesture: CompanionGesture | null
  trayOnHead: number
  trayOnHeadTarget: number
  standBehind: number
  standBehindTarget: number
  cocktailInHand: boolean
  cocktailServedUntil: number
  serveSpot: THREE.Vector3 | null
  muted: boolean
  lineIsMute: boolean
  recentLines: string[]
  nextChatAt: number
  lastOwnerActionKey: string | null
  lastAllInKey: string | null
  otherNames: readonly string[]
}

const REST_ARM_TARGET = (side: 1 | -1): ArmTarget => ({
  target: new THREE.Vector3(side * 0.27, -0.2, 0.03),
  pole: new THREE.Vector3(side * 0.4, 0, -1),
  handX: 0,
  handZ: 0.1,
})

function setArm(arm: ArmTarget, x: number, y: number, z: number, px: number, py: number, pz: number, handX = 0, handZ = 0) {
  arm.target.set(x, y, z)
  arm.pole.set(px, py, pz)
  arm.handX = handX
  arm.handZ = handZ
}

function blendArm(arm: ArmTarget, into: ArmTarget, weight: number) {
  if (weight <= 0) return
  arm.target.lerp(into.target, weight)
  arm.pole.lerp(into.pole, weight)
  arm.handX += (into.handX - arm.handX) * weight
  arm.handZ += (into.handZ - arm.handZ) * weight
}

function blendBody(pose: BodyPose, channel: BodyChannel, value: number, weight: number) {
  pose[channel] += (value - pose[channel]) * weight
}


// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

type ParticleKind = 'heart' | 'sparkle' | 'smoke' | 'confetti' | 'coin' | 'lips'

interface Particle {
  object: THREE.Sprite | THREE.Mesh
  kind: ParticleKind
  velocity: THREE.Vector3
  spin: THREE.Vector3
  age: number
  life: number
  size: number
  active: boolean
  color: THREE.Color
  wobble: number
}

interface CompanionFx {
  group: THREE.Group
  sprites: Particle[]
  served: ServedDrink[]
  confetti: Particle[]
  textures: THREE.Texture[]
  heartTexture: THREE.Texture
  sparkleTexture: THREE.Texture
  smokeTexture: THREE.Texture
  lipsTexture: THREE.Texture
  confettiGeometry: THREE.PlaneGeometry
}

const SPRITE_POOL = 64
const CONFETTI_POOL = 48

function createFx(scene: THREE.Scene): CompanionFx {
  const group = new THREE.Group()
  group.name = 'lady-luck-fx'
  group.renderOrder = 5
  scene.add(group)
  const heartTexture = toTexture(heartTextureData(64), 64)
  const sparkleTexture = toTexture(sparkleTextureData(64), 64)
  const smokeTexture = toTexture(smokeTextureData(64), 64)
  const lipsTexture = toTexture(lipsTextureData(64), 64)
  const sprites: Particle[] = []
  for (let index = 0; index < SPRITE_POOL; index += 1) {
    const material = new THREE.SpriteMaterial({
      map: heartTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.visible = false
    sprite.renderOrder = 6
    group.add(sprite)
    sprites.push({
      object: sprite, kind: 'heart', velocity: new THREE.Vector3(), spin: new THREE.Vector3(),
      age: 0, life: 1, size: 0.2, active: false, color: new THREE.Color(), wobble: 0,
    })
  }
  const confettiGeometry = new THREE.PlaneGeometry(0.05, 0.028)
  const confetti: Particle[] = []
  for (let index = 0; index < CONFETTI_POOL; index += 1) {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, transparent: true })
    const mesh = new THREE.Mesh(confettiGeometry, material)
    mesh.visible = false
    group.add(mesh)
    confetti.push({
      object: mesh, kind: 'confetti', velocity: new THREE.Vector3(), spin: new THREE.Vector3(),
      age: 0, life: 1, size: 1, active: false, color: new THREE.Color(), wobble: 0,
    })
  }
  return {
    group,
    sprites,
    confetti,
    textures: [heartTexture, sparkleTexture, smokeTexture, lipsTexture],
    heartTexture,
    sparkleTexture,
    smokeTexture,
    lipsTexture,
    confettiGeometry,
    served: [],
  }
}

const HEART_COLORS = [new THREE.Color(2.4, 0.55, 1.2), new THREE.Color(2.6, 0.35, 0.7), new THREE.Color(2.0, 0.8, 1.9)]
const SPARKLE_COLORS = [new THREE.Color(2.6, 2.2, 1.3), new THREE.Color(2.2, 1.6, 2.6), new THREE.Color(2.8, 2.8, 2.6)]
const CONFETTI_COLORS = ['#ff4fa3', '#ffd23f', '#8a5bff', '#35e0c2', '#ff7a3d', '#ffffff'].map(color => new THREE.Color(color))

function spawnSprite(
  fx: CompanionFx,
  kind: Exclude<ParticleKind, 'confetti'>,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  life: number,
  size: number,
  color: THREE.Color
) {
  const particle = fx.sprites.find(entry => !entry.active) ?? fx.sprites.reduce((oldest, entry) => (
    entry.age / entry.life > oldest.age / oldest.life ? entry : oldest
  ))
  const sprite = particle.object as THREE.Sprite
  const material = sprite.material
  material.map = kind === 'heart' ? fx.heartTexture
    : kind === 'smoke' ? fx.smokeTexture
      : kind === 'lips' ? fx.lipsTexture
        : fx.sparkleTexture
  material.blending = kind === 'smoke' || kind === 'lips' ? THREE.NormalBlending : THREE.AdditiveBlending
  material.needsUpdate = true
  particle.kind = kind
  particle.active = true
  particle.age = 0
  particle.life = life
  particle.size = size
  particle.color.copy(color)
  particle.velocity.copy(velocity)
  particle.wobble = Math.random() * Math.PI * 2
  particle.spin.set(0, 0, (Math.random() - 0.5) * (kind === 'sparkle' ? 5 : 1.2))
  sprite.position.copy(origin)
  sprite.visible = true
  material.rotation = kind === 'heart' ? (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI
  sprite.scale.setScalar(0.001)
}

function spawnConfetti(fx: CompanionFx, origin: THREE.Vector3, count: number, scale: number) {
  let spawned = 0
  for (const particle of fx.confetti) {
    if (spawned >= count) break
    if (particle.active) continue
    const mesh = particle.object as THREE.Mesh
    const material = mesh.material as THREE.MeshBasicMaterial
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!
    material.color.copy(color)
    material.opacity = 1
    particle.active = true
    particle.age = 0
    particle.life = 1.8 + Math.random() * 0.9
    const angle = Math.random() * Math.PI * 2
    const speed = (0.8 + Math.random() * 1.4) * scale
    particle.velocity.set(Math.cos(angle) * speed * 0.6, (2.2 + Math.random() * 1.6) * scale, Math.sin(angle) * speed * 0.6)
    particle.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
    mesh.position.copy(origin)
    mesh.scale.setScalar(scale * (0.8 + Math.random() * 0.6))
    mesh.visible = true
    spawned += 1
  }
}

function updateParticles(fx: CompanionFx, dt: number, time: number) {
  for (const particle of fx.sprites) {
    if (!particle.active) continue
    particle.age += dt
    const sprite = particle.object as THREE.Sprite
    if (particle.age >= particle.life) {
      particle.active = false
      sprite.visible = false
      continue
    }
    const u = particle.age / particle.life
    const material = sprite.material
    if (particle.kind === 'heart') {
      particle.velocity.y += 0.25 * dt
      sprite.position.addScaledVector(particle.velocity, dt)
      sprite.position.x += Math.sin(time * 3.2 + particle.wobble) * 0.25 * dt
      const pop = u < 0.15 ? THREE.MathUtils.smoothstep(u, 0, 0.15) * 1.25 : 1.25 - Math.min(0.25, (u - 0.15) * 1.4)
      const pulse = 1 + Math.sin(particle.age * 9) * 0.06
      sprite.scale.setScalar(particle.size * pop * pulse)
      material.color.copy(particle.color).multiplyScalar(1 - THREE.MathUtils.smoothstep(u, 0.6, 1))
    } else if (particle.kind === 'sparkle' || particle.kind === 'coin') {
      particle.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.4))
      particle.velocity.y -= (particle.kind === 'coin' ? 2.2 : 0.2) * dt
      sprite.position.addScaledVector(particle.velocity, dt)
      const twinkle = 0.65 + 0.35 * Math.sin(particle.age * 26 + particle.wobble)
      sprite.scale.setScalar(particle.size * (1 - u * 0.6) * twinkle)
      material.rotation += particle.spin.z * dt
      material.color.copy(particle.color).multiplyScalar(1 - THREE.MathUtils.smoothstep(u, 0.55, 1))
    } else if (particle.kind === 'smoke') {
      particle.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.6))
      sprite.position.addScaledVector(particle.velocity, dt)
      sprite.scale.setScalar(particle.size * (0.5 + u * 1.1))
      material.rotation += particle.spin.z * dt
      material.color.copy(particle.color)
      material.opacity = 0.75 * (1 - u) * THREE.MathUtils.smoothstep(u, 0, 0.08)
    } else if (particle.kind === 'lips') {
      sprite.position.addScaledVector(particle.velocity, dt)
      const pop = u < 0.1 ? THREE.MathUtils.smoothstep(u, 0, 0.1) * 1.3 : 1.3 - Math.min(0.3, (u - 0.1) * 3)
      sprite.scale.set(particle.size * pop, particle.size * pop * 0.72, 1)
      material.color.copy(particle.color)
      material.opacity = 1 - THREE.MathUtils.smoothstep(u, 0.7, 1)
    }
    if (particle.kind !== 'smoke' && particle.kind !== 'lips') material.opacity = 1
  }
  for (const particle of fx.confetti) {
    if (!particle.active) continue
    particle.age += dt
    const mesh = particle.object as THREE.Mesh
    if (particle.age >= particle.life) {
      particle.active = false
      mesh.visible = false
      continue
    }
    particle.velocity.y -= 5.2 * dt
    particle.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.5))
    mesh.position.addScaledVector(particle.velocity, dt)
    mesh.position.x += Math.sin(time * 5 + particle.age * 3) * 0.1 * dt
    mesh.rotation.x += particle.spin.x * dt
    mesh.rotation.y += particle.spin.y * dt
    mesh.rotation.z += particle.spin.z * dt
    const material = mesh.material as THREE.MeshBasicMaterial
    material.opacity = 1 - THREE.MathUtils.smoothstep(particle.age / particle.life, 0.75, 1)
  }
}

function clearParticles(fx: CompanionFx) {
  for (const particle of [...fx.sprites, ...fx.confetti]) {
    particle.active = false
    particle.object.visible = false
  }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function createCompanion(scene: THREE.Scene): CompanionRuntime {
  const rig = buildRig()
  const group = new THREE.Group()
  group.name = 'lady-luck'
  group.visible = false
  group.add(rig.model)
  scene.add(group)
  const fx = createFx(scene)

  const anim: CompanionAnimState = {
    phase: 'hidden',
    phaseStart: 0,
    current: null,
    pending: null,
    lastMood: null,
    lastSince: 0,
    gesture: null,
    lastGesture: null,
    nextGestureAt: 0,
    nextBlinkAt: 1.5,
    blinkStart: -10,
    random: createCompanionRandom(20260926),
    body: zeroBody(),
    bodyVelocity: zeroBody(),
    arms: [REST_ARM_TARGET(1), REST_ARM_TARGET(-1)],
    armVelocity: [
      { target: new THREE.Vector3(), pole: new THREE.Vector3() },
      { target: new THREE.Vector3(), pole: new THREE.Vector3() },
    ],
    side: 1,
    sideForOwner: null,
    placement: null,
    position: new THREE.Vector3(),
    positionReady: false,
    yaw: 0,
    line: null,
    lineUntil: 0,
    lineCounter: 0,
    time: 0,
    ownerFolded: false,
    exitFast: false,
    enteredBurst: false,
    fxPuffed: false,
    playerSide: -1,
    queuedGesture: null,
    trayOnHead: 0,
    trayOnHeadTarget: 0,
    standBehind: 0,
    standBehindTarget: 0,
    cocktailInHand: false,
    cocktailServedUntil: 0,
    serveSpot: null,
    muted: false,
    lineIsMute: false,
    recentLines: [],
    nextChatAt: 0,
    lastOwnerActionKey: null,
    lastAllInKey: null,
    otherNames: [],
  }

  return { group, rig, anim, fx }
}

export function disposeCompanion(runtime: CompanionRuntime): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const collect = (object: THREE.Object3D) => {
    object.traverse(child => {
      const mesh = child as THREE.Mesh | THREE.Sprite
      if ((mesh as THREE.Mesh).geometry) geometries.add((mesh as THREE.Mesh).geometry)
      const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach(entry => materials.add(entry))
      else if (material) materials.add(material)
    })
  }
  collect(runtime.group)
  collect(runtime.fx.group)
  runtime.group.removeFromParent()
  runtime.fx.group.removeFromParent()
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  runtime.rig.materials.textures.forEach(texture => texture.dispose())
  runtime.fx.textures.forEach(texture => texture.dispose())
}

export function getCompanionLine(runtime: CompanionRuntime): string | null {
  const { anim } = runtime
  if (!anim.line || anim.time > anim.lineUntil) return null
  if (anim.muted && !anim.lineIsMute) return null
  return anim.line
}

/** World-space point just above her head, for anchoring a DOM speech bubble. Returns false when hidden. */
export function getCompanionBubbleAnchor(runtime: CompanionRuntime, out: THREE.Vector3): boolean {
  if (!runtime.group.visible) return false
  runtime.rig.head.updateWorldMatrix(true, false)
  runtime.rig.head.localToWorld(out.set(0, HEAD_CENTER_Y + 0.42, 0))
  return true
}

/** Force a gesture right now (dev harness / debugging). */
export function triggerCompanionGesture(runtime: CompanionRuntime, name: CompanionGesture): void {
  const { anim } = runtime
  if (anim.phase !== 'present') return
  startGesture(anim, name, anim.time)
}

function say(anim: CompanionAnimState, context: LadyLuckLineContext, duration: number, name?: string) {
  // Once told to shut up she only gets her one pouty "Fine." in.
  if (anim.muted && context !== 'muted') return
  const id = anim.current?.id ?? 'lady-luck'
  let line = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    anim.lineCounter += 1
    line = companionLineFor(context, id, anim.lineCounter, name)
    if (!anim.recentLines.includes(line)) break
  }
  anim.recentLines = [line, ...anim.recentLines].slice(0, 4)
  anim.line = line
  anim.lineIsMute = context === 'muted'
  anim.lineUntil = anim.time + duration
  anim.nextChatAt = Math.max(anim.nextChatAt, anim.time + duration + CHAT_GAP_MIN + anim.random() * CHAT_GAP_SPREAD)
}

function startGesture(anim: CompanionAnimState, name: CompanionGesture, time: number) {
  anim.gesture = { name, start: time, duration: GESTURE_DURATIONS[name], fired: new Set() }
  anim.lastGesture = name
}

function setPhase(anim: CompanionAnimState, phase: Phase, time: number) {
  anim.phase = phase
  anim.phaseStart = time
}

function beginEntrance(runtime: CompanionRuntime, state: NonNullable<CompanionState>, time: number) {
  const { anim } = runtime
  anim.current = state
  anim.pending = null
  anim.lastMood = state.mood
  anim.lastSince = state.since
  anim.gesture = null
  anim.positionReady = false
  anim.random = createCompanionRandom(hashLadyLuckSeed(state.id))
  anim.nextGestureAt = time + 3.2 + anim.random() * 1.5
  anim.lineCounter = 0
  anim.ownerFolded = false
  anim.exitFast = false
  anim.queuedGesture = null
  anim.muted = Boolean(state.muted)
  anim.lineIsMute = false
  anim.nextChatAt = time + 5 + anim.random() * 3
  anim.lastOwnerActionKey = null
  anim.lastAllInKey = null
  anim.standBehindTarget = 0
  anim.trayOnHeadTarget = 0
  anim.cocktailInHand = false
  anim.cocktailServedUntil = 0
  if (anim.sideForOwner !== state.ownerId) anim.sideForOwner = null
  setPhase(anim, 'entering', time)
  anim.line = null
}

function beginExit(runtime: CompanionRuntime, time: number, fast: boolean) {
  const { anim } = runtime
  if (anim.phase === 'hidden' || anim.phase === 'leaving') return
  anim.gesture = null
  anim.exitFast = fast
  setPhase(anim, 'leaving', time)
  if (!fast) say(anim, 'sulk_leave', 3)
}

function handleState(runtime: CompanionRuntime, input: CompanionUpdateInput) {
  const { anim } = runtime
  const state = input.state
  const time = anim.time
  const visible = anim.phase === 'entering' || anim.phase === 'present'

  if (!state || state.mood === 'sulk_leave') {
    anim.pending = null
    if (visible && (!state || state.id === anim.current?.id || state.mood === 'sulk_leave')) {
      beginExit(runtime, time, false)
    }
    return
  }

  if (!anim.current || state.id !== anim.current.id) {
    if (visible) {
      // Switching owner: quick huff at the old one, then reappear by the new one.
      anim.pending = state
      beginExit(runtime, time, true)
      return
    }
    if (anim.phase === 'leaving') {
      anim.pending = state
      return
    }
    beginEntrance(runtime, state, time)
    return
  }

  // Same companion: react to mood edges.
  const moodChanged = state.mood !== anim.lastMood || state.since !== anim.lastSince
  anim.current = state
  const present = anim.phase === 'present'
  if (moodChanged) {
    anim.lastMood = state.mood
    anim.lastSince = state.since
    if (state.mood === 'cheer' && present) {
      // Owner won again: wink + finger-guns, then a victory cheer.
      startGesture(anim, input.reducedMotion ? 'wink' : 'fingerGuns', time)
      anim.queuedGesture = input.reducedMotion ? null : 'cheer'
      say(anim, 'cheer', 3)
      anim.nextGestureAt = time + GESTURE_DURATIONS.fingerGuns + 0.3
    }
  }

  // Told to shut up: one pout, then silence (gestures carry on).
  const muted = Boolean(state.muted)
  if (muted && !anim.muted) {
    anim.muted = true
    say(anim, 'muted', 2.2)
    if (present) {
      startGesture(anim, 'eyeRoll', time)
      anim.nextGestureAt = time + GESTURE_DURATIONS.eyeRoll + 2.5
    }
  } else if (!muted && anim.muted) {
    anim.muted = false
  }

  // React to the owner's own actions and to all-ins.
  const table = input.table
  const folded = Boolean(input.ownerFolded) || table?.ownerActionCue === 'fold'
  const actionKey = table?.ownerActionKey ?? null
  if (present && actionKey && actionKey !== anim.lastOwnerActionKey && anim.lastOwnerActionKey !== null) {
    const cue = table?.ownerActionCue
    if (cue === 'all_in') {
      say(anim, 'owner_all_in', 2.8)
      if (!anim.gesture) startGesture(anim, 'fan', time)
    } else if (cue === 'bet' || cue === 'raise' || cue === 'call') {
      say(anim, 'owner_bet', 2.6)
    } else if (cue === 'check') {
      say(anim, 'owner_check', 2.4)
    }
  }
  anim.lastOwnerActionKey = actionKey ?? anim.lastOwnerActionKey ?? ''

  if (folded && !anim.ownerFolded && present) {
    startGesture(anim, 'eyeRoll', time)
    say(anim, 'owner_folded', 2.6)
    anim.nextGestureAt = time + GESTURE_DURATIONS.eyeRoll + 3
  }
  anim.ownerFolded = folded

  const allIn = table?.allIn ?? null
  if (present && allIn && allIn.actionKey !== anim.lastAllInKey && anim.lastAllInKey !== null && allIn.playerId !== state.ownerId) {
    say(anim, 'other_all_in', 2.6, allIn.nickname)
  }
  anim.lastAllInKey = allIn?.actionKey ?? anim.lastAllInKey ?? ''
  anim.otherNames = table?.otherPlayerNames ?? anim.otherNames
}

function resolvePlacement(runtime: CompanionRuntime, input: CompanionUpdateInput): CompanionPlacement | null {
  const { anim } = runtime
  const ownerId = anim.current?.ownerId ?? null
  if (input.ownerIsHero) {
    return computeHeroCompanionPlacement(input.camera)
  }
  if (!input.ownerSeat) return null
  if (anim.sideForOwner !== ownerId) {
    anim.side = chooseCompanionSide(input.ownerSeat, input.camera)
    anim.sideForOwner = ownerId
  }
  return computeSeatCompanionPlacement(input.ownerSeat, input.camera, anim.side)
}

const tmpVector = new THREE.Vector3()
const tmpVector2 = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpQuat2 = new THREE.Quaternion()
const DOWN = new THREE.Vector3(0, -1, 0)

function worldToTorso(rig: CompanionRig, world: THREE.Vector3, out: THREE.Vector3) {
  rig.torso.updateWorldMatrix(true, false)
  return rig.torso.worldToLocal(out.copy(world))
}

function buildTargets(runtime: CompanionRuntime, input: CompanionUpdateInput): PoseTargets {
  const { anim } = runtime
  const t = anim.time
  const reduced = input.reducedMotion
  const motion = reduced ? 0.25 : 1
  const body = zeroBody()
  const arms: [ArmTarget, ArmTarget] = [REST_ARM_TARGET(1), REST_ARM_TARGET(-1)]
  const blink: [number, number] = [0, 0]
  const side = anim.side
  anim.trayOnHeadTarget = 0
  anim.standBehindTarget = 0
  anim.cocktailInHand = false

  // --- Idle: sassy contrapposto hip pop, sway, breathing, head bob, sly smile.
  const sway = Math.sin(t * 1.25)
  body.hipX = (0.03 * sway + 0.028) * motion
  body.hipRz = (0.07 * sway + 0.085) * motion
  body.hipRy = 0.09 * Math.sin(t * 0.62) * motion
  body.torRz = -body.hipRz * 0.8
  body.torRx = 0.02 + 0.012 * Math.sin(t * 2.1) * motion
  body.torRy = -body.hipRy * 0.5
  body.headRz = -0.12 + 0.05 * Math.sin(t * 1.25 + 0.6) * motion
  body.headRx = 0.04 + 0.02 * Math.sin(t * 0.9) * motion
  body.headRy = 0.06 * Math.sin(t * 0.47) * motion
  body.bob = Math.abs(sway) * 0.012 * motion
  body.smile = 0.8
  body.browUp = 0.2
  body.gazeX = 0.25 * Math.sin(t * 0.37)
  body.gazeY = -0.05

  // Left hand carries the tray waiter-style; right hand sits sassily on the hip.
  setArm(arms[TRAY_ARM], 0.25, 0.1, 0.25, 1, -0.8, -0.3, 0, 0)
  setArm(arms[GESTURE_ARM], -0.185, -0.03, -0.03, -1, 0.1, -0.35, 0.2, 1.1)

  // --- Blink (natural, every 2.5-5 s).
  if (t >= anim.nextBlinkAt) {
    anim.blinkStart = t
    anim.nextBlinkAt = t + 2.4 + anim.random() * 2.8
  }
  const blinkU = (t - anim.blinkStart) / 0.16
  if (blinkU >= 0 && blinkU <= 1) {
    const closed = Math.sin(blinkU * Math.PI)
    blink[0] = closed
    blink[1] = closed
  }

  // --- Entrance: tray up high, free arm flung out: "ta-da!"
  if (anim.phase === 'entering') {
    const u = (t - anim.phaseStart) / ENTRANCE_DURATION
    const ta = keyframe(u, [[0, 0], [0.45, 0], [0.62, 1], [0.9, 1], [1, 0]])
    const into = createArmTarget()
    setArm(into, 0.4, 0.72, 0.12, 1, -0.4, -0.4, 0, 0)
    blendArm(arms[TRAY_ARM], into, ta)
    setArm(into, -0.68, 0.62, 0.12, -0.4, -1, -0.3, -0.3, -0.5)
    blendArm(arms[GESTURE_ARM], into, ta)
    blendBody(body, 'smile', 1, ta)
    blendBody(body, 'browUp', 0.8, ta)
    blendBody(body, 'headRz', 0.14, ta)
    blendBody(body, 'headRx', -0.12, ta)
    blendBody(body, 'hipRz', 0.16, ta)
  }

  // --- Sulky exit: hand on hip, chin up, head turned away, pout, stomp.
  if (anim.phase === 'leaving' && !anim.exitFast) {
    const u = (t - anim.phaseStart) / EXIT_DURATION
    const w = keyframe(u, [[0, 0], [0.12, 1], [1, 1]])
    const toss = keyframe(u, [[0, 0], [0.15, 1], [0.32, 0.6], [0.45, 1]])
    const into = createArmTarget()
    setArm(into, -0.14, 0.02, 0.02, -1, 0.3, -0.2, 0.3, 1.2)
    blendArm(arms[GESTURE_ARM], into, w)
    blendBody(body, 'headRy', -0.75 * side, w)
    blendBody(body, 'headRx', -0.2 * toss, w)
    blendBody(body, 'headRz', 0.2 * side, w)
    blendBody(body, 'torRy', -0.3 * side, w)
    blendBody(body, 'hipRz', -0.14, w)
    blendBody(body, 'smile', 0, w)
    blendBody(body, 'pout', 1, w)
    blendBody(body, 'browAngry', 1, w)
    blendBody(body, 'browUp', 0, w)
    blendBody(body, 'squint', 0.55, w)
    blink[0] = Math.max(blink[0], 0.45 * w)
    blink[1] = Math.max(blink[1], 0.45 * w)
  }

  // --- Gestures.
  const gesture = anim.gesture
  if (gesture) {
    const u = (t - gesture.start) / gesture.duration
    if (u >= 1) {
      anim.gesture = null
    } else {
      applyGesture(runtime, input, gesture, u, body, arms, blink)
    }
  }

  return { body, arms, blink }
}

function fireOnce(gesture: ActiveGesture, key: string, when: boolean) {
  if (!when || gesture.fired.has(key)) return false
  gesture.fired.add(key)
  return true
}

function applyGesture(
  runtime: CompanionRuntime,
  input: CompanionUpdateInput,
  gesture: ActiveGesture,
  u: number,
  body: BodyPose,
  arms: [ArmTarget, ArmTarget],
  blink: [number, number]
) {
  const { anim, rig, fx } = runtime
  const reduced = input.reducedMotion
  const scale = runtime.group.scale.x
  const w = gestureEnvelope(u)
  const into = createArmTarget()
  const elapsed = anim.time - gesture.start
  // Her right hand (the free one) is on -X; `ps` is the side the player is on.
  const ps = anim.playerSide
  const winkEye: 0 | 1 = ps === 1 ? 0 : 1

  const mouthWorld = () => rig.mouth.localToWorld(tmpVector.set(0, 0, 0.04)).clone()
  const handWorld = (index: 0 | 1) => rig.arms[index].hand.localToWorld(tmpVector.set(0, -0.06, 0.02)).clone()
  const sparkleAt = (origin: THREE.Vector3, count: number, speed = 1) => {
    if (reduced) return
    for (let index = 0; index < count; index += 1) {
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.9, (Math.random() - 0.5) * 1.2)
        .multiplyScalar(scale * speed)
      spawnSprite(fx, 'sparkle', origin, velocity, 0.7 + Math.random() * 0.4, (0.08 + Math.random() * 0.08) * scale, SPARKLE_COLORS[index % 3]!)
    }
  }

  switch (gesture.name) {
    case 'wink':
    case 'fingerGuns': {
      // Finger-guns + wink: "pew pew, you lucky thing".
      const guns = gesture.name === 'fingerGuns'
      const closed = keyframe(u, [[0, 0], [0.25, 0], [0.36, 1], [0.6, 1], [0.72, 0]])
      blink[winkEye] = Math.max(blink[winkEye], closed)
      blendBody(body, 'headRz', -0.22 * ps, w)
      blendBody(body, 'headRx', 0.08, w)
      blendBody(body, 'smile', 1, w)
      blendBody(body, 'browUp', 0.9, w)
      blendBody(body, 'hipRz', body.hipRz + 0.08, w)
      const aim = keyframe(u, [[0, 0], [0.22, 1], [0.8, 1], [1, 0]])
      const recoil = guns ? keyframe(u, [[0.3, 0], [0.36, 1], [0.44, 0], [0.52, 1], [0.6, 0]]) : 0
      setArm(into, -0.24, 0.3 + recoil * 0.08, 0.42, -1, -1, 0, -0.6 - recoil * 0.6, 0.3)
      blendArm(arms[GESTURE_ARM], into, aim)
      if (fireOnce(gesture, 'spark', u > 0.36)) {
        sparkleAt(rig.eyes[winkEye].group.localToWorld(tmpVector.set(0.02, 0.03, 0.05)).clone(), guns ? 2 : 1, 0.3)
        if (guns) sparkleAt(handWorld(GESTURE_ARM), 5, 0.8)
      }
      if (guns && fireOnce(gesture, 'spark2', u > 0.52)) sparkleAt(handWorld(GESTURE_ARM), 4, 0.8)
      break
    }
    case 'blowKiss': {
      const toLips = keyframe(u, [[0, 0], [0.22, 1], [0.44, 1], [0.58, 0]])
      const fling = keyframe(u, [[0.44, 0], [0.6, 1], [0.85, 1], [1, 0]])
      setArm(into, -0.03, 0.62, 0.24, -1, -1.2, 0.2, -1.2, -0.2)
      blendArm(arms[GESTURE_ARM], into, toLips)
      setArm(into, -0.46, 0.5, 0.36, -0.6, -1, -0.2, -0.5, -0.9)
      blendArm(arms[GESTURE_ARM], into, fling)
      blendBody(body, 'kiss', 1, toLips)
      blendBody(body, 'smile', 1, fling)
      blendBody(body, 'headRz', -0.18 * ps, w)
      blendBody(body, 'headRx', 0.08 * toLips - 0.1 * fling, 1)
      blendBody(body, 'torRy', -0.2 * fling, 1)
      blink[0] = Math.max(blink[0], 0.9 * toLips)
      blink[1] = Math.max(blink[1], 0.9 * toLips)
      if (fireOnce(gesture, 'heart', u > 0.56)) {
        const origin = handWorld(GESTURE_ARM)
        const direction = tmpVector2.set(Math.sin(runtime.group.rotation.y - 0.4), 0.8, Math.cos(runtime.group.rotation.y - 0.4))
          .normalize()
          .multiplyScalar(0.9 * scale)
        spawnSprite(fx, 'heart', origin, direction, 2.2, 0.36 * scale, HEART_COLORS[0]!)
        if (!reduced) {
          for (let index = 0; index < 3; index += 1) {
            const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4).multiplyScalar(scale)
            spawnSprite(fx, 'heart', origin, jitter.add(direction.clone().multiplyScalar(0.6)), 1.6 + Math.random() * 0.6, (0.14 + Math.random() * 0.08) * scale, HEART_COLORS[index % HEART_COLORS.length]!)
          }
        }
      }
      break
    }
    case 'hairFlip': {
      // Big confident hair toss: hand sweeps through the hair, head whips round.
      const lift = keyframe(u, [[0, 0], [0.18, 1], [0.55, 1], [0.78, 0]])
      setArm(into, -0.22, 0.8, -0.02, -1, 0.6, -0.2, -0.6, 1.2)
      blendArm(arms[GESTURE_ARM], into, lift)
      const flip = keyframe(u, [[0, 0], [0.28, -0.3], [0.44, 1.35], [0.66, 0.4], [1, 0]])
      blendBody(body, 'hairFlip', flip, 1)
      blendBody(body, 'headRz', 0.34 * flip + 0.08, w)
      blendBody(body, 'headRx', -0.26 * Math.max(0, flip), w)
      blendBody(body, 'headRy', -0.35 * flip, w)
      blendBody(body, 'torRy', -0.12 * flip, w)
      blendBody(body, 'hipRz', body.hipRz + 0.1, w)
      blendBody(body, 'smile', 1, w)
      blendBody(body, 'squint', 0.45, w)
      blink[0] = Math.max(blink[0], 0.6 * Math.max(0, flip))
      blink[1] = Math.max(blink[1], 0.6 * Math.max(0, flip))
      if (fireOnce(gesture, 'sparkles', u > 0.44)) {
        sparkleAt(rig.head.localToWorld(tmpVector.set(-0.22, HEAD_CENTER_Y + 0.1, -0.05)).clone(), 7)
      }
      break
    }
    case 'lean': {
      // Leans on the chair back with a hand on the player's shoulder.
      const lean = keyframe(u, [[0, 0], [0.2, 1], [0.82, 1], [1, 0]])
      blendBody(body, 'hipRz', 0.16 * ps, lean)
      blendBody(body, 'hipX', 0.05 * ps, lean)
      blendBody(body, 'torRz', 0.14 * ps, lean)
      blendBody(body, 'torRx', 0.18, lean)
      blendBody(body, 'torRy', 0.25 * ps, lean)
      blendBody(body, 'headRz', 0.22 * ps, lean)
      blendBody(body, 'headRx', 0.12, lean)
      blendBody(body, 'smile', 1, lean)
      blendBody(body, 'browUp', 0.7, lean)
      blendBody(body, 'squint', 0.35, lean)
      const shoulder = anim.placement?.shoulder
      if (shoulder) {
        const local = worldToTorso(rig, shoulder, new THREE.Vector3())
        setArm(into, local.x, local.y, local.z, -0.8, -0.4, -0.5, 0.4, 0.4)
      } else {
        setArm(into, -0.5, 0.05, 0.35, -0.8, -0.4, -0.5, 0.4, 0.4)
      }
      blendArm(arms[GESTURE_ARM], into, lean)
      if (!reduced && fireOnce(gesture, 'heart', u > 0.35)) {
        const origin = rig.head.localToWorld(tmpVector.set(0, HEAD_CENTER_Y + 0.25, 0.1)).clone()
        spawnSprite(fx, 'heart', origin, new THREE.Vector3(0, 0.5, 0).multiplyScalar(scale), 2, 0.22 * scale, HEART_COLORS[1]!)
      }
      break
    }
    case 'fan': {
      // Flustered by the winner: fans herself, lashes fluttering.
      const up = keyframe(u, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]])
      const flutter = Math.sin(elapsed * 18)
      setArm(into, -0.2, 0.62 + flutter * 0.02, 0.24, -1, -1, 0, -1.1, 0.8 + flutter * 0.55)
      blendArm(arms[GESTURE_ARM], into, up)
      blendBody(body, 'headRx', -0.18, up)
      blendBody(body, 'headRz', -0.12, up)
      blendBody(body, 'smile', 1, up)
      blendBody(body, 'browUp', 1, up)
      const flutterBlink = Math.max(0, Math.sin(elapsed * 14)) * 0.8 * up
      blink[0] = Math.max(blink[0], flutterBlink)
      blink[1] = Math.max(blink[1], flutterBlink)
      if (!reduced && fireOnce(gesture, 'hearts', u > 0.3)) {
        const origin = rig.head.localToWorld(tmpVector.set(0, HEAD_CENTER_Y + 0.3, 0.05)).clone()
        for (let index = 0; index < 3; index += 1) {
          spawnSprite(fx, 'heart', origin, new THREE.Vector3((index - 1) * 0.25, 0.5, 0).multiplyScalar(scale), 1.6, 0.15 * scale, HEART_COLORS[index]!)
        }
      }
      break
    }
    case 'chaChing': {
      // Tray balanced on her head, both hands rubbing fingers: money money money.
      const up = keyframe(u, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]])
      anim.trayOnHeadTarget = up > 0.02 ? 1 : 0
      const rub = Math.sin(elapsed * 22) * 0.03
      setArm(into, 0.13 + rub, 0.3, 0.3, 1, -1, -0.2, -0.9, -0.4)
      blendArm(arms[TRAY_ARM], into, up)
      setArm(into, -0.13 - rub, 0.3, 0.3, -1, -1, -0.2, -0.9, -0.4)
      blendArm(arms[GESTURE_ARM], into, up)
      blendBody(body, 'bob', body.bob + Math.abs(Math.sin(elapsed * 7)) * 0.03, up)
      blendBody(body, 'smile', 1, up)
      blendBody(body, 'browUp', 1, up)
      blendBody(body, 'headRz', 0.06 * Math.sin(elapsed * 7), up)
      if (!reduced) {
        const beat = Math.floor(elapsed / 0.22)
        if (u > 0.12 && u < 0.8 && fireOnce(gesture, `coin${beat}`, true)) {
          const origin = handWorld(beat % 2 === 0 ? 0 : 1)
          const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8).multiplyScalar(scale)
          spawnSprite(fx, 'coin', origin, velocity, 1.1, 0.16 * scale, SPARKLE_COLORS[0]!)
        }
      }
      break
    }
    case 'cheekKiss': {
      const lean = keyframe(u, [[0, 0], [0.28, 1], [0.6, 1], [0.8, 0]])
      blendBody(body, 'hipRz', 0.18 * ps, lean)
      blendBody(body, 'torRz', 0.22 * ps, lean)
      blendBody(body, 'torRx', 0.35, lean)
      blendBody(body, 'torRy', 0.35 * ps, lean)
      blendBody(body, 'headRz', 0.25 * ps, lean)
      blendBody(body, 'headRx', 0.25, lean)
      blendBody(body, 'kiss', 1, keyframe(u, [[0.2, 0], [0.35, 1], [0.6, 1], [0.7, 0]]))
      blendBody(body, 'smile', 1, keyframe(u, [[0.6, 0], [0.75, 1], [1, 1]]))
      blink[0] = Math.max(blink[0], lean * 0.95)
      blink[1] = Math.max(blink[1], lean * 0.95)
      const shoulder = anim.placement?.shoulder
      if (shoulder) {
        const local = worldToTorso(rig, shoulder, new THREE.Vector3())
        setArm(into, local.x, local.y, local.z, -0.8, -0.4, -0.5, 0.4, 0.4)
        blendArm(arms[GESTURE_ARM], into, lean)
      }
      if (fireOnce(gesture, 'mark', u > 0.45)) {
        let origin: THREE.Vector3
        let size = 0.2 * scale
        if (input.ownerIsHero) {
          // "Your" cheek is the screen: plant the kiss right on the lens.
          input.camera.updateMatrixWorld()
          origin = input.camera.localToWorld(new THREE.Vector3(0.28, -0.1, -1.6))
          size = 0.22
        } else {
          const head = anim.placement?.head
          origin = head ? head.clone().lerp(mouthWorld(), 0.3) : mouthWorld()
          const cameraPosition = input.camera.getWorldPosition(new THREE.Vector3())
          origin.add(cameraPosition.sub(origin).normalize().multiplyScalar(0.25 * scale))
        }
        spawnSprite(fx, 'lips', origin, new THREE.Vector3(0, 0.03, 0), 2.6, size, new THREE.Color(PALETTE.lips))
        if (!reduced) {
          spawnSprite(fx, 'heart', origin.clone().add(new THREE.Vector3(0, 0.1 * scale, 0)), new THREE.Vector3(0, 0.55, 0).multiplyScalar(scale), 1.8, 0.2 * scale, HEART_COLORS[1]!)
        }
      }
      break
    }
    case 'cheer': {
      // Tray hoisted high, free fist pumping, little hops, confetti.
      const up = keyframe(u, [[0, 0], [0.12, 1], [0.85, 1], [1, 0]])
      const hop = Math.max(0, Math.sin(elapsed * 9)) * (u < 0.7 ? 1 : 0)
      setArm(into, 0.3, 0.95 + hop * 0.04, 0.1, 1, 0, -0.6, 0, 0)
      blendArm(arms[TRAY_ARM], into, up)
      setArm(into, -0.34, 0.92 + hop * 0.04, 0.12, -1, 0, -0.6, -0.2, -0.3 - Math.sin(elapsed * 12) * 0.4)
      blendArm(arms[GESTURE_ARM], into, up)
      blendBody(body, 'bob', hop * 0.09 * (reduced ? 0 : 1), 1)
      blendBody(body, 'smile', 1, up)
      blendBody(body, 'browUp', 1, up)
      blendBody(body, 'headRx', -0.2, up)
      blendBody(body, 'hipRz', Math.sin(elapsed * 9) * 0.1, up)
      if (!reduced && fireOnce(gesture, 'burst', u > 0.12)) {
        const origin = rig.head.localToWorld(tmpVector.set(0, HEAD_CENTER_Y + 0.35, 0)).clone()
        spawnConfetti(fx, origin, 36, scale)
        for (let index = 0; index < 5; index += 1) {
          const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.3, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.3).multiplyScalar(scale)
          spawnSprite(fx, 'heart', origin, velocity, 1.8 + Math.random() * 0.6, (0.15 + Math.random() * 0.1) * scale, HEART_COLORS[index % 3]!)
        }
      }
      break
    }
    case 'eyeRoll': {
      const roll = keyframe(u, [[0, 0], [0.2, 1], [0.7, 1], [0.9, 0]])
      blendBody(body, 'gazeY', 0.9 * Math.sin(u * Math.PI), roll)
      blendBody(body, 'gazeX', Math.cos(u * Math.PI * 1.6) * 0.8, roll)
      blendBody(body, 'headRx', -0.14, roll)
      blendBody(body, 'headRy', -0.35, roll)
      blendBody(body, 'pout', 1, roll)
      blendBody(body, 'smile', 0, roll)
      blendBody(body, 'browAngry', 0.7, roll)
      break
    }
    case 'serve': {
      // Takes the cocktail off her tray and sets it down by the owner's seat.
      const spot = anim.serveSpot
      const reach = keyframe(u, [[0, 0], [0.18, 1], [0.3, 1], [0.55, 1], [0.72, 0]])
      const grab = keyframe(u, [[0, 0], [0.16, 1], [0.26, 0]])
      // 1) right hand to the glass on the tray.
      const trayGlass = worldToTorso(rig, rig.cocktail.getWorldPosition(new THREE.Vector3()), new THREE.Vector3())
      setArm(into, trayGlass.x, trayGlass.y + 0.08, trayGlass.z + 0.02, -1, -1, -0.2, -0.4, 0)
      blendArm(arms[GESTURE_ARM], into, grab)
      // 2) reach out and set it down toward the spot.
      const outU = keyframe(u, [[0.24, 0], [0.4, 1], [0.58, 1], [0.72, 0]])
      if (spot) {
        const local = worldToTorso(rig, spot, new THREE.Vector3())
        local.y = Math.max(local.y + 0.2, -0.1)
        setArm(into, local.x, local.y, local.z, -1, -0.6, -0.4, 0.3, 0)
      } else {
        setArm(into, -0.3, 0.1, 0.5, -1, -0.6, -0.4, 0.3, 0)
      }
      blendArm(arms[GESTURE_ARM], into, outU)
      blendBody(body, 'torRx', 0.3, outU)
      blendBody(body, 'hipRx', 0.1, outU)
      blendBody(body, 'torRy', -0.25, outU)
      blendBody(body, 'headRx', 0.18, outU)
      blendBody(body, 'smile', 1, reach)
      blendBody(body, 'browUp', 0.8, reach)
      anim.cocktailInHand = u > 0.2 && u < 0.46
      if (fireOnce(gesture, 'release', u > 0.46)) {
        const from = rig.arms[GESTURE_ARM].hand.localToWorld(new THREE.Vector3(0, -0.05, 0))
        serveCocktail(runtime, from, spot, scale)
        anim.cocktailServedUntil = anim.time + gesture.duration * 0.5
      }
      // A wink as she lets go.
      const closed = keyframe(u, [[0.5, 0], [0.56, 1], [0.7, 1], [0.76, 0]])
      blink[winkEye] = Math.max(blink[winkEye], closed)
      if (fireOnce(gesture, 'refill', u > 0.94)) {
        sparkleAt(rig.cocktail.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15 * scale, 0)), 4, 0.5)
      }
      break
    }
    case 'shoulderRub': {
      // Steps behind the chair, tray balanced on her head, a friendly
      // two-handed shoulder squeeze with a little bob, and a wink.
      const on = keyframe(u, [[0, 0], [0.18, 1], [0.82, 1], [1, 0]])
      anim.standBehindTarget = on
      anim.trayOnHeadTarget = on > 0.02 ? 1 : 0
      const shoulders = anim.placement?.shoulders
      const squeeze = Math.abs(Math.sin(elapsed * 8)) * (u > 0.25 && u < 0.78 ? 1 : 0)
      if (shoulders) {
        const a = worldToTorso(rig, shoulders[0], new THREE.Vector3())
        const b = worldToTorso(rig, shoulders[1], new THREE.Vector3())
        const [left, right] = a.x >= b.x ? [a, b] : [b, a]
        setArm(into, left.x, left.y + 0.04 - squeeze * 0.025, left.z, 0.9, 0.2, 0.3, 0.8, 0)
        blendArm(arms[TRAY_ARM], into, on)
        setArm(into, right.x, right.y + 0.04 - squeeze * 0.025, right.z, -0.9, 0.2, 0.3, 0.8, 0)
        blendArm(arms[GESTURE_ARM], into, on)
      }
      blendBody(body, 'hipRx', 0.12, on)
      blendBody(body, 'torRx', 0.34, on)
      blendBody(body, 'hipRz', 0, on)
      blendBody(body, 'torRz', 0, on)
      blendBody(body, 'headRx', -0.32, on)
      blendBody(body, 'headRz', 0.18 * ps + Math.sin(elapsed * 4) * 0.05, on)
      blendBody(body, 'bob', body.bob - squeeze * 0.02, on)
      blendBody(body, 'smile', 1, on)
      blendBody(body, 'browUp', 0.8, on)
      const closed = keyframe(u, [[0.45, 0], [0.5, 1], [0.62, 1], [0.67, 0]])
      blink[winkEye] = Math.max(blink[winkEye], closed)
      if (!reduced && fireOnce(gesture, 'hearts', u > 0.5)) {
        const origin = rig.head.localToWorld(tmpVector.set(0, HEAD_CENTER_Y + 0.2, 0.2)).clone()
        for (let index = 0; index < 2; index += 1) {
          spawnSprite(fx, 'heart', origin, new THREE.Vector3((index - 0.5) * 0.3, 0.55, 0).multiplyScalar(scale), 1.7, 0.16 * scale, HEART_COLORS[index]!)
        }
      }
      break
    }
  }
}

const ENTRANCE_DURATION = 1.9
const EXIT_DURATION = 1.8
const FAST_EXIT_DURATION = 0.6

function applyPose(runtime: CompanionRuntime, targets: PoseTargets, dt: number) {
  const { anim, rig } = runtime
  // Springs for the body channels (lively, slightly under-damped).
  for (const channel of BODY_CHANNELS) {
    const fast = channel === 'smile' || channel === 'pout' || channel === 'kiss' || channel === 'browUp' || channel === 'browAngry' || channel === 'gazeX' || channel === 'gazeY' || channel === 'squint'
    const [value, velocity] = springStep(
      anim.body[channel],
      anim.bodyVelocity[channel],
      targets.body[channel],
      dt,
      fast ? 260 : channel === 'hairFlip' ? 180 : 95,
      fast ? 28 : channel === 'hairFlip' ? 14 : 15
    )
    anim.body[channel] = value
    anim.bodyVelocity[channel] = velocity
  }
  for (const index of [0, 1] as const) {
    const current = anim.arms[index]
    const target = targets.arms[index]
    const velocity = anim.armVelocity[index]
    for (const axis of ['x', 'y', 'z'] as const) {
      const [tx, tv] = springStep(current.target[axis], velocity.target[axis], target.target[axis], dt, 140, 19)
      current.target[axis] = tx
      velocity.target[axis] = tv
      const [px, pv] = springStep(current.pole[axis], velocity.pole[axis], target.pole[axis], dt, 90, 16)
      current.pole[axis] = px
      velocity.pole[axis] = pv
    }
    current.handX += (target.handX - current.handX) * Math.min(1, dt * 10)
    current.handZ += (target.handZ - current.handZ) * Math.min(1, dt * 10)
  }

  const b = anim.body
  rig.model.position.y = b.bob
  rig.hips.position.x = b.hipX
  rig.hips.rotation.set(b.hipRx, b.hipRy, b.hipRz)
  rig.torso.rotation.set(b.torRx, b.torRy, b.torRz)
  rig.head.rotation.set(b.headRx, b.headRy, b.headRz)

  // Hair follows with lag + flip.
  const time = anim.time
  const headVelocity = anim.bodyVelocity.headRz
  rig.hairLeft.rotation.z = 0.06 * Math.sin(time * 2.5) - headVelocity * 0.08 + b.hairFlip * 0.5
  rig.hairRight.rotation.z = -0.06 * Math.sin(time * 2.5 + 0.8) - headVelocity * 0.08 - b.hairFlip * 0.5
  rig.hairLeft.rotation.x = -b.hairFlip * 0.4
  rig.hairRight.rotation.x = -b.hairFlip * 0.4
  rig.hairBack.rotation.x = 0.04 * Math.sin(time * 1.9) - anim.bodyVelocity.headRx * 0.06 - b.hairFlip * 0.35
  rig.bangs.rotation.z = b.hairFlip * 0.25
  rig.earrings.forEach((earring, index) => {
    earring.rotation.z = Math.sin(time * 3.1 + index) * 0.25 - headVelocity * 0.3
    earring.rotation.x = Math.sin(time * 2.3 + index * 2) * 0.15
  })
  rig.shirt.rotation.x = 0.015 * Math.sin(time * 2.2)

  // Face.
  targets.blink.forEach((closed, index) => {
    const eye = rig.eyes[index]!
    const lidClosed = Math.max(closed, b.squint * 0.45)
    eye.group.scale.y = 1 - lidClosed * 0.88
    eye.iris.position.x = THREE.MathUtils.clamp(b.gazeX, -1, 1) * 0.014
    eye.iris.position.y = -0.004 + THREE.MathUtils.clamp(b.gazeY, -1, 1) * 0.014
  })
  rig.brows.forEach((brow, index) => {
    const side = index === 0 ? 1 : -1
    brow.position.y = HEAD_CENTER_Y + 0.1 + b.browUp * 0.016 - b.browAngry * 0.012
    brow.rotation.z = side * (b.browAngry * 0.35 - b.browUp * 0.12)
  })
  const kiss = THREE.MathUtils.clamp(b.kiss, 0, 1)
  const pout = THREE.MathUtils.clamp(b.pout, 0, 1)
  const smile = THREE.MathUtils.clamp(b.smile, 0, 1)
  rig.mouth.scale.set(1 + smile * 0.25 - kiss * 0.45 - pout * 0.2, 1 + kiss * 0.35 + pout * 0.1, 1 + kiss * 0.8 + pout * 0.4)
  rig.upperLip.position.y = pout * 0.004
  rig.lowerLip.position.y = -0.012 - smile * 0.004 + pout * 0.004
  rig.lowerLip.rotation.x = -pout * 0.3
  rig.upperLip.rotation.z = 0
  rig.mouth.rotation.z = 0

  // Arms: two-bone IK in torso space.
  rig.torso.updateMatrix()
  for (const index of [0, 1] as const) {
    solveArm(rig.arms[index], anim.arms[index])
  }
}

function solveArm(arm: ArmRig, target: ArmTarget) {
  const shoulderPosition = arm.shoulder.position
  const local = tmpVector.copy(target.target).sub(shoulderPosition)
  const elbow = solveTwoBoneElbow(local, target.pole, arm.upperLength, arm.lowerLength, tmpVector2)
  // Upper arm: rotate rest direction (-Y) onto the elbow direction.
  const upperDirection = elbow.clone().normalize()
  tmpQuat.setFromUnitVectors(DOWN, upperDirection)
  arm.shoulder.quaternion.copy(tmpQuat)
  // Forearm in the upper-arm frame.
  const reach = Math.min(local.length(), arm.upperLength + arm.lowerLength - 1e-3)
  const handPoint = local.clone().normalize().multiplyScalar(Math.max(reach, Math.abs(arm.upperLength - arm.lowerLength) + 1e-3))
  const foreDirection = handPoint.sub(elbow).normalize()
  tmpQuat2.copy(tmpQuat).invert()
  foreDirection.applyQuaternion(tmpQuat2)
  arm.elbow.quaternion.setFromUnitVectors(DOWN, foreDirection)
  arm.hand.rotation.set(target.handX, 0, arm.side * target.handZ)
}

function updateRootTransform(runtime: CompanionRuntime, input: CompanionUpdateInput, dt: number) {
  const { anim, group, rig, fx } = runtime
  const placement = anim.placement
  if (!placement) return
  const t = anim.time
  const scaleBase = placement.scale

  if (!anim.positionReady || placement.screenLocked) {
    anim.position.copy(placement.position)
    anim.yaw = placement.yaw
    anim.positionReady = true
  } else {
    anim.position.lerp(placement.position, Math.min(1, dt * 6))
    anim.yaw += angleDelta(anim.yaw, placement.yaw) * Math.min(1, dt * 5)
  }

  // Step behind the chair for the shoulder rub.
  const behindTarget = placement.behind ? anim.standBehindTarget : 0
  anim.standBehind += (behindTarget - anim.standBehind) * Math.min(1, dt * 4.5)
  const base = tmpVector2.copy(anim.position)
  let yaw = anim.yaw
  if (placement.behind && anim.standBehind > 1e-3) {
    base.lerp(placement.behind, anim.standBehind)
    yaw += angleDelta(yaw, placement.behindYaw) * anim.standBehind
  }

  let spin = 0
  let scale = 1
  let offsetSide = 0
  let sink = 0

  if (anim.phase === 'entering') {
    const u = THREE.MathUtils.clamp((t - anim.phaseStart) / ENTRANCE_DURATION, 0, 1)
    if (input.reducedMotion) {
      scale = THREE.MathUtils.smoothstep(u, 0, 0.3)
    } else {
      // Sashay in from beside the seat with two twirls, overshoot, settle.
      const travel = keyframe(u, [[0, 1], [0.5, 0]])
      offsetSide = travel * 1.1
      spin = keyframe(u, [[0, -Math.PI * 4], [0.52, 0]])
      scale = keyframe(u, [[0, 0.05], [0.2, 0.9], [0.48, 1.08], [0.62, 0.97], [0.75, 1]])
      rig.hips.rotation.z += Math.sin(u * Math.PI * 6) * 0.18 * (1 - u)
    }
  } else if (anim.phase === 'leaving') {
    const duration = anim.exitFast ? FAST_EXIT_DURATION : EXIT_DURATION
    const u = THREE.MathUtils.clamp((t - anim.phaseStart) / duration, 0, 1)
    if (input.reducedMotion) {
      scale = 1 - THREE.MathUtils.smoothstep(u, 0.5, 1)
    } else if (anim.exitFast) {
      spin = keyframe(u, [[0, 0], [1, Math.PI * 3]])
      scale = keyframe(u, [[0, 1], [0.3, 1.08], [1, 0]])
    } else {
      // "Hmph" (0-0.5): stomp + turn away. Then spin out, shrink, puff of smoke.
      const stomp = keyframe(u, [[0.05, 0], [0.12, 1], [0.2, 0], [0.26, 1], [0.34, 0]])
      sink = -stomp * 0.03
      spin = keyframe(u, [[0.5, 0], [1, Math.PI * 5]])
      scale = keyframe(u, [[0, 1], [0.5, 1], [0.62, 1.06], [0.95, 0.05], [1, 0]])
      sink += keyframe(u, [[0.55, 0], [1, 0.4]])
    }
  }

  const sideVector = tmpVector.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-anim.side * offsetSide * scaleBase)
  group.position.copy(base).add(sideVector)
  group.position.y += sink * scaleBase
  group.rotation.set(0, yaw + spin, 0)
  group.scale.setScalar(Math.max(1e-3, scale * scaleBase))
  fx.group.visible = true
}

/** Places the tray (hand or balanced on her head) and the cocktail, in model space. */
function placeTrayAndCocktail(runtime: CompanionRuntime, dt: number) {
  const { anim, rig } = runtime
  anim.trayOnHead += (anim.trayOnHeadTarget - anim.trayOnHead) * Math.min(1, dt * 7)
  const w = THREE.MathUtils.smoothstep(anim.trayOnHead, 0, 1)
  rig.model.updateMatrixWorld(true)
  const toModel = (object: THREE.Object3D, x: number, y: number, z: number) =>
    rig.model.worldToLocal(object.localToWorld(new THREE.Vector3(x, y, z)))
  const hand = toModel(rig.arms[TRAY_ARM].hand, 0, -0.045, 0).add(new THREE.Vector3(0.05, 0.035, 0.06))
  const head = toModel(rig.head, 0, HEAD_CENTER_Y + 0.36, -0.03)
  rig.tray.position.copy(hand).lerp(head, w)
  rig.tray.position.y += Math.sin(w * Math.PI) * 0.18
  const wobble = w * Math.sin(anim.time * 3.4) * 0.07
  rig.tray.rotation.set(wobble * 0.6, 0, wobble)

  const cocktail = rig.cocktail
  if (anim.cocktailInHand) {
    cocktail.visible = true
    cocktail.position.copy(toModel(rig.arms[GESTURE_ARM].hand, 0, -0.07, 0.02)).add(new THREE.Vector3(0, -0.06, 0))
    cocktail.rotation.set(0, 0, 0)
    cocktail.scale.setScalar(1)
  } else if (anim.time < anim.cocktailServedUntil) {
    cocktail.visible = false
  } else {
    // On the tray (pops back in after a serve).
    const refill = THREE.MathUtils.clamp((anim.time - anim.cocktailServedUntil) / 0.3, 0, 1)
    cocktail.visible = true
    cocktail.position.copy(rig.tray.position).add(new THREE.Vector3(0.05, 0.004, -0.02))
    cocktail.rotation.copy(rig.tray.rotation)
    cocktail.scale.setScalar(anim.cocktailServedUntil > 0 ? keyframe(refill, [[0, 0.2], [0.7, 1.15], [1, 1]]) : 1)
  }
}

interface ServedDrink {
  object: THREE.Group
  from: THREE.Vector3
  to: THREE.Vector3
  age: number
  scale: number
}

const SERVED_FLIGHT = 0.45
const SERVED_LIFE = 7

/** Launches a copy of her cocktail from her hand to the serve spot on the felt. */
function serveCocktail(runtime: CompanionRuntime, from: THREE.Vector3, to: THREE.Vector3 | null, scale: number) {
  const { fx, rig } = runtime
  const object = rig.cocktail.clone(true)
  object.visible = true
  object.rotation.set(0, 0, 0)
  fx.group.add(object)
  const target = to ? to.clone() : from.clone().add(new THREE.Vector3(0, -0.5 * scale, 0))
  fx.served.push({ object, from: from.clone(), to: target, age: 0, scale })
  while (fx.served.length > 3) {
    fx.served.shift()!.object.removeFromParent()
  }
}

function updateServedDrinks(fx: CompanionFx, dt: number, reducedMotion: boolean) {
  for (let index = fx.served.length - 1; index >= 0; index -= 1) {
    const drink = fx.served[index]!
    drink.age += dt
    const object = drink.object
    if (drink.age >= SERVED_LIFE) {
      object.removeFromParent()
      fx.served.splice(index, 1)
      continue
    }
    const flight = THREE.MathUtils.clamp(drink.age / SERVED_FLIGHT, 0, 1)
    object.position.copy(drink.from).lerp(drink.to, flight)
    object.position.y += Math.sin(flight * Math.PI) * 0.35 * drink.scale
    const land = flight >= 1 ? keyframe(drink.age - SERVED_FLIGHT, [[0, 1.2], [0.15, 0.92], [0.3, 1]]) : 1
    const fade = 1 - THREE.MathUtils.smoothstep(drink.age, SERVED_LIFE - 0.6, SERVED_LIFE)
    object.scale.setScalar(Math.max(1e-3, drink.scale * land * fade))
    if (!reducedMotion && flight >= 1 && drink.age - dt < SERVED_FLIGHT) {
      spawnSprite(fx, 'sparkle', drink.to.clone().add(new THREE.Vector3(0, 0.2 * drink.scale, 0)), new THREE.Vector3(0, 0.4 * drink.scale, 0), 0.8, 0.16 * drink.scale, SPARKLE_COLORS[0]!)
    }
    if (!reducedMotion && drink.age >= SERVED_LIFE - 0.6 && drink.age - dt < SERVED_LIFE - 0.6) {
      spawnSprite(fx, 'sparkle', object.position.clone().add(new THREE.Vector3(0, 0.15 * drink.scale, 0)), new THREE.Vector3(0, 0.3 * drink.scale, 0), 0.6, 0.14 * drink.scale, SPARKLE_COLORS[2]!)
    }
  }
}

function spawnEntranceBurst(runtime: CompanionRuntime, input: CompanionUpdateInput) {
  const { fx, anim } = runtime
  if (!anim.placement || input.reducedMotion) return
  const scale = anim.placement.scale
  const origin = anim.placement.position.clone().add(new THREE.Vector3(0, 1.3 * scale, 0))
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2
    const velocity = new THREE.Vector3(Math.cos(angle) * 1.6, (Math.random() - 0.2) * 1.4, Math.sin(angle) * 1.6).multiplyScalar(scale)
    spawnSprite(fx, 'sparkle', origin, velocity, 0.9 + Math.random() * 0.5, (0.12 + Math.random() * 0.12) * scale, SPARKLE_COLORS[index % 3]!)
  }
  for (let index = 0; index < 4; index += 1) {
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6).multiplyScalar(scale)
    spawnSprite(fx, 'heart', origin.clone().add(new THREE.Vector3(0, 0.8 * scale, 0)), velocity, 2, (0.14 + Math.random() * 0.1) * scale, HEART_COLORS[index % 3]!)
  }
}

function spawnSmokePuff(runtime: CompanionRuntime, strength: number) {
  const { fx, group } = runtime
  const scale = runtime.anim.placement?.scale ?? 1
  const origin = group.position.clone().add(new THREE.Vector3(0, 0.9 * scale, 0))
  const grey = new THREE.Color('#cbbbd6')
  for (let index = 0; index < Math.round(7 * strength); index += 1) {
    const angle = (index / 7) * Math.PI * 2
    const velocity = new THREE.Vector3(Math.cos(angle) * 0.9, 0.3 + Math.random() * 0.5, Math.sin(angle) * 0.9).multiplyScalar(scale)
    const start = origin.clone().add(new THREE.Vector3(0, (Math.random() - 0.3) * 0.9 * scale, 0))
    spawnSprite(fx, 'smoke', start, velocity, 1.2 + Math.random() * 0.5, (0.7 + Math.random() * 0.4) * scale, grey)
  }
  for (let index = 0; index < Math.round(3 * strength); index += 1) {
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8, (Math.random() - 0.5) * 0.4).multiplyScalar(scale)
    spawnSprite(fx, 'heart', origin.clone().add(new THREE.Vector3(0, 0.6 * scale, 0)), velocity, 1.4, 0.16 * scale, new THREE.Color(1.0, 0.35, 0.6))
  }
}

export function updateCompanion(runtime: CompanionRuntime, input: CompanionUpdateInput): void {
  const { anim, group, rig, fx } = runtime
  const dt = THREE.MathUtils.clamp(Number.isFinite(input.delta) ? input.delta : 0, 0, 0.1)
  anim.time = input.time

  handleState(runtime, input)

  // Phase transitions driven by time.
  if (anim.phase === 'entering' && anim.time - anim.phaseStart >= ENTRANCE_DURATION) {
    setPhase(anim, 'present', anim.time)
  }
  if (anim.phase === 'leaving') {
    const duration = anim.exitFast ? FAST_EXIT_DURATION : EXIT_DURATION
    const elapsed = anim.time - anim.phaseStart
    const puffAt = anim.exitFast ? 0.4 : 1.35
    if (elapsed >= puffAt && !anim.fxPuffed) {
      anim.fxPuffed = true
      if (!input.reducedMotion) spawnSmokePuff(runtime, anim.exitFast ? 0.6 : 1)
    }
    if (elapsed >= duration) {
      anim.fxPuffed = false
      setPhase(anim, 'hidden', anim.time)
      group.visible = false
      const pending = anim.pending
      anim.current = null
      if (pending && input.state && input.state.id === pending.id && pending.mood !== 'sulk_leave') {
        beginEntrance(runtime, input.state, anim.time)
      }
    }
  }

  if (anim.phase === 'hidden') {
    group.visible = false
    updateParticles(fx, dt, anim.time)
    updateServedDrinks(fx, dt, input.reducedMotion)
    return
  }

  const placement = resolvePlacement(runtime, input)
  if (!placement) {
    // Owner seat not found: hide quietly (keep state so she can come back).
    group.visible = false
    updateParticles(fx, dt, anim.time)
    updateServedDrinks(fx, dt, input.reducedMotion)
    return
  }
  anim.placement = placement
  if (placement.head) {
    // Which of her sides the player is on, in her own (yawed) frame.
    const dx = placement.head.x - placement.position.x
    const dz = placement.head.z - placement.position.z
    const localX = dx * Math.cos(placement.yaw) - dz * Math.sin(placement.yaw)
    anim.playerSide = localX >= 0 ? 1 : -1
  }
  if (input.ownerSeat && !input.ownerIsHero) {
    anim.serveSpot = computeServeSpot(input.ownerSeat.getWorldPosition(new THREE.Vector3()), placement.position)
  } else if (input.ownerIsHero) {
    // "Your" drink lands on the felt just in front of the lens.
    input.camera.updateMatrixWorld()
    const spot = input.camera.localToWorld(new THREE.Vector3(-0.35, -0.6, -2.4))
    anim.serveSpot = spot
  } else {
    anim.serveSpot = null
  }

  if (anim.phase === 'entering' && !anim.enteredBurst) {
    anim.enteredBurst = true
    spawnEntranceBurst(runtime, input)
  }
  if (anim.phase === 'entering' && anim.time - anim.phaseStart > 0.9 && !anim.line) {
    const context = anim.current ? getLadyLuckMoodContext({ mood: 'arrive', reason: anim.current.reason }) : 'arrive_streak'
    say(anim, context, 3.2)
  }
  if (anim.phase !== 'entering') anim.enteredBurst = false

  // Gesture scheduler.
  if (anim.phase === 'present' && !anim.gesture && anim.time >= anim.nextGestureAt && anim.current) {
    const name = anim.queuedGesture ?? pickCompanionGesture(
      anim.current.mood,
      anim.random,
      anim.lastGesture,
      input.reducedMotion,
      input.ownerIsHero || !placement.behind ? SEAT_ONLY_GESTURES : []
    )
    anim.queuedGesture = null
    startGesture(anim, name, anim.time)
    if (name === 'serve') say(anim, 'serve', 2.4)
    anim.nextGestureAt = anim.time + GESTURE_DURATIONS[name] + 1.6 + anim.random() * 2.6
  }

  // Chatter: a short quip every ~6-12 s (flirty to her owner, sassy about others).
  if (anim.phase === 'present' && !anim.muted && anim.time >= anim.nextChatAt && anim.time > anim.lineUntil) {
    const names = anim.otherNames.filter(Boolean)
    if (names.length > 0 && anim.random() < 0.35) {
      say(anim, 'sass_other', 2.8, names[Math.floor(anim.random() * names.length) % names.length])
    } else {
      say(anim, anim.current?.mood === 'cheer' ? 'cheer' : 'flirt', 2.8)
    }
  }

  group.visible = true
  group.updateMatrixWorld(true)
  const targets = buildTargets(runtime, input)
  applyPose(runtime, targets, dt)
  updateRootTransform(runtime, input, dt)
  group.updateMatrixWorld(true)
  placeTrayAndCocktail(runtime, dt)

  // A little sequin sparkle on the swim top.
  const sequins = rig.materials.sequinTexture
  sequins.offset.set((anim.time * 0.02) % 1, Math.floor(anim.time * 5) * 0.137 % 1)
  rig.materials.swimTop.emissiveIntensity = input.reducedMotion ? 0.55 : 0.5 + 0.3 * Math.sin(anim.time * 3.3)

  updateParticles(fx, dt, anim.time)
  updateServedDrinks(fx, dt, input.reducedMotion)
}

