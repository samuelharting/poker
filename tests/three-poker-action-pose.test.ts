import { describe, expect, it } from 'vitest'
import {
  ACTION_ANIMATION_DURATION_MS,
  getHeroCardActionPose,
  getHeroChipActionPose,
  getHeroHandActionPose,
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
})
