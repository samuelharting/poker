/**
 * Table drinks: beers make you drunk, water sobers you up, ten beers and you
 * pass out. Everything in this module is pure so the PartyKit room, the
 * client hooks and the tests all share one source of truth.
 *
 * Timing rules (server authoritative):
 * - Beer: +1 drunk level immediately.
 * - Water: -1 drunk level WATER_KICK_IN_MS (30s) after ordering ("after a while").
 * - Wear-off: every WEAR_OFF_EVERY_HANDS (3) completed hands, -1 level on its own.
 * - Pass-out: reaching PASS_OUT_LEVEL (10). The player's hand is folded through
 *   the normal fold path when action reaches them; they wake up at the start of
 *   the next hand they did not pass out in, at WAKE_UP_LEVEL (6).
 * - Rate limit: one drink per DRINK_COOLDOWN_MS (3s) per player.
 */
import type { Card, Rank, Suit } from './poker/types'

export type DrinkKind = 'beer' | 'water'

export const DRUNK_LEVEL_MAX = 10
export const PASS_OUT_LEVEL = 10
export const WAKE_UP_LEVEL = 6
export const DRINK_COOLDOWN_MS = 3_000
export const WATER_KICK_IN_MS = 30_000
export const WEAR_OFF_EVERY_HANDS = 3
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
}

export const EMPTY_DRINK_STATE: Readonly<PlayerDrinkState> = Object.freeze({
  level: 0,
  beers: 0,
  waters: 0,
  lastDrink: null,
  passedOut: false,
  sobering: 0,
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
  | { ok: true; passedOut: boolean; water?: PendingWater }
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
    const water = { id: context.drinkId, dueAt: context.now + WATER_KICK_IN_MS }
    entry.pendingWaters.push(water)
    return { ok: true, passedOut: false, water }
  }

  entry.beers += 1
  entry.level = clampLevel(entry.level + 1)
  if (entry.level >= PASS_OUT_LEVEL) {
    entry.passedOut = true
    entry.passedOutThroughHand = context.isDealtIntoLiveHand
      ? context.handNumber
      : context.handNumber + 1
    entry.pendingWaters = []
    entry.handsTowardSober = 0
    return { ok: true, passedOut: true }
  }

  return { ok: true, passedOut: false }
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

export type DrinkEventKind = 'beer' | 'water' | 'water_kicked_in' | 'passed_out' | 'woke_up'

export const DRINK_EVENT_KINDS: readonly DrinkEventKind[] = [
  'beer',
  'water',
  'water_kicked_in',
  'passed_out',
  'woke_up',
]

export interface DrinkEvent {
  id: string
  kind: DrinkEventKind
  playerId: string
  nickname: string
  level: number
  beers: number
  at: number
}

export function describeDrinkEvent(event: Pick<DrinkEvent, 'kind' | 'nickname' | 'beers' | 'level'>, isSelf = false): {
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
