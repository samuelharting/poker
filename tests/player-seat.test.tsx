import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatWinnerPaymentLabel, getVisibleSeatCards } from '@/components/table/PlayerSeat'
import { PlayerSeat } from '@/components/table/PlayerSeat'
import type { Card, SeatPlayer } from '@/lib/poker/types'

function makeSeatPlayer(overrides: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id: 'p1',
    nickname: 'Alice',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'folded',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards: [],
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

describe('PlayerSeat card reveals', () => {
  it('renders a right-only reveal in the right slot', () => {
    const player = makeSeatPlayer({
      showCards: 'right',
      holeCards: [{ rank: 'K', suit: 'hearts' }],
    })
    const visible = getVisibleSeatCards(player.showCards, player.holeCards)

    expect(visible.left).toBeNull()
    expect(visible.right).toEqual({ rank: 'K', suit: 'hearts' })
  })

  it('renders a left-only reveal in the left slot', () => {
    const player = makeSeatPlayer({
      showCards: 'left',
      holeCards: [{ rank: 'A', suit: 'spades' }],
    })
    const visible = getVisibleSeatCards(player.showCards, player.holeCards)

    expect(visible.left).toEqual({ rank: 'A', suit: 'spades' })
    expect(visible.right).toBeNull()
  })

  it('uses the second card for a two-card right reveal', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
    ]

    const visible = getVisibleSeatCards('right', cards)

    expect(visible.left).toBeNull()
    expect(visible.right).toEqual(cards[1])
  })

  it('shows both cards in order for a full reveal', () => {
    const cards: Card[] = [
      { rank: 'Q', suit: 'clubs' },
      { rank: 'J', suit: 'diamonds' },
    ]

    const visible = getVisibleSeatCards('both', cards)

    expect(visible.left).toEqual(cards[0])
    expect(visible.right).toEqual(cards[1])
  })
})

describe('winner payment labels', () => {
  it('adds Venmo when the winner has a handle', () => {
    expect(formatWinnerPaymentLabel('Sam', '@samvenmo')).toBe('Sam @samvenmo')
  })

  it('falls back to nickname only without Venmo', () => {
    expect(formatWinnerPaymentLabel('Sam')).toBe('Sam')
  })
})

describe('PlayerSeat turn label', () => {
  it('uses a direct turn label for the acting player', () => {
    const markup = renderToStaticMarkup(
      <PlayerSeat
        player={makeSeatPlayer({ status: 'active' })}
        isActing={true}
        depthClass="seat-depth-mid"
        opacityValue={1}
      />
    )

    expect(markup).toContain('Turn')
    expect(markup).not.toContain('Acting')
  })
})

describe('PlayerSeat folded presentation', () => {
  it('marks folded seats with a status hook and stronger inactive opacity', () => {
    const markup = renderToStaticMarkup(
      <PlayerSeat
        player={makeSeatPlayer({ status: 'folded', lastAction: 'Folded' })}
        isActing={false}
        depthClass="seat-depth-mid"
        opacityValue={1}
      />
    )

    expect(markup).toContain('is-folded')
    expect(markup).toContain('data-player-status="folded"')
    expect(markup).toContain('opacity:0.34')
    expect(markup).toContain('Folded')
  })
})

describe('PlayerSeat target controls', () => {
  it('lets the avatar marker target a player for emojis', () => {
    const markup = renderToStaticMarkup(
      <PlayerSeat
        player={makeSeatPlayer({ id: 'villain', nickname: 'Villain' })}
        isActing={false}
        depthClass="seat-depth-mid"
        opacityValue={1}
        onNameClick={() => {}}
      />
    )

    expect(markup).toContain('data-player-target-trigger="avatar"')
    expect(markup).toContain('Target Villain for emojis')
  })
})
