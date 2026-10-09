import { describe, expect, it } from 'vitest'
import {
  createInitialGameState,
  foldLeavingPlayer,
  processAction,
  resolveRunItTwiceDecision,
  startHand,
  voteRunItTwice,
} from '@/lib/poker/engine'
import { evaluateHand } from '@/lib/poker/evaluator'
import type { Card, InternalGameState, InternalPlayer } from '@/lib/poker/types'

/**
 * Regressions found by the room fuzz (tests/room-fuzz.test.ts) and by the
 * disputed live hands: a live hand that loses a pot it never got to contest,
 * chips that vanish, hands that stall, and labels from the wrong board.
 */

function c(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function seat(state: InternalGameState, id: string, seatIndex: number, stack: number) {
  const player: InternalPlayer = {
    id,
    nickname: id.toUpperCase(),
    stack,
    bet: 0,
    totalInPot: 0,
    status: 'waiting',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards: [],
    showCards: 'none',
    isConnected: true,
    seatIndex,
    hasActedThisRound: false,
  }
  state.players.push(player)
  state.players.sort((a, b) => a.seatIndex - b.seatIndex)
}

function table(stacks: Record<string, number>): InternalGameState {
  const state = createInitialGameState('QA')
  Object.entries(stacks).forEach(([id, stack], index) => seat(state, id, index, stack))
  return state
}

function byId(state: InternalGameState, id: string): InternalPlayer {
  const player = state.players.find(candidate => candidate.id === id)
  if (!player) throw new Error(`missing ${id}`)
  return player
}

/** Fix the hole cards and the next cards off the deck (burns included). */
function rig(state: InternalGameState, hands: Record<string, Card[]>, deckTop: Card[]) {
  for (const [id, cards] of Object.entries(hands)) byId(state, id).holeCards = cards
  const used = new Set([...Object.values(hands).flat(), ...deckTop].map(card => `${card.rank}${card.suit}`))
  state.deck = [...deckTop, ...state.deck.filter(card => !used.has(`${card.rank}${card.suit}`))]
}

const actor = (state: InternalGameState) => byId(state, state.actingPlayerId!)
const chips = (state: InternalGameState) => state.players.reduce((sum, player) => sum + player.stack + (state.phase === 'in_hand' ? player.totalInPot : 0), 0)

describe('an all-in for less than a full raise (disputed hands 63 and 73)', () => {
  it('gives the player who already bet the chance to call the extra, and pays them when they win', () => {
    // Three-handed: UTG raises to 100, the short stack shoves 130 (a 30 raise,
    // too small to reopen the betting), the big blind calls.
    let state = startHand(table({ a: 1000, b: 1000, c: 130 }))
    const bb = state.players.find(player => player.isBB)!.id
    const utg = state.actingPlayerId!
    const short = 'c'
    expect(utg).not.toBe(short)

    state = processAction(state, utg, 'raise', 100)
    expect(state.actingPlayerId).toBe(short)
    state = processAction(state, short, 'all_in')
    state = processAction(state, bb, 'call')

    // Before the fix the round ended here and UTG's 100 sat in a pot only the
    // other two could win, while UTG's cards were still tabled at showdown.
    expect(state.round).toBe('preflop')
    expect(state.actingPlayerId).toBe(utg)
    state = processAction(state, utg, 'call')
    expect(state.round).toBe('flop')
    expect(state.pots[0]).toEqual({ amount: 390, eligiblePlayerIds: expect.arrayContaining([utg, bb, short]) })
  })

  it('heads-up: the bettor facing a short shove is asked to call, and the best hand wins the whole pot', () => {
    // vaughn (button) and macknig, like hand 63: vaughn bets, macknig shoves a
    // little more, vaughn holds the best hand at showdown.
    let state = table({ vaughn: 1000, macknig: 300 })
    state.dealerSeatIndex = 1 // next button: seat 0 (vaughn)
    state = startHand(state)
    expect(byId(state, 'vaughn').isDealer).toBe(true)
    rig(state, { vaughn: [c('6', 'clubs'), c('Q', 'clubs')], macknig: [c('3', 'spades'), c('2', 'spades')] }, [
      c('4', 'clubs'), c('J', 'hearts'), c('7', 'hearts'), c('2', 'diamonds'),
      c('5', 'clubs'), c('K', 'diamonds'),
      c('8', 'clubs'), c('6', 'spades'),
    ])

    state = processAction(state, 'vaughn', 'call')
    state = processAction(state, 'macknig', 'check')
    expect(state.round).toBe('flop')
    // Post-flop the big blind acts first.
    state = processAction(state, 'macknig', 'check')
    state = processAction(state, 'vaughn', 'raise', 200)
    state = processAction(state, 'macknig', 'all_in') // 280 total: a raise of 80 into a 200 bet
    expect(state.actingPlayerId).toBe('vaughn')
    expect(state.round).toBe('flop')

    state = processAction(state, 'vaughn', 'call')
    // Heads-up all-in: decline running it twice, one board.
    state = voteRunItTwice(state, 'vaughn', 'no')
    expect(state.phase).toBe('between_hands')
    expect(state.communityCards.map(card => `${card.rank}${card.suit[0]}`)).toEqual(['Jh', '7h', '2d', 'Kd', '6s'])
    expect(evaluateHand([...byId(state, 'vaughn').holeCards, ...state.communityCards]).description).toBe('Pair of Sixes')
    expect(state.winners).toEqual([expect.objectContaining({ playerId: 'vaughn', amount: 600, handDescription: 'Pair of Sixes' })])
    expect(byId(state, 'vaughn').stack).toBe(1300)
    expect(byId(state, 'macknig').stack).toBe(0)
  })

  it('treats a "raise" for the whole stack below the current bet as an all-in call for less', () => {
    let state = startHand(table({ a: 1000, b: 1000, c: 60 }))
    const utg = state.actingPlayerId!
    state = processAction(state, utg, 'raise', 100)
    expect(state.actingPlayerId).toBe('c')
    const shortStack = byId(state, 'c')
    // The slider's max: 60 total, less than the 100 to call.
    state = processAction(state, 'c', 'raise', shortStack.stack + shortStack.bet)
    expect(state.currentBet).toBe(100)
    expect(byId(state, 'c').status).toBe('all_in')
    expect(byId(state, 'c').totalInPot).toBe(60)
  })
})

describe('chips never vanish', () => {
  it('returns a leaver\'s uncalled chips when the only player left is all-in for less', () => {
    let state = table({ a: 1000, b: 300 })
    state.dealerSeatIndex = 1 // next button: a (small blind, first to act heads-up)
    state = startHand(state)
    const before = chips(state)
    state = processAction(state, 'a', 'raise', 900)
    state = processAction(state, 'b', 'all_in') // calls for less: 300
    expect(state.runItTwice?.status).toBe('voting')
    // a walks away from the table during the vote: folded out of the hand.
    state = foldLeavingPlayer(state, 'a')
    expect(state.phase).toBe('between_hands')
    // Before the fix a's uncalled 600 was in no pot and simply disappeared.
    expect(chips(state)).toBe(before)
    expect(state.winners).toEqual([expect.objectContaining({ playerId: 'b', amount: 600 })])
    expect(byId(state, 'a').stack).toBe(100 + 600)
  })
})

describe('blinds that put everyone all-in', () => {
  it('runs the board out instead of handing the turn to an all-in player', () => {
    let state = table({ a: 10, b: 10 })
    state = startHand(state)
    expect(state.players.every(player => player.status === 'all_in')).toBe(true)
    expect(state.actingPlayerId).toBeNull()
    // Heads-up humans are offered run it twice; either way the hand finishes.
    expect(state.runItTwice?.status).toBe('voting')
    state = resolveRunItTwiceDecision(state, false)
    expect(state.phase).toBe('between_hands')
    expect(state.communityCards).toHaveLength(5)
    expect(chips(state)).toBe(20)
  })
})

describe('run it twice labels', () => {
  it('names each run\'s hand instead of pairing run 2\'s hand with run 1\'s board', () => {
    let state = table({ a: 500, b: 500 })
    state.dealerSeatIndex = 1
    state = startHand(state)
    rig(state, { a: [c('K', 'hearts'), c('K', 'clubs')], b: [c('9', 'spades'), c('9', 'diamonds')] }, [
      // run 1: burn, flop, burn, turn, burn, river
      c('2', 'clubs'), c('K', 'diamonds'), c('7', 'spades'), c('3', 'hearts'),
      c('2', 'hearts'), c('4', 'clubs'), c('2', 'spades'), c('J', 'clubs'),
      // run 2
      c('3', 'clubs'), c('9', 'hearts'), c('9', 'clubs'), c('5', 'spades'),
      c('4', 'hearts'), c('8', 'diamonds'), c('4', 'spades'), c('6', 'clubs'),
    ])
    state = processAction(state, actor(state).id, 'all_in')
    state = processAction(state, actor(state).id, 'call')
    state = voteRunItTwice(state, 'a', 'yes')
    state = voteRunItTwice(state, 'b', 'yes')
    expect(state.runItTwice?.status).toBe('accepted')
    const [run1, run2] = state.runItTwice!.boards!
    expect(run1!.winners.map(winner => winner.playerId)).toEqual(['a'])
    expect(run2!.winners.map(winner => winner.playerId)).toEqual(['b'])
    const winners = new Map(state.winners!.map(winner => [winner.playerId, winner]))
    expect(winners.get('a')!.handDescription).toBe('Run 1: Three of a Kind, Kings')
    expect(winners.get('b')!.handDescription).toBe('Run 2: Four of a Kind, Nines')
    // Highlights go with the board on the table (run 1) only.
    expect(winners.get('b')!.winningCards).toBeUndefined()
    expect(state.communityCards).toEqual(run1!.cards)
  })
})

describe('evaluator', () => {
  it('describes A-2-3-4-5 suited as a five-high straight flush', () => {
    const result = evaluateHand([
      c('A', 'hearts'), c('2', 'hearts'), c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), c('K', 'clubs'), c('Q', 'clubs'),
    ])
    expect(result.rank).toBe('straight_flush')
    expect(result.description).toBe('Straight Flush, Five-high')
    const sixHigh = evaluateHand([
      c('6', 'hearts'), c('2', 'hearts'), c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), c('K', 'clubs'), c('Q', 'clubs'),
    ])
    expect(sixHigh.tiebreakers[0]).toBeGreaterThan(result.tiebreakers[0]!)
  })
})
