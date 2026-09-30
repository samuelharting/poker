import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import { netsToCents, type LedgerSnapshot } from '@/lib/poker/ledger'
import {
  actingPlayer,
  createHarness,
  disconnect,
  joinPlayer,
  lastMessage,
  messagesOf,
  roomChips,
  seatPlayer,
  send,
  type RoomInternals,
} from './helpers/roomHarness'

/**
 * Self-serve rebuys and the night's ledger: every chip that enters the room is
 * on the books, so the nets always sum to zero and the settle-up balances.
 */

type Harness = ReturnType<typeof createHarness>

interface LedgerInternals extends RoomInternals {
  data: RoomInternals['data'] & {
    membership: { departedStacks: Record<string, number> }
    ledger: { pendingRebuys: Record<string, true> }
  }
  buildLedgerSnapshot: () => LedgerSnapshot
}

function internalsOf(harness: Harness): LedgerInternals {
  return harness.internals as LedgerInternals
}

function ledgerOf(harness: Harness): LedgerSnapshot {
  return internalsOf(harness).buildLedgerSnapshot()
}

function rowOf(harness: Harness, name: string) {
  const row = ledgerOf(harness).rows.find(candidate => candidate.name === name)
  if (!row) throw new Error(`No ledger row for ${name}`)
  return row
}

/** Chips anywhere: table, rail, pockets of people who walked out. */
function allChips(internals: LedgerInternals): number {
  return roomChips(internals) + Object.values(internals.data.membership.departedStacks).reduce((sum, stack) => sum + stack, 0)
}

function expectBalancedBooks(harness: Harness) {
  const ledger = ledgerOf(harness)
  expect(ledger.rows.reduce((sum, row) => sum + row.net, 0)).toBe(0)
  expect(ledger.totalChips).toBe(ledger.totalBoughtIn)
  // Payments are money: they must square in whole cents. (At the default $5
  // buy-in a chip is half a cent, so the chip count shown on a payment can be
  // off by one; the cents are what actually gets paid.)
  const paid = new Map<string, number>()
  for (const payment of ledger.payments) {
    paid.set(payment.fromKey, (paid.get(payment.fromKey) ?? 0) - payment.cents)
    paid.set(payment.toKey, (paid.get(payment.toKey) ?? 0) + payment.cents)
  }
  const owedCents = new Map(netsToCents(ledger.rows.map(row => ({ key: row.key, name: row.name, net: row.net })), ledger.settings.chipValue).map(balance => [balance.key, balance.net]))
  for (const row of ledger.rows) {
    expect(paid.get(row.key) ?? 0).toBe(owedCents.get(row.key) ?? 0)
  }
  return ledger
}

function setupTable(names: string[]) {
  const harness = createHarness()
  const players = names.map((name, index) => {
    const joined = joinPlayer(harness.server, harness.room, `conn-${name}`, name)
    seatPlayer(harness.server, joined.connection, index)
    return { name, ...joined }
  })
  // No 7-2 bounty: it moves chips on a random deal and would make stacks unpredictable.
  send(harness.server, players[0]!.connection, { type: 'update_table_settings', sevenTwoRuleEnabled: false })
  const byName = Object.fromEntries(players.map(player => [player.name, player]))
  const byId: Record<string, Connection> = Object.fromEntries(players.map(player => [player.playerId, player.connection]))
  return { ...harness, players, byName, byId, host: players[0]! }
}

function seat(harness: Harness, id: string) {
  return harness.internals.data.gameState.players.find(player => player.id === id)
}

function failureOf(connection: Connection) {
  return lastMessage(connection, 'action_failed')?.message ?? ''
}

function resultOf(connection: Connection) {
  return lastMessage(connection, 'action_result')?.message ?? ''
}

function actPassive(harness: Harness, byId: Record<string, Connection>) {
  const actor = actingPlayer(harness.internals)
  if (!actor) throw new Error('nobody acting')
  const state = harness.internals.data.gameState
  send(harness.server, byId[actor.id]!, { type: 'player_action', action: actor.bet >= state.currentBet ? 'check' : 'call' })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('buy-ins on the ledger', () => {
  it('books a starting stack for everyone who sits down, bots included', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.host.connection, { type: 'add_bots', count: 1 })
    const ledger = expectBalancedBooks(table)
    expect(ledger.rows).toHaveLength(3)
    expect(ledger.rows.every(row => row.boughtIn === 1000 && row.chips === 1000 && row.net === 0)).toBe(true)
    expect(ledger.rows.filter(row => row.isBot)).toHaveLength(1)
    expect(ledger.buyInAmount).toBe(1000)
  })

  it('shares the ledger with every player in the snapshot', () => {
    const table = setupTable(['Ann', 'Ben'])
    const snapshot = lastMessage(table.byName.Ben!.connection, 'room_snapshot')
    expect(snapshot?.state.ledger?.rows.map(row => row.name).sort()).toEqual(['Ann', 'Ben'])
    // Default buy-in: $5 for one starting stack.
    expect(snapshot?.state.ledger?.settings).toEqual({ allowRebuys: true, maxRebuys: 0, chipValue: 5 / snapshot!.state.startingStack })
  })
})

