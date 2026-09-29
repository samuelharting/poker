import * as THREE from 'three'
import { faceHash01, type FacePersonality } from './avatarFacePersonality'

/**
 * Natural gaze.
 *
 * Attention is a small state machine over "what am I looking at": the pot/board,
 * the player who is acting, the viewer's camera (eye contact), my own cards,
 * another player, or away (thinking up-and-aside, bored down-and-aside). Each
 * fixation holds for a personality-dependent time, with micro-saccades landing
 * a few hundredths of a radian off and a slow drift, then jumps ballistically
 * (fast) to the next target. Between jumps the eyes pursue the target smoothly
 * (heads and targets move). Each eye aims at the real 3D point independently, so
 * near targets (cards, pot) converge (vergence) for free. Big jumps trigger a
 * blink. Tired/drunk eyes lag and swim.
 */

export const GAZE = { board: 0, pot: 1, acting: 2, viewer: 3, cards: 4, other: 5, away: 6 } as const
export const GAZE_KINDS = 7

export interface GazeTargets {
  positions: THREE.Vector3[]
  weights: Float32Array
  available: Uint8Array
  /** Another player to glance at (seat id), refreshed when a new fixation is chosen. */
  otherIndexHint: number
  /** Tags what the "away" look means right now. */
  awayMode: 'think' | 'down' | 'side'
}

export function createGazeTargets(): GazeTargets {
  return {
    positions: Array.from({ length: GAZE_KINDS }, () => new THREE.Vector3()),
    weights: new Float32Array(GAZE_KINDS),
    available: new Uint8Array(GAZE_KINDS),
    otherIndexHint: 0,
    awayMode: 'side',
  }
}

export interface GazeState {
  kind: number
  fixUntil: number
  /** Landing error / micro-saccade offset (radians) on top of the fixation point. */
  offX: number
  offY: number
  nextMicro: number
  /** Away look direction in head space (yaw, pitch radians). */
  awayYaw: number
  awayPitch: number
  /** Per eye current yaw/pitch (radians). */
  yaw: [number, number]
  pitch: [number, number]
  /** Slow drift phase. */
  drift: number
  lastJump: number
  jumpedAt: number
  blinkKick: boolean
  seed: number
  count: number
}

export function createGazeState(seed: number): GazeState {
  return {
    kind: GAZE.board,
    fixUntil: 0.4 + faceHash01(seed * 3.3) * 1.2,
    offX: 0,
    offY: 0,
    nextMicro: 0.5,
    awayYaw: 0.3,
    awayPitch: -0.1,
    yaw: [0, 0],
    pitch: [0, 0],
    drift: seed * 40,
    lastJump: 0,
    jumpedAt: -10,
    blinkKick: false,
    seed,
    count: 0,
  }
}

// Eyes rarely swing far from centre; the head takes the rest of a turn.
const MAX_YAW = 0.4
const MAX_PITCH_UP = 0.3
const MAX_PITCH_DOWN = 0.36
/** Largest convergence / divergence of the two eyes (radians each). */
const MAX_CONVERGE = 0.12
const MAX_DIVERGE = 0.02

const local = new THREE.Vector3()
const dir = new THREE.Vector3()
const invQuat = new THREE.Quaternion()
const scratchYaw = [0, 0]
const scratchPitch = [0, 0]

function softLimit(value: number, limit: number) {
  // Smoothly saturates towards +-limit instead of a hard clamp.
  const x = value / limit
  const ax = Math.abs(x)
  if (ax < 0.7) return value
  const t = (ax - 0.7) / 0.3
  return limit * Math.sign(x) * (0.7 + 0.3 * (t / (1 + t)))
}

