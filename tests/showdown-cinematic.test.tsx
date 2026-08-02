import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { ShowdownCinematic } from '@/components/table/ShowdownCinematic'
import { getShowdownPresentation, getShowdownTiming } from '@/lib/poker/showdown'
import type { TableState } from '@/lib/poker/types'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function makeShowdownState(): TableState {
  return {
    roomCode: 'SHOW01',
    phase: 'between_hands',
    serverNow: 10_000,
    autoStartEnabled: true,
    autoStartDelay: 3_000,
    round: 'showdown',
    players: [
      {
        id: 'alice',
        nickname: 'Alice',
        isBot: false,
        stack: 1_120,
        bet: 0,
        totalInPot: 120,
        status: 'active',
        isDealer: true,
        isSB: false,
        isBB: false,
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'A', suit: 'hearts' },
        ],
        hasCards: true,
        showCards: 'both',
        isConnected: true,
        seatIndex: 0,
        hasActedThisRound: true,
      },
      {
        id: 'bob',
        nickname: 'Bob',
        isBot: false,
        stack: 880,
        bet: 0,
        totalInPot: 120,
        status: 'disconnected',
        isDealer: false,
        isSB: true,
        isBB: false,
        holeCards: [
          { rank: 'K', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ],
        hasCards: true,
        showCards: 'both',
        isConnected: false,
        seatIndex: 1,
        hasActedThisRound: true,
      },
    ],
    communityCards: [
      { rank: 'A', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: '5', suit: 'hearts' },
      { rank: '3', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ],
    pots: [{ amount: 240, eligiblePlayerIds: ['alice', 'bob'] }],
    totalPot: 240,
    currentBet: 0,
    minRaise: 40,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1_000,
    actionTimerStart: null,
    actionTimerDuration: 30_000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 2,
    handNumber: 4,
    showdownAt: 10_000,
    recentActions: [],
    lobbyPlayers: [],
    winners: [{
      playerId: 'alice',
      amount: 240,
      handDescription: 'Three of a Kind, Aces',
      winningCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
        { rank: 'A', suit: 'diamonds' },
        { rank: '7', suit: 'clubs' },
        { rank: '5', suit: 'hearts' },
      ],
    }],
  }
}

describe('ShowdownCinematic', () => {
  it('keeps the showdown as a compact table cue without duplicating player cards', () => {
    const state = makeShowdownState()
    const timing = getShowdownTiming(2)
    const presentation = getShowdownPresentation({
      ...state,
      serverNow: state.showdownAt! + timing.highlightAtMs,
      participantIds: ['alice', 'bob'],
    })
    const markup = renderToStaticMarkup(
      <ShowdownCinematic
        state={state}
        presentation={presentation}
        onSoundCue={vi.fn()}
      />
    )

    expect(markup).toContain('data-stage="highlight"')
    expect(markup).toContain('showdown-table-sequence')
    expect(markup).toContain('Showdown')
    expect(markup).toContain('Winning five')
    expect(markup).not.toContain('showdown-cinematic-vignette')
    expect(markup).not.toContain('Alice')
    expect(markup).not.toContain('A of spades')
  })

  it('hands off to the normal table result as soon as results are ready', () => {
    const state = makeShowdownState()
    const timing = getShowdownTiming(2)
    const presentation = getShowdownPresentation({
      ...state,
      serverNow: state.showdownAt! + timing.resultAtMs,
      participantIds: ['alice', 'bob'],
    })

    expect(renderToStaticMarkup(
      <ShowdownCinematic
        state={state}
        presentation={presentation}
      />
    )).toBe('')
  })

  it('plays one cue at each deliberate card, winner, and payout transition', () => {
    const state = makeShowdownState()
    const timing = getShowdownTiming(2)
    const onSoundCue = vi.fn()
    const participantIds = ['alice', 'bob']
    const presentationAt = (elapsedMs: number) => getShowdownPresentation({
      ...state,
      serverNow: state.showdownAt! + elapsedMs,
      participantIds,
    })
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(
        <ShowdownCinematic
          state={state}
          presentation={presentationAt(0)}
          onSoundCue={onSoundCue}
        />
      )
    })

    for (let index = 0; index < timing.cardCount; index += 1) {
      act(() => {
        renderer.update(
          <ShowdownCinematic
            state={state}
            presentation={presentationAt(timing.revealStartMs + timing.revealStepMs * index)}
            onSoundCue={onSoundCue}
          />
        )
      })
    }

    act(() => {
      renderer.update(
        <ShowdownCinematic
          state={state}
          presentation={presentationAt(timing.highlightAtMs)}
          onSoundCue={onSoundCue}
        />
      )
    })
    act(() => {
      renderer.update(
        <ShowdownCinematic
          state={state}
          presentation={presentationAt(timing.payoutAtMs)}
          onSoundCue={onSoundCue}
        />
      )
    })

    expect(onSoundCue.mock.calls.map(([cue]) => cue)).toEqual([
      'showdown_card',
      'showdown_card',
      'showdown_card',
      'showdown_card',
      'showdown_winner',
      'pot_payout',
    ])

    act(() => renderer.unmount())
  })

  it('does not stack stale cues when a throttled client skips several stages', () => {
    const state = makeShowdownState()
    const timing = getShowdownTiming(2)
    const onSoundCue = vi.fn()
    const presentationAt = (elapsedMs: number) => getShowdownPresentation({
      ...state,
      serverNow: state.showdownAt! + elapsedMs,
      participantIds: ['alice', 'bob'],
    })
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(
        <ShowdownCinematic
          state={state}
          presentation={presentationAt(0)}
          onSoundCue={onSoundCue}
        />
      )
    })
    act(() => {
      renderer.update(
        <ShowdownCinematic
          state={state}
          presentation={presentationAt(timing.payoutAtMs)}
          onSoundCue={onSoundCue}
        />
      )
    })

    expect(onSoundCue).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})
