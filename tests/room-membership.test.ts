import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import type { LedgerSnapshot } from '@/lib/poker/ledger'
import { HOST_DISCONNECT_GRACE_MS, MISSED_HANDS_BEFORE_SIT_OUT } from '@/partykit/room'
import {
  actingPlayer,
  createHarness,
  disconnect,
  expectTurnIntegrity,
  joinPlayer,
  lastMessage,
  messagesOf,
  roomChips,
  seatPlayer,
  send,
  tableChips,
  type RoomInternals,
} from './helpers/roomHarness'

/**
 * Table membership flows: joining, leaving, kicks, bots, host succession,
 * reconnects and sitting out. Every scenario checks that no chips are created
 * or destroyed and that the turn never points at the wrong seat.
 */

type Harness = ReturnType<typeof createHarness>

interface MembershipInternals extends RoomInternals {
  data: RoomInternals['data'] & {
    membership: {
      departedStacks: Record<string, number>
      awayIds: Record<string, true>
      missedHands: Record<string, number>
    }
  }
}

function internalsOf(harness: Harness): MembershipInternals {
  return harness.internals as MembershipInternals
}

/** Chips anywhere: table, rail, and in the pockets of people who walked out. */
function allChips(internals: MembershipInternals): number {
  const departed = Object.values(internals.data.membership.departedStacks).reduce((sum, stack) => sum + stack, 0)
  return roomChips(internals) + departed
}

function setupTable(names: string[], seats?: number[]) {
  const harness = createHarness()
  const { room, server } = harness
  const players = names.map((name, index) => {
    const joined = joinPlayer(server, room, `conn-${name}`, name)
    seatPlayer(server, joined.connection, seats?.[index] ?? index)
    return { name, ...joined }
  })
  const byId: Record<string, Connection> = Object.fromEntries(players.map(player => [player.playerId, player.connection]))
  return { ...harness, players, byId, host: players[0]! }
}

function actFor(harness: Harness, byId: Record<string, Connection>, action: 'check' | 'call' | 'fold' | 'all_in' | 'passive') {
  const internals = harness.internals
  const actor = actingPlayer(internals)
  if (!actor) throw new Error('Nobody is acting')
  const conn = byId[actor.id]
  if (!conn) throw new Error(`No connection for ${actor.nickname}`)
  const state = internals.data.gameState
  const resolved = action === 'passive' ? (actor.bet >= state.currentBet ? 'check' : 'call') : action
  send(harness.server, conn, { type: 'player_action', action: resolved })
  return actor
}

function playOutHand(harness: Harness, byId: Record<string, Connection>) {
  for (let guard = 0; guard < 60 && harness.internals.data.gameState.phase === 'in_hand'; guard += 1) {
    const actor = actingPlayer(harness.internals)
    if (!actor) break
    expectTurnIntegrity(harness.internals)
    actFor(harness, byId, 'passive')
  }
  expect(harness.internals.data.gameState.phase).not.toBe('in_hand')
}

/** Let the auto-deal timer run until the next hand is dealt (and no further). */
function waitForNextDeal(harness: Harness) {
  const state = () => harness.internals.data.gameState
  const handNumber = state().handNumber
  for (let elapsed = 0; elapsed < 45_000 && state().handNumber === handNumber; elapsed += 250) {
    vi.advanceTimersByTime(250)
  }
}

