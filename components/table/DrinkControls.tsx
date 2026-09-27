'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { CHASER_WINDOW_MS, DRINK_COOLDOWN_MS, DRUNK_LEVEL_MAX, type DrunkTier } from '@/lib/drinks'
import { useChaserSecondsLeft, useDrinks } from './DrinkContext'

const CHASER_WINDOW_SECONDS = CHASER_WINDOW_MS / 1000

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
  const chaserSeconds = useChaserSecondsLeft()

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
    : chaserSeconds > 0
      ? `Chaser: a water now takes 2 off at once (${chaserSeconds}s)`
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
          className={`drink-button is-water ${chaserSeconds > 0 ? 'is-chaser' : ''}`}
          onClick={() => order('water')}
          disabled={disabled}
          aria-label={waterTitle}
          title={waterTitle}
        >
          <span className="drink-button-glyph" aria-hidden="true">💧</span>
          <span className="drink-button-label">Water</span>
          {chaserSeconds > 0 && (
            // Chaser window after a shot: a ring that drains over 20s, no words.
            <svg className="drink-chaser-ring" viewBox="0 0 36 36" aria-hidden="true" data-seconds={chaserSeconds}>
              <circle className="drink-chaser-ring-track" cx="18" cy="18" r="15.5" />
              <circle
                className="drink-chaser-ring-fill"
                cx="18"
                cy="18"
                r="15.5"
                pathLength={100}
                strokeDasharray={`${(chaserSeconds / CHASER_WINDOW_SECONDS) * 100} 100`}
              />
            </svg>
          )}
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
