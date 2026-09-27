import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import { clearHandOddsCache, getHandOddsComputationCount } from '@/lib/poker/odds'
import type { TableState } from '@/lib/poker/types'
import {
  actingPlayer,
  createHarness,
  disconnect,
  joinPlayer,
  lastMessage,
  seatPlayer,
  send,
  type RoomInternals,
} from './helpers/roomHarness'

/**
 * Spectating end to end at the room level: how people end up on the rail,
 * what the rail may see, and that the rail is never treated as a player.
 */

type Harness = ReturnType<typeof createHarness>
type Joined = ReturnType<typeof joinPlayer>

function snapshot(connection: Connection): TableState {
  return lastMessage(connection, 'room_snapshot')!.state
}

function lobbyEntry(connection: Connection, id: string) {
  return snapshot(connection).lobbyPlayers.find(player => player.id === id)
}

function seatIds(internals: RoomInternals): string[] {
  return internals.data.gameState.players.map(player => player.id)
}

function seatTable(harness: Harness, names: string[]): Joined[] {
  return names.map((name, index) => {
    const joined = joinPlayer(harness.server, harness.room, `conn-${name}`, name)
    seatPlayer(harness.server, joined.connection, index)
    return joined
  })
}

function playHandPassively(harness: Harness, seats: Joined[], onStep?: () => void) {
  const byId = new Map(seats.map(seat => [seat.playerId, seat.connection]))
  for (let guard = 0; guard < 80 && harness.internals.data.gameState.phase === 'in_hand'; guard += 1) {
    onStep?.()
    const actor = actingPlayer(harness.internals)
    if (!actor) break
    const state = harness.internals.data.gameState
    const connection = byId.get(actor.id)
    if (!connection) throw new Error(`no connection for ${actor.nickname}`)
    send(harness.server, connection, {
      type: 'player_action',
      action: actor.bet >= state.currentBet ? 'check' : 'call',
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  clearHandOddsCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getting onto the rail', () => {
  it('a newcomer at a full table watches instead of taking a seat', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'])
    const late = joinPlayer(harness.server, harness.room, 'conn-late', 'Late')
    seatPlayer(harness.server, late.connection)

    expect(lastMessage(late.connection, 'action_result')?.message).toMatch(/Table is full/)
    expect(seatIds(harness.internals)).not.toContain(late.playerId)
    expect(lobbyEntry(seats[0]!.connection, late.playerId)).toMatchObject({ isSpectator: true, isSeated: false })
    expect(lobbyEntry(late.connection, late.playerId)?.stack).toBeGreaterThan(0)
  })

  it('the host can bench a player between hands and seat them again', () => {
    const harness = createHarness()
    const [ann, ben, cat] = seatTable(harness, ['Ann', 'Ben', 'Cat'])
    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: true })
    expect(seatIds(harness.internals)).not.toContain(cat!.playerId)
    expect(lobbyEntry(ben!.connection, cat!.playerId)).toMatchObject({ isSpectator: true, stack: 1000 })

    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: false })
    expect(seatIds(harness.internals)).toContain(cat!.playerId)
    expect(lobbyEntry(ben!.connection, cat!.playerId)?.isSpectator).toBe(false)
  })

  it('benching mid-hand folds them now, shows them the live hands, and clears the seat next hand', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben', 'Cat'])
    const [ann, , cat] = seats
    send(harness.server, ann!.connection, { type: 'start_game' })
    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: true })

    const catSeat = harness.internals.data.gameState.players.find(player => player.id === cat!.playerId)!
    expect(catSeat.status).toBe('folded')
    const catView = snapshot(cat!.connection)
    expect(catView.handOdds?.mode).toBe('spectator')
    const liveOthers = catView.players.filter(player => player.id !== cat!.playerId && player.status !== 'folded')
    expect(liveOthers.every(player => player.holeCards?.length === 2)).toBe(true)

    playHandPassively(harness, seats.filter(seat => seat !== cat))
    vi.advanceTimersByTime(30_000)
    expect(seatIds(harness.internals)).not.toContain(cat!.playerId)
    expect(lobbyEntry(ann!.connection, cat!.playerId)?.isSpectator).toBe(true)
  })

  it('a busted player goes to the rail with nothing, and cannot take a seat without chips', () => {
    const harness = createHarness()
    const [ann, ben] = seatTable(harness, ['Ann', 'Ben'])
    send(harness.server, ann!.connection, { type: 'start_game' })
    for (let guard = 0; guard < 6 && harness.internals.data.gameState.phase === 'in_hand'; guard += 1) {
      const actor = actingPlayer(harness.internals)
      if (!actor) break
      const connection = actor.id === ann!.playerId ? ann!.connection : ben!.connection
      send(harness.server, connection, { type: 'player_action', action: guard === 0 ? 'all_in' : 'call' })
    }
    vi.advanceTimersByTime(40_000)
    const state = harness.internals.data.gameState
    if (state.players.length === 2) {
      // A chopped pot: nobody busted this time.
      return
    }
    const bustedId = [ann!, ben!].find(seat => !seatIds(harness.internals).includes(seat.playerId))!.playerId
    const busted = bustedId === ann!.playerId ? ann! : ben!
    expect(lobbyEntry(busted.connection, bustedId)).toMatchObject({ isSpectator: true, stack: 0 })
    seatPlayer(harness.server, busted.connection)
    expect(seatIds(harness.internals)).not.toContain(bustedId)
    expect(lastMessage(busted.connection, 'action_failed')?.message).toMatch(/chips|Rebuy|rebuy/)
  })
})

