import { describe, expect, it, vi } from 'vitest'
import { MockConnection } from './helpers/roomHarness'

// The real partyserver needs the Workers runtime; stand in a minimal Server.
vi.mock('partyserver', () => {
  class Server {
    name = 'main'
    env = {}
    ctx = { storage: { setAlarm: vi.fn(), deleteAlarm: vi.fn() } }
    conns = new Map<string, MockConnection>()
    getConnection(id: string) { return this.conns.get(id) }
    getConnections() { return this.conns.values() }
    broadcast() {}
  }
  return { Server, routePartykitRequest: vi.fn() }
})

describe('Cloudflare worker adapter', () => {
  it('treats a socket error as a disconnect so the player is not left bound to a dead socket', async () => {
    const { Main } = await import('@/partykit/worker')
    const main = new (Main as unknown as new () => InstanceType<typeof Main>)()
    const internal = main as unknown as { conns: Map<string, MockConnection>; poker: { data: { playerToConnection: Record<string, string>; gameState: { players: Array<{ id: string; isConnected: boolean }> } } } }
    const conn = new MockConnection('c1')
    internal.conns.set('c1', conn)
    main.onConnect(conn as never)
    main.onMessage(conn as never, JSON.stringify({ type: 'join_room', nickname: 'Ann' }))
    const session = conn.messages.find(message => message.type === 'private_session') as { yourId: string } | undefined
    expect(session?.yourId).toBeTruthy()
    const join = { playerId: session!.yourId }
    expect(internal.poker.data.playerToConnection[join.playerId]).toBe('c1')

    // PartyServer drops the socket from its set on error; close may never come.
    internal.conns.delete('c1')
    main.onError(conn as never, new Error('Network connection lost'))
    expect(internal.poker.data.playerToConnection[join.playerId]).toBeUndefined()

    // A late close for the same socket changes nothing.
    expect(() => main.onClose(conn as never)).not.toThrow()
  })

  it('decodes binary frames as text', async () => {
    const { Main } = await import('@/partykit/worker')
    const main = new (Main as unknown as new () => InstanceType<typeof Main>)()
    const internal = main as unknown as { conns: Map<string, MockConnection> }
    const conn = new MockConnection('c2')
    internal.conns.set('c2', conn)
    main.onConnect(conn as never)
    main.onMessage(conn as never, new TextEncoder().encode(JSON.stringify({ type: 'join_room', nickname: 'Bo' })).buffer as ArrayBuffer)
    expect(conn.messages.some(message => message.type === 'private_session')).toBe(true)
  })
})
