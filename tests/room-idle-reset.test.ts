import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Room } from 'partykit/server'
import PokerRoom, {
  HAND_COUNTER_RETENTION,
  IDLE_RESET_BOTS_ONLY_MS,
  IDLE_RESET_HELD_MS,
  IDLE_RESET_SLACK_MS,
} from '@/partykit/room'
import {
  MockRoom,
  disconnect,
  joinPlayer,
  lastMessage,
  messagesOf,
  seatPlayer,
  send,
} from './helpers/roomHarness'

/**
 * Bots-only tables must pause and, after IDLE_RESET_HELD_MS with nobody connected,
 * reset; and nothing may ever reset while a human is connected.
 */

// Long simulated stretches (tens of minutes of bot play) are slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 })

interface Internals {
  data: {
    gameState: {
      phase: string
      handNumber: number
      players: Array<{ id: string; stack: number; isBot?: boolean; status: string }>
    }
    hostId: string | null
    playerNicknames: Record<string, string>
    reconnectTokens: Record<string, string>
    spectatorIds: Record<string, true>
    spectatorStacks: Record<string, number>
    ledger: { accounts: Record<string, unknown>; events: unknown[] }
    handHistory: unknown[]
    social: { chatLog: unknown[] }
    statsByUsername: Record<string, unknown>
    countedHandPlayers: Record<string, true>
    countedFolds: Record<string, true>
    countedWinHands: Record<number, true>
    lastHumanSeenAt?: number
    humansPresent?: boolean
    tableSettings: { startingStack: number }
  }
  drinkLedger: Record<string, unknown>
  autoBeerTimer: unknown
  idleResetBotsOnlyMs: number
  idleResetHeldMs: number
  lastChipFlickAt: Map<string, number>
  foldStreaks: Map<string, number>
  resetTable(arrivingConnId?: string): boolean
}

const internalsOf = (server: PokerRoom) => server as unknown as Internals

function roomWithStorage(values: Map<string, unknown>, env: Record<string, unknown> = {}) {
  const room = new MockRoom()
  ;(room as unknown as { env: unknown }).env = env
  ;(room as unknown as { storage: unknown }).storage = {
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    delete: vi.fn(async (key: string) => values.delete(key)),
  }
  return room
}

function quietServer(room: MockRoom) {
  const server = new PokerRoom(room as unknown as Room)
  server.autoBeerRandom = () => 1
  const tunable = server as unknown as { botDrinkRandom?: () => number; botPeekRandom?: () => number }
  tunable.botDrinkRandom = () => 1
  tunable.botPeekRandom = () => 1
  return server
}

/** Host + guest-less table with three bots and a hand dealt. */
async function liveTable(storage = new Map<string, unknown>()) {
  const room = roomWithStorage(storage)
  const server = quietServer(room)
  await server.onStart()
  const host = joinPlayer(server, room, 'c-host', 'Host')
  seatPlayer(server, host.connection)
  send(server, host.connection, { type: 'add_bots', count: 3 })
  send(server, host.connection, { type: 'start_game' })
  return { storage, room, server, host, internals: internalsOf(server) }
}

/** Let time pass in small steps so chained timers (bots, auto-start) all run. */
async function pass(ms: number, step = 5_000) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - elapsed))
  }
}

function expectFreshTable(internals: Internals) {
  expect(internals.data.gameState.players).toEqual([])
  expect(internals.data.gameState.handNumber).toBe(0)
  expect(internals.data.gameState.phase).not.toBe('in_hand')
  expect(internals.data.hostId).toBeNull()
  expect(internals.data.playerNicknames).toEqual({})
  expect(internals.data.reconnectTokens).toEqual({})
  expect(internals.data.spectatorIds).toEqual({})
  expect(internals.data.spectatorStacks).toEqual({})
  expect(internals.data.ledger.accounts).toEqual({})
  expect(internals.data.ledger.events).toEqual([])
  expect(internals.data.handHistory).toEqual([])
  expect(internals.data.social.chatLog).toEqual([])
  expect(internals.data.statsByUsername).toEqual({})
  expect(internals.drinkLedger).toEqual({})
}

