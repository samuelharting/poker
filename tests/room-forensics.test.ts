import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import { AUTO_FOLD_GRACE_MS } from '@/partykit/room'
import { describeHandOutcome } from '@/lib/poker/handHistory'
import { getTurnTimeoutWarning } from '@/lib/poker/turnGuidance'
import type { HandHistoryEntry, InternalGameState } from '@/lib/poker/types'
import type { LedgerSnapshot } from '@/lib/poker/ledger'
import { actingPlayer, createHarness, disconnect, joinPlayer, lastMessage, send } from './helpers/roomHarness'

/**
 * Disputes: the hand history records how every dealt-in player's hand ended
 * (won / lost at showdown / folded by choice, timed out, left, kicked, moved
 * to the rail) and on which street. Plus the host actions that used to fold
 * or lose chips.
 */

interface Internals {
  data: {
    gameState: InternalGameState
    handHistory: HandHistoryEntry[]
    spectatorStacks: Record<string, number>
  }
  autoFoldDeadline: number | null
  buildLedgerSnapshot: () => LedgerSnapshot
}

function setup(names: string[]) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T20:00:00.000Z'))
  const { room, server } = createHarness()
  const internals = server as unknown as Internals
  const players = names.map((name, index) => {
    const joined = joinPlayer(server, room, `conn-${name}`, name)
    send(server, joined.connection, { type: 'seat_me', seatIndex: index })
    return { name, ...joined }
  })
  const byId = new Map<string, Connection>(players.map(player => [player.playerId, player.connection]))
  send(server, players[0]!.connection, { type: 'start_game' })
  return { room, server, internals, players, byId }
}

function act(setupResult: ReturnType<typeof setup>, action: 'fold' | 'check' | 'call' | 'raise' | 'all_in', amount?: number) {
  const actor = actingPlayer(setupResult.internals as never)
  if (!actor) throw new Error('nobody to act')
  send(setupResult.server, setupResult.byId.get(actor.id)!, { type: 'player_action', action, amount })
  return actor
}

function timeOut(setupResult: ReturnType<typeof setup>) {
  const actor = actingPlayer(setupResult.internals as never)!
  vi.advanceTimersByTime(setupResult.internals.autoFoldDeadline! + AUTO_FOLD_GRACE_MS - Date.now() + 5)
  return actor
}

afterEach(() => {
  vi.useRealTimers()
})

