import { describe, expect, it } from 'vitest'
import {
  ACTION_ANIMATION_DURATION_MS,
  derivePokerActionVariant,
  deriveWagerIntensity,
  getHeroCardActionPose,
  getHeroChipActionPose,
  getHeroHandActionPose,
  getOpponentTableActionPose,
  getPokerActionMotionProfile,
  getSeatedAvatarActionPose,
} from '@/components/three/pokerActionPose'

describe('desktop 3D poker action pose animation', () => {
  it('reaches the hero hand across the cards for a fold', () => {
    const anticipation = getHeroHandActionPose('fold', 'right', 90)
    const reaching = getHeroHandActionPose('fold', 'right', 410)

    expect(anticipation.position[0]).toBeGreaterThan(0.04)
    expect(anticipation.position[2]).toBeGreaterThan(0.02)
    expect(reaching.position[0]).toBeLessThan(-1.35)
    expect(reaching.position[2]).toBeLessThan(-0.7)
    expect(reaching.fingerCurl).toBeGreaterThan(0.65)
  })

  it('forms a fist while tapping the table for a check and returns to rest', () => {
    const windup = getHeroHandActionPose('check', 'right', 85)
    const tap = getHeroHandActionPose('check', 'right', 245)
    const lateSettle = getHeroHandActionPose('check', 'right', 820)
    const rest = getHeroHandActionPose('check', 'right', ACTION_ANIMATION_DURATION_MS)

    expect(windup.position[1]).toBeGreaterThan(0.015)
    expect(tap.position[1]).toBeLessThan(-0.055)
    expect(tap.rotation[0]).toBeGreaterThan(0.08)
    expect(tap.fingerCurl).toBeGreaterThan(0.75)
    expect(lateSettle.fingerCurl).toBeLessThan(0.25)
    expect(Math.abs(lateSettle.position[1])).toBeLessThan(0.03)
    expect(rest.position).toEqual([0, 0, 0])
    expect(rest.rotation).toEqual([0, 0, 0])
  })

  it('moves the hero hand from the chip stack toward the pot for wager actions', () => {
    const windup = getHeroHandActionPose('raise', 'right', 90)
    const carrying = getHeroHandActionPose('raise', 'right', 520)
    const restingLeft = getHeroHandActionPose('raise', 'left', 430)

    expect(windup.position[0]).toBeGreaterThan(0.08)
    expect(windup.position[2]).toBeGreaterThan(0.02)
    expect(carrying.position[0]).toBeLessThan(-1.05)
    expect(carrying.position[2]).toBeLessThan(-1.1)
    expect(carrying.fingerCurl).toBeGreaterThan(0.55)
    expect(restingLeft.position).toEqual([0, 0, 0])
    expect(restingLeft.fingerCurl).toBe(0)
  })

  it('makes all-in shoves read bigger than a standard call', () => {
    const callHand = getHeroHandActionPose('call', 'right', 620)
    const allInHand = getHeroHandActionPose('all_in', 'right', 620)
    const callAvatar = getSeatedAvatarActionPose('call', 620)
    const allInAvatar = getSeatedAvatarActionPose('all_in', 620)

    expect(allInHand.position[0]).toBeLessThan(callHand.position[0] - 0.25)
    expect(allInHand.position[1]).toBeGreaterThan(callHand.position[1] + 0.015)
    expect(allInAvatar.bodyRotation[0]).toBeGreaterThan(callAvatar.bodyRotation[0] + 0.025)
    expect(allInAvatar.armPosition[2]).toBeLessThan(callAvatar.armPosition[2] - 0.035)
  })

  it('moves committed wager chips toward the pot for wager actions', () => {
    const lift = getHeroChipActionPose('raise', 160)
    const moving = getHeroChipActionPose('raise', 520)
    const settle = getHeroChipActionPose('raise', 880)
    const idle = getHeroChipActionPose('check', 390)

    expect(lift.visible).toBe(true)
    expect(lift.position[1]).toBeGreaterThan(0.08)
    expect(moving.visible).toBe(true)
    expect(moving.position[0]).toBeLessThan(-1.15)
    expect(moving.position[2]).toBeLessThan(-1.0)
    expect(settle.visible).toBe(true)
    expect(Math.abs(settle.position[1])).toBeLessThan(0.05)
    expect(idle.visible).toBe(false)
  })

  it('slides hero cards toward the muck for a fold', () => {
    const gather = getHeroCardActionPose('fold', 180)
    const moving = getHeroCardActionPose('fold', 520)
    const idle = getHeroCardActionPose('raise', 430)

    expect(gather.visible).toBe(true)
    expect(gather.position[1]).toBeGreaterThan(0.025)
    expect(moving.visible).toBe(true)
    expect(moving.position[0]).toBeLessThan(-0.7)
    expect(moving.position[2]).toBeLessThan(-0.62)
    expect(moving.rotation[2]).toBeLessThan(-0.22)
    expect(idle.visible).toBe(false)
  })

  it('leans seated avatars out and drops their arms for a fold', () => {
    const moving = getSeatedAvatarActionPose('fold', 520)
    const rest = getSeatedAvatarActionPose('fold', ACTION_ANIMATION_DURATION_MS)

    expect(moving.bodyPosition[1]).toBeLessThan(-0.035)
    expect(moving.bodyRotation[0]).toBeGreaterThan(0.14)
    expect(moving.armRotation[0]).toBeLessThan(-0.2)
    expect(moving.headRotation[0]).toBeGreaterThan(0.05)
    expect(rest.bodyPosition).toEqual([0, 0, 0])
    expect(rest.armRotation).toEqual([0, 0, 0])
  })

  it('turns seated avatar check actions into a visible table tap', () => {
    const windup = getSeatedAvatarActionPose('check', 120)
    const tap = getSeatedAvatarActionPose('check', 250)
    const idle = getSeatedAvatarActionPose('ready', 250)

    expect(windup.armPosition[1]).toBeGreaterThan(0.015)
    expect(tap.armPosition[1]).toBeLessThan(-0.04)
    expect(tap.armRotation[0]).toBeGreaterThan(0.18)
    expect(Math.abs(tap.bodyRotation[2])).toBeGreaterThan(0.02)
    expect(idle.armPosition).toEqual([0, 0, 0])
  })

  it('keeps seated avatar wager reaches readable with the slimmer body calibration', () => {
    const call = getSeatedAvatarActionPose('call', 620)
    const raise = getSeatedAvatarActionPose('raise', 620)
    const allIn = getSeatedAvatarActionPose('all_in', 620)

    expect(call.bodyPosition[2]).toBeLessThan(-0.04)
    expect(call.armPosition[2]).toBeLessThan(-0.1)
    expect(raise.armPosition[2]).toBeLessThan(call.armPosition[2] - 0.02)
    expect(allIn.armPosition[2]).toBeLessThan(raise.armPosition[2] - 0.04)
  })

  it('moves opponent table props through a fold without revealing card faces', () => {
    const reaching = getOpponentTableActionPose('fold', 320)
    const sliding = getOpponentTableActionPose('fold', 640)
    const finished = getOpponentTableActionPose('fold', ACTION_ANIMATION_DURATION_MS)

    expect(reaching.cards.visible).toBe(true)
    expect(reaching.hand.position[2]).toBeLessThan(-0.12)
    expect(reaching.hand.fingerCurl).toBeGreaterThan(0.45)
    expect(sliding.cards.position[0]).toBeLessThan(-0.1)
    expect(sliding.cards.position[2]).toBeLessThan(-0.55)
    expect(sliding.cards.opacity).toBeLessThan(0.8)
    expect(finished.cards.visible).toBe(false)
    expect(finished.cards.opacity).toBe(0)
  })

  it('turns opponent check actions into a small table tap', () => {
    const windup = getOpponentTableActionPose('check', 120)
    const tap = getOpponentTableActionPose('check', 260)
    const rest = getOpponentTableActionPose('check', ACTION_ANIMATION_DURATION_MS)

    expect(windup.hand.position[1]).toBeGreaterThan(0.015)
    expect(tap.hand.position[1]).toBeLessThan(-0.035)
    expect(tap.hand.rotation[0]).toBeGreaterThan(0.18)
    expect(tap.cards.visible).toBe(true)
    expect(rest.hand.position).toEqual([0, 0, 0])
    expect(rest.hand.rotation).toEqual([0, 0, 0])
  })

  it('pushes opponent wager props forward, with all-in larger than call', () => {
    const call = getOpponentTableActionPose('call', 620)
    const allIn = getOpponentTableActionPose('all_in', 620)

    expect(call.hand.position[2]).toBeLessThan(-0.16)
    expect(call.chipPush.visible).toBe(true)
    expect(call.chipPush.position[2]).toBeLessThan(-0.22)
    expect(allIn.hand.position[2]).toBeLessThan(call.hand.position[2] - 0.08)
    expect(allIn.chipPush.position[2]).toBeLessThan(call.chipPush.position[2] - 0.12)
    expect(allIn.chipPush.opacity).toBeGreaterThanOrEqual(call.chipPush.opacity)
  })

  it('derives stable three-way action variants from action and player identity', () => {
    const first = derivePokerActionVariant('hand-8:turn-14', 'player-a')
    const repeated = derivePokerActionVariant('hand-8:turn-14', 'player-a')
    const discoveredVariants = new Set(
      Array.from({ length: 30 }, (_, index) => (
        derivePokerActionVariant(`action-${index}`, `player-${index % 5}`)
      ))
    )

    expect(first).toBe(repeated)
    expect([...discoveredVariants].sort()).toEqual([0, 1, 2])
    expect(derivePokerActionVariant()).toBe(0)
  })

  it('maps the three variants to distinct fold, check, and wager personalities', () => {
    expect(getPokerActionMotionProfile('fold', { variant: 0 })).toMatchObject({
      foldStyle: 'slide',
      checkStyle: 'single',
      wagerStyle: 'slide',
    })
    expect(getPokerActionMotionProfile('check', { variant: 1 })).toMatchObject({
      foldStyle: 'snap',
      checkStyle: 'double',
      wagerStyle: 'flick',
    })
    expect(getPokerActionMotionProfile('raise', { variant: 2 })).toMatchObject({
      foldStyle: 'toss',
      checkStyle: 'knuckle',
      wagerStyle: 'shove',
    })
  })

  it('turns fold variants into a slide, snap, or airborne toss', () => {
    const slide = getHeroCardActionPose('fold', 360, { variant: 0 })
    const snap = getHeroCardActionPose('fold', 360, { variant: 1 })
    const toss = getHeroCardActionPose('fold', 360, { variant: 2 })
    const opponentSlide = getOpponentTableActionPose('fold', 430, { variant: 0 })
    const opponentToss = getOpponentTableActionPose('fold', 430, { variant: 2 })

    expect(snap.position[0]).toBeLessThan(slide.position[0] - 0.18)
    expect(snap.position[2]).toBeLessThan(slide.position[2] - 0.15)
    expect(toss.position[1]).toBeGreaterThan(slide.position[1] + 0.12)
    expect(toss.rotation[2]).toBeLessThan(slide.rotation[2] - 0.55)
    expect(opponentToss.cards.position[1]).toBeGreaterThan(opponentSlide.cards.position[1] + 0.1)
  })

  it('adds a readable second tap and a heavier knuckle check', () => {
    const singleLate = getHeroHandActionPose('check', 'right', 525, { variant: 0 })
    const doubleLate = getHeroHandActionPose('check', 'right', 525, { variant: 1 })
    const singleTap = getOpponentTableActionPose('check', 250, { variant: 0 })
    const knuckleTap = getOpponentTableActionPose('check', 250, { variant: 2 })
    const doubleAvatar = getSeatedAvatarActionPose('check', 525, { variant: 1 })

    expect(singleLate.position[1]).toBeGreaterThan(0)
    expect(doubleLate.position[1]).toBeLessThan(-0.045)
    expect(knuckleTap.hand.position[1]).toBeLessThan(singleTap.hand.position[1] - 0.012)
    expect(knuckleTap.hand.rotation[0]).toBeGreaterThan(singleTap.hand.rotation[0] + 0.035)
    expect(doubleAvatar.armPosition[1]).toBeLessThan(-0.035)
  })

  it('differentiates flick, slide, and shove wagers while scaling their commitment', () => {
    const slide = getHeroChipActionPose('bet', 520, { variant: 0, wagerIntensity: 0.5 })
    const flick = getHeroChipActionPose('bet', 520, { variant: 1, wagerIntensity: 0.5 })
    const shove = getHeroChipActionPose('bet', 520, { variant: 2, wagerIntensity: 0.5 })
    const tinyCall = getHeroHandActionPose('call', 'right', 560, { variant: 0, wagerIntensity: 0 })
    const hugeCall = getHeroHandActionPose('call', 'right', 560, { variant: 0, wagerIntensity: 1 })

    expect(flick.rotation[1]).toBeGreaterThan(slide.rotation[1] + 2)
    expect(shove.position[0]).toBeLessThan(slide.position[0] - 0.2)
    expect(shove.position[2]).toBeLessThan(slide.position[2] - 0.15)
    expect(hugeCall.position[0]).toBeLessThan(tinyCall.position[0] - 0.6)
    expect(hugeCall.position[2]).toBeLessThan(tinyCall.position[2] - 0.5)
  })

  it('normalizes raw wager sizes and applies intensity to every wager cue', () => {
    const blindSized = deriveWagerIntensity(20, 20, 200)
    const potSized = deriveWagerIntensity(200, 20, 200)

    expect(deriveWagerIntensity(0, 20, 200)).toBe(0)
    expect(potSized).toBeGreaterThan(blindSized)
    expect(deriveWagerIntensity(Number.POSITIVE_INFINITY, 20, 200)).toBe(0)
    expect(deriveWagerIntensity(1_000_000, 1, 0)).toBe(1)

    for (const cue of ['call', 'bet', 'raise', 'all_in'] as const) {
      const restrainedAvatar = getSeatedAvatarActionPose(cue, 620, {
        variant: 0,
        wagerIntensity: 0,
      })
      const dramaticAvatar = getSeatedAvatarActionPose(cue, 620, {
        variant: 0,
        wagerIntensity: 1,
      })
      const restrainedOpponent = getOpponentTableActionPose(cue, 620, {
        variant: 0,
        wagerIntensity: 0,
      })
      const dramaticOpponent = getOpponentTableActionPose(cue, 620, {
        variant: 0,
        wagerIntensity: 1,
      })

      expect(dramaticAvatar.armPosition[2]).toBeLessThan(restrainedAvatar.armPosition[2] - 0.04)
      expect(dramaticOpponent.chipPush.position[2]).toBeLessThan(
        restrainedOpponent.chipPush.position[2] - 0.15
      )
    }
  })

})
