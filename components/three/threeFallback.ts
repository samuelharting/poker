import { useSyncExternalStore } from 'react'

/**
 * When the desktop 3D room cannot keep drawing (WebGL unavailable, a context
 * that keeps getting lost, a render error), the room drops to the simple 2D
 * table instead of leaving a black screen. Lives outside the 3D bundle (no
 * three.js import) so the room page and PokerTable can read it cheaply.
 *
 * The switch is remembered for the browser tab (sessionStorage), so a reload
 * on a struggling GPU does not walk straight back into the same black screen.
 * "Try 3D again" clears it.
 */

export type ThreeFallbackReason =
  | 'webgl-unavailable'
  | 'context-lost'
  | 'start-failed'
  | 'stalled'
  | 'black-frame'
  | 'render-error'

export interface ThreeFallbackState {
  reason: ThreeFallbackReason
  at: number
}

const STORAGE_KEY = 'poker-night:3d-fallback'
const REASONS: readonly ThreeFallbackReason[] = ['webgl-unavailable', 'context-lost', 'start-failed', 'stalled', 'black-frame', 'render-error']

let current: ThreeFallbackState | null | undefined
const listeners = new Set<() => void>()

function readStored(): ThreeFallbackState | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ThreeFallbackState>
    if (!parsed || !REASONS.includes(parsed.reason as ThreeFallbackReason)) return null
    return { reason: parsed.reason as ThreeFallbackReason, at: Number(parsed.at) || Date.now() }
  } catch {
    return null
  }
}

function writeStored(state: ThreeFallbackState | null) {
  try {
    if (typeof window === 'undefined') return
    if (state) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode / blocked storage: the switch still holds for this page.
  }
}

function emit() {
  listeners.forEach(listener => listener())
}

export function getThreeFallback(): ThreeFallbackState | null {
  if (current === undefined) current = readStored()
  return current
}

/** Switches this tab to the 2D table. The first reason wins (later ones are echoes of it). */
export function activateThreeFallback(reason: ThreeFallbackReason, error?: unknown) {
  if (getThreeFallback()) return
  console.warn(`3D table unavailable (${reason}); switching to the 2D table.`, error ?? '')
  current = { reason, at: Date.now() }
  writeStored(current)
  emit()
}

export function clearThreeFallback() {
  if (getThreeFallback() === null) return
  current = null
  writeStored(null)
  emit()
}

export function subscribeThreeFallback(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getServerSnapshot = () => null

/** The active 2D fallback (or null while the 3D room is allowed). */
export function useThreeFallback(): ThreeFallbackState | null {
  return useSyncExternalStore(subscribeThreeFallback, getThreeFallback, getServerSnapshot)
}

/** Test-only: forget the in-memory state (storage is left to the caller). */
export function resetThreeFallbackForTests() {
  current = undefined
  listeners.clear()
}

/**
 * Counts render failures (lost contexts, failed starts, stalled or black
 * output) in a sliding window. One failure is worth a rebuild; repeated ones
 * mean this GPU cannot hold the 3D room, so the caller falls back to 2D
 * instead of rebuilding (or reloading) forever.
 */
export function createRenderFailureTracker(options: { limit?: number; windowMs?: number } = {}) {
  const limit = Math.max(1, options.limit ?? 3)
  const windowMs = Math.max(1, options.windowMs ?? 180_000)
  let failures: number[] = []
  const prune = (now: number) => {
    failures = failures.filter(at => now - at < windowMs)
  }
  return {
    /** Records one failure; true when the limit is reached (stop rebuilding, fall back). */
    record(now: number): boolean {
      prune(now)
      failures.push(now)
      return failures.length >= limit
    },
    count(now: number): number {
      prune(now)
      return failures.length
    },
    reset() {
      failures = []
    },
  }
}

export type RenderFailureTracker = ReturnType<typeof createRenderFailureTracker>

/** True for errors that mean WebGL itself is missing or blocked (no retry will help). */
export function isWebGLUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /webgl.*(not supported|unavailable|disabled|blocked)|error creating webgl context/i.test(message)
}
