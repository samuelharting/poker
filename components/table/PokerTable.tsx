'use client'

import dynamic from 'next/dynamic'
import React, { type CSSProperties, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { Card, CardRevealRequest, TableState, SeatPlayer, LobbyPlayer, ShowCardsMode, PlayerStats } from '@/lib/poker/types'
import { isAllowedEmote, type SocialSnapshot, type TableChatEntry } from '@/shared/protocol'
import { PlayerSeat, formatWinnerPaymentLabel, getVisibleSeatCards } from './PlayerSeat'
import { CommunityCards } from './CommunityCards'
import { RunItTwiceBoards, RunItTwicePrompt } from './RunItTwice'
import { OwnHand } from './OwnHand'
import { PotDisplay } from './PotDisplay'
import { ShowdownCinematic, useShowdownPresentation } from './ShowdownCinematic'
import { ChipStack } from '@/components/ui/ChipStack'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { SearchableEmojiPicker } from '@/components/ui/SearchableEmojiPicker'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'
import { evaluateHand } from '@/lib/poker/evaluator'
import { getShowdownRevealMode } from '@/lib/poker/showdown'
import type { PokerSoundCueKind } from '@/lib/poker/soundscape'
import {
  AVATAR_CELEBRATION_OPTIONS,
  AVATAR_GLASSES_OPTIONS,
  AVATAR_HAT_OPTIONS,
  AVATAR_IDLE_TELL_OPTIONS,
  AVATAR_JACKET_COLOR_OPTIONS,
  AVATAR_JACKET_OPTIONS,
  AVATAR_MODEL_KEYS,
  DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  type PlayerAvatarCustomization,
} from '@/lib/profile'
import {
  createThreeChatMessages,
  createThreeEmoteReactions,
  createThreeTableViewModel,
  type ThreeChatMessage,
  type ThreeEmoteReaction,
  type ThreeTableViewModel,
} from '@/components/three/tableViewModel'

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
  soundMuted?: boolean
  soundVolume?: number
  avatarCustomization?: PlayerAvatarCustomization
  roomCode: string
  canShareRoom: boolean
  onAction: (
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
    amount?: number
  ) => void
  onStartGame: () => void
  onAddBots: (count: number) => void
  onRabbitHunt?: () => void
  onRunItTwiceVote?: (vote: 'yes' | 'no') => void
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
  onSeatMe: () => void
  onSetShowCards: (mode: ShowCardsMode) => void
  onRequestCardReveal?: (targetId: string) => void
  onRespondCardReveal?: (requesterId: string, allow: boolean) => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onSetSoundMuted?: (muted: boolean) => void
  onSetSoundVolume?: (volume: number) => void
  onUpdateAvatar?: (avatar: PlayerAvatarCustomization) => void
  onSoundCue?: (cue: PokerSoundCueKind) => void
  onCloseSettings: () => void
  onCopyRoom: () => void
  onShareRoom: () => void
  onSendChat?: (message: string) => void
  onSendTargetChat?: (targetId: string, message: string) => void
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

interface MobileEdgeOpponent extends OpponentSeat {
  mobileVisualSeat: number
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

const MOBILE_EDGE_SAFE_SEATS_BY_COUNT: Record<number, number[]> = {
  1: [4],
  2: [3, 5],
  3: [3, 4, 5],
  4: [2, 3, 5, 6],
  5: [2, 3, 4, 5, 6],
  6: [2, 3, 4, 5, 6, 1],
  7: [2, 3, 4, 5, 6, 1, 7],
}

const MOBILE_SEAT_NUMBERS_BY_VISUAL_SEAT: Record<number, number> = {
  0: 5,
  1: 6,
  2: 7,
  3: 8,
  4: 1,
  5: 2,
  6: 3,
  7: 4,
}

function getMobileSeatName(player: OpponentSeat): string {
  return player.isBot ? player.nickname.replace(/^Bot\s+/i, '') : player.nickname
}

const EMOTE_OPTIONS = [
  { id: 'wave', glyph: '\uD83D\uDC4B', label: 'Wave' },
  { id: 'thumbs_up', glyph: '\uD83D\uDC4D', label: 'Thumbs up' },
  { id: 'laugh', glyph: '\uD83D\uDE02', label: 'Laugh' },
  { id: 'cool', glyph: '\uD83D\uDE0E', label: 'Cool' },
  { id: 'skull', glyph: '\uD83D\uDC80', label: 'Skull' },
  { id: 'cry', glyph: '\uD83D\uDE2D', label: 'Cry' },
  { id: 'angry', glyph: '\uD83D\uDE21', label: 'Angry' },
  { id: 'middle_finger', glyph: '\uD83D\uDD95', label: 'Middle finger' },
] as const

const DEFAULT_TARGETED_QUICK_EMOTES = [
  '\uD83D\uDD95',
  '\uD83C\uDDEE\uD83C\uDDF1',
  '\uD83D\uDC12',
] as const
const TARGETED_QUICK_EMOTES_STORAGE_KEY = 'poker-night:targeted-quick-emotes'

export function updateTargetedQuickEmotes(current: readonly string[], emote: string): string[] {
  const next = isAllowedEmote(emote) ? [emote] : []

  for (const candidate of [...current, ...DEFAULT_TARGETED_QUICK_EMOTES]) {
    if (isAllowedEmote(candidate) && !next.includes(candidate)) {
      next.push(candidate)
    }
  }

  return next.slice(0, 3)
}

type WinnerDisplay = {
  playerId: string
  nickname: string
  venmoUsername?: string
  amount: number
  handDescription?: string
  visualSeat: number
  targetX: string
  targetY: string
  delayMs: number
}

type AllInAnnouncementView = NonNullable<ThreeTableViewModel['allInAnnouncement']>

interface CardRevealSeatAction {
  playerId: string
  label: string
  ariaLabel: string
  status?: CardRevealRequest['status']
  disabled: boolean
}

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
  emoteReactions: ThreeEmoteReaction[]
  chatMessages: ThreeChatMessage[]
  selectedTargetId: string | null
  onSelectPlayer: (playerId: string) => void
  cardRevealActions: CardRevealSeatAction[]
  onRequestCardReveal: (playerId: string) => void
}

const DesktopPokerRoom3D = dynamic<DesktopPokerRoom3DProps>(
  () => import('@/components/three/DesktopPokerRoom3D').then(module => module.DesktopPokerRoom3D),
  { ssr: false }
)

const ALL_IN_ANNOUNCEMENT_MS = 2600

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
  mode: ShowCardsMode
  label: string
  shortLabel: string
}> = [
  { mode: 'left', label: 'left card', shortLabel: 'Left' },
  { mode: 'right', label: 'right card', shortLabel: 'Right' },
  { mode: 'both', label: 'both cards', shortLabel: 'Both' },
  { mode: 'none', label: 'both cards', shortLabel: 'Muck' },
]

function getEmoteGlyph(emote?: string): string | undefined {
  return EMOTE_OPTIONS.find(option => option.id === emote)?.glyph ?? emote
}

function getEmoteLabel(emote: string): string {
  return EMOTE_OPTIONS.find(option => option.glyph === emote)?.label ?? 'Emoji'
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

export function formatPlayerStatsSummary(stats?: PlayerStats): Array<{ label: string; value: string }> {
  const handsPlayed = Math.max(0, Math.floor(stats?.handsPlayed ?? 0))
  const wins = Math.max(0, Math.floor(stats?.wins ?? 0))
  const foldRate = typeof stats?.foldRate === 'number'
    ? stats.foldRate
    : handsPlayed > 0
      ? (stats?.folds ?? 0) / handsPlayed
      : 0
  const foldPercent = Math.round(Math.max(0, Math.min(1, foldRate)) * 100)

  return [
    { label: 'Fold', value: `${foldPercent}%` },
    { label: 'Games', value: handsPlayed.toLocaleString() },
    { label: 'Won', value: wins.toLocaleString() },
  ]
}

function HeroTableBet({ amount }: { amount: number }) {
  if (amount <= 0) {
    return null
  }

  const formattedAmount = formatAmount(amount)

  return (
    <div className="hero-table-bet" role="status" aria-label={`Your table bet ${formattedAmount}`}>
      <div className="hero-table-bet-chip-rail" aria-hidden="true">
        <ChipStack amount={amount} compact showAmount={false} />
      </div>
      <span className="hero-table-bet-label">
        <span className="hero-table-bet-kicker">Bet</span>
        <span className="hero-table-bet-value">{formattedAmount}</span>
      </span>
    </div>
  )
}

function MobileBetIndicator({
  amount,
  ownerLabel,
  className,
}: {
  amount: number
  ownerLabel: string
  className: string
}) {
  if (amount <= 0) {
    return null
  }

  const formattedAmount = formatAmount(amount)

  return (
    <div className={className}>
      <div
        className="mobile-bet-indicator"
        role="status"
        aria-label={`${ownerLabel} bet ${formattedAmount}`}
      >
        <span className="mobile-bet-token" aria-hidden="true" />
        <strong>{formattedAmount}</strong>
      </div>
    </div>
  )
}

function AllInAnnouncement({ announcement }: { announcement: AllInAnnouncementView }) {
  const amountCopy = announcement.amountLabel
    ? `${announcement.amountLabel} in the middle`
    : 'Stack in the middle'

  return (
    <div
      className="all-in-announcement"
      data-hero={announcement.isHero ? 'true' : 'false'}
      data-visual-seat={announcement.visualSeat}
      role="status"
      aria-live="assertive"
      aria-label={`${announcement.nickname} is all in`}
    >
      <div className="all-in-chip-burst" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index} className="all-in-chip" />
        ))}
      </div>
      <span className="all-in-kicker">All in</span>
      <strong className="all-in-player">{announcement.nickname}</strong>
      <span className="all-in-amount">{amountCopy}</span>
    </div>
  )
}

