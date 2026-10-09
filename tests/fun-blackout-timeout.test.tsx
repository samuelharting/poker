import React, { act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLACKOUT_BEAT_MAX_MS, FunLayer } from '@/components/table/FunLayer'
import { EMPTY_DRINK_STATE } from '@/lib/drinks'
import type { SeatPlayer, TableState } from '@/lib/poker/types'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function table(passedOut: boolean, extraPlayers = 0): TableState {
  const me: SeatPlayer = {
    id: 'me',
    nickname: 'Sam',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    drinkCapable: true,
    drinks: { ...EMPTY_DRINK_STATE, level: passedOut ? 10 : 2, passedOut },
  }
  const others = Array.from({ length: extraPlayers }, (_, index) => ({ ...me, id: `guest-${index}`, nickname: `Guest ${index}`, seatIndex: index + 1, drinks: undefined }))
  return {
    roomCode: '1',
    phase: 'in_hand',
    serverNow: 1,
    round: 'preflop',
    players: [me, ...others],
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: true,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
  }
}

describe('blackout overlay hard timeout', () => {
  const dataset: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    for (const key of Object.keys(dataset)) delete dataset[key]
    vi.stubGlobal('document', {
      documentElement: { dataset, style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    })
    vi.stubGlobal('window', {
      setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
      clearInterval: (id: number) => clearInterval(id),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function render(state: TableState) {
    return (
      <FunLayer
        tableState={state}
        yourId="me"
        privateMushroom={null}
        mushroomEvents={[]}
        onSpike={() => {}}
        soundMuted
      />
    )
  }

  it('drops the black eyelids after one beat even while still passed out, and new players joining do not re-close them', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => {
      renderer = create(render(table(true)))
    })
    expect(dataset.funBlackout).toBe('on')

    act(() => {
      vi.advanceTimersByTime(BLACKOUT_BEAT_MAX_MS + 10)
    })
    expect(dataset.funBlackout).toBeUndefined()

    // Someone sits down mid-blackout: the table state changes, the lids stay open.
    act(() => {
      renderer!.update(render(table(true, 2)))
    })
    expect(dataset.funBlackout).toBeUndefined()

    act(() => renderer!.unmount())
    expect(dataset.funBlackout).toBeUndefined()
  })

  it('clears the flag on unmount mid-beat (leaving the 3D table never strands a black overlay)', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => {
      renderer = create(render(table(true)))
    })
    expect(dataset.funBlackout).toBe('on')
    act(() => renderer!.unmount())
    expect(dataset.funBlackout).toBeUndefined()
  })
})
