import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom, { AUTO_START_DELAY } from '@/partykit/room'
import type { C2SMessage, S2CMessage } from '@/shared/protocol'
import type { TableState } from '@/lib/poker/types'

class MockConnection {
  readonly uri: string
  readyState = 1
  state: unknown = null
  messages: S2CMessage[] = []

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
  readonly id = 'QAROOM'
  readonly storage = { setAlarm: vi.fn(), deleteAlarm: vi.fn() } as unknown as Room['storage']
  readonly connections = new Map<string, Connection>()

  getConnection(id: string) {
    return this.connections.get(id)
  }

  getConnections() {
    return this.connections.values()
  }
}

interface Client {
  connection: Connection
  id: string
}

function harness() {
  const room = new MockRoom()
  const server = new PokerRoom(room as unknown as Room)

  const send = (client: Client | Connection, message: C2SMessage) => {
    const connection = 'connection' in client ? client.connection : client
    server.onMessage(JSON.stringify(message), connection)
  }

  const join = (connectionId: string, nickname: string, seatIndex?: number): Client => {
    const connection = new MockConnection(connectionId) as unknown as Connection
    room.connections.set(connectionId, connection)
    server.onConnect(connection)
    send(connection, { type: 'join_room', nickname })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('no session')
    const client = { connection, id: session.yourId }
    send(client, { type: 'seat_me', seatIndex })
    return client
  }

  return { room, server, send, join }
}

function last<T extends S2CMessage['type']>(connection: Connection, type: T) {
  const messages = (connection as unknown as MockConnection).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.type === type) return messages[index] as Extract<S2CMessage, { type: T }>
  }
  return undefined
}

function snapshot(client: Client): TableState {
  const state = last(client.connection, 'room_snapshot')?.state
  if (!state) throw new Error('no snapshot')
  return state
}

function failure(client: Client) {
  return last(client.connection, 'action_failed')?.message
}

afterEach(() => {
  vi.useRealTimers()
})

describe('raising the blinds', () => {
  it('posts the new blinds on the next auto-dealt hand and bounds the raise sizing', () => {
    vi.useFakeTimers()
    const { send, join } = harness()
    const host = join('h', 'Host', 0)
    const guest = join('g', 'Guest', 1)
    send(host, { type: 'start_game' })

    send(host, { type: 'update_table_settings', smallBlind: 50, bigBlind: 100, startingStack: 2_000 })
    expect(snapshot(guest).bigBlind).toBe(20)

    const actor = snapshot(host).actingPlayerId === host.id ? host : guest
    send(actor, { type: 'player_action', action: 'fold' })
    expect(snapshot(guest).bigBlind).toBe(100)

    vi.advanceTimersByTime(AUTO_START_DELAY + 50)
    const next = snapshot(guest)
    expect(next.handNumber).toBe(2)
    expect(next.phase).toBe('in_hand')
    const sb = next.players.find(player => player.isSB)!
    const bb = next.players.find(player => player.isBB)!
    expect(sb.bet).toBe(50)
    expect(bb.bet).toBe(100)
    expect(next.minRaise).toBe(200)

    // A raise below the new minimum is refused.
    const nextActor = next.actingPlayerId === host.id ? host : guest
    send(nextActor, { type: 'player_action', action: 'raise', amount: 150 })
    expect(failure(nextActor)).toMatch(/Minimum raise is \$200/)
  })

  it('rejects a big blind smaller than the small blind and non-host changes', () => {
    const { send, join } = harness()
    const host = join('h', 'Host', 0)
    const guest = join('g', 'Guest', 1)
    send(host, { type: 'update_table_settings', smallBlind: 40, bigBlind: 20 })
    expect(failure(host)).toMatch(/Use valid blinds/)
    send(guest, { type: 'update_table_settings', smallBlind: 25, bigBlind: 50 })
    expect(failure(guest)).toBe('Only the game creator can change table settings.')
    expect(snapshot(host).bigBlind).toBe(20)
  })
})