function MobileEdgeSeat({
  player,
  visualSeat,
  isActing,
  isWinner = false,
  winnerAmount,
  winnerHandDescription,
  winningCards = [],
  cardRevealControl,
  onNameClick,
}: {
  player: OpponentSeat
  visualSeat: number
  isActing: boolean
  isWinner?: boolean
  winnerAmount?: number
  winnerHandDescription?: string
  winningCards?: Card[]
  cardRevealControl?: React.ReactNode
  onNameClick?: (playerId: string) => void
}) {
  const isFolded = player.status === 'folded'
  const isDisconnected = player.status === 'disconnected' || !player.isConnected
  const isAllIn = player.status === 'all_in'
  const seatNumber = MOBILE_SEAT_NUMBERS_BY_VISUAL_SEAT[visualSeat] ?? visualSeat + 1
  const mobileSeatName = getMobileSeatName(player)
  const targetTitle = `Target ${player.nickname} for emojis`
  const holeCards = player.holeCards ?? []
  const { left: visibleLeftCard, right: visibleRightCard } = getVisibleSeatCards(
    player.showCards,
    holeCards
  )
  const hasVisibleHoleCards = Boolean(visibleLeftCard || visibleRightCard)
  const statusLabel = isWinner && typeof winnerAmount === 'number' && winnerAmount > 0
    ? `Won ${formatAmount(winnerAmount)}`
    : isActing
      ? 'Turn'
      : isFolded
        ? 'Folded'
        : isAllIn
          ? 'All-in'
          : isDisconnected
            ? 'Away'
            : null
  const classes = [
    'mobile-edge-seat',
    `mobile-seat-${visualSeat}`,
    isActing ? 'is-acting' : '',
    isFolded ? 'is-folded' : '',
    isWinner ? 'is-winner' : '',
    hasVisibleHoleCards ? 'has-visible-cards' : '',
    isDisconnected ? 'is-disconnected' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} data-mobile-seat={visualSeat} data-player-status={player.status}>
      {onNameClick ? (
        <button
          type="button"
          className={`mobile-seat-number ${isActing ? 'is-acting' : ''}`}
          onClick={() => onNameClick(player.id)}
          title={targetTitle}
          aria-label={targetTitle}
          data-player-target-trigger="avatar"
        >
          {seatNumber}
        </button>
      ) : (
        <div className={`mobile-seat-number ${isActing ? 'is-acting' : ''}`}>
          {seatNumber}
        </div>
      )}
      {player.hasCards && (
        <div className={`mobile-edge-seat-cards ${hasVisibleHoleCards ? 'is-revealed' : ''}`}>
          {visibleLeftCard ? (
            <PlayingCard
              card={visibleLeftCard}
              size="xs"
              highlighted={isWinner && (
                winningCards.length === 0 || winningCards.some(
                  card => card.rank === visibleLeftCard.rank && card.suit === visibleLeftCard.suit
                )
              )}
            />
          ) : (
            <span className="mobile-edge-card-back" aria-label="Hidden card" />
          )}
          {visibleRightCard ? (
            <PlayingCard
              card={visibleRightCard}
              size="xs"
              highlighted={isWinner && (
                winningCards.length === 0 || winningCards.some(
                  card => card.rank === visibleRightCard.rank && card.suit === visibleRightCard.suit
                )
              )}
            />
          ) : (
            <span className="mobile-edge-card-back" aria-label="Hidden card" />
          )}
        </div>
      )}
      {player.bet > 0 && (
        <MobileBetIndicator
          key={`${player.id}-${player.bet}`}
          amount={player.bet}
          ownerLabel={mobileSeatName}
          className="mobile-edge-bet-anchor"
        />
      )}
      {cardRevealControl && (
        <div className="mobile-card-reveal-control">{cardRevealControl}</div>
      )}

      <div className="mobile-edge-seat-main">
        {onNameClick ? (
          <button
            type="button"
            className="mobile-edge-seat-name"
            onClick={() => onNameClick(player.id)}
            title={targetTitle}
            data-player-target-trigger="username"
          >
            {mobileSeatName}
          </button>
        ) : (
          <div className="mobile-edge-seat-name">{mobileSeatName}</div>
        )}
        <div className="mobile-edge-seat-stack">{formatAmount(player.stack)}</div>
      </div>

      {statusLabel && <div className="mobile-edge-seat-status">{statusLabel}</div>}
      {isWinner && winnerHandDescription && (
        <div className="mobile-edge-winner-hand">{winnerHandDescription}</div>
      )}
    </div>
  )
}

function MobileHeroSeat({
  player,
  isActing,
  isWinner,
  status,
}: {
  player: SeatPlayer
  isActing: boolean
  isWinner: boolean
  status: string
}) {
  return (
    <div className={`mobile-hero-seat ${isActing ? 'is-acting' : ''} ${isWinner ? 'is-winner' : ''}`}>
      <div className={`mobile-seat-number ${isActing ? 'is-acting' : ''}`}>
        {MOBILE_SEAT_NUMBERS_BY_VISUAL_SEAT[0]}
      </div>
      <div className="mobile-hero-seat-cards" aria-hidden="true">
        <span className="mobile-edge-card-back" />
        <span className="mobile-edge-card-back" />
      </div>
      {player.isDealer && <span className="mobile-hero-dealer-badge">D</span>}
      <div className="mobile-hero-seat-name">You</div>
      <div className="mobile-hero-seat-stack">{formatAmount(player.stack)}</div>
      <div className="mobile-hero-seat-status">{status}</div>
    </div>
  )
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

export function resolveCheckFoldPreAction(legalActions: PokerAction[]): 'check' | 'fold' | null {
  if (legalActions.includes('check')) {
    return 'check'
  }

  return legalActions.includes('fold') ? 'fold' : null
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

export function buildPlayerManagementTags(
  player: LobbyPlayer,
  options: { yourId: string }
): string[] {
  const tags: string[] = []
  if (player.id === options.yourId) {
    tags.push('You')
  }
  if (player.isBot) {
    tags.push('Bot')
  }
  if (player.isSpectator) {
    tags.push('Spectator')
  } else if (player.isSeated) {
    tags.push('Seated')
  }
  if (!player.isConnected) {
    tags.push('Away')
  }
  return tags
}

export function getSpectatorRailState(
  lobbyPlayer: LobbyPlayer | undefined,
  isConnected: boolean
): { canTakeSeat: boolean; actionLabel?: string; message: string } | null {
  if (!lobbyPlayer?.isSpectator) {
    return null
  }

  if (lobbyPlayer.stack <= 0) {
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Add chips from the Players tab before you take a seat.',
    }
  }

  if (!isConnected) {
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Reconnect before taking a seat.',
    }
  }

  return {
    canTakeSeat: true,
    actionLabel: 'Take seat',
    message: 'You have chips again and can take the next open seat.',
  }
}

export function canSaveTableSettings({
  isConnected,
  hasSettingsChanges,
}: {
  isConnected: boolean
  hasSettingsChanges: boolean
  phase?: TableState['phase']
}): boolean {
  return isConnected && hasSettingsChanges
}