describe('self-serve rebuys', () => {
  it('refuses a rebuy at or above the starting stack', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.byName.Ben!.connection, { type: 'rebuy' })
    expect(failureOf(table.byName.Ben!.connection)).toContain('below the $1,000 buy-in')
    expect(seat(table, table.byName.Ben!.playerId)?.stack).toBe(1000)
  })

  it('adds one full buy-in for any player below the starting stack (not just the host)', () => {
    const table = setupTable(['Ann', 'Ben'])
    const ben = table.byName.Ben!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: ben.playerId, amount: -600 })
    send(table.server, ben.connection, { type: 'rebuy' })
    expect(resultOf(ben.connection)).toContain('Rebought $1,000')
    expect(seat(table, ben.playerId)?.stack).toBe(1400)
    const row = rowOf(table, 'Ben')
    expect(row).toMatchObject({ boughtIn: 1400, chips: 1400, net: 0, rebuys: 1 })
    expectBalancedBooks(table)

    // Everyone hears about it.
    const notice = lastMessage(table.host.connection, 'notice')
    expect(notice).toMatchObject({ kind: 'ledger', message: 'Ben rebought $1,000' })
  })

  it('lets a busted player on the rail rebuy straight back into a seat', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const cat = table.byName.Cat!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: cat.playerId, amount: -1000 })
    // At zero chips between hands Cat is swept to the rail.
    expect(seat(table, cat.playerId)).toBeUndefined()
    expect(table.internals.data.spectatorIds[cat.playerId]).toBe(true)

    send(table.server, cat.connection, { type: 'rebuy' })
    expect(seat(table, cat.playerId)?.stack).toBe(1000)
    expect(seat(table, cat.playerId)?.status).toBe('waiting')
    expect(rowOf(table, 'Cat')).toMatchObject({ boughtIn: 1000, chips: 1000, net: 0, rebuys: 1, where: 'seated' })
    expectBalancedBooks(table)
  })

  it('queues a rebuy asked for mid-hand and lands it when the hand ends', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.host.connection, { type: 'start_game' })
    const state = table.internals.data.gameState
    expect(state.phase).toBe('in_hand')
    // Heads-up the small blind acts first; they are live and below the buy-in.
    const actor = actingPlayer(table.internals)!
    const conn = table.byId[actor.id]!
    const stackBefore = actor.stack
    expect(stackBefore).toBeLessThan(1000)

    send(table.server, conn, { type: 'rebuy' })
    expect(resultOf(conn)).toContain('queued')
    expect(seat(table, actor.id)?.stack).toBe(stackBefore)
    expect(ledgerOf(table).rows.find(row => row.playerId === actor.id)?.rebuyQueued).toBe(true)
    expectBalancedBooks(table)

    send(table.server, conn, { type: 'rebuy' })
    expect(failureOf(conn)).toContain('already queued')

    send(table.server, conn, { type: 'player_action', action: 'fold' })
    expect(table.internals.data.gameState.phase).not.toBe('in_hand')
    expect(seat(table, actor.id)?.stack).toBe(stackBefore + 1000)
    const row = ledgerOf(table).rows.find(candidate => candidate.playerId === actor.id)!
    expect(row).toMatchObject({ rebuys: 1, rebuyQueued: false, boughtIn: 2000 })
    expectBalancedBooks(table)
  })

  it('drops a queued rebuy if the player wins back above the buy-in', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.host.connection, { type: 'start_game' })
    const actor = actingPlayer(table.internals)!
    const other = table.internals.data.gameState.players.find(player => player.id !== actor.id)!
    // The big blind queues a rebuy, then the small blind folds to them.
    send(table.server, table.byId[other.id]!, { type: 'rebuy' })
    expect(resultOf(table.byId[other.id]!)).toContain('queued')
    send(table.server, table.byId[actor.id]!, { type: 'player_action', action: 'fold' })
    expect(seat(table, other.id)?.stack).toBeGreaterThan(1000)
    expect(ledgerOf(table).rows.find(row => row.playerId === other.id)).toMatchObject({ rebuys: 0, rebuyQueued: false })
    expect(failureOf(table.byId[other.id]!)).toContain('Rebuy skipped')
    expectBalancedBooks(table)
  })

  it('lets a folded player rebuy right away while the hand plays on', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const cat = table.byName.Cat!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: cat.playerId, amount: -500 })
    send(table.server, table.host.connection, { type: 'start_game' })
    for (let guard = 0; guard < 10 && actingPlayer(table.internals)?.id !== cat.playerId; guard += 1) {
      actPassive(table, table.byId)
    }
    expect(actingPlayer(table.internals)?.id).toBe(cat.playerId)
    send(table.server, cat.connection, { type: 'player_action', action: 'fold' })
    expect(table.internals.data.gameState.phase).toBe('in_hand')
    const before = seat(table, cat.playerId)!.stack
    send(table.server, cat.connection, { type: 'rebuy' })
    expect(seat(table, cat.playerId)?.stack).toBe(before + 1000)
    expect(seat(table, cat.playerId)?.status).toBe('folded')
    expectBalancedBooks(table)
  })

  it('respects the host rebuy switch and the per-player cap', () => {
    const table = setupTable(['Ann', 'Ben'])
    const ben = table.byName.Ben!
    send(table.server, ben.connection, { type: 'update_table_settings', allowRebuys: false })
    expect(failureOf(ben.connection)).toContain('Only the game creator')

    send(table.server, table.host.connection, { type: 'update_table_settings', allowRebuys: false })
    expect(resultOf(table.host.connection)).toContain('Rebuy and settle-up settings saved')
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: ben.playerId, amount: -900 })
    send(table.server, ben.connection, { type: 'rebuy' })
    expect(failureOf(ben.connection)).toContain('turned rebuys off')
    expect(seat(table, ben.playerId)?.stack).toBe(100)

    send(table.server, table.host.connection, { type: 'update_table_settings', allowRebuys: true, maxRebuys: 1 })
    send(table.server, ben.connection, { type: 'rebuy' })
    expect(seat(table, ben.playerId)?.stack).toBe(1100)
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: ben.playerId, amount: -1000 })
    send(table.server, ben.connection, { type: 'rebuy' })
    expect(failureOf(ben.connection)).toContain('used all 1 rebuy')
    expect(ledgerOf(table).settings).toMatchObject({ allowRebuys: true, maxRebuys: 1 })

    send(table.server, table.host.connection, { type: 'update_table_settings', maxRebuys: -3 })
    send(table.server, table.host.connection, { type: 'update_table_settings', chipValue: 0 })
    expect(failureOf(table.host.connection)).toContain('chip value')
    expectBalancedBooks(table)
  })
})

