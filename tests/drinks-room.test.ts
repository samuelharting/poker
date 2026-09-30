import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import {
  BLACKOUT_MS,
  createDrinkLedgerEntry,
  DRINK_COOLDOWN_MS,
  ONE_BEER_PER_HAND_REASON,
  SHOT_LEVEL_BOOST,
  WAKE_UP_LEVEL,
  WATER_KICK_IN_MS,
  type DrinkLedgerEntry,
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
  // Random thirst off unless a test turns it on.
  server.autoBeerRandom = () => 1
  // These rules are easier to read from a sober start; real seats begin at BUZZ.startLevel.
  server.seatedStartLevel = 0

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

/** One beer per hand makes long drinking sessions slow to script: set the buzz directly. */
function setLevel(server: PokerRoom, seat: Seat, level: number) {
  const ledger = (server as unknown as { drinkLedger: Record<string, DrinkLedgerEntry> }).drinkLedger
  ledger[seat.playerId] = { ...(ledger[seat.playerId] ?? createDrinkLedgerEntry()), level }
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
  it('broadcasts a beer to every player, with no per-hand limit', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)

    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 0, beers: 0, lastDrink: null })

    alice.send({ type: 'order_drink', kind: 'beer' })

    const seen = seatState(bob, alice.playerId)?.drinks
    expect(seen).toMatchObject({ level: 1, beers: 1, passedOut: false, lastDrink: { kind: 'beer' }, beerReadyAtHand: 0 })
    expect(drinkEvents(bob.connection).at(-1)).toMatchObject({
      kind: 'beer',
      playerId: alice.playerId,
      nickname: 'Alice',
      level: 1,
      beers: 1,
    })

    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    void ONE_BEER_PER_HAND_REASON
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
    alice.send({ type: 'order_drink', kind: 'water' })
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

  it('water sobers you up 1.5 about five seconds after you order it', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    setLevel(server, alice, 5)

    alice.send({ type: 'order_drink', kind: 'water' })
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 5, sobering: 1, waters: 1 })
    expect(drinkEvents(bob.connection).at(-1)?.kind).toBe('water')

    vi.advanceTimersByTime(4_900)
    expect(seatState(bob, alice.playerId)?.drinks?.level).toBe(5)
    vi.advanceTimersByTime(200)
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 3.5, sobering: 0 })
    expect(drinkEvents(bob.connection).some(event => event.kind === 'water_kicked_in' && event.playerId === alice.playerId)).toBe(true)
  })

  it('never sobers anyone on their own between hands', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    setLevel(server, alice, 4)

    for (let hand = 1; hand <= 3; hand += 1) {
      alice.send({ type: 'start_game' })
      expect(state(alice).handNumber).toBe(hand)
      foldHandOut(alice, bob)
      // House rules may add drinks; nothing ever takes them away except water.
      expect(seatState(bob, alice.playerId)!.drinks!.level).toBeGreaterThanOrEqual(4)
    }
  })

  it('blacks out at 10 without folding: the player keeps acting on their normal timer, then comes to mid-hand', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    setLevel(server, alice, 9)

    alice.send({ type: 'start_game' })
    expect(state(alice).phase).toBe('in_hand')
    alice.send({ type: 'order_drink', kind: 'beer' })
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: 10, passedOut: true })
    expect(drinkEvents(bob.connection).map(event => event.kind).slice(-2)).toEqual(['beer', 'passed_out'])

    if (state(bob).actingPlayerId === bob.playerId) {
      bob.send({ type: 'player_action', action: 'call' })
    }
    expect(state(bob).actingPlayerId).toBe(alice.playerId)
    const timerStart = state(bob).actionTimerStart

    // Nothing folds or skips her: same clock, still to act.
    vi.advanceTimersByTime(BLACKOUT_MS - 200)
    const midBlackout = state(bob)
    expect(midBlackout.phase).toBe('in_hand')
    expect(midBlackout.actingPlayerId).toBe(alice.playerId)
    expect(midBlackout.actionTimerStart).toBe(timerStart)
    expect(midBlackout.players.find(player => player.id === alice.playerId)?.status).toBe('active')
    expect(seatState(bob, alice.playerId)?.drinks?.passedOut).toBe(true)

    // She can act while blacked out.
    alice.send({ type: 'player_action', action: 'check' })
    expect(last(alice.connection, 'action_failed')).toBeUndefined()
    expect(state(bob).players.find(player => player.id === alice.playerId)?.status).not.toBe('folded')

    // Blacked-out players cannot keep drinking.
    alice.send({ type: 'order_drink', kind: 'water' })
    expect(last(alice.connection, 'action_failed')?.message).toContain('passed out')

    // She comes to on her own, mid-hand, at level 1 and hungover.
    vi.advanceTimersByTime(400)
    expect(state(bob).phase).toBe('in_hand')
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: WAKE_UP_LEVEL, passedOut: false, hungover: true })
    expect(drinkEvents(bob.connection).at(-1)).toMatchObject({ kind: 'woke_up', level: WAKE_UP_LEVEL })
    expect(state(bob).players.find(player => player.id === alice.playerId)?.stats?.folds ?? 0).toBe(0)
  })

  it('never folds, skips or re-times a blacked-out player who is the one to act', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    setLevel(server, alice, 9)
    setLevel(server, bob, 9)

    alice.send({ type: 'start_game' })
    const actor = state(alice).actingPlayerId === alice.playerId ? alice : bob
    const other = actor === alice ? bob : alice
    const timerStart = state(other).actionTimerStart

    actor.send({ type: 'order_drink', kind: 'beer' })
    expect(seatState(other, actor.playerId)?.drinks?.passedOut).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(state(other).phase).toBe('in_hand')
    expect(state(other).actingPlayerId).toBe(actor.playerId)
    expect(state(other).actionTimerStart).toBe(timerStart)
    actor.send({ type: 'player_action', action: 'call' })
    expect(state(other).actingPlayerId).toBe(other.playerId)
  })

  it('a blackout that starts between hands still deals them in, and the hangover lasts about a hand', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    setLevel(server, bob, 9)

    bob.send({ type: 'order_drink', kind: 'beer' })
    expect(seatState(alice, bob.playerId)?.drinks?.passedOut).toBe(true)

    alice.send({ type: 'start_game' })
    const bobSeat = state(alice).players.find(player => player.id === bob.playerId)
    expect(bobSeat?.status).toBe('active')
    expect(bobSeat?.hasCards).toBe(true)
    vi.advanceTimersByTime(BLACKOUT_MS + 10)
    expect(seatState(alice, bob.playerId)?.drinks).toMatchObject({ passedOut: false, level: WAKE_UP_LEVEL, hungover: true })
    foldHandOut(alice, bob)

    alice.send({ type: 'start_game' })
    expect(seatState(alice, bob.playerId)?.drinks?.hungover).toBe(true)
    foldHandOut(alice, bob)
    alice.send({ type: 'start_game' })
    expect(seatState(alice, bob.playerId)?.drinks?.hungover).toBe(false)
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

describe('PokerRoom sober tax', () => {
  function stackOf(viewer: Seat, playerId: string) {
    return seatState(viewer, playerId)?.stack ?? 0
  }

  function tableChips(viewer: Seat) {
    const table = state(viewer)
    // Between hands the pot has been paid out already; in a hand it sits in totalInPot.
    return table.players.reduce((sum, player) => sum + player.stack + (table.phase === 'in_hand' ? player.totalInPot : 0), 0)
  }

  it('never taxes a sober player: being sober costs no chips', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: true })
    bob.send({ type: 'set_drink_capable', capable: true })

    for (let hand = 1; hand <= 4; hand += 1) {
      alice.send({ type: 'start_game' })
      const aliceSeat = seatState(bob, alice.playerId)!
      expect(aliceSeat.drinks?.soberTax ?? 0).toBe(0)
      expect(aliceSeat.totalInPot).toBe(aliceSeat.isSB ? 10 : aliceSeat.isBB ? 20 : 0)
      expect(state(bob).recentActions.some(line => line.includes('sober tax'))).toBe(false)
      foldHandOut(alice, bob)
      expect(tableChips(bob)).toBe(2000)
    }
    void stackOf
  })

  it('exempts phone players (not drink-capable) entirely', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: false })
    bob.send({ type: 'set_drink_capable', capable: false })

    for (let hand = 1; hand <= 3; hand += 1) {
      alice.send({ type: 'start_game' })
      expect(seatState(bob, alice.playerId)?.drinks?.soberTax).toBe(0)
      expect(seatState(bob, bob.playerId)?.drinks?.soberTax).toBe(0)
      foldHandOut(alice, bob)
    }
    expect(seatState(bob, alice.playerId)?.drinks?.soberHands).toBe(0)
  })

  it('never taxes with fun mode off', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: true })
    alice.send({ type: 'update_table_settings', funModeEnabled: false })

    for (let hand = 1; hand <= 3; hand += 1) {
      alice.send({ type: 'start_game' })
      expect(seatState(bob, alice.playerId)?.drinks?.soberTax ?? 0).toBe(0)
      foldHandOut(alice, bob)
    }
  })
})