export function canManualRabbitHunt(state: TableState): boolean {
  return (
    state.phase === 'between_hands' &&
    state.round !== 'showdown' &&
    Boolean(state.winners?.length) &&
    state.communityCards.length < 5
  )
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
    return 'Setting up the next hand after showdown.'
  }

  return 'Waiting for the next hand.'
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
  soundMuted = false,
  soundVolume = 0.65,
  avatarCustomization = DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  roomCode,
  canShareRoom,
  onAction,
  onStartGame,
  onAddBots,
  onRabbitHunt,
  onRunItTwiceVote = () => {},
  autoStartEnabled,
  onSetAutoStart,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onSeatMe,
  onSetShowCards,
  onRequestCardReveal = () => {},
  onRespondCardReveal = () => {},
  onSetSuitColorMode,
  onSetSoundMuted = () => {},
  onSetSoundVolume = () => {},
  onUpdateAvatar = () => {},
  onSoundCue = () => {},
  onCloseSettings,
  onCopyRoom,
  onShareRoom,
  onSendChat = () => {},
  onSendTargetChat = () => {},
  onSendEmote,
  onSendTargetEmote,
  onFeedback,
}: PokerTableProps) {
  const isMobileViewport = useMediaQuery('(max-width: 768px)')
  const shouldRenderDesktopThree = useMediaQuery('(min-width: 1024px)')
  const showdownView = useShowdownPresentation(state)
  const showdownPresentation = showdownView.presentation
  const runItTwiceVote = state.runItTwice?.status === 'voting' ? state.runItTwice : null
  const acceptedRunItTwice = state.runItTwice?.status === 'accepted' ? state.runItTwice : null
  const isSpectatorViewer = Boolean(
    state.lobbyPlayers.find(player => player.id === yourId)?.isSpectator
  )
  const liveCardRevealTargetIds = useMemo(() => new Set(
    (state.cardRevealRequests ?? [])
      .filter(request => request.requesterId === yourId && request.status === 'approved')
      .map(request => request.targetId)
  ), [state.cardRevealRequests, yourId])
  const privacyProtectedPlayers = useMemo(() => {
    if (state.phase !== 'in_hand' || isSpectatorViewer) {
      return state.players
    }

    return state.players.map(player => {
      if (player.id === yourId || liveCardRevealTargetIds.has(player.id)) {
        return player
      }

      return player.holeCards || player.showCards !== 'none'
        ? { ...player, holeCards: undefined, showCards: 'none' as const }
        : player
    })
  }, [isSpectatorViewer, liveCardRevealTargetIds, state.phase, state.players, yourId])
  const showWinnerHighlights = !showdownPresentation.isShowdown || showdownPresentation.winningHandHighlighted
  const showWinnerPayout = !showdownPresentation.isShowdown || showdownPresentation.payoutStarted
  const showWinnerResults = !showdownPresentation.isShowdown || showdownPresentation.resultsVisible
  const showdownPresentedPlayers = useMemo(() => {
    if (!showdownPresentation.isShowdown) {
      return privacyProtectedPlayers
    }

    return privacyProtectedPlayers.map(player => {
      // Keep the local player's already-known hand in place. Every other live
      // hand flips at its existing seat according to the shared timeline.
      if (player.id === yourId) {
        return player
      }

      const revealMode = getShowdownRevealMode(showdownPresentation, player.id)
      return revealMode === null || revealMode === player.showCards
        ? player
        : { ...player, showCards: revealMode }
    })
  }, [privacyProtectedPlayers, showdownPresentation, yourId])
  const showdownPresentedState = useMemo(
    () => showdownPresentedPlayers === state.players
      ? state
      : { ...state, players: showdownPresentedPlayers },
    [showdownPresentedPlayers, state]
  )
  const threeTableView = useMemo(
    () => shouldRenderDesktopThree ? createThreeTableViewModel(showdownPresentedState, yourId) : null,
    [shouldRenderDesktopThree, showdownPresentedState, yourId]
  )
  const presentedThreeTableView = useMemo(() => {
    if (!threeTableView) {
      return threeTableView
    }

    const suppressWinnerEffects = !showWinnerHighlights
    const clearCollectedPot = showdownPresentation.isShowdown && showdownPresentation.payoutStarted

    if (!suppressWinnerEffects && !clearCollectedPot) {
      return threeTableView
    }

    return {
      ...threeTableView,
      collectedPot: clearCollectedPot ? 0 : threeTableView.collectedPot,
      players: suppressWinnerEffects
        ? threeTableView.players.map(player => ({ ...player, isWinner: false }))
        : threeTableView.players,
      hero: suppressWinnerEffects && threeTableView.hero
        ? { ...threeTableView.hero, isWinner: false }
        : threeTableView.hero,
    }
  }, [showWinnerHighlights, showdownPresentation.isShowdown, showdownPresentation.payoutStarted, threeTableView])
  const latestAllInAnnouncement = threeTableView?.allInAnnouncement ?? null
  const latestAllInActionKey = latestAllInAnnouncement?.actionKey ?? ''
  const [activeAllInAnnouncement, setActiveAllInAnnouncement] = useState<AllInAnnouncementView | null>(null)
  const consumedAllInActionKeyRef = useRef<string | null>(latestAllInActionKey || null)
  const me = state.players.find(player => player.id === yourId)
  const lobbyMe = state.lobbyPlayers.find(player => player.id === yourId)
  const actingPlayer = state.players.find(player => player.id === state.actingPlayerId)
  const isMyTurn = state.actingPlayerId === yourId
  const isInHand = state.phase === 'in_hand'
  const betweenHands = !isInHand
  const hasCompletedHandWinner = betweenHands && Boolean(state.winners?.length)
  const isSpectator = isSpectatorViewer
  const isCompletedHandReveal = state.phase === 'between_hands' && Boolean(state.winners?.length)
  const isFoldedViewer = me?.status === 'folded' && (isInHand || isCompletedHandReveal)
  const canShowRevealedCards = isSpectator || hasCompletedHandWinner
  const canAdjustShownCards = Boolean(me?.holeCards?.length) && hasCompletedHandWinner
  const cardRevealRequests = state.cardRevealRequests ?? []
  const pendingIncomingCardRequest = cardRevealRequests.find(request => (
    request.targetId === yourId && request.status === 'pending'
  ))
  const incomingCardRequester = pendingIncomingCardRequest
    ? state.players.find(player => player.id === pendingIncomingCardRequest.requesterId)
    : undefined
  const requestableCardPlayers = isFoldedViewer
      ? state.players.filter(player => (
        player.id !== yourId &&
        player.hasCards &&
        (player.status === 'active' || player.status === 'all_in' || player.status === 'folded')
      ))
    : []
  const cardRevealActions = useMemo<CardRevealSeatAction[]>(() => {
    if (settingsOpen) {
      return []
    }

    return requestableCardPlayers.map(player => createCardRevealSeatAction(
      player,
      cardRevealRequests.find(request => (
        request.requesterId === yourId && request.targetId === player.id
      )),
      isConnected
    ))
  }, [cardRevealRequests, isConnected, requestableCardPlayers, settingsOpen, yourId])
  const cardRevealActionByPlayerId = useMemo(
    () => new Map(cardRevealActions.map(action => [action.playerId, action])),
    [cardRevealActions]
  )
  const visibleOwnPlayer = (
    !isSpectator &&
    me &&
    me.holeCards &&
    me.holeCards.length > 0
  ) ? me : null
  const shouldShowOwnHand = visibleOwnPlayer !== null
  const ownHandCards = visibleOwnPlayer?.holeCards ?? []
  const ownShowCardsMode: ShowCardsMode = canShowRevealedCards ? visibleOwnPlayer?.showCards ?? 'none' : 'none'
  const isOwnHandFolded = isInHand && visibleOwnPlayer?.status === 'folded'
  const heroTableBetAmount = !isSpectator && me ? me.bet : 0
  const showHeroBottomSummary = Boolean(threeTableView && visibleOwnPlayer && !isSpectator)
  const ownHandDescription = useMemo(
    () => isOwnHandFolded ? null : getVisibleOwnHandDescription(ownHandCards, state.communityCards),
    [isOwnHandFolded, ownHandCards, state.communityCards]
  )

  useEffect(() => {
    if (!latestAllInAnnouncement || !latestAllInActionKey) {
      return
    }

    if (consumedAllInActionKeyRef.current === latestAllInActionKey) {
      return
    }

    consumedAllInActionKeyRef.current = latestAllInActionKey
    setActiveAllInAnnouncement(latestAllInAnnouncement)

    const timeout = window.setTimeout(() => {
      setActiveAllInAnnouncement(current => (
        current?.actionKey === latestAllInActionKey ? null : current
      ))
    }, ALL_IN_ANNOUNCEMENT_MS)

    return () => window.clearTimeout(timeout)
  }, [latestAllInActionKey])
  const [socialTick, setSocialTick] = useState(() => Date.now())
  const [targetEmotePlayerId, setTargetEmotePlayerId] = useState<string | null>(null)
  const [targetEmotePickerOpen, setTargetEmotePickerOpen] = useState(false)
  const [targetQuickEmotes, setTargetQuickEmotes] = useState<string[]>(() => (
    [...DEFAULT_TARGETED_QUICK_EMOTES]
  ))
  const targetEmoteTriggerRef = useRef<HTMLElement | null>(null)
  const playerIds = useMemo(() => state.players.map(player => player.id), [state.players])
  const playerIdSet = useMemo(() => new Set(playerIds), [playerIds])
  const threeEmoteReactions = useMemo(
    () => createThreeEmoteReactions(socialState, playerIds, socialTick, getEmoteGlyph),
    [playerIds, socialState, socialTick]
  )
  const threeChatMessages = useMemo(
    () => createThreeChatMessages(socialState, playerIds, socialTick),
    [playerIds, socialState, socialTick]
  )

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TARGETED_QUICK_EMOTES_STORAGE_KEY)
      if (!stored) {
        return
      }

      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        setTargetQuickEmotes(updateTargetedQuickEmotes(
          parsed.filter((value): value is string => typeof value === 'string'),
          ''
        ))
      }
    } catch {
      // Local storage is optional; defaults remain available when it is blocked.
    }
  }, [])

  const orderedOpponents = useMemo<OpponentSeat[]>(() => {
    if (isSpectator || !me) {
      return showdownPresentedPlayers
        .map(player => ({
          ...player,
          showCards: canShowRevealedCards || (
            isFoldedViewer && liveCardRevealTargetIds.has(player.id)
          ) ? player.showCards : 'none',
          visualSeat: player.seatIndex,
        }))
        .sort((a, b) => a.visualSeat - b.visualSeat)
    }

    const mySeat = me.seatIndex
    return showdownPresentedPlayers
      .map(player => ({
        ...player,
        showCards: canShowRevealedCards || (
          isFoldedViewer && liveCardRevealTargetIds.has(player.id)
        ) ? player.showCards : 'none',
        visualSeat: (player.seatIndex - mySeat + 8) % 8,
      }))
      .sort((a, b) => a.visualSeat - b.visualSeat)
  }, [canShowRevealedCards, isFoldedViewer, isSpectator, liveCardRevealTargetIds, me, showdownPresentedPlayers])

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

  const mobileEdgeOpponents = useMemo<MobileEdgeOpponent[]>(() => {
    const visiblePlayers = orderedOpponents.filter(player => !(shouldShowOwnHand && !isSpectator && player.id === yourId))

    if (!shouldShowOwnHand || isSpectator) {
      return visiblePlayers.map(player => ({
        ...player,
        mobileVisualSeat: player.visualSeat,
      }))
    }

    const safeSeats = MOBILE_EDGE_SAFE_SEATS_BY_COUNT[Math.min(visiblePlayers.length, 7)] ?? MOBILE_EDGE_SAFE_SEATS_BY_COUNT[7]

    return visiblePlayers.map((player, index) => ({
      ...player,
      mobileVisualSeat: safeSeats[index] ?? player.visualSeat,
    }))
  }, [isSpectator, orderedOpponents, shouldShowOwnHand, yourId])

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
  const [queuedCheckFoldHand, setQueuedCheckFoldHand] = useState<number | null>(null)
  const isCheckFoldQueued = queuedCheckFoldHand === state.handNumber
  const canQueueCheckFold = Boolean(
    isInHand &&
    state.actingPlayerId &&
    !isMyTurn &&
    me?.status === 'active' &&
    visibleOwnPlayer &&
    isConnected &&
    !settingsOpen
  )
  const showCheckFoldPreAction = canQueueCheckFold && (
    isMobileViewport || Boolean(threeTableView)
  )

  useEffect(() => {
    if (queuedCheckFoldHand === null) {
      return
    }

    const queueIsStillValid =
      queuedCheckFoldHand === state.handNumber &&
      isInHand &&
      me?.status === 'active' &&
      isConnected &&
      !settingsOpen

    if (!queueIsStillValid) {
      setQueuedCheckFoldHand(null)
      return
    }

    if (!isMyTurn) {
      return
    }

    const action = resolveCheckFoldPreAction(legalActions)
    if (!action) {
      return
    }

    setQueuedCheckFoldHand(null)
    onAction(action)
  }, [
    isConnected,
    isInHand,
    isMyTurn,
    legalActions,
    me?.status,
    onAction,
    queuedCheckFoldHand,
    settingsOpen,
    state.handNumber,
  ])

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

  const clampRaiseAmount = useCallback((amount: number) => {
    if (maxRaise <= 0) {
      return 0
    }

    return Math.max(effectiveMin, Math.min(maxRaise, amount))
  }, [effectiveMin, maxRaise])

  const setClampedRaiseAmount = useCallback((amount: number) => {
    setRaiseAmount(clampRaiseAmount(amount))
  }, [clampRaiseAmount])

  const adjustRaiseAmount = useCallback((delta: number) => {
    setRaiseAmount(current => clampRaiseAmount(current + delta))
  }, [clampRaiseAmount])

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
        const messageSeatId = entry.messageTargetPlayerId?.trim() || entry.playerId
        const current = entries.get(messageSeatId) ?? {}
        entries.set(messageSeatId, {
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
  const winnerCardsByPlayer = useMemo(
    () => new Map((state.winners ?? []).map(winner => [winner.playerId, winner.winningCards ?? []])),
    [state.winners]
  )
  const winnerDescriptions = useMemo(
    () => new Map((state.winners ?? []).map(winner => [winner.playerId, winner.handDescription])),
    [state.winners]
  )
  const highlightedWinningCards = useMemo(
    () => showWinnerHighlights
      ? (state.winners ?? []).flatMap(winner => winner.winningCards ?? [])
      : [],
    [showWinnerHighlights, state.winners]
  )
  const myWinnerAmount = winnerAmounts.get(yourId) ?? 0
  const winnerSeatMap = useMemo(() => {
    if (isMobileViewport) {
      return new Map(
        mobileEdgeOpponents.map(player => [player.id, player.mobileVisualSeat])
      )
    }

    return new Map(orderedOpponents.map(player => [player.id, player.visualSeat]))
  }, [isMobileViewport, mobileEdgeOpponents, orderedOpponents])
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
          handDescription: winner.handDescription,
          visualSeat: safeVisualSeat,
          targetX: target?.x ?? winnerSeatTargets[0]!.x,
          targetY: target?.y ?? winnerSeatTargets[0]!.y,
          delayMs: index * 180,
        })

        return acc
      }, [])
  }, [betweenHands, state.winners, state.players, winnerSeatMap, winnerSeatTargets])
  const showDesktopWaitingBanner = betweenHands && !isMobileViewport && winnerDisplays.length === 0
  const showManualRabbitHunt = canManualRabbitHunt(state) && Boolean(onRabbitHunt)
  const hasVisibleRabbitRunout = betweenHands &&
    state.round !== 'showdown' &&
    state.communityCards.length === 5 &&
    state.recentActions[0]?.startsWith('Rabbit hunt:') === true

  const tableCenterLabel = me
      ? me.nickname.toUpperCase()
      : 'TABLE VIEW'
  const mobileHeroStatus = !isConnected
    ? 'Reconnecting'
    : betweenHands
      ? showWinnerResults && myWinnerAmount > 0
        ? `Won ${formatAmount(myWinnerAmount)}`
        : 'Waiting for next hand'
      : isMyTurn
        ? toCall > 0
          ? `To call ${formatAmount(toCall)}`
          : 'Check or raise'
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
  const mobileFoldAction = actionButtons.find(actionButton => actionButton.key === 'fold')
  const mobileCheckCallAction = actionButtons.find(actionButton => actionButton.key === 'call' || actionButton.key === 'check')
  const mobileBetRaiseAction = actionButtons.find(actionButton => actionButton.key === 'raise')
  const mobileAllInAction = actionButtons.find(actionButton => actionButton.key === 'all_in')
  const mobileRaiseStep = Math.max(state.bigBlind, 1)
  const mobileRaiseBlindCount = state.bigBlind > 0
    ? Math.max(1, Math.round(raiseAmount / state.bigBlind))
    : raiseAmount
  const checkFoldPreActionControl = showCheckFoldPreAction ? (
    <button
      type="button"
      className={`own-hand-pre-action-button ${isCheckFoldQueued ? 'is-queued' : ''}`}
      aria-label={isCheckFoldQueued
        ? 'Cancel queued check or fold'
        : 'Queue check if possible, otherwise fold'}
      aria-pressed={isCheckFoldQueued}
      title="Checks if checking is free; otherwise folds when action reaches you."
      onClick={() => setQueuedCheckFoldHand(current => (
        current === state.handNumber ? null : state.handNumber
      ))}
    >
      <span className="own-hand-pre-action-mark" aria-hidden="true">
        {isCheckFoldQueued ? '✓' : ''}
      </span>
      <span className="own-hand-pre-action-copy">
        <small>{isCheckFoldQueued ? 'Queued' : 'Pre-action'}</small>
        <strong>Check / Fold</strong>
      </span>
    </button>
  ) : null

  const tableWaitingCopy = !isConnected
    ? 'Restoring the room snapshot and reconnecting your seat.'
    : state.players.length < 2
      ? 'Share the room code and fill the open seats to kick off the next hand.'
      : 'The table is ready. Deal whenever everyone looks settled.'
  const waitingStatusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const desktopWaitingBannerTitle = !isConnected
    ? 'Reconnecting'
    : state.players.length < 2
      ? 'Waiting for players'
      : 'Ready for the next hand'
  const desktopWaitingBannerCopy = tableWaitingCopy
  const bettingTrayHeader = isMyTurn
    ? toCall > 0
      ? `Call ${formatAmount(toCall)}`
      : 'Check or raise'
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

  const closeTargetedEmote = useCallback(() => {
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)

    const trigger = targetEmoteTriggerRef.current
    targetEmoteTriggerRef.current = null
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true })
    }
  }, [])

  const handleTargetedEmote = useCallback((emote: string) => {
    if (!targetedPlayer) {
      onFeedback('Select a player before sending a targeted emote.', 'error')
      return
    }

    setTargetQuickEmotes(current => {
      const next = updateTargetedQuickEmotes(current, emote)
      try {
        window.localStorage.setItem(TARGETED_QUICK_EMOTES_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Sending a reaction should still work when storage is unavailable.
      }
      return next
    })
    onSendTargetEmote(targetedPlayer.id, emote)
    closeTargetedEmote()
  }, [closeTargetedEmote, onFeedback, onSendTargetEmote, targetedPlayer])

  const handleTargetedMessage = useCallback((message: string) => {
    if (!targetedPlayer) {
      onFeedback('Select a player before sending a message.', 'error')
      return
    }

    onSendTargetChat(targetedPlayer.id, message)
    closeTargetedEmote()
  }, [closeTargetedEmote, onFeedback, onSendTargetChat, targetedPlayer])

  const handleSelectEmoteTarget = useCallback((playerId: string) => {
    if (!playerIdSet.has(playerId)) {
      return
    }

    if (typeof document !== 'undefined' && typeof HTMLElement !== 'undefined') {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        targetEmoteTriggerRef.current = activeElement
      }
    }

    setTargetEmotePlayerId(playerId)
    setTargetEmotePickerOpen(false)
  }, [playerIdSet])

  return (
    <div
      className="table-scene"
      data-phase={state.phase}
      data-hero-seat={shouldShowOwnHand ? 'true' : 'false'}
      data-player-count={state.players.length}
      data-show-cards={canAdjustShownCards && !settingsOpen ? 'true' : 'false'}
      data-suit-colors={suitColorMode}
      data-tray-open={hasActionTray ? 'true' : 'false'}
      data-desktop-three={threeTableView ? 'true' : 'false'}
      data-showdown={showdownPresentation.isShowdown ? 'true' : 'false'}
      data-run-it-twice={state.runItTwice?.status ?? 'none'}
      data-showdown-stage={showdownPresentation.stage}
      data-settings-open={settingsOpen ? 'true' : 'false'}
    >
      {threeTableView ? (
        <DesktopPokerRoom3D
          view={presentedThreeTableView ?? threeTableView}
          emoteReactions={threeEmoteReactions}
          chatMessages={threeChatMessages}
          selectedTargetId={targetEmotePlayerId}
          onSelectPlayer={handleSelectEmoteTarget}
          cardRevealActions={cardRevealActions}
          onRequestCardReveal={onRequestCardReveal}
        />
      ) : null}
      <ShowdownCinematic
        state={state}
        presentation={showdownPresentation}
        onSoundCue={onSoundCue}
      />
      {pendingIncomingCardRequest && incomingCardRequester && !settingsOpen ? (
        <CardRevealConsentPrompt
          requesterName={incomingCardRequester.nickname}
          isConnected={isConnected}
          onRespond={allow => onRespondCardReveal(pendingIncomingCardRequest.requesterId, allow)}
        />
      ) : null}
      {runItTwiceVote && !settingsOpen ? (
        <RunItTwicePrompt
          runItTwice={runItTwiceVote}
          players={state.players}
          yourId={yourId}
          isConnected={isConnected}
          onVote={onRunItTwiceVote}
        />
      ) : null}
      {isInHand && actingPlayer && !threeTableView && !isMobileViewport && (
        <div
          className={`turn-focus-banner ${isMyTurn ? 'is-hero-turn' : 'is-opponent-turn'}`}
          role="status"
          aria-live={isMyTurn ? 'assertive' : 'polite'}
        >
          <span className="turn-focus-kicker">
            {isMyTurn ? 'Action' : 'Turn'}
          </span>
          <span className="turn-focus-name">
            {isMyTurn ? 'You are up' : `${actingPlayer.nickname} is up`}
          </span>
          <span className="turn-focus-detail">{turnFocusDetail}</span>
        </div>
      )}
      <div className="table-stage">
        {isMobileViewport ? (
          <div className="mobile-edge-arena mobile-poker-field" role="region" aria-label="Mobile poker field">
            <div className="mobile-edge-board mobile-board-zone">
              <PotDisplay
                totalPot={state.totalPot}
                pots={state.pots}
                currentBet={state.currentBet}
                toCall={isMyTurn ? Math.max(0, toCall) : 0}
              />
              {acceptedRunItTwice ? (
                <RunItTwiceBoards runItTwice={acceptedRunItTwice} players={state.players} />
              ) : (
                <CommunityCards
                  cards={state.communityCards}
                  highlightedCards={highlightedWinningCards}
                />
              )}
            </div>

            <div className="mobile-edge-seats" aria-label="Players">
              {mobileEdgeOpponents
                .map(player => {
                  const seatSocial = activeSocialByPlayer.get(player.id) ?? {}

                  return (
                    <div
                      key={player.id}
                      className={`mobile-edge-seat-position mobile-seat-position-${player.mobileVisualSeat}`}
                    >
                      <MobileEdgeSeat
                        player={player}
                        visualSeat={player.mobileVisualSeat}
                        isActing={state.actingPlayerId === player.id}
                        isWinner={betweenHands && showWinnerHighlights && winnerAmounts.has(player.id)}
                        winnerAmount={winnerAmounts.get(player.id)}
                        winnerHandDescription={winnerDescriptions.get(player.id)}
                        winningCards={winnerCardsByPlayer.get(player.id)}
                        cardRevealControl={cardRevealActionByPlayerId.has(player.id) ? (
                          <CardRevealSeatButton
                            action={cardRevealActionByPlayerId.get(player.id)!}
                            onRequest={onRequestCardReveal}
                          />
                        ) : null}
                        onNameClick={handleSelectEmoteTarget}
                      />
                      {(seatSocial.message || seatSocial.emote) && (
                        <div className="mobile-edge-social" aria-live="polite">
                          {seatSocial.emote && <EmojiGlyph emoji={seatSocial.emote} />}
                          {seatSocial.message && <span>{seatSocial.message}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>

            {betweenHands && showWinnerPayout && winnerDisplays.length > 0 && (
              <div
                className="table-center-winner-chip-trails mobile-winner-chip-trails"
                aria-hidden="true"
              >
                {winnerDisplays.map(winner => {
                  const trailStyle: WinnerChipTrailStyle = {
                    ['--winner-chip-x']: winner.targetX,
                    ['--winner-chip-y']: winner.targetY,
                    ['--winner-chip-delay']: `${winner.delayMs}ms`,
                  }

                  return (
                    <div
                      key={`${winner.playerId}-mobile-trail`}
                      className="table-center-winner-chip-trail"
                      style={trailStyle}
                    >
                      <ChipStack amount={winner.amount} compact showAmount={false} />
                    </div>
                  )
                })}
              </div>
            )}

            {betweenHands && showWinnerResults && winnerDisplays.length > 0 && !hasVisibleRabbitRunout && !acceptedRunItTwice && (
              <div className="mobile-edge-winners" role="status" aria-live="assertive" aria-atomic="true">
                <div className="mobile-edge-winners-heading">
                  {winnerDisplays.length > 1 ? 'Split pot' : 'Hand winner'}
                </div>
                {winnerDisplays.map(winner => (
                  <div key={winner.playerId} className="mobile-edge-winner-line">
                    <span>
                      <b>{formatWinnerPaymentLabel(winner.nickname, winner.venmoUsername)}</b>
                      {winner.handDescription && <small>{winner.handDescription}</small>}
                    </span>
                    <strong>Won {formatAmount(winner.amount)}</strong>
                  </div>
                ))}
              </div>
            )}

            {shouldShowOwnHand && visibleOwnPlayer && (
              <div className="mobile-hero-lane">
                {visibleOwnPlayer.bet > 0 && (
                  <MobileBetIndicator
                    key={`${visibleOwnPlayer.id}-${visibleOwnPlayer.bet}`}
                    amount={visibleOwnPlayer.bet}
                    ownerLabel="Your"
                    className="mobile-hero-bet-anchor"
                  />
                )}
                <MobileHeroSeat
                  player={visibleOwnPlayer}
                  isActing={isMyTurn}
                  isWinner={betweenHands && showWinnerHighlights && myWinnerAmount > 0}
                  status={mobileHeroStatus}
                />

                <OwnHand
                  cards={ownHandCards}
                  isActing={isMyTurn}
                  isFolded={isOwnHandFolded}
                  isWinner={betweenHands && showWinnerHighlights && myWinnerAmount > 0}
                  winningCards={winnerCardsByPlayer.get(yourId)}
                  handDescription={ownHandDescription}
                  showCardsMode={ownShowCardsMode}
                  revealChoiceActive={canAdjustShownCards}
                  showCardsControl={
                    canAdjustShownCards && me && !isSpectator && !settingsOpen ? (
                      <ShowCardsControl
                        mode={me.showCards}
                        isConnected={isConnected}
                        onChangeMode={onSetShowCards}
                      />
                    ) : null
                  }
                  preActionControl={checkFoldPreActionControl}
                />
              </div>
            )}
          </div>
        ) : (
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
              if (showHeroBottomSummary && player.id === yourId) {
                return null
              }

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
                    isWinner={betweenHands && showWinnerHighlights && winnerAmounts.has(player.id)}
                    winnerAmount={winnerAmounts.get(player.id)}
                    winnerVenmoUsername={winnerVenmoUsernames.get(player.id) ?? player.venmoUsername}
                    winnerHandDescription={winnerDescriptions.get(player.id)}
                    winningCards={winnerCardsByPlayer.get(player.id)}
                    depthClass={layout.depthClass}
                    opacityValue={layout.opacity}
                    socialMessage={seatSocial.message}
                    socialMessageExpiresAt={seatSocial.messageExpiresAt}
                    socialEmote={seatSocial.emote}
                    socialEmoteExpiresAt={seatSocial.emoteExpiresAt}
                    socialEmoteTargeted={seatSocial.emoteTargeted}
                    cardRevealControl={cardRevealActionByPlayerId.has(player.id) ? (
                      <CardRevealSeatButton
                        action={cardRevealActionByPlayerId.get(player.id)!}
                        onRequest={onRequestCardReveal}
                      />
                    ) : null}
                    onNameClick={handleSelectEmoteTarget}
                  />
                </div>
              )
            })}
          </div>

          <div className="table-surface">
            {acceptedRunItTwice ? (
              <RunItTwiceBoards runItTwice={acceptedRunItTwice} players={state.players} />
            ) : (
              <CommunityCards
                cards={state.communityCards}
                highlightedCards={highlightedWinningCards}
              />
            )}

            <PotDisplay
              totalPot={state.totalPot}
              pots={state.pots}
              currentBet={state.currentBet}
              toCall={isMyTurn ? Math.max(0, toCall) : 0}
            />

            <HeroTableBet amount={heroTableBetAmount} />

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

            {betweenHands && winnerDisplays.length > 0 && !acceptedRunItTwice && (showWinnerResults || showWinnerPayout) ? (
              <div className="table-seat-winner-announcements" role="status" aria-live="assertive" aria-atomic="true">
                {showWinnerResults && !hasVisibleRabbitRunout && (
                  <div className="table-hand-result-summary">
                    <span className="table-hand-result-kicker">
                      {winnerDisplays.length > 1 ? 'Split pot' : 'Hand winner'}
                    </span>
                    <div className="table-hand-result-list">
                      {winnerDisplays.map(winner => (
                        <div key={`${winner.playerId}-result`} className="table-hand-result-row">
                          <span className="table-hand-result-player">
                            <strong>{formatWinnerPaymentLabel(winner.nickname, winner.venmoUsername)}</strong>
                            {winner.handDescription && <small>{winner.handDescription}</small>}
                          </span>
                          <b className="table-hand-result-amount">+{formatAmount(winner.amount)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showWinnerPayout && (
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
                )}
              </div>
            ) : null}
          </div>

          {showHeroBottomSummary && visibleOwnPlayer && (
            <div
              className={`hero-bottom-summary ${isMyTurn ? 'is-acting' : ''} ${betweenHands && showWinnerHighlights && myWinnerAmount > 0 ? 'is-winner' : ''}`}
              role="status"
              aria-label={`${visibleOwnPlayer.nickname}, chips ${formatAmount(visibleOwnPlayer.stack)}`}
            >
              <span className="hero-bottom-summary-name">{visibleOwnPlayer.nickname}</span>
              <span className="hero-bottom-summary-stack">{formatAmount(visibleOwnPlayer.stack)}</span>
            </div>
          )}

          {shouldShowOwnHand && visibleOwnPlayer && (
            <>
              <OwnHand
                cards={ownHandCards}
                isActing={isMyTurn}
                isFolded={isOwnHandFolded}
                isWinner={betweenHands && showWinnerHighlights && myWinnerAmount > 0}
                winningCards={winnerCardsByPlayer.get(yourId)}
                handDescription={ownHandDescription}
                showCardsMode={ownShowCardsMode}
                revealChoiceActive={canAdjustShownCards}
                showCardsControl={
                  canAdjustShownCards && me && !isSpectator && !settingsOpen ? (
                    <ShowCardsControl
                      mode={me.showCards}
                      isConnected={isConnected}
                      onChangeMode={onSetShowCards}
                    />
                  ) : null
                }
                preActionControl={checkFoldPreActionControl}
              />

              <div
                className={`mobile-hero-summary ${isMyTurn ? 'is-acting' : ''} ${betweenHands && showWinnerHighlights && myWinnerAmount > 0 ? 'is-winner' : ''}`}
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
        )}

        {!isMobileViewport && me && !isSpectator && (
          <div className="hero-inline-status">
            <span className="table-chip table-chip-soft">{formatAmount(me.stack)}</span>
            {typeof me.equityPercent === 'number' && (
              <span className="table-chip table-chip-soft">
                Eq {formatEquityPercent(me.equityPercent)}
              </span>
            )}
            {betweenHands && showWinnerResults && myWinnerAmount > 0 && (
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

      {activeAllInAnnouncement ? (
        <AllInAnnouncement
          key={activeAllInAnnouncement.actionKey}
          announcement={activeAllInAnnouncement}
        />
      ) : null}

      {showManualRabbitHunt && !settingsOpen && onRabbitHunt && (
        <RabbitHuntDock
          isConnected={isConnected}
          onRabbitHunt={onRabbitHunt}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          state={state}
          yourId={yourId}
          isConnected={isConnected}
          suitColorMode={suitColorMode}
          soundMuted={soundMuted}
          soundVolume={soundVolume}
          avatarCustomization={avatarCustomization}
          roomCode={roomCode}
          canShareRoom={canShareRoom}
          onClose={onCloseSettings}
          onSetSuitColorMode={onSetSuitColorMode}
          onSetSoundMuted={onSetSoundMuted}
          onSetSoundVolume={onSetSoundVolume}
          onUpdateAvatar={onUpdateAvatar}
          onUpdateSettings={onUpdateSettings}
          onRemovePlayer={onRemovePlayer}
          onAdjustPlayerStack={onAdjustPlayerStack}
          onSetPlayerSpectator={onSetPlayerSpectator}
          onCopyRoom={onCopyRoom}
          onShareRoom={onShareRoom}
          onFeedback={onFeedback}
        />
      )}

      {!settingsOpen && (
        <TableSocialDock
          chatLog={socialState.chatLog}
          isConnected={isConnected}
          onSendChat={onSendChat}
          onSendEmote={onSendEmote}
        />
      )}

      {betweenHands && winnerDisplays.length === 0 && !settingsOpen && (
        <MobileBetweenHandsDock
          state={state}
          me={me}
          lobbyMe={lobbyMe}
          isConnected={isConnected}
          copy={tableWaitingCopy}
          onStartGame={onStartGame}
          onAddBots={onAddBots}
          onSeatMe={onSeatMe}
          onFeedback={onFeedback}
        />
      )}

      {hasActionTray && me && (
        isMobileViewport ? (
          <div className="mobile-betting-panel">
            {legalActions.includes('raise') && effectiveMin > 0 && (
              <>
                <div className="mobile-bet-row">
                  <div className="mobile-bet-quick mobile-bet-quick-left">
                    <button type="button" onClick={() => setClampedRaiseAmount(Math.floor(state.totalPot / 4))}>
                      1/4
                    </button>
                    <button type="button" onClick={() => setClampedRaiseAmount(Math.floor(state.totalPot / 2))}>
                      1/2
                    </button>
                  </div>
                  <div className="mobile-bet-amount">{formatAmount(raiseAmount)}</div>
                  <div className="mobile-bet-quick mobile-bet-quick-right">
                    <button type="button" onClick={() => setClampedRaiseAmount(state.totalPot)}>
                      Pot
                    </button>
                    <button type="button" onClick={mobileAllInAction?.onClick} disabled={!mobileAllInAction}>
                      All In
                    </button>
                  </div>
                </div>

                <div className="mobile-raise-control">
                  <button
                    type="button"
                    className="mobile-raise-step"
                    onClick={() => adjustRaiseAmount(-mobileRaiseStep)}
                    aria-label="Decrease bet"
                  >
                    −
                  </button>
                  <div className="mobile-raise-meter">
                    <input
                      type="range"
                      className="raise-slider mobile-raise-slider"
                      min={effectiveMin}
                      max={maxRaise}
                      step={mobileRaiseStep}
                      value={raiseAmount}
                      onChange={event => setClampedRaiseAmount(Number(event.target.value))}
                    />
                    <div className="mobile-raise-bb">{mobileRaiseBlindCount} BB</div>
                  </div>
                  <button
                    type="button"
                    className="mobile-raise-step"
                    onClick={() => adjustRaiseAmount(mobileRaiseStep)}
                    aria-label="Increase bet"
                  >
                    +
                  </button>
                </div>
              </>
            )}

            <div className="mobile-main-actions">
              <button
                type="button"
                className="mobile-main-action mobile-action-fold"
                data-action="fold"
                onClick={mobileFoldAction?.onClick}
                disabled={!mobileFoldAction}
              >
                <span>FOLD</span>
              </button>
              <button
                type="button"
                className="mobile-main-action mobile-action-call"
                data-action={mobileCheckCallAction?.key ?? 'check-call'}
                onClick={mobileCheckCallAction?.onClick}
                disabled={!mobileCheckCallAction}
              >
                <span>CHECK / CALL</span>
                {toCall > 0 && <strong>{formatAmount(toCall)}</strong>}
              </button>
              <button
                type="button"
                className="mobile-main-action mobile-action-raise"
                data-action="raise"
                onClick={mobileBetRaiseAction?.onClick}
                disabled={!mobileBetRaiseAction}
              >
                <span>BET / RAISE</span>
                <strong>{formatAmount(raiseAmount)}</strong>
              </button>
            </div>
          </div>
        ) : (
          <div className="betting-tray">
            <div className="betting-tray-header">
              <span className="betting-tray-kicker">
                {bettingTrayHeader}
              </span>
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
                    onClick={() => setClampedRaiseAmount(effectiveMin)}
                  >
                    Min
                  </button>
                  {quickBets.map(quickBet => (
                    <button
                      key={quickBet.label}
                      type="button"
                      className="btn-quick"
                      onClick={() => setClampedRaiseAmount(quickBet.amount)}
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
                  onChange={event => setClampedRaiseAmount(Number(event.target.value))}
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

                    setClampedRaiseAmount(nextValue)
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
        )
      )}

          {betweenHands && winnerDisplays.length === 0 && (
            <div className="table-side-panels">
              <WaitingPanel
                state={state}
                me={me}
                lobbyMe={lobbyMe}
                isConnected={isConnected}
                onStartGame={onStartGame}
                onAddBots={onAddBots}
                onSeatMe={onSeatMe}
                onFeedback={onFeedback}
              />

            </div>
          )}

          {targetedPlayer && (
            <TargetedEmotePanel
              target={targetedPlayer}
              isConnected={isConnected}
              onSendEmote={handleTargetedEmote}
              onSendMessage={handleTargetedMessage}
              onClose={closeTargetedEmote}
              fullPickerOpen={targetEmotePickerOpen}
              onToggleFullPicker={() => setTargetEmotePickerOpen(current => !current)}
              quickEmotes={targetQuickEmotes}
            />
          )}
    </div>
  )
}

function TableSocialDock({
  chatLog,
  isConnected,
  onSendChat,
  onSendEmote,
}: {
  chatLog: TableChatEntry[]
  isConnected: boolean
  onSendChat: (message: string) => void
  onSendEmote: (emote: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const recentMessages = chatLog.slice(-6)

  const submitMessage = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || !isConnected) {
      return
    }

    onSendChat(trimmed)
    setMessage('')
  }, [isConnected, message, onSendChat])

  return (
    <aside className={`social-dock ${isOpen ? 'is-open' : ''}`} aria-label="Table chat and reactions">
      {isOpen && (
        <div className="social-dock-panel">
          <div className="social-dock-header">
            <div>
              <span className="social-dock-kicker">Table talk</span>
              <strong>Chat &amp; reactions</strong>
            </div>
            <button
              type="button"
              className="social-dock-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close table chat"
            >
              ×
            </button>
          </div>

          <div className="social-dock-messages" aria-live="polite">
            {recentMessages.length > 0 ? recentMessages.map(entry => (
              <div key={entry.id} className="social-dock-message">
                <span>{entry.nickname}</span>
                <p>{entry.message}</p>
              </div>
            )) : (
              <div className="social-dock-empty">No table talk yet. Break the ice.</div>
            )}
          </div>

          <div className="social-dock-reactions" aria-label="Quick reactions">
            {EMOTE_OPTIONS.map(item => (
              <button
                key={item.id}
                type="button"
                disabled={!isConnected}
                onClick={() => onSendEmote(item.glyph)}
                aria-label={`Send ${item.label.toLowerCase()} reaction`}
              >
                <EmojiGlyph emoji={item.glyph} />
              </button>
            ))}
          </div>

          <div className="social-dock-compose">
            <input
              type="text"
              value={message}
              maxLength={160}
              placeholder="Message the table"
              disabled={!isConnected}
              onChange={event => setMessage(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitMessage()
                }
              }}
              aria-label="Table message"
            />
            <button
              type="button"
              disabled={!isConnected || !message.trim()}
              onClick={submitMessage}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="social-dock-toggle"
        onClick={() => setIsOpen(current => !current)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close table chat' : 'Open table chat and reactions'}
      >
        <span aria-hidden="true">♣</span>
        <strong>Table talk</strong>
        {chatLog.length > 0 && <em>{Math.min(chatLog.length, 99)}</em>}
      </button>
    </aside>
  )
}

function CardRevealConsentPrompt({
  requesterName,
  isConnected,
  onRespond,
}: {
  requesterName: string
  isConnected: boolean
  onRespond: (allow: boolean) => void
}) {
  return (
    <aside
      className="card-reveal-consent"
      role="alertdialog"
      aria-labelledby="card-reveal-consent-title"
      aria-describedby="card-reveal-consent-description"
    >
      <span className="card-reveal-consent-kicker">Card request</span>
      <strong id="card-reveal-consent-title">{requesterName} wants to see your cards</strong>
      <p id="card-reveal-consent-description">
        Only {requesterName} will see them, and permission expires after this hand.
      </p>
      <div className="card-reveal-consent-actions">
        <button
          type="button"
          className="card-reveal-deny"
          disabled={!isConnected}
          onClick={() => onRespond(false)}
        >
          Keep hidden
        </button>
        <button
          type="button"
          className="card-reveal-allow"
          disabled={!isConnected}
          onClick={() => onRespond(true)}
        >
          Allow this hand
        </button>
      </div>
    </aside>
  )
}

function createCardRevealSeatAction(
  player: SeatPlayer,
  request: CardRevealRequest | undefined,
  isConnected: boolean
): CardRevealSeatAction {
  const label = request?.status === 'pending'
    ? 'Waiting'
    : request?.status === 'approved'
      ? 'Shown'
      : request?.status === 'denied'
        ? 'Hidden'
        : player.isBot ? 'See' : 'Ask'

  return {
    playerId: player.id,
    label,
    ariaLabel: request
      ? `${player.nickname}: ${label}`
      : player.isBot
        ? `See ${player.nickname}'s cards`
        : `Ask ${player.nickname} for permission to see their cards`,
    status: request?.status,
    disabled: !isConnected || Boolean(request),
  }
}

function CardRevealSeatButton({
  action,
  onRequest,
}: {
  action: CardRevealSeatAction
  onRequest: (targetId: string) => void
}) {
  return (
    <button
      type="button"
      className={`card-reveal-seat-button${action.status ? ` is-${action.status}` : ''}`}
      disabled={action.disabled}
      onClick={() => onRequest(action.playerId)}
      aria-label={action.ariaLabel}
      title={action.ariaLabel}
    >
      {action.label}
    </button>
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
    <div
      className="show-cards-toggle"
      role="group"
      aria-label="Choose which cards to reveal after this hand"
    >
      <span className="show-cards-toggle-label">
        {mode === 'none' ? 'Your cards are private' : 'Visible to the table'}
      </span>
      {SHOW_CARD_OPTIONS.map(option => {
        const isActive = mode === option.mode
        const buttonLabel = option.mode === 'none'
          ? 'Muck both cards'
          : isActive
            ? `Stop showing ${option.label}`
            : `Show ${option.label}`

        return (
          <button
            key={option.mode}
            type="button"
            className={`show-cards-toggle-button${isActive ? ' is-active' : ''}`}
            onClick={() => onChangeMode(isActive ? 'none' : option.mode)}
            disabled={!isConnected}
            aria-pressed={isActive}
            aria-label={buttonLabel}
            title={buttonLabel}
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
  onSendMessage,
  onClose,
  fullPickerOpen,
  onToggleFullPicker,
  quickEmotes,
}: {
  target: SeatPlayer
  isConnected: boolean
  onSendEmote: (emote: string) => void
  onSendMessage: (message: string) => void
  onClose: () => void
  fullPickerOpen: boolean
  onToggleFullPicker: () => void
  quickEmotes: readonly string[]
}) {
  const statSummary = formatPlayerStatsSummary(target.stats)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [message, setMessage] = useState('')

  const submitMessage = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || !isConnected) {
      return
    }

    onSendMessage(trimmed)
    setMessage('')
  }, [isConnected, message, onSendMessage])

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })
  }, [target.id])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <aside
      className={`table-panel targeted-emote-panel ${fullPickerOpen ? 'is-picker-open' : ''}`}
      data-picker-open={fullPickerOpen ? 'true' : 'false'}
      role="dialog"
      aria-label={`Message or react to ${target.nickname}`}
    >
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Opponent</div>
          <div className="table-panel-title">Send to {target.nickname}</div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="targeted-emote-close"
          onClick={onClose}
          aria-label="Close target emote panel"
        >
          x
        </button>
      </div>

      {!fullPickerOpen && (
        <>
          <div className="targeted-player-stats" aria-label={`${target.nickname} stats`}>
            {statSummary.map(stat => (
              <div key={stat.label} className="targeted-player-stat">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>

          <div className="targeted-message-compose">
            <input
              type="text"
              value={message}
              maxLength={140}
              placeholder={`Message ${target.nickname}`}
              disabled={!isConnected}
              onChange={event => setMessage(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitMessage()
                }
              }}
              aria-label={`Message ${target.nickname}`}
            />
            <button
              type="button"
              disabled={!isConnected || !message.trim()}
              onClick={submitMessage}
            >
              Send
            </button>
          </div>
        </>
      )}

      <div className="chat-emotes">
        {!fullPickerOpen && quickEmotes.map(emote => (
          <button
            key={emote}
            type="button"
            className="emote-button"
            onClick={() => onSendEmote(emote)}
            disabled={!isConnected}
            aria-label={`Send ${getEmoteLabel(emote).toLowerCase()} to ${target.nickname}`}
            title={`Send ${getEmoteLabel(emote).toLowerCase()} to ${target.nickname}`}
          >
            <EmojiGlyph emoji={emote} />
          </button>
        ))}
        <button
          type="button"
          className={`emote-picker-toggle ${fullPickerOpen ? 'is-open' : ''}`}
          disabled={!isConnected}
          onClick={onToggleFullPicker}
        >
          {fullPickerOpen ? 'Back' : 'More emojis'}
        </button>
      </div>

      {fullPickerOpen && (
        <SearchableEmojiPicker
          className="targeted-emote-picker"
          isConnected={isConnected}
          height="clamp(240px, calc(100dvh - 260px), 360px)"
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

function formatAvatarChoice(value: string): string {
  return value
    .split('_')
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function buildAvatarSummary(avatar: PlayerAvatarCustomization): string {
  const hat = avatar.hat === 'none' ? 'No hat' : formatAvatarChoice(avatar.hat)
  const glasses = avatar.glasses === 'none' ? 'No glasses' : formatAvatarChoice(avatar.glasses)
  const jacket = avatar.jacket === 'none'
    ? 'No jacket'
    : `${formatAvatarChoice(avatar.jacket)} in ${formatAvatarChoice(avatar.jacketColor)}`

  return [
    formatAvatarChoice(avatar.modelKey),
    hat,
    glasses,
    jacket,
    `${formatAvatarChoice(avatar.idleTell)} tell`,
    `${formatAvatarChoice(avatar.celebration)} win`,
  ].join(' \u00b7 ')
}

function AvatarChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="avatar-choice-group">
      <legend>{legend}</legend>
      <div className="avatar-choice-options">
        {options.map(option => (
          <button
            key={option}
            type="button"
            className={`avatar-choice ${value === option ? 'is-active' : ''}`}
            data-option={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {formatAvatarChoice(option)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function AvatarLookPreview({ avatar }: { avatar: PlayerAvatarCustomization }) {
  const summary = buildAvatarSummary(avatar)

  return (
    <div className="avatar-look-card">
      <div
        className="avatar-preview-figure"
        role="img"
        aria-label={`Avatar preview: ${summary}`}
        data-model={avatar.modelKey}
        data-hat={avatar.hat}
        data-glasses={avatar.glasses}
        data-jacket={avatar.jacket}
        data-jacket-color={avatar.jacketColor}
      >
        <div className="avatar-preview-glow" aria-hidden="true" />
        <div className="avatar-preview-person" aria-hidden="true">
          <div className="avatar-preview-hat"><span /></div>
          <div className="avatar-preview-head">
            <div className="avatar-preview-hair" />
            <div className="avatar-preview-glasses">
              <i />
              <b />
              <i />
            </div>
          </div>
          <div className="avatar-preview-neck" />
          <div className="avatar-preview-torso">
            <div className="avatar-preview-jacket avatar-preview-jacket-left" />
            <div className="avatar-preview-shirt" />
            <div className="avatar-preview-jacket avatar-preview-jacket-right" />
          </div>
        </div>
      </div>
      <div className="avatar-look-copy">
        <span className="settings-section-title">Live look</span>
        <strong>{formatAvatarChoice(avatar.modelKey)}</strong>
        <p aria-live="polite">{summary}</p>
      </div>
    </div>
  )
}

export function SettingsModal({
  state,
  yourId,
  isConnected,
  suitColorMode,
  soundMuted = false,
  soundVolume = 0.65,
  avatarCustomization = DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  roomCode,
  canShareRoom,
  onClose,
  onSetSuitColorMode,
  onSetSoundMuted = () => {},
  onSetSoundVolume = () => {},
  onUpdateAvatar = () => {},
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
  isConnected: boolean
  suitColorMode: 'two' | 'four'
  soundMuted?: boolean
  soundVolume?: number
  avatarCustomization?: PlayerAvatarCustomization
  roomCode: string
  canShareRoom: boolean
  onClose: () => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onSetSoundMuted?: (muted: boolean) => void
  onSetSoundVolume?: (volume: number) => void
  onUpdateAvatar?: (avatar: PlayerAvatarCustomization) => void
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
  type NumericDraftValue = number | ''
  type NumericSettingsDraftKey =
    | 'smallBlind'
    | 'bigBlind'
    | 'startingStack'
    | 'actionTimerSeconds'
    | 'autoStartDelaySeconds'
    | 'sevenTwoBountyPercent'

  const [activeTab, setActiveTab] = useState<'general' | 'avatar' | 'players'>('general')
  const [showSevenTwoCustomize, setShowSevenTwoCustomize] = useState(false)
  const [chipDrafts, setChipDrafts] = useState<Record<string, NumericDraftValue>>({})
  const [avatarDraft, setAvatarDraft] = useState<PlayerAvatarCustomization>(() => ({
    ...avatarCustomization,
  }))
  const configuredSettings = {
    smallBlind: state.pendingTableSettings?.smallBlind ?? state.smallBlind,
    bigBlind: state.pendingTableSettings?.bigBlind ?? state.bigBlind,
    startingStack: state.pendingTableSettings?.startingStack ?? state.startingStack,
    actionTimerDuration: state.pendingTableSettings?.actionTimerDuration ?? state.actionTimerDuration,
    autoStartDelay: state.pendingTableSettings?.autoStartDelay ?? state.autoStartDelay ?? 5000,
    rabbitHuntingEnabled: state.pendingTableSettings?.rabbitHuntingEnabled ?? state.rabbitHuntingEnabled,
    sevenTwoRuleEnabled: state.pendingTableSettings?.sevenTwoRuleEnabled ?? state.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: state.pendingTableSettings?.sevenTwoBountyPercent ?? state.sevenTwoBountyPercent,
  }
  const [draft, setDraft] = useState<{
    smallBlind: NumericDraftValue
    bigBlind: NumericDraftValue
    startingStack: NumericDraftValue
    actionTimerSeconds: NumericDraftValue
    autoStartDelaySeconds: NumericDraftValue
    rabbitHuntingEnabled: boolean
    sevenTwoRuleEnabled: boolean
    sevenTwoBountyPercent: NumericDraftValue
  }>(() => ({
    smallBlind: configuredSettings.smallBlind,
    bigBlind: configuredSettings.bigBlind,
    startingStack: configuredSettings.startingStack,
    actionTimerSeconds: Math.max(1, Math.floor(configuredSettings.actionTimerDuration / 1000)),
    autoStartDelaySeconds: Math.max(1, Math.floor(configuredSettings.autoStartDelay / 1000)),
    rabbitHuntingEnabled: configuredSettings.rabbitHuntingEnabled,
    sevenTwoRuleEnabled: configuredSettings.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: configuredSettings.sevenTwoBountyPercent,
  }))

  useEffect(() => {
    setDraft({
      smallBlind: configuredSettings.smallBlind,
      bigBlind: configuredSettings.bigBlind,
      startingStack: configuredSettings.startingStack,
      actionTimerSeconds: Math.max(1, Math.floor(configuredSettings.actionTimerDuration / 1000)),
      autoStartDelaySeconds: Math.max(1, Math.floor(configuredSettings.autoStartDelay / 1000)),
      rabbitHuntingEnabled: configuredSettings.rabbitHuntingEnabled,
      sevenTwoRuleEnabled: configuredSettings.sevenTwoRuleEnabled,
      sevenTwoBountyPercent: configuredSettings.sevenTwoBountyPercent,
    })
  }, [
    configuredSettings.actionTimerDuration,
    configuredSettings.autoStartDelay,
    configuredSettings.bigBlind,
    configuredSettings.rabbitHuntingEnabled,
    configuredSettings.sevenTwoBountyPercent,
    configuredSettings.sevenTwoRuleEnabled,
    configuredSettings.smallBlind,
    configuredSettings.startingStack,
  ])

  useEffect(() => {
    setAvatarDraft({ ...avatarCustomization })
  }, [
    avatarCustomization.celebration,
    avatarCustomization.glasses,
    avatarCustomization.hat,
    avatarCustomization.idleTell,
    avatarCustomization.jacket,
    avatarCustomization.jacketColor,
    avatarCustomization.modelKey,
  ])

  const hasSettingsChanges =
    draft.smallBlind !== configuredSettings.smallBlind ||
    draft.bigBlind !== configuredSettings.bigBlind ||
    draft.startingStack !== configuredSettings.startingStack ||
    Number(draft.actionTimerSeconds) * 1000 !== configuredSettings.actionTimerDuration ||
    Number(draft.autoStartDelaySeconds) * 1000 !== configuredSettings.autoStartDelay ||
    draft.rabbitHuntingEnabled !== configuredSettings.rabbitHuntingEnabled ||
    draft.sevenTwoRuleEnabled !== configuredSettings.sevenTwoRuleEnabled ||
    draft.sevenTwoBountyPercent !== configuredSettings.sevenTwoBountyPercent
  const hasAvatarChanges =
    avatarDraft.modelKey !== avatarCustomization.modelKey ||
    avatarDraft.hat !== avatarCustomization.hat ||
    avatarDraft.glasses !== avatarCustomization.glasses ||
    avatarDraft.jacket !== avatarCustomization.jacket ||
    avatarDraft.jacketColor !== avatarCustomization.jacketColor ||
    avatarDraft.idleTell !== avatarCustomization.idleTell ||
    avatarDraft.celebration !== avatarCustomization.celebration
  const canSaveSettings = canSaveTableSettings({
    isConnected,
    hasSettingsChanges,
    phase: state.phase,
  })
  const resetGeneralDraft = () => setDraft({
    smallBlind: configuredSettings.smallBlind,
    bigBlind: configuredSettings.bigBlind,
    startingStack: configuredSettings.startingStack,
    actionTimerSeconds: Math.max(1, Math.floor(configuredSettings.actionTimerDuration / 1000)),
    autoStartDelaySeconds: Math.max(1, Math.floor(configuredSettings.autoStartDelay / 1000)),
    rabbitHuntingEnabled: configuredSettings.rabbitHuntingEnabled,
    sevenTwoRuleEnabled: configuredSettings.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: configuredSettings.sevenTwoBountyPercent,
  })

  const updateNumericDraft = (field: NumericSettingsDraftKey, value: string) => {
    const parsedValue = value === '' ? '' : Number(value)
    setDraft(current => ({
      ...current,
      [field]: typeof parsedValue === 'number' && !Number.isFinite(parsedValue) ? '' : parsedValue,
    }))
  }

  const getPlayerChipDraft = (playerId: string): NumericDraftValue => {
    if (Object.prototype.hasOwnProperty.call(chipDrafts, playerId)) {
      return chipDrafts[playerId]
    }

    return Math.max(state.bigBlind, 100)
  }

  const applyRuleSetting = (next: {
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
  }) => {
    setDraft(current => ({ ...current, ...next }))
  }

  const saveGeneralSettings = () => {
    if (!canSaveSettings) {
      return
    }

    const numericDrafts = [
      draft.smallBlind,
      draft.bigBlind,
      draft.startingStack,
      draft.actionTimerSeconds,
      draft.autoStartDelaySeconds,
      draft.sevenTwoBountyPercent,
    ]
    if (numericDrafts.some(value => value === '' || !Number.isFinite(value))) {
      onFeedback('Enter a number in every numeric setting before saving.', 'error')
      return
    }

    const smallBlind = Math.max(1, Math.floor(Number(draft.smallBlind)))
    const bigBlind = Math.max(smallBlind, Math.floor(Number(draft.bigBlind)))
    const startingStack = Math.max(bigBlind * 10, Math.floor(Number(draft.startingStack)))
    const actionTimerDuration = Math.min(60000, Math.max(5000, Math.floor(Number(draft.actionTimerSeconds)) * 1000))
    const autoStartDelay = Math.min(30000, Math.max(1000, Math.floor(Number(draft.autoStartDelaySeconds)) * 1000))
    const sevenTwoBountyPercent = Math.min(100, Math.max(0, Number(draft.sevenTwoBountyPercent)))

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

  const saveAvatar = () => {
    if (!isConnected) {
      onFeedback('Reconnect to the table before saving your avatar.', 'error')
      return
    }
    if (!hasAvatarChanges) {
      return
    }

    onUpdateAvatar({ ...avatarDraft })
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-settings-dialog-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div>
            <div className="table-panel-kicker">Table console</div>
            <div id="table-settings-dialog-title" className="table-panel-title">Table, avatar, and roster</div>
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
            Settings
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'avatar' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('avatar')}
          >
            Avatar
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'players' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('players')}
          >
            Players ({state.lobbyPlayers.length})
          </button>
        </div>

        {activeTab === 'general' && (
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Room actions</div>
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
              <div className="settings-toggle-row">
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'two' ? 'is-active' : ''}`}
                  aria-pressed={suitColorMode === 'two'}
                  onClick={() => onSetSuitColorMode('two')}
                >
                  2-color suits
                </button>
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'four' ? 'is-active' : ''}`}
                  aria-pressed={suitColorMode === 'four'}
                  onClick={() => onSetSuitColorMode('four')}
                >
                  4-color suits
                </button>
              </div>
            </div>

            <div className="settings-section settings-audio-section">
              <div>
                <div className="settings-section-title">Soundscape</div>
                <div className="settings-section-copy">
                  Card, chip, action, and showdown sounds play in both table views.
                </div>
              </div>
              <div className="settings-rule-row settings-audio-controls">
                <div className="settings-toggle-row">
                  <button
                    type="button"
                    className={`settings-pill ${!soundMuted ? 'is-active' : ''}`}
                    aria-pressed={!soundMuted}
                    onClick={() => onSetSoundMuted(false)}
                  >
                    Sound on
                  </button>
                  <button
                    type="button"
                    className={`settings-pill ${soundMuted ? 'is-active' : ''}`}
                    aria-pressed={soundMuted}
                    onClick={() => onSetSoundMuted(true)}
                  >
                    Muted
                  </button>
                </div>
                <label className="settings-volume-field">
                  <span>Volume {Math.round(Math.max(0, Math.min(1, soundVolume)) * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(Math.max(0, Math.min(1, soundVolume)) * 100)}
                    aria-label="Table sound volume"
                    onChange={event => onSetSoundVolume(Number(event.target.value) / 100)}
                  />
                </label>
              </div>
            </div>

            <>
                <div className="settings-section">
                  <div className="settings-section-title">Game setup</div>
                  <div className="settings-grid settings-grid-modal">
                    <label className="settings-field">
                      <span>Small blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.smallBlind}
                        onChange={event => updateNumericDraft('smallBlind', event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Big blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.bigBlind}
                        onChange={event => updateNumericDraft('bigBlind', event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Starting stack</span>
                      <input
                        type="number"
                        min={10}
                        step={10}
                        value={draft.startingStack}
                        onChange={event => updateNumericDraft('startingStack', event.target.value)}
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
                        onChange={event => updateNumericDraft('actionTimerSeconds', event.target.value)}
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
                        onChange={event => updateNumericDraft('autoStartDelaySeconds', event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Rules</div>
                  <div className="settings-rule-row">
                    <div>
                      <div className="settings-rule-name">Rabbit hunting</div>
                      <div className="settings-rule-copy">Run out the board after fold-ended hands.</div>
                    </div>
                    <div className="settings-toggle-row">
                      <button
                        type="button"
                        className={`settings-pill ${draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                        aria-pressed={draft.rabbitHuntingEnabled}
                        onClick={() => applyRuleSetting({ rabbitHuntingEnabled: true })}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={`settings-pill ${!draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                        aria-pressed={!draft.rabbitHuntingEnabled}
                        onClick={() => applyRuleSetting({ rabbitHuntingEnabled: false })}
                      >
                        Off
                      </button>
                    </div>
                  </div>
                  <div className="settings-rule-row">
                    <div>
                      <div className="settings-rule-name">7 / 2 rule</div>
                      <div className="settings-rule-copy">Winning 7-2 hands collect the configured bounty.</div>
                    </div>
                    <div className="settings-toggle-row">
                      <button
                        type="button"
                        className={`settings-pill ${draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                        aria-pressed={draft.sevenTwoRuleEnabled}
                        onClick={() => applyRuleSetting({ sevenTwoRuleEnabled: true })}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={`settings-pill ${!draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                        aria-pressed={!draft.sevenTwoRuleEnabled}
                        onClick={() => applyRuleSetting({ sevenTwoRuleEnabled: false })}
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        className={`settings-pill ${showSevenTwoCustomize ? 'is-active' : ''}`}
                        aria-pressed={showSevenTwoCustomize}
                        onClick={() => setShowSevenTwoCustomize(current => !current)}
                      >
                        Customize
                      </button>
                    </div>
                  </div>
                  {showSevenTwoCustomize && (
                    <div className="settings-rule-detail">
                      <label className="settings-field">
                        <span>Bounty % of original buy-in</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={draft.sevenTwoBountyPercent}
                          onChange={event => updateNumericDraft('sevenTwoBountyPercent', event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div className="settings-footer">
                  {state.phase === 'in_hand' && (
                    <span className="settings-save-status" role="status">
                      {state.pendingTableSettings && !hasSettingsChanges
                        ? 'Settings saved. They’ll apply automatically next hand.'
                        : state.pendingTableSettings
                          ? 'Save to replace the settings queued for next hand.'
                          : 'Save now and changes will apply automatically next hand.'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-subtle"
                    disabled={!hasSettingsChanges || !isConnected}
                    onClick={resetGeneralDraft}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn-subtle btn-subtle-gold"
                    disabled={!canSaveSettings}
                    onClick={saveGeneralSettings}
                  >
                    {state.phase === 'in_hand'
                      ? state.pendingTableSettings && !hasSettingsChanges
                        ? 'Saved for next hand'
                        : 'Save for next hand'
                      : 'Save table settings'}
                  </button>
                </div>
              </>
          </div>
        )}

        {activeTab === 'avatar' && (
          <div className="settings-modal-body avatar-settings-body">
            <section className="settings-section avatar-settings-intro">
              <div>
                <div className="settings-section-title">Make the seat yours</div>
                <div className="settings-section-copy">
                  Build a table look, choose a natural idle tell, and pick how you celebrate a win.
                  Nothing changes for the room until you save.
                </div>
              </div>
              <AvatarLookPreview avatar={avatarDraft} />
            </section>

            <section className="settings-section avatar-customizer-section" aria-label="Avatar options">
              <AvatarChoiceGroup
                legend="Base look"
                value={avatarDraft.modelKey}
                options={AVATAR_MODEL_KEYS}
                onChange={modelKey => setAvatarDraft(current => ({ ...current, modelKey }))}
              />
              <AvatarChoiceGroup
                legend="Hat"
                value={avatarDraft.hat}
                options={AVATAR_HAT_OPTIONS}
                onChange={hat => setAvatarDraft(current => ({ ...current, hat }))}
              />
              <AvatarChoiceGroup
                legend="Glasses"
                value={avatarDraft.glasses}
                options={AVATAR_GLASSES_OPTIONS}
                onChange={glasses => setAvatarDraft(current => ({ ...current, glasses }))}
              />
              <AvatarChoiceGroup
                legend="Jacket"
                value={avatarDraft.jacket}
                options={AVATAR_JACKET_OPTIONS}
                onChange={jacket => setAvatarDraft(current => ({ ...current, jacket }))}
              />
              <AvatarChoiceGroup
                legend="Jacket color"
                value={avatarDraft.jacketColor}
                options={AVATAR_JACKET_COLOR_OPTIONS}
                onChange={jacketColor => setAvatarDraft(current => ({ ...current, jacketColor }))}
              />
              <AvatarChoiceGroup
                legend="Idle tell"
                value={avatarDraft.idleTell}
                options={AVATAR_IDLE_TELL_OPTIONS}
                onChange={idleTell => setAvatarDraft(current => ({ ...current, idleTell }))}
              />
              <AvatarChoiceGroup
                legend="Win celebration"
                value={avatarDraft.celebration}
                options={AVATAR_CELEBRATION_OPTIONS}
                onChange={celebration => setAvatarDraft(current => ({ ...current, celebration }))}
              />

              <div className="settings-footer avatar-settings-footer">
                <span className="settings-save-status" role="status">
                  {!isConnected
                    ? 'Reconnect to save this look to the table.'
                    : hasAvatarChanges
                      ? 'Previewing unsaved changes.'
                      : 'Your saved look is live at the table.'}
                </span>
                <button
                  type="button"
                  className="btn-subtle"
                  disabled={!hasAvatarChanges}
                  onClick={() => setAvatarDraft({ ...avatarCustomization })}
                >
                  Reset avatar
                </button>
                <button
                  type="button"
                  className="btn-subtle btn-subtle-gold"
                  disabled={!hasAvatarChanges || !isConnected}
                  onClick={saveAvatar}
                >
                  {hasAvatarChanges ? 'Save avatar' : 'Avatar saved'}
                </button>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'players' && (
          <div className="settings-modal-body">
            <div className="settings-roster-summary">
              <span className="table-chip">{state.players.length} seated</span>
              <span className="table-chip table-chip-soft">
                {state.lobbyPlayers.filter(player => player.isSpectator).length} spectating
              </span>
              <span className="table-chip table-chip-soft">Players stay on the rail at 0 chips</span>
            </div>

            <div className="settings-player-list">
              {state.lobbyPlayers.map(player => {
                const chipDraft = getPlayerChipDraft(player.id)
                const hasValidChipDraft = typeof chipDraft === 'number' && Number.isFinite(chipDraft) && chipDraft > 0
                const manageAmount = hasValidChipDraft
                  ? Math.max(state.bigBlind, Math.floor(chipDraft))
                  : Math.max(state.bigBlind, 100)
                const tags = buildPlayerManagementTags(player, {
                  yourId,
                })
                const canRemoveChips = isConnected && player.stack > 0 && hasValidChipDraft
                const canToggleSpectator = isConnected && (
                  !player.isSpectator || player.stack > 0
                )

                return (
                  <div key={player.id} className={`settings-player-row ${player.isSpectator ? 'is-spectator' : ''}`}>
                    <div className="settings-player-main">
                      <div className="settings-player-title-row">
                        <div className="host-player-name">{player.nickname}</div>
                        <div className="settings-player-tags">
                          {tags.map(tag => (
                            <span key={tag} className="settings-player-tag">{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div className="host-player-meta">
                        {formatAmount(player.stack)} {'\u00b7'} {getLobbyStatusLabel(state, player)}
                      </div>
                    </div>
                    <div className="settings-player-actions">
                      <label className="settings-field settings-player-chip-input">
                        <span>Chip amount</span>
                        <input
                          type="number"
                          min={state.bigBlind}
                          step={state.bigBlind}
                          value={chipDraft}
                          onChange={event => {
                            const nextValue = event.target.value === '' ? '' : Number(event.target.value)
                            setChipDrafts(current => ({
                              ...current,
                              [player.id]: typeof nextValue === 'number' && !Number.isFinite(nextValue)
                                ? ''
                                : nextValue,
                            }))
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-subtle btn-chip-add"
                        aria-label={`Add ${formatAmount(manageAmount)} chips to ${player.nickname}`}
                        disabled={!isConnected || !hasValidChipDraft}
                        onClick={() => onAdjustPlayerStack(player.id, manageAmount)}
                      >
                        Add chips
                      </button>
                      <button
                        type="button"
                        className="btn-subtle"
                        aria-label={`Remove ${formatAmount(manageAmount)} chips from ${player.nickname}`}
                        disabled={!canRemoveChips}
                        onClick={() => onAdjustPlayerStack(player.id, -manageAmount)}
                      >
                        Remove chips
                      </button>
                      <button
                        type="button"
                        className="btn-subtle"
                        disabled={!canToggleSpectator}
                        title={player.isSpectator && player.stack <= 0 ? 'Add chips before seating this player back' : undefined}
                        aria-label={player.isSpectator ? `Seat ${player.nickname}` : `Move ${player.nickname} to spectator mode`}
                        onClick={() => onSetPlayerSpectator(player.id, !player.isSpectator)}
                      >
                        {player.isSpectator ? 'Seat player' : state.phase === 'in_hand' ? 'Spectate now' : 'Spectate player'}
                      </button>
                      {player.id !== yourId ? (
                        <button
                          type="button"
                          className="btn-subtle btn-subtle-danger"
                          disabled={!isConnected}
                          aria-label={`Kick ${player.nickname} from the table`}
                          onClick={() => onRemovePlayer(player.id)}
                        >
                          {state.phase === 'in_hand' ? 'Kick after hand' : 'Kick player'}
                        </button>
                      ) : (
                        <span className="table-chip table-chip-soft">Self removal blocked</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RabbitHuntDock({
  isConnected,
  onRabbitHunt,
}: {
  isConnected: boolean
  onRabbitHunt: () => void
}) {
  return (
    <div className="rabbit-hunt-dock" role="region" aria-label="Rabbit hunt controls">
      <div className="rabbit-hunt-copy">
        <span className="rabbit-hunt-kicker">Folded hand</span>
        <span className="rabbit-hunt-title">See the board runout</span>
      </div>
      <button
        type="button"
        className="btn-subtle btn-subtle-gold rabbit-hunt-button"
        disabled={!isConnected}
        onClick={onRabbitHunt}
      >
        Rabbit hunt
      </button>
    </div>
  )
}

function WaitingPanel({
  state,
  me,
  lobbyMe,
  isConnected,
  onStartGame,
  onAddBots,
  onSeatMe,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isConnected: boolean
  onStartGame: () => void
  onAddBots: (count: number) => void
  onSeatMe: () => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const statusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const seatedCount = state.players.length
  const canStart = seatedCount >= 2 && isConnected
  const canAddBots = isConnected && seatedCount < 8
  const openSeats = Math.max(0, 8 - seatedCount)
  const spectatorRail = getSpectatorRailState(lobbyMe, isConnected)

  return (
    <div className="table-panel status-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Table controls</div>
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
        {spectatorRail
          ? spectatorRail.message
          : me
          ? `You are seated with ${formatAmount(me.stack)} and blinds are ${formatAmount(state.smallBlind)}/${formatAmount(state.bigBlind)}.`
          : 'Seat assignment is being restored.'}
      </div>
      {spectatorRail && (
        <div className="spectator-rail-actions">
          <span className="table-chip table-chip-soft">Rail stack {formatAmount(lobbyMe?.stack ?? 0)}</span>
          {spectatorRail.canTakeSeat && (
            <button type="button" className="btn-subtle btn-subtle-gold" onClick={onSeatMe}>
              {spectatorRail.actionLabel}
            </button>
          )}
        </div>
      )}
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
    </div>
  )
}

function MobileBetweenHandsDock({
  state,
  me,
  lobbyMe,
  isConnected,
  copy,
  onStartGame,
  onAddBots,
  onSeatMe,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isConnected: boolean
  copy: string
  onStartGame: () => void
  onAddBots: (count: number) => void
  onSeatMe: () => void
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
  const spectatorRail = getSpectatorRailState(lobbyMe, isConnected)

  return (
    <div className="mobile-between-hands-dock">
      <div className="mobile-between-hands-card">
        <>
          <div className="mobile-between-hands-copy">
            <div className="mobile-between-hands-kicker">
              {lobbyMe?.isSpectator ? 'Spectator rail' : 'Table controls'}
            </div>
            <div className="mobile-between-hands-title">{copy}</div>
            <div className="mobile-between-hands-meta">
              <span>{seatedCount} seated</span>
              <span>{infoChip}</span>
            </div>
          </div>
          <div className="mobile-between-hands-note">
            {spectatorRail
              ? spectatorRail.message
              : 'Anyone at the table can deal as soon as the table is ready.'}
          </div>
          {spectatorRail?.canTakeSeat && (
            <button
              type="button"
              className="mobile-between-hands-btn mobile-between-hands-btn-primary"
              onClick={onSeatMe}
            >
              {spectatorRail.actionLabel}
            </button>
          )}
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
        </>
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
