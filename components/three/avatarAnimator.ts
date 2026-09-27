import type { PlayerAvatarCelebration, PlayerAvatarIdleTell } from '@/lib/profile'
import {
  getOpponentTableActionPose,
  getSeatedAvatarActionPose,
  type Vec3,
} from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'
import {
  CHIP_BONK_REACT_SECONDS,
  CHIP_FLICK_GESTURE_SECONDS,
  CHIP_LAUNCH_AT,
  SHOT_ARRIVE_AT,
  SHOT_DOWN_AT,
  SHOT_MOUTH_AT,
  SHOT_SHUDDER_END,
  SHOT_SLAM_AT,
} from './prankTimeline'

/**
 * Procedural performance layer for seated rigged avatars.
 *
 * The GLB idle clip gives subtle full-body life. This layer turns it into a
 * seated poker player: the spine and head are driven by additive rotations,
 * while each hand gets a *target position* in seat space (resting on the
 * rail, peeking at cards, pushing chips, cheering). The renderer reaches
 * those targets with two-bone IK, so gestures land in the right place on
 * any of the rigs. Every channel runs through a critically damped spring so
 * state changes blend instead of popping.
 */

export const ANIMATED_BONES = [
  'Torso',
  'Chest',
  'Neck',
  'Head',
  'ShoulderR',
  'ShoulderL',
  'WristR',
  'WristL',
] as const

export type AnimatedBone = (typeof ANIMATED_BONES)[number]

/** Seat-local reference points (seat root space, -Z faces the table). */
export interface AvatarAnchors {
  railR: Vec3
  railL: Vec3
  cards: Vec3
  chest: Vec3
  chin: Vec3
  shoulderR: Vec3
  shoulderL: Vec3
  /** The player's own chip stack on the felt. */
  stack: Vec3
  /** Where their bets land (the wager anchor). */
  betSpot: Vec3
  /** Felt spot for check taps. */
  tap: Vec3
  /** Centre of the community cards. */
  board: Vec3
  /** Where the player's drink sits on the felt between sips. */
  drinkRest: Vec3
}

export interface AvatarPose {
  bones: Record<AnimatedBone, Vec3>
  /** Seat-local wrist targets for arm IK. */
  handR: Vec3
  handL: Vec3
  fingerCurlR: number
  fingerCurlL: number
  bodyPosition: Vec3
  bodyRotation: Vec3
  /** 0..1 how far the player has lifted their hole cards to peek. */
  cardLift: number
  /** 0..1 how far a drink is raised to the mouth (for the prop's tilt). */
  drinkLift: number
  /** 0..1 middle finger extended (the flick-off gesture). */
  middleFinger: number
  /** 0..1 elbows splayed out level with the hands (arms folded on the rail). */
  elbowOut: number
  /** 0..1 elbows raised up and out (hands laced behind the head). */
  elbowUp: number
}

export interface AvatarAnimatorInput {
  time: number
  delta: number
  reducedMotion: boolean
  acting: boolean
  folded: boolean
  winner: boolean
  loser: boolean
  hasCards: boolean
  cue: ThreeActionCue
  cueElapsedMs: number
  cueActive: boolean
  actionKey: string
  playerId: string
  wagerIntensity: number
  /** Direction toward the acting player, from getAvatarHeadTurn. */
  lookYaw: number
  lookPitch: number
  /** Someone else's recent raise/all-in, 0..1. */
  tableHeat: number
  idleTell: PlayerAvatarIdleTell
  celebration: PlayerAvatarCelebration
  anchors: AvatarAnchors
  /** An in-progress drink: seconds since it started. */
  drinkElapsed?: number | null
  /** 0..10 beers deep. */
  drunkLevel?: number
  passedOut?: boolean
  /** A flick-off aimed at another seat: seconds elapsed and the target in seat space. */
  flipOff?: { elapsed: number; target: Vec3 } | null
  /** Seconds since new community cards landed (everyone looks at the board). */
  boardRevealAge?: number
  /** Someone else just won the pot (table reacts). */
  otherWinner?: boolean
  /** The player is really looking at their hole cards right now (server-driven peek). */
  peeking?: boolean
  /** Someone bought them a shot: seconds on the shot timeline (see prankTimeline). */
  shotElapsed?: number | null
  /** 0..1 glass raised to the middle for a group cheers. */
  cheersRaise?: number
  /** A flicked chip bonked them: seconds since impact. */
  bonkElapsed?: number | null
  /** They are flicking a chip at another seat: seconds elapsed and the target (seat space). */
  chipFlick?: { elapsed: number; target: Vec3 } | null
  /** Seconds since they blacked out (the head-bonk beat); null when not blacked out. */
  blackoutElapsed?: number | null
  /** Seconds since they came to from a blackout (dazed wobble); null when not dazed. */
  dazedElapsed?: number | null
  /** Hungover: rubs their temples now and then, winces, moves carefully. */
  hungover?: boolean
  /** On the pill trip: stares at their hands in wonder, swaying. */
  tripping?: boolean
}

interface Spring {
  value: number
  velocity: number
}

export interface AvatarAnimatorState {
  seed: number
  random: () => number
  springs: Spring[]
  nextGlanceAt: number
  glanceYaw: number
  glancePitch: number
  nextPeekAt: number
  peekStartedAt: number
  /** Server-driven peek: when it started / ended, and how far in it was when released. */
  livePeekSince: number
  livePeekEndedAt: number
  livePeekReleaseReach: number
  livePeekReleaseLift: number
  winnerSince: number
  loserSince: number
  foldedSince: number
  actingSince: number
  heatSince: number
  lastHeat: number
  thinkingStyle: 0 | 1 | 2
  loserStyle: 0 | 1
  nextBigIdleAt: number
  bigIdleStartedAt: number
  bigIdleKind: 0 | 1 | 2 | 3
  reactionSince: number
  reactionKind: 0 | 1 | 2
  initialized: boolean
}

const BONE_CHANNELS = ANIMATED_BONES.length * 3
/** Channel index of bodyPosition in writeChannels (after bones, hands and fingers). */
const BODY_CHANNEL_START = BONE_CHANNELS + 3 + 3 + 2
const CHANNEL_COUNT = BONE_CHANNELS + 3 + 3 + 2 + 3 + 3 + 1 + 1 + 1 + 1 + 1
/** Wind-up, thrust + jab, a readable ~1.4s hold, and a relaxed return. */
export const FLIP_OFF_SECONDS = 3.2
const DRINK_SECONDS = 2.6
/** How long the dazed head-circling lasts after coming to from a blackout. */
export const DAZED_SECONDS = 2.6
/** Winners rake the pot toward themselves before celebrating. */
const WINNER_RAKE_SECONDS = 1.0
const PEEK_DURATION = 2.1

export function createAvatarAnimatorState(seedSource: string): AvatarAnimatorState {
  let hash = 2166136261
  for (let index = 0; index < seedSource.length; index += 1) {
    hash ^= seedSource.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }

  return {
    seed: (hash >>> 0) / 0x100000000,
    random,
    springs: Array.from({ length: CHANNEL_COUNT }, () => ({ value: 0, velocity: 0 })),
    nextGlanceAt: 0,
    glanceYaw: 0,
    glancePitch: 0,
    nextPeekAt: 2 + random() * 6,
    peekStartedAt: Number.NEGATIVE_INFINITY,
    livePeekSince: Number.NEGATIVE_INFINITY,
    livePeekEndedAt: Number.NEGATIVE_INFINITY,
    livePeekReleaseReach: 0,
    livePeekReleaseLift: 0,
    winnerSince: Number.NEGATIVE_INFINITY,
    loserSince: Number.NEGATIVE_INFINITY,
    foldedSince: Number.NEGATIVE_INFINITY,
    actingSince: Number.NEGATIVE_INFINITY,
    heatSince: Number.NEGATIVE_INFINITY,
    lastHeat: 0,
    thinkingStyle: Math.floor(random() * 3) as 0 | 1 | 2,
    loserStyle: random() > 0.5 ? 1 : 0,
    nextBigIdleAt: 12 + random() * 20,
    bigIdleStartedAt: Number.NEGATIVE_INFINITY,
    bigIdleKind: 0,
    reactionSince: Number.NEGATIVE_INFINITY,
    reactionKind: 0,
    initialized: false,
  }
}

function emptyPose(): AvatarPose {
  const bones = {} as Record<AnimatedBone, Vec3>
  for (const bone of ANIMATED_BONES) bones[bone] = [0, 0, 0]
  return {
    bones,
    handR: [0, 0, 0],
    handL: [0, 0, 0],
    fingerCurlR: 0,
    fingerCurlL: 0,
    bodyPosition: [0, 0, 0],
    bodyRotation: [0, 0, 0],
    cardLift: 0,
    drinkLift: 0,
    middleFinger: 0,
    elbowOut: 0,
    elbowUp: 0,
  }
}

/**
 * Which hand throws the flick-off: the one on the target's side, so the arm
 * extends toward them instead of crossing the body. `target` is seat-local.
 */
export function getFlipOffHand(target: Vec3): 'R' | 'L' {
  return target[0] < -0.2 * Math.abs(target[2]) ? 'L' : 'R'
}

/** Blends one rotation axis of a bone toward `value` (so a gesture can own it). */
function blendAxis(target: Vec3, axis: 0 | 1 | 2, value: number, weight: number) {
  const w = Math.max(0, Math.min(1, weight))
  target[axis] += (value - target[axis]!) * w
}

