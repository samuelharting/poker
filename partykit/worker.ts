import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver'
import type { Connection as PartyConnection, Room } from 'partykit/server'
import PokerRoom from './room'

/**
 * Cloudflare Worker entry. Hosted PartyKit shut down in Oct 2026, so the table
 * runs on PartyServer (a Durable Object per room). PokerRoom still speaks the
 * PartyKit Room API, so this class hands it an adapter over the PartyServer
 * equivalents and forwards every lifecycle call.
 */
type Env = Record<string, unknown>

export class Main extends Server<Env> {
  private poker: PokerRoom | null = null

  private table(): PokerRoom {
    if (!this.poker) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const server = this
      // env / ctx come from the Durable Object base class (types live in cloudflare:workers).
      const durable = this as unknown as { env: Env; ctx: { storage: unknown } }
      const room = {
        get id() { return server.name },
        get env() { return durable.env },
        get storage() { return durable.ctx.storage },
        getConnection: (id: string) => server.getConnection(id),
        getConnections: (tag?: string) => server.getConnections(tag),
        broadcast: (message: string, without?: string[]) => server.broadcast(message, without),
      }
      this.poker = new PokerRoom(room as unknown as Room)
    }
    return this.poker
  }

  async onStart() {
    await this.table().onStart()
  }

  onConnect(connection: Connection) {
    this.table().onConnect(connection as unknown as PartyConnection)
  }

  onMessage(connection: Connection, message: WSMessage) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message as ArrayBuffer)
    this.table().onMessage(text, connection as unknown as PartyConnection)
  }

  onClose(connection: Connection) {
    this.table().onClose(connection as unknown as PartyConnection)
  }

  onAlarm() {
    this.table().onAlarm()
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('ok')
    }
    return (await routePartykitRequest(request, env as never)) ?? new Response('Not found', { status: 404 })
  },
}