describe('heads-up at the room level', () => {
  it('the button is the small blind and acts first preflop', () => {
    const { send, join } = harness()
    const host = join('h', 'Host', 0)
    const guest = join('g', 'Guest', 1)
    send(host, { type: 'start_game' })
    const state = snapshot(host)
    const button = state.players.find(player => player.isDealer)!
    expect(button.isSB).toBe(true)
    expect(state.actingPlayerId).toBe(button.id)
    expect(snapshot(guest).players.find(player => player.isBB)?.id).not.toBe(button.id)
  })
})

describe('card reveal permissions', () => {
  function threeHanded() {
    const h = harness()
    const a = h.join('a', 'Ann', 0)
    const b = h.join('b', 'Ben', 1)
    const c = h.join('c', 'Cat', 2)
    h.send(a, { type: 'start_game' })
    return { ...h, a, b, c }
  }

  it('only a folded player can ask', () => {
    const { send, a, b, c } = threeHanded()
    const acting = [a, b, c].find(client => client.id === snapshot(a).actingPlayerId)!
    const waiting = [a, b, c].find(client => client !== acting)!
    const target = [a, b, c].find(client => client !== acting && client !== waiting)!
    send(waiting, { type: 'request_card_reveal', targetId: target.id })
    expect(failure(waiting)).toBe('You can only request cards after folding in the current hand.')
  })

  it('only the asked player can answer, and self / empty-seat targets are refused', () => {
    const { send, join, a, b, c } = threeHanded()
    const folder = [a, b, c].find(client => client.id === snapshot(a).actingPlayerId)!
    send(folder, { type: 'player_action', action: 'fold' })
    const [target, bystander] = [a, b, c].filter(client => client !== folder) as [Client, Client]

    send(folder, { type: 'request_card_reveal', targetId: folder.id })
    expect(failure(folder)).toBe('That player cannot share cards right now.')

    // Someone who sat down mid-hand has no cards to share.
    const late = join('d', 'Dan')
    send(folder, { type: 'request_card_reveal', targetId: late.id })
    expect(failure(folder)).toBe('That player cannot share cards right now.')

    send(folder, { type: 'request_card_reveal', targetId: target.id })
    // The bystander cannot approve a request addressed to someone else.
    send(bystander, { type: 'respond_card_reveal', requesterId: folder.id, allow: true })
    expect(failure(bystander)).toBe('That card request is no longer active.')
    expect(snapshot(folder).players.find(player => player.id === target.id)?.holeCards).toBeUndefined()

    // Asking twice while pending is refused with a clear message.
    send(folder, { type: 'request_card_reveal', targetId: target.id })
    expect(failure(folder)).toBe(`Waiting for ${snapshot(target).players.find(p => p.id === target.id)!.nickname} to answer.`)

    send(target, { type: 'respond_card_reveal', requesterId: folder.id, allow: true })
    expect(snapshot(folder).players.find(player => player.id === target.id)?.holeCards).toHaveLength(2)
    expect(snapshot(bystander).players.find(player => player.id === target.id)?.holeCards).toBeUndefined()
    // The late joiner / spectators never see the privately shared hand either.
    expect(snapshot(late).players.find(player => player.id === target.id)?.holeCards).toBeUndefined()
  })
})

describe('7-2 bounty settings', () => {
  it('saves a fractional bounty percentage and rejects more than 100%', () => {
    const { send, join } = harness()
    const host = join('h', 'Host', 0)
    join('g', 'Guest', 1)
    send(host, { type: 'update_table_settings', sevenTwoRuleEnabled: true, sevenTwoBountyPercent: 7.5 })
    const state = snapshot(host)
    expect(state.sevenTwoRuleEnabled).toBe(true)
    expect(state.sevenTwoBountyPercent).toBe(7.5)
    send(host, { type: 'update_table_settings', sevenTwoBountyPercent: 101 })
    expect(failure(host)).toMatch(/bounty from 0 to 100%/)
  })
})
