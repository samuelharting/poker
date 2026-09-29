import type { Bone } from 'three'

/**
 * Procedural hands for the rigged avatars.
 *
 * Rig facts (all six Quaternius models share them):
 *  - Every finger has bones `F1..F4` (the thumb has `Thumb1..3`). `F1` is the
 *    metacarpal (a palm-length bone: bending it bends the whole palm, so it only
 *    gets a little cupping), `F2` is the knuckle (MCP), `F3` the middle joint
 *    (PIP), `F4` the last joint (DIP). Local X flexes (negative = toward the
 *    palm), local Z splays, local Y is a small twist. The left hand mirrors the
 *    Y and Z signs of the right.
 *  - The idle clip used to animate a few finger bones; those tracks are
 *    stripped at load (avatarAssetLoader), so this module owns every finger
 *    bone outright and writes `bind + delta` rotations each frame.
 *
 * Hands are described as blends of named shapes (relaxed, fist, pinch ...). A
 * shape is a vector of joint angles; the blend of the current shape weights is
 * the per-frame target, and every joint runs through its own critically damped
 * spring (pinky lags index, splay is slower than flex) so hands ease between
 * shapes and the fingers curl in a cascade instead of moving as one piece.
 */

const D = Math.PI / 180

export const HAND_SHAPES = [
  'relaxed',
  'flat',
  'open',
  'fist',
  'loose',
  'pinch',
  'grab',
  'card',
  'peek',
  'tap',
  'point',
  'flickCock',
  'flickSnap',
  'cup',
  'middle',
  'rub',
  'clap',
  'chipRest',
] as const

export type HandShapeId = (typeof HAND_SHAPES)[number]
export const HAND_SHAPE_COUNT = HAND_SHAPES.length
const SHAPE_INDEX = Object.fromEntries(HAND_SHAPES.map((name, index) => [name, index])) as Record<HandShapeId, number>
const RELAXED = SHAPE_INDEX.relaxed

/** Finger order in the joint vector. */
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const
const DOF = 6
const JOINTS = FINGERS.length * DOF

/*
 * Per finger: [cmc, mcp, pip, dip, splay, twist] (degrees, positive = curl;
 * splay positive = spread apart from the middle finger).
 * Thumb: [opposition (toward the palm), rotate, abduct (out from the hand),
 * mcp flex, ip flex, mcp adduct].
 */
type FingerDof = readonly [number, number, number, number, number, number]
const F = (cmc: number, mcp: number, pip: number, dip: number, splay = 0, twist = 0): FingerDof => [cmc, mcp, pip, dip, splay, twist]

function shape(thumb: FingerDof, index: FingerDof, middle: FingerDof, ring: FingerDof, pinky: FingerDof): Float32Array {
  const out = new Float32Array(JOINTS)
  ;[thumb, index, middle, ring, pinky].forEach((finger, f) => {
    finger.forEach((value, k) => { out[f * DOF + k] = value * D })
  })
  return out
}

