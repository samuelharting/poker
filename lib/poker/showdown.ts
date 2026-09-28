import type { BettingRound, GamePhase, ShowCardsMode } from './types'

// Let a final community-card runout finish before the hole-card reveal begins.
export const SHOWDOWN_INTRO_DURATION_MS = 900
export const SHOWDOWN_MAX_CARD_REVEAL_STEP_MS = 160
export const SHOWDOWN_MIN_CARD_REVEAL_STEP_MS = 64
export const SHOWDOWN_MAX_CARD_REVEAL_SPAN_MS = 960
// The winner lights up (and the 3D pot starts shipping) as the last hole
// card finishes flipping, not a long beat later.
export const SHOWDOWN_POST_REVEAL_PAUSE_MS = 200
export const SHOWDOWN_WINNING_HAND_HOLD_MS = 420
export const SHOWDOWN_PAYOUT_TRAVEL_MS = 850
// Hold the result long enough to enjoy it: with the buffer the next deal comes
// at least ~2.5s after the pot starts moving to the winner.
export const SHOWDOWN_RESULT_HOLD_MS = 1_000
export const SHOWDOWN_AUTO_START_BUFFER_MS = 400
// Run it twice: run 1 deals, a beat, then run 2. Both the DOM boards and the
// shared showdown clock read these so the payout never lands mid-runout.
export const RUN_IT_TWICE_SHARED_CARD_STEP_MS = 55
export const RUN_IT_TWICE_FIRST_CARD_MS = 360
export const RUN_IT_TWICE_CARD_STEP_MS = 240
export const RUN_IT_TWICE_SECOND_BOARD_DELAY_MS = 1_500
export const RUN_IT_TWICE_CARD_DEAL_MS = 540
export const RUN_IT_TWICE_RESULT_PAUSE_MS = 300

export type ShowdownStage =
  | 'idle'
  | 'intro'
  | 'reveal'
  | 'highlight'
  | 'payout'
  | 'result'
  | 'complete'

export interface ShowdownStateLike {
  phase: GamePhase
  round: BettingRound | null
  winners?: readonly unknown[]
}

export interface ShowdownRevealOffset {
  playerId: string
  cardIndex: 0 | 1
  order: number
  offsetMs: number
}

export interface ShowdownTiming {
  participantCount: number
  cardCount: number
  revealStartMs: number
  revealStepMs: number
  lastRevealMs: number
  highlightAtMs: number
  payoutAtMs: number
  resultAtMs: number
  completeAtMs: number
  totalDurationMs: number
}

export interface ShowdownPresentationInput extends ShowdownStateLike {
  showdownAt?: number | null
  serverNow?: number | null
  timeSinceSnapshotMs?: number
  participantIds: readonly string[]
  runItTwiceSharedCardCount?: number | null
}

export interface ShowdownPresentation {
  isShowdown: boolean
  stage: ShowdownStage
  elapsedMs: number
  timing: ShowdownTiming
  revealOffsets: ShowdownRevealOffset[]
  revealedCardCounts: Readonly<Record<string, 0 | 1 | 2>>
  winningHandHighlighted: boolean
  payoutStarted: boolean
  resultsVisible: boolean
  complete: boolean
  nextTransitionAtMs: number | null
}

/** Card visibility to use at an existing table seat during the reveal. */
export function getShowdownRevealMode(
  presentation: ShowdownPresentation,
  playerId: string
): ShowCardsMode | null {
  if (!presentation.isShowdown) {
    return null
  }

  const revealedCount = presentation.revealedCardCounts[playerId]
  if (revealedCount === undefined) {
    return null
  }

  if (revealedCount === 0) return 'none'
  if (revealedCount === 1) return 'left'
  return 'both'
}

/**
 * A resolved showdown keeps `round` set to `showdown`. Fold-ended hands clear
 * the round, so this predicate deliberately excludes uncontested wins.
 */
export function isTrueShowdown(state: ShowdownStateLike): boolean {
  return (
    state.phase === 'between_hands' &&
    state.round === 'showdown' &&
    Boolean(state.winners?.length)
  )
}

