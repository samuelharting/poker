import { describe, expect, it } from 'vitest'
import {
  advanceLadyLuckForNewHand,
  applyLadyLuckHandOutcome,
  classifyLadyLuckResult,
  createLadyLuckTracker,
  getOutrightWinner,
  getVisibleLadyLuck,
  muteLadyLuck,
  type LadyLuckHandPlayer,
  type LadyLuckTracker,
} from '@/lib/poker/ladyLuck'

const SEATED = new Set(['ann', 'bob', 'cat'])

function dealt(...ids: string[]): LadyLuckHandPlayer[] {
  return ids.map(id => ({ id, dealtIn: true }))
}

/** Deals hand `n`, then resolves it with the given winners. */
function hand(
  tracker: LadyLuckTracker,
  n: number,
  players: LadyLuckHandPlayer[],
  winners: Array<{ playerId: string; amount: number }>,
  seated: ReadonlySet<string> = SEATED
) {
  const started = advanceLadyLuckForNewHand(tracker, n, seated, n * 1000)
  return applyLadyLuckHandOutcome(started, { handNumber: n, now: n * 1000 + 500, players, winners })
}

const win = (tracker: LadyLuckTracker, n: number, winner: string, players = dealt('ann', 'bob', 'cat')) =>
  hand(tracker, n, players, [{ playerId: winner, amount: 80 }])

describe('Lady Luck hand classification', () => {
  it('only counts a sole winner as a win; a chop has no winner', () => {
    expect(getOutrightWinner([{ playerId: 'ann', amount: 80 }])).toBe('ann')
    expect(getOutrightWinner([{ playerId: 'ann', amount: 40 }, { playerId: 'ann', amount: 20 }])).toBe('ann')
    expect(getOutrightWinner([{ playerId: 'ann', amount: 40 }, { playerId: 'bob', amount: 40 }])).toBeNull()
  })

  it('breaks the streak of every dealt-in non-winner and ignores players not dealt in', () => {
    expect(classifyLadyLuckResult({ id: 'ann', dealtIn: true }, 'ann')).toBe('won')
    expect(classifyLadyLuckResult({ id: 'bob', dealtIn: true }, 'ann')).toBe('broke')
    expect(classifyLadyLuckResult({ id: 'bob', dealtIn: true }, null)).toBe('broke')
    expect(classifyLadyLuckResult({ id: 'cat', dealtIn: false }, 'ann')).toBe('not_dealt')
  })
})

describe('Lady Luck appearance', () => {
  it('does not appear after one win, even a huge one, and arrives on the second straight win', () => {
    let tracker = hand(createLadyLuckTracker(), 1, dealt('ann', 'bob'), [{ playerId: 'ann', amount: 5000 }])
    expect(tracker.companion).toBeNull()

    tracker = win(tracker, 2, 'ann')
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', reason: 'streak', streak: 2, mood: 'arrive', muted: false })
    expect(getVisibleLadyLuck(tracker, SEATED)?.ownerId).toBe('ann')
  })

  it('does not count a split pot as a win', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = hand(tracker, 2, dealt('ann', 'bob'), [{ playerId: 'ann', amount: 40 }, { playerId: 'bob', amount: 40 }])
    expect(tracker.streaks.ann).toBe(0)
    tracker = win(tracker, 3, 'ann')
    expect(tracker.companion).toBeNull()
  })

  it('breaks a streak on a fold but keeps it through hands the player sat out', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'bob', dealt('ann', 'bob'))
    expect(tracker.streaks.ann).toBe(0)

    tracker = win(tracker, 3, 'ann')
    tracker = win(tracker, 4, 'bob', dealt('bob', 'cat')) // ann sat out
    tracker = win(tracker, 5, 'ann')
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', streak: 2 })
  })

  it('settles into flirting when the next hand is dealt, then cheers when the owner wins again', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    const id = tracker.companion!.id

    const dealtHand = advanceLadyLuckForNewHand(tracker, 3, SEATED, 3000)
    expect(dealtHand.companion).toMatchObject({ id, mood: 'flirt', since: 3000 })

    tracker = win(tracker, 3, 'ann')
    expect(tracker.companion).toMatchObject({ id, mood: 'cheer', streak: 3 })
  })

  it('is idempotent for repeated outcome and deal calls', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    const again = applyLadyLuckHandOutcome(tracker, {
      handNumber: 2,
      now: 9999,
      players: dealt('ann', 'bob'),
      winners: [{ playerId: 'ann', amount: 80 }],
    })
    expect(again).toBe(tracker)
    const dealtHand = advanceLadyLuckForNewHand(tracker, 3, SEATED, 1)
    expect(advanceLadyLuckForNewHand(dealtHand, 3, SEATED, 2)).toBe(dealtHand)
  })
})

