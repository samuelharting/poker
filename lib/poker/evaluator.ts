import type { Card, HandRank, HandResult, Rank, Suit } from './types'
import { rankValue } from './deck'

const HAND_RANK_INDEX: Record<HandRank, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
}

function sortByRankDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))
}

function groupByRank(cards: Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>()
  for (const card of cards) {
    const existing = groups.get(card.rank) ?? []
    existing.push(card)
    groups.set(card.rank, existing)
  }
  return groups
}

function groupBySuit(cards: Card[]): Map<Suit, Card[]> {
  const groups = new Map<Suit, Card[]>()
  for (const card of cards) {
    const existing = groups.get(card.suit) ?? []
    existing.push(card)
    groups.set(card.suit, existing)
  }
  return groups
}

/** Check for a straight in the given sorted (desc) cards. Returns best 5 or null. */
function findStraight(cards: Card[]): Card[] | null {
  // Deduplicate by rank value
  const seen = new Set<number>()
  const unique: Card[] = []
  for (const card of cards) {
    const v = rankValue(card.rank)
    if (!seen.has(v)) {
      seen.add(v)
      unique.push(card)
    }
  }

  // Try ace-low: treat ace as 1
  // Build a list of rank values, possibly with ace = 1
  const values = unique.map(c => rankValue(c.rank))
  const hasAce = values.includes(14)

  // Augment with ace-as-1 if needed
  // Collect all distinct rank values with representative cards
  const byValue = new Map<number, Card>()
  for (const card of unique) {
    byValue.set(rankValue(card.rank), card)
  }
  if (hasAce) {
    byValue.set(1, unique.find(c => c.rank === 'A')!)
  }

  const sortedValues = Array.from(byValue.keys()).sort((a, b) => b - a)

  for (let i = 0; i <= sortedValues.length - 5; i++) {
    const top = sortedValues[i]!
    const run: number[] = [top]
    for (let j = i + 1; j < sortedValues.length && run.length < 5; j++) {
      if (sortedValues[j] === run[run.length - 1]! - 1) {
        run.push(sortedValues[j]!)
      }
    }
    if (run.length === 5) {
      return run.map(v => byValue.get(v)!)
    }
  }
  return null
}

/** Find a flush (5+ same suit). Returns best 5 cards of that suit or null. */
function findFlush(cards: Card[]): Card[] | null {
  const bySuit = groupBySuit(cards)
  for (const [, suitCards] of Array.from(bySuit.entries())) {
    if (suitCards.length >= 5) {
      const sorted = sortByRankDesc(suitCards)
      return sorted.slice(0, 5)
    }
  }
  return null
}

/** Find a straight flush (straight within a flush suit). */
function findStraightFlush(cards: Card[]): Card[] | null {
  const bySuit = groupBySuit(cards)
  for (const [, suitCards] of Array.from(bySuit.entries())) {
    if (suitCards.length >= 5) {
      const sorted = sortByRankDesc(suitCards)
      const sf = findStraight(sorted)
      if (sf) return sf
    }
  }
  return null
}

function describeHand(rank: HandRank, best5: Card[]): string {
  const sorted = sortByRankDesc(best5)
  const rankName = (r: Rank): string => {
    const map: Record<Rank, string> = {
      '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
      '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
      'T': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace',
    }
    return map[r]
  }

  switch (rank) {
    case 'royal_flush': return 'Royal Flush'
    case 'straight_flush': return `Straight Flush, ${rankName(sorted[0]!.rank)}-high`
    case 'four_of_a_kind': {
      const groups = groupByRank(best5)
      const quad = Array.from(groups.entries()).find(([, cards]) => cards.length === 4)!
      return `Four of a Kind, ${rankName(quad[0])}s`
    }
    case 'full_house': {
      const groups = groupByRank(best5)
      const trip = Array.from(groups.entries()).find(([, cards]) => cards.length === 3)!
      const pair = Array.from(groups.entries()).find(([, cards]) => cards.length === 2)!
      return `Full House, ${rankName(trip[0])}s full of ${rankName(pair[0])}s`
    }
    case 'flush': return `Flush, ${rankName(sorted[0]!.rank)}-high`
    case 'straight': return `Straight, ${rankName(sorted[0]!.rank)}-high`
    case 'three_of_a_kind': {
      const groups = groupByRank(best5)
      const trip = Array.from(groups.entries()).find(([, cards]) => cards.length === 3)!
      return `Three of a Kind, ${rankName(trip[0])}s`
    }
    case 'two_pair': {
      const groups = groupByRank(best5)
      const pairs = Array.from(groups.entries())
        .filter(([, cards]) => cards.length === 2)
        .sort((a, b) => rankValue(b[0]) - rankValue(a[0]))
      return `Two Pair, ${rankName(pairs[0]![0])}s and ${rankName(pairs[1]![0])}s`
    }
    case 'pair': {
      const groups = groupByRank(best5)
      const pair = Array.from(groups.entries()).find(([, cards]) => cards.length === 2)!
      return `Pair of ${rankName(pair[0])}s`
    }
    case 'high_card': return `${rankName(sorted[0]!.rank)}-high`
  }
}