describe('host adjustments on the ledger', () => {
  it('records who added or removed chips, and only what actually moved', () => {
    const table = setupTable(['Ann', 'Ben'])
    const ben = table.byName.Ben!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: ben.playerId, amount: 500 })
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: ben.playerId, amount: -2000 })
    const ledger = expectBalancedBooks(table)
    expect(rowOf(table, 'Ben')).toMatchObject({ boughtIn: 0, chips: 0, net: 0 })
    const benEvents = ledger.events.filter(event => event.name === 'Ben')
    expect(benEvents.map(event => [event.kind, event.amount, event.byName])).toEqual([
      ['host_remove', 1500, 'Ann'],
      ['host_add', 500, 'Ann'],
      ['buy_in', 1000, undefined],
    ])
    expect(messagesOf(ben.connection).some(message => (
      message.type === 'notice' && message.kind === 'ledger' && message.message === 'Ann added $500 to Ben'
    ))).toBe(true)
  })

  it('still rejects chip changes from anyone but the host', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.byName.Ben!.connection, { type: 'adjust_player_stack', targetId: table.byName.Ben!.playerId, amount: 5000 })
    expect(failureOf(table.byName.Ben!.connection)).toContain('Only the game creator')
    expect(rowOf(table, 'Ben').boughtIn).toBe(1000)
  })
})

