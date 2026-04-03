import { describe, it, expect } from 'vitest'
import {
  createInitialGameState,
  startHand,
  processAction,
  resolveShowdown,
  prepareNextHand,
  toTableState,
} from '@/lib/poker/engine'
import type { InternalGameState, InternalPlayer } from '@/lib/poker/types'

function addPlayer(
  state: InternalGameState,
  id: string,
  nickname: string,
  seat: number,
  stack = 1000
): InternalGameState {
  const player: InternalPlayer = {
    id,
    nickname,
    stack,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards: [],
    showCards: 'none',
    isConnected: true,
    seatIndex: seat,
    hasActedThisRound: false,
  }
  state.players.push(player)
  state.players.sort((a, b) => a.seatIndex - b.seatIndex)
  return state
}

function card(rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A', suit: 'spades' | 'hearts' | 'diamonds' | 'clubs') {
  return { rank, suit }
}

function handCards(
  rankA: Parameters<typeof card>[0],
  suitA: Parameters<typeof card>[1],
  rankB: Parameters<typeof card>[0],
  suitB: Parameters<typeof card>[1]
) {
  return [card(rankA, suitA), card(rankB, suitB)]
}

function setup2Players(): InternalGameState {
  let state = createInitialGameState('TEST')
  state = addPlayer(state, 'p1', 'Alice', 0)
  state = addPlayer(state, 'p2', 'Bob', 1)
  return state
}

function setup3Players(): InternalGameState {
  let state = createInitialGameState('TEST')
  state = addPlayer(state, 'p1', 'Alice', 0)
  state = addPlayer(state, 'p2', 'Bob', 1)
  state = addPlayer(state, 'p3', 'Carol', 2)
  return state
}

describe('createInitialGameState', () => {
  it('creates state with correct defaults', () => {
    const state = createInitialGameState('ROOM1')
    expect(state.roomCode).toBe('ROOM1')
    expect(state.phase).toBe('waiting')
    expect(state.smallBlind).toBe(10)
    expect(state.bigBlind).toBe(20)
    expect(state.players).toHaveLength(0)
  })
})

describe('startHand', () => {
  it('throws with fewer than 2 players', () => {
    let state = createInitialGameState('TEST')
    state = addPlayer(state, 'p1', 'Alice', 0)
    expect(() => startHand(state)).toThrow()
  })

  it('starts a hand with 2 players', () => {
    const state = startHand(setup2Players())
    expect(state.phase).toBe('in_hand')
    expect(state.round).toBe('preflop')
    expect(state.handNumber).toBe(1)
    // Both players should have 2 hole cards
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(2)
    }
    // One SB and one BB
    const sb = state.players.find(p => p.isSB)
    const bb = state.players.find(p => p.isBB)
    expect(sb).toBeDefined()
    expect(bb).toBeDefined()
    // Acting player should be set
    expect(state.actingPlayerId).toBeTruthy()
  })

  it('posts correct blind amounts', () => {
    const state = startHand(setup2Players())
    const sb = state.players.find(p => p.isSB)!
    const bb = state.players.find(p => p.isBB)!
    expect(sb.bet).toBe(10)
    expect(bb.bet).toBe(20)
    expect(sb.stack).toBe(990)
    expect(bb.stack).toBe(980)
  })
})

describe('processAction', () => {
  it('rejects action from wrong player', () => {
    const state = startHand(setup2Players())
    const nonActing = state.players.find(p => p.id !== state.actingPlayerId)!
    expect(() => processAction(state, nonActing.id, 'fold')).toThrow('Not your turn')
  })

  it('fold ends hand when only 2 players', () => {
    const state = startHand(setup2Players())
    const actingId = state.actingPlayerId!
    const result = processAction(state, actingId, 'fold')
    expect(result.phase).toBe('between_hands')
    expect(result.winners).toHaveLength(1)
    expect(result.winners![0]!.playerId).not.toBe(actingId)
  })

  it('call matches the current bet', () => {
    const state = startHand(setup2Players())
    const actingId = state.actingPlayerId!
    const result = processAction(state, actingId, 'call')
    const caller = result.players.find(p => p.id === actingId)!
    expect(caller.bet).toBe(result.currentBet)
  })

  it('raise increases current bet', () => {
    const state = startHand(setup2Players())
    const actingId = state.actingPlayerId!
    const raiseAmount = state.minRaise
    const result = processAction(state, actingId, 'raise', raiseAmount)
    expect(result.currentBet).toBe(raiseAmount)
  })

  it('rejects raise below minimum', () => {
    const state = startHand(setup2Players())
    const actingId = state.actingPlayerId!
    expect(() => processAction(state, actingId, 'raise', 25)).toThrow()
  })

  it('all-in puts player all-in with correct status', () => {
    const state = startHand(setup2Players())
    const actingId = state.actingPlayerId!
    const result = processAction(state, actingId, 'all_in')
    const player = result.players.find(p => p.id === actingId)!
    expect(player.status).toBe('all_in')
    expect(player.stack).toBe(0)
  })
})

