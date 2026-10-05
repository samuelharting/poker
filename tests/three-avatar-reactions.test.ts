import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  SOCIAL_ACTION_WINDOW_SECONDS,
  computeSocialReactions,
  createAvatarSocialInput,
  createReactionContext,
  createReactionState,
  hash01,
  nervousDrumRate,
  pickWinnerReaction,
  type AvatarSocialInput,
  type ReactionContext,
  type ReactionState,
} from '@/components/three/avatarReactions'
import {
  createTableSocialFrame,
  fillSeatSocial,
  setSeatSocialStats,
  updateTableSocialFrame,
  type SocialSeat,
} from '@/components/three/avatarSocialFeed'
import {
  computeAvatarTargetPose,
  createAvatarAnimatorState,
  type AvatarAnimatorInput,
} from '@/components/three/avatarAnimator'

type V3 = [number, number, number]
const anchors = {
  railR: [0.3, 0.9, -0.9] as V3,
  railL: [-0.3, 0.9, -0.9] as V3,
  cards: [0, 0.5, -1.6] as V3,
  chest: [0, 1.1, -0.3] as V3,
  chin: [0, 1.5, -0.35] as V3,
  shoulderR: [0.25, 1.35, -0.15] as V3,
  shoulderL: [-0.25, 1.35, -0.15] as V3,
  stack: [0.5, 0.5, -1.5] as V3,
  betSpot: [0, 0.5, -2.4] as V3,
  tap: [0.15, 0.5, -1.3] as V3,
  board: [0, 0.5, -4] as V3,
  drinkRest: [-0.5, 0.5, -1.5] as V3,
}

function ctxWith(overrides: Partial<ReactionContext> = {}): ReactionContext {
  return { ...createReactionContext(), ...overrides }
}

function socialWith(overrides: Partial<AvatarSocialInput> = {}): AvatarSocialInput {
  return { ...createAvatarSocialInput(), ...overrides }
}

/** Peak of one weight over an action's reaction window, for one seat. */
function peak(
  social: AvatarSocialInput,
  pick: (w: ReturnType<typeof computeSocialReactions>) => number,
  seed: number,
  ctx: Partial<ReactionContext> = {}
) {
  const rx = createReactionState()
  let best = 0
  for (let age = 0; age < SOCIAL_ACTION_WINDOW_SECONDS; age += 0.05) {
    const s = { ...social, actorAge: age }
    best = Math.max(best, Math.abs(pick(computeSocialReactions(rx, s, ctxWith({ time: 50 + age, seed, ...ctx })))))
  }
  return best
}

describe('reaction hashing', () => {
  it('is deterministic and spread over 0..1', () => {
    expect(hash01(123456, 7)).toBe(hash01(123456, 7))
    let sum = 0
    for (let i = 0; i < 400; i += 1) {
      const value = hash01(1000 + i * 37, i)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      sum += value
    }
    expect(sum / 400).toBeGreaterThan(0.4)
    expect(sum / 400).toBeLessThan(0.6)
  })
})

