import type { InternalPlayer, Pot } from './types'

type PotParticipant = Pick<InternalPlayer, 'id' | 'status' | 'totalInPot'>

/**
 * Calculate the minimum raise amount.
 * The minimum raise is at least the size of the last raise, or the big blind.
 * Returns the total amount the raiser must put in (not just the extra amount).
 */
export function calculateMinRaise(
  currentBet: number,
  lastRaiseSize: number,
  bigBlind: number
): number {
  const raiseSize = Math.max(lastRaiseSize, bigBlind)
  return currentBet + raiseSize
}

/**
 * Build side pots from the current players' commitments.
 * Handles scenarios where players are all-in for different amounts.
 *
 * Algorithm:
 * 1. Sort all-in players by total committed (ascending)
 * 2. For each all-in threshold, create a pot up to that level
 * 3. Remaining goes to main pot for non-all-in players
 */
export function buildSidePots(players: PotParticipant[]): Pot[] {
  // Only consider players who have committed chips this hand
  const activePlayers = players.filter(p => p.totalInPot > 0 || p.status !== 'waiting')

  if (activePlayers.length === 0) return []

  // Get all unique contribution levels from all-in players
  const allInLevels = activePlayers
    .filter(p => p.status === 'all_in')
    .map(p => p.totalInPot)
    .sort((a, b) => a - b)

  // Remove duplicates
  const uniqueLevels = Array.from(new Set(allInLevels))

  const pots: Pot[] = []
  let previousLevel = 0

  for (const level of uniqueLevels) {
    const potAmount = activePlayers.reduce((sum, p) => {
      const contribution = Math.min(p.totalInPot, level) - Math.min(p.totalInPot, previousLevel)
      return sum + Math.max(0, contribution)
    }, 0)

    if (potAmount > 0) {
      const eligible = activePlayers
        .filter(p => p.totalInPot >= level && p.status !== 'folded')
        .map(p => p.id)

      pots.push({ amount: potAmount, eligiblePlayerIds: eligible })
    }

    previousLevel = level
  }

  // Main pot: remaining chips beyond the highest all-in level
  const remainingAmount = activePlayers.reduce((sum, p) => {
    return sum + Math.max(0, p.totalInPot - previousLevel)
  }, 0)

  if (remainingAmount > 0) {
    const eligible = activePlayers
      .filter(p => p.status !== 'folded' && p.status !== 'all_in')
      .map(p => p.id)

    // If all remaining eligible are all-in too, include them
    if (eligible.length === 0) {
      const allEligible = activePlayers
        .filter(p => p.status !== 'folded' && p.totalInPot > previousLevel)
        .map(p => p.id)
      if (allEligible.length > 0) {
        pots.push({ amount: remainingAmount, eligiblePlayerIds: allEligible })
      }
    } else {
      pots.push({ amount: remainingAmount, eligiblePlayerIds: eligible })
    }
  }

  // If no side pots were created, build a single main pot
  if (pots.length === 0) {
    const total = activePlayers.reduce((sum, p) => sum + p.totalInPot, 0)
    const eligible = activePlayers.filter(p => p.status !== 'folded').map(p => p.id)
    if (total > 0) {
      pots.push({ amount: total, eligiblePlayerIds: eligible })
    }
  }

  return pots
}

/**
 * Check if the current betting round is complete.
 * The round is complete when:
 * - All active (non-folded, non-all-in) players have acted
 * - All active players have matched the current bet
 */
export function isRoundComplete(players: InternalPlayer[], currentBet: number): boolean {
  const activePlayers = players.filter(
    p => p.status === 'active' && p.stack > 0
  )

  if (activePlayers.length === 0) return true

  // Check if everyone who can act has acted and matched the bet
  for (const player of activePlayers) {
    if (!player.hasActedThisRound) return false
    if (player.bet < currentBet) return false
  }

  return true
}

/**
 * Get the next player who needs to act.
 * Returns null if the round is complete.
 */
export function getNextActingPlayer(
  players: InternalPlayer[],
  currentActorIndex: number
): InternalPlayer | null {
  const n = players.length
  for (let i = 1; i <= n; i++) {
    const idx = (currentActorIndex + i) % n
    const player = players[idx]!
    if (player.status === 'active' && player.stack > 0) {
      return player
    }
  }
  return null
}

/**
 * Find the index of a player by ID.
 */
export function findPlayerIndex(players: InternalPlayer[], playerId: string): number {
  return players.findIndex(p => p.id === playerId)
}

/**
 * Count players who are still in the hand (not folded, not sitting out).
 */
export function countPlayersInHand(players: InternalPlayer[]): number {
  return players.filter(p =>
    p.status === 'active' || p.status === 'all_in'
  ).length
}

/**
 * Count players who can still act (active + have chips).
 */
export function countActionablePlayers(players: InternalPlayer[]): number {
  return players.filter(p => p.status === 'active' && p.stack > 0).length
}