describe('full hand flow', () => {
  it('completes a hand through preflop fold', () => {
    const state = startHand(setup2Players())
    const result = processAction(state, state.actingPlayerId!, 'fold')
    expect(result.phase).toBe('between_hands')
  })

  it('advances to flop after preflop calls', () => {
    let state = startHand(setup3Players())
    // In 3-player, preflop action goes: UTG, SB, BB
    // Each calls until round is complete
    let maxActions = 10
    while (state.round === 'preflop' && state.phase === 'in_hand' && maxActions-- > 0) {
      const acting = state.actingPlayerId!
      const player = state.players.find(p => p.id === acting)!
      if (player.bet < state.currentBet) {
        state = processAction(state, acting, 'call')
      } else {
        state = processAction(state, acting, 'check')
      }
    }
    // Should have advanced past preflop
    expect(state.round).not.toBe('preflop')
  })
})

describe('rabbit hunting', () => {
  it('keeps fold-ended hands unchanged when rabbit hunting is off', () => {
    const state = startHand(setup2Players())
    state.rabbitHuntingEnabled = false
    state.deck = [
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
      card('J', 'diamonds'),
      card('9', 'spades'),
      card('8', 'hearts'),
      card('7', 'clubs'),
      card('6', 'diamonds'),
    ]

    const result = processAction(state, state.actingPlayerId!, 'fold')

    expect(result.communityCards).toEqual([])
    expect(result.recentActions.some(action => action.startsWith('Rabbit hunt:'))).toBe(false)
  })

  it('runs out the full board after a preflop fold without changing payouts', () => {
    const state = startHand(setup2Players())
    state.rabbitHuntingEnabled = true

    const actingId = state.actingPlayerId!
    const folder = state.players.find(player => player.id === actingId)!
    const winner = state.players.find(player => player.id !== actingId)!
    const expectedBoard = [
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
      card('J', 'diamonds'),
      card('9', 'spades'),
    ]

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    folder.holeCards = handCards('A', 'clubs', 'K', 'clubs')
    state.deck = [
      card('3', 'spades'),
      expectedBoard[0]!,
      expectedBoard[1]!,
      expectedBoard[2]!,
      card('4', 'hearts'),
      expectedBoard[3]!,
      card('5', 'clubs'),
      expectedBoard[4]!,
    ]

    const result = processAction(state, actingId, 'fold')

    expect(result.communityCards).toEqual(expectedBoard)
    expect(result.winners).toHaveLength(1)
    expect(result.winners?.[0]).toMatchObject({
      playerId: winner.id,
      amount: 30,
      handDescription: undefined,
    })
    expect(result.bounty?.active).toBe(true)
    expect(result.bounty?.amount).toBe(20)
    expect(result.bounty?.contributors).toEqual([folder.id])
    expect(result.recentActions[0]).toContain('Rabbit hunt:')
  })

  it('runs out turn and river after a flop fold', () => {
    const state = startHand(setup2Players())
    state.rabbitHuntingEnabled = true
    state.round = 'flop'
    state.communityCards = [
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
    ]
    state.deck = [
      card('2', 'diamonds'),
      card('J', 'spades'),
      card('3', 'clubs'),
      card('9', 'hearts'),
    ]

    const result = processAction(state, state.actingPlayerId!, 'fold')

    expect(result.communityCards).toEqual([
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
      card('J', 'spades'),
      card('9', 'hearts'),
    ])
    expect(result.recentActions[0]).toContain('turn Js')
    expect(result.recentActions[0]).toContain('river 9h')
  })

  it('runs out only the river after a turn fold', () => {
    const state = startHand(setup2Players())
    state.rabbitHuntingEnabled = true
    state.round = 'turn'
    state.communityCards = [
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
      card('J', 'diamonds'),
    ]
    state.deck = [
      card('2', 'clubs'),
      card('9', 'spades'),
    ]

    const result = processAction(state, state.actingPlayerId!, 'fold')

    expect(result.communityCards).toEqual([
      card('A', 'spades'),
      card('K', 'hearts'),
      card('Q', 'clubs'),
      card('J', 'diamonds'),
      card('9', 'spades'),
    ])
    expect(result.recentActions[0]).toContain('Rabbit hunt: river 9s')
  })
})