const SHAPE_TABLE: Record<HandShapeId, Float32Array> = {
  // A resting hand: gently curled, curl growing from index to pinky, thumb alongside.
  relaxed: shape(F(20, 8, -10, 14, 16), F(0, 18, 28, 12, 4), F(0, 23, 36, 15, 1), F(2, 28, 42, 18, 3), F(4, 34, 46, 20, 7)),
  flat: shape(F(6, 0, -18, 4, 4), F(0, -2, 0, 0, 0), F(0, -2, 0, 0, 0), F(0, -2, 0, 0, 0), F(0, -2, 0, 0, 1)),
  open: shape(F(0, 0, 10, 0, -4), F(0, -6, -2, 0, 7), F(0, -6, -2, 0, 2), F(0, -6, -2, 0, 5), F(0, -6, -2, 0, 10)),
  fist: shape(F(48, 26, -22, 30, 36), F(0, 84, 105, 60, 0), F(0, 86, 108, 62, 0), F(4, 88, 106, 60, 0), F(8, 86, 100, 55, 0)),
  loose: shape(F(30, 14, -12, 20, 24), F(0, 55, 70, 35, 2), F(0, 62, 80, 40, 0), F(3, 68, 85, 42, 0), F(6, 72, 88, 44, 2)),
  // Chip pinch: thumb tip meets index tip, the rest curled out of the way.
  pinch: shape(F(22, 28, -28, 10, 1), F(0, 51, 25, 19, 0), F(0, 55, 65, 30, 0), F(2, 62, 72, 35, 0), F(4, 68, 78, 38, 0)),
  // Claw round a stack of chips.
  grab: shape(F(30, 10, -6, 20, 20), F(0, 38, 44, 20, 3), F(0, 42, 50, 24, 1), F(2, 46, 54, 26, 3), F(4, 50, 58, 28, 5)),
  // Holding a card edge: thumb under, fingers curved over the top.
  card: shape(F(26, 14, -8, 18, 18), F(0, 30, 28, 12, 3), F(0, 36, 38, 16, 0), F(2, 46, 52, 24, 2), F(4, 52, 56, 26, 4)),
  peek: shape(F(30, 16, -6, 20, 18), F(0, 20, 24, 10, 4), F(0, 26, 34, 14, 1), F(2, 38, 46, 20, 3), F(4, 46, 52, 24, 5)),
  // Two-finger tap on the felt: index and middle out, the rest tucked.
  tap: shape(F(30, 16, -14, 24, 26), F(0, 24, 20, 8, 2), F(0, 26, 24, 10, 0), F(2, 84, 98, 55, 0), F(4, 84, 95, 52, 0)),
  point: shape(F(15, 10, 4, 10, 6), F(0, 2, 0, 0, 4), F(0, 86, 106, 60, 0), F(4, 88, 106, 60, 0), F(8, 86, 100, 55, 0)),
  flickCock: shape(F(38, 20, -8, 22, 20), F(0, 72, 108, 30, 0), F(0, 62, 80, 40, 0), F(3, 68, 85, 42, 0), F(6, 72, 88, 44, 2)),
  flickSnap: shape(F(30, 20, 0, 14, 8), F(0, -4, 0, 0, 2), F(0, 62, 80, 40, 0), F(3, 68, 85, 42, 0), F(6, 72, 88, 44, 2)),
  // Round a glass.
  cup: shape(F(34, 12, -4, 22, 20), F(0, 50, 52, 26, 4), F(0, 54, 60, 30, 1), F(2, 58, 66, 32, 3), F(4, 62, 70, 34, 5)),
  // Flick-off: middle finger up, the rest folded, thumb over them.
  middle: shape(F(40, 22, -20, 28, 32), F(0, 84, 105, 60, 0), F(0, -4, 0, 0, 0), F(4, 88, 106, 60, 0), F(8, 86, 100, 55, 0)),
  // Fingertips resting on the temple or head.
  rub: shape(F(10, 6, -6, 8, 8), F(0, 14, 16, 6, 8), F(0, 16, 20, 8, 3), F(0, 22, 26, 10, 6), F(0, 28, 30, 12, 10)),
  clap: shape(F(4, 0, -14, 4, 4), F(0, 8, 8, 4, 0), F(0, 8, 8, 4, 0), F(0, 10, 10, 5, 0), F(0, 12, 12, 6, 1)),
  // Fingers draped over a chip stack: relaxed but a little more spread.
  chipRest: shape(F(22, 10, -6, 16, 18), F(0, 30, 38, 18, 4), F(0, 34, 46, 22, 1), F(2, 40, 52, 26, 3), F(4, 46, 56, 28, 6)),
}

/** Legacy 0..1 curl: 0 = the relaxed hand, ~0.55 = a loose fist, 1 = a tight fist. */
const CURL_TARGETS = [SHAPE_TABLE.relaxed, SHAPE_TABLE.loose, SHAPE_TABLE.fist]
const CURL_KNEE = 0.55

/** Per-finger speed (the pinky trails the index) and per-joint speed. */
const FINGER_SPEED = [0.9, 1, 0.95, 0.88, 0.8] as const
const DOF_SPEED = [0.8, 1, 1, 0.9, 0.55, 0.45] as const
const BASE_OMEGA = 19

/** Joint limits (radians) for [cmc, mcp, pip, dip]. */
const FLEX_MIN = [-0.15, -0.55, -0.15, -0.3] as const
const FLEX_MAX = [0.7, 1.66, 1.95, 1.4] as const

export interface HandTarget {
  /** Shape weights (always sums to 1; the relaxed hand absorbs the remainder). */
  weights: Float32Array
  /** Legacy 0..1 curl layered on the relaxed part of the hand. */
  curl: number
  /** Extra finger spread (0..1). */
  spread: number
  /** Multiplies the spring speed (snaps for flicks, slow for lazy hands). */
  speed: number
  /** Fingers drumming on the table, index first (0..1). */
  drum: number
}

export function createHandTarget(): HandTarget {
  const target: HandTarget = { weights: new Float32Array(HAND_SHAPE_COUNT), curl: 0, spread: 0, speed: 1, drum: 0 }
  resetHandTarget(target)
  return target
}

