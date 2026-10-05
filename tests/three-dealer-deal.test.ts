import { describe, expect, it } from 'vitest'
import {
  DEAL_DEFAULT_STEP_SECONDS,
  DEAL_HOLE_LEAD_SECONDS,
  DEAL_POSE_LEAD_FIRST_PERSON_SECONDS,
  DEAL_POSE_LEAD_SECONDS,
  buildBoardDealSchedule,
  buildHoleDealSchedule,
  canDealerDeal,
  createDealerPose,
  findDealCard,
  getBoardCardOffsets,
  getDealCardRelease,
  getDealFlightSeconds,
  getDealerPose,
  getHoleCardDelay,
  getHoleDealTiming,
  planBoardDeal,
  type DealerAnchors,
  type DealerSchedule,
} from '@/components/three/dealerDeal'
import { computeAvatarTargetPose, createAvatarAnimatorState, type AvatarAnimatorInput } from '@/components/three/avatarAnimator'
import type { Vec3 } from '@/components/three/pokerActionPose'

const anchors = {
  railR: [0.24, 0.71, -0.44] as Vec3,
  railL: [-0.24, 0.71, -0.44] as Vec3,
  cards: [0, 0.41, -1.39] as Vec3,
  chest: [0, 1.2, -0.3] as Vec3,
  chin: [0, 1.65, -0.45] as Vec3,
  shoulderR: [0.4, 1.27, -0.2] as Vec3,
  shoulderL: [-0.32, 1.34, -0.16] as Vec3,
  stack: [0.7, 0.44, -1.08] as Vec3,
  betSpot: [0, 0.43, -2.9] as Vec3,
  tap: [0.16, 0.4, -1.04] as Vec3,
  board: [0, 0.48, -5.4] as Vec3,
  drinkRest: [-0.66, 0.4, -1.0] as Vec3,
}

/** Six seats' hole cards spread across the table (the dealer's own last), in dealer space. */
const targets: Vec3[] = [
  [-3.2, 0.4, -4.6], [-2, 0.4, -6], [1.2, 0.4, -6.1], [3.4, 0.4, -4.8], [4.2, 0.4, -2.2], [0, 0.4, -1.4],
]

function holeSchedule(count = targets.length, startedAt = 5): DealerSchedule {
  const timing = getHoleDealTiming(count, true)
  return buildHoleDealSchedule(startedAt, targets.slice(0, count), timing)
}

function finite(values: readonly number[]) {
  return values.every(value => Number.isFinite(value))
}

describe('dealer hole-card schedule', () => {
  it('releases card k at the same time the room launches it (clockwise, one card a round)', () => {
    for (const count of [2, 3, 6, 8]) {
      const timing = getHoleDealTiming(count, true)
      const schedule = buildHoleDealSchedule(0, Array.from({ length: count }, (_, i): Vec3 => [i, 0.4, -3]), timing)
      expect(schedule.cards).toHaveLength(count * 2)
      for (let round = 0; round < 2; round += 1) {
        for (let order = 0; order < count; order += 1) {
          const index = findDealCard(schedule, 'hole', order, round, count)
          expect(index).toBe(round * count + order)
          expect(schedule.cards[index]!.releaseAt).toBeCloseTo(getHoleCardDelay(order, round, count, timing), 10)
        }
      }
      // Strictly increasing, one step apart: a card per beat, no two at once.
      for (let i = 1; i < schedule.cards.length; i += 1) {
        expect(schedule.cards[i]!.releaseAt - schedule.cards[i - 1]!.releaseAt).toBeCloseTo(timing.step, 10)
      }
    }
  })

  it('pitches slower than the deck fan but never longer than a few seconds, heads-up to eight-handed', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8]) {
      const timing = getHoleDealTiming(count, true)
      expect(timing.lead).toBe(DEAL_HOLE_LEAD_SECONDS)
      expect(timing.step).toBeGreaterThanOrEqual(0.15)
      expect(timing.step).toBeLessThanOrEqual(0.26)
      expect(timing.lead + count * 2 * timing.step).toBeLessThan(3.4)
    }
  })

  it('keeps today\'s quick stagger when nobody deals by hand', () => {
    expect(getHoleDealTiming(6, false)).toEqual({ lead: 0, step: DEAL_DEFAULT_STEP_SECONDS })
    expect(getHoleCardDelay(2, 1, 6, getHoleDealTiming(6, false))).toBeCloseTo((2 + 6) * DEAL_DEFAULT_STEP_SECONDS, 10)
  })

  it('flies longer across the table, never shorter than the base or past 0.72s', () => {
    expect(getDealFlightSeconds(0, 0.36)).toBe(0.36)
    expect(getDealFlightSeconds(1, 0.36)).toBeGreaterThanOrEqual(0.36)
    expect(getDealFlightSeconds(5, 0.36)).toBeGreaterThan(getDealFlightSeconds(2, 0.36))
    expect(getDealFlightSeconds(50, 0.36)).toBeLessThanOrEqual(0.72)
  })
})

