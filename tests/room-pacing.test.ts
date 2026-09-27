import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
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
  const alice = join(server, room, 'pace-alice', 'Alice')
  send(server, alice.connection, { type: 'seat_me', seatIndex: 0 })
  const bob = join(server, room, 'pace-bob', 'Bob')
  send(server, bob.connection, { type: 'seat_me', seatIndex: 1 })
  send(server, alice.connection, { type: 'start_game' })
  const byId = new Map([[alice.playerId, alice], [bob.playerId, bob]])
  return { room, server, alice, bob, byId }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PokerRoom run it twice pacing', () => {
  it('plays both runouts and then the full configured next-hand delay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T12:00:00.000Z'))
    const { server, alice, bob, byId } = startHeadsUp()

    const firstActor = last(alice.connection, 'room_snapshot')!.state.actingPlayerId!
    send(server, byId.get(firstActor)!.connection, { type: 'player_action', action: 'all_in' })
    const secondActor = last(alice.connection, 'room_snapshot')!.state.actingPlayerId!
    send(server, byId.get(secondActor)!.connection, { type: 'player_action', action: 'call' })

    // Voting takes a while; the pause must be measured from acceptance.
    vi.advanceTimersByTime(4_000)
    send(server, alice.connection, { type: 'run_it_twice_vote', vote: 'yes' })
    send(server, bob.connection, { type: 'run_it_twice_vote', vote: 'yes' })
    const accepted = last(alice.connection, 'room_snapshot')!.state
    expect(accepted.runItTwice?.status).toBe('accepted')
    // Keep both players funded whoever wins, so auto-deal can continue.
    const internals = server as unknown as {
      data: { gameState: { players: Array<{ stack: number }> } }
      syncAutoStart: () => void
      getAutoStartDelayMs: () => number
    }
    for (const player of internals.data.gameState.players) player.stack = Math.max(player.stack, 500)
    internals.syncAutoStart()

    const configuredDelay = accepted.autoStartDelay ?? 5_000
    const presentation = getShowdownMinimumDurationMs(2, {
      runItTwiceSharedCardCount: accepted.runItTwice?.sharedCardCount ?? 0,
    })
    // The two-board cinematic is longer than a normal heads-up showdown.
    expect(presentation).toBeGreaterThan(getShowdownMinimumDurationMs(2) + 1_500)

    expect(internals.getAutoStartDelayMs()).toBe(presentation + configuredDelay)

    vi.advanceTimersByTime(presentation + configuredDelay - 50)
    expect(last(alice.connection, 'room_snapshot')!.state.phase).toBe('between_hands')

    vi.advanceTimersByTime(100)
    const next = last(alice.connection, 'room_snapshot')!.state
    expect(next.phase).toBe('in_hand')
    expect(next.handNumber).toBe(accepted.handNumber + 1)
  })
})

describe('PokerRoom reconnect timer', () => {
  it('keeps the acting player’s original deadline across a disconnect and reconnect', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T13:00:00.000Z'))
    const { room, server, alice, bob, byId } = startHeadsUp()

    const snapshot = last(alice.connection, 'room_snapshot')!.state
    const actorId = snapshot.actingPlayerId!
    const timerStart = snapshot.actionTimerStart!
    expect(timerStart).toBeTruthy()
    const actor = byId.get(actorId)!
    const observer = actor === alice ? bob : alice

    vi.advanceTimersByTime(4_000)
    room.connections.delete(actor.connection.id)
    server.onClose(actor.connection)
    expect(last(observer.connection, 'room_snapshot')!.state.actionTimerStart).toBe(timerStart)

    vi.advanceTimersByTime(2_000)
    const rejoined = join(server, room, `${actor.connection.id}-again`, actorId === alice.playerId ? 'Alice' : 'Bob', actor.reconnectToken)
    expect(rejoined.playerId).toBe(actorId)
    const after = last(rejoined.connection, 'room_snapshot')!.state
    expect(after.actingPlayerId).toBe(actorId)
    expect(after.actionTimerStart).toBe(timerStart)

    const runtime = server as unknown as { autoFoldDeadline: number | null }
    expect(runtime.autoFoldDeadline).toBe(timerStart + after.actionTimerDuration)
  })
})