/** A quick accent: rises over `attack`, then decays over `decay` seconds. */
function pulse(elapsed: number, at: number, attack: number, decay = attack * 2.2) {
  const local = elapsed - at
  if (local < 0) return 0
  if (local < attack) return smoothStep(local / attack)
  return Math.max(0, 1 - smoothStep((local - attack) / decay))
}

function add(target: Vec3, x: number, y: number, z: number, weight = 1) {
  target[0] += x * weight
  target[1] += y * weight
  target[2] += z * weight
}

/** Moves a hand target toward `goal` by `weight` (0 keeps it, 1 replaces it). */
function blendTo(target: Vec3, goal: Vec3, weight: number) {
  const w = Math.max(0, Math.min(1, weight))
  target[0] += (goal[0] - target[0]) * w
  target[1] += (goal[1] - target[1]) * w
  target[2] += (goal[2] - target[2]) * w
}

function offset(base: Vec3, x: number, y: number, z: number): Vec3 {
  return [base[0] + x, base[1] + y, base[2] + z]
}

/**
 * Wrist target for hands laced behind the head. The chin anchor sits in front
 * of the face, so the target goes up and well back past the skull; the arm IK
 * raises the elbows (pose.elbowUp) so the forearms frame the head instead of
 * crossing the face.
 */
function behindHead(anchors: AvatarAnchors, side: 1 | -1): Vec3 {
  return offset(anchors.chin, 0.12 * side, 0.3, 0.42)
}

/**
 * Hands travelling between the rail and behind the head swing out wide around
 * the shoulders (peaking mid-way) so they never sweep through the face.
 */
