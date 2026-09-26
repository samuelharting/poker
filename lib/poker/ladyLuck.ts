import type { LadyLuckCompanionState, LadyLuckReason } from './types'

/**
 * "Lady Luck" — a cosmetic, server-authoritative companion who attaches herself
 * to whoever is running hot. Pure rules only; the room feeds in hand outcomes
 * and hand starts, and publishes `getVisibleLadyLuck` in the table snapshot.
 *
 * Rules
 * - A dealt-in player WINS a hand when they collect any chips from it.
 * - They LOSE a hand when they collect nothing but reached showdown (did not
 *   fold) or put chips in beyond their forced blind.
 * - Anything else (a free fold, a fold after only posting a blind) is NEUTRAL:
 *   the streak is kept but not extended.
 * - A winner qualifies for her when the pot they took is >= 20 big blinds, or
 *   they won a contested all-in, or their win streak reaches 2.
 * - She appears on the hottest qualifier ("heat" = streak + 2 for a big win).
 * - She leaves (mood `sulk_leave`, removed at the next deal) as soon as her
 *   owner loses a hand, or switches straight to a new qualifier with more heat
 *   than her owner. If her owner loses and someone else qualifies on the same
 *   hand she switches to them immediately.
 */

export const LADY_LUCK_BIG_WIN_BIG_BLINDS = 20
export const LADY_LUCK_STREAK_TO_APPEAR = 2
const BIG_WIN_HEAT_BONUS = 2

export interface LadyLuckTracker {
  /** Consecutive wins per player id (neutral hands keep the streak). */
  streaks: Record<string, number>
  companion: LadyLuckCompanionState | null
  /** Heat she currently attributes to her owner; a challenger must beat it. */
  ownerHeat: number
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
  folded: boolean
  allIn: boolean
  totalInPot: number
  /** Blind posted this hand (0 when none). */
  forcedBlind: number
}

export interface LadyLuckHandOutcome {
  handNumber: number
  bigBlind: number
  now: number
  players: readonly LadyLuckHandPlayer[]
  winners: ReadonlyArray<{ playerId: string; amount: number }>
}

export type LadyLuckHandResult = 'won' | 'lost' | 'neutral'

export function createLadyLuckTracker(): LadyLuckTracker {
  return {
    streaks: {},
    companion: null,
    ownerHeat: 0,
    lastOutcomeHand: 0,
    lastStartedHand: 0,
    sequence: 0,
  }
}

export function classifyLadyLuckResult(player: LadyLuckHandPlayer, wonAmount: number): LadyLuckHandResult {
  if (!player.dealtIn) return 'neutral'
  if (wonAmount > 0) return 'won'
  const voluntary = player.totalInPot - Math.max(0, player.forcedBlind)
  if (!player.folded || voluntary > 0) return 'lost'
  return 'neutral'
}

export function isLadyLuckBigWin(
  player: LadyLuckHandPlayer,
  wonAmount: number,
  outcome: Pick<LadyLuckHandOutcome, 'bigBlind' | 'players'>
): boolean {
  if (wonAmount <= 0) return false
  if (outcome.bigBlind > 0 && wonAmount >= outcome.bigBlind * LADY_LUCK_BIG_WIN_BIG_BLINDS) return true
  const contenders = outcome.players.filter(entry => entry.dealtIn && !entry.folded)
  const contested = contenders.length >= 2
  return contested && contenders.some(entry => entry.allIn) && contenders.some(entry => entry.id === player.id)
}

interface Candidate {
  id: string
  heat: number
  amount: number
  streak: number
  reason: LadyLuckReason
}

