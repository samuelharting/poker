import type { HandHistoryEntry, TableState } from './types'
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

/**
 * Summarises a completed hand from the public (viewer-less) table state:
 * winners, the board that was actually played, and any hands shown to the
 * table. Never includes cards the table could not see.
 */
export function buildHandHistoryEntry(state: TableState, endedAt: number): HandHistoryEntry | null {
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
