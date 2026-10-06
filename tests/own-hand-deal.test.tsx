import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card } from '@/lib/poker/types'
import { OwnHand } from '@/components/table/OwnHand'
import { getHeroHoleCardLandings, type DealTimingPlayer } from '@/components/table/ownHandDeal'

function seats(dealerSeat: number): DealTimingPlayer[] {
  return [0, 1, 3, 4, 5, 7].map(visualSeat => ({
    id: `p${visualSeat}`,
    visualSeat,
    isHero: visualSeat === 0,
    isDealer: visualSeat === dealerSeat,
    isOutOfHand: false,
    hasCards: true,
  }))
}

describe('hero hole card landing times', () => {
  it('lands the second card after the first, and both after the dealer reaches for the deck', () => {
    const [first, second] = getHeroHoleCardLandings(seats(4))!
    expect(first).toBeGreaterThan(0.5)
    expect(second).toBeGreaterThan(first)
  })

  it('deals the hero last when the hero has the button', () => {
    const asDealer = getHeroHoleCardLandings(seats(0))!
    const nextToDealer = getHeroHoleCardLandings(seats(7))!
    // Seat 1 is dealt first when seat 0 holds the button; the hero (seat 0) is dealt first when seat 7 does.
    expect(asDealer[0]).toBeGreaterThan(nextToDealer[0])
  })

  it('returns null when the hero holds no cards', () => {
    const players = seats(4).map(player => ({ ...player, hasCards: player.isHero ? false : true }))
    expect(getHeroHoleCardLandings(players)).toBeNull()
  })

  it('falls back to the quick deck deal when the dealer cannot deal by hand', () => {
    const players = seats(4).map(player => player.isDealer ? { ...player, awayLabel: 'Away' as const } : player)
    const [, second] = getHeroHoleCardLandings(players)!
    expect(second).toBeLessThan(1.5)
  })
})

describe('OwnHand deal gate', () => {
  const cards: Card[] = [
    { rank: 'A', suit: 'spades' },
    { rank: 'K', suit: 'hearts' },
  ]

  it('holds the cards back until they have landed in the 3D deal', () => {
    const markup = renderToStaticMarkup(
      <OwnHand cards={cards} isActing={false} concealed dealLandsAt={[Date.now() + 2000, Date.now() + 3000]} />
    )
    expect(markup).toContain('data-deal-gate="pending"')
    expect(markup).not.toContain('is-landed')
  })

  it('does not gate a hand whose cards have already landed (or when nothing is passed)', () => {
    const landed = renderToStaticMarkup(
      <OwnHand cards={cards} isActing={false} concealed dealLandsAt={[Date.now() - 2000, Date.now() - 1000]} />
    )
    const plain = renderToStaticMarkup(<OwnHand cards={cards} isActing={false} concealed />)
    expect(landed).not.toContain('data-deal-gate')
    expect(plain).not.toContain('data-deal-gate')
  })
})
