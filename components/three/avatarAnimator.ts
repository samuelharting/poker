import type { PlayerAvatarCelebration, PlayerAvatarIdleTell } from '@/lib/profile'
import {
  getOpponentTableActionPose,
  getPokerActionMotionProfile,
  getSeatedAvatarActionPose,
  type Vec3,
} from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'
import type { DealerPose } from './dealerDeal'
import {
  blendHandShape,
  createAvatarHandsState,
  createHandTarget,
  getHandLab,
  resetHandTarget,
  type AvatarHandsState,
  type HandShapeId,
  type HandTarget,
} from './avatarHands'
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
import {
  computeSocialReactions,
  createReactionState,
  nervousDrumRate,
  pickWinnerReaction,
  type AvatarSocialInput,
  type ReactionState,
} from './avatarReactions'
import { chatLaughAmount, chatTalkAmount, chatWeight, listenerNod, speechBeat, yawnAmount, type TableChat } from './tableTalk'

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
  /**
   * Unsmoothed hand-shape targets (owned by the animator state; avatarHands
   * springs every finger toward them, so they are not smoothed twice).
   */
  handShapeR: HandTarget
  handShapeL: HandTarget
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
  /**
   * Hand frames: [weight, yaw, pitch, roll] relative to palm-down with the
   * fingers toward the table. Yaw turns the fingers in toward the body's
   * midline, pitch raises them, roll turns the palm toward the midline. Weight
   * 0 leaves the hand in its natural relaxed frame (see avatarBodyArms).
   */
  frameR: number[]
  frameL: number[]
  /** 0..1 the hand is deliberately taking chips from the personal stack (no stack clearance). */
  stackGrip: number
  /**
   * 0..1 the wrist targets are laid out around the resting head and must be
   * carried along with the live one (head in hands), without raising the elbows.
   */
  headFollow: number
  /** True when the pose was not smoothed (reduced motion, first frame): the arm solve must not smooth either. */
  instant: boolean
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
  /**
   * The dealer's deal in progress (see dealerDeal.getDealerPose): hand targets,
   * wrist / head offsets and a finger mix for pitching cards. Null / absent
   * when this seat is not physically dealing.
   */
  dealing?: DealerPose | null
  /** Seconds since they blacked out (the head-bonk beat); null when not blacked out. */
  blackoutElapsed?: number | null
  /** Seconds since they came to from a blackout (dazed wobble); null when not dazed. */
  dazedElapsed?: number | null
  /** Hungover: rubs their temples now and then, winces, moves carefully. */
  hungover?: boolean
  /** On the pill trip: stares at their hands in wonder, swaying. */
  tripping?: boolean
  /**
   * Height of the personal chip stack's top above the felt (seat units): the
   * hand takes chips from the top of the stack instead of reaching into it.
   */
  stackHeight?: number
  /** What they wear on the head, for the fix-your-hat / push-up-your-glasses idle. */
  headwear?: 'hat' | 'glasses' | 'none'
  /** What this seat can see of the table's social moment (the hero's action, an all-in, the winner ...); see avatarReactions. */
  social?: AvatarSocialInput
  /**
   * This seat's part in an idle table-talk conversation (see tableTalk.ts), or null. The animator
   * decides whether the seat is free to take part (never while acting, peeking, drinking, flipping
   * someone off, winning, losing, passed out...) and reports it in state.chatOn.
   */
  chat?: TableChat | null
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
  /** How this loss is taken (picked when it lands; a bad beat after a big bet leans to head-in-hands). */
  loserStyle: number
  /** The beat after the winner's celebration: 0 lounge, 1 laugh back, 2 point at the pot, 3 pull-down fist pump. */
  winFlair: number
  nextBigIdleAt: number
  bigIdleStartedAt: number
  /** 0 stretch, 1 hands behind head, 2 knuckle crack, 3 chip spin, 4 chip riffle, 5 hand on the cards, 6 look round the room, 7 fix hat / glasses / scratch head. */
  bigIdleKind: number
  reactionSince: number
  reactionKind: number
  initialized: boolean
  /**
   * Calm-seat detail throttle: the target pose is rebuilt every other frame
   * (the springs still run every frame) and the skipped frame's time is owed.
   */
  skipTarget: boolean
  owedDelta: number
  handTargetR: HandTarget
  handTargetL: HandTarget
  /** Finger springs (see avatarHands.ts). */
  hands: AvatarHandsState
  /** Breath cycle (0..1), and the slow stance / posture drifts that come and go. */
  breathPhase: number
  stance: number
  stanceTarget: number
  nextShiftAt: number
  posture: number
  postureTarget: number
  nextPostureAt: number
  /** Small body reactions (laugh, shrug, head shake, sigh, nod) between the big idles. */
  nextMicroAt: number
  microStartedAt: number
  microKind: 0 | 1 | 2 | 3 | 4
  /** Social reaction memory (odds history, when a bad beat began, ...) and this frame's weights. */
  reactions: ReactionState
  /** Output: the seat is taking part in its table-talk conversation right now (the face talks, smiles or laughs with it). */
  chatOn: boolean
  /** Output: 0..1 how wide the yawn in the middle of the stretch big idle is (the face yawns with it). */
  yawn: number
  /** Spring stiffness, eased toward its per-situation goal so a gesture never starts with a jolt. */
  omega: number
  /** Reused every frame (no per-frame allocation). */
  smoothed: number[]
  outPose: AvatarPose | null
  targetPose: AvatarPose | null
}

/** Legacy finger curl that already corresponds to the relaxed hand shape. */
const HAND_REST_CURL = 0.15
const BONE_CHANNELS = ANIMATED_BONES.length * 3
/** Channel index of bodyPosition in writeChannels (after bones, hands and fingers). */
const BODY_CHANNEL_START = BONE_CHANNELS + 3 + 3 + 2
const HAND_R_CHANNEL = BONE_CHANNELS
const HAND_L_CHANNEL = BONE_CHANNELS + 3
const CHANNEL_COUNT = BONE_CHANNELS + 3 + 3 + 2 + 3 + 3 + 1 + 1 + 1 + 1 + 1 + 8 + 1 + 1
/** Wind-up, thrust + jab, a readable ~1.4s hold, and a relaxed return. */
export const FLIP_OFF_SECONDS = 3.2
const DRINK_SECONDS = 2.6
/** How long the dazed head-circling lasts after coming to from a blackout. */
export const DAZED_SECONDS = 2.6
/** Winners rake the pot toward themselves before celebrating. */
const WINNER_RAKE_SECONDS = 1.0
const PEEK_DURATION = 2.1
/** A server-driven peek reads on screen for at least this long, however short the tap. */
export const LIVE_PEEK_MIN_HOLD_SECONDS = 1.8
/** Big idles (see 7c): how many kinds, and how long each lasts. */
const BIG_IDLE_KINDS = 8
const BIG_IDLE_SECONDS = [2.8, 4.2, 2.8, 2.8, 3.2, 4.5, 3.4, 2.6] as const
/** Most the face may pitch down, summed over the spine (radians). */
const MAX_FACE_PITCH = 0.42

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
    loserStyle: 0,
    winFlair: 0,
    nextBigIdleAt: 8 + random() * 18,
    bigIdleStartedAt: Number.NEGATIVE_INFINITY,
    bigIdleKind: 0,
    reactionSince: Number.NEGATIVE_INFINITY,
    reactionKind: 0,
    initialized: false,
    skipTarget: (hash & 1) === 1,
    owedDelta: 0,
    handTargetR: createHandTarget(),
    handTargetL: createHandTarget(),
    hands: createAvatarHandsState((hash >>> 0) / 0x100000000),
    breathPhase: random(),
    stance: 0,
    stanceTarget: 0,
    nextShiftAt: 2 + random() * 5,
    posture: 0,
    postureTarget: 0,
    nextPostureAt: 4 + random() * 8,
    nextMicroAt: 9 + random() * 22,
    microStartedAt: Number.NEGATIVE_INFINITY,
    microKind: 0,
    reactions: createReactionState(),
    chatOn: false,
    yawn: 0,
    omega: 9,
    smoothed: new Array(CHANNEL_COUNT).fill(0),
    outPose: null,
    targetPose: null,
  }
}

const NEUTRAL_HAND_TARGET = createHandTarget()

function emptyPose(handShapeR: HandTarget = NEUTRAL_HAND_TARGET, handShapeL: HandTarget = NEUTRAL_HAND_TARGET): AvatarPose {
  const bones = {} as Record<AnimatedBone, Vec3>
  for (const bone of ANIMATED_BONES) bones[bone] = [0, 0, 0]
  return {
    bones,
    handR: [0, 0, 0],
    handL: [0, 0, 0],
    fingerCurlR: 0,
    fingerCurlL: 0,
    handShapeR,
    handShapeL,
    bodyPosition: [0, 0, 0],
    bodyRotation: [0, 0, 0],
    cardLift: 0,
    drinkLift: 0,
    middleFinger: 0,
    elbowOut: 0,
    elbowUp: 0,
    frameR: [0, 0, 0, 0],
    frameL: [0, 0, 0, 0],
    stackGrip: 0,
    headFollow: 0,
    instant: false,
  }
}

/**
 * Blends a hand frame toward a gesture (`weight` 0 keeps it, 1 replaces it).
 * Angles are weighted by how much of the frame each contributor owns, so a
 * gesture never blends from the meaningless zeros of an unused frame.
 */
