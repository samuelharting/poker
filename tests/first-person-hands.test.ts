import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  checkRap,
  clearPotLabel,
  createHandPose,
  createHandVelocity,
  createHeroHandsAnchors,
  createHeroHandsPose,
  evaluateHeroHands,
  followHandPose,
  getFoldLaneX,
  getHeroGestureSeconds,
  getHeroPushStyle,
  getPilePush,
  getWagerPairWeight,
  getWagerTravelSeconds,
  keepCardOffLabel,
  HAND_DEPTH,
  MAX_REACH_Y,
  MIN_HAND_DEPTH,
  REST_Y,
  WAGER_DEPART_SECONDS,
  type HeroHandsInput,
  type HeroHandsPose,
} from '@/components/three/firstPersonHandPose'
import { getDealRightX, getPileOffset } from '@/components/three/firstPersonHands'
import {
  buildHandGeometry,
  createCelMaterial,
  createHandHullMaterial,
  createHandMaterial,
  getHandShapeTips,
  getHullWidth,
  HAND_INK_COLOR,
  HAND_MORPH,
  HAND_SCALE,
} from '@/components/three/firstPersonHandMesh'
import { getPokerActionMotionProfile } from '@/components/three/pokerActionPose'
import type { ThreeActionCue } from '@/components/three/tableViewModel'

function inputFor(cue: ThreeActionCue, seconds: number, extra: Partial<HeroHandsInput> = {}): HeroHandsInput {
  const anchors = createHeroHandsAnchors()
  return {
    cue,
    elapsedMs: seconds * 1000,
    profile: getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: 0.5 }),
    peeking: false,
    winnerSeconds: -1,
    flickSeconds: -1,
    deal: null,
    time: 3,
    drunkLevel: 0,
    reducedMotion: false,
    anchors,
    ...extra,
  }
}

function pose(cue: ThreeActionCue, seconds: number, extra: Partial<HeroHandsInput> = {}): HeroHandsPose {
  return evaluateHeroHands(inputFor(cue, seconds, extra), createHeroHandsPose())
}

const CUES: ThreeActionCue[] = ['ready', 'check', 'call', 'bet', 'raise', 'all_in', 'fold']

describe('first-person hands: resting', () => {
  it('rests low on the rail, either side of the hole cards, never near the lens', () => {
    const rest = pose('ready', 99)
    for (const hand of [rest.right, rest.left]) {
      expect(hand.y).toBeLessThan(-0.7)
      expect(hand.show).toBe(1)
      expect(hand.depth).toBeGreaterThanOrEqual(MIN_HAND_DEPTH)
      expect(hand.fist).toBeLessThan(0.2)
    }
    expect(rest.right.x).toBeGreaterThan(0)
    expect(rest.left.x).toBeLessThan(0)
    expect(rest.cards.visible).toBe(false)
  })

  it('stays low-profile: the idle breath barely moves the hands', () => {
    const a = pose('ready', 99, { time: 0 })
    const b = pose('ready', 99, { time: 2.2 })
    expect(Math.abs(a.right.y - b.right.y)).toBeLessThan(0.02)
    expect(Math.abs(a.left.x - b.left.x)).toBeLessThan(0.01)
  })

  it('keeps resting under reduced motion whatever the cue', () => {
    for (const cue of CUES) {
      const rest = pose(cue, 0.4, { reducedMotion: true, peeking: true, winnerSeconds: 1 })
      expect(rest.right.y).toBeCloseTo(REST_Y, 5)
      expect(rest.left.y).toBeCloseTo(REST_Y, 5)
      expect(rest.right.fist).toBe(0)
      expect(rest.cards.visible).toBe(false)
    }
  })

  it('rests where the room measured the cards and tray', () => {
    const anchors = { ...createHeroHandsAnchors(), restRightX: 0.31, restLeftX: -0.4 }
    const rest = pose('ready', 99, { anchors })
    // (the idle sway moves it by a few thousandths)
    expect(rest.right.x).toBeCloseTo(0.31, 1)
    expect(rest.left.x).toBeCloseTo(-0.4, 1)
    expect(Math.abs(rest.right.x - 0.31)).toBeLessThan(0.01)
  })
})

describe('first-person hands: check', () => {
  it('knuckle-taps: lifts off the rail beside the cards, raps down in a fist, then goes home', () => {
    const profile = getPokerActionMotionProfile('check', { variant: 2 })
    expect(profile.checkStyle).toBe('knuckle')
    const rest = pose('ready', 99)
    const reach = pose('check', 0.14, { profile })
    const strike = pose('check', 0.25, { profile })
    const end = pose('check', getHeroGestureSeconds('check', profile) + 0.05, { profile })
    expect(reach.right.y).toBeGreaterThan(rest.right.y + 0.1)
    // Cocked back at the wrist before the rap, flexed down on it.
    expect(reach.right.pitch).toBeGreaterThan(strike.right.pitch + 0.2)
    // The rap lands on the rail right of the hole cards (never under the card tray or the pot label).
    expect(strike.right.x).toBeGreaterThan(createHeroHandsAnchors().cardsX + 0.18)
    expect(strike.right.y).toBeLessThan(reach.right.y - 0.06)
    expect(strike.right.fist).toBeGreaterThan(0.7)
    expect(end.right.y).toBeCloseTo(rest.right.y, 3)
    expect(end.right.fist).toBeLessThan(0.2)
    expect(strike.left.y).toBeCloseTo(rest.left.y, 1)
  })

  it('the double style taps twice', () => {
    const profile = getPokerActionMotionProfile('check', { variant: 1 })
    expect(profile.checkStyle).toBe('double')
    let lows = 0
    let previous = pose('check', 0.1, { profile }).right.y
    let falling = false
    for (let t = 0.12; t < 0.8; t += 0.01) {
      const y = pose('check', t, { profile }).right.y
      if (y < previous - 1e-5) falling = true
      else if (falling && y > previous + 1e-5) {
        lows += 1
        falling = false
      }
      previous = y
    }
    expect(lows).toBeGreaterThanOrEqual(2)
  })
})

