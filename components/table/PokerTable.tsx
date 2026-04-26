'use client'

import dynamic from 'next/dynamic'
import React, { type CSSProperties, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { Card, TableState, SeatPlayer, LobbyPlayer, ShowCardsMode } from '@/lib/poker/types'
import type { SocialSnapshot } from '@/shared/protocol'
import { PlayerSeat, formatWinnerPaymentLabel } from './PlayerSeat'
import { CommunityCards } from './CommunityCards'
import { OwnHand } from './OwnHand'
import { PotDisplay } from './PotDisplay'
import { ChipStack } from '@/components/ui/ChipStack'
import { SearchableEmojiPicker } from '@/components/ui/SearchableEmojiPicker'
import { evaluateHand } from '@/lib/poker/evaluator'
import { createThreeTableViewModel, type ThreeTableViewModel } from '@/components/three/tableViewModel'

type FeedbackTone = 'info' | 'success' | 'error'
type PokerAction = 'fold' | 'check' | 'call' | 'raise' | 'all_in'
type WinnerChipTrailStyle = CSSProperties & {
  '--winner-chip-x': string | number
  '--winner-chip-y': string | number
  '--winner-chip-delay': string
}

export interface PokerActionButtonDescriptor {
  key: PokerAction
  label: string
  amountLabel?: string
  className: string
}

interface PokerTableProps {
  state: TableState
  socialState: SocialSnapshot
  yourId: string
  isHost: boolean
  isConnected: boolean
  startingStackSetting: number
  settingsOpen: boolean
  suitColorMode: 'two' | 'four'
  roomCode: string
  canShareRoom: boolean
  onAction: (
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
    amount?: number
  ) => void
  onStartGame: () => void
  onAddBots: (count: number) => void
  autoStartEnabled: boolean
  onSetAutoStart: (enabled: boolean) => void
  onUpdateSettings: (settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onSetShowCards: (mode: ShowCardsMode) => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onCloseSettings: () => void
  onCopyRoom: () => void
  onShareRoom: () => void
  onSendEmote: (emote: string) => void
  onSendTargetEmote: (targetId: string, emote: string) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}

interface SeatLayout {
  cssClass: string
  depthClass: 'seat-depth-near' | 'seat-depth-mid' | 'seat-depth-far' | 'seat-depth-top'
  opacity: number
}

interface OpponentSeat extends SeatPlayer {
  visualSeat: number
}

const SEAT_LAYOUTS: SeatLayout[] = [
  { cssClass: 'seat-0', depthClass: 'seat-depth-near', opacity: 1.0 },
  { cssClass: 'seat-1', depthClass: 'seat-depth-near', opacity: 0.97 },
  { cssClass: 'seat-2', depthClass: 'seat-depth-mid', opacity: 0.94 },
  { cssClass: 'seat-3', depthClass: 'seat-depth-far', opacity: 0.92 },
  { cssClass: 'seat-4', depthClass: 'seat-depth-top', opacity: 0.9 },
  { cssClass: 'seat-5', depthClass: 'seat-depth-far', opacity: 0.92 },
  { cssClass: 'seat-6', depthClass: 'seat-depth-mid', opacity: 0.94 },
  { cssClass: 'seat-7', depthClass: 'seat-depth-near', opacity: 0.97 },
]

const EMOTE_OPTIONS = [
  { id: 'wave', glyph: '\uD83D\uDC4B', label: 'Wave' },
  { id: 'thumbs_up', glyph: '\uD83D\uDC4D', label: 'Thumbs up' },
  { id: 'laugh', glyph: '\uD83D\uDE02', label: 'Laugh' },
  { id: 'middle_finger', glyph: '\uD83D\uDD95', label: 'Middle finger' },
  { id: 'israel_flag', glyph: '\uD83C\uDDEE\uD83C\uDDF1', label: 'Israel flag' },
] as const

type EmoteId = (typeof EMOTE_OPTIONS)[number]['id']

type WinnerDisplay = {
  playerId: string
  nickname: string
  venmoUsername?: string
  amount: number
  targetX: string
  targetY: string
  delayMs: number
}

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
}

const DesktopPokerRoom3D = dynamic<DesktopPokerRoom3DProps>(
  () => import('@/components/three/DesktopPokerRoom3D').then(module => module.DesktopPokerRoom3D),
  { ssr: false }
)

const WINNER_SEAT_TARGETS: Record<number, { x: string; y: string }> = {
  0: { x: '50.5%', y: '88.2%' },
  1: { x: '19.5%', y: '78.5%' },
  2: { x: '11%', y: '53%' },
  3: { x: '18.8%', y: '23.5%' },
  4: { x: '50%', y: '11.5%' },
  5: { x: '81.2%', y: '23.5%' },
  6: { x: '89%', y: '53%' },
  7: { x: '80.5%', y: '78.5%' },
}

const MOBILE_WINNER_SEAT_TARGETS: Record<number, { x: string; y: string }> = {
  0: { x: '50%', y: '85%' },
  1: { x: '19%', y: '76%' },
  2: { x: '12%', y: '57%' },
  3: { x: '20%', y: '29%' },
  4: { x: '50%', y: '11%' },
  5: { x: '80%', y: '29%' },
  6: { x: '88%', y: '57%' },
  7: { x: '81%', y: '76%' },
}

const SHOW_CARD_OPTIONS: Array<{
  mode: Exclude<ShowCardsMode, 'none'>
  label: string
  shortLabel: string
}> = [
  { mode: 'left', label: 'left card', shortLabel: 'L' },
  { mode: 'right', label: 'right card', shortLabel: 'R' },
  { mode: 'both', label: 'both cards', shortLabel: 'Both' },
]

function getEmoteGlyph(emote?: string): string | undefined {
  return EMOTE_OPTIONS.find(option => option.id === emote)?.glyph ?? emote
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

export function buildActionButtonDescriptors({
  legalActions,
  toCall,
  raiseAmount,
  allInAmount,
}: {
  legalActions: PokerAction[]
  toCall: number
  raiseAmount: number
  allInAmount?: number
}): PokerActionButtonDescriptor[] {
  const buttons: PokerActionButtonDescriptor[] = []

  if (legalActions.includes('call')) {
    buttons.push({
      key: 'call',
      label: 'Call',
      amountLabel: formatAmount(toCall),
      className: 'btn-call',
    })
  }

  if (legalActions.includes('check')) {
    buttons.push({
      key: 'check',
      label: 'Check',
      className: 'btn-check',
    })
  }

  if (legalActions.includes('raise')) {
    buttons.push({
      key: 'raise',
      label: 'Raise to',
      amountLabel: formatAmount(raiseAmount),
      className: 'btn-raise',
    })
  }

  if (legalActions.includes('all_in') && typeof allInAmount === 'number') {
    buttons.push({
      key: 'all_in',
      label: 'All-in',
      amountLabel: formatAmount(allInAmount),
      className: 'btn-all-in',
    })
  }

  if (legalActions.includes('fold')) {
    buttons.push({
      key: 'fold',
      label: 'Fold',
      className: 'btn-fold',
    })
  }

  return buttons
}

function formatEquityPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

const RANK_NAMES: Record<Card['rank'], string> = {
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
}

const RANK_ORDER: Record<Card['rank'], number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

function pluralRankName(rank: Card['rank']): string {
  const name = RANK_NAMES[rank]
  return name.endsWith('x') ? `${name}es` : `${name}s`
}

function describePreflopHand(holeCards: Card[]): string | null {
  if (holeCards.length < 2) {
    return null
  }

  const [first, second] = holeCards
  if (first!.rank === second!.rank) {
    return `Pair of ${pluralRankName(first!.rank)}`
  }

  const highCard = [...holeCards].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank])[0]!
  return `${RANK_NAMES[highCard.rank]}-high`
}

