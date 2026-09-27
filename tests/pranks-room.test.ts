import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import {
  buyShot,
  CHASER_LEVELS,
  CHASER_WINDOW_MS,
  createDrinkLedgerEntry,
  DRINK_COOLDOWN_MS,
  getShotBlockReasonFromState,
  PASS_OUT_LEVEL,
  SHOT_COOLDOWN_HANDS,
  SHOT_LEVEL_BOOST,
  SHOT_LEVEL_CAP,
  SHOT_LIVE_TARGET_REASON,
  SHOT_RECEIVE_COOLDOWN_HANDS,
  toPublicDrinkState,
  WATER_KICK_IN_MS,
} from '@/lib/drinks'
import { CHIP_FLICK_COOLDOWN_MS, describePrankEvent, isValidPrankEvent, type PrankEvent } from '@/lib/pranks'
import { parseC2S, parseS2C, type C2SMessage, type S2CMessage } from '@/shared/protocol'
import { connect, createHarness, MockConnection, send as sendTo, type TypedMessage } from './helpers/roomHarness'

interface Seat {
  connection: Connection
  playerId: string
  send: (message: C2SMessage) => void
}

function createTable() {
  const { room, server } = createHarness()
  const tunable = server as unknown as { botShotRandom: () => number }
  tunable.botShotRandom = () => 1
  const join = (id: string, nickname: string, seatIndex: number): Seat => {
    const connection = connect(server, room, id)
    const send = (message: C2SMessage) => sendTo(server, connection, message)
    send({ type: 'join_room', nickname })
    send({ type: 'seat_me', seatIndex })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('missing session')
    return { connection, playerId: session.yourId, send }
  }
  return { room, server, join, tunable }
}

function messagesOf(connection: Connection): S2CMessage[] {
  return (connection as unknown as MockConnection).messages
}

function last<T extends S2CMessage['type']>(connection: Connection, type: T): TypedMessage<T> | undefined {
  const messages = messagesOf(connection)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === type) return messages[index] as TypedMessage<T>
  }
  return undefined
}

function prankEvents(connection: Connection): PrankEvent[] {
  return messagesOf(connection)
    .filter((message): message is TypedMessage<'prank_event'> => message.type === 'prank_event')
    .map(message => message.event)
}

function state(viewer: Seat) {
  return last(viewer.connection, 'room_snapshot')!.state
}

function drinksOf(viewer: Seat, playerId: string) {
  return state(viewer).players.find(player => player.id === playerId)?.drinks
}

function lastFailure(seat: Seat) {
  return last(seat.connection, 'action_failed')?.message ?? ''
}