describe('leaving, rejoining and settling up', () => {
  it('keeps a player on the books after they leave and picks the same account back up on rejoin', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const cat = table.byName.Cat!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: cat.playerId, amount: -300 })
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: table.byName.Ben!.playerId, amount: 300 })
    send(table.server, cat.connection, { type: 'leave_room' })
    disconnect(table.server, table.room, cat.connection)

    let row = rowOf(table, 'Cat')
    expect(row).toMatchObject({ where: 'left', boughtIn: 700, chips: 700, net: 0 })
    expectBalancedBooks(table)

    const back = joinPlayer(table.server, table.room, 'conn-cat-2', 'cat')
    seatPlayer(table.server, back.connection)
    row = rowOf(table, 'Cat')
    expect(row).toMatchObject({ where: 'seated', boughtIn: 700, chips: 700, rebuys: 0 })
    expect(ledgerOf(table).rows).toHaveLength(3)
    expectBalancedBooks(table)
  })

  it('books the chips a removed bot takes with it', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.host.connection, { type: 'add_bots', count: 1 })
    const bot = table.internals.data.gameState.players.find(player => player.isBot)!
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: bot.id, amount: 250 })
    send(table.server, table.host.connection, { type: 'remove_player', targetId: bot.id })
    expect(seat(table, bot.id)).toBeUndefined()
    const row = ledgerOf(table).rows.find(candidate => candidate.isBot)!
    expect(row).toMatchObject({ where: 'left', chips: 1250, boughtIn: 1250, net: 0 })
    expectBalancedBooks(table)
  })

  it('settles winners and losers after real hands, with Venmo handles', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    send(table.server, table.byName.Ben!.connection, { type: 'set_venmo', venmoUsername: 'ben-v' })
    for (let hand = 0; hand < 4; hand += 1) {
      const phase = (): string => table.internals.data.gameState.phase
      if (phase() !== 'in_hand') {
        send(table.server, table.host.connection, { type: 'start_game' })
        if (phase() !== 'in_hand') vi.advanceTimersByTime(30_000)
      }
      for (let guard = 0; guard < 40 && table.internals.data.gameState.phase === 'in_hand'; guard += 1) {
        const actor = actingPlayer(table.internals)!
        const state = table.internals.data.gameState
        const conn = table.byId[actor.id]!
        if (state.round === 'preflop' && actor.bet < state.currentBet && actor.nickname === 'Cat') {
          send(table.server, conn, { type: 'player_action', action: 'fold' })
        } else {
          actPassive(table, table.byId)
        }
      }
      vi.advanceTimersByTime(30_000)
    }
    const ledger = expectBalancedBooks(table)
    expect(ledger.totalChips).toBe(allChips(internalsOf(table)))
    // Blinds changed hands, so somebody owes somebody (and the payments square it).
    expect(ledger.rows.some(row => row.net !== 0)).toBe(true)
    expect(ledger.payments.length).toBeGreaterThan(0)
    const benRow = rowOf(table, 'Ben')
    expect(benRow.venmoUsername).toBe('@ben-v')
    for (const payment of ledger.payments.filter(candidate => candidate.toKey === 'ben')) {
      expect(payment.toVenmoUsername).toBe('@ben-v')
    }

    // Only the host can pop the settle-up card for the table.
    send(table.server, table.byName.Ben!.connection, { type: 'settle_up' })
    expect(failureOf(table.byName.Ben!.connection)).toContain('Only the game creator')
    send(table.server, table.host.connection, { type: 'settle_up' })
    expect(lastMessage(table.byName.Cat!.connection, 'room_snapshot')?.state.ledger?.settleUpAt).toEqual(expect.any(Number))
  })

  it('converts the settle-up to money at the host chip value', () => {
    const table = setupTable(['Ann', 'Ben'])
    send(table.server, table.host.connection, { type: 'update_table_settings', chipValue: 0.02 })
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: table.byName.Ben!.playerId, amount: -400 })
    send(table.server, table.host.connection, { type: 'adjust_player_stack', targetId: table.host.playerId, amount: 400 })
    // Chips moved by the host are bought in / taken out, so nobody owes anybody yet.
    expect(ledgerOf(table).payments).toEqual([])
    // Move chips between players the way a hand would.
    const ann = seat(table, table.host.playerId)!
    const ben = seat(table, table.byName.Ben!.playerId)!
    ann.stack -= 500
    ben.stack += 500
    const ledger = expectBalancedBooks(table)
    expect(ledger.payments).toEqual([
      expect.objectContaining({ fromName: 'Ann', toName: 'Ben', chips: 500, cents: 1000 }),
    ])
  })
})
