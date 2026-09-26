import { describe, expect, it } from 'vitest'
import {
  advanceLadyLuckForNewHand,
  applyLadyLuckHandOutcome,
  classifyLadyLuckResult,
  createLadyLuckTracker,
  getVisibleLadyLuck,
  isLadyLuckBigWin,
  type LadyLuckHandPlayer,
  type LadyLuckTracker,
} from '@/lib/poker/ladyLuck'

const BB = 20

function player(id: string, overrides: Partial<LadyLuckHandPlayer> = {}): LadyLuckHandPlayer {
  return {
    id,
    dealtIn: true,
    folded: false,
    allIn: false,
    totalInPot: 40,
    forcedBlind: 0,
    ...overrides,
  }
}

const SEATED = new Set(['ann', 'bob', 'cat'])

/** Plays hand `n`: deal (advance), then resolve with the given result. */
function hand(
  tracker: LadyLuckTracker,
  n: number,
  players: LadyLuckHandPlayer[],
  winners: Array<{ playerId: string; amount: number }>,
  seated: ReadonlySet<string> = SEATED
) {
  const started = advanceLadyLuckForNewHand(tracker, n, seated, n * 1000)
  return applyLadyLuckHandOutcome(started, { handNumber: n, bigBlind: BB, now: n * 1000 + 500, players, winners })
}

/** Heads-up showdown between ann and bob for a small pot won by `winner`. */
function smallShowdown(tracker: LadyLuckTracker, n: number, winner: string) {
  return hand(tracker, n, [player('ann'), player('bob')], [{ playerId: winner, amount: 80 }])
}

describe('Lady Luck hand classification', () => {
  it('treats collecting chips as a win and a showdown loss as a loss', () => {
    expect(classifyLadyLuckResult(player('a'), 80)).toBe('won')
    expect(classifyLadyLuckResult(player('a'), 0)).toBe('lost')
  })

  it('treats a free fold or a fold after only the blind as neutral, but a fold after betting as a loss', () => {
    expect(classifyLadyLuckResult(player('a', { folded: true, totalInPot: 0 }), 0)).toBe('neutral')
    expect(classifyLadyLuckResult(player('a', { folded: true, totalInPot: 20, forcedBlind: 20 }), 0)).toBe('neutral')
    expect(classifyLadyLuckResult(player('a', { folded: true, totalInPot: 60, forcedBlind: 20 }), 0)).toBe('lost')
    expect(classifyLadyLuckResult(player('a', { dealtIn: false, totalInPot: 0 }), 0)).toBe('neutral')
  })

  it('flags a 20 big blind pot or a contested all-in win as a big win', () => {
    const players = [player('a'), player('b')]
    expect(isLadyLuckBigWin(players[0]!, 20 * BB, { bigBlind: BB, players })).toBe(true)
    expect(isLadyLuckBigWin(players[0]!, 20 * BB - 1, { bigBlind: BB, players })).toBe(false)

    const allIn = [player('a'), player('b', { allIn: true })]
    expect(isLadyLuckBigWin(allIn[0]!, 100, { bigBlind: BB, players: allIn })).toBe(true)

    // Shoving and taking the blinds uncontested is not a big win.
    const uncontested = [player('a', { allIn: true }), player('b', { folded: true, totalInPot: 0 })]
    expect(isLadyLuckBigWin(uncontested[0]!, 30, { bigBlind: BB, players: uncontested })).toBe(false)
  })
})

describe('Lady Luck appearance', () => {
  it('does not appear after a single small win but arrives on the second win in a row', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    expect(tracker.companion).toBeNull()

    tracker = smallShowdown(tracker, 2, 'ann')
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', reason: 'streak', streak: 2, mood: 'arrive' })
    expect(getVisibleLadyLuck(tracker, SEATED)?.ownerId).toBe('ann')
  })

  it('arrives immediately for a big pot', () => {
    const tracker = hand(createLadyLuckTracker(), 1, [player('ann'), player('bob')], [{ playerId: 'bob', amount: 500 }])
    expect(tracker.companion).toMatchObject({ ownerId: 'bob', reason: 'big_win', streak: 1, mood: 'arrive' })
  })

  it('keeps a streak across a neutral free fold', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = hand(
      tracker,
      2,
      [player('ann', { folded: true, totalInPot: 0 }), player('bob'), player('cat')],
      [{ playerId: 'bob', amount: 80 }]
    )
    tracker = smallShowdown(tracker, 3, 'ann')
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', streak: 2 })
  })

  it('settles into flirting when the next hand is dealt, then cheers when the owner wins again', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    const id = tracker.companion!.id

    const dealt = advanceLadyLuckForNewHand(tracker, 3, SEATED, 3000)
    expect(dealt.companion).toMatchObject({ id, mood: 'flirt', since: 3000 })

    tracker = smallShowdown(tracker, 3, 'ann')
    expect(tracker.companion).toMatchObject({ id, mood: 'cheer', streak: 3 })
  })

  it('is idempotent for repeated outcome and deal calls', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    const again = applyLadyLuckHandOutcome(tracker, {
      handNumber: 2,
      bigBlind: BB,
      now: 9999,
      players: [player('ann'), player('bob')],
      winners: [{ playerId: 'ann', amount: 80 }],
    })
    expect(again).toBe(tracker)
    const dealt = advanceLadyLuckForNewHand(tracker, 3, SEATED, 1)
    expect(advanceLadyLuckForNewHand(dealt, 3, SEATED, 2)).toBe(dealt)
  })
})