describe('what the rail sees', () => {
  it('sees every live hand with odds; seated players never do while betting is open', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben', 'Cat'])
    const rails = ['R1', 'R2', 'R3', 'R4', 'R5'].map(name => joinPlayer(harness.server, harness.room, `conn-${name}`, name))
    for (const rail of rails) {
      send(harness.server, seats[0]!.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })
    }
    send(harness.server, seats[0]!.connection, { type: 'start_game' })

    let streetsChecked = 0
    playHandPassively(harness, seats, () => {
      const phase = harness.internals.data.gameState.phase
      if (phase !== 'in_hand') return
      for (const rail of rails) {
        const view = snapshot(rail.connection)
        expect(view.handOdds?.mode).toBe('spectator')
        expect(view.players.every(player => player.holeCards?.length === 2)).toBe(true)
        expect(seatIds(harness.internals)).not.toContain(rail.playerId)
        expect(harness.internals.data.gameState.actingPlayerId).not.toBe(rail.playerId)
      }
      for (const seat of seats) {
        const view = snapshot(seat.connection)
        expect(view.handOdds).toBeUndefined()
        for (const other of view.players.filter(player => player.id !== seat.playerId)) {
          expect(other.holeCards).toBeUndefined()
        }
      }
      streetsChecked += 1
    })
    expect(streetsChecked).toBeGreaterThan(3)
    // Five spectators, one computation per distinct street: never per viewer.
    expect(getHandOddsComputationCount()).toBeLessThanOrEqual(4)
  })

  it('keeps spectator status and the hole-card cam across a reconnect', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben'])
    const rail = joinPlayer(harness.server, harness.room, 'conn-rail', 'Rail')
    send(harness.server, seats[0]!.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })
    send(harness.server, seats[0]!.connection, { type: 'start_game' })

    disconnect(harness.server, harness.room, rail.connection)
    const back = joinPlayer(harness.server, harness.room, 'conn-rail-2', 'Rail', rail.reconnectToken)
    expect(back.playerId).toBe(rail.playerId)
    expect(lobbyEntry(back.connection, rail.playerId)?.isSpectator).toBe(true)
    expect(seatIds(harness.internals)).not.toContain(rail.playerId)
    expect(snapshot(back.connection).handOdds?.mode).toBe('spectator')
  })
})

describe('the rail is never a player', () => {
  it('takes a seat mid-hand only for the next deal, and loses the hole-card cam once seated', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben'])
    const rail = joinPlayer(harness.server, harness.room, 'conn-rail', 'Rail')
    send(harness.server, seats[0]!.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })
    send(harness.server, seats[0]!.connection, { type: 'start_game' })
    const handNumber = harness.internals.data.gameState.handNumber

    seatPlayer(harness.server, rail.connection)
    const railSeat = harness.internals.data.gameState.players.find(player => player.id === rail.playerId)!
    expect(railSeat).toBeDefined()
    expect(railSeat.holeCards).toHaveLength(0)
    expect(railSeat.status).not.toBe('active')
    // Seated now: the live hands are hidden again.
    const view = snapshot(rail.connection)
    expect(view.handOdds).toBeUndefined()
    expect(view.players.filter(player => player.id !== rail.playerId).every(player => !player.holeCards)).toBe(true)

    playHandPassively(harness, seats)
    for (let waited = 0; waited < 45_000 && harness.internals.data.gameState.handNumber === handNumber; waited += 250) {
      vi.advanceTimersByTime(250)
    }
    expect(harness.internals.data.gameState.handNumber).toBe(handNumber + 1)
    const dealtIn = harness.internals.data.gameState.players.find(player => player.id === rail.playerId)!
    expect(dealtIn.holeCards).toHaveLength(2)
  })

  it('cannot be bought a shot or flicked, and cannot prank from the rail', () => {
    const harness = createHarness()
    const [ann, ben] = seatTable(harness, ['Ann', 'Ben'])
    const rail = joinPlayer(harness.server, harness.room, 'conn-rail', 'Rail')
    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })
    for (const connection of [ann!.connection, ben!.connection, rail.connection]) {
      send(harness.server, connection, { type: 'set_drink_capable', capable: true })
    }

    send(harness.server, ann!.connection, { type: 'buy_shot', targetId: rail.playerId })
    expect(lastMessage(ann!.connection, 'action_failed')?.message).toMatch(/not at the table/)
    send(harness.server, ann!.connection, { type: 'flick_chip', targetId: rail.playerId })
    expect(lastMessage(ann!.connection, 'action_failed')?.message).toMatch(/not at the table/)
    send(harness.server, rail.connection, { type: 'buy_shot', targetId: ben!.playerId })
    expect(lastMessage(rail.connection, 'action_failed')?.message).toMatch(/Take a seat/)
  })
})

