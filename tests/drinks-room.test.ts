import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import {
  DRINK_COOLDOWN_MS,
  PASS_OUT_FOLD_DELAY_MS,
  WAKE_UP_LEVEL,
  WATER_KICK_IN_MS,
} from '@/lib/drinks'
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

interface Seat {
  connection: Connection
  playerId: string
  send: (message: C2SMessage) => void
}

function createTable() {
  const connections = new Map<string, Connection>()
  const room = {
    id: 'BAR001',
    internalID: 'internal-bar',
    name: 'main',
    env: {},
    storage: { setAlarm: vi.fn(), deleteAlarm: vi.fn() },
    context: { parties: {} },
    getConnection: (id: string) => connections.get(id),
    getConnections: () => connections.values(),
    broadcast: () => {},
  }
  const server = new PokerRoom(room as unknown as Room)

  const join = (id: string, nickname: string, seatIndex: number): Seat => {
    const connection = new MockConnection(id) as unknown as Connection
    connections.set(id, connection)
    server.onConnect(connection)
    const send = (message: C2SMessage) => server.onMessage(JSON.stringify(message), connection)
    send({ type: 'join_room', nickname })
    send({ type: 'seat_me', seatIndex })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('missing session')
    return { connection, playerId: session.yourId, send }
  }

  return { server, join }
}

function messagesOf(connection: Connection): S2CMessage[] {
  return (connection as unknown as MockConnection).messages
}

function last<T extends S2CMessage['type']>(connection: Connection, type: T): TypedMessage<T> | undefined {
  const messages = messagesOf(connection)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === type) return messages[index] as TypedMessage<T>
  }
}

function drinkEvents(connection: Connection) {
  return messagesOf(connection)
    .filter((message): message is TypedMessage<'drink_event'> => message.type === 'drink_event')
    .map(message => message.event)
}

function seatState(viewer: Seat, playerId: string) {
  return last(viewer.connection, 'room_snapshot')?.state.players.find(player => player.id === playerId)
}

function orderBeers(seat: Seat, count: number) {
  for (let index = 0; index < count; index += 1) {
    seat.send({ type: 'order_drink', kind: 'beer' })
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
  }
}

function state(viewer: Seat) {
  return last(viewer.connection, 'room_snapshot')!.state
}