export function resetHandTarget(target: HandTarget, curl = 0) {
  target.weights.fill(0)
  target.weights[RELAXED] = 1
  target.curl = curl
  target.spread = 0
  target.speed = 1
  target.drum = 0
}

/** Crossfades toward a shape: `weight` 0 keeps the current mix, 1 replaces it. */
export function blendHandShape(target: HandTarget, id: HandShapeId, weight: number) {
  const w = weight < 0 ? 0 : weight > 1 ? 1 : weight
  if (w <= 0) return
  const weights = target.weights
  for (let index = 0; index < HAND_SHAPE_COUNT; index += 1) weights[index]! *= 1 - w
  weights[SHAPE_INDEX[id]]! += w
  // The legacy curl belongs to the relaxed part only.
}

export function copyHandTarget(from: HandTarget, to: HandTarget) {
  to.weights.set(from.weights)
  to.curl = from.curl
  to.spread = from.spread
  to.speed = from.speed
  to.drum = from.drum
}

interface FingerRig {
  bones: Array<Bone | undefined>
  base: Float32Array
}

export interface HandRig {
  fingers: FingerRig[]
}

const rigCache = new WeakMap<object, { R: HandRig | null; L: HandRig | null }>()

function buildHandRig(bones: ReadonlyMap<string, Bone>, side: 'R' | 'L'): HandRig | null {
  if (!bones.get(`Index2${side}`) || !bones.get(`Thumb2${side}`)) return null
  const fingers: FingerRig[] = FINGERS.map(name => {
    const count = name === 'Thumb' ? 3 : 4
    const list: Array<Bone | undefined> = []
    const base = new Float32Array(4 * 3)
    for (let joint = 1; joint <= count; joint += 1) {
      const bone = bones.get(`${name}${joint}${side}`)
      list.push(bone)
      if (bone) {
        base[(joint - 1) * 3] = bone.rotation.x
        base[(joint - 1) * 3 + 1] = bone.rotation.y
        base[(joint - 1) * 3 + 2] = bone.rotation.z
      }
    }
    return { bones: list, base }
  })
  return { fingers }
}

export function getHandRig(bones: ReadonlyMap<string, Bone>): { R: HandRig | null; L: HandRig | null } {
  let rigs = rigCache.get(bones)
  if (!rigs) {
    rigs = { R: buildHandRig(bones, 'R'), L: buildHandRig(bones, 'L') }
    rigCache.set(bones, rigs)
  }
  return rigs
}

/** Puts every finger bone back on its bind rotation (so the arm solve sees a neutral hand). */
export function neutralizeHand(rig: HandRig | null) {
  if (!rig) return
  for (const finger of rig.fingers) {
    for (let joint = 0; joint < finger.bones.length; joint += 1) {
      const bone = finger.bones[joint]
      if (bone) bone.rotation.set(finger.base[joint * 3]!, finger.base[joint * 3 + 1]!, finger.base[joint * 3 + 2]!)
    }
  }
}

interface HandSpring {
  pos: Float32Array
  vel: Float32Array
  goal: Float32Array
}

function createHandSpring(): HandSpring {
  const spring = { pos: new Float32Array(JOINTS), vel: new Float32Array(JOINTS), goal: new Float32Array(JOINTS) }
  spring.pos.set(SHAPE_TABLE.relaxed)
  return spring
}

export interface AvatarHandsState {
  R: HandSpring
  L: HandSpring
  initialized: boolean
  /** Which finger is drumming / thumb rubbing, and when. */
  fidgetAt: number
  fidgetFinger: number
  fidgetHand: 0 | 1
}

export function createAvatarHandsState(): AvatarHandsState {
  return { R: createHandSpring(), L: createHandSpring(), initialized: false, fidgetAt: 3, fidgetFinger: 1, fidgetHand: 0 }
}

/** Dev override for shape review: window.__handDebug = { R: 'fist', L: 'pinch' }. */
function debugShape(side: 'R' | 'L'): HandShapeId | null {
  if (process.env.NODE_ENV === 'production') return null
  const debug = (globalThis as { __handDebug?: Partial<Record<'R' | 'L', string>> }).__handDebug
  const name = debug?.[side]
  return name && name in SHAPE_INDEX ? (name as HandShapeId) : null
}

export interface HandLab {
  /** Hands held out in front of the chest (seat units) for close-up review. */
  sep?: number
  forward?: number
  up?: number
  /** Hand frame [yawIn, pitch, rollIn] and wrist offset [flex, roll, dev]. */
  frame?: [number, number, number]
  wrist?: [number, number, number]
}

