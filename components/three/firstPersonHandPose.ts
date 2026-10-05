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
  /** Idle finger drift (-1..1): index and middle lift while ring and little finger tuck. */
  flutter: number
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
  return { x: 0, y: -0.8, depth: HAND_DEPTH, pitch: REST_PITCH, yaw: 0, roll: 0, fist: 0, open: 0, pinch: 0, flutter: 0, show: 1 }
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
/**
 * Pushing chips: the wrist sits this far (NDC) below the pile, so the fingertips
 * stop at the pile's near edge and the hand pushes from behind instead of
 * covering the chips it is moving.
 */
const WRIST_BELOW = 0.27
/** Beyond the hole-card tray's half width (NDC), how far its influence on a passing hand reaches. */
const CARDS_CLEAR_FADE = 0.1
/** The hand trails the chips by this long (s): the pile leads, the hand follows. */
const PUSH_LAG_SECONDS = 0.05
/** The hands never travel above this line: the board and the pot stay clear. */
export const MAX_REACH_Y = -0.27
/**
 * Where the dealing hands work (wrist, NDC): well above the hole-card tray and the
 * pot label (DOM overlays at the bottom of the view), so the deal is visible rather
 * than a ghost behind them. The gesture's own table point projects below the
 * screen for the hero (clamped to -1), so only its cock/snap shape is used; the
 * card leaves the drawn fingertips (see getHeroDealTipWorld).
 */
export const DEAL_RIGHT_X = 0.34
export const DEAL_RIGHT_Y = -0.44
export const DEAL_LEFT_X = -0.34
export const DEAL_LEFT_Y = -0.48
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
  /** The tray's half width and its top edge (NDC), measured from the DOM row (it is taller at 720p). */
  cardsHalfW: number
  cardsTopY: number
  /**
   * Where the dealing hands work (wrists, NDC). The room moves these out to the
   * sides of the pot readout and the hole-card tray, so the hands are seen
   * flanking the table's middle instead of sitting under those overlays.
   */
  dealRightX: number
  dealRightY: number
  dealLeftX: number
  dealLeftY: number
  /**
   * The pot readout (a DOM label over the felt, NDC): centre x, half width and
   * bottom edge. A reaching hand stays below it instead of disappearing under it
   * (potHalfW 0 = no label measured).
   */
  potX: number
  potHalfW: number
  potBottomY: number
}

export function createHeroHandsAnchors(): HeroHandsAnchors {
  return { restRightX: REST_X, restLeftX: -REST_X, stackX: 0.2, stackY: -0.4, betX: 0.05, betY: -0.3, cardsX: 0, cardsY: -0.7, cardsHalfW: 0.15, cardsTopY: -0.5, dealRightX: DEAL_RIGHT_X, dealRightY: DEAL_RIGHT_Y, dealLeftX: DEAL_LEFT_X, dealLeftY: DEAL_LEFT_Y, potX: 0, potHalfW: 0, potBottomY: 1 }
}

/** Half the width of the column a hand must keep out of to stay clear of the hole-card tray (NDC). */
function cardColumn(anchors: HeroHandsAnchors) {
  return anchors.cardsHalfW + HAND_SCREEN_HALF_W - 0.025
}

/** Wrist to fingertips as drawn on screen (NDC) for a hand reaching up the felt. */
const HAND_SCREEN_REACH = 0.23
/** Half the drawn hand's width on screen (NDC). */
const HAND_SCREEN_HALF_W = 0.075

/**
 * Keeps a wrist low enough that the fingers stop just short of the pot label
 * when the hand is under it (a soft edge either side, so a hand passing by is
 * never yanked down).
 */
