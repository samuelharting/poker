import { beforeEach, describe, expect, it } from 'vitest'
import {
  advanceAllInRunout,
  createInitialGameState,
  isBettingClosed,
  processAction,
  startHand,
  toTableState,
} from '@/lib/poker/engine'
import {
  clearHandOddsCache,
  computeLiveHandOdds,
  getHandOddsComputationCount,
  withVisibleHandOdds,
} from '@/lib/poker/odds'
import type { Card, InternalGameState, InternalPlayer, Rank, Suit } from '@/lib/poker/types'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

function addPlayer(state: InternalGameState, id: string, seat: number, extra: Partial<InternalPlayer> = {}) {
  state.players.push({
    id,
    nickname: id,
    stack: 1000,
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
    ...extra,
  })
  state.players.sort((a, b) => a.seatIndex - b.seatIndex)
}

/** Heads-up hand against a bot (no run-it-twice vote) with a paced runout. */
function pacedHeadsUp(): InternalGameState {
  const state = createInitialGameState('ODDS')
  addPlayer(state, 'hero', 0)
  addPlayer(state, 'bot_villain', 1, { isBot: true })
  return startHand({ ...state, pacedRunout: true })
}

function otherId(state: InternalGameState, id: string): string {
  return state.players.find(player => player.id !== id)!.id
}

beforeEach(() => {
  clearHandOddsCache()
})

describe('isBettingClosed', () => {
  it('is false while someone still has a decision to make', () => {
    let state = pacedHeadsUp()
    expect(isBettingClosed(state)).toBe(false)
    state = processAction(state, state.actingPlayerId!, 'all_in')
    // The caller still has to act: nothing is tabled yet.
    expect(state.actingPlayerId).toBeTruthy()
    expect(isBettingClosed(state)).toBe(false)
  })

  it('closes once the last actionable player has matched an all-in', () => {
    let state = pacedHeadsUp()
    state = processAction(state, state.actingPlayerId!, 'all_in')
    state = processAction(state, state.actingPlayerId!, 'call')
    expect(isBettingClosed(state)).toBe(true)
  })

  it('stays closed when one player still has chips behind but nobody can bet against them', () => {
    const state = createInitialGameState('ODDS')
    addPlayer(state, 'deep', 0, { stack: 5000 })
    addPlayer(state, 'bot_short', 1, { isBot: true, stack: 200 })
    let hand = startHand({ ...state, pacedRunout: true })
    expect(hand.actingPlayerId).toBe('bot_short')
    hand = processAction(hand, 'bot_short', 'all_in')
    expect(isBettingClosed(hand)).toBe(false)
    hand = processAction(hand, 'deep', 'call')
    expect(hand.players.find(player => player.id === 'deep')!.status).toBe('active')
    expect(isBettingClosed(hand)).toBe(true)
  })

  it('is false between hands and when only one player is left', () => {
    let state = pacedHeadsUp()
    state = processAction(state, state.actingPlayerId!, 'fold')
    expect(state.phase).toBe('between_hands')
    expect(isBettingClosed(state)).toBe(false)
  })
})

describe('paced all-in runout', { timeout: 30_000 }, () => {
  it('tables the hands, then deals one street per step and resolves at the river', () => {
    let state = pacedHeadsUp()
    const shover = state.actingPlayerId!
    const caller = otherId(state, shover)

    state = processAction(state, shover, 'all_in')
    // No leak before the action closes: the shover cannot see the caller's cards.
    expect(toTableState(state, shover).players.find(player => player.id === caller)!.holeCards).toBeUndefined()

    state = processAction(state, caller, 'call')
    expect(state.phase).toBe('in_hand')
    expect(state.communityCards).toHaveLength(0)
    expect(state.allInRunout?.nextStreetAt).toBeGreaterThan(Date.now())
    expect(state.actingPlayerId).toBeNull()

    // Tabled: every viewer (even a stranger) sees both hands now.
    const strangerView = toTableState(state, 'someone-else')
    expect(strangerView.allInRunout).toBeDefined()
    for (const player of strangerView.players) {
      expect(player.holeCards).toHaveLength(2)
      expect(player.showCards).toBe('both')
    }

    const boardSizes: number[] = []
    while (state.phase === 'in_hand') {
      state = advanceAllInRunout(state)
      boardSizes.push(state.communityCards.length)
    }
    expect(boardSizes).toEqual([3, 4, 5, 5])
    expect(state.round).toBe('showdown')
    expect(state.winners?.length).toBeGreaterThan(0)
    expect(state.allInRunout).toBeUndefined()
  })

  it('keeps the instant runout when pacing is off', () => {
    const state = createInitialGameState('ODDS')
    addPlayer(state, 'hero', 0)
    addPlayer(state, 'bot_villain', 1, { isBot: true })
    let hand = startHand(state)
    hand = processAction(hand, hand.actingPlayerId!, 'all_in')
    hand = processAction(hand, hand.actingPlayerId!, 'call')
    expect(hand.phase).toBe('between_hands')
    expect(hand.communityCards).toHaveLength(5)
  })

  it('ignores a runout step when nothing is pending', () => {
    const state = pacedHeadsUp()
    expect(advanceAllInRunout(state)).toBe(state)
  })

  it('tables both hands while two humans vote on running it twice', () => {
    const state = createInitialGameState('ODDS')
    addPlayer(state, 'alice', 0)
    addPlayer(state, 'bob', 1)
    let hand = startHand({ ...state, pacedRunout: true })
    hand = processAction(hand, hand.actingPlayerId!, 'all_in')
    hand = processAction(hand, hand.actingPlayerId!, 'call')
    expect(hand.runItTwice?.status).toBe('voting')
    expect(isBettingClosed(hand)).toBe(true)
    const view = toTableState(hand, 'alice')
    expect(view.players.find(player => player.id === 'bob')!.holeCards).toHaveLength(2)
  })
})

