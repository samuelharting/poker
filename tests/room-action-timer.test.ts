import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom, { AUTO_FOLD_GRACE_MS } from '@/partykit/room'
import { getShowdownMinimumDurationMs } from '@/lib/poker/showdown'
import type { C2SMessage, S2CMessage } from '@/shared/protocol'

type TypedMessage<T extends S2CMessage['type']> = Extract<S2CMessage, { type: T }>

class MockConnection {
  readyState = 1
  socket = this
  state: unknown = null
  messages: S2CMessage[] = []
  uri: string

  constructor(readonly id: string) {
    this.uri = `ws://mock/${id}`
  }

  send(message: string) {
    this.messages.push(JSON.parse(message) as S2CMessage)
  }

  setState(next: unknown) {
    this.state = next
    return next
  }

  serializeAttachment() {}
  deserializeAttachment() {
    return null
  }
}

class MockRoom {
  readonly id = 'PACE01'
  readonly internalID = 'internal-pace'
  readonly name = 'main'
  readonly env = {}
  readonly storage = { setAlarm: vi.fn(), deleteAlarm: vi.fn() } as unknown as Room['storage']
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
}

function setup() {
  const room = new MockRoom()
  const server = new PokerRoom(room as unknown as Room)
  // Random thirst off unless a test turns it on.
  server.autoBeerRandom = () => 1
  return { room, server }
}

function send(server: PokerRoom, connection: Connection, message: C2SMessage) {
  server.onMessage(JSON.stringify(message), connection)
}

function last<T extends S2CMessage['type']>(connection: Connection, type: T): TypedMessage<T> | undefined {
  const messages = (connection as unknown as MockConnection).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === type) return messages[index] as TypedMessage<T>
  }
}

function join(server: PokerRoom, room: MockRoom, id: string, nickname: string, reconnectToken?: string) {
  const connection = new MockConnection(id) as unknown as Connection
  room.connections.set(id, connection)
  server.onConnect(connection)
  send(server, connection, { type: 'join_room', nickname, email: `${id}@example.com`, venmoUsername: `@${id}`, reconnectToken })
  const session = last(connection, 'private_session')
  if (!session) throw new Error(`no session for ${id}`)
  return { connection, playerId: session.yourId, reconnectToken: session.reconnectToken }
}

function startHeadsUp() {
  const { room, server } = setup()
  const alice = join(server, room, 'timer-alice', 'Alice')
  send(server, alice.connection, { type: 'seat_me', seatIndex: 0 })
  const bob = join(server, room, 'timer-bob', 'Bob')
  send(server, bob.connection, { type: 'seat_me', seatIndex: 1 })
  send(server, alice.connection, { type: 'start_game' })
  const byId = new Map([[alice.playerId, alice], [bob.playerId, bob]])
  return { room, server, alice, bob, byId }
}

afterEach(() => {
  vi.useRealTimers()
})


function internalsOf(server: PokerRoom) {
  return server as unknown as {
    autoFoldTimeout: ReturnType<typeof setTimeout> | null
    autoFoldPlayerId: string | null
    autoFoldDeadline: number | null
    data: { gameState: { phase: string; actingPlayerId: string | null; actionTimerStart: number | null; actionTimerDuration: number; handNumber: number } }
  }
}

describe('PokerRoom turn clock', () => {
  it('a rejected action from someone else does not cancel the acting player’s clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { room, server, byId, alice, bob } = startHeadsUp()
    const internals = internalsOf(server)
    const actorId = internals.data.gameState.actingPlayerId!
    const actor = byId.get(actorId)!
    const other = actor === alice ? bob : alice
    const deadline = internals.autoFoldDeadline!
    const deleteAlarm = room.storage.deleteAlarm as unknown as ReturnType<typeof vi.fn>
    deleteAlarm.mockClear()

    send(server, other.connection, { type: 'player_action', action: 'fold' })

    expect(last(other.connection, 'action_failed')).toBeTruthy()
    expect(internals.data.gameState.actingPlayerId).toBe(actorId)
    expect(internals.autoFoldTimeout).not.toBeNull()
    expect(internals.autoFoldPlayerId).toBe(actorId)
    expect(internals.autoFoldDeadline).toBe(deadline)
    expect(deleteAlarm).not.toHaveBeenCalled()
  })

  it('an illegal action from the acting player keeps their original clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { server, byId } = startHeadsUp()
    const internals = internalsOf(server)
    const actorId = internals.data.gameState.actingPlayerId!
    const actor = byId.get(actorId)!
    const start = internals.data.gameState.actionTimerStart
    const deadline = internals.autoFoldDeadline

    vi.advanceTimersByTime(3_000)
    send(server, actor.connection, { type: 'player_action', action: 'raise', amount: 1 })

    expect(internals.data.gameState.actingPlayerId).toBe(actorId)
    expect(internals.autoFoldTimeout).not.toBeNull()
    expect(internals.autoFoldDeadline).toBe(deadline)
    expect(internals.data.gameState.actionTimerStart).toBe(start)
  })

  it('accepts an action that reaches the server just after the displayed clock hit zero', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { server, byId } = startHeadsUp()
    const internals = internalsOf(server)
    const actorId = internals.data.gameState.actingPlayerId!
    const actor = byId.get(actorId)!
    const handNumber = internals.data.gameState.handNumber

    // The client's clock runs about one network hop behind the server's, and
    // its click needs another hop to arrive.
    vi.advanceTimersByTime(internals.data.gameState.actionTimerDuration + Math.floor(AUTO_FOLD_GRACE_MS / 2))
    expect(internals.data.gameState.actingPlayerId).toBe(actorId)
    send(server, actor.connection, { type: 'player_action', action: 'call' })

    expect(last(actor.connection, 'room_snapshot')!.state.players.find(p => p.id === actorId)?.status).toBe('active')
    expect(internals.data.gameState.actingPlayerId).not.toBe(actorId)
    expect(internals.data.gameState.handNumber).toBe(handNumber)
  })

  it('still times the player out once the grace has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { server } = startHeadsUp()
    const internals = internalsOf(server)
    const actorId = internals.data.gameState.actingPlayerId!

    vi.advanceTimersByTime(internals.data.gameState.actionTimerDuration + AUTO_FOLD_GRACE_MS + 10)
    expect(internals.data.gameState.actingPlayerId).not.toBe(actorId)
  })

  it('a stale alarm never folds a turn whose clock this room is not tracking', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { server } = startHeadsUp()
    const internals = internalsOf(server)
    const actorId = internals.data.gameState.actingPlayerId!

    // Turn state carrying an old start time but no live clock behind it.
    internals.data.gameState.actionTimerStart = Date.now() - 60_000
    internals.autoFoldPlayerId = null
    internals.autoFoldDeadline = null
    ;(server as unknown as { onAlarm: () => void }).onAlarm()

    expect(internals.data.gameState.actingPlayerId).toBe(actorId)
    expect(internals.data.gameState.phase).toBe('in_hand')
    // ...and the turn gets a fresh, correctly tracked clock instead.
    expect(internals.autoFoldPlayerId).toBe(actorId)
    expect(internals.autoFoldDeadline).toBeGreaterThan(Date.now())
  })
})