describe('idle table: constants', () => {
  it('resets a bots-only table after two minutes and a held table after five', () => {
    expect(IDLE_RESET_BOTS_ONLY_MS).toBe(2 * 60_000)
    expect(IDLE_RESET_HELD_MS).toBe(5 * 60_000)
    expect(IDLE_RESET_SLACK_MS).toBeGreaterThan(0)
  })

  it('lets a dev server or test lower the windows, but never below one second', () => {
    const lowered = internalsOf(new PokerRoom(roomWithStorage(new Map(), {
      POKER_IDLE_RESET_BOTS_ONLY_MS: '5000',
      POKER_IDLE_RESET_HELD_MS: '9000',
    }) as unknown as Room))
    expect(lowered.idleResetBotsOnlyMs).toBe(5000)
    expect(lowered.idleResetHeldMs).toBe(9000)
    const bad = internalsOf(new PokerRoom(roomWithStorage(new Map(), {
      POKER_IDLE_RESET_BOTS_ONLY_MS: '10',
      POKER_IDLE_RESET_HELD_MS: 'soon',
    }) as unknown as Room))
    expect(bad.idleResetBotsOnlyMs).toBe(IDLE_RESET_BOTS_ONLY_MS)
    expect(bad.idleResetHeldMs).toBe(IDLE_RESET_HELD_MS)
    const unset = internalsOf(new PokerRoom(new MockRoom() as unknown as Room))
    expect(unset.idleResetBotsOnlyMs).toBe(IDLE_RESET_BOTS_ONLY_MS)
    expect(unset.idleResetHeldMs).toBe(IDLE_RESET_HELD_MS)
  })
})

