import { ACTION_ANIMATION_DURATION_MS } from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'

export interface ThreeActionPlaybackState {
  key: string
  cue: ThreeActionCue
  startedAtMs: number
}

export interface ThreeActionPlaybackSnapshot {
  cue: ThreeActionCue
  elapsedMs: number
  isActive: boolean
}

export function createActionPlaybackState(
  actionKey = '',
  actionCue: ThreeActionCue = 'ready'
): ThreeActionPlaybackState {
  return {
    key: actionKey,
    cue: actionKey ? actionCue : 'ready',
    startedAtMs: Number.NEGATIVE_INFINITY,
  }
}

export function advanceActionPlaybackState(
  state: ThreeActionPlaybackState,
  actionKey: string,
  actionCue: ThreeActionCue,
  nowMs: number
): ThreeActionPlaybackState {
  if (!actionKey) {
    if (state.key === '' && state.cue === 'ready') {
      return state
    }

    return createActionPlaybackState()
  }

  if (state.key !== actionKey) {
    return {
      key: actionKey,
      cue: actionCue,
      startedAtMs: nowMs,
    }
  }

  return state
}

export function getActionPlaybackSnapshot(
  state: ThreeActionPlaybackState,
  nowMs: number
): ThreeActionPlaybackSnapshot {
  if (!state.key) {
    return {
      cue: 'ready',
      elapsedMs: ACTION_ANIMATION_DURATION_MS,
      isActive: false,
    }
  }

  const rawElapsedMs = nowMs - state.startedAtMs
  const elapsedMs = Number.isFinite(rawElapsedMs)
    ? Math.max(0, rawElapsedMs)
    : ACTION_ANIMATION_DURATION_MS

  return {
    cue: state.cue,
    elapsedMs,
    isActive: elapsedMs < ACTION_ANIMATION_DURATION_MS,
  }
}
