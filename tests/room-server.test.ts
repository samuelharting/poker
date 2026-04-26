import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom, { AUTO_FOLD_DELAY, AUTO_START_DELAY, BOT_ACTION_DELAY } from '@/partykit/room'
import type { C2SMessage, S2CMessage } from '@/shared/protocol'

type TypedMessage<T extends S2CMessage['type']> = Extract<S2CMessage, { type: T }>

class MockConnection {
  id: string
  uri: string
  readyState = 1
  socket: MockConnection
  state: unknown = null
  messages: S2CMessage[] = []

  constructor(id: string) {
    this.id = id
    this.uri = `ws://mock/${id}`
    this.socket = this
  }

  send(message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message !== 'string') {
      throw new Error('Expected string payload')
    }

    this.messages.push(JSON.parse(message) as S2CMessage)
  }

  setState(nextState: unknown) {
    this.state = typeof nextState === 'function'
      ? (nextState as (previous: unknown) => unknown)(this.state)
      : nextState
    return this.state
  }

  serializeAttachment() {}

  deserializeAttachment() {
    return null
  }
}

class MockRoom {
  readonly id = 'TEST01'
  readonly internalID = 'internal-test'
  readonly name = 'main'
  readonly env = {}
  readonly storage = {
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
  } as unknown as Room['storage']
  readonly blockConcurrencyWhile = async <T>(callback: () => Promise<T> | T) => await callback()
  readonly context = {
    parties: {},
    ai: {},
    vectorize: {},
    assets: { fetch: async () => null },
    bindings: { r2: {}, kv: {} },
  } as Room['context']
  readonly connections = new Map<string, Connection>()
  readonly parties = this.context.parties
  readonly analytics = {} as Room['analytics']

  broadcast = () => {}

  getConnection(id: string) {
    return this.connections.get(id)
  }

  getConnections() {
    return this.connections.values()
  }

  addConnection(id: string) {
    const connection = new MockConnection(id) as unknown as Connection
    this.connections.set(id, connection)
    return connection
  }

  removeConnection(id: string) {
    this.connections.delete(id)
  }
}

function createHarness() {
  const room = new MockRoom()
  const server = new PokerRoom(room as unknown as Room)
  return { room, server }
}

function connect(server: PokerRoom, room: MockRoom, id: string) {
  const connection = room.addConnection(id)
  server.onConnect(connection)
  return connection
}

function send(server: PokerRoom, connection: Connection, message: C2SMessage) {
  server.onMessage(JSON.stringify(message), connection)
}

function sendRaw(server: PokerRoom, connection: Connection, message: string) {
  server.onMessage(message, connection)
}

function lastMessage<T extends S2CMessage['type']>(
  connection: Connection,
  type: T
): TypedMessage<T> | undefined {
  const messages = (connection as unknown as MockConnection).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === type) {
      return message as TypedMessage<T>
    }
  }
}

function joinPlayer(
  server: PokerRoom,
  room: MockRoom,
  connectionId: string,
  nickname: string,
  reconnectToken?: string,
  profile?: Partial<{ email: string; venmoUsername: string }>
) {
  const connection = connect(server, room, connectionId)
  send(server, connection, {
    type: 'join_room',
    nickname,
    email: profile?.email ?? `${connectionId}@example.com`,
    venmoUsername: profile?.venmoUsername ?? `@${connectionId}`,
    reconnectToken,
  })

  const session = lastMessage(connection, 'private_session')
  if (!session) {
    throw new Error(`Missing private_session for ${connectionId}`)
  }

  return {
    connection,
    playerId: session.yourId,
    reconnectToken: session.reconnectToken,
  }
}

