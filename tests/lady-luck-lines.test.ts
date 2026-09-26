import { describe, expect, it } from 'vitest'
import { countLadyLuckWords, describeLadyLuckChange, getLadyLuckMoodLine, LADY_LUCK_LINES } from '@/lib/ladyLuckLines'
import { createThreeTableViewModel } from '@/components/three/tableViewModel'
import type { LadyLuckCompanionState, TableState } from '@/lib/poker/types'

const names: Record<string, string> = { ann: 'Ann', bob: 'Bob' }
const nameOf = (id: string) => names[id] ?? 'Someone'

function companion(overrides: Partial<LadyLuckCompanionState> = {}): LadyLuckCompanionState {
  return { id: 'll-2-1', ownerId: 'ann', reason: 'streak', streak: 2, mood: 'arrive', since: 1, muted: false, ...overrides }
}

describe('Lady Luck toasts', () => {
  it('announces an arrival with the reason', () => {
    expect(describeLadyLuckChange(null, companion(), nameOf)?.text).toBe('💃 Lady Luck is all over Ann — 2 wins in a row!')
    expect(describeLadyLuckChange(null, companion({ streak: 3 }), nameOf, 'ann')?.text)
      .toBe('💃 Lady Luck is all over you — 3 wins in a row!')
  })

  it('announces a switch, a sulky exit, and ignores mood-only changes', () => {
    const switched = describeLadyLuckChange(companion(), companion({ id: 'll-3-2', ownerId: 'bob' }), nameOf)
    expect(switched?.kind).toBe('switch')
    expect(switched?.text).toContain('dumped Ann for Bob')
    const leave = describeLadyLuckChange(companion(), companion({ mood: 'sulk_leave' }), nameOf)
    expect(leave?.kind).toBe('leave')
    expect(describeLadyLuckChange(companion({ mood: 'sulk_leave' }), companion({ mood: 'sulk_leave' }), nameOf)).toBeNull()
    expect(describeLadyLuckChange(companion(), companion({ mood: 'cheer', streak: 3 }), nameOf)).toBeNull()
    expect(describeLadyLuckChange(companion({ mood: 'sulk_leave' }), null, nameOf)).toBeNull()
    // Telling her to shut up is not a table-wide event.
    expect(describeLadyLuckChange(companion({ mood: 'flirt' }), companion({ mood: 'flirt', muted: true }), nameOf)).toBeNull()
  })

  it('arrives fresh after a sulky exit rather than "dumping" anyone', () => {
    const next = describeLadyLuckChange(companion({ mood: 'sulk_leave' }), companion({ id: 'll-5-3', ownerId: 'bob' }), nameOf)
    expect(next?.kind).toBe('arrive')
  })

  it('keeps every line short (at most 5 words plus emoji)', () => {
    for (const pool of Object.values(LADY_LUCK_LINES)) {
      for (const line of pool) expect(countLadyLuckWords(line.replace('{name}', 'Nova'))).toBeLessThanOrEqual(5)
    }
  })

  it('picks mood lines from the matching pool', () => {
    expect(LADY_LUCK_LINES.arrive_big_win).toContain(getLadyLuckMoodLine(companion({ reason: 'big_win' })))
    expect(LADY_LUCK_LINES.cheer).toContain(getLadyLuckMoodLine(companion({ mood: 'cheer' })))
    expect(LADY_LUCK_LINES.flirt).toContain(getLadyLuckMoodLine(companion({ mood: 'flirt' })))
  })
})

describe('ThreeTableViewModel.companion', () => {
  const baseState = {
    roomCode: 'LUCK01', phase: 'between_hands', serverNow: 0, round: null, players: [], communityCards: [],
    pots: [], totalPot: 0, currentBet: 0, minRaise: 0, actingPlayerId: null, dealerSeatIndex: 0,
    smallBlind: 10, bigBlind: 20, startingStack: 1000, actionTimerStart: null, actionTimerDuration: 10000,
    rabbitHuntingEnabled: false, sevenTwoRuleEnabled: false, sevenTwoBountyPercent: 0, handNumber: 3,
    recentActions: [], lobbyPlayers: [],
  } as TableState

  it('passes the server companion through and defaults to null', () => {
    expect(createThreeTableViewModel(baseState, 'ann').companion).toBeNull()
    const view = createThreeTableViewModel({ ...baseState, companion: companion() }, 'ann')
    expect(view.companion).toEqual(companion())
  })
})
