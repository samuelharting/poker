import type { LadyLuckCompanionState } from './types'

/**
 * "Lady Luck" — a cosmetic, server-authoritative companion who attaches herself
 * to whoever is on a winning streak. Pure rules only; the room feeds in hand
 * outcomes and hand starts, and publishes `getVisibleLadyLuck` in the snapshot.
 *
 * Rules ("you have to keep winning for her to stay")
 * - A dealt-in player WINS a hand only when they are its sole winner. A split
 *   pot / chop is not a win for anybody.
 * - Every other dealt-in player breaks their streak: losing at showdown,
 *   folding (even a free fold or folding the blind), or chopping.
 * - Players who were not dealt in (sitting out, spectating, joined mid-hand)
 *   are unaffected either way.
 * - She appears on a player who wins 2 hands in a row.
 * - She leaves (mood `sulk_leave`, removed at the next deal) as soon as her
 *   owner's streak breaks — unless someone else is on a 2+ streak at that
 *   moment, in which case she switches straight to them.
 * - While her owner sits a hand out she stays, unless another player's active
 *   streak becomes strictly longer than her owner's (ties keep the owner).
 */

export const LADY_LUCK_STREAK_TO_APPEAR = 2

export interface LadyLuckTracker {
  /** Consecutive outright wins per player id. */
  streaks: Record<string, number>
  companion: LadyLuckCompanionState | null
  /** Last hand number whose outcome was applied (idempotency guard). */
  lastOutcomeHand: number
  /** Last hand number whose start was applied (idempotency guard). */
  lastStartedHand: number
  /** Monotonic counter used to mint companion ids. */
  sequence: number
}

export interface LadyLuckHandPlayer {
  id: string
  /** Was dealt hole cards this hand. */
  dealtIn: boolean
}

export interface LadyLuckHandOutcome {
  handNumber: number
  now: number
  players: readonly LadyLuckHandPlayer[]
  winners: ReadonlyArray<{ playerId: string; amount: number }>
}

export type LadyLuckHandResult = 'won' | 'broke' | 'not_dealt'

export function createLadyLuckTracker(): LadyLuckTracker {
  return {
    streaks: {},
    companion: null,
    lastOutcomeHand: 0,
    lastStartedHand: 0,
    sequence: 0,
  }
}

/** The single outright winner of a hand, or null for a chop / no winner. */
export function getOutrightWinner(winners: LadyLuckHandOutcome['winners']): string | null {
  const ids = new Set(winners.filter(winner => winner.amount > 0).map(winner => winner.playerId))
  return ids.size === 1 ? [...ids][0]! : null
}

export function classifyLadyLuckResult(player: LadyLuckHandPlayer, outrightWinner: string | null): LadyLuckHandResult {
  if (!player.dealtIn) return 'not_dealt'
  return player.id === outrightWinner ? 'won' : 'broke'
}

function mintCompanion(
  tracker: LadyLuckTracker,
  ownerId: string,
  streak: number,
  handNumber: number,
  now: number
): LadyLuckCompanionState {
  tracker.sequence += 1
  return {
    id: `ll-${handNumber}-${tracker.sequence}`,
    ownerId,
    reason: 'streak',
    streak,
    mood: 'arrive',
    since: now,
    muted: false,
  }
}

/** Player with the longest active streak >= 2 (ties broken by id), or null. */
function hottest(streaks: Record<string, number>, excludeId?: string): { id: string; streak: number } | null {
  let best: { id: string; streak: number } | null = null
  for (const [id, streak] of Object.entries(streaks)) {
    if (id === excludeId || streak < LADY_LUCK_STREAK_TO_APPEAR) continue
    if (!best || streak > best.streak || (streak === best.streak && id < best.id)) {
      best = { id, streak }
    }
  }
  return best
}