describe('first-person hands: wagers', () => {
  const anchors = { ...createHeroHandsAnchors(), stackX: 0.3, stackY: -0.45, betX: -0.05, betY: -0.25 }
  const profile = getPokerActionMotionProfile('raise', { variant: 0, wagerIntensity: 0.6 })

  it('grabs the stack, pushes toward the betting spot with the chips, and returns', () => {
    const rest = pose('ready', 99, { anchors })
    const atStack = pose('raise', 0.22, { anchors, profile })
    const midPush = pose('raise', WAGER_DEPART_SECONDS + getWagerTravelSeconds(profile) / 2, { anchors, profile })
    const arrive = pose('raise', WAGER_DEPART_SECONDS + getWagerTravelSeconds(profile), { anchors, profile })
    const end = pose('raise', getHeroGestureSeconds('raise', profile) + 0.1, { anchors, profile })
    // Behind the pile on its right, the fingers leaning in.
    expect(atStack.right.x).toBeCloseTo(anchors.stackX + 0.11, 1)
    expect(atStack.right.fist).toBeGreaterThan(0.5)
    expect(midPush.right.x).toBeLessThan(atStack.right.x)
    expect(midPush.right.x).toBeGreaterThan(arrive.right.x - 1e-6)
    // The hand drives the pile to the betting spot (it ends beside it, not stopped at the tray's side).
    expect(arrive.right.x).toBeLessThan(atStack.right.x - 0.15)
    expect(Math.abs(arrive.right.x - anchors.betX)).toBeLessThan(0.2)
    expect(arrive.right.fist).toBeLessThan(atStack.right.fist)
    expect(end.right.y).toBeCloseTo(rest.right.y, 3)
    expect(end.right.x).toBeCloseTo(rest.right.x, 3)
  })

  it('never reaches above the line that keeps the board and pot clear', () => {
    for (const cue of ['call', 'bet', 'raise', 'all_in'] as const) {
      const p = getPokerActionMotionProfile(cue, { variant: 1, wagerIntensity: 1 })
      for (let t = 0; t <= getHeroGestureSeconds(cue, p); t += 0.02) {
        const hands = pose(cue, t, { anchors: { ...anchors, stackY: 0.2, betY: 0.3 }, profile: p })
        // A flick adds a small lift; the wrist stays well under the pot.
        expect(hands.right.y).toBeLessThanOrEqual(MAX_REACH_Y + 0.16)
      }
    }
  })

  it('only an all-in uses both hands', () => {
    const allIn = pose('all_in', 0.5, { anchors, profile })
    const call = pose('call', 0.5, { anchors, profile })
    expect(allIn.left.y).toBeGreaterThan(REST_Y + 0.08)
    expect(allIn.left.fist).toBeGreaterThan(0.4)
    // The free hand only braces on the rail.
    expect(Math.abs(call.left.y - REST_Y)).toBeLessThan(0.02)
  })

  it('matches the chip flight: the push takes as long as animateWagers throws them', () => {
    expect(getWagerTravelSeconds({ wagerStyle: 'slide', wagerIntensity: 0.3 })).toBeCloseTo(0.72)
    expect(getWagerTravelSeconds({ wagerStyle: 'shove', wagerIntensity: 1 })).toBeCloseTo(0.56)
    // The hero's own chips are pushed, never thrown: a flick takes a slide's time.
    expect(getWagerTravelSeconds({ wagerStyle: 'flick', wagerIntensity: 0 })).toBeCloseTo(0.72)
  })

  it('the pile curve is the one animateWagers draws: a smoothstep over the flight, the leading chips 4% ahead', () => {
    const travel = 0.72
    expect(getPilePush(WAGER_DEPART_SECONDS - 0.1, travel)).toBe(0)
    expect(getPilePush(WAGER_DEPART_SECONDS + travel, travel)).toBe(1)
    const half = getPilePush(WAGER_DEPART_SECONDS + travel * 0.5, travel)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(0.55)
    let last = 0
    for (let t = 0; t <= 1.2; t += 0.02) {
      const value = getPilePush(t, travel)
      expect(value).toBeGreaterThanOrEqual(last)
      last = value
    }
  })

  it('the hand follows the pile all the way to the betting spot instead of stopping beside the pot readout', () => {
    // The layout measured at 1280x720: stack right of the cards, the spot under the pot readout.
    const real = { ...createHeroHandsAnchors(), stackX: 0.27, stackY: -0.49, betX: 0, betY: -0.3, cardsX: 0.04, cardsHalfW: 0.13, cardsTopY: -0.53, potX: 0, potHalfW: 0.108, potBottomY: -0.4, potTopY: -0.28, restRightX: 0.22 }
    for (const intensity of [0.3, 0.45, 0.6]) {
      const p = getPokerActionMotionProfile('raise', { variant: 0, wagerIntensity: intensity })
      const travel = getWagerTravelSeconds(p)
      const pileAt = (t: number) => {
        const push = getPilePush(t, travel)
        return { x: real.stackX + (real.betX - real.stackX) * push, y: real.stackY + (Math.max(real.betY, real.stackY + 0.05) - real.stackY) * push }
      }
      const arrive = pose('raise', WAGER_DEPART_SECONDS + travel, { anchors: real, profile: p }).right
      // Over the felt where the chips land: the wrist is within a hand's width of the spot sideways.
      expect(Math.abs(arrive.x - real.betX), `intensity ${intensity}`).toBeLessThan(0.2)
      // All the way along, the hand stays with the pile (never left behind at the stack while the chips slide on).
      for (let t = WAGER_DEPART_SECONDS + 0.1; t <= WAGER_DEPART_SECONDS + travel; t += 0.02) {
        const hand = pose('raise', t, { anchors: real, profile: p }).right
        const pile = pileAt(t)
        expect(Math.abs(hand.x - pile.x), `intensity ${intensity} t=${t.toFixed(2)}`).toBeLessThan(0.3)
        expect(Math.abs(hand.y - (pile.y - 0.17)), `intensity ${intensity} t=${t.toFixed(2)}`).toBeLessThan(0.14)
      }
    }
  })
})

