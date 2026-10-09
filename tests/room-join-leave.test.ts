import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'partykit/server'
import PokerRoom, { HOST_DISCONNECT_GRACE_MS } from '@/partykit/room'
import {
  MockRoom,
  createHarness,
  disconnect,
  joinPlayer,
  lastMessage,
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

describe('joining and leaving the table', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the host to a returning guest when the host never comes back after a restart', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const firstRoom = roomWithStorage(storage)
    const first = quietServer(firstRoom)
    await first.onStart()
    const host = joinPlayer(first, firstRoom, 'c1', 'Host')
    const guest = joinPlayer(first, firstRoom, 'c2', 'Guest')
    seatPlayer(first, host.connection)
    seatPlayer(first, guest.connection)
    await vi.advanceTimersByTimeAsync(1_000)

    // Deploy: every socket dies. Only the guest's browser comes back.
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const back = joinPlayer(second, secondRoom, 'c9', 'Guest', guest.reconnectToken)
    expect(back.playerId).toBe(guest.playerId)
    const internals = second as unknown as RoomInternals
    // The host seat is held for a grace period, like any host who drops.
    expect(internals.data.hostId).toBe(host.playerId)

    await vi.advanceTimersByTimeAsync(HOST_DISCONNECT_GRACE_MS + 1_000)
    expect(internals.data.hostId).toBe(guest.playerId)
    expect(lastMessage(back.connection, 'private_session')?.isHost).toBe(true)
  })

  it('keeps the host when the host comes back within the grace period after a restart', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const firstRoom = roomWithStorage(storage)
    const first = quietServer(firstRoom)
    await first.onStart()
    const host = joinPlayer(first, firstRoom, 'c1', 'Host')
    const guest = joinPlayer(first, firstRoom, 'c2', 'Guest')
    seatPlayer(first, host.connection)
    seatPlayer(first, guest.connection)
    await vi.advanceTimersByTimeAsync(1_000)

    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    joinPlayer(second, secondRoom, 'c9', 'Guest', guest.reconnectToken)
    await vi.advanceTimersByTimeAsync(HOST_DISCONNECT_GRACE_MS / 2)
    const hostBack = joinPlayer(second, secondRoom, 'c10', 'Host', host.reconnectToken)
    await vi.advanceTimersByTimeAsync(HOST_DISCONNECT_GRACE_MS * 2)
    expect((second as unknown as RoomInternals).data.hostId).toBe(host.playerId)
    expect(lastMessage(hostBack.connection, 'private_session')?.isHost).toBe(true)
  })

  it('does not hand a seat to a different nickname that carries another player reconnect token', () => {
    // Two tabs of one browser share one stored token: the second nickname must
    // be its own player, not a takeover of the first tab's seat.
    const { room, server, internals } = createHarness()
    const alice = joinPlayer(server, room, 'c1', 'Alice')
    seatPlayer(server, alice.connection)
    const bob = joinPlayer(server, room, 'c2', 'Bob', alice.reconnectToken)
    seatPlayer(server, bob.connection)

    expect(bob.playerId).not.toBe(alice.playerId)
    expect(bob.reconnectToken).not.toBe(alice.reconnectToken)
    expect(internals.data.playerToConnection[alice.playerId]).toBe('c1')
    expect(internals.data.playerToConnection[bob.playerId]).toBe('c2')
    expect(lastMessage(alice.connection, 'session_ended')).toBeUndefined()
    expect(internals.data.gameState.players.map(player => player.nickname).sort()).toEqual(['Alice', 'Bob'])
  })

  it('still resumes the same player when the token comes with their own nickname, in any case or spacing', () => {
    const { room, server, internals } = createHarness()
    const alice = joinPlayer(server, room, 'c1', 'Alice')
    seatPlayer(server, alice.connection)
    disconnect(server, room, alice.connection)
    const back = joinPlayer(server, room, 'c2', '  alice ', alice.reconnectToken)
    expect(back.playerId).toBe(alice.playerId)
    expect(internals.data.gameState.players).toHaveLength(1)
  })
})
