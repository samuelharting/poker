import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeatPlayer, TableState } from '@/lib/poker/types'
import type { ThreeFallbackState } from '@/components/three/threeFallback'

function DesktopPokerRoom3DMock() {
  return <div className="desktop-3d-stage" />
}

vi.mock('next/dynamic', () => ({ default: () => DesktopPokerRoom3DMock }))
vi.mock('@/components/three/DesktopPokerRoom3D', () => ({ DesktopPokerRoom3D: DesktopPokerRoom3DMock }))

const fallbackState: { current: ThreeFallbackState | null } = { current: null }
vi.mock('@/components/three/threeFallback', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/three/threeFallback')>()),
  useThreeFallback: () => fallbackState.current,
}))

import { PokerTable } from '@/components/table/PokerTable'

const noop = () => {}

function makeState(): TableState {
  const hero: SeatPlayer = {
    id: 'hero',
    nickname: 'Hero',
    stack: 980,
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
  }
  return {
    roomCode: '1',
    phase: 'waiting',
    serverNow: 1,
    round: 'preflop',
    players: [hero, { ...hero, id: 'villain', nickname: 'Villain', seatIndex: 3 }],
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

function renderDesktop(): string {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  })
  return renderToStaticMarkup(
    <PokerTable
      state={makeState()}
      socialState={{ active: [], chatLog: [] }}
      yourId="hero"
      isHost={false}
      isConnected={true}
      startingStackSetting={1000}
      settingsOpen={false}
      suitColorMode="two"
      onAction={noop}
      onStartGame={noop}
      onAddBots={noop}
      autoStartEnabled={true}
      onSetAutoStart={noop}
      onUpdateSettings={noop}
      onRemovePlayer={noop}
      onAdjustPlayerStack={noop}
      onSetPlayerSpectator={noop}
      onSeatMe={noop}
      onSetShowCards={noop}
      onSetSuitColorMode={noop}
      onCloseSettings={noop}
      onSendEmote={noop}
      onSendTargetEmote={noop}
      onFeedback={noop}
    />
  )
}

describe('PokerTable 2D fallback when the 3D room cannot draw', () => {
  afterEach(() => {
    fallbackState.current = null
    vi.unstubAllGlobals()
  })

  it('renders the 3D room on a healthy desktop', () => {
    const markup = renderDesktop()
    expect(markup).toContain('desktop-3d-stage')
    expect(markup).toContain('data-layout="desktop"')
    expect(markup).not.toContain('three-fallback-notice')
  })

  it('drops to the 2D table with a small notice instead of a black screen', () => {
    fallbackState.current = { reason: 'context-lost', at: 1 }
    const markup = renderDesktop()
    expect(markup).not.toContain('desktop-3d-stage')
    expect(markup).toContain('data-layout="2d"')
    expect(markup).toContain('three-fallback-notice')
    expect(markup).toContain('Try 3D again')
  })
})