function pickKind(state: GazeState, targets: GazeTargets, time: number) {
  let total = 0
  for (let i = 0; i < GAZE_KINDS; i += 1) {
    if (targets.available[i]) total += targets.weights[i]!
  }
  if (total <= 0) return GAZE.board
  let pick = faceHash01(time * 7.13 + state.seed * 61 + state.count * 3.7) * total
  for (let i = 0; i < GAZE_KINDS; i += 1) {
    if (!targets.available[i]) continue
    pick -= targets.weights[i]!
    if (pick <= 0) return i
  }
  return GAZE.board
}

export interface GazeOptions {
  instant: boolean
  heavy: number
  fallbackYaw: number
  fallbackPitch: number
  tripping: boolean
  drunk: number
  closed: boolean
  still?: boolean
}

export interface GazeEye {
  /** Eye centre in Head-bone space. */
  position: THREE.Vector3
  /** Eye rotation relative to the Head bone. */
  quaternion: THREE.Quaternion
  /** The eye's fixed outward yaw in Head space (radians, + for the +x eye). */
  baseYaw: number
}

/**
 * Advances the gaze one frame. Writes eye yaw/pitch (radians, eye-local, + yaw
 * towards +x, + pitch up) into `state`. Returns true when a big gaze shift just
 * started (the caller can blink).
 */
