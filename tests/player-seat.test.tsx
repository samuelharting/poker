import { describe, expect, it } from 'vitest'
import { getVisibleSeatCards } from '@/components/table/PlayerSeat'
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
