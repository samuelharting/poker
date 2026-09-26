'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { DRINK_COOLDOWN_MS, DRUNK_LEVEL_MAX, type DrunkTier } from '@/lib/drinks'
import { useDrinks } from './DrinkContext'

const TIER_LABELS: Record<DrunkTier, string> = {
  sober: 'Sober',
  buzzed: 'Buzzed',
  tipsy: 'Tipsy',
  drunk: 'Drunk',
  wasted: 'Wasted',
  out: 'Out cold',
}

function useCooldownActive(lastOrderAt: number | null): boolean {
  const [now, setNow] = useState(() => Date.now())
  const remaining = lastOrderAt === null ? 0 : lastOrderAt + DRINK_COOLDOWN_MS - now

  useEffect(() => {
    if (lastOrderAt === null) {
      return
    }

    setNow(Date.now())
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, lastOrderAt + DRINK_COOLDOWN_MS - Date.now()) + 20
    )
    return () => window.clearTimeout(timer)
  }, [lastOrderAt])

  return remaining > 0
}

/**
 * Beer / water buttons. `desktop` floats beside the Table talk button;
 * `mobile` sits in the hero lane next to your cards.
 */
export function DrinkControls({ variant }: { variant: 'desktop' | 'mobile' }) {
  const drinks = useDrinks()
  const isCooling = useCooldownActive(drinks?.lastOrderAt ?? null)

  if (!drinks || !drinks.isSeated) {
    return null
  }

  const { myDrinks, profile, canOrder, order, lastOrderAt } = drinks
  const disabled = !canOrder || isCooling
  const tierLabel = TIER_LABELS[profile.tier]
  const style = {
    '--drink-cooldown': `${DRINK_COOLDOWN_MS}ms`,
    '--drink-level': myDrinks.level,
  } as CSSProperties
  const beerTitle = myDrinks.passedOut
    ? 'You are passed out'
    : `Crack a beer (${myDrinks.beers} so far)`
  const waterTitle = myDrinks.passedOut
    ? 'You are passed out'
    : 'Drink a water. Sobers you up one level.'

  return (
    <div
      className={`drink-controls is-${variant} ${isCooling ? 'is-cooling' : ''}`}
      data-tier={profile.tier}
      role="group"
      aria-label={`Drinks. You are ${tierLabel.toLowerCase()}, level ${myDrinks.level} of ${DRUNK_LEVEL_MAX}.`}
      style={style}
    >
      <div className="drink-buttons">
        <button
          type="button"
          className="drink-button is-beer"
          onClick={() => order('beer')}
          disabled={disabled}
          aria-label={beerTitle}
          title={beerTitle}
        >
          <span className="drink-button-glyph" aria-hidden="true">🍺</span>
          <span className="drink-button-label">Beer</span>
          {myDrinks.beers > 0 && (
            <em className="drink-button-count" aria-hidden="true">{myDrinks.beers}</em>
          )}
        </button>
        <button
          type="button"
          className="drink-button is-water"
          onClick={() => order('water')}
          disabled={disabled}
          aria-label={waterTitle}
          title={waterTitle}
        >
          <span className="drink-button-glyph" aria-hidden="true">💧</span>
          <span className="drink-button-label">Water</span>
        </button>
        {isCooling && lastOrderAt !== null && (
          <span key={lastOrderAt} className="drink-cooldown" aria-hidden="true" />
        )}
      </div>

      <div className="drink-meter" aria-hidden="true">
        <span className="drink-meter-label">{myDrinks.passedOut ? '💤 ' : ''}{tierLabel}</span>
        <span className="drink-meter-pips">
          {Array.from({ length: DRUNK_LEVEL_MAX }, (_, index) => (
            <i key={index} className={index < myDrinks.level ? 'is-full' : ''} />
          ))}
        </span>
      </div>
    </div>
  )
}
