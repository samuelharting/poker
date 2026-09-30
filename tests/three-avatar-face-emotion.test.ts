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

  it('keeps every reaction smooth: no channel jumps more than 0.13 in one 60 fps frame', () => {
    for (const seed of [0.11, 0.37, 0.62, 0.9]) {
      for (const style of ['calm', 'focused', 'smirk']) {
        const state = createEmotionState(seed)
        const ctx = createFaceContext()
        const person = getFacePersonality({ seed, faceStyle: style })
        const script: Array<[number, Partial<typeof ctx>]> = [
          [0, { inHand: true }],
          [60, { cue: 'all_in', cueStartedAt: state.time + 1, wager: 1 }],
          [240, { winner: true }],
          [480, { winner: false, anyWinner: false, cue: 'ready' }],
          [540, { loser: true, anyWinner: true }],
          [780, { loser: false, anyWinner: false, drinkLift: 1 }],
          [840, { drinkLift: 0, drinkAfter: 1 }],
          [900, { drinkAfter: 0, burning: true }],
          [960, { burning: false }],
        ]
        const prev = Float32Array.from(state.params)
        let step = 0
        let worst = 0
        for (let frame = 0; frame < 1080; frame += 1) {
          while (step < script.length && script[step]![0] === frame) Object.assign(ctx, script[step++]![1])
          ctx.cueElapsed = state.time - ctx.cueStartedAt
          updateEmotion(state, ctx, person, 1 / 60, false, null)
          if (frame > 0) {
            for (let c = 0; c < prev.length; c += 1) worst = Math.max(worst, Math.abs(state.params[c]! - prev[c]!))
          }
          prev.set(state.params)
        }
        expect(worst).toBeLessThan(0.13)
      }
    }
  })

  it('takes a bad beat with a wide-eyed sting, then a frown, whatever the personality', () => {
    for (const seed of [0.05, 0.21, 0.48, 0.73, 0.94]) {
      for (const style of ['calm', 'focused', 'smirk']) {
        const state = createEmotionState(seed)
        const ctx = { ...createFaceContext(), inHand: true }
        const person = getFacePersonality({ seed, faceStyle: style })
        for (let i = 0; i < 60; i += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
        const idleLid = state.params[CH.lidUA]!
        ctx.loser = true
        let widest = 0
        for (let i = 0; i < 24; i += 1) {
          updateEmotion(state, ctx, person, 1 / 60, false, null)
          widest = Math.max(widest, state.params[CH.lidUA]!)
        }
        for (let i = 0; i < 150; i += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
        expect(widest).toBeGreaterThan(idleLid)
        expect((state.params[CH.smileA]! + state.params[CH.smileB]!) / 2).toBeLessThan(-0.1)
      }
    }
  })

  it('celebrates wins in different ways across players', () => {
    const openings = new Set<string>()
    for (let k = 0; k < 12; k += 1) {
      const seed = 0.03 + k * 0.08
      const state = createEmotionState(seed)
      const ctx = { ...createFaceContext(), inHand: true }
      const person = getFacePersonality({ seed, faceStyle: ['calm', 'focused', 'smirk'][k % 3] })
      for (let i = 0; i < 30; i += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
      ctx.winner = true
      for (let i = 0; i < 36; i += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
      const p = state.params
      // Classify the first beat: wide-eyed, lopsided smirk, or soft exhale.
      openings.add(p[CH.lidUA]! > 1.02 ? 'wide' : Math.abs(p[CH.smileA]! - p[CH.smileB]!) > 0.25 ? 'smug' : 'soft')
    }
    expect(openings.size).toBeGreaterThanOrEqual(2)
  })

  it('rolls the eyes up and over, then back', () => {
    const seed = 0.4
    const state = createEmotionState(seed)
    const ctx = { ...createFaceContext(), inHand: true, flipOffReceived: true }
    const person = getFacePersonality({ seed, faceStyle: 'smirk' })
    let peak = 0
    for (let i = 0; i < 120; i += 1) {
      updateEmotion(state, ctx, person, 1 / 60, false, null)
      peak = Math.max(peak, state.rollPitch)
    }
    expect(peak).toBeGreaterThan(0.2)
    expect(state.rollPitch).toBe(0)
  })

  it('blinks in clusters and stares in between, at a natural average rate', () => {
    const state = createEmotionState(0.3)
    const ctx = createFaceContext()
    const person = getFacePersonality({ seed: 0.3 })
    const starts: number[] = []
    let was = 0
    for (let i = 0; i < 60 * 120; i += 1) {
      updateEmotion(state, ctx, person, 1 / 60, false, null)
      const blink = updateBlink(state, person, false)
      if (blink > 0.05 && was <= 0.05) starts.push(state.time)
      was = blink
    }
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(mean).toBeGreaterThan(person.blinkPeriod * 0.6)
    expect(mean).toBeLessThan(person.blinkPeriod * 1.6)
    expect(gaps.some(gap => gap < 1.3)).toBe(true)
    expect(gaps.some(gap => gap > person.blinkPeriod)).toBe(true)
  })

  it('maps table emotes to faces for the sender and the target', () => {
    expect(emoteToEmotion('😂', 'sender')).toBe('laugh')
    expect(emoteToEmotion('😂', 'target')).toBe('happy')
    expect(emoteToEmotion('😡', 'sender')).toBe('angry')
    expect(emoteToEmotion('🤷', 'sender')).toBe('happy')
    expect(emoteToEmotion('🤷', 'target')).toBe('surprised')
  })
})
