import { describe, expect, it } from 'vitest'
import { buildActionButtonDescriptors, getVisibleOwnHandDescription } from '@/components/table/PokerTable'
import type { Card } from '@/lib/poker/types'

function cards(...specs: string[]): Card[] {
  return specs.map(s => {
    const rank = s.slice(0, -1) as Card['rank']
    const suitChar = s.slice(-1)
    const suit = ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[suitChar]!
    return { rank, suit }
  })
}

describe('PokerTable action button descriptors', () => {
  it('keeps wager actions easy to scan without changing legal action order', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      toCall: 40,
      raiseAmount: 120,
      allInAmount: 940,
    })).toEqual([
      { key: 'call', label: 'Call', amountLabel: '$40', className: 'btn-call' },
      { key: 'raise', label: 'Raise to', amountLabel: '$120', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$940', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })

  it('shows check as the primary no-cost action when call is not legal', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'check', 'raise', 'all_in'],
      toCall: 0,
      raiseAmount: 80,
      allInAmount: 1000,
    })).toEqual([
      { key: 'check', label: 'Check', className: 'btn-check' },
      { key: 'raise', label: 'Raise to', amountLabel: '$80', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$1,000', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })
})

describe('getVisibleOwnHandDescription', () => {
  it('describes a pocket pair before the board is dealt', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Ah'),
      []
    )).toBe('Pair of Aces')
  })

  it('describes the best live hand from hole cards and the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Kh'),
      cards('Qd', 'Jc', 'Th')
    )).toBe('Straight, Ace-high')
  })

  it('describes a straight that is entirely on the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Kh'),
      cards('9d', '8c', '7h', '6s', '5d')
    )).toBe('Straight, Nine-high')
  })

  it('describes two pair that is entirely on the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Qh'),
      cards('Kd', 'Kc', '8h', '8s', '3d')
    )).toBe('Two Pair, Kings and Eights')
  })
})
