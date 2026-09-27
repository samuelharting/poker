import { describe, expect, it } from 'vitest'
import {
  createThreeTableViewModel,
  DEFAULT_THREE_PLAYER_DRINKS,
  toThreePlayerDrinks,
} from '@/components/three/tableViewModel'
import type { SeatPlayer, TableState } from '@/lib/poker/types'

function makePlayer(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'p1',
    nickname: 'Player',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

function makeTable(players: SeatPlayer[]): TableState {
  return {
    roomCode: 'BAR',
    phase: 'in_hand',
    serverNow: 1,
    round: 'preflop',
    players,
    communityCards: [],
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
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
  }
}

describe('3D view model drinks', () => {
  it('defaults every player to sober when the server sends no drink state', () => {
    const view = createThreeTableViewModel(makeTable([
      makePlayer({ id: 'hero', seatIndex: 0 }),
      makePlayer({ id: 'villain', seatIndex: 3 }),
    ]), 'hero')

    for (const player of view.players) {
      expect(player.drinks).toEqual({ level: 0, beers: 0, lastDrink: null, passedOut: false })
    }
    expect(DEFAULT_THREE_PLAYER_DRINKS).toEqual({ level: 0, beers: 0, lastDrink: null, passedOut: false })
  })

  it('maps drink state onto the 3D player view with exactly the contract fields', () => {
    const lastDrink = { kind: 'beer' as const, id: 'drink-7', at: 1234 }
    const view = createThreeTableViewModel(makeTable([
      makePlayer({ id: 'hero', seatIndex: 0 }),
      makePlayer({
        id: 'drunk',
        seatIndex: 2,
        drinks: { level: 7, beers: 8, waters: 1, lastDrink, passedOut: false, sobering: 1, shots: 0, shotReadyAtHand: 0, shotReceivableAtHand: 0, chaserUntil: 0 },
      }),
      makePlayer({
        id: 'asleep',
        seatIndex: 4,
        drinks: { level: 10, beers: 10, waters: 0, lastDrink: null, passedOut: true, sobering: 0, shots: 0, shotReadyAtHand: 0, shotReceivableAtHand: 0, chaserUntil: 0 },
      }),
    ]), 'hero')

    const drunk = view.players.find(player => player.id === 'drunk')
    expect(drunk?.drinks).toEqual({ level: 7, beers: 8, lastDrink, passedOut: false })
    expect(Object.keys(drunk?.drinks ?? {}).sort()).toEqual(['beers', 'lastDrink', 'level', 'passedOut'])
    expect(view.players.find(player => player.id === 'asleep')?.drinks.passedOut).toBe(true)
  })

  it('clamps malformed drink payloads', () => {
    expect(toThreePlayerDrinks({
      level: 42,
      beers: -1,
      waters: 0,
      lastDrink: { kind: 'beer', id: '', at: 1 },
      passedOut: false,
      sobering: 0,
      shots: 0,
      shotReadyAtHand: 0,
      shotReceivableAtHand: 0,
      chaserUntil: 0,
    })).toEqual({ level: 10, beers: 0, lastDrink: null, passedOut: false })
  })
})
