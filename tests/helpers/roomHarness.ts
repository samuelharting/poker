import { vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import type { C2SMessage, S2CMessage } from '@/shared/protocol'
import type { InternalGameState } from '@/lib/poker/types'

/** Shared MockRoom harness for PokerRoom membership tests. */

export type TypedMessage<T extends S2CMessage['type']> = Extract<S2CMessage, { type: T }>

export class MockConnection {
  id: string
  uri: string
  readyState = 1
  socket: MockConnection
  state: unknown = null
  messages: S2CMessage[] = []
  closed = false

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
    // Long simulations broadcast thousands of snapshots; keep memory bounded.
    if (this.messages.length > 400) {
      this.messages.splice(0, this.messages.length - 200)
    }
  }

  close() {
    this.closed = true
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

export class MockRoom {
  readonly id = 'TEST01'
  readonly internalID = 'internal-test'
  readonly name = 'main'
  readonly env = {}
  readonly storage = {
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
  } as unknown as Room['storage']
  readonly connections = new Map<string, Connection>()

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

export interface RoomInternals {
  data: {
    gameState: InternalGameState
    hostId: string | null
    playerNicknames: Record<string, string>
    playerToConnection: Record<string, string>
    reconnectTokens: Record<string, string>
    spectatorIds: Record<string, true>
    spectatorStacks: Record<string, number>
    pendingRemovals: Record<string, true>
    pendingSpectators: Record<string, true>
  }
}

export function createHarness() {
  const room = new MockRoom()
  const server = new PokerRoom(room as unknown as Room)
  // Random thirst off unless a test turns it on.
  server.autoBeerRandom = () => 1
  // Deterministic: no bot drinks / peeks sneaking in timers.
  const tunable = server as unknown as { botDrinkRandom?: () => number; botPeekRandom?: () => number }
  tunable.botDrinkRandom = () => 1
  tunable.botPeekRandom = () => 1
  return { room, server, internals: server as unknown as RoomInternals }
}

export function connect(server: PokerRoom, room: MockRoom, id: string) {
  const connection = room.addConnection(id)
  server.onConnect(connection)
  return connection
}

export function send(server: PokerRoom, connection: Connection, message: C2SMessage) {
  server.onMessage(JSON.stringify(message), connection)
}

export function messagesOf(connection: Connection): S2CMessage[] {
  return (connection as unknown as MockConnection).messages
}

export function lastMessage<T extends S2CMessage['type']>(
  connection: Connection,
  type: T
): TypedMessage<T> | undefined {
  const messages = messagesOf(connection)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === type) {
      return message as TypedMessage<T>
    }
  }
}

export function joinPlayer(
  server: PokerRoom,
  room: MockRoom,
  connectionId: string,
  nickname: string,
  reconnectToken?: string
) {
  const connection = connect(server, room, connectionId)
  send(server, connection, { type: 'join_room', nickname, reconnectToken })
  const session = lastMessage(connection, 'private_session')
  return {
    connection,
    playerId: session?.yourId ?? '',
    reconnectToken: session?.reconnectToken ?? '',
  }
}

export function seatPlayer(server: PokerRoom, connection: Connection, seatIndex?: number) {
  send(server, connection, { type: 'seat_me', seatIndex })
}

/** Drop a socket the way PartyKit does: the connection disappears, then onClose fires. */
export function disconnect(server: PokerRoom, room: MockRoom, connection: Connection) {
  room.removeConnection(connection.id)
  server.onClose(connection)
}

/**
 * Chips on the table: stacks plus whatever is committed to an unfinished hand.
 * Once a hand has been paid out (phase leaves in_hand) totalInPot is history.
 */
export function tableChips(internals: RoomInternals): number {
  const state = internals.data.gameState
  const committed = state.phase === 'in_hand'
    ? state.players.reduce((sum, player) => sum + player.totalInPot, 0)
    : 0
  return state.players.reduce((sum, player) => sum + player.stack, 0) + committed
}

/** Chips anywhere in the room: the table plus spectators' banked stacks. */
export function roomChips(internals: RoomInternals): number {
  const spectator = Object.values(internals.data.spectatorStacks).reduce((sum, stack) => sum + stack, 0)
  return tableChips(internals) + spectator
}

export function actingPlayer(internals: RoomInternals) {
  const state = internals.data.gameState
  return state.players.find(player => player.id === state.actingPlayerId)
}

/** Turn integrity: acting id and index agree, and the actor can actually act. */
export function expectTurnIntegrity(internals: RoomInternals) {
  const state = internals.data.gameState
  if (state.phase !== 'in_hand' || !state.actingPlayerId) {
    return
  }
  const actor = state.players[state.actingPlayerIndex]
  if (!actor || actor.id !== state.actingPlayerId) {
    throw new Error(
      `actingPlayerIndex ${state.actingPlayerIndex} points at ${actor?.nickname ?? 'nobody'}, ` +
      `but actingPlayerId is ${state.actingPlayerId}`
    )
  }
  if (actor.status !== 'active') {
    throw new Error(`Acting player ${actor.nickname} has status ${actor.status}`)
  }
}

/** Act for whoever holds the turn with a safe passive action. */
export function actPassively(
  server: PokerRoom,
  internals: RoomInternals,
  connectionsById: Record<string, Connection>
) {
  const actor = actingPlayer(internals)
  if (!actor) return false
  const conn = connectionsById[actor.id]
  if (!conn) return false
  const state = internals.data.gameState
  send(server, conn, { type: 'player_action', action: actor.bet >= state.currentBet ? 'check' : 'call' })
  return true
}
