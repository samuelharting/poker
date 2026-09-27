import { describe, expect, it } from 'vitest'
import {
  applyHandCompleted,
  applyWaterKickIn,
  createDrinkLedgerEntry,
  describeDrinkEvent,
  DRINK_COOLDOWN_MS,
  getDrunkEffectProfile,
  normalizeDrinkState,
  orderDrink,
  pickMisreadCard,
  toPublicDrinkState,
  wakeIfRested,
  WAKE_UP_LEVEL,
  WATER_KICK_IN_MS,
  type DrinkLedgerEntry,
  type DrinkOrderContext,
} from '@/lib/drinks'
import type { Card } from '@/lib/poker/types'

let drinkCounter = 0
function order(
  entry: DrinkLedgerEntry,
  kind: 'beer' | 'water',
  now: number,
  overrides: Partial<DrinkOrderContext> = {}
) {
  drinkCounter += 1
  return orderDrink(entry, {
    kind,
    now,
    drinkId: `drink-${drinkCounter}`,
    handNumber: 1,
    isDealtIntoLiveHand: true,
    ...overrides,
  })
}

function drinkBeers(entry: DrinkLedgerEntry, count: number, start = 0, overrides: Partial<DrinkOrderContext> = {}) {
  let now = start
  for (let index = 0; index < count; index += 1) {
    const result = order(entry, 'beer', now, overrides)
    expect(result.ok).toBe(true)
    now += DRINK_COOLDOWN_MS
  }
  return now
}

describe('drink ledger rules', () => {
  it('adds one drunk level per beer and changes the lastDrink id every time', () => {
    const entry = createDrinkLedgerEntry()
    order(entry, 'beer', 0)
    const firstId = entry.lastDrink?.id
    order(entry, 'beer', DRINK_COOLDOWN_MS)

    expect(entry.level).toBe(2)
    expect(entry.beers).toBe(2)
    expect(entry.lastDrink?.kind).toBe('beer')
    expect(entry.lastDrink?.id).not.toBe(firstId)
  })

  it('rate limits drinks to one every three seconds', () => {
    const entry = createDrinkLedgerEntry()
    expect(order(entry, 'beer', 1_000).ok).toBe(true)
    expect(order(entry, 'water', 1_000 + DRINK_COOLDOWN_MS - 1)).toEqual({
      ok: false,
      reason: expect.stringContaining('3 seconds'),
    })
    expect(entry.level).toBe(1)
    expect(order(entry, 'beer', 1_000 + DRINK_COOLDOWN_MS).ok).toBe(true)
  })

  it('makes water kick in later instead of immediately', () => {
    const entry = createDrinkLedgerEntry()
    drinkBeers(entry, 3)
    const result = order(entry, 'water', 60_000)

    expect(result).toMatchObject({ ok: true, water: { dueAt: 60_000 + WATER_KICK_IN_MS } })
    expect(entry.level).toBe(3)
    expect(toPublicDrinkState(entry).sobering).toBe(1)

    const waterId = result.ok && result.water ? result.water.id : ''
    expect(applyWaterKickIn(entry, waterId)).toBe(true)
    expect(entry.level).toBe(2)
    expect(toPublicDrinkState(entry).sobering).toBe(0)
    expect(applyWaterKickIn(entry, waterId)).toBe(false)
    expect(entry.level).toBe(2)
  })

  it('never lets water push the level below zero', () => {
    const entry = createDrinkLedgerEntry()
    const result = order(entry, 'water', 0)
    applyWaterKickIn(entry, result.ok && result.water ? result.water.id : '')
    expect(entry.level).toBe(0)
    expect(entry.waters).toBe(1)
  })

  it('wears off one level every three completed hands', () => {
    const entry = createDrinkLedgerEntry()
    drinkBeers(entry, 2)

    expect(applyHandCompleted(entry)).toBe(false)
    expect(applyHandCompleted(entry)).toBe(false)
    expect(applyHandCompleted(entry)).toBe(true)
    expect(entry.level).toBe(1)
    applyHandCompleted(entry)
    applyHandCompleted(entry)
    applyHandCompleted(entry)
    expect(entry.level).toBe(0)
    applyHandCompleted(entry)
    expect(entry.level).toBe(0)
  })

  it('passes out at ten beers, sleeps through the live hand, and wakes at level 6', () => {
    const entry = createDrinkLedgerEntry()
    drinkBeers(entry, 9, 0, { handNumber: 4 })
    expect(entry.passedOut).toBe(false)
    const result = order(entry, 'beer', 100_000, { handNumber: 4, isDealtIntoLiveHand: true })

    expect(result).toEqual({ ok: true, passedOut: true })
    expect(entry.level).toBe(10)
    expect(entry.passedOut).toBe(true)
    expect(order(entry, 'water', 200_000)).toMatchObject({ ok: false })
    expect(applyHandCompleted(entry)).toBe(false)
    expect(entry.level).toBe(10)

    expect(wakeIfRested(entry, 4)).toBe(false)
    expect(wakeIfRested(entry, 5)).toBe(true)
    expect(entry.passedOut).toBe(false)
    expect(entry.level).toBe(WAKE_UP_LEVEL)
  })

  it('sits out the whole next hand when passing out between hands', () => {
    const entry = createDrinkLedgerEntry()
    drinkBeers(entry, 10, 0, { handNumber: 2, isDealtIntoLiveHand: false })

    expect(entry.passedOut).toBe(true)
    expect(wakeIfRested(entry, 3)).toBe(false)
    expect(wakeIfRested(entry, 4)).toBe(true)
  })

  it('drops pending waters when passing out', () => {
    const entry = createDrinkLedgerEntry()
    drinkBeers(entry, 9)
    order(entry, 'water', 50_000)
    order(entry, 'beer', 60_000)
    expect(entry.passedOut).toBe(true)
    expect(toPublicDrinkState(entry).sobering).toBe(0)
  })
})