export function updateGaze(
  state: GazeState,
  targets: GazeTargets | null,
  invHeadWorld: THREE.Matrix4,
  eyes: readonly GazeEye[],
  person: FacePersonality,
  time: number,
  delta: number,
  opts: GazeOptions
): boolean {
  let kicked = false
  const restless = person.gazeRestless

  if (targets && time >= state.fixUntil) {
    const previous = state.kind
    state.count += 1
    state.kind = pickKind(state, targets, time)
    const r1 = faceHash01(time * 3.9 + state.seed * 17 + state.count)
    const r2 = faceHash01(time * 2.1 + state.seed * 29 + state.count * 1.3)
    let hold = 1.2 + r1 * 2.6
    if (state.kind === GAZE.viewer) hold = 0.8 + r1 * 1.3
    else if (state.kind === GAZE.cards) hold = 1.4 + r1 * 2.2
    else if (state.kind === GAZE.away) hold = 0.7 + r1 * 1.4
    hold *= 1.5 - restless * 0.9
    if (opts.tripping) hold *= 0.55
    state.fixUntil = time + hold * (1 + opts.heavy * 0.6)
    state.offX = (r2 - 0.5) * 0.05
    state.offY = (faceHash01(time * 1.7 + state.count * 0.9) - 0.5) * 0.04
    if (state.kind === GAZE.away) {
      const side = faceHash01(time * 4.4 + state.seed * 8 + state.count) < 0.5 ? -1 : 1
      if (targets.awayMode === 'think') {
        state.awayYaw = side * (0.25 + r2 * 0.25)
        state.awayPitch = 0.18 + r1 * 0.15
      } else if (targets.awayMode === 'down') {
        state.awayYaw = side * (0.1 + r2 * 0.3)
        state.awayPitch = -0.22 - r1 * 0.15
      } else {
        state.awayYaw = side * (0.32 + r2 * 0.28)
        state.awayPitch = (r1 - 0.5) * 0.14
      }
    }
    if (previous !== state.kind) {
      state.jumpedAt = time
      kicked = true
    }
  }

  // Micro-saccades: tiny ballistic re-fixations within a fixation.
  if (time >= state.nextMicro) {
    const n = state.count * 5 + Math.floor(time * 3)
    const amp = 0.028 + restless * 0.06 + opts.drunk * 0.005
    state.offX = (faceHash01(state.seed * 91 + n * 1.37) - 0.5) * 2 * amp
    state.offY = (faceHash01(state.seed * 53 + n * 1.91) - 0.5) * 2 * amp * 0.6
    state.nextMicro = time + (0.28 + faceHash01(state.seed * 17 + n * 2.3) * 0.9) * (1.6 - restless)
  }
  state.drift += delta * (0.6 + restless)
  const swim = 0.006 + opts.drunk * 0.0035 + opts.heavy * 0.01
  const driftX = opts.still ? 0 : (Math.sin(state.drift * 1.3) + Math.sin(state.drift * 2.9 + 1)) * swim
  const driftY = opts.still ? 0 : (Math.sin(state.drift * 1.7 + 2) + Math.sin(state.drift * 3.1)) * swim * 0.6

  if (opts.still) {
    state.offX = 0
    state.offY = 0
  }

  // Where each eye wants to point.
  const wantYaw = scratchYaw
  const wantPitch = scratchPitch
  wantYaw[0] = wantYaw[1] = 0
  wantPitch[0] = wantPitch[1] = 0
  let hasTarget = false
  if (targets && !opts.closed) {
    if (state.kind === GAZE.away) {
      wantYaw[0] = state.awayYaw - eyes[0]!.baseYaw
      wantYaw[1] = state.awayYaw - eyes[1]!.baseYaw
      wantPitch[0] = wantPitch[1] = state.awayPitch
      hasTarget = true
    } else if (targets.available[state.kind]) {
      local.copy(targets.positions[state.kind]!).applyMatrix4(invHeadWorld)
      hasTarget = true
      for (let e = 0; e < eyes.length; e += 1) {
        const eye = eyes[e]!
        dir.copy(local).sub(eye.position)
        invQuat.copy(eye.quaternion).invert()
        dir.applyQuaternion(invQuat).normalize()
        wantYaw[e] = Math.atan2(dir.x, dir.z)
        wantPitch[e] = Math.atan2(dir.y, Math.hypot(dir.x, dir.z))
      }
    }
  }
  if (!hasTarget) {
    wantYaw[0] = opts.fallbackYaw - eyes[0]!.baseYaw
    wantYaw[1] = opts.fallbackYaw - eyes[1]!.baseYaw
    wantPitch[0] = wantPitch[1] = opts.fallbackPitch
  }

  // Work in the head frame with a shared (conjugate) direction plus a small, clamped vergence,
  // so the two eyes never wander apart however near or far the target is.
  const hy0 = wantYaw[0]! + eyes[0]!.baseYaw
  const hy1 = wantYaw[1]! + eyes[1]!.baseYaw
  const meanYaw = softLimit((hy0 + hy1) * 0.5 + state.offX + driftX, MAX_YAW)
  const vergence = Math.min(MAX_CONVERGE, Math.max(-MAX_DIVERGE, (hy1 - hy0) * 0.5))
  const rawPitch = (wantPitch[0]! + wantPitch[1]!) * 0.5 + state.offY + driftY
  const pitchGoal = softLimit(rawPitch, rawPitch >= 0 ? MAX_PITCH_UP : MAX_PITCH_DOWN)
  for (let e = 0; e < eyes.length; e += 1) {
    const yawGoal = meanYaw + (e === 0 ? -vergence : vergence) - eyes[e]!.baseYaw
    const errYaw = yawGoal - state.yaw[e]!
    const errPitch = pitchGoal - state.pitch[e]!
    if (opts.instant) {
      state.yaw[e] = yawGoal
      state.pitch[e] = pitchGoal
      continue
    }
    const err = Math.hypot(errYaw, errPitch)
    // Saccade (fast, ballistic) for real jumps, smooth pursuit for tracking.
    const sacc = err > 0.075
    const lag = 1 / (1 + opts.heavy * 1.4 + opts.drunk * 0.08)
    const rate = (sacc ? 46 : 7.5 + restless * 3) * lag
    const k = 1 - Math.exp(-delta * rate)
    state.yaw[e] = state.yaw[e]! + errYaw * k
    state.pitch[e] = state.pitch[e]! + errPitch * k
  }
  return kicked
}

/**
 * Converts eye yaw/pitch (radians) into the unit gaze vector the eye shader wants.
 */
export function gazeVector(yaw: number, pitch: number, out: THREE.Vector3) {
  const cp = Math.cos(pitch)
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
}
