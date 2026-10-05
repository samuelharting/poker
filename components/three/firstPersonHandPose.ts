import { ACTION_ANIMATION_DURATION_MS } from './pokerActionPose'
import type { PokerActionMotionProfile } from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'
import { CHIP_FLICK_GESTURE_SECONDS, CHIP_LAUNCH_AT } from './prankTimeline'

/**
 * The hero's own hands, seen first-person: a pure, allocation-free timeline.
 *
 * Everything is in screen terms (NDC, -1..1, y up) plus a fixed camera-space
 * depth, because the hands ride on the camera like the first-person drink. The
 * rig (firstPersonHands.ts) turns a HandPose into a transform and finger
 * morphs; the room only feeds it the cue, the clock and a few projected points
 * (the hero's stack and betting spot). Nothing here touches three.js.
 */

export interface HandPose {
  /** Wrist position on screen (NDC). */
  x: number
  y: number
  /** Distance in front of the lens (metres). Never below MIN_HAND_DEPTH. */
  depth: number
  /** Fingers pitched up the screen (rad). */
  pitch: number
  /** Fingers turned toward the middle of the table (rad, mirrored for the left hand). */
  yaw: number
  roll: number
  /** Finger shape mix: relaxed + fist + open + pinch. */
  fist: number
  open: number
  pinch: number
  /** 0 = slid away below the frame, 1 = in view. */
  show: number
}

export interface CardTossPose {
  visible: boolean
  x: number
  y: number
  depth: number
  roll: number
  yaw: number
  /** 1 = full size. */
  scale: number
  /** How far the second card fans out from the first (0..1). */
  spread: number
}

export interface HeroHandsPose {
  right: HandPose
  left: HandPose
  cards: CardTossPose
}

export function createHandPose(): HandPose {
  return { x: 0, y: -0.8, depth: HAND_DEPTH, pitch: REST_PITCH, yaw: 0, roll: 0, fist: 0, open: 0, pinch: 0, show: 1 }
}

export function createHeroHandsPose(): HeroHandsPose {
  return {
    right: createHandPose(),
    left: createHandPose(),
    cards: { visible: false, x: 0, y: 0, depth: HAND_DEPTH, roll: 0, yaw: 0, scale: 1, spread: 0 },
  }
}

/** Hands sit this far in front of the lens: close enough to read as yours, never near the 0.1 clip plane. */
export const HAND_DEPTH = 0.72
export const MIN_HAND_DEPTH = 0.45
/** Fingers lean up the screen this much when the hand lies on the rail. */
export const REST_PITCH = 0.5
/** Resting hands: low on the screen, either side of the hole cards. */
export const REST_Y = -0.8
export const REST_X = 0.27
/** The wrist sits this far (NDC) below whatever the fingertips are working on. */
const WRIST_BELOW = 0.17
/** The hands never travel above this line: the board and the pot stay clear. */
export const MAX_REACH_Y = -0.27
/**
 * Where the dealing hands work (wrist, NDC): well above the hole-card tray and the
 * pot label (DOM overlays at the bottom of the view), so the deal is visible rather
 * than a ghost behind them. The gesture's own table point projects below the
 * screen for the hero (clamped to -1), so only its cock/snap shape is used; the
 * card leaves the drawn fingertips (see getHeroDealTipWorld).
 */
export const DEAL_RIGHT_X = 0.1
export const DEAL_RIGHT_Y = -0.34
export const DEAL_LEFT_X = -0.1
export const DEAL_LEFT_Y = -0.4
/** Where a knuckle tap lands (on the rail, just above the hole cards). */
const TAP_X = 0.12
const TAP_Y = -0.5
/** Wager chips leave the stack this long after the action starts (see syncWagers). */
export const WAGER_DEPART_SECONDS = 0.25
const WIN_HOLD_SECONDS = 3.2

export interface HeroHandsAnchors {
  /** Resting x of each hand (NDC); the room nudges these to clear the action tray. */
  restRightX: number
  restLeftX: number
  /** The hero's chip stack, where a wager is grabbed (NDC). */
  stackX: number
  stackY: number
  /** The hero's betting spot (NDC). */
  betX: number
  betY: number
  /** The hole cards' spot at the bottom of the view (NDC). */
  cardsX: number
  cardsY: number
}