/**
 * Evaluate the best 5-card hand from 5, 6, or 7 cards.
 * Returns a HandResult with rank, tiebreakers, best 5 cards, and description.
 */
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards to evaluate, got ${cards.length}`)
  }

  const sorted = sortByRankDesc(cards)
  const groups = groupByRank(sorted)

  // Straight flush / royal flush
  const sf = findStraightFlush(sorted)
  if (sf) {
    const topValue = rankValue(sf[0]!.rank)
    const isRoyal = topValue === 14 && rankValue(sf[1]!.rank) === 13
    const rank: HandRank = isRoyal ? 'royal_flush' : 'straight_flush'
    return {
      rank,
      rankIndex: HAND_RANK_INDEX[rank],
      tiebreakers: sf.map(c => rankValue(c.rank)),
      cards: sf,
      description: describeHand(rank, sf),
    }
  }

  // Four of a kind
  const quads = Array.from(groups.entries())
    .filter(([, c]) => c.length >= 4)
    .sort((a, b) => rankValue(b[0]) - rankValue(a[0]))
  if (quads.length > 0) {
    const quadCards = quads[0]![1].slice(0, 4)
    const kickers = sorted.filter(c => c.rank !== quads[0]![0]).slice(0, 1)
    const best5 = [...quadCards, ...kickers]
    return {
      rank: 'four_of_a_kind',
      rankIndex: HAND_RANK_INDEX['four_of_a_kind'],
      tiebreakers: [rankValue(quads[0]![0]), ...kickers.map(c => rankValue(c.rank))],
      cards: best5,
      description: describeHand('four_of_a_kind', best5),
    }
  }

  // Full house
  const trips = Array.from(groups.entries())
    .filter(([, c]) => c.length >= 3)
    .sort((a, b) => rankValue(b[0]) - rankValue(a[0]))
  const pairs = Array.from(groups.entries())
    .filter(([, c]) => c.length >= 2)
    .sort((a, b) => rankValue(b[0]) - rankValue(a[0]))

  if (trips.length > 0) {
    // Check for full house: trips + any pair (or second trips)
    const tripRank = trips[0]![0]
    const pairCandidates = pairs.filter(([r]) => r !== tripRank)
    if (pairCandidates.length > 0) {
      const tripCards = trips[0]![1].slice(0, 3)
      const pairCards = pairCandidates[0]![1].slice(0, 2)
      const best5 = [...tripCards, ...pairCards]
      return {
        rank: 'full_house',
        rankIndex: HAND_RANK_INDEX['full_house'],
        tiebreakers: [rankValue(tripRank), rankValue(pairCandidates[0]![0])],
        cards: best5,
        description: describeHand('full_house', best5),
      }
    }
  }

  // Flush
  const flush = findFlush(sorted)
  if (flush) {
    return {
      rank: 'flush',
      rankIndex: HAND_RANK_INDEX['flush'],
      tiebreakers: flush.map(c => rankValue(c.rank)),
      cards: flush,
      description: describeHand('flush', flush),
    }
  }

  // Straight
  const straight = findStraight(sorted)
  if (straight) {
    // For wheel (A-2-3-4-5), the top card from findStraight is 5 (value=5)
    // but the Ace's rankValue is 14 — we need tiebreakers to reflect ace-low
    const straightValues = straight.map(c => rankValue(c.rank))
    const isWheel = straightValues.includes(14) && straightValues.includes(2)
    const tiebreakers = isWheel ? [5, 4, 3, 2, 1] : straightValues
    return {
      rank: 'straight',
      rankIndex: HAND_RANK_INDEX['straight'],
      tiebreakers,
      cards: straight,
      description: isWheel ? 'Straight, Five-high' : describeHand('straight', straight),
    }
  }

  // Three of a kind (no pair available for full house)
  if (trips.length > 0) {
    const tripCards = trips[0]![1].slice(0, 3)
    const kickers = sorted.filter(c => c.rank !== trips[0]![0]).slice(0, 2)
    const best5 = [...tripCards, ...kickers]
    return {
      rank: 'three_of_a_kind',
      rankIndex: HAND_RANK_INDEX['three_of_a_kind'],
      tiebreakers: [rankValue(trips[0]![0]), ...kickers.map(c => rankValue(c.rank))],
      cards: best5,
      description: describeHand('three_of_a_kind', best5),
    }
  }

  // Two pair
  if (pairs.length >= 2) {
    const topPairCards = pairs[0]![1].slice(0, 2)
    const secondPairCards = pairs[1]![1].slice(0, 2)
    const kickers = sorted
      .filter(c => c.rank !== pairs[0]![0] && c.rank !== pairs[1]![0])
      .slice(0, 1)
    const best5 = [...topPairCards, ...secondPairCards, ...kickers]
    return {
      rank: 'two_pair',
      rankIndex: HAND_RANK_INDEX['two_pair'],
      tiebreakers: [
        rankValue(pairs[0]![0]),
        rankValue(pairs[1]![0]),
        ...kickers.map(c => rankValue(c.rank)),
      ],
      cards: best5,
      description: describeHand('two_pair', best5),
    }
  }

  // Pair
  if (pairs.length === 1) {
    const pairCards = pairs[0]![1].slice(0, 2)
    const kickers = sorted.filter(c => c.rank !== pairs[0]![0]).slice(0, 3)
    const best5 = [...pairCards, ...kickers]
    return {
      rank: 'pair',
      rankIndex: HAND_RANK_INDEX['pair'],
      tiebreakers: [rankValue(pairs[0]![0]), ...kickers.map(c => rankValue(c.rank))],
      cards: best5,
      description: describeHand('pair', best5),
    }
  }

  // High card
  const best5 = sorted.slice(0, 5)
  return {
    rank: 'high_card',
    rankIndex: HAND_RANK_INDEX['high_card'],
    tiebreakers: best5.map(c => rankValue(c.rank)),
    cards: best5,
    description: describeHand('high_card', best5),
  }
}

/**
 * Compare two HandResults.
 * Returns positive if a wins, negative if b wins, 0 for tie.
 */
export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rankIndex !== b.rankIndex) return a.rankIndex - b.rankIndex
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] ?? 0
    const bv = b.tiebreakers[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}