function player(internals: RoomInternals, id: string) {
  return internals.data.gameState.players.find(candidate => candidate.id === id)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('joining', () => {
  it('seats a mid-hand joiner for the next hand without corrupting the turn order', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'], [2, 3, 4])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)

    // Dan grabs seat 0, which sorts in front of everyone mid-hand.
    const dan = joinPlayer(table.server, table.room, 'conn-Dan', 'Dan')
    seatPlayer(table.server, dan.connection, 0)
    table.byId[dan.playerId] = dan.connection

    expect(player(internals, dan.playerId)?.status).toBe('waiting')
    expect(player(internals, dan.playerId)?.holeCards).toHaveLength(0)
    expectTurnIntegrity(internals)

    const actedOrder: string[] = []
    for (let guard = 0; guard < 12 && internals.data.gameState.phase === 'in_hand' && internals.data.gameState.round === 'preflop'; guard += 1) {
      expectTurnIntegrity(internals)
      actedOrder.push(actFor(table, table.byId, 'passive').nickname)
    }
    // Everyone dealt in acts once preflop, in seat order, and Dan never does.
    expect(actedOrder).not.toContain('Dan')
    expect(new Set(actedOrder).size).toBe(actedOrder.length)
    expect(actedOrder).toHaveLength(3)

    playOutHand(table, table.byId)
    expect(allChips(internals)).toBe(chipsBefore + 1000)
  })

  it('turns a full-table joiner into a spectator and seats them when a chair opens', () => {
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'add_bots', count: 6 })
    expect(internals.data.gameState.players).toHaveLength(8)

    const late = joinPlayer(table.server, table.room, 'conn-Late', 'Late')
    seatPlayer(table.server, late.connection)
    expect(player(internals, late.playerId)).toBeUndefined()
    expect(lastMessage(late.connection, 'room_snapshot')?.state.lobbyPlayers
      .find(entry => entry.id === late.playerId)?.isSpectator).toBe(true)

    const bot = internals.data.gameState.players.find(candidate => candidate.isBot)!
    send(table.server, table.host.connection, { type: 'remove_player', targetId: bot.id })
    expect(player(internals, bot.id)).toBeUndefined()
    send(table.server, table.host.connection, { type: 'set_player_spectator', targetId: late.playerId, spectator: false })
    expect(player(internals, late.playerId)?.seatIndex).toBe(bot.seatIndex)
    expect(player(internals, late.playerId)?.stack).toBe(1000)
  })

  it('rejects a second live player with the same nickname instead of creating a twin', () => {
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    const twin = joinPlayer(table.server, table.room, 'conn-twin', ' ben ')

    expect(twin.playerId).toBe('')
    const ended = lastMessage(twin.connection, 'session_ended')
    expect(ended?.reason).toBe('name_taken')
    expect(ended?.message).toContain('Ben')
    expect(Object.values(internals.data.playerNicknames).filter(name => name.toLowerCase() === 'ben')).toHaveLength(1)
  })

  it('lets a disconnected player reclaim their seat, chips and stats by nickname alone', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const ben = table.players[1]!
    player(internals, ben.playerId)!.stack = 777

    disconnect(table.server, table.room, ben.connection)
    // New device: no reconnect token.
    const again = joinPlayer(table.server, table.room, 'conn-ben-phone', 'Ben')

    expect(again.playerId).toBe(ben.playerId)
    expect(player(internals, ben.playerId)?.stack).toBe(777)
    expect(player(internals, ben.playerId)?.isConnected).toBe(true)
    expect(player(internals, ben.playerId)?.seatIndex).toBe(1)
  })

  it('hands the seat to the newest tab and tells the old tab it was replaced', () => {
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    const ben = table.players[1]!
    const secondTab = joinPlayer(table.server, table.room, 'conn-ben-tab2', 'Ben', ben.reconnectToken)

    expect(secondTab.playerId).toBe(ben.playerId)
    expect(lastMessage(ben.connection, 'session_ended')?.reason).toBe('replaced')
    expect(internals.data.gameState.players.filter(candidate => candidate.id === ben.playerId)).toHaveLength(1)

    // The stale tab no longer speaks for Ben.
    send(table.server, ben.connection, { type: 'table_chat', message: 'ghost' })
    expect(lastMessage(ben.connection, 'action_failed')).toBeDefined()

    // Closing the old tab must not mark Ben offline.
    disconnect(table.server, table.room, ben.connection)
    expect(player(internals, ben.playerId)?.isConnected).toBe(true)
  })
})

