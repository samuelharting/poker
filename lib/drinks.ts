/**
 * Table drinks: beers make you drunk, water sobers you up, ten beers and you
 * pass out. Everything in this module is pure so the PartyKit room, the
 * client hooks and the tests all share one source of truth.
 *
 * Timing rules (server authoritative):
 * - Beer: +1 drunk level immediately.
 * - Water: -1 drunk level WATER_KICK_IN_MS (3s) after ordering, once the sip finishes.
 * - Wear-off: every WEAR_OFF_EVERY_HANDS (3) completed hands, -1 level on its own.
 * - Pass-out: reaching PASS_OUT_LEVEL (10). The player's hand is folded through
 *   the normal fold path when action reaches them; they wake up at the start of
 *   the next hand they did not pass out in, at WAKE_UP_LEVEL (6).
 * - Rate limit: one drink per DRINK_COOLDOWN_MS (3s) per player.
 * - Shots: any seated player can buy another seated player a shot, any time:
 *   +SHOT_LEVEL_BOOST (3) levels, uncapped (it can black them out). So a shot
 *   can never interfere with a live hand, it is queued on the server and only
 *   DELIVERED while the target is not live (folded, sitting out, or between
 *   hands); the animation, the +3 and the chaser window all start at delivery.
 *   - each buyer may buy one shot every SHOT_COOLDOWN_HANDS (5) hands (counted
 *     when bought);
 *   - each target receives at most one shot every SHOT_RECEIVE_COOLDOWN_HANDS
 *     (3) hands (counted when delivered); extra queued shots wait their turn.
 * - Chaser: a water ordered within CHASER_WINDOW_MS (20s) of a delivered shot
 *   applies INSTANTLY and takes CHASER_LEVELS (2) off. It is never also queued
 *   as an ordinary water (no double-apply); the window closes on any water.
 */
import type { Card, Rank, Suit } from './poker/types'

export type DrinkKind = 'beer' | 'water'

export const DRUNK_LEVEL_MAX = 10
export const PASS_OUT_LEVEL = 10
export const WAKE_UP_LEVEL = 6
export const DRINK_COOLDOWN_MS = 3_000
export const WATER_KICK_IN_MS = 3_000
export const WEAR_OFF_EVERY_HANDS = 3
/** A bought shot hits harder than a beer. */
export const SHOT_LEVEL_BOOST = 3
/** Each player may buy one shot for someone every this many hands. */
export const SHOT_COOLDOWN_HANDS = 5
/** Each player may be bought one shot every this many hands. */
export const SHOT_RECEIVE_COOLDOWN_HANDS = 3
/** After a shot, a water within this window is a chaser. */
export const CHASER_WINDOW_MS = 20_000
/** Levels a chaser water takes off, instantly. */
export const CHASER_LEVELS = 2
/** How long a passed-out player "slumps" before their hand is folded. */
export const PASS_OUT_FOLD_DELAY_MS = 900

export interface LastDrink {
  kind: DrinkKind
  /** Changes on every drink so renderers can trigger an animation exactly once. */
  id: string
  at: number
}

/** Public, per-player drink state that every client receives. */
export interface PlayerDrinkState {
  /** Current drunk level 0..10. */
  level: number
  /** Total beers this session. */
  beers: number
  /** Total waters this session. */
  waters: number
  lastDrink: LastDrink | null
  passedOut: boolean
  /** Waters ordered that have not kicked in yet. */
  sobering: number
  /** Shots other players bought them this session. */
  shots: number
  /** First hand number at which this player may buy someone a shot (0 = any time). */
  shotReadyAtHand: number
  /** First hand number at which this player may be bought another shot (0 = any time). */
  shotReceivableAtHand: number
  /** Server time (ms) until which a water counts as a chaser (0 = no chaser window). */
  chaserUntil: number
  /** Shots bought for this player that are waiting for them to leave the hand. */
  shotsWaiting: number
}

export const EMPTY_DRINK_STATE: Readonly<PlayerDrinkState> = Object.freeze({
  level: 0,
  beers: 0,
  waters: 0,
  lastDrink: null,
  passedOut: false,
  sobering: 0,
  shots: 0,
  shotReadyAtHand: 0,
  shotReceivableAtHand: 0,
  chaserUntil: 0,
  shotsWaiting: 0,
})

