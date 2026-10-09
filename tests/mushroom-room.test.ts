import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import { createDrinkLedgerEntry, DRINK_COOLDOWN_MS, WATER_KICK_IN_MS, type DrinkLedgerEntry } from '@/lib/drinks'
import {
  giveMushroom,
  maybeSpawnMushroom,
  createMushroomTable,
  MUSHROOM_AUTO_SPIKE_MS,
  MUSHROOM_SPAWN_EVERY_HANDS,
  MUSHROOM_SPAWN_JITTER_HANDS,
  TRIP_HANDS,
  type MushroomTable,
} from '@/lib/mushroom'
import type { C2SMessage, S2CMessage } from '@/shared/protocol'

type TypedMessage<T extends S2CMessage['type']> = Extract<S2CMessage, { type: T }>

class MockConnection {
  readyState = 1
  socket = this
  state: unknown = null
  messages: S2CMessage[] = []
  constructor(readonly id: string, readonly uri = `ws://mock/${id}`) {}
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

interface Internals {
  mushrooms: MushroomTable
  mushroomRandom: () => number
  drinkLedger: Record<string, DrinkLedgerEntry>
}

function createTable() {
  const connections = new Map<string, Connection>()
  const room = {
    id: 'SHROOM',
    internalID: 'internal-shroom',
    name: 'main',
    env: {},
    storage: { setAlarm: vi.fn(), deleteAlarm: vi.fn() },
    context: { parties: {} },
    getConnection: (id: string) => connections.get(id),
    getConnections: () => connections.values(),
    broadcast: () => {},
  }
  const server = new PokerRoom(room as unknown as Room)
  // Random thirst off unless a test turns it on.
  server.autoBeerRandom = () => 1
  const internals = server as unknown as Internals
  // Deterministic: first human candidate, first eligible target.
  internals.mushroomRandom = () => 0

  const join = (id: string, nickname: string, seatIndex: number, { capable = true, uri }: { capable?: boolean; uri?: string } = {}): Seat => {
    const connection = new MockConnection(id, uri) as unknown as Connection
    connections.set(id, connection)
    server.onConnect(connection)
    const send = (message: C2SMessage) => server.onMessage(JSON.stringify(message), connection)
    send({ type: 'join_room', nickname })
    send({ type: 'seat_me', seatIndex })
    send({ type: 'set_drink_capable', capable })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('missing session')
    return { connection, playerId: session.yourId, send }
  }

  const leave = (seat: Seat) => {
    seat.send({ type: 'leave_room' })
    connections.delete((seat.connection as unknown as MockConnection).id)
  }

  return { server, internals, join, leave }
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

function mushroomEvents(connection: Connection) {
  return messagesOf(connection)
    .filter((message): message is TypedMessage<'mushroom_event'> => message.type === 'mushroom_event')
    .map(message => message.event)
}

function state(viewer: Seat) {
  return last(viewer.connection, 'room_snapshot')!.state
}

function seatOf(viewer: Seat, playerId: string) {
  return state(viewer).players.find(player => player.id === playerId)
}

/** Whoever is acting folds until the hand is over. */
function finishHand(seats: Seat[]) {
  const viewer = seats[0]!
  for (let guard = 0; guard < 12 && state(viewer).phase === 'in_hand'; guard += 1) {
    const acting = state(viewer).actingPlayerId
    seats.find(seat => seat.playerId === acting)?.send({ type: 'player_action', action: 'fold' })
  }
  expect(state(viewer).phase).toBe('between_hands')
}

function everythingSentTo(connection: Connection): string {
  return JSON.stringify(messagesOf(connection))
}

/** Makes the next hand spawn a mushroom. */
function dueNow(internals: Internals) {
  internals.mushrooms.nextSpawnHand = 0
}

afterEach(() => {
  vi.useRealTimers()
})

describe('mushroom (pill) rules', () => {
  it('spawns every ~30 hands, only one at a time, and only for someone who can drink', () => {
    const table = createMushroomTable(() => 0.5)
    expect(table.nextSpawnHand).toBe(MUSHROOM_SPAWN_EVERY_HANDS)
    const low = createMushroomTable(() => 0)
    expect(low.nextSpawnHand).toBe(MUSHROOM_SPAWN_EVERY_HANDS - MUSHROOM_SPAWN_JITTER_HANDS)

    const candidates = [{ id: 'a', isBot: false }, { id: 'b', isBot: false }]
    expect(maybeSpawnMushroom(table, 10, candidates, () => 0)).toBeNull()
    expect(maybeSpawnMushroom(table, 30, [{ id: 'bot', isBot: true }], () => 0)).toBeNull()
    expect(maybeSpawnMushroom(table, 30, candidates, () => 0)).toBe('a')
    // Exactly one: nothing else spawns while it exists.
    expect(maybeSpawnMushroom(table, 90, candidates, () => 0)).toBeNull()
  })
})

describe('PokerRoom mushroom (pill)', () => {
  it('gives it to one player privately, pre-selects a target and keeps it secret from everyone else', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    const carol = join('carol', 'Carol', 2)
    dueNow(internals)

    alice.send({ type: 'start_game' })
    const holder = internals.mushrooms.mushroom
    expect(holder?.status).toBe('held')
    const holderSeat = [alice, bob, carol].find(seat => holder?.status === 'held' && seat.playerId === holder.holderId)!
    const others = [alice, bob, carol].filter(seat => seat !== holderSeat)

    expect(mushroomEvents(holderSeat.connection).map(event => event.kind)).toEqual(['found'])
    const session = last(holderSeat.connection, 'private_session')
    expect(session?.mushroom?.status).toBe('holding')
    for (const other of others) {
      expect(mushroomEvents(other.connection)).toHaveLength(0)
      expect(last(other.connection, 'private_session')?.mushroom).toBeUndefined()
    }

    // Spike it: still secret.
    const victim = others[0]!
    holderSeat.send({ type: 'spike_water', targetId: victim.playerId })
    expect(last(holderSeat.connection, 'private_session')?.mushroom).toEqual({ status: 'spiked', victimId: victim.playerId })
    expect(mushroomEvents(holderSeat.connection).at(-1)?.kind).toBe('spiked')
    for (const other of others) {
      expect(mushroomEvents(other.connection)).toHaveLength(0)
      expect(everythingSentTo(other.connection)).not.toContain('spiked')
      expect(everythingSentTo(other.connection)).not.toContain('"mushroom"')
      expect(everythingSentTo(other.connection)).not.toContain('"trip"')
    }
  })

  it('arms a 15s auto-spike on the pre-selected target once the holder is not acting', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    dueNow(internals)

    alice.send({ type: 'start_game' })
    const held = internals.mushrooms.mushroom
    if (held?.status !== 'held') throw new Error('expected a held mushroom')
    const holder = held.holderId === alice.playerId ? alice : bob
    const other = holder === alice ? bob : alice
    expect(held.suggestedVictimId).toBe(other.playerId)
    // Holding back while it's their turn.
    if (state(alice).actingPlayerId === holder.playerId) {
      expect(held.autoSpikeAt).toBeNull()
      holder.send({ type: 'player_action', action: 'call' })
    }
    expect(internals.mushrooms.mushroom?.status === 'held' && internals.mushrooms.mushroom.autoSpikeAt).toBeGreaterThan(0)
    vi.advanceTimersByTime(MUSHROOM_AUTO_SPIKE_MS + 20)
    expect(internals.mushrooms.mushroom).toMatchObject({ status: 'spiked', victimId: other.playerId })
    expect(last(holder.connection, 'private_session')?.mushroom).toEqual({ status: 'spiked', victimId: other.playerId })
  })

  it("turns the victim's next water into a trip, queued while they're live, revealed to everyone when it starts", () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    const carol = join('carol', 'Carol', 2)
    internals.drinkLedger[bob.playerId] = { ...createDrinkLedgerEntry(), level: 5 }
    dueNow(internals)
    alice.send({ type: 'start_game' })
    const held = internals.mushrooms.mushroom
    if (held?.status !== 'held') throw new Error('expected a held mushroom')
    expect(held.holderId).toBe(alice.playerId)
    alice.send({ type: 'spike_water', targetId: bob.playerId })

    // Bob is live in the hand: he orders a water.
    expect(seatOf(alice, bob.playerId)?.status).toBe('active')
    bob.send({ type: 'order_drink', kind: 'water' })
    // It doesn't sober him (not even next hand) and nothing is revealed yet.
    expect(seatOf(alice, bob.playerId)?.drinks).toMatchObject({ sobering: 0, waterNextHand: 0 })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 20)
    expect(internals.mushrooms.trip).toMatchObject({ victimId: bob.playerId, queued: true })
    expect(seatOf(carol, bob.playerId)?.trip).toBeUndefined()
    expect(mushroomEvents(carol.connection)).toHaveLength(0)
    // The mushroom itself is gone: nobody can hold another one.
    expect(internals.mushrooms.mushroom).toBeNull()
    expect(last(alice.connection, 'private_session')?.mushroom).toBeUndefined()

    // Bob folds: the trip starts and everyone learns who did it.
    for (let guard = 0; guard < 6 && seatOf(alice, bob.playerId)?.status === 'active'; guard += 1) {
      const acting = state(alice).actingPlayerId
      const actor = [alice, bob, carol].find(seat => seat.playerId === acting)!
      actor.send({ type: 'player_action', action: actor === bob ? 'fold' : 'call' })
    }
    expect(seatOf(alice, bob.playerId)?.status).toBe('folded')
    const reveal = mushroomEvents(carol.connection).at(-1)
    expect(reveal).toMatchObject({ kind: 'trip_started', spikerNickname: 'Alice', victimNickname: 'Bob' })
    expect(mushroomEvents(bob.connection).at(-1)?.kind).toBe('trip_started')
    const startHand = state(carol).handNumber
    const trip = seatOf(carol, bob.playerId)?.trip
    expect(trip?.endsAfterHand).toBe(startHand + TRIP_HANDS)
    // His level never moved: the spiked water did nothing else.
    expect(seatOf(carol, bob.playerId)?.drinks?.level).toBe(5)

    // It lasts the rest of this hand plus three full hands, whatever the clock says.
    finishHand([alice, bob, carol])
    for (let hand = 1; hand <= TRIP_HANDS; hand += 1) {
      expect(seatOf(carol, bob.playerId)?.trip).toBeDefined()
      alice.send({ type: 'start_game' })
      expect(state(alice).handNumber).toBe(startHand + hand)
      expect(seatOf(carol, bob.playerId)?.trip).toBeDefined()
      finishHand([alice, bob, carol])
    }
    expect(seatOf(carol, bob.playerId)?.trip).toBeUndefined()
    expect(mushroomEvents(carol.connection).at(-1)?.kind).toBe('trip_ended')
    expect(internals.mushrooms.trip).toBeNull()
    // The next one is ~30 hands out.
    expect(internals.mushrooms.nextSpawnHand).toBeGreaterThanOrEqual(state(alice).handNumber + MUSHROOM_SPAWN_EVERY_HANDS - MUSHROOM_SPAWN_JITTER_HANDS)
  })

  it('never folds, skips or sits out the tripping player', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    dueNow(internals)
    alice.send({ type: 'start_game' })
    alice.send({ type: 'spike_water', targetId: bob.playerId })
    finishHand([alice, bob])
    bob.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 20)
    expect(seatOf(alice, bob.playerId)?.trip).toBeDefined()

    alice.send({ type: 'start_game' })
    expect(seatOf(alice, bob.playerId)?.status).toBe('active')
    expect(seatOf(alice, bob.playerId)?.hasCards).toBe(true)
    const acting = state(alice).actingPlayerId
    const timerStart = state(alice).actionTimerStart
    vi.advanceTimersByTime(2_000)
    expect(state(alice).actingPlayerId).toBe(acting)
    expect(state(alice).actionTimerStart).toBe(timerStart)
  })

  it('returns to nobody and respawns later when the victim leaves', () => {
    vi.useFakeTimers()
    const { internals, join, leave } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    const carol = join('carol', 'Carol', 2)
    dueNow(internals)
    alice.send({ type: 'start_game' })
    alice.send({ type: 'spike_water', targetId: bob.playerId })
    finishHand([alice, bob, carol])
    leave(bob)
    expect(internals.mushrooms.mushroom).toBeNull()
    expect(internals.mushrooms.trip).toBeNull()
    expect(internals.mushrooms.nextSpawnHand).toBeGreaterThan(state(alice).handNumber)
  })

  it('never gives it to, or lets anyone spike, a phone player', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const phone = join('phone', 'Phone', 1, { capable: false })
    const bob = join('bob', 'Bob', 2)
    dueNow(internals)
    // Random 0 would pick the first human; make the phone player first in line.
    internals.mushroomRandom = () => 0.4
    alice.send({ type: 'start_game' })
    const held = internals.mushrooms.mushroom
    expect(held?.status).toBe('held')
    expect(held?.status === 'held' && held.holderId).not.toBe(phone.playerId)
    const holder = [alice, bob].find(seat => held?.status === 'held' && seat.playerId === held.holderId)!
    expect(held?.status === 'held' && held.suggestedVictimId).not.toBe(phone.playerId)
    holder.send({ type: 'spike_water', targetId: phone.playerId })
    expect(last(holder.connection, 'action_failed')?.message).toBeTruthy()
    expect(internals.mushrooms.mushroom?.status).toBe('held')
  })

  it('drinking off keeps the mushroom and the trip, and a spike skips the water', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    dueNow(internals)
    alice.send({ type: 'start_game' })
    alice.send({ type: 'spike_water', targetId: bob.playerId })
    finishHand([alice, bob])
    bob.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 20)
    expect(seatOf(alice, bob.playerId)?.trip).toBeDefined()

    alice.send({ type: 'update_table_settings', funModeEnabled: false })
    expect(seatOf(alice, bob.playerId)?.trip).toBeDefined()
    expect(internals.mushrooms.trip).not.toBeNull()

    // New mushrooms still spawn while drinking is off.
    internals.mushrooms.trip = null
    dueNow(internals)
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    alice.send({ type: 'start_game' })
    expect(internals.mushrooms.mushroom).not.toBeNull()
  })

  it('with drinking off a spike starts the trip directly (no water to order)', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'update_table_settings', funModeEnabled: false })
    giveMushroom(internals.mushrooms, alice.playerId, 0)
    alice.send({ type: 'spike_water', targetId: bob.playerId })
    expect(last(alice.connection, 'action_failed')?.message ?? '').not.toContain('Drinking')
    expect(internals.mushrooms.mushroom).toBeNull()
    expect(seatOf(alice, bob.playerId)?.trip).toBeDefined()
    bob.send({ type: 'order_drink', kind: 'water' })
    expect(last(bob.connection, 'action_failed')?.message).toBe('Drinking is off at this table')
  })

  it('ignores the dev shortcuts from a non-local connection and honours them locally', () => {
    vi.useFakeTimers()
    const { internals, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1, { uri: 'ws://localhost:1999/parties/main/shroom' })
    alice.send({ type: 'dev_fun', action: 'mushroom' })
    expect(internals.mushrooms.mushroom).toBeNull()
    bob.send({ type: 'dev_fun', action: 'mushroom' })
    expect(internals.mushrooms.mushroom).toMatchObject({ status: 'held', holderId: bob.playerId })
  })
})