describe('Lady Luck leaving', () => {
  it('sulks off as soon as her owner does not win, then is gone at the next deal', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    const id = tracker.companion!.id

    tracker = win(tracker, 3, 'cat')
    expect(tracker.companion).toMatchObject({ id, ownerId: 'ann', mood: 'sulk_leave', streak: 0 })

    tracker = advanceLadyLuckForNewHand(tracker, 4, SEATED, 4000)
    expect(tracker.companion).toBeNull()
  })

  it('leaves when her owner folds, even for free', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    tracker = win(tracker, 3, 'bob') // ann was dealt in and folded
    expect(tracker.companion?.mood).toBe('sulk_leave')
  })

  it('stays while her owner sits a hand out', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    tracker = win(tracker, 3, 'bob', dealt('bob', 'cat'))
    expect(tracker.companion).toMatchObject({ ownerId: 'ann', mood: 'flirt' })
  })

  it('is hidden immediately and dropped at the next deal when her owner leaves the table', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    const withoutAnn = new Set(['bob', 'cat'])
    expect(getVisibleLadyLuck(tracker, withoutAnn)).toBeNull()
    tracker = advanceLadyLuckForNewHand(tracker, 3, withoutAnn, 3000)
    expect(tracker.companion).toBeNull()
    expect(tracker.streaks.ann).toBeUndefined()
  })
})

describe('Lady Luck switching', () => {
  it('switches to another 2+ streak when her owner breaks', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'bob', dealt('bob'))
    tracker = win(tracker, 2, 'ann', dealt('ann', 'cat'))
    tracker = win(tracker, 3, 'ann', dealt('ann', 'cat')) // ann owns her; bob sat out on streak 1
    tracker = win(tracker, 4, 'bob', dealt('ann', 'bob')) // ann breaks, bob reaches 2
    expect(tracker.companion).toMatchObject({ ownerId: 'bob', streak: 2, mood: 'arrive' })
  })

  it('is stolen only by a strictly longer active streak while her owner sits out', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann', dealt('ann', 'cat'))
    tracker = win(tracker, 2, 'ann', dealt('ann', 'cat')) // ann: 2
    const sitOut = dealt('bob', 'cat')
    tracker = win(tracker, 3, 'bob', sitOut)
    tracker = win(tracker, 4, 'bob', sitOut) // bob: 2 ties ann -> she stays
    expect(tracker.companion?.ownerId).toBe('ann')
    tracker = win(tracker, 5, 'bob', sitOut) // bob: 3 > 2 -> switch
    expect(tracker.companion).toMatchObject({ ownerId: 'bob', streak: 3, mood: 'arrive', muted: false })
  })
})

describe('Lady Luck mute', () => {
  it('only her current owner can mute her, and a new appearance resets it', () => {
    let tracker = win(createLadyLuckTracker(), 1, 'ann')
    tracker = win(tracker, 2, 'ann')
    expect(muteLadyLuck(tracker, 'bob')).toBe(tracker)
    tracker = muteLadyLuck(tracker, 'ann')
    expect(tracker.companion?.muted).toBe(true)
    expect(muteLadyLuck(tracker, 'ann')).toBe(tracker)

    // Still muted while she stays with ann.
    tracker = win(tracker, 3, 'ann')
    expect(tracker.companion).toMatchObject({ mood: 'cheer', muted: true })

    // She leaves, then comes back for bob unmuted.
    tracker = win(tracker, 4, 'bob')
    expect(tracker.companion?.mood).toBe('sulk_leave')
    expect(muteLadyLuck(tracker, 'ann')).toBe(tracker)
    tracker = win(tracker, 5, 'bob')
    expect(tracker.companion).toMatchObject({ ownerId: 'bob', muted: false })
  })
})