describe('eye contact and nods toward the hero', () => {
  const heroRaise = socialWith({ actorCue: 'raise', actorKey: 777, actorIsHero: true, actorWager: 0.7, actorYaw: 0.4, actorPitch: -0.2, actorSteps: 2 })

  it('most of the table turns to the hero when the hero acts, at the real bearing', () => {
    let attentive = 0
    for (let i = 0; i < 40; i += 1) {
      const seed = i / 40
      const rx = createReactionState()
      let max = 0
      for (let age = 0; age < SOCIAL_ACTION_WINDOW_SECONDS; age += 0.05) {
        const w = computeSocialReactions(rx, { ...heroRaise, actorAge: age }, ctxWith({ time: 20 + age, seed }))
        if (w.look > max) {
          max = w.look
          expect(w.lookYaw).toBeCloseTo(0.4, 6)
          expect(w.lookPitch).toBeCloseTo(-0.2, 6)
        }
      }
      if (max > 0.5) attentive += 1
    }
    expect(attentive).toBeGreaterThanOrEqual(30)
    expect(attentive).toBeLessThan(41)
  })

  it('looks at the hero while the hero is on the clock, but never while acting itself', () => {
    const waiting = socialWith({ heroActing: true, heroYaw: -0.3, heroPitch: 0.1 })
    const rx = createReactionState()
    const w = computeSocialReactions(rx, waiting, ctxWith({ time: 5, seed: 0.3 }))
    expect(w.look).toBeGreaterThan(0.4)
    expect(w.lookYaw).toBeCloseTo(-0.3, 6)
    const own = computeSocialReactions(createReactionState(), waiting, ctxWith({ time: 5, seed: 0.3, acting: true, beatFree: false, headFree: false, handsFree: false }))
    expect(own.look).toBe(0)
  })

  it('some seats nod and some shake at a hero raise, never both in one beat', () => {
    let nods = 0
    let shakes = 0
    for (let i = 0; i < 80; i += 1) {
      const seed = i / 80
      const nod = peak(heroRaise, w => w.nod, seed)
      const shake = peak(heroRaise, w => w.shake, seed)
      expect(nod > 0 && shake > 0).toBe(false)
      if (nod > 0.2) nods += 1
      if (shake > 0.2) shakes += 1
    }
    expect(nods).toBeGreaterThan(10)
    expect(shakes).toBeGreaterThan(3)
    expect(nods).toBeGreaterThan(shakes)
  })

  it('a hero check gets only the odd polite nod and no shakes', () => {
    const check = socialWith({ actorCue: 'check', actorKey: 91, actorIsHero: true })
    let nods = 0
    for (let i = 0; i < 80; i += 1) {
      expect(peak(check, w => w.shake, i / 80)).toBe(0)
      if (peak(check, w => w.nod, i / 80) > 0.2) nods += 1
    }
    expect(nods).toBeGreaterThan(5)
    expect(nods).toBeLessThan(40)
  })

  it('ignores a small raise by another player but reacts to a big one', () => {
    const small = socialWith({ actorCue: 'raise', actorKey: 33, actorWager: 0.2, actorSteps: 2 })
    const big = socialWith({ actorCue: 'raise', actorKey: 33, actorWager: 0.9, actorSteps: 2 })
    let smallGestures = 0
    let bigGestures = 0
    for (let i = 0; i < 80; i += 1) {
      const seed = i / 80
      if (peak(small, w => w.nod + Math.abs(w.shake), seed) > 0.05) smallGestures += 1
      if (peak(big, w => w.nod + Math.abs(w.shake), seed) > 0.05) bigGestures += 1
    }
    expect(smallGestures).toBe(0)
    expect(bigGestures).toBeGreaterThan(15)
  })

  it('turns toward the pot winner (the hero most of all) and fades out', () => {
    const win = socialWith({ winnerAge: 1.2, winnerKey: 5, winnerIsHero: true, winnerYaw: 0.6, winnerPitch: -0.1 })
    let looked = 0
    for (let i = 0; i < 40; i += 1) {
      const w = computeSocialReactions(createReactionState(), win, ctxWith({ time: 9, seed: i / 40 }))
      if (w.look > 0.5) {
        looked += 1
        expect(w.lookYaw).toBeCloseTo(0.6, 6)
      }
    }
    expect(looked).toBeGreaterThanOrEqual(28)
    const late = computeSocialReactions(createReactionState(), { ...win, winnerAge: 5 }, ctxWith({ time: 9, seed: 0.2 }))
    expect(late.look).toBe(0)
  })

  it('makes a friendly table clap or nod more when the hero wins', () => {
    let positive = 0
    let positiveOther = 0
    const hero = socialWith({ winnerIsHero: true, winnerKey: 4242 })
    const other = socialWith({ winnerIsHero: false, winnerKey: 4242 })
    for (let i = 0; i < 100; i += 1) {
      const kind = i % 5
      if ([0, 1].includes(pickWinnerReaction(kind, hero, i / 100))) positive += 1
      if ([0, 1].includes(pickWinnerReaction(kind, other, i / 100))) positiveOther += 1
    }
    expect(positiveOther).toBe(40)
    expect(positive).toBeGreaterThan(65)
    expect(pickWinnerReaction(3, undefined, 0.5)).toBe(3)
  })
})