/** Plays hands out by folding until the hand number reaches `hand` (between hands). */
function playToHand(host: Seat, seats: Seat[], hand: number) {
  while (state(host).handNumber < hand) {
    host.send({ type: 'start_game' })
    let guard = 0
    while (state(host).phase === 'in_hand' && guard < 20) {
      const acting = state(host).actingPlayerId
      seats.find(seat => seat.playerId === acting)?.send({ type: 'player_action', action: 'fold' })
      guard += 1
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('prank protocol', () => {
  it('parses buy_shot and flick_chip with a target', () => {
    expect(parseC2S(JSON.stringify({ type: 'buy_shot', targetId: ' p2 ' }))).toEqual({ type: 'buy_shot', targetId: 'p2' })
    expect(parseC2S(JSON.stringify({ type: 'flick_chip', targetId: 'p2' }))).toEqual({ type: 'flick_chip', targetId: 'p2' })
    expect(parseC2S(JSON.stringify({ type: 'buy_shot' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'flick_chip', targetId: 7 }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'buy_shot', targetId: 'x'.repeat(65) }))).toBeNull()
  })

  it('validates prank events from the server', () => {
    const event: PrankEvent = {
      id: 'e1', kind: 'shot', fromId: 'a', fromNickname: 'Sam', targetId: 'b', targetNickname: 'Alex', at: 1, level: 3, levelAdded: 3,
    }
    expect(isValidPrankEvent(event)).toBe(true)
    expect(isValidPrankEvent({ ...event, kind: 'punch' })).toBe(false)
    expect(isValidPrankEvent({ ...event, targetId: 'a' })).toBe(false)
    expect(isValidPrankEvent({ ...event, level: 11 })).toBe(false)
    expect(parseS2C(JSON.stringify({ type: 'prank_event', event }))).toMatchObject({ type: 'prank_event', event: { kind: 'shot' } })
  })

  it('describes pranks for toasts from each point of view', () => {
    const shot = { kind: 'shot' as const, fromId: 'a', fromNickname: 'Sam', targetId: 'b', targetNickname: 'Alex', levelAdded: 3 }
    expect(describePrankEvent(shot).text).toBe('Sam bought Alex a shot 🥃 (+3)')
    expect(describePrankEvent(shot, 'a').text).toBe('You bought Alex a shot 🥃 (+3)')
    expect(describePrankEvent(shot, 'b').text).toBe('Sam bought you a shot 🥃 (+3)')
    expect(describePrankEvent({ ...shot, kind: 'chip_flick' }).text).toBe('Sam flicked a chip at Alex. Bonk!')
  })
})

describe('shot rules (pure)', () => {
  it('adds three levels but never past the cap, so a shot can never pass anyone out', () => {
    const buyer = createDrinkLedgerEntry()
    const target = createDrinkLedgerEntry()
    target.level = 8
    const result = buyShot(buyer, target, { handNumber: 4, targetIsLive: false })
    expect(result).toEqual({ ok: true, levelAdded: SHOT_LEVEL_CAP - 8 })
    expect(target.level).toBe(SHOT_LEVEL_CAP)
    expect(target.level).toBeLessThan(PASS_OUT_LEVEL)
    expect(target.passedOut).toBe(false)
    expect(target.shots).toBe(1)
  })

  it('refuses a shot for a player already at the cap', () => {
    const target = createDrinkLedgerEntry()
    target.level = SHOT_LEVEL_CAP
    const result = buyShot(createDrinkLedgerEntry(), target, { handNumber: 1, targetIsLive: false }, 'Alex')
    expect(result).toEqual({ ok: false, reason: "Alex is wrecked enough. Shots can't knock anyone out." })
    expect(target.level).toBe(SHOT_LEVEL_CAP)
  })

  it('mirrors the block reasons from public state for the button', () => {
    const buyer = createDrinkLedgerEntry()
    const target = createDrinkLedgerEntry()
    buyShot(buyer, target, { handNumber: 2, targetIsLive: false })
    const context = { handNumber: 4, targetIsLive: false }
    expect(getShotBlockReasonFromState(toPublicDrinkState(buyer), toPublicDrinkState(target), context))
      .toBe('Next shot in 3 hands.')
    expect(getShotBlockReasonFromState(undefined, toPublicDrinkState(target), context, 'Alex'))
      .toBe('Alex just had a shot. Try again in 1 hand.')
    expect(getShotBlockReasonFromState(undefined, undefined, { handNumber: 4, targetIsLive: true }))
      .toBe(SHOT_LIVE_TARGET_REASON)
    expect(getShotBlockReasonFromState(undefined, undefined, { handNumber: 7, targetIsLive: false })).toBeNull()
  })
})

describe('PokerRoom buy_shot', () => {
  it('buys a seated, out-of-hand player a shot: +3, counted, broadcast to everyone', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })

    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_BOOST, shots: 1, passedOut: false })
    expect(drinksOf(alex, sam.playerId)?.shotReadyAtHand).toBe(SHOT_COOLDOWN_HANDS)
    for (const viewer of [sam, alex]) {
      expect(prankEvents(viewer.connection).at(-1)).toMatchObject({
        kind: 'shot',
        fromId: sam.playerId,
        fromNickname: 'Sam',
        targetId: alex.playerId,
        targetNickname: 'Alex',
        levelAdded: 3,
        level: 3,
      })
    }
  })

  it('can never target a player who is live in the hand (all-in included)', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    sam.send({ type: 'start_game' })
    expect(state(sam).phase).toBe('in_hand')

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe(SHOT_LIVE_TARGET_REASON)
    expect(drinksOf(sam, alex.playerId)?.level ?? 0).toBe(0)
    expect(prankEvents(sam.connection)).toHaveLength(0)

    // Whoever is acting goes all-in: still live, still protected.
    const acting = [sam, alex, cy].find(seat => seat.playerId === state(sam).actingPlayerId)!
    acting.send({ type: 'player_action', action: 'all_in' })
    const buyer = [sam, alex, cy].find(seat => seat !== acting)!
    buyer.send({ type: 'buy_shot', targetId: acting.playerId })
    expect(lastFailure(buyer)).toBe(SHOT_LIVE_TARGET_REASON)
    expect(drinksOf(sam, acting.playerId)?.shots ?? 0).toBe(0)
  })

  it('allows a shot for a player who has folded this hand', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    sam.send({ type: 'start_game' })
    const seats = [sam, alex, cy]
    const folder = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    folder.send({ type: 'player_action', action: 'fold' })
    expect(state(sam).phase).toBe('in_hand')
    const buyer = seats.find(seat => seat !== folder)!

    buyer.send({ type: 'buy_shot', targetId: folder.playerId })
    expect(drinksOf(sam, folder.playerId)).toMatchObject({ level: 3, shots: 1 })
  })

  it('can never cause a pass-out: shots cap at level 9 and are refused at the cap', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    for (let beer = 0; beer < 8; beer += 1) {
      alex.send({ type: 'order_drink', kind: 'beer' })
      vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    }
    expect(drinksOf(sam, alex.playerId)?.level).toBe(8)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_CAP, passedOut: false, shots: 1 })
    expect(prankEvents(sam.connection).at(-1)).toMatchObject({ levelAdded: 1, passedOut: false })

    expect(state(sam).players.every(player => !player.drinks?.passedOut)).toBe(true)
    expect(prankEvents(cy.connection).every(event => event.passedOut === false)).toBe(true)
  })

  it('limits each buyer to one shot every five hands', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    sam.send({ type: 'buy_shot', targetId: cy.playerId })
    expect(lastFailure(sam)).toBe('Next shot in 5 hands.')
    expect(drinksOf(sam, cy.playerId)?.shots ?? 0).toBe(0)

    playToHand(sam, [sam, alex, cy], SHOT_COOLDOWN_HANDS - 1)
    sam.send({ type: 'buy_shot', targetId: cy.playerId })
    expect(lastFailure(sam)).toBe('Next shot in 1 hand.')

    playToHand(sam, [sam, alex, cy], SHOT_COOLDOWN_HANDS)
    sam.send({ type: 'buy_shot', targetId: cy.playerId })
    expect(drinksOf(sam, cy.playerId)?.shots).toBe(1)
  })

  it('limits each target to one shot every three hands, so a table cannot gang up', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    cy.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(cy)).toBe('Alex just had a shot. Try again in 3 hands.')
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ shots: 1, level: 3 })

    playToHand(sam, [sam, alex, cy], SHOT_RECEIVE_COOLDOWN_HANDS)
    cy.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(drinksOf(sam, alex.playerId)?.shots).toBe(2)
  })

  it('rejects yourself, unseated targets, spectators and unseated buyers', () => {
    vi.useFakeTimers()
    const { join, server, room } = createTable()
    const sam = join('sam', 'Sam', 0)
    join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: sam.playerId })
    expect(lastFailure(sam)).toBe('Nice try. Pick someone else.')
    sam.send({ type: 'buy_shot', targetId: 'ghost' })
    expect(lastFailure(sam)).toBe('That player is not at the table')

    const rail = connect(server, room, 'rail')
    sendTo(server, rail, { type: 'buy_shot', targetId: sam.playerId })
    expect(last(rail, 'action_failed')?.message).toContain('Join the room')
    expect(prankEvents(sam.connection)).toHaveLength(0)
  })

  it('refuses a target who already passed out', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    for (let beer = 0; beer < 10; beer += 1) {
      alex.send({ type: 'order_drink', kind: 'beer' })
      vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    }
    expect(drinksOf(sam, alex.playerId)?.passedOut).toBe(true)
    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(sam)).toContain('already passed out')
  })

  it('is disabled with fun mode off (both pranks)', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    sam.send({ type: 'update_table_settings', funModeEnabled: false })
    expect(state(sam).funModeEnabled).toBe(false)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe('Fun mode is off at this table')
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe('Fun mode is off at this table')
    expect(prankEvents(alex.connection)).toHaveLength(0)
  })
})

