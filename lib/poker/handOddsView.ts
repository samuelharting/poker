import type { HandOddsMode, TableState } from './types'

export interface SeatOddsView {
  playerId: string
  winPercent: number
  tiePercent: number
  /** Best chance to win right now (shared when several are level). */
  isLeader: boolean
  /** Nothing left can save this hand. */
  isDrawingDead: boolean
  /** Already locked up: no card can change it. */
  isLocked: boolean
}

export interface HandOddsView {
  mode: HandOddsMode
  boardCount: number
  street: 'Preflop' | 'Flop' | 'Turn' | 'River'
  exact: boolean
  /** Live players in seat order. */
  players: SeatOddsView[]
  byPlayer: ReadonlyMap<string, SeatOddsView>
  /** A split is still possible (show tie %). */
  showTies: boolean
}

type OddsState = Pick<TableState, 'phase' | 'handNumber' | 'players' | 'handOdds'>

function streetFor(boardCount: number): HandOddsView['street'] {
  if (boardCount >= 5) return 'River'
  if (boardCount === 4) return 'Turn'
  if (boardCount >= 3) return 'Flop'
  return 'Preflop'
}

/**
 * The broadcast odds the viewer should see right now, or null when there is
 * nothing to show (no odds for this viewer, a stale hand, or one player left).
 */
export function getHandOddsView(state: OddsState): HandOddsView | null {
  const odds = state.handOdds
  if (!odds || state.phase !== 'in_hand' || odds.handNumber !== state.handNumber) {
    return null
  }

  const seatById = new Map(state.players.map(player => [player.id, player]))
  const rows = odds.players
    .filter(row => {
      const seat = seatById.get(row.playerId)
      return seat && (seat.status === 'active' || seat.status === 'all_in')
    })
    .sort((left, right) => (
      (seatById.get(left.playerId)?.seatIndex ?? 0) - (seatById.get(right.playerId)?.seatIndex ?? 0)
    ))
  if (rows.length < 2) {
    return null
  }

  const bestWin = Math.max(...rows.map(row => row.winPercent))
  const bestTie = Math.max(...rows.map(row => row.tiePercent))
  const players = rows.map((row): SeatOddsView => ({
    playerId: row.playerId,
    winPercent: row.winPercent,
    tiePercent: row.tiePercent,
    isLeader: bestWin > 0 ? row.winPercent === bestWin : row.tiePercent === bestTie && bestTie > 0,
    isDrawingDead: row.winPercent === 0 && row.tiePercent === 0,
    isLocked: row.winPercent >= 100,
  }))

  return {
    mode: odds.mode,
    boardCount: odds.boardCount,
    street: streetFor(odds.boardCount),
    exact: odds.exact,
    players,
    byPlayer: new Map(players.map(player => [player.playerId, player])),
    showTies: players.some(player => player.tiePercent >= 0.5),
  }
}

/** "72%", with "<1%" / ">99%" so a live long shot never reads as dead or locked. */
export function formatOddsPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  if (value >= 100) return '100%'
  if (value < 1) return '<1%'
  if (value > 99) return '>99%'
  return `${Math.round(value)}%`
}
