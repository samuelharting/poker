import { describe, expect, it } from 'vitest'
import { getAvatarHeadTurn, getTurnCameraPose } from '@/components/three/turnFocus'

describe('3D turn focus helpers', () => {
  it('keeps the default camera when nobody is acting', () => {
    expect(getTurnCameraPose(null)).toEqual({
      position: [0, 3.58, 5.72],
      lookAt: [0, 1.12, 0.08],
    })
  })

  it('moves the camera and gaze toward the active opponent seat', () => {
    const defaultPose = getTurnCameraPose(null)
    const leftSeat = getTurnCameraPose(2)
    const rightSeat = getTurnCameraPose(6)
    const heroSeat = getTurnCameraPose(0)

    expect(leftSeat.position[0]).toBeLessThan(defaultPose.position[0] - 0.05)
    expect(rightSeat.position[0]).toBeGreaterThan(defaultPose.position[0] + 0.05)
    expect(leftSeat.position[2]).toBeLessThan(defaultPose.position[2])
    expect(rightSeat.position[2]).toBeLessThan(defaultPose.position[2])
    expect(heroSeat.position).toEqual([0, 3.58, 5.72])
    expect(leftSeat.lookAt[0]).toBeLessThan(-0.8)
    expect(rightSeat.lookAt[0]).toBeGreaterThan(0.8)
    expect(leftSeat.lookAt[1]).toBeGreaterThan(defaultPose.lookAt[1])
    expect(rightSeat.lookAt[1]).toBeGreaterThan(defaultPose.lookAt[1])
  })

  it('turns seated avatars toward the player whose turn it is', () => {
    expect(getAvatarHeadTurn(1, 6).yaw).toBeLessThan(-0.42)
    expect(getAvatarHeadTurn(6, 1).yaw).toBeGreaterThan(0.42)
    expect(getAvatarHeadTurn(3, 3)).toEqual({ yaw: 0, pitch: -0.035 })
  })
})