export function createEmptyDrinkState(): PlayerDrinkState {
  return { ...EMPTY_DRINK_STATE }
}

function clampLevel(level: number): number {
  return Math.max(0, Math.min(DRUNK_LEVEL_MAX, Math.floor(level)))
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** Defensive normalizer for data received over the wire. */
export function normalizeDrinkState(raw: unknown): PlayerDrinkState {
  if (!raw || typeof raw !== 'object') {
    return createEmptyDrinkState()
  }

  const candidate = raw as Partial<PlayerDrinkState>
  const lastDrinkRaw = candidate.lastDrink as Partial<LastDrink> | null | undefined
  const lastDrink = lastDrinkRaw &&
    typeof lastDrinkRaw === 'object' &&
    (lastDrinkRaw.kind === 'beer' || lastDrinkRaw.kind === 'water') &&
    typeof lastDrinkRaw.id === 'string' &&
    lastDrinkRaw.id.length > 0 &&
    typeof lastDrinkRaw.at === 'number' &&
    Number.isFinite(lastDrinkRaw.at)
    ? { kind: lastDrinkRaw.kind, id: lastDrinkRaw.id, at: lastDrinkRaw.at }
    : null

  return {
    level: clampLevel(nonNegativeInt(candidate.level)),
    beers: nonNegativeInt(candidate.beers),
    waters: nonNegativeInt(candidate.waters),
    lastDrink,
    passedOut: candidate.passedOut === true,
    sobering: nonNegativeInt(candidate.sobering),
    shots: nonNegativeInt(candidate.shots),
    shotReadyAtHand: nonNegativeInt(candidate.shotReadyAtHand),
    shotReceivableAtHand: nonNegativeInt(candidate.shotReceivableAtHand),
    chaserUntil: nonNegativeInt(candidate.chaserUntil),
    shotsWaiting: nonNegativeInt(candidate.shotsWaiting),
  }
}

// ---------------------------------------------------------------------------
// Server ledger
// ---------------------------------------------------------------------------

export interface PendingWater {
  id: string
  dueAt: number
}

/** Server-only bookkeeping on top of the public state. */
export interface DrinkLedgerEntry {
  level: number
  beers: number
  waters: number
  lastDrink: LastDrink | null
  passedOut: boolean
  lastOrderAt: number | null
  handsTowardSober: number
  pendingWaters: PendingWater[]
  /** Last hand number the player sleeps through; they wake when a later hand starts. */
  passedOutThroughHand: number | null
  /** Shots bought for this player. */
  shots: number
  /** Hand number when this player last bought someone a shot. */
  lastShotBoughtHand: number | null
  /** Hand number when this player was last bought a shot. */
  lastShotReceivedHand: number | null
  /** Open chaser window after a delivered shot (server ms). */
  chaserUntil: number | null
}

export function createDrinkLedgerEntry(): DrinkLedgerEntry {
  return {
    level: 0,
    beers: 0,
    waters: 0,
    lastDrink: null,
    passedOut: false,
    lastOrderAt: null,
    handsTowardSober: 0,
    pendingWaters: [],
    passedOutThroughHand: null,
    shots: 0,
    lastShotBoughtHand: null,
    lastShotReceivedHand: null,
    chaserUntil: null,
  }
}

export function toPublicDrinkState(entry: DrinkLedgerEntry | undefined): PlayerDrinkState {
  if (!entry) {
    return createEmptyDrinkState()
  }

  return {
    level: entry.level,
    beers: entry.beers,
    waters: entry.waters,
    lastDrink: entry.lastDrink ? { ...entry.lastDrink } : null,
    passedOut: entry.passedOut,
    sobering: entry.pendingWaters.length,
    shots: entry.shots,
    shotReadyAtHand: entry.lastShotBoughtHand === null ? 0 : entry.lastShotBoughtHand + SHOT_COOLDOWN_HANDS,
    shotReceivableAtHand: entry.lastShotReceivedHand === null
      ? 0
      : entry.lastShotReceivedHand + SHOT_RECEIVE_COOLDOWN_HANDS,
    chaserUntil: entry.chaserUntil ?? 0,
    // Filled in by the room from its delivery queue.
    shotsWaiting: 0,
  }
}

export interface DrinkOrderContext {
  kind: DrinkKind
  now: number
  drinkId: string
  /** Current hand number (0 before the first hand). */
  handNumber: number
  /** True when the player holds cards in a live hand right now. */
  isDealtIntoLiveHand: boolean
}

export type DrinkOrderResult =
  | { ok: true; passedOut: boolean; water?: PendingWater; chaser?: boolean }
  | { ok: false; reason: string }

/** Mutates `entry` when the order is accepted. */
export function orderDrink(entry: DrinkLedgerEntry, context: DrinkOrderContext): DrinkOrderResult {
  if (entry.passedOut) {
    return { ok: false, reason: 'You are passed out. The bartender cut you off until next hand.' }
  }

  if (entry.lastOrderAt !== null && context.now - entry.lastOrderAt < DRINK_COOLDOWN_MS) {
    return { ok: false, reason: 'Easy there. One drink every 3 seconds.' }
  }

  entry.lastOrderAt = context.now
  entry.lastDrink = { kind: context.kind, id: context.drinkId, at: context.now }

  if (context.kind === 'water') {
    entry.waters += 1
    // Chaser: inside the window after a delivered shot the water hits at once
    // (-2) and is NOT also queued as an ordinary water. One per shot.
    const chaser = entry.chaserUntil !== null && context.now <= entry.chaserUntil
    entry.chaserUntil = null
    if (chaser) {
      entry.level = clampLevel(entry.level - CHASER_LEVELS)
      return { ok: true, passedOut: false, chaser: true }
    }
    const water: PendingWater = { id: context.drinkId, dueAt: context.now + WATER_KICK_IN_MS }
    entry.pendingWaters.push(water)
    return { ok: true, passedOut: false, water }
  }

  entry.beers += 1
  return { ok: true, passedOut: raiseLevel(entry, 1, context) }
}

/** Adds drunk levels; returns true when that knocked the player out. */
function raiseLevel(
  entry: DrinkLedgerEntry,
  amount: number,
  context: Pick<DrinkOrderContext, 'handNumber' | 'isDealtIntoLiveHand'>
): boolean {
  entry.level = clampLevel(entry.level + amount)
  if (entry.level < PASS_OUT_LEVEL) {
    return false
  }

  entry.passedOut = true
  entry.passedOutThroughHand = context.isDealtIntoLiveHand
    ? context.handNumber
    : context.handNumber + 1
  entry.pendingWaters = []
  entry.handsTowardSober = 0
  return true
}

/** Hands until `buyer` may buy another shot (0 = ready now). */
export function getShotHandsRemaining(
  buyer: Pick<DrinkLedgerEntry, 'lastShotBoughtHand'> | undefined,
  handNumber: number
): number {
  if (!buyer || buyer.lastShotBoughtHand === null) {
    return 0
  }
  return Math.max(0, buyer.lastShotBoughtHand + SHOT_COOLDOWN_HANDS - handNumber)
}

/** Hands until `target` may be bought another shot (0 = ready now). */
export function getShotReceiveHandsRemaining(
  target: Pick<DrinkLedgerEntry, 'lastShotReceivedHand'> | undefined,
  handNumber: number
): number {
  if (!target || target.lastShotReceivedHand === null) {
    return 0
  }
  return Math.max(0, target.lastShotReceivedHand + SHOT_RECEIVE_COOLDOWN_HANDS - handNumber)
}

export function formatShotCooldown(handsRemaining: number): string {
  return `Next shot in ${handsRemaining} hand${handsRemaining === 1 ? '' : 's'}`
}

/**
 * True while a player still has a stake in the current hand: the hand is
 * live and they hold cards they have not folded (all-in counts as live).
 */
export function isLiveInHand(target: {
  phase: 'waiting' | 'in_hand' | 'between_hands'
  status: string
  holdsCards: boolean
}): boolean {
  return target.phase === 'in_hand' && target.holdsCards && target.status !== 'folded'
}

/**
 * Why `buyer` can't buy `target` a shot right now, or null when they can.
 * Seat, self-targeting and fun-mode checks belong to the caller. A live
 * target is fine: the shot waits for them (see canDeliverShot).
 */
export function getShotBlockReason(
  buyer: Pick<DrinkLedgerEntry, 'lastShotBoughtHand'> | undefined,
  target: Pick<DrinkLedgerEntry, 'passedOut'> | undefined,
  handNumber: number,
  targetName = 'They'
): string | null {
  const remaining = getShotHandsRemaining(buyer, handNumber)
  if (remaining > 0) {
    return `${formatShotCooldown(remaining)}.`
  }
  if (target?.passedOut) {
    return `${targetName} already blacked out. Let them sleep.`
  }
  return null
}

/** Counts a bought shot against the buyer's one-per-five-hands limit. */
export function recordShotBought(buyer: DrinkLedgerEntry, handNumber: number) {
  buyer.lastShotBoughtHand = handNumber
}

export interface ShotDeliveryContext {
  handNumber: number
  /** The target is still live in the current hand (see isLiveInHand). */
  targetIsLive: boolean
  /** Server time: the chaser window and a blackout start now. */
  now: number
}

/** A queued shot can land only outside a live hand, on someone awake, once per 3 hands. */
export function canDeliverShot(
  target: DrinkLedgerEntry | undefined,
  context: Pick<ShotDeliveryContext, 'handNumber' | 'targetIsLive'>
): boolean {
  if (context.targetIsLive || target?.passedOut) {
    return false
  }
  return getShotReceiveHandsRemaining(target, context.handNumber) === 0
}

export type ShotDeliveryResult =
  | { ok: true; levelAdded: number; passedOut: boolean }
  | { ok: false }

/**
 * Pours a queued shot for `target`: +3 levels (it can black them out, which is
 * fine because they are out of the hand), opens the chaser window and starts
 * the receive cooldown. Mutates `target` when delivered.
 */
export function deliverShot(target: DrinkLedgerEntry, context: ShotDeliveryContext): ShotDeliveryResult {
  if (!canDeliverShot(target, context)) {
    return { ok: false }
  }

  const before = target.level
  target.lastShotReceivedHand = context.handNumber
  target.shots += 1
  const passedOut = raiseLevel(target, SHOT_LEVEL_BOOST, {
    handNumber: context.handNumber,
    isDealtIntoLiveHand: false,
  })
  const levelAdded = target.level - before
  if (!passedOut) {
    target.chaserUntil = context.now + CHASER_WINDOW_MS
  }
  return { ok: true, levelAdded, passedOut }
}

// ---------------------------------------------------------------------------
// House rules: forced drinks after the hand ends (never mid-hand)
// ---------------------------------------------------------------------------

/** Lose more than this share of your hand-start stack in one hand: drink one. */
export const BIG_LOSS_ONE_BEER_FRACTION = 0.1
/** More than this share: drink two. */
export const BIG_LOSS_TWO_BEERS_FRACTION = 0.25

/**
 * Forced beers for a big loss: 1 when the stack dropped by more than 10% of
 * what they started the hand with, 2 when it dropped by more than 25%.
 * Measured on final stacks, so returned uncalled bets and split-pot shares
 * never count as losses.
 */
export function computeBigLossBeers(startStack: number, endStack: number): 0 | 1 | 2 {
  if (!(startStack > 0) || !Number.isFinite(endStack)) return 0
  const lost = startStack - endStack
  if (lost > startStack * BIG_LOSS_TWO_BEERS_FRACTION) return 2
  if (lost > startStack * BIG_LOSS_ONE_BEER_FRACTION) return 1
  return 0
}

/**
 * House rule beers: counted as beers, animated like one, but forced, so they
 * ignore the one-beer-per-hand and order cooldowns. Returns true on a blackout.
 */
export function forceBeers(entry: DrinkLedgerEntry, count: number, context: { drinkId: string; now: number; handNumber: number }): boolean {
  if (entry.passedOut || count <= 0) return false
  entry.beers += count
  entry.lastDrink = { kind: 'beer', id: context.drinkId, at: context.now }
  return raiseLevel(entry, count, { handNumber: context.handNumber, isDealtIntoLiveHand: false })
}

/** The big-win free water takes this much off, at once. */
export const FREE_WATER_LEVELS = 2

/** Big-win house rule: a free water that lands at once (-2), not the slow kind. */
export function pourFreeWater(entry: DrinkLedgerEntry): number {
  if (entry.passedOut) return 0
  const before = entry.level
  entry.level = clampLevel(entry.level - FREE_WATER_LEVELS)
  return before - entry.level
}

/**
 * A house shot (see lib/houseRules): like a delivered shot (+3, chaser
 * window) but it bypasses every shot limit and never touches the cooldowns.
 */
export function pourHouseShot(target: DrinkLedgerEntry, context: Omit<ShotDeliveryContext, 'targetIsLive'>): ShotDeliveryResult {
  if (target.passedOut) return { ok: false }
  const before = target.level
  target.shots += 1
  const passedOut = raiseLevel(target, SHOT_LEVEL_BOOST, { handNumber: context.handNumber, isDealtIntoLiveHand: false })
  if (!passedOut) {
    target.chaserUntil = context.now + CHASER_WINDOW_MS
  }
  return { ok: true, levelAdded: target.level - before, passedOut }
}

/**
 * Client-side mirror of getShotBlockReason from the public state, so the
 * button can say why it is disabled. The server stays authoritative.
 */
export function getShotBlockReasonFromState(
  buyer: Pick<PlayerDrinkState, 'shotReadyAtHand'> | undefined,
  target: Pick<PlayerDrinkState, 'passedOut'> | undefined,
  handNumber: number,
  targetName = 'They'
): string | null {
  // A "ready at hand N" of 0 means no cooldown; otherwise N = last + 5.
  const readyAt = buyer?.shotReadyAtHand ?? 0
  return getShotBlockReason(
    { lastShotBoughtHand: readyAt ? readyAt - SHOT_COOLDOWN_HANDS : null },
    { passedOut: target?.passedOut ?? false },
    handNumber,
    targetName
  )
}

/** Applies a pending water. Returns true when it existed (and was consumed). */
export function applyWaterKickIn(entry: DrinkLedgerEntry, waterId: string): boolean {
  const index = entry.pendingWaters.findIndex(water => water.id === waterId)
  if (index < 0) {
    return false
  }

  entry.pendingWaters.splice(index, 1)
  if (!entry.passedOut) {
    entry.level = clampLevel(entry.level - 1)
  }
  return true
}

/** Call once per completed hand. Returns true when the level dropped. */
export function applyHandCompleted(entry: DrinkLedgerEntry): boolean {
  if (entry.passedOut || entry.level <= 0) {
    entry.handsTowardSober = 0
    return false
  }

  entry.handsTowardSober += 1
  if (entry.handsTowardSober < WEAR_OFF_EVERY_HANDS) {
    return false
  }

  entry.handsTowardSober = 0
  entry.level = clampLevel(entry.level - 1)
  return true
}

/** Call when a new hand starts. Returns true when the player woke up. */
export function wakeIfRested(entry: DrinkLedgerEntry, startedHandNumber: number): boolean {
  if (!entry.passedOut) {
    return false
  }

  const through = entry.passedOutThroughHand ?? 0
  if (startedHandNumber <= through) {
    return false
  }

  entry.passedOut = false
  entry.passedOutThroughHand = null
  entry.level = WAKE_UP_LEVEL
  entry.handsTowardSober = 0
  return true
}

// ---------------------------------------------------------------------------
// Events shared with clients
// ---------------------------------------------------------------------------

export type DrinkEventKind =
  | 'beer'
  | 'water'
  | 'water_kicked_in'
  | 'passed_out'
  | 'woke_up'
  | 'chaser'
  /** House rules: forced beers (amount 1 or 2) and the big-win free water. */
  | 'house_beer'
  | 'house_water'

export const DRINK_EVENT_KINDS: readonly DrinkEventKind[] = [
  'beer',
  'water',
  'water_kicked_in',
  'passed_out',
  'woke_up',
  'chaser',
  'house_beer',
  'house_water',
]

export interface DrinkEvent {
  id: string
  kind: DrinkEventKind
  playerId: string
  nickname: string
  level: number
  beers: number
  at: number
  /** house_beer: how many forced beers (1 or 2). */
  amount?: number
}

export function describeDrinkEvent(event: Pick<DrinkEvent, 'kind' | 'nickname' | 'beers' | 'level' | 'amount'>, isSelf = false): {
  icon: string
  text: string
} {
  const who = isSelf ? 'You' : event.nickname
  switch (event.kind) {
    case 'beer':
      return {
        icon: '🍺',
        text: `${who} cracked a beer (${event.beers})`,
      }
    case 'water':
      return { icon: '💧', text: `${who} ordered a water` }
    case 'water_kicked_in':
      return { icon: '💧', text: isSelf ? 'Your water kicked in' : `${event.nickname}'s water kicked in` }
    case 'passed_out':
      return { icon: '💤', text: `${who} passed out` }
    case 'woke_up':
      return { icon: '☀️', text: isSelf ? 'You came to. Ow.' : `${event.nickname} woke up` }
    // House rules are shown as pictures on the table only (never toasted).
    case 'house_beer':
      return { icon: (event.amount ?? 1) >= 2 ? '🍺🍺' : '🍺', text: '' }
    case 'house_water':
      return { icon: '💧', text: '' }
    case 'chaser':
      return {
        icon: '💧',
        text: isSelf ? 'Nice chaser! 💧 That takes the edge off.' : `${event.nickname} chased the shot with water. Nice chaser! 💧`,
      }
  }
}

// ---------------------------------------------------------------------------
// Client-side visual effects
// ---------------------------------------------------------------------------

export type DrunkTier = 'sober' | 'buzzed' | 'tipsy' | 'drunk' | 'wasted' | 'out'

export interface DrunkEffectProfile {
  tier: DrunkTier
  level: number
  /** Peak blur of the table while a pulse is at its strongest. */
  blurPx: number
  /** Offset of the doubled "ghost" image. */
  ghostPx: number
  swayDeg: number
  swayPx: number
  /** Seconds per blur/double-vision pulse (shorter when drunker). */
  pulseSeconds: number
  /** Warm tint / vignette strength 0..1. */
  tint: number
  /** Chance a newly seen card is misread for a moment. */
  hallucinationChance: number
  hiccups: boolean
  wobblyButtons: boolean
}

export function getDrunkTier(level: number, passedOut = false): DrunkTier {
  if (passedOut) return 'out'
  if (level <= 0) return 'sober'
  if (level <= 2) return 'buzzed'
  if (level <= 4) return 'tipsy'
  if (level <= 6) return 'drunk'
  return 'wasted'
}

export function getDrunkEffectProfile(rawLevel: number, passedOut = false): DrunkEffectProfile {
  const level = clampLevel(rawLevel)
  const tier = getDrunkTier(level, passedOut)
  const blurry = level >= 3
  const steps = Math.max(0, level - 3)

  return {
    tier,
    level,
    blurPx: blurry ? round(0.8 + steps * 0.2) : 0,
    ghostPx: blurry ? round(4 + steps * 1.5) : level > 0 ? level : 0,
    swayDeg: blurry ? round(0.35 + steps * 0.25) : 0,
    swayPx: blurry ? round(3 + steps * 1.8) : 0,
    pulseSeconds: level > 0 ? round(Math.max(3.4, 9.5 - level * 0.65)) : 0,
    tint: round(Math.min(1, level / DRUNK_LEVEL_MAX)),
    hallucinationChance: blurry ? round(Math.min(0.8, 0.32 + steps * 0.08)) : 0,
    hiccups: level >= 6,
    wobblyButtons: level >= 6,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

/**
 * Picks a random card that is NOT any of `avoid` (the cards the viewer can
 * already see), so a misread never duplicates a visible card. The result is
 * random, never derived from hidden game state, so it cannot leak anything.
 */
export function pickMisreadCard(avoid: readonly Card[], random: () => number = Math.random): Card {
  const taken = new Set(avoid.map(card => `${card.rank}${card.suit}`))
  const pool: Card[] = []
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      if (!taken.has(`${rank}${suit}`)) {
        pool.push({ rank, suit })
      }
    }
  }

  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index] ?? { rank: '2', suit: 'clubs' }
}
