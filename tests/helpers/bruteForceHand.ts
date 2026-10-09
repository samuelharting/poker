import type { Card } from '@/lib/poker/types'

/**
 * Independent reference evaluator for tests: scores every 5-card subset of the
 * given cards (21 for seven cards) with a deliberately simple 5-card scorer and
 * keeps the best. Shares no code with lib/poker/evaluator.
 */

const VALUE: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
}
const NAME: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
}
const plural = (value: number) => (value === 6 ? 'Sixes' : `${NAME[value]}s`)

export interface ReferenceScore {
  /** 0 high card ... 8 straight flush, 9 royal flush (matches evaluator rankIndex). */
  category: number
  /** Category first, then tiebreak values: compare lexicographically. */
  key: number[]
  cards: Card[]
  description: string
}

function score5(cards: Card[]): ReferenceScore {
  const values = cards.map(card => VALUE[card.rank]).sort((a, b) => b - a)
  const isFlush = cards.every(card => card.suit === cards[0]!.suit)
  const distinct = Array.from(new Set(values))
  let straightHigh = 0
  if (distinct.length === 5) {
    if (values[0]! - values[4]! === 4) straightHigh = values[0]!
    else if (values.join(',') === '14,5,4,3,2') straightHigh = 5
  }
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  // Groups ordered by size, then value: [quad, kicker], [trip, pair], ...
  const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map(([, count]) => count).join('')
  const groupValues = groups.map(([value]) => value)

  let category: number
  let tiebreak: number[]
  let description: string
  if (straightHigh && isFlush) {
    category = straightHigh === 14 ? 9 : 8
    tiebreak = [straightHigh]
    description = straightHigh === 14 ? 'Royal Flush' : `Straight Flush, ${NAME[straightHigh]}-high`
  } else if (shape === '41') {
    category = 7
    tiebreak = groupValues
    description = `Four of a Kind, ${plural(groupValues[0]!)}`
  } else if (shape === '32') {
    category = 6
    tiebreak = groupValues
    description = `Full House, ${plural(groupValues[0]!)} full of ${plural(groupValues[1]!)}`
  } else if (isFlush) {
    category = 5
    tiebreak = values
    description = `Flush, ${NAME[values[0]!]}-high`
  } else if (straightHigh) {
    category = 4
    tiebreak = [straightHigh]
    description = `Straight, ${NAME[straightHigh]}-high`
  } else if (shape === '311') {
    category = 3
    tiebreak = groupValues
    description = `Three of a Kind, ${plural(groupValues[0]!)}`
  } else if (shape === '221') {
    category = 2
    tiebreak = groupValues
    description = `Two Pair, ${plural(groupValues[0]!)} and ${plural(groupValues[1]!)}`
  } else if (shape === '2111') {
    category = 1
    tiebreak = groupValues
    description = `Pair of ${plural(groupValues[0]!)}`
  } else {
    category = 0
    tiebreak = values
    description = `${NAME[values[0]!]}-high`
  }
  return { category, key: [category, ...tiebreak], cards, description }
}

export function compareReference(a: ReferenceScore, b: ReferenceScore): number {
  for (let index = 0; index < Math.max(a.key.length, b.key.length); index += 1) {
    const diff = (a.key[index] ?? 0) - (b.key[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function bestReferenceHand(cards: Card[]): ReferenceScore {
  if (cards.length < 5) throw new Error(`need 5+ cards, got ${cards.length}`)
  let best: ReferenceScore | null = null
  const n = cards.length
  for (let a = 0; a < n; a += 1)
    for (let b = a + 1; b < n; b += 1)
      for (let c = b + 1; c < n; c += 1)
        for (let d = c + 1; d < n; d += 1)
          for (let e = d + 1; e < n; e += 1) {
            const scored = score5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!])
            if (!best || compareReference(scored, best) > 0) best = scored
          }
  return best!
}

/** Score exactly these five cards (to check a claimed "winning cards" set). */
export function scoreFive(cards: Card[]): ReferenceScore {
  if (cards.length !== 5) throw new Error(`need exactly 5 cards, got ${cards.length}`)
  return score5(cards)
}

export const cardKey = (card: Card) => `${card.rank}${card.suit[0]}`
