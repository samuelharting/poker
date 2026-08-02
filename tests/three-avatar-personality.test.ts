import { describe, expect, it } from 'vitest'
import { getAvatarPersonalityPose } from '@/components/three/avatarPersonality'

const baseInput = {
  idleTell: 'calm' as const,
  celebration: 'wave' as const,
  winner: false,
  actionActive: false,
  acting: false,
  folded: false,
  time: 4.8,
  phase: 0,
  reducedMotion: false,
}

describe('3D avatar idle tells and celebrations', () => {
  it('keeps calm avatars still and gives each selected tell a distinct readable pose', () => {
    const calm = getAvatarPersonalityPose(baseInput)
    const shuffle = getAvatarPersonalityPose({ ...baseInput, idleTell: 'chip_shuffle' })
    const peek = getAvatarPersonalityPose({ ...baseInput, idleTell: 'card_peek' })
    const drum = getAvatarPersonalityPose({ ...baseInput, idleTell: 'table_drum' })

    expect(calm.rightUpperArm).toEqual([0, 0, 0])
    expect(shuffle.rightWrist).not.toEqual(calm.rightWrist)
    expect(peek.headRotation[0]).toBeGreaterThan(0.1)
    expect(drum.rightLowerArm[0]).toBeLessThan(-0.1)
  })

  it('suppresses idle tells while a player acts, thinks, folds, or requests reduced motion', () => {
    for (const update of [
      { actionActive: true },
      { acting: true },
      { folded: true },
      { reducedMotion: true },
    ]) {
      const pose = getAvatarPersonalityPose({
        ...baseInput,
        idleTell: 'chip_shuffle',
        ...update,
      })
      expect(pose.rightUpperArm).toEqual([0, 0, 0])
    }
  })

  it('gives victory, fist-pump, slow-clap, and wave winners different silhouettes', () => {
    const wave = getAvatarPersonalityPose({ ...baseInput, winner: true, celebration: 'wave' })
    const fist = getAvatarPersonalityPose({ ...baseInput, winner: true, celebration: 'fist_pump' })
    const victory = getAvatarPersonalityPose({ ...baseInput, winner: true, celebration: 'victory' })
    const clap = getAvatarPersonalityPose({ ...baseInput, winner: true, celebration: 'slow_clap' })

    expect(fist.fingerCurl).toBeGreaterThan(0.9)
    expect(victory.leftUpperArm[0]).toBeLessThan(-0.9)
    expect(clap.leftLowerArm).not.toEqual(wave.leftLowerArm)
    expect(new Set([wave.rightUpperArm[0], fist.rightUpperArm[0], victory.rightUpperArm[0], clap.rightUpperArm[0]]).size).toBe(4)
  })
})