function seatPlayer(server: PokerRoom, connection: Connection, seatIndex?: number) {
  send(server, connection, { type: 'seat_me', seatIndex })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PokerRoom reconnect and session handling', () => {
  it('rotates reconnect tokens, preserves the seat, and strips stale connections of private cards', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice-1', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob-1', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'start_game' })

    const aliceReconnect = joinPlayer(server, room, 'alice-2', 'Alice', alice.reconnectToken)
    expect(aliceReconnect.playerId).toBe(alice.playerId)
    expect(aliceReconnect.reconnectToken).not.toBe(alice.reconnectToken)

    const staleSnapshot = lastMessage(alice.connection, 'room_snapshot')
    const staleAliceView = staleSnapshot?.state.players.find(player => player.id === alice.playerId)
    expect(staleAliceView?.holeCards).toBeUndefined()

    server.onClose(alice.connection)

    const freshSnapshot = lastMessage(aliceReconnect.connection, 'room_snapshot')
    const reconnectView = freshSnapshot?.state.players.find(player => player.id === alice.playerId)

    expect(reconnectView?.holeCards).toHaveLength(2)
    expect(reconnectView?.isConnected).toBe(true)

    const gameState = (server as unknown as { data: { gameState: { players: Array<{ id: string }> } } }).data.gameState
    expect(gameState.players.filter(player => player.id === alice.playerId)).toHaveLength(1)
  })

  it('rejects self-removal and safely transfers host when the host leaves', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    const bob = joinPlayer(server, room, 'bob', 'Bob')

    send(server, alice.connection, { type: 'remove_player', targetId: alice.playerId })
    expect(lastMessage(alice.connection, 'action_failed')?.message).toContain('leave room')

    send(server, alice.connection, { type: 'leave_room' })

    const bobSession = lastMessage(bob.connection, 'private_session')
    expect(bobSession?.yourId).toBe(bob.playerId)
    expect(bobSession?.isHost).toBe(true)

    const hostId = (server as unknown as { data: { hostId: string | null } }).data.hostId
    expect(hostId).toBe(bob.playerId)
  })
})

describe('PokerRoom player profiles and stats', () => {
  it('exposes Venmo and room stats while keeping email private', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice', undefined, {
      email: 'ALICE@example.com',
      venmoUsername: 'alicepay',
    })
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob', undefined, {
      email: 'bob@example.com',
      venmoUsername: '@bobpay',
    })
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'start_game' })

    const liveSnapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = liveSnapshot?.state.actingPlayerId
    expect(actingPlayerId).toBeTruthy()

    const folder = actingPlayerId === alice.playerId ? alice : bob
    send(server, folder.connection, { type: 'player_action', action: 'fold' })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    expect(snapshot?.state.phase).toBe('between_hands')
    expect(JSON.stringify(snapshot?.state)).not.toContain('alice@example.com')
    expect(JSON.stringify(snapshot?.state)).not.toContain('bob@example.com')

    const winner = snapshot?.state.winners?.[0]
    expect(winner).toBeDefined()
    expect(winner?.venmoUsername).toMatch(/^@(alicepay|bobpay)$/)

    const winnerSeat = snapshot?.state.players.find(player => player.id === winner?.playerId)
    const foldedSeat = snapshot?.state.players.find(player => player.id === folder.playerId)

    expect(winnerSeat?.venmoUsername).toBe(winner?.venmoUsername)
    expect(winnerSeat?.stats?.handsPlayed).toBe(1)
    expect(winnerSeat?.stats?.wins).toBe(1)
    expect(winnerSeat?.stats?.totalWon).toBeGreaterThan(0)
    expect(winnerSeat?.stats?.foldRate).toBe(0)

    expect(foldedSeat?.stats?.handsPlayed).toBe(1)
    expect(foldedSeat?.stats?.folds).toBe(1)
    expect(foldedSeat?.stats?.wins).toBe(0)
    expect(foldedSeat?.stats?.foldRate).toBe(1)

    const lobbyWinner = snapshot?.state.lobbyPlayers.find(player => player.id === winner?.playerId)
    expect(lobbyWinner?.venmoUsername).toBe(winner?.venmoUsername)
    expect(lobbyWinner?.stats?.wins).toBe(1)
  })
})

