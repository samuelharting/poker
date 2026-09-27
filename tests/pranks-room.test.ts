import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import {
  canDeliverShot,
  computeBigLossBeers,
  CHASER_LEVELS,
  CHASER_WINDOW_MS,
  createDrinkLedgerEntry,
  deliverShot,
  DRINK_COOLDOWN_MS,
  getShotBlockReasonFromState,
  orderDrink,
  PASS_OUT_LEVEL,
  recordShotBought,
  SHOT_COOLDOWN_HANDS,
  SHOT_LEVEL_BOOST,
  SHOT_RECEIVE_COOLDOWN_HANDS,
  toPublicDrinkState,
  WATER_KICK_IN_MS,
} from '@/lib/drinks'
import { CHIP_FLICK_COOLDOWN_MS, isValidPrankEvent, type PrankEvent } from '@/lib/pranks'
import { parseC2S, parseS2C, type C2SMessage, type S2CMessage } from '@/shared/protocol'
import { computeHouseRules, HOUSE_BEER_CAP, type HouseRuleOutcome, type HouseRulePlayer } from '@/lib/houseRules'
import type { Card } from '@/lib/poker/types'
import { connect, createHarness, MockConnection, send as sendTo, type TypedMessage } from './helpers/roomHarness'

interface Seat {
  connection: Connection
  playerId: string
  send: (message: C2SMessage) => void
}

function createTable() {
  const { room, server } = createHarness()
  server.seatedStartLevel = 0
  const tunable = server as unknown as { botShotRandom: () => number }
  tunable.botShotRandom = () => 1
  /** `phone` joins from the 2D layout: no drink controls, so no pranks either way. */
  /** Sets a player's buzz directly (beers are one per hand now). */
  const setLevel = (playerId: string, level: number) => {
    const ledger = (server as unknown as { drinkLedger: Record<string, { level: number; passedOut: boolean; passedOutAt?: number | null }> }).drinkLedger
    ledger[playerId] ??= createDrinkLedgerEntry()
    ledger[playerId]!.level = level
    if (level >= PASS_OUT_LEVEL) {
      ledger[playerId]!.passedOut = true
      ledger[playerId]!.passedOutAt = Date.now()
    }
  }
  const join = (id: string, nickname: string, seatIndex: number, phone = false): Seat => {
    const connection = connect(server, room, id)
    const send = (message: C2SMessage) => sendTo(server, connection, message)
    send({ type: 'join_room', nickname })
    send({ type: 'seat_me', seatIndex })
    send({ type: 'set_drink_capable', capable: !phone })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('missing session')
    return { connection, playerId: session.yourId, send }
  }
  return { room, server, join, tunable, setLevel }
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

function drinkEventKinds(connection: Connection): string[] {
  return messagesOf(connection)
    .filter((message): message is TypedMessage<'drink_event'> => message.type === 'drink_event')
    .map(message => message.event.kind)
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

/** Lets the showdown run out, stopping as soon as the hand is over (before the next deal). */
function runOutHand(viewer: Seat) {
  // Covers a run-it-twice vote timing out plus the paced street-by-street runout.
  for (let step = 0; step < 200 && state(viewer).phase === 'in_hand'; step += 1) {
    vi.advanceTimersByTime(250)
  }
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
  it('parses buy_shot, flick_chip and set_drink_capable', () => {
    expect(parseC2S(JSON.stringify({ type: 'buy_shot', targetId: ' p2 ' }))).toEqual({ type: 'buy_shot', targetId: 'p2' })
    expect(parseC2S(JSON.stringify({ type: 'flick_chip', targetId: 'p2' }))).toEqual({ type: 'flick_chip', targetId: 'p2' })
    expect(parseC2S(JSON.stringify({ type: 'buy_shot' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'flick_chip', targetId: 7 }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'buy_shot', targetId: 'x'.repeat(65) }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'set_drink_capable', capable: true }))).toEqual({ type: 'set_drink_capable', capable: true })
    expect(parseC2S(JSON.stringify({ type: 'set_drink_capable', capable: 'yes' }))).toBeNull()
  })

  it('validates prank events from the server', () => {
    const event: PrankEvent = {
      id: 'e1', kind: 'shot', fromId: 'a', fromNickname: 'Sam', targetId: 'b', targetNickname: 'Alex', at: 1, level: 3, levelAdded: 3,
    }
    expect(isValidPrankEvent(event)).toBe(true)
    expect(isValidPrankEvent({ ...event, kind: 'shot_queued' })).toBe(true)
    expect(isValidPrankEvent({ ...event, kind: 'punch' })).toBe(false)
    expect(isValidPrankEvent({ ...event, targetId: 'a' })).toBe(false)
    expect(isValidPrankEvent({ ...event, level: 11 })).toBe(false)
    expect(parseS2C(JSON.stringify({ type: 'prank_event', event }))).toMatchObject({ type: 'prank_event', event: { kind: 'shot' } })
  })
})