describe('drink state normalization and copy', () => {
  it('defaults to a sober empty state', () => {
    expect(toPublicDrinkState(undefined)).toEqual({
      level: 0,
      beers: 0,
      waters: 0,
      lastDrink: null,
      passedOut: false,
      sobering: 0,
      shots: 0,
      shotReadyAtHand: 0,
      shotReceivableAtHand: 0,
      chaserUntil: 0,
      shotsWaiting: 0,
    })
    expect(normalizeDrinkState(null)).toEqual(toPublicDrinkState(undefined))
  })

  it('clamps and sanitizes untrusted drink state', () => {
    expect(normalizeDrinkState({
      level: 99,
      beers: -3,
      lastDrink: { kind: 'vodka', id: 'x', at: 1 },
      passedOut: 'yes',
    })).toMatchObject({ level: 10, beers: 0, lastDrink: null, passedOut: false })
  })

  it('describes events for toasts', () => {
    expect(describeDrinkEvent({ kind: 'beer', nickname: 'Sam', beers: 3, level: 3 }))
      .toEqual({ icon: '🍺', text: 'Sam cracked a beer (3)' })
    expect(describeDrinkEvent({ kind: 'passed_out', nickname: 'Sam', beers: 10, level: 10 }).text)
      .toBe('Sam passed out')
    expect(describeDrinkEvent({ kind: 'passed_out', nickname: 'Sam', beers: 10, level: 10 }, true).text)
      .toBe('You passed out')
  })
})

describe('drunk vision profile', () => {
  it('keeps a sober player completely unaffected', () => {
    expect(getDrunkEffectProfile(0)).toMatchObject({
      tier: 'sober',
      blurPx: 0,
      ghostPx: 0,
      swayDeg: 0,
      hallucinationChance: 0,
      hiccups: false,
      wobblyButtons: false,
    })
  })

  it('starts misreading cards and blurring at level 3', () => {
    expect(getDrunkEffectProfile(2).hallucinationChance).toBe(0)
    expect(getDrunkEffectProfile(2).blurPx).toBe(0)
    const tipsy = getDrunkEffectProfile(3)
    expect(tipsy.tier).toBe('tipsy')
    expect(tipsy.hallucinationChance).toBeGreaterThan(0)
    expect(tipsy.blurPx).toBeGreaterThan(0)
  })

  it('gets strictly worse as the level rises and adds hiccups from level 6', () => {
    const levels = [3, 4, 5, 6, 7, 8, 9].map(level => getDrunkEffectProfile(level))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!.blurPx).toBeGreaterThan(levels[index - 1]!.blurPx)
      expect(levels[index]!.ghostPx).toBeGreaterThan(levels[index - 1]!.ghostPx)
      expect(levels[index]!.pulseSeconds).toBeLessThanOrEqual(levels[index - 1]!.pulseSeconds)
    }
    expect(getDrunkEffectProfile(5).hiccups).toBe(false)
    expect(getDrunkEffectProfile(6)).toMatchObject({ hiccups: true, wobblyButtons: true })
    expect(getDrunkEffectProfile(9).hallucinationChance).toBeLessThanOrEqual(0.8)
    expect(getDrunkEffectProfile(10, true).tier).toBe('out')
  })

  it('never misreads a card as one the viewer can already see', () => {
    const visible: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
    ]
    for (let step = 0; step < 50; step += 1) {
      const misread = pickMisreadCard(visible, () => step / 50)
      expect(visible.some(card => card.rank === misread.rank && card.suit === misread.suit)).toBe(false)
    }
    expect(pickMisreadCard(visible, () => 0.999999)).toBeTruthy()
  })
})