describe('idle table: pause and reset', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not deal another hand once the last human is gone, and resets after the idle window', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals, storage } = await liveTable()
    expect(internals.data.gameState.phase).toBe('in_hand')
    await pass(1_000)
    expect(storage.size).toBe(1)

    disconnect(server, room, host.connection)
    // The hand in progress finishes on its own (bots act, the absent human times out)...
    await pass(2 * 60_000)
    expect(internals.data.gameState.phase).toBe('between_hands')
    const handsAtPause = internals.data.gameState.handNumber
    // ...but no new hand is dealt while nobody is connected.
    await pass(2 * 60_000)
    expect(internals.data.gameState.handNumber).toBe(handsAtPause)
    expect(internals.data.gameState.players.length).toBeGreaterThan(0)

    await pass(IDLE_RESET_HELD_MS - 4 * 60_000 + IDLE_RESET_SLACK_MS + 5_000)
    expectFreshTable(internals)
    expect(storage.has('room-data-v1')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps dealing hands while a human is connected (control)', async () => {
    vi.useFakeTimers()
    const { internals } = await liveTable()
    await pass(60_000)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(1)
  })

  it('removes bots, human seats, ledger, history, drinks and chat, and leaves no timers or alarm', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals, storage } = await liveTable()
    send(server, host.connection, { type: 'table_chat', message: 'hello table' })
    send(server, host.connection, { type: 'set_drink_capable', capable: true })
    send(server, host.connection, { type: 'order_drink', kind: 'beer' })
    await pass(90_000)
    expect(internals.data.handHistory.length).toBeGreaterThan(0)
    expect(Object.keys(internals.data.ledger.accounts).length).toBeGreaterThan(0)
    expect(internals.data.social.chatLog.length).toBe(1)

    disconnect(server, room, host.connection)
    await pass(IDLE_RESET_HELD_MS + IDLE_RESET_SLACK_MS + 5 * 60_000)
    expectFreshTable(internals)
    expect(storage.has('room-data-v1')).toBe(false)
    expect(internals.autoBeerTimer).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    const storageMock = (room as unknown as { storage: { deleteAlarm: ReturnType<typeof vi.fn> } }).storage
    expect(storageMock.deleteAlarm).toHaveBeenCalled()
  })

  it('does not reset a moment early, and ties go to the person coming back', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    await pass(1_000)
    disconnect(server, room, host.connection)
    const handBefore = internals.data.gameState.handNumber

    await vi.advanceTimersByTimeAsync(IDLE_RESET_HELD_MS - 1_000)
    expect(internals.data.gameState.players.length).toBe(4)
    // Exactly on the boundary: nothing has reset, and the comeback keeps the table.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(internals.data.gameState.players.length).toBe(4)
    const back = joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    expect(back.playerId).toBe(host.playerId)
    expect(internals.data.gameState.players.length).toBe(4)
    expect(internals.data.gameState.handNumber).toBeGreaterThanOrEqual(handBefore)
    await pass(IDLE_RESET_HELD_MS * 2)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(0)
  })

  it('a human connecting cancels a pending reset timer', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    await pass(IDLE_RESET_HELD_MS - 60_000)
    joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    await pass(30 * 60_000)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(0)
  })

  it('a brief disconnect of the only human (refresh, phone sleep, wifi drop) never resets and returns their seat', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    await pass(10_000)
    const stackBefore = internals.data.gameState.players.find(player => player.id === host.playerId)?.stack
    disconnect(server, room, host.connection)
    await pass(45_000)
    const back = joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    expect(back.playerId).toBe(host.playerId)
    const me = lastMessage(back.connection, 'room_snapshot')?.state.players.find(player => player.id === host.playerId)
    expect(me).toBeDefined()
    expect(stackBefore).toBeDefined()
    expect(internals.data.hostId).toBe(host.playerId)
    // Nothing resets later either, and the table is dealing again.
    await pass(IDLE_RESET_HELD_MS + 60_000)
    // (A bot may bust over this much play, so only the human's seat is pinned.)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(1)
  })

  it('two humans: one leaving keeps the table going and the timer never starts', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    const guest = joinPlayer(server, room, 'c-guest', 'Guest')
    seatPlayer(server, guest.connection)
    disconnect(server, room, guest.connection)
    const handBefore = internals.data.gameState.handNumber
    await pass(IDLE_RESET_HELD_MS + 5 * 60_000)
    expect(internals.data.humansPresent).toBe(true)
    expect(internals.data.gameState.players.length).toBeGreaterThanOrEqual(4)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(handBefore)
    expect(internals.data.hostId).toBe(host.playerId)
  })

  it('a connected spectator (never seated) prevents the pause and the reset', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    const watcher = room.addConnection('c-watcher')
    server.onConnect(watcher)
    send(server, watcher, { type: 'join_room', nickname: 'Watcher' })
    send(server, host.connection, { type: 'leave_room' })
    disconnect(server, room, host.connection)
    // A rail viewer who joined but never sat keeps the room alive.
    await pass(IDLE_RESET_HELD_MS + 5 * 60_000)
    expect(internals.data.gameState.players.length).toBeGreaterThan(0)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(1)
    expect(internals.data.humansPresent).toBe(true)
  })

  it('a socket that never sent join_room still counts as a person', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    const lurker = room.addConnection('c-lurker')
    server.onConnect(lurker)
    disconnect(server, room, host.connection)
    await pass(IDLE_RESET_HELD_MS + 5 * 60_000)
    expect(internals.data.gameState.players.length).toBe(4)
    expect(internals.data.humansPresent).toBe(true)
    // Once the lurker leaves too, the clock starts from that moment.
    disconnect(server, room, lurker)
    await pass(IDLE_RESET_HELD_MS - 60_000)
    expect(internals.data.gameState.players.length).toBe(4)
    await pass(2 * 60_000 + IDLE_RESET_SLACK_MS)
    expectFreshTable(internals)
  })

  it('the timer re-checks live connections when it fires', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    // A socket appears in the connection set without any handler having run
    // (so nothing cancelled the countdown): firing must still see it.
    room.addConnection('c-sneaky')
    await pass(IDLE_RESET_HELD_MS + 2 * IDLE_RESET_SLACK_MS)
    expect(internals.data.gameState.players.length).toBe(4)
    expect(internals.data.humansPresent).toBe(true)
  })

  it('a socket that is already closing does not count as a person', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    // The runtime still lists the closing socket while onClose runs.
    server.onClose(host.connection)
    expect(internals.data.humansPresent).toBe(false)
    room.removeConnection(host.connection.id)
    await pass(IDLE_RESET_HELD_MS + IDLE_RESET_SLACK_MS + 5 * 60_000)
    expectFreshTable(internals)
  })

  it('a socket that died without any close event (zombie) neither keeps the table dealing nor blocks the reset', async () => {
    vi.useFakeTimers()
    const { room, host, internals } = await liveTable()
    // The runtime dropped the socket but onClose never ran: playerToConnection still names it.
    room.removeConnection(host.connection.id)
    await pass(2 * 60_000)
    expect(internals.data.humansPresent).toBe(false)
    const handsAtPause = internals.data.gameState.handNumber
    await pass(2 * 60_000)
    expect(internals.data.gameState.handNumber).toBe(handsAtPause)
    await pass(IDLE_RESET_HELD_MS + IDLE_RESET_SLACK_MS)
    expectFreshTable(internals)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never resets while a human is connected, even if asked directly', async () => {
    vi.useFakeTimers()
    const { server, internals } = await liveTable()
    const before = internals.data.gameState.players.length
    expect(internals.resetTable()).toBe(false)
    expect(internals.data.gameState.players.length).toBe(before)
  })

  it('a reset never lands mid-hand for a human who is acting', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    await pass(IDLE_RESET_HELD_MS - 2_000)
    const back = joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    // Past the idle boundary and the timer slack, while they play on.
    for (let i = 0; i < 12; i += 1) {
      const state = internals.data.gameState as unknown as {
        actingPlayerId: string | null
        currentBet: number
        players: Array<{ id: string; bet: number }>
      }
      if (state.actingPlayerId === host.playerId) {
        const me = state.players.find(player => player.id === host.playerId)!
        send(server, back.connection, { type: 'player_action', action: me.bet >= state.currentBet ? 'check' : 'call' })
      }
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(internals.data.gameState.players.length).toBe(4)
    expect(internals.data.hostId).toBe(host.playerId)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(0)
  })

  it('an empty untouched table never arms a timer', () => {
    vi.useFakeTimers()
    const room = new MockRoom()
    const server = quietServer(room)
    const lurker = room.addConnection('c1')
    server.onConnect(lurker)
    disconnect(server, room, lurker)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not throw on partial state', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    await pass(2 * 60_000)
    const broken = internals as unknown as Record<string, unknown> & { data: Record<string, unknown> }
    broken.data.ledger = undefined
    broken.data.handHistory = undefined
    broken.data.social = undefined
    broken.drinkLedger = { ghost: undefined }
    ;(room as unknown as { storage: Record<string, unknown> }).storage = { setAlarm: undefined, deleteAlarm: undefined }
    await pass(IDLE_RESET_HELD_MS + IDLE_RESET_SLACK_MS + 1_000)
    expect(internals.data.gameState.players).toEqual([])
    expect(internals.data.ledger.accounts).toEqual({})
    expect(internals.data.social.chatLog).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the paused table keeps its random-beer clock off', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    expect(internals.autoBeerTimer).not.toBeNull()
    disconnect(server, room, host.connection)
    expect(internals.autoBeerTimer).toBeNull()
    joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    expect(internals.autoBeerTimer).not.toBeNull()
  })
})