describe('shot rules (pure)', () => {
  it('pours +3 uncapped: a delivered shot can black someone out', () => {
    const target = createDrinkLedgerEntry()
    target.level = 8
    const result = deliverShot(target, { handNumber: 4, targetIsLive: false, now: 1_000 })
    expect(result).toEqual({ ok: true, levelAdded: 2, passedOut: true })
    expect(target.level).toBe(PASS_OUT_LEVEL)
    expect(target.passedOut).toBe(true)
    expect(target.shots).toBe(1)
  })

  it('never pours for a live, blacked-out or recently-shot target', () => {
    const target = createDrinkLedgerEntry()
    expect(canDeliverShot(target, { handNumber: 2, targetIsLive: true })).toBe(false)
    expect(deliverShot(target, { handNumber: 2, targetIsLive: true, now: 1 })).toEqual({ ok: false })
    expect(target.level).toBe(0)
    deliverShot(target, { handNumber: 2, targetIsLive: false, now: 1 })
    expect(canDeliverShot(target, { handNumber: 4, targetIsLive: false })).toBe(false)
    expect(canDeliverShot(target, { handNumber: 2 + SHOT_RECEIVE_COOLDOWN_HANDS, targetIsLive: false })).toBe(true)
    target.passedOut = true
    expect(canDeliverShot(target, { handNumber: 9, targetIsLive: false })).toBe(false)
  })

  it('mirrors the purchase block reasons from public state for the button', () => {
    const buyer = createDrinkLedgerEntry()
    recordShotBought(buyer, 2)
    expect(getShotBlockReasonFromState(toPublicDrinkState(buyer), undefined, 4)).toBe('Next shot in 3 hands.')
    expect(getShotBlockReasonFromState(toPublicDrinkState(buyer), undefined, 7)).toBeNull()
    expect(getShotBlockReasonFromState(undefined, { passedOut: true }, 1, 'Alex')).toBe('Alex already blacked out. Let them sleep.')
    expect(getShotBlockReasonFromState(undefined, undefined, 0)).toBeNull()
  })

  it('a chaser water applies instantly (-2) and is not also queued', () => {
    const entry = createDrinkLedgerEntry()
    deliverShot(entry, { handNumber: 1, targetIsLive: false, now: 1_000 })
    expect(entry.level).toBe(3)
    const result = orderDrink(entry, { kind: 'water', now: 2_000, drinkId: 'w1', handNumber: 1, isDealtIntoLiveHand: false })
    expect(result).toEqual({ ok: true, passedOut: false, chaser: true })
    expect(entry.level).toBe(3 - CHASER_LEVELS)
    expect(entry.pendingWaters).toHaveLength(0)
    expect(entry.chaserUntil).toBeNull()
  })
})