describe('all-in gasp and sweat', () => {
  it('neighbours gasp at an all-in more than far seats, the hero draws a gasp too', () => {
    const near = socialWith({ actorCue: 'all_in', actorKey: 1000, actorSteps: 1, actorWager: 1 })
    const far = socialWith({ actorCue: 'all_in', actorKey: 1000, actorSteps: 4, actorWager: 1 })
    let nearCount = 0
    let farCount = 0
    for (let i = 0; i < 100; i += 1) {
      if (peak(near, w => w.gasp, i / 100) > 0.5) nearCount += 1
      if (peak(far, w => w.gasp, i / 100) > 0.5) farCount += 1
    }
    expect(nearCount).toBeGreaterThan(farCount)
    expect(nearCount).toBeGreaterThan(30)
    expect(farCount).toBeLessThan(35)
    const side = new Set<number>()
    for (let i = 0; i < 100; i += 1) {
      const rx = createReactionState()
      const w = computeSocialReactions(rx, { ...near, actorAge: 1.2 }, ctxWith({ time: 30, seed: i / 100 }))
      if (w.gasp > 0) side.add(w.gaspSide)
    }
    expect(side.size).toBe(2)
  })

  it('never gasps while acting, and not in hands when folded', () => {
    const near = socialWith({ actorCue: 'all_in', actorKey: 1000, actorSteps: 1 })
    for (let i = 0; i < 30; i += 1) {
      expect(peak(near, w => w.gasp, i / 30, { acting: true, beatFree: false, headFree: false, handsFree: false })).toBe(0)
    }
  })

  it('sweats the run-out in bursts once all-in, tighter as each card lands', () => {
    const rx = createReactionState()
    const social = socialWith({ allIn: true, atRisk: 1 })
    let max = 0
    let min = 1
    for (let t = 0; t < 12; t += 0.1) {
      const w = computeSocialReactions(rx, social, ctxWith({ time: 100 + t, seed: 0.37 }))
      if (t < 1.0) expect(w.sweat).toBe(0)
      if (t > 3) {
        max = Math.max(max, w.sweat)
        min = Math.min(min, w.sweat)
      }
    }
    expect(max).toBeGreaterThan(0.6)
    // Bursts, not a constant pose.
    expect(min).toBeLessThan(0.3)
    // A fresh community card brings the held breath at any point in the cycle.
    const reveal = computeSocialReactions(rx, social, ctxWith({ time: 112, seed: 0.37, boardAge: 0.9 }))
    expect(reveal.sweat).toBeGreaterThan(0.9)
    // Not all-in, not folded players, not while acting.
    expect(computeSocialReactions(createReactionState(), socialWith({ allIn: false }), ctxWith({ time: 120, boardAge: 0.9 })).sweat).toBe(0)
    expect(computeSocialReactions(rx, social, ctxWith({ time: 112, seed: 0.37, boardAge: 0.9, folded: true })).sweat).toBe(0)
  })
})

