import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { RunItTwiceBoards, RunItTwicePrompt } from '@/components/table/RunItTwice'
import { advanceRound, createInitialGameState, voteRunItTwice } from '@/lib/poker/engine'
import type { Card, InternalGameState, InternalPlayer, SeatPlayer } from '@/lib/poker/types'

function player(
  id: string,
  nickname: string,
  seatIndex: number,
  holeCards: Card[],
  overrides: Partial<InternalPlayer> = {}
): InternalPlayer {
  return {
    id,
    nickname,
    stack: 0,
    bet: 100,
    totalInPot: 100,
    status: 'all_in',
    isDealer: seatIndex === 0,
    isSB: false,
    isBB: false,
    holeCards,
    showCards: 'none',
    isConnected: true,
    seatIndex,
    hasActedThisRound: true,
    ...overrides,
  }
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function makeHeadsUpAllInState(): InternalGameState {
  const state = createInitialGameState('TWICE', 10, 20, 1000, 35_000)
  state.phase = 'in_hand'
  state.round = 'preflop'
  state.handNumber = 1
  state.players = [
    player('alice', 'Alice', 0, [card('A', 'spades'), card('A', 'hearts')]),
    player(
      'bob',
      'Bob',
      1,
      [card('K', 'spades'), card('K', 'hearts')],
      { status: 'active', stack: 100 }
    ),
    player(
      'folded',
      'Folded Player',
      2,
      [card('Q', 'spades'), card('Q', 'hearts')],
      { status: 'folded', stack: 800, totalInPot: 0, bet: 0 }
    ),
  ]
  state.actingPlayerId = null
  state.actingPlayerIndex = -1
  state.deck = [
    card('2', 'clubs'),
    card('3', 'clubs'), card('4', 'clubs'), card('5', 'clubs'),
    card('6', 'clubs'), card('7', 'clubs'),
    card('8', 'clubs'), card('9', 'clubs'),
    card('T', 'clubs'),
    card('J', 'clubs'), card('Q', 'clubs'), card('K', 'clubs'),
    card('A', 'clubs'), card('2', 'diamonds'),
    card('3', 'diamonds'), card('4', 'diamonds'),
  ]
  return state
}

describe('run it twice engine', () => {
  it('offers the vote to exactly the two live human contenders before dealing', () => {
    const pending = advanceRound(makeHeadsUpAllInState())

    expect(pending.phase).toBe('in_hand')
    expect(pending.communityCards).toEqual([])
    expect(pending.actingPlayerId).toBeNull()
    expect(pending.runItTwice).toMatchObject({
      status: 'voting',
      eligiblePlayerIds: ['alice', 'bob'],
      votes: {},
      sharedCardCount: 0,
    })
  })

  it('does not run twice until both players vote yes', () => {
    const pending = advanceRound(makeHeadsUpAllInState())
    const oneYes = voteRunItTwice(pending, 'alice', 'yes')

    expect(oneYes.phase).toBe('in_hand')
    expect(oneYes.runItTwice?.status).toBe('voting')
    expect(oneYes.runItTwice?.votes).toEqual({ alice: 'yes' })
    expect(oneYes.runItTwice?.boards).toBeUndefined()

    const bothYes = voteRunItTwice(oneYes, 'bob', 'yes')
    const boards = bothYes.runItTwice?.boards ?? []

    expect(bothYes.phase).toBe('between_hands')
    expect(bothYes.round).toBe('showdown')
    expect(bothYes.runItTwice?.status).toBe('accepted')
    expect(boards).toHaveLength(2)
    expect(boards.map(board => board.cards)).toEqual([
      [card('3', 'clubs'), card('4', 'clubs'), card('5', 'clubs'), card('7', 'clubs'), card('9', 'clubs')],
      [card('J', 'clubs'), card('Q', 'clubs'), card('K', 'clubs'), card('2', 'diamonds'), card('4', 'diamonds')],
    ])
    expect(boards.flatMap(board => board.winners).reduce((sum, winner) => sum + winner.amount, 0)).toBe(200)
    expect(bothYes.winners?.reduce((sum, winner) => sum + winner.amount, 0)).toBe(200)
  })

  it('immediately continues with one board when either player says no', () => {
    const pending = advanceRound(makeHeadsUpAllInState())
    const declined = voteRunItTwice(pending, 'alice', 'no')

    expect(declined.phase).toBe('between_hands')
    expect(declined.runItTwice?.status).toBe('declined')
    expect(declined.runItTwice?.boards).toBeUndefined()
    expect(declined.communityCards).toHaveLength(5)
  })
})

describe('run it twice interface', () => {
  const players = makeHeadsUpAllInState().players as SeatPlayer[]

  it('shows unanimous-consent copy and each player vote independently', () => {
    const markup = renderToStaticMarkup(
      <RunItTwicePrompt
        runItTwice={{
          status: 'voting',
          eligiblePlayerIds: ['alice', 'bob'],
          votes: { alice: 'yes' },
          expiresAt: Date.now() + 10_000,
        }}
        players={players}
        yourId="alice"
        isConnected
        onVote={vi.fn()}
      />
    )

    expect(markup).toContain('Both players must say yes.')
    expect(markup).toContain('Yes locked in')
    expect(markup).toContain('Bob')
    expect(markup).toContain('Waiting')
  })

  it('renders two labeled board rows after unanimous consent', () => {
    const board = [
      card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs'),
      card('5', 'clubs'), card('6', 'clubs'),
    ]
    const markup = renderToStaticMarkup(
      <RunItTwiceBoards
        runItTwice={{
          status: 'accepted',
          eligiblePlayerIds: ['alice', 'bob'],
          votes: { alice: 'yes', bob: 'yes' },
          boards: [
            { cards: board, winners: [{ playerId: 'alice', amount: 100 }] },
            { cards: [...board].reverse(), winners: [{ playerId: 'bob', amount: 100 }] },
          ],
        }}
        players={players}
      />
    )

    expect(markup.match(/class="run-it-twice-board"/g)).toHaveLength(2)
    expect(markup).toContain('Alice')
    expect(markup).toContain('Bob')
  })
})
