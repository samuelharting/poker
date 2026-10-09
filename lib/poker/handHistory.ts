import type { BettingRound, HandExitReason, HandHistoryEntry, HandOutcome, TableState } from './types'
import { evaluateHand } from './evaluator'
import { isTrueShowdown } from './showdown'

/** Completed hands kept for the "Last hands" view. */
export const HAND_HISTORY_LIMIT = 10

const RABBIT_HUNT_PREFIX = 'Rabbit hunt:'

/**
 * Number of board cards a rabbit hunt added after a fold-ended hand, read from
 * the latest action line (e.g. "Rabbit hunt: turn Jc | river 10s" -> 2).
 * Those cards were never played.
 */
export function getRabbitHuntCardCount(recentActions: readonly string[]): number {
  const latest = recentActions[0]
  if (!latest?.startsWith(RABBIT_HUNT_PREFIX)) {
    return 0
  }

  return latest
    .slice(RABBIT_HUNT_PREFIX.length)
    .split('|')
    .reduce((count, street) => {
      const name = street.trim().toLowerCase()
      if (name.startsWith('flop')) return count + 3
      if (name.startsWith('turn') || name.startsWith('river')) return count + 1
      return count
    }, 0)
}

/** What the room knows about how each player's hand ended (see HandOutcome). */
export interface HandForensics {
  exits?: Readonly<Record<string, { reason: HandExitReason; street?: BettingRound | null; disconnected?: boolean; away?: boolean }>>
  timedOutChecks?: Readonly<Record<string, number>>
}

/**
 * One line per dealt-in player: won / lost at showdown / folded (by choice,
 * timed out, left, kicked, moved to the rail) and on which street. Built
 * from the public state, so it only names hands the table saw.
 */
export function buildHandOutcomes(state: TableState, forensics: HandForensics = {}): HandOutcome[] {
  const showdown = isTrueShowdown(state)
  const ranTwice = state.runItTwice?.status === 'accepted'
  const won = new Map<string, number>()
  for (const winner of state.winners ?? []) won.set(winner.playerId, (won.get(winner.playerId) ?? 0) + winner.amount)

  return state.players
    .filter(player => player.hasCards)
    .map((player): HandOutcome => {
      const exit = forensics.exits?.[player.id]
      const timedOutChecks = forensics.timedOutChecks?.[player.id] ?? 0
      const base: HandOutcome = {
        playerId: player.id,
        nickname: player.nickname,
        result: 'lost',
        stake: player.totalInPot,
        ...(timedOutChecks > 0 ? { timedOutChecks } : {}),
      }
      if (player.status === 'folded') {
        return {
          ...base,
          result: 'folded',
          reason: exit?.reason ?? 'fold',
          ...(exit?.street ? { street: exit.street } : {}),
          ...(exit?.disconnected ? { disconnected: true } : {}),
          ...(exit?.away ? { away: true } : {}),
        }
      }
      const amount = won.get(player.id) ?? 0
      const shownHand = !ranTwice && showdown && player.holeCards?.length === 2 && state.communityCards.length >= 3
        ? evaluateHand([...player.holeCards, ...state.communityCards]).description
        : undefined
      return {
        ...base,
        result: amount > 0 ? 'won' : 'lost',
        via: showdown || ranTwice ? 'showdown' : 'uncontested',
        ...(amount > 0 ? { amount } : {}),
        ...(shownHand ? { handDescription: shownHand } : {}),
        ...(!player.isConnected ? { disconnected: true } : {}),
      }
    })
}

const STREET_LABEL: Record<BettingRound, string> = {
  preflop: 'preflop',
  flop: 'on the flop',
  turn: 'on the turn',
  river: 'on the river',
  showdown: 'at showdown',
}

