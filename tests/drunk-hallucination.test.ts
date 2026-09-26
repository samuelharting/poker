import { describe, expect, it } from 'vitest'
import { applyCardMisread, newlyDealtBoardIndices } from '@/hooks/useDrunkHallucination'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'

const ace: Card = { rank: 'A', suit: 'spades' }
const king: Card = { rank: 'K', suit: 'hearts' }
const deuce: Card = { rank: '2', suit: 'clubs' }

function player(id: string, holeCards?: Card[]): SeatPlayer {
  return {
    id,
    nickname: id,
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
  }
}

function table(): TableState {
  return {
    roomCode: 'BAR',
    phase: 'in_hand',
    serverNow: 1,
    round: 'flop',
    players: [player('me', [ace, king]), player('them')],
    communityCards: [ace, king, deuce].map(card => ({ ...card, suit: 'diamonds' as const })),
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 10000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 3,
    recentActions: [],
    lobbyPlayers: [],
  }
}

describe('drunk card misreads', () => {
  it('returns the exact same state object when nothing is misread', () => {
    const state = table()
    expect(applyCardMisread(state, 'me', null)).toBe(state)
  })

  it('swaps only the viewer’s own hole card and never mutates the source state', () => {
    const state = table()
    const misread = { key: 'k', target: 'hole' as const, index: 1, card: deuce, until: 0 }
    const shown = applyCardMisread(state, 'me', misread)

    expect(shown.players[0]?.holeCards).toEqual([ace, deuce])
    expect(state.players[0]?.holeCards).toEqual([ace, king])
    expect(shown.players[1]).toBe(state.players[1])
    expect(shown.communityCards).toBe(state.communityCards)
  })

  it('swaps a freshly dealt board card', () => {
    const state = table()
    const shown = applyCardMisread(state, 'me', { key: 'b', target: 'board', index: 2, card: king, until: 0 })
    expect(shown.communityCards[2]).toEqual(king)
    expect(state.communityCards[2]).toEqual({ rank: '2', suit: 'diamonds' })
  })

  it('ignores misreads that point at cards the viewer does not have', () => {
    const state = table()
    expect(applyCardMisread(state, 'spectator', { key: 'x', target: 'hole', index: 0, card: deuce, until: 0 }).players)
      .toEqual(state.players)
    expect(applyCardMisread(state, 'me', { key: 'y', target: 'board', index: 4, card: deuce, until: 0 })).toBe(state)
  })

  it('knows which board cards were just dealt', () => {
    expect(newlyDealtBoardIndices(0)).toEqual([])
    expect(newlyDealtBoardIndices(3)).toEqual([0, 1, 2])
    expect(newlyDealtBoardIndices(4)).toEqual([3])
    expect(newlyDealtBoardIndices(5)).toEqual([4])
  })
})