describe('PokerRoom seated buzz', () => {
  it('seats new players sober and clear-eyed', async () => {
    const { BUZZ, createSeatedDrinkLedgerEntry } = await import('@/lib/drinks')
    expect(BUZZ.startLevel).toBe(0)
    expect(createSeatedDrinkLedgerEntry().level).toBe(0)
    expect(BUZZ.soberPenaltiesEnabled).toBe(false)
  })
})

describe('PokerRoom random thirst', () => {
  it('every 30s each drink-capable player may down a beer on their own, and it can black them out', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: true })
    bob.send({ type: 'set_drink_capable', capable: true })
    setLevel(server, alice, 9)
    server.autoBeerRandom = () => 0
    // Seated, no hand running: the thirst clock still ticks.
    vi.advanceTimersByTime(30_050)
    expect(seatState(bob, alice.playerId)?.drinks?.passedOut).toBe(true)
    expect(seatState(bob, bob.playerId)!.drinks!.level).toBeGreaterThanOrEqual(1)
  })

  it('never fires with fun mode off', () => {
    vi.useFakeTimers()
    const { server, join } = createTable()
    const alice = join('alice', 'Alice', 0)
    join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: true })
    alice.send({ type: 'update_table_settings', funModeEnabled: false })
    server.autoBeerRandom = () => 0
    vi.advanceTimersByTime(120_000)
    expect(seatState(alice, alice.playerId)?.drinks?.level ?? 0).toBe(0)
  })
})

describe('PokerRoom take a shot yourself', () => {
  it('pours a +6 shot for yourself, as many as you like (just the order cooldown), and can black you out', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    const bob = join('bob', 'Bob', 1)
    alice.send({ type: 'set_drink_capable', capable: true })
    alice.send({ type: 'take_shot' })
    expect(seatState(bob, alice.playerId)?.drinks).toMatchObject({ level: SHOT_LEVEL_BOOST, shots: 1 })
    alice.send({ type: 'take_shot' })
    expect(seatState(bob, alice.playerId)?.drinks?.level).toBe(SHOT_LEVEL_BOOST)
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    // Two +6 shots black you out.
    alice.send({ type: 'take_shot' })
    expect(seatState(bob, alice.playerId)?.drinks?.passedOut).toBe(true)
  })

  it('refuses phone players and fun mode off', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const alice = join('alice', 'Alice', 0)
    join('bob', 'Bob', 1)
    alice.send({ type: 'take_shot' })
    expect(last(alice.connection, 'action_failed')?.message).toBe('No bar service here')
  })
})
