import { describe, expect, it } from 'vitest'
import { computeHouseRules } from '@/lib/houseRules'
describe('house rules: sips, scared money and the bubble', () => {
  const card = (rank: string, suit: string) => ({ rank, suit }) as never
  const board = [card('2', 'clubs'), card('7', 'diamonds'), card('9', 'hearts'), card('J', 'spades'), card('4', 'clubs')]
  const base = { drinkCapable: true, folded: false, startStack: 1000, endStack: 1000, won: 0 }

  it('a lost showdown is a sip (half a beer)', () => {
    const outcomes = computeHouseRules({
      showdown: true,
      boards: [board],
      players: [
        { ...base, id: 'win', holeCards: [card('A', 'hearts'), card('A', 'spades')], won: 100, endStack: 1050 },
        { ...base, id: 'lose', holeCards: [card('K', 'hearts'), card('Q', 'spades')], endStack: 950 },
      ],
    })
    const loser = outcomes.find(outcome => outcome.playerId === 'lose')!
    expect(loser.beerRules).toContain('lost_showdown')
    expect(loser.beers).toBe(0.5)
  })

  it('three folds in a row cost a beer (scared money)', () => {
    const outcomes = computeHouseRules({
      showdown: false,
      boards: [[]],
      players: [{ ...base, id: 'nit', holeCards: [], folded: true, foldStreak: 3 }],
    })
    expect(outcomes[0]).toMatchObject({ playerId: 'nit', beers: 1, beerRules: ['scared_money'] })
    expect(computeHouseRules({ showdown: false, boards: [[]], players: [{ ...base, id: 'nit', holeCards: [], folded: true, foldStreak: 2 }] })).toEqual([])
  })

  it('the bubble (shortest stack at the end of an orbit) drinks, capped at two beers a hand', () => {
    const outcomes = computeHouseRules({
      showdown: false,
      boards: [[]],
      players: [{ ...base, id: 'short', holeCards: [], folded: true, foldStreak: 3, startStack: 1000, endStack: 600 }],
      bubbleIds: ['short'],
    })
    expect(outcomes[0]!.beerRules).toEqual(expect.arrayContaining(['big_loss', 'scared_money', 'bubble']))
    expect(outcomes[0]!.beers).toBe(2)
  })
})

describe("house rules: dealer's round", () => {
  const base = { drinkCapable: true, folded: true, holeCards: [], startStack: 1000, endStack: 1000, won: 0 }
  it('whoever had the button this hand drinks a beer', () => {
    const outcomes = computeHouseRules({ showdown: false, boards: [[]], players: [{ ...base, id: 'dealer' }, { ...base, id: 'other' }], dealerId: 'dealer' })
    expect(outcomes).toEqual([expect.objectContaining({ playerId: 'dealer', beers: 1, beerRules: ['dealer'] })])
  })
  it('skips a dealer who was not dealt in', () => {
    const outcomes = computeHouseRules({ showdown: false, boards: [[]], players: [{ ...base, id: 'dealer', startStack: undefined }], dealerId: 'dealer' })
    expect(outcomes).toEqual([])
  })
})