describe('rail social and self-service seating', () => {
  it('a spectator can chat and throw a reaction at a seated player', () => {
    const harness = createHarness()
    const [ann] = seatTable(harness, ['Ann', 'Ben'])
    const rail = joinPlayer(harness.server, harness.room, 'conn-rail', 'Rail')
    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: rail.playerId, spectator: true })

    send(harness.server, rail.connection, { type: 'table_emote', emote: '\u{1F525}', targetId: ann!.playerId })
    expect(lastMessage(rail.connection, 'action_failed')).toBeUndefined()
    const social = lastMessage(ann!.connection, 'social_snapshot')!.social
    expect(social.active).toContainEqual(expect.objectContaining({
      playerId: rail.playerId,
      emote: '\u{1F525}',
      targetPlayerId: ann!.playerId,
    }))

    send(harness.server, rail.connection, { type: 'table_chat', message: 'gl all' })
    expect(lastMessage(ann!.connection, 'social_snapshot')!.social.chatLog[0]).toMatchObject({ message: 'gl all', nickname: 'Rail' })
  })

  it('a player can stand up without folding a live hand, then sit back down', () => {
    const harness = createHarness()
    const seats = seatTable(harness, ['Ann', 'Ben', 'Cat'])
    const [ann, , cat] = seats
    send(harness.server, ann!.connection, { type: 'start_game' })
    const handNumber = harness.internals.data.gameState.handNumber

    send(harness.server, cat!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: true })
    expect(lastMessage(cat!.connection, 'action_result')?.message).toMatch(/after this hand/)
    const catSeat = harness.internals.data.gameState.players.find(player => player.id === cat!.playerId)!
    expect(catSeat.status).toBe('active')
    // Still live: no peeking at the others from the half-way-to-the-rail seat.
    expect(snapshot(cat!.connection).handOdds).toBeUndefined()
    expect(snapshot(cat!.connection).players.filter(player => player.id !== cat!.playerId).every(player => !player.holeCards)).toBe(true)

    playHandPassively(harness, seats)
    for (let waited = 0; waited < 45_000 && harness.internals.data.gameState.handNumber === handNumber; waited += 250) {
      vi.advanceTimersByTime(250)
    }
    expect(seatIds(harness.internals)).not.toContain(cat!.playerId)
    expect(lobbyEntry(cat!.connection, cat!.playerId)).toMatchObject({ isSpectator: true, isSeated: false })
    expect(lobbyEntry(cat!.connection, cat!.playerId)!.stack).toBeGreaterThan(0)

    send(harness.server, cat!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: false })
    expect(seatIds(harness.internals)).toContain(cat!.playerId)
    expect(lobbyEntry(cat!.connection, cat!.playerId)?.isSpectator).toBe(false)
  })

  it('a player cannot bench anyone else', () => {
    const harness = createHarness()
    const [, ben, cat] = seatTable(harness, ['Ann', 'Ben', 'Cat'])
    send(harness.server, ben!.connection, { type: 'set_player_spectator', targetId: cat!.playerId, spectator: true })
    expect(lastMessage(ben!.connection, 'action_failed')?.message).toMatch(/Only the game creator/)
    expect(seatIds(harness.internals)).toContain(cat!.playerId)
  })

  it('benched bots are not shown as away', () => {
    const harness = createHarness()
    const [ann] = seatTable(harness, ['Ann'])
    send(harness.server, ann!.connection, { type: 'add_bots', count: 2 })
    const bot = harness.internals.data.gameState.players.find(player => player.isBot)!
    send(harness.server, ann!.connection, { type: 'set_player_spectator', targetId: bot.id, spectator: true })
    expect(lobbyEntry(ann!.connection, bot.id)).toMatchObject({ isSpectator: true, isConnected: true })
  })
})
