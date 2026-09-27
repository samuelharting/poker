import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import {
  MockRoom,
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

describe('table survives a server restart', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores seats, stacks and the hand, and re-seats players by their reconnect token', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const firstRoom = roomWithStorage(storage)
    const first = quietServer(firstRoom)
    await first.onStart()
    const host = joinPlayer(first, firstRoom, 'c1', 'Host')
    const guest = joinPlayer(first, firstRoom, 'c2', 'Guest')
    seatPlayer(first, host.connection)
    seatPlayer(first, guest.connection)
    send(first, host.connection, { type: 'start_game' })
    const before = (first as unknown as RoomInternals).data.gameState
    expect(before.phase).toBe('in_hand')
    const stacksBefore = before.players.map(player => [player.id, player.stack, player.bet])
    // The debounced save lands.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(storage.size).toBe(1)

    // The room restarts: a new instance, every socket gone.
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const restored = (second as unknown as RoomInternals).data.gameState
    expect(restored.phase).toBe('in_hand')
    expect(restored.handNumber).toBe(before.handNumber)
    expect(restored.players.map(player => [player.id, player.stack, player.bet])).toEqual(stacksBefore)

    const back = joinPlayer(second, secondRoom, 'c9', 'Host', host.reconnectToken)
    expect(back.playerId).toBe(host.playerId)
    const snapshot = lastMessage(back.connection, 'room_snapshot')
    expect(snapshot?.state.viewerId).toBe(host.playerId)
    const me = snapshot?.state.players.find(player => player.id === host.playerId)
    expect(me?.holeCards?.length).toBe(2)
    expect(lastMessage(back.connection, 'private_session')?.isHost).toBe(true)
  })

  it('starts fresh when nothing was saved', async () => {
    const room = roomWithStorage(new Map())
    const server = quietServer(room)
    await server.onStart()
    expect((server as unknown as RoomInternals).data.gameState.players).toEqual([])
  })

  it('snapshots name their viewer, and are anonymous before a join', () => {
    const room = roomWithStorage(new Map())
    const server = quietServer(room)
    const host = joinPlayer(server, room, 'c1', 'Host')
    expect(lastMessage(host.connection, 'room_snapshot')?.state.viewerId).toBe(host.playerId)
    const watcher = room.addConnection('c2')
    server.onConnect(watcher)
    expect(lastMessage(watcher, 'room_snapshot')?.state.viewerId).toBe('')
  })
})