describe('dealer pose timeline', () => {
  it('is idle before the start and after the end, so the hands are free to rest', () => {
    const schedule = holeSchedule()
    const pose = createDealerPose()
    expect(getDealerPose(-0.5, schedule, anchors, pose).weight).toBe(0)
    expect(getDealerPose(schedule.duration + 0.01, schedule, anchors, pose).weight).toBe(0)
    expect(getDealerPose(5, null, anchors, pose).weight).toBe(0)
  })

  it('eases in over the reach and back out after the last card (hands return to rest)', () => {
    const schedule = holeSchedule()
    const pose = createDealerPose()
    const last = schedule.cards[schedule.cards.length - 1]!.releaseAt
    expect(getDealerPose(0, schedule, anchors, pose, 0).weight).toBeLessThan(0.05)
    expect(getDealerPose(0, schedule, anchors, pose).weight).toBeLessThan(0.2)
    expect(getDealerPose(schedule.cards[0]!.releaseAt, schedule, anchors, pose).weight).toBe(1)
    expect(getDealerPose(last, schedule, anchors, pose).weight).toBe(1)
    let previous = 1
    for (let t = last; t <= schedule.duration; t += 0.02) {
      const weight = getDealerPose(t, schedule, anchors, pose).weight
      expect(weight).toBeLessThanOrEqual(previous + 1e-9)
      previous = weight
    }
    expect(getDealerPose(schedule.duration, schedule, anchors, pose).weight).toBe(0)
  })

  it('snaps as each card leaves the hand and is calm between strokes', () => {
    const schedule = holeSchedule()
    const pose = createDealerPose()
    schedule.cards.forEach(card => {
      // No lead compensation: the pose is the timeline itself.
      getDealerPose(card.releaseAt, schedule, anchors, pose, 0)
      expect(pose.snap).toBeGreaterThan(0.95)
      // Cocked behind the thumb just before it, snap not yet in.
      getDealerPose(card.releaseAt - 0.04, schedule, anchors, pose, 0)
      expect(pose.cock).toBeGreaterThan(0.6)
    })
    // The first stroke has no flick before it: calm until the snap is on its way.
    getDealerPose(schedule.cards[0]!.releaseAt - 0.12, schedule, anchors, pose, 0)
    expect(pose.snap).toBe(0)
  })

  it('leads the first-person hands less than the avatars (their quicker spring lands the flick on the release)', () => {
    expect(DEAL_POSE_LEAD_FIRST_PERSON_SECONDS).toBeGreaterThan(0)
    expect(DEAL_POSE_LEAD_FIRST_PERSON_SECONDS).toBeLessThan(DEAL_POSE_LEAD_SECONDS)
    const schedule = holeSchedule()
    const early = createDealerPose()
    const late = createDealerPose()
    const release = schedule.cards[2]!.releaseAt
    // Evaluated this far ahead of the card, the snap is already fully on with the avatar lead and not yet with the smaller one.
    getDealerPose(release - DEAL_POSE_LEAD_SECONDS, schedule, anchors, early)
    getDealerPose(release - DEAL_POSE_LEAD_SECONDS, schedule, anchors, late, DEAL_POSE_LEAD_FIRST_PERSON_SECONDS)
    expect(early.snap).toBeGreaterThan(0.95)
    expect(late.snap).toBeLessThan(early.snap)
  })

  it('has the right hand at the release point on the release frame', () => {
    const schedule = holeSchedule()
    const pose = createDealerPose()
    const release: Vec3 = [0, 0, 0]
    schedule.cards.forEach((card, index) => {
      getDealerPose(card.releaseAt, schedule, anchors, pose, 0)
      getDealCardRelease(schedule, index, anchors, release)
      // The release point is the fingertips: a hand's length past the wrist, on the way to the recipient.
      const reach = Math.hypot(release[0] - pose.handR[0], release[2] - pose.handR[2])
      expect(reach).toBeGreaterThan(0.05)
      expect(reach).toBeLessThan(0.16)
      // Toward the recipient, not away from them.
      const toward = (card.target[0] - pose.handR[0]) * (release[0] - pose.handR[0]) + (card.target[2] - pose.handR[2]) * (release[2] - pose.handR[2])
      expect(toward).toBeGreaterThan(0)
    })
  })

  it('turns the head toward each recipient by the time the card goes', () => {
    const schedule = holeSchedule()
    const pose = createDealerPose()
    // Targets sweep from the dealer's far left to far right: the yaw follows the sign of x.
    const yaws = schedule.cards.slice(0, targets.length).map(card => {
      getDealerPose(card.releaseAt, schedule, anchors, pose, 0)
      return pose.headYaw
    })
    for (let i = 0; i < targets.length; i += 1) {
      const dx = targets[i]![0] - anchors.chin[0]
      const dz = targets[i]![2] - anchors.chin[2]
      expect(yaws[i]).toBeCloseTo(Math.max(-1.15, Math.min(1.15, Math.atan2(-dx, -dz))), 5)
    }
    // Round one is a left to right sweep: yaw falls (positive turns toward the dealer's left).
    expect(yaws[0]!).toBeGreaterThan(yaws[3]!)
  })

  it('never produces NaN or runaway values across the whole deal, any seat count', () => {
    for (const count of [2, 3, 6, 8]) {
      const schedule = holeSchedule(Math.min(count, targets.length))
      const pose = createDealerPose()
      for (let t = -0.2; t <= schedule.duration + 0.3; t += 1 / 60) {
        getDealerPose(t, schedule, anchors, pose)
        expect(finite([pose.weight, pose.headYaw, pose.headPitch, pose.snap, pose.cock, pose.pinch, pose.curlR, pose.curlL, ...pose.handR, ...pose.handL, ...pose.wristR])).toBe(true)
        expect(pose.weight).toBeGreaterThanOrEqual(0)
        expect(pose.weight).toBeLessThanOrEqual(1)
        for (const value of [pose.snap, pose.cock, pose.pinch]) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
        if (pose.weight > 0) {
          // Hands stay on the dealer's side of the table and above the felt.
          expect(pose.handR[1]).toBeGreaterThan(0.3)
          expect(pose.handR[1]).toBeLessThan(1.2)
          expect(Math.abs(pose.handR[0])).toBeLessThan(0.8)
          expect(pose.handR[2]).toBeGreaterThan(-1.8)
          expect(pose.handL[2]).toBeGreaterThan(-1.8)
        }
      }
    }
  })

  it('survives a degenerate target on top of the deck without dividing by zero', () => {
    const schedule = buildHoleDealSchedule(0, [[0.05, 0.4, -0.94]], getHoleDealTiming(1, true))
    const pose = createDealerPose()
    for (let t = 0; t <= schedule.duration; t += 0.016) {
      getDealerPose(t, schedule, anchors, pose)
      expect(finite([...pose.handR, pose.headYaw, pose.headPitch])).toBe(true)
    }
  })
})

