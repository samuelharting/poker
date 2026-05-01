import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SocialSnapshot } from '@/shared/protocol'
import type { SeatPlayer, TableState } from '@/lib/poker/types'
import type { ThreeTableViewModel } from '@/components/three/tableViewModel'

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
    />
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

  it('keeps showdown winner UI at the winning seat and removes the host status panel', () => {
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
    state.winners = [{ playerId: 'bot-river', amount: 220 }]

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
    expect(markup).toContain('--winner-announcement-x:50%')
    expect(markup).toContain('--winner-announcement-y:11.5%')
    expect(markup).toContain('Bot River')
    expect(markup).toContain('Won $220')
    expect(markup).not.toContain('status-panel')
    expect(markup).not.toContain('Deal next hand')
  })

  it('keeps folded live hero cards face-down without local show-card controls before a winner', () => {
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
        showCards: 'left',
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
    expect(markup).not.toContain('A of spades')
    expect(markup).toContain('Face-down card')
    expect(markup).not.toContain('table-show-cards-panel')
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
    expect(markup).toContain('A of spades')
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

    const markup = renderWithMedia(
      {
        '(min-width: 1100px)': true,
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
        '(min-width: 1100px)': true,
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
    expect(tableSource).toContain('view={threeTableView}')
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

  it('keeps folded live-hand opponents out of the 3D avatar mount tree', () => {
    const roomSource = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(roomSource).toContain('{!isHero && !player.isOutOfHand && (')
    expect(roomSource).not.toContain('{!isHero && (\r\n          <Avatar')
    expect(roomSource).not.toContain('{!isHero && (\n          <Avatar')
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
        '(min-width: 1100px)': true,
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
        '(min-width: 1100px)': false,
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
        '(min-width: 1100px)': false,
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
        '(min-width: 1100px)': false,
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
      '(min-width: 1100px)': false,
    })
    const mobileMarkup = renderTable(state, {
      '(max-width: 768px)': true,
      '(min-width: 1100px)': false,
    })

    expect(desktopMarkup).toContain('Rabbit hunt')
    expect(mobileMarkup).toContain('Rabbit hunt')
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