describe('bounty payouts', () => {
  it('applies a 7-2 bounty on an outright showdown win', () => {
    const state = startHand(setup3Players())
    const winner = state.players[0]!
    const loserA = state.players[1]!
    const loserB = state.players[2]!

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    loserA.holeCards = handCards('A', 'spades', 'K', 'hearts')
    loserB.holeCards = handCards('Q', 'spades', 'J', 'hearts')
    state.communityCards = [
      { rank: '7', suit: 'diamonds' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
      { rank: '9', suit: 'spades' },
    ]
    state.round = 'showdown'
    state.round = 'showdown'

    const before = Object.fromEntries(state.players.map(p => [p.id, p.stack] as const))
    const resolved = resolveShowdown(state)
    const winnerResult = resolved.winners?.find(w => w.playerId === winner.id)

    expect(winnerResult?.amount).toBe(30)
    expect(resolved.bounty?.active).toBe(true)
    expect(resolved.bounty?.amount).toBe(40)
    expect(resolved.bounty?.recipientPlayerIds).toEqual([winner.id])
    expect(new Set(resolved.bounty?.contributors ?? [])).toEqual(new Set([loserA.id, loserB.id]))

    expect(resolved.players.find(p => p.id === winner.id)?.stack).toBe(before[winner.id]! + 70)
    expect(resolved.players.find(p => p.id === loserA.id)?.stack).toBe(before[loserA.id]! - 20)
    expect(resolved.players.find(p => p.id === loserB.id)?.stack).toBe(before[loserB.id]! - 20)
  })

  it('splits 7-2 bounty across tied winners by pot-share proportion', () => {
    const state = startHand(setup3Players())
    const p1 = state.players[0]!
    const p2 = state.players[1]!
    const p3 = state.players[2]!

    p1.holeCards = handCards('7', 'spades', '2', 'hearts')
    p2.holeCards = handCards('7', 'clubs', '2', 'diamonds')
    p3.holeCards = handCards('Q', 'spades', 'J', 'hearts')
    state.communityCards = [
      { rank: 'A', suit: 'spades' },
      { rank: '7', suit: 'diamonds' },
      { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'clubs' },
      { rank: '4', suit: 'hearts' },
    ]
    state.round = 'showdown'
    state.round = 'showdown'

    const before = Object.fromEntries(state.players.map(p => [p.id, p.stack] as const))
    const resolved = resolveShowdown(state)
    const amounts = Object.fromEntries(
      resolved.winners?.map(w => [w.playerId, w.amount] as const) ?? []
    )

    expect(amounts).toMatchObject({ [p1.id]: 15, [p2.id]: 15 })
    expect(resolved.bounty?.active).toBe(true)
    expect(resolved.bounty?.amount).toBe(20)
    expect(new Set(resolved.bounty?.contributors ?? [])).toEqual(new Set([p3.id]))
    expect(new Set(resolved.bounty?.recipientPlayerIds ?? [])).toEqual(new Set([p1.id, p2.id]))

    expect(resolved.players.find(p => p.id === p1.id)?.stack).toBe(before[p1.id]! + 15 + 10)
    expect(resolved.players.find(p => p.id === p2.id)?.stack).toBe(before[p2.id]! + 15 + 10)
    expect(resolved.players.find(p => p.id === p3.id)?.stack).toBe(before[p3.id]! - 20)
  })

  it('does not double-apply bounty after hand is resolved', () => {
    const state = startHand(setup3Players())
    const winner = state.players[0]!
    const loserA = state.players[1]!
    const loserB = state.players[2]!

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    loserA.holeCards = handCards('A', 'spades', 'K', 'hearts')
    loserB.holeCards = handCards('Q', 'spades', 'J', 'hearts')
    state.communityCards = [
      { rank: '7', suit: 'diamonds' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
      { rank: '9', suit: 'spades' },
    ]
    state.round = 'showdown'
    state.round = 'showdown'

    const once = resolveShowdown(state)
    const stacksAfterFirst = once.players.map(p => p.stack)
    const twice = resolveShowdown(once)

    expect(twice.players.map(p => p.stack)).toEqual(stacksAfterFirst)
    expect(twice.bounty).toEqual(once.bounty)
  })

  it('keeps disconnected players out of bounty contribution', () => {
    const state = startHand(setup3Players())
    const winner = state.players[0]!
    const disconnected = state.players[1]!
    const activeContributor = state.players[2]!

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    disconnected.holeCards = handCards('A', 'spades', 'K', 'hearts')
    activeContributor.holeCards = handCards('Q', 'spades', 'J', 'hearts')
    disconnected.status = 'disconnected'

    state.communityCards = [
      { rank: '7', suit: 'diamonds' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
      { rank: '9', suit: 'spades' },
    ]
    state.round = 'showdown'
    state.round = 'showdown'

    const resolved = resolveShowdown(state)

    expect(resolved.bounty?.active).toBe(true)
    expect(resolved.bounty?.amount).toBe(20)
    expect(resolved.bounty?.contributors).toEqual([activeContributor.id])
  })

  it('charges folded players who were dealt into the hand', () => {
    const state = startHand(setup3Players())
    const winner = state.players[0]!
    const foldedLoser = state.players[1]!
    const liveLoser = state.players[2]!

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    foldedLoser.holeCards = handCards('A', 'spades', 'K', 'hearts')
    liveLoser.holeCards = handCards('Q', 'spades', 'J', 'hearts')
    foldedLoser.status = 'folded'

    state.communityCards = [
      { rank: '7', suit: 'diamonds' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
      { rank: '9', suit: 'spades' },
    ]
    state.round = 'showdown'

    const before = Object.fromEntries(state.players.map(p => [p.id, p.stack] as const))
    const resolved = resolveShowdown(state)

    expect(resolved.bounty?.active).toBe(true)
    expect(resolved.bounty?.amount).toBe(40)
    expect(new Set(resolved.bounty?.contributors ?? [])).toEqual(
      new Set([foldedLoser.id, liveLoser.id])
    )
    expect(resolved.players.find(p => p.id === winner.id)?.stack).toBe(before[winner.id]! + 70)
    expect(resolved.players.find(p => p.id === foldedLoser.id)?.stack).toBe(
      before[foldedLoser.id]! - 20
    )
    expect(resolved.players.find(p => p.id === liveLoser.id)?.stack).toBe(
      before[liveLoser.id]! - 20
    )
  })

  it('works with a side pot and still applies 7-2 bounty', () => {
    const state = startHand(setup3Players())
    const winner = state.players[0]!
    const sidePotContributor = state.players[2]!
    const allInLoser = state.players[1]!

    winner.status = 'active'
    sidePotContributor.status = 'active'
    allInLoser.status = 'all_in'

    winner.holeCards = handCards('7', 'spades', '2', 'hearts')
    sidePotContributor.holeCards = handCards('A', 'spades', 'Q', 'hearts')
    allInLoser.holeCards = handCards('4', 'spades', '3', 'hearts')

    winner.totalInPot = 100
    winner.stack = 1000
    sidePotContributor.totalInPot = 80
    sidePotContributor.stack = 1000
    allInLoser.totalInPot = 40
    allInLoser.stack = 0

    state.communityCards = [
      { rank: '7', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '4', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
    ]
    state.round = 'showdown'
    state.round = 'showdown'

    const resolved = resolveShowdown(state)

    expect(resolved.totalPot).toBe(220)
    expect(resolved.bounty?.active).toBe(true)
    expect(resolved.bounty?.amount).toBe(20)
    expect(resolved.bounty?.contributors).toEqual([sidePotContributor.id])
    expect(resolved.winners?.map(w => w.amount)).toEqual([220])
    expect(resolved.winners?.[0]?.playerId).toBe(winner.id)
  })
})

describe('toTableState', () => {
  it('masks hole cards for other players', () => {
    const state = startHand(setup2Players())
    const p1 = state.players[0]!
    const p2 = state.players[1]!

    const view1 = toTableState(state, p1.id)
    const view2 = toTableState(state, p2.id)

    // p1's view: can see own cards, not p2's
    const p1InView1 = view1.players.find(p => p.id === p1.id)!
    const p2InView1 = view1.players.find(p => p.id === p2.id)!
    expect(p1InView1.holeCards).toHaveLength(2)
    expect(p2InView1.holeCards).toBeUndefined()
    expect(p2InView1.hasCards).toBe(true)

    // p2's view: can see own cards, not p1's
    const p1InView2 = view2.players.find(p => p.id === p1.id)!
    const p2InView2 = view2.players.find(p => p.id === p2.id)!
    expect(p2InView2.holeCards).toHaveLength(2)
    expect(p1InView2.holeCards).toBeUndefined()
  })

  it('reveals every hand to a spectator view during a live hand', () => {
    const state = startHand(setup2Players())
    const [p1, p2] = state.players

    const spectatorView = toTableState(state, 'spectator-1', {
      revealAllHoleCards: true,
    })
    const p1InSpectatorView = spectatorView.players.find(player => player.id === p1!.id)!
    const p2InSpectatorView = spectatorView.players.find(player => player.id === p2!.id)!

    expect(p1InSpectatorView.holeCards).toHaveLength(2)
    expect(p2InSpectatorView.holeCards).toHaveLength(2)
    expect(p1InSpectatorView.showCards).toBe('both')
    expect(p2InSpectatorView.showCards).toBe('both')
  })

  it('reveals folded cards when a player opts to show them', () => {
    const state = startHand(setup2Players())
    const p1 = state.players[0]!
    const p2 = state.players[1]!

    p2.status = 'folded'
    p2.showCards = 'both'
    state.phase = 'between_hands'

    const view = toTableState(state, p1.id)
    const p2View = view.players.find(player => player.id === p2.id)!

    expect(p2View.holeCards).toHaveLength(2)
    expect(p2View.showCards).toBe('both')
  })

  it('reveals folded cards during a live hand when a player opts to show them', () => {
    const state = startHand(setup3Players())
    const actingPlayerId = state.actingPlayerId!
    const finishedTurn = processAction(state, actingPlayerId, 'fold')
    const foldedPlayer = finishedTurn.players.find(player => player.id === actingPlayerId)!
    const observer = finishedTurn.players.find(
      player => player.id !== actingPlayerId && player.status === 'active'
    )!

    expect(finishedTurn.phase).toBe('in_hand')

    foldedPlayer.showCards = 'both'

    const view = toTableState(finishedTurn, observer.id)
    const foldedView = view.players.find(player => player.id === foldedPlayer.id)!

    expect(foldedView.holeCards).toHaveLength(2)
    expect(foldedView.showCards).toBe('both')
  })

  it('reveals only selected cards for a folded player', () => {
    const state = startHand(setup2Players())
    const p1 = state.players[0]!
    const p2 = state.players[1]!

    p2.status = 'folded'
    p2.holeCards = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
    ]
    state.phase = 'between_hands'

    p2.showCards = 'left'
    const viewLeft = toTableState(state, p1.id)
    const p2ViewLeft = viewLeft.players.find(player => player.id === p2.id)!

    expect(p2ViewLeft.holeCards).toHaveLength(1)
    expect(p2ViewLeft.holeCards?.[0]).toEqual({ rank: 'A', suit: 'spades' })

    p2.showCards = 'right'
    const viewRight = toTableState(state, p1.id)
    const p2ViewRight = viewRight.players.find(player => player.id === p2.id)!

    expect(p2ViewRight.holeCards).toHaveLength(1)
    expect(p2ViewRight.holeCards?.[0]).toEqual({ rank: 'K', suit: 'hearts' })

    p2.showCards = 'both'
    const viewBoth = toTableState(state, p1.id)
    const p2ViewBoth = viewBoth.players.find(player => player.id === p2.id)!

    expect(p2ViewBoth.holeCards).toHaveLength(2)
    expect(p2ViewBoth.holeCards?.[0]).toEqual({ rank: 'A', suit: 'spades' })
    expect(p2ViewBoth.holeCards?.[1]).toEqual({ rank: 'K', suit: 'hearts' })
  })

  it('reveals surviving hands automatically after the hand is over', () => {
    const state = startHand(setup2Players())
    const hero = state.players[0]!

    const finished = processAction(state, state.actingPlayerId!, 'fold')
    const villain = finished.phase === 'between_hands'
      ? finished.players.find(player => player.id !== state.actingPlayerId!)!
      : hero

    const view = toTableState(finished, hero.id)
    const villainView = view.players.find(player => player.id === villain.id)!

    expect(villainView.holeCards).toHaveLength(2)
  })
})

describe('prepareNextHand', () => {
  it('resets hand state and sits out busted players', () => {
    let state = startHand(setup2Players())
    state = processAction(state, state.actingPlayerId!, 'fold')
    const next = prepareNextHand(state)
    expect(next.phase).toBe('between_hands')
    expect(next.communityCards).toHaveLength(0)
    expect(next.pots).toHaveLength(0)
    for (const p of next.players) {
      expect(p.holeCards).toHaveLength(0)
      expect(p.bet).toBe(0)
    }
  })
})
