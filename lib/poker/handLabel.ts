import type { Card } from './types'
import { evaluateHand } from './evaluator'

/**
 * The hand-strength label shown under your own cards ("Pair of Aces",
 * "Full House, Jacks full of Fours"). Always computed from the real cards:
 * your two hole cards plus the board that was actually played (never rabbit
 * cards, never the other run of a run-it-twice). Preflop it names the pair
 * or high card; from the flop on it is the evaluator's best five of up to seven.
 *
 * Returns null whenever the input could not be a real holding (wrong card
 * counts, a board of 1-2 or 6+ cards, a card seen twice) rather than ever
 * naming a hand the player does not have.
 */
const RANK_NAMES: Record<Card['rank'], string> = {
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
}

const RANK_ORDER: Record<Card['rank'], number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

function pluralRankName(rank: Card['rank']): string {
  const name = RANK_NAMES[rank]
  return name.endsWith('x') ? `${name}es` : `${name}s`
}

function describePreflopHand(holeCards: readonly Card[]): string {
  const [first, second] = holeCards
  if (first!.rank === second!.rank) {
    return `Pair of ${pluralRankName(first!.rank)}`
  }

  const highCard = [...holeCards].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank])[0]!
  return `${RANK_NAMES[highCard.rank]}-high`
}

export function getVisibleOwnHandDescription(
  holeCards: readonly Card[],
  communityCards: readonly Card[]
): string | null {
  if (holeCards.length !== 2) {
    return null
  }
  const boardLength = communityCards.length
  if (boardLength !== 0 && boardLength !== 3 && boardLength !== 4 && boardLength !== 5) {
    return null
  }
  const visibleCards = [...holeCards, ...communityCards]
  if (new Set(visibleCards.map(card => `${card.rank}${card.suit}`)).size !== visibleCards.length) {
    return null
  }

  if (boardLength === 0) {
    return describePreflopHand(holeCards)
  }

  return evaluateHand(visibleCards).description
}