describe('kicking players', () => {
  it('folds a non-acting kicked player at once, keeps the turn, and tells them why', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat', 'Dan'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)
    const actorBefore = actingPlayer(internals)!
    const target = table.players.find(candidate => (
      candidate.playerId !== actorBefore.id && candidate.playerId !== table.host.playerId
    ))!

    send(table.server, table.host.connection, { type: 'remove_player', targetId: target.playerId })

    expect(player(internals, target.playerId)?.status).toBe('folded')
    expect(actingPlayer(internals)?.id).toBe(actorBefore.id)
    expectTurnIntegrity(internals)
    expect(lastMessage(target.connection, 'session_ended')?.reason).toBe('kicked')
    expect(allChips(internals)).toBe(chipsBefore)

    // A kicked client cannot act or chat any more.
    send(table.server, target.connection, { type: 'player_action', action: 'fold' })
    expect(lastMessage(target.connection, 'action_failed')?.message).toMatch(/join the room/i)

    playOutHand(table, table.byId)
    // Hand over: the kicked seat is gone by the next deal and the chips left with them.
    waitForNextDeal(table)
    expect(player(internals, target.playerId)).toBeUndefined()
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('awards the pot immediately when a kick leaves a single contender', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)

    // Get the host to fold if they are not the one left standing.
    const others = table.players.filter(candidate => candidate.playerId !== table.host.playerId)
    // Kick both guests: the second kick leaves only the host.
    for (const other of others) {
      if (internals.data.gameState.phase !== 'in_hand') break
      send(table.server, table.host.connection, { type: 'remove_player', targetId: other.playerId })
      expectTurnIntegrity(internals)
    }

    expect(internals.data.gameState.phase).toBe('between_hands')
    expect(internals.data.gameState.winners?.[0]?.playerId).toBe(table.host.playerId)
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('moves the turn to the next seat when the acting player is kicked', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat', 'Dan'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    let actor = actingPlayer(internals)!
    if (actor.id === table.host.playerId) {
      actFor(table, table.byId, 'call')
      actor = actingPlayer(internals)!
    }
    const seatOrder = internals.data.gameState.players.map(candidate => candidate.id)
    const expectedNext = seatOrder[(seatOrder.indexOf(actor.id) + 1) % seatOrder.length]

    send(table.server, table.host.connection, { type: 'remove_player', targetId: actor.id })

    expect(actingPlayer(internals)?.id).toBe(expectedNext)
    expectTurnIntegrity(internals)
  })

  it('lets a kicked all-in player finish the hand with side pots, then carries their chips out', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const ben = table.players[1]!
    player(internals, ben.playerId)!.stack = 200
    const chipsBefore = allChips(internals)
    send(table.server, table.host.connection, { type: 'start_game' })

    // Ben shoves when it is his turn; everyone else calls.
    for (let guard = 0; guard < 10 && internals.data.gameState.round === 'preflop'; guard += 1) {
      const actor = actingPlayer(internals)
      if (!actor) break
      actFor(table, table.byId, actor.id === ben.playerId ? 'all_in' : 'passive')
    }
    expect(player(internals, ben.playerId)?.status).toBe('all_in')

    send(table.server, table.host.connection, { type: 'remove_player', targetId: ben.playerId })
    expect(player(internals, ben.playerId)?.status).toBe('all_in')
    expect(lastMessage(table.host.connection, 'action_result')?.message).toMatch(/all-in plays out/i)
    expect(allChips(internals)).toBe(chipsBefore)

    playOutHand(table, table.byId)
    expect(allChips(internals)).toBe(chipsBefore)
    const benFinal = player(internals, ben.playerId)!.stack

    vi.advanceTimersByTime(60_000)
    expect(player(internals, ben.playerId)).toBeUndefined()
    expect(allChips(internals)).toBe(chipsBefore)
    expect(internals.data.membership.departedStacks.ben).toBe(benFinal)

    // Coming back by name restores exactly that stack, not a fresh buy-in,
    // and a kicked player comes back to the rail rather than straight into a seat.
    const back = joinPlayer(table.server, table.room, 'conn-ben-back', 'Ben')
    const lobbyBen = lastMessage(back.connection, 'room_snapshot')?.state.lobbyPlayers
      .find(entry => entry.id === back.playerId)
    expect(lobbyBen?.isSpectator).toBe(true)
    expect(lobbyBen?.stack).toBe(benFinal)
    expect(player(internals, back.playerId)).toBeUndefined()
    expect(allChips(internals)).toBe(chipsBefore)
    if (benFinal > 0) {
      send(table.server, table.host.connection, { type: 'set_player_spectator', targetId: back.playerId, spectator: false })
      expect(player(internals, back.playerId)?.stack).toBe(benFinal)
    }
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('settles a run-it-twice vote with one board when a voter is kicked', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const [ann, ben, cat] = table.players
    send(table.server, ann!.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)

    // Cat folds; Ann and Ben get it all in.
    for (let guard = 0; guard < 10 && internals.data.gameState.phase === 'in_hand' && !internals.data.gameState.runItTwice; guard += 1) {
      const actor = actingPlayer(internals)
      if (!actor) break
      actFor(table, table.byId, actor.id === cat!.playerId ? 'fold' : actor.id === ben!.playerId ? 'all_in' : 'call')
    }
    expect(internals.data.gameState.runItTwice?.status).toBe('voting')

    send(table.server, ann!.connection, { type: 'remove_player', targetId: ben!.playerId })
    expect(internals.data.gameState.runItTwice?.status).not.toBe('voting')
    // One board is then dealt street by street.
    expect(internals.data.gameState.allInRunout).toBeDefined()
    vi.advanceTimersByTime(10_000)
    expect(internals.data.gameState.phase).toBe('between_hands')
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('clears a kicked player off the table after the reveal even when no next hand can start', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    playOutHand(table, table.byId)
    const chipsBefore = allChips(internals)

    // Kicked during the reveal window of a heads-up table.
    send(table.server, table.host.connection, { type: 'remove_player', targetId: table.players[1]!.playerId })
    vi.advanceTimersByTime(60_000)

    expect(internals.data.gameState.players.map(candidate => candidate.nickname)).toEqual(['Ann'])
    expect(internals.data.gameState.phase).toBe('between_hands')
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('sends a player kicked mid-hand who comes straight back to the rail, chips intact', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)
    const cat = table.players[2]!

    send(table.server, table.host.connection, { type: 'remove_player', targetId: cat.playerId })
    disconnect(table.server, table.room, cat.connection)
    // Reload: the kicked tab dropped its token, so it comes back by nickname.
    const back = joinPlayer(table.server, table.room, 'conn-cat-back', 'Cat')
    expect(back.playerId).toBe(cat.playerId)
    expect(player(internals, cat.playerId)?.status).toBe('folded')
    expect(allChips(internals)).toBe(chipsBefore)

    playOutHand(table, table.byId)
    waitForNextDeal(table)
    expect(player(internals, cat.playerId)).toBeUndefined()
    const lobbyCat = lastMessage(back.connection, 'room_snapshot')?.state.lobbyPlayers
      .find(entry => entry.id === cat.playerId)
    expect(lobbyCat?.isSpectator).toBe(true)
    expect(lobbyCat?.stack).toBeGreaterThan(0)
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('removes bots cleanly, mid-hand or between hands', () => {
    const table = setupTable(['Ann'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'add_bots', count: 3 })
    const bots = internals.data.gameState.players.filter(candidate => candidate.isBot)
    expect(bots).toHaveLength(3)

    send(table.server, table.host.connection, { type: 'remove_player', targetId: bots[0]!.id })
    expect(player(internals, bots[0]!.id)).toBeUndefined()

    send(table.server, table.host.connection, { type: 'start_game' })
    const tableBefore = tableChips(internals)
    send(table.server, table.host.connection, { type: 'remove_player', targetId: bots[1]!.id })
    expectTurnIntegrity(internals)
    expect(tableChips(internals)).toBe(tableBefore)
    expect(internals.data.hostId).toBe(table.host.playerId)
  })
})

describe('bots', () => {
  it('adds bots mid-hand as waiting players who are dealt in next hand', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben'], [3, 5])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })

    send(table.server, table.host.connection, { type: 'add_bots', count: 2 })
    expect(lastMessage(table.host.connection, 'action_result')?.message).toMatch(/join next hand/i)
    const bots = internals.data.gameState.players.filter(candidate => candidate.isBot)
    expect(bots.map(bot => bot.status)).toEqual(['waiting', 'waiting'])
    expectTurnIntegrity(internals)

    playOutHand(table, table.byId)
    waitForNextDeal(table)
    expect(internals.data.gameState.handNumber).toBe(2)
    for (const bot of internals.data.gameState.players.filter(candidate => candidate.isBot)) {
      expect(bot.holeCards).toHaveLength(2)
    }
  })
})

describe('leaving and reconnecting', () => {
  it('lets a player leave and come back by name with the same chips and stats', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const ben = table.players[1]!
    player(internals, ben.playerId)!.stack = 5
    const chipsBefore = allChips(internals)

    send(table.server, ben.connection, { type: 'leave_room' })
    expect(player(internals, ben.playerId)).toBeUndefined()
    expect(allChips(internals)).toBe(chipsBefore)

    const back = joinPlayer(table.server, table.room, 'conn-ben-2', 'Ben')
    seatPlayer(table.server, back.connection)
    expect(player(internals, back.playerId)?.stack).toBe(5)
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('reclaims a seat that is still finishing the hand after leaving mid-hand', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)
    const cat = table.players[2]!

    send(table.server, cat.connection, { type: 'leave_room' })
    expect(internals.data.pendingRemovals[cat.playerId]).toBe(true)

    const back = joinPlayer(table.server, table.room, 'conn-cat-2', 'Cat')
    expect(back.playerId).toBe(cat.playerId)
    expect(internals.data.pendingRemovals[cat.playerId]).toBeUndefined()
    expect(player(internals, cat.playerId)?.isConnected).toBe(true)
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('keeps a disconnected player in the hand on their original clock and their seat afterwards', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    const chipsBefore = allChips(internals)
    const actor = actingPlayer(internals)!
    const actorEntry = table.players.find(candidate => candidate.playerId === actor.id)!

    disconnect(table.server, table.room, actorEntry.connection)
    expect(actingPlayer(internals)?.id).toBe(actor.id)
    vi.advanceTimersByTime(internals.data.gameState.actionTimerDuration + 10)
    expect(actingPlayer(internals)?.id).not.toBe(actor.id)
    expect(player(internals, actor.id)).toBeDefined()
    expect(allChips(internals)).toBe(chipsBefore)
  })

  it('pauses cleanly when a heads-up table drops to one player', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    playOutHand(table, table.byId)
    send(table.server, table.players[1]!.connection, { type: 'leave_room' })
    vi.advanceTimersByTime(120_000)

    expect(internals.data.gameState.phase).toBe('between_hands')
    expect(internals.data.gameState.players).toHaveLength(1)
    send(table.server, table.host.connection, { type: 'start_game' })
    expect(lastMessage(table.host.connection, 'action_failed')?.message).toMatch(/at least 2/i)
  })

  it('moves from three-handed to heads-up with the button posting the small blind', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'start_game' })
    playOutHand(table, table.byId)
    send(table.server, table.players[2]!.connection, { type: 'leave_room' })
    waitForNextDeal(table)

    const state = internals.data.gameState
    expect(state.phase).toBe('in_hand')
    expect(state.players).toHaveLength(2)
    const dealer = state.players.find(candidate => candidate.isDealer)!
    expect(dealer.isSB).toBe(true)
    expect(state.players.find(candidate => candidate.isBB)?.id).not.toBe(dealer.id)
    expect(actingPlayer(internals)?.id).toBe(dealer.id)
  })
})

