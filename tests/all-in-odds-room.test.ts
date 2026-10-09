import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import { clearHandOddsCache, getHandOddsComputationCount } from '@/lib/poker/odds'
import type { TableState } from '@/lib/poker/types'
import {
  createHarness,
  joinPlayer,
  lastMessage,
  seatPlayer,
  send,
  type RoomInternals,
} from './helpers/roomHarness'

function snapshot(connection: Connection): TableState {
  return lastMessage(connection, 'room_snapshot')!.state
}

function setupRoom() {
  const { room, server, internals } = createHarness()
  const sam = joinPlayer(server, room, 'c-sam', 'Sam')
  seatPlayer(server, sam.connection, 0)
  const alex = joinPlayer(server, room, 'c-alex', 'Alex')
  seatPlayer(server, alex.connection, 1)
  const rail = joinPlayer(server, room, 'c-rail', 'Rail')
  send(server, sam.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })
  const byId: Record<string, { connection: Connection; playerId: string }> = {
    [sam.playerId]: sam,
    [alex.playerId]: alex,
  }
  return { server, internals: internals as RoomInternals, sam, alex, rail, byId }
}

function act(
  setup: ReturnType<typeof setupRoom>,
  action: 'all_in' | 'call' | 'check' | 'fold'
) {
  const actorId = setup.internals.data.gameState.actingPlayerId!
  send(setup.server, setup.byId[actorId]!.connection, { type: 'player_action', action })
  return actorId
}

beforeEach(() => {
  vi.useFakeTimers()
  clearHandOddsCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('broadcast all-in odds in the room', { timeout: 30_000 }, () => {
  it('shows nothing to players or the rail before action closes, then tables hands and odds for everyone street by street', () => {
    const setup = setupRoom()
    const { server, sam, alex, rail } = setup
    send(server, sam.connection, { type: 'start_game' })
    expect(setup.internals.data.gameState.phase).toBe('in_hand')

    // The spectator is never dealt in.
    expect(setup.internals.data.gameState.players.map(player => player.id)).not.toContain(rail.playerId)

    // The rail watches with every hand and the odds visible.
    const railBefore = snapshot(rail.connection)
    expect(railBefore.handOdds?.mode).toBe('spectator')
    expect(railBefore.players.every(player => player.holeCards?.length === 2)).toBe(true)

    const shoverId = act(setup, 'all_in')
    const callerId = shoverId === sam.playerId ? alex.playerId : sam.playerId
    const shover = setup.byId[shoverId]!
    const caller = setup.byId[callerId]!

    // Action is still open: no odds and no opposing cards for either player.
    const railMid = snapshot(rail.connection)
    expect(railMid.handOdds?.mode).toBe('spectator')
    expect(railMid.players.every(player => player.holeCards?.length === 2)).toBe(true)
    for (const viewer of [shover, caller]) {
      const view = snapshot(viewer.connection)
      expect(view.handOdds).toBeUndefined()
      const opponent = view.players.find(player => player.id !== viewer.playerId)!
      expect(opponent.holeCards).toBeUndefined()
      expect(opponent.equityPercent).toBeUndefined()
      expect(view.players.find(player => player.id === viewer.playerId)!.equityPercent).toBeUndefined()
    }

    act(setup, 'call')
    // Two humans heads-up: the run-it-twice vote opens with the hands tabled.
    expect(setup.internals.data.gameState.runItTwice?.status).toBe('voting')
    for (const viewer of [shover, caller, rail]) {
      const view = snapshot(viewer.connection)
      expect(view.handOdds?.mode).toBe('all_in')
      expect(view.handOdds?.boardCount).toBe(0)
      expect(view.players.every(player => player.holeCards?.length === 2)).toBe(true)
    }

    send(server, shover.connection, { type: 'run_it_twice_vote', vote: 'no' })
    expect(setup.internals.data.gameState.phase).toBe('in_hand')
    expect(setup.internals.data.gameState.allInRunout).toBeDefined()

    const seenBoards: number[] = []
    const computationsBefore = getHandOddsComputationCount()
    let river: TableState | null = null
    for (let step = 0; step < 100 && setup.internals.data.gameState.phase === 'in_hand'; step += 1) {
      vi.advanceTimersByTime(100)
      const view = snapshot(caller.connection)
      if (view.phase !== 'in_hand') break
      const boardCount = view.handOdds?.boardCount
      expect(boardCount).toBe(view.communityCards.length)
      if (seenBoards[seenBoards.length - 1] !== boardCount) seenBoards.push(boardCount!)
      if (boardCount === 5) river = view
      // Everybody sees the same odds.
      expect(snapshot(shover.connection).handOdds).toEqual(view.handOdds)
      expect(snapshot(rail.connection).handOdds).toEqual(view.handOdds)
    }
    expect(seenBoards).toEqual([0, 3, 4, 5])
    // One computation per street, however many viewers and snapshots.
    expect(getHandOddsComputationCount() - computationsBefore).toBeLessThanOrEqual(3)

    // River: resolved to 100 / 0 (or a clean split).
    const riverOdds = river!.handOdds!.players
    const total = riverOdds.reduce((sum, player) => sum + player.winPercent + player.tiePercent / 2, 0)
    expect(total).toBeCloseTo(100, 5)
    expect(riverOdds.every(player => [0, 100].includes(player.winPercent))).toBe(true)

    expect(setup.internals.data.gameState.phase).toBe('between_hands')
    expect(snapshot(rail.connection).handOdds).toBeUndefined()
  })

  it('never gives a seated player live odds or opposing cards during a normal hand; the rail sees all', () => {
    const setup = setupRoom()
    send(setup.server, setup.sam.connection, { type: 'start_game' })
    for (let guard = 0; guard < 12 && setup.internals.data.gameState.phase === 'in_hand'; guard += 1) {
      for (const viewer of [setup.sam, setup.alex]) {
        const view = snapshot(viewer.connection)
        expect(view.handOdds).toBeUndefined()
        expect(view.players.find(player => player.id !== viewer.playerId)!.holeCards).toBeUndefined()
      }
      const railView = snapshot(setup.rail.connection)
      expect(railView.handOdds?.mode).toBe('spectator')
      expect(railView.players.every(player => player.holeCards?.length === 2)).toBe(true)
      const actor = setup.internals.data.gameState.players.find(player => player.id === setup.internals.data.gameState.actingPlayerId)!
      act(setup, actor.bet >= setup.internals.data.gameState.currentBet ? 'check' : 'call')
    }
    expect(setup.internals.data.gameState.phase).toBe('between_hands')
  })
})