function compareCandidates(a: Candidate, b: Candidate) {
  if (b.heat !== a.heat) return b.heat - a.heat
  if (b.amount !== a.amount) return b.amount - a.amount
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function mintCompanion(
  tracker: LadyLuckTracker,
  candidate: Candidate,
  handNumber: number,
  now: number
): LadyLuckCompanionState {
  tracker.sequence += 1
  return {
    id: `ll-${handNumber}-${tracker.sequence}`,
    ownerId: candidate.id,
    reason: candidate.reason,
    streak: candidate.streak,
    mood: 'arrive',
    since: now,
  }
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

  const wonByPlayer = new Map<string, number>()
  for (const winner of outcome.winners) {
    wonByPlayer.set(winner.playerId, (wonByPlayer.get(winner.playerId) ?? 0) + Math.max(0, winner.amount))
  }

  const results = new Map<string, LadyLuckHandResult>()
  const candidates: Candidate[] = []
  const heatById = new Map<string, number>()
  const bigWinById = new Map<string, boolean>()

  for (const player of outcome.players) {
    const wonAmount = wonByPlayer.get(player.id) ?? 0
    const result = classifyLadyLuckResult(player, wonAmount)
    results.set(player.id, result)
    if (result === 'lost') {
      tracker.streaks[player.id] = 0
      continue
    }
    if (result !== 'won') continue

    const streak = (tracker.streaks[player.id] ?? 0) + 1
    tracker.streaks[player.id] = streak
    const bigWin = isLadyLuckBigWin(player, wonAmount, outcome)
    const heat = streak + (bigWin ? BIG_WIN_HEAT_BONUS : 0)
    heatById.set(player.id, heat)
    bigWinById.set(player.id, bigWin)
    if (bigWin || streak >= LADY_LUCK_STREAK_TO_APPEAR) {
      candidates.push({
        id: player.id,
        heat,
        amount: wonAmount,
        streak,
        reason: bigWin ? 'big_win' : 'streak',
      })
    }
  }
  candidates.sort(compareCandidates)

  const current = tracker.companion && tracker.companion.mood !== 'sulk_leave' ? tracker.companion : null
  const best = candidates[0] ?? null

  if (!current) {
    if (best) {
      tracker.companion = mintCompanion(tracker, best, outcome.handNumber, outcome.now)
      tracker.ownerHeat = best.heat
    }
    return tracker
  }

  const ownerResult = results.get(current.ownerId) ?? 'neutral'
  const challenger = candidates.find(candidate => candidate.id !== current.ownerId) ?? null

  if (ownerResult === 'lost') {
    if (challenger) {
      tracker.companion = mintCompanion(tracker, challenger, outcome.handNumber, outcome.now)
      tracker.ownerHeat = challenger.heat
    } else {
      tracker.companion = {
        ...current,
        streak: 0,
        mood: 'sulk_leave',
        since: outcome.now,
      }
      tracker.ownerHeat = 0
    }
    return tracker
  }

  if (ownerResult === 'won') {
    const ownerHeat = Math.max(tracker.ownerHeat, heatById.get(current.ownerId) ?? 0)
    if (challenger && challenger.heat > ownerHeat) {
      tracker.companion = mintCompanion(tracker, challenger, outcome.handNumber, outcome.now)
      tracker.ownerHeat = challenger.heat
      return tracker
    }
    tracker.ownerHeat = ownerHeat
    tracker.companion = {
      ...current,
      reason: bigWinById.get(current.ownerId) ? 'big_win' : current.reason,
      streak: tracker.streaks[current.ownerId] ?? current.streak,
      mood: 'cheer',
      since: outcome.now,
    }
    return tracker
  }

  // Owner sat this one out (free fold): a hotter player can steal her.
  if (challenger && challenger.heat > tracker.ownerHeat) {
    tracker.companion = mintCompanion(tracker, challenger, outcome.handNumber, outcome.now)
    tracker.ownerHeat = challenger.heat
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
  let ownerHeat = previous.ownerHeat
  if (companion && (companion.mood === 'sulk_leave' || !seatedPlayerIds.has(companion.ownerId))) {
    companion = null
    ownerHeat = 0
  } else if (companion && companion.mood !== 'flirt') {
    companion = { ...companion, mood: 'flirt', since: now }
  }

  return {
    ...previous,
    streaks,
    companion,
    ownerHeat,
    lastStartedHand: handNumber,
  }
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
