import { describe, expect, it } from 'vitest'
import {
  advanceActionPlaybackState,
  createActionPlaybackState,
  getActionPlaybackSnapshot,
} from '@/components/three/actionPlayback'
import { ACTION_ANIMATION_DURATION_MS } from '@/components/three/pokerActionPose'

describe('desktop 3D action playback state', () => {
  it('treats an action present on initial mount as already consumed', () => {
    const playback = createActionPlaybackState('hero:1:4', 'check')

    expect(getActionPlaybackSnapshot(playback, 250)).toEqual({
      cue: 'check',
      elapsedMs: ACTION_ANIMATION_DURATION_MS,
      isActive: false,
    })
  })

  it('starts exactly once when a new action key arrives', () => {
    const idle = createActionPlaybackState()
    const started = advanceActionPlaybackState(idle, 'hero:1:5', 'raise', 1200)
    const same = advanceActionPlaybackState(started, 'hero:1:5', 'raise', 1330)

    expect(started.startedAtMs).toBe(1200)
    expect(same).toBe(started)
    expect(getActionPlaybackSnapshot(same, 1330)).toMatchObject({
      cue: 'raise',
      elapsedMs: 130,
      isActive: true,
    })
  })

  it('does not restart or morph when only the cue text for the same key changes', () => {
    const started = advanceActionPlaybackState(
      createActionPlaybackState(),
      'hero:1:6',
      'bet',
      500
    )
    const relabeled = advanceActionPlaybackState(started, 'hero:1:6', 'raise', 680)

    expect(relabeled).toBe(started)
    expect(getActionPlaybackSnapshot(relabeled, 680)).toMatchObject({
      cue: 'bet',
      elapsedMs: 180,
      isActive: true,
    })
  })
})
