import type { PlayerAvatarCelebration, PlayerAvatarIdleTell } from '@/lib/profile'
import {
  getOpponentTableActionPose,
  getSeatedAvatarActionPose,
  type Vec3,
} from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'

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
const CHANNEL_COUNT = BONE_CHANNELS + 3 + 3 + 2 + 3 + 3 + 1 + 1 + 1
export const FLIP_OFF_SECONDS = 2.4
const DRINK_SECONDS = 2.6
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
  }
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
  pose.fingerCurlR = 0.3
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
  const canIdle = !input.acting && !input.cueActive && !input.folded && !input.winner && !input.loser
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
    add(bones.Chest, 0.14, 0.02, 0, peek)
    add(bones.Head, 0.36, 0.03, 0, peek)
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
        blendTo(pose.handR, offset(anchors.chin, 0.02, -0.02 - 0.015 * tap, -0.04), think)
        pose.fingerCurlR += 0.45 * think
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
    pose.bodyPosition[2] -= 0.05 * think
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
        // Two crisp knuckle taps on the felt in front of the cards.
        const reach = envelope(t, 1, 0.16, 0.22)
        const tap = Math.max(0, Math.sin(clamp01((t - 0.18) / 0.16) * Math.PI), Math.sin(clamp01((t - 0.4) / 0.16) * Math.PI))
        blendTo(pose.handR, offset(anchors.tap, 0, 0.1 - 0.1 * tap, 0), reach)
        add(bones.WristR, 0.5 * tap, 0, 0, reach)
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + reach
        add(bones.Head, 0.12 * reach, 0, 0)
        break
      }
      case 'call':
      case 'bet':
      case 'raise': {
        // Reach → grab from the stack → slide to the bet line → release → return.
        const reach = smoothStep(t / 0.22)
        const push = smoothStep((t - 0.25) / 0.4)
        const release = smoothStep((t - 0.68) / 0.12)
        const back = smoothStep((t - 0.8) / 0.2)
        const grabbed = offset(anchors.stack, 0, 0.04, 0.02)
        const pushed: Vec3 = [
          grabbed[0] + (anchors.betSpot[0] - grabbed[0]) * 0.8,
          grabbed[1] + Math.sin(push * Math.PI) * 0.06,
          grabbed[2] + (anchors.betSpot[2] - grabbed[2]) * 0.8,
        ]
        const path: Vec3 = [
          grabbed[0] + (pushed[0] - grabbed[0]) * push,
          grabbed[1] + (pushed[1] - grabbed[1]) * push + 0.05 * release,
          grabbed[2] + (pushed[2] - grabbed[2]) * push,
        ]
        blendTo(pose.handR, path, reach * (1 - back))
        add(bones.WristR, -0.2 * push, 0, 0, reach * (1 - back))
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + (0.95 - 0.8 * release) * reach
        add(bones.Chest, 0.16 * push * (1 - back), 0, 0)
        add(bones.Head, 0.1 * push * (1 - back), 0, 0)
        if (input.cue === 'raise') add(bones.Head, -0.08 * release * (1 - back), 0.1 * release * (1 - back), 0)
        void rail
        break
      }
      case 'all_in': {
        // Both hands wrap the stack and shove it in, then a palms-up "I'm in".
        const grip = smoothStep(t / 0.2)
        const shove = smoothStep((t - 0.2) / 0.38)
        const flourish = smoothStep((t - 0.62) / 0.18)
        const fromR = offset(anchors.stack, 0.14, 0.04, 0.06)
        const fromL = offset(anchors.stack, -0.18, 0.04, 0.06)
        const toX = anchors.betSpot[0] - anchors.stack[0]
        const toZ = anchors.betSpot[2] - anchors.stack[2]
        const drive = shove * 0.85
        blendTo(pose.handR, offset(fromR, toX * drive, 0.03 * Math.sin(shove * Math.PI), toZ * drive), grip * (1 - flourish))
        blendTo(pose.handL, offset(fromL, toX * drive, 0.03 * Math.sin(shove * Math.PI), toZ * drive), grip * (1 - flourish))
        blendTo(pose.handR, offset(anchors.shoulderR, 0.3, 0.05, -0.38), flourish)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.3, 0.05, -0.38), flourish)
        add(bones.WristR, 0, 0, -0.8 * flourish)
        add(bones.WristL, 0, 0, 0.8 * flourish)
        pose.fingerCurlR = 0.9 * grip * (1 - flourish)
        pose.fingerCurlL = 0.9 * grip * (1 - flourish)
        add(bones.Chest, 0.26 * shove * (1 - flourish) - 0.12 * flourish, 0, 0)
        add(bones.Head, -0.12 * flourish, 0, 0)
        pose.bodyPosition[2] -= 0.12 * shove * (1 - flourish)
        break
      }
      case 'fold': {
        // Pick up the cards, flick them toward the middle, sit back.
        const reach = smoothStep(t / 0.22)
        const flick = smoothStep((t - 0.28) / 0.18)
        const back = smoothStep((t - 0.6) / 0.3)
        const toward: Vec3 = [
          anchors.cards[0] + (anchors.board[0] - anchors.cards[0]) * 0.18,
          anchors.cards[1] + 0.12,
          anchors.cards[2] + (anchors.board[2] - anchors.cards[2]) * 0.18,
        ]
        blendTo(pose.handR, offset(anchors.cards, 0.06, 0.04, 0.08), reach * (1 - back))
        blendTo(pose.handR, toward, flick * (1 - back))
        add(bones.WristR, -0.6 * flick, 0, 0.3 * flick, 1 - back)
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + (0.8 - 0.7 * flick) * reach
        add(bones.Head, 0.05, -0.2 * back, 0)
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
      case 0: // stretch
        blendTo(pose.handR, offset(anchors.shoulderR, 0.1, 0.62, 0.05), w)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.1, 0.62, 0.05), w)
        add(bones.Chest, -0.2, 0, 0, w)
        add(bones.Head, -0.2, 0, 0, w)
        pose.fingerCurlR *= 1 - w
        pose.fingerCurlL *= 1 - w
        break
      case 1: // lean back, hands behind the head
        blendTo(pose.handR, offset(anchors.chin, 0.1, 0.22, 0.28), w)
        blendTo(pose.handL, offset(anchors.chin, -0.1, 0.22, 0.28), w)
        add(bones.Chest, -0.22, 0, 0, w)
        add(bones.Head, -0.08, 0.05, 0, w)
        pose.bodyPosition[2] += 0.1 * w
        break
      case 2: { // interlace and crack the knuckles
        const pushOut = Math.sin(clamp01((elapsed - 0.8) / 1.2) * Math.PI)
        const mid = offset(anchors.chest, 0, -0.05, -0.28 - 0.14 * pushOut)
        blendTo(pose.handR, offset(mid, 0.05, 0, 0), w)
        blendTo(pose.handL, offset(mid, -0.05, 0, 0), w)
        add(bones.WristR, 0, 0, -0.6 * pushOut, w)
        add(bones.WristL, 0, 0, 0.6 * pushOut, w)
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
    pose.bodyPosition[1] -= 0.04 * settle
  }

  // 11. Winner: pop up out of the seat into their celebration.
  if (input.winner) {
    const elapsed = time - state.winnerSince
    const rise = smoothStep(elapsed / 0.32)
    const hop = Math.max(0, Math.sin(Math.min(1, elapsed / 0.45) * Math.PI)) * motion
    const beat = time * 6 + seed * 10
    add(bones.Chest, -0.18, 0, 0, rise)
    add(bones.Head, -0.16, 0, 0, rise)
    switch (input.celebration) {
      case 'victory':
        blendTo(pose.handR, offset(anchors.shoulderR, 0.22, 0.72 + 0.04 * Math.sin(beat) * motion, -0.08), rise)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.22, 0.72 + 0.04 * Math.sin(beat + 1) * motion, -0.08), rise)
        pose.fingerCurlR = 0.1
        pose.fingerCurlL = 0.1
        break
      case 'fist_pump': {
        const pump = (0.5 + 0.5 * Math.sin(time * 9 + seed)) * motion
        blendTo(pose.handR, offset(anchors.shoulderR, 0.12, 0.34 + 0.24 * pump, -0.2), rise)
        add(bones.Chest, 0.06 * pump, 0, 0, rise)
        pose.fingerCurlR = 1
        break
      }
      case 'slow_clap': {
        const clap = (0.5 + 0.5 * Math.sin(time * 5.4 + seed)) * motion
        blendTo(pose.handR, offset(anchors.chest, 0.03 + 0.12 * clap, 0.14, -0.32), rise)
        blendTo(pose.handL, offset(anchors.chest, -0.03 - 0.12 * clap, 0.14, -0.32), rise)
        pose.fingerCurlR = 0.1
        pose.fingerCurlL = 0.1
        break
      }
      case 'wave':
      default:
        blendTo(pose.handR, offset(anchors.shoulderR, 0.34 + 0.12 * Math.sin(time * 8) * motion, 0.56, -0.1), rise)
        add(bones.WristR, 0, 0, 0.4 * Math.sin(time * 8) * motion, rise)
        pose.fingerCurlR = 0.05
        break
    }
    pose.bodyPosition[1] += 0.14 * rise + 0.16 * hop
    pose.bodyPosition[2] += 0.08 * rise
  }

  // 12. Drunkenness: a loose, growing sway, lolling head, and hiccups.
  const drunk = clamp01((input.drunkLevel ?? 0) / 10)
  if (drunk > 0 && !input.passedOut) {
    const wobble = Math.sin(time * (0.9 + drunk * 0.6) + seed * 9) * motion
    const loll = Math.sin(time * 1.35 + seed * 4) * motion
    add(bones.Torso, 0, 0.05 * wobble * drunk, 0.16 * wobble * drunk)
    add(bones.Chest, 0.06 * drunk, 0, 0.05 * loll * drunk)
    add(bones.Head, 0.08 * drunk + 0.06 * loll * drunk, 0.1 * wobble * drunk, 0.22 * loll * drunk)
    pose.handR[0] += 0.04 * wobble * drunk
    pose.handL[0] += 0.04 * wobble * drunk
    if ((input.drunkLevel ?? 0) >= 5) {
      const period = 3.2 + seed * 2
      const hiccup = Math.max(0, 1 - Math.abs(positiveModulo(time + seed * 13, period) - 0.1) / 0.12) * motion
      add(bones.Chest, -0.14 * hiccup, 0, 0)
      add(bones.Head, -0.18 * hiccup, 0, 0)
      pose.bodyPosition[1] += 0.05 * hiccup
    }
  }

  // 13. Drinking: grab the glass, lift it to the mouth, tip the head back, set it down.
  if (input.drinkElapsed !== null && input.drinkElapsed !== undefined && !input.passedOut) {
    const elapsed = input.drinkElapsed
    // Reach for the glass on the felt, raise it to the mouth, tip back, set it down.
    const holding = envelope(elapsed, DRINK_SECONDS, 0.35, 0.35)
    const lift = smoothStep((elapsed - 0.35) / 0.45) * smoothStep((DRINK_SECONDS - 0.4 - elapsed) / 0.45)
    blendTo(pose.handR, offset(anchors.drinkRest, 0.02, 0.1, 0.04), holding)
    blendTo(pose.handR, offset(anchors.chin, 0.02, -0.12, -0.12), lift)
    add(bones.Head, -0.42 * lift, 0, 0)
    add(bones.Chest, -0.1 * lift, 0, 0)
    pose.fingerCurlR = pose.fingerCurlR * (1 - holding) + 1 * holding
    pose.drinkLift = lift
  }

  // 14. Passed out: face-down on the rail, arms sprawled.
  if (input.passedOut) {
    add(bones.Chest, 0.75, 0, 0.05)
    add(bones.Torso, 0.3, 0, 0)
    add(bones.Neck, 0.3, 0.2, 0)
    add(bones.Head, 0.35, 0.25, 0.2)
    blendTo(pose.handR, offset(anchors.railR, 0.18, -0.04, -0.2), 1)
    blendTo(pose.handL, offset(anchors.railL, -0.18, -0.04, -0.2), 1)
    pose.fingerCurlR = 0.05
    pose.fingerCurlL = 0.05
    pose.bodyPosition[1] -= 0.08
    pose.bodyPosition[2] -= 0.08
  }

  // 15. The flick-off: turn to the target, raise the fist, pump it twice.
  if (input.flipOff && !input.passedOut) {
    const { elapsed, target } = input.flipOff
    const raise = envelope(elapsed, FLIP_OFF_SECONDS, 0.28, 0.4)
    const pump = (Math.max(0, Math.sin(Math.min(1, Math.max(0, (elapsed - 0.35) / 0.9)) * Math.PI * 2)) * 0.5) * motion
    const shoulder = anchors.shoulderR
    const dx = target[0] - shoulder[0]
    const dz = target[2] - shoulder[2]
    const length = Math.hypot(dx, dz) || 1
    const turn = Math.atan2(-dx, -dz)
    const reach = 0.36 + 0.12 * pump
    const goal: Vec3 = [
      shoulder[0] + (dx / length) * reach,
      shoulder[1] + 0.18 + 0.08 * pump,
      shoulder[2] + (dz / length) * reach,
    ]
    blendTo(pose.handR, goal, raise)
    add(bones.Chest, -0.06, turn * 0.3, 0, raise)
    add(bones.Head, -0.1, turn * 0.45, 0.12, raise)
    add(bones.WristR, -0.3, 0, 0, raise)
    pose.fingerCurlR = pose.fingerCurlR * (1 - raise) + raise
    pose.middleFinger = raise
    pose.bodyPosition[2] -= 0.05 * pump * raise
  }

  // Keep faces visible: clamp the stacked downward pitch of neck + head, and
  // keep the body close to the chair no matter what stacks up.
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
  const omega = input.cueActive ? 18 : input.winner ? 12 : 9
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