describe('first-person hands: the pile the hand pushes', () => {
  it('is centred on the chips as laid out around the wager origin, turned by the columns yaw', () => {
    const bases = [{ x: -0.1, z: 0.2 }, { x: 0.1, z: 0.2 }, { x: 0, z: 0.3 }]
    const out = new THREE.Vector3()
    expect(getPileOffset({ start: new THREE.Vector3(), target: new THREE.Vector3(), layoutCount: 0, chipBasePositions: bases }, out).length()).toBe(0)
    expect(getPileOffset({ start: new THREE.Vector3(), target: new THREE.Vector3() }, out).length()).toBe(0)
    getPileOffset({ start: new THREE.Vector3(), target: new THREE.Vector3(), layoutCount: 3, chipBasePositions: bases, yaw: 0 }, out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(0.2333, 3)
    // Turned a quarter way round, the depth offset swings sideways (the same rotation the group gets).
    getPileOffset({ start: new THREE.Vector3(), target: new THREE.Vector3(), layoutCount: 3, chipBasePositions: bases, yaw: Math.PI / 2 }, out)
    expect(out.x).toBeCloseTo(0.2333, 3)
    expect(Math.abs(out.z)).toBeLessThan(1e-9)
    // Only the chips actually laid out count.
    getPileOffset({ start: new THREE.Vector3(), target: new THREE.Vector3(), layoutCount: 2, chipBasePositions: bases, yaw: 0 }, out)
    expect(out.z).toBeCloseTo(0.2)
  })
})

describe('first-person hands: overlays', () => {
  it('a hand reaching under the pot label stops short of it; one beside it is left alone', () => {
    const anchors = { ...createHeroHandsAnchors(), potX: 0, potHalfW: 0.1, potBottomY: -0.2 }
    const under = clearPotLabel(-0.3, 0.02, anchors)
    // Wrist low enough that the fingers stay below the label's bottom edge.
    expect(under).toBeLessThan(-0.2 - 0.2)
    expect(clearPotLabel(-0.3, 0.5, anchors)).toBe(-0.3)
    expect(clearPotLabel(-0.6, 0.02, anchors)).toBe(-0.6)
    expect(clearPotLabel(-0.3, 0.02, createHeroHandsAnchors())).toBe(-0.3)
  })

  it('wagers never sink behind the card tray, and only slip under the pot readout in the last moment of the push', () => {
    const anchors = { ...createHeroHandsAnchors(), stackX: 0.32, stackY: -0.42, betX: 0.02, betY: -0.3, potX: 0, potHalfW: 0.09, potBottomY: -0.28 }
    for (const cue of ['call', 'raise', 'all_in'] as const) {
      const p = getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: 0.8 })
      const travel = getWagerTravelSeconds(p)
      let under = 0
      for (let t = 0; t <= getHeroGestureSeconds(cue, p); t += 0.02) {
        const hands = pose(cue, t, { anchors, profile: p })
        for (const hand of [hands.right, hands.left]) {
          if (Math.abs(hand.x - anchors.cardsX) < anchors.cardsHalfW - 0.02) expect(hand.y).toBeGreaterThan(anchors.cardsTopY - 0.13)
        }
        // The pushing hand is only under the readout once the pile is nearly home.
        if (Math.abs(hands.right.x - anchors.potX) < anchors.potHalfW && hands.right.y > anchors.potBottomY - 0.2) {
          under += 1
          expect(t).toBeGreaterThan(WAGER_DEPART_SECONDS + travel * 0.5)
        }
      }
      // ... and briefly (the whole gesture is over a second and a half).
      expect(under * 0.02, cue).toBeLessThan(0.7)
    }
  })

  it('a check rap accelerates into the rail and rebounds', () => {
    expect(checkRap(0.1, 0.25)).toBe(0)
    expect(checkRap(0.2, 0.25)).toBeLessThan(checkRap(0.23, 0.25))
    expect(checkRap(0.25, 0.25)).toBe(1)
    expect(checkRap(0.32, 0.25)).toBeLessThan(1)
    expect(checkRap(0.5, 0.25)).toBe(0)
  })
})

describe('first-person hands: fold', () => {
  it('carries the two cards forward toward the middle, lets go, and the hand comes home', () => {
    const profile = getPokerActionMotionProfile('fold', { variant: 2 })
    expect(profile.foldStyle).toBe('toss')
    const before = pose('fold', 0.02, { profile })
    const carried = pose('fold', 0.4, { profile })
    const flying = pose('fold', 0.62, { profile })
    const end = pose('fold', getHeroGestureSeconds('fold', profile) + 0.05, { profile })
    expect(before.cards.visible).toBe(false)
    expect(carried.cards.visible).toBe(true)
    expect(carried.right.fist).toBeGreaterThan(0.4)
    const anchors = createHeroHandsAnchors()
    // Lifted beside the card tray (never behind it), the cards flicked in toward the middle.
    expect(carried.right.x).toBeGreaterThan(anchors.cardsX + anchors.cardsHalfW * 0.7)
    expect(flying.cards.x).toBeLessThan(flying.right.x)
    for (let t = 0; t <= getHeroGestureSeconds('fold', profile); t += 0.02) {
      const hand = pose('fold', t, { profile }).right
      // (Inside the tray's width only by its top corner: the fingers reach over the top edge.)
      if (Math.abs(hand.x - anchors.cardsX) < anchors.cardsHalfW) expect(hand.y).toBeGreaterThan(anchors.cardsTopY - 0.13)
    }
    expect(flying.cards.depth).toBeGreaterThan(HAND_DEPTH)
    expect(flying.cards.scale).toBeLessThan(1)
    expect(flying.right.fist).toBeLessThan(carried.right.fist)
    expect(end.cards.visible).toBe(false)
    // Home on the rail (give or take the idle weight drift).
    expect(Math.abs(end.right.x - createHeroHandsAnchors().restRightX)).toBeLessThan(0.012)
  })
})

