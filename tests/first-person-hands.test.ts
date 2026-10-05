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
  getHeroGestureSeconds,
  getWagerTravelSeconds,
  HAND_DEPTH,
  MAX_REACH_Y,
  MIN_HAND_DEPTH,
  REST_Y,
  WAGER_DEPART_SECONDS,
  type HeroHandsInput,
  type HeroHandsPose,
} from '@/components/three/firstPersonHandPose'
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
    expect(atStack.right.x).toBeCloseTo(anchors.stackX + 0.02, 1)
    expect(atStack.right.fist).toBeGreaterThan(0.5)
    expect(midPush.right.x).toBeLessThan(atStack.right.x)
    expect(midPush.right.x).toBeGreaterThan(arrive.right.x - 1e-6)
    // The spot is behind the hole-card tray on screen: the hand stops at the tray's side and the chips slide on.
    expect(arrive.right.x).toBeLessThan(atStack.right.x - 0.08)
    expect(arrive.right.x).toBeGreaterThan(anchors.cardsX + 0.15)
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
    expect(getWagerTravelSeconds({ wagerStyle: 'flick', wagerIntensity: 0 })).toBeCloseTo(0.78)
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

  it('wagers stay clear of the pot label and the card tray even when the betting spot is behind them', () => {
    const anchors = { ...createHeroHandsAnchors(), stackX: 0.32, stackY: -0.42, betX: 0.02, betY: -0.3, potX: 0, potHalfW: 0.09, potBottomY: -0.28 }
    for (const cue of ['call', 'raise', 'all_in'] as const) {
      const p = getPokerActionMotionProfile(cue, { variant: 0, wagerIntensity: 0.8 })
      for (let t = 0; t <= getHeroGestureSeconds(cue, p); t += 0.02) {
        const hands = pose(cue, t, { anchors, profile: p })
        for (const hand of [hands.right, hands.left]) {
          if (Math.abs(hand.x - anchors.potX) < anchors.potHalfW) expect(hand.y).toBeLessThan(anchors.potBottomY - 0.2)
          if (Math.abs(hand.x - anchors.cardsX) < anchors.cardsHalfW - 0.02) expect(hand.y).toBeGreaterThan(anchors.cardsTopY - 0.13)
        }
      }
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
