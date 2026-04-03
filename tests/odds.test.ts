import { describe, expect, it } from 'vitest'
import { withVisibleHandOdds } from '@/lib/poker/odds'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'

function makePlayer(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'p1',
    nickname: 'Player',
    stack: 1000,
    bet: 0,
    totalInPot: 100,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards: [],
    hasCards: true,
    showCards: 'both',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: true,
    ...overrides,
  }
}

function makeState(players: SeatPlayer[], communityCards: Card[]): TableState {
  return {
    roomCode: 'TEST',
    phase: 'in_hand',
    round: communityCards.length === 5 ? 'river' : 'turn',
    players,
    communityCards,
    pots: [],
    totalPot: players.reduce((sum, player) => sum + player.totalInPot, 0),
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: true,
    sevenTwoBountyPercent: 2,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
  }
}

describe('withVisibleHandOdds', () => {
  it('calculates exact turn equity when every live hand is visible', () => {
    const state = makeState(
      [
        makePlayer({
          id: 'aces',
          nickname: 'Aces',
          holeCards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'A', suit: 'diamonds' },
          ],
        }),
        makePlayer({
          id: 'kings',
          nickname: 'Kings',
          seatIndex: 1,
          holeCards: [
            { rank: 'K', suit: 'hearts' },
            { rank: 'K', suit: 'spades' },
          ],
        }),
      ],
      [
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'diamonds' },
        { rank: '7', suit: 'clubs' },
        { rank: '2', suit: 'spades' },
      ]
    )

    const withOdds = withVisibleHandOdds(state)
    const aces = withOdds.players.find(player => player.id === 'aces')
    const kings = withOdds.players.find(player => player.id === 'kings')

    expect(aces?.equityPercent).toBe(97.7)
    expect(kings?.equityPercent).toBe(2.3)
  })

  it('handles split pots on a fully dealt board', () => {
    const state = makeState(
      [
        makePlayer({
          id: 'p1',
          holeCards: [
            { rank: '2', suit: 'clubs' },
            { rank: '3', suit: 'diamonds' },
          ],
        }),
        makePlayer({
          id: 'p2',
          seatIndex: 1,
          holeCards: [
            { rank: '4', suit: 'clubs' },
            { rank: '5', suit: 'diamonds' },
          ],
        }),
      ],
      [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'diamonds' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'hearts' },
        { rank: 'T', suit: 'spades' },
      ]
    )

    const withOdds = withVisibleHandOdds(state)

    expect(withOdds.players.find(player => player.id === 'p1')?.equityPercent).toBe(50)
    expect(withOdds.players.find(player => player.id === 'p2')?.equityPercent).toBe(50)
  })

  it('leaves odds hidden when a live opponent hand is not visible', () => {
    const state = makeState(
      [
        makePlayer({
          id: 'hero',
          holeCards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'K', suit: 'spades' },
          ],
        }),
        makePlayer({
          id: 'villain',
          seatIndex: 1,
          holeCards: undefined,
          hasCards: true,
        }),
      ],
      [
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '7', suit: 'hearts' },
      ]
    )

    const withOdds = withVisibleHandOdds(state)

    expect(withOdds.players.every(player => player.equityPercent === undefined)).toBe(true)
  })
})