/** Dev override for close-ups: window.__handLab = { forward: 0.5, frame: [0, 0, 0] }. */
export function getHandLab(): HandLab | null {
  if (process.env.NODE_ENV === 'production') return null
  return (globalThis as { __handLab?: HandLab }).__handLab ?? null
}

/** Legacy curl: the relaxed hand tightening through a loose fist to a full fist. */
function curlAdd(goal: Float32Array, curl: number, weight: number) {
  if (curl <= 0.001 || weight <= 0.001) return
  const c = curl > 1 ? 1 : curl
  const lower = c <= CURL_KNEE
  const from = lower ? CURL_TARGETS[0]! : CURL_TARGETS[1]!
  const to = lower ? CURL_TARGETS[1]! : CURL_TARGETS[2]!
  const t = lower ? c / CURL_KNEE : (c - CURL_KNEE) / (1 - CURL_KNEE)
  const relaxed = CURL_TARGETS[0]!
  for (let index = 0; index < JOINTS; index += 1) {
    const value = from[index]! + (to[index]! - from[index]!) * t
    goal[index]! += (value - relaxed[index]!) * weight
  }
}

const IDLE_FREQ = [0.53, 0.71, 0.63, 0.83, 0.97] as const

function updateOneHand(
  spring: HandSpring,
  target: HandTarget,
  debug: HandShapeId | null,
  dt: number,
  time: number,
  phase: number,
  idle: number,
  snap: boolean
) {
  const { goal, pos, vel } = spring
  goal.fill(0)
  const weights = target.weights
  const vector = process.env.NODE_ENV === 'production' ? undefined : (globalThis as { __handDebugVector?: ArrayLike<number> }).__handDebugVector
  if (vector && vector.length >= JOINTS) {
    // Dev: a raw joint vector (degrees-free radians, see SHAPE_TABLE layout) for shape tuning.
    for (let index = 0; index < JOINTS; index += 1) goal[index] = vector[index]!
  } else if (debug) {
    goal.set(SHAPE_TABLE[debug])
  } else {
    for (let shapeIndex = 0; shapeIndex < HAND_SHAPE_COUNT; shapeIndex += 1) {
      const w = weights[shapeIndex]!
      if (w < 0.002) continue
      const source = SHAPE_TABLE[HAND_SHAPES[shapeIndex]!]
      for (let index = 0; index < JOINTS; index += 1) goal[index]! += source[index]! * w
    }
    curlAdd(goal, target.curl, weights[RELAXED]!)
  }
  // Spread: fingers fan out.
  if (target.spread > 0.001) {
    for (let f = 1; f < FINGERS.length; f += 1) goal[f * DOF + 4]! += target.spread * (f === 1 ? 0.22 : f === 2 ? 0.06 : f === 3 ? 0.16 : 0.28)
  }
  // Drumming: a ripple of taps running index to pinky.
  if (target.drum > 0.002) {
    for (let f = 1; f < FINGERS.length; f += 1) {
      const s = Math.sin(time * 12.5 - (f - 1) * 0.85 + phase)
      const tap = s > 0 ? s * Math.sqrt(s) : 0
      goal[f * DOF + 1]! += target.drum * 0.26 * tap
      goal[f * DOF + 2]! += target.drum * 0.2 * tap
    }
  }
  // Idle life: every finger drifts on its own slow cycle, mostly while relaxed.
  const lively = idle * (weights[RELAXED]! + 0.4 * weights[SHAPE_INDEX.chipRest]! + 0.25 * weights[SHAPE_INDEX.loose]!)
  if (lively > 0.002 && !debug && !vector) {
    for (let f = 0; f < FINGERS.length; f += 1) {
      const wave = Math.sin(time * IDLE_FREQ[f]! + phase + f * 1.7)
      const wave2 = Math.sin(time * IDLE_FREQ[f]! * 2.3 + phase * 1.9 + f)
      const base = f * DOF
      if (f === 0) {
        goal[base + 0]! += lively * (0.06 * wave + 0.02 * wave2)
        goal[base + 3]! += lively * 0.05 * wave2
      } else {
        goal[base + 1]! += lively * (0.05 * wave + 0.02 * wave2)
        goal[base + 2]! += lively * 0.06 * wave
        goal[base + 4]! += lively * 0.03 * wave2
      }
    }
  }
  // Springs: pinky lags index, splay and twist are slower than flexion.
  const speed = target.speed
  for (let f = 0; f < FINGERS.length; f += 1) {
    for (let k = 0; k < DOF; k += 1) {
      const index = f * DOF + k
      if (snap || vector) {
        pos[index] = goal[index]!
        vel[index] = 0
        continue
      }
      const omega = BASE_OMEGA * FINGER_SPEED[f]! * DOF_SPEED[k]! * speed
      const y = pos[index]! - goal[index]!
      const e = Math.exp(-omega * dt)
      const t = vel[index]! + omega * y
      pos[index] = goal[index]! + (y + t * dt) * e
      vel[index] = (vel[index]! - omega * t * dt) * e
      if (!Number.isFinite(pos[index]!)) {
        pos[index] = goal[index]!
        vel[index] = 0
      }
    }
  }
}