describe('PokerRoom bots buying shots', () => {
  type BotHooks = { maybeScheduleBotShot: (amounts: Map<string, number>) => void }

  function tableWithBot() {
    const table = createTable()
    const sam = table.join('sam', 'Sam', 0)
    sam.send({ type: 'add_bots', count: 1 })
    const bot = state(sam).players.find(player => player.isBot)!
    table.tunable.botShotRandom = () => 0
    const hooks = table.server as unknown as BotHooks
    return { ...table, sam, bot, hooks }
  }

  it('buys a human a shot after a big pot, through the same rules', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    hooks.maybeScheduleBotShot(new Map([[bot.id, 100_000]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection).at(-1)).toMatchObject({ kind: 'shot', fromId: bot.id, targetId: sam.playerId })
    expect(drinksOf(sam, sam.playerId)).toMatchObject({ level: 3, shots: 1 })

    // Bot cooldown: no second shot right away.
    hooks.maybeScheduleBotShot(new Map([[bot.id, 100_000]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection).filter(event => event.kind === 'shot')).toHaveLength(1)
  })

  it('ignores small pots', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    hooks.maybeScheduleBotShot(new Map([[bot.id, 20]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection)).toHaveLength(0)
  })

  it('never shoots a live player, even if the next hand deals them in before the shot lands', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    hooks.maybeScheduleBotShot(new Map([[bot.id, 100_000]]))
    sam.send({ type: 'start_game' })
    expect(state(sam).phase).toBe('in_hand')
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection)).toHaveLength(0)
    expect(drinksOf(sam, sam.playerId)?.shots ?? 0).toBe(0)
  })

  it('does not schedule anything while every human is live', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    sam.send({ type: 'start_game' })
    hooks.maybeScheduleBotShot(new Map([[bot.id, 100_000]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection).filter(event => event.kind === 'shot')).toHaveLength(0)
  })
})