describe('PokerRoom timer handling', () => {
  it('resets the action timer on reconnect and clears it after the hand ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice-1', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob-1', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'start_game' })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = snapshot?.state.actingPlayerId
    expect(actingPlayerId).toBeTruthy()

    const acting = actingPlayerId === alice.playerId ? alice : bob
    const waiting = actingPlayerId === alice.playerId ? bob : alice

    vi.advanceTimersByTime(10_000)
    room.removeConnection((acting.connection as unknown as MockConnection).id)
    server.onClose(acting.connection)

    vi.advanceTimersByTime(10_000)
    const reconnect = joinPlayer(server, room, 'reconnect', actingPlayerId === alice.playerId ? 'Alice' : 'Bob', acting.reconnectToken)
    expect(reconnect.playerId).toBe(acting.playerId)

    vi.advanceTimersByTime(AUTO_FOLD_DELAY - 1_000)

    const midHandSnapshot = lastMessage(reconnect.connection, 'room_snapshot') ?? lastMessage(waiting.connection, 'room_snapshot')
    expect(midHandSnapshot?.state.phase).toBe('in_hand')

    vi.advanceTimersByTime(1_001)

    const endedSnapshot = lastMessage(reconnect.connection, 'room_snapshot') ?? lastMessage(waiting.connection, 'room_snapshot')
    expect(endedSnapshot?.state.phase).toBe('between_hands')

    const roomState = server as unknown as {
      autoFoldTimeout: ReturnType<typeof setTimeout> | null
      data: { gameState: { actionTimerStart: number | null } }
    }

    expect(roomState.autoFoldTimeout).toBeNull()
    expect(roomState.data.gameState.actionTimerStart).toBeNull()
  })

  it('folds and detaches a removed acting player without leaving a reconnect path behind', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 1)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 2)

    const carol = joinPlayer(server, room, 'carol', 'Carol')
    seatPlayer(server, carol.connection, 3)

    const dave = joinPlayer(server, room, 'dave', 'Dave')
    seatPlayer(server, dave.connection, 0)

    send(server, alice.connection, { type: 'start_game' })

    const liveSnapshot = lastMessage(alice.connection, 'room_snapshot')
    expect(liveSnapshot?.state.actingPlayerId).toBe(dave.playerId)

    send(server, alice.connection, { type: 'remove_player', targetId: dave.playerId })

    const updatedSnapshot = lastMessage(alice.connection, 'room_snapshot')
    expect(updatedSnapshot?.state.actingPlayerId).not.toBe(dave.playerId)

    const daveSeat = updatedSnapshot?.state.players.find(player => player.id === dave.playerId)
    expect(daveSeat?.status).toBe('folded')
    expect(daveSeat?.isConnected).toBe(false)

    const roomState = server as unknown as {
      autoFoldTimeout: ReturnType<typeof setTimeout> | null
      data: {
        reconnectTokens: Record<string, string>
      }
    }

    expect(roomState.data.reconnectTokens[dave.playerId]).toBeUndefined()
    expect(roomState.autoFoldTimeout).not.toBeNull()
  })

  it('marks a removed in-hand player as a spectator in lobby state', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    const carol = joinPlayer(server, room, 'carol', 'Carol')
    seatPlayer(server, carol.connection, 2)

    send(server, alice.connection, { type: 'start_game' })

    send(server, alice.connection, { type: 'remove_player', targetId: carol.playerId })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    const lobbyCarol = snapshot?.state.lobbyPlayers.find(player => player.id === carol.playerId)

    expect(lobbyCarol?.isSpectator).toBe(true)
    expect(lobbyCarol?.status).toBe('spectating')
  })

  it('allows hosts to change chips and move players to spectator mode during a live hand', () => {
    const { room, server } = createHarness()

    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    send(server, host.connection, { type: 'start_game' })

    send(server, host.connection, { type: 'adjust_player_stack', targetId: guest.playerId, amount: 175 })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    let snapshot = lastMessage(host.connection, 'room_snapshot')
    const guestAfterChips = snapshot?.state.players.find(player => player.id === guest.playerId)
    expect(guestAfterChips?.stack).toBeGreaterThan(900)

    send(server, host.connection, { type: 'set_player_spectator', targetId: guest.playerId, spectator: true })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    snapshot = lastMessage(host.connection, 'room_snapshot')
    const lobbyGuest = snapshot?.state.lobbyPlayers.find(player => player.id === guest.playerId)
    expect(lobbyGuest?.isSpectator).toBe(true)
  })

  it('shows every hand to a player once they are moved into spectator mode', () => {
    const { room, server } = createHarness()

    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    send(server, host.connection, { type: 'start_game' })
    send(server, host.connection, { type: 'set_player_spectator', targetId: guest.playerId, spectator: true })

    const spectatorSnapshot = lastMessage(guest.connection, 'room_snapshot')
    const hostSeatForSpectator = spectatorSnapshot?.state.players.find(player => player.id === host.playerId)
    const guestSeatForSpectator = spectatorSnapshot?.state.players.find(player => player.id === guest.playerId)

    expect(hostSeatForSpectator?.holeCards).toHaveLength(2)
    expect(guestSeatForSpectator?.holeCards).toHaveLength(2)
    expect(hostSeatForSpectator?.showCards).toBe('both')
    expect(guestSeatForSpectator?.showCards).toBe('both')
    expect(hostSeatForSpectator?.equityPercent).toBeUndefined()
    expect(guestSeatForSpectator?.equityPercent).toBeUndefined()

    const hostSnapshot = lastMessage(host.connection, 'room_snapshot')
    const guestSeatForHost = hostSnapshot?.state.players.find(player => player.id === guest.playerId)
    expect(guestSeatForHost?.holeCards).toBeUndefined()
    expect(guestSeatForHost?.equityPercent).toBeUndefined()
  })

  it('adds live odds for true spectators while the hand is still contested', () => {
    const { room, server } = createHarness()

    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    const rail = joinPlayer(server, room, 'rail', 'Charlie')
    send(server, host.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })

    send(server, host.connection, { type: 'start_game' })

    const spectatorSnapshot = lastMessage(rail.connection, 'room_snapshot')
    const hostSeatForRail = spectatorSnapshot?.state.players.find(player => player.id === host.playerId)
    const guestSeatForRail = spectatorSnapshot?.state.players.find(player => player.id === guest.playerId)

    expect(hostSeatForRail?.holeCards).toHaveLength(2)
    expect(guestSeatForRail?.holeCards).toHaveLength(2)
    expect(typeof hostSeatForRail?.equityPercent).toBe('number')
    expect(typeof guestSeatForRail?.equityPercent).toBe('number')

    const hostSnapshot = lastMessage(host.connection, 'room_snapshot')
    const guestSeatForHost = hostSnapshot?.state.players.find(player => player.id === guest.playerId)

    expect(guestSeatForHost?.holeCards).toBeUndefined()
    expect(guestSeatForHost?.equityPercent).toBeUndefined()
  })
})