/**
 * Converts an authoritative snapshot clock into elapsed showdown time. The
 * optional third argument lets a client advance the clock after receiving the
 * snapshot without comparing its wall clock to the server's wall clock.
 */
export function getSynchronizedShowdownElapsedMs(
  showdownAt: number | null | undefined,
  serverNow: number | null | undefined,
  timeSinceSnapshotMs = 0
): number {
  if (!Number.isFinite(showdownAt) || !Number.isFinite(serverNow)) {
    return 0
  }

  const safeTimeSinceSnapshot = Number.isFinite(timeSinceSnapshotMs)
    ? Math.max(0, timeSinceSnapshotMs)
    : 0

  return Math.max(0, (serverNow as number) - (showdownAt as number) + safeTimeSinceSnapshot)
}

/** Deal delay for one card of a run-it-twice board (shared cards land first). */
export function getRunItTwiceCardDelayMs(
  boardIndex: number,
  cardIndex: number,
  sharedCardCount: number
): number {
  if (cardIndex < sharedCardCount) {
    return 80 + cardIndex * RUN_IT_TWICE_SHARED_CARD_STEP_MS
  }

  const newCardIndex = cardIndex - sharedCardCount
  return RUN_IT_TWICE_FIRST_CARD_MS +
    boardIndex * RUN_IT_TWICE_SECOND_BOARD_DELAY_MS +
    newCardIndex * RUN_IT_TWICE_CARD_STEP_MS
}

/** When a run-it-twice board has fully landed and its result can show. */
export function getRunItTwiceBoardResultMs(boardIndex: number, sharedCardCount: number): number {
  const safeShared = Math.max(0, Math.min(5, Math.floor(sharedCardCount)))
  const lastCardDelay = getRunItTwiceCardDelayMs(boardIndex, 4, safeShared)
  return lastCardDelay + RUN_IT_TWICE_CARD_DEAL_MS + RUN_IT_TWICE_RESULT_PAUSE_MS
}

export interface ShowdownTimingOptions {
  /** Set for an accepted run it twice: the payout waits for run 2 to land. */
  runItTwiceSharedCardCount?: number | null
}

export function getShowdownTiming(
  participantCount: number,
  options: ShowdownTimingOptions = {}
): ShowdownTiming {
  const safeParticipantCount = Number.isFinite(participantCount)
    ? Math.max(0, Math.floor(participantCount))
    : 0
  const cardCount = safeParticipantCount * 2
  const intervalCount = Math.max(0, cardCount - 1)
  const revealStepMs = intervalCount === 0
    ? SHOWDOWN_MAX_CARD_REVEAL_STEP_MS
    : Math.max(
      SHOWDOWN_MIN_CARD_REVEAL_STEP_MS,
      Math.min(
        SHOWDOWN_MAX_CARD_REVEAL_STEP_MS,
        Math.floor(SHOWDOWN_MAX_CARD_REVEAL_SPAN_MS / intervalCount)
      )
    )
  const lastRevealMs = cardCount === 0
    ? SHOWDOWN_INTRO_DURATION_MS
    : SHOWDOWN_INTRO_DURATION_MS + intervalCount * revealStepMs
  const runItTwiceShared = options.runItTwiceSharedCardCount
  const runoutDoneMs = typeof runItTwiceShared === 'number' && Number.isFinite(runItTwiceShared)
    ? getRunItTwiceBoardResultMs(1, runItTwiceShared)
    : 0
  const highlightAtMs = Math.max(
    lastRevealMs + SHOWDOWN_POST_REVEAL_PAUSE_MS,
    runoutDoneMs
  )
  const payoutAtMs = highlightAtMs + SHOWDOWN_WINNING_HAND_HOLD_MS
  const resultAtMs = payoutAtMs + SHOWDOWN_PAYOUT_TRAVEL_MS
  const completeAtMs = resultAtMs + SHOWDOWN_RESULT_HOLD_MS

  return {
    participantCount: safeParticipantCount,
    cardCount,
    revealStartMs: SHOWDOWN_INTRO_DURATION_MS,
    revealStepMs,
    lastRevealMs,
    highlightAtMs,
    payoutAtMs,
    resultAtMs,
    completeAtMs,
    totalDurationMs: completeAtMs,
  }
}