describe('idle table: bots-only (a) and held (b) thresholds', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Host leaves the table for good (leave_room) and closes the page: only bots remain. */
  async function botsOnlyTable() {
    const table = await liveTable()
    await pass(1_000)
    // Leave between hands so the seat goes at once (a mid-hand leaver keeps the
    // seat until the hand ends, which would make the timing random).
    for (let i = 0; i < 300 && table.internals.data.gameState.phase === 'in_hand'; i += 1) {
      const state = table.internals.data.gameState as unknown as {
        actingPlayerId: string | null
        currentBet: number
        players: Array<{ id: string; bet: number }>
      }
      if (state.actingPlayerId === table.host.playerId) {
        const me = state.players.find(player => player.id === table.host.playerId)!
        send(table.server, table.host.connection, { type: 'player_action', action: me.bet >= state.currentBet ? 'check' : 'call' })
      }
      await vi.advanceTimersByTimeAsync(1_000)
    }
    send(table.server, table.host.connection, { type: 'leave_room' })
    disconnect(table.server, table.room, table.host.connection)
    return table
  }

  const hasHuman = (internals: Internals) =>
    Object.keys(internals.data.playerNicknames).some(id => !id.startsWith('bot_'))

  it('(a) a bots-only table pauses at once and resets after two minutes without anyone', async () => {
    vi.useFakeTimers()
    const { internals } = await botsOnlyTable()
    await pass(30_000)
    expect(hasHuman(internals)).toBe(false)
    expect(internals.data.gameState.players.every(player => player.isBot)).toBe(true)
    const hand = internals.data.gameState.handNumber
    await pass(IDLE_RESET_BOTS_ONLY_MS - 60_000)
    expect(internals.data.gameState.handNumber).toBe(hand)
    expect(internals.data.gameState.players.length).toBe(3)

    await pass(60_000 + IDLE_RESET_SLACK_MS + 1_000)
    expectFreshTable(internals)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('(a) is not reset one tick early, and exactly on the boundary a comeback keeps the bots', async () => {
    vi.useFakeTimers()
    const { room, server, internals } = await botsOnlyTable()
    await vi.advanceTimersByTimeAsync(IDLE_RESET_BOTS_ONLY_MS - 1)
    expect(internals.data.gameState.players.length).toBe(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(internals.data.gameState.players.length).toBe(3)
    const back = room.addConnection('c-friend')
    server.onConnect(back)
    expect(internals.data.gameState.players.length).toBe(3)
    await pass(10 * 60_000)
    expect(internals.data.gameState.players.length).toBe(3)
  })

  it('(a) lazy reset: connecting after the two minutes gives a fresh empty table, under it does not', async () => {
    vi.useFakeTimers()
    const early = await botsOnlyTable()
    await pass(30_000)
    vi.setSystemTime(Date.now() + 30_000)
    early.server.onConnect(early.room.addConnection('c-early'))
    expect(early.internals.data.gameState.players.length).toBe(3)

    const late = await botsOnlyTable()
    await pass(30_000)
    vi.setSystemTime(Date.now() + IDLE_RESET_BOTS_ONLY_MS)
    const newcomer = late.room.addConnection('c-late')
    late.server.onConnect(newcomer)
    expectFreshTable(late.internals)
    const snapshot = messagesOf(newcomer).find(message => message.type === 'room_snapshot')
    expect(snapshot && snapshot.type === 'room_snapshot' && snapshot.state.players).toEqual([])
  })

  it('(a) a connect during the countdown cancels the pending reset', async () => {
    vi.useFakeTimers()
    const { room, server, internals } = await botsOnlyTable()
    await pass(IDLE_RESET_BOTS_ONLY_MS - 20_000)
    server.onConnect(room.addConnection('c-friend'))
    await pass(10 * 60_000)
    expect(internals.data.gameState.players.length).toBe(3)
  })

  it('(b) held seats of disconnected humans survive the bots-only window and are kept five minutes', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    await pass(1_000)
    disconnect(server, room, host.connection)
    // Paused, but everything is kept through the short window and well beyond it.
    await pass(IDLE_RESET_BOTS_ONLY_MS + 60_000)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    const hand = internals.data.gameState.handNumber
    await pass(60_000)
    expect(internals.data.gameState.handNumber).toBe(hand)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    // Past five minutes of nobody connected: reset.
    await pass(IDLE_RESET_HELD_MS - (IDLE_RESET_BOTS_ONLY_MS + 2 * 60_000) + IDLE_RESET_SLACK_MS + 5_000)
    expectFreshTable(internals)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('(b) is not reset a tick early, and the comeback at the boundary finds their seat', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    await pass(1_000)
    disconnect(server, room, host.connection)
    await vi.advanceTimersByTimeAsync(IDLE_RESET_HELD_MS - 1)
    expect(internals.data.gameState.players.length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1)
    const back = joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    expect(back.playerId).toBe(host.playerId)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
    await pass(HELD_FOREVER)
    expect(internals.data.gameState.players.some(player => player.id === host.playerId)).toBe(true)
  })

  it('(b) lazy reset: a friend rejoining after two minutes finds their seat, after five a fresh table', async () => {
    vi.useFakeTimers()
    const first = await liveTable()
    await pass(1_000)
    disconnect(first.server, first.room, first.host.connection)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    const back = joinPlayer(first.server, first.room, 'c-back', 'Host', first.host.reconnectToken)
    expect(back.playerId).toBe(first.host.playerId)
    expect(first.internals.data.gameState.players.some(player => player.id === first.host.playerId)).toBe(true)

    disconnect(first.server, first.room, back.connection)
    vi.setSystemTime(Date.now() + IDLE_RESET_HELD_MS + 1)
    const late = first.room.addConnection('c-late')
    first.server.onConnect(late)
    expectFreshTable(first.internals)
  })

  it('a table that starts bots-only after the last held entry is cleared shortens its wait', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    await pass(1_000)
    disconnect(server, room, host.connection)
    await pass(60_000)
    expect(internals.data.gameState.players.length).toBeGreaterThan(0)
    // The last human entry goes away (say the host removed it): the long timer is pulled in.
    const data = internals.data as unknown as Record<string, Record<string, unknown>>
    delete data.playerNicknames[host.playerId]
    delete data.reconnectTokens[host.playerId]
    internals.data.gameState.players = internals.data.gameState.players.filter(player => player.isBot)
    ;(server as unknown as { finalizeState(): void }).finalizeState()
    await pass(IDLE_RESET_BOTS_ONLY_MS + IDLE_RESET_SLACK_MS + 5_000)
    expectFreshTable(internals)
  })

  it('both windows are tunable per instance', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    internals.idleResetHeldMs = 10_000
    disconnect(server, room, host.connection)
    await pass(9_000)
    expect(internals.data.gameState.players.length).toBeGreaterThan(0)
    await pass(3_000 + IDLE_RESET_SLACK_MS)
    expectFreshTable(internals)
  })
})

