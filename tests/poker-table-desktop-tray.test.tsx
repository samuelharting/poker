import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SocialSnapshot } from '@/shared/protocol'
import type { SeatPlayer, TableState } from '@/lib/poker/types'
import type { ThreeTableViewModel } from '@/components/three/tableViewModel'
import { TWO_D_LAYOUT_QUERY } from '@/lib/layoutMode'

const lastView: { current: ThreeTableViewModel | null } = { current: null }

function DesktopPokerRoom3DMock(props: { view: ThreeTableViewModel }) {
  lastView.current = props.view
  return <div className="desktop-3d-stage" />
}

vi.mock('next/dynamic', () => ({ default: () => DesktopPokerRoom3DMock }))
vi.mock('@/components/three/DesktopPokerRoom3D', () => ({ DesktopPokerRoom3D: DesktopPokerRoom3DMock }))
vi.mock('@/components/table/CommunityCards', () => ({ CommunityCards: () => <div className="community-cards" /> }))
vi.mock('@/components/table/PotDisplay', () => ({
  PotDisplay: ({ totalPot }: { totalPot: number }) => <div className="pot-display" data-total={totalPot} />,
}))

import {
  PokerTable,
  buildActionButtonDescriptors,
  buildRaisePresetBets,
  getPotFractionRaiseTo,
  parseRaiseDraft,
} from '@/components/table/PokerTable'

function seat(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
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
    ...overrides,
  }
}

function tableState(overrides: Partial<TableState>): TableState {
  return {
    roomCode: '123',
    phase: 'in_hand',
    serverNow: 10_000,
    round: 'flop',
    players: [],
    communityCards: [],
    pots: [],
    totalPot: 200,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: 'hero',
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: 9_000,
    actionTimerDuration: 30_000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 3,
    recentActions: [],
    lobbyPlayers: [],
    ...overrides,
  }
}

const noop = () => {}
const DESKTOP = { [TWO_D_LAYOUT_QUERY]: false, '(min-width: 1024px)': true }

function render(state: TableState, isConnected = true): string {
  const socialState: SocialSnapshot = { active: [], chatLog: [] }
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: (DESKTOP as Record<string, boolean>)[query] ?? false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  })
  try {
    return renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={isConnected}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={true}
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
        onCopyRoom={noop}
        onShareRoom={noop}
        onSendEmote={noop}
        onSendTargetEmote={noop}
        onFeedback={noop}
      />
    )
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('pot-fraction raise sizing', () => {
  it('raises to the current bet plus a fraction of the pot after calling', () => {
    // SB facing the big blind: pot 30, bet 20, 10 to call -> pot after call 40.
    expect(getPotFractionRaiseTo({ totalPot: 30, currentBet: 20, toCall: 10, fraction: 1 })).toBe(60)
    expect(getPotFractionRaiseTo({ totalPot: 30, currentBet: 20, toCall: 10, fraction: 0.5 })).toBe(40)
    // Opening bet on the flop: nothing to call.
    expect(getPotFractionRaiseTo({ totalPot: 200, currentBet: 0, toCall: 0, fraction: 0.5 })).toBe(100)
    // Facing a 100 bet into 200 (pot now 300): pot raise is to 100 + 400 = 500.
    expect(getPotFractionRaiseTo({ totalPot: 300, currentBet: 100, toCall: 100, fraction: 1 })).toBe(500)
  })

  it('drops presets equal to Min, illegal sizes and shoves', () => {
    expect(buildRaisePresetBets({ totalPot: 30, currentBet: 20, toCall: 10, effectiveMin: 40, maxRaise: 1000 }))
      .toEqual([{ label: '3/4 Pot', amount: 50 }, { label: 'Pot', amount: 60 }])
    expect(buildRaisePresetBets({ totalPot: 200, currentBet: 0, toCall: 0, effectiveMin: 20, maxRaise: 900 }))
      .toEqual([
        { label: '1/4 Pot', amount: 50 },
        { label: '1/2 Pot', amount: 100 },
        { label: '3/4 Pot', amount: 150 },
        { label: 'Pot', amount: 200 },
      ])
    expect(buildRaisePresetBets({ totalPot: 200, currentBet: 0, toCall: 0, effectiveMin: 20, maxRaise: 120 }))
      .toEqual([{ label: '1/4 Pot', amount: 50 }, { label: '1/2 Pot', amount: 100 }])
  })

  it('reads typed raise text without fighting partial input', () => {
    expect(parseRaiseDraft('150')).toBe(150)
    expect(parseRaiseDraft('$1,250')).toBe(1250)
    expect(parseRaiseDraft('')).toBeNull()
    expect(parseRaiseDraft('-')).toBeNull()
    expect(parseRaiseDraft('1e3')).toBeNull()
  })

  it('labels an opening wager "Bet" and a raise "Raise to"', () => {
    const open = buildActionButtonDescriptors({ legalActions: ['fold', 'check', 'raise'], toCall: 0, raiseAmount: 100, isOpeningBet: true })
    expect(open.find(button => button.key === 'raise')?.label).toBe('Bet')
    const raise = buildActionButtonDescriptors({ legalActions: ['fold', 'call', 'raise'], toCall: 20, raiseAmount: 100 })
    expect(raise.find(button => button.key === 'raise')?.label).toBe('Raise to')
  })
})