describe('first-person hands: peek, win, flick, deal', () => {
  it('peeking pinches a corner of each card with both hands, just outside the cards', () => {
    const peek = pose('ready', 99, { peeking: true })
    expect(peek.right.pinch).toBe(1)
    expect(peek.left.pinch).toBeGreaterThan(0.85)
    expect(peek.right.x).toBeGreaterThan(0.1)
    expect(peek.left.x).toBeLessThan(-0.1)
    expect(peek.right.y).toBeLessThan(-0.5)
  })

  it('a win raises both fists, then lowers them again', () => {
    const rest = pose('ready', 99)
    const up = pose('ready', 99, { winnerSeconds: 1.2 })
    const late = pose('ready', 99, { winnerSeconds: 4.5 })
    expect(up.right.y).toBeGreaterThan(rest.right.y + 0.4)
    expect(up.left.y).toBeGreaterThan(rest.left.y + 0.4)
    expect(up.right.fist).toBeGreaterThan(0.8)
    expect(late.right.y).toBeCloseTo(rest.right.y, 2)
  })

  it('a chip flick pinches, snaps open at the launch, and settles', () => {
    const hold = pose('ready', 99, { flickSeconds: 0.25 })
    const snap = pose('ready', 99, { flickSeconds: 0.5 })
    const done = pose('ready', 99, { flickSeconds: 1.2 })
    expect(hold.right.pinch).toBeGreaterThan(0.5)
    expect(snap.right.open).toBeGreaterThan(0.5)
    expect(done.right.y).toBeCloseTo(REST_Y, 1)
  })

  it('dealing by hand works a visible spot above the tray (cock and snap shape it), easing in with the gesture weight', () => {
    const deal = { weight: 1, rightX: 0.1, rightY: -0.55, leftX: -0.2, leftY: -0.6, pinch: 1, cock: 0.2, snap: 0.5, holdLeft: 1 }
    const full = pose('ready', 99, { deal })
    const none = pose('ready', 99, { deal: { ...deal, weight: 0 } })
    const half = pose('ready', 99, { deal: { ...deal, weight: 0.5 } })
    const anchors = createHeroHandsAnchors()
    expect(full.right.x).toBeCloseTo(anchors.dealRightX, 1)
    expect(full.left.x).toBeCloseTo(anchors.dealLeftX, 1)
    expect(full.right.y).toBeGreaterThan(MAX_REACH_Y - 0.25)
    expect(full.right.pinch).toBe(1)
    expect(full.left.fist).toBeGreaterThan(0.4)
    expect(none.right.y).toBeCloseTo(REST_Y, 1)
    expect(half.right.x).toBeGreaterThan(Math.min(none.right.x, full.right.x))
    expect(half.right.x).toBeLessThan(Math.max(none.right.x, full.right.x))
  })
})