export function getVisibleOwnHandDescription(
  holeCards: Card[],
  communityCards: Card[]
): string | null {
  const visibleCards = [...holeCards, ...communityCards]

  if (holeCards.length === 0) {
    return null
  }

  if (visibleCards.length < 5) {
    return describePreflopHand(holeCards)
  }

  return evaluateHand(visibleCards).description
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    setMatches(mediaQuery.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [query])

  return matches
}

function getLobbyStatusLabel(state: TableState, player: LobbyPlayer): string {
  if (player.isSpectator) {
    return state.phase === 'in_hand' && state.players.some(seatedPlayer => seatedPlayer.id === player.id)
      ? 'spectating next hand'
      : 'spectating'
  }

  if (!player.isSeated && state.phase === 'in_hand') {
    return 'waiting for next hand'
  }

  return player.status.replace('_', ' ')
}

function getWaitingStatusText(
  state: TableState,
  lobbyPlayer: LobbyPlayer | undefined,
  isConnected: boolean
): string {
  if (!isConnected) {
    return 'Rejoining your seat and waiting for the table snapshot.'
  }

  if (lobbyPlayer?.isSpectator) {
    return 'You are in spectator mode and watching the table.'
  }

  if (state.players.length < 2) {
    return 'Waiting for at least one more player to sit down.'
  }

  if (state.winners && state.winners.length > 0) {
    return 'Host is setting up the next hand after showdown.'
  }

  return 'Waiting for the host to deal the next hand.'
}