describe('desktop action tray', () => {
  const villain = seat({ id: 'villain', nickname: 'Villain', seatIndex: 1, stack: 900, bet: 0 })

  it('opens the flop with Bet, a quiet Fold ("Check is free") and key hints', () => {
    const markup = render(tableState({ players: [seat({ holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }] }), villain] }))
    expect(markup).toContain('aria-label="Bet $20"')
    expect(markup).toContain('is-check-free')
    expect(markup).toContain('Check is free')
    expect(markup).toContain('aria-keyshortcuts="F"')
    expect(markup).toContain('min $20')
  })

  it('hides raise sizing when facing an all-in with only Fold or Call left', () => {
    const shover = seat({ id: 'villain', nickname: 'Villain', seatIndex: 1, stack: 0, bet: 500, status: 'all_in' })
    const markup = render(tableState({ currentBet: 500, minRaise: 1000, totalPot: 700, players: [seat({ stack: 980, bet: 0 }), shover] }))
    expect(markup).toContain('data-action="call"')
    expect(markup).not.toContain('raise-slider-row')
    expect(markup).not.toContain('data-action="raise"')
  })

  it('keeps the tray up with a Reconnecting chip and disabled buttons while offline', () => {
    const markup = render(tableState({ players: [seat({}), villain] }), false)
    expect(markup).toContain('betting-tray is-reconnecting')
    expect(markup).toContain('Reconnecting…')
    expect(markup).toMatch(/data-action="check" disabled=""/)
  })
})

describe('showdown spoilers', () => {
  it('shows pre-payout stacks and no "Won" label until the payout stage', () => {
    const hero = seat({ stack: 960, status: 'active', lastAction: 'Checked', holeCards: [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' }] })
    const winner = seat({ id: 'villain', nickname: 'Villain', seatIndex: 1, stack: 1040, status: 'active', lastAction: 'Won $80' })
    lastView.current = null
    const markup = render(tableState({
      phase: 'between_hands',
      round: 'showdown',
      actingPlayerId: null,
      actionTimerStart: null,
      showdownAt: 10_000,
      serverNow: 10_000,
      totalPot: 80,
      pots: [{ amount: 80, eligiblePlayerIds: ['hero', 'villain'] }],
      winners: [{ playerId: 'villain', amount: 80, handDescription: 'Pair of Aces' }],
      players: [hero, winner],
    }))
    const villainView = lastView.current!.players.find(player => player.id === 'villain')!
    expect(villainView.stack).toBe(960)
    expect(villainView.lastAction).toBeUndefined()
    expect(villainView.statusAction).toBeUndefined()
    expect(villainView.isWinner).toBe(false)
    expect(markup).not.toContain('Won $80')
  })
})

describe('hero hand strength', () => {
  it('never labels a folded hand, even after the hand is over', () => {
    const board = [
      { rank: 'K', suit: 'hearts' },
      { rank: '6', suit: 'clubs' },
      { rank: 'Q', suit: 'hearts' },
    ] as const
    const folded = seat({ status: 'folded', lastAction: 'Folded', holeCards: [{ rank: '2', suit: 'spades' }, { rank: '9', suit: 'hearts' }] })
    const winner = seat({ id: 'villain', nickname: 'Villain', seatIndex: 1, stack: 1020, lastAction: 'Won $40' })
    const markup = render(tableState({
      phase: 'between_hands',
      round: null,
      actingPlayerId: null,
      actionTimerStart: null,
      communityCards: [...board],
      rabbitCards: [{ rank: '3', suit: 'spades' }, { rank: '9', suit: 'spades' }],
      winners: [{ playerId: 'villain', amount: 40 }],
      players: [folded, winner],
    }))
    expect(markup).not.toContain('own-hand-strength')
    expect(markup).toContain('Rabbit hunt — not played')
  })
})

