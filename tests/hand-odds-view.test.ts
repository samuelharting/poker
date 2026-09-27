import { describe, expect, it } from 'vitest'
import { formatOddsPercent, getHandOddsView } from '@/lib/poker/handOddsView'
import type { HandOddsSnapshot, SeatPlayer } from '@/lib/poker/types'

function seat(id: string, seatIndex: number, status: SeatPlayer['status'] = 'all_in'): SeatPlayer {
  return {
    id,
    nickname: id,
    stack: 0,
    bet: 0,
    totalInPot: 500,
    status,
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'both',
    isConnected: true,
    seatIndex,
    hasActedThisRound: true,
  }
}

function odds(players: HandOddsSnapshot['players'], extra: Partial<HandOddsSnapshot> = {}): HandOddsSnapshot {
  return { mode: 'all_in', handNumber: 3, boardCount: 3, exact: true, players, ...extra }
}

describe('getHandOddsView', () => {
  it('orders rows by seat and marks the leader and dead hands', () => {
    const view = getHandOddsView({
      phase: 'in_hand',
      handNumber: 3,
      players: [seat('sam', 4), seat('alex', 1), seat('kim', 2)],
      handOdds: odds([
        { playerId: 'sam', winPercent: 72, tiePercent: 0 },
        { playerId: 'alex', winPercent: 28, tiePercent: 0 },
        { playerId: 'kim', winPercent: 0, tiePercent: 0 },
      ]),
    })!
    expect(view.players.map(row => row.playerId)).toEqual(['alex', 'kim', 'sam'])
    expect(view.byPlayer.get('sam')!.isLeader).toBe(true)
    expect(view.byPlayer.get('alex')!.isLeader).toBe(false)
    expect(view.byPlayer.get('kim')!.isDrawingDead).toBe(true)
    expect(view.street).toBe('Flop')
    expect(view.showTies).toBe(false)
  })

  it('shows nothing between hands, for a stale hand, or once only one live hand is left', () => {
    const base = {
      handNumber: 3,
      players: [seat('sam', 0), seat('alex', 1)],
      handOdds: odds([
        { playerId: 'sam', winPercent: 60, tiePercent: 2 },
        { playerId: 'alex', winPercent: 38, tiePercent: 2 },
      ]),
    }
    expect(getHandOddsView({ ...base, phase: 'between_hands' })).toBeNull()
    expect(getHandOddsView({ ...base, phase: 'in_hand', handNumber: 4 })).toBeNull()
    expect(getHandOddsView({ ...base, phase: 'in_hand', handOdds: undefined })).toBeNull()
    expect(getHandOddsView({
      ...base,
      phase: 'in_hand',
      players: [seat('sam', 0), seat('alex', 1, 'folded')],
    })).toBeNull()
    expect(getHandOddsView({ ...base, phase: 'in_hand' })!.showTies).toBe(true)
  })

  it('leads with the split when nobody can win outright', () => {
    const view = getHandOddsView({
      phase: 'in_hand',
      handNumber: 3,
      players: [seat('sam', 0), seat('alex', 1)],
      handOdds: odds([
        { playerId: 'sam', winPercent: 0, tiePercent: 100 },
        { playerId: 'alex', winPercent: 0, tiePercent: 100 },
      ], { boardCount: 5 }),
    })!
    expect(view.street).toBe('River')
    expect(view.players.every(row => row.isLeader && !row.isDrawingDead)).toBe(true)
  })
})

describe('formatOddsPercent', () => {
  it('rounds for the broadcast and never shows a live long shot as dead or locked', () => {
    expect(formatOddsPercent(72.4)).toBe('72%')
    expect(formatOddsPercent(0)).toBe('0%')
    expect(formatOddsPercent(0.4)).toBe('<1%')
    expect(formatOddsPercent(99.6)).toBe('>99%')
    expect(formatOddsPercent(100)).toBe('100%')
  })
})