describe('PokerRoom buy_shot', () => {
  it('pours straight away for a player out of the hand: +3, counted, broadcast to everyone', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })

    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_BOOST, shots: 1, shotsWaiting: 0 })
    expect(drinksOf(alex, sam.playerId)?.shotReadyAtHand).toBe(SHOT_COOLDOWN_HANDS)
    for (const viewer of [sam, alex]) {
      expect(prankEvents(viewer.connection).map(event => event.kind)).toEqual(['shot'])
      expect(prankEvents(viewer.connection).at(-1)).toMatchObject({
        fromId: sam.playerId, fromNickname: 'Sam', targetId: alex.playerId, targetNickname: 'Alex', levelAdded: 3, level: 3,
      })
    }
  })

  it('queues a shot for a live player and pours it the moment they fold', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    const seats = [sam, alex, cy]
    sam.send({ type: 'start_game' })
    const target = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    const buyer = seats.find(seat => seat !== target)!

    buyer.send({ type: 'buy_shot', targetId: target.playerId })
    expect(prankEvents(cy.connection).at(-1)).toMatchObject({ kind: 'shot_queued', targetId: target.playerId })
    expect(drinksOf(sam, target.playerId)).toMatchObject({ level: 0, shots: 0, shotsWaiting: 1, chaserUntil: 0 })

    target.send({ type: 'player_action', action: 'fold' })
    expect(state(sam).players.find(player => player.id === target.playerId)?.status).toBe('folded')
    expect(drinksOf(sam, target.playerId)).toMatchObject({ level: 3, shots: 1, shotsWaiting: 0 })
    expect(drinksOf(sam, target.playerId)!.chaserUntil).toBeGreaterThan(Date.now())
    expect(prankEvents(sam.connection).at(-1)).toMatchObject({ kind: 'shot', targetId: target.playerId })
  })

  it('pours right away, even for a live player, but waits while it is their turn', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    const seats = [sam, alex, cy]
    sam.send({ type: 'start_game' })
    const actor = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    const bystander = seats.find(seat => seat !== actor)!
    const buyer = seats.find(seat => seat !== actor && seat !== bystander)!

    // A live player who isn't deciding right now gets it at once.
    buyer.send({ type: 'buy_shot', targetId: bystander.playerId })
    expect(drinksOf(sam, bystander.playerId)).toMatchObject({ level: 3, shots: 1, shotsWaiting: 0 })

    // The player on the clock gets it the moment they act.
    bystander.send({ type: 'buy_shot', targetId: actor.playerId })
    expect(drinksOf(sam, actor.playerId)).toMatchObject({ level: 0, shotsWaiting: 1 })
    actor.send({ type: 'player_action', action: 'call' })
    expect(drinksOf(sam, actor.playerId)).toMatchObject({ level: 3, shots: 1, shotsWaiting: 0 })
  })

  it('a mid-hand shot that would black them out keeps them on the edge until they fold', () => {
    vi.useFakeTimers()
    const { join, setLevel } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    const seats = [sam, alex, cy]
    sam.send({ type: 'start_game' })
    const target = seats.find(seat => seat.playerId !== state(sam).actingPlayerId)!
    const buyer = seats.find(seat => seat !== target)!
    setLevel(target.playerId, 8)
    buyer.send({ type: 'buy_shot', targetId: target.playerId })
    // Still in the hand: awake on the edge.
    expect(drinksOf(sam, target.playerId)).toMatchObject({ level: PASS_OUT_LEVEL - 0.5, passedOut: false, shots: 1 })

    // Play on; the target folds on their turn and blacks out at once.
    let guard = 0
    while (state(sam).phase === 'in_hand' && !drinksOf(sam, target.playerId)?.passedOut && guard < 12) {
      const actingId = state(sam).actingPlayerId
      const actingSeat = seats.find(seat => seat.playerId === actingId)
      if (!actingSeat) break
      actingSeat.send({ type: 'player_action', action: actingSeat === target ? 'fold' : 'call' })
      guard += 1
    }
    expect(drinksOf(sam, target.playerId)).toMatchObject({ level: PASS_OUT_LEVEL, passedOut: true })
    expect(drinkEventKinds(sam.connection)).toContain('passed_out')
  })

  it('chasing an edge shot with water in time cancels the blackout', () => {
    vi.useFakeTimers()
    const { join, setLevel } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    const seats = [sam, alex, cy]
    sam.send({ type: 'start_game' })
    const target = seats.find(seat => seat.playerId !== state(sam).actingPlayerId)!
    const buyer = seats.find(seat => seat !== target)!
    setLevel(target.playerId, 8)
    buyer.send({ type: 'buy_shot', targetId: target.playerId })
    target.send({ type: 'order_drink', kind: 'water' })
    vi.advanceTimersByTime(3_100)
    expect(drinksOf(sam, target.playerId)!.level).toBeLessThan(PASS_OUT_LEVEL - 0.5)
    let guard = 0
    while (state(sam).phase === 'in_hand' && guard < 12) {
      const actingSeat = seats.find(seat => seat.playerId === state(sam).actingPlayerId)
      if (!actingSeat) break
      actingSeat.send({ type: 'player_action', action: actingSeat === target ? 'fold' : 'call' })
      guard += 1
    }
    expect(drinksOf(sam, target.playerId)).toMatchObject({ passedOut: false })
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
    expect(drinksOf(sam, cy.playerId)).toMatchObject({ shots: 0, shotsWaiting: 0 })

    playToHand(sam, [sam, alex, cy], SHOT_COOLDOWN_HANDS - 1)
    sam.send({ type: 'buy_shot', targetId: cy.playerId })
    expect(lastFailure(sam)).toBe('Next shot in 1 hand.')

    playToHand(sam, [sam, alex, cy], SHOT_COOLDOWN_HANDS)
    sam.send({ type: 'buy_shot', targetId: cy.playerId })
    expect(drinksOf(sam, cy.playerId)?.shots).toBe(1)
  })

  it('delivers at most one shot per target every three hands; extras wait their turn', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    cy.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(prankEvents(cy.connection).at(-1)).toMatchObject({ kind: 'shot_queued', fromId: cy.playerId })
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ shots: 1, level: 3, shotsWaiting: 1 })

    playToHand(sam, [sam, alex, cy], SHOT_RECEIVE_COOLDOWN_HANDS - 1)
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ shots: 1, shotsWaiting: 1 })

    playToHand(sam, [sam, alex, cy], SHOT_RECEIVE_COOLDOWN_HANDS)
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ shots: 2, shotsWaiting: 0 })
  })

  it('has nothing for phones: no shots or flicks at them, none from them', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const phone = join('pip', 'Pip', 1, true)
    expect(state(sam).players.find(player => player.id === phone.playerId)?.drinkCapable).toBe(false)
    expect(state(sam).players.find(player => player.id === sam.playerId)?.drinkCapable).toBe(true)

    sam.send({ type: 'buy_shot', targetId: phone.playerId })
    expect(lastFailure(sam)).toBe("They're on their phone — no bar service")
    expect(drinksOf(sam, sam.playerId)?.shotReadyAtHand).toBe(0)
    sam.send({ type: 'flick_chip', targetId: phone.playerId })
    expect(lastFailure(sam)).toBe("They're on their phone — no bar service")

    phone.send({ type: 'buy_shot', targetId: sam.playerId })
    expect(lastFailure(phone)).toBe('Pranks are only at the desktop table')
    phone.send({ type: 'flick_chip', targetId: sam.playerId })
    expect(lastFailure(phone)).toBe('Pranks are only at the desktop table')
    expect(prankEvents(sam.connection)).toHaveLength(0)
  })

  it('rejects yourself, unseated targets and unseated buyers', () => {
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

  it('refuses a target who already blacked out', () => {
    vi.useFakeTimers()
    const { join, setLevel } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    setLevel(alex.playerId, PASS_OUT_LEVEL)
    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(sam)).toContain('already blacked out')
  })

  it('is disabled with fun mode off (both pranks), and turning it off drops queued shots', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    sam.send({ type: 'start_game' })
    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(drinksOf(sam, alex.playerId)?.shotsWaiting).toBe(1)
    sam.send({ type: 'update_table_settings', funModeEnabled: false })
    expect(state(sam).funModeEnabled).toBe(false)
    expect(drinksOf(sam, alex.playerId)?.shotsWaiting ?? 0).toBe(0)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe('Fun mode is off at this table')
    sam.send({ type: 'flick_chip', targetId: alex.playerId })
    expect(lastFailure(sam)).toBe('Fun mode is off at this table')
    expect(prankEvents(alex.connection).filter(event => event.kind !== 'shot_queued')).toHaveLength(0)
  })
})

