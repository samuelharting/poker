import type { Vec3 } from './pokerActionPose'

/**
 * The dealer's deal as a pure, testable timeline.
 *
 * A schedule lists every card the dealer pitches (hole cards one round at a
 * time clockwise, or burn + board cards) with its release time and where it is
 * headed, all in the DEALER'S seat space (-Z faces the table, +X is their
 * right). getDealerPose turns a point on that timeline into hand targets, wrist
 * and head offsets and a finger-shape mix; getDealCardRelease says where the
 * card leaves the hand. Nothing here touches three.js or allocates per call, so
 * the same timeline can drive an avatar's IK targets (avatarAnimator), the
 * moment a card launches (the room) and the hero's first-person hands.
 */

/** The anchors the gesture reads; AvatarAnchors satisfies this structurally. */
export interface DealerAnchors {
  chin: Vec3
  chest: Vec3
  shoulderR: Vec3
  shoulderL: Vec3
  railR: Vec3
  railL: Vec3
  tap: Vec3
  cards: Vec3
  board: Vec3
}

export type DealCardKind = 'hole' | 'burn' | 'flop' | 'turn' | 'river'

export interface DealerCard {
  kind: DealCardKind
  /** Seconds after the schedule start that the card leaves the hand. */
  releaseAt: number
  /** Where it is headed, in the dealer's seat space (unused for a burn card). */
  target: Vec3
  /** Hole: the round (0 or 1). Board: the board slot (0..4). Burn: -1. */
  slot: number
}

export interface DealerSchedule {
  /** Scene time (seconds) the gesture starts; releaseAt is relative to it. */
  startedAt: number
  /** In release order. */
  cards: DealerCard[]
  /** Seconds until the hands are back on the rail. */
  duration: number
}

/** Today's stagger when nobody physically deals (seconds between hole cards). */
export const DEAL_DEFAULT_STEP_SECONDS = 0.05
/** Seconds the dealer takes to reach for the deck before the first hole card. */
export const DEAL_HOLE_LEAD_SECONDS = 0.5
/** Hole cards take about this long in all, then the step is clamped. */
const HOLE_DEAL_TARGET_SECONDS = 2.4
const HOLE_STEP_MIN = 0.15
const HOLE_STEP_MAX = 0.26
/** Seconds from reaching to the first burn card (board deals). */
export const DEAL_BOARD_LEAD_SECONDS = 0.45
/** Burn card to the first card of its street, and the gap between flop cards. */
const BURN_TO_CARD_SECONDS = 0.36
const FLOP_CARD_GAP_SECONDS = 0.24
/** Last card of a street to the next street's burn card (all-in runouts). */
const STREET_GAP_SECONDS = 0.55
/** Hands stay out this long after the last release before heading back. */
const FOLLOW_THROUGH_SECONDS = 0.14
const RETURN_SECONDS = 0.42
/**
 * The animator's springs lag the target by about this much, so the pose is
 * evaluated this far ahead: the visible flick then lands as the card launches.
 * Pass 0 for hands that track the timeline exactly (first-person hands).
 */
export const DEAL_POSE_LEAD_SECONDS = 0.09

export interface DealTiming {
  /** Seconds before the first card leaves the hand. */
  lead: number
  /** Seconds between consecutive hole cards. */
  step: number
}

/** Hole-card timing: a dealer pitching by hand, or today's quick fan from the deck. */
export function getHoleDealTiming(dealtSeats: number, avatarDeals: boolean): DealTiming {
  if (!avatarDeals) return { lead: 0, step: DEAL_DEFAULT_STEP_SECONDS }
  const cards = Math.max(1, dealtSeats) * 2
  return { lead: DEAL_HOLE_LEAD_SECONDS, step: clamp(HOLE_DEAL_TARGET_SECONDS / cards, HOLE_STEP_MIN, HOLE_STEP_MAX) }
}

/** Seconds (from the deal start) hole card `round` of the seat at `order` leaves the hand. */
export function getHoleCardDelay(order: number, round: number, dealtSeats: number, timing: DealTiming): number {
  return timing.lead + (round * Math.max(1, dealtSeats) + order) * timing.step
}

