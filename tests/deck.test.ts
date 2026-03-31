import { describe, it, expect } from 'vitest'
import { createDeck, shuffleDeck, dealCards, freshShuffledDeck, rankValue } from '@/lib/poker/deck'

describe('deck', () => {
  it('creates a 52-card deck', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(52)
  })

  it('has no duplicates', () => {
    const deck = createDeck()
    const keys = deck.map(c => `${c.rank}${c.suit}`)
    expect(new Set(keys).size).toBe(52)
  })

  it('shuffles in place and returns the same array', () => {
    const deck = createDeck()
    const ref = deck
    const shuffled = shuffleDeck(deck)
    expect(shuffled).toBe(ref)
    expect(shuffled).toHaveLength(52)
  })

  it('shuffle produces a different order (statistical)', () => {
    const a = createDeck()
    const b = shuffleDeck([...a])
    // Extremely unlikely all 52 match after shuffle
    const same = a.every((c, i) => c.rank === b[i]!.rank && c.suit === b[i]!.suit)
    expect(same).toBe(false)
  })

  it('deals cards from the top and shrinks deck', () => {
    const deck = freshShuffledDeck()
    const dealt = dealCards(deck, 5)
    expect(dealt).toHaveLength(5)
    expect(deck).toHaveLength(47)
  })

  it('throws if dealing more cards than available', () => {
    const deck = freshShuffledDeck()
    dealCards(deck, 50) // leaves 2 cards
    expect(() => dealCards(deck, 5)).toThrow()
  })

  it('rankValue maps correctly', () => {
    expect(rankValue('2')).toBe(2)
    expect(rankValue('T')).toBe(10)
    expect(rankValue('A')).toBe(14)
    expect(rankValue('K')).toBe(13)
  })
})