describe('board deal', () => {
  it('burns a card before the flop, the turn and the river', () => {
    expect(planBoardDeal([0, 1, 2]).map(entry => entry.kind)).toEqual(['burn', 'flop', 'flop', 'flop'])
    expect(planBoardDeal([3]).map(entry => entry.kind)).toEqual(['burn', 'turn'])
    expect(planBoardDeal([4]).map(entry => entry.kind)).toEqual(['burn', 'river'])
    // An all-in runout deals every street in one go.
    expect(planBoardDeal([0, 1, 2, 3, 4]).map(entry => entry.kind)).toEqual(['burn', 'flop', 'flop', 'flop', 'burn', 'turn', 'burn', 'river'])
  })

  it('gives the room one launch offset per board card, increasing, after the burn', () => {
    const plan = planBoardDeal([0, 1, 2])
    const offsets = getBoardCardOffsets(plan)
    expect(offsets).toHaveLength(3)
    expect(offsets[0]!).toBeGreaterThan(plan[0]!.offset)
    expect(offsets[1]!).toBeGreaterThan(offsets[0]!)
    expect(offsets[2]!).toBeGreaterThan(offsets[1]!)
    expect(getBoardCardOffsets(planBoardDeal([4]))).toHaveLength(1)
  })

  it('lays the flop out in a spread and looks at the board', () => {
    const plan = planBoardDeal([0, 1, 2])
    const slotTargets: Vec3[] = [-2, -1, 0, 1, 2].map((i): Vec3 => [i * 0.9, 0.45, -5.4])
    const schedule = buildBoardDealSchedule(10, plan, slotTargets)
    const pose = createDealerPose()
    const xs = [0, 1, 2].map(slot => {
      const index = findDealCard(schedule, 'board', slot, 0, 0)
      expect(index).toBeGreaterThanOrEqual(0)
      getDealerPose(schedule.cards[index]!.releaseAt, schedule, anchors, pose, 0)
      expect(pose.snap).toBeGreaterThan(0.6)
      return pose.handR[0]
    })
    // The hand sweeps from the left card to the right one (+x is the dealer's right).
    expect(xs[0]!).toBeLessThan(xs[1]!)
    expect(xs[1]!).toBeLessThan(xs[2]!)
    expect(findDealCard(schedule, 'board', 4, 0, 0)).toBe(-1)
    // The burn card carries no board slot.
    expect(schedule.cards[0]!.kind).toBe('burn')
    expect(schedule.cards[0]!.slot).toBe(-1)
  })

  it('reaches further for a board card than for a hole card', () => {
    const hole = holeSchedule()
    const board = buildBoardDealSchedule(0, planBoardDeal([3]), [0, 1, 2, 3, 4].map((): Vec3 => [0, 0.45, -5.4]))
    const holePose = createDealerPose()
    const boardPose = createDealerPose()
    getDealerPose(hole.cards[0]!.releaseAt, hole, anchors, holePose, 0)
    getDealerPose(board.cards[1]!.releaseAt, board, anchors, boardPose, 0)
    // Deck is the same spot for both; the board card carries further forward.
    expect(boardPose.handR[2]).toBeLessThan(holePose.handR[2] + 0.05)
    const burnRelease: Vec3 = [0, 0, 0]
    getDealCardRelease(board, 0, anchors, burnRelease)
    expect(finite(burnRelease)).toBe(true)
  })
})