describe('host succession', () => {
  it('promotes the longest-seated connected human, never a bot, and announces it', () => {
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'add_bots', count: 2 })
    // A spectator joined earlier than nobody; seated players outrank them.
    const watcher = joinPlayer(table.server, table.room, 'conn-watch', 'Watcher')

    send(table.server, table.host.connection, { type: 'leave_room' })

    const ben = table.players[1]!
    expect(internals.data.hostId).toBe(ben.playerId)
    expect(lastMessage(ben.connection, 'private_session')?.isHost).toBe(true)
    const notice = lastMessage(watcher.connection, 'notice')
    expect(notice?.kind).toBe('host_changed')
    expect(notice?.message).toBe('Ben is now the host')
    expect(notice?.playerId).toBe(ben.playerId)

    // Full host controls move with it.
    send(table.server, ben.connection, { type: 'add_bots', count: 1 })
    expect(lastMessage(ben.connection, 'action_result')?.message).toMatch(/Added 1 bot/)
    send(table.server, ben.connection, { type: 'remove_player', targetId: table.players[2]!.playerId })
    expect(lastMessage(ben.connection, 'action_result')?.message).toMatch(/Kicked Cat/)
  })

  it('transfers host after the disconnect grace period and the old host returns as a regular player', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const [ann, ben] = table.players

    disconnect(table.server, table.room, ann!.connection)
    vi.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS - 1000)
    expect(internals.data.hostId).toBe(ann!.playerId)
    vi.advanceTimersByTime(1500)
    expect(internals.data.hostId).toBe(ben!.playerId)
    expect(lastMessage(ben!.connection, 'notice')?.message).toBe('Ben is now the host')

    const annBack = joinPlayer(table.server, table.room, 'conn-ann-back', 'Ann', ann!.reconnectToken)
    expect(annBack.playerId).toBe(ann!.playerId)
    expect(lastMessage(annBack.connection, 'private_session')?.isHost).toBe(false)
    expect(internals.data.hostId).toBe(ben!.playerId)
  })

  it('never hands a bot table to a bot when the last human leaves', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann'])
    const internals = internalsOf(table)
    send(table.server, table.host.connection, { type: 'add_bots', count: 3 })
    send(table.server, table.host.connection, { type: 'start_game' })

    send(table.server, table.host.connection, { type: 'leave_room' })
    expect(internals.data.hostId).toBeNull()
    vi.advanceTimersByTime(120_000)
    // Nobody left to run the table: it stops dealing.
    expect(internals.data.gameState.phase).toBe('between_hands')
    const handNumber = internals.data.gameState.handNumber
    vi.advanceTimersByTime(120_000)
    expect(internals.data.gameState.handNumber).toBe(handNumber)

    const back = joinPlayer(table.server, table.room, 'conn-ann-back', 'Ann')
    expect(internals.data.hostId).toBe(back.playerId)
    expect(lastMessage(back.connection, 'private_session')?.isHost).toBe(true)
  })

  it('does not transfer host while the host is only briefly away', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben'])
    const internals = internalsOf(table)
    const ann = table.players[0]!
    disconnect(table.server, table.room, ann.connection)
    vi.advanceTimersByTime(5_000)
    joinPlayer(table.server, table.room, 'conn-ann-2', 'Ann', ann.reconnectToken)
    vi.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS * 2)
    expect(internals.data.hostId).toBe(ann.playerId)
    expect(messagesOf(table.players[1]!.connection).some(message => message.type === 'notice')).toBe(false)
  })
})