/** Heads-up: whoever is acting folds until the hand ends. */
function foldHandOut(alice: Seat, bob: Seat) {
  const acting = state(alice).actingPlayerId
  const actor = acting === alice.playerId ? alice : bob
  actor.send({ type: 'player_action', action: 'fold' })
  expect(state(alice).phase).toBe('between_hands')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PokerRoom drinks', () => {
  it('broadcasts a beer to every player and exposes drink state on the seat', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 0, beers: 0, lastDrink: null })

    alice.send({ type: 'order_drink', kind: 'beer' })

    const seen = seatState(bob, alice.playerId)?.drinks
    expect(seen).toMatchObject({ level: 1, beers: 1, passedOut: false, lastDrink: { kind: 'beer' } })
    expect(drinkEvents(bob.connection).at(-1)).toMatchObject({
      kind: 'beer',
      playerId: alice.playerId,
      nickname: 'Alice',
      level: 1,
      beers: 1,
    })

    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    alice.send({ type: 'order_drink', kind: 'beer' })
    const next = seatState(bob, alice.playerId)?.drinks
    expect(next?.level).toBe(2)
    expect(next?.lastDrink?.id).not.toBe(seen?.lastDrink?.id)
  })

  it('rate limits drinks per player', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    alice.send({ type: 'order_drink', kind: 'beer' })
    alice.send({ type: 'order_drink', kind: 'beer' })
    expect(last(alice.connection, 'action_failed')?.message).toContain('3 seconds')
    expect(seatState(bob, alice.playerId)?.drinks?.level).toBe(1)

    // Another player's cooldown is independent.
    bob.send({ type: 'order_drink', kind: 'beer' })
    expect(seatState(bob, bob.playerId)?.drinks?.level).toBe(1)
  })

  it('requires a seat before ordering', () => {
    vi.useFakeTimers()
    const { server } = createTable()
    const connection = new MockConnection('rail') as unknown as Connection
    server.onConnect(connection)
    server.onMessage(JSON.stringify({ type: 'order_drink', kind: 'beer' }), connection)
    expect(last(connection, 'action_failed')?.message).toContain('Join the room')
  })

  it('applies water after a delay rather than immediately', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    orderBeers(alice, 3)
    alice.send({ type: 'order_drink', kind: 'water' })
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 3, sobering: 1, waters: 1 })
    expect(drinkEvents(bob.connection).at(-1)?.kind).toBe('water')

    vi.advanceTimersByTime(WATER_KICK_IN_MS - 10)
    expect(seatState(bob, alice.playerId)?.drinks?.level).toBe(3)

    vi.advanceTimersByTime(20)
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 2, sobering: 0 })
    expect(drinkEvents(bob.connection).at(-1)).toMatchObject({ kind: 'water_kicked_in', level: 2 })
  })

  it('wears off one level every three completed hands', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    orderBeers(alice, 2)
    for (let hand = 1; hand <= 3; hand += 1) {
      alice.send({ type: 'start_game' })
      expect(state(alice).handNumber).toBe(hand)
      foldHandOut(alice, bob)
      expect(seatState(bob, alice.playerId)?.drinks?.level).toBe(hand < 3 ? 2 : 1)
    }
  })

  it('passes out at 10, auto-folds through the normal fold path, and wakes next hand at level 6', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    orderBeers(alice, 9)
    alice.send({ type: 'start_game' })
    expect(state(alice).phase).toBe('in_hand')
    expect(state(alice).handNumber).toBe(1)

    alice.send({ type: 'order_drink', kind: 'beer' })
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 10, beers: 10, passedOut: true })
    expect(drinkEvents(bob.connection).map(event => event.kind).slice(-2)).toEqual(['beer', 'passed_out'])

    // Let Bob act if it is his turn; the action then reaches Alice.
    if (state(bob).actingPlayerId === bob.playerId) {
      bob.send({ type: 'player_action', action: 'call' })
    }
    expect(state(bob).actingPlayerId).toBe(alice.playerId)
    expect(state(bob).phase).toBe('in_hand')

    vi.advanceTimersByTime(PASS_OUT_FOLD_DELAY_MS + 10)
    const afterFold = state(bob)
    expect(afterFold.phase).toBe('between_hands')
    expect(afterFold.players.find(player => player.id === alice.playerId)?.status).toBe('folded')
    expect(afterFold.winners?.[0]?.playerId).toBe(bob.playerId)
    // The fold was recorded by the ordinary fold bookkeeping.
    expect(afterFold.players.find(player => player.id === alice.playerId)?.stats?.folds).toBe(1)

    // Passed-out players cannot keep drinking.
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    alice.send({ type: 'order_drink', kind: 'water' })
    expect(last(alice.connection, 'action_failed')?.message).toContain('passed out')

    alice.send({ type: 'start_game' })
    expect(state(bob).handNumber).toBe(2)
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({
      level: WAKE_UP_LEVEL,
      passedOut: false,
      beers: 10,
    })
    expect(drinkEvents(bob.connection).at(-1)).toMatchObject({ kind: 'woke_up', level: WAKE_UP_LEVEL })
  })

  it('folds immediately when the passed-out player is the one to act', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    orderBeers(alice, 9)
    orderBeers(bob, 9)
    alice.send({ type: 'start_game' })
    const actor = state(alice).actingPlayerId === alice.playerId ? alice : bob
    const other = actor === alice ? bob : alice

    actor.send({ type: 'order_drink', kind: 'beer' })
    expect(state(other).actingPlayerId).toBe(actor.playerId)
    vi.advanceTimersByTime(PASS_OUT_FOLD_DELAY_MS + 10)
    expect(state(other).phase).toBe('between_hands')
    expect(state(other).players.find(player => player.id === actor.playerId)?.status).toBe('folded')
  })

  it('sleeps through the whole next hand when passing out between hands', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    orderBeers(bob, 10)
    expect(seatState(alice, bob.playerId)?.drinks?.passedOut).toBe(true)

    alice.send({ type: 'start_game' })
    expect(seatState(alice, bob.playerId)?.drinks?.passedOut).toBe(true)
    if (state(alice).actingPlayerId === alice.playerId) {
      alice.send({ type: 'player_action', action: 'call' })
    }
    vi.advanceTimersByTime(PASS_OUT_FOLD_DELAY_MS + 10)
    expect(state(alice).phase).toBe('between_hands')
    expect(state(alice).players.find(player => player.id === bob.playerId)?.status).toBe('folded')

    alice.send({ type: 'start_game' })
    expect(seatState(alice, bob.playerId)?.drinks).toMatchObject({ passedOut: false, level: WAKE_UP_LEVEL })
  })

  it('forgets drink state when a player leaves', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    bob.send({ type: 'order_drink', kind: 'water' })
    bob.send({ type: 'leave_room' })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 10)
    expect(seatState(alice, bob.playerId)).toBeUndefined()
    expect(drinkEvents(alice.connection).some(event => event.kind === 'water_kicked_in')).toBe(false)
  })
})