function aroundHead(target: Vec3, weight: number, side: 1 | -1) {
  const bulge = 4 * weight * (1 - weight)
  target[0] += 0.3 * side * bulge
  target[2] -= 0.06 * bulge
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function smoothStep(value: number) {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
}

/** Rises over `attack`, holds, then falls over `release` within `duration`. */
function envelope(elapsed: number, duration: number, attack: number, release: number) {
  if (elapsed < 0 || elapsed > duration) return 0
  return Math.min(smoothStep(elapsed / attack), smoothStep((duration - elapsed) / release))
}

function sway(time: number, seed: number) {
  return (
    Math.sin(time * 0.61 + seed * 11) * 0.6 +
    Math.sin(time * 0.37 + seed * 7) * 0.4
  )
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

/** Builds the unsmoothed target pose for this frame. */
/**
 * Server-driven peek envelope. Reaching comes first, then the cards lift;
 * on release the cards go down first, then the hands return to the rail.
 */
function getLivePeekWeights(state: AvatarAnimatorState, input: AvatarAnimatorInput): { reach: number; lift: number } {
  const { time } = input
  const able = Boolean(input.peeking) && input.hasCards && !input.folded && !input.passedOut && !input.winner && !input.loser
  if (able && !Number.isFinite(state.livePeekSince)) {
    state.livePeekSince = time
    state.livePeekEndedAt = Number.NEGATIVE_INFINITY
  }
  if (able) {
    const since = time - state.livePeekSince
    return {
      reach: smoothStep(since / 0.38),
      lift: smoothStep((since - 0.3) / 0.32),
    }
  }
  if (Number.isFinite(state.livePeekSince)) {
    const since = time - state.livePeekSince
    state.livePeekReleaseReach = smoothStep(since / 0.38)
    state.livePeekReleaseLift = smoothStep((since - 0.3) / 0.32)
    state.livePeekSince = Number.NEGATIVE_INFINITY
    state.livePeekEndedAt = time
  }
  if (!Number.isFinite(state.livePeekEndedAt) || !input.hasCards) return { reach: 0, lift: 0 }
  const after = time - state.livePeekEndedAt
  const lift = state.livePeekReleaseLift * (1 - smoothStep(after / 0.24))
  const reach = state.livePeekReleaseReach * (1 - smoothStep((after - 0.14) / 0.5))
  if (reach <= 0.001) state.livePeekEndedAt = Number.NEGATIVE_INFINITY
  return { reach, lift }
}

export function computeAvatarTargetPose(
  state: AvatarAnimatorState,
  input: AvatarAnimatorInput
): AvatarPose {
  const pose = emptyPose()
  const { bones } = pose
  const { time, anchors } = input
  const motion = input.reducedMotion ? 0 : 1
  const seed = state.seed

  // Transition bookkeeping.
  if (input.winner && !Number.isFinite(state.winnerSince)) state.winnerSince = time
  if (!input.winner) state.winnerSince = Number.NEGATIVE_INFINITY
  if (input.loser && !Number.isFinite(state.loserSince)) {
    state.loserSince = time
    state.loserStyle = state.random() > 0.5 ? 1 : 0
  }
  if (!input.loser) state.loserSince = Number.NEGATIVE_INFINITY
  if (input.folded && !Number.isFinite(state.foldedSince)) state.foldedSince = time
  if (!input.folded) state.foldedSince = Number.NEGATIVE_INFINITY
  if (input.acting && !Number.isFinite(state.actingSince)) {
    state.actingSince = time
    state.thinkingStyle = Math.floor(state.random() * 3) as 0 | 1 | 2
  }
  if (!input.acting) state.actingSince = Number.NEGATIVE_INFINITY
  if (input.tableHeat > state.lastHeat + 0.2) state.heatSince = time
  state.lastHeat = input.tableHeat

  // 1. Seated base: lean into the table, forearms resting on the rail.
  add(bones.Chest, 0.08, 0, 0)
  pose.handR = [...anchors.railR]
  pose.handL = [...anchors.railL]
  // Relaxed hands: fingers loosely curled, never flat mittens.
  pose.fingerCurlR = 0.32
  pose.fingerCurlL = 0.3

  // 2. Breathing and slow weight shifts keep every player alive.
  const breath = Math.sin(time * 1.3 + seed * 20) * motion
  add(bones.Chest, 0.018 * breath, 0, 0)
  add(bones.ShoulderR, 0, 0, 0.025 * breath)
  add(bones.ShoulderL, 0, 0, -0.025 * breath)
  add(bones.Head, -0.012 * breath, 0, 0)
  const shift = sway(time, seed) * motion
  add(bones.Torso, 0, 0.04 * shift, 0.03 * shift)
  add(bones.Head, 0, -0.025 * shift, -0.02 * shift)
  pose.handR[1] += 0.01 * breath
  pose.handL[1] += 0.01 * breath

  // 3. Attention: follow the acting player, otherwise glance around the table.
  const someoneElseActing = Math.abs(input.lookYaw) > 0.001 || input.lookPitch > -0.03
  if (time >= state.nextGlanceAt) {
    const roll = state.random()
    if (roll < 0.34) {
      state.glanceYaw = (state.random() - 0.5) * 0.3
      state.glancePitch = 0.22
    } else if (roll < 0.58 && input.hasCards && !input.folded) {
      state.glanceYaw = 0.04
      state.glancePitch = 0.36
    } else {
      state.glanceYaw = (state.random() - 0.5) * 1.2
      state.glancePitch = -0.02 + state.random() * 0.08
    }
    state.nextGlanceAt = time + 1.4 + state.random() * 3
  }
  const followActor = someoneElseActing && !input.acting
  const yaw = followActor ? input.lookYaw * 1.2 : state.glanceYaw
  const pitch = followActor ? input.lookPitch : state.glancePitch
  add(bones.Neck, pitch * 0.35 * motion, yaw * 0.35 * motion, 0)
  add(bones.Head, pitch * 0.65 * motion, yaw * 0.65 * motion, yaw * -0.08 * motion)
  add(bones.Chest, 0, yaw * 0.12 * motion, 0)

  const actionPoseOptions = {
    actionKey: input.actionKey,
    playerId: input.playerId,
    wagerIntensity: input.wagerIntensity,
  }

  // 4. Idle card peeks: reach to the cards, lift the corners, look down.
  const canIdle = !input.acting && !input.cueActive && !input.folded && !input.winner && !input.loser && !input.passedOut
  if (canIdle && input.hasCards && time >= state.nextPeekAt && !Number.isFinite(state.peekStartedAt)) {
    state.peekStartedAt = time
  }
  if (Number.isFinite(state.peekStartedAt)) {
    const elapsed = time - state.peekStartedAt
    const peek = canIdle && input.hasCards ? envelope(elapsed, PEEK_DURATION, 0.5, 0.55) * motion : 0
    if (elapsed > PEEK_DURATION || !canIdle) {
      state.peekStartedAt = Number.NEGATIVE_INFINITY
      state.nextPeekAt = time + 6 + state.random() * 8
    }
    const lifted = smoothStep((elapsed - 0.45) / 0.35) * peek
    add(bones.Chest, 0.09, 0.02, 0, peek)
    add(bones.Head, 0.26, 0.03, 0, peek)
    blendTo(pose.handR, offset(anchors.cards, 0.1, 0.05 + 0.08 * lifted, 0.14), peek)
    blendTo(pose.handL, offset(anchors.cards, -0.16, 0.06 + 0.04 * lifted, 0.2), peek * 0.85)
    pose.fingerCurlR += 0.2 * peek
    pose.cardLift = lifted
  }

  // 5. Personality tells while idle.
  if (canIdle) {
    const cycle = positiveModulo(time + seed * 8.3, 7.2)
    const window = smoothStep((cycle - 4) / 0.4) * smoothStep((6.9 - cycle) / 0.4) * motion
    if (window > 0.001) {
      switch (input.idleTell) {
        case 'chip_shuffle': {
          const circle = time * 7 + seed
          blendTo(pose.handR, offset(anchors.railR, -0.08 + Math.cos(circle) * 0.05, 0.03, -0.12 + Math.sin(circle) * 0.04), window)
          add(bones.WristR, 0, 0.3 * Math.sin(circle), 0, window)
          add(bones.Head, 0.12, -0.08, 0, window)
          pose.fingerCurlR += 0.4 * window
          break
        }
        case 'table_drum': {
          const tap = Math.max(0, Math.sin(time * 16 + seed * 3))
          pose.handR[1] += 0.05 * tap * window
          add(bones.WristR, 0.35 * tap, 0, 0, window)
          add(bones.Head, 0, 0.06 * Math.sin(time * 2), 0, window)
          break
        }
        case 'card_peek':
          state.nextPeekAt = Math.min(state.nextPeekAt, time + 1)
          break
        default:
          break
      }
    }
  }

  // 6. Thinking while it's their turn: chin rest, chip riffle, or a lean-in stare.
  if (input.acting && !input.cueActive) {
    const think = smoothStep((time - state.actingSince) / 0.55)
    const tap = Math.max(0, Math.sin(time * 9 + seed * 5)) * motion
    switch (state.thinkingStyle) {
      case 0:
        add(bones.Chest, 0.12, -0.05, 0, think)
        add(bones.Head, 0.05, -0.06, 0.12, think)
        // Chin resting on a loose fist.
        blendTo(pose.handR, offset(anchors.chin, 0.02, -0.04 - 0.015 * tap, -0.04), think)
        add(bones.WristR, -0.35, 0, 0, think)
        pose.fingerCurlR = pose.fingerCurlR * (1 - think) + 0.85 * think
        break
      case 1: {
        const riffle = Math.sin(time * 11 + seed * 3) * motion
        add(bones.Chest, 0.1, 0.05, 0, think)
        add(bones.Head, 0.16, 0.04, 0, think)
        blendTo(pose.handR, offset(anchors.railR, -0.06, 0.04 + 0.02 * Math.abs(riffle), -0.16), think)
        add(bones.WristR, 0.1, 0.35 * riffle, 0.2 * riffle, think)
        pose.fingerCurlR += (0.3 + 0.3 * tap) * think
        break
      }
      default: {
        add(bones.Chest, 0.2, 0, 0, think)
        add(bones.Head, 0.06, 0.03 * Math.sin(time * 1.7) * motion, 0, think)
        const mid: Vec3 = [
          (anchors.railR[0] + anchors.railL[0]) / 2,
          (anchors.railR[1] + anchors.railL[1]) / 2 + 0.06,
          (anchors.railR[2] + anchors.railL[2]) / 2 - 0.05,
        ]
        blendTo(pose.handR, offset(mid, 0.08, 0.02 * tap, 0), think)
        blendTo(pose.handL, offset(mid, -0.08, 0, 0), think)
        pose.fingerCurlR += 0.5 * think
        pose.fingerCurlL += 0.5 * think
        break
      }
    }
    // Every few seconds, a sidelong glance down at their own chips.
    const glance = envelope(positiveModulo(time - state.actingSince - 1.2 + seed * 2, 3.4), 0.9, 0.18, 0.25) * think * motion
    if (glance > 0) {
      const stackYaw = Math.atan2(-anchors.stack[0], -anchors.stack[2])
      blendAxis(bones.Head, 1, stackYaw * 0.8, glance)
      add(bones.Head, 0.22 * glance, 0, 0)
    }
    pose.bodyPosition[2] -= 0.05 * think
  }

  // 6b. Really peeking (the player clicked their cards, or a bot glancing):
  // lean in, cup both hands round the near edge of the two cards, lift it,
  // and duck the head to look — then set the cards down and sit back.
  const livePeek = getLivePeekWeights(state, input)
  if (livePeek.reach > 0.001) {
    const reach = livePeek.reach * Math.max(motion, 0.6)
    const lift = livePeek.lift * Math.max(motion, 0.6)
    const wiggle = Math.sin(time * 5.3 + seed * 9) * 0.012 * lift * motion
    state.nextPeekAt = Math.max(state.nextPeekAt, time + 4)
    // A small lean and a look down: enough to read as "checking my cards"
    // from across the table without the face disappearing under the hat.
    add(bones.Torso, 0.03, 0, 0, reach)
    add(bones.Chest, 0.1, 0, 0, reach)
    // Face the cards: yaw back to centre, pitch down to look.
    bones.Neck[1] -= bones.Neck[1] * reach
    bones.Head[1] -= bones.Head[1] * reach
    bones.Neck[0] += (0.1 - bones.Neck[0]) * reach
    bones.Head[0] += (0.26 + 0.05 * lift - bones.Head[0]) * reach
    add(bones.Head, 0, 0, 0.05 * Math.sin(time * 0.9 + seed), lift)
    blendTo(pose.handR, offset(anchors.cards, 0.09, 0.03 + 0.085 * lift + wiggle, 0.13 - 0.035 * lift), reach)
    blendTo(pose.handL, offset(anchors.cards, -0.09, 0.03 + 0.085 * lift - wiggle, 0.13 - 0.035 * lift), reach)
    add(bones.WristR, -0.35 * lift, 0, 0.2, reach)
    add(bones.WristL, -0.35 * lift, 0, -0.2, reach)
    pose.fingerCurlR = pose.fingerCurlR + (0.62 - pose.fingerCurlR) * reach
    pose.fingerCurlL = pose.fingerCurlL + (0.62 - pose.fingerCurlL) * reach
    pose.cardLift = Math.max(pose.cardLift, lift)
  }

  // 7. The action itself, choreographed against real table spots: reach to
  // the chip stack, push chips to the bet line, knuckle-tap the felt, flick the
  // cards to the muck, or shove the whole stack in with both hands.
  if (input.cueActive) {
    const avatarPose = getSeatedAvatarActionPose(input.cue, input.cueElapsedMs, actionPoseOptions)
    add(bones.Chest, avatarPose.bodyRotation[0] * 1.6, avatarPose.bodyRotation[1] * 1.2, avatarPose.bodyRotation[2])
    add(bones.Head, avatarPose.headRotation[0] * 0.6, avatarPose.headRotation[1], avatarPose.headRotation[2])
    add(pose.bodyPosition, avatarPose.bodyPosition[0], avatarPose.bodyPosition[1], avatarPose.bodyPosition[2], 1.4)
    const t = clamp01(input.cueElapsedMs / 980)
    const rail = anchors.railR
    switch (input.cue) {
      case 'check': {
        // Wind up, two crisp knuckle taps on the felt (head nods with them), lift away.
        const reach = envelope(t, 1, 0.16, 0.22)
        const tap = Math.max(0, Math.sin(clamp01((t - 0.2) / 0.14) * Math.PI), Math.sin(clamp01((t - 0.42) / 0.14) * Math.PI))
        const cock = smoothStep(t / 0.18) * (1 - smoothStep((t - 0.2) / 0.08))
        const lift = smoothStep((t - 0.58) / 0.2) * (1 - smoothStep((t - 0.8) / 0.2))
        blendTo(pose.handR, offset(anchors.tap, 0, 0.12 + 0.05 * cock - 0.12 * tap + 0.06 * lift, 0.02 * lift), reach)
        add(bones.WristR, 0.55 * tap - 0.35 * cock - 0.2 * lift, 0, 0, reach)
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + reach
        add(bones.Head, 0.1 * reach + 0.07 * tap, 0, 0)
        add(bones.Chest, 0.05 * tap, 0, 0)
        break
      }
      case 'call':
      case 'bet':
      case 'raise': {
        // Anticipation (sit up, hand hovers over the stack) → take the chips →
        // push them out *with* the chips (which leave the stack ~0.25s in and
        // land ~0.95s in) → release with a little wrist flick → settle back.
        // A call slides a neat stack with a flat hand; bets grip and push with
        // a lean that grows with the size of the bet, and big raises bring
        // the second hand in too.
        const isCall = input.cue === 'call'
        const big = clamp01(input.wagerIntensity)
        const antic = envelope(t, 0.28, 0.1, 0.14) * motion
        const reach = smoothStep(t / 0.2)
        const push = smoothStep((t - 0.25) / 0.55)
        const release = smoothStep((t - 0.8) / 0.08)
        const back = smoothStep((t - 0.86) / 0.14)
        const flick = pulse(t, 0.8, 0.05, 0.14) * motion
        const hold = reach * (1 - back)
        const grabbed = offset(anchors.stack, 0, 0.04 + 0.08 * antic, 0.04)
        // Push a hand-length or two toward the bet line; the chips fly on.
        const toBetX = anchors.betSpot[0] - grabbed[0]
        const toBetZ = anchors.betSpot[2] - grabbed[2]
        const toBetLength = Math.hypot(toBetX, toBetZ) || 1
        const pushDistance = Math.min(toBetLength * 0.8, isCall ? 0.32 : 0.4 + 0.14 * big)
        const travel = pushDistance / toBetLength
        const path: Vec3 = [
          grabbed[0] + toBetX * travel * push,
          grabbed[1] + (isCall ? 0 : Math.sin(push * Math.PI) * 0.05) + 0.07 * release,
          grabbed[2] + toBetZ * travel * push + 0.05 * release,
        ]
        blendTo(pose.handR, path, hold)
        if (isCall) {
          // Flat hand behind the stack, palm down, fingers together.
          add(bones.WristR, -0.28, 0, 0, hold)
          pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + 0.1 * reach
        } else {
          add(bones.WristR, -0.2 * push - 0.45 * flick, 0, 0, hold)
          pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + (0.9 - 0.75 * release) * reach
        }
        const twoHands = isCall ? 0 : smoothStep((big - 0.5) / 0.25)
        if (twoHands > 0) {
          const fromL = offset(anchors.stack, -0.22, 0.04 + 0.06 * antic, 0.06)
          const pathL: Vec3 = [
            fromL[0] + (anchors.betSpot[0] - 0.12 - fromL[0]) * travel * push,
            path[1],
            fromL[2] + (anchors.betSpot[2] - fromL[2]) * travel * push + 0.05 * release,
          ]
          blendTo(pose.handL, pathL, hold * twoHands)
          pose.fingerCurlL = pose.fingerCurlL * (1 - twoHands * reach) + 0.2 * twoHands * reach
        }
        const drive = Math.sin(clamp01((t - 0.2) / 0.66) * Math.PI)
        const lean = isCall ? 0.12 : 0.16 + 0.2 * big
        add(bones.Chest, -0.06 * antic + lean * drive * (1 - back) + 0.03 * flick, 0.05 * drive * (1 - twoHands), 0)
        add(bones.Head, 0.04 * push * (1 - back) - 0.05 * antic, 0, 0)
        pose.bodyPosition[2] -= (isCall ? 0.04 : 0.06 + 0.08 * big) * drive
        if (input.cue === 'raise') {
          // Confident: chin up and a little head tilt as the chips land.
          add(bones.Head, -0.14 * release * (1 - back * 0.5), 0.1 * release * (1 - back), 0.06 * release * (1 - back))
        }
        void rail
        break
      }
      case 'all_in': {
        // Gather (a breath: lean back, arms open wide around the stack), then
        // both arms sweep the whole stack forward as the torso lunges, chin
        // up — a brief defiant hold — then sit back.
        const gather = envelope(t, 0.3, 0.1, 0.12) * motion
        const grip = smoothStep((t - 0.06) / 0.16)
        const shove = smoothStep((t - 0.22) / 0.32)
        const hold = smoothStep((t - 0.5) / 0.08)
        const settle = smoothStep((t - 0.84) / 0.16)
        const slam = pulse(t, 0.52, 0.05, 0.16) * motion
        add(bones.Chest, -0.16 * gather, 0, 0)
        add(bones.Head, -0.08 * gather, 0, 0)
        add(bones.ShoulderR, 0, 0, 0.08 * gather)
        add(bones.ShoulderL, 0, 0, -0.08 * gather)
        pose.bodyPosition[2] += 0.06 * gather
        // Hands start wide around the stack and converge as they sweep in.
        const toX = anchors.betSpot[0] - anchors.stack[0]
        const toZ = anchors.betSpot[2] - anchors.stack[2]
        const drive = shove * 0.88
        const spread = 0.26 - 0.12 * shove
        const sweepY = 0.04 + 0.06 * gather + 0.03 * Math.sin(shove * Math.PI)
        blendTo(pose.handR, offset(anchors.stack, spread + toX * drive, sweepY, 0.06 + toZ * drive), grip * (1 - settle))
        blendTo(pose.handL, offset(anchors.stack, -spread - 0.08 + toX * drive, sweepY, 0.06 + toZ * drive), grip * (1 - settle))
        add(bones.WristR, -0.25 * shove, 0, 0, 1 - settle)
        add(bones.WristL, -0.25 * shove, 0, 0, 1 - settle)
        pose.fingerCurlR = pose.fingerCurlR * (1 - grip) + 0.35 * grip * (1 - settle)
        pose.fingerCurlL = pose.fingerCurlL * (1 - grip) + 0.35 * grip * (1 - settle)
        // Lunge with the shove, chin up and hold.
        add(bones.Chest, (0.34 * shove + 0.06 * slam) * (1 - settle), 0, 0)
        add(bones.Neck, -0.1 * hold * (1 - settle), 0, 0)
        add(bones.Head, (0.06 * shove - 0.26 * hold) * (1 - settle), 0, 0)
        pose.bodyPosition[2] -= (0.2 * shove + 0.03 * slam) * (1 - settle)
        break
      }
      case 'fold': {
        // Pick up both cards, draw back, a wrist-snap toss toward the middle
        // with follow-through, then lean back and fold the arms. Facing a big
        // bet, a small disgusted head shake.
        const reach = smoothStep(t / 0.2)
        const cock = envelope(t, 0.4, 0.2, 0.06) * motion
        const flick = smoothStep((t - 0.34) / 0.1)
        const follow = pulse(t, 0.42, 0.06, 0.25) * motion
        const back = smoothStep((t - 0.55) / 0.35)
        const toward: Vec3 = [
          anchors.cards[0] + (anchors.board[0] - anchors.cards[0]) * 0.2,
          anchors.cards[1] + 0.14 + 0.05 * follow,
          anchors.cards[2] + (anchors.board[2] - anchors.cards[2]) * 0.2,
        ]
        blendTo(pose.handR, offset(anchors.cards, 0.06, 0.05 + 0.1 * cock, 0.1 + 0.1 * cock), reach * (1 - back))
        blendTo(pose.handR, toward, flick * (1 - back))
        add(bones.WristR, 0.5 * cock - 0.75 * flick - 0.3 * follow, 0, 0.3 * flick, 1 - back)
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + (0.75 - 0.65 * flick) * reach
        // Lean back into the folded-arms rest the fold state holds afterwards.
        blendTo(pose.handR, offset(anchors.chest, -0.2, -0.12, -0.16), back * 0.8)
        blendTo(pose.handL, offset(anchors.chest, 0.2, -0.16, -0.14), back * 0.8)
        add(bones.Chest, 0.08 * reach * (1 - back) + 0.04 * cock - 0.14 * back, -0.06 * back, 0)
        const disgust = clamp01((input.tableHeat - 0.2) / 0.4) * envelope(t - 0.5, 0.5, 0.08, 0.15) * motion
        add(bones.Head, 0.05 - 0.08 * back, -0.2 * back + 0.2 * Math.sin((t - 0.5) * 38) * disgust, 0.05 * back)
        pose.bodyPosition[2] += 0.07 * back
        break
      }
      default:
        break
    }
  }

  // 7b. New board cards: everyone glances at the board and leans in.
  const boardAge = input.boardRevealAge ?? Number.POSITIVE_INFINITY
  const boardLook = envelope(boardAge, 1.8, 0.2, 0.6) * motion
  if (boardLook > 0 && !input.passedOut) {
    const bx = anchors.board[0]
    const bz = anchors.board[2]
    const boardYaw = Math.atan2(-bx, -bz)
    add(bones.Neck, 0.1 * boardLook, 0.35 * boardYaw * boardLook, 0)
    add(bones.Head, 0.14 * boardLook, 0.55 * boardYaw * boardLook, 0)
    add(bones.Chest, 0.08 * boardLook, 0, 0)
    pose.bodyPosition[2] -= 0.05 * boardLook
  }

  // 7c. Big idles now and then: stretch, hands behind the head, knuckle crack, chip spin.
  if (canIdle && time >= state.nextBigIdleAt && !Number.isFinite(state.bigIdleStartedAt) && !Number.isFinite(state.peekStartedAt)) {
    state.bigIdleStartedAt = time
    state.bigIdleKind = Math.floor(state.random() * 4) as 0 | 1 | 2 | 3
  }
  if (Number.isFinite(state.bigIdleStartedAt)) {
    const elapsed = time - state.bigIdleStartedAt
    const duration = state.bigIdleKind === 1 ? 4.2 : 2.8
    const w = canIdle ? envelope(elapsed, duration, 0.5, 0.6) * motion : 0
    if (elapsed > duration || !canIdle) {
      state.bigIdleStartedAt = Number.NEGATIVE_INFINITY
      state.nextBigIdleAt = time + 16 + state.random() * 22
    }
    switch (state.bigIdleKind) {
      case 0: { // stretch: arms right up over the head, fingers reaching
        const reachUp = smoothStep((elapsed - 0.35) / 0.6) * w
        blendTo(pose.handR, offset(anchors.shoulderR, 0.06, 0.66 + 0.06 * reachUp, 0.08), w)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.06, 0.66 + 0.06 * reachUp, 0.08), w)
        aroundHead(pose.handR, w, 1)
        aroundHead(pose.handL, w, -1)
        pose.elbowUp = Math.max(pose.elbowUp, w)
        add(bones.Chest, -0.2, 0, 0, w)
        add(bones.Head, -0.2, 0, 0, w)
        pose.fingerCurlR *= 1 - w
        pose.fingerCurlL *= 1 - w
        break
      }
      case 1: // lean back, hands laced behind the head, elbows up and out
        blendTo(pose.handR, behindHead(anchors, 1), w)
        blendTo(pose.handL, behindHead(anchors, -1), w)
        aroundHead(pose.handR, w, 1)
        aroundHead(pose.handL, w, -1)
        pose.elbowUp = Math.max(pose.elbowUp, w)
        // Fingers loosely laced, not splayed, on the way up and back.
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.5 * w
        pose.fingerCurlL = pose.fingerCurlL * (1 - w) + 0.5 * w
        add(bones.Chest, -0.22, 0, 0, w)
        add(bones.Head, -0.08, 0.05, 0, w)
        pose.bodyPosition[2] += 0.1 * w
        break
      case 2: { // interlace and crack the knuckles
        const pushOut = Math.sin(clamp01((elapsed - 0.8) / 1.2) * Math.PI)
        // Fists pressed together knuckle to knuckle (never one hand through
        // the other), pushed out as the wrists roll.
        const mid = offset(anchors.chest, 0, -0.05, -0.28 - 0.14 * pushOut)
        blendTo(pose.handR, offset(mid, 0.085, 0, 0), w)
        blendTo(pose.handL, offset(mid, -0.085, 0, 0), w)
        add(bones.WristR, 0, 0, -0.45 * pushOut, w)
        add(bones.WristL, 0, 0, 0.45 * pushOut, w)
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.8 * w
        pose.fingerCurlL = pose.fingerCurlL * (1 - w) + 0.8 * w
        add(bones.Chest, 0.06, 0, 0, w)
        break
      }
      default: { // spin a chip on the felt by the stack
        const spin = Math.sin(elapsed * 14) * motion
        blendTo(pose.handR, offset(anchors.stack, -0.12, 0.06, 0.06), w)
        add(bones.WristR, 0.2, 0.5 * spin, 0, w)
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.5 * w
        add(bones.Head, 0.25, 0, 0, w)
        break
      }
    }
  }

  // 7d. Somebody else scooped the pot: some clap, some nod, some grumble.
  if (input.otherWinner && !input.winner && !input.loser && !input.passedOut) {
    if (!Number.isFinite(state.reactionSince)) {
      state.reactionSince = time + state.random() * 0.5
      state.reactionKind = Math.floor(state.random() * 3) as 0 | 1 | 2
    }
    const w = envelope(time - state.reactionSince, 2.4, 0.3, 0.6) * motion
    if (state.reactionKind === 0) {
      const clap = 0.5 + 0.5 * Math.sin((time - state.reactionSince) * 16)
      blendTo(pose.handR, offset(anchors.chest, 0.03 + 0.1 * clap, 0.05, -0.3), w)
      blendTo(pose.handL, offset(anchors.chest, -0.03 - 0.1 * clap, 0.05, -0.3), w)
      pose.fingerCurlR *= 1 - w
      pose.fingerCurlL *= 1 - w
    } else if (state.reactionKind === 1) {
      add(bones.Head, 0.12 * Math.sin((time - state.reactionSince) * 7), 0, 0, w)
    } else {
      add(bones.Head, 0.1, 0.25 * Math.sin((time - state.reactionSince) * 9), 0, w)
      add(bones.Chest, -0.08, 0, 0, w)
    }
  } else {
    state.reactionSince = Number.NEGATIVE_INFINITY
  }

  // 8. Folded: sit back and fold the arms, eyes drifting off the action.
  if (input.folded && !input.cueActive && !input.winner) {
    const settle = smoothStep((time - state.foldedSince) / 0.9)
    add(bones.Chest, -0.16, 0, 0, settle)
    add(bones.Torso, -0.06, 0.08, 0, settle)
    add(bones.Head, 0.1, -0.12, 0.04, settle)
    blendTo(pose.handR, offset(anchors.chest, -0.2, -0.12, -0.16), settle)
    blendTo(pose.handL, offset(anchors.chest, 0.2, -0.16, -0.14), settle)
    pose.fingerCurlR += 0.3 * settle
    pose.fingerCurlL += 0.3 * settle
    pose.bodyPosition[2] += 0.08 * settle
  }

  // 9. Big bet elsewhere: hands off the rail, lean back — "whoa".
  const heatElapsed = time - state.heatSince
  const startle = envelope(heatElapsed, 1.4, 0.14, 0.8) * input.tableHeat * motion
  if (startle > 0 && !input.acting && !input.cueActive) {
    add(bones.Chest, -0.16, 0, 0, startle)
    add(bones.Head, -0.14, 0, 0, startle)
    add(pose.handR, 0.06, 0.16, 0.12, startle)
    add(pose.handL, -0.06, 0.16, 0.12, startle)
    pose.bodyPosition[2] += 0.06 * startle
    pose.fingerCurlR *= 1 - 0.6 * startle
    pose.fingerCurlL *= 1 - 0.6 * startle
  }

  // 10. Lost the showdown: each loser reacts in their own time and way —
  // a facepalm, a slump into the chair, or a head-shaking shrug.
  if (input.loser) {
    const elapsed = time - state.loserSince - seed * 0.7
    const shake = envelope(elapsed, 1.3, 0.1, 0.5) * Math.sin(elapsed * 16) * motion
    const settle = smoothStep((elapsed - 0.5) / 0.7)
    const style = Math.floor(seed * 3) % 3
    if (style === 0) {
      add(bones.Head, 0.08 + 0.22 * settle, 0.1 * shake, 0)
      add(bones.Chest, 0.16 * settle, 0, 0)
      blendTo(pose.handR, offset(anchors.chin, 0.02, 0.2, -0.1), settle)
      pose.fingerCurlR = pose.fingerCurlR * (1 - settle) + 0.15 * settle
    } else if (style === 1) {
      add(bones.Head, 0.08, 0.24 * shake, 0)
      add(bones.Chest, -0.12 * settle, 0, 0)
      add(bones.Head, -0.16 * settle, 0, 0)
      add(pose.handR, 0.04, -0.14, 0.24, settle)
      add(pose.handL, -0.04, -0.14, 0.24, settle)
      pose.bodyPosition[2] += 0.08 * settle
    } else {
      const shrug = envelope(elapsed, 2.2, 0.3, 0.6)
      add(bones.Head, 0, 0.3 * shake, 0.12 * shrug)
      add(bones.ShoulderR, 0, 0, 0.18 * shrug)
      add(bones.ShoulderL, 0, 0, -0.18 * shrug)
      blendTo(pose.handR, offset(anchors.shoulderR, 0.28, -0.12, -0.3), shrug)
      blendTo(pose.handL, offset(anchors.shoulderL, -0.28, -0.12, -0.3), shrug)
      add(bones.WristR, 0, 0, -0.7 * shrug)
      add(bones.WristL, 0, 0, 0.7 * shrug)
      pose.fingerCurlR *= 1 - shrug
      pose.fingerCurlL *= 1 - shrug
    }
    // Then a long exhale and a slump: shoulders rise on the sigh, drop, and
    // the whole body sinks into the chair.
    const sigh = envelope(elapsed - 1.1, 1.3, 0.45, 0.7) * motion
    const slump = smoothStep((elapsed - 1.6) / 1.1)
    add(bones.Chest, -0.06 * sigh + 0.12 * slump, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.1 * sigh - 0.08 * slump)
    add(bones.ShoulderL, 0, 0, -0.1 * sigh + 0.08 * slump)
    add(bones.Head, 0.1 * slump, 0, 0.04 * slump)
    pose.handR[1] -= 0.03 * slump
    pose.handL[1] -= 0.03 * slump
    pose.bodyPosition[1] -= 0.04 * settle + 0.03 * slump
    pose.bodyPosition[2] += 0.05 * slump
  }

  // 11. Winner: a quick crouch of anticipation, pop up out of the seat into
  // their celebration, then settle back into a smug lean in the chair.
  if (input.winner) {
    // First rake the pot in with both arms (as the payout chips fly over),
    // then celebrate.
    const sinceWin = time - state.winnerSince
    const rakeW = envelope(sinceWin, WINNER_RAKE_SECONDS + 0.25, 0.22, 0.3) * motion
    if (rakeW > 0) {
      const pull = smoothStep((sinceWin - 0.3) / 0.65)
      const far: Vec3 = [
        anchors.cards[0] + (anchors.board[0] - anchors.cards[0]) * 0.3,
        anchors.cards[1] + 0.06,
        anchors.cards[2] + (anchors.board[2] - anchors.cards[2]) * 0.3,
      ]
      const near = offset(anchors.cards, 0, 0.06, 0.25)
      const sweep: Vec3 = [far[0] + (near[0] - far[0]) * pull, far[1], far[2] + (near[2] - far[2]) * pull]
      blendTo(pose.handR, offset(sweep, 0.2, 0, 0), rakeW)
      blendTo(pose.handL, offset(sweep, -0.2, 0, 0), rakeW)
      add(bones.WristR, 0.3, 0, 0, rakeW)
      add(bones.WristL, 0.3, 0, 0, rakeW)
      pose.fingerCurlR = pose.fingerCurlR * (1 - rakeW) + 0.5 * rakeW
      pose.fingerCurlL = pose.fingerCurlL * (1 - rakeW) + 0.5 * rakeW
      add(bones.Chest, 0.3 * (1 - pull * 0.6), 0, 0, rakeW)
      add(bones.Head, 0.12, 0, 0, rakeW)
      pose.bodyPosition[2] -= 0.12 * (1 - pull) * rakeW
    }
    const elapsed = sinceWin - WINNER_RAKE_SECONDS
    const antic = envelope(elapsed, 0.3, 0.08, 0.18) * motion
    const rise = smoothStep((elapsed - 0.1) / 0.3)
    const hop = Math.max(0, Math.sin(clamp01((elapsed - 0.12) / 0.45) * Math.PI)) * motion
    const lounge = smoothStep((elapsed - 3.2) / 1.2) * motion
    const beat = time * 6 + seed * 10
    add(bones.Chest, 0.14 * antic, 0, 0)
    add(bones.Head, 0.08 * antic, 0, 0)
    pose.bodyPosition[1] -= 0.05 * antic
    add(bones.Chest, -0.18, 0, 0, rise)
    add(bones.Head, -0.16, 0, 0, rise)
    switch (input.celebration) {
      case 'victory': {
        // Both arms up, a triumphant bounce, then hands laced behind the head.
        const up = rise * (1 - lounge)
        blendTo(pose.handR, offset(anchors.shoulderR, 0.22, 0.7 + 0.05 * Math.sin(beat) * motion, -0.08), up)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.22, 0.7 + 0.05 * Math.sin(beat + 1) * motion, -0.08), up)
        blendTo(pose.handR, behindHead(anchors, 1), lounge)
        blendTo(pose.handL, behindHead(anchors, -1), lounge)
        aroundHead(pose.handR, lounge, 1)
        aroundHead(pose.handL, lounge, -1)
        pose.elbowUp = Math.max(pose.elbowUp, lounge)
        add(bones.Head, 0.06 * Math.sin(beat * 0.5) * up * motion, 0, 0)
        pose.fingerCurlR = 0.12 + 0.3 * lounge
        pose.fingerCurlL = 0.12 + 0.3 * lounge
        break
      }
      case 'fist_pump': {
        // Snappy pumps: a quick punch up, a slower pull down, chest and head
        // driving with each one.
        const phase = positiveModulo(elapsed * 2.1 + seed, 1)
        const punch = (phase < 0.22 ? smoothStep(phase / 0.22) : 1 - smoothStep((phase - 0.22) / 0.78)) * motion
        const pumping = rise * (1 - lounge)
        blendTo(pose.handR, offset(anchors.shoulderR, 0.2, 0.3 + 0.42 * punch, -0.24), pumping)
        blendTo(pose.handR, behindHead(anchors, 1), lounge)
        blendTo(pose.handL, behindHead(anchors, -1), lounge)
        aroundHead(pose.handR, lounge, 1)
        aroundHead(pose.handL, lounge, -1)
        pose.elbowUp = Math.max(pose.elbowUp, lounge)
        blendTo(pose.handL, offset(anchors.chest, 0.08, -0.08, -0.26), pumping * 0.6)
        add(bones.Chest, 0.1 * punch * pumping, 0.06 * punch * pumping, 0)
        add(bones.Head, -0.08 * punch * pumping, 0, 0)
        add(bones.WristR, -0.3 * punch * pumping, 0, 0)
        pose.fingerCurlR = 1 - 0.6 * lounge
        pose.fingerCurlL = 0.6
        break
      }
      case 'slow_clap': {
        const clap = (0.5 + 0.5 * Math.sin(time * 5.4 + seed)) * motion
        // Hands meet out in front of the chest (never crossing).
        blendTo(pose.handR, offset(anchors.chest, 0.05 + 0.13 * clap, 0.16, -0.42), rise)
        blendTo(pose.handL, offset(anchors.chest, -0.05 - 0.13 * clap, 0.16, -0.42), rise)
        add(bones.Head, 0.05 * clap, 0, 0, rise)
        pose.fingerCurlR = 0.12
        pose.fingerCurlL = 0.12
        break
      }
      case 'wave':
      default: {
        const wave = Math.sin(time * 8) * motion
        // Arm up and out beside the head (not a salute), hand swinging.
        blendTo(pose.handR, offset(anchors.shoulderR, 0.44 + 0.12 * wave, 0.74, -0.16), rise * (1 - lounge * 0.5))
        add(bones.WristR, 0, 0, 0.4 * wave, rise)
        add(bones.Head, 0, 0, -0.06 * wave, rise)
        pose.fingerCurlR = 0.06
        break
      }
    }
    pose.bodyPosition[1] += 0.14 * rise * (1 - lounge) + 0.16 * hop
    pose.bodyPosition[2] += 0.08 * rise + 0.08 * lounge
    add(bones.Chest, -0.14 * lounge, 0, 0)
    add(bones.Torso, -0.06 * lounge, 0.05 * lounge, 0)
  }

  // 12. Drunkenness: a loose, circling sway that grows with every drink, a
  // head that lags behind the body, and hiccups once they are a few deep.
  const drunkLevel = input.drunkLevel ?? 0
  const drunk = clamp01(drunkLevel / 10)
  if (drunk > 0 && !input.passedOut) {
    const amp = Math.pow(drunk, 0.8) * motion
    const phase = time * (0.8 + drunk * 0.5) + seed * 9
    const swayX = Math.sin(phase)
    const swayZ = Math.cos(phase * 0.83 + 1.3)
    const lag = Math.sin(phase - 0.9)
    const loll = Math.sin(time * 1.35 + seed * 4)
    add(bones.Torso, 0.05 * swayZ * amp, 0.05 * swayX * amp, 0.17 * swayX * amp)
    add(bones.Chest, 0.06 * drunk, 0, 0.07 * lag * amp)
    add(bones.Neck, 0, 0, 0.08 * lag * amp)
    add(bones.Head, 0.07 * drunk + 0.06 * loll * amp, 0.1 * swayX * amp, 0.2 * lag * amp)
    pose.bodyPosition[0] += 0.03 * swayX * amp
    pose.handR[0] += 0.04 * swayX * amp
    pose.handL[0] += 0.04 * swayX * amp
    if (drunkLevel >= 3) {
      // A sharp hiccup: shoulders jump, head snaps back, then it all settles.
      const period = 4.6 - drunk * 1.6 + seed * 1.5
      const since = positiveModulo(time + seed * 13, period)
      const hiccup = (since < 0.07 ? since / 0.07 : Math.exp(-(since - 0.07) * 8)) * motion * (0.6 + 0.4 * drunk)
      add(bones.Chest, -0.12 * hiccup, 0, 0)
      add(bones.Head, -0.16 * hiccup, 0, 0)
      add(bones.ShoulderR, 0, 0, 0.14 * hiccup)
      add(bones.ShoulderL, 0, 0, -0.14 * hiccup)
      pose.bodyPosition[1] += 0.05 * hiccup
    }
  }

  // 13. Drinking: grab the glass, lift it to the mouth, tip the head back, set it down.
  if (input.drinkElapsed !== null && input.drinkElapsed !== undefined && !input.passedOut) {
    const elapsed = input.drinkElapsed
    const holding = envelope(elapsed, DRINK_SECONDS, 0.35, 0.35)
    const lift = smoothStep((elapsed - 0.35) / 0.45) * smoothStep((DRINK_SECONDS - 0.4 - elapsed) / 0.45)
    blendTo(pose.handR, offset(anchors.drinkRest, 0.02, 0.1, 0.04), holding)
    blendTo(pose.handR, offset(anchors.chin, 0.02, -0.12, -0.12), lift)
    add(bones.Head, -0.42 * lift, 0, 0)
    add(bones.Chest, -0.1 * lift, 0, 0)
    pose.fingerCurlR = pose.fingerCurlR * (1 - holding) + 0.85 * holding
    pose.drinkLift = lift
  }

  // 14. Passed out: forearms folded on the rail, head resting sideways on
  // them (cheek down), breathing slow and deep. Owns the whole body.
  if (input.passedOut) {
    for (const bone of ANIMATED_BONES) bones[bone] = [0, 0, 0]
    const breathe = Math.sin(time * 1.2 + seed * 7) * motion
    const midX = (anchors.railR[0] + anchors.railL[0]) / 2
    const railY = (anchors.railR[1] + anchors.railL[1]) / 2
    const railZ = (anchors.railR[2] + anchors.railL[2]) / 2
    const span = Math.abs(anchors.railR[0] - anchors.railL[0])
    bones.Torso = [0.45, 0, 0.03]
    bones.Chest = [0.7 + 0.035 * breathe, 0.04, 0.05]
    bones.Neck = [0.08, 0.12, 0.28]
    bones.Head = [0.02, 0.28, 0.85]
    bones.ShoulderR = [0, 0, 0.03 * breathe]
    bones.ShoulderL = [0, 0, -0.03 * breathe]
    // Wrists cross in front of the chest so the forearms stack on the rail.
    pose.handR = [midX - span * 0.2, railY + 0.05, railZ - 0.46]
    pose.handL = [midX + span * 0.62, railY + 0.08, railZ - 0.4]
    pose.fingerCurlR = 0.4
    pose.fingerCurlL = 0.4
    pose.elbowOut = 1
    // Slid down in the chair, folded over the rail.
    pose.bodyPosition = [0.02, -0.22 + 0.012 * breathe, -0.15]
    pose.bodyRotation = [0, 0, 0]
    pose.cardLift = 0
    pose.drinkLift = 0
    pose.middleFinger = 0
  }

  // 15. The flick-off: a wind-up, then the arm on the target's side shoots
  // out toward their face, back of the hand to them, middle finger up; head
  // and chest turn square to them, a jab accent, a readable hold, and a
  // relaxed return.
  if (input.flipOff && !input.passedOut) {
    const { elapsed, target } = input.flipOff
    const left = getFlipOffHand(target) === 'L'
    const mirror = left ? -1 : 1
    const w = envelope(elapsed, FLIP_OFF_SECONDS, 0.16, 0.6)
    const windup = envelope(elapsed, 0.42, 0.14, 0.26) * motion
    const extend = smoothStep((elapsed - 0.24) / 0.26) * smoothStep((FLIP_OFF_SECONDS - 0.3 - elapsed) / 0.5)
    const jab = (pulse(elapsed, 0.5, 0.08, 0.26) + 0.7 * pulse(elapsed, 1.45, 0.08, 0.26)) * motion
    const shake = Math.sin(elapsed * 17) * 0.012 * extend * motion
    const shoulder = left ? anchors.shoulderL : anchors.shoulderR
    const dx = target[0] - shoulder[0]
    const dy = target[1] - shoulder[1]
    const dz = target[2] - shoulder[2]
    const flat = Math.hypot(dx, dz) || 1
    const turn = Math.max(-1.35, Math.min(1.35, Math.atan2(-dx, -dz)))
    const aimPitch = Math.max(-0.25, Math.min(0.3, Math.atan2(dy, flat)))
    const reach = 0.72 + 0.07 * jab
    const goal: Vec3 = [
      shoulder[0] + (dx / flat) * reach * Math.cos(aimPitch),
      shoulder[1] + 0.08 + reach * Math.sin(aimPitch) + 0.03 * jab + shake,
      shoulder[2] + (dz / flat) * reach * Math.cos(aimPitch),
    ]
    const gestureHand = left ? pose.handL : pose.handR
    const braceHand = left ? pose.handR : pose.handL
    // Wind-up: the fist draws back beside the chest before it's thrown.
    const cocked = offset(anchors.chest, 0.14 * mirror, 0.02, -0.12)
    blendTo(gestureHand, cocked, windup * (1 - extend))
    blendTo(gestureHand, goal, extend * w)
    // The off hand braces on the rail.
    blendTo(braceHand, left ? anchors.railR : anchors.railL, w)
    blendAxis(bones.Torso, 1, turn * 0.22, w)
    blendAxis(bones.Chest, 1, turn * 0.38, w)
    blendAxis(bones.Neck, 1, turn * 0.2, w)
    blendAxis(bones.Head, 1, turn * 0.3, w)
    blendAxis(bones.Head, 0, -0.06 + 0.05 * jab, w)
    blendAxis(bones.Neck, 0, 0, w)
    add(bones.Chest, -0.06 * windup + 0.1 * jab, 0, 0, w)
    add(bones.Head, 0, 0, (0.1 * windup - 0.06 * extend) * mirror, w)
    add(left ? bones.ShoulderL : bones.ShoulderR, 0, 0, 0.1 * extend * mirror, w)
    if (left) pose.fingerCurlL = pose.fingerCurlL * (1 - w) + w
    else pose.fingerCurlR = pose.fingerCurlR * (1 - w) + w
    // The finger goes up as the arm is thrown and drops as it comes back.
    pose.middleFinger = w * smoothStep((elapsed - 0.18) / 0.22) * smoothStep((FLIP_OFF_SECONDS - 0.45 - elapsed) / 0.35)
    pose.bodyPosition[2] -= (0.05 * extend + 0.05 * jab) * w
  }

  // 16. Buy-a-shot: watch the glass slide in, grab it, throw it back with the
  // head snapping up, slam it upside down, then a full-body shudder.
  if (input.shotElapsed !== null && input.shotElapsed !== undefined && !input.passedOut && input.shotElapsed >= 0) {
    const e = input.shotElapsed
    const watch = smoothStep(e / 0.35) * (1 - smoothStep((e - SHOT_ARRIVE_AT) / 0.25))
    const reach = smoothStep((e - (SHOT_ARRIVE_AT - 0.15)) / 0.28) * (1 - smoothStep((e - SHOT_SLAM_AT - 0.2) / 0.4))
    const lift = smoothStep((e - (SHOT_MOUTH_AT - 0.24)) / 0.22) * (1 - smoothStep((e - SHOT_DOWN_AT) / 0.16))
    const tip = smoothStep((e - (SHOT_MOUTH_AT - 0.08)) / 0.14) * (1 - smoothStep((e - SHOT_DOWN_AT - 0.02) / 0.16))
    const slam = pulse(e, SHOT_SLAM_AT - 0.04, 0.06, 0.3) * motion
    const shudder = envelope(e - SHOT_SLAM_AT, SHOT_SHUDDER_END - SHOT_SLAM_AT, 0.08, 0.45)
    // Eyes down on the glass skidding toward them.
    add(bones.Head, 0.16 * watch, 0, 0)
    add(bones.Chest, 0.06 * watch, 0, 0)
    const glassSpot = offset(anchors.drinkRest, 0.02, 0.08, 0.02)
    blendTo(pose.handR, glassSpot, reach)
    // Glass to the lips (the chin anchor sits out in front of the face).
    blendTo(pose.handR, offset(anchors.chin, 0.05, -0.12, 0.08), lift)
    // Throw it back: head and chest tip well back while the glass is up.
    add(bones.Head, -0.62 * tip, 0, 0)
    add(bones.Neck, -0.22 * tip, 0, 0)
    add(bones.Chest, -0.16 * tip + 0.16 * slam, 0, 0)
    pose.bodyPosition[2] += 0.05 * tip - 0.05 * slam
    pose.handR[1] -= 0.04 * slam
    pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + 0.9 * reach
    // Brrr: a fast head shake, shoulders up around the ears, chin tucked.
    const buzz = Math.sin(e * 44) * motion
    add(bones.Head, 0.12 * shudder, 0.14 * buzz * shudder, 0.07 * Math.sin(e * 31) * shudder * motion)
    add(bones.Neck, 0.06 * shudder, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.18 * shudder)
    add(bones.ShoulderL, 0, 0, -0.18 * shudder)
    add(bones.Torso, 0, 0.05 * buzz * shudder, 0)
    blendTo(pose.handL, offset(anchors.chest, 0.02, 0.02, -0.18), shudder * 0.7)
    pose.fingerCurlL = pose.fingerCurlL * (1 - shudder) + shudder
    pose.drinkLift = Math.max(pose.drinkLift, tip)
    // Cheers: glass held high out over the table, a little clink bump, chin up.
    const raise = input.cheersRaise ?? 0
    if (raise > 0) {
      const clink = Math.sin(Math.min(1, raise) * Math.PI) * 0.04 * motion
      blendTo(pose.handR, offset(anchors.chest, 0.04, 0.46 + clink, -0.62 - clink), raise)
      add(bones.Head, -0.12 * raise, 0, 0)
      add(bones.Chest, 0.08 * raise, 0, 0)
      pose.bodyPosition[2] -= 0.06 * raise
    }
  }

  // 17. Chip flick (sender): hand cocks at the rail edge, fingers curled,
  // then the fingertip snaps at the chip while the head turns toward the mark.
  if (input.chipFlick && !input.passedOut) {
    const { elapsed: f, target } = input.chipFlick
    const w = envelope(f, CHIP_FLICK_GESTURE_SECONDS, 0.16, 0.4)
    const cock = smoothStep(f / 0.26) * (1 - smoothStep((f - CHIP_LAUNCH_AT + 0.02) / 0.05))
    const snap = pulse(f, CHIP_LAUNCH_AT - 0.03, 0.05, 0.3) * motion
    const shoulder = anchors.shoulderR
    const dx = target[0] - shoulder[0]
    const dz = target[2] - shoulder[2]
    const flat = Math.hypot(dx, dz) || 1
    const turn = Math.max(-1.2, Math.min(1.2, Math.atan2(-dx, -dz)))
    const flickSpot = offset(anchors.tap, 0.02, 0.1, 0.04)
    blendTo(pose.handR, flickSpot, w)
    add(pose.handR, (dx / flat) * 0.12 * snap, 0.04 * snap, (dz / flat) * 0.12 * snap, w)
    add(bones.WristR, -0.55 * cock + 0.9 * snap, 0, 0, w)
    pose.fingerCurlR = pose.fingerCurlR * (1 - w) + (0.95 * (1 - snap) + 0.05 * snap) * w
    blendAxis(bones.Head, 1, turn * 0.34, w)
    blendAxis(bones.Neck, 1, turn * 0.16, w)
    blendAxis(bones.Chest, 1, turn * 0.2, w)
    add(bones.Head, 0.08 * cock - 0.05 * snap, 0, 0, w)
    add(bones.Chest, 0.08 * w, 0, 0)
    pose.bodyPosition[2] -= 0.05 * w
  }

  // 18. Bonked by a chip: the head snaps back and away, shoulders jump, then
  // a hand comes up to rub the sore spot on top of the head.
  if (input.bonkElapsed !== null && input.bonkElapsed !== undefined && input.bonkElapsed >= 0 && !input.passedOut) {
    const b = input.bonkElapsed
    const flinch = pulse(b, 0, 0.05, 0.45) * motion
    const rub = envelope(b - 0.28, CHIP_BONK_REACT_SECONDS - 0.28, 0.3, 0.45)
    const circle = b * 10
    add(bones.Head, -0.38 * flinch, 0, 0.26 * flinch)
    add(bones.Neck, -0.12 * flinch, 0, 0.08 * flinch)
    add(bones.Chest, -0.1 * flinch, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.12 * flinch)
    add(bones.ShoulderL, 0, 0, -0.12 * flinch)
    pose.bodyPosition[2] += 0.07 * flinch
    const sore: Vec3 = offset(
      anchors.chin,
      0.1 + Math.cos(circle) * 0.035 * motion,
      0.2 + Math.sin(circle) * 0.02 * motion,
      0.2
    )
    blendTo(pose.handR, sore, rub)
    pose.fingerCurlR = pose.fingerCurlR * (1 - rub) + 0.2 * rub
    // Head bows into the rub, wincing side to side.
    add(bones.Head, 0.14 * rub, 0.06 * Math.sin(b * 5) * rub * motion, -0.08 * rub)
  }

  // 19. Blackout bonk: the passed-out slump above lands fast, the head bounces
  // off the rail once like a cartoon, then rests. (Owns nothing new: it only
  // adds the bounce to the slump.)
  if (input.passedOut && input.blackoutElapsed !== null && input.blackoutElapsed !== undefined) {
    const b = input.blackoutElapsed
    const bounce = pulse(b, 0.34, 0.07, 0.32) * motion
    const settle = pulse(b, 0.72, 0.06, 0.2) * motion
    bones.Chest[0] -= 0.34 * bounce + 0.08 * settle
    bones.Head[0] -= 0.3 * bounce + 0.06 * settle
    pose.bodyPosition[1] += 0.06 * bounce + 0.015 * settle
  }

  // 20. Coming to: sits back up dazed, the head circling slowly before it steadies.
  if (!input.passedOut && input.dazedElapsed !== null && input.dazedElapsed !== undefined && input.dazedElapsed >= 0) {
    const d = input.dazedElapsed
    const w = envelope(d, DAZED_SECONDS, 0.25, 0.9) * motion
    const circle = d * 5.2
    add(bones.Head, 0.1 * w + 0.12 * Math.sin(circle) * w, 0.16 * Math.cos(circle) * w, 0.18 * Math.sin(circle) * w)
    add(bones.Neck, 0.04 * w, 0, 0.06 * Math.sin(circle - 0.6) * w)
    add(bones.Torso, 0, 0, 0.08 * Math.sin(circle * 0.5) * w)
    pose.bodyPosition[1] -= 0.04 * w
  }

  // 21. Hungover: moves carefully, and every few seconds a hand comes up to
  // rub a temple with a wince.
  if (input.hungover && !input.passedOut) {
    const period = 7.5 + seed * 2
    const since = positiveModulo(time + seed * 17, period)
    const rub = envelope(since, 3.2, 0.5, 0.7) * motion
    const circle = since * 7
    const temple: Vec3 = offset(anchors.chin, 0.11 + Math.cos(circle) * 0.015 * motion, 0.16 + Math.sin(circle) * 0.015 * motion, 0.02)
    blendTo(pose.handR, temple, rub)
    pose.fingerCurlR = pose.fingerCurlR * (1 - rub) + 0.25 * rub
    add(bones.Head, 0.12 * rub, -0.08 * rub, -0.1 * rub)
    add(bones.Chest, 0.05, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.06 * rub)
  }

  // 22. Tripping: hands up in front of the face, turning slowly, head tilting
  // in wonder, the whole body swaying in slow circles.
  if (input.tripping && !input.passedOut) {
    const t = time * 0.9 + seed * 5
    const wonder = motion > 0 ? 0.75 + 0.25 * Math.sin(time * 0.37 + seed) : 0.8
    const turn = Math.sin(t) * motion
    blendTo(pose.handR, offset(anchors.chin, 0.12 + 0.04 * turn, 0.02 + 0.03 * Math.cos(t * 1.3) * motion, -0.24), wonder)
    blendTo(pose.handL, offset(anchors.chin, -0.12 + 0.04 * turn, -0.02 + 0.03 * Math.sin(t * 1.1) * motion, -0.22), wonder)
    add(bones.WristR, 0, 0.6 * turn, 0.4 * Math.cos(t) * motion, wonder)
    add(bones.WristL, 0, -0.6 * turn, -0.4 * Math.cos(t) * motion, wonder)
    pose.fingerCurlR = pose.fingerCurlR * (1 - wonder) + 0.05 * wonder
    pose.fingerCurlL = pose.fingerCurlL * (1 - wonder) + 0.05 * wonder
    const swayX = Math.sin(time * 0.7 + seed * 3) * motion
    const swayZ = Math.cos(time * 0.55 + seed * 2) * motion
    add(bones.Head, 0.06 + 0.08 * Math.sin(time * 0.5) * motion, 0.14 * turn, 0.22 * swayX)
    add(bones.Torso, 0.04 * swayZ, 0.05 * swayX, 0.12 * swayX)
    add(bones.Chest, -0.04, 0, 0.06 * swayZ)
    pose.bodyPosition[0] += 0.03 * swayX
  }

  // Keep faces visible: clamp the stacked downward pitch of neck + head, and
  // keep the body close to the chair no matter what stacks up.
  // Leaning in, people keep their eyes up: counter a deep chest lean at the head.
  if (!input.passedOut) bones.Head[0] -= Math.max(0, bones.Chest[0] - 0.15) * 0.8
  const totalPitch = bones.Neck[0] + bones.Head[0]
  const maxPitch = input.passedOut ? 0.9 : 0.34
  if (totalPitch > maxPitch) {
    const scale = maxPitch / totalPitch
    bones.Neck[0] *= scale
    bones.Head[0] *= scale
  }
  bones.Chest[0] = Math.max(-0.45, Math.min(input.passedOut ? 1 : 0.4, bones.Chest[0]))
  for (let axis = 0; axis < 3; axis += 1) {
    pose.bodyPosition[axis] = Math.max(-0.3, Math.min(0.3, pose.bodyPosition[axis]!))
  }

  pose.fingerCurlR = clamp01(pose.fingerCurlR)
  pose.fingerCurlL = clamp01(pose.fingerCurlL)
  return pose
}

