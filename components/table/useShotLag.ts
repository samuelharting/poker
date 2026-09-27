'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlayerDrinkState } from '@/lib/drinks'
import { SHOT_DOWN_AT } from '@/components/three/prankTimeline'

/** The server adds a shot's +3 the moment it is poured; you feel it once it's down. */
export const SHOT_FEEL_DELAY_MS = Math.round(SHOT_DOWN_AT * 1000) + 100

/**
 * Holds your previous buzz (and keeps you awake) for the couple of seconds the
 * shot glass takes to slide over and be thrown back, so the meter, the drunk
 * vision and a shot blackout land when you actually drink it.
 */
export function useShotLaggedDrinks(drinks: PlayerDrinkState): PlayerDrinkState {
  const previousRef = useRef(drinks)
  const [held, setHeld] = useState<Pick<PlayerDrinkState, 'level' | 'passedOut'> | null>(null)

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = drinks
    if (drinks.shots <= previous.shots) return
    setHeld(current => current ?? { level: previous.level, passedOut: previous.passedOut })
    const timer = window.setTimeout(() => setHeld(null), SHOT_FEEL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [drinks])

  if (!held) return drinks
  return { ...drinks, level: held.level, passedOut: held.passedOut && drinks.passedOut }
}