describe('PokerRoom auto-start lifecycle', () => {
  it('blocks auto-start while host is disconnected and resumes once host reconnects', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    ;(server as unknown as { data: { gameState: { phase: string }; autoStartEnabled: boolean } }).data.gameState.phase =
      'between_hands'

    room.removeConnection(host.connection.id)
    server.onClose(host.connection)

    vi.advanceTimersByTime(AUTO_START_DELAY + 10)
    const blockedSnapshot = lastMessage(guest.connection, 'room_snapshot')
    expect(blockedSnapshot?.state.phase).toBe('between_hands')

    const hostReconnect = joinPlayer(server, room, 'host-reconnect', 'Alice', host.reconnectToken)
    expect(hostReconnect.playerId).toBe(host.playerId)

    vi.advanceTimersByTime(AUTO_START_DELAY + 10)
    const resumedSnapshot = lastMessage(hostReconnect.connection, 'room_snapshot')
    expect(resumedSnapshot?.state.phase).toBe('in_hand')
  })

  it('does not auto-start with fewer than 2 eligible active players', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    ;(server as unknown as {
      data: { gameState: { phase: 'between_hands' | 'waiting'; players: Array<{ id: string; stack: number; status: string }> } }
    }).data.gameState.phase = 'between_hands'
    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    vi.advanceTimersByTime(AUTO_START_DELAY + 10)
    expect(
      (server as unknown as { data: { gameState: { phase: string } } }).data.gameState.phase
    ).toBe('between_hands')
    expect(
      (server as unknown as { autoStartTimeout: ReturnType<typeof setTimeout> | null }).autoStartTimeout
    ).toBeNull()

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    vi.advanceTimersByTime(AUTO_START_DELAY + 10)
    expect(
      (server as unknown as { data: { gameState: { phase: string } } }).data.gameState.phase
    ).toBe('in_hand')
  })

  it('cleans action timer after an auto-started hand ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    ;(server as unknown as {
      data: { gameState: { phase: 'between_hands' | 'waiting' } }
    }).data.gameState.phase = 'between_hands'

    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    vi.advanceTimersByTime(AUTO_START_DELAY + 10)

    const inHand = lastMessage(host.connection, 'room_snapshot')
    expect(inHand?.state.phase).toBe('in_hand')
    expect(inHand?.state.actionTimerStart).toBeTruthy()
    const roomRuntime = server as unknown as {
      autoFoldTimeout: ReturnType<typeof setTimeout> | null
      data: { gameState: { actionTimerStart: number | null } }
    }
    expect(roomRuntime.autoFoldTimeout).not.toBeNull()

    vi.advanceTimersByTime(AUTO_FOLD_DELAY + 10)

    const ended = lastMessage(host.connection, 'room_snapshot')
    expect(ended?.state.phase).toBe('between_hands')
    expect(roomRuntime.autoFoldTimeout).toBeNull()
    expect(roomRuntime.data.gameState.actionTimerStart).toBeNull()
  })
})

