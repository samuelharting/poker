'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { DRINK_COOLDOWN_MS, DRUNK_LEVEL_MAX, getDrunkTier, type DrunkTier } from '@/lib/drinks'
import { useChaserSecondsLeft, useDrinks } from './DrinkContext'

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
export function DrinkControls({
  variant,
  handNumber = 0,
}: {
  variant: 'desktop' | 'mobile'
  /** Current hand number: one beer per hand. */
  handNumber?: number
}) {
  const drinks = useDrinks()
  const isCooling = useCooldownActive(drinks?.lastOrderAt ?? null)
  const chaserSeconds = useChaserSecondsLeft()

  if (!drinks || !drinks.isSeated) {
    return null
  }

  const { myDrinks, canOrder, order, takeShot } = drinks
  const disabled = !canOrder || isCooling
  const beerUsed = myDrinks.beerReadyAtHand > handNumber
  // The meter shows your real buzz; screen effects (profile) only start at 6.
  const buzzTier = getDrunkTier(myDrinks.level, myDrinks.passedOut)
  const tierLabel = TIER_LABELS[buzzTier]
  const style = {
    '--drink-level': myDrinks.level,
  } as CSSProperties
  const beerTitle = myDrinks.passedOut
    ? 'You are passed out'
    : beerUsed
      ? 'One beer per hand'
      : `Crack a beer (${myDrinks.beers} so far)`
  const waterTitle = myDrinks.passedOut
    ? 'You are passed out'
    : chaserSeconds > 0
      ? `Chaser: a water now takes 2 off at once (${chaserSeconds}s)`
      : 'Water: sobers you up 1.5 in a few seconds.'

  return (
    <div
      className={`drink-controls is-${variant} ${isCooling ? 'is-cooling' : ''}`}
      data-tier={buzzTier}
      role="group"
      aria-label={`Drinks. You are ${tierLabel.toLowerCase()}, level ${myDrinks.level} of ${DRUNK_LEVEL_MAX}.`}
      style={style}
    >
      <div className="drink-buttons">
        <button
          type="button"
          className={`drink-button is-beer ${beerUsed ? 'is-used' : ''}`}
          onClick={() => order('beer')}
          disabled={disabled || beerUsed}
          aria-label={beerTitle}
          title={beerTitle}
        >
          <span className="drink-button-glyph" aria-hidden="true">🍺</span>
          <span className="drink-button-label">Beer</span>
          {beerUsed ? (
            <em className="drink-button-count is-per-hand" aria-hidden="true">1/hand</em>
          ) : myDrinks.beers > 0 ? (
            <em className="drink-button-count" aria-hidden="true">{myDrinks.beers}</em>
          ) : null}

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
        <button
          type="button"
          className="drink-button is-shot"
          onClick={takeShot}
          disabled={disabled}
          aria-label={myDrinks.passedOut ? 'You are passed out' : 'Take a shot (+3)'}
          title={myDrinks.passedOut ? 'You are passed out' : 'Take a shot (+3)'}
        >
          <span className="drink-button-glyph" aria-hidden="true">
            {/* Drawn, not an emoji: some fonts show the tumbler glass as a picture box. */}
            <svg viewBox="0 0 24 24" width="1em" height="1em">
              <path d="M5 4h14l-1.6 15.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5 4Z" fill="rgba(255,255,255,0.18)" stroke="#f4efe4" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M6.3 11h11.4l-.9 8.1a1 1 0 0 1-1 .9H8.2a1 1 0 0 1-1-.9L6.3 11Z" fill="#e9a23b" />
              <path d="M7 12.3h10" stroke="#ffd88a" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </span>
          <span className="drink-button-label">Shot</span>
        </button>
      </div>

      {/* The classic dot meter: one pip per buzz level. */}
      <div className="drink-meter" aria-hidden="true">
        <span className="drink-meter-label">{tierLabel}</span>
        <span className="drink-meter-pips">
          {Array.from({ length: DRUNK_LEVEL_MAX }, (_, index) => (
            <i
              key={index}
              className={index + 1 <= myDrinks.level ? 'is-full' : index < myDrinks.level ? 'is-half' : ''}
            />
          ))}
        </span>
      </div>

    </div>
  )
}