/** A card thrown across the table flies longer the further it goes. */
export function getDealFlightSeconds(distance: number, baseSeconds: number): number {
  if (!(distance > 0)) return baseSeconds
  return clamp(0.24 + distance * 0.055, baseSeconds, 0.72)
}

/** Who may deal with their hands: a seated, awake, in-hand player (or the hero, via first-person hands), no reduced motion. */
export function canDealerDeal(options: {
  reducedMotion: boolean
  isHero: boolean
  hasRig: boolean
  away: boolean
  passedOut: boolean
  folded: boolean
}): boolean {
  if (options.reducedMotion || options.away || options.passedOut || options.folded) return false
  return options.isHero || options.hasRig
}

/**
 * Hole-card deal: `targets` are where each dealt seat's cards lie, in dealing
 * order (clockwise from the button; the dealer's own seat last). Two rounds.
 */
export function buildHoleDealSchedule(startedAt: number, targets: readonly Vec3[], timing: DealTiming): DealerSchedule {
  const count = targets.length
  const cards: DealerCard[] = []
  for (let round = 0; round < 2; round += 1) {
    for (let order = 0; order < count; order += 1) {
      cards.push({
        kind: 'hole',
        releaseAt: getHoleCardDelay(order, round, count, timing),
        target: [targets[order]![0], targets[order]![1], targets[order]![2]],
        slot: round,
      })
    }
  }
  return finishSchedule(startedAt, cards)
}

export interface BoardDealEntry {
  kind: DealCardKind
  /** Board slot (0..4), or -1 for a burn card. */
  slot: number
  /** Seconds after the board deal starts. */
  offset: number
}

/**
 * Burn-then-deal plan for the board slots about to be dealt (ascending): a
 * burn before the flop, the turn and the river, the flop in a quick spread.
 */
export function planBoardDeal(slots: readonly number[]): BoardDealEntry[] {
  const plan: BoardDealEntry[] = []
  let at = DEAL_BOARD_LEAD_SECONDS
  let lastStreet = -1
  let first = true
  for (const slot of slots) {
    const street = slot < 3 ? 0 : slot - 2
    if (street !== lastStreet) {
      if (!first) at += STREET_GAP_SECONDS
      plan.push({ kind: 'burn', slot: -1, offset: at })
      at += BURN_TO_CARD_SECONDS
      lastStreet = street
    } else {
      at += FLOP_CARD_GAP_SECONDS
    }
    plan.push({ kind: street === 0 ? 'flop' : street === 1 ? 'turn' : 'river', slot, offset: at })
    first = false
  }
  return plan
}

/** Board cards only (no burn cards), in deal order, as the room's slots need them. */
export function getBoardCardOffsets(plan: readonly BoardDealEntry[]): number[] {
  const offsets: number[] = []
  for (const entry of plan) if (entry.slot >= 0) offsets.push(entry.offset)
  return offsets
}

/** `slotTargets[slot]` is where board slot `slot` lies, in the dealer's seat space. */
export function buildBoardDealSchedule(startedAt: number, plan: readonly BoardDealEntry[], slotTargets: readonly Vec3[]): DealerSchedule {
  const cards: DealerCard[] = plan.map(entry => {
    const target = entry.slot >= 0 ? slotTargets[entry.slot] ?? [0, 0, 0] : [0, 0, 0]
    return { kind: entry.kind, releaseAt: entry.offset, target: [target[0], target[1], target[2]], slot: entry.slot }
  })
  return finishSchedule(startedAt, cards)
}

function finishSchedule(startedAt: number, cards: DealerCard[]): DealerSchedule {
  const last = cards.length > 0 ? cards[cards.length - 1]!.releaseAt : 0
  return { startedAt, cards, duration: last + FOLLOW_THROUGH_SECONDS + RETURN_SECONDS + 0.1 }
}

