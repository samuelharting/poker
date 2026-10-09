import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'partykit/server'
import PokerRoom, { STATE_VERSION } from '@/partykit/room'
import {
  MockRoom,
  joinPlayer,
  lastMessage,
  messagesOf,
  seatPlayer,
  send,
} from './helpers/roomHarness'

/** Host-only manual reset, and versioned saves. */

vi.setConfig({ testTimeout: 60_000 })

const STORAGE_KEY = 'room-data-v1'

interface Internals {
  data: {
    gameState: {
      phase: string
      handNumber: number
      players: Array<{ id: string; bet: number }>
      actingPlayerId: string | null
      currentBet: number
    }
    hostId: string | null
    playerNicknames: Record<string, string>
    reconnectTokens: Record<string, string>
    spectatorIds: Record<string, true>
    ledger: { accounts: Record<string, unknown>; events: unknown[] }
    handHistory: unknown[]
    humansPresent?: boolean
    stateVersion?: number
  }
}

const internalsOf = (server: PokerRoom) => server as unknown as Internals

function roomWithStorage(values: Map<string, unknown>) {
  const room = new MockRoom()
  ;(room as unknown as { env: unknown }).env = {}
  ;(room as unknown as { storage: unknown }).storage = {
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    delete: vi.fn(async (key: string) => values.delete(key)),
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

/** Host and a guest connected and seated, two bots, a hand dealt. */
async function liveTable(storage = new Map<string, unknown>()) {
  const room = roomWithStorage(storage)
  const server = quietServer(room)
  await server.onStart()
  const host = joinPlayer(server, room, 'c-host', 'Host')
  const guest = joinPlayer(server, room, 'c-guest', 'Guest')
  seatPlayer(server, host.connection)
  seatPlayer(server, guest.connection)
  send(server, host.connection, { type: 'add_bots', count: 2 })
  send(server, host.connection, { type: 'start_game' })
  return { storage, room, server, host, guest, internals: internalsOf(server) }
}

describe('host-only reset_table', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refuses a reset from anyone but the host and leaves the table alone', async () => {
    vi.useFakeTimers()
    const { server, guest, internals } = await liveTable()
    const hand = internals.data.gameState.handNumber
    expect(hand).toBeGreaterThan(0)

    send(server, guest.connection, { type: 'reset_table' })

    expect(lastMessage(guest.connection, 'action_failed')?.message).toMatch(/Only the game creator/)
    expect(internals.data.gameState.handNumber).toBe(hand)
    expect(internals.data.gameState.players.length).toBe(4)
    expect(internals.data.playerNicknames[guest.playerId]).toBe('Guest')
  })

  it('refuses a reset from a socket that never joined', async () => {
    vi.useFakeTimers()
    const { server, room, internals } = await liveTable()
    const lurker = room.addConnection('c-lurker')
    server.onConnect(lurker)
    send(server, lurker, { type: 'reset_table' })
    expect(lastMessage(lurker, 'action_failed')).toBeTruthy()
    expect(internals.data.gameState.players.length).toBe(4)
  })

  it('lets the host reset with humans connected, and puts everyone back in the lobby', async () => {
    vi.useFakeTimers()
    const { server, host, guest, internals } = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(internals.data.gameState.phase).toBe('in_hand')

    send(server, host.connection, { type: 'reset_table' })

    const data = internals.data
    expect(data.gameState.players).toEqual([])
    expect(data.gameState.handNumber).toBe(0)
    expect(data.gameState.phase).not.toBe('in_hand')
    expect(data.handHistory).toEqual([])
    expect(data.ledger.events).toEqual([])
    expect(data.spectatorIds).toEqual({})
    expect(data.stateVersion).toBe(STATE_VERSION)
    expect(data.humansPresent).toBe(true)

    // Both people are still known by name, with new identities; the host stays host.
    const names = Object.values(data.playerNicknames).sort()
    expect(names).toEqual(['Guest', 'Host'])
    const hostSession = lastMessage(host.connection, 'private_session')
    const guestSession = lastMessage(guest.connection, 'private_session')
    expect(hostSession?.isHost).toBe(true)
    expect(guestSession?.isHost).toBe(false)
    expect(data.hostId).toBe(hostSession?.yourId)
    expect(data.playerNicknames[hostSession!.yourId]).toBe('Host')
    expect(data.playerNicknames[guestSession!.yourId]).toBe('Guest')
    expect(hostSession?.yourId).not.toBe(host.playerId)
    expect(data.reconnectTokens[guestSession!.yourId]).toBe(guestSession?.reconnectToken)

    // Each connected client got the fresh table as a lobby player.
    for (const person of [host, guest]) {
      const snapshot = lastMessage(person.connection, 'room_snapshot')
      expect(snapshot?.state.players).toEqual([])
      expect(snapshot?.state.handNumber).toBe(0)
      expect(snapshot?.state.lobbyPlayers.map(player => player.nickname).sort()).toEqual(['Guest', 'Host'])
      expect(snapshot?.state.lobbyPlayers.every(player => !player.isSeated)).toBe(true)
    }
    expect(lastMessage(guest.connection, 'room_snapshot')?.state.viewerId).toBe(guestSession?.yourId)
  })

  it('leaves no stray timers, and a fresh table with people connected stays put', async () => {
    vi.useFakeTimers()
    const { server, host, internals } = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    send(server, host.connection, { type: 'reset_table' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(Object.keys(internals.data.playerNicknames).length).toBe(2)
    expect(internals.data.gameState.handNumber).toBe(0)
  })

  it('replaces the saved copy of the old table with the fresh one', async () => {
    vi.useFakeTimers()
    const { server, host, storage } = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    const before = JSON.parse(storage.get(STORAGE_KEY) as string)
    expect(before.gameState.players.length).toBe(4)

    send(server, host.connection, { type: 'reset_table' })
    await vi.advanceTimersByTimeAsync(2_000)

    const after = JSON.parse(storage.get(STORAGE_KEY) as string)
    expect(after.gameState.players).toEqual([])
    expect(after.stateVersion).toBe(STATE_VERSION)
  })

  it('lets the re-admitted people sit again and play a normal hand', async () => {
    vi.useFakeTimers()
    const { server, host, guest, internals } = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    send(server, host.connection, { type: 'reset_table' })

    seatPlayer(server, host.connection)
    seatPlayer(server, guest.connection)
    send(server, host.connection, { type: 'add_bots', count: 1 })
    send(server, host.connection, { type: 'start_game' })
    expect(internals.data.gameState.phase).toBe('in_hand')
    expect(internals.data.gameState.players.length).toBe(3)

    const hostId = lastMessage(host.connection, 'private_session')!.yourId
    const guestId = lastMessage(guest.connection, 'private_session')!.yourId
    for (let i = 0; i < 200 && internals.data.gameState.handNumber < 2; i += 1) {
      const state = internals.data.gameState
      if (state.phase === 'in_hand') {
        for (const [conn, id] of [[host.connection, hostId], [guest.connection, guestId]] as const) {
          if (state.actingPlayerId === id) {
            const me = state.players.find(player => player.id === id)!
            send(server, conn, { type: 'player_action', action: me.bet >= state.currentBet ? 'check' : 'call' })
          }
        }
      }
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(internals.data.gameState.handNumber).toBeGreaterThanOrEqual(2)
    expect(messagesOf(host.connection).some(message => message.type === 'action_failed')).toBe(false)
  })

  it('a watcher who never joined stays connected and sees the fresh table', async () => {
    vi.useFakeTimers()
    const { server, room, host } = await liveTable()
    const watcher = room.addConnection('c-watch')
    server.onConnect(watcher)
    send(server, host.connection, { type: 'reset_table' })
    const snapshot = lastMessage(watcher, 'room_snapshot')
    expect(snapshot?.state.players).toEqual([])
    expect(snapshot?.state.viewerId).toBe('')
  })
})

describe('versioned saves', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the version with every save', async () => {
    vi.useFakeTimers()
    const { storage } = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(JSON.parse(storage.get(STORAGE_KEY) as string).stateVersion).toBe(STATE_VERSION)
  })

  it('restores a save of the current version', async () => {
    vi.useFakeTimers()
    const first = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    const second = quietServer(roomWithStorage(first.storage))
    await second.onStart()
    expect(internalsOf(second).data.gameState.players.length).toBe(4)
  })

  it.each([
    ['no version', (saved: Record<string, unknown>) => { delete saved.stateVersion }],
    ['an older version', (saved: Record<string, unknown>) => { saved.stateVersion = STATE_VERSION - 1 }],
    ['a newer version', (saved: Record<string, unknown>) => { saved.stateVersion = STATE_VERSION + 1 }],
  ])('discards a save with %s, starts fresh and deletes the stored copy', async (_label, mutate) => {
    vi.useFakeTimers()
    const first = await liveTable()
    await vi.advanceTimersByTimeAsync(2_000)
    const saved = JSON.parse(first.storage.get(STORAGE_KEY) as string)
    mutate(saved)
    first.storage.set(STORAGE_KEY, JSON.stringify(saved))
    vi.clearAllTimers()

    const second = quietServer(roomWithStorage(first.storage))
    await second.onStart()
    const data = internalsOf(second).data
    expect(data.gameState.players).toEqual([])
    expect(data.gameState.handNumber).toBe(0)
    expect(data.hostId).toBeNull()
    expect(data.playerNicknames).toEqual({})
    expect(first.storage.has(STORAGE_KEY)).toBe(false)
    expect(data.stateVersion).toBe(STATE_VERSION)
  })
})