const HELD_FOREVER = 2 * IDLE_RESET_HELD_MS

describe('idle table: lazy reset and persistence', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a human arriving after a long empty spell (lost timer) gets a clean table before they are admitted', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    // The process was frozen: time jumps without any timer firing.
    vi.setSystemTime(Date.now() + IDLE_RESET_HELD_MS + 60_000)
    const newcomer = room.addConnection('c-new')
    server.onConnect(newcomer)
    expectFreshTable(internals)
    const first = messagesOf(newcomer).find(message => message.type === 'room_snapshot')
    expect(first && first.type === 'room_snapshot' && first.state.players).toEqual([])
    expect(first && first.type === 'room_snapshot' && first.state.handNumber).toBe(0)
    // The old token no longer matches anyone: joining makes a fresh player.
    send(server, newcomer, { type: 'join_room', nickname: 'Host', reconnectToken: host.reconnectToken })
    expect(internals.data.gameState.players).toEqual([])
    expect(Object.keys(internals.data.playerNicknames).length).toBe(1)
  })

  it('a reconnect just inside the window (lost timer) keeps the table', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    vi.setSystemTime(Date.now() + IDLE_RESET_HELD_MS)
    const back = joinPlayer(server, room, 'c-back', 'Host', host.reconnectToken)
    expect(back.playerId).toBe(host.playerId)
    expect(internals.data.gameState.players.length).toBe(4)
  })

  it('saves lastHumanSeenAt, and a restarted empty table still resets lazily', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const first = await liveTable(storage)
    await pass(2_000)
    disconnect(first.server, first.room, first.host.connection)
    const leftAt = Date.now()
    await vi.advanceTimersByTimeAsync(1_000)
    const saved = JSON.parse(storage.get('room-data-v1') as string) as { lastHumanSeenAt: number; humansPresent: boolean }
    expect(saved.humansPresent).toBe(false)
    expect(saved.lastHumanSeenAt).toBe(leftAt)

    // The instance is evicted; a new one starts long after the idle window.
    vi.setSystemTime(leftAt + IDLE_RESET_HELD_MS + 120_000)
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    expect(internalsOf(second).data.gameState.players.length).toBe(4)
    const newcomer = secondRoom.addConnection('c-new')
    second.onConnect(newcomer)
    expectFreshTable(internalsOf(second))
  })

  it('a restarted empty table resets on its own timer when nobody comes back', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const first = await liveTable(storage)
    await pass(2_000)
    disconnect(first.server, first.room, first.host.connection)
    await vi.advanceTimersByTimeAsync(1_000)
    const leftAt = Date.now()
    vi.clearAllTimers()

    vi.setSystemTime(leftAt + 2 * 60_000)
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    await pass(2 * 60_000)
    expect(internalsOf(second).data.gameState.players.length).toBe(4)
    await pass(2 * 60_000)
    expectFreshTable(internalsOf(second))
  })

  it('a save written while humans were connected restarts the clock (a deploy is not idle time)', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const first = await liveTable(storage)
    await pass(2_000)
    expect(JSON.parse(storage.get('room-data-v1') as string).humansPresent).toBe(true)
    const savedAt = Date.now()
    // Evicted, and the server only comes back an hour later (e.g. a deploy).
    vi.setSystemTime(savedAt + 60 * 60_000)
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const back = joinPlayer(second, secondRoom, 'c-back', 'Host', first.host.reconnectToken)
    expect(back.playerId).toBe(first.host.playerId)
    expect(internalsOf(second).data.gameState.players.length).toBe(4)
  })

  it('old saves without the field are treated as "now"', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const first = await liveTable(storage)
    await pass(2_000)
    const saved = JSON.parse(storage.get('room-data-v1') as string)
    delete saved.lastHumanSeenAt
    delete saved.humansPresent
    storage.set('room-data-v1', JSON.stringify(saved))
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000)

    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const back = joinPlayer(second, secondRoom, 'c-back', 'Host', first.host.reconnectToken)
    expect(back.playerId).toBe(first.host.playerId)
    expect(internalsOf(second).data.gameState.players.length).toBe(4)
  })

  it('garbage in lastHumanSeenAt never causes a reset', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, unknown>()
    const first = await liveTable(storage)
    await pass(2_000)
    const saved = JSON.parse(storage.get('room-data-v1') as string)
    saved.humansPresent = false
    saved.lastHumanSeenAt = 'yesterday'
    storage.set('room-data-v1', JSON.stringify(saved))
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000)
    const secondRoom = roomWithStorage(storage)
    const second = quietServer(secondRoom)
    await second.onStart()
    const back = joinPlayer(second, secondRoom, 'c-back', 'Host', first.host.reconnectToken)
    expect(back.playerId).toBe(first.host.playerId)
  })

  it('after a reset a new human can sit, fill with bots and play a normal hand', async () => {
    vi.useFakeTimers()
    const { room, server, host, internals } = await liveTable()
    disconnect(server, room, host.connection)
    await pass(IDLE_RESET_HELD_MS + IDLE_RESET_SLACK_MS + 1_000)
    expectFreshTable(internals)

    const guest = joinPlayer(server, room, 'c-guest', 'Newcomer')
    expect(internals.data.hostId).toBe(guest.playerId)
    seatPlayer(server, guest.connection)
    send(server, guest.connection, { type: 'add_bots', count: 2 })
    send(server, guest.connection, { type: 'start_game' })
    expect(internals.data.gameState.phase).toBe('in_hand')
    expect(internals.data.gameState.players.length).toBe(3)

    // Play it out passively and watch the next hand come around by itself.
    for (let i = 0; i < 200 && internals.data.gameState.handNumber < 2; i += 1) {
      const state = internals.data.gameState as unknown as {
        phase: string
        actingPlayerId: string | null
        currentBet: number
        players: Array<{ id: string; bet: number }>
      }
      if (state.phase === 'in_hand' && state.actingPlayerId === guest.playerId) {
        const me = state.players.find(player => player.id === guest.playerId)!
        send(server, guest.connection, { type: 'player_action', action: me.bet >= state.currentBet ? 'check' : 'call' })
      }
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(internals.data.gameState.handNumber).toBeGreaterThanOrEqual(2)
    expect(internals.data.handHistory.length).toBeGreaterThan(0)
    expect(lastMessage(guest.connection, 'room_snapshot')?.state.viewerId).toBe(guest.playerId)
  })
})

