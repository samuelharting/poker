import { describe, it, expect } from 'vitest'
import {
  calculateMinRaise,
  buildSidePots,
  isRoundComplete,
  countPlayersInHand,
  countActionablePlayers,
} from '@/lib/poker/betting'
import type { InternalPlayer } from '@/lib/poker/types'

function makePlayer(
  id: string,
  overrides: Partial<InternalPlayer> = {}
): InternalPlayer {
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
    holeCards: [],
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

describe('calculateMinRaise', () => {
  it('returns currentBet + bigBlind when no prior raise', () => {
    expect(calculateMinRaise(20, 20, 20)).toBe(40)
  })

  it('uses lastRaiseSize when larger than bigBlind', () => {
    // currentBet=60, lastRaise=40, bigBlind=20 → min = 60+40 = 100
    expect(calculateMinRaise(60, 40, 20)).toBe(100)
  })

  it('uses bigBlind when lastRaiseSize is smaller', () => {
    expect(calculateMinRaise(30, 10, 20)).toBe(50)
  })
})

describe('buildSidePots', () => {
  it('returns empty for no players', () => {
    expect(buildSidePots([])).toEqual([])
  })

  it('builds a single main pot with no all-ins', () => {
    const players = [
      makePlayer('p1', { totalInPot: 100, status: 'active' }),
      makePlayer('p2', { totalInPot: 100, status: 'active' }),
    ]
    const pots = buildSidePots(players)
    expect(pots).toHaveLength(1)
    expect(pots[0]!.amount).toBe(200)
    expect(pots[0]!.eligiblePlayerIds).toContain('p1')
    expect(pots[0]!.eligiblePlayerIds).toContain('p2')
  })

  it('creates side pot when one player is all-in for less', () => {
    const players = [
      makePlayer('p1', { totalInPot: 50, status: 'all_in', stack: 0 }),
      makePlayer('p2', { totalInPot: 100, status: 'active', stack: 900 }),
      makePlayer('p3', { totalInPot: 100, status: 'active', stack: 900 }),
    ]
    const pots = buildSidePots(players)
    expect(pots.length).toBeGreaterThanOrEqual(2)
    // Main pot: 50*3 = 150, all 3 eligible
    expect(pots[0]!.amount).toBe(150)
    expect(pots[0]!.eligiblePlayerIds).toHaveLength(3)
    // Side pot: 50*2 = 100, only p2 and p3
    expect(pots[1]!.amount).toBe(100)
    expect(pots[1]!.eligiblePlayerIds).toHaveLength(2)
    expect(pots[1]!.eligiblePlayerIds).not.toContain('p1')
  })

  it('excludes folded players from pot eligibility', () => {
    const players = [
      makePlayer('p1', { totalInPot: 50, status: 'folded' }),
      makePlayer('p2', { totalInPot: 100, status: 'active' }),
      makePlayer('p3', { totalInPot: 100, status: 'active' }),
    ]
    const pots = buildSidePots(players)
    for (const pot of pots) {
      expect(pot.eligiblePlayerIds).not.toContain('p1')
    }
  })
})

describe('isRoundComplete', () => {
  it('returns true when all active players have acted and matched bet', () => {
    const players = [
      makePlayer('p1', { bet: 20, hasActedThisRound: true, stack: 980 }),
      makePlayer('p2', { bet: 20, hasActedThisRound: true, stack: 980 }),
    ]
    expect(isRoundComplete(players, 20)).toBe(true)
  })

  it('returns false when a player has not acted', () => {
    const players = [
      makePlayer('p1', { bet: 20, hasActedThisRound: true, stack: 980 }),
      makePlayer('p2', { bet: 20, hasActedThisRound: false, stack: 980 }),
    ]
    expect(isRoundComplete(players, 20)).toBe(false)
  })

  it('returns false when a player has not matched the bet', () => {
    const players = [
      makePlayer('p1', { bet: 20, hasActedThisRound: true, stack: 980 }),
      makePlayer('p2', { bet: 10, hasActedThisRound: true, stack: 990 }),
    ]
    expect(isRoundComplete(players, 20)).toBe(false)
  })

  it('returns true with no active players', () => {
    expect(isRoundComplete([], 20)).toBe(true)
  })
})

describe('countPlayersInHand', () => {
  it('counts active and all-in players', () => {
    const players = [
      makePlayer('p1', { status: 'active' }),
      makePlayer('p2', { status: 'all_in' }),
      makePlayer('p3', { status: 'folded' }),
      makePlayer('p4', { status: 'sitting_out' }),
    ]
    expect(countPlayersInHand(players)).toBe(2)
  })
})

describe('countActionablePlayers', () => {
  it('counts active players with chips', () => {
    const players = [
      makePlayer('p1', { status: 'active', stack: 500 }),
      makePlayer('p2', { status: 'active', stack: 0 }),
      makePlayer('p3', { status: 'all_in', stack: 0 }),
    ]
    expect(countActionablePlayers(players)).toBe(1)
  })
})