describe('who deals by hand', () => {
  const base = { reducedMotion: false, isHero: false, hasRig: true, away: false, passedOut: false, folded: false }

  it('falls back to the deck point for reduced motion, away, passed out, folded or an unloaded rig', () => {
    expect(canDealerDeal(base)).toBe(true)
    expect(canDealerDeal({ ...base, reducedMotion: true })).toBe(false)
    expect(canDealerDeal({ ...base, away: true })).toBe(false)
    expect(canDealerDeal({ ...base, passedOut: true })).toBe(false)
    expect(canDealerDeal({ ...base, folded: true })).toBe(false)
    expect(canDealerDeal({ ...base, hasRig: false })).toBe(false)
  })

  it('lets the hero deal through first-person hands (no rig needed) unless reduced motion', () => {
    expect(canDealerDeal({ ...base, isHero: true, hasRig: false })).toBe(true)
    expect(canDealerDeal({ ...base, isHero: true, hasRig: false, reducedMotion: true })).toBe(false)
  })
})

describe('animator hook', () => {
  function animatorInput(overrides: Partial<AvatarAnimatorInput> = {}): AvatarAnimatorInput {
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
      playerId: 'dealer',
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

  it('moves the right hand to the deck while dealing and leaves it on the rail otherwise', () => {
    const schedule = holeSchedule()
    const dealing = createDealerPose()
    getDealerPose(schedule.cards[2]!.releaseAt, schedule, anchors, dealing, 0)
    const idle = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput())
    const idleHand = [...idle.handR]
    const dealt = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ dealing }))
    expect(dealt.handR[2]).toBeLessThan(idleHand[2]! - 0.2)
    expect(dealt.handR[0]).toBeCloseTo(dealing.handR[0], 5)
    expect(finite([...dealt.handR, ...dealt.handL, ...dealt.bones.Head, ...dealt.bones.WristR])).toBe(true)
    // With the gesture over (weight 0) the pose is the plain idle again.
    const done = createDealerPose()
    getDealerPose(schedule.duration + 1, schedule, anchors, done)
    const after = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ dealing: done }))
    expect(after.handR[0]).toBeCloseTo(idleHand[0]!, 5)
    expect(after.handR[2]).toBeCloseTo(idleHand[2]!, 5)
  })

  it('adds no extra motion under reduced motion (the room never builds a pose; the wrist and head stay put)', () => {
    const schedule = holeSchedule()
    const dealing = createDealerPose()
    getDealerPose(schedule.cards[2]!.releaseAt, schedule, anchors, dealing, 0)
    const quiet = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ reducedMotion: true }))
    const still = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ reducedMotion: true, dealing }))
    expect(still.bones.WristR[0]).toBeCloseTo(quiet.bones.WristR[0], 8)
    expect(still.handShapeR.speed).toBe(1)
  })

  it('yields to the dealer folding or passing out', () => {
    const schedule = holeSchedule()
    const dealing = createDealerPose()
    getDealerPose(schedule.cards[2]!.releaseAt, schedule, anchors, dealing, 0)
    const base = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ folded: true }))
    const folded = computeAvatarTargetPose(createAvatarAnimatorState('dealer'), animatorInput({ folded: true, dealing }))
    expect(folded.handR[2]).toBeCloseTo(base.handR[2], 8)
  })
})
