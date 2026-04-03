import { describe, expect, it } from 'vitest'
import { getVisibleCommunityCardCount } from '@/components/table/CommunityCards'

describe('CommunityCards visibility', () => {
  it('shows all dealt cards even after the betting round is no longer active', () => {
    expect(getVisibleCommunityCardCount([])).toBe(0)
    expect(getVisibleCommunityCardCount([
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'clubs' },
      { rank: 'J', suit: 'diamonds' },
      { rank: '9', suit: 'spades' },
    ])).toBe(5)
  })
})