describe('first-person hands: an action taken mid-deal', () => {
  const deal = { weight: 1, rightX: 0.1, rightY: -1, leftX: -0.2, leftY: -1, pinch: 0.5, cock: 0.2, snap: 0, holdLeft: 1 }
  const withDeal = (cue: ThreeActionCue, seconds: number, d = deal, extra: Partial<HeroHandsInput> = {}) =>
    pose(cue, seconds, { deal: d, profile: getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: 0.3 }), ...extra })

  it('slides out of the deal stance into the fold: the right hand never drops to the rail first', () => {
    const stance = pose('ready', 99, { deal })
    const early = withDeal('fold', 0.01)
    // Starts where the deal had it (not at the rail), and only then goes for the cards.
    expect(Math.abs(early.right.x - stance.right.x)).toBeLessThan(0.03)
    expect(Math.abs(early.right.y - stance.right.y)).toBeLessThan(0.03)
    let lowest = Infinity
    for (let t = 0; t <= 0.25; t += 0.01) lowest = Math.min(lowest, withDeal('fold', t).right.y)
    expect(lowest).toBeGreaterThan(Math.min(stance.right.y, REST_Y + 0.1) - 0.05)
  })

  it('the free left hand stays on the deck and keeps pitching the remaining cards through a fold or a check', () => {
    const stance = pose('ready', 99, { deal })
    for (const cue of ['fold', 'check', 'call'] as const) {
      for (const t of [0.05, 0.3, 0.6]) {
        const p = withDeal(cue, t)
        expect(p.dealHand, cue).toBe(-1)
        expect(Math.abs(p.left.x - stance.left.x), cue).toBeLessThan(0.08)
        expect(Math.abs(p.left.y - stance.left.y), cue).toBeLessThan(0.12)
      }
    }
    // The snap opens the left hand, the cock closes it, just as the right hand does in the normal deal.
    const snap = withDeal('fold', 0.5, { ...deal, snap: 1, cock: 0 })
    const cock = withDeal('fold', 0.5, { ...deal, snap: 0, cock: 1, pinch: 0 })
    expect(snap.left.open).toBeGreaterThan(0.7)
    expect(cock.left.fist).toBeGreaterThan(0.3)
    expect(snap.left.pitch).toBeGreaterThan(cock.left.pitch + 0.3)
  })

  it('a gesture that needs both hands takes the left too, and the cards leave the deck spot', () => {
    const big = pose('raise', 0.6, { deal, profile: getPokerActionMotionProfile('raise', { variant: 0, wagerIntensity: 0.9 }) })
    const allIn = pose('all_in', 0.6, { deal, profile: getPokerActionMotionProfile('all_in', { variant: 0, wagerIntensity: 1 }) })
    expect(big.dealHand).toBe(0)
    expect(allIn.dealHand).toBe(0)
    expect(pose('raise', 0.6, { deal, profile: getPokerActionMotionProfile('raise', { variant: 0, wagerIntensity: 0.3 }) }).dealHand).toBe(-1)
  })

  it('the deal itself pitches with the right hand, and picks up again after the gesture without a jump', () => {
    expect(pose('ready', 99, { deal }).dealHand).toBe(1)
    expect(pose('fold', 99, { deal }).dealHand).toBe(1)
    expect(pose('ready', 99).dealHand).toBe(0)
    const profile = getPokerActionMotionProfile('fold', { variant: 0 })
    const length = getHeroGestureSeconds('fold', profile)
    const stance = pose('ready', 99, { deal }).right
    const before = withDeal('fold', length - 0.02).right
    const after = withDeal('fold', length + 0.02).right
    // Right at the end of the gesture the hand is home and the deal weight eases back in: no jump.
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.06)
    expect(withDeal('fold', length + 0.6).right.y).toBeCloseTo(stance.y, 1)
    expect(withDeal('fold', length + 0.6).dealHand).toBe(1)
  })

  it('every pose over a fold, a check and a raise mid-deal is finite and in front of the lens', () => {
    for (const cue of ['fold', 'check', 'call', 'raise', 'all_in'] as const) {
      for (let t = 0; t <= 2.2; t += 0.04) {
        const p = withDeal(cue, t, { ...deal, snap: Math.sin(t * 9) ** 2, cock: Math.cos(t * 7) ** 2 })
        for (const hand of [p.right, p.left]) {
          for (const value of Object.values(hand)) expect(Number.isFinite(value)).toBe(true)
          expect(hand.depth).toBeGreaterThanOrEqual(0.65)
          expect(Math.abs(hand.x)).toBeLessThan(1.05)
          expect(hand.y).toBeLessThan(0)
          for (const shape of [hand.fist, hand.open, hand.pinch]) {
            expect(shape).toBeGreaterThanOrEqual(0)
            expect(shape).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

describe('first-person hands: dealing placement', () => {
  const deal = { weight: 1, rightX: 0, rightY: -1, leftX: 0, leftY: -1, pinch: 0, cock: 0, snap: 0, holdLeft: 1 }

  it('works to the sides of the pot readout and the hole cards, not under them', () => {
    const anchors = createHeroHandsAnchors()
    // Pot readout and hero cards roughly span -0.15..0.17 around the middle at the bottom of the view.
    expect(anchors.dealRightX).toBeGreaterThan(0.25)
    expect(anchors.dealLeftX).toBeLessThan(-0.25)
    const out = pose('ready', 99, { deal, anchors })
    expect(out.right.x).toBeGreaterThan(0.25)
    expect(out.left.x).toBeLessThan(-0.25)
  })

  it('follows the measured clear spots when the layout moves', () => {
    const anchors = { ...createHeroHandsAnchors(), dealRightX: 0.5, dealLeftX: -0.45, dealRightY: -0.4 }
    const out = pose('ready', 99, { deal, anchors })
    expect(out.right.x).toBeCloseTo(0.5, 1)
    expect(out.left.x).toBeCloseTo(-0.45, 1)
    expect(out.right.y).toBeGreaterThan(-0.5)
  })
})

describe('first-person hands: invariants', () => {
  it('every pose over every gesture is finite, on screen and in front of the lens', () => {
    const anchors = { ...createHeroHandsAnchors(), stackX: 0.25, stackY: -0.42, betX: -0.05, betY: -0.28 }
    for (const variant of [0, 1, 2] as const) {
      for (const cue of CUES) {
        const profile = getPokerActionMotionProfile(cue, { variant, wagerIntensity: variant / 2 })
        for (let t = 0; t <= 2.6; t += 0.04) {
          const p = pose(cue, t, { profile, anchors, peeking: t > 1 })
          for (const hand of [p.right, p.left]) {
            for (const value of Object.values(hand)) expect(Number.isFinite(value)).toBe(true)
            expect(hand.depth).toBeGreaterThanOrEqual(0.65)
            expect(Math.abs(hand.x)).toBeLessThan(1.05)
            expect(hand.y).toBeLessThan(0)
            expect(hand.y).toBeGreaterThan(-1.1)
            for (const shape of [hand.fist, hand.open, hand.pinch]) {
              expect(shape).toBeGreaterThanOrEqual(0)
              expect(shape).toBeLessThanOrEqual(1)
            }
          }
          if (p.cards.visible) expect(p.cards.depth).toBeGreaterThanOrEqual(MIN_HAND_DEPTH)
        }
      }
    }
  })

  it('hands are back at rest when every gesture is over', () => {
    const rest = pose('ready', 99)
    for (const cue of CUES) {
      const profile = getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: 1 })
      const end = pose(cue, getHeroGestureSeconds(cue, profile) + 0.3, { profile })
      expect(end.right.x).toBeCloseTo(rest.right.x, 3)
      expect(end.right.y).toBeCloseTo(rest.right.y, 3)
      expect(end.left.y).toBeCloseTo(rest.left.y, 3)
    }
  })

  it('the spring carries a hand to its target with no sudden start and no overshoot', () => {
    const current = createHandPose()
    const target = createHandPose()
    const velocity = createHandVelocity()
    target.x = 0.5
    let firstStep = 0
    let peakStep = 0
    let previous = current.x
    let peak = 0
    for (let i = 0; i < 90; i += 1) {
      followHandPose(current, target, 1 / 60, false, velocity)
      const step = current.x - previous
      if (i === 0) firstStep = step
      peakStep = Math.max(peakStep, step)
      previous = current.x
      peak = Math.max(peak, current.x)
    }
    // It starts gently (the first frame moves far less than the fastest one) and never overshoots.
    expect(firstStep).toBeLessThan(peakStep * 0.5)
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-3)
    expect(current.x).toBeCloseTo(0.5, 2)
    // A huge frame (tab switch) cannot blow the spring up.
    followHandPose(current, createHandPose(), 5, false, velocity)
    expect(Number.isFinite(current.x)).toBe(true)
  })

  it('idle fingers drift on their own slow clocks, right and left out of step', () => {
    let differs = 0
    let range = 0
    for (let t = 0; t < 40; t += 0.5) {
      const p = pose('ready', 99, { time: t })
      if (Math.abs(p.right.flutter - p.left.flutter) > 0.05) differs += 1
      range = Math.max(range, Math.abs(p.right.flutter))
      expect(Math.abs(p.right.flutter)).toBeLessThanOrEqual(0.6)
    }
    expect(differs).toBeGreaterThan(10)
    expect(range).toBeGreaterThan(0.15)
  })

  it('followHandPose eases toward the target and snaps when asked', () => {
    const current = createHandPose()
    const target = createHandPose()
    target.x = 0.5
    target.fist = 1
    followHandPose(current, target, 1 / 60, false)
    expect(current.x).toBeGreaterThan(0)
    expect(current.x).toBeLessThan(0.5)
    for (let i = 0; i < 60; i += 1) followHandPose(current, target, 1 / 60, false)
    expect(current.x).toBeCloseTo(0.5, 2)
    followHandPose(current, createHandPose(), 0, true)
    expect(current.x).toBeCloseTo(createHandPose().x, 6)
  })
})

/** The shallowest depth any gesture draws a hand at (see the invariants test). */
const SHALLOWEST_POSE_DEPTH = 0.65

describe('first-person hands: mesh', () => {
  const geometry = buildHandGeometry()

  it('is one merged mesh with fist, open and pinch morph targets', () => {
    const position = geometry.getAttribute('position')
    expect(geometry.morphAttributes.position).toHaveLength(4)
    expect(geometry.morphAttributes.normal).toHaveLength(4)
    for (const target of geometry.morphAttributes.position!) expect(target.count).toBe(position.count)
    expect(geometry.morphTargetsRelative).toBe(true)
    expect(HAND_MORPH).toEqual({ fist: 0, open: 1, pinch: 2, flutter: 3 })
    expect((geometry.index?.count ?? 0) / 3).toBeLessThan(4000)
    expect(geometry.getAttribute('color').count).toBe(position.count)
    // Baked shading (palm underside, finger roots, the sleeve sinking into shadow).
    expect(geometry.getAttribute('shade').count).toBe(position.count)
  })

  it('the pinch shape brings thumb and index fingertips together; the thumb rests beside the hand', () => {
    const pinch = getHandShapeTips('pinch')
    expect(pinch.index.distanceTo(pinch.thumb)).toBeLessThan(0.02)
    const relaxed = getHandShapeTips('relaxed')
    expect(relaxed.index.distanceTo(relaxed.thumb)).toBeGreaterThan(0.03)
    expect(relaxed.thumb.z).toBeGreaterThan(relaxed.index.z)
    expect(Math.abs(relaxed.thumb.x)).toBeLessThan(0.08)
    expect(getHandShapeTips('open').index.z).toBeLessThan(-0.15)
  })

  it('a fist is shorter than an open hand (the fingers curl in)', () => {
    const position = geometry.getAttribute('position')
    const fist = geometry.morphAttributes.position![HAND_MORPH.fist]!
    const open = geometry.morphAttributes.position![HAND_MORPH.open]!
    let minZ = Infinity
    let minZFist = Infinity
    let minZOpen = Infinity
    for (let index = 0; index < position.count; index += 1) {
      const z = position.getZ(index)
      minZ = Math.min(minZ, z)
      minZFist = Math.min(minZFist, z + fist.getZ(index))
      minZOpen = Math.min(minZOpen, z + open.getZ(index))
    }
    expect(minZFist).toBeGreaterThan(minZ + 0.04)
    expect(minZOpen).toBeLessThan(minZ - 0.004)
  })

  it('never reaches the lens: the forearm stays clear of the near plane in any pose', () => {
    const position = geometry.getAttribute('position')
    const vertex = new THREE.Vector3()
    const euler = new THREE.Euler()
    const matrix = new THREE.Matrix4()
    const scale = new THREE.Matrix4().makeScale(HAND_SCALE, HAND_SCALE, HAND_SCALE)
    let nearest = Infinity
    for (const pitch of [0.2, 0.5, 0.95, 1.1]) {
      for (const yaw of [-0.7, 0.1, 0.7]) {
        for (const roll of [-0.4, 0, 0.4]) {
          euler.set(pitch, yaw, roll, 'YXZ')
          matrix.makeRotationFromEuler(euler).multiply(scale)
          for (let index = 0; index < position.count; index += 4) {
            vertex.fromBufferAttribute(position, index).applyMatrix4(matrix)
            // The hand sits at depth d in front of the lens, so a vertex is at d - z.
            nearest = Math.min(nearest, SHALLOWEST_POSE_DEPTH - vertex.z)
          }
        }
      }
    }
    // 0.1 is the camera near plane; keep a margin.
    expect(nearest).toBeGreaterThan(0.1)
  })

  it('the silhouette ink is a back-face hull pushed out along the morphed normals', () => {
    const hull = createHandHullMaterial()
    expect(hull.material.side).toBe(THREE.BackSide)
    expect(hull.material.color.getHexString()).toBe(HAND_INK_COLOR.slice(1))
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <morphtarget_vertex>',
    }
    hull.material.onBeforeCompile(shader as never, undefined as never)
    expect(shader.uniforms.uHullWidth).toBe(hull.width)
    expect(shader.vertexShader).toContain('morphnormal_vertex')
    expect(shader.vertexShader).toContain('normalize(objectNormal) * uHullWidth')
    hull.material.dispose()
  })

  it('the hull width keeps the ink about the same on screen at any window size and depth', () => {
    const tan = Math.tan(THREE.MathUtils.degToRad(30))
    const small = getHullWidth(1.5, 720, 0.72, tan)
    const big = getHullWidth(1.5, 1080, 0.72, tan)
    expect(big).toBeLessThan(small)
    expect(small / big).toBeCloseTo(1.5, 5)
    expect(getHullWidth(1.5, 720, 1.44, tan)).toBeCloseTo(small * 2, 5)
    // About 1.5 px at 720p is a couple of millimetres on the hand.
    expect(small).toBeGreaterThan(0.001)
    expect(small).toBeLessThan(0.004)
  })

  it('shares one material between both hands and recolours through uniforms', () => {
    const colors = { skin: new THREE.Color('#d9a27c'), sleeve: new THREE.Color('#2b2f3a'), cuff: new THREE.Color('#f4efe6') }
    const material = createHandMaterial(colors)
    expect(material.vertexColors).toBe(true)
    expect(material.fog).toBe(false)
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <opaque_fragment>',
    }
    material.onBeforeCompile(shader as never, undefined as never)
    expect(shader.uniforms.uSkin!.value).toBe(colors.skin)
    expect(shader.fragmentShader).toContain('uniform vec3 uSleeve;')
    expect(shader.fragmentShader).toContain('vColor.r * uSkin')
    // The multi-segment hand has no normal-based ink (it would draw lines at every joint)...
    expect(shader.fragmentShader).not.toContain('fwidth')
    // ...the plain one-piece cel material (the drink hand) does, in the avatars' ink colour.
    const plain = createCelMaterial('#d9a27c')
    const plainShader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: '#include <common>\n#include <opaque_fragment>' }
    plain.onBeforeCompile(plainShader as never, undefined as never)
    expect(plainShader.fragmentShader).toContain('fwidth')
    expect(plainShader.fragmentShader).toContain('vec3(0.07, 0.04, 0.03)')
    plain.dispose()
    material.dispose()
  })
})

