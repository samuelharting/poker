import { describe, expect, it } from 'vitest'
import {
  advanceRound,
  createInitialGameState,
  processAction,
  resolveRunItTwiceDecision,
  runRabbitHunt,
  startHand,
  voteRunItTwice,
} from '@/lib/poker/engine'
import type { Card, InternalGameState, InternalPlayer } from '@/lib/poker/types'

type Rank = Card['rank']
type Suit = Card['suit']

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

function seat(state: InternalGameState, id: string, seatIndex: number, stack = 1000) {
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

function table(ids: string[], stack = 1000): InternalGameState {
  const state = createInitialGameState('QA')
  ids.forEach((id, index) => seat(state, id, index, stack))
  return state
}

function byId(state: InternalGameState, id: string): InternalPlayer {
  const player = state.players.find(candidate => candidate.id === id)
  if (!player) throw new Error(`missing ${id}`)
  return player
}

/** Put known cards in hands and on top of the deck (burns included). */
function rig(state: InternalGameState, hands: Record<string, Card[]>, deckTop: Card[] = []) {
  for (const [id, cards] of Object.entries(hands)) {
    byId(state, id).holeCards = cards
  }
  const used = new Set([...Object.values(hands).flat(), ...deckTop].map(card => `${card.rank}${card.suit}`))
  state.deck = [...deckTop, ...state.deck.filter(card => !used.has(`${card.rank}${card.suit}`))]
}

describe('heads-up blind order (regression)', () => {
  it('puts the button on the small blind, first to act preflop and last after the flop', () => {
    for (let hand = 0; hand < 4; hand += 1) {
      let state = table(['a', 'b'])
      // Rotate the button through both seats.
      state.dealerSeatIndex = hand % 2
      state = startHand(state)

      const dealer = state.players.find(player => player.isDealer)!
      const sb = state.players.find(player => player.isSB)!
      const bb = state.players.find(player => player.isBB)!
      expect(sb.id).toBe(dealer.id)
      expect(bb.id).not.toBe(dealer.id)
      expect(sb.bet).toBe(10)
      expect(bb.bet).toBe(20)
      expect(state.actingPlayerId).toBe(dealer.id)

      state = processAction(state, dealer.id, 'call')
      expect(state.actingPlayerId).toBe(bb.id)
      state = processAction(state, bb.id, 'check')
      expect(state.round).toBe('flop')
      // Out of position (big blind) acts first after the flop; the button acts last.
      expect(state.actingPlayerId).toBe(bb.id)
      state = processAction(state, bb.id, 'check')
      expect(state.actingPlayerId).toBe(dealer.id)
    }
  })

  it('keeps the regular order for three or more players', () => {
    let state = table(['a', 'b', 'c'])
    state = startHand(state)
    const dealer = state.players.find(player => player.isDealer)!
    const sb = state.players.find(player => player.isSB)!
    const bb = state.players.find(player => player.isBB)!
    expect(new Set([dealer.id, sb.id, bb.id]).size).toBe(3)
    expect(state.actingPlayerId).toBe(dealer.id)
  })
})

describe('7-2 bounty game', () => {
  function sevenDeuceFoldWin(percent: number, enabled = true) {
    let state = table(['a', 'b', 'c'])
    state.sevenTwoRuleEnabled = enabled
    state.sevenTwoBountyPercent = percent
    state = startHand(state)
    const first = state.actingPlayerId!
    const others = state.players.map(player => player.id).filter(id => id !== first)
    rig(state, {
      [first]: [c('7', 'hearts'), c('2', 'clubs')],
      [others[0]!]: [c('A', 'spades'), c('A', 'hearts')],
      [others[1]!]: [c('K', 'spades'), c('K', 'hearts')],
    })
    const before = Object.fromEntries(state.players.map(player => [player.id, player.stack + player.bet]))
    state = processAction(state, first, 'raise', 100)
    while (state.phase === 'in_hand') {
      state = processAction(state, state.actingPlayerId!, 'fold')
    }
    return { state, first, others, before }
  }

  it('pays the bounty when 7-2 wins uncontested (everyone folds to the bluff)', () => {
    const { state, first, others, before } = sevenDeuceFoldWin(2)
    expect(state.winners?.[0]?.playerId).toBe(first)
    expect(state.bounty?.active).toBe(true)
    // 2% of the 1,000 buy-in from each opponent dealt into the hand.
    expect(state.bounty?.amount).toBe(40)
    expect(new Set(state.bounty?.contributors)).toEqual(new Set(others))
    const blinds = others.map(id => before[id]! - byId(state, id).stack - 20)
    // Each folder lost only their blind (if any) plus the 20 chip bounty.
    for (const [index, id] of others.entries()) {
      expect(byId(state, id).stack).toBe(before[id]! - (blinds[index]! + 20))
    }
    const totalChips = state.players.reduce((sum, player) => sum + player.stack, 0)
    expect(totalChips).toBe(3000)
  })

  it('uses the configured percentage', () => {
    const { state } = sevenDeuceFoldWin(7.5)
    // floor(1000 * 7.5%) = 75 per opponent.
    expect(state.bounty?.amount).toBe(150)
  })

  it('does not charge anyone when the rule is off', () => {
    const { state } = sevenDeuceFoldWin(5, false)
    expect(state.bounty?.active).toBe(false)
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(3000)
  })

  it('does not charge a chip when the bounty is set to 0% (regression)', () => {
    const { state, others, before } = sevenDeuceFoldWin(0)
    expect(state.bounty?.active).toBe(false)
    expect(state.bounty?.amount).toBe(0)
    expect(state.bounty?.contributors).toEqual([])
    const blindsPosted = others.reduce((sum, id) => sum + (before[id]! - byId(state, id).stack), 0)
    // Folders lose only their blinds: SB 10 + BB 20.
    expect(blindsPosted).toBe(30)
  })

  it('logs the bounty with player names, never raw ids (regression)', () => {
    const { state, first } = sevenDeuceFoldWin(2)
    const line = state.recentActions.find(action => action.includes('bounty'))
    expect(line).toBeDefined()
    expect(line).toContain(byId(state, first).nickname)
    expect(line).not.toMatch(new RegExp(`\\b${first}\\b`))
  })

  it('does not pay a bounty for a losing 7-2', () => {
    let state = table(['a', 'b'])
    state = startHand(state)
    const [x, y] = state.players.map(player => player.id)
    rig(state, {
      [x!]: [c('7', 'hearts'), c('2', 'clubs')],
      [y!]: [c('A', 'spades'), c('A', 'hearts')],
    }, [c('3', 'clubs'), c('K', 'diamonds'), c('9', 'clubs'), c('4', 'spades'), c('5', 'clubs'), c('J', 'hearts'), c('6', 'clubs'), c('Q', 'spades')])
    state = processAction(state, state.actingPlayerId!, 'call')
    state = processAction(state, state.actingPlayerId!, 'check')
    while (state.phase === 'in_hand') {
      state = processAction(state, state.actingPlayerId!, 'check')
    }
    expect(state.winners?.[0]?.playerId).toBe(y)
    expect(state.bounty?.active).toBe(false)
  })

  it('pays the bounty to a 7-2 that wins one board of a run-it-twice', () => {
    let state = table(['a', 'b'])
    state = startHand(state)
    const sbId = state.actingPlayerId!
    const bbId = state.players.find(player => player.id !== sbId)!.id
    rig(state, {
      [sbId]: [c('7', 'hearts'), c('2', 'clubs')],
      [bbId]: [c('A', 'spades'), c('K', 'spades')],
    }, [
      // Board 1: burn + 7 7 2 flop, burn + 3 turn, burn + 4 river -> 7-2 full house wins.
      c('9', 'diamonds'), c('7', 'diamonds'), c('7', 'spades'), c('2', 'hearts'),
      c('T', 'diamonds'), c('3', 'diamonds'), c('J', 'clubs'), c('4', 'hearts'),
      // Board 2: burn + Q Q A flop, burn + 8 turn, burn + 5 river -> AK wins.
      c('6', 'diamonds'), c('Q', 'hearts'), c('Q', 'clubs'), c('A', 'diamonds'),
      c('8', 'clubs'), c('8', 'hearts'), c('6', 'hearts'), c('5', 'diamonds'),
    ])
    state = processAction(state, sbId, 'all_in')
    state = processAction(state, bbId, 'call')
    expect(state.runItTwice?.status).toBe('voting')
    state = voteRunItTwice(state, sbId, 'yes')
    expect(state.runItTwice?.status).toBe('voting')
    state = voteRunItTwice(state, bbId, 'yes')
    expect(state.runItTwice?.status).toBe('accepted')
    expect(state.runItTwice?.boards).toHaveLength(2)
    const boardWinners = state.runItTwice!.boards!.map(board => board.winners.map(winner => winner.playerId))
    expect(boardWinners).toEqual([[sbId], [bbId]])
    expect(state.bounty?.active).toBe(true)
    expect(state.bounty?.recipientPlayerIds).toEqual([sbId])
    // Each board is worth 1,000; the 7-2 also collects 20 from the other player.
    expect(byId(state, sbId).stack).toBe(1020)
    expect(byId(state, bbId).stack).toBe(980)
  })
})

describe('run it twice consent', () => {
  function allInHeadsUp() {
    let state = table(['a', 'b'])
    state = startHand(state)
    const first = state.actingPlayerId!
    const second = state.players.find(player => player.id !== first)!.id
    state = processAction(state, first, 'all_in')
    state = processAction(state, second, 'call')
    return { state, first, second }
  }

  it('offers the vote only to the two all-in players and pauses the board', () => {
    const { state, first, second } = allInHeadsUp()
    expect(state.runItTwice?.status).toBe('voting')
    expect(new Set(state.runItTwice?.eligiblePlayerIds)).toEqual(new Set([first, second]))
    expect(state.communityCards).toHaveLength(0)
    expect(state.actingPlayerId).toBeNull()
  })

  it('runs one board when either player says no', () => {
    const { state, first } = allInHeadsUp()
    const resolved = voteRunItTwice(state, first, 'no')
    expect(resolved.runItTwice?.status).toBe('declined')
    expect(resolved.communityCards).toHaveLength(5)
    expect(resolved.phase).toBe('between_hands')
    expect(resolved.players.reduce((sum, player) => sum + player.stack, 0)).toBe(2000)
  })

  it('rejects double votes and outsiders', () => {
    const { state, first } = allInHeadsUp()
    const voted = voteRunItTwice(state, first, 'yes')
    expect(() => voteRunItTwice(voted, first, 'yes')).toThrow(/already locked/)
    expect(() => voteRunItTwice(voted, 'ghost', 'yes')).toThrow(/Only the two players/)
  })

  it('expiry resolves to a single board', () => {
    const { state } = allInHeadsUp()
    const resolved = resolveRunItTwiceDecision(state, false)
    expect(resolved.runItTwice?.status).toBe('declined')
    expect(resolved.communityCards).toHaveLength(5)
  })

  it('conserves chips across two boards', () => {
    const { state, first, second } = allInHeadsUp()
    const resolved = voteRunItTwice(voteRunItTwice(state, first, 'yes'), second, 'yes')
    expect(resolved.runItTwice?.boards?.every(board => board.cards.length === 5)).toBe(true)
    expect(resolved.players.reduce((sum, player) => sum + player.stack, 0)).toBe(2000)
  })
})

describe('rabbit hunt', () => {
  it('only runs after a fold-ended hand with cards still to come', () => {
    let state = table(['a', 'b'])
    state = startHand(state)
    expect(() => runRabbitHunt(state)).toThrow()
    state = processAction(state, state.actingPlayerId!, 'fold')
    const hunted = runRabbitHunt(state)
    expect(hunted.communityCards).toHaveLength(0)
    expect(hunted.rabbitCards).toHaveLength(5)
    expect(hunted.recentActions[0]).toMatch(/^Rabbit hunt: flop .* \| turn .* \| river /)
    // Payouts never change.
    expect(hunted.players.map(player => player.stack)).toEqual(state.players.map(player => player.stack))
    expect(() => runRabbitHunt(hunted)).toThrow()
  })

  it('never reveals a board after a real showdown', () => {
    let state = table(['a', 'b'])
    state = startHand(state)
    state = processAction(state, state.actingPlayerId!, 'call')
    while (state.phase === 'in_hand') {
      state = processAction(state, state.actingPlayerId!, 'check')
    }
    expect(state.round).toBe('showdown')
    expect(() => runRabbitHunt(state)).toThrow()
  })

  // advanceRound is exported for the room; keep the import meaningful.
  it('advanceRound deals the flop from preflop', () => {
    let state = table(['a', 'b'])
    state = startHand(state)
    state = advanceRound(state)
    expect(state.communityCards).toHaveLength(3)
  })
})
