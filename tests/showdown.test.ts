import { describe, expect, it } from 'vitest'

import {
  SHOWDOWN_INTRO_DURATION_MS,
  SHOWDOWN_AUTO_START_BUFFER_MS,
  SHOWDOWN_MAX_CARD_REVEAL_SPAN_MS,
  getShowdownMinimumDurationMs,
  getShowdownPresentation,
  getShowdownRevealMode,
  getShowdownRevealOffsets,
  getShowdownStage,
  getShowdownTiming,
  getSynchronizedShowdownElapsedMs,
  isTrueShowdown,
} from '@/lib/poker/showdown'

describe('showdown presentation timeline', () => {
  it('distinguishes a resolved showdown from an uncontested win', () => {
    expect(isTrueShowdown({
      phase: 'between_hands',
      round: 'showdown',
      winners: [{ playerId: 'alice' }],
    })).toBe(true)

    expect(isTrueShowdown({
      phase: 'between_hands',
      round: null,
      winners: [{ playerId: 'alice' }],
    })).toBe(false)

    expect(isTrueShowdown({
      phase: 'in_hand',
      round: 'showdown',
      winners: [{ playerId: 'alice' }],
    })).toBe(false)

    expect(isTrueShowdown({
      phase: 'between_hands',
      round: 'showdown',
      winners: [],
    })).toBe(false)
  })

  it('uses the server clock and advances from snapshot-relative elapsed time', () => {
    expect(getSynchronizedShowdownElapsedMs(10_000, 10_750)).toBe(750)
    expect(getSynchronizedShowdownElapsedMs(10_000, 10_750, 125)).toBe(875)
    expect(getSynchronizedShowdownElapsedMs(10_750, 10_000, -100)).toBe(0)
    expect(getSynchronizedShowdownElapsedMs(undefined, 10_000)).toBe(0)
    expect(getSynchronizedShowdownElapsedMs(10_000, Number.NaN)).toBe(0)
  })

  it('assigns stable card-by-card offsets in participant order', () => {
    const offsets = getShowdownRevealOffsets(['alice', 'bob', 'alice', ''])
    const timing = getShowdownTiming(2)

    expect(offsets).toEqual([
      { playerId: 'alice', cardIndex: 0, order: 0, offsetMs: SHOWDOWN_INTRO_DURATION_MS },
      { playerId: 'alice', cardIndex: 1, order: 1, offsetMs: SHOWDOWN_INTRO_DURATION_MS + timing.revealStepMs },
      { playerId: 'bob', cardIndex: 0, order: 2, offsetMs: SHOWDOWN_INTRO_DURATION_MS + timing.revealStepMs * 2 },
      { playerId: 'bob', cardIndex: 1, order: 3, offsetMs: SHOWDOWN_INTRO_DURATION_MS + timing.revealStepMs * 3 },
    ])
  })

  it('scales the reveal cadence and minimum hold for a crowded showdown', () => {
    const headsUp = getShowdownTiming(2)
    const fullTable = getShowdownTiming(8)

    expect(headsUp.cardCount).toBe(4)
    expect(fullTable.cardCount).toBe(16)
    expect(fullTable.revealStepMs).toBeLessThan(headsUp.revealStepMs)
    expect(fullTable.lastRevealMs - fullTable.revealStartMs)
      .toBeLessThanOrEqual(SHOWDOWN_MAX_CARD_REVEAL_SPAN_MS)
    expect(fullTable.totalDurationMs).toBeGreaterThan(headsUp.totalDurationMs)
    expect(getShowdownMinimumDurationMs(8)).toBe(
      fullTable.totalDurationMs + SHOWDOWN_AUTO_START_BUFFER_MS
    )
    expect(fullTable.highlightAtMs).toBeGreaterThan(fullTable.lastRevealMs)
    expect(fullTable.payoutAtMs).toBeGreaterThan(fullTable.highlightAtMs)
    expect(fullTable.resultAtMs).toBeGreaterThan(fullTable.payoutAtMs)
  })

  it('changes stages exactly at the shared timing boundaries', () => {
    const timing = getShowdownTiming(3)

    expect(getShowdownStage(timing.revealStartMs - 1, timing)).toBe('intro')
    expect(getShowdownStage(timing.revealStartMs, timing)).toBe('reveal')
    expect(getShowdownStage(timing.highlightAtMs, timing)).toBe('highlight')
    expect(getShowdownStage(timing.payoutAtMs, timing)).toBe('payout')
    expect(getShowdownStage(timing.resultAtMs, timing)).toBe('result')
    expect(getShowdownStage(timing.completeAtMs, timing)).toBe('complete')
  })

  it('maps reveal progress onto the cards already shown at each table seat', () => {
    const timing = getShowdownTiming(2)
    const presentationAt = (elapsedMs: number) => getShowdownPresentation({
      phase: 'between_hands',
      round: 'showdown',
      winners: [{ playerId: 'alice' }],
      showdownAt: 1_000,
      serverNow: 1_000 + elapsedMs,
      participantIds: ['alice', 'bob'],
    })

    expect(getShowdownRevealMode(presentationAt(0), 'alice')).toBe('none')
    expect(getShowdownRevealMode(presentationAt(timing.revealStartMs), 'alice')).toBe('left')
    expect(getShowdownRevealMode(
      presentationAt(timing.revealStartMs + timing.revealStepMs),
      'alice'
    )).toBe('both')
    expect(getShowdownRevealMode(presentationAt(timing.highlightAtMs), 'bob')).toBe('both')
    expect(getShowdownRevealMode(presentationAt(0), 'folded-player')).toBeNull()
  })

  it('lets a late snapshot jump to the synchronized payout state', () => {
    const timing = getShowdownTiming(2)
    const showdownAt = 50_000
    const presentation = getShowdownPresentation({
      phase: 'between_hands',
      round: 'showdown',
      winners: [{ playerId: 'alice' }],
      showdownAt,
      serverNow: showdownAt + timing.payoutAtMs,
      participantIds: ['alice', 'bob'],
    })

    expect(presentation.isShowdown).toBe(true)
    expect(presentation.stage).toBe('payout')
    expect(presentation.revealedCardCounts).toEqual({ alice: 2, bob: 2 })
    expect(presentation.winningHandHighlighted).toBe(true)
    expect(presentation.payoutStarted).toBe(true)
    expect(presentation.resultsVisible).toBe(false)
    expect(presentation.nextTransitionAtMs).toBe(timing.resultAtMs)
  })

  it('stays idle and exposes no reveal events for a fold-ended hand', () => {
    const presentation = getShowdownPresentation({
      phase: 'between_hands',
      round: null,
      winners: [{ playerId: 'alice' }],
      showdownAt: 1_000,
      serverNow: 2_000,
      participantIds: ['alice', 'bob'],
    })

    expect(presentation.isShowdown).toBe(false)
    expect(presentation.stage).toBe('idle')
    expect(presentation.revealOffsets).toEqual([])
    expect(presentation.revealedCardCounts).toEqual({ alice: 0, bob: 0 })
    expect(presentation.nextTransitionAtMs).toBeNull()
  })

  it('finishes legacy showdowns without a synchronization timestamp instead of stalling', () => {
    const presentation = getShowdownPresentation({
      phase: 'between_hands',
      round: 'showdown',
      winners: [{ playerId: 'alice' }],
      participantIds: ['alice', 'bob'],
      serverNow: 10_000,
    })

    expect(presentation.isShowdown).toBe(true)
    expect(presentation.stage).toBe('complete')
    expect(presentation.complete).toBe(true)
    expect(presentation.nextTransitionAtMs).toBeNull()
  })
})