describe('PokerRoom protocol safety and host-only enforcement', () => {
  it('lets the host add local bots for testing', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    send(server, host.connection, { type: 'add_bots', count: 2 })

    const snapshot = lastMessage(host.connection, 'room_snapshot')
    expect(snapshot?.state.players).toHaveLength(3)
    expect(snapshot?.state.players.filter(player => player.isBot)).toHaveLength(2)
    expect(lastMessage(host.connection, 'action_result')?.message).toContain('Added 2 bots')
  })

  it('auto-acts when a bot has the turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    send(server, host.connection, { type: 'add_bots', count: 1 })
    const state = (server as unknown as {
      data: {
        gameState: {
          phase: 'waiting' | 'in_hand'
          actingPlayerId: string | null
          players: Array<{ id: string; isBot?: boolean }>
        }
      }
      syncActionTimer: (resetCurrentTimer?: boolean) => void
    }).data.gameState

    const bot = state.players.find(player => player.isBot)
    expect(bot).toBeDefined()

    send(server, host.connection, { type: 'start_game' })

    state.actingPlayerId = bot?.id ?? null
    ;(server as unknown as { syncActionTimer: (resetCurrentTimer?: boolean) => void }).syncActionTimer(true)

    vi.advanceTimersByTime(BOT_ACTION_DELAY + 50)

    const snapshot = lastMessage(host.connection, 'room_snapshot')
    expect(snapshot?.state.actingPlayerId).not.toBe(bot?.id)
  })

  it('rejects malformed set_auto_start payloads safely', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const nonHost = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, nonHost.connection, 1)

    sendRaw(server, nonHost.connection, '{\"type\":\"set_auto_start\",\"enabled\":\"yes\"}')
    expect(lastMessage(nonHost.connection, 'error')?.message).toBe('Invalid message format')
    expect(lastMessage(nonHost.connection, 'action_failed')).toBeUndefined()
  })

  it('rejects malformed chat payloads without corrupting social snapshots', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const nonHost = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, nonHost.connection, 1)

    send(server, host.connection, { type: 'table_chat', message: 'Ready' })
    const beforeReconnect = lastMessage(host.connection, 'social_snapshot')
    expect(beforeReconnect?.social.chatLog[0]?.message).toBe('Ready')

    sendRaw(server, host.connection, '{\"type\":\"table_chat\",\"message\":{}}')
    expect(lastMessage(host.connection, 'error')?.message).toBe('Invalid message format')

    ;(server as unknown as { data: { gameState: { phase: 'between_hands' } } }).data.gameState.phase = 'between_hands'
    room.removeConnection(host.connection.id)
    server.onClose(host.connection)

    const reconnect = joinPlayer(server, room, 'host-reconnect', 'Alice', host.reconnectToken)
    const socialAfterReconnect = lastMessage(reconnect.connection, 'social_snapshot')
    expect(Array.isArray(socialAfterReconnect?.social.active)).toBe(true)
    expect(Array.isArray(socialAfterReconnect?.social.chatLog)).toBe(true)
    const chatLog = socialAfterReconnect?.social.chatLog
    expect(Array.isArray(chatLog)).toBe(true)
    if (chatLog) {
      expect(chatLog.every(
        entry => typeof entry.id === 'string' &&
          entry.id.length > 0 &&
          typeof entry.playerId === 'string' &&
          typeof entry.nickname === 'string' &&
          typeof entry.message === 'string' &&
          typeof entry.createdAt === 'number'
      )).toBe(true)
    }
  })

  it('keeps bounty metadata in snapshots and clears it when a new hand starts', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    const state = server as unknown as {
      data: {
        gameState: {
          bounty?: {
            active: boolean
            amount: number
            contributors: string[]
            recipientPlayerIds: string[]
            reason: string
          }
          phase: 'between_hands' | 'in_hand'
          players: Array<{ id: string; id2?: string }>
        }
      }
    }
    ;(server as unknown as { data: { gameState: { phase: 'between_hands' | 'waiting' } } }).data.gameState.phase = 'between_hands'
    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    expect(lastMessage(host.connection, 'action_result')).toBeDefined()

    state.data.gameState.bounty = {
      active: true,
      amount: 100,
      contributors: [guest.playerId],
      recipientPlayerIds: [host.playerId],
      reason: 'forced fixture',
    }
    state.data.gameState.phase = 'between_hands'
    ;(server as unknown as { broadcastState: () => void }).broadcastState()

    const preStartHost = lastMessage(host.connection, 'room_snapshot')
    expect(preStartHost?.state.autoStartEnabled).toBe(true)
    expect(preStartHost?.state.bounty?.active).toBe(true)

    send(server, host.connection, { type: 'start_game' })
    const postStartHost = lastMessage(host.connection, 'room_snapshot')
    const postStartGuest = lastMessage(guest.connection, 'room_snapshot')
    expect(Object.prototype.hasOwnProperty.call(postStartHost?.state ?? {}, 'autoStartEnabled')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(postStartGuest?.state ?? {}, 'autoStartEnabled')).toBe(true)
    expect(postStartHost?.state.bounty).toBeUndefined()
    expect(postStartGuest?.state.bounty).toBeUndefined()
  })

  it('does not expose room internals through room snapshots', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    ;(server as unknown as { data: { gameState: { phase: 'between_hands' } } }).data.gameState.phase = 'between_hands'
    send(server, host.connection, { type: 'set_auto_start', enabled: true })
    ;(server as unknown as { broadcastState: () => void }).broadcastState()

    const hostSnapshot = lastMessage(host.connection, 'room_snapshot')?.state as unknown as Record<string, unknown>
    const guestSnapshot = lastMessage(guest.connection, 'room_snapshot')?.state as unknown as Record<string, unknown>

    expect(hostSnapshot?.autoStartEnabled).toBe(true)
    expect(guestSnapshot?.autoStartEnabled).toBe(true)

    expect(Object.prototype.hasOwnProperty.call(hostSnapshot ?? {}, 'reconnectTokens')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(guestSnapshot ?? {}, 'gameState')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(hostSnapshot ?? {}, 'connectionToPlayer')).toBe(false)
  })

  it('rejects host-only actions from non-host clients', () => {
    const { room, server } = createHarness()
    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const nonHost = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, nonHost.connection, 1)

    send(server, nonHost.connection, { type: 'start_game' })
    const startFail = lastMessage(nonHost.connection, 'action_failed')
    const last = (nonHost.connection as unknown as MockConnection).messages.at(-1)
    expect(startFail?.message).toContain('Only the host')
    expect(last?.type).toBe('action_failed')

    send(server, nonHost.connection, { type: 'set_auto_start', enabled: true })
    const settingsFail = lastMessage(nonHost.connection, 'action_failed')
    expect(settingsFail?.message).toContain('Only the host')
  })
})