describe('PokerRoom bots buying shots', () => {
  type BotHooks = {
    maybeScheduleBotShot: (amounts: Map<string, number>) => void
    buyShotFor: (buyerId: string, targetId: string) => { ok: boolean }
    broadcastState: () => void
  }

  function tableWithBot(phone = false) {
    const table = createTable()
    const sam = table.join('sam', 'Sam', 0, phone)
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
    expect(prankEvents(sam.connection).filter(event => event.kind.startsWith('shot'))).toHaveLength(1)
  })

  it('ignores small pots', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    hooks.maybeScheduleBotShot(new Map([[bot.id, 20]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection)).toHaveLength(0)
  })

  it('never buys for phone players', () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot(true)
    hooks.maybeScheduleBotShot(new Map([[bot.id, 100_000]]))
    vi.advanceTimersByTime(2_500)
    expect(prankEvents(sam.connection)).toHaveLength(0)
  })

  it("a bot's shot pours right away unless the human is on the clock", () => {
    vi.useFakeTimers()
    const { sam, bot, hooks } = tableWithBot()
    sam.send({ type: 'start_game' })
    expect(state(sam).phase).toBe('in_hand')
    const levelBefore = drinksOf(sam, sam.playerId)?.level ?? 0
    const samActing = state(sam).actingPlayerId === sam.playerId
    expect(hooks.buyShotFor(bot.id, sam.playerId).ok).toBe(true)
    hooks.broadcastState()
    if (samActing) {
      expect(drinksOf(sam, sam.playerId)).toMatchObject({ level: levelBefore, shotsWaiting: 1 })
    } else {
      expect(drinksOf(sam, sam.playerId)).toMatchObject({ level: levelBefore + 3, shotsWaiting: 0 })
    }
    // Bot cooldown applies either way.
    expect(hooks.buyShotFor(bot.id, sam.playerId).ok).toBe(false)
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
  it('a water within 20s of a delivered shot is an instant -2 chaser, never double-applied', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    const chaserUntil = drinksOf(alex, alex.playerId)?.chaserUntil ?? 0
    expect(chaserUntil - Date.now()).toBe(CHASER_WINDOW_MS)

    vi.advanceTimersByTime(CHASER_WINDOW_MS - 2_000)
    alex.send({ type: 'order_drink', kind: 'water' })
    expect(drinkEventKinds(sam.connection)).toContain('chaser')
    // Instant, and not queued as an ordinary water as well.
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_BOOST - CHASER_LEVELS, sobering: 0, chaserUntil: 0 })

    vi.advanceTimersByTime(WATER_KICK_IN_MS + 10)
    expect(drinksOf(sam, alex.playerId)?.level).toBe(SHOT_LEVEL_BOOST - CHASER_LEVELS)
    expect(drinkEventKinds(sam.connection)).not.toContain('water_kicked_in')
  })

  it('a water after the window is an ordinary (queued) water, not a chaser', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    vi.advanceTimersByTime(CHASER_WINDOW_MS + 1)
    alex.send({ type: 'order_drink', kind: 'water' })
    expect(drinkEventKinds(sam.connection)).not.toContain('chaser')
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_BOOST, sobering: 1 })
  })

  it('only the first water counts as the chaser', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'buy_shot', targetId: alex.playerId })
    alex.send({ type: 'order_drink', kind: 'water' })
    expect(drinksOf(sam, alex.playerId)?.level).toBe(SHOT_LEVEL_BOOST - CHASER_LEVELS)
    vi.advanceTimersByTime(DRINK_COOLDOWN_MS)
    alex.send({ type: 'order_drink', kind: 'water' })
    expect(drinkEventKinds(sam.connection).filter(kind => kind === 'chaser')).toHaveLength(1)
    expect(drinksOf(sam, alex.playerId)).toMatchObject({ level: SHOT_LEVEL_BOOST - CHASER_LEVELS, sobering: 1 })
  })

  it('the chaser window opens at delivery, not at purchase', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const cy = join('cy', 'Cy', 2)
    sam.send({ type: 'start_game' })
    const seats = [sam, alex, cy]
    const target = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    const buyer = seats.find(seat => seat !== target)!
    buyer.send({ type: 'buy_shot', targetId: target.playerId })
    expect(drinksOf(sam, target.playerId)?.chaserUntil).toBe(0)
    vi.advanceTimersByTime(5_000)
    target.send({ type: 'player_action', action: 'fold' })
    expect(drinksOf(sam, target.playerId)!.chaserUntil - Date.now()).toBe(CHASER_WINDOW_MS)
  })
})