describe('long-running tables: bounded growth', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('per-hand bookkeeping, history, ledger events and chat stay bounded over many hands', async () => {
    vi.useFakeTimers()
    const { server, host, internals } = await liveTable()
    // The human sits out (still connected, still host); three bots play. Keep them stacked so the game never stalls.
    send(server, host.connection, { type: 'set_sitting_out', sittingOut: true })
    const target = HAND_COUNTER_RETENTION + 40
    for (let i = 0; i < 6_000 && internals.data.gameState.handNumber < target; i += 1) {
      for (const player of internals.data.gameState.players) {
        if (player.stack < 500 && internals.data.gameState.phase !== 'in_hand') player.stack = 5_000
      }
      await vi.advanceTimersByTimeAsync(1_000)
      if (i % 50 === 0 && internals.data.gameState.players.filter(player => player.stack > 0).length < 3) {
        send(server, host.connection, { type: 'add_bots', count: 1 })
      }
      send(server, host.connection, { type: 'table_chat', message: `msg ${i}` })
    }
    const hand = internals.data.gameState.handNumber
    expect(hand).toBeGreaterThanOrEqual(target)

    const handsOf = (keys: string[]) => keys.map(key => Number(key.split(':')[0]))
    const oldest = hand - HAND_COUNTER_RETENTION
    expect(Math.min(...handsOf(Object.keys(internals.data.countedHandPlayers)))).toBeGreaterThanOrEqual(oldest)
    expect(Object.keys(internals.data.countedHandPlayers).length).toBeLessThanOrEqual((HAND_COUNTER_RETENTION + 2) * 4)
    expect(Object.keys(internals.data.countedWinHands).every(key => Number(key) >= oldest)).toBe(true)
    expect(internals.data.handHistory.length).toBeLessThanOrEqual(10)
    expect(internals.data.ledger.events.length).toBeLessThanOrEqual(60)
    expect(internals.data.social.chatLog.length).toBeLessThanOrEqual(18)
  }, 60_000)

  it('forgets stats and cooldowns of players the room no longer knows, and keeps the current ones', async () => {
    vi.useFakeTimers()
    const { server, host, internals } = await liveTable()
    const botId = internals.data.gameState.players.find(player => player.isBot)!.id
    internals.data.statsByUsername['bot:bot_gone'] = { handsPlayed: 3, folds: 1, wins: 1, totalWon: 5 }
    internals.data.statsByUsername[`bot:${botId}`] = { handsPlayed: 3, folds: 1, wins: 1, totalWon: 5 }
    internals.lastChipFlickAt.set('ghost', 1)
    internals.lastChipFlickAt.set(host.playerId, 1)
    internals.foldStreaks.set('ghost', 2)
    internals.foldStreaks.set(botId, 2)

    send(server, host.connection, { type: 'set_sitting_out', sittingOut: true })
    await pass(60_000)
    expect(internals.data.gameState.handNumber).toBeGreaterThan(1)
    expect(internals.data.statsByUsername['bot:bot_gone']).toBeUndefined()
    expect(internals.data.statsByUsername[`bot:${botId}`]).toBeDefined()
    expect(internals.lastChipFlickAt.has('ghost')).toBe(false)
    expect(internals.foldStreaks.has('ghost')).toBe(false)
    expect(internals.foldStreaks.has(botId)).toBe(true)
  })
})

// Type-only reference so the helper import stays used if cases are trimmed.
void (null as unknown as Connection)
