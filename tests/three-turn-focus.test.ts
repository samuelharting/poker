import { describe, expect, it } from 'vitest'
import { getAvatarHeadTurn, getTurnCameraPose } from '@/components/three/turnFocus'

describe('3D turn focus helpers', () => {
  it('keeps the default camera when nobody is acting', () => {
    expect(getTurnCameraPose(null)).toEqual({
      position: [0, 2.45, 5.62],
      lookAt: [0, 1.06, 0.18],
    })
  })

  it('nudges the camera and gaze subtly toward the active opponent seat', () => {
    const defaultPose = getTurnCameraPose(null)
    const leftSeat = getTurnCameraPose(2)
    const rightSeat = getTurnCameraPose(6)
    const heroSeat = getTurnCameraPose(0)

    expect(leftSeat.position[0]).toBeLessThan(defaultPose.position[0] - 0.04)
    expect(rightSeat.position[0]).toBeGreaterThan(defaultPose.position[0] + 0.04)
    expect(Math.abs(leftSeat.position[0])).toBeLessThan(0.12)
    expect(Math.abs(rightSeat.position[0])).toBeLessThan(0.12)
    expect(leftSeat.position[2]).toBeLessThan(defaultPose.position[2])
    expect(rightSeat.position[2]).toBeLessThan(defaultPose.position[2])
    expect(defaultPose.position[2] - leftSeat.position[2]).toBeLessThan(0.12)
    expect(defaultPose.position[2] - rightSeat.position[2]).toBeLessThan(0.12)
    expect(heroSeat.position).toEqual([0, 2.45, 5.62])
    expect(leftSeat.lookAt[0]).toBeLessThan(-0.3)
    expect(rightSeat.lookAt[0]).toBeGreaterThan(0.3)
    expect(Math.abs(leftSeat.lookAt[0])).toBeLessThan(0.45)
    expect(Math.abs(rightSeat.lookAt[0])).toBeLessThan(0.45)
    expect(leftSeat.lookAt[1]).toBeGreaterThan(defaultPose.lookAt[1])
    expect(rightSeat.lookAt[1]).toBeGreaterThan(defaultPose.lookAt[1])
  })

  it('turns seated avatars toward the player whose turn it is', () => {
    expect(getAvatarHeadTurn(1, 6).yaw).toBeLessThan(-0.42)
    expect(getAvatarHeadTurn(6, 1).yaw).toBeGreaterThan(0.42)
    expect(getAvatarHeadTurn(3, 3)).toEqual({ yaw: 0, pitch: -0.035 })
  })
})