describe('PokerRoom flick_chip', () => {
  it('broadcasts a cosmetic flick and never touches stacks', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    sam.send({ type: 'start_game' })
    const stacksBefore = state(sam).players.map(player => [player.id, player.stack, player.bet])

    // Allowed any time, even mid-hand at a live player.
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    expect(prankEvents(alex.connection).at(-1)).toMatchObject({
      kind: 'chip_flick', fromId: sam.playerId, targetId: alex.playerId,
    })
    alex.send({ type: 'flick_chip', targetId: sam.playerId })
    const after = last(sam.connection, 'room_snapshot')!.state.players.map(player => [player.id, player.stack, player.bet])
    expect(after).toEqual(stacksBefore)
  })

  it('rate limits each sender to one flick every 8 seconds', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe('Reloading. Next chip in 8s.')
    alex.send({ type: 'flick_chip', targetId: sam.playerId })
    expect(prankEvents(sam.connection)).toHaveLength(2)

    vi.advanceTimersByTime(CHIP_FLICK_COOLDOWN_MS)
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    expect(prankEvents(sam.connection)).toHaveLength(3)
  })

  it('rejects flicking yourself or an empty seat', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    join('alex', 'Alex', 1)
    sam.send({ type: 'flick_chip', targetId: sam.playerId })
    expect(lastFailure(sam)).toBe('Nice try. Pick someone else.')
    sam.send({ type: 'flick_chip', targetId: 'nobody' })
    expect(lastFailure(sam)).toBe('That player is not at the table')
  })
})

describe('PokerRoom shot chaser', () => {
  it('a water within 20s of a shot is a chaser: it takes 2 of the shot levels back off', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    const chaserUntil = drinksOf(alex, alex.playerId)?.chaserUntil ?? 0
    expect(chaserUntil).toBeGreaterThan(Date.now())
    expect(chaserUntil - Date.now()).toBeLessThanOrEqual(CHASER_WINDOW_MS)

    vi.advanceTimersByTime(CHASER_WINDOW_MS - 2_000)
    alex.send({ type: 'order_drink', kind: 'water' })
    const events = messagesOf(sam.connection)
      .filter((message): message is TypedMessage<'drink_event'> => message.type === 'drink_event')
      .map(message => message.event)
    expect(events.at(-1)).toMatchObject({ kind: 'chaser', playerId: alex.playerId })
    expect(drinksOf(sam, alex.playerId)?.chaserUntil).toBe(0)

    vi.advanceTimersByTime(WATER_KICK_IN_MS + 10)
    expect(drinksOf(sam, alex.playerId)?.level).toBe(SHOT_LEVEL_BOOST - CHASER_LEVELS)
  })

  it('a water after the window is an ordinary -1 water', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    vi.advanceTimersByTime(CHASER_WINDOW_MS + 1)
    alex.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 10)
    expect(drinksOf(sam, alex.playerId)?.level).toBe(SHOT_LEVEL_BOOST - 1)
  })

  it('only the first water counts as the chaser', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    alex.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    alex.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(WATER_KICK_IN_MS + 10)
    // 3 - 2 (chaser) - 1 (plain water) = 0
    expect(drinksOf(sam, alex.playerId)?.level).toBe(0)
  })

  it('never takes back more than the shot added', () => {
    const buyer = createDrinkLedgerEntry()
    const target = createDrinkLedgerEntry()
    target.level = 8
    buyShot(buyer, target, { handNumber: 1, targetIsLive: false, now: 1_000 })
    expect(target.level).toBe(9)
    expect(target.chaserLevels).toBe(1)
  })
})