describe('hand outcomes in the hand history', () => {
  it('records a timeout fold, a free-check timeout, and the winner, with streets', () => {
    const table = setup(['Ann', 'Ben', 'Cat'])
    const { internals } = table
    const handNumber = internals.data.gameState.handNumber

    // Preflop: everyone calls / checks around.
    act(table, 'call')
    act(table, 'call')
    act(table, 'check')
    expect(internals.data.gameState.round).toBe('flop')
    // Flop: first player times out with a free check (checked, not folded).
    const checker = timeOut(table)
    expect(internals.data.gameState.players.find(player => player.id === checker.id)?.status).toBe('active')
    // Next bets, the third times out facing it (folded), the checker folds by choice.
    act(table, 'raise', 40)
    const timedOut = timeOut(table)
    expect(internals.data.gameState.players.find(player => player.id === timedOut.id)?.status).toBe('folded')
    const folder = act(table, 'fold')
    expect(folder.id).toBe(checker.id)

    const entry = internals.data.handHistory.find(candidate => candidate.handNumber === handNumber)!
    expect(entry.endedBy).toBe('fold')
    const outcomes = new Map(entry.outcomes!.map(outcome => [outcome.playerId, outcome]))
    expect(outcomes.get(timedOut.id)).toMatchObject({ result: 'folded', reason: 'timeout', street: 'flop', stake: 20 })
    expect(outcomes.get(checker.id)).toMatchObject({ result: 'folded', reason: 'fold', street: 'flop', timedOutChecks: 1 })
    const winnerId = entry.winners[0]!.playerId
    expect(outcomes.get(winnerId)).toMatchObject({ result: 'won', via: 'uncontested', amount: 100, stake: 60 })
    expect(describeHandOutcome(outcomes.get(timedOut.id)!)).toBe('timed out on the flop')
    expect(describeHandOutcome(outcomes.get(checker.id)!)).toBe('folded on the flop (clock ran out 1x, checked)')
  })

  it('records a player who left mid-hand and a disconnected timeout', () => {
    const table = setup(['Ann', 'Ben', 'Cat', 'Dan'])
    const { internals, server, room, players } = table
    const handNumber = internals.data.gameState.handNumber
    const actor = actingPlayer(internals as never)!
    const leaver = players.find(player => player.playerId !== actor.id && player.playerId !== internals.data.gameState.players.find(p => p.isBB)?.id)!
    // A player who is not on turn walks out.
    send(server, leaver.connection, { type: 'leave_room' })
    disconnect(server, room, leaver.connection)
    // The acting player's connection drops and their clock runs out facing the big blind.
    const actorConn = table.byId.get(actor.id)!
    disconnect(server, room, actorConn)
    timeOut(table)
    // Everyone else folds to the big blind.
    while (internals.data.gameState.phase === 'in_hand') act(table, 'fold')

    const entry = internals.data.handHistory.find(candidate => candidate.handNumber === handNumber)!
    const outcomes = new Map(entry.outcomes!.map(outcome => [outcome.playerId, outcome]))
    expect(outcomes.get(leaver.playerId)).toMatchObject({ result: 'folded', reason: 'left', street: 'preflop' })
    expect(outcomes.get(actor.id)).toMatchObject({ result: 'folded', reason: 'timeout', street: 'preflop', disconnected: true })
    expect(describeHandOutcome(outcomes.get(actor.id)!)).toBe('timed out preflop (disconnected)')
  })

  it('records losers at showdown with the hand they showed', () => {
    const table = setup(['Ann', 'Ben'])
    const { internals } = table
    const handNumber = internals.data.gameState.handNumber
    act(table, 'call')
    act(table, 'check')
    for (let street = 0; street < 3; street += 1) {
      act(table, 'check')
      act(table, 'check')
    }
    const entry = internals.data.handHistory.find(candidate => candidate.handNumber === handNumber)!
    expect(entry.endedBy).toBe('showdown')
    for (const outcome of entry.outcomes!) {
      expect(outcome.via).toBe('showdown')
      expect(outcome.handDescription).toBeTruthy()
      expect(['won', 'lost']).toContain(outcome.result)
    }
  })
})

describe('host actions mid-hand', () => {
  it('removing every chip from the player on turn facing a bet puts them all-in, never folds them', () => {
    const table = setup(['Ann', 'Ben', 'Cat'])
    const { internals, server, players } = table
    const host = players[0]!
    const actor = actingPlayer(internals as never)!
    expect(actor.bet).toBeLessThan(internals.data.gameState.currentBet)
    send(server, host.connection, { type: 'adjust_player_stack', targetId: actor.id, amount: -100_000 })
    const after = internals.data.gameState.players.find(player => player.id === actor.id)!
    expect(after.status).toBe('all_in')
    expect(after.stack).toBe(0)
  })

  it('moving a player who already left to the rail keeps their chips on the books', () => {
    const table = setup(['Ann', 'Ben', 'Cat'])
    const { internals, server, room, players } = table
    const host = players[0]!
    const leaver = players[2]!
    send(server, leaver.connection, { type: 'leave_room' })
    disconnect(server, room, leaver.connection)
    send(server, host.connection, { type: 'set_player_spectator', targetId: leaver.playerId, spectator: true })
    expect(lastMessage(host.connection, 'action_failed')?.message).toBe('That player already left the table')
    // Finish the hand: the chips must still balance.
    while (internals.data.gameState.phase === 'in_hand') act(table, 'fold')
    const ledger = internals.buildLedgerSnapshot()
    expect(ledger.totalChips).toBe(ledger.totalBoughtIn)
    expect(internals.data.spectatorStacks[leaver.playerId]).toBeUndefined()
  })
})

describe('turn clock warning', () => {
  it('warns what the clock will do in the last five seconds only', () => {
    expect(getTurnTimeoutWarning(6, 20)).toBeNull()
    expect(getTurnTimeoutWarning(5, 20)).toBe('Auto-fold in 5s')
    expect(getTurnTimeoutWarning(2, 0)).toBe('Auto-check in 2s')
  })
})