describe('Lady Luck leaving', () => {
  it('sulks off when her owner loses a hand, then is gone at the next deal', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    const id = tracker.companion!.id

    tracker = hand(tracker, 3, [player('ann'), player('bob'), player('cat')], [{ playerId: 'cat', amount: 60 }])
    expect(tracker.companion).toMatchObject({ id, ownerId: 'ann', mood: 'sulk_leave', streak: 0 })
    expect(tracker.streaks.ann).toBe(0)

    tracker = advanceLadyLuckForNewHand(tracker, 4, SEATED, 4000)
    expect(tracker.companion).toBeNull()
  })

  it('stays when her owner folds for free', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    tracker = hand(
      tracker,
      3,
      [player('ann', { folded: true, totalInPot: 0 }), player('bob'), player('cat')],
      [{ playerId: 'bob', amount: 60 }]
    )
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', mood: 'flirt' })
  })

  it('is hidden immediately and dropped at the next deal when her owner leaves the table', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    const withoutAnn = new Set(['bob', 'cat'])
    expect(getVisibleLadyLuck(tracker, withoutAnn)).toBeNull()
    tracker = advanceLadyLuckForNewHand(tracker, 3, withoutAnn, 3000)
    expect(tracker.companion).toBeNull()
    expect(tracker.streaks.ann).toBeUndefined()
  })
})

describe('Lady Luck switching', () => {
  it('switches straight to the player who beat her owner when that player qualifies', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann')
    const firstId = tracker.companion!.id

    // Bob stacks Ann in a huge pot: Ann loses, Bob qualifies with a big win.
    tracker = hand(tracker, 3, [player('ann', { allIn: true }), player('bob')], [{ playerId: 'bob', amount: 900 }])
    expect(tracker.companion).toMatchObject({ ownerId: 'bob', reason: 'big_win', mood: 'arrive' })
    expect(tracker.companion!.id).not.toBe(firstId)
  })

  it('is stolen by a hotter player while her owner sits out, but not by a cooler one', () => {
    let tracker = smallShowdown(createLadyLuckTracker(), 1, 'ann')
    tracker = smallShowdown(tracker, 2, 'ann') // ann heat 2
    const annFolds = (n: number, winner: string, amount: number, t: LadyLuckTracker) => hand(
      t,
      n,
      [player('ann', { folded: true, totalInPot: 0 }), player('bob'), player('cat')],
      [{ playerId: winner, amount }]
    )

    // Cat's first small win (heat 1) does not qualify.
    tracker = annFolds(3, 'cat', 60, tracker)
    expect(tracker.companion?.ownerId).toBe('ann')
    // Cat's second win in a row (heat 2) ties Ann's heat: she stays loyal.
    tracker = annFolds(4, 'cat', 60, tracker)
    expect(tracker.companion?.ownerId).toBe('ann')
    // Cat's third straight win (heat 3) beats Ann: she switches.
    tracker = annFolds(5, 'cat', 60, tracker)
    expect(tracker.companion).toMatchObject({ ownerId: 'cat', reason: 'streak', streak: 3, mood: 'arrive' })
  })

  it('picks the hottest qualifier when several qualify at once', () => {
    let tracker = hand(createLadyLuckTracker(), 1, [player('ann'), player('bob')], [{ playerId: 'ann', amount: 80 }])
    tracker = hand(
      tracker,
      2,
      [player('ann'), player('bob'), player('cat')],
      [
        { playerId: 'ann', amount: 120 },
        { playerId: 'cat', amount: 120 },
      ]
    )
    // Ann: streak 2 (heat 2) beats Cat: streak 1, no big win.
    expect(tracker.companion?.ownerId).toBe('ann')
  })
})