/** Applies one finished hand. Returns a new tracker; the input is not mutated. */
export function applyLadyLuckHandOutcome(
  previous: LadyLuckTracker,
  outcome: LadyLuckHandOutcome
): LadyLuckTracker {
  if (outcome.handNumber <= 0 || outcome.handNumber <= previous.lastOutcomeHand || outcome.winners.length === 0) {
    return previous
  }

  const tracker: LadyLuckTracker = {
    ...previous,
    streaks: { ...previous.streaks },
    companion: previous.companion ? { ...previous.companion } : null,
    lastOutcomeHand: outcome.handNumber,
  }

  const outrightWinner = getOutrightWinner(outcome.winners)
  const results = new Map<string, LadyLuckHandResult>()
  for (const player of outcome.players) {
    const result = classifyLadyLuckResult(player, outrightWinner)
    results.set(player.id, result)
    if (result === 'won') tracker.streaks[player.id] = (tracker.streaks[player.id] ?? 0) + 1
    else if (result === 'broke') tracker.streaks[player.id] = 0
  }

  const current = tracker.companion && tracker.companion.mood !== 'sulk_leave' ? tracker.companion : null
  if (!current) {
    const best = hottest(tracker.streaks)
    if (best) tracker.companion = mintCompanion(tracker, best.id, best.streak, outcome.handNumber, outcome.now)
    return tracker
  }

  const ownerResult = results.get(current.ownerId) ?? 'not_dealt'
  const ownerStreak = tracker.streaks[current.ownerId] ?? 0

  if (ownerResult === 'broke') {
    const next = hottest(tracker.streaks, current.ownerId)
    tracker.companion = next
      ? mintCompanion(tracker, next.id, next.streak, outcome.handNumber, outcome.now)
      : { ...current, streak: 0, mood: 'sulk_leave', since: outcome.now }
    return tracker
  }

  if (ownerResult === 'won') {
    tracker.companion = { ...current, streak: ownerStreak, mood: 'cheer', since: outcome.now }
    return tracker
  }

  // Owner sat this one out: only a strictly longer active streak steals her.
  const challenger = hottest(tracker.streaks, current.ownerId)
  if (challenger && challenger.streak > ownerStreak) {
    tracker.companion = mintCompanion(tracker, challenger.id, challenger.streak, outcome.handNumber, outcome.now)
  }
  return tracker
}

/**
 * Called when a new hand is dealt: a sulking companion is gone for good,
 * arrival/cheer settle into flirting, and she drops anyone who left the table.
 */
export function advanceLadyLuckForNewHand(
  previous: LadyLuckTracker,
  handNumber: number,
  seatedPlayerIds: ReadonlySet<string>,
  now: number
): LadyLuckTracker {
  if (handNumber <= previous.lastStartedHand) {
    return previous
  }

  const streaks: Record<string, number> = {}
  for (const [playerId, streak] of Object.entries(previous.streaks)) {
    if (seatedPlayerIds.has(playerId) && streak > 0) {
      streaks[playerId] = streak
    }
  }

  let companion = previous.companion
  if (companion && (companion.mood === 'sulk_leave' || !seatedPlayerIds.has(companion.ownerId))) {
    companion = null
  } else if (companion && companion.mood !== 'flirt') {
    companion = { ...companion, mood: 'flirt', since: now }
  }

  return {
    ...previous,
    streaks,
    companion,
    lastStartedHand: handNumber,
  }
}

/**
 * Her owner told her to shut up. Only the current owner can do it, and only
 * while she is present; it lasts until she leaves (a new appearance resets it).
 * Returns the same tracker when the request is ignored.
 */
export function muteLadyLuck(tracker: LadyLuckTracker, playerId: string): LadyLuckTracker {
  const companion = tracker.companion
  if (!companion || companion.ownerId !== playerId || companion.mood === 'sulk_leave' || companion.muted) {
    return tracker
  }
  return { ...tracker, companion: { ...companion, muted: true } }
}

/** The companion as published to clients (hidden when her owner is gone). */
export function getVisibleLadyLuck(
  tracker: LadyLuckTracker,
  seatedPlayerIds: ReadonlySet<string>
): LadyLuckCompanionState | null {
  const companion = tracker.companion
  if (!companion || !seatedPlayerIds.has(companion.ownerId)) {
    return null
  }
  return { ...companion }
}