describe('PokerRoom social protocol', () => {
  it('broadcasts chat to seated participants and keeps chat log entries', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'table_chat', message: '  Welcome to the table!  ' })

    const aliceSocial = lastMessage(alice.connection, 'social_snapshot')
    const bobSocial = lastMessage(bob.connection, 'social_snapshot')

    const hasBobView = bobSocial?.social.chatLog.some(entry =>
      entry.message === 'Welcome to the table!' &&
      entry.nickname === 'Alice'
    )
    expect(hasBobView).toBe(true)
    expect(aliceSocial?.social.active.some(entry =>
      entry.playerId === alice.playerId &&
      entry.message === 'Welcome to the table!'
    )).toBe(true)
  })

  it('broadcasts live emotes and keeps target metadata for targeted emotes', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'table_emote', emote: '👋' })

    let social = lastMessage(bob.connection, 'social_snapshot')
    const selfEmote = social?.social.active.find(entry =>
      entry.playerId === alice.playerId &&
      entry.emote === '👋'
    )

    expect(selfEmote?.targetPlayerId).toBeUndefined()
    expect(typeof selfEmote?.emoteExpiresAt).toBe('number')

    send(server, alice.connection, { type: 'table_emote', emote: '😂', targetId: bob.playerId })

    social = lastMessage(bob.connection, 'social_snapshot')
    const targetedEmote = social?.social.active.find(entry =>
      entry.playerId === alice.playerId &&
      entry.emote === '😂'
    )

    expect(targetedEmote?.targetPlayerId).toBe(bob.playerId)
    expect(social?.social.chatLog.some(entry =>
      entry.playerId === alice.playerId &&
      entry.message === 'to Bob: 😂'
    )).toBe(true)
  })

  it('surfaces malformed emote payloads through explicit error messaging', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    send(server, alice.connection, { type: 'table_emote', emote: 'unknown_emote' })
    expect(
      lastMessage(alice.connection, 'error')?.message ??
      lastMessage(alice.connection, 'action_failed')?.message
    ).toMatch(/Invalid message format|Unknown emote/)
  })

  it('lets a folded player show their cards to the table', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'start_game' })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = snapshot?.state.actingPlayerId
    const folder = actingPlayerId === alice.playerId ? alice : bob
    const observer = actingPlayerId === alice.playerId ? bob : alice

    send(server, folder.connection, { type: 'player_action', action: 'fold' })
    send(server, folder.connection, { type: 'set_show_cards', mode: 'both' })

    const observerSnapshot = lastMessage(observer.connection, 'room_snapshot')
    const foldedSeat = observerSnapshot?.state.players.find(player => player.id === folder.playerId)

    expect(foldedSeat?.showCards).toBe('both')
    expect(foldedSeat?.holeCards).toHaveLength(2)
  })

  it('lets a folded player show cards while a multi-way hand is still live', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    const carol = joinPlayer(server, room, 'carol', 'Carol')
    seatPlayer(server, carol.connection, 2)

    send(server, alice.connection, { type: 'start_game' })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = snapshot?.state.actingPlayerId
    const players = [alice, bob, carol]
    const folder = players.find(player => player.playerId === actingPlayerId)!
    const observer = players.find(player => player.playerId !== folder.playerId)!

    send(server, folder.connection, { type: 'player_action', action: 'fold' })
    send(server, folder.connection, { type: 'set_show_cards', mode: 'both' })

    const folderResult = lastMessage(folder.connection, 'action_result')
    expect(folderResult?.message).toBeUndefined()

    const observerSnapshot = lastMessage(observer.connection, 'room_snapshot')
    const foldedSeat = observerSnapshot?.state.players.find(player => player.id === folder.playerId)

    expect(observerSnapshot?.state.phase).toBe('in_hand')
    expect(foldedSeat?.status).toBe('folded')
    expect(foldedSeat?.showCards).toBe('both')
    expect(foldedSeat?.holeCards).toHaveLength(2)
  })

  it('keeps active players from showing cards mid-hand before they fold', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob', 'Bob')
    seatPlayer(server, bob.connection, 1)

    const carol = joinPlayer(server, room, 'carol', 'Carol')
    seatPlayer(server, carol.connection, 2)

    send(server, alice.connection, { type: 'start_game' })

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = snapshot?.state.actingPlayerId
    const activePlayer = [alice, bob, carol].find(player => player.playerId === actingPlayerId)!

    send(server, activePlayer.connection, { type: 'set_show_cards', mode: 'both' })

    expect(lastMessage(activePlayer.connection, 'action_failed')?.message)
      .toContain('after folding or after the hand')
  })
})