function writeChannels(pose: AvatarPose, out: number[]) {
  let index = 0
  for (const bone of ANIMATED_BONES) {
    const value = pose.bones[bone]
    out[index++] = value[0]
    out[index++] = value[1]
    out[index++] = value[2]
  }
  for (const value of [...pose.handR, ...pose.handL]) out[index++] = value
  out[index++] = pose.fingerCurlR
  out[index++] = pose.fingerCurlL
  for (const value of [...pose.bodyPosition, ...pose.bodyRotation]) out[index++] = value
  out[index++] = pose.cardLift
  out[index++] = pose.drinkLift
  out[index++] = pose.middleFinger
  out[index++] = pose.elbowOut
  out[index++] = pose.elbowUp
}

function readChannels(values: readonly number[]): AvatarPose {
  const pose = emptyPose()
  let index = 0
  for (const bone of ANIMATED_BONES) {
    pose.bones[bone] = [values[index++]!, values[index++]!, values[index++]!]
  }
  pose.handR = [values[index++]!, values[index++]!, values[index++]!]
  pose.handL = [values[index++]!, values[index++]!, values[index++]!]
  pose.fingerCurlR = values[index++]!
  pose.fingerCurlL = values[index++]!
  pose.bodyPosition = [values[index++]!, values[index++]!, values[index++]!]
  pose.bodyRotation = [values[index++]!, values[index++]!, values[index++]!]
  pose.cardLift = values[index++]!
  pose.drinkLift = values[index++]!
  pose.middleFinger = values[index++]!
  pose.elbowOut = values[index++]!
  pose.elbowUp = values[index++]!
  return pose
}

