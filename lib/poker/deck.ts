import type { Card, Rank, Suit } from './types'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']

/** Create a fresh, ordered 52-card deck */
export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

/**
 * Fisher-Yates in-place shuffle.
 * Returns the same array (mutated) for convenience.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = deck[i]!
    deck[i] = deck[j]!
    deck[j] = temp
  }
  return deck
}

/**
 * Deal `n` cards from the top (start) of the deck.
 * Mutates the deck array by removing the dealt cards.
 * Returns the dealt cards.
 */
export function dealCards(deck: Card[], n: number): Card[] {
  if (n > deck.length) {
    throw new Error(`Cannot deal ${n} cards from a deck of ${deck.length}`)
  }
  const dealt = deck.splice(0, n)
  return dealt
}

/** Create and return a freshly shuffled deck */
export function freshShuffledDeck(): Card[] {
  return shuffleDeck(createDeck())
}

/** Get numeric rank value for comparison (2=2, T=10, J=11, Q=12, K=13, A=14) */
export function rankValue(rank: Rank): number {
  const map: Record<Rank, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '8': 8, '9': 9, 'T': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  }
  return map[rank]
}
