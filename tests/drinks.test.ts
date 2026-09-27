import { describe, expect, it } from 'vitest'
import {
  applyHandCompleted,
  applyQueuedWaters,
  BUZZ,
  BLACKOUT_MS,
  CHASER_LEVELS,
  CHASER_WINDOW_MS,
  computeSoberTax,
  createEmptyDrinkState,
  endHangoverIfOver,
  isInSweetSpot,
  ONE_BEER_PER_HAND_REASON,
  projectNextSoberTax,
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

describe('drink ledger rules (buzz economy)', () => {
  it('adds one level per beer, as many beers as you like, and changes the lastDrink id every time', () => {
    const entry = createDrinkLedgerEntry()
    order(entry, 'beer', 0, { handNumber: 1 })
    const firstId = entry.lastDrink?.id
    // Owner: no per-hand limit, only the short order cooldown.
    expect(order(entry, 'beer', DRINK_COOLDOWN_MS, { handNumber: 1 }).ok).toBe(true)
    expect(toPublicDrinkState(entry).beerReadyAtHand).toBe(0)
    void ONE_BEER_PER_HAND_REASON

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
    expect(order(entry, 'water', 1_000 + DRINK_COOLDOWN_MS).ok).toBe(true)
  })

  it('queues water (-1.5 each) until its timer lands it, with no per-hand limit', () => {
    const entry = createDrinkLedgerEntry()
    entry.level = 7
    const first = order(entry, 'water', 60_000)
    const second = order(entry, 'water', 60_000 + DRINK_COOLDOWN_MS)
    expect(first).toMatchObject({ ok: true, water: { levels: BUZZ.waterLevels } })
    expect(second.ok).toBe(true)
    expect(entry.level).toBe(7)
    expect(toPublicDrinkState(entry)).toMatchObject({ sobering: 2, waterNextHand: 3 })

    expect(applyQueuedWaters(entry)).toBe(3)
    expect(entry.level).toBe(4)
    expect(toPublicDrinkState(entry)).toMatchObject({ sobering: 0, waterNextHand: 0 })
    expect(applyQueuedWaters(entry)).toBe(0)
  })

  it('never lets water push the level below zero', () => {
    const entry = createDrinkLedgerEntry()
    order(entry, 'water', 0)
    applyQueuedWaters(entry)
    expect(entry.level).toBe(0)
    expect(entry.waters).toBe(1)
  })

  it('a chaser applies instantly and is never also queued', () => {
    const entry = createDrinkLedgerEntry()
    entry.level = 6
    entry.chaserUntil = 10_000
    const result = order(entry, 'water', 5_000)
    expect(result).toMatchObject({ ok: true, chaser: true })
    expect(entry.level).toBe(6 - CHASER_LEVELS)
    expect(entry.pendingWaters).toHaveLength(0)
    expect(applyQueuedWaters(entry)).toBe(0)
  })

  it('never sobers on its own: water is the only way down', () => {
    const entry = createDrinkLedgerEntry()
    entry.level = 2
    for (let hand = 0; hand < 6; hand += 1) applyHandCompleted(entry)
    expect(entry.level).toBe(2)
  })

  it('blacks out at 10 for a few seconds, never waiting for a hand, then wakes at 1 hungover for about a hand', () => {
    const entry = createDrinkLedgerEntry()
    entry.level = 9
    const result = order(entry, 'beer', 100_000, { handNumber: 4, isDealtIntoLiveHand: true })

    expect(result).toEqual({ ok: true, passedOut: true })
    expect(entry.level).toBe(10)
    expect(entry.passedOut).toBe(true)
    expect(order(entry, 'water', 100_000 + DRINK_COOLDOWN_MS)).toMatchObject({ ok: false })
    expect(applyHandCompleted(entry, { dealtIn: true, taxable: true })).toBe(false)
    expect(entry.level).toBe(10)

    expect(wakeIfRested(entry, 4, 100_000 + BLACKOUT_MS - 1)).toBe(false)
    // Mid-hand: they come to on their own, no need to wait for a new deal.
    expect(wakeIfRested(entry, 4, 100_000 + BLACKOUT_MS)).toBe(true)
    expect(entry.passedOut).toBe(false)
    expect(entry.level).toBe(WAKE_UP_LEVEL)
    expect(WAKE_UP_LEVEL).toBe(1)
    expect(toPublicDrinkState(entry).hungover).toBe(true)

    expect(endHangoverIfOver(entry, 5)).toBe(false)
    expect(endHangoverIfOver(entry, 6)).toBe(true)
    expect(toPublicDrinkState(entry).hungover).toBe(false)
  })

  it('drops pending waters when blacking out', () => {
    const entry = createDrinkLedgerEntry()
    entry.level = 9
    order(entry, 'water', 50_000, { handNumber: 3 })
    order(entry, 'beer', 60_000, { handNumber: 3 })
    expect(entry.passedOut).toBe(true)
    expect(toPublicDrinkState(entry).sobering).toBe(0)
  })
})

describe('sober tax', () => {
  const blinds = { smallBlind: 10, bigBlind: 20 }

  it('counts dealt-in sober hands and resets once they drink back above 1', () => {
    const entry = createDrinkLedgerEntry()
    applyHandCompleted(entry, { dealtIn: true, taxable: true })
    expect(entry.soberHands).toBe(1)
    // Not dealt in: the counter holds.
    applyHandCompleted(entry, { dealtIn: false, taxable: true })
    expect(entry.soberHands).toBe(1)
    applyHandCompleted(entry, { dealtIn: true, taxable: true })
    expect(entry.soberHands).toBe(2)
    order(entry, 'beer', 0, { handNumber: 9 })
    order(entry, 'beer', DRINK_COOLDOWN_MS, { handNumber: 10 })
    expect(entry.level).toBe(2)
    expect(entry.soberHands).toBe(0)
  })

  it('exempts phone players (not taxable) and hungover players', () => {
    const phone = createDrinkLedgerEntry()
    applyHandCompleted(phone, { dealtIn: true, taxable: false })
    expect(phone.soberHands).toBe(0)

    const hungover = createDrinkLedgerEntry()
    hungover.hungoverThroughHand = 5
    applyHandCompleted(hungover, { dealtIn: true, taxable: true })
    expect(hungover.soberHands).toBe(0)
  })

  // Owner: being sober must never cost chips. The tax is switched off.
  it('never charges a sober tax while sober penalties are off', () => {
    expect(BUZZ.soberPenaltiesEnabled).toBe(false)
    for (const soberHands of [0, 1, 2, 5, 40]) {
      expect(computeSoberTax({ soberHands, stack: 10_000, ...blinds })).toBe(0)
    }
    const drinks = { ...createEmptyDrinkState(), level: 0, soberHands: 9 }
    expect(projectNextSoberTax(drinks, { ...blinds, stack: 1000, dealtIn: true })).toBe(0)
  })
})

/**
 * Deterministic simulation of the economy (the lead's targets): a locked-in
 * player (beer under 4, water over 6, chases shots) stays in the sweet spot
 * almost all the time; a casual one drifts out about half the time; a chugger
 * (a beer every hand) blacks out regularly. Shots from the table land now and then.
 */
describe('buzz economy simulation', () => {
  function lcg(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  type Style = 'locked_in' | 'casual' | 'chugger'

  function simulate(style: Style, hands = 400, seed = 7) {
    const random = lcg(seed)
    const entry = createDrinkLedgerEntry()
    entry.level = 3
    let now = 0
    let inSweetSpot = 0
    let blackouts = 0
    let beers = 0
    let taxedHands = 0
    for (let hand = 1; hand <= hands; hand += 1) {
      now += 60_000
      wakeIfRested(entry, hand, now)
      endHangoverIfOver(entry, hand)
      applyQueuedWaters(entry)
      if (computeSoberTax({ soberHands: entry.soberHands, smallBlind: 10, bigBlind: 20, stack: 1000 }) > 0) {
        taxedHands += 1
      }

      // A shot from the table every ~8 hands (delivered between hands).
      if (!entry.passedOut && random() < 0.12) {
        entry.level = Math.min(10, entry.level + 3)
        entry.soberHands = 0
        entry.chaserUntil = now + CHASER_WINDOW_MS
        if (entry.level >= 10) {
          entry.passedOut = true
          entry.passedOutAt = now
          blackouts += 1
        } else if (style === 'locked_in' && entry.level > BUZZ.sweetSpotMax) {
          order(entry, 'water', now + 1_000, { handNumber: hand })
        }
      }

      const level = entry.level
      let drink: 'beer' | 'water' | null = null
      if (style === 'locked_in') {
        drink = level < 4 ? 'beer' : level > 6 ? 'water' : null
      } else if (style === 'casual') {
        drink = random() < 0.3 ? 'beer' : random() < 0.1 ? 'water' : null
      } else {
        drink = 'beer'
      }
      if (drink && !entry.passedOut) {
        const result = order(entry, drink, now + 5_000, { handNumber: hand })
        if (result.ok && result.passedOut) blackouts += 1
        if (result.ok && drink === 'beer') beers += 1
      }

      if (isInSweetSpot(entry.level) && !entry.passedOut) inSweetSpot += 1
      now += BLACKOUT_MS
      wakeIfRested(entry, hand, now)
      applyHandCompleted(entry, { dealtIn: true, taxable: true })
    }
    return {
      sweetSpotShare: inSweetSpot / hands,
      blackoutsPer100: (blackouts / hands) * 100,
      beersPerHand: beers / hands,
      taxedShare: taxedHands / hands,
    }
  }

  it('keeps a locked-in player in the sweet spot ~90% of hands, never taxed', () => {
    const result = simulate('locked_in')
    expect(result.sweetSpotShare).toBeGreaterThan(0.8)
    expect(result.blackoutsPer100).toBeLessThan(2)
    expect(result.taxedShare).toBe(0)
  })

  it('lets a casual drinker drift out of the sweet spot about half the time', () => {
    const result = simulate('casual')
    expect(result.sweetSpotShare).toBeGreaterThan(0.25)
    expect(result.sweetSpotShare).toBeLessThan(0.75)
  })

  it('blacks out a chugger regularly (several times per 100 hands)', () => {
    const result = simulate('chugger')
    expect(result.blackoutsPer100).toBeGreaterThan(4)
    expect(result.blackoutsPer100).toBeLessThan(20)
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
      waterNextHand: 0,
      beerReadyAtHand: 0,
      soberHands: 0,
      soberTax: 0,
      hungover: false,
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

  it('keeps normal vision below buzz 6, then blurs and misreads from 7', () => {
    for (const level of [0, 1, 2, 3, 4, 5, 5.5]) {
      expect(getDrunkEffectProfile(level)).toMatchObject({ tier: 'sober', blurPx: 0, ghostPx: 0, swayDeg: 0, hallucinationChance: 0 })
    }
    expect(getDrunkEffectProfile(6).blurPx).toBe(0)
    const drunk = getDrunkEffectProfile(7)
    expect(drunk.hallucinationChance).toBeGreaterThan(0)
    expect(drunk.blurPx).toBeGreaterThan(0)
  })

  it('gets strictly worse from 7 to 9 and adds hiccups from level 8', () => {
    const levels = [7, 8, 9].map(level => getDrunkEffectProfile(level))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!.blurPx).toBeGreaterThan(levels[index - 1]!.blurPx)
      expect(levels[index]!.ghostPx).toBeGreaterThan(levels[index - 1]!.ghostPx)
      expect(levels[index]!.pulseSeconds).toBeLessThanOrEqual(levels[index - 1]!.pulseSeconds)
    }
    expect(getDrunkEffectProfile(7).hiccups).toBe(false)
    expect(getDrunkEffectProfile(8)).toMatchObject({ hiccups: true, wobblyButtons: true })
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