describe('sitting out after missed hands', () => {
  function timeOutEveryTurnOf(table: ReturnType<typeof setupTable>, awayId: string) {
    const internals = table.internals
    for (let guard = 0; guard < 80 && internals.data.gameState.phase === 'in_hand'; guard += 1) {
      const actor = actingPlayer(internals)
      if (!actor) break
      if (actor.id === awayId) {
        vi.advanceTimersByTime(internals.data.gameState.actionTimerDuration + 10)
      } else {
        actFor(table, table.byId, 'passive')
      }
    }
  }

  it(`sits a player out after ${MISSED_HANDS_BEFORE_SIT_OUT} timed-out hands and deals them back in after "I'm back"`, () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const cat = table.players[2]!
    const chipsBefore = allChips(internals)
    send(table.server, table.host.connection, { type: 'start_game' })

    for (let hand = 1; hand <= MISSED_HANDS_BEFORE_SIT_OUT; hand += 1) {
      expect(player(internals, cat.playerId)?.holeCards).toHaveLength(2)
      timeOutEveryTurnOf(table, cat.playerId)
      waitForNextDeal(table)
    }

    // The next deal leaves Cat out: seat and chips kept, no blinds charged.
    expect(internals.data.gameState.phase).toBe('in_hand')
    const catSeat = player(internals, cat.playerId)!
    expect(catSeat.status).toBe('sitting_out')
    expect(catSeat.holeCards).toHaveLength(0)
    expect(catSeat.totalInPot).toBe(0)
    const catStack = catSeat.stack
    const catView = lastMessage(cat.connection, 'room_snapshot')?.state
    expect(catView?.players.find(entry => entry.id === cat.playerId)?.isAway).toBe(true)
    expect(allChips(internals)).toBe(chipsBefore)

    playOutHand(table, table.byId)
    expect(player(internals, cat.playerId)?.stack).toBe(catStack)

    send(table.server, cat.connection, { type: 'set_sitting_out', sittingOut: false })
    expect(player(internals, cat.playerId)?.isAway).toBeUndefined()
    waitForNextDeal(table)
    expect(player(internals, cat.playerId)?.holeCards).toHaveLength(2)
    expect(internals.data.membership.awayIds[cat.playerId]).toBeUndefined()
  })

  it('resets the missed-hand streak when the player acts', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const cat = table.players[2]!
    send(table.server, table.host.connection, { type: 'start_game' })

    timeOutEveryTurnOf(table, cat.playerId)
    waitForNextDeal(table)
    expect(internals.data.membership.missedHands[cat.playerId]).toBe(1)

    playOutHand(table, table.byId) // Cat acts this time.
    waitForNextDeal(table)
    expect(internals.data.membership.missedHands[cat.playerId]).toBeUndefined()
    expect(player(internals, cat.playerId)?.holeCards).toHaveLength(2)
  })

  it('keeps a disconnected player seated with chips, then sits them out after missing two deals', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const cat = table.players[2]!
    send(table.server, table.host.connection, { type: 'start_game' })
    playOutHand(table, table.byId)
    const catStack = player(internals, cat.playerId)!.stack

    disconnect(table.server, table.room, cat.connection)
    for (let hand = 0; hand < 2; hand += 1) {
      waitForNextDeal(table)
      expect(player(internals, cat.playerId)?.holeCards).toHaveLength(0)
      playOutHand(table, table.byId)
    }
    expect(internals.data.membership.awayIds[cat.playerId]).toBe(true)

    const back = joinPlayer(table.server, table.room, 'conn-cat-back', 'Cat', cat.reconnectToken)
    table.byId[cat.playerId] = back.connection
    const seat = player(internals, cat.playerId)!
    expect(seat.stack).toBe(catStack)
    expect(seat.seatIndex).toBe(2)
    expect(seat.isConnected).toBe(true)
    waitForNextDeal(table)
    // Still sitting out until they say they are back.
    expect(player(internals, cat.playerId)?.holeCards).toHaveLength(0)
    expect(lastMessage(back.connection, 'room_snapshot')?.state.players
      .find(entry => entry.id === cat.playerId)?.isAway).toBe(true)

    playOutHand(table, table.byId)
    send(table.server, back.connection, { type: 'set_sitting_out', sittingOut: false })
    waitForNextDeal(table)
    expect(player(internals, cat.playerId)?.holeCards).toHaveLength(2)
  })

  it('deals a briefly disconnected player straight back in without sitting them out', () => {
    vi.useFakeTimers()
    const table = setupTable(['Ann', 'Ben', 'Cat'])
    const internals = internalsOf(table)
    const cat = table.players[2]!
    send(table.server, table.host.connection, { type: 'start_game' })
    playOutHand(table, table.byId)

    disconnect(table.server, table.room, cat.connection)
    joinPlayer(table.server, table.room, 'conn-cat-back', 'Cat', cat.reconnectToken)
    waitForNextDeal(table)
    expect(player(internals, cat.playerId)?.holeCards).toHaveLength(2)
    expect(internals.data.membership.awayIds[cat.playerId]).toBeUndefined()
  })
})