describe('house rules (pure)', () => {
  const c = (code: string): Card => ({
    rank: code[0] as Card['rank'],
    suit: ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[code[1] as 's' | 'h' | 'd' | 'c'],
  })
  const cards = (codes: string) => codes.split(' ').map(c)
  const player = (overrides: Partial<HouseRulePlayer> & { id: string }): HouseRulePlayer => ({
    drinkCapable: true,
    holeCards: [],
    folded: false,
    startStack: 1000,
    endStack: 1000,
    won: 0,
    ...overrides,
  })
  const outcomeOf = (outcomes: HouseRuleOutcome[], id: string) => outcomes.find(outcome => outcome.playerId === id)

  it('big loss: more than 10% is one beer, more than 25% is two (boundaries exclusive)', () => {
    expect(computeBigLossBeers(1000, 900)).toBe(0)
    expect(computeBigLossBeers(1000, 899)).toBe(1)
    expect(computeBigLossBeers(1000, 750)).toBe(1)
    expect(computeBigLossBeers(1000, 749)).toBe(2)
    expect(computeBigLossBeers(1000, 0)).toBe(2)
    // Uncalled bets come back before the final stack is measured: no loss.
    expect(computeBigLossBeers(1000, 1000)).toBe(0)
    // A split pot's share counts toward the final stack.
    expect(computeBigLossBeers(1000, 950)).toBe(0)
  })

  it('lost to the 7-2 at showdown: a house shot for each showdown loser, not for folders or phones', () => {
    const board = cards('7h 2s Kd 9c 4h')
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [board],
      players: [
        player({ id: 'winner', holeCards: cards('7c 2d'), won: 400, endStack: 1200 }),
        player({ id: 'loser', holeCards: cards('Ah Qh'), endStack: 800 }),
        player({ id: 'folder', holeCards: cards('3c 3d'), folded: true, endStack: 980 }),
        player({ id: 'phone', holeCards: cards('Jc Jd'), drinkCapable: false, endStack: 800 }),
      ],
    })
    expect(outcomeOf(outcomes, 'loser')?.shots).toContain('seven_two')
    expect(outcomeOf(outcomes, 'folder')).toBeUndefined()
    expect(outcomeOf(outcomes, 'phone')).toBeUndefined()
    expect(outcomeOf(outcomes, 'winner')?.shots ?? []).not.toContain('seven_two')
  })

  it('no showdown (everyone folded to the 7-2): nobody lost to it', () => {
    const outcomes = computeHouseRules({
      showdown: false,
      boards: [cards('7h 2s Kd')],
      players: [
        player({ id: 'winner', holeCards: cards('7c 2d'), won: 60, endStack: 1030 }),
        player({ id: 'folder', holeCards: cards('Ah Qh'), folded: true, endStack: 970 }),
      ],
    })
    expect(outcomes.flatMap(outcome => outcome.shots)).toEqual([])
  })

  it('got rivered: ahead on the turn, beaten on the river', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [cards('Kh 7d 2c 9s 8h')],
      players: [
        player({ id: 'kings', holeCards: cards('Ks Kc'), endStack: 500 }),
        player({ id: 'straight', holeCards: cards('Th Jd'), won: 1000, endStack: 1500 }),
      ],
    })
    expect(outcomeOf(outcomes, 'kings')?.shots).toEqual(['rivered'])
    expect(outcomeOf(outcomes, 'straight')?.shots ?? []).toEqual([])
  })

  it('run it twice: rivered on one board is still at most one shot', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [cards('Kh 7d 2c 9s 8h'), cards('Kh 7d 2c 9s 8d')],
      players: [
        player({ id: 'kings', holeCards: cards('Ks Kc'), endStack: 500 }),
        player({ id: 'straight', holeCards: cards('Th Jd'), won: 1000, endStack: 1500 }),
      ],
    })
    expect(outcomeOf(outcomes, 'kings')?.shots.filter(rule => rule === 'rivered')).toHaveLength(1)
  })

  it('quads or better at showdown: cheers, a house shot for every drink-capable seat', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [cards('9h 9d 4c 2s Kd')],
      players: [
        player({ id: 'quads', holeCards: cards('9s 9c'), won: 600, endStack: 1300 }),
        player({ id: 'loser', holeCards: cards('Ks Kc'), endStack: 700 }),
        player({ id: 'folder', holeCards: cards('3c 5d'), folded: true, endStack: 990 }),
        player({ id: 'phone', drinkCapable: false }),
      ],
    })
    for (const id of ['quads', 'loser', 'folder']) {
      expect(outcomeOf(outcomes, id)?.shots).toContain('cheers')
    }
    expect(outcomeOf(outcomes, 'phone')).toBeUndefined()
  })

  it('bad beat: losing at showdown with a set or better made with a hole card is a beer; beers cap at 2', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [cards('8h 8d 3c Qs Qd')],
      players: [
        // Set of eights (a full house, even) that loses to a bigger boat.
        player({ id: 'set', holeCards: cards('8s 2c'), endStack: 0 }),
        player({ id: 'boat', holeCards: cards('Qh Qc'), won: 2000, endStack: 2000 }),
      ],
    })
    const set = outcomeOf(outcomes, 'set')!
    expect(set.beerRules).toEqual(['big_loss', 'bad_beat', 'lost_showdown'])
    expect(set.beers).toBe(HOUSE_BEER_CAP)
  })

  it('a board-only hand is not a bad beat', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [cards('8h 8d 8c Qs 2d')],
      players: [
        player({ id: 'board', holeCards: cards('3s 4c'), endStack: 950 }),
        player({ id: 'winner', holeCards: cards('Ah Kc'), won: 100, endStack: 1050 }),
      ],
    })
    expect(outcomeOf(outcomes, 'board')?.beerRules ?? []).not.toContain('bad_beat')
  })

  it('big win: a pot worth more than half your starting stack is a free water', () => {
    const outcomes = computeHouseRules({
      showdown: false,
      boards: [],
      players: [
        player({ id: 'big', won: 501, endStack: 1300 }),
        player({ id: 'small', won: 500, endStack: 1200 }),
      ],
    })
    expect(outcomeOf(outcomes, 'big')?.freeWater).toBe(true)
    // Every winner drinks a victory beer; only the big one also gets the free water.
    expect(outcomeOf(outcomes, 'small')).toMatchObject({ freeWater: false, beerRules: ['winner'] })
  })
})

