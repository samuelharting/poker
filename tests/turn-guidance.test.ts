import { describe, expect, it } from 'vitest'
import {
  createPreAction,
  describeAutoAction,
  getBlindTip,
  getPreActionOptions,
  getTurnPrompt,
  isPreActionOptionActive,
  reconcilePreAction,
  resolvePreAction,
  type TurnPromptInput,
} from '@/lib/poker/turnGuidance'

function promptInput(overrides: Partial<TurnPromptInput>): TurnPromptInput {
  return {
    round: 'preflop',
    toCall: 0,
    stack: 980,
    myBet: 0,
    currentBet: 20,
    isSB: false,
    isBB: false,
    smallBlind: 10,
    bigBlind: 20,
    hasActedThisRound: false,
    ...overrides,
  }
}

describe('turn prompt copy', () => {
  it('spells out the call amount', () => {
    const prompt = getTurnPrompt(promptInput({ toCall: 20 }))
    expect(prompt.kicker).toBe('Your turn')
    expect(prompt.headline).toBe('$20 to call')
    expect(prompt.primary).toBe('call')
    expect(prompt.context).toBeNull()
  })

  it('marks a call that puts you all-in', () => {
    const prompt = getTurnPrompt(promptInput({ toCall: 80, stack: 80, round: 'turn' }))
    expect(prompt.headline).toBe('$80 to call (all-in)')
    expect(prompt.callIsAllIn).toBe(true)
  })

  it('says check or bet on an unopened street and check or raise with a live blind', () => {
    expect(getTurnPrompt(promptInput({ round: 'flop', currentBet: 0 })).headline).toBe('Check or bet')
    const bbOption = getTurnPrompt(promptInput({ isBB: true, myBet: 20 }))
    expect(bbOption.headline).toBe('Check or raise')
    expect(bbOption.primary).toBe('check')
  })

  it('adds blind context for the first preflop decision', () => {
    expect(getTurnPrompt(promptInput({ isSB: true, myBet: 10, toCall: 10 })).context)
      .toBe("You're the small blind: $10 more to call")
    expect(getTurnPrompt(promptInput({ isBB: true, myBet: 20 })).context).toBe('Big blind: you can check')
    expect(getTurnPrompt(promptInput({ isBB: true, myBet: 20, toCall: 40, currentBet: 60 })).context)
      .toBe('Big blind: raised to you, $40 more to call')
  })

  it('drops the blind context after acting or on later streets', () => {
    expect(getTurnPrompt(promptInput({ isSB: true, myBet: 10, toCall: 10, hasActedThisRound: true })).context).toBeNull()
    expect(getTurnPrompt(promptInput({ isSB: true, myBet: 10, toCall: 10, round: 'flop' })).context).toBeNull()
  })

  it('explains the blinds once to beginners', () => {
    expect(getBlindTip(promptInput({ isSB: true, myBet: 10, toCall: 10 })))
      .toBe('You posted the small blind ($10). Call $10 more to see the flop, or fold.')
    expect(getBlindTip(promptInput({ isBB: true, myBet: 20 })))
      .toContain('You posted the big blind ($20)')
    expect(getBlindTip(promptInput({ toCall: 20 }))).toBeNull()
    expect(getBlindTip(promptInput({ isBB: true, myBet: 20, toCall: 40 }))).toBeNull()
  })
})

describe('pre-action options', () => {
  it('offers check choices when nothing is owed', () => {
    expect(getPreActionOptions({ toCall: 0, stack: 500 }).map(option => option.label))
      .toEqual(['Check/Fold', 'Check', 'Call any'])
  })

  it('hides Check and locks Call to the amount when facing a bet', () => {
    const options = getPreActionOptions({ toCall: 30, stack: 500 })
    expect(options.map(option => option.label)).toEqual(['Fold', 'Call $30', 'Call any'])
    expect(options.some(option => option.kind === 'check')).toBe(false)
  })

  it('drops Call any when the call is already all-in', () => {
    expect(getPreActionOptions({ toCall: 500, stack: 400 }).map(option => option.kind)).toEqual(['fold', 'call'])
  })

  it('lights the Fold chip for a Check/Fold that will fold', () => {
    const queued = createPreAction('check_fold', { handNumber: 1, round: 'flop', toCall: 0 })
    expect(isPreActionOptionActive(queued, 'check_fold')).toBe(true)
    expect(isPreActionOptionActive(queued, 'fold')).toBe(true)
    expect(isPreActionOptionActive(queued, 'check')).toBe(false)
    expect(isPreActionOptionActive(null, 'fold')).toBe(false)
  })
})