// Preflop Monte Carlo is the heavy case; give it room on a busy CI box.
describe('broadcast odds', { timeout: 30_000 }, () => {
  const aces = [c('A', 'spades'), c('A', 'hearts')]
  const kings = [c('K', 'spades'), c('K', 'hearts')]
  const pot = [{ amount: 2000, eligiblePlayerIds: ['aa', 'kk'] }]

  it('puts AA about 82% against KK preflop', () => {
    const odds = computeLiveHandOdds(
      [{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }],
      [],
      pot
    )!
    const aaWin = odds.win.get('aa')! * 100
    const kkWin = odds.win.get('kk')! * 100
    expect(aaWin).toBeGreaterThan(80)
    expect(aaWin).toBeLessThan(84)
    expect(kkWin).toBeGreaterThan(16)
    expect(kkWin).toBeLessThan(20)
    expect(odds.exact).toBe(false)
    // Win + tie shares always cover every runout.
    expect(odds.win.get('aa')! + odds.win.get('kk')! + odds.tie.get('aa')!).toBeCloseTo(1, 5)
  })

  it('is exact on the turn and resolves to 100 / 0 on the river', () => {
    const turn = [c('2', 'clubs'), c('7', 'diamonds'), c('9', 'clubs'), c('J', 'spades')]
    const turnOdds = computeLiveHandOdds(
      [{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }],
      turn,
      pot
    )!
    expect(turnOdds.exact).toBe(true)
    // KK needs one of the two remaining kings: 2 / 44.
    expect(turnOdds.win.get('kk')!).toBeCloseTo(2 / 44, 6)

    const river = [...turn, c('3', 'hearts')]
    const riverOdds = computeLiveHandOdds(
      [{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }],
      river,
      pot
    )!
    expect(riverOdds.win.get('aa')).toBe(1)
    expect(riverOdds.win.get('kk')).toBe(0)
  })

  it('reports a chopped board as a tie, not a win', () => {
    const board = [c('A', 'clubs'), c('K', 'clubs'), c('Q', 'clubs'), c('J', 'clubs'), c('T', 'clubs')]
    const odds = computeLiveHandOdds(
      [{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }],
      board,
      pot
    )!
    expect(odds.win.get('aa')).toBe(0)
    expect(odds.tie.get('aa')).toBe(1)
    expect(odds.tie.get('kk')).toBe(1)
  })

  it('computes each street once and serves every other viewer from the cache', () => {
    let state = pacedHeadsUp()
    state = processAction(state, state.actingPlayerId!, 'all_in')
    state = processAction(state, state.actingPlayerId!, 'call')

    const viewers = ['hero', 'bot_villain', 'spectator-1', 'spectator-2', 'spectator-3']
    const snapshots = viewers.map(viewer => withVisibleHandOdds(toTableState(state, viewer), { oddsMode: 'all_in' }))
    expect(getHandOddsComputationCount()).toBe(1)
    for (const snapshot of snapshots) {
      expect(snapshot.handOdds?.mode).toBe('all_in')
      expect(snapshot.handOdds?.players).toHaveLength(2)
      expect(snapshot.handOdds).toEqual(snapshots[0]!.handOdds)
    }

    state = advanceAllInRunout(state)
    withVisibleHandOdds(toTableState(state, 'hero'), { oddsMode: 'all_in' })
    withVisibleHandOdds(toTableState(state, 'spectator-1'), { oddsMode: 'all_in' })
    expect(getHandOddsComputationCount()).toBe(2)
  })

  it('never computes odds for a player who cannot see every live hand', () => {
    let state = pacedHeadsUp()
    state = processAction(state, state.actingPlayerId!, 'all_in')
    const view = withVisibleHandOdds(toTableState(state, 'hero'), { oddsMode: 'all_in' })
    expect(view.handOdds).toBeUndefined()
    expect(view.players.every(player => player.equityPercent === undefined)).toBe(true)
    expect(getHandOddsComputationCount()).toBe(0)
  })

  it('returns the same Monte Carlo figures on a cache miss (seeded, no jitter)', () => {
    const hands = [{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }]
    const first = computeLiveHandOdds(hands, [], pot)!
    clearHandOddsCache()
    const second = computeLiveHandOdds(hands, [], pot)!
    expect(second.win.get('aa')).toBe(first.win.get('aa'))
  })

  it('computes a preflop heads-up estimate quickly enough for the room', () => {
    const started = performance.now()
    computeLiveHandOdds([{ id: 'aa', holeCards: aces }, { id: 'kk', holeCards: kings }], [], pot)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(4_000)
  })
})