describe('chip conservation under random membership churn', () => {
  it('never creates or destroys chips and never points the turn at the wrong seat', { timeout: 60_000 }, () => {
    vi.useFakeTimers()
    let seed = 1234567
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!

    for (let run = 0; run < 3; run += 1) {
      const names = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay']
      const table = setupTable(names)
      const internals = internalsOf(table)
      const total = 1000 * names.length
      const connByName: Record<string, Connection | null> = Object.fromEntries(
        table.players.map(entry => [entry.name, entry.connection])
      )
      const tokens: Record<string, string> = Object.fromEntries(
        table.players.map(entry => [entry.name, entry.reconnectToken])
      )
      let connCounter = 0
      send(table.server, table.host.connection, { type: 'start_game' })

      const hostConn = () => Object.values(connByName).find(conn => (
        conn && lastMessage(conn, 'private_session')?.isHost &&
        internals.data.hostId === lastMessage(conn, 'private_session')?.yourId
      )) ?? null
      const idOf = (conn: Connection) => lastMessage(conn, 'private_session')?.yourId

      for (let step = 0; step < 80; step += 1) {
        const roll = random()
        const state = internals.data.gameState
        const actor = actingPlayer(internals)
        const actorConn = actor ? Object.values(connByName).find(conn => conn && idOf(conn) === actor.id) : null
        const name = pick(names)
        const conn = connByName[name]

        if (roll < 0.45 && actorConn) {
          const action = pick(['fold', 'check', 'call', 'call', 'raise', 'all_in'] as const)
          const amount = action === 'raise' ? state.currentBet + state.bigBlind * 2 : undefined
          send(table.server, actorConn, { type: 'player_action', action, amount })
        } else if (roll < 0.55) {
          const host = hostConn()
          const target = conn && idOf(conn)
          if (host && target && host !== conn) {
            send(table.server, host, { type: 'remove_player', targetId: target })
            // A kicked client closes its socket.
            disconnect(table.server, table.room, conn)
            connByName[name] = null
          }
        } else if (roll < 0.62 && conn) {
          send(table.server, conn, { type: 'leave_room' })
          disconnect(table.server, table.room, conn)
          connByName[name] = null
        } else if (roll < 0.7 && conn) {
          disconnect(table.server, table.room, conn)
          connByName[name] = null
        } else if (roll < 0.82 && !conn) {
          connCounter += 1
          const useToken = random() < 0.5 ? tokens[name] : undefined
          const joined = joinPlayer(table.server, table.room, `c${run}-${connCounter}`, name, useToken)
          if (joined.playerId) {
            connByName[name] = joined.connection
            tokens[name] = joined.reconnectToken
            seatPlayer(table.server, joined.connection)
            send(table.server, joined.connection, { type: 'set_sitting_out', sittingOut: false })
          }
        } else if (roll < 0.87) {
          const host = hostConn()
          const target = conn && idOf(conn)
          if (host && target) {
            send(table.server, host, { type: 'set_player_spectator', targetId: target, spectator: random() < 0.6 })
          }
        } else if (roll < 0.91 && conn) {
          // Self-serve rebuy: immediate, queued mid-hand, or refused.
          send(table.server, conn, { type: 'rebuy' })
        } else {
          vi.advanceTimersByTime(pick([1_500, 11_000, 25_000]))
        }

        expectTurnIntegrity(internals)
        const chips = allChips(internals)
        // Rebuys are the only chips minted mid-run, and every one is on the ledger.
        const ledger = (internals as unknown as { buildLedgerSnapshot: () => LedgerSnapshot }).buildLedgerSnapshot()
        const rebuyChips = ledger.rows.reduce((sum, row) => sum + row.rebuys, 0) * 1000
        if (chips !== total + rebuyChips) {
          throw new Error(`run ${run} step ${step}: ${chips} chips on the books, expected ${total + rebuyChips}`)
        }
        // The ledger sees every chip and the house keeps nothing.
        expect(ledger.totalChips).toBe(chips)
        expect(ledger.totalBoughtIn).toBe(chips)
        expect(ledger.rows.reduce((sum, row) => sum + row.net, 0)).toBe(0)
        const seatIndexes = internals.data.gameState.players.map(entry => entry.seatIndex)
        expect(new Set(seatIndexes).size).toBe(seatIndexes.length)
        const ids = internals.data.gameState.players.map(entry => entry.id)
        expect(new Set(ids).size).toBe(ids.length)
        if (internals.data.hostId) {
          expect(internals.data.hostId.startsWith('bot_')).toBe(false)
        }
      }
    }
  })
})