/** Layouts as the room measures them (NDC): the pot readout sits above the hole-card tray, the tray near the bottom. */
const LAYOUTS = {
  p720: { potX: -0.05, potHalfW: 0.1, potBottomY: -0.4, potTopY: -0.28, cardsX: 0.04, cardsHalfW: 0.13, cardsTopY: -0.53, cardsY: -0.69 },
  p900: { potX: -0.05, potHalfW: 0.095, potBottomY: -0.36, potTopY: -0.27, cardsX: 0.02, cardsHalfW: 0.115, cardsTopY: -0.5, cardsY: -0.66 },
  wide: { potX: 0.1, potHalfW: 0.12, potBottomY: -0.45, potTopY: -0.3, cardsX: 0.0, cardsHalfW: 0.14, cardsTopY: -0.55, cardsY: -0.72 },
}

describe('first-person hands: the fold toss clears the pot label', () => {
  it('the toss lane sits beyond the label by more than a card width, and is never under the tray', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const anchors = { ...createHeroHandsAnchors(), ...layout }
      const lane = getFoldLaneX(anchors)
      expect(lane).toBeGreaterThanOrEqual(anchors.potX + anchors.potHalfW + 0.1)
      expect(lane).toBeGreaterThan(anchors.cardsX + anchors.cardsHalfW)
    }
    // No label measured: the lane is just beside the tray as before.
    const none = createHeroHandsAnchors()
    expect(getFoldLaneX(none)).toBeCloseTo(none.cardsX + none.cardsHalfW + 0.075 - 0.025, 5)
  })

  it('a carried card stays under the label until it has slid out past it; a flying one stays above', () => {
    const anchors = { ...createHeroHandsAnchors(), ...LAYOUTS.p720 }
    // Under the label's columns: held below its bottom edge (card top below the label).
    expect(keepCardOffLabel(0.0, -0.2, 1, false, anchors)).toBeLessThan(anchors.potBottomY - 0.14)
    // Beside it nothing is touched.
    expect(keepCardOffLabel(0.5, -0.2, 1, false, anchors)).toBe(-0.2)
    // In flight, over the label's columns, held above its top edge.
    expect(keepCardOffLabel(0.0, -0.4, 0.6, true, anchors)).toBeGreaterThan(anchors.potTopY + 0.14 * 0.6)
    expect(keepCardOffLabel(0.0, 0.2, 0.6, true, anchors)).toBe(0.2)
    // No label measured: untouched.
    expect(keepCardOffLabel(0.0, -0.2, 1, false, createHeroHandsAnchors())).toBe(-0.2)
  })

  it('no frame of any fold style puts the two cards over the label, at any measured layout', () => {
    for (const [name, layout] of Object.entries(LAYOUTS)) {
      const anchors = { ...createHeroHandsAnchors(), ...layout }
      for (const variant of [0, 1, 2] as const) {
        const profile = getPokerActionMotionProfile('fold', { variant })
        for (let t = 0; t <= getHeroGestureSeconds('fold', profile); t += 0.01) {
          const { cards } = pose('fold', t, { profile, anchors })
          if (!cards.visible) continue
          // On-screen half size of a card (and its fan), shrinking as it flies off.
          const shrink = (cards.scale * (HAND_DEPTH + 0.11)) / cards.depth
          const halfW = 0.075 * shrink
          const halfH = 0.12 * shrink
          const overlapX = Math.abs(cards.x - anchors.potX) < anchors.potHalfW + halfW
          const overlapY = cards.y - halfH < anchors.potTopY && cards.y + halfH > anchors.potBottomY
          expect(overlapX && overlapY, `${name} style ${variant} t=${t.toFixed(2)} card (${cards.x.toFixed(2)}, ${cards.y.toFixed(2)})`).toBe(false)
        }
      }
    }
  })
})