export function clearPotLabel(y: number, x: number, anchors: HeroHandsAnchors): number {
  if (anchors.potHalfW <= 0) return y
  const reach = Math.abs(x - anchors.potX) - anchors.potHalfW - HAND_SCREEN_HALF_W
  // Full clearance while the hand overlaps the label and a little beyond (the fingers
  // lean in toward the middle of the table), easing off further out.
  const under = 1 - smooth((reach - 0.04) / 0.06)
  if (under <= 0) return y
  const ceiling = anchors.potBottomY - 0.02 - HAND_SCREEN_REACH
  return y > ceiling ? lerp(y, ceiling, under) : y
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
  // The hands are not mirror images: the left lies a touch flatter and more turned in.
  hand.yaw = side === 1 ? 0.14 : 0.19
  hand.roll = side === 1 ? 0.05 : 0.08
  hand.fist = 0
  hand.open = 0
  hand.pinch = 0
  hand.flutter = 0
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
    poseDeal(input.deal, out, anchors)
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

/**
 * Idle: a slow breath that lifts and settles the wrists, a hair of sway, and
 * fingers that drift on their own slow clocks (right and left never in step).
 */
function poseIdle(input: HeroHandsInput, out: HeroHandsPose) {
  const t = input.time
  const breath = Math.sin(t * 1.15)
  const breathLeft = Math.sin(t * 1.15 + 0.9)
  out.right.y += breath * 0.0055
  out.left.y += breathLeft * 0.0055
  out.right.x += Math.sin(t * 0.37 + 1.1) * 0.003
  out.left.x += Math.sin(t * 0.31 + 2.4) * 0.003
  out.right.pitch += breath * 0.012
  out.left.pitch += breathLeft * 0.012
  out.right.roll += Math.sin(t * 0.43) * 0.012
  out.left.roll += Math.sin(t * 0.39 + 1.7) * 0.012
  out.right.fist = 0.04 + 0.035 * Math.sin(t * 0.7)
  out.left.fist = 0.04 + 0.035 * Math.sin(t * 0.6 + 2)
  out.right.flutter = 0.55 * Math.sin(t * 0.52 + 0.4) * Math.sin(t * 0.21)
  out.left.flutter = 0.55 * Math.sin(t * 0.47 + 2.1) * Math.sin(t * 0.19 + 1)
  // Now and then the weight drifts onto one forearm: both hands slide a touch the same
  // way and the loaded wrist rolls in (slow, irregular, never a loop you can spot).
  const shift = Math.sin(t * 0.23 + 0.7) * Math.sin(t * 0.11)
  out.right.x += 0.009 * shift
  out.left.x += 0.007 * shift
  out.right.roll += 0.03 * Math.max(0, shift)
  out.left.roll += 0.03 * Math.max(0, -shift)
}

function posePeek(out: HeroHandsPose, anchors: HeroHandsAnchors) {
  // Thumb and finger pinch the near corner of each card, lifting it.
  // The hands sit just outside the cards with the fingers turned in under their
  // outer edges (the card tray is drawn over them), so most of each hand shows.
  const lift = 0.012
  const right = out.right
  const left = out.left
  right.x = anchors.cardsX + anchors.cardsHalfW + 0.075
  right.y = anchors.cardsY - 0.075 + lift
  right.pitch = 0.6
  right.yaw = 0.78
  right.roll = 0.16
  right.pinch = 1
  left.x = anchors.cardsX - anchors.cardsHalfW - 0.085
  left.y = anchors.cardsY - 0.085 + lift
  left.pitch = 0.58
  left.yaw = 0.82
  left.roll = 0.2
  left.pinch = 0.9
}

/**
 * One rap of a check tap (0 = hovering, 1 = on the rail): an accelerating drop
 * that lands at `at`, then a quick rebound, like a knuckle hitting wood.
 */
export function checkRap(e: number, at: number): number {
  const d = e - at
  if (d < -0.075 || d > 0.13) return 0
  if (d < 0) {
    const p = (d + 0.075) / 0.075
    return p * p
  }
  return 1 - smooth(d / 0.13)
}

/**
 * Check: the hand lifts off the rail where it rests (just right of the hole
 * cards, clear of every overlay), cocks back at the wrist, and raps the rail:
 * a double knuckle rap, a two-finger double tap, or one firm rap, then settles.
 */
function poseCheck(e: number, input: HeroHandsInput, hand: HandPose) {
  const { anchors } = input
  const style = input.profile.checkStyle
  const knuckle = style === 'knuckle'
  const fingers = style === 'double'
  const lift = smooth(e / 0.15)
  const back = smooth((e - 0.6) / 0.32)
  const hold = lift * (1 - back)
  const first = checkRap(e, 0.25)
  const second = knuckle || fingers ? checkRap(e, knuckle ? 0.4 : 0.43) * 0.8 : 0
  const strike = Math.max(first, second)
  // Hover a hand's height above the spot, wrist cocked up; each rap drops onto the rail.
  const hover = 0.095 * (1 - strike)
  const tapX = anchors.restRightX - 0.03
  const tapY = REST_Y + 0.07
  hand.x = lerp(hand.x, tapX + 0.008 * strike, hold)
  hand.y = lerp(hand.y, tapY + hover - 0.012 * strike, hold)
  hand.depth = HAND_DEPTH + 0.02 * hold * (1 - strike)
  hand.pitch = REST_PITCH + (0.24 * (1 - strike) - 0.12 * strike) * hold
  hand.yaw = 0.14 + 0.08 * hold
  hand.roll = 0.05 - 0.06 * hold
  if (fingers) {
    // Index and middle out, the others tucked: a two-finger tap.
    hand.fist = 0.3 * hold
    hand.flutter = 1 * hold
  } else {
    hand.fist = Math.min(1, hold * (knuckle ? 0.88 + 0.12 * strike : 0.62 + 0.2 * strike))
  }
}

function poseFold(e: number, input: HeroHandsInput, out: HeroHandsPose) {
  const style = input.profile.foldStyle
  const tempo = style === 'snap' ? 1.25 : style === 'toss' ? 1.05 : 0.9
  const t = e * tempo
  const { anchors } = input
  const hand = out.right
  // Fingers over the top edge of the hole cards (the near edge sits under the
  // card tray), then a short lift-and-flick forward toward the middle: the hand
  // stays low and in front of the player instead of sweeping across the table.
  // Picked up by the top corner of the right-hand card, lifted just beside the tray
  // and flicked in toward the middle: the hand never crosses behind the card tray.
  const gatherX = anchors.cardsX + anchors.cardsHalfW * 0.75
  const gatherY = anchors.cardsTopY - 0.08
  const tossX = anchors.cardsX + cardColumn(anchors)
  const tossY = clearPotLabel(Math.min(MAX_REACH_Y - 0.06, anchors.cardsTopY + 0.08), tossX, anchors)
  const reach = smooth(t / 0.22)
  // A small draw back (anticipation) before the toss, then the flick.
  const cock = smooth((t - 0.2) / 0.14) * (1 - smooth((t - 0.36) / 0.1))
  const sweep = smooth((t - 0.34) / 0.24)
  const back = smooth((t - 0.76) / 0.34)
  blendTo(hand, gatherX, gatherY, reach)
  hand.y -= 0.035 * cock
  hand.x = lerp(hand.x, tossX, sweep)
  hand.y = lerp(hand.y, tossY, sweep)
  const arc = style === 'toss' ? 0.06 : style === 'snap' ? 0.02 : 0.035
  hand.y += Math.sin(sweep * Math.PI) * arc
  const rest = out.left
  const away = reach * (1 - back)
  // Return to the rail.
  hand.x = lerp(hand.x, anchors.restRightX, back)
  hand.y = lerp(hand.y, REST_Y, back)
  const release = smooth((t - 0.5) / 0.08)
  hand.fist = smooth((t - 0.1) / 0.12) * 0.55 * (1 - release)
  hand.pinch = smooth((t - 0.12) / 0.12) * 0.5 * (1 - release)
  hand.open = release * (1 - back) * 0.8
  // The wrist cocks back on the draw, then snaps forward through the release.
  hand.pitch = REST_PITCH + (0.18 * cock - 0.1 * sweep + 0.3 * release) * (1 - back)
  hand.yaw = 0.14 + 0.32 * sweep * (1 - back)
  hand.roll = 0.05 - 0.28 * sweep * (1 - back) * (style === 'toss' ? 1.3 : 1)
  // The left hand steadies the rail while the right one works.
  rest.y += 0.012 * away
  rest.fist += 0.12 * away

  // The two cards: slide in under the hand, ride with it, then fly off toward the muck.
  const cards = out.cards
  const grab = smooth((t - 0.2) / 0.12)
  const flightT = clamp01((t - 0.53) / 0.5)
  if (t >= 0.14 && flightT < 1) {
    cards.visible = true
    const carryX = lerp(anchors.cardsX, hand.x, grab) + 0.0
    // Held under the fingertips (as deep as they reach, so the fingers draw over the cards).
    const carryY = lerp(anchors.cardsY, hand.y + 0.15, grab)
    // Off the fingertips, forward and in toward the muck in the middle, dropping as they go.
    const flightX = tossX - 0.24 * flightT * (style === 'snap' ? 1.3 : 1)
    const flightY = tossY + 0.14 + 0.3 * flightT - 0.16 * flightT * flightT
    cards.x = flightT > 0 ? flightX : carryX
    cards.y = flightT > 0 ? flightY : carryY
    cards.depth = HAND_DEPTH + 0.11 + 1.4 * flightT
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
  const push = easeInOut((e - departAt - PUSH_LAG_SECONDS) / travel)
  const back = smooth((e - arriveAt - 0.12) / 0.38)
  const release = smooth((e - arriveAt - PUSH_LAG_SECONDS + 0.06) / 0.12)
  const grab = smooth((e - 0.1) / 0.12)
  const lift = profile.wagerStyle === 'flick' ? 0.1 : profile.wagerStyle === 'shove' ? 0.02 : 0.045
  const allIn = cue === 'all_in'
  const bigger = cue === 'raise' || allIn ? 1.1 : 1

  const stackY = Math.min(MAX_REACH_Y, anchors.stackY - WRIST_BELOW)
  // The push always carries the chips forward a little (never back toward the player,
  // even when the spot projects lower than the stack); the chips fly the rest.
  const betY = Math.min(MAX_REACH_Y, Math.max(anchors.betY, anchors.stackY + 0.05) - WRIST_BELOW)
  const sides = allIn ? 2 : 1
  for (let index = 0; index < sides; index += 1) {
    const sign: 1 | -1 = index === 0 ? 1 : -1
    const hand = sign === 1 ? out.right : out.left
    // An all-in shoves with both hands, cupped either side of the pile.
    const spread = allIn ? 0.1 * sign : 0.0
    // The betting spot sits between the hole-card tray and the pot readout on screen:
    // the hands drive the chips toward it from the stack's side of that column and let
    // them slide the rest of the way, so a hand never vanishes under either overlay
    // (both hands of an all-in stay on that side too, the far one just inside it).
    const column = Math.max(cardColumn(anchors), anchors.potHalfW > 0 ? Math.abs(anchors.potX - anchors.cardsX) + anchors.potHalfW + HAND_SCREEN_HALF_W + 0.05 : 0)
    const stackSide = anchors.stackX >= anchors.cardsX ? 1 : -1
    const edge = anchors.cardsX + stackSide * (column - (allIn && sign !== stackSide ? 0.04 : 0))
    const rawStackX = anchors.stackX + spread + (allIn ? 0 : 0.02)
    const rawBetX = anchors.betX + spread + (allIn && sign === stackSide ? 0.16 * stackSide : 0)
    const stackX = stackSide === 1 ? Math.max(rawStackX, edge) : Math.min(rawStackX, edge)
    const betX = stackSide === 1 ? Math.max(rawBetX, edge) : Math.min(rawBetX, edge)
    const restX = sign === 1 ? anchors.restRightX : anchors.restLeftX
    let x = lerp(restX, stackX, reach)
    let y = lerp(REST_Y, stackY, reach)
    x = lerp(x, betX, push)
    y = lerp(y, betY, push)
    y += Math.sin(push * Math.PI) * lift * bigger
    x = lerp(x, restX, back)
    y = lerp(y, REST_Y, back)
    // Passing the hole-card tray: ride just above its top edge instead of under it.
    const overCards = 1 - smooth((Math.abs(x - anchors.cardsX) - cardColumn(anchors)) / CARDS_CLEAR_FADE)
    y = lerp(y, Math.max(y, anchors.cardsTopY), overCards)
    // The push stops a finger short of the pot readout; the chips slide on.
    y = clearPotLabel(y, x, anchors)
    // Settle: the hand pats down a touch as it lands back on the rail.
    const land = Math.sin(clamp01((e - arriveAt - 0.32) / 0.3) * Math.PI) * back
    hand.x = x
    hand.y = y - 0.012 * land
    // The wrist dips as the fingers close on the chips, drives flat through the push and
    // flicks up as they let go.
    const flick = Math.sin(release * Math.PI) * (1 - back)
    hand.pitch = REST_PITCH + 0.08 * reach - 0.08 * grab * (1 - push) + 0.18 * push * (1 - back) + 0.16 * flick
    hand.yaw = 0.14 + 0.1 * reach * (1 - back)
    hand.roll = 0.05 - 0.14 * push * (1 - back)
    hand.fist = grab * 0.55 * (1 - release)
    hand.open = release * (1 - back) * 0.65
    hand.depth = HAND_DEPTH - 0.04 * push * (1 - back)
  }
  if (!allIn) {
    // The free hand braces on the rail through the push (a little weight onto it).
    const brace = Math.sin(clamp01(e / (arriveAt + 0.3)) * Math.PI)
    out.left.y -= 0.008 * brace
    out.left.x += 0.012 * brace
    out.left.fist += 0.14 * brace
  }
}

function poseWin(w: number, out: HeroHandsPose) {
  // Both fists up and pumping, then they come back down. The hands are not mirror
  // images: the right is the lead (higher, tighter, quicker), the left follows a
  // beat behind and a little looser, each punching up and easing back down with
  // its own sway and wrist roll instead of bobbing in lockstep.
  const raise = smooth(w / 0.4) * (1 - smooth((w - WIN_HOLD_SECONDS) / 0.55))
  for (let index = 0; index < 2; index += 1) {
    const sign: 1 | -1 = index === 0 ? 1 : -1
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
    // Turned thumb-up (the pinky side toward the felt) so the curled fingers and the thumb read as a fist.
    hand.roll = lerp(hand.roll, -(lead ? 0.95 : 0.85) + 0.14 * sway - 0.1 * punch, raise)
    hand.fist = raise * (lead ? 0.95 : 0.8) * (0.9 + 0.1 * punch)
    hand.open = raise * (lead ? 0 : 0.12) * (1 - punch)
    hand.depth = HAND_DEPTH + (0.06 - 0.05 * punch) * raise
  }
}

/** Dealing: the right hand cocks and snaps cards off the deck, the left steadies it. */
function poseDeal(deal: HeroDealInput, out: HeroHandsPose, anchors: HeroHandsAnchors) {
  const w = clamp01(deal.weight)
  const right = out.right
  const left = out.left
  right.x = lerp(right.x, anchors.dealRightX - 0.03 * deal.cock + 0.02 * deal.snap, w)
  right.y = lerp(right.y, anchors.dealRightY - 0.05 * deal.cock + 0.07 * deal.snap, w)
  right.pitch = REST_PITCH + w * (0.12 - 0.28 * deal.cock + 0.35 * deal.snap)
  right.yaw = 0.14 + w * 0.1
  right.pinch = deal.pinch * w
  right.fist = 0.4 * deal.cock * w
  right.open = 0.9 * deal.snap * w
  left.x = lerp(left.x, anchors.dealLeftX, w)
  left.y = lerp(left.y, anchors.dealLeftY, w)
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

/** Smoothing for pose channels (per second) when no spring state is given. */
export const HAND_FOLLOW_RATE = 16

const CHANNELS = ['x', 'y', 'depth', 'pitch', 'yaw', 'roll', 'fist', 'open', 'pinch', 'flutter', 'show'] as const

/**
 * Settling time (s) per channel of the critically damped spring that carries a
 * drawn pose to its target: position and angles ease in and out (no sudden
 * start), finger shapes close a little quicker, and the hand slides in and out
 * of frame slowest.
 */
const SMOOTH_TIME: Record<(typeof CHANNELS)[number], number> = {
  x: 0.075,
  y: 0.075,
  depth: 0.09,
  pitch: 0.09,
  yaw: 0.09,
  roll: 0.09,
  fist: 0.06,
  open: 0.05,
  pinch: 0.06,
  flutter: 0.2,
  show: 0.16,
}

/** Per-channel velocities for followHandPose's spring (one per hand). */
export type HandVelocity = Record<(typeof CHANNELS)[number], number>

export function createHandVelocity(): HandVelocity {
  return { x: 0, y: 0, depth: 0, pitch: 0, yaw: 0, roll: 0, fist: 0, open: 0, pinch: 0, flutter: 0, show: 0 }
}

/**
 * Carries the drawn pose to the target. With velocities it is a critically
 * damped spring (smooth start and stop, never overshoots); without, a plain
 * exponential ease. `snap` jumps straight to the target.
 */
export function followHandPose(current: HandPose, target: HandPose, dt: number, snap: boolean, velocity?: HandVelocity) {
  if (snap) {
    for (let index = 0; index < CHANNELS.length; index += 1) {
      const channel = CHANNELS[index]!
      current[channel] = target[channel]
      if (velocity) velocity[channel] = 0
    }
    return
  }
  const step = Math.max(0, dt)
  if (!velocity) {
    const k = 1 - Math.exp(-step * HAND_FOLLOW_RATE)
    for (let index = 0; index < CHANNELS.length; index += 1) {
      const channel = CHANNELS[index]!
      current[channel] += (target[channel] - current[channel]) * k
    }
    return
  }
  for (let index = 0; index < CHANNELS.length; index += 1) {
    const channel = CHANNELS[index]!
    const omega = 2 / SMOOTH_TIME[channel]
    const x = omega * step
    const damp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const change = current[channel] - target[channel]
    const temp = (velocity[channel] + omega * change) * step
    velocity[channel] = (velocity[channel] - omega * temp) * damp
    current[channel] = target[channel] + (change + temp) * damp
  }
}