const scratchTarget: number[] = new Array(CHANNEL_COUNT).fill(0)

/**
 * Advances the animator and returns the smoothed pose. Action cues use a stiff
 * spring so chip pushes stay crisp; everything else settles more softly.
 */
export function updateAvatarAnimator(
  state: AvatarAnimatorState,
  input: AvatarAnimatorInput
): AvatarPose {
  const target = computeAvatarTargetPose(state, input)
  writeChannels(target, scratchTarget)

  if (input.reducedMotion || !state.initialized) {
    state.springs.forEach((spring, index) => {
      spring.value = scratchTarget[index]!
      spring.velocity = 0
    })
    state.initialized = true
    return target
  }

  // Semi-implicit spring integration with fixed substeps: unconditionally
  // stable at any frame rate (a slow frame can never launch an avatar).
  // Flick-offs and hiccups need snap; passing out sinks slowly.
  const prankActive = Boolean(input.chipFlick) ||
    (input.shotElapsed !== null && input.shotElapsed !== undefined) ||
    (input.bonkElapsed !== null && input.bonkElapsed !== undefined)
  // The blackout lands fast (a bonk, not a slow sink).
  const bonking = input.passedOut && input.blackoutElapsed !== null && input.blackoutElapsed !== undefined && input.blackoutElapsed < 1.1
  const omega = input.cueActive || bonking ? 18 : input.flipOff || prankActive ? 14 : input.winner ? 12 : input.passedOut ? 5 : 9

  const dt = Math.min(0.1, Math.max(0.0001, input.delta))
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  const values: number[] = new Array(CHANNEL_COUNT)
  state.springs.forEach((spring, index) => {
    const goal = scratchTarget[index]!
    // Spine and body settle with a little overshoot for weight; hands track tightly.
    const zeta = index < 6 || (index >= BODY_CHANNEL_START && index < BODY_CHANNEL_START + 3) ? 0.62 : 0.95
    for (let step = 0; step < steps; step += 1) {
      const acceleration = -2 * zeta * omega * spring.velocity - omega * omega * (spring.value - goal)
      spring.velocity += acceleration * h
      spring.value += spring.velocity * h
    }
    if (!Number.isFinite(spring.value)) {
      spring.value = goal
      spring.velocity = 0
    }
    values[index] = spring.value
  })
  return readChannels(values)
}