describe('pre-action lifecycle', () => {
  const ctx = { handNumber: 4, round: 'flop' as const, toCall: 0, isLive: true }

  it('clears silently on a new street or hand, or when no longer live', () => {
    const queued = createPreAction('check', ctx)
    expect(reconcilePreAction(queued, { ...ctx, round: 'turn' })).toEqual({ keep: false, note: null })
    expect(reconcilePreAction(queued, { ...ctx, handNumber: 5 })).toEqual({ keep: false, note: null })
    expect(reconcilePreAction(queued, { ...ctx, isLive: false })).toEqual({ keep: false, note: null })
    expect(reconcilePreAction(queued, ctx)).toEqual({ keep: true })
  })

  it('cancels Check with a note once someone bets', () => {
    const result = reconcilePreAction(createPreAction('check', ctx), { ...ctx, toCall: 40 })
    expect(result).toEqual({ keep: false, note: "Check cancelled: there's a bet, $40 to call" })
  })

  it('locks Call to its amount and cancels with a note when the bet changes', () => {
    const queued = createPreAction('call', { ...ctx, toCall: 20 })
    expect(queued.amount).toBe(20)
    expect(reconcilePreAction(queued, { ...ctx, toCall: 20 })).toEqual({ keep: true })
    expect(reconcilePreAction(queued, { ...ctx, toCall: 60 })).toEqual({
      keep: false,
      note: 'Call $20 cancelled: the bet changed, $60 to call now',
    })
  })

  it('keeps Check/Fold, Fold and Call any through a bet', () => {
    for (const kind of ['check_fold', 'fold', 'call_any'] as const) {
      expect(reconcilePreAction(createPreAction(kind, ctx), { ...ctx, toCall: 100 })).toEqual({ keep: true })
    }
  })
})

describe('resolving a pre-action on your turn', () => {
  const facing = { handNumber: 4, round: 'flop' as const, toCall: 20, legalActions: ['fold', 'call', 'raise', 'all_in'] as const }
  const free = { handNumber: 4, round: 'flop' as const, toCall: 0, legalActions: ['fold', 'check', 'raise', 'all_in'] as const }
  const make = (kind: Parameters<typeof createPreAction>[0], toCall = 0) =>
    createPreAction(kind, { handNumber: 4, round: 'flop', toCall })

  it('Check/Fold checks when free and folds to a bet', () => {
    expect(resolvePreAction(make('check_fold'), free)).toBe('check')
    expect(resolvePreAction(make('check_fold'), facing)).toBe('fold')
  })

  it('Fold never folds when checking is free', () => {
    expect(resolvePreAction(make('fold', 20), facing)).toBe('fold')
    expect(resolvePreAction(make('fold', 20), free)).toBe('check')
  })

  it('Call only fires for the exact amount it was locked to', () => {
    expect(resolvePreAction(make('call', 20), facing)).toBe('call')
    expect(resolvePreAction(make('call', 10), facing)).toBeNull()
  })

  it('Call any calls or checks', () => {
    expect(resolvePreAction(make('call_any'), facing)).toBe('call')
    expect(resolvePreAction(make('call_any'), free)).toBe('check')
  })

  it('Check only checks', () => {
    expect(resolvePreAction(make('check'), free)).toBe('check')
    expect(resolvePreAction(make('check'), facing)).toBeNull()
  })

  it('never acts for another street or hand', () => {
    expect(resolvePreAction(make('call_any'), { ...facing, round: 'turn' })).toBeNull()
    expect(resolvePreAction(make('call_any'), { ...facing, handNumber: 5 })).toBeNull()
  })

  it('confirms what it did', () => {
    expect(describeAutoAction('check', 0)).toBe('Auto-checked')
    expect(describeAutoAction('fold', 20)).toBe('Auto-folded')
    expect(describeAutoAction('call', 20)).toBe('Auto-called $20')
  })
})