export function blendFrame(frame: number[], weight: number, yawIn: number, pitch: number, rollIn: number) {
  const w = weight < 0 ? 0 : weight > 1 ? 1 : weight
  if (w <= 0) return
  const owned = frame[0]! * (1 - w)
  const total = owned + w
  frame[1] = (frame[1]! * owned + yawIn * w) / total
  frame[2] = (frame[2]! * owned + pitch * w) / total
  frame[3] = (frame[3]! * owned + rollIn * w) / total
  frame[0] = total
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

type Side = 'R' | 'L'

/** Crossfades a hand toward a named shape (see avatarHands). */
function handShape(pose: AvatarPose, side: Side, id: HandShapeId, weight: number) {
  blendHandShape(side === 'R' ? pose.handShapeR : pose.handShapeL, id, weight)
}

/** Blends a hand frame (yaw toward the midline, pitch up, roll palm-in) over the natural one. */
function handFrame(pose: AvatarPose, side: Side, weight: number, yawIn: number, pitch: number, rollIn: number) {
  blendFrame(side === 'R' ? pose.frameR : pose.frameL, weight, yawIn, pitch, rollIn)
}

/**
 * Scratch targets for offset(): a small ring, so building a frame's targets
 * allocates nothing. An offset() result is only ever used within a few lines
 * (never stored on the pose), far fewer than the ring holds.
 */
const OFFSET_RING = Array.from({ length: 64 }, (): Vec3 => [0, 0, 0])
let offsetCursor = 0

function offset(base: Vec3, x: number, y: number, z: number): Vec3 {
  const out = OFFSET_RING[offsetCursor]!
  offsetCursor = (offsetCursor + 1) & 63
  out[0] = base[0] + x
  out[1] = base[1] + y
  out[2] = base[2] + z
  return out
}

/**
 * Folded-arms wrist targets (seat space): arms crossed low and snug against
 * the stomach, right forearm on top of (higher and a touch in front of) the
 * left so they never pass through each other, each hand tucked in by the
 * opposite elbow. The chest anchor is measured in the upright rest pose; the
 * fold also sits back (bodyPosition) so the targets are pulled in to match.
 */
const FOLD_HAND_R = (anchors: AvatarAnchors): Vec3 => offset(anchors.chest, -0.21, -0.2, 0.05)
const FOLD_HAND_L = (anchors: AvatarAnchors): Vec3 => offset(anchors.chest, 0.21, -0.29, 0.1)

/**
 * Wrist target for hands laced behind the head. The chin anchor sits in front
 * of the face, so the target goes up and well back past the skull; the arm IK
 * raises the elbows (pose.elbowUp) so the forearms frame the head instead of
 * crossing the face.
 */
function behindHead(anchors: AvatarAnchors, side: 1 | -1, hat = false): Vec3 {
  // Wrists on the back of the skull, close to the midline so the fingers meet there (below any
  // hat brim: a hat lowers them), not on top of the head and not floating behind it; the
  // renderer carries the target along with the live head as the player leans back.
  return offset(anchors.chin, 0.1 * side, hat ? 0.1 : 0.19, 0.52)
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

/**
 * How far apart clapping hands are (0 = together, 1 = wide) over a beat: they
 * touch, swing open slowly, then come together fast (accelerating into the
 * clap), so each clap lands with a hit instead of a sine-wave wobble.
 */
export function slapClap(phase: number) {
  const p = positiveModulo(phase, 1)
  if (p < 0.12) return 0
  if (p < 0.72) return smoothStep((p - 0.12) / 0.6)
  const q = (p - 0.72) / 0.28
  return 1 - q * q
}

/** Rises over `attack`, holds, then falls over `release` within `duration`. */
function envelope(elapsed: number, duration: number, attack: number, release: number) {
  if (elapsed < 0 || elapsed > duration) return 0
  return Math.min(smoothStep(elapsed / attack), smoothStep((duration - elapsed) / release))
}

/** How far in front of the shoulder a relaxed forearm puts the wrist (seat units). */
const REST_REACH = 0.47
/**
 * Where the resting wrist may sit, measured in from the rail anchor (the
 * outer shoulder of the cushion; its crown is ~0.21 further in). The wrist
 * stays on the player's side of the crown so the hand lies flat over the top
 * of the padding instead of hanging down the inner slope toward the felt.
 */
const REST_WRIST_IN_MIN = 0.08
const REST_WRIST_IN_MAX = 0.17

/**
 * The resting hands everyone spends most of the game in: forearms on the
 * padded rail, wrists just behind its crown, elbows out a little to the
 * sides, palms down and fingers relaxed. Where the wrist lands comes from the
 * measured shoulder (every model's proportions), clamped onto the cushion.
 * Four relaxed styles plus per-player jitter (all by seed, so deterministic)
 * so the table never looks cloned; the hands never overlap.
 */
export function restingHands(anchors: AvatarAnchors, seed: number) {
  const right: Vec3 = [0, 0, 0]
  const left: Vec3 = [0, 0, 0]
  const style = writeRestingHands(anchors, seed, right, left)
  return { right, left, curlR: restCurl.R, curlL: restCurl.L, style }
}

/** The resting curls of the last writeRestingHands call. */
const restCurl = { R: 0.16, L: 0.15 }

function restJitter(seed: number, salt: number) {
  return (((seed * 9301 + salt * 49297) % 1) + 1) % 1 - 0.5
}

/** Per-style/per-player shifts apply after the clamp so they always show. */
function restWristZ(railZ: number, shoulder: Vec3, shift: number) {
  return Math.min(railZ - REST_WRIST_IN_MIN, Math.max(railZ - REST_WRIST_IN_MAX, shoulder[2] - REST_REACH)) - shift
}

/** restingHands without allocating: writes the wrists into `right` / `left`, the curls into restCurl, returns the style. */
function writeRestingHands(anchors: AvatarAnchors, seed: number, right: Vec3, left: Vec3) {
  const style = Math.floor(seed * 4) % 4
  const railZ = (anchors.railR[2] + anchors.railL[2]) / 2
  const railY = (anchors.railR[1] + anchors.railL[1]) / 2 - 0.02
  let rightX: number
  let leftX: number
  let rightFwd = 0
  let leftFwd = 0
  let curlR = 0.16
  let curlL = 0.15
  if (style === 0) {
    // Hands together: fingertips nearly meeting in front of the chest.
    rightX = 0.2
    leftX = -0.205
    curlR = 0.2
    curlL = 0.18
  } else if (style === 1) {
    // Asymmetric: the right hand a little further out on the cushion.
    rightX = 0.22
    leftX = -0.19
    rightFwd = 0.05
    leftFwd = -0.02
    curlR = 0.13
    curlL = 0.2
  } else if (style === 2) {
    // Relaxed apart, each forearm on the cushion.
    rightX = 0.24
    leftX = -0.23
    curlR = 0.12
    curlL = 0.14
  } else {
    // Leaning on the left forearm, right hand out wide.
    rightX = 0.26
    leftX = -0.18
    rightFwd = -0.02
    leftFwd = 0.04
    curlR = 0.17
    curlL = 0.12
  }
  right[0] = rightX + 0.02 * restJitter(seed, 1)
  right[1] = railY
  right[2] = restWristZ(railZ, anchors.shoulderR, rightFwd + 0.04 * restJitter(seed, 2))
  left[0] = leftX + 0.02 * restJitter(seed, 3)
  left[1] = railY
  left[2] = restWristZ(railZ, anchors.shoulderL, leftFwd + 0.04 * restJitter(seed, 4))
  restCurl.R = curlR
  restCurl.L = curlL
  return style
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
  // A quick tap on the owner's phone is over in under a second, which an
  // observer barely registers: keep the look on show for a minimum hold.
  const holdingMinimum = Number.isFinite(state.livePeekSince) && time - state.livePeekSince < LIVE_PEEK_MIN_HOLD_SECONDS
  const able = (Boolean(input.peeking) || holdingMinimum) && input.hasCards && !input.folded && !input.passedOut && !input.winner && !input.loser
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

/**
 * The rail-slap timeline (0 = hand up, 1 = on the rail): two strikes, each a
 * ~0.2s wind-up and a ~0.12s drop, then the hand stays down.
 */
function railSlap(elapsed: number) {
  const strike = (at: number) => {
    const local = elapsed - at
    if (local < 0 || local > 0.5) return 0
    if (local < 0.14) return smoothStep(local / 0.14)
    if (local < 0.26) return 1
    return 1 - smoothStep((local - 0.26) / 0.24)
  }
  const last = smoothStep((elapsed - 1.1) / 0.14)
  return Math.max(strike(0.5), strike(1.0) * (1 - last), last)
}

/**
 * How a loss is taken, picked when it lands: a bad beat (they had a lot in)
 * leans toward head-in-hands or a slap of the rail; otherwise the player's
 * habit (by seed) with some randomness so the same player varies hand to hand.
 */
function pickLoserStyle(state: AvatarAnimatorState, input: AvatarAnimatorInput): number {
  const roll = state.random()
  const badBeat = input.wagerIntensity >= 0.55
  if (badBeat) return roll < 0.55 ? 3 : roll < 0.8 ? 4 : Math.floor(state.seed * 3) % 3
  if (roll < 0.55) return Math.floor(state.seed * 3) % 3
  return roll < 0.7 ? 4 : roll < 0.8 ? 3 : Math.floor(roll * 30) % 3
}

/** The beat after the celebration, leaning on the player's celebration style. */
function pickWinFlair(state: AvatarAnimatorState, input: AvatarAnimatorInput): number {
  const roll = state.random()
  const habit = input.celebration === 'fist_pump' ? 3 : input.celebration === 'slow_clap' ? 2 : input.celebration === 'victory' ? 0 : 1
  // A big pot (they bet big, or the table was heated) favours the big beats:
  // the laugh or the pull-down.
  const bigPot = Math.max(input.wagerIntensity, input.tableHeat) >= 0.55
  if (bigPot && roll < 0.6) return roll < 0.3 ? 1 : 3
  return roll < 0.45 ? habit : Math.floor(roll * 97) % 4
}

/**
 * How far above the usual grab height the top of the personal stack is
 * (the grab height already clears about two chips; a tower is taken from
 * its plinth, not its crown).
 */
function stackLift(input: AvatarAnimatorInput) {
  const height = input.stackHeight ?? 0
  return Math.max(0, Math.min(0.42, height) - 0.07)
}

/** Zeroes a pooled pose in place (its arrays may have been swapped for fresh ones by a pose branch). */
function resetPose(pose: AvatarPose, shapeR: HandTarget, shapeL: HandTarget): AvatarPose {
  for (const bone of ANIMATED_BONES) pose.bones[bone].fill(0)
  pose.handR.fill(0)
  pose.handL.fill(0)
  pose.fingerCurlR = 0
  pose.fingerCurlL = 0
  pose.handShapeR = shapeR
  pose.handShapeL = shapeL
  pose.bodyPosition.fill(0)
  pose.bodyRotation.fill(0)
  pose.cardLift = 0
  pose.drinkLift = 0
  pose.middleFinger = 0
  pose.elbowOut = 0
  pose.elbowUp = 0
  pose.frameR.fill(0)
  pose.frameL.fill(0)
  pose.stackGrip = 0
  pose.headFollow = 0
  pose.instant = false
  return pose
}

/**
 * Is this seat free to chat right now? Never while acting, peeking, drinking, flipping someone
 * off, winning, losing or passed out, mid-prank, while the table is hot or reacting to a pot or
 * new board cards, or during one of its own idles (those finish first).
 */
function isFreeToChat(state: AvatarAnimatorState, input: AvatarAnimatorInput) {
  return !input.acting && !input.cueActive && !input.winner && !input.loser && !input.passedOut && !input.peeking &&
    !input.flipOff && !input.chipFlick && !input.dealing && !input.otherWinner && !input.tripping &&
    input.drinkElapsed == null && input.shotElapsed == null && input.bonkElapsed == null &&
    input.blackoutElapsed == null && input.dazedElapsed == null &&
    input.tableHeat < 0.3 && (input.boardRevealAge ?? Number.POSITIVE_INFINITY) > 2.2 &&
    !Number.isFinite(state.peekStartedAt) && !Number.isFinite(state.bigIdleStartedAt) && !Number.isFinite(state.microStartedAt) &&
    !Number.isFinite(state.livePeekSince) && !(input.time - state.livePeekEndedAt < 1)
}

/**
 * Builds the unsmoothed target pose. Pass `out` to reuse a pooled pose object
 * (the render loop does); without it a fresh pose is returned.
 */
export function computeAvatarTargetPose(
  state: AvatarAnimatorState,
  input: AvatarAnimatorInput,
  out?: AvatarPose
): AvatarPose {
  resetHandTarget(state.handTargetR)
  resetHandTarget(state.handTargetL)
  const pose = out ? resetPose(out, state.handTargetR, state.handTargetL) : emptyPose(state.handTargetR, state.handTargetL)
  const { bones } = pose
  const { time, anchors } = input
  const motion = input.reducedMotion ? 0 : 1
  const seed = state.seed

  // Transition bookkeeping.
  if (input.winner && !Number.isFinite(state.winnerSince)) {
    state.winnerSince = time
    state.winFlair = pickWinFlair(state, input)
  }
  if (!input.winner) state.winnerSince = Number.NEGATIVE_INFINITY
  if (input.loser && !Number.isFinite(state.loserSince)) {
    state.loserSince = time
    state.loserStyle = pickLoserStyle(state, input)
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

  // 1. Seated base: lean into the table, forearms resting on the rail. Each
  // player sits a little differently (deterministic by seed): how far they
  // lean, a slight slouch to one side, a habitual head tilt.
  const habit = (salt: number) => ((((seed * 7919 + salt * 104729) % 1) + 1) % 1) - 0.5
  add(bones.Chest, 0.08 + 0.07 * habit(1), 0.05 * habit(2), 0)
  add(bones.Torso, 0, 0, 0.05 * habit(3))
  add(bones.Head, 0.04 * habit(4), 0, 0.1 * habit(5))
  // Written into the pose's own arrays (no per-frame allocation).
  writeRestingHands(anchors, seed, pose.handR, pose.handL)
  const rest = { curlR: restCurl.R, curlL: restCurl.L }
  // (pose.handL is mutated in place below: keep the resting spot for gestures that return to it.)
  const restLx = pose.handL[0]
  const restLy = pose.handL[1]
  const restLz = pose.handL[2]
  // Relaxed hands: fingers loosely curled, never flat mittens.
  pose.fingerCurlR = rest.curlR
  pose.fingerCurlL = rest.curlL

  // 2. Breathing, weight shifts and posture changes keep every player alive.
  // The breath is a slow inhale and a longer exhale (not a sine), quicker and
  // deeper the more the player is worked up.
  const dt = Math.min(0.1, Math.max(0.0001, input.delta + state.owedDelta))
  state.owedDelta = 0
  const arousal = clamp01(0.1 + 0.6 * input.tableHeat + (input.acting ? 0.25 : 0) + (input.winner ? 0.3 : 0) + (input.loser ? 0.15 : 0))
  state.breathPhase = (state.breathPhase + dt * (0.21 + 0.05 * seed) * (1 + 0.8 * arousal)) % 1
  const inhale = state.breathPhase < 0.4
    ? smoothStep(state.breathPhase / 0.4)
    : 1 - smoothStep((state.breathPhase - 0.4) / 0.6)
  const breath = (inhale * 2 - 1) * motion
  const depth = 1 + 0.9 * arousal
  add(bones.Chest, 0.02 * breath * depth, 0, 0)
  add(bones.Torso, 0.006 * breath * depth, 0, 0)
  add(bones.ShoulderR, 0, 0, 0.03 * breath * depth)
  add(bones.ShoulderL, 0, 0, -0.03 * breath * depth)
  add(bones.Head, -0.012 * breath * depth, 0, 0)
  add(bones.Neck, -0.006 * breath * depth, 0, 0)
  const shift = sway(time, seed) * motion * 0.5
  add(bones.Torso, 0, 0.02 * shift, 0.015 * shift)
  add(bones.Head, 0, -0.012 * shift, -0.01 * shift)
  pose.handR[1] += 0.008 * breath * depth
  pose.handL[1] += 0.008 * breath * depth
  // Every few seconds the weight goes onto the other hip (a slow lateral roll,
  // the head levelling back against it), and now and then they settle back or
  // lean onto their forearms. Eased over a second or so, never a pop.
  if (time >= state.nextShiftAt) {
    state.stanceTarget = (state.random() * 2 - 1) * 0.9
    state.nextShiftAt = time + 6 + state.random() * 9
  }
  if (time >= state.nextPostureAt) {
    const roll = state.random()
    state.postureTarget = roll < 0.3 ? -0.9 : roll < 0.65 ? 0 : 0.75
    state.nextPostureAt = time + 9 + state.random() * 14
  }
  state.stance += (state.stanceTarget - state.stance) * (1 - Math.exp(-dt / 0.6))
  state.posture += (state.postureTarget - state.posture) * (1 - Math.exp(-dt / 0.9))
  const settleBody = motion * (input.acting || input.cueActive ? 0.35 : 1)
  const stance = state.stance * settleBody
  const posture = state.posture * settleBody
  add(bones.Torso, 0, 0.03 * stance, 0.045 * stance)
  add(bones.Chest, 0, 0, -0.02 * stance)
  add(bones.Head, 0, -0.015 * stance, -0.04 * stance)
  add(bones.ShoulderR, 0, 0, -0.03 * stance)
  add(bones.ShoulderL, 0, 0, -0.03 * stance)
  pose.bodyPosition[0] += 0.02 * stance
  add(bones.Chest, 0.06 * posture, 0, 0)
  add(bones.Torso, 0.025 * posture, 0, 0)
  add(bones.Head, -0.035 * posture, 0, 0)
  pose.bodyPosition[2] -= 0.025 * posture
  // Resting hands are never frozen: a slow, small drift of each wrist on the
  // padding (out of step with each other), like thumbs idly moving.
  const drift = motion * 0.012
  pose.handR[0] += drift * Math.sin(time * 0.43 + seed * 17)
  pose.handR[2] += drift * Math.sin(time * 0.31 + seed * 5)
  pose.handL[0] += drift * Math.sin(time * 0.37 + seed * 13 + 1.7)
  pose.handL[2] += drift * Math.sin(time * 0.29 + seed * 3 + 0.8)

  // Fingers never hold one shape: a slow loosening and tightening, out of
  // step per hand, plus a barely-there head float from incommensurate sines so
  // the idle never reads as a loop. Later poses blend over these values.
  pose.fingerCurlR += motion * (0.045 * Math.sin(time * 0.61 + seed * 11) + 0.02 * Math.sin(time * 1.7 + seed * 3))
  pose.fingerCurlL += motion * (0.045 * Math.sin(time * 0.53 + seed * 7 + 2.1) + 0.02 * Math.sin(time * 1.9 + seed * 5))
  add(bones.Head, 0.006 * Math.sin(time * 0.71 + seed * 9) * motion, 0.008 * Math.sin(time * 0.47 + seed * 4) * motion, 0.008 * Math.sin(time * 0.37 + seed * 2) * motion)

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
  // Dev review switch: window.__animQuiet = true stops the random idles (peeks,
  // big idles, fidgets, reactions) so a pose can be reviewed on its own.
  const quiet = process.env.NODE_ENV !== 'production' && Boolean((globalThis as { __animQuiet?: boolean }).__animQuiet)
  // Table talk (section 8b): decided up front because a seat in conversation sits out the random
  // idles (and an idle already under way delays the chat).
  state.yawn = 0
  const chat = input.chat ?? null
  const chatOn = chat !== null && motion > 0 && !quiet && isFreeToChat(state, input)
  state.chatOn = chatOn
  const canIdle = !quiet && !chatOn && !input.acting && !input.cueActive && !input.folded && !input.winner && !input.loser && !input.passedOut
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
    blendTo(pose.handR, offset(anchors.cards, 0.17, 0.09 + 0.08 * lifted, 0.14), peek)
    blendTo(pose.handL, offset(anchors.cards, -0.22, 0.1 + 0.04 * lifted, 0.2), peek * 0.85)
    pose.fingerCurlR += 0.2 * peek
    // Both hands cup the near corners, fingertips tucked under the edge.
    handShape(pose, 'R', 'peek', peek)
    handShape(pose, 'L', 'peek', peek * 0.85)
    handFrame(pose, 'R', peek, 0, -0.14, 0.08)
    handFrame(pose, 'L', peek * 0.85, 0, -0.14, 0.08)
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
          handShape(pose, 'R', 'pinch', window)
          handFrame(pose, 'R', window, 0.1, -0.3, 0.15)
          break
        }
        case 'table_drum': {
          const tap = Math.max(0, Math.sin(time * 16 + seed * 3))
          pose.handR[1] += 0.03 * tap * window
          add(bones.WristR, 0.2 * tap, 0, 0, window)
          pose.handShapeR.drum = Math.max(pose.handShapeR.drum, window)
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

  // 5b. Small fidgets every few seconds so nobody sits frozen: fingers
  // drumming, a hand shifting on the rail, leaning onto one forearm, a
  // shoulder roll. Which one and when is by seed and time (no state, cheap).
  if (canIdle && !Number.isFinite(state.peekStartedAt) && !Number.isFinite(state.bigIdleStartedAt)) {
    const period = 4.2 + seed * 3.4
    const clock = time + seed * 31
    const phase = positiveModulo(clock, period)
    const kind = Math.floor(positiveModulo(Math.floor(clock / period) * 7 + seed * 13, 4))
    const w = envelope(phase, 1.7, 0.35, 0.55) * motion
    if (w > 0.001) {
      if (kind === 0) {
        // Fingers drumming on the cushion, a ripple from index to pinky.
        pose.handShapeR.drum = Math.max(pose.handShapeR.drum, w)
        pose.handR[1] += 0.004 * Math.sin(time * 12.5 + seed) * w
      } else if (kind === 1) {
        // One hand lifts a touch and resettles a little further out on the
        // cushion (outward, so it never lands on the other hand).
        add(pose.handL, -0.03, 0.025, -0.03, w)
        pose.fingerCurlL += 0.15 * w
      } else if (kind === 2) {
        // Weight onto one forearm: the torso rolls and shifts over it.
        const lean = habit(6) > 0 ? 1 : -1
        add(bones.Torso, 0, 0.04 * lean, 0.06 * lean, w)
        add(bones.Head, 0, -0.04 * lean, -0.05 * lean, w)
        pose.bodyPosition[0] += 0.02 * lean * w
      } else {
        // Shoulder roll and a small neck stretch.
        const roll = Math.sin(phase * 3.4)
        add(bones.ShoulderR, 0, 0, 0.07 * roll, w)
        add(bones.ShoulderL, 0, 0, -0.07 * roll, w)
        add(bones.Head, -0.04, 0, 0.1 * Math.sin(phase * 1.8), w)
      }
    }
  }

  // 5c. Small body reactions between the big idles: a laugh, a shrug, a head
  // shake, a sigh, a nod. Body language only (faces are the face rig's job).
  if (canIdle && !Number.isFinite(state.peekStartedAt) && !Number.isFinite(state.bigIdleStartedAt) &&
      !Number.isFinite(state.microStartedAt) && time >= state.nextMicroAt) {
    state.microStartedAt = time
    state.microKind = Math.floor(state.random() * 5) as 0 | 1 | 2 | 3 | 4
  }
  if (Number.isFinite(state.microStartedAt)) {
    const elapsed = time - state.microStartedAt
    const durations = [2.0, 1.7, 1.5, 2.4, 1.3] as const
    const duration = durations[state.microKind]
    const w = canIdle ? envelope(elapsed, duration, 0.28, 0.5) * motion : 0
    if (elapsed > duration || !canIdle) {
      state.microStartedAt = Number.NEGATIVE_INFINITY
      state.nextMicroAt = time + 14 + state.random() * 26
    }
    if (w > 0.001) {
      switch (state.microKind) {
        case 0: { // laugh: lean back, head thrown back, chest heaving, shoulders bouncing, a hand to the belly
          // The laugh fades as it goes (a burst, then chuckles), so the bounce decays too.
          const bounce = (Math.sin(elapsed * 15) * 0.5 + 0.5) * (1 - 0.45 * smoothStep((elapsed - 0.6) / 1.1))
          add(bones.Head, -0.4, 0.06 * Math.sin(elapsed * 6), 0.12 * Math.sin(elapsed * 4.2), w)
          add(bones.Chest, -0.2 + 0.09 * bounce, 0, 0, w)
          add(bones.Torso, -0.05, 0, 0, w)
          add(bones.Neck, 0.05 * bounce, 0, 0, w)
          add(bones.ShoulderR, 0, 0, 0.24 * bounce, w)
          add(bones.ShoulderL, 0, 0, -0.24 * bounce, w)
          // One hand comes off the rail to the belly; the other bounces on the cushion.
          const belly = seed > 0.5
          blendTo(belly ? pose.handL : pose.handR, offset(anchors.chest, belly ? -0.08 : 0.08, -0.3, 0.05), w * 0.9)
          handShape(pose, belly ? 'L' : 'R', 'loose', w * 0.8)
          handFrame(pose, belly ? 'L' : 'R', w * 0.9, 0.9, 0.2, 0.4)
          ;(belly ? pose.handR : pose.handL)[1] += 0.04 * bounce * w
          pose.bodyPosition[1] += 0.025 * bounce * w
          pose.bodyPosition[2] += 0.07 * w
          break
        }
        case 1: { // shrug: shoulders up round the ears, forearms and open palm-up hands lifted off the rail
          const rise = smoothStep(elapsed / 0.3) * (1 - smoothStep((elapsed - 1.1) / 0.4))
          add(bones.ShoulderR, 0, 0, 0.38, w * rise)
          add(bones.ShoulderL, 0, 0, -0.38, w * rise)
          add(bones.Head, 0.03, 0.06, 0.18, w)
          add(bones.Neck, 0, 0, 0.05, w * rise)
          add(bones.Chest, -0.06, 0, 0, w * rise)
          add(pose.handR, 0.12, 0.23, 0.08, w * rise)
          add(pose.handL, -0.12, 0.23, 0.08, w * rise)
          pose.bodyPosition[2] += 0.04 * w * rise
          handShape(pose, 'R', 'open', w * 0.9)
          handShape(pose, 'L', 'open', w * 0.9)
          pose.handShapeR.spread = Math.max(pose.handShapeR.spread, 0.25 * w)
          pose.handShapeL.spread = Math.max(pose.handShapeL.spread, 0.25 * w)
          handFrame(pose, 'R', w, -0.1, 0.5, 2.3)
          handFrame(pose, 'L', w, -0.1, 0.5, 2.3)
          break
        }
        case 2: { // head shake: a small no, decaying
          const decay = Math.exp(-elapsed * 1.5)
          add(bones.Head, 0.02, 0.3 * Math.sin(elapsed * 11) * decay, 0.03 * Math.sin(elapsed * 11 + 1), w)
          add(bones.Neck, 0, 0.06 * Math.sin(elapsed * 11 - 0.4) * decay, 0, w)
          add(bones.Chest, 0, 0.03 * Math.sin(elapsed * 11 - 0.9) * decay, 0, w)
          break
        }
        case 3: { // sigh: a long breath in, shoulders up, then out and slump
          const inn = envelope(elapsed, 1.0, 0.5, 0.4)
          const out = smoothStep((elapsed - 1.0) / 0.7)
          add(bones.Chest, -0.07 * inn + 0.05 * out, 0, 0, w)
          add(bones.ShoulderR, 0, 0, 0.1 * inn - 0.07 * out, w)
          add(bones.ShoulderL, 0, 0, -0.1 * inn + 0.07 * out, w)
          add(bones.Head, -0.04 * inn + 0.05 * out, 0, 0, w)
          pose.bodyPosition[1] -= 0.012 * out * w
          break
        }
        default: { // nod, twice
          const nod = Math.max(0, Math.sin(clamp01(elapsed / 1.0) * Math.PI * 2))
          add(bones.Head, 0.15 * nod, 0, 0, w)
          add(bones.Neck, 0.05 * nod, 0, 0, w)
          add(bones.Chest, 0.02 * nod, 0, 0, w)
          break
        }
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
        pose.fingerCurlR = pose.fingerCurlR * (1 - think) + 0.85 * think
        handShape(pose, 'R', 'loose', think)
        // Fingers curl toward the face, the knuckles under the chin.
        handFrame(pose, 'R', think, 0.55, 1.0, 1.25)
        break
      case 1: {
        const riffle = Math.sin(time * 11 + seed * 3) * motion
        add(bones.Chest, 0.1, 0.05, 0, think)
        add(bones.Head, 0.16, 0.04, 0, think)
        blendTo(pose.handR, offset(anchors.railR, -0.06, 0.04 + 0.02 * Math.abs(riffle), -0.16), think)
        add(bones.WristR, 0.1, 0.35 * riffle, 0.2 * riffle, think)
        pose.fingerCurlR += (0.3 + 0.3 * tap) * think
        // Thumb and fingers walking a chip.
        handShape(pose, 'R', 'pinch', think)
        handFrame(pose, 'R', think, 0.1, -0.3, 0.2)
        break
      }
      default: {
        add(bones.Chest, 0.2, 0, 0, think)
        add(bones.Head, 0.06, 0.03 * Math.sin(time * 1.7) * motion, 0, think)
        // Fists together on top of the cushion (the rail anchor already sits
        // a forearm above the padding), side by side rather than one inside
        // the other.
        const mid: Vec3 = [
          (anchors.railR[0] + anchors.railL[0]) / 2,
          (anchors.railR[1] + anchors.railL[1]) / 2 + 0.03,
          (anchors.railR[2] + anchors.railL[2]) / 2 - 0.12,
        ]
        blendTo(pose.handR, offset(mid, 0.125, 0.02 * tap, 0), think)
        blendTo(pose.handL, offset(mid, -0.125, 0, 0), think)
        pose.fingerCurlR += 0.5 * think
        pose.fingerCurlL += 0.5 * think
        handShape(pose, 'R', 'fist', think * 0.85)
        handShape(pose, 'L', 'fist', think * 0.85)
        // Fists side by side, knuckles up, thumbs on top.
        handFrame(pose, 'R', think, 0.1, 0.1, 0.9)
        handFrame(pose, 'L', think, 0.1, 0.1, 0.9)
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
    // Pitch is capped further down (the hat brim hides the face past it), so
    // the tell is carried by the whole body instead: shoulders lean in over the
    // cards, the head cocks to one side, and the elbows come up and out.
    add(bones.Torso, 0.04, 0, 0, reach)
    add(bones.Chest, 0.1, 0, 0, reach)
    pose.bodyPosition[2] -= 0.1 * reach
    pose.elbowOut = Math.max(pose.elbowOut, 0.4 * reach)
    // Face the cards: yaw back to centre, pitch down to look.
    bones.Neck[1] -= bones.Neck[1] * reach
    bones.Head[1] -= bones.Head[1] * reach
    bones.Neck[0] += (0.1 - bones.Neck[0]) * reach
    bones.Head[0] += (0.26 + 0.05 * lift - bones.Head[0]) * reach
    // A clear sideways head cock (a fixed side per seat, blended in absolutely so
    // the idle sway can't cancel it) over a slow drift.
    const cock = (seed < 0.5 ? 1 : -1) * 0.18 + 0.04 * Math.sin(time * 0.9 + seed)
    bones.Head[2] += (cock - bones.Head[2]) * lift
    blendTo(pose.handR, offset(anchors.cards, 0.15, 0.08 + 0.15 * lift + wiggle, 0.12 - 0.075 * lift), reach)
    blendTo(pose.handL, offset(anchors.cards, -0.15, 0.08 + 0.15 * lift - wiggle, 0.12 - 0.075 * lift), reach)
    add(bones.WristR, -0.45 * lift, 0, 0.2, reach)
    add(bones.WristL, -0.45 * lift, 0, -0.2, reach)
    pose.fingerCurlR = pose.fingerCurlR + (0.62 - pose.fingerCurlR) * reach
    pose.fingerCurlL = pose.fingerCurlL + (0.62 - pose.fingerCurlL) * reach
    // Cupped round the near edge; lifting the corner tips the wrists back.
    handShape(pose, 'R', 'peek', reach)
    handShape(pose, 'L', 'peek', reach)
    handShape(pose, 'R', 'card', lift * 0.7)
    handShape(pose, 'L', 'card', lift * 0.7)
    handFrame(pose, 'R', reach, 0.05, -0.12 + 0.28 * lift, 0.08)
    handFrame(pose, 'L', reach, 0.05, -0.12 + 0.28 * lift, 0.08)
    pose.cardLift = Math.max(pose.cardLift, lift)
  }

  // How far the fold cue has handed over to the folded-arms rest (section 8 draws it).
  let foldHandoff = 0
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
        blendTo(pose.handR, offset(anchors.tap, 0, 0.12 + 0.05 * cock - 0.12 * tap + 0.06 * lift, 0.2 + 0.02 * lift), reach)
        add(bones.WristR, 0.55 * tap - 0.35 * cock - 0.2 * lift, 0, 0, reach)
        pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + reach
        // Knuckle rap (a fist) or a two-finger tap, by the player's style; the
        // hand dips toward the felt on each tap and cocks back between them.
        const knuckles = getPokerActionMotionProfile('check', actionPoseOptions).checkStyle === 'knuckle'
        handShape(pose, 'R', knuckles ? 'fist' : 'tap', reach)
        handFrame(pose, 'R', reach, 0.05, -0.12 - 0.22 * tap + 0.16 * cock, 0)
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
        pose.stackGrip = Math.max(pose.stackGrip, hold)
        // The wrist rides just above the top chips (the fingers curl over the
        // front of the stack) instead of at the felt inside a tall stack.
        const lift = stackLift(input)
        const grabbed = offset(anchors.stack, 0, 0.04 + lift + 0.08 * antic, 0.04 + 0.3 * lift)
        // Push a hand-length or two toward the bet line; the chips fly on.
        const toBetX = anchors.betSpot[0] - grabbed[0]
        const toBetZ = anchors.betSpot[2] - grabbed[2]
        const toBetLength = Math.hypot(toBetX, toBetZ) || 1
        const pushDistance = Math.min(toBetLength * 0.8, isCall ? 0.32 : 0.4 + 0.14 * big)
        const travel = pushDistance / toBetLength
        const path: Vec3 = [
          grabbed[0] + toBetX * travel * push,
          // Once clear of the stack, down toward the felt as the chips slide out.
          grabbed[1] - lift * smoothStep((push - 0.45) / 0.45) + (isCall ? 0 : Math.sin(push * Math.PI) * 0.05) + 0.07 * release,
          grabbed[2] + toBetZ * travel * push + 0.05 * release,
        ]
        blendTo(pose.handR, path, hold)
        if (isCall) {
          // Flat hand behind the stack, palm down, fingers together.
          add(bones.WristR, -0.28, 0, 0, hold)
          pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + 0.1 * reach
          handShape(pose, 'R', 'flat', hold)
          handFrame(pose, 'R', hold, 0.04, 0.05 + 0.1 * push, 0)
        } else {
          add(bones.WristR, -0.2 * push - 0.45 * flick, 0, 0, hold)
          pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + (0.9 - 0.75 * release) * reach
          // Claw round the chips to push them out, then fingers spring open on the release.
          handShape(pose, 'R', 'grab', hold * (1 - release))
          handShape(pose, 'R', 'open', hold * release * 0.55)
          handFrame(pose, 'R', hold, 0.05, -0.08 + 0.22 * release, 0)
        }
        const twoHands = isCall ? 0 : smoothStep((big - 0.5) / 0.25)
        if (twoHands > 0) {
          const fromL = offset(anchors.stack, -0.26, 0.04 + 0.5 * lift + 0.06 * antic, 0.06)
          const pathL: Vec3 = [
            fromL[0] + (anchors.betSpot[0] - 0.12 - fromL[0]) * travel * push,
            path[1],
            fromL[2] + (anchors.betSpot[2] - fromL[2]) * travel * push + 0.05 * release,
          ]
          blendTo(pose.handL, pathL, hold * twoHands)
          pose.fingerCurlL = pose.fingerCurlL * (1 - twoHands * reach) + 0.2 * twoHands * reach
          handShape(pose, 'L', 'chipRest', hold * twoHands * (1 - release))
          handShape(pose, 'L', 'flat', hold * twoHands * release)
          handFrame(pose, 'L', hold * twoHands, -0.05, -0.05 + 0.15 * release, 0)
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
        pose.stackGrip = Math.max(pose.stackGrip, grip * (1 - smoothStep((t - 0.84) / 0.16)))
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
        // Wide enough to start outside the block's right-hand columns.
        const spread = 0.38 - 0.24 * shove
        const sweepY = 0.04 + 0.06 * gather + 0.03 * Math.sin(shove * Math.PI)
        blendTo(pose.handR, offset(anchors.stack, spread + toX * drive, sweepY, 0.06 + toZ * drive), grip * (1 - settle))
        blendTo(pose.handL, offset(anchors.stack, -spread - 0.08 + toX * drive, sweepY, 0.06 + toZ * drive), grip * (1 - settle))
        add(bones.WristR, -0.25 * shove, 0, 0, 1 - settle)
        add(bones.WristL, -0.25 * shove, 0, 0, 1 - settle)
        pose.fingerCurlR = pose.fingerCurlR * (1 - grip) + 0.35 * grip * (1 - settle)
        pose.fingerCurlL = pose.fingerCurlL * (1 - grip) + 0.35 * grip * (1 - settle)
        // Hands spread wide around the stack, claw in, then flat to sweep it forward.
        for (const side of ['R', 'L'] as const) {
          handShape(pose, side, 'open', gather * 0.8)
          handShape(pose, side, 'grab', grip * (1 - shove) * (1 - settle))
          handShape(pose, side, 'flat', shove * (1 - settle))
          handFrame(pose, side, grip * (1 - settle), 0.15, -0.05 + 0.1 * shove, 0)
        }
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
        // Fingers pinch the cards' edge, then spring open on the toss.
        handShape(pose, 'R', 'card', reach * (1 - flick) * (1 - back))
        handShape(pose, 'R', 'flickSnap', flick * (1 - back) * 0.9)
        handFrame(pose, 'R', reach * (1 - back), 0.1, -0.08 + 0.32 * cock - 0.42 * flick, 0.15)
        // Lean back into the folded-arms rest: section 8 draws it (the same pose the
        // fold state holds afterwards), so the end of the cue hands over without a pop.
        foldHandoff = back
        if (!input.folded) {
          // (Not marked folded yet: settle back toward the rail instead.)
          handShape(pose, 'R', 'loose', back * 0.5)
        }
        add(bones.Chest, 0.08 * reach * (1 - back) + 0.04 * cock, 0, 0)
        const disgust = clamp01((input.tableHeat - 0.2) / 0.4) * envelope(t - 0.5, 0.5, 0.08, 0.15) * motion
        add(bones.Head, 0.05 * (1 - back), 0.2 * Math.sin((t - 0.5) * 38) * disgust, 0)
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

  // 7c. Big idles now and then: stretch, hands behind the head, knuckle crack,
  // chip spin, riffling a chip, a hand resting on the cards, a look round the
  // room, fixing the hat or glasses. Picked at random per player (never the
  // same one twice running), each on its own clock so the table never syncs.
  if (canIdle && time >= state.nextBigIdleAt && !Number.isFinite(state.bigIdleStartedAt) &&
      !Number.isFinite(state.peekStartedAt) && !Number.isFinite(state.microStartedAt)) {
    state.bigIdleStartedAt = time
    let kind = Math.floor(state.random() * BIG_IDLE_KINDS)
    if (kind === state.bigIdleKind || (kind === 5 && (!input.hasCards || input.folded))) kind = Math.floor(state.random() * BIG_IDLE_KINDS)
    if (kind === 5 && (!input.hasCards || input.folded)) kind = 6
    state.bigIdleKind = kind
  }
  if (Number.isFinite(state.bigIdleStartedAt)) {
    const elapsed = time - state.bigIdleStartedAt
    const duration = BIG_IDLE_SECONDS[state.bigIdleKind] ?? 2.8
    const w = canIdle ? envelope(elapsed, duration, 0.5, 0.6) * motion : 0
    if (elapsed > duration || !canIdle) {
      state.bigIdleStartedAt = Number.NEGATIVE_INFINITY
      state.nextBigIdleAt = time + 12 + state.random() * 18
    }
    switch (state.bigIdleKind) {
      case 0: { // stretch: arms right up over the head, fingers reaching
        // ...with a wide yawn through the middle of it (the face rig reads state.yawn).
        state.yawn = yawnAmount(elapsed) * Math.min(1, w * 2)
        const reachUp = smoothStep((elapsed - 0.35) / 0.6) * w
        // (Reaching a little higher and wider in a hat, so the hands clear its crown and brim.)
        const hatLift = input.headwear === 'hat' ? 0.15 : 0
        const hatSpread = input.headwear === 'hat' ? 0.1 : 0
        blendTo(pose.handR, offset(anchors.shoulderR, 0.06 + hatSpread, 0.66 + hatLift + 0.06 * reachUp, 0.08), w)
        blendTo(pose.handL, offset(anchors.shoulderL, -0.06 - hatSpread, 0.66 + hatLift + 0.06 * reachUp, 0.08), w)
        aroundHead(pose.handR, w, 1)
        aroundHead(pose.handL, w, -1)
        pose.elbowUp = Math.max(pose.elbowUp, w)
        add(bones.Chest, -0.2, 0, 0, w)
        add(bones.Head, -0.2, 0, 0, w)
        pose.fingerCurlR *= 1 - w
        pose.fingerCurlL *= 1 - w
        // Fingers reaching for the ceiling, palms turned up and back: fingers
        // together and gently extended (a wide splay reads as an OK sign).
        handShape(pose, 'R', 'flat', w * 0.7)
        handShape(pose, 'L', 'flat', w * 0.7)
        handFrame(pose, 'R', w, -0.1, 1.3, 1.9)
        handFrame(pose, 'L', w, -0.1, 1.3, 1.9)
        break
      }
      case 1: { // lean back, hands laced behind the head, elbows up and out
        const hat = input.headwear === 'hat'
        blendTo(pose.handR, behindHead(anchors, 1, hat), w)
        blendTo(pose.handL, behindHead(anchors, -1, hat), w)
        aroundHead(pose.handR, w, 1)
        aroundHead(pose.handL, w, -1)
        pose.elbowUp = Math.max(pose.elbowUp, w)
        // Fingers loosely laced, not splayed, on the way up and back.
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.5 * w
        pose.fingerCurlL = pose.fingerCurlL * (1 - w) + 0.5 * w
        handShape(pose, 'R', 'grab', w * 0.85)
        handShape(pose, 'L', 'grab', w * 0.85)
        // Palms on the back of the head, fingers pointing up and in toward the other hand (tipped
        // inward under a hat's brim instead of up into it).
        handFrame(pose, 'R', w, 0.5, hat ? 0.85 : 1.3, 0.1)
        handFrame(pose, 'L', w, 0.5, hat ? 0.85 : 1.3, 0.1)
        add(bones.Chest, -0.22, 0, 0, w)
        add(bones.Head, -0.08, 0.05, 0, w)
        pose.bodyPosition[2] += 0.1 * w
        break
      }
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
        // Fingers laced (claws pressed together), palms turning out as they push.
        handShape(pose, 'R', 'grab', w)
        handShape(pose, 'L', 'grab', w)
        handFrame(pose, 'R', w, 0.05, 0.15, 1.35 - 1.1 * pushOut)
        handFrame(pose, 'L', w, 0.05, 0.15, 1.35 - 1.1 * pushOut)
        add(bones.Chest, 0.06, 0, 0, w)
        break
      }
      case 3: { // spin a chip on the felt by the stack
        const spin = Math.sin(elapsed * 14) * motion
        blendTo(pose.handR, offset(anchors.stack, -0.12, 0.06, 0.06), w)
        add(bones.WristR, 0.2, 0.5 * spin, 0, w)
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.5 * w
        handShape(pose, 'R', 'pinch', w)
        handFrame(pose, 'R', w, 0.1, -0.35, 0.2)
        add(bones.Head, 0.25, 0, 0, w)
        break
      }
      case 4: { // riffle a few chips beside the stack: quick wrist rolls, eyes on the table now and then
        const riffle = Math.sin(elapsed * 17 + seed * 5) * motion
        const bob = Math.abs(Math.sin(elapsed * 8.5 + seed)) * motion
        // Along the front (player's side) of the block, on the felt, the hand
        // turned to lie parallel to the chips: a hand deliberately at the stack.
        blendTo(pose.handR, offset(anchors.stack, -0.04, 0.03 + 0.04 * bob, 0.24), w)
        pose.stackGrip = Math.max(pose.stackGrip, w)
        add(bones.WristR, 0.15, 0.45 * riffle, 0.2 * riffle, w)
        add(bones.Chest, 0.08, 0.04, 0, w)
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + (0.45 + 0.1 * bob) * w
        handShape(pose, 'R', 'pinch', w)
        handFrame(pose, 'R', w, 0.9, -0.3, 0.2)
        // Riffling by feel: a glance down at the start, then back up to the table.
        add(bones.Head, 0.18 * (1 - smoothStep((elapsed - 1.2) / 0.6)), 0.05 * Math.sin(elapsed * 0.9), 0, w)
        break
      }
      case 5: { // card protection: a flat hand resting on the hole cards, the other on the rail
        const settle = smoothStep((elapsed - 0.2) / 0.8)
        // Palm on the cards, fingers over their far edge; a lean to reach.
        blendTo(pose.handR, offset(anchors.cards, 0.06, 0.07, 0.0), w)
        pose.handR[1] += 0.004 * Math.sin(elapsed * 2.1) * motion
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.12 * w
        handShape(pose, 'R', 'flat', w * 0.85)
        // A slow tap of the index on the card back mid-way.
        pose.handShapeR.drum = Math.max(pose.handShapeR.drum, 0.5 * envelope(elapsed - 1.8, 1.2, 0.3, 0.3) * w * motion)
        handFrame(pose, 'R', w, 0.25, -0.12, 0)
        add(bones.Chest, 0.1, -0.05, 0, w * settle)
        add(bones.Head, 0.12, 0.05, 0, w * settle)
        break
      }
      case 6: { // a look round the room: the head leads, the chest follows a little
        const sweep = Math.sin(clamp01(elapsed / (BIG_IDLE_SECONDS[6] ?? 3.4)) * Math.PI * 2 + (seed > 0.5 ? Math.PI : 0)) * motion
        add(bones.Neck, -0.03, 0.22 * sweep, 0, w)
        add(bones.Head, -0.06, 0.42 * sweep, -0.04 * sweep, w)
        add(bones.Chest, 0, 0.12 * sweep, 0, w)
        add(bones.Torso, 0, 0.05 * sweep, 0, w)
        break
      }
      default: { // fix the hat brim, push the glasses up, or scratch the head
        const wear = input.headwear ?? 'none'
        const tug = Math.sin(clamp01((elapsed - 0.7) / 0.9) * Math.PI) * motion
        const circle = elapsed * 9
        // Out at the side of the head (never across the eyes): the hat's brim
        // edge, the glasses' hinge at the temple, or the side of the crown.
        // Carried with the live head; the elbow hangs, the arm swings wide on the way.
        const spot: Vec3 = wear === 'hat'
          ? offset(anchors.chin, 0.24, 0.3 - 0.03 * tug, 0.1)
          : wear === 'glasses'
            ? offset(anchors.chin, 0.21, 0.1 + 0.02 * tug, 0.12)
            : offset(anchors.chin, 0.2 + Math.cos(circle) * 0.015 * motion, 0.27 + Math.sin(circle) * 0.015 * motion, 0.2)
        blendTo(pose.handR, spot, w)
        aroundHead(pose.handR, w, 1)
        pose.headFollow = Math.max(pose.headFollow, w)
        pose.fingerCurlR = pose.fingerCurlR * (1 - w) + 0.35 * w
        handShape(pose, 'R', wear === 'none' ? 'rub' : 'pinch', w)
        // Fingers up and in toward the head, palm to the temple.
        handFrame(pose, 'R', w, 0.7, 1.1, 1.3)
        add(bones.Head, wear === 'hat' ? 0.06 : 0.1, -0.06, -0.06, w)
        break
      }
    }
  }

  // 7d. Somebody else scooped the pot: some clap, some nod, some grumble.
  if (input.otherWinner && !input.winner && !input.loser && !input.passedOut) {
    if (!Number.isFinite(state.reactionSince)) {
      state.reactionSince = time + state.random() * 0.5
      let kind = Math.floor(state.random() * 5)
      // A big pot (the table was heated) gets more grumbling than applause.
      if (input.tableHeat > 0.5 && kind === 0) kind = 3
      // The hero scooping it: a friendly table claps or nods more (avatarReactions).
      kind = pickWinnerReaction(kind, input.social, seed)
      state.reactionKind = kind
    }
    const since = time - state.reactionSince
    // (A half-second onset: the hands turn palm to palm without a wrist snap.)
    const w = envelope(since, state.reactionKind >= 3 ? 2.8 : 2.4, 0.5, 0.6) * motion
    if (state.reactionKind === 0) {
      // Each player claps at their own tempo (a polite patter to a slow, sarcastic clap).
      const clap = 0.5 + 0.5 * Math.sin(since * (7 + 9 * seed))
      blendTo(pose.handR, offset(anchors.chest, 0.05 + 0.09 * clap, -0.05, -0.3), w)
      blendTo(pose.handL, offset(anchors.chest, -0.05 - 0.09 * clap, -0.05, -0.3), w)
      // Open for the clap, but never splayed stiff.
      pose.fingerCurlR += (0.15 - pose.fingerCurlR) * w
      pose.fingerCurlL += (0.15 - pose.fingerCurlL) * w
      // Palms facing each other, fingers angled up.
      handShape(pose, 'R', 'clap', w)
      handShape(pose, 'L', 'clap', w)
      // (Fingers nearly parallel and the wrists a palm's width apart at the
      // meeting point: the palms touch instead of the fingers passing through each other.)
      handFrame(pose, 'R', w, -0.05, 0.65, 1.4)
      handFrame(pose, 'L', w, -0.05, 0.65, 1.4)
    } else if (state.reactionKind === 1) {
      // An approving nod, the chin tipping toward the winner's side.
      add(bones.Head, 0.14 * Math.max(0, Math.sin(since * 7)), 0, 0.05, w)
      add(bones.Chest, 0.03, 0, 0, w)
    } else if (state.reactionKind === 2) {
      add(bones.Head, 0.1, 0.25 * Math.sin(since * 9) * Math.exp(-since * 0.8), 0, w)
      add(bones.Chest, -0.08, 0, 0, w)
    } else if (state.reactionKind === 3) {
      // Sour grapes: sit back, arms folded, a slow head shake.
      const fold = smoothStep(since / 0.6) * w
      blendTo(pose.handR, FOLD_HAND_R(anchors), fold)
      blendTo(pose.handL, FOLD_HAND_L(anchors), fold)
      pose.fingerCurlR += (0.38 - pose.fingerCurlR) * fold
      pose.fingerCurlL += (0.38 - pose.fingerCurlL) * fold
      handShape(pose, 'R', 'loose', fold * 0.55)
      handShape(pose, 'L', 'loose', fold * 0.55)
      handFrame(pose, 'R', fold, 0.7, 0.1, 0.35)
      handFrame(pose, 'L', fold, 0.7, 0.1, 0.35)
      pose.elbowOut = Math.max(pose.elbowOut, 0.55 * fold)
      add(bones.Chest, -0.14, 0, 0, w)
      add(bones.Head, 0.04, 0.16 * Math.sin(since * 4.2) * Math.exp(-since * 0.6), 0.05, w)
      pose.bodyPosition[2] += 0.07 * w
    } else {
      // "What can you do": a palms-up shrug with the head tipped.
      const rise = smoothStep(since / 0.35) * (1 - smoothStep((since - 1.5) / 0.5))
      add(bones.ShoulderR, 0, 0, 0.3, w * rise)
      add(bones.ShoulderL, 0, 0, -0.3, w * rise)
      add(bones.Head, 0.02, 0, -0.15, w)
      add(pose.handR, 0.1, 0.2, 0.06, w * rise)
      add(pose.handL, -0.1, 0.2, 0.06, w * rise)
      handShape(pose, 'R', 'open', w * rise * 0.9)
      handShape(pose, 'L', 'open', w * rise * 0.9)
      handFrame(pose, 'R', w * rise, -0.1, 0.5, 2.3)
      handFrame(pose, 'L', w * rise, -0.1, 0.5, 2.3)
    }
  } else {
    state.reactionSince = Number.NEGATIVE_INFINITY
  }

  // 8. Folded: sit back and fold the arms, eyes drifting off the action.
  if (input.folded && (!input.cueActive || input.cue === 'fold') && !input.winner) {
    const settle = smoothStep((time - state.foldedSince) / 0.9) * (input.cueActive ? foldHandoff : 1)
    add(bones.Chest, -0.16, 0, 0, settle)
    add(bones.Torso, -0.06, 0.08, 0, settle)
    add(bones.Head, 0.1, -0.12, 0.04, settle)
    // Arms crossed snug: each hand tucks in at the opposite elbow, the right
    // forearm resting on top of the left, elbows out a little at the sides.
    blendTo(pose.handR, FOLD_HAND_R(anchors), settle)
    blendTo(pose.handL, FOLD_HAND_L(anchors), settle)
    pose.fingerCurlR += (0.38 - pose.fingerCurlR) * settle
    pose.fingerCurlL += (0.38 - pose.fingerCurlL) * settle
    // Hands tucked over the opposite arm: loosely curled, wrists turned in.
    handShape(pose, 'R', 'loose', settle * 0.55)
    handShape(pose, 'L', 'loose', settle * 0.55)
    handFrame(pose, 'R', settle, 0.7, 0.1, 0.35)
    handFrame(pose, 'L', settle, 0.7, 0.1, 0.35)
    pose.elbowOut = Math.max(pose.elbowOut, 0.55 * settle)
    pose.bodyPosition[2] += 0.08 * settle
  }

  // 8b. Table talk (see tableTalk.ts): a neighbour chats with another player. Both turn to face
  // each other (head leads, the spine follows; this replaces the random glance). The speaker nods
  // on the beats of speech and talks with one hand, palm up and lifted off the rail (the jaw flaps
  // in the face rig, which reads state.chatOn); the listener nods along, hands staying down, and
  // when the exchange ends in a joke gives a small laugh with a shoulder shake. Folded players
  // keep their crossed arms but still turn and talk. isFreeToChat gated it above.
  if (chatOn && chat) {
    const w = chatWeight(chat) * motion
    if (w > 0.001) {
      const yaw = Math.max(-1.3, Math.min(1.3, chat.yaw))
      blendAxis(bones.Torso, 1, yaw * 0.12, w)
      blendAxis(bones.Chest, 1, yaw * 0.2, w)
      blendAxis(bones.Neck, 1, yaw * 0.24, w)
      blendAxis(bones.Head, 1, yaw * 0.32, w)
      blendAxis(bones.Head, 0, -0.02, w * 0.7)
      if (chat.role === 'speak') {
        const talk = chatTalkAmount(chat) * w
        const beat = speechBeat(time, seed)
        add(bones.Head, 0.1 * beat, 0, 0.04 * Math.sin(time * 2.7 + seed * 5), talk)
        add(bones.Neck, 0.03 * beat, 0, 0, talk)
        add(bones.Chest, 0.02 * beat, 0, 0, talk)
        add(bones.ShoulderR, 0, 0, 0.03 * beat, talk)
        add(bones.ShoulderL, 0, 0, -0.03 * beat, talk)
        if (!input.folded && talk > 0.001) {
          // The hand on the listener's side (or the far one, by habit): palm up, forearm raised,
          // punching the beats. A fixed hand per player, so it never swaps mid-sentence.
          const toward = yaw >= 0 ? -1 : 1
          const side: 1 | -1 = seed > 0.5 ? toward : toward === 1 ? -1 : 1
          const letter: Side = side === 1 ? 'R' : 'L'
          const hand = side === 1 ? pose.handR : pose.handL
          add(hand, 0.05 * side + 0.02 * Math.sin(time * 2.1 + seed * 5), 0.17 + 0.07 * beat, -0.07 - 0.06 * beat, talk)
          add(side === 1 ? bones.WristR : bones.WristL, -0.1 - 0.2 * beat, 0, 0.18 * side * Math.sin(time * 3.1 + seed), talk)
          handShape(pose, letter, 'open', talk * 0.7)
          handFrame(pose, letter, talk, -0.1, 0.45, 2.2)
        }
      } else {
        const nod = listenerNod(time, seed)
        add(bones.Head, 0.1 * nod, 0, 0.03 * Math.sin(time * 0.8 + seed), w)
        add(bones.Neck, 0.03 * nod, 0, 0, w)
        add(bones.Chest, 0.03, 0, 0, w)
      }
      // The punchline: a small laugh (the listener most of all), head back, shoulders bouncing.
      const laugh = chatLaughAmount(chat) * (chat.role === 'listen' ? 1 : 0.55) * w
      if (laugh > 0.001) {
        const bounce = Math.sin(chat.elapsed * 15 + seed * 6) * 0.5 + 0.5
        add(bones.Head, -0.2, 0.03 * Math.sin(chat.elapsed * 6), 0.06 * Math.sin(chat.elapsed * 4.2), laugh)
        add(bones.Chest, -0.07 + 0.05 * bounce, 0, 0, laugh)
        add(bones.ShoulderR, 0, 0, 0.14 * bounce, laugh)
        add(bones.ShoulderL, 0, 0, -0.14 * bounce, laugh)
        pose.bodyPosition[1] += 0.012 * bounce * laugh
      }
    }
  }

  // 9. Big bet elsewhere: hands off the rail, lean back — "whoa".
  const heatElapsed = time - state.heatSince
  const startle = envelope(heatElapsed, 1.4, 0.14, 0.8) * input.tableHeat * motion
  if (startle > 0 && !input.acting && !input.cueActive && !quiet) {
    add(bones.Chest, -0.16, 0, 0, startle)
    add(bones.Head, -0.14, 0, 0, startle)
    add(pose.handR, 0.06, 0.16, 0.12, startle)
    add(pose.handL, -0.06, 0.16, 0.12, startle)
    pose.bodyPosition[2] += 0.06 * startle
    pose.fingerCurlR = Math.max(Math.min(pose.fingerCurlR, 0.15), pose.fingerCurlR * (1 - 0.6 * startle))
    pose.fingerCurlL = Math.max(Math.min(pose.fingerCurlL, 0.15), pose.fingerCurlL * (1 - 0.6 * startle))
    // Hands fly off the rail, fingers spread, palms out.
    handShape(pose, 'R', 'open', startle * 0.7)
    handShape(pose, 'L', 'open', startle * 0.7)
    handFrame(pose, 'R', startle, -0.1, 0.35, 0.7)
    handFrame(pose, 'L', startle, -0.1, 0.35, 0.7)
  }

  // 10. Lost the showdown: each loser reacts in their own time and way —
  // a facepalm, a slump into the chair, or a head-shaking shrug.
  if (input.loser) {
    const elapsed = time - state.loserSince - seed * 0.7
    const shake = envelope(elapsed, 1.3, 0.1, 0.5) * Math.sin(elapsed * 16) * motion
    const settle = smoothStep((elapsed - 0.5) / 0.7)
    const style = state.loserStyle
    if (style === 3) {
      // A bad beat: head sinks into both hands, elbows on the rail, a slow
      // disbelieving shake inside them.
      const sink = smoothStep((elapsed - 0.15) / 0.6)
      const slowShake = Math.sin(elapsed * 3.4) * envelope(elapsed - 0.8, 2.2, 0.4, 0.6) * motion
      add(bones.Chest, 0.2 * sink, 0, 0)
      add(bones.Head, 0.2 * sink, 0.12 * slowShake, 0.03 * slowShake)
      add(bones.Neck, 0.06 * sink, 0.05 * slowShake, 0)
      // Heels of the hands at the sides of the jaw, fingers up the temples:
      // laid out round the resting head, the arm solve carries them with the
      // live (sinking) head (headFollow). Out wide of the cheeks so the hands
      // never cover the face or the glasses; under a hat brim the fingers stay
      // lower and curled so they never reach it. Swung out on the way up.
      const brim = input.headwear === 'hat' ? 1 : 0
      const up = -0.07 - 0.03 * brim
      blendTo(pose.handR, offset(anchors.chin, 0.19, up, 0.14), sink)
      blendTo(pose.handL, offset(anchors.chin, -0.19, up, 0.14), sink)
      aroundHead(pose.handR, sink, 1)
      aroundHead(pose.handL, sink, -1)
      pose.headFollow = Math.max(pose.headFollow, sink)
      pose.fingerCurlR = pose.fingerCurlR * (1 - sink) + (0.3 + 0.15 * brim) * sink
      pose.fingerCurlL = pose.fingerCurlL * (1 - sink) + (0.3 + 0.15 * brim) * sink
      handShape(pose, 'R', 'rub', sink)
      handShape(pose, 'L', 'rub', sink)
      handFrame(pose, 'R', sink, -0.15, 1.45, 1.5)
      handFrame(pose, 'L', sink, -0.15, 1.45, 1.5)
      pose.bodyPosition[2] -= 0.05 * sink
    } else if (style === 4) {
      // Frustration: the flat hand winds up high and slaps the rail twice
      // (a ~0.2s wind-up, a ~0.12s strike that lands on the cushion), the
      // chest and shoulder driving each strike, the head shaking.
      const slap = railSlap(elapsed) * motion
      const raise = envelope(elapsed, 1.9, 0.2, 0.4)
      const rail = anchors.railR
      blendTo(pose.handR, offset(rail, 0.02, 0.44 - 0.54 * slap, -0.06), raise)
      handShape(pose, 'R', 'flat', raise)
      handFrame(pose, 'R', raise, 0.1, 0.25 - 0.35 * slap, 0)
      add(bones.Chest, 0.04 + 0.16 * slap, 0.05 * slap, 0)
      add(bones.Head, 0.08 + 0.1 * slap, 0.3 * shake, 0)
      add(bones.ShoulderR, 0, 0, (0.14 - 0.2 * slap) * raise)
    } else if (style === 0) {
      add(bones.Head, 0.08 + 0.22 * settle, 0.1 * shake, 0)
      add(bones.Chest, 0.16 * settle, 0, 0)
      blendTo(pose.handR, offset(anchors.chin, 0.02, 0.2, -0.1), settle)
      pose.fingerCurlR = pose.fingerCurlR * (1 - settle) + 0.15 * settle
      // Facepalm: the flat hand over the eyes, fingers up.
      handShape(pose, 'R', 'flat', settle)
      handFrame(pose, 'R', settle, 0.55, 1.35, 1.35)
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
      // Palms up and open: what can you do.
      handShape(pose, 'R', 'open', shrug * 0.6)
      handShape(pose, 'L', 'open', shrug * 0.6)
      handFrame(pose, 'R', shrug, -0.1, 0.25, 2.7)
      handFrame(pose, 'L', shrug, -0.1, 0.25, 2.7)
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
      // Raking arms: fingers hooked, palms drawing toward the body.
      handShape(pose, 'R', 'chipRest', rakeW)
      handShape(pose, 'L', 'chipRest', rakeW)
      handFrame(pose, 'R', rakeW, -0.1, -0.12 - 0.2 * pull, 0)
      handFrame(pose, 'L', rakeW, -0.1, -0.12 - 0.2 * pull, 0)
      add(bones.Chest, 0.24 * (1 - pull * 0.6), 0, 0, rakeW)
      // Eyes up and grinning at the table while the arms pull the pot in.
      add(bones.Head, -0.1, 0, 0, rakeW)
      pose.bodyPosition[2] -= 0.12 * (1 - pull) * rakeW
    }
    const elapsed = sinceWin - WINNER_RAKE_SECONDS
    const antic = envelope(elapsed, 0.3, 0.08, 0.18) * motion
    const rise = smoothStep((elapsed - 0.1) / 0.3)
    const hop = Math.max(0, Math.sin(clamp01((elapsed - 0.12) / 0.45) * Math.PI)) * motion
    // A second beat after the celebration (see pickWinFlair) before the smug lounge.
    const flairKind = state.winFlair
    const loungeAt = flairKind === 0 ? 3.2 : 4.5
    const lounge = smoothStep((elapsed - loungeAt) / 1.2) * motion
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
        // Open hands thrown up (palms toward the ceiling's far side), then laced behind the head.
        handShape(pose, 'R', 'open', up * 0.9)
        handShape(pose, 'L', 'open', up * 0.9)
        handShape(pose, 'R', 'loose', lounge * 0.8)
        handShape(pose, 'L', 'loose', lounge * 0.8)
        handFrame(pose, 'R', up, -0.15, 1.25, 0.5)
        handFrame(pose, 'L', up, -0.15, 1.25, 0.5)
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
        handShape(pose, 'R', 'fist', pumping)
        handShape(pose, 'R', 'loose', lounge * 0.8)
        handShape(pose, 'L', 'fist', pumping * 0.6)
        handShape(pose, 'L', 'loose', lounge * 0.8)
        handFrame(pose, 'R', pumping, -0.1, 0.5, 0.9)
        handFrame(pose, 'L', pumping * 0.6, 0.2, 0.2, 0.9)
        break
      }
      case 'slow_clap': {
        // A deliberate, sarcastic clap: the hands swing open slowly and come together
        // fast, a beat each (slapClap), out in front of the chest and below the chin so
        // the face stays clear. Wide enough apart between beats that the clap reads.
        const clap = slapClap(time * 0.68 + seed) * motion
        const meet = 1 - clap
        blendTo(pose.handR, offset(anchors.chest, 0.05 + 0.15 * clap, -0.04 + 0.03 * clap, -0.4), rise)
        blendTo(pose.handL, offset(anchors.chest, -0.05 - 0.15 * clap, -0.04 + 0.03 * clap, -0.4), rise)
        // The head dips on each clap.
        add(bones.Head, 0.06 * meet * meet * meet, 0, 0, rise)
        add(bones.Chest, 0.02 * meet, 0, 0, rise)
        pose.fingerCurlR = 0.12
        pose.fingerCurlL = 0.12
        handShape(pose, 'R', 'clap', rise)
        handShape(pose, 'L', 'clap', rise)
        handFrame(pose, 'R', rise, -0.05, 0.7, 1.4)
        handFrame(pose, 'L', rise, -0.05, 0.7, 1.4)
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
        handShape(pose, 'R', 'open', rise)
        handFrame(pose, 'R', rise, -0.25, 1.2, 0.15)
        break
      }
    }
    // The flair holds until the lounge takes over (it never hands back to the
    // celebration underneath, which would re-raise the arms).
    const flair = flairKind === 0 ? 0 : smoothStep((elapsed - 2.5) / 0.45) * motion
    if (flair > 0.001) {
      const fe = elapsed - 2.5
      if (flairKind !== 1) {
        // One-handed beats: the other hand drops back to the rail from the celebration.
        pose.handL[0] += (restLx - pose.handL[0]) * flair
        pose.handL[1] += (restLy - pose.handL[1]) * flair
        pose.handL[2] += (restLz - pose.handL[2]) * flair
        handShape(pose, 'L', 'relaxed', flair)
        pose.frameL[0] *= 1 - flair
        pose.fingerCurlL = pose.fingerCurlL * (1 - flair) + rest.curlL * flair
      }
      if (flairKind === 1) {
        // Lean back and laugh: head thrown back, shoulders bouncing, a hand slapping the rail.
        const bounce = (Math.sin(fe * 14) * 0.5 + 0.5) * (1 - 0.4 * smoothStep((fe - 0.8) / 1.2))
        const slap = Math.max(0, Math.sin(fe * 7)) * motion
        add(bones.Chest, -0.26 + 0.09 * bounce, 0, 0, flair)
        add(bones.Torso, -0.05, 0, 0, flair)
        add(bones.Head, -0.34, 0.05 * Math.sin(fe * 5), 0.12 * Math.sin(fe * 3.7), flair)
        add(bones.ShoulderR, 0, 0, 0.24 * bounce, flair)
        add(bones.ShoulderL, 0, 0, -0.24 * bounce, flair)
        // The right hand slaps the rail out at its own side; the left holds the belly.
        // (Slap out past the shoulder, belly hand on its own side and in
        // against the body: the two never meet, whatever the rest style.)
        blendTo(pose.handR, offset(anchors.shoulderR, 0.15, anchors.railR[1] - anchors.shoulderR[1] + 0.12 - 0.12 * slap, anchors.railR[2] - anchors.shoulderR[2] - 0.06), flair)
        blendTo(pose.handL, offset(anchors.chest, -0.08, -0.3, 0.05), flair)
        pose.bodyPosition[2] += 0.08 * flair
        handShape(pose, 'R', 'flat', flair)
        handShape(pose, 'L', 'loose', flair * 0.8)
        handFrame(pose, 'R', flair, 0.1, 0.05 - 0.15 * slap, 0)
        handFrame(pose, 'L', flair, 0.9, 0.2, 0.4)
        pose.bodyPosition[1] += 0.02 * bounce * flair
      } else if (flairKind === 2) {
        // Point at the pot coming their way ("that's mine"), a double jab, chin up.
        const jab = (pulse(fe, 0.45, 0.08, 0.2) + pulse(fe, 0.85, 0.08, 0.2)) * motion
        // Arm out toward the pot (most of its length, a little below the
        // shoulder), the index finger along the same line.
        const bx = anchors.board[0] - anchors.shoulderR[0]
        const bz = anchors.board[2] - anchors.shoulderR[2]
        const flat = Math.hypot(bx, bz) || 1
        const reach = 0.74 + 0.06 * jab
        blendTo(pose.handR, offset(anchors.shoulderR, (bx / flat) * reach, -0.08 + 0.02 * jab, (bz / flat) * reach), flair)
        pose.fingerCurlR = pose.fingerCurlR * (1 - flair) + 0.8 * flair
        handShape(pose, 'R', 'point', flair)
        // Yaw toward the midline is -x for the right hand (fingers along -z).
        handFrame(pose, 'R', flair, Math.atan2(-bx, -bz), -0.1, 1.15)
        add(bones.Head, -0.1 + 0.04 * jab, 0, 0.06, flair)
        add(bones.Chest, 0.06 * jab, 0.06, 0, flair)
      } else {
        // The pull-down: a fist raised high, then yanked down to the chest, "yes!",
        // held there with a couple of little shakes.
        const pull = smoothStep(fe / 0.4) * (1 - smoothStep((fe - 0.55) / 0.22))
        const pulled = smoothStep((fe - 0.55) / 0.22)
        const shakeFist = Math.sin(fe * 22) * 0.015 * pulled * (1 - smoothStep((fe - 1.3) / 0.4)) * motion
        blendTo(pose.handR, offset(anchors.shoulderR, 0.1, 0.38 * pull - 0.24 * pulled + shakeFist, -0.28 + 0.06 * pulled), flair)
        pose.fingerCurlR = pose.fingerCurlR * (1 - flair) + flair
        handShape(pose, 'R', 'fist', flair)
        handFrame(pose, 'R', flair, -0.1, 0.5, 0.9)
        add(bones.Chest, 0.16 * pulled * (1 - smoothStep((fe - 1.2) / 0.6)), 0, 0, flair)
        add(bones.Head, -0.12 * pull + 0.06 * pulled, 0, 0, flair)
        add(bones.WristR, -0.2 * pull, 0, 0, flair)
      }
    }
    if (flair > 0.001 && lounge > 0.001) {
      // Every flair ends in the smug lounge, hands laced behind the head.
      blendTo(pose.handR, behindHead(anchors, 1), lounge)
      blendTo(pose.handL, behindHead(anchors, -1), lounge)
      aroundHead(pose.handR, lounge, 1)
      aroundHead(pose.handL, lounge, -1)
      pose.elbowUp = Math.max(pose.elbowUp, lounge)
      handShape(pose, 'R', 'loose', lounge * 0.8)
      handShape(pose, 'L', 'loose', lounge * 0.8)
      pose.frameR[0] *= 1 - lounge
      pose.frameL[0] *= 1 - lounge
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
    // One continuous motion: the ramps overlap (the hand is already rising
    // toward the mouth while it closes on the glass, and starts back to the rail
    // while the glass is still coming down), not grab, then lift, then tip.
    const holding = smoothStep(elapsed / 0.55) * (1 - smoothStep((elapsed - (DRINK_SECONDS - 0.6)) / 0.55))
    const lift = smoothStep((elapsed - 0.3) / 1.0) * (1 - smoothStep((elapsed - (DRINK_SECONDS - 1.25)) / 0.95))
    // The glass sits on the felt to the player's left, so the left hand takes
    // it (no arm across the body). Raised, the fist stays on its own side
    // just below and in front of the mouth; the renderer (placeDrinkProp)
    // then puts the hand exactly on the glass whose rim is at the lips.
    blendTo(pose.handL, offset(anchors.drinkRest, 0.04, 0.1, 0.04), holding)
    blendTo(pose.handL, offset(anchors.chin, -0.1, -0.22, -0.02), lift)
    add(bones.Head, -0.3 * lift, 0, 0)
    add(bones.Chest, -0.08 * lift, 0, 0)
    // The swallow (a small throat bob as the glass comes down) and a satisfied exhale.
    const swallow = pulse(elapsed, DRINK_SECONDS - 0.95, 0.09, 0.28) * motion
    const sigh = envelope(elapsed - (DRINK_SECONDS - 0.7), 0.9, 0.25, 0.4) * motion
    add(bones.Neck, 0.06 * swallow, 0, 0)
    add(bones.Head, 0.04 * swallow, 0, 0)
    add(bones.Chest, -0.04 * sigh, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.05 * sigh)
    add(bones.ShoulderL, 0, 0, -0.05 * sigh)
    pose.fingerCurlL = pose.fingerCurlL * (1 - holding) + 0.85 * holding
    // Fingers wrap the glass, thumb up its side, the fist vertical.
    handShape(pose, 'L', 'cup', holding)
    handFrame(pose, 'L', holding, 0.05, 0.05 + 0.25 * lift, 1.35)
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
    // Not a locked-straight arm: the elbow stays low and the forearm angles
    // up, so the hand (fingers up, a modest wrist bend) sits high and clear.
    const reach = 0.62 + 0.07 * jab
    const goal: Vec3 = [
      shoulder[0] + (dx / flat) * reach * Math.cos(aimPitch),
      shoulder[1] + 0.22 + reach * Math.sin(aimPitch) + 0.03 * jab + shake,
      shoulder[2] + (dz / flat) * reach * Math.cos(aimPitch),
    ]
    const gestureHand = left ? pose.handL : pose.handR
    const braceHand = left ? pose.handR : pose.handL
    // Wind-up: the fist draws back beside the chest before it's thrown.
    const cocked = offset(anchors.chest, 0.14 * mirror, 0.02, -0.12)
    blendTo(gestureHand, cocked, windup * (1 - extend))
    blendTo(gestureHand, goal, extend * w)
    // On the way back the hand drops down and out to its own side first, so
    // it never sweeps across the chest or face to reach the rail.
    if (elapsed > 1.8) {
      const releaseBulge = 4 * extend * (1 - extend) * w
      gestureHand[0] += 0.14 * mirror * releaseBulge
      gestureHand[1] -= 0.1 * releaseBulge
    }
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
    // A fist while the arm winds up, the middle finger rising out of it.
    handShape(pose, left ? 'L' : 'R', 'fist', w)
    handShape(pose, left ? 'L' : 'R', 'middle', pose.middleFinger)
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
    // (The fist stays on its own side of the mouth, the glass in its top.)
    blendTo(pose.handR, offset(anchors.chin, 0.08, -0.13, 0.06), lift)
    // Throw it back: head and chest tip well back while the glass is up.
    add(bones.Head, -0.62 * tip, 0, 0)
    add(bones.Neck, -0.22 * tip, 0, 0)
    add(bones.Chest, -0.16 * tip + 0.16 * slam, 0, 0)
    pose.bodyPosition[2] += 0.05 * tip - 0.05 * slam
    pose.handR[1] -= 0.04 * slam
    pose.fingerCurlR = pose.fingerCurlR * (1 - reach) + 0.9 * reach
    // Fingers round the little glass.
    handShape(pose, 'R', 'cup', reach)
    handFrame(pose, 'R', reach, 0.05, 0.05 + 0.3 * lift, 1.3)
    // Brrr: a fast head shake, shoulders up around the ears, chin tucked.
    const buzz = Math.sin(e * 44) * motion
    add(bones.Head, 0.12 * shudder, 0.14 * buzz * shudder, 0.07 * Math.sin(e * 31) * shudder * motion)
    add(bones.Neck, 0.06 * shudder, 0, 0)
    add(bones.ShoulderR, 0, 0, 0.18 * shudder)
    add(bones.ShoulderL, 0, 0, -0.18 * shudder)
    add(bones.Torso, 0, 0.05 * buzz * shudder, 0)
    // The burn: a flat hand thumps the chest a couple of times.
    const thump = Math.max(0, Math.sin((e - SHOT_SLAM_AT) * 14)) * motion
    blendTo(pose.handL, offset(anchors.chest, 0.06, -0.16, 0.06 - 0.03 * thump), shudder * 0.85)
    pose.fingerCurlL = pose.fingerCurlL * (1 - shudder) + 0.2 * shudder
    // A flat hand thumping the chest.
    handShape(pose, 'L', 'flat', shudder * 0.9)
    handFrame(pose, 'L', shudder, 1.0, 0.2, 0.5)
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
    // A modest cock and snap at the wrist (a sharp bend on top of the reach
    // down to the felt folds the hand into a wedge).
    add(bones.WristR, -0.3 * cock + 0.55 * snap, 0, 0, w)
    pose.fingerCurlR = pose.fingerCurlR * (1 - w) + (0.8 * (1 - snap) + 0.15 * snap) * w
    // Index cocked behind the thumb, then it springs free with the snap.
    handShape(pose, 'R', 'flickCock', w * (1 - snap))
    handShape(pose, 'R', 'flickSnap', w * snap)
    pose.handShapeR.speed = 1 + 1.6 * snap
    handFrame(pose, 'R', w, 0.05, -0.22 + 0.15 * cock - 0.1 * snap, 0.1)
    blendAxis(bones.Head, 1, turn * 0.34, w)
    blendAxis(bones.Neck, 1, turn * 0.16, w)
    blendAxis(bones.Chest, 1, turn * 0.2, w)
    add(bones.Head, 0.08 * cock - 0.05 * snap, 0, 0, w)
    add(bones.Chest, 0.08 * w, 0, 0)
    pose.bodyPosition[2] -= 0.05 * w
  }

  // 17b. Dealing (the dealer's chair): the left hand steadies the deck, the
  // right pinches a card, draws back and snaps it out at the recipient while
  // the head swings from the deck to them. All the timing lives in dealerDeal
  // (the card launches on the snap); this only lays it onto the pose. Anything
  // louder in progress (a prank, a flick-off, the dealer's own action) wins.
  const dealing = input.dealing
  if (
    dealing && dealing.weight > 0 && !input.passedOut && !input.folded && !input.cueActive && !input.flipOff &&
    !input.chipFlick && input.shotElapsed == null && input.bonkElapsed == null
  ) {
    const w = dealing.weight
    // A beer in the left hand (and the head tipped back for it) wins over the deck hold; the right hand keeps pitching.
    const wl = input.drinkElapsed == null ? w : 0
    const snap = dealing.snap * motion
    blendTo(pose.handR, dealing.handR, w)
    blendTo(pose.handL, dealing.handL, wl)
    add(bones.WristR, dealing.wristR[0], dealing.wristR[1], dealing.wristR[2], w * motion)
    pose.fingerCurlR = pose.fingerCurlR * (1 - w) + dealing.curlR * w
    pose.fingerCurlL = pose.fingerCurlL * (1 - wl) + dealing.curlL * wl
    // A relaxed pinch on the card, cocked behind the thumb, then it springs free.
    handShape(pose, 'R', 'pinch', w * dealing.pinch)
    handShape(pose, 'R', 'flickCock', w * dealing.cock * (1 - snap))
    handShape(pose, 'R', 'flickSnap', w * snap)
    pose.handShapeR.speed = 1 + 1.6 * snap
    handFrame(pose, 'R', w, dealing.frameYaw, dealing.framePitch, dealing.frameRoll)
    // The off hand cups the deck.
    handShape(pose, 'L', 'card', wl * dealing.holdL)
    blendAxis(bones.Head, 1, dealing.headYaw * 0.5, wl)
    blendAxis(bones.Neck, 1, dealing.headYaw * 0.25, wl)
    blendAxis(bones.Chest, 1, dealing.headYaw * 0.15, w)
    blendAxis(bones.Torso, 1, dealing.headYaw * 0.1, w)
    blendAxis(bones.Head, 0, dealing.headPitch * 0.65, wl)
    blendAxis(bones.Neck, 0, dealing.headPitch * 0.35, wl)
    add(bones.Chest, 0.06 * w, 0, 0)
    pose.bodyPosition[2] -= 0.03 * w
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
    // On the crown, a little to the side: the chin anchor is at the lips, so
    // this is up past the forehead and back over the top of the skull.
    const sore: Vec3 = offset(
      anchors.chin,
      0.14 + Math.cos(circle) * 0.03 * motion,
      0.3 + Math.sin(circle) * 0.02 * motion,
      0.27
    )
    blendTo(pose.handR, sore, rub)
    aroundHead(pose.handR, rub, 1)
    pose.elbowUp = Math.max(pose.elbowUp, rub)
    pose.fingerCurlR = pose.fingerCurlR * (1 - rub) + 0.35 * rub
    // Fingertips rubbing the sore spot, palm on the skull.
    handShape(pose, 'R', 'rub', rub)
    handFrame(pose, 'R', rub, 0.55, 1.0, 1.25)
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
    // The temple is beside the head (the chin anchor is out in front of the
    // lips), and the elbow comes up and out so the forearm never crosses the face.
    const temple: Vec3 = offset(anchors.chin, 0.17 + Math.cos(circle) * 0.015 * motion, 0.13 + Math.sin(circle) * 0.015 * motion, 0.17)
    blendTo(pose.handR, temple, rub)
    aroundHead(pose.handR, rub, 1)
    pose.elbowUp = Math.max(pose.elbowUp, rub)
    pose.fingerCurlR = pose.fingerCurlR * (1 - rub) + 0.25 * rub
    handShape(pose, 'R', 'rub', rub)
    handFrame(pose, 'R', rub, 0.5, 1.15, 1.2)
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
    // Fingers spread wide, palms turning toward the face in wonder.
    handShape(pose, 'R', 'open', wonder * 0.9)
    handShape(pose, 'L', 'open', wonder * 0.9)
    pose.handShapeR.spread = wonder * 0.4
    pose.handShapeL.spread = wonder * 0.4
    handFrame(pose, 'R', wonder, -0.3, 0.9, 1.5 + 0.5 * turn)
    handFrame(pose, 'L', wonder, -0.3, 0.9, 1.5 - 0.5 * turn)
    const swayX = Math.sin(time * 0.7 + seed * 3) * motion
    const swayZ = Math.cos(time * 0.55 + seed * 2) * motion
    add(bones.Head, 0.06 + 0.08 * Math.sin(time * 0.5) * motion, 0.14 * turn, 0.22 * swayX)
    add(bones.Torso, 0.04 * swayZ, 0.05 * swayX, 0.12 * swayX)
    add(bones.Chest, -0.04, 0, 0.06 * swayZ)
    pose.bodyPosition[0] += 0.03 * swayX
  }

  // 23. Social reactions (avatarReactions.ts): eye contact and nods toward the
  // hero or the pot winner, a gasp and head shake at an all-in or big raise,
  // sweating a run-out, a bad beat or a hit out when the broadcast odds swing,
  // stack-at-risk nervous tells, a shrug on folding to a big bet. Every weight is
  // zero under reduced motion and while the seat is acting, mid-gesture or
  // owned by a showdown / prank / drink pose; they enter and leave smoothly.
  const social = input.social
  if (social && motion > 0 && !quiet) {
    const rx = state.reactions
    const rc = rx.ctx
    const staged = input.shotElapsed != null || input.bonkElapsed != null || input.blackoutElapsed != null ||
      input.dazedElapsed != null || input.drinkElapsed != null || Boolean(input.flipOff) || Boolean(input.chipFlick)
    rc.time = time
    rc.seed = seed
    rc.motion = motion
    rc.acting = input.acting
    rc.folded = input.folded
    rc.beatFree = !input.acting && !input.passedOut && !input.winner && !staged && !input.tripping
    rc.headFree = rc.beatFree && !input.loser && !input.cueActive
    rc.handsFree = rc.headFree && !input.peeking && livePeek.reach < 0.05 && !Number.isFinite(state.bigIdleStartedAt) &&
      !Number.isFinite(state.peekStartedAt) && !input.hungover && !(input.cheersRaise && input.cheersRaise > 0.01)
    rc.loserAge = input.loser ? time - state.loserSince : Number.POSITIVE_INFINITY
    rc.boardAge = input.boardRevealAge ?? Number.POSITIVE_INFINITY
    const rw = computeSocialReactions(rx, social, rc)

    // Face the person (the camera for the hero) and meet their eyes: the head
    // and neck swing to the real bearing; the eyes lock on through the gaze rig.
    if (rw.look > 0.001) {
      const yawTo = Math.max(-0.9, Math.min(0.9, rw.lookYaw))
      const pitchTo = Math.max(-0.3, Math.min(0.3, rw.lookPitch))
      blendAxis(bones.Neck, 1, 0.35 * yawTo, rw.look)
      blendAxis(bones.Head, 1, 0.65 * yawTo, rw.look)
      blendAxis(bones.Chest, 1, 0.12 * yawTo, rw.look)
      blendAxis(bones.Neck, 0, 0.35 * pitchTo, rw.look)
      blendAxis(bones.Head, 0, 0.65 * pitchTo, rw.look)
    }
    // A nod (chin dips twice) or a small no.
    if (rw.nod > 0.001) {
      add(bones.Head, 0.17 * rw.nod, 0, 0)
      add(bones.Neck, 0.05 * rw.nod, 0, 0)
      add(bones.Chest, 0.025 * rw.nod, 0, 0)
    }
    if (rw.shake > 0.001 || rw.shake < -0.001) {
      add(bones.Head, 0.01, 0.26 * rw.shake, 0.03 * rw.shake)
      add(bones.Neck, 0, 0.06 * rw.shake, 0)
      add(bones.Chest, 0, 0.03 * rw.shake, 0)
    }
    // Gasp: flinch back, shoulders up, a hand flies over the mouth.
    if (rw.gasp > 0.001) {
      const g = rw.gasp
      add(bones.Chest, -0.1, 0, 0, g)
      add(bones.Head, -0.08, 0, 0, g)
      add(bones.ShoulderR, 0, 0, 0.1, g)
      add(bones.ShoulderL, 0, 0, -0.1, g)
      pose.bodyPosition[2] += 0.04 * g
      if (!input.folded) {
        const side: Side = rw.gaspSide > 0 ? 'R' : 'L'
        const hand = side === 'R' ? pose.handR : pose.handL
        blendTo(hand, offset(anchors.chin, 0.02 * rw.gaspSide, -0.01, -0.07), g * 0.95)
        pose.headFollow = Math.max(pose.headFollow, g)
        if (side === 'R') pose.fingerCurlR = pose.fingerCurlR * (1 - g) + 0.2 * g
        else pose.fingerCurlL = pose.fingerCurlL * (1 - g) + 0.2 * g
        // Fingers together over the lips, palm in.
        handShape(pose, side, 'flat', g * 0.85)
        handFrame(pose, side, g, 0.55, 1.3, 1.3)
        // The other hand lifts off the rail, fingers spread.
        const other = side === 'R' ? pose.handL : pose.handR
        add(other, 0.05 * rw.gaspSide, 0.1, 0.05, g)
        handShape(pose, side === 'R' ? 'L' : 'R', 'open', g * 0.6)
      }
    }
    // Sweating a run-out: leaning in, a knuckle at the lips in bursts, jittery.
    if (rw.sweat > 0.001) {
      const s = rw.sweat
      const side: Side = seed > 0.5 ? 'L' : 'R'
      const sign = side === 'R' ? 1 : -1
      const hand = side === 'R' ? pose.handR : pose.handL
      add(bones.Chest, 0.07, 0, 0, s)
      add(bones.Head, 0.03, 0, 0, s)
      pose.bodyPosition[2] -= 0.03 * s
      blendTo(hand, offset(anchors.chin, 0.03 * sign, -0.015, -0.06), s * 0.9)
      pose.headFollow = Math.max(pose.headFollow, s * 0.9)
      if (side === 'R') pose.fingerCurlR = pose.fingerCurlR * (1 - s) + 0.75 * s
      else pose.fingerCurlL = pose.fingerCurlL * (1 - s) + 0.75 * s
      handShape(pose, side, 'loose', s * 0.9)
      handFrame(pose, side, s * 0.9, 0.55, 1.1, 1.25)
      hand[1] += 0.004 * Math.sin(time * 23 + seed * 5) * s
    }
    // Bad beat: the odds collapsed. Hands fly to the head, sat back in disbelief.
    if (rw.badBeat > 0.001) {
      const b = rw.badBeat
      const stunned = Math.sin(time * 3.1 + seed * 4) * 0.5 * b
      add(bones.Chest, -0.1, 0, 0, b)
      add(bones.Head, -0.1, 0.05 * stunned, 0.02 * stunned, b)
      add(bones.Neck, 0.02, 0.03 * stunned, 0, b)
      pose.bodyPosition[2] += 0.05 * b
      blendTo(pose.handR, offset(anchors.chin, 0.2, 0.17, 0.1), b)
      blendTo(pose.handL, offset(anchors.chin, -0.2, 0.17, 0.1), b)
      aroundHead(pose.handR, b, 1)
      aroundHead(pose.handL, b, -1)
      pose.headFollow = Math.max(pose.headFollow, b)
      pose.elbowUp = Math.max(pose.elbowUp, 0.6 * b)
      pose.fingerCurlR = pose.fingerCurlR * (1 - b) + 0.3 * b
      pose.fingerCurlL = pose.fingerCurlL * (1 - b) + 0.3 * b
      handShape(pose, 'R', 'rub', b)
      handShape(pose, 'L', 'rub', b)
      handFrame(pose, 'R', b, 0.3, 1.4, 1.4)
      handFrame(pose, 'L', b, 0.3, 1.4, 1.4)
    }
    // Hit the out: a long breath out, the whole body sagging into the chair.
    if (rw.relief > 0.001) {
      const r = rw.relief
      const out = smoothStep((time - rx.reliefAt - 0.4) / 0.9)
      add(bones.Chest, -0.07, 0, 0, r)
      add(bones.Head, -0.12 + 0.05 * out, 0, 0.05, r)
      add(bones.ShoulderR, 0, 0, 0.11 * (1 - out) - 0.04 * out, r)
      add(bones.ShoulderL, 0, 0, -0.11 * (1 - out) + 0.04 * out, r)
      pose.bodyPosition[1] -= 0.015 * out * r
      pose.bodyPosition[2] += 0.04 * r
    }
    // Folded to a big bet: a shrug, head tipped to one side.
    if (rw.shrug > 0.001) {
      const s = rw.shrug
      const tilt = seed < 0.5 ? 1 : -1
      add(bones.ShoulderR, 0, 0, 0.3, s)
      add(bones.ShoulderL, 0, 0, -0.3, s)
      add(bones.Head, 0.02, 0.05 * tilt, 0.16 * tilt, s)
      add(bones.Chest, -0.04, 0, 0, s)
      add(pose.handR, 0.05, 0.1, 0.03, s)
      add(pose.handL, -0.05, 0.1, 0.03, s)
      handShape(pose, 'R', 'open', s * 0.5)
      handShape(pose, 'L', 'open', s * 0.5)
    }
    // Nerves grow with the stack at risk: tight shoulders, shallow quick breaths,
    // a bouncing knee through the torso, trembling hands, drumming in bursts,
    // a glance down at the chips.
    if (rw.nervous > 0.001) {
      const n = rw.nervous
      add(bones.ShoulderR, 0, 0, 0.05, n)
      add(bones.ShoulderL, 0, 0, -0.05, n)
      add(bones.Chest, 0.008 * Math.sin(time * 6.2 + seed * 5), 0, 0, n)
      pose.bodyPosition[1] += 0.004 * Math.sin(time * 21 + seed * 3) * n
      const tremble = 0.004 * n * n
      pose.handR[0] += tremble * Math.sin(time * 37 + seed * 3)
      pose.handR[2] += tremble * Math.sin(time * 41 + seed)
      pose.handL[0] += tremble * Math.sin(time * 39 + seed * 7)
      pose.handL[2] += tremble * Math.sin(time * 35 + seed * 2)
    }
    if (rw.drum > 0.001) {
      pose.handShapeR.drum = Math.max(pose.handShapeR.drum, rw.drum)
      pose.handShapeL.drum = Math.max(pose.handShapeL.drum, rw.drum * 0.7)
      const beat = time * nervousDrumRate(rw.nervous) * 6.2832
      pose.handR[1] += 0.004 * Math.max(0, Math.sin(beat + seed)) * rw.drum
      pose.handL[1] += 0.003 * Math.max(0, Math.sin(beat * 0.9 + seed * 3)) * rw.drum
    }
    if (rw.chipGlance > 0.001) {
      const stackYaw = Math.atan2(-anchors.stack[0], -anchors.stack[2])
      blendAxis(bones.Head, 1, stackYaw * 0.8, rw.chipGlance)
      add(bones.Head, 0.2 * rw.chipGlance, 0, 0)
    }
  }

  // Dev-only close-up rig (see getHandLab): hands held out in front of the chest.
  const lab = getHandLab()
  if (lab && !input.passedOut) {
    const sep = lab.sep ?? 0.16
    const forward = lab.forward ?? 0.5
    const up = (lab.up ?? 0) - 0.05
    pose.handR = [anchors.chest[0] + sep, anchors.chest[1] + up, anchors.chest[2] - forward]
    pose.handL = [anchors.chest[0] - sep, anchors.chest[1] + up, anchors.chest[2] - forward]
    const frame = lab.frame ?? [0, 0, 0]
    pose.frameR = [1, frame[0], frame[1], frame[2]]
    pose.frameL = [1, frame[0], frame[1], frame[2]]
    const wrist = lab.wrist ?? [0, 0, 0]
    bones.WristR = [wrist[0], wrist[1], wrist[2]]
    bones.WristL = [wrist[0], wrist[1], wrist[2]]
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
  if (!input.passedOut) {
    // The face's real downward pitch is the whole spine's: torso, chest, neck
    // and head stack (peeks, drunk lolling, leaning in). Past ~0.42 rad a hat
    // brim hides the face, so the head lifts to cancel the excess.
    const spinePitch = bones.Torso[0] + bones.Chest[0] + bones.Neck[0] + bones.Head[0]
    const excess = spinePitch - MAX_FACE_PITCH
    if (excess > 0) {
      const fromHead = Math.min(excess, bones.Head[0] + 0.3)
      bones.Head[0] -= Math.max(0, fromHead)
      bones.Neck[0] -= Math.max(0, Math.min(excess - Math.max(0, fromHead), bones.Neck[0] + 0.15))
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    pose.bodyPosition[axis] = Math.max(-0.3, Math.min(0.3, pose.bodyPosition[axis]!))
  }

  pose.fingerCurlR = clamp01(pose.fingerCurlR)
  pose.fingerCurlL = clamp01(pose.fingerCurlL)
  // The relaxed hand already carries the resting curl; only curl beyond it
  // (a grip, a fist) is layered on top by the finger springs.
  state.handTargetR.curl = clamp01((pose.fingerCurlR - HAND_REST_CURL) / (1 - HAND_REST_CURL))
  state.handTargetL.curl = clamp01((pose.fingerCurlL - HAND_REST_CURL) / (1 - HAND_REST_CURL))
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
  for (let axis = 0; axis < 3; axis += 1) out[index++] = pose.handR[axis]!
  for (let axis = 0; axis < 3; axis += 1) out[index++] = pose.handL[axis]!
  out[index++] = pose.fingerCurlR
  out[index++] = pose.fingerCurlL
  for (let axis = 0; axis < 3; axis += 1) out[index++] = pose.bodyPosition[axis]!
  for (let axis = 0; axis < 3; axis += 1) out[index++] = pose.bodyRotation[axis]!
  out[index++] = pose.cardLift
  out[index++] = pose.drinkLift
  out[index++] = pose.middleFinger
  out[index++] = pose.elbowOut
  out[index++] = pose.elbowUp
  out[index++] = pose.stackGrip
  for (let axis = 0; axis < 4; axis += 1) out[index++] = pose.frameR[axis]!
  for (let axis = 0; axis < 4; axis += 1) out[index++] = pose.frameL[axis]!
  out[index++] = pose.headFollow
}

function readChannels(values: readonly number[], state: AvatarAnimatorState): AvatarPose {
  // Filled in place: the pose object (and its small arrays) belongs to the
  // animator state and is reused every frame.
  const pose = state.outPose ?? (state.outPose = emptyPose(state.handTargetR, state.handTargetL))
  pose.handShapeR = state.handTargetR
  pose.handShapeL = state.handTargetL
  pose.instant = false
  let index = 0
  for (const bone of ANIMATED_BONES) {
    const rotation = pose.bones[bone]
    rotation[0] = values[index++]!
    rotation[1] = values[index++]!
    rotation[2] = values[index++]!
  }
  for (let axis = 0; axis < 3; axis += 1) pose.handR[axis] = values[index++]!
  for (let axis = 0; axis < 3; axis += 1) pose.handL[axis] = values[index++]!
  pose.fingerCurlR = values[index++]!
  pose.fingerCurlL = values[index++]!
  for (let axis = 0; axis < 3; axis += 1) pose.bodyPosition[axis] = values[index++]!
  for (let axis = 0; axis < 3; axis += 1) pose.bodyRotation[axis] = values[index++]!
  pose.cardLift = values[index++]!
  pose.drinkLift = values[index++]!
  pose.middleFinger = values[index++]!
  pose.elbowOut = values[index++]!
  pose.elbowUp = values[index++]!
  pose.stackGrip = values[index++]!
  for (let axis = 0; axis < 4; axis += 1) pose.frameR[axis] = values[index++]!
  for (let axis = 0; axis < 4; axis += 1) pose.frameL[axis] = values[index++]!
  pose.headFollow = values[index++]!
  return pose
}

const scratchTarget: number[] = new Array(CHANNEL_COUNT).fill(0)

/** Caps the speed of the 3 spring channels starting at `start` (seat units per second). */
function limitHandSpeed(springs: Spring[], values: number[], start: number, max: number, dt: number) {
  const a = springs[start]!
  const b = springs[start + 1]!
  const c = springs[start + 2]!
  const speed = Math.hypot(a.velocity, b.velocity, c.velocity)
  if (speed <= max) return
  const scale = max / speed
  // Roll the position back by the clipped part of this step's travel so the
  // hand really slows instead of only carrying less momentum next frame.
  const excess = 1 - scale
  a.value -= a.velocity * excess * dt
  b.value -= b.velocity * excess * dt
  c.value -= c.velocity * excess * dt
  a.velocity *= scale
  b.velocity *= scale
  c.velocity *= scale
  values[start] = a.value
  values[start + 1] = b.value
  values[start + 2] = c.value
}

/**
 * Advances the animator and returns the smoothed pose. Action cues use a stiff
 * spring so chip pushes stay crisp; everything else settles more softly.
 */
export function updateAvatarAnimator(
  state: AvatarAnimatorState,
  input: AvatarAnimatorInput
): AvatarPose {
  const profile = process.env.NODE_ENV !== 'production' ? (globalThis as { __animProf?: Record<string, number> }).__animProf : undefined
  const started = profile ? performance.now() : 0
  const pose = updateAvatarAnimatorInner(state, input)
  if (profile) {
    profile.anim = (profile.anim ?? 0) + performance.now() - started
    profile.calls = (profile.calls ?? 0) + 1
  }
  return pose
}

function updateAvatarAnimatorInner(
  state: AvatarAnimatorState,
  input: AvatarAnimatorInput
): AvatarPose {
  // A calm seat (nothing quick going on) rebuilds its target every other
  // frame; the springs below still advance every frame, so the motion stays
  // smooth and the only cost is up to a frame of latency on slow idle cues.
  const calm = state.initialized && !input.reducedMotion && !input.cueActive && !input.flipOff && !input.chipFlick && !input.dealing &&
    input.shotElapsed == null && input.bonkElapsed == null && input.drinkElapsed == null && input.blackoutElapsed == null &&
    !input.winner && !input.loser && !input.passedOut && !input.otherWinner && (input.boardRevealAge ?? Infinity) > 2 &&
    !(process.env.NODE_ENV !== 'production' && (globalThis as { __animFullRate?: boolean }).__animFullRate)
  let target = state.targetPose
  if (calm && state.skipTarget && target) {
    state.skipTarget = false
    state.owedDelta += input.delta
  } else {
    state.skipTarget = calm
    target = computeAvatarTargetPose(state, input, target ?? (state.targetPose = emptyPose(state.handTargetR, state.handTargetL)))
  }
  writeChannels(target, scratchTarget)

  if (input.reducedMotion || !state.initialized) {
    state.springs.forEach((spring, index) => {
      spring.value = scratchTarget[index]!
      spring.velocity = 0
    })
    state.initialized = true
    target.instant = true
    return target
  }

  // Semi-implicit spring integration with fixed substeps: unconditionally
  // stable at any frame rate (a slow frame can never launch an avatar).
  // Flick-offs and hiccups need snap; passing out sinks slowly.
  const prankActive = Boolean(input.chipFlick) || Boolean(input.dealing) ||
    (input.shotElapsed !== null && input.shotElapsed !== undefined) ||
    (input.bonkElapsed !== null && input.bonkElapsed !== undefined)
  // The blackout lands fast (a bonk, not a slow sink).
  const bonking = input.passedOut && input.blackoutElapsed !== null && input.blackoutElapsed !== undefined && input.blackoutElapsed < 1.1
  // The rail slap needs snap too (its strikes are ~0.12s).
  const slapping = Boolean(input.loser) && state.loserStyle === 4
  const omegaGoal = input.cueActive || bonking || slapping ? 16 : input.flipOff || prankActive ? 14 : input.winner ? 12 : input.passedOut ? 5 : 9
  // Ease the stiffness itself toward its goal (about 0.14s): the cue's target
  // and the spring never both jump in the same frame. A bonk / blackout needs
  // its snap immediately.
  const dt = Math.min(0.1, Math.max(0.0001, input.delta))
  if (bonking) state.omega = omegaGoal
  else state.omega += (omegaGoal - state.omega) * (1 - Math.exp(-dt / 0.14))
  const omega = state.omega
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  const values = state.smoothed
  const springs = state.springs
  for (let index = 0; index < springs.length; index += 1) {
    const spring = springs[index]!
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
  }
  // A hand is a limb, not a projectile: cap how fast a wrist target may travel
  // (a chin rest to the chips is a big move; the arm should swing there, not
  // whip). Gestures that really are quick (flick-off, chip flick, shot) get more.
  const handSpeedMax = input.flipOff || prankActive ? 9 : input.cueActive || slapping ? 5.5 : 4.2
  limitHandSpeed(springs, values, HAND_R_CHANNEL, handSpeedMax, dt)
  limitHandSpeed(springs, values, HAND_L_CHANNEL, handSpeedMax, dt)
  return readChannels(values, state)
}