/** The hole card for `order`/`round` or the board card for `slot`: its index in schedule.cards (-1 when absent). */
export function findDealCard(schedule: DealerSchedule, kind: 'hole' | 'board', order: number, round: number, count: number): number {
  if (kind === 'hole') {
    const index = round * count + order
    return index >= 0 && index < schedule.cards.length && schedule.cards[index]!.kind === 'hole' ? index : -1
  }
  // `order` is the board slot.
  for (let index = 0; index < schedule.cards.length; index += 1) {
    const card = schedule.cards[index]!
    if (card.kind !== 'burn' && card.kind !== 'hole' && card.slot === order) return index
  }
  return -1
}

export interface DealerPose {
  /** 0..1 how much of the gesture is in force (eased in over the reach, out after the last card). */
  weight: number
  /** Seat-space wrist targets. */
  handR: Vec3
  handL: Vec3
  /** Head-turn offsets (radians): yaw toward the recipient, pitch down toward the deck / cards. */
  headYaw: number
  headPitch: number
  /** WristR additive rotation (x cock / snap, y, z). */
  wristR: Vec3
  /** Right hand frame: yaw toward the midline, pitch (fingers up), roll. */
  frameYaw: number
  framePitch: number
  frameRoll: number
  /** Right hand shape mix (already scaled by nothing: apply with `weight`). */
  pinch: number
  cock: number
  snap: number
  /** Legacy 0..1 finger curls. */
  curlR: number
  curlL: number
  /** The left hand holds the deck (0..1). */
  holdL: number
  /** Index (in schedule.cards) of the next card to leave the hand. */
  index: number
  /** Cards already released. */
  released: number
}