describe('PokerRoom rabbit hunting', () => {
  it('syncs the rabbit hunting setting through host updates and rejects non-host changes', () => {
    const { room, server } = createHarness()

    const host = joinPlayer(server, room, 'host', 'Alice')
    seatPlayer(server, host.connection, 0)

    const guest = joinPlayer(server, room, 'guest', 'Bob')
    seatPlayer(server, guest.connection, 1)

    const initialSnapshot = lastMessage(host.connection, 'room_snapshot')
    expect(initialSnapshot?.state.rabbitHuntingEnabled).toBe(false)

    send(server, guest.connection, { type: 'update_table_settings', rabbitHuntingEnabled: true })
    expect(lastMessage(guest.connection, 'action_failed')?.message).toContain('Only the host')

    send(server, host.connection, { type: 'update_table_settings', rabbitHuntingEnabled: true })
    expect(lastMessage(host.connection, 'action_result')?.message).toBe('Updated table settings.')

    const hostSnapshot = lastMessage(host.connection, 'room_snapshot')
    const guestSnapshot = lastMessage(guest.connection, 'room_snapshot')

    expect(hostSnapshot?.state.rabbitHuntingEnabled).toBe(true)
    expect(guestSnapshot?.state.rabbitHuntingEnabled).toBe(true)
  })

  it('shows the rabbit-hunted board in room snapshots after a fold-ended hand', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice-rabbit', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob-rabbit', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'update_table_settings', rabbitHuntingEnabled: true })
    send(server, alice.connection, { type: 'start_game' })

    const serverAny = server as unknown as {
      data: {
        gameState: {
          deck: Array<{ rank: string; suit: string }>
        }
      }
    }
    serverAny.data.gameState.deck = [
      { rank: '3', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'clubs' },
      { rank: '4', suit: 'diamonds' },
      { rank: 'J', suit: 'spades' },
      { rank: '5', suit: 'clubs' },
      { rank: '9', suit: 'hearts' },
    ]

    const liveSnapshot = lastMessage(alice.connection, 'room_snapshot')
    const actingPlayerId = liveSnapshot?.state.actingPlayerId
    const folder = actingPlayerId === alice.playerId ? alice : bob

    send(server, folder.connection, { type: 'player_action', action: 'fold' })

    const finalSnapshot = lastMessage(alice.connection, 'room_snapshot')
    expect(finalSnapshot?.state.phase).toBe('between_hands')
    expect(finalSnapshot?.state.rabbitHuntingEnabled).toBe(true)
    expect(finalSnapshot?.state.communityCards).toEqual([
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'clubs' },
      { rank: 'J', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
    ])
    expect(finalSnapshot?.state.recentActions[0]).toContain('Rabbit hunt:')
  })
})