describe('bad beats and hit outs from the broadcast odds', () => {
  function run(odds: number[], stepSeconds = 0.5, ctx: Partial<ReactionContext> = {}) {
    const rx: ReactionState = createReactionState()
    const trace: Array<{ t: number; bad: number; relief: number }> = []
    let time = 200
    for (const value of odds) {
      const w = computeSocialReactions(rx, socialWith({ oddsWin: value, allIn: true }), ctxWith({ time, seed: 0.2, ...ctx }))
      trace.push({ t: time, bad: w.badBeat, relief: w.relief })
      time += stepSeconds
    }
    return { rx, trace }
  }

  it('hands fly to the head when a favourite is cracked, then settle', () => {
    const odds = [82, 82, 82, 82, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
    const { trace } = run(odds)
    expect(Math.max(...trace.slice(0, 4).map(row => row.bad))).toBe(0)
    expect(Math.max(...trace.map(row => row.bad))).toBeGreaterThan(0.9)
    expect(trace[trace.length - 1]!.bad).toBe(0)
    // One trigger only: the pose goes up and down once.
    let rises = 0
    for (let i = 1; i < trace.length; i += 1) if (trace[i]!.bad > 0.5 && trace[i - 1]!.bad <= 0.5) rises += 1
    expect(rises).toBe(1)
  })

  it('a small drift or a mid-range swing is not a bad beat', () => {
    expect(Math.max(...run([55, 52, 49, 46, 40, 35, 30, 28]).trace.map(row => row.bad))).toBe(0)
    expect(Math.max(...run([70, 70, 40, 40, 40]).trace.map(row => row.bad))).toBe(0)
  })

  it('a long shot hitting its out sags with relief instead', () => {
    const { trace } = run([12, 12, 12, 12, 97, 97, 97, 97, 97, 97])
    expect(Math.max(...trace.map(row => row.relief))).toBeGreaterThan(0.9)
    expect(Math.max(...trace.map(row => row.bad))).toBe(0)
  })

  it('does nothing without odds, and forgets the history when they go away', () => {
    const rx = createReactionState()
    let time = 300
    for (const value of [80, 80, 80, -1, -1, 5, 5]) {
      const w = computeSocialReactions(rx, socialWith({ oddsWin: value }), ctxWith({ time, seed: 0.5 }))
      expect(w.badBeat).toBe(0)
      time += 0.5
    }
  })

  it('hands the pose to the loss reaction when the showdown loss lands', () => {
    const rx = createReactionState()
    let time = 400
    for (const value of [80, 80, 80, 5]) {
      computeSocialReactions(rx, socialWith({ oddsWin: value }), ctxWith({ time, seed: 0.5 }))
      time += 0.5
    }
    const holding = computeSocialReactions(rx, socialWith({ oddsWin: 5 }), ctxWith({ time, seed: 0.5 }))
    expect(holding.badBeat).toBeGreaterThan(0.6)
    const lost = computeSocialReactions(rx, socialWith({ oddsWin: 5 }), ctxWith({ time: time + 0.7, seed: 0.5, loserAge: 0.7, headFree: false, handsFree: false }))
    expect(lost.badBeat).toBe(0)
    const fading = computeSocialReactions(rx, socialWith({ oddsWin: 5 }), ctxWith({ time: time + 0.1, seed: 0.5, loserAge: 0.1, headFree: false, handsFree: false }))
    expect(fading.badBeat).toBeGreaterThan(0)
    expect(fading.badBeat).toBeLessThan(holding.badBeat + 0.01)
  })
})

describe('nervous tells scale with the stack at risk', () => {
  function nerves(atRisk: number, seed = 0.4) {
    const rx = createReactionState()
    let nervous = 0
    let drum = 0
    let glance = 0
    for (let t = 0; t < 30; t += 0.1) {
      const w = computeSocialReactions(rx, socialWith({ atRisk }), ctxWith({ time: 10 + t, seed }))
      nervous = Math.max(nervous, w.nervous)
      drum += w.drum
      glance += w.chipGlance
    }
    return { nervous, drum, glance }
  }

  it('is silent for a comfortable stack and grows monotonically', () => {
    expect(nerves(0.05)).toEqual({ nervous: 0, drum: 0, glance: 0 })
    const a = nerves(0.3)
    const b = nerves(0.6)
    const c = nerves(1)
    expect(a.nervous).toBeLessThan(b.nervous)
    expect(b.nervous).toBeLessThan(c.nervous)
    expect(a.drum).toBeLessThan(c.drum)
    // Glances down at the chips come more often when more is at stake.
    expect(a.glance).toBeLessThan(c.glance)
    expect(c.nervous).toBeCloseTo(1, 5)
  })

  it('drums faster the more is at risk', () => {
    expect(nervousDrumRate(1)).toBeGreaterThan(nervousDrumRate(0.3))
    expect(nervousDrumRate(0)).toBeGreaterThan(2)
  })

  it('stays off while acting, folded or with the hands busy', () => {
    for (const ctx of [
      { acting: true, beatFree: false, headFree: false, handsFree: false },
      { folded: true, handsFree: false },
      { handsFree: false },
    ]) {
      const w = computeSocialReactions(createReactionState(), socialWith({ atRisk: 1 }), ctxWith({ time: 10, seed: 0.4, ...ctx }))
      expect(w.nervous).toBe(0)
      expect(w.drum).toBe(0)
    }
  })
})

describe('shrug on folding to a big bet', () => {
  it('shrugs when folding to a big bet, not to a small one, and only once folded', () => {
    let big = 0
    let small = 0
    for (let i = 0; i < 80; i += 1) {
      const seed = i / 80
      const run = (facingBet: number, folded = true) => {
        const rx = createReactionState()
        let best = 0
        for (let age = 0; age < 3; age += 0.05) {
          const social = socialWith({ selfCue: 'fold', selfKey: 8888, selfCueAge: age, facingBet })
          best = Math.max(best, computeSocialReactions(rx, social, ctxWith({ time: 60 + age, seed, folded })).shrug)
        }
        return best
      }
      if (run(0.9) > 0.5) big += 1
      if (run(0.3) > 0) small += 1
      expect(run(0.9, false)).toBe(0)
    }
    expect(big).toBeGreaterThan(45)
    expect(big).toBeLessThan(80)
    expect(small).toBe(0)
  })

  it('remembers how big the bet was after the table state moves on', () => {
    const rx = createReactionState()
    let best = 0
    for (let age = 0; age < 3; age += 0.05) {
      // The bet shrinks to nothing as the hand ends one beat after the fold.
      const facingBet = age < 0.2 ? 0.95 : 0
      const social = socialWith({ selfCue: 'fold', selfKey: 31, selfCueAge: age, facingBet })
      best = Math.max(best, computeSocialReactions(rx, social, ctxWith({ time: 70 + age, seed: 0.05, folded: true })).shrug)
    }
    expect(best).toBeGreaterThan(0.5)
  })
})

describe('reduced motion', () => {
  it('zeroes every weight', () => {
    const rx = createReactionState()
    const social = socialWith({
      actorCue: 'all_in', actorAge: 1, actorKey: 3, actorIsHero: true, heroActing: true, allIn: true, atRisk: 1,
      winnerAge: 1, winnerKey: 2, winnerIsHero: true, oddsWin: 3, selfCue: 'fold', selfCueAge: 1, facingBet: 1,
    })
    const w = computeSocialReactions(rx, social, ctxWith({ time: 3, seed: 0.3, motion: 0, folded: true }))
    for (const [key, value] of Object.entries(w)) {
      if (key === 'gaspSide') continue
      expect(value, key).toBe(0)
    }
  })

  it('allocates nothing per call', () => {
    const rx = createReactionState()
    const social = socialWith({ actorCue: 'raise', actorAge: 1, actorKey: 3, actorWager: 0.8, atRisk: 0.7 })
    const ctx = ctxWith({ time: 3, seed: 0.3 })
    const first = computeSocialReactions(rx, social, ctx)
    ctx.time = 3.1
    expect(computeSocialReactions(rx, social, ctx)).toBe(first)
  })
})

describe('social input in the avatar animator', () => {
  function animInput(overrides: Partial<AvatarAnimatorInput> = {}): AvatarAnimatorInput {
    return {
      time: 10,
      delta: 1 / 60,
      reducedMotion: false,
      acting: false,
      folded: false,
      winner: false,
      loser: false,
      hasCards: true,
      cue: 'ready',
      cueElapsedMs: 0,
      cueActive: false,
      actionKey: '',
      playerId: 'p1',
      wagerIntensity: 0,
      lookYaw: 0,
      lookPitch: -0.035,
      tableHeat: 0,
      idleTell: 'calm',
      celebration: 'victory',
      anchors,
      ...overrides,
    }
  }

  it('turns the head toward the hero at the bearing the feed gives', () => {
    // A seat that is not attentive to a hero raise is the exception (about one in ten); find an attentive one.
    let checked = 0
    for (let i = 0; i < 20 && checked < 3; i += 1) {
      const id = `seat-${i}`
      const state = createAvatarAnimatorState(id)
      const social = socialWith({ actorCue: 'raise', actorKey: 555, actorIsHero: true, actorWager: 0.6, actorYaw: 0.7, actorPitch: 0.05, actorSteps: 1, actorAge: 1.3 })
      const base = computeAvatarTargetPose(createAvatarAnimatorState(id), animInput({ playerId: id }))
      const pose = computeAvatarTargetPose(state, animInput({ playerId: id, social }))
      if (Math.abs(pose.bones.Head[1] - 0.65 * 0.7) < 0.12) {
        checked += 1
        expect(Math.abs(pose.bones.Head[1] - base.bones.Head[1])).toBeGreaterThan(0.1)
        expect(pose.bones.Neck[1]).toBeGreaterThan(0.15)
      }
    }
    expect(checked).toBeGreaterThan(0)
  }, 30_000)

  it('does not move at all under reduced motion, or while acting', () => {
    const social = socialWith({ actorCue: 'all_in', actorKey: 9, actorIsHero: true, actorYaw: 0.7, actorAge: 1, allIn: true, atRisk: 1, heroActing: true })
    const a = computeAvatarTargetPose(createAvatarAnimatorState('p1'), animInput({ reducedMotion: true }))
    const b = computeAvatarTargetPose(createAvatarAnimatorState('p1'), animInput({ reducedMotion: true, social }))
    expect(b.bones.Head).toEqual(a.bones.Head)
    expect(b.handR).toEqual(a.handR)
    const c = computeAvatarTargetPose(createAvatarAnimatorState('p1'), animInput({ acting: true }))
    const d = computeAvatarTargetPose(createAvatarAnimatorState('p1'), animInput({ acting: true, social }))
    expect(d.bones.Head[1]).toBeCloseTo(c.bones.Head[1], 6)
  })

  it('brings both hands to the head on a bad beat', () => {
    const state = createAvatarAnimatorState('p1')
    // Seed the odds history, then drop them.
    for (let t = 0; t < 2; t += 0.5) computeAvatarTargetPose(state, animInput({ time: 40 + t, social: socialWith({ oddsWin: 85, allIn: true }) }))
    const pose = computeAvatarTargetPose(state, animInput({ time: 42.5, social: socialWith({ oddsWin: 4, allIn: true }) }))
    const later = computeAvatarTargetPose(state, animInput({ time: 43.4, social: socialWith({ oddsWin: 4, allIn: true }) }))
    const rest = computeAvatarTargetPose(createAvatarAnimatorState('p1'), animInput({ time: 43.4 }))
    expect(later.handR[1]).toBeGreaterThan(rest.handR[1] + 0.3)
    expect(later.handL[1]).toBeGreaterThan(rest.handL[1] + 0.3)
    expect(later.handR[0]).toBeGreaterThan(later.handL[0])
    expect(later.elbowUp).toBeGreaterThan(0.2)
    expect(pose.bones.Chest[0]).toBeLessThan(later.bones.Chest[0] + 0.5)
  })

  it('puts a hand over the mouth to gasp at a neighbour all-in', () => {
    let gasped = 0
    for (let i = 0; i < 30; i += 1) {
      const id = `gasper-${i}`
      const social = socialWith({ actorCue: 'all_in', actorKey: 1000, actorWager: 1, actorSteps: 1, actorAge: 1.3 })
      const base = computeAvatarTargetPose(createAvatarAnimatorState(id), animInput({ playerId: id }))
      const pose = computeAvatarTargetPose(createAvatarAnimatorState(id), animInput({ playerId: id, social }))
      const lift = Math.max(pose.handR[1] - base.handR[1], pose.handL[1] - base.handL[1])
      if (lift > 0.25) {
        gasped += 1
        expect(pose.headFollow).toBeGreaterThan(0.5)
      }
    }
    expect(gasped).toBeGreaterThan(5)
  }, 30_000)
})

describe('social feed', () => {
  function makeSeat(visualSeat: number, x: number, z: number, overrides: Partial<SocialSeat> = {}): SocialSeat {
    const root = new THREE.Group()
    root.position.set(x, 0, z)
    // Faces the table centre (-Z local points at the origin), like the room does.
    root.rotation.y = Math.atan2(x, z)
    root.updateMatrixWorld(true)
    return {
      visualSeat,
      isHero: false,
      acting: false,
      winner: false,
      root,
      avatar: null,
      playback: { key: '', cue: 'ready', startedAtMs: Number.NEGATIVE_INFINITY },
      wagerIntensity: 0,
      anchors: { chin: [0, 1.5, -0.35] },
      social: createAvatarSocialInput(),
      ...overrides,
    }
  }

  const camera = new THREE.Object3D()
  camera.position.set(0, 4.08, 6.26)
  camera.updateMatrixWorld(true)

  it('points the seat opposite the hero straight ahead and a little up', () => {
    const hero = makeSeat(0, 0, 3, { isHero: true, playback: { key: 'h', cue: 'raise', startedAtMs: 10_000 } })
    const across = makeSeat(4, 0, -3)
    const frame = createTableSocialFrame()
    updateTableSocialFrame(frame, [hero, across], camera, 10.5)
    const social = fillSeatSocial(across, frame, 10.5)
    expect(social.actorCue).toBe('raise')
    expect(social.actorIsHero).toBe(true)
    expect(social.actorAge).toBeCloseTo(0.5, 5)
    expect(social.actorSteps).toBe(4)
    expect(Math.abs(social.actorYaw)).toBeLessThan(0.05)
    // The camera is above the felt: the face tips up (negative pitch).
    expect(social.actorPitch).toBeLessThan(-0.2)
  })

  it('turns neighbours toward the hero on the correct side', () => {
    const hero = makeSeat(0, 0, 3, { isHero: true, playback: { key: 'h', cue: 'bet', startedAtMs: 10_000 } })
    const right = makeSeat(1, 2.5, 2)
    const left = makeSeat(7, -2.5, 2)
    const frame = createTableSocialFrame()
    updateTableSocialFrame(frame, [hero, right, left], camera, 10.4)
    const a = fillSeatSocial(right, frame, 10.4)
    const b = fillSeatSocial(left, frame, 10.4)
    expect(Math.sign(a.actorYaw)).toBe(-Math.sign(b.actorYaw))
    expect(Math.abs(a.actorYaw)).toBeGreaterThan(0.4)
    expect(a.actorSteps).toBe(1)
    expect(b.actorSteps).toBe(1)
  })

  it('skips a seat\'s own action and old actions, and gives the hero no reactions', () => {
    const a = makeSeat(2, -2, 0, { playback: { key: 'a', cue: 'all_in', startedAtMs: 20_000 } })
    const b = makeSeat(5, 2, 0, { playback: { key: 'b', cue: 'raise', startedAtMs: 19_000 } })
    const old = makeSeat(6, 2, -2, { playback: { key: 'c', cue: 'bet', startedAtMs: 1_000 } })
    const hero = makeSeat(0, 0, 3, { isHero: true })
    const frame = createTableSocialFrame()
    updateTableSocialFrame(frame, [a, b, old, hero], camera, 20.5)
    // The all-in is the newest: everyone else sees it, the all-in seat sees the earlier raise.
    expect(fillSeatSocial(b, frame, 20.5).actorCue).toBe('all_in')
    expect(fillSeatSocial(a, frame, 20.5).actorCue).toBe('raise')
    expect(fillSeatSocial(old, frame, 20.5).actorCue).toBe('all_in')
    expect(fillSeatSocial(hero, frame, 20.5).actorCue).toBe('ready')
    // Past the window nobody reacts.
    updateTableSocialFrame(frame, [a, b, old, hero], camera, 24)
    expect(fillSeatSocial(b, frame, 24).actorCue).toBe('ready')
  })

  it('tracks the winner from the first frame it is seen and the hero on the clock', () => {
    const winner = makeSeat(3, -2, -2, { winner: true })
    const other = makeSeat(5, 2, -2)
    const hero = makeSeat(0, 0, 3, { isHero: true, acting: true })
    const frame = createTableSocialFrame()
    updateTableSocialFrame(frame, [winner, other, hero], camera, 50)
    updateTableSocialFrame(frame, [winner, other, hero], camera, 51.5)
    const social = fillSeatSocial(other, frame, 51.5)
    expect(social.winnerAge).toBeCloseTo(1.5, 5)
    expect(social.winnerIsHero).toBe(false)
    expect(social.winnerSteps).toBe(2)
    expect(social.heroActing).toBe(true)
    expect(fillSeatSocial(winner, frame, 51.5).winnerAge).toBe(Number.POSITIVE_INFINITY)
    updateTableSocialFrame(frame, [other, hero], camera, 52)
    expect(fillSeatSocial(other, frame, 52).winnerAge).toBe(Number.POSITIVE_INFINITY)
  })

  it('turns table facts into stack-at-risk, bet-faced and odds', () => {
    const social = createAvatarSocialInput()
    const player = { bet: 40, stack: 360, committed: 140, status: 'active' as const, hasCards: true, isOutOfHand: false, odds: undefined }
    setSeatSocialStats(social, player, { currentBet: 200, bigBlind: 20 })
    expect(social.allIn).toBe(false)
    expect(social.atRisk).toBeCloseTo((1.3 * 140) / 500, 5)
    // Facing 160 more over a 20 blind: a big bet.
    expect(social.facingBet).toBeGreaterThan(0.85)
    expect(social.oddsWin).toBe(-1)
    setSeatSocialStats(social, { ...player, status: 'all_in', stack: 0, odds: { playerId: 'x', winPercent: 63, tiePercent: 0, isLeader: true, isDrawingDead: false, isLocked: false } }, { currentBet: 0, bigBlind: 20 })
    expect(social.allIn).toBe(true)
    expect(social.atRisk).toBe(1)
    expect(social.facingBet).toBe(0)
    expect(social.oddsWin).toBe(63)
    setSeatSocialStats(social, { ...player, isOutOfHand: true }, { currentBet: 0, bigBlind: 20 })
    expect(social.atRisk).toBe(0)
    expect(social.allIn).toBe(false)
  })
})