describe('first-person hands: wager size', () => {
  const anchors = { ...createHeroHandsAnchors(), ...LAYOUTS.p720, stackX: 0.3, stackY: -0.47, betX: 0.0, betY: -0.2, restRightX: 0.25, restLeftX: -0.2 }
  const run = (cue: ThreeActionCue, intensity: number, variant: 0 | 1 | 2 = 0) => {
    const profile = getPokerActionMotionProfile(cue, { variant, wagerIntensity: intensity })
    const frames: HeroHandsPose[] = []
    for (let t = 0; t <= getHeroGestureSeconds(cue, profile) + 0.1; t += 0.02) frames.push(pose(cue, t, { anchors, profile }))
    return frames
  }
  const travel = (frames: HeroHandsPose[], side: 'left' | 'right') => Math.max(...frames.map(f => Math.hypot(f[side].x - frames[0]![side].x, f[side].y - frames[0]![side].y)))

  it('a small bet is one hand sliding the chips, a big raise needs both, an all-in always shoves with both', () => {
    expect(getWagerPairWeight('call', 0.25)).toBe(0)
    expect(getWagerPairWeight('bet', 0.45)).toBe(0)
    expect(getWagerPairWeight('raise', 0.9)).toBe(1)
    expect(getWagerPairWeight('raise', 0.7)).toBe(1)
    expect(getWagerPairWeight('raise', 0.5)).toBe(0)
    expect(getWagerPairWeight('all_in', 0)).toBe(1)
    const small = run('bet', 0.3)
    const big = run('raise', 1)
    const shove = run('all_in', 1)
    expect(travel(small, 'left')).toBeLessThan(0.05)
    expect(travel(big, 'left')).toBeGreaterThan(0.35)
    expect(travel(shove, 'left')).toBeGreaterThan(0.35)
    // The pair is symmetric about the pile: both fists close on it.
    const grabAt = Math.round((WAGER_DEPART_SECONDS + 0.02) / 0.02)
    expect(big[grabAt]!.left.fist).toBeGreaterThan(0.4)
    expect(small[grabAt]!.left.fist).toBeLessThan(0.3)
  })

  it('the second hand is all or nothing: a half-faded hand would hang over the hole-card tray', () => {
    for (let intensity = 0.5; intensity <= 0.9; intensity += 0.02) {
      const left = travel(run('raise', intensity), 'left')
      expect(left < 0.05 || left > 0.35, `intensity ${intensity.toFixed(2)} moved the left hand ${left.toFixed(2)}`).toBe(true)
    }
  })

  it('the hero pushes chips, never throws them: a flicked bet is flattened to a slide and the hand stays low', () => {
    // How far the wrist rises above the straight line of the push (the pile's path on screen).
    const lift = (frames: HeroHandsPose[]) => {
      const from = Math.round((WAGER_DEPART_SECONDS + 0.1) / 0.02)
      const to = Math.round((WAGER_DEPART_SECONDS + 0.62) / 0.02)
      const a = frames[from]!.right
      const b = frames[to]!.right
      let worst = 0
      for (let i = from; i <= to; i += 1) {
        const k = (i - from) / (to - from)
        worst = Math.max(worst, frames[i]!.right.y - (a.y + (b.y - a.y) * k))
      }
      return worst
    }
    expect(getPokerActionMotionProfile('all_in', { variant: 1 }).wagerStyle).toBe('flick')
    expect(getHeroPushStyle('flick')).toBe('slide')
    expect(getHeroPushStyle('shove')).toBe('shove')
    expect(getHeroPushStyle('slide')).toBe('slide')
    expect(lift(run('all_in', 1, 1))).toBeLessThan(0.08)
    expect(lift(run('raise', 1, 1))).toBeLessThan(0.08)
  })

  it('the second hand crosses above the hole-card tray, never behind it, and comes home the same way', () => {
    for (const [cue, intensity] of [['raise', 0.66], ['raise', 0.72], ['raise', 0.8], ['raise', 1], ['all_in', 1]] as const) {
      for (const frame of run(cue, intensity)) {
        const hand = frame.left
        if (Math.abs(hand.x - anchors.cardsX) < anchors.cardsHalfW - 0.02 && Math.abs(hand.x - anchors.restLeftX) > 0.08) {
          expect(hand.y, `${cue} ${intensity}`).toBeGreaterThan(anchors.cardsTopY - 0.02)
        }
      }
    }
  })

  it('every size settles onto the rail with no pop at the end of the gesture', () => {
    for (const [cue, intensity] of [['call', 0.3], ['bet', 0.5], ['raise', 1], ['all_in', 1]] as const) {
      const profile = getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: intensity })
      const length = getHeroGestureSeconds(cue, profile)
      for (const side of ['right', 'left'] as const) {
        const before = pose(cue, length - 0.02, { anchors, profile })[side]
        const after = pose(cue, length + 0.02, { anchors, profile })[side]
        // 0.04 s apart: a pop would be a big step; the settle is a slow slide.
        expect(Math.abs(after.y - before.y), `${cue} ${side}`).toBeLessThan(0.05)
        expect(Math.abs(after.x - before.x), `${cue} ${side}`).toBeLessThan(0.05)
      }
    }
  })
})