describe('PokerRoom snapshots include bounty metadata', () => {
  it('exposes bounty details in room snapshots after a 7-2 bounty hand', () => {
    const { room, server } = createHarness()

    const alice = joinPlayer(server, room, 'alice-1', 'Alice')
    seatPlayer(server, alice.connection, 0)

    const bob = joinPlayer(server, room, 'bob-1', 'Bob')
    seatPlayer(server, bob.connection, 1)

    send(server, alice.connection, { type: 'start_game' })

    const serverAny = server as unknown as {
      data: {
        gameState: {
          players: Array<{
            id: string
            isSB: boolean
            isBB: boolean
            holeCards: Array<{ rank: string; suit: string }>
            status: string
            totalInPot: number
            stack: number
          }>
          phase: string
          round: string | null
          communityCards: Array<{ rank: string; suit: string }>
          bigBlind: number
          smallBlind: number
          bounty?: {
            active: boolean
            amount: number
            contributors: string[]
            recipientPlayerIds: string[]
            reason: string
          }
          winners?: Array<{ playerId: string; amount: number; handDescription?: string }>
        }
      }
    }

    const state = serverAny.data.gameState
    const winner = state.players[0]!
    const loser = state.players[1]!

    state.bounty = {
      active: true,
      amount: state.bigBlind,
      contributors: [loser.id],
      recipientPlayerIds: [winner.id],
      reason: 'test bounty payout',
    }
    state.winners = [
      { playerId: winner.id, amount: state.bigBlind + state.smallBlind },
    ]
    state.phase = 'between_hands'
    state.round = null

    ;(server as unknown as { broadcastState: () => void }).broadcastState()

    const snapshot = lastMessage(alice.connection, 'room_snapshot')
    expect(snapshot?.state.phase).toBe('between_hands')
    expect(snapshot?.state.bounty?.active).toBe(true)
    expect(snapshot?.state.bounty?.amount).toBe(state.bigBlind)
    expect(snapshot?.state.bounty?.contributors).toEqual([loser.id])
    expect(snapshot?.state.bounty?.recipientPlayerIds).toEqual([winner.id])
  })
})