export function PokerTable({
  state,
  socialState,
  yourId,
  isHost,
  isConnected,
  startingStackSetting,
  settingsOpen,
  suitColorMode,
  roomCode,
  canShareRoom,
  onAction,
  onStartGame,
  onAddBots,
  autoStartEnabled,
  onSetAutoStart,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onSetShowCards,
  onSetSuitColorMode,
  onCloseSettings,
  onCopyRoom,
  onShareRoom,
  onSendEmote,
  onSendTargetEmote,
  onFeedback,
}: PokerTableProps) {
  const isMobileViewport = useMediaQuery('(max-width: 768px)')
  const shouldRenderDesktopThree = useMediaQuery('(min-width: 1100px)')
  const threeTableView = useMemo(
    () => shouldRenderDesktopThree ? createThreeTableViewModel(state, yourId) : null,
    [shouldRenderDesktopThree, state, yourId]
  )
  const me = state.players.find(player => player.id === yourId)
  const lobbyMe = state.lobbyPlayers.find(player => player.id === yourId)
  const actingPlayer = state.players.find(player => player.id === state.actingPlayerId)
  const isMyTurn = state.actingPlayerId === yourId
  const isInHand = state.phase === 'in_hand'
  const betweenHands = !isInHand
  const isSpectator = Boolean(lobbyMe?.isSpectator)
  const canAdjustShownCards = Boolean(me?.holeCards?.length) && (betweenHands || me?.status === 'folded')
  const visibleOwnPlayer = (
    !isSpectator &&
    me &&
    me.holeCards &&
    me.holeCards.length > 0 &&
    me.status !== 'folded'
  ) ? me : null
  const shouldShowOwnHand = visibleOwnPlayer !== null
  const ownHandCards = visibleOwnPlayer?.holeCards ?? []
  const ownHandDescription = useMemo(
    () => getVisibleOwnHandDescription(ownHandCards, state.communityCards),
    [ownHandCards, state.communityCards]
  )
  const [socialTick, setSocialTick] = useState(() => Date.now())
  const [targetEmotePlayerId, setTargetEmotePlayerId] = useState<string | null>(null)
  const [targetEmotePickerOpen, setTargetEmotePickerOpen] = useState(false)

  const orderedOpponents = useMemo<OpponentSeat[]>(() => {
    if (isSpectator || !me) {
      return state.players
        .map(player => ({
          ...player,
          visualSeat: player.seatIndex,
        }))
        .sort((a, b) => a.visualSeat - b.visualSeat)
    }

    const mySeat = me.seatIndex
    return state.players
      .map(player => ({
        ...player,
        visualSeat: (player.seatIndex - mySeat + 8) % 8,
      }))
      .sort((a, b) => a.visualSeat - b.visualSeat)
  }, [isSpectator, me, state.players, yourId])

  const occupiedVisualSeats = useMemo(() => {
    const occupied = new Set<number>()

    orderedOpponents.forEach(player => occupied.add(player.visualSeat))

    if (me && !isSpectator) {
      occupied.add(0)
    }

    return occupied
  }, [isSpectator, me, orderedOpponents])

  const emptyVisualSeats = useMemo(() => {
    return SEAT_LAYOUTS
      .map((layout, visualSeat) => ({
        ...layout,
        visualSeat,
      }))
      .filter(layout => !occupiedVisualSeats.has(layout.visualSeat))
  }, [occupiedVisualSeats])

  const toCall = me ? Math.min(state.currentBet - me.bet, me.stack) : 0
  const canCheck = me ? me.bet >= state.currentBet : false

  const legalActions = useMemo(() => {
    if (!isMyTurn || !me || me.status !== 'active' || !isConnected) {
      return []
    }

    const actions: Array<'fold' | 'check' | 'call' | 'raise' | 'all_in'> = ['fold']
    if (canCheck) {
      actions.push('check')
    } else if (toCall > 0) {
      actions.push('call')
    }
    if (me.stack > toCall) {
      actions.push('raise')
    }
    actions.push('all_in')
    return actions
  }, [canCheck, isConnected, isMyTurn, me, toCall])
  const hasActionTray = isInHand && isMyTurn && Boolean(me) && legalActions.length > 0

  const maxRaise = me ? me.stack + me.bet : 0
  const effectiveMin = Math.min(state.minRaise, maxRaise)
  const [raiseAmount, setRaiseAmount] = useState(effectiveMin)

  useEffect(() => {
    if (maxRaise <= 0) {
      return
    }

    setRaiseAmount(current => {
      const nextAmount = Number.isFinite(current) ? current : effectiveMin
      return Math.max(effectiveMin, Math.min(maxRaise, nextAmount))
    })
  }, [effectiveMin, maxRaise])

  const quickBets = useMemo(() => {
    const bets: Array<{ label: string; amount: number }> = []
    if (!me || effectiveMin <= 0 || maxRaise <= 0) {
      return bets
    }

    const presetBets = [
      { label: '1/4 Pot', amount: Math.max(effectiveMin, Math.floor(state.totalPot / 4)) },
      { label: '1/2 Pot', amount: Math.max(effectiveMin, Math.floor(state.totalPot / 2)) },
      { label: '3/4 Pot', amount: Math.max(effectiveMin, Math.floor((state.totalPot * 3) / 4)) },
      { label: 'Pot', amount: Math.max(effectiveMin, state.totalPot) },
    ]

    for (const presetBet of presetBets) {
      const alreadyAdded = bets.some(bet => bet.amount === presetBet.amount)
      if (!alreadyAdded && presetBet.amount <= maxRaise) {
        bets.push(presetBet)
      }
    }

    return bets
  }, [effectiveMin, maxRaise, me, state.totalPot])

  const handleRaise = useCallback(() => {
    if (!isConnected) {
      onFeedback('You are reconnecting. Raise is disabled until the table is live again.', 'error')
      return
    }

    onAction('raise', raiseAmount)
  }, [isConnected, onAction, onFeedback, raiseAmount])

  const turnTimer = useTurnTimer(
    state.actionTimerStart,
    state.actionTimerDuration,
    state.serverNow
  )

  useEffect(() => {
    const activeExpiries = socialState.active.flatMap(entry =>
      [entry.messageExpiresAt, entry.emoteExpiresAt].filter(
        (value): value is number => typeof value === 'number' && value > Date.now()
      )
    )

    if (activeExpiries.length === 0) {
      return
    }

    const nextExpiry = Math.min(...activeExpiries)
    const timeout = window.setTimeout(() => {
      setSocialTick(Date.now())
    }, Math.max(50, nextExpiry - Date.now() + 50))

    return () => window.clearTimeout(timeout)
  }, [socialState])

  const activeSocialByPlayer = useMemo(() => {
    const entries = new Map<string, {
      message?: string
      emote?: string
      messageExpiresAt?: number
      emoteExpiresAt?: number
      emoteTargeted?: boolean
    }>()

    for (const entry of socialState.active) {
      if (entry.message && entry.messageExpiresAt && entry.messageExpiresAt > socialTick) {
        const current = entries.get(entry.playerId) ?? {}
        entries.set(entry.playerId, {
          ...current,
          message: entry.message,
          messageExpiresAt: entry.messageExpiresAt,
        })
      }

      if (entry.emote && entry.emoteExpiresAt && entry.emoteExpiresAt > socialTick) {
        const senderId = entry.playerId
        const targetSeatId = entry.targetPlayerId?.trim() ?? ''
        const emote = getEmoteGlyph(entry.emote)

        const senderCurrent = entries.get(senderId) ?? {}
        entries.set(senderId, {
          ...senderCurrent,
          emote,
          emoteExpiresAt: entry.emoteExpiresAt,
          emoteTargeted: false,
        })

        if (targetSeatId && targetSeatId !== senderId) {
          const targetCurrent = entries.get(targetSeatId) ?? {}
          entries.set(targetSeatId, {
            ...targetCurrent,
            emote,
            emoteExpiresAt: entry.emoteExpiresAt,
            emoteTargeted: true,
          })
        }
      }
    }

    return entries
  }, [socialState.active, socialTick])

  const targetedPlayer = targetEmotePlayerId
    ? state.players.find(player => player.id === targetEmotePlayerId)
    : null
  const winnerAmounts = useMemo(
    () => new Map((state.winners ?? []).map(winner => [winner.playerId, winner.amount])),
    [state.winners]
  )
  const winnerVenmoUsernames = useMemo(
    () => new Map((state.winners ?? []).map(winner => [winner.playerId, winner.venmoUsername])),
    [state.winners]
  )
  const myWinnerAmount = winnerAmounts.get(yourId) ?? 0
  const winnerSeatMap = useMemo(() => new Map(orderedOpponents.map(player => [player.id, player.visualSeat])), [orderedOpponents])
  const winnerSeatTargets = isMobileViewport ? MOBILE_WINNER_SEAT_TARGETS : WINNER_SEAT_TARGETS
  const winnerDisplays = useMemo<WinnerDisplay[]>(() => {
    if (!betweenHands || !state.winners?.length) {
      return []
    }

    const playerById = new Map(state.players.map(player => [player.id, player]))

    return state.winners.reduce<WinnerDisplay[]>((acc, winner, index) => {
        const player = playerById.get(winner.playerId)
        if (!player) {
          return acc
        }

        const visualSeat = winnerSeatMap.get(winner.playerId) ?? player.seatIndex
        const safeVisualSeat = Math.min(7, Math.max(0, visualSeat))
        const target = winnerSeatTargets[safeVisualSeat]

        acc.push({
          playerId: winner.playerId,
          nickname: player.nickname,
          venmoUsername: winner.venmoUsername ?? player.venmoUsername,
          amount: winner.amount,
          targetX: target?.x ?? winnerSeatTargets[0]!.x,
          targetY: target?.y ?? winnerSeatTargets[0]!.y,
          delayMs: index * 180,
        })

        return acc
      }, [])
  }, [betweenHands, state.winners, state.players, winnerSeatMap, winnerSeatTargets])
  const showDesktopWaitingBanner = betweenHands && !isMobileViewport && winnerDisplays.length === 0

  const tableCenterLabel = isHost
    ? 'HOST VIEW'
    : me
      ? me.nickname.toUpperCase()
      : 'TABLE VIEW'
  const mobileHeroStatus = !isConnected
    ? 'Reconnecting'
    : betweenHands
      ? myWinnerAmount > 0
        ? `Won ${formatAmount(myWinnerAmount)}`
        : 'Waiting for next hand'
      : isMyTurn
        ? toCall > 0
          ? `To call ${formatAmount(toCall)}`
          : 'Your turn'
        : actingPlayer
          ? `${actingPlayer.nickname}'s turn`
          : 'In hand'

  const actionButtonDescriptors = useMemo(
    () => buildActionButtonDescriptors({
      legalActions,
      toCall,
      raiseAmount,
      allInAmount: me ? me.stack + me.bet : undefined,
    }),
    [legalActions, me, raiseAmount, toCall]
  )

  const actionButtons = useMemo(() => {
    return actionButtonDescriptors.map(actionButton => {
      const onClick = actionButton.key === 'raise'
        ? handleRaise
        : () => onAction(actionButton.key)

      return {
        ...actionButton,
        onClick,
      }
    })
  }, [actionButtonDescriptors, handleRaise, onAction])

  const tableWaitingCopy = !isConnected
    ? 'Restoring the room snapshot and reconnecting your seat.'
    : state.players.length < 2
      ? 'Share the room code and fill the open seats to kick off the next hand.'
      : isHost
        ? 'The table is ready. Deal whenever everyone looks settled.'
        : 'Everyone is seated. Waiting for the host to deal the next hand.'
  const waitingStatusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const desktopWaitingBannerTitle = !isConnected
    ? 'Reconnecting'
    : state.players.length < 2
      ? 'Waiting for players'
      : isHost
        ? 'Ready for the next hand'
        : 'Waiting on the host'
  const desktopWaitingBannerCopy = isHost ? tableWaitingCopy : waitingStatusText
  const bettingTrayHeader = isMyTurn
    ? toCall > 0
      ? `Your turn - Call ${formatAmount(toCall)}`
      : 'Your turn'
    : toCall > 0
      ? `To call ${formatAmount(toCall)}`
      : 'Action live'
  const turnFocusDetail = isMyTurn
    ? toCall > 0
      ? `Call ${formatAmount(toCall)} to continue`
      : 'Check or raise'
    : actingPlayer
      ? `${turnTimer.secondsLeft}s left`
      : 'Hand live'

  const handleTargetedEmote = useCallback((emote: string) => {
    if (!targetedPlayer) {
      onFeedback('Select a player before sending a targeted emote.', 'error')
      return
    }

    onSendTargetEmote(targetedPlayer.id, emote)
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [onFeedback, onSendTargetEmote, targetedPlayer])

  const closeTargetedEmote = useCallback(() => {
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [])

  return (
    <div
      className="table-scene"
      data-phase={state.phase}
      data-hero-seat={shouldShowOwnHand ? 'true' : 'false'}
      data-player-count={state.players.length}
      data-show-cards={canAdjustShownCards && !settingsOpen ? 'true' : 'false'}
      data-suit-colors={suitColorMode}
      data-tray-open={hasActionTray ? 'true' : 'false'}
    >
      {threeTableView ? <DesktopPokerRoom3D view={threeTableView} /> : null}
      {isInHand && actingPlayer && (
        <div
          className={`turn-focus-banner ${isMyTurn ? 'is-hero-turn' : 'is-opponent-turn'}`}
          role="status"
          aria-live={isMyTurn ? 'assertive' : 'polite'}
        >
          <span className="turn-focus-kicker">
            {isMyTurn ? 'Your turn' : 'Turn'}
          </span>
          <span className="turn-focus-name">
            {isMyTurn ? 'You are up' : `${actingPlayer.nickname} is up`}
          </span>
          <span className="turn-focus-detail">{turnFocusDetail}</span>
        </div>
      )}
      <div className="table-stage">
        <div className="table-wrapper">
          <div className="table-seat-ring">
            {emptyVisualSeats.map(layout => (
              <div
                key={`open-seat-${layout.visualSeat}`}
                className={`seat-position table-seat-placeholder ${layout.cssClass}`}
              >
                <div className="table-seat-placeholder-card">
                  <span className="table-seat-placeholder-kicker">Open seat</span>
                  <span className="table-seat-placeholder-label">
                    {state.phase === 'in_hand' ? 'Wait' : 'Sit'}
                  </span>
                </div>
              </div>
            ))}

            {orderedOpponents.map(player => {
              const layout = SEAT_LAYOUTS[player.visualSeat] ?? SEAT_LAYOUTS[1]
              const seatSocial = activeSocialByPlayer.get(player.id) ?? {}
              return (
                <div
                  key={player.id}
                  className={`seat-position ${layout.cssClass} ${shouldShowOwnHand && !isSpectator && player.id === yourId ? 'hero-seat-position' : ''}`}
                >
                  <PlayerSeat
                    player={player}
                    isActing={state.actingPlayerId === player.id}
                    isWinner={betweenHands && winnerAmounts.has(player.id)}
                    winnerAmount={winnerAmounts.get(player.id)}
                    winnerVenmoUsername={winnerVenmoUsernames.get(player.id) ?? player.venmoUsername}
                    depthClass={layout.depthClass}
                    opacityValue={layout.opacity}
                    socialMessage={seatSocial.message}
                    socialMessageExpiresAt={seatSocial.messageExpiresAt}
                    socialEmote={seatSocial.emote}
                    socialEmoteExpiresAt={seatSocial.emoteExpiresAt}
                    socialEmoteTargeted={seatSocial.emoteTargeted}
                    onNameClick={playerId => {
                      setTargetEmotePlayerId(playerId)
                      setTargetEmotePickerOpen(false)
                    }}
                  />
                </div>
              )
            })}
          </div>

          <div className="table-surface">
            <CommunityCards cards={state.communityCards} />

            <PotDisplay
              totalPot={state.totalPot}
              pots={state.pots}
              currentBet={state.currentBet}
              toCall={isMyTurn ? Math.max(0, toCall) : 0}
            />

            {showDesktopWaitingBanner ? (
              <TableWaitingBanner
                title={desktopWaitingBannerTitle}
                playerCount={state.players.length}
                copy={desktopWaitingBannerCopy}
              />
            ) : (
              <div className="table-surface-center-copy" aria-hidden="true">
                <span className="table-surface-center-owner">{tableCenterLabel}</span>
                <span className="table-surface-center-stakes">
                  NLH - {state.smallBlind} / {state.bigBlind}
                </span>
              </div>
            )}

            {betweenHands && winnerDisplays.length > 0 ? (
              <div className="table-center-winner-announcement" role="status" aria-live="polite">
                <div className="table-center-winner-title">
                  {winnerDisplays.length === 1 ? 'Hand Winner' : 'Hand Winners'}
                </div>

                <div className="table-center-winner-list">
                  {winnerDisplays.map(winner => (
                    <div key={winner.playerId} className="table-center-winner-line">
                      <span className="table-center-winner-name">
                        {formatWinnerPaymentLabel(winner.nickname, winner.venmoUsername)}
                      </span>
                      <span className="table-center-winner-amount">Won {formatAmount(winner.amount)}</span>
                      <ChipStack amount={winner.amount} compact />
                    </div>
                  ))}
                </div>

                <div className="table-center-winner-chip-trails" aria-hidden="true">
                  {winnerDisplays.map(winner => {
                    const trailStyle: WinnerChipTrailStyle = {
                      ['--winner-chip-x']: winner.targetX,
                      ['--winner-chip-y']: winner.targetY,
                      ['--winner-chip-delay']: `${winner.delayMs}ms`,
                    }

                    return (
                      <div
                        key={`${winner.playerId}-trail`}
                        className="table-center-winner-chip-trail"
                        style={trailStyle}
                      >
                        <ChipStack amount={winner.amount} compact showAmount={false} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {shouldShowOwnHand && visibleOwnPlayer && (
            <>
              <OwnHand
                cards={ownHandCards}
                bet={visibleOwnPlayer.bet}
                isActing={isMyTurn}
                isWinner={betweenHands && myWinnerAmount > 0}
                handDescription={ownHandDescription}
              />

              <div
                className={`mobile-hero-summary ${isMyTurn ? 'is-acting' : ''} ${betweenHands && myWinnerAmount > 0 ? 'is-winner' : ''}`}
              >
                <div className="mobile-hero-summary-card">
                  <span className="mobile-hero-summary-name">{visibleOwnPlayer.nickname}</span>
                  <span className="mobile-hero-summary-stack">{formatAmount(visibleOwnPlayer.stack)}</span>
                </div>
                <div className="mobile-hero-summary-status">{mobileHeroStatus}</div>
              </div>
            </>
          )}
        </div>

        {canAdjustShownCards && me && !isSpectator && !settingsOpen && (
          <div className="table-show-cards-panel">
            <ShowCardsControl
              mode={me.showCards}
              isConnected={isConnected}
              onChangeMode={onSetShowCards}
            />
          </div>
        )}

        {me && !isSpectator && (
          <div className="hero-inline-status">
            <span className="table-chip table-chip-soft">{formatAmount(me.stack)}</span>
            {typeof me.equityPercent === 'number' && (
              <span className="table-chip table-chip-soft">
                Eq {formatEquityPercent(me.equityPercent)}
              </span>
            )}
            {betweenHands && myWinnerAmount > 0 && (
              <span className="table-chip winner-chip">
                Won {formatAmount(myWinnerAmount)}
                {me?.venmoUsername ? ` ${me.venmoUsername}` : ''}
              </span>
            )}
            {me.isDealer && <span className="table-chip">Dealer</span>}
            {me.isSB && <span className="table-chip">SB</span>}
            {me.isBB && <span className="table-chip">BB</span>}
            {isMyTurn && <span className="table-chip table-chip-soft">Your action</span>}
            {!isConnected && <span className="table-chip chip-warning">Reconnecting</span>}
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          state={state}
          yourId={yourId}
          isHost={isHost}
          isConnected={isConnected}
          suitColorMode={suitColorMode}
          roomCode={roomCode}
          canShareRoom={canShareRoom}
          onClose={onCloseSettings}
          onSetSuitColorMode={onSetSuitColorMode}
          onUpdateSettings={onUpdateSettings}
          onRemovePlayer={onRemovePlayer}
          onAdjustPlayerStack={onAdjustPlayerStack}
          onSetPlayerSpectator={onSetPlayerSpectator}
          onCopyRoom={onCopyRoom}
          onShareRoom={onShareRoom}
          onFeedback={onFeedback}
        />
      )}

      {betweenHands && !settingsOpen && (
        <MobileBetweenHandsDock
          state={state}
          me={me}
          lobbyMe={lobbyMe}
          isHost={isHost}
          isConnected={isConnected}
          copy={isHost ? tableWaitingCopy : waitingStatusText}
          onStartGame={onStartGame}
          onAddBots={onAddBots}
          onFeedback={onFeedback}
        />
      )}

      {hasActionTray && me && (
        <div className="betting-tray">
          <div className="betting-tray-header">
            <span className="betting-tray-kicker">
              {bettingTrayHeader}
            </span>
            {isMyTurn && (
              <span className="betting-tray-turn">
                Your turn
              </span>
            )}
          </div>

          <div className="timer-bar-shell">
            <div className="timer-bar-header">
              <span>Fold timer</span>
              <span>{turnTimer.secondsLeft}s left</span>
            </div>
            <div className="timer-bar">
              <div
                className={`timer-bar-fill ${turnTimer.percent < 20 ? 'timer-low' : ''}`}
                style={{ width: `${turnTimer.percent}%` }}
              />
            </div>
          </div>

          {legalActions.includes('raise') && effectiveMin > 0 && (
            <div className="raise-slider-row">
              <div className="raise-quick-btns">
                <button
                  type="button"
                  className="btn-quick"
                  onClick={() => setRaiseAmount(effectiveMin)}
                >
                  Min
                </button>
                {quickBets.map(quickBet => (
                  <button
                    key={quickBet.label}
                    type="button"
                    className="btn-quick"
                    onClick={() => setRaiseAmount(quickBet.amount)}
                  >
                    {quickBet.label}
                  </button>
                ))}
              </div>

              <input
                type="range"
                className="raise-slider"
                min={effectiveMin}
                max={maxRaise}
                step={Math.max(state.bigBlind, 1)}
                value={raiseAmount}
                onChange={event => setRaiseAmount(Number(event.target.value))}
              />

              <input
                type="number"
                className="raise-input"
                min={effectiveMin}
                max={maxRaise}
                value={raiseAmount}
                onChange={event => {
                  const nextValue = Number(event.target.value)
                  if (!Number.isFinite(nextValue)) {
                    return
                  }

                  setRaiseAmount(Math.max(effectiveMin, Math.min(maxRaise, nextValue)))
                }}
              />
            </div>
          )}

          <div className="bet-action-row" data-count={actionButtons.length}>
            {actionButtons.map(actionButton => (
              <button
                key={actionButton.key}
                type="button"
                className={`btn-action ${actionButton.className}`}
                data-action={actionButton.key}
                aria-label={
                  actionButton.amountLabel
                    ? `${actionButton.label} ${actionButton.amountLabel}`
                    : actionButton.label
                }
                onClick={actionButton.onClick}
              >
                <span className="btn-action-main">{actionButton.label}</span>
                {actionButton.amountLabel && (
                  <span className="btn-action-sub">{actionButton.amountLabel}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

          {betweenHands && (
            <div className="table-side-panels">
              <WaitingPanel
                state={state}
                me={me}
                lobbyMe={lobbyMe}
                isHost={isHost}
                isConnected={isConnected}
                onStartGame={onStartGame}
                onAddBots={onAddBots}
                onFeedback={onFeedback}
              />

            </div>
          )}

          <div className="table-side-panels chat-dock">
            {targetedPlayer && (
              <TargetedEmotePanel
                target={targetedPlayer}
                isConnected={isConnected}
                onSendEmote={handleTargetedEmote}
                onClose={closeTargetedEmote}
                fullPickerOpen={targetEmotePickerOpen}
                onToggleFullPicker={() => setTargetEmotePickerOpen(current => !current)}
                emotes={EMOTE_OPTIONS}
              />
            )}
          </div>
    </div>
  )
}

function ShowCardsControl({
  mode,
  isConnected,
  onChangeMode,
}: {
  mode: ShowCardsMode
  isConnected: boolean
  onChangeMode: (mode: ShowCardsMode) => void
}) {
  return (
    <div className="show-cards-toggle" role="group" aria-label="Show folded cards">
      {SHOW_CARD_OPTIONS.map(option => {
        const isActive = mode === option.mode

        return (
          <button
            key={option.mode}
            type="button"
            className={`show-cards-toggle-button${isActive ? ' is-active' : ''}`}
            onClick={() => onChangeMode(isActive ? 'none' : option.mode)}
            disabled={!isConnected}
            aria-pressed={isActive}
            title={isActive ? `Hide ${option.label}` : `Show ${option.label}`}
          >
            {option.shortLabel}
          </button>
        )
      })}
    </div>
  )
}

function TargetedEmotePanel({
  target,
  isConnected,
  onSendEmote,
  onClose,
  fullPickerOpen,
  onToggleFullPicker,
  emotes,
}: {
  target: SeatPlayer
  isConnected: boolean
  onSendEmote: (emote: string) => void
  onClose: () => void
  fullPickerOpen: boolean
  onToggleFullPicker: () => void
  emotes: readonly { id: EmoteId; glyph: string; label: string }[]
}) {
  return (
    <aside className="table-panel targeted-emote-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Target emoji</div>
          <div className="table-panel-title">Send to {target.nickname}</div>
        </div>
        <button
          type="button"
          className="targeted-emote-close"
          onClick={onClose}
          aria-label="Close target emote panel"
        >
          x
        </button>
      </div>

      <div className="chat-emotes">
        {emotes.map(item => (
          <button
            key={item.id}
            type="button"
            className="emote-button"
            onClick={() => onSendEmote(item.glyph)}
            disabled={!isConnected}
            title={`Send ${item.label.toLowerCase()} to ${target.nickname}`}
          >
            {item.glyph}
          </button>
        ))}
        <button
          type="button"
          className={`emote-picker-toggle ${fullPickerOpen ? 'is-open' : ''}`}
          disabled={!isConnected}
          onClick={onToggleFullPicker}
        >
          {fullPickerOpen ? 'Hide picker' : 'Search all emojis'}
        </button>
      </div>

      {fullPickerOpen && (
        <SearchableEmojiPicker
          className="targeted-emote-picker"
          isConnected={isConnected}
          searchPlaceholder={`Search emojis for ${target.nickname}`}
          onSelect={emoji => onSendEmote(emoji)}
        />
      )}
    </aside>
  )
}

function useTurnTimer(
  timerStart: number | null,
  duration: number,
  serverNow: number
): { percent: number; secondsLeft: number } {
  const [timer, setTimer] = useState({
    percent: 100,
    secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
  })
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    if (!timerStart) {
      setTimer({
        percent: 100,
        secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
      })
      return
    }

    const deadline = Date.now() + Math.max(0, timerStart + duration - serverNow)

    const tick = () => {
      const remainingMs = Math.max(0, deadline - Date.now())
      const remainingPercent = duration > 0 ? (remainingMs / duration) * 100 : 0

      setTimer({
        percent: remainingPercent,
        secondsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
      })

      if (remainingMs <= 0 && intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    tick()
    intervalRef.current = window.setInterval(tick, 100)

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [duration, serverNow, timerStart])

  return timer
}

function SettingsModal({
  state,
  yourId,
  isHost,
  isConnected,
  suitColorMode,
  roomCode,
  canShareRoom,
  onClose,
  onSetSuitColorMode,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onCopyRoom,
  onShareRoom,
  onFeedback,
}: {
  state: TableState
  yourId: string
  isHost: boolean
  isConnected: boolean
  suitColorMode: 'two' | 'four'
  roomCode: string
  canShareRoom: boolean
  onClose: () => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onUpdateSettings: (settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onCopyRoom: () => void
  onShareRoom: () => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'players'>(isHost ? 'general' : 'general')
  const [showSevenTwoCustomize, setShowSevenTwoCustomize] = useState(false)
  const [chipDrafts, setChipDrafts] = useState<Record<string, number>>({})
  const [draft, setDraft] = useState(() => ({
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    startingStack: state.startingStack,
    actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
    autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
    rabbitHuntingEnabled: state.rabbitHuntingEnabled,
    sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: state.sevenTwoBountyPercent,
  }))

  useEffect(() => {
    setDraft({
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      startingStack: state.startingStack,
      actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
      autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
      rabbitHuntingEnabled: state.rabbitHuntingEnabled,
      sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
      sevenTwoBountyPercent: state.sevenTwoBountyPercent,
    })
  }, [
    state.actionTimerDuration,
    state.autoStartDelay,
    state.bigBlind,
    state.rabbitHuntingEnabled,
    state.sevenTwoBountyPercent,
    state.sevenTwoRuleEnabled,
    state.smallBlind,
    state.startingStack,
  ])

  const hasSettingsChanges =
    draft.smallBlind !== state.smallBlind ||
    draft.bigBlind !== state.bigBlind ||
    draft.startingStack !== state.startingStack ||
    draft.actionTimerSeconds * 1000 !== state.actionTimerDuration ||
    draft.autoStartDelaySeconds * 1000 !== (state.autoStartDelay ?? 5000) ||
    draft.rabbitHuntingEnabled !== state.rabbitHuntingEnabled ||
    draft.sevenTwoRuleEnabled !== state.sevenTwoRuleEnabled ||
    draft.sevenTwoBountyPercent !== state.sevenTwoBountyPercent

  const getPlayerChipDraft = (playerId: string) => {
    const draftValue = chipDrafts[playerId]
    if (typeof draftValue === 'number' && Number.isFinite(draftValue) && draftValue > 0) {
      return draftValue
    }

    return Math.max(state.bigBlind, 100)
  }

  const saveGeneralSettings = () => {
    const smallBlind = Math.max(1, Math.floor(draft.smallBlind))
    const bigBlind = Math.max(smallBlind, Math.floor(draft.bigBlind))
    const startingStack = Math.max(bigBlind * 10, Math.floor(draft.startingStack))
    const actionTimerDuration = Math.min(60000, Math.max(5000, Math.floor(draft.actionTimerSeconds) * 1000))
    const autoStartDelay = Math.min(30000, Math.max(1000, Math.floor(draft.autoStartDelaySeconds) * 1000))
    const sevenTwoBountyPercent = Math.min(100, Math.max(0, Number(draft.sevenTwoBountyPercent)))

    if (!Number.isFinite(smallBlind) || !Number.isFinite(bigBlind) || !Number.isFinite(startingStack)) {
      onFeedback('Enter valid blinds and stack sizes before saving.', 'error')
      return
    }

    onUpdateSettings({
      smallBlind,
      bigBlind,
      startingStack,
      actionTimerDuration,
      autoStartDelay,
      rabbitHuntingEnabled: draft.rabbitHuntingEnabled,
      sevenTwoRuleEnabled: draft.sevenTwoRuleEnabled,
      sevenTwoBountyPercent,
    })
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={event => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div>
            <div className="table-panel-kicker">Table settings</div>
            <div className="table-panel-title">{isHost ? 'Host controls and personal preferences' : 'Personal preferences'}</div>
          </div>
          <button type="button" className="btn-subtle" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-tabs">
          <button
            type="button"
            className={`settings-tab ${activeTab === 'general' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          {isHost && (
            <button
              type="button"
              className={`settings-tab ${activeTab === 'players' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('players')}
            >
              Players
            </button>
          )}
        </div>

        {activeTab === 'general' && (
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Room actions</div>
              <div className="settings-section-copy">
                Keep invites and room sharing tucked in here instead of on the table.
              </div>
              <div className="settings-room-code">Room code: {roomCode}</div>
              <div className="settings-inline-controls">
                <button type="button" className="btn-subtle" onClick={onCopyRoom}>
                  Copy code
                </button>
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={onShareRoom}
                  disabled={!canShareRoom}
                >
                  Share link
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Cards</div>
              <div className="settings-section-copy">
                Suit colors are personal, so every player can choose the card palette they like.
              </div>
              <div className="settings-toggle-row">
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'two' ? 'is-active' : ''}`}
                  onClick={() => onSetSuitColorMode('two')}
                >
                  2-color suits
                </button>
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'four' ? 'is-active' : ''}`}
                  onClick={() => onSetSuitColorMode('four')}
                >
                  4-color suits
                </button>
              </div>
            </div>

            {isHost && (
              <>
                <div className="settings-section">
                  <div className="settings-section-title">Blinds and buy-in</div>
                  <div className="settings-grid settings-grid-modal">
                    <label className="settings-field">
                      <span>Small blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.smallBlind}
                        onChange={event => setDraft(current => ({ ...current, smallBlind: Number(event.target.value) || current.smallBlind }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Big blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.bigBlind}
                        onChange={event => setDraft(current => ({ ...current, bigBlind: Number(event.target.value) || current.bigBlind }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Starting stack</span>
                      <input
                        type="number"
                        min={10}
                        step={10}
                        value={draft.startingStack}
                        onChange={event => setDraft(current => ({ ...current, startingStack: Number(event.target.value) || current.startingStack }))}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Timing</div>
                  <div className="settings-grid settings-grid-modal">
                    <label className="settings-field">
                      <span>Action timer (seconds)</span>
                      <input
                        type="number"
                        min={5}
                        max={60}
                        step={1}
                        value={draft.actionTimerSeconds}
                        onChange={event => setDraft(current => ({ ...current, actionTimerSeconds: Number(event.target.value) || current.actionTimerSeconds }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Next hand delay (seconds)</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        step={1}
                        value={draft.autoStartDelaySeconds}
                        onChange={event => setDraft(current => ({ ...current, autoStartDelaySeconds: Number(event.target.value) || current.autoStartDelaySeconds }))}
                      />
                    </label>
                  </div>
                  <div className="settings-section-copy">
                    If time runs out the acting player auto-checks when possible, otherwise auto-folds. New hands always auto-deal after the delay above.
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Rabbit hunting</div>
                  <div className="settings-toggle-row">
                    <button
                      type="button"
                      className={`settings-pill ${draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, rabbitHuntingEnabled: true }))}
                    >
                      On
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${!draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, rabbitHuntingEnabled: false }))}
                    >
                      Off
                    </button>
                  </div>
                  <div className="settings-section-copy">
                    When active, hands that end before showdown automatically run out the rest of the board for a rabbit-hunt reveal without changing the winner.
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">7 / 2 rule</div>
                  <div className="settings-toggle-row">
                    <button
                      type="button"
                      className={`settings-pill ${draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, sevenTwoRuleEnabled: true }))}
                    >
                      On
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${!draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, sevenTwoRuleEnabled: false }))}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${showSevenTwoCustomize ? 'is-active' : ''}`}
                      onClick={() => setShowSevenTwoCustomize(current => !current)}
                    >
                      Customize
                    </button>
                  </div>
                  {showSevenTwoCustomize && (
                    <div className="settings-grid settings-grid-modal">
                      <label className="settings-field">
                        <span>Bounty % of original buy-in</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={draft.sevenTwoBountyPercent}
                          onChange={event => setDraft(current => ({
                            ...current,
                            sevenTwoBountyPercent: Number(event.target.value) || 0,
                          }))}
                        />
                      </label>
                    </div>
                  )}
                  <div className="settings-section-copy">
                    When active, every other player who was dealt into the hand pays this percent of the table starting stack to any winning 7/2 hand.
                  </div>
                </div>

                <div className="settings-footer">
                  <button
                    type="button"
                    className="btn-subtle"
                    disabled={!hasSettingsChanges || !isConnected}
                    onClick={() => setDraft({
                      smallBlind: state.smallBlind,
                      bigBlind: state.bigBlind,
                      startingStack: state.startingStack,
                      actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
                      autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
                      rabbitHuntingEnabled: state.rabbitHuntingEnabled,
                      sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
                      sevenTwoBountyPercent: state.sevenTwoBountyPercent,
                    })}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn-subtle btn-subtle-gold"
                    disabled={!hasSettingsChanges || !isConnected}
                    onClick={saveGeneralSettings}
                  >
                    Save host settings
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'players' && isHost && (
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Player list</div>
              <div className="settings-section-copy">
                Change chips, kick players, or move them in and out of spectator mode any time. Mid-hand spectator moves fold the player out and seat them in the rail for the next deal.
              </div>
            </div>

            <div className="settings-player-list">
              {state.lobbyPlayers.map(player => {
                const manageAmount = Math.max(state.bigBlind, Math.floor(getPlayerChipDraft(player.id)))

                return (
                <div key={player.id} className="settings-player-row">
                  <div>
                    <div className="host-player-name">
                      {player.id === yourId ? `${player.nickname} (you)` : player.nickname}
                    </div>
                    <div className="host-player-meta">
                      {formatAmount(player.stack)} {'\u00b7'} {getLobbyStatusLabel(state, player)}
                    </div>
                  </div>
                  <div className="settings-player-actions">
                    <label className="settings-field settings-player-chip-input">
                      <span>Chips</span>
                      <input
                        type="number"
                        min={state.bigBlind}
                        step={state.bigBlind}
                        value={getPlayerChipDraft(player.id)}
                        onChange={event => {
                          const nextValue = Number(event.target.value)
                          setChipDrafts(current => ({
                            ...current,
                            [player.id]: Number.isFinite(nextValue) && nextValue > 0
                              ? nextValue
                              : state.bigBlind,
                          }))
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => onAdjustPlayerStack(player.id, manageAmount)}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => onAdjustPlayerStack(player.id, -manageAmount)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => onSetPlayerSpectator(player.id, !player.isSpectator)}
                    >
                      {player.isSpectator ? 'Seat back' : state.phase === 'in_hand' ? 'Spectate now' : 'Spectate'}
                    </button>
                    {player.id !== yourId ? (
                      <button
                        type="button"
                        className="btn-subtle btn-subtle-danger"
                        disabled={!isConnected}
                        onClick={() => onRemovePlayer(player.id)}
                      >
                        {state.phase === 'in_hand' ? 'Kick now' : 'Kick'}
                      </button>
                    ) : (
                      <span className="table-chip">Host</span>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WaitingPanel({
  state,
  me,
  lobbyMe,
  isHost,
  isConnected,
  onStartGame,
  onAddBots,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isHost: boolean
  isConnected: boolean
  onStartGame: () => void
  onAddBots: (count: number) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const statusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const seatedCount = state.players.length
  const canStart = seatedCount >= 2 && isConnected
  const canAddBots = isConnected && seatedCount < 8
  const openSeats = Math.max(0, 8 - seatedCount)

  return (
    <div className="table-panel status-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">{isHost ? 'Host controls' : 'Table status'}</div>
          <div className="table-panel-title">{statusText}</div>
        </div>
        <div className="status-panel-header-pills">
          <span className="table-chip table-chip-soft">{seatedCount} seated</span>
          <span className="table-chip">{openSeats} open</span>
        </div>
      </div>
      <div className="status-panel-stats">
        <span className="table-chip">Blinds {formatAmount(state.smallBlind)}/{formatAmount(state.bigBlind)}</span>
        <span className="table-chip">Buy-in {formatAmount(state.startingStack)}</span>
        {lobbyMe?.isSpectator && <span className="table-chip chip-warning">Spectating</span>}
      </div>
      <div className="table-panel-note">
        {lobbyMe?.isSpectator
          ? 'Open Settings if the host wants to seat you back into the game.'
          : me
          ? `You are seated with ${formatAmount(me.stack)} and blinds are ${formatAmount(state.smallBlind)}/${formatAmount(state.bigBlind)}.`
          : 'Seat assignment is being restored.'}
      </div>
      {isHost && (
        <div className="table-panel-actions status-panel-actions">
          {canAddBots && (
            <>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => onAddBots(1)}
              >
                Add bot
              </button>
              {openSeats > 1 && (
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={() => onAddBots(openSeats)}
                >
                  Fill seats
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="btn-gold"
            disabled={!canStart}
            onClick={() => {
              if (!canStart) {
                onFeedback('You need at least two connected players with chips to deal.', 'error')
                return
              }

              onStartGame()
            }}
          >
            {state.phase === 'between_hands' ? 'Deal next hand' : 'Start game'}
          </button>
        </div>
      )}
    </div>
  )
}

function MobileBetweenHandsDock({
  state,
  me,
  lobbyMe,
  isHost,
  isConnected,
  copy,
  onStartGame,
  onAddBots,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isHost: boolean
  isConnected: boolean
  copy: string
  onStartGame: () => void
  onAddBots: (count: number) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const seatedCount = state.players.length
  const canStart = seatedCount >= 2 && isConnected
  const canAddBots = isConnected && seatedCount < 8
  const openSeats = Math.max(0, 8 - seatedCount)
  const infoChip = lobbyMe?.isSpectator
      ? 'Watching only'
      : me
        ? `Stack ${formatAmount(me.stack)}`
        : 'Restoring seat'

  return (
    <div className="mobile-between-hands-dock">
      <div className="mobile-between-hands-card">
        {isHost ? (
          <>
            {canAddBots && (
              <div className="mobile-between-hands-actions">
                <button
                  type="button"
                  className="mobile-between-hands-btn mobile-between-hands-btn-secondary"
                  onClick={() => onAddBots(1)}
                >
                  Add bot
                </button>
                {openSeats > 1 && (
                  <button
                    type="button"
                    className="mobile-between-hands-btn mobile-between-hands-btn-secondary"
                    onClick={() => onAddBots(openSeats)}
                  >
                    Fill seats
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              className="mobile-between-hands-btn mobile-between-hands-btn-primary"
              disabled={!canStart}
              onClick={() => {
                if (!canStart) {
                  onFeedback('You need at least two connected players with chips to deal.', 'error')
                  return
                }

                onStartGame()
              }}
            >
              {state.phase === 'between_hands' ? 'Deal next hand' : 'Start game'}
            </button>
          </>
        ) : (
          <>
            <div className="mobile-between-hands-copy">
              <div className="mobile-between-hands-kicker">
                {lobbyMe?.isSpectator ? 'Spectator rail' : 'Table status'}
              </div>
              <div className="mobile-between-hands-title">{copy}</div>
              <div className="mobile-between-hands-meta">
                <span>{seatedCount} seated</span>
                <span>{infoChip}</span>
              </div>
            </div>
            <div className="mobile-between-hands-note">
              {lobbyMe?.isSpectator
                ? 'Use the seat drawer when the host wants you back in.'
                : 'The host can deal as soon as the table is ready.'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TableWaitingBanner({
  title,
  playerCount,
  copy,
}: {
  title: string
  playerCount: number
  copy: string
}) {
  return (
    <div className="table-waiting-banner">
      <div className="table-waiting-title">{title}</div>
      <div className="table-waiting-copy">{copy}</div>
      <div className="table-waiting-meta">
        <span>{playerCount} seated</span>
        <span>8 max</span>
      </div>
    </div>
  )
}