/** The minimum between-hands hold PartyKit should use for this showdown. */
export function getShowdownMinimumDurationMs(
  participantCount: number,
  options: ShowdownTimingOptions = {}
): number {
  return getShowdownTiming(participantCount, options).totalDurationMs + SHOWDOWN_AUTO_START_BUFFER_MS
}

export function getShowdownRevealOffsets(
  participantIds: readonly string[]
): ShowdownRevealOffset[] {
  const uniqueParticipantIds = normalizeParticipantIds(participantIds)
  const timing = getShowdownTiming(uniqueParticipantIds.length)
  const offsets: ShowdownRevealOffset[] = []

  for (const playerId of uniqueParticipantIds) {
    for (const cardIndex of [0, 1] as const) {
      const order = offsets.length
      offsets.push({
        playerId,
        cardIndex,
        order,
        offsetMs: timing.revealStartMs + order * timing.revealStepMs,
      })
    }
  }

  return offsets
}

export function getShowdownStage(
  elapsedMs: number,
  timing: ShowdownTiming
): Exclude<ShowdownStage, 'idle'> {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0

  if (safeElapsedMs < timing.revealStartMs) return 'intro'
  if (safeElapsedMs < timing.highlightAtMs) return 'reveal'
  if (safeElapsedMs < timing.payoutAtMs) return 'highlight'
  if (safeElapsedMs < timing.resultAtMs) return 'payout'
  if (safeElapsedMs < timing.completeAtMs) return 'result'
  return 'complete'
}

export function getShowdownPresentation(
  input: ShowdownPresentationInput
): ShowdownPresentation {
  const participantIds = normalizeParticipantIds(input.participantIds)
  const timing = getShowdownTiming(participantIds.length, {
    runItTwiceSharedCardCount: input.runItTwiceSharedCardCount,
  })
  const isShowdown = isTrueShowdown(input)
  const hasSynchronizedAnchor = (
    Number.isFinite(input.showdownAt) &&
    Number.isFinite(input.serverNow)
  )
  const elapsedMs = isShowdown
    ? hasSynchronizedAnchor
      ? getSynchronizedShowdownElapsedMs(
        input.showdownAt,
        input.serverNow,
        input.timeSinceSnapshotMs
      )
      : timing.completeAtMs
    : 0
  const stage = isShowdown ? getShowdownStage(elapsedMs, timing) : 'idle'
  const revealOffsets = isShowdown ? getShowdownRevealOffsets(participantIds) : []
  const revealedCardCounts: Record<string, 0 | 1 | 2> = {}

  for (const playerId of participantIds) {
    revealedCardCounts[playerId] = 0
  }

  for (const reveal of revealOffsets) {
    if (reveal.offsetMs > elapsedMs) break
    revealedCardCounts[reveal.playerId] = (reveal.cardIndex + 1) as 1 | 2
  }

  return {
    isShowdown,
    stage,
    elapsedMs,
    timing,
    revealOffsets,
    revealedCardCounts,
    winningHandHighlighted: isShowdown && elapsedMs >= timing.highlightAtMs,
    payoutStarted: isShowdown && elapsedMs >= timing.payoutAtMs,
    resultsVisible: isShowdown && elapsedMs >= timing.resultAtMs,
    complete: isShowdown && elapsedMs >= timing.completeAtMs,
    nextTransitionAtMs: isShowdown
      ? getNextTransitionAtMs(elapsedMs, revealOffsets, timing)
      : null,
  }
}

function normalizeParticipantIds(participantIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const playerId of participantIds) {
    if (!playerId || !playerId.trim() || seen.has(playerId)) continue
    seen.add(playerId)
    normalized.push(playerId)
  }

  return normalized
}

function getNextTransitionAtMs(
  elapsedMs: number,
  revealOffsets: readonly ShowdownRevealOffset[],
  timing: ShowdownTiming
): number | null {
  const transitions = [
    ...revealOffsets.map(reveal => reveal.offsetMs),
    timing.highlightAtMs,
    timing.payoutAtMs,
    timing.resultAtMs,
    timing.completeAtMs,
  ]

  return transitions.find(transition => transition > elapsedMs) ?? null
}
