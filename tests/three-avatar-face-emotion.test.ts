import { describe, expect, it } from 'vitest'
import {
  CH,
  createEmotionState,
  createFaceContext,
  emoteToEmotion,
  updateBlink,
  updateEmotion,
} from '@/components/three/avatarFaceEmotion'
import { getFacePersonality } from '@/components/three/avatarPersonality'

function settle(seed: number, patch: Partial<ReturnType<typeof createFaceContext>>) {
  const state = createEmotionState(seed)
  const ctx = { ...createFaceContext(), ...patch }
  const person = getFacePersonality({ seed, faceStyle: 'calm', browWeight: 'medium' })
  for (let i = 0; i < 90; i += 1) updateEmotion(state, ctx, person, 1 / 30, false, null)
  return { state, person }
}

describe('3D avatar face emotion model', () => {
  it('derives a stable personality from the seed and profile', () => {
    const a = getFacePersonality({ seed: 0.31, faceStyle: 'smirk', browWeight: 'low' })
    const b = getFacePersonality({ seed: 0.31, faceStyle: 'smirk', browWeight: 'low' })
    const c = getFacePersonality({ seed: 0.77, faceStyle: 'calm', browWeight: 'high' })
    expect(a).toEqual(b)
    expect(a.idle).toBe('smirk')
    expect(c.idle).toBe('neutral')
    expect(a.baseBrow).toBeLessThan(c.baseBrow)
  })

  it('closes the lids when passed out and grins with teeth on a win', () => {
    const asleep = settle(0.4, { passedOut: true }).state.params
    const winner = settle(0.4, { winner: true, inHand: true }).state.params
    const idle = settle(0.4, {}).state.params
    expect(asleep[CH.lidUA]!).toBeLessThan(idle[CH.lidUA]! - 0.4)
    expect(winner[CH.smileA]!).toBeGreaterThan(0.6)
    expect(winner[CH.teeth]!).toBeGreaterThan(0.5)
    expect(winner[CH.open]!).toBeGreaterThan(idle[CH.open]!)
  })

  it('tenses up for an all-in and droops for a hangover', () => {
    const allIn = settle(0.2, { cue: 'all_in', cueElapsed: 0.5, inHand: true, wager: 1 }).state.params
    const hungover = settle(0.2, { hungover: true }).state.params
    const idle = settle(0.2, {}).state.params
    expect(allIn[CH.sweat]!).toBeGreaterThan(idle[CH.sweat]! + 0.2)
    expect(allIn[CH.pupil]!).toBeGreaterThan(idle[CH.pupil]!)
    expect(hungover[CH.pallor]!).toBeGreaterThan(0.5)
    expect(hungover[CH.lidUA]!).toBeLessThan(idle[CH.lidUA]!)
  })

  it('moves smoothly: no channel jumps more than a fraction of its range in one frame', () => {
    const state = createEmotionState(0.6)
    const ctx = createFaceContext()
    const person = getFacePersonality({ seed: 0.6 })
    for (let i = 0; i < 30; i += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
    const before = Float32Array.from(state.params)
    ctx.winner = true
    updateEmotion(state, ctx, person, 1 / 60, false, null)
    for (let c = 0; c < before.length; c += 1) expect(Math.abs(state.params[c]! - before[c]!)).toBeLessThan(0.2)
  })

  it('blinks naturally: closes fully, reopens, and does not stay shut', () => {
    const state = createEmotionState(0.5)
    const ctx = createFaceContext()
    const person = getFacePersonality({ seed: 0.5 })
    let max = 0
    let closedFrames = 0
    const frames = 60 * 12
    for (let i = 0; i < frames; i += 1) {
      updateEmotion(state, ctx, person, 1 / 60, false, null)
      const blink = updateBlink(state, person, false)
      max = Math.max(max, blink)
      if (blink > 0.98) closedFrames += 1
    }
    expect(max).toBeGreaterThan(0.99)
    expect(closedFrames).toBeLessThan(frames / 5)
  })

  it('maps table emotes to faces for the sender and the target', () => {
    expect(emoteToEmotion('😂', 'sender')).toBe('laugh')
    expect(emoteToEmotion('😂', 'target')).toBe('happy')
    expect(emoteToEmotion('😡', 'sender')).toBe('angry')
    expect(emoteToEmotion('🤷', 'sender')).toBe('happy')
    expect(emoteToEmotion('🤷', 'target')).toBe('surprised')
  })
})
