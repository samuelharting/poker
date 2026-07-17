import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SocialSnapshot } from '@/shared/protocol'
import type { SeatPlayer, TableState } from '@/lib/poker/types'
import type { ThreeTableViewModel } from '@/components/three/tableViewModel'
import { getShowdownTiming } from '@/lib/poker/showdown'

function DesktopPokerRoom3DMock(props: {
  view: ThreeTableViewModel
  emoteReactions?: Array<{
    senderId: string
    targetId: string
    emote: string
    targeted: boolean
  }>
  selectedTargetId?: string | null
  onSelectPlayer?: (playerId: string) => void
  cardRevealActions?: Array<{
    playerId: string
    label: string
    ariaLabel: string
    disabled: boolean
  }>
  onRequestCardReveal?: (playerId: string) => void
}) {
  const firstReaction = props.emoteReactions?.[0]

  return (
    <div
      className="desktop-3d-stage"
      data-emote-count={props.emoteReactions?.length ?? 0}
      data-first-emote={firstReaction?.emote ?? ''}
      data-first-sender={firstReaction?.senderId ?? ''}
      data-first-target={firstReaction?.targetId ?? ''}
      data-first-targeted={firstReaction?.targeted ? 'true' : 'false'}
      data-has-select={typeof props.onSelectPlayer === 'function' ? 'true' : 'false'}
      data-selected-target={props.selectedTargetId ?? ''}
    >
      {props.cardRevealActions?.map(action => (
        <button
          key={action.playerId}
          type="button"
          className="card-reveal-seat-button cinematic-card-reveal-control"
          aria-label={action.ariaLabel}
          disabled={action.disabled}
          onClick={() => props.onRequestCardReveal?.(action.playerId)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

vi.mock('next/dynamic', () => ({
  default: () => DesktopPokerRoom3DMock,
}))

vi.mock('@/components/three/DesktopPokerRoom3D', () => ({
  DesktopPokerRoom3D: DesktopPokerRoom3DMock,
}))

vi.mock('@/components/table/CommunityCards', () => ({
  CommunityCards: () => <div className="community-cards" />,
}))

vi.mock('@/components/table/PotDisplay', () => ({
  PotDisplay: () => <div className="pot-display" />,
}))

import { PokerTable } from '@/components/table/PokerTable'

function makeTableState(): TableState {
  return {
    roomCode: '123',
    phase: 'waiting',
    serverNow: 1,
    round: 'preflop',
    players: [],
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

function makeSeatPlayer(overrides: Partial<SeatPlayer>): SeatPlayer {
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

const noop = () => {}

function renderWithMedia(queryMatches: Record<string, boolean>, element: React.ReactElement): string {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: queryMatches[query] ?? false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  })

  try {
    return renderToStaticMarkup(element)
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('PokerTable desktop 3D gate', () => {
  it('does not render the desktop 3D room before a desktop viewport is confirmed', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }

    const markup = renderToStaticMarkup(
      <PokerTable
        state={makeTableState()}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).not.toContain('desktop-3d-stage')
  })

  it('renders the hero bet on the table layer instead of inside the card row', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        bet: 20,
        holeCards: [
          { rank: '4', suit: 'clubs' },
          { rank: '6', suit: 'hearts' },
        ],
      }),
    ]
    state.currentBet = 20
    state.totalPot = 20

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
        onAction={noop}
        onStartGame={noop}
        onAddBots={noop}
        onRabbitHunt={noop}
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

    expect(markup).toContain('hero-table-bet')
    expect(markup).toContain('Your table bet $20')
    expect(markup).not.toContain('own-hand-bet-stack')
  })

  it('shows one unmistakable hand result with the payout and winning hand', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'between_hands'
    state.round = 'showdown'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        seatIndex: 0,
        status: 'waiting',
        stack: 960,
      }),
      makeSeatPlayer({
        id: 'bot-river',
        nickname: 'Bot River',
        seatIndex: 4,
        status: 'waiting',
        stack: 1220,
      }),
    ]
    state.winners = [{
      playerId: 'bot-river',
      amount: 220,
      handDescription: 'Full House, Queens over Tens',
    }]
    state.showdownAt = 1_000
    state.serverNow = state.showdownAt + getShowdownTiming(0).resultAtMs

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={true}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
        onAction={noop}
        onStartGame={noop}
        onAddBots={noop}
        onRabbitHunt={noop}
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

    expect(markup).toContain('table-seat-winner-announcements')
    expect(markup.match(/table-hand-result-summary/g)).toHaveLength(1)
    expect(markup).not.toContain('showdown-table-sequence')
    expect(markup).toContain('Hand winner')
    expect(markup).toContain('Bot River')
    expect(markup).toContain('+$220')
    expect(markup.match(/\+\$220/g)).toHaveLength(1)
    expect(markup).toContain('Full House, Queens over Tens')
    expect(markup).not.toContain('table-center-winner-announcement')
    expect(markup).not.toContain('--winner-announcement-x')
    expect(markup).not.toContain('status-panel')
    expect(markup).not.toContain('Deal next hand')
  })

  it('groups split-pot winners into the same result summary', () => {
    const state = makeTableState()
    state.phase = 'between_hands'
    state.round = 'showdown'
    state.players = [
      makeSeatPlayer({ id: 'hero', nickname: 'Hero', seatIndex: 0, status: 'waiting' }),
      makeSeatPlayer({ id: 'one', nickname: 'Ada', seatIndex: 2, status: 'waiting' }),
      makeSeatPlayer({ id: 'two', nickname: 'Grace', seatIndex: 6, status: 'waiting' }),
    ]
    state.winners = [
      { playerId: 'one', amount: 90, handDescription: 'Straight, Nine-high' },
      { playerId: 'two', amount: 90 },
    ]
    state.showdownAt = 1_000
    state.serverNow = state.showdownAt + getShowdownTiming(0).completeAtMs

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={{ active: [], chatLog: [] }}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup.match(/table-hand-result-summary/g)).toHaveLength(1)
    expect(markup).toContain('Split pot')
    expect(markup).toContain('Ada')
    expect(markup).toContain('Grace')
    expect(markup.match(/\+\$90/g)).toHaveLength(2)
    expect(markup).toContain('Straight, Nine-high')
    expect(markup).not.toContain('undefined')
  })

  it('keeps every dealt hand face-down for a folded viewer while play continues', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'folded',
        lastAction: 'Folded',
        showCards: 'both',
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'clubs' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 1,
        status: 'active',
        showCards: 'both',
        holeCards: [
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
        ],
      }),
    ]
    state.actingPlayerId = 'villain'

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('own-hand-area')
    expect(markup).not.toContain('own-hand-show-cards')
    expect(markup).not.toContain('show-cards-toggle')
    expect(markup).toContain('Ask Villain for permission to see their cards')
    expect(markup).toContain('player-card-reveal-control')
    expect(markup).not.toContain('card-reveal-request-panel')
    expect(markup.match(/Face-down card/g)).toHaveLength(2)
    expect(markup).not.toContain('A of spades')
    expect(markup).not.toContain('7 of clubs')
    expect(markup).not.toContain('K of hearts')
    expect(markup).not.toContain('Q of diamonds')
    expect(markup).not.toContain('table-show-cards-panel')
  })

  it.each([
    ['desktop 3D', { '(min-width: 1024px)': true }],
    ['desktop 2D', { '(min-width: 1024px)': false, '(max-width: 768px)': false }],
    ['mobile 2D', { '(max-width: 768px)': true }],
  ])('keeps the card request control beside the opponent cards after a heads-up fold on %s', (label, media) => {
    const state = makeTableState()
    state.phase = 'between_hands'
    state.winners = [{ playerId: 'villain', amount: 40 }]
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'folded',
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'clubs' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        isBot: true,
        seatIndex: 1,
        status: 'active',
      }),
    ]

    const markup = renderWithMedia(media, (
      <PokerTable
        state={state}
        socialState={{ active: [], chatLog: [] }}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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
        onRequestCardReveal={noop}
        onSetSuitColorMode={noop}
        onCloseSettings={noop}
        onCopyRoom={noop}
        onShareRoom={noop}
        onSendEmote={noop}
        onSendTargetEmote={noop}
        onFeedback={noop}
      />
    ))

    expect(markup).toContain('aria-label="See Villain&#x27;s cards"')
    expect(markup).not.toContain('card-reveal-request-panel')
    expect(markup).toContain(label === 'desktop 3D'
      ? 'cinematic-card-reveal-control'
      : label === 'mobile 2D'
        ? 'mobile-card-reveal-control'
        : 'player-card-reveal-control')
  })

  it('asks the card owner to allow or deny a folded player request', () => {
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'active',
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'clubs' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 1,
        status: 'folded',
      }),
    ]
    state.cardRevealRequests = [{
      requesterId: 'villain',
      targetId: 'hero',
      handNumber: state.handNumber,
      status: 'pending',
    }]

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={{ active: [], chatLog: [] }}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain('Villain wants to see your cards')
    expect(markup).toContain('permission expires after this hand')
    expect(markup).toContain('>Keep hidden</button>')
    expect(markup).toContain('>Allow this hand</button>')
  })

  it('keeps accidental opponent card data concealed from an active viewer', () => {
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'active',
        showCards: 'both',
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'clubs' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 1,
        status: 'active',
        showCards: 'both',
        holeCards: [
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
        ],
      }),
    ]

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={{ active: [], chatLog: [] }}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).not.toContain('K of hearts')
    expect(markup).not.toContain('Q of diamonds')
    expect(markup).toContain('player-card-back player-card-back-left')
    expect(markup).toContain('player-card-back player-card-back-right')
  })

  it('shows local show-card controls after the hand has a winner', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'between_hands'
    state.winners = [{ playerId: 'villain', amount: 120 }]
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'waiting',
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'clubs' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 1,
        status: 'waiting',
      }),
    ]

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('own-hand-show-cards')
    expect(markup).toContain('show-cards-toggle')
    expect(markup).toContain('aria-label="Choose which cards to reveal after this hand"')
    expect(markup).toContain('aria-label="Muck both cards"')
    expect(markup).toContain('Your cards are private')
    expect(markup).toContain('>Left</button>')
    expect(markup).toContain('>Right</button>')
    expect(markup).toContain('>Muck</button>')
    expect(markup.match(/Face-down card/g)).toHaveLength(2)
    expect(markup).not.toContain('A of spades')
  })

  it('uses a separate fixed 2D hero summary in the desktop 3D card view', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero Player',
        stack: 960,
        bet: 20,
        holeCards: [
          { rank: '7', suit: 'clubs' },
          { rank: 'T', suit: 'diamonds' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 4,
        status: 'active',
      }),
    ]
    state.currentBet = 20
    state.totalPot = 40
    state.actingPlayerId = 'villain'

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': true,
        '(max-width: 768px)': false,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('hero-bottom-summary')
    expect(markup).toContain('hero-bottom-summary-name')
    expect(markup).toContain('Hero Player')
    expect(markup).toContain('hero-bottom-summary-stack')
    expect(markup).toContain('$960')
    expect(markup).not.toContain('class="seat-position seat-0 hero-seat-position"')
    expect(markup).toContain('check-fold-pre-action-dock')
    expect(markup).toContain('own-hand-pre-action-button')
    expect(markup).not.toContain('own-hand-pre-action-mark')
  })

  it('does not expose two-hand streak companion eligibility to the desktop 3D stage', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero Player',
        stack: 960,
        bet: 20,
        stats: {
          handsPlayed: 4,
          folds: 0,
          wins: 2,
          totalWon: 360,
          foldRate: 0,
          currentWinStreak: 2,
        } as SeatPlayer['stats'] & { currentWinStreak: number },
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 4,
        status: 'active',
        stack: 1240,
      }),
    ]

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': true,
        '(max-width: 768px)': false,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('data-desktop-three="true"')
    expect(markup).not.toContain('data-companion-count')
    expect(markup).not.toContain('data-companion-player-ids')
    const tableSource = readFileSync(
      join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
      'utf8'
    )
    const roomSource = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )
    const viewModelSource = readFileSync(
      join(process.cwd(), 'components', 'three', 'tableViewModel.ts'),
      'utf8'
    )
    expect(tableSource).toContain('view={presentedThreeTableView ?? threeTableView}')
    expect(roomSource).not.toContain('StreakCompanion')
    expect(viewModelSource).not.toContain('hasCompanion')
  })

  it('passes live social emotes and targeting callbacks into the desktop 3D scene', () => {
    const tableSource = readFileSync(
      join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
      'utf8'
    )

    expect(tableSource).toContain('createThreeEmoteReactions(socialState, playerIds, socialTick, getEmoteGlyph)')
    expect(tableSource).toContain('emoteReactions={threeEmoteReactions}')
    expect(tableSource).toContain('selectedTargetId={targetEmotePlayerId}')
    expect(tableSource).toContain('onSelectPlayer={handleSelectEmoteTarget}')
  })

  it('wires all-in actions to a table-level popup above the 3D stage', () => {
    const tableSource = readFileSync(
      join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
      'utf8'
    )
    const roomSource = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(tableSource).toContain('const latestAllInAnnouncement = threeTableView?.allInAnnouncement ?? null')
    expect(tableSource).toContain('setActiveAllInAnnouncement(latestAllInAnnouncement)')
    expect(tableSource).toContain('<AllInAnnouncement')
    expect(tableSource).toContain('className="all-in-announcement"')
    expect(roomSource).toContain("data-all-in-action-key={view.allInAnnouncement?.actionKey ?? ''}")
  })

  it('marks folded live-hand opponents as folded in the desktop seat layer', () => {
    const roomSource = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(roomSource).toContain("player.isOutOfHand ? 'is-folded' : ''")
    expect(roomSource).toContain("if (player.isOutOfHand) return 'Folded'")
  })

  it('shows clicked card reveals at the player seat after the hand', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'between_hands'
    state.winners = [{ playerId: 'hero', amount: 120 }]
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        status: 'waiting',
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 4,
        status: 'waiting',
        showCards: 'both',
        holeCards: [
          { rank: 'Q', suit: 'clubs' },
          { rank: 'J', suit: 'diamonds' },
        ],
      }),
    ]

    const markup = renderToStaticMarkup(
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('player-held-cards is-revealed')
    expect(markup).toContain('player-card-face player-card-face-left')
    expect(markup).toContain('player-card-face player-card-face-right')
    expect(markup).not.toContain('public-card-reveals')
    expect(markup).not.toContain('Villain shows')
    expect(markup).toContain('Q of clubs')
    expect(markup).toContain('J of diamonds')
  })

  it('passes targeted 3D emotes to desktop observers who are not the sender or target', () => {
    const state = makeTableState()
    state.players = [
      makeSeatPlayer({
        id: 'sender',
        nickname: 'Sender',
        seatIndex: 0,
      }),
      makeSeatPlayer({
        id: 'target',
        nickname: 'Target',
        seatIndex: 3,
      }),
      makeSeatPlayer({
        id: 'observer',
        nickname: 'Observer',
        seatIndex: 5,
      }),
    ]

    const socialState: SocialSnapshot = {
      active: [
        {
          playerId: 'sender',
          emote: 'laugh',
          emoteExpiresAt: Date.now() + 5000,
          targetPlayerId: 'target',
        },
      ],
      chatLog: [],
    }

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': true,
        '(max-width: 768px)': false,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="observer"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('data-desktop-three="true"')
    expect(markup).toContain('player-emote-badge-targeted')
    expect(markup).toContain('Sender')
    expect(markup).toContain('Target')
    const tableSource = readFileSync(
      join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
      'utf8'
    )
    expect(tableSource).toContain('emoteReactions={threeEmoteReactions}')
  })

  it('shows a targeted 3D reaction over the recipient own cards when their avatar is hidden', () => {
    const state = makeTableState()
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero',
        seatIndex: 0,
        holeCards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ],
      }),
      makeSeatPlayer({
        id: 'sender',
        nickname: 'Sender',
        seatIndex: 3,
      }),
    ]

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': true,
        '(max-width: 768px)': false,
      },
      <PokerTable
        state={state}
        socialState={{
          active: [{
            playerId: 'sender',
            emote: '\uD83D\uDE02',
            emoteExpiresAt: Date.now() + 5_000,
            targetPlayerId: 'hero',
          }],
          chatLog: [],
        }}
        yourId="hero"
        isHost={true}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('data-desktop-three="true"')
    expect(markup).toContain('own-hand-social')
    expect(markup).toContain('player-emote-badge-targeted')
  })

  it('uses a tableless mobile field instead of the table surface on phone viewports', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero Player',
        stack: 960,
        bet: 20,
        holeCards: [
          { rank: '7', suit: 'clubs' },
          { rank: 'T', suit: 'diamonds' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 4,
        status: 'active',
        stack: 1240,
      }),
    ]
    state.currentBet = 20
    state.totalPot = 40
    state.actingPlayerId = 'villain'

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': false,
        '(max-width: 768px)': true,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('mobile-poker-field')
    expect(markup).toContain('mobile-board-zone')
    expect(markup).toContain('mobile-edge-seat')
    expect(markup).toContain('mobile-seat-number')
    expect(markup).toContain('You')
    expect(markup).toContain('Villain')
    expect(markup).toContain('community-cards')
    expect(markup).toContain('pot-display')
    expect(markup).not.toContain('table-wrapper')
    expect(markup).not.toContain('table-surface')
    expect(markup).not.toContain('table-surface-center-copy')
    expect(markup).not.toContain('table-seat-placeholder')
    expect(markup).not.toContain('player-action-badge')
    expect(markup).not.toContain('chip-stack')
    expect(markup).toContain('check-fold-pre-action-dock')
    expect(markup).toContain('own-hand-pre-action-button')
    expect(markup).toContain('Queue check if possible, otherwise fold')
    expect(markup).not.toContain('own-hand-pre-action-mark')
  })

  it('renders mobile betting controls as the reference three-button bottom panel', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero Player',
        stack: 960,
        bet: 20,
        holeCards: [
          { rank: '9', suit: 'spades' },
          { rank: '9', suit: 'hearts' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 4,
        status: 'active',
        stack: 1240,
        bet: 40,
      }),
    ]
    state.currentBet = 40
    state.totalPot = 120
    state.minRaise = 80
    state.actingPlayerId = 'hero'

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': false,
        '(max-width: 768px)': true,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('mobile-betting-panel')
    expect(markup).toContain('mobile-bet-row')
    expect(markup).toContain('mobile-bet-quick mobile-bet-quick-left')
    expect(markup).toContain('mobile-bet-amount')
    expect(markup).toContain('mobile-raise-control')
    expect(markup).toContain('mobile-main-actions')
    expect(markup).toContain('FOLD')
    expect(markup).toContain('CHECK / CALL')
    expect(markup).toContain('BET / RAISE')
    expect(markup).toContain('$80')
    expect(markup).not.toContain('betting-tray-header')
  })

  it('keeps mobile opponents out of the hero action lane in heads-up hands', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }
    const state = makeTableState()
    state.phase = 'in_hand'
    state.players = [
      makeSeatPlayer({
        id: 'hero',
        nickname: 'Hero Player',
        stack: 990,
        bet: 10,
        seatIndex: 1,
        holeCards: [
          { rank: 'J', suit: 'clubs' },
          { rank: '9', suit: 'diamonds' },
        ],
      }),
      makeSeatPlayer({
        id: 'villain',
        nickname: 'Villain',
        seatIndex: 0,
        status: 'active',
        stack: 980,
        bet: 20,
      }),
    ]
    state.currentBet = 20
    state.totalPot = 30
    state.actingPlayerId = 'hero'

    const markup = renderWithMedia(
      {
        '(min-width: 1024px)': false,
        '(max-width: 768px)': true,
      },
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={true}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
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

    expect(markup).toContain('mobile-seat-position-4')
    expect(markup).not.toContain('mobile-seat-position-0')
    expect(markup).not.toContain('mobile-seat-position-1')
    expect(markup).not.toContain('mobile-seat-position-7')
  })
})