/** Short plain-English line for the hand history, e.g. "timed out on the turn (disconnected)". */
export function describeHandOutcome(outcome: HandOutcome): string {
  const street = outcome.street ? ` ${STREET_LABEL[outcome.street]}` : ''
  const notes = [
    outcome.disconnected ? 'disconnected' : null,
    outcome.away ? 'sitting out' : null,
    outcome.timedOutChecks ? `clock ran out ${outcome.timedOutChecks}x, checked` : null,
  ].filter(Boolean)
  const suffix = notes.length ? ` (${notes.join(', ')})` : ''
  if (outcome.result === 'folded') {
    const verb = {
      fold: 'folded',
      timeout: 'timed out',
      left: 'left the table',
      kicked: 'was kicked',
      moved_to_rail: 'moved to the rail',
    }[outcome.reason ?? 'fold']
    return `${verb}${street}${suffix}`
  }
  const hand = outcome.handDescription ? ` with ${outcome.handDescription}` : ''
  if (outcome.result === 'won') {
    return `${outcome.via === 'uncontested' ? 'won uncontested' : 'won at showdown'}${hand}${suffix}`
  }
  return `lost at showdown${hand}${suffix}`
}

/**
 * Summarises a completed hand from the public (viewer-less) table state:
 * winners, the board that was actually played, and any hands shown to the
 * table. Never includes cards the table could not see.
 */
export function buildHandHistoryEntry(state: TableState, endedAt: number, forensics?: HandForensics): HandHistoryEntry | null {
  const winners = state.winners ?? []
  if (state.handNumber <= 0 || winners.length === 0) {
    return null
  }

  const nicknameOf = (playerId: string) => (
    state.players.find(player => player.id === playerId)?.nickname
      ?? state.lobbyPlayers?.find(player => player.id === playerId)?.nickname
      ?? 'Player'
  )
  // Rabbit-hunt cards now arrive separately (state.rabbitCards) and are never
  // part of communityCards; the action-log count only covers older snapshots.
  const playedBoardLength = state.rabbitCards?.length
    ? state.communityCards.length
    : Math.max(0, state.communityCards.length - getRabbitHuntCardCount(state.recentActions))
  const runItTwiceBoards = state.runItTwice?.status === 'accepted' && state.runItTwice.boards?.length === 2
    ? state.runItTwice.boards.map(board => board.cards.slice(0, 5))
    : undefined

  const winnerTotals = new Map<string, { amount: number; handDescription?: string }>()
  for (const winner of winners) {
    const current = winnerTotals.get(winner.playerId)
    winnerTotals.set(winner.playerId, {
      amount: (current?.amount ?? 0) + winner.amount,
      handDescription: current?.handDescription ?? winner.handDescription,
    })
  }

  return {
    handNumber: state.handNumber,
    endedAt,
    endedBy: isTrueShowdown(state) || runItTwiceBoards ? 'showdown' : 'fold',
    pot: [...winnerTotals.values()].reduce((sum, winner) => sum + winner.amount, 0),
    board: state.communityCards.slice(0, playedBoardLength),
    ...(runItTwiceBoards ? { boards: runItTwiceBoards } : {}),
    winners: [...winnerTotals.entries()].map(([playerId, winner]) => ({
      playerId,
      nickname: nicknameOf(playerId),
      amount: winner.amount,
      ...(winner.handDescription ? { handDescription: winner.handDescription } : {}),
    })),
    shown: state.players
      .filter(player => (player.holeCards?.length ?? 0) > 0)
      .map(player => ({
        playerId: player.id,
        nickname: player.nickname,
        cards: player.holeCards ?? [],
      })),
    outcomes: buildHandOutcomes(state, forensics),
  }
}

/** Newest first, one entry per hand, capped at HAND_HISTORY_LIMIT. */
export function upsertHandHistory(
  history: readonly HandHistoryEntry[],
  entry: HandHistoryEntry,
  limit = HAND_HISTORY_LIMIT
): HandHistoryEntry[] {
  return [entry, ...history.filter(item => item.handNumber !== entry.handNumber)]
    .sort((left, right) => right.handNumber - left.handNumber)
    .slice(0, limit)
}
