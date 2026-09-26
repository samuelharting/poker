'use client'

import { useEffect, useRef, useState } from 'react'
import { getDrunkTier, normalizeDrinkState, type PlayerDrinkState } from '@/lib/drinks'

const SIP_ANIMATION_MS = 1500

/**
 * 2D seat indicator: 🍺×N badge, a quick drinking animation when the player
 * drinks, and 💤 when they pass out. The seat itself wobbles via CSS
 * (`:has(.seat-drink-badge[data-wobble])`) so seat markup stays untouched.
 */
export function SeatDrinkBadge({
  drinks: rawDrinks,
  nickname,
}: {
  drinks?: PlayerDrinkState
  nickname?: string
}) {
  const drinks = normalizeDrinkState(rawDrinks)
  const [sip, setSip] = useState<{ id: string; kind: 'beer' | 'water' } | null>(null)
  const seenDrinkIdRef = useRef<string | null | undefined>(undefined)
  const lastDrinkId = drinks.lastDrink?.id ?? null
  const lastDrinkKind = drinks.lastDrink?.kind ?? null

  useEffect(() => {
    if (seenDrinkIdRef.current === undefined) {
      seenDrinkIdRef.current = lastDrinkId
      return
    }
    if (!lastDrinkId || !lastDrinkKind || lastDrinkId === seenDrinkIdRef.current) {
      return
    }

    seenDrinkIdRef.current = lastDrinkId
    setSip({ id: lastDrinkId, kind: lastDrinkKind })
    const timer = window.setTimeout(() => setSip(null), SIP_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [lastDrinkId, lastDrinkKind])

  // Only beers are worth bragging about; water isn't counted.
  const hasHistory = drinks.beers > 0 || drinks.passedOut
  if (!hasHistory && !sip) {
    return null
  }

  const tier = getDrunkTier(drinks.level, drinks.passedOut)
  const label = drinks.passedOut
    ? `${nickname ?? 'Player'} passed out`
    : `${nickname ?? 'Player'}: ${drinks.beers} beer${drinks.beers === 1 ? '' : 's'}, drunk level ${drinks.level}`

  return (
    <div
      className="seat-drink-badge"
      data-tier={tier}
      data-wobble={!drinks.passedOut && drinks.level >= 5 ? 'true' : undefined}
      data-passed-out={drinks.passedOut ? 'true' : undefined}
      role="img"
      aria-label={label}
      title={label}
    >
      {hasHistory && (
        <span className="seat-drink-chip">
          {drinks.passedOut ? (
            <span className="seat-drink-zzz" aria-hidden="true">💤</span>
          ) : (
            <>
              <span aria-hidden="true">🍺</span>
              <b>×{drinks.beers}</b>
            </>
          )}
        </span>
      )}
      {sip && (
        <span key={sip.id} className={`seat-drink-sip is-${sip.kind}`} aria-hidden="true">
          {sip.kind === 'beer' ? '🍺' : '💧'}
        </span>
      )}
    </div>
  )
}