function clampFlex(value: number, joint: number) {
  return value < FLEX_MIN[joint]! ? FLEX_MIN[joint]! : value > FLEX_MAX[joint]! ? FLEX_MAX[joint]! : value
}

/** Writes the sprung joint vector onto the finger bones (bind + delta). */
function writeHand(rig: HandRig, spring: HandSpring, mirror: 1 | -1) {
  const v = spring.pos
  for (let f = 0; f < FINGERS.length; f += 1) {
    const finger = rig.fingers[f]!
    const b = finger.bones
    const base = finger.base
    const o = f * DOF
    if (f === 0) {
      const t1 = b[0]
      const t2 = b[1]
      const t3 = b[2]
      if (t1) t1.rotation.set(base[0]! - v[o]!, base[1]! - v[o + 1]! * mirror, base[2]! + v[o + 2]! * mirror)
      if (t2) t2.rotation.set(base[3]! - clampFlex(v[o + 3]!, 1), base[4]!, base[5]! + v[o + 5]! * mirror)
      if (t3) t3.rotation.set(base[6]! - clampFlex(v[o + 4]!, 3), base[7]!, base[8]!)
      continue
    }
    // Splay direction: the index and middle fingers spread toward the thumb, the
    // ring and pinky away from it (right-hand +Z is toward the thumb).
    const splaySign = f <= 2 ? 1 : -1
    const c1 = b[0]
    const c2 = b[1]
    const c3 = b[2]
    const c4 = b[3]
    if (c1) c1.rotation.set(base[0]! - clampFlex(v[o]!, 0), base[1]!, base[2]!)
    if (c2) c2.rotation.set(base[3]! - clampFlex(v[o + 1]!, 1), base[4]! + v[o + 5]! * mirror, base[5]! + v[o + 4]! * splaySign * mirror)
    if (c3) c3.rotation.set(base[6]! - clampFlex(v[o + 2]!, 2), base[7]!, base[8]!)
    if (c4) c4.rotation.set(base[9]! - clampFlex(v[o + 3]!, 3), base[10]!, base[11]!)
  }
}

export interface AvatarHandsInput {
  time: number
  delta: number
  reducedMotion: boolean
  /** 0..1 how much idle finger life to add (seeded by player). */
  idle?: number
  seed: number
}

/**
 * Advances both hands' springs toward their targets and writes the finger
 * bones. Call after the arms have been solved (the wrists are final by then).
 */
export function updateAvatarHands(
  state: AvatarHandsState,
  bones: ReadonlyMap<string, Bone>,
  targetR: HandTarget,
  targetL: HandTarget,
  input: AvatarHandsInput
) {
  const profile = process.env.NODE_ENV !== 'production' ? (globalThis as { __animProf?: Record<string, number> }).__animProf : undefined
  const started = profile ? performance.now() : 0
  updateAvatarHandsInner(state, bones, targetR, targetL, input)
  if (profile) profile.hands = (profile.hands ?? 0) + performance.now() - started
}

function updateAvatarHandsInner(
  state: AvatarHandsState,
  bones: ReadonlyMap<string, Bone>,
  targetR: HandTarget,
  targetL: HandTarget,
  input: AvatarHandsInput
) {
  const rigs = getHandRig(bones)
  const dt = Math.min(0.05, Math.max(0.0001, input.delta))
  const snap = input.reducedMotion || !state.initialized
  const idle = input.reducedMotion ? 0 : input.idle ?? 1
  const phase = input.seed * 40
  updateOneHand(state.R, targetR, debugShape('R'), dt, input.time, phase, idle, snap)
  updateOneHand(state.L, targetL, debugShape('L'), dt, input.time, phase + 2.3, idle, snap)
  state.initialized = true
  if (rigs.R) writeHand(rigs.R, state.R, 1)
  if (rigs.L) writeHand(rigs.L, state.L, -1)
}