describe('PokerRoom house rules', () => {
  type Internals = {
    data: { gameState: { players: Array<{ id: string; stack: number; totalInPot: number; holeCards: Card[]; status: string }>; phase: string; communityCards: Card[]; round: string; winners?: Array<{ playerId: string; amount: number }> } }
    handStartStacks: Map<string, number>
    applyHouseRules: (winners: Map<string, number>) => void
    broadcastState: () => void
  }

  it('an all-in bust drinks two, the winner gets a free water, and nothing fires mid-hand', () => {
    vi.useFakeTimers()
    const { join, setLevel } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const seats = [sam, alex]
    setLevel(sam.playerId, 5)
    setLevel(alex.playerId, 5)
    sam.send({ type: 'start_game' })
    const shover = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    const caller = seats.find(seat => seat !== shover)!
    shover.send({ type: 'player_action', action: 'all_in' })
    expect(drinkEventKinds(sam.connection).filter(kind => kind.startsWith('house'))).toEqual([])
    caller.send({ type: 'player_action', action: 'call' })
    runOutHand(sam)
    const final = state(sam)
    expect(final.phase).toBe('between_hands')
    const busted = final.players.find(player => player.stack === 0)
    const houseBeers = messagesOf(sam.connection)
      .filter((message): message is TypedMessage<'drink_event'> => message.type === 'drink_event')
      .map(message => message.event)
      .filter(event => event.kind === 'house_beer')
    if (busted) {
      // The dealer's-round beer can also land on the button; only check the bust.
      expect(houseBeers.filter(event => event.playerId === busted.id)).toEqual([expect.objectContaining({ playerId: busted.id, amount: 2 })])
      expect(busted.drinks?.beers).toBe(2)
      expect(drinkEventKinds(sam.connection)).toContain('house_water')
    } else {
      // Chopped pot: nobody lost anything (only a dealer's-round beer, at most).
      expect(houseBeers.every(event => event.amount === 1)).toBe(true)
    }
  })

  it('an uncalled shove is returned: the folder only loses a blind (no beer)', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const seats = [sam, alex]
    sam.send({ type: 'start_game' })
    const shover = seats.find(seat => seat.playerId === state(sam).actingPlayerId)!
    const folder = seats.find(seat => seat !== shover)!
    shover.send({ type: 'player_action', action: 'all_in' })
    folder.send({ type: 'player_action', action: 'fold' })
    expect(state(sam).phase).toBe('between_hands')
    // The folder lost only a blind: no big-loss beer. (The dealer's-round beer goes to the button.)
    const folderBeers = messagesOf(sam.connection)
      .filter((message): message is TypedMessage<'drink_event'> => message.type === 'drink_event')
      .map(message => message.event)
      .filter(event => event.kind === 'house_beer' && event.playerId === folder.playerId && !state(sam).players.find(player => player.id === folder.playerId)?.isDealer)
    expect(folderBeers).toEqual([])
  })

  it('pours house shots with their rule, bypassing shot limits; skips phones and fun mode off', () => {
    vi.useFakeTimers()
    const { join, server } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const pip = join('pip', 'Pip', 2, true)
    const internals = server as unknown as Internals
    // Sam just had a bought shot: his receive limit is spent.
    alex.send({ type: 'buy_shot', targetId: sam.playerId })
    expect(drinksOf(sam, sam.playerId)?.shots).toBe(1)

    const game = internals.data.gameState
    game.phase = 'between_hands'
    game.round = 'showdown'
    game.communityCards = [
      { rank: '7', suit: 'hearts' }, { rank: '2', suit: 'spades' }, { rank: 'K', suit: 'diamonds' },
      { rank: '9', suit: 'clubs' }, { rank: '4', suit: 'hearts' },
    ]
    game.winners = [{ playerId: alex.playerId, amount: 200 }]
    for (const seat of game.players) {
      seat.status = 'active'
      seat.holeCards = seat.id === alex.playerId
        ? [{ rank: '7', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }]
        : [{ rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'hearts' }]
    }
    internals.applyHouseRules(new Map([[alex.playerId, 200]]))
    internals.broadcastState()
    const houseShots = prankEvents(sam.connection).filter(event => event.kind === 'house_shot')
    expect(houseShots).toEqual([expect.objectContaining({ targetId: sam.playerId, rule: 'seven_two', fromId: 'house' })])
    expect(drinksOf(sam, sam.playerId)?.shots).toBe(2)
    expect(houseShots.some(event => event.targetId === pip.playerId)).toBe(false)

    sam.send({ type: 'update_table_settings', funModeEnabled: false })
    internals.applyHouseRules(new Map([[alex.playerId, 200]]))
    expect(prankEvents(sam.connection).filter(event => event.kind === 'house_shot')).toHaveLength(1)
  })
})