export function createDealerPose(): DealerPose {
  return {
    weight: 0,
    handR: [0, 0, 0],
    handL: [0, 0, 0],
    headYaw: 0,
    headPitch: 0,
    wristR: [0, 0, 0],
    frameYaw: 0,
    framePitch: 0,
    frameRoll: 0,
    pinch: 0,
    cock: 0,
    snap: 0,
    curlR: 0,
    curlL: 0,
    holdL: 0,
    index: 0,
    released: 0,
  }
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smooth(value: number) {
  const x = clamp01(value)
  return x * x * (3 - 2 * x)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** First card of an interval has no earlier release: it starts this long before. */
const FIRST_INTERVAL_SECONDS = 0.3
const BURN_DIRECTION: readonly [number, number] = [-0.5, -0.87]

const deck: Vec3 = [0, 0, 0]
const spotNext: Vec3 = [0, 0, 0]
const spotPrev: Vec3 = [0, 0, 0]
const cockSpot: Vec3 = [0, 0, 0]
const direction: [number, number] = [0, -1]

/** Where the deck sits: just inside the felt edge in front of the dealer, a touch to the right of centre. */
export function getDealerDeckSpot(anchors: DealerAnchors, out: Vec3): Vec3 {
  out[0] = anchors.tap[0] * 0.3
  out[1] = anchors.tap[1] + 0.09
  out[2] = anchors.tap[2] + 0.1
  return out
}

/** Horizontal unit direction (x, z) from the deck toward a card's target. */
function directionTo(card: DealerCard, from: Vec3, out: [number, number]) {
  let dx: number
  let dz: number
  if (card.kind === 'burn') {
    dx = BURN_DIRECTION[0]
    dz = BURN_DIRECTION[1]
  } else {
    dx = card.target[0] - from[0]
    dz = card.target[2] - from[2]
  }
  const length = Math.hypot(dx, dz)
  if (length < 1e-4) {
    out[0] = 0
    out[1] = -1
  } else {
    out[0] = dx / length
    out[1] = dz / length
  }
}

/** How far past the deck the hand carries a card on the way out (seat units). */
function pitchReach(card: DealerCard, interval: number) {
  if (card.kind === 'burn') return 0.12
  if (card.kind === 'hole') return 0.1 + 0.08 * clamp01((interval - HOLE_STEP_MIN) / (HOLE_STEP_MAX - HOLE_STEP_MIN))
  return 0.3
}

/** How hard the wrist snaps on release. */
function snapScale(card: DealerCard) {
  return card.kind === 'burn' ? 0.35 : card.kind === 'hole' ? 1 : 0.7
}

/** The hand's spot at the moment `card` is released (the wrist), written to `out`. */
function releaseSpot(card: DealerCard, interval: number, anchors: DealerAnchors, out: Vec3) {
  getDealerDeckSpot(anchors, deck)
  directionTo(card, deck, direction)
  const reach = pitchReach(card, interval)
  out[0] = deck[0] + direction[0] * reach
  out[1] = deck[1] + (card.kind === 'hole' ? 0.045 : 0.09)
  out[2] = deck[2] + direction[1] * reach
  return out
}

function intervalBefore(cards: readonly DealerCard[], index: number) {
  return index > 0 ? cards[index]!.releaseAt - cards[index - 1]!.releaseAt : FIRST_INTERVAL_SECONDS
}

/**
 * Where card `index` leaves the hand, in the dealer's seat space: the fingertips
 * at the flick (a little past the wrist). Used when there is no rig to read.
 */
export function getDealCardRelease(schedule: DealerSchedule, index: number, anchors: DealerAnchors, out: Vec3): Vec3 {
  const card = schedule.cards[index]
  if (!card) {
    getDealerDeckSpot(anchors, out)
    return out
  }
  releaseSpot(card, intervalBefore(schedule.cards, index), anchors, out)
  directionTo(card, deck, direction)
  out[0] += direction[0] * 0.1
  out[1] -= 0.015
  out[2] += direction[1] * 0.1
  return out
}

function yawToward(card: DealerCard, anchors: DealerAnchors) {
  if (card.kind === 'burn') return 0.12
  const dx = card.target[0] - anchors.chin[0]
  const dz = card.target[2] - anchors.chin[2]
  const yaw = Math.atan2(-dx, -dz)
  return Number.isFinite(yaw) ? clamp(yaw, -1.15, 1.15) : 0
}

function pitchToward(card: DealerCard, anchors: DealerAnchors) {
  if (card.kind === 'burn') return 0.2
  const dx = card.target[0] - anchors.chin[0]
  const dz = card.target[2] - anchors.chin[2]
  const distance = Math.hypot(dx, dz)
  const drop = anchors.chin[1] - card.target[1]
  const pitch = Math.atan2(drop, Math.max(0.3, distance)) * 0.5
  // The board is a glance up from the deck; a seat's cards are a look down at them.
  return clamp(pitch - (card.kind === 'hole' ? 0 : 0.05), -0.05, 0.36)
}

const DECK_LOOK_PITCH = 0.22

/**
 * The dealer's pose `elapsed` seconds into `schedule`. Allocation-free: writes
 * into (and returns) `out`. Weight is 0 outside the gesture.
 *
 * Each card is one stroke: the hand comes back to the deck (fingers closing in
 * a relaxed pinch), draws back and cocks (fingers curl behind the thumb), then
 * snaps out toward the recipient and lets the card go. The head swings from the
 * deck to the recipient and is on them as the card leaves.
 */
export function getDealerPose(
  elapsed: number,
  schedule: DealerSchedule | null,
  anchors: DealerAnchors,
  out: DealerPose,
  poseLead = DEAL_POSE_LEAD_SECONDS
): DealerPose {
  out.weight = 0
  out.released = 0
  out.index = 0
  if (!schedule || schedule.cards.length === 0 || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > schedule.duration) return out
  const cards = schedule.cards
  const count = cards.length
  const t = elapsed + poseLead
  const first = cards[0]!.releaseAt
  const last = cards[count - 1]!.releaseAt

  let index = 0
  while (index < count && cards[index]!.releaseAt < t) index += 1
  const done = index >= count
  const target = cards[done ? count - 1 : index]!
  const prev = index > 0 ? cards[index - 1]! : null

  const intervalEnd = target.releaseAt
  const interval = done ? intervalBefore(cards, count - 1) : intervalBefore(cards, index)
  const intervalStart = done ? last : prev ? prev.releaseAt : intervalEnd - FIRST_INTERVAL_SECONDS
  const u = done ? 1 : clamp01((t - intervalStart) / Math.max(0.05, intervalEnd - intervalStart))

  // Envelope: eased in over the reach, out after the last card.
  const wIn = smooth(t / Math.max(0.2, first * 0.75))
  const wOut = 1 - smooth((t - last - FOLLOW_THROUGH_SECONDS) / RETURN_SECONDS)
  out.weight = Math.min(wIn, wOut)
  out.index = done ? count : index
  out.released = index

  getDealerDeckSpot(anchors, deck)

  // Right hand path: previous pitch spot -> deck (pick up) -> cocked back -> out.
  releaseSpot(target, interval, anchors, spotNext)
  if (prev) releaseSpot(prev, intervalBefore(cards, index - 1), anchors, spotPrev)
  else { spotPrev[0] = deck[0]; spotPrev[1] = deck[1] + 0.05; spotPrev[2] = deck[2] }
  directionTo(target, deck, direction)
  const reach = pitchReach(target, interval)
  cockSpot[0] = deck[0] - direction[0] * reach * 0.55
  cockSpot[1] = deck[1] + 0.07
  cockSpot[2] = deck[2] - direction[1] * reach * 0.55
  let x: number
  let y: number
  let z: number
  if (done) {
    x = spotNext[0]; y = spotNext[1]; z = spotNext[2]
  } else if (u < 0.4) {
    const s = smooth(u / 0.4)
    x = lerp(spotPrev[0], deck[0], s); y = lerp(spotPrev[1], deck[1], s); z = lerp(spotPrev[2], deck[2], s)
  } else if (u < 0.72) {
    const s = smooth((u - 0.4) / 0.32)
    x = lerp(deck[0], cockSpot[0], s); y = lerp(deck[1], cockSpot[1], s); z = lerp(deck[2], cockSpot[2], s)
  } else {
    // Accelerates into the snap.
    const s = (u - 0.72) / 0.28
    const e = s * s
    x = lerp(cockSpot[0], spotNext[0], e); y = lerp(cockSpot[1], spotNext[1], e); z = lerp(cockSpot[2], spotNext[2], e)
  }
  out.handR[0] = x
  out.handR[1] = y
  out.handR[2] = z

  // Left hand holds the deck, a hand's width to the left of the pick-up spot.
  out.handL[0] = deck[0] - 0.2
  out.handL[1] = deck[1] - 0.025
  out.handL[2] = deck[2] + 0.06
  out.holdL = 1
  out.curlL = 0.45

  // Fingers: open after the flick, a relaxed pinch on the deck, cocked behind the thumb, then the snap.
  const cock = done ? 0 : smooth((u - 0.4) / 0.32)
  const approach = done ? 0 : smooth((t - (intervalEnd - 0.07)) / 0.07)
  const tail = prev || done ? 1 - smooth((t - (done ? last : prev!.releaseAt)) / 0.16) : 0
  const scale = snapScale(done ? target : tail > approach && prev ? prev : target)
  const snap = Math.max(approach, tail) * scale
  out.cock = cock
  out.snap = snap
  out.pinch = done ? 0 : smooth((u - 0.12) / 0.25) * (1 - cock)
  out.curlR = 0.3 * (1 - snap) + 0.12 * snap
  out.wristR[0] = -0.3 * cock * (1 - snap) + 0.55 * snap
  out.wristR[1] = 0
  out.wristR[2] = 0
  out.frameYaw = 0.05
  out.framePitch = -0.1 + 0.2 * cock - 0.12 * snap
  out.frameRoll = 0.1

  // Head: down at the deck while picking up, then round to the recipient by the release.
  const yawNext = yawToward(target, anchors)
  const pitchNext = pitchToward(target, anchors)
  const yawPrev = prev ? yawToward(prev, anchors) : 0
  const pitchPrev = prev ? pitchToward(prev, anchors) : DECK_LOOK_PITCH
  const swing = done ? 1 : smooth((u - 0.3) / 0.45)
  // Eyes dip to the deck in the middle of each stroke.
  const dip = done ? 0 : Math.sin(clamp01((u - 0.1) / 0.45) * Math.PI) * 0.07
  out.headYaw = lerp(yawPrev, yawNext, swing)
  out.headPitch = lerp(pitchPrev, pitchNext, swing) + dip
  return out
}
