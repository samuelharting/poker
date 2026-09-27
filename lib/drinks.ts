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
 * - Shots: another seated player can buy you a shot: +SHOT_LEVEL_BOOST (3)
 *   levels at once. Anti-cheat rules, so a shot can never be used to knock
 *   someone out of a pot:
 *   - only for a player who is NOT live in the current hand (folded, sitting
 *     out, or the table is between hands), never someone still holding cards
 *     (all-in included);
 *   - a shot is capped at SHOT_LEVEL_CAP (9): shots can never pass anyone out,
 *     only a player's own beers can. (Safer than timing the pass-out around the
 *     next deal: there is no window where a shot lands and a hand starts.)
 *   - each buyer may buy one shot every SHOT_COOLDOWN_HANDS (5) hands;
 *   - each target may receive one shot every SHOT_RECEIVE_COOLDOWN_HANDS (3)
 *     hands, so a table can't gang up on one player.
 * - Chaser: a water ordered within CHASER_WINDOW_MS (20s) of receiving a shot
 *   takes CHASER_LEVELS (2) of the shot's levels back off when it kicks in,
 *   instead of the usual 1.
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
/** Shots never take anyone past this level: they can't cause a pass-out. */
export const SHOT_LEVEL_CAP = PASS_OUT_LEVEL - 1
/** After a shot, a water within this window is a chaser. */
export const CHASER_WINDOW_MS = 20_000
/** Levels a chaser water takes off (never more than the shot added). */
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
  }
}

// ---------------------------------------------------------------------------
// Server ledger
// ---------------------------------------------------------------------------

export interface PendingWater {
  id: string
  dueAt: number
  /** Chaser water: levels it takes off when it kicks in (default 1). */
  levels?: number
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
  /** Open chaser window after a shot (server ms), and how many levels it can take back. */
  chaserUntil: number | null
  chaserLevels: number
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
    chaserLevels: 0,
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
    const water: PendingWater = { id: context.drinkId, dueAt: context.now + WATER_KICK_IN_MS }
    const chaser = entry.chaserUntil !== null && context.now <= entry.chaserUntil
    if (chaser) {
      water.levels = Math.max(1, entry.chaserLevels)
    }
    // One chaser per shot; the window closes once any water is ordered.
    entry.chaserUntil = null
    entry.chaserLevels = 0
    entry.pendingWaters.push(water)
    return { ok: true, passedOut: false, water, ...(chaser ? { chaser: true } : {}) }
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

export const SHOT_LIVE_TARGET_REASON = "You can only buy shots for players who've folded"

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

export interface ShotContext {
  handNumber: number
  /** The target is still live in the current hand (see isLiveInHand). */
  targetIsLive: boolean
  /** Server time, for the chaser window (defaults to Date.now()). */
  now?: number
}

export type ShotResult =
  | { ok: true; levelAdded: number }
  | { ok: false; reason: string }

/**
 * Why `buyer` can't buy `target` a shot right now, or null when they can.
 * Seat, self-targeting and fun-mode checks belong to the caller.
 */
export function getShotBlockReason(
  buyer: DrinkLedgerEntry | undefined,
  target: DrinkLedgerEntry | undefined,
  context: ShotContext,
  targetName = 'They'
): string | null {
  if (context.targetIsLive) {
    return SHOT_LIVE_TARGET_REASON
  }
  const remaining = getShotHandsRemaining(buyer, context.handNumber)
  if (remaining > 0) {
    return `${formatShotCooldown(remaining)}.`
  }
  if (target?.passedOut) {
    return `${targetName} already passed out. Let them sleep.`
  }
  const receiving = getShotReceiveHandsRemaining(target, context.handNumber)
  if (receiving > 0) {
    return `${targetName} just had a shot. Try again in ${receiving} hand${receiving === 1 ? '' : 's'}.`
  }
  if ((target?.level ?? 0) >= SHOT_LEVEL_CAP) {
    return `${targetName} is wrecked enough. Shots can't knock anyone out.`
  }
  return null
}

/**
 * `buyer` buys `target` a shot. Mutates both entries when accepted. The shot
 * adds up to SHOT_LEVEL_BOOST levels but never past SHOT_LEVEL_CAP, so it can
 * never pass anyone out.
 */
export function buyShot(
  buyer: DrinkLedgerEntry,
  target: DrinkLedgerEntry,
  context: ShotContext,
  targetName?: string
): ShotResult {
  const blocked = getShotBlockReason(buyer, target, context, targetName)
  if (blocked) {
    return { ok: false, reason: blocked }
  }

  const before = target.level
  buyer.lastShotBoughtHand = context.handNumber
  target.lastShotReceivedHand = context.handNumber
  target.shots += 1
  target.level = Math.min(SHOT_LEVEL_CAP, clampLevel(target.level + SHOT_LEVEL_BOOST))
  const levelAdded = target.level - before
  target.chaserUntil = (context.now ?? Date.now()) + CHASER_WINDOW_MS
  target.chaserLevels = Math.min(CHASER_LEVELS, Math.max(1, levelAdded))
  return { ok: true, levelAdded }
}

/**
 * Client-side mirror of getShotBlockReason from the public state, so the
 * button can say why it is disabled. The server stays authoritative.
 */
export function getShotBlockReasonFromState(
  buyer: Pick<PlayerDrinkState, 'shotReadyAtHand'> | undefined,
  target: Pick<PlayerDrinkState, 'shotReceivableAtHand' | 'passedOut' | 'level'> | undefined,
  context: ShotContext,
  targetName = 'They'
): string | null {
  // A "ready at hand N" of 0 means no cooldown; otherwise N = last + window.
  const lastHand = (readyAt: number | undefined, window: number) => (readyAt ? readyAt - window : null)
  return getShotBlockReason(
    {
      ...createDrinkLedgerEntry(),
      lastShotBoughtHand: lastHand(buyer?.shotReadyAtHand, SHOT_COOLDOWN_HANDS),
    },
    {
      ...createDrinkLedgerEntry(),
      level: target?.level ?? 0,
      passedOut: target?.passedOut ?? false,
      lastShotReceivedHand: lastHand(target?.shotReceivableAtHand, SHOT_RECEIVE_COOLDOWN_HANDS),
    },
    context,
    targetName
  )
}

/** Applies a pending water. Returns true when it existed (and was consumed). */
export function applyWaterKickIn(entry: DrinkLedgerEntry, waterId: string): boolean {
  const index = entry.pendingWaters.findIndex(water => water.id === waterId)
  if (index < 0) {
    return false
  }

  const [water] = entry.pendingWaters.splice(index, 1)
  if (!entry.passedOut) {
    entry.level = clampLevel(entry.level - (water?.levels ?? 1))
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

export type DrinkEventKind = 'beer' | 'water' | 'water_kicked_in' | 'passed_out' | 'woke_up' | 'chaser'

export const DRINK_EVENT_KINDS: readonly DrinkEventKind[] = [
  'beer',
  'water',
  'water_kicked_in',
  'passed_out',
  'woke_up',
  'chaser',
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
