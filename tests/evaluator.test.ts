import { describe, it, expect } from 'vitest'
import { evaluateHand, compareHands } from '@/lib/poker/evaluator'
import type { Card } from '@/lib/poker/types'

function cards(...specs: string[]): Card[] {
  return specs.map(s => {
    const rank = s.slice(0, -1) as Card['rank']
    const suitChar = s.slice(-1)
    const suit = ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[suitChar]!
    return { rank, suit }
  })
}

describe('evaluateHand', () => {
  it('detects royal flush', () => {
    const hand = cards('As', 'Ks', 'Qs', 'Js', 'Ts', '3d', '7c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('royal_flush')
  })

  it('detects straight flush', () => {
    const hand = cards('9h', '8h', '7h', '6h', '5h', '2d', '3c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('straight_flush')
  })

  it('detects four of a kind', () => {
    const hand = cards('Ks', 'Kh', 'Kd', 'Kc', '7s', '3d', '2c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('four_of_a_kind')
  })

  it('detects full house', () => {
    const hand = cards('Qs', 'Qh', 'Qd', '8c', '8s', '3d', '2c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('full_house')
    expect(result.description).toContain('Queen')
  })

  it('detects flush', () => {
    const hand = cards('Ad', 'Td', '7d', '4d', '2d', '3s', '5c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('flush')
  })

  it('detects straight', () => {
    const hand = cards('9s', '8h', '7d', '6c', '5s', '2d', '3c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('straight')
  })

  it('detects ace-low straight (wheel)', () => {
    const hand = cards('As', '2h', '3d', '4c', '5s', '9d', 'Tc')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('straight')
    expect(result.description).toContain('Five')
  })

  it('detects three of a kind', () => {
    const hand = cards('Js', 'Jh', 'Jd', '8c', '4s', '3d', '2c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('three_of_a_kind')
  })

  it('detects two pair', () => {
    const hand = cards('As', 'Ah', 'Ks', 'Kh', '7d', '3c', '2s')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('two_pair')
  })

  it('detects pair', () => {
    const hand = cards('Ts', 'Th', '8d', '6c', '4s', '3d', '2c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('pair')
  })

  it('detects high card', () => {
    const hand = cards('As', 'Kh', '9d', '7c', '4s', '3d', '2c')
    const result = evaluateHand(hand)
    expect(result.rank).toBe('high_card')
  })

  it('throws with fewer than 5 cards', () => {
    expect(() => evaluateHand(cards('As', 'Kh', '9d', '7c'))).toThrow()
  })
})

describe('compareHands', () => {
  it('flush beats straight', () => {
    const flush = evaluateHand(cards('Ad', 'Td', '7d', '4d', '2d', '3s', '5c'))
    const straight = evaluateHand(cards('9s', '8h', '7d', '6c', '5s', '2d', '3c'))
    expect(compareHands(flush, straight)).toBeGreaterThan(0)
  })

  it('higher pair beats lower pair', () => {
    const aa = evaluateHand(cards('As', 'Ah', '9d', '7c', '4s', '3d', '2c'))
    const kk = evaluateHand(cards('Ks', 'Kh', '9d', '7c', '4s', '3d', '2c'))
    expect(compareHands(aa, kk)).toBeGreaterThan(0)
  })

  it('same hand ranks compare by kicker', () => {
    const a = evaluateHand(cards('As', 'Ah', 'Kd', '7c', '4s', '3d', '2c'))
    const b = evaluateHand(cards('As', 'Ah', 'Qd', '7c', '4s', '3d', '2c'))
    expect(compareHands(a, b)).toBeGreaterThan(0)
  })

  it('identical hands tie', () => {
    const a = evaluateHand(cards('As', 'Kh', '9d', '7c', '4s'))
    const b = evaluateHand(cards('Ad', 'Kc', '9h', '7s', '4d'))
    expect(compareHands(a, b)).toBe(0)
  })
})