describe('first-person hands: dealing keeps clear of the action tray', () => {
  const anchors = { stackX: 0.3, potX: -0.05, potHalfW: 0.1 }

  it('without a tray the wrist works beyond the hero chip stack', () => {
    expect(getDealRightX(0.2, anchors, null)).toBeCloseTo(0.56, 5)
    expect(getDealRightX(0.2, { ...anchors, stackX: 0 }, null)).toBeCloseTo(0.22, 5)
  })

  it('with the tray or the pre-action chips up, the wrist stays left of them, over the stack', () => {
    // A tray whose left edge is at NDC 0.31 (about 840px of 1280): the hand's right edge stays short of it.
    const x = getDealRightX(0.2, anchors, 0.31)
    expect(x + 0.075).toBeLessThan(0.31)
    expect(x).toBeGreaterThan(0.1)
  })

  it('and right of the pot readout when there is room for a hand between the two', () => {
    const x = getDealRightX(0.2, anchors, 0.31)
    expect(x - 0.075).toBeGreaterThanOrEqual(anchors.potX + anchors.potHalfW - 1e-6)
  })

  it('a tray close to the cards wins over the pot readout (no ghost hand behind the glass)', () => {
    const x = getDealRightX(0.2, { ...anchors, potX: 0.05 }, 0.2)
    expect(x).toBeLessThanOrEqual(0.2 - 0.1 + 1e-6)
  })
})

describe('first-person hands: acting while dealing', () => {
  const deal = { weight: 1, rightX: 0, rightY: -1, leftX: 0, leftY: -1, pinch: 0, cock: 0, snap: 0, holdLeft: 1 }

  it('a fold taken mid-deal is played (cards tossed), not swallowed by the deal; the deal resumes after', () => {
    const during = pose('fold', 0.4, { deal })
    expect(during.cards.visible).toBe(true)
    const wager = pose('raise', 0.5, { deal })
    expect(wager.right.fist).toBeGreaterThan(0.3)
    // Once the gesture is over the dealing hands are back.
    const profile = getPokerActionMotionProfile('fold', { variant: 0 })
    const after = pose('fold', getHeroGestureSeconds('fold', profile) + 0.1, { deal })
    expect(after.right.x).toBeGreaterThan(0.25)
    expect(after.cards.visible).toBe(false)
    // A ready cue is still just dealing.
    expect(pose('ready', 99, { deal }).right.x).toBeGreaterThan(0.25)
  })
})
