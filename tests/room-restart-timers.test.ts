import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import {
  MockRoom,
  joinPlayer,
  seatPlayer,
  send,
  type RoomInternals,
} from './helpers/roomHarness'

/** A MockRoom whose storage survives the server instance (like a Durable Object's). */
function roomWithStorage(values: Map<string, unknown>) {
  const room = new MockRoom()
  ;(room as unknown as { storage: unknown }).storage = {
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
  }
  return room
}

function quietServer(room: MockRoom) {
  const server = new PokerRoom(room as unknown as Room)
  server.autoBeerRandom = () => 1
  const tunable = server as unknown as { botDrinkRandom?: () => number; botPeekRandom?: () => number }
  tunable.botDrinkRandom = () => 1
  tunable.botPeekRandom = () => 1
  return server
}

describe('server restart mid all-in runout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['vote', 'runout'] as const)('finishes the hand after a restart during the %s, with nobody needing to rejoin', async (stage) => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const firstRoom = roomWithStorage(storage)
    const first = quietServer(firstRoom)
    await first.onStart()
    const a = joinPlayer(first, firstRoom, 'c1', 'Ann')
    const b = joinPlayer(first, firstRoom, 'c2', 'Bob')
    seatPlayer(first, a.connection)
    seatPlayer(first, b.connection)
    send(first, a.connection, { type: 'start_game' })
    const byId = { [a.playerId]: a, [b.playerId]: b }
    const internals = first as unknown as RoomInternals
    send(first, byId[internals.data.gameState.actingPlayerId!]!.connection, { type: 'player_action', action: 'all_in' })
    send(first, byId[internals.data.gameState.actingPlayerId!]!.connection, { type: 'player_action', action: 'call' })
    expect(internals.data.gameState.runItTwice?.status).toBe('voting')
    if (stage === 'runout') {
      send(first, a.connection, { type: 'run_it_twice_vote', vote: 'no' })
      expect(internals.data.gameState.allInRunout).toBeTruthy()
    }
    const totalChips = internals.data.gameState.players.reduce((sum, p) => sum + p.stack + p.totalInPot, 0)
    expect(totalChips).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(350)
    expect(storage.size).toBe(1)
    // Freeze the first instance: it died with the restart.
    vi.clearAllTimers()

    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const restored = (second as unknown as RoomInternals).data.gameState
    expect(restored.phase).toBe('in_hand')
    if (stage === 'runout') expect(restored.allInRunout).toBeTruthy()
    else expect(restored.runItTwice?.status).toBe('voting')

    // No socket arrives; the runout must still finish on its own.
    await vi.advanceTimersByTimeAsync(30_000)
    const after = (second as unknown as RoomInternals).data.gameState
    expect(after.allInRunout).toBeFalsy()
    expect(after.runItTwice?.status).not.toBe('voting')
    expect(after.handNumber > restored.handNumber || after.phase !== 'in_hand').toBe(true)
    expect(after.phase).not.toBe('in_hand')
    expect(after.players.reduce((sum, p) => sum + p.stack, 0)).toBe(totalChips)
  })
})