describe('PokerTable table-management controls', () => {
  function makeFoldEndedState(): TableState {
    const hero = makeSeatPlayer({
      id: 'hero',
      nickname: 'Hero',
      stack: 1010,
      status: 'waiting',
      hasCards: true,
      holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
      seatIndex: 0,
    })
    const villain = makeSeatPlayer({
      id: 'villain',
      nickname: 'Villain',
      stack: 970,
      status: 'folded',
      hasCards: true,
      holeCards: [{ rank: '7', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }],
      seatIndex: 1,
    })

    return {
      ...makeTableState(),
      phase: 'between_hands',
      round: null,
      players: [hero, villain],
      lobbyPlayers: [
        {
          id: hero.id,
          nickname: hero.nickname,
          stack: hero.stack,
          status: 'waiting',
          isConnected: true,
          isSeated: true,
          isSpectator: false,
        },
        {
          id: villain.id,
          nickname: villain.nickname,
          stack: villain.stack,
          status: 'waiting',
          isConnected: true,
          isSeated: true,
          isSpectator: false,
        },
      ],
      winners: [{ playerId: hero.id, amount: 30 }],
      communityCards: [],
      recentActions: ['Hero wins $30'],
    }
  }

  function renderTable(
    state: TableState,
    queryMatches: Record<string, boolean>,
    extraProps: Partial<React.ComponentProps<typeof PokerTable>> = {}
  ) {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }

    return renderWithMedia(queryMatches, (
      <PokerTable
        state={state}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={true}
        onAction={noop}
        onStartGame={noop}
        onAddBots={noop}
        onRabbitHunt={noop}
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
        {...extraProps}
      />
    ))
  }

  it('surfaces a manual rabbit hunt button after fold-ended hands on desktop and mobile', () => {
    const state = makeFoldEndedState()

    const desktopMarkup = renderTable(state, {
      '(max-width: 768px)': false,
      '(min-width: 1024px)': false,
    })
    const mobileMarkup = renderTable(state, {
      '(max-width: 768px)': true,
      '(min-width: 1024px)': false,
    })

    expect(desktopMarkup).toContain('Rabbit hunt')
    expect(mobileMarkup).toContain('Rabbit hunt')
  })

  it('sends the mobile payout chips to the winner compact rendered seat', () => {
    const state = makeFoldEndedState()
    state.players[0] = { ...state.players[0]!, status: 'folded' }
    state.players[1] = { ...state.players[1]!, status: 'waiting' }
    state.winners = [{ playerId: 'villain', amount: 30 }]

    const mobileMarkup = renderTable(state, {
      '(max-width: 768px)': true,
      '(min-width: 1024px)': false,
    })

    expect(mobileMarkup).toContain('mobile-seat-position-4')
    expect(mobileMarkup).toContain('table-center-winner-chip-trails mobile-winner-chip-trails')
    expect(mobileMarkup).toContain('--winner-chip-x:50%;--winner-chip-y:11%')
  })

  it('clears the mobile and desktop 3D winner summaries after a rabbit runout so the board stays visible', () => {
    const state = makeFoldEndedState()
    state.communityCards = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: 'T', suit: 'spades' },
    ]
    state.recentActions = ['Rabbit hunt: flop As Kh Qd | turn Jc | river 10s', ...state.recentActions]

    const desktopThreeMarkup = renderTable(state, {
      '(max-width: 768px)': false,
      '(min-width: 1024px)': true,
    })
    const mobileMarkup = renderTable(state, {
      '(max-width: 768px)': true,
      '(min-width: 1024px)': false,
    })

    expect(desktopThreeMarkup).toContain('data-desktop-three="true"')
    expect(desktopThreeMarkup).not.toContain('table-hand-result-summary')
    expect(desktopThreeMarkup).toContain('class="community-cards"')
    expect(mobileMarkup).not.toContain('mobile-edge-winners')
    expect(mobileMarkup).toContain('class="community-cards"')
  })

  it('uses explicit, mobile-safe labels for player management controls', () => {
    const tableSource = readFileSync(join(process.cwd(), 'components', 'table', 'PokerTable.tsx'), 'utf8')

    expect(tableSource).toContain('Add chips')
    expect(tableSource).toContain('Remove chips')
    expect(tableSource).toContain('Spectate player')
    expect(tableSource).toContain('Kick player')
    expect(tableSource).toContain('Rabbit hunting')
  })
})