export function createHeroHandsAnchors(): HeroHandsAnchors {
  return { restRightX: REST_X, restLeftX: -REST_X, stackX: 0.2, stackY: -0.4, betX: 0.05, betY: -0.3, cardsX: 0, cardsY: -0.7 }
}

/** The dealer gesture (dealerDeal.getDealerPose) mapped onto the screen by the rig. */
export interface HeroDealInput {
  /** 0..1 how much of the gesture is in force. */
  weight: number
  rightX: number
  rightY: number
  leftX: number
  leftY: number
  pinch: number
  cock: number
  snap: number
  holdLeft: number
}

export interface HeroHandsInput {
  cue: ThreeActionCue
  /** Milliseconds since the action began (any value >= the gesture length means it is over). */
  elapsedMs: number
  /** Motion personality shared with the avatars and the chips. */
  profile: Pick<PokerActionMotionProfile, 'foldStyle' | 'checkStyle' | 'wagerStyle' | 'wagerIntensity'>
  /** The server says the hero is looking at their hole cards. */
  peeking: boolean
  /** Seconds since the hero became a winner (-1 when not). */
  winnerSeconds: number
  /** Seconds since the hero flicked a chip at someone (-1 when not). */
  flickSeconds: number
  /** The hero is dealing by hand: wrist targets already projected to the screen (null when not). */
  deal: HeroDealInput | null
  /** Scene time (s) for idle motion. */
  time: number
  /** 0..~8: drunk hands wander. */
  drunkLevel: number
  reducedMotion: boolean
  anchors: HeroHandsAnchors
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const smooth = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}
const easeInOut = (value: number) => {
  const t = clamp01(value)
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Seconds the chips take to reach the betting spot (matches animateWagers in the room). */
export function getWagerTravelSeconds(profile: Pick<PokerActionMotionProfile, 'wagerStyle' | 'wagerIntensity'>): number {
  return profile.wagerStyle === 'flick'
    ? 0.78 - profile.wagerIntensity * 0.08
    : profile.wagerStyle === 'shove'
      ? 0.62 - profile.wagerIntensity * 0.06
      : 0.72
}

/** How long each gesture needs, in seconds (the hands are back at rest afterwards). */
export function getHeroGestureSeconds(cue: ThreeActionCue, profile: Pick<PokerActionMotionProfile, 'wagerStyle' | 'wagerIntensity'>): number {
  switch (cue) {
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in':
      return WAGER_DEPART_SECONDS + getWagerTravelSeconds(profile) + 0.5
    case 'check':
      return ACTION_ANIMATION_DURATION_MS / 1000 + 0.1
    case 'fold':
      return ACTION_ANIMATION_DURATION_MS / 1000 + 0.45
    default:
      return 0
  }
}

function setRest(hand: HandPose, side: 1 | -1, anchors: HeroHandsAnchors) {
  hand.x = side === 1 ? anchors.restRightX : anchors.restLeftX
  hand.y = REST_Y
  hand.depth = HAND_DEPTH
  hand.pitch = REST_PITCH
  hand.yaw = 0.14
  hand.roll = 0.05
  hand.fist = 0
  hand.open = 0
  hand.pinch = 0
  hand.show = 1
}

function blendTo(hand: HandPose, x: number, y: number, t: number) {
  hand.x = lerp(hand.x, x, t)
  hand.y = lerp(hand.y, y, t)
}

/**
 * Writes the hands' target pose for this instant. Allocation-free.
 * Priority: a chip flick / the action in progress, then the win, then peeking,
 * then resting. Reduced motion keeps the hands resting (no gestures).
 */
export function evaluateHeroHands(input: HeroHandsInput, out: HeroHandsPose): HeroHandsPose {
  const { anchors } = input
  setRest(out.right, 1, anchors)
  setRest(out.left, -1, anchors)
  out.cards.visible = false
  out.cards.scale = 1
  out.cards.spread = 0

  if (input.reducedMotion) return out

  const e = input.elapsedMs / 1000
  const length = getHeroGestureSeconds(input.cue, input.profile)
  const acting = e >= 0 && e < length && length > 0
  const flicking = input.flickSeconds >= 0 && input.flickSeconds < CHIP_FLICK_GESTURE_SECONDS

  if (input.deal && input.deal.weight > 0.001) {
    poseDeal(input.deal, out)
  } else if (flicking) {
    poseFlick(input.flickSeconds, out.right, anchors)
  } else if (acting && input.cue === 'check') {
    poseCheck(e, input, out.right)
  } else if (acting && input.cue === 'fold') {
    poseFold(e, input, out)
  } else if (acting && (input.cue === 'call' || input.cue === 'bet' || input.cue === 'raise' || input.cue === 'all_in')) {
    poseWager(e, input, out)
  } else if (input.winnerSeconds >= 0 && input.winnerSeconds < WIN_HOLD_SECONDS + 0.6) {
    poseWin(input.winnerSeconds, out)
  } else if (input.peeking) {
    posePeek(out, anchors)
  } else if (!input.reducedMotion) {
    poseIdle(input, out)
  }
  return out
}

/** A very small breath and a slow finger drift while the hands rest. */
function poseIdle(input: HeroHandsInput, out: HeroHandsPose) {
  const t = input.time
  out.right.y += Math.sin(t * 1.1) * 0.006
  out.left.y += Math.sin(t * 1.1 + 1.7) * 0.006
  out.right.fist = 0.04 + 0.04 * Math.sin(t * 0.7)
  out.left.fist = 0.04 + 0.04 * Math.sin(t * 0.6 + 2)
}

function posePeek(out: HeroHandsPose, anchors: HeroHandsAnchors) {
  // Thumb and finger pinch the near corner of each card, lifting it.
  const lift = 0.012
  const right = out.right
  const left = out.left
  right.x = anchors.cardsX + 0.2
  right.y = anchors.cardsY - 0.1 + lift
  right.pitch = 0.62
  right.yaw = 0.55
  right.roll = 0.12
  right.pinch = 1
  left.x = anchors.cardsX - 0.2
  left.y = anchors.cardsY - 0.1 + lift
  left.pitch = 0.62
  left.yaw = 0.55
  left.roll = 0.12
  left.pinch = 1
}

function poseCheck(e: number, input: HeroHandsInput, hand: HandPose) {
  const style = input.profile.checkStyle
  const knuckle = style === 'knuckle' ? 1.25 : 1
  const reach = smooth(e / 0.16)
  const first = Math.sin(clamp01((e - 0.14) / 0.2) * Math.PI)
  const second = style === 'double' ? Math.sin(clamp01((e - 0.4) / 0.2) * Math.PI) * 0.9 : 0
  const strike = Math.max(first, second)
  const back = smooth((e - 0.62) / 0.3)
  const hold = reach * (1 - back)
  blendTo(hand, TAP_X + 0.02 * strike, TAP_Y - 0.065 * strike * knuckle, hold)
  hand.pitch = REST_PITCH - 0.22 * strike * hold
  hand.yaw = 0.14 - 0.1 * hold
  hand.fist = hold * (0.5 + 0.42 * strike * knuckle)
  hand.fist = Math.min(1, hand.fist)
}

function poseFold(e: number, input: HeroHandsInput, out: HeroHandsPose) {
  const style = input.profile.foldStyle
  const tempo = style === 'snap' ? 1.25 : style === 'toss' ? 1.05 : 0.9
  const t = e * tempo
  const { anchors } = input
  const hand = out.right
  const gatherX = anchors.cardsX + 0.1
  const gatherY = anchors.cardsY - 0.1
  const tossX = anchors.cardsX - 0.34
  const tossY = -0.3
  const reach = smooth(t / 0.22)
  const sweep = smooth((t - 0.26) / 0.3)
  const back = smooth((t - 0.78) / 0.3)
  blendTo(hand, gatherX, gatherY, reach)
  hand.x = lerp(hand.x, tossX, sweep)
  hand.y = lerp(hand.y, tossY, sweep)
  const arc = style === 'toss' ? 0.1 : style === 'snap' ? 0.03 : 0.05
  hand.y += Math.sin(sweep * Math.PI) * arc
  const rest = out.left
  const away = reach * (1 - back)
  // Return to the rail.
  hand.x = lerp(hand.x, anchors.restRightX, back)
  hand.y = lerp(hand.y, REST_Y, back)
  const release = smooth((t - 0.56) / 0.08)
  hand.fist = smooth((t - 0.12) / 0.12) * 0.62 * (1 - release)
  hand.open = release * (1 - back) * 0.9
  hand.pitch = REST_PITCH + 0.15 * sweep * (1 - back)
  hand.yaw = 0.14 + 0.5 * sweep * (1 - back)
  hand.roll = 0.05 - 0.35 * sweep * (1 - back) * (style === 'toss' ? 1.4 : 1)
  // The left hand steadies the rail while the right one works.
  rest.y += 0.02 * away

  // The two cards: slide in under the hand, ride with it, then fly off toward the muck.
  const cards = out.cards
  const grab = smooth((t - 0.2) / 0.12)
  const flightT = clamp01((t - 0.56) / 0.5)
  if (t >= 0.14 && flightT < 1) {
    cards.visible = true
    const carryX = lerp(anchors.cardsX, hand.x, grab) + 0.0
    const carryY = lerp(anchors.cardsY, hand.y + 0.1, grab)
    const flightX = tossX - 0.22 * flightT * (style === 'snap' ? 1.4 : 1)
    const flightY = tossY + 0.14 + 0.2 * flightT - 0.1 * flightT * flightT * 2
    cards.x = flightT > 0 ? flightX : carryX
    cards.y = flightT > 0 ? flightY : carryY
    cards.depth = HAND_DEPTH + 1.5 * flightT
    cards.scale = 1 - 0.55 * flightT
    cards.roll = -0.15 - 1.4 * flightT * (style === 'toss' ? 1.5 : 1)
    cards.yaw = 0.7 * flightT
    cards.spread = smooth(t / 0.4) * 0.5 + flightT * 0.5
  }
}

function poseWager(e: number, input: HeroHandsInput, out: HeroHandsPose) {
  const { anchors, profile, cue } = input
  const travel = getWagerTravelSeconds(profile)
  const departAt = WAGER_DEPART_SECONDS
  const arriveAt = departAt + travel
  const reach = smooth(e / 0.22)
  const push = easeInOut((e - departAt) / travel)
  const back = smooth((e - arriveAt - 0.08) / 0.38)
  const release = smooth((e - arriveAt + 0.06) / 0.12)
  const grab = smooth((e - 0.1) / 0.12)
  const lift = profile.wagerStyle === 'flick' ? 0.1 : profile.wagerStyle === 'shove' ? 0.02 : 0.045
  const allIn = cue === 'all_in'
  const bigger = cue === 'raise' || allIn ? 1.1 : 1

  const stackY = Math.min(MAX_REACH_Y, anchors.stackY - WRIST_BELOW)
  const betY = Math.min(MAX_REACH_Y, anchors.betY - WRIST_BELOW)
  const side: Array<1 | -1> = allIn ? [1, -1] : [1]
  for (let index = 0; index < side.length; index += 1) {
    const sign = side[index]!
    const hand = sign === 1 ? out.right : out.left
    // An all-in shoves with both hands, a hand's width either side of the pile.
    const spread = allIn ? 0.11 * sign : 0.0
    const stackX = anchors.stackX + spread + (allIn ? 0 : 0.02)
    const betX = anchors.betX + spread
    const restX = sign === 1 ? anchors.restRightX : anchors.restLeftX
    let x = lerp(restX, stackX, reach)
    let y = lerp(REST_Y, stackY, reach)
    x = lerp(x, betX, push)
    y = lerp(y, betY, push)
    y += Math.sin(push * Math.PI) * lift * bigger
    x = lerp(x, restX, back)
    y = lerp(y, REST_Y, back)
    hand.x = x
    hand.y = y
    hand.pitch = REST_PITCH + 0.2 * push * (1 - back) + 0.08 * reach
    hand.yaw = 0.14 + 0.1 * reach * (1 - back)
    hand.roll = 0.05 - 0.14 * push * (1 - back)
    hand.fist = grab * 0.7 * (1 - release)
    hand.open = release * (1 - back) * 0.65
    hand.depth = HAND_DEPTH - 0.04 * push * (1 - back)
  }
}

function poseWin(w: number, out: HeroHandsPose) {
  // Both fists up and pumping, then they come back down. The hands are not mirror
  // images: the right is the lead (higher, tighter, quicker), the left follows a
  // beat behind and a little looser, each punching up and easing back down with
  // its own sway and wrist roll instead of bobbing in lockstep.
  const raise = smooth(w / 0.4) * (1 - smooth((w - WIN_HOLD_SECONDS) / 0.55))
  for (const sign of [1, -1] as const) {
    const hand = sign === 1 ? out.right : out.left
    const lead = sign === 1
    const cycle = w * (lead ? 2.3 : 2.0) - (lead ? 0 : 0.28)
    const phase = cycle - Math.floor(cycle)
    // A quick punch up, a slower pull down.
    const punch = phase < 0.28 ? smooth(phase / 0.28) : 1 - smooth((phase - 0.28) / 0.72)
    const sway = Math.sin(w * (lead ? 3.1 : 2.6) + (lead ? 0 : 1.3))
    hand.x = lerp(hand.x, 0.47 * sign + 0.035 * sway * sign, raise)
    hand.y = lerp(hand.y, (lead ? -0.12 : -0.2) + 0.1 * punch, raise)
    hand.pitch = lerp(hand.pitch, 0.85 + 0.2 * punch, raise)
    hand.yaw = lerp(hand.yaw, 0.1 + 0.08 * sway, raise)
    hand.roll = lerp(hand.roll, 0.3 + 0.16 * sway - 0.1 * punch, raise)
    hand.fist = raise * (lead ? 0.95 : 0.8) * (0.9 + 0.1 * punch)
    hand.open = raise * (lead ? 0 : 0.12) * (1 - punch)
    hand.depth = HAND_DEPTH + (0.06 - 0.05 * punch) * raise
  }
}

/** Dealing: the right hand cocks and snaps cards off the deck, the left steadies it. */
function poseDeal(deal: HeroDealInput, out: HeroHandsPose) {
  const w = clamp01(deal.weight)
  const right = out.right
  const left = out.left
  right.x = lerp(right.x, DEAL_RIGHT_X - 0.03 * deal.cock + 0.02 * deal.snap, w)
  right.y = lerp(right.y, DEAL_RIGHT_Y - 0.05 * deal.cock + 0.07 * deal.snap, w)
  right.pitch = REST_PITCH + w * (0.12 - 0.28 * deal.cock + 0.35 * deal.snap)
  right.yaw = 0.14 + w * 0.1
  right.pinch = deal.pinch * w
  right.fist = 0.4 * deal.cock * w
  right.open = 0.9 * deal.snap * w
  left.x = lerp(left.x, DEAL_LEFT_X, w)
  left.y = lerp(left.y, DEAL_LEFT_Y, w)
  left.pitch = REST_PITCH + 0.08 * w
  left.fist = 0.5 * deal.holdLeft * w
}

function poseFlick(f: number, hand: HandPose, anchors: HeroHandsAnchors) {
  // Thumb-and-finger flick at the launch point just right of centre.
  const reach = smooth(f / 0.2)
  const snap = smooth((f - CHIP_LAUNCH_AT) / 0.07)
  const back = smooth((f - 0.62) / 0.35)
  const hold = reach * (1 - back)
  blendTo(hand, anchors.cardsX + 0.24, -0.5, hold)
  hand.pitch = REST_PITCH + 0.1 * hold
  hand.yaw = 0.14 + 0.2 * hold
  hand.pinch = hold * (1 - snap)
  hand.open = snap * (1 - back) * 0.9
  hand.fist = 0
}

/** Smoothing for pose channels (per second); gestures are already smooth in time. */
export const HAND_FOLLOW_RATE = 16

const CHANNELS = ['x', 'y', 'depth', 'pitch', 'yaw', 'roll', 'fist', 'open', 'pinch', 'show'] as const

/** Exponentially eases `current` toward `target` (the hand's own lag, so state changes never snap). */
export function followHandPose(current: HandPose, target: HandPose, dt: number, snap: boolean) {
  const k = snap ? 1 : 1 - Math.exp(-Math.max(0, dt) * HAND_FOLLOW_RATE)
  for (let index = 0; index < CHANNELS.length; index += 1) {
    const channel = CHANNELS[index]!
    current[channel] += (target[channel] - current[channel]) * k
  }
}
