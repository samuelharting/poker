import { describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import { parseC2S, type C2SMessage, type S2CMessage } from '@/shared/protocol'

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

function createRoom() {
  const connections = new Map<string, Connection>()
  const room = {
    id: 'LUCK01',
    internalID: 'internal-luck',
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
  const join = (id: string, nickname: string, seatIndex: number) => {
    const connection = new MockConnection(id) as unknown as Connection
    connections.set(id, connection)
    server.onConnect(connection)
    const send = (message: C2SMessage) => server.onMessage(JSON.stringify(message), connection)
    send({ type: 'join_room', nickname })
    send({ type: 'seat_me', seatIndex })
    const messages = (connection as unknown as MockConnection).messages
    const session = [...messages].reverse().find(message => message.type === 'private_session')
    if (session?.type !== 'private_session') throw new Error('missing session')
    return { connection, playerId: session.yourId }
  }
  return { server, join }
}

type Internals = {
  data: {
    gameState: {
      phase: string
      handNumber: number
      players: Array<{ id: string; holeCards: unknown[]; status: string; totalInPot: number }>
      winners?: Array<{ playerId: string; amount: number }>
    }
  }
  recordHandsPlayedForCurrentHand: () => void
  recordCompletedHandStats: () => void
  buildSnapshotFor: (connId: string) => Extract<S2CMessage, { type: 'room_snapshot' }>
}

describe('PokerRoom Lady Luck companion', () => {
  it('publishes her in the table snapshot after two straight wins and sulks her off on a loss', () => {
    const { server, join } = createRoom()
    const ann = join('ann', 'Ann', 0)
    const bob = join('bob', 'Bob', 1)
    const internals = server as unknown as Internals

    const playHand = (handNumber: number, winnerId: string, amount = 80) => {
      internals.data.gameState.phase = 'between_hands'
      internals.data.gameState.handNumber = handNumber
      for (const player of internals.data.gameState.players) {
        player.holeCards = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]
        player.status = 'active'
        player.totalInPot = 40
      }
      internals.data.gameState.winners = [{ playerId: winnerId, amount }]
      internals.recordHandsPlayedForCurrentHand()
      internals.recordCompletedHandStats()
      // Idempotent: the room calls this from several code paths.
      internals.recordCompletedHandStats()
    }

    playHand(1, ann.playerId)
    expect(internals.buildSnapshotFor(bob.connection.id).state.companion).toBeNull()

    playHand(2, ann.playerId)
    const arrived = internals.buildSnapshotFor(bob.connection.id).state.companion
    expect(arrived).toMatchObject({ ownerId: ann.playerId, reason: 'streak', streak: 2, mood: 'arrive' })
    // Everybody at the table sees the same companion.
    expect(internals.buildSnapshotFor(ann.connection.id).state.companion).toEqual(arrived)

    playHand(3, bob.playerId)
    expect(internals.buildSnapshotFor(ann.connection.id).state.companion).toMatchObject({
      id: arrived!.id,
      ownerId: ann.playerId,
      mood: 'sulk_leave',
    })

    playHand(4, bob.playerId)
    // Bob has two in a row now; the sulking companion was cleared at the deal and Bob earns a fresh one.
    const bobs = internals.buildSnapshotFor(ann.connection.id).state.companion
    expect(bobs).toMatchObject({ ownerId: bob.playerId, mood: 'arrive' })
    expect(bobs!.id).not.toBe(arrived!.id)
  })

  it('lets only her owner tell her to shut up, and resets that when she reappears', () => {
    const { server, join } = createRoom()
    const ann = join('ann', 'Ann', 0)
    const bob = join('bob', 'Bob', 1)
    const internals = server as unknown as Internals
    const playHand = (handNumber: number, winnerId: string) => {
      internals.data.gameState.phase = 'between_hands'
      internals.data.gameState.handNumber = handNumber
      for (const player of internals.data.gameState.players) {
        player.holeCards = [{ rank: 'Q', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }]
        player.status = 'active'
      }
      internals.data.gameState.winners = [{ playerId: winnerId, amount: 60 }]
      internals.recordHandsPlayedForCurrentHand()
      internals.recordCompletedHandStats()
    }
    const mute = (connection: Connection) => server.onMessage(JSON.stringify({ type: 'companion_mute' }), connection)
    const companion = () => internals.buildSnapshotFor(bob.connection.id).state.companion

    playHand(1, ann.playerId)
    playHand(2, ann.playerId)
    expect(companion()).toMatchObject({ ownerId: ann.playerId, muted: false })

    mute(bob.connection)
    expect(companion()?.muted).toBe(false)
    mute(ann.connection)
    expect(companion()?.muted).toBe(true)
    // The mute is broadcast to the whole table.
    const lastSnapshot = [...(bob.connection as unknown as MockConnection).messages]
      .reverse()
      .find(message => message.type === 'room_snapshot')
    expect(lastSnapshot?.type === 'room_snapshot' && lastSnapshot.state.companion?.muted).toBe(true)

    playHand(3, bob.playerId)
    playHand(4, bob.playerId)
    expect(companion()).toMatchObject({ ownerId: bob.playerId, muted: false })
  })
})

describe('companion_mute protocol', () => {
  it('parses the owner mute request and rejects junk', () => {
    expect(parseC2S(JSON.stringify({ type: 'companion_mute' }))).toEqual({ type: 'companion_mute' })
    expect(parseC2S(JSON.stringify({ type: 'companion_mute', extra: 'ignored' }))).toEqual({ type: 'companion_mute' })
    expect(parseC2S('{"type":"companion_muted"}')).toBeNull()
  })
})
