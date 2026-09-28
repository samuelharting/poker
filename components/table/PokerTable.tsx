'use client'

import dynamic from 'next/dynamic'
import React, { type CSSProperties, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { Card, CardRevealRequest, HandHistoryEntry, TableState, SeatPlayer, LobbyPlayer, ShowCardsMode, PlayerStats } from '@/lib/poker/types'
import {
  isAllowedEmote,
  type PlayerSocialState,
  type SocialSnapshot,
  type TableChatEntry,
} from '@/shared/protocol'
import { PlayerSeat, formatWinnerPaymentLabel, getVisibleSeatCards } from './PlayerSeat'
import { CommunityCards } from './CommunityCards'
import { RunItTwiceBoards, RunItTwicePrompt } from './RunItTwice'
import { OwnHand } from './OwnHand'
import { PotDisplay } from './PotDisplay'
import { ShowdownCinematic, useShowdownPresentation } from './ShowdownCinematic'
import { SeatDrinkBadge } from './SeatDrinkBadge'
import { useDrinks } from './DrinkContext'
import { PrankControls } from './PrankControls'
import { getShotBlockReasonFromState, isLiveInHand, type DrinkEvent } from '@/lib/drinks'
import { CHIP_FLICK_COOLDOWN_MS, type PrankEvent } from '@/lib/pranks'
import { CompanionBadge } from './CompanionBadge'
import { BountyToast } from './BountyToast'
import { ChipStack } from '@/components/ui/ChipStack'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { SearchableEmojiPicker } from '@/components/ui/SearchableEmojiPicker'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'
import { evaluateHand } from '@/lib/poker/evaluator'
import { getShowdownRevealMode, isTrueShowdown } from '@/lib/poker/showdown'
import { getHandOddsView, type SeatOddsView } from '@/lib/poker/handOddsView'
import { HandOddsPanel, OddsPill } from '@/components/table/HandOdds'
import { TWO_D_LAYOUT_QUERY, useMediaQuery } from '@/lib/layoutMode'
import type { PokerSoundCueKind } from '@/lib/poker/soundscape'
import {
  createPreAction,
  describeAutoAction,
  getBlindTip,
  getPreActionOptions,
  getTurnPrompt,
  isPreActionOptionActive,
  reconcilePreAction,
  resolvePreAction,
  type PreActionKind,
  type QueuedPreAction,
  type TurnPromptInput,
} from '@/lib/poker/turnGuidance'
import { PRE_ACTION_SHORTCUT_KEYS, PreActionBar } from './PreActionBar'
import { PeekStylePicker } from './PeekStylePicker'
import { LedgerPanel, getRebuyStatus, requestRebuy, type LedgerC2SMessage } from './LedgerPanel'
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
    funModeEnabled?: boolean
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
  /** You started/stopped privately peeking at your hole cards. */
  onPeekCards?: (peeking: boolean) => void
  onCloseSettings: () => void
  onCopyRoom: () => void
  onShareRoom: () => void
  onLeaveGame?: () => void
  onSendChat?: (message: string) => void
  onSendTargetChat?: (targetId: string, message: string) => void
  onSendEmote: (emote: string) => void
  onSendTargetEmote: (targetId: string, emote: string) => void
  /** Shots bought and chips flicked at this table (newest last). */
  prankEvents?: readonly PrankEvent[]
  onBuyShot?: (targetId: string) => void
  onFlickChip?: (targetId: string) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
  /** Rebuys, settle-up, Venmo and the host's money rules (Settings > Ledger). */
  onSendLedgerMessage?: (message: LedgerC2SMessage) => void
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

const SEAT_TONES = ['burgundy', 'midnight', 'emerald', 'ivory', 'gold', 'violet'] as const

function getMobileSeatName(player: Pick<SeatPlayer, 'isBot' | 'nickname'>): string {
  return player.isBot ? player.nickname.replace(/^Bot\s+/i, '') : player.nickname
}

/** Avatar puck colour: the player's jacket colour, or a stable pick from their id. */
export function getSeatTone(player: Pick<SeatPlayer, 'id' | 'avatar'>): string {
  const jacketColor = player.avatar?.jacketColor
  if (jacketColor) {
    return jacketColor
  }

  let hash = 0
  for (const character of player.id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return SEAT_TONES[hash % SEAT_TONES.length]!
}

export function getSeatInitials(name: string): string {
  const words = name.replace(/^Bot\s+/i, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }

  if (words.length === 1) {
    return words[0]!.slice(0, 1).toUpperCase()
  }

  return `${words[0]!.slice(0, 1)}${words[1]!.slice(0, 1)}`.toUpperCase()
}

export type SeatActionTone = 'fold' | 'check' | 'call' | 'raise' | 'all-in'

/** Short seat chip for the player's latest action on the current street. */
export function getSeatActionChip(
  player: Pick<SeatPlayer, 'status' | 'lastAction' | 'hasActedThisRound'>
): { label: string; tone: SeatActionTone } | null {
  if (player.status === 'folded') {
    return { label: 'Fold', tone: 'fold' }
  }

  if (player.status === 'all_in') {
    return { label: 'All-in', tone: 'all-in' }
  }

  if (!player.lastAction || !player.hasActedThisRound) {
    return null
  }

  const normalized = player.lastAction.toLowerCase()
  const amount = player.lastAction.match(/\$[0-9][0-9,]*/)?.[0]

  if (normalized.startsWith('check')) {
    return { label: 'Check', tone: 'check' }
  }

  if (normalized.startsWith('call')) {
    return { label: amount ? `Call ${amount}` : 'Call', tone: 'call' }
  }

  if (normalized.startsWith('raise') || normalized.startsWith('bet')) {
    return { label: amount ? `Raise ${amount}` : 'Raise', tone: 'raise' }
  }

  if (normalized.startsWith('all')) {
    return { label: 'All-in', tone: 'all-in' }
  }

  return null
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
const FLIP_OFF_EMOTE = '🖕'
const FLIP_OFF_FILLERS = ['😂', '💀', '🔥'] as const

/** The middle finger has its own prank button (it animates the avatar), so it leaves the quick row there. */
function withoutFlipOff(emotes: readonly string[]): string[] {
  const next = emotes.filter(emote => emote !== FLIP_OFF_EMOTE)
  for (const filler of FLIP_OFF_FILLERS) {
    if (next.length >= 3) break
    if (!next.includes(filler)) next.push(filler)
  }
  return next.slice(0, 3)
}

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
  /** Seat-chip name (bots without the "Bot" prefix) for the 2D layout. */
  displayName: string
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

const NO_PRANK_EVENTS: readonly PrankEvent[] = []

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
  prankEvents?: readonly PrankEvent[]
  drinkEvents?: readonly DrinkEvent[]
  emoteReactions: ThreeEmoteReaction[]
  chatMessages: ThreeChatMessage[]
  selectedTargetId: string | null
  onSelectPlayer: (playerId: string) => void
  cardRevealActions: CardRevealSeatAction[]
  onRequestCardReveal: (playerId: string) => void
  highlightedCards?: ReadonlyArray<Pick<Card, 'rank' | 'suit'>>
  actingTimerPercent?: number
}

const DesktopPokerRoom3D = dynamic<DesktopPokerRoom3DProps>(
  () => import('@/components/three/DesktopPokerRoom3D').then(module => module.DesktopPokerRoom3D),
  { ssr: false }
)

const ALL_IN_ANNOUNCEMENT_MS = 2600
/** How long a sent action keeps the tray locked if the server never answers. */
const ACTION_PENDING_TIMEOUT_MS = 2500

const SUIT_GLYPHS: Record<Card['suit'], string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

/** Desktop tray keyboard shortcuts, shown as tiny key hints on the buttons. */
const BLIND_TIP_STORAGE_KEY = 'poker:blind-tip-seen'

const ACTION_SHORTCUT_KEYS: Partial<Record<PokerAction, string>> = {
  fold: 'F',
  check: 'C',
  call: 'C',
  raise: 'R',
  all_in: 'A',
}

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

/**
 * Mobile seats sit around the edges of the screen like a real table, clockwise
 * from the hero's left: up the left side, across the top, down the right.
 */
const MOBILE_SEAT_SLOTS: Record<number, string[]> = {
  1: ['t'],
  2: ['tl', 'tr'],
  3: ['l2', 't', 'r2'],
  4: ['l2', 'tl', 'tr', 'r2'],
  5: ['l1', 'l2', 't', 'r2', 'r1'],
  6: ['l1', 'l2', 'tl', 'tr', 'r2', 'r1'],
  7: ['l1', 'l2', 'tl', 't', 'tr', 'r2', 'r1'],
  8: ['l1', 'l2', 'tl', 't', 'tr', 'r2', 'r1', 'b'],
}

export function getMobileSeatSlot(index: number, count: number): string {
  return MOBILE_SEAT_SLOTS[Math.min(Math.max(count, 1), 8)]?.[index] ?? 't'
}

function getEmoteGlyph(emote?: string): string | undefined {
  return EMOTE_OPTIONS.find(option => option.id === emote)?.glyph ?? emote
}

function getEmoteLabel(emote: string): string {
  return EMOTE_OPTIONS.find(option => option.glyph === emote)?.label ?? 'Emoji'
}

interface ActiveSeatSocial {
  message?: string
  emote?: string
  messageExpiresAt?: number
  emoteExpiresAt?: number
  emoteTargeted?: boolean
  /** Who sent a targeted emote, so the seat can read "Sender → 🖕". */
  emoteSenderId?: string
}

export function buildActiveSocialByPlayer(
  activeSocial: PlayerSocialState[],
  now = Date.now()
): Map<string, ActiveSeatSocial> {
  const entries = new Map<string, ActiveSeatSocial>()

  for (const entry of activeSocial) {
    if (entry.message && entry.messageExpiresAt && entry.messageExpiresAt > now) {
      const messageSeatId = entry.messageTargetPlayerId?.trim() || entry.playerId
      const current = entries.get(messageSeatId) ?? {}
      entries.set(messageSeatId, {
        ...current,
        message: entry.message,
        messageExpiresAt: entry.messageExpiresAt,
      })
    }

    if (entry.emote && entry.emoteExpiresAt && entry.emoteExpiresAt > now) {
      const targetSeatId = entry.targetPlayerId?.trim() || entry.playerId
      const current = entries.get(targetSeatId) ?? {}
      entries.set(targetSeatId, {
        ...current,
        emote: getEmoteGlyph(entry.emote),
        emoteExpiresAt: entry.emoteExpiresAt,
        emoteTargeted: targetSeatId !== entry.playerId,
        ...(targetSeatId !== entry.playerId ? { emoteSenderId: entry.playerId } : {}),
      })
    }
  }

  return entries
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

type SeatTimerStyle = CSSProperties & { '--turn-pct'?: number }

function AllInAnnouncement({ announcement }: { announcement: AllInAnnouncementView }) {
  const amountLabel = announcement.amountLabel?.replace(/\d{4,}/g, digits => Number(digits).toLocaleString())
  const amountCopy = amountLabel
    ? `${amountLabel} in the middle`
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
      <span className="all-in-flare" aria-hidden="true" />
      <span className="all-in-shockwave" aria-hidden="true" />
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

const SEAT_ACTION_WORDS: Record<SeatActionTone, string> = {
  fold: 'Folded',
  check: 'Check',
  call: 'Call',
  raise: 'Raise',
  'all-in': 'All-in',
}

/** Seat-chip stack: whole dollars up to $9,999, then $12.3K so it never truncates. */
export function formatSeatStack(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`
  if (amount >= 10_000) return `$${(amount / 1000).toFixed(amount >= 100_000 ? 0 : 1)}K`
  return formatAmount(amount)
}

/**
 * 2D seat chip: a small avatar, name, stack and one status line with the
 * player's current bet. The whole chip is the tap target for reactions.
 */
function MobileEdgeSeat({
  player,
  visualSeat,
  displayStack,
  isActing,
  secondsLeft,
  timerPercent,
  isWinner = false,
  winnerAmount,
  winningCards = [],
  cardRevealControl,
  onNameClick,
  odds,
  isHandLive = false,
  isSelf = false,
}: {
  player: OpponentSeat
  visualSeat: number
  displayStack: number
  isActing: boolean
  secondsLeft?: number
  timerPercent?: number
  isWinner?: boolean
  winnerAmount?: number
  winningCards?: Card[]
  cardRevealControl?: React.ReactNode
  onNameClick?: (playerId: string) => void
  odds?: SeatOddsView
  isHandLive?: boolean
  /** The viewer's own chair in the all-seats (rail) layout: not a reaction target. */
  isSelf?: boolean
}) {
  const isFolded = player.status === 'folded'
  const isDisconnected = player.status === 'disconnected' || !player.isConnected
  // Benched after missed hands (or by choice): keeps the seat, not dealt in.
  const isSittingOut = !isDisconnected && (player.isAway || (player.status === 'sitting_out' && player.stack > 0))
  const isAllIn = player.status === 'all_in'
  // Sat down while a hand was running: dealt in from the next one.
  const isJoiningNextHand = player.status === 'waiting' && !player.hasCards && isHandLive
  const blindRole = player.isBB ? 'big' : player.isSB ? 'small' : null
  const mobileSeatName = getMobileSeatName(player)
  const targetTitle = `Target ${player.nickname} for emojis`
  const holeCards = player.holeCards ?? []
  const { left: visibleLeftCard, right: visibleRightCard } = getVisibleSeatCards(
    player.showCards,
    holeCards
  )
  const hasVisibleHoleCards = Boolean(visibleLeftCard || visibleRightCard)
  const actionChip = getSeatActionChip(player)
  const statusTone = isWinner && typeof winnerAmount === 'number' && winnerAmount > 0
    ? 'win'
    : (isDisconnected || isSittingOut) && !isFolded
      ? 'away'
      : actionChip?.tone ?? (blindRole ? 'blind' : 'idle')
  const classes = [
    'mobile-edge-seat',
    `mobile-seat-${visualSeat}`,
    isActing ? 'is-acting' : '',
    isActing && typeof secondsLeft === 'number' && secondsLeft <= 5 ? 'is-low-time' : '',
    isFolded ? 'is-folded' : '',
    isAllIn ? 'is-all-in' : '',
    isWinner ? 'is-winner' : '',
    hasVisibleHoleCards ? 'has-visible-cards' : '',
    isDisconnected ? 'is-disconnected' : '',
    cardRevealControl ? 'has-reveal-control' : '',
  ].filter(Boolean).join(' ')
  const seatStyle: SeatTimerStyle | undefined = isActing && typeof timerPercent === 'number'
    ? { '--turn-pct': Math.round(timerPercent * 10) / 10 }
    : undefined
  const renderSeatCard = (card: Card) => (
    <PlayingCard
      card={card}
      size="xs"
      highlighted={isWinner && (
        winningCards.length === 0 || winningCards.some(
          winningCard => winningCard.rank === card.rank && winningCard.suit === card.suit
        )
      )}
    />
  )

  return (
    <div
      className={classes}
      data-mobile-seat={visualSeat}
      data-player-status={player.status}
      data-tone={getSeatTone(player)}
      style={seatStyle}
    >
      {onNameClick && !isSelf && (
        <button
          type="button"
          className="mobile-seat-hit"
          onClick={() => onNameClick(player.id)}
          title={targetTitle}
          aria-label={targetTitle}
          data-player-target-trigger="seat"
        />
      )}
      {odds && <OddsPill odds={odds} playerName={player.nickname} className="mobile-seat-odds" />}
      <div className="mobile-seat-puck">
        {isActing && <span className="mobile-seat-ring" aria-hidden="true" />}
        <div className="mobile-seat-avatar" aria-hidden="true">
          {getSeatInitials(player.nickname)}
        </div>
        {player.hasCards && !isFolded && !hasVisibleHoleCards && (
          <span className="mobile-edge-seat-cards" aria-label="Holding cards">
            <span className="mobile-edge-card-back" />
            <span className="mobile-edge-card-back" />
          </span>
        )}
        {player.isDealer && (
          <span className="mobile-seat-dealer" title="Dealer" aria-label="Dealer">D</span>
        )}
      </div>

      {isActing && typeof secondsLeft === 'number' && (
        <div
          className={`mobile-edge-seat-timer ${secondsLeft <= 5 ? 'is-low' : ''}`}
          role="timer"
          aria-label={`${secondsLeft} seconds left`}
        >
          {secondsLeft}s
        </div>
      )}

      <div className="mobile-edge-seat-main">
        <div className="mobile-edge-seat-name">
          <span className="mobile-edge-seat-name-text">{mobileSeatName}</span>
        </div>
        <div
          className="mobile-edge-seat-stack"
          aria-label={`${mobileSeatName} stack ${formatAmount(displayStack)}`}
        >
          {formatSeatStack(displayStack)}
        </div>
      </div>

      {player.hasCards && hasVisibleHoleCards && (
        <div className="mobile-edge-seat-cards is-revealed">
          {visibleLeftCard ? renderSeatCard(visibleLeftCard) : (
            <span className="mobile-edge-card-back" aria-label="Hidden card" />
          )}
          {visibleRightCard ? renderSeatCard(visibleRightCard) : (
            <span className="mobile-edge-card-back" aria-label="Hidden card" />
          )}
        </div>
      )}

      <div className={`mobile-seat-status is-${statusTone}`}>
        {statusTone === 'win' ? (
          <span className="mobile-seat-action">+{formatAmount(winnerAmount ?? 0)}</span>
        ) : isJoiningNextHand ? (
          <span className="mobile-seat-action">Next hand</span>
        ) : statusTone === 'away' ? (
          <span className="mobile-seat-action">{isSittingOut ? 'Sitting out' : 'Away'}</span>
        ) : actionChip ? (
          <span
            key={`${actionChip.tone}-${player.lastActionId ?? actionChip.label}`}
            className="mobile-seat-action"
          >
            {SEAT_ACTION_WORDS[actionChip.tone]}
          </span>
        ) : blindRole ? (
          <span className={`mobile-blind-role is-${blindRole}`}>
            <strong aria-hidden="true">{blindRole === 'big' ? 'BB' : 'SB'}</strong>
            <span className="sr-only">{blindRole === 'big' ? 'Big Blind' : 'Small Blind'}</span>
          </span>
        ) : null}
        {player.bet > 0 && statusTone !== 'win' && (
          <MobileBetIndicator
            key={`${player.id}-${player.bet}`}
            amount={player.bet}
            ownerLabel={mobileSeatName}
            className="mobile-edge-bet-anchor"
          />
        )}
      </div>

      {cardRevealControl && (
        <div className="mobile-card-reveal-control">{cardRevealControl}</div>
      )}
    </div>
  )
}

function MobileHeroSeat({
  player,
  displayStack,
  isActing,
  isWinner,
  status,
  odds,
}: {
  player: SeatPlayer
  displayStack: number
  isActing: boolean
  isWinner: boolean
  status: string
  odds?: SeatOddsView
}) {
  const blindRole = player.isBB ? 'big' : player.isSB ? 'small' : null

  return (
    <div
      className={`mobile-hero-seat ${isActing ? 'is-acting' : ''} ${isWinner ? 'is-winner' : ''}`}
      data-tone={getSeatTone(player)}
    >
      {odds && <OddsPill odds={odds} playerName="You" className="mobile-seat-odds mobile-hero-odds" />}
      <div className="mobile-hero-avatar" aria-hidden="true">
        {getSeatInitials(player.nickname)}
      </div>
      <div className="mobile-hero-meta">
        <div className="mobile-hero-seat-name">
          You
          {player.isDealer && (
            <span className="mobile-seat-dealer" title="Dealer" aria-label="Dealer">D</span>
          )}
          {blindRole && (
            <span className={`mobile-blind-role is-${blindRole}`}>
              <strong aria-hidden="true">{blindRole === 'big' ? 'BB' : 'SB'}</strong>
              <span className="sr-only">{blindRole === 'big' ? 'Big Blind' : 'Small Blind'}</span>
            </span>
          )}
        </div>
        <div className="mobile-hero-seat-stack">{formatAmount(displayStack)}</div>
        <div className="mobile-hero-seat-status">{status}</div>
      </div>
      {player.bet > 0 && (
        <MobileBetIndicator
          key={`${player.id}-${player.bet}`}
          amount={player.bet}
          ownerLabel="Your"
          className="mobile-hero-bet-anchor"
        />
      )}
    </div>
  )
}

/**
 * True when at least one other player could still act after the viewer (has
 * chips behind and has not folded). When nobody can, raising or shoving more
 * than the call changes nothing, so only Fold / Call (or Check) make sense.
 */
export function canAnyOpponentRespond(
  players: ReadonlyArray<Pick<SeatPlayer, 'id' | 'status' | 'stack'>>,
  yourId: string
): boolean {
  return players.some(player => (
    player.id !== yourId &&
    player.status === 'active' &&
    player.stack > 0
  ))
}

export function buildActionButtonDescriptors({
  legalActions,
  toCall,
  raiseAmount,
  allInAmount,
  othersCanRespond = true,
  isOpeningBet = false,
}: {
  legalActions: PokerAction[]
  toCall: number
  raiseAmount: number
  allInAmount?: number
  /** False when everyone else is all-in: Raise and All-in are dropped. */
  othersCanRespond?: boolean
  /** Nobody has bet this street yet: the wager button reads "Bet". */
  isOpeningBet?: boolean
}): PokerActionButtonDescriptor[] {
  const buttons: PokerActionButtonDescriptor[] = []
  const canBetMore = othersCanRespond || !legalActions.some(action => action === 'call' || action === 'check')

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

  if (canBetMore && legalActions.includes('raise')) {
    buttons.push({
      key: 'raise',
      label: isOpeningBet ? 'Bet' : 'Raise to',
      amountLabel: formatAmount(raiseAmount),
      className: 'btn-raise',
    })
  }

  if (canBetMore && legalActions.includes('all_in') && typeof allInAmount === 'number') {
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

/**
 * Raise-to amount for a pot-fraction preset: call first, then bet the
 * fraction of the pot as it stands after the call.
 */
export function getPotFractionRaiseTo({
  totalPot,
  currentBet,
  toCall,
  fraction,
}: {
  totalPot: number
  currentBet: number
  toCall: number
  fraction: number
}): number {
  const potAfterCall = Math.max(0, totalPot) + Math.max(0, toCall)
  return Math.round(Math.max(0, currentBet) + fraction * potAfterCall)
}

const RAISE_PRESET_FRACTIONS = [
  { label: '1/4 Pot', fraction: 0.25 },
  { label: '1/2 Pot', fraction: 0.5 },
  { label: '3/4 Pot', fraction: 0.75 },
  { label: 'Pot', fraction: 1 },
] as const

/**
 * Pot-fraction presets for the desktop tray. Min is its own button, so any
 * preset that would equal it (or be illegal, or be a shove) is dropped.
 */
export function buildRaisePresetBets({
  totalPot,
  currentBet,
  toCall,
  effectiveMin,
  maxRaise,
}: {
  totalPot: number
  currentBet: number
  toCall: number
  effectiveMin: number
  maxRaise: number
}): Array<{ label: string; amount: number }> {
  const bets: Array<{ label: string; amount: number }> = []
  if (effectiveMin <= 0 || maxRaise <= 0) {
    return bets
  }

  for (const preset of RAISE_PRESET_FRACTIONS) {
    const amount = getPotFractionRaiseTo({ totalPot, currentBet, toCall, fraction: preset.fraction })
    if (amount <= effectiveMin || amount >= maxRaise) continue
    if (bets.some(bet => bet.amount === amount)) continue
    bets.push({ label: preset.label, amount })
  }

  return bets
}

/**
 * Parses what the player typed in the raise box. Returns null while the text
 * is not a usable number yet (empty, "-", "1e") so typing is never fought.
 */
export function parseRaiseDraft(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null
  }
  const value = Math.floor(Number(cleaned))
  return Number.isFinite(value) ? value : null
}

export function resolveCheckFoldPreAction(legalActions: PokerAction[]): 'check' | 'fold' | null {
  if (legalActions.includes('check')) {
    return 'check'
  }

  return legalActions.includes('fold') ? 'fold' : null
}

export function getMobileCheckCallLabel(action?: PokerAction): 'CHECK' | 'CALL' | 'CHECK / CALL' {
  if (action === 'call') {
    return 'CALL'
  }

  if (action === 'check') {
    return 'CHECK'
  }

  return 'CHECK / CALL'
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
  } else if (player.isAway) {
    tags.push('Sitting out')
  }
  return tags
}

export function getSpectatorRailState(
  lobbyPlayer: LobbyPlayer | undefined,
  isConnected: boolean,
  table: { openSeats?: number } = {}
): { canTakeSeat: boolean; actionLabel?: string; message: string } | null {
  if (!lobbyPlayer?.isSpectator) {
    return null
  }

  if (lobbyPlayer.isSeated) {
    // Standing up (or benched) mid-hand: still in the chair until it ends.
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Moving to the rail after this hand.',
    }
  }

  if (lobbyPlayer.stack <= 0) {
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      // A status, not a second prompt: the one rebuy prompt is the out-of-chips
      // card (desktop) / the between-hands dock (phones).
      message: 'Out of chips.',
    }
  }

  if (!isConnected) {
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Reconnect before taking a seat.',
    }
  }

  if (table.openSeats !== undefined && table.openSeats <= 0) {
    return {
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Table is full. You are watching until a seat opens.',
    }
  }

  return {
    canTakeSeat: true,
    actionLabel: 'Take seat',
    message: 'A seat is open: sit in from the next hand.',
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

export function resolveRaiseDraftAmount({
  currentAmount,
  effectiveMin,
  maxRaise,
  resetToMinimum,
}: {
  currentAmount: number
  effectiveMin: number
  maxRaise: number
  resetToMinimum: boolean
}): number {
  if (maxRaise <= 0) {
    return 0
  }

  if (resetToMinimum) {
    return effectiveMin
  }

  const nextAmount = Number.isFinite(currentAmount) ? currentAmount : effectiveMin
  return Math.max(effectiveMin, Math.min(maxRaise, nextAmount))
}

export function canManualRabbitHunt(state: TableState): boolean {
  return (
    state.phase === 'between_hands' &&
    state.round !== 'showdown' &&
    Boolean(state.winners?.length) &&
    state.communityCards.length < 5 &&
    !state.rabbitCards?.length
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

/** The engine's "Won $X" action line, which must wait for the payout stage. */
function isPayoutLabel(label: string | undefined): boolean {
  return Boolean(label && label.trim().toLowerCase().startsWith('won '))
}

/** Returns `value`, frozen at its last un-held value while `hold` is true. */
function useHeldValue<T>(value: T, hold: boolean): T {
  const heldRef = useRef(value)
  if (!hold) {
    heldRef.current = value
  }
  return hold ? heldRef.current : value
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
  onPeekCards,
  onCloseSettings,
  onCopyRoom,
  onShareRoom,
  onLeaveGame = () => {},
  onSendChat = () => {},
  onSendTargetChat = () => {},
  onSendEmote,
  onSendTargetEmote,
  prankEvents = NO_PRANK_EVENTS,
  onBuyShot,
  onFlickChip,
  onFeedback,
  onSendLedgerMessage,
}: PokerTableProps) {
  // Narrow screens and touch-first devices (phones, tablets, iPad landscape)
  // use the simple 2D table; wide mouse-driven screens get the 3D room.
  const isMobileViewport = useMediaQuery(TWO_D_LAYOUT_QUERY)
  const drinkContext = useDrinks()
  const isDesktopWidth = useMediaQuery('(min-width: 1024px)')
  const shouldRenderDesktopThree = isDesktopWidth && !isMobileViewport
  const showdownView = useShowdownPresentation(state)
  const showdownPresentation = showdownView.presentation
  const runItTwiceVote = state.runItTwice?.status === 'voting' ? state.runItTwice : null
  const acceptedRunItTwice = state.runItTwice?.status === 'accepted' ? state.runItTwice : null
  // Someone moved to the rail mid-hand who is still live (all-in) keeps
  // playing their hand until it ends; only then do they become a spectator.
  const viewerSeat = state.players.find(player => player.id === yourId)
  const viewerIsLive = Boolean(
    state.phase === 'in_hand' &&
    viewerSeat?.hasCards &&
    (viewerSeat.status === 'active' || viewerSeat.status === 'all_in')
  )
  const isSpectatorViewer = Boolean(
    state.lobbyPlayers.find(player => player.id === yourId)?.isSpectator
  ) && !viewerIsLive
  const liveCardRevealTargetIds = useMemo(() => new Set(
    (state.cardRevealRequests ?? [])
      .filter(request => request.requesterId === yourId && request.status === 'approved')
      .map(request => request.targetId)
  ), [state.cardRevealRequests, yourId])
  // Betting closed at an all-in: the server tables every live hand for the
  // whole table, so nothing is hidden client side.
  const isTabledRunout = state.phase === 'in_hand' && (
    state.handOdds?.mode === 'all_in' || Boolean(state.allInRunout)
  )
  const handOddsView = useMemo(() => getHandOddsView(state), [state])
  const playerNamesById = useMemo(
    () => new Map(state.players.map(player => [player.id, player.nickname])),
    [state.players]
  )
  // Hands that were tabled during this hand's runout stay face up through the
  // showdown instead of flipping back over for the reveal.
  const tabledHandsRef = useRef<{ handNumber: number; ids: Set<string> }>({ handNumber: -1, ids: new Set() })
  if (tabledHandsRef.current.handNumber !== state.handNumber) {
    tabledHandsRef.current = { handNumber: state.handNumber, ids: new Set() }
  }
  if (isTabledRunout) {
    for (const player of state.players) {
      if ((player.holeCards?.length ?? 0) === 2 && player.showCards === 'both') {
        tabledHandsRef.current.ids.add(player.id)
      }
    }
  }
  const tabledHandIds = tabledHandsRef.current.ids
  const privacyProtectedPlayers = useMemo(() => {
    if (state.phase !== 'in_hand' || isSpectatorViewer || isTabledRunout) {
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
  }, [isSpectatorViewer, isTabledRunout, liveCardRevealTargetIds, state.phase, state.players, yourId])
  const showWinnerHighlights = !showdownPresentation.isShowdown || showdownPresentation.winningHandHighlighted
  const showWinnerPayout = !showdownPresentation.isShowdown || showdownPresentation.payoutStarted
  const showWinnerResults = !showdownPresentation.isShowdown || showdownPresentation.resultsVisible
  // Lady Luck and the 7-2 bounty announce who won, so they wait for the
  // results stage instead of spoiling the reveal.
  const holdResultAnnouncements = showdownPresentation.isShowdown && !showdownPresentation.resultsVisible
  const presentedCompanion = useHeldValue(state.companion, holdResultAnnouncements)
  const presentedBounty = holdResultAnnouncements ? undefined : state.bounty
  const showdownPresentedPlayers = useMemo(() => {
    if (!showdownPresentation.isShowdown) {
      return privacyProtectedPlayers
    }

    return privacyProtectedPlayers.map(player => {
      // Keep the local player's already-known hand in place. Every other live
      // hand flips at its existing seat according to the shared timeline.
      if (player.id === yourId || tabledHandIds.has(player.id)) {
        return player
      }

      const revealMode = getShowdownRevealMode(showdownPresentation, player.id)
      return revealMode === null || revealMode === player.showCards
        ? player
        : { ...player, showCards: revealMode }
    })
  }, [privacyProtectedPlayers, showdownPresentation, tabledHandIds, yourId])
  const showdownPresentedState = useMemo(
    () => showdownPresentedPlayers === state.players && presentedCompanion === state.companion
      ? state
      : { ...state, players: showdownPresentedPlayers, companion: presentedCompanion },
    [presentedCompanion, showdownPresentedPlayers, state]
  )
  const allViewportTableView = useMemo(
    () => createThreeTableViewModel(showdownPresentedState, yourId),
    [showdownPresentedState, yourId]
  )
  const threeTableView = shouldRenderDesktopThree ? allViewportTableView : null
  const presentedThreeTableView = useMemo(() => {
    if (!threeTableView) {
      return threeTableView
    }

    const suppressWinnerEffects = !showWinnerHighlights
    const clearCollectedPot = showdownPresentation.isShowdown && showdownPresentation.payoutStarted
    // Until the payout stage nothing may spoil the result: no "Won $X" plate
    // label and every stack still shows its pre-payout amount.
    const holdPayout = showdownPresentation.isShowdown && !showdownPresentation.payoutStarted
    const pendingWinnings = new Map<string, number>()
    if (holdPayout) {
      for (const winner of state.winners ?? []) {
        pendingWinnings.set(winner.playerId, (pendingWinnings.get(winner.playerId) ?? 0) + winner.amount)
      }
    }

    if (!suppressWinnerEffects && !clearCollectedPot && !holdPayout) {
      return threeTableView
    }

    const presentPlayer = <T extends ThreeTableViewModel['players'][number]>(player: T): T => {
      if (!suppressWinnerEffects && !holdPayout) return player
      const won = pendingWinnings.get(player.id) ?? 0
      return {
        ...player,
        isWinner: suppressWinnerEffects ? false : player.isWinner,
        stack: holdPayout ? Math.max(0, player.stack - won) : player.stack,
        lastAction: holdPayout && isPayoutLabel(player.lastAction) ? undefined : player.lastAction,
        statusAction: holdPayout && isPayoutLabel(player.statusAction) ? undefined : player.statusAction,
      }
    }

    return {
      ...threeTableView,
      collectedPot: clearCollectedPot ? 0 : threeTableView.collectedPot,
      players: threeTableView.players.map(presentPlayer),
      hero: threeTableView.hero ? presentPlayer(threeTableView.hero) : threeTableView.hero,
    }
  }, [
    showWinnerHighlights,
    showdownPresentation.isShowdown,
    showdownPresentation.payoutStarted,
    state.winners,
    threeTableView,
  ])
  const latestAllInAnnouncement = allViewportTableView.allInAnnouncement
  const latestAllInActionKey = latestAllInAnnouncement?.actionKey ?? ''
  const [activeAllInAnnouncement, setActiveAllInAnnouncement] = useState<AllInAnnouncementView | null>(null)
  const consumedAllInActionKeyRef = useRef<string | null>(latestAllInActionKey || null)
  const me = state.players.find(player => player.id === yourId)
  const lobbyMe = state.lobbyPlayers.find(player => player.id === yourId)
  const actingPlayer = state.players.find(player => player.id === state.actingPlayerId)
  const isMyTurn = state.actingPlayerId === yourId
  const isInHand = state.phase === 'in_hand'

  // One action per turn. A click (or shortcut) marks that button pressed at
  // once and swallows any repeat until the server moves the turn on, so a
  // double-click or click + key can never send two actions. If the server
  // rejects it, the lock lifts after a moment and the toast explains why.
  const turnKey = `${state.handNumber}:${state.round ?? ''}:${state.actingPlayerId ?? ''}:${state.currentBet}:${me?.bet ?? 0}:${me?.status ?? ''}`
  const turnKeyRef = useRef(turnKey)
  turnKeyRef.current = turnKey
  const [pendingAction, setPendingAction] = useState<{ key: PokerAction; turnKey: string } | null>(null)
  const pendingActionRef = useRef(pendingAction)
  const isActionPending = pendingAction !== null && pendingAction.turnKey === turnKey
  useEffect(() => {
    if (!pendingAction) return
    if (pendingAction.turnKey !== turnKey) {
      pendingActionRef.current = null
      setPendingAction(null)
      return
    }
    const timeout = window.setTimeout(() => {
      pendingActionRef.current = null
      setPendingAction(null)
    }, ACTION_PENDING_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [pendingAction, turnKey])
  const isMyTurnRef = useRef(isMyTurn)
  isMyTurnRef.current = isMyTurn
  const submitAction = useCallback((action: PokerAction, amount?: number) => {
    const pending = pendingActionRef.current
    if (pending && pending.turnKey === turnKeyRef.current) return
    // A local server can answer before the second click of a double-click
    // lands and hand the turn to someone else: never act off-turn.
    if (!isMyTurnRef.current) return
    const next = { key: action, turnKey: turnKeyRef.current }
    pendingActionRef.current = next
    setPendingAction(next)
    onAction(action, amount)
  }, [onAction])
  const betweenHands = !isInHand
  const hasCompletedHandWinner = betweenHands && Boolean(state.winners?.length)
  const isSpectator = isSpectatorViewer
  const isCompletedHandReveal = state.phase === 'between_hands' && Boolean(state.winners?.length)
  const isFoldedViewer = me?.status === 'folded' && (isInHand || isCompletedHandReveal)
  const canShowRevealedCards = isSpectator || hasCompletedHandWinner || isTabledRunout
  const canAdjustShownCards = Boolean(me?.holeCards?.length) && hasCompletedHandWinner
  const cardRevealRequests = state.cardRevealRequests ?? []
  const pendingIncomingCardRequest = cardRevealRequests.find(request => (
    request.targetId === yourId && request.status === 'pending'
  ))
  const incomingCardRequester = pendingIncomingCardRequest
    ? state.players.find(player => player.id === pendingIncomingCardRequest.requesterId)
    : undefined
  // Only offer "See / Ask" where it can still show something: not for hands
  // the table is already seeing (a showdown reveal, cards shown by choice),
  // unless this viewer has a request running for them.
  const showdownParticipantIds = new Set(
    showdownPresentation.isShowdown ? showdownView.participants.map(player => player.id) : []
  )
  const requestableCardPlayers = isFoldedViewer
      ? privacyProtectedPlayers.filter(player => {
        if (
          player.id === yourId ||
          !player.hasCards ||
          !(player.status === 'active' || player.status === 'all_in' || player.status === 'folded')
        ) {
          return false
        }
        const hasOwnRequest = cardRevealRequests.some(request => (
          request.requesterId === yourId && request.targetId === player.id
        ))
        if (hasOwnRequest) return true
        const alreadyVisible = Boolean(player.holeCards?.length) && player.showCards !== 'none'
        return !alreadyVisible && !showdownParticipantIds.has(player.id)
      })
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
  // A hand won by everyone folding ends with the street's bets still set on
  // the players; those chips already went to the winner, so drop the label.
  const heroTableBetAmount = !isSpectator && me && isInHand ? me.bet : 0
  const showHeroBottomSummary = Boolean(threeTableView && visibleOwnPlayer && !isSpectator)
  // A rabbit hunt deals the streets nobody played. They arrive separately in
  // state.rabbitCards, are drawn dimmed after the real board and never feed a
  // hand-strength label.
  const rabbitCards = useMemo(
    () => betweenHands && state.round !== 'showdown' ? state.rabbitCards ?? [] : [],
    [betweenHands, state.rabbitCards, state.round]
  )
  const rabbitCardCount = rabbitCards.length
  const playedBoardCards = state.communityCards
  const boardCardsWithRabbit = useMemo(
    () => rabbitCardCount > 0 ? [...state.communityCards, ...rabbitCards] : state.communityCards,
    [rabbitCardCount, rabbitCards, state.communityCards]
  )
  const heroWentToShowdown = showdownPresentation.isShowdown &&
    showdownView.participants.some(player => player.id === yourId)
  // A folded hand has no strength to report, including between hands.
  const ownHandHasFolded = visibleOwnPlayer?.status === 'folded'
  const ownHandDescription = useMemo(
    () => ownHandHasFolded || acceptedRunItTwice
      ? null
      : getVisibleOwnHandDescription(ownHandCards, playedBoardCards),
    [acceptedRunItTwice, ownHandHasFolded, ownHandCards, playedBoardCards]
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
  }, [latestAllInActionKey])

  // Clear the banner on its own timer: tying it to the latest action key let a
  // new snapshot cancel the timeout and leave a ghost banner on screen.
  const activeAllInActionKey = activeAllInAnnouncement?.actionKey ?? null
  useEffect(() => {
    if (!activeAllInActionKey) {
      return
    }

    const timeout = window.setTimeout(() => {
      setActiveAllInAnnouncement(current => (
        current?.actionKey === activeAllInActionKey ? null : current
      ))
    }, ALL_IN_ANNOUNCEMENT_MS)

    return () => window.clearTimeout(timeout)
  }, [activeAllInActionKey])
  const [socialTick, setSocialTick] = useState(() => Date.now())
  const [targetEmotePlayerId, setTargetEmotePlayerId] = useState<string | null>(null)
  const [targetEmotePickerOpen, setTargetEmotePickerOpen] = useState(false)
  const [flickReadyAt, setFlickReadyAt] = useState(0)
  const [targetQuickEmotes, setTargetQuickEmotes] = useState<string[]>(() => (
    [...DEFAULT_TARGETED_QUICK_EMOTES]
  ))
  const targetEmoteTriggerRef = useRef<HTMLElement | null>(null)
  const playerIds = useMemo(() => state.players.map(player => player.id), [state.players])
  const playerIdSet = useMemo(() => new Set(playerIds), [playerIds])
  const threeEmoteReactions = useMemo(
    () => createThreeEmoteReactions(
      socialState,
      playerIds,
      socialTick,
      getEmoteGlyph,
      id => state.lobbyPlayers.find(player => player.id === id)?.nickname
    ),
    [playerIds, socialState, socialTick, state.lobbyPlayers]
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

  // 2D seat grid: everyone but the hero (once the hero has cards), in table order.
  const mobileEdgeOpponents = useMemo<OpponentSeat[]>(
    () => orderedOpponents.filter(player => !(shouldShowOwnHand && !isSpectator && player.id === yourId)),
    [isSpectator, orderedOpponents, shouldShowOwnHand, yourId]
  )

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
  // Desktop keeps the tray up (buttons disabled) through a brief reconnect so
  // the decision does not vanish; mobile has its own reconnect banner.
  const turnActions = useMemo<Array<'fold' | 'check' | 'call' | 'raise' | 'all_in'>>(() => {
    if (!isMyTurn || !me || me.status !== 'active') {
      return []
    }
    const actions: Array<'fold' | 'check' | 'call' | 'raise' | 'all_in'> = ['fold']
    if (canCheck) actions.push('check')
    else if (toCall > 0) actions.push('call')
    if (me.stack > toCall) actions.push('raise')
    actions.push('all_in')
    return actions
  }, [canCheck, isMyTurn, me, toCall])
  const isTrayReconnecting = !isConnected && !isMobileViewport && turnActions.length > 0
  const trayActions = legalActions.length > 0 ? legalActions : isTrayReconnecting ? turnActions : legalActions
  const hasActionTray = isInHand && isMyTurn && Boolean(me) && trayActions.length > 0
  // Pre-actions: queued while someone else decides, sent as a normal action
  // only from a snapshot where it really is your turn (the server still
  // validates it). A queue lives for one hand and one street.
  const [queuedPreAction, setQueuedPreAction] = useState<QueuedPreAction | null>(null)
  const [preActionNote, setPreActionNote] = useState<{ id: number; text: string; tone: 'done' | 'cancelled' } | null>(null)
  const preActionToCall = Math.max(0, toCall)
  const canQueuePreAction = Boolean(
    isInHand &&
    state.actingPlayerId &&
    !isMyTurn &&
    me?.status === 'active' &&
    visibleOwnPlayer &&
    isConnected &&
    !settingsOpen
  )
  // The chips keep their slot for the whole time you are live in the hand:
  // between streets (nobody to act yet) they stay put, just inactive, instead
  // of vanishing and reflowing the table under your thumb for a second.
  const preActionSlotLive = Boolean(
    isInHand &&
    !isMyTurn &&
    me?.status === 'active' &&
    visibleOwnPlayer &&
    isConnected &&
    !settingsOpen
  )
  const showPreActionBar = preActionSlotLive && (
    isMobileViewport || Boolean(threeTableView)
  )
  const meStack = me?.stack ?? 0
  const preActionOptions = useMemo(
    () => showPreActionBar ? getPreActionOptions({ toCall: preActionToCall, stack: meStack }) : [],
    [meStack, preActionToCall, showPreActionBar]
  )

  const togglePreAction = useCallback((kind: PreActionKind) => {
    setQueuedPreAction(current => (
      isPreActionOptionActive(current, kind)
        ? null
        : createPreAction(kind, { handNumber: state.handNumber, round: state.round, toCall: preActionToCall })
    ))
  }, [preActionToCall, state.handNumber, state.round])

  useEffect(() => {
    if (!preActionNote) {
      return
    }
    const timeout = window.setTimeout(() => {
      setPreActionNote(current => (current?.id === preActionNote.id ? null : current))
    }, preActionNote.tone === 'cancelled' ? 4200 : 2400)
    return () => window.clearTimeout(timeout)
  }, [preActionNote])

  useEffect(() => {
    if (!queuedPreAction) {
      return
    }

    const check = reconcilePreAction(queuedPreAction, {
      handNumber: state.handNumber,
      round: state.round,
      toCall: preActionToCall,
      isLive: isInHand && me?.status === 'active' && isConnected && !settingsOpen,
    })
    if (!check.keep) {
      setQueuedPreAction(null)
      if (check.note) {
        setPreActionNote({ id: Date.now(), text: check.note, tone: 'cancelled' })
      }
      return
    }

    if (!isMyTurn || legalActions.length === 0) {
      return
    }

    const action = resolvePreAction(queuedPreAction, {
      handNumber: state.handNumber,
      round: state.round,
      toCall: preActionToCall,
      legalActions,
    })
    setQueuedPreAction(null)
    if (!action) {
      return
    }
    submitAction(action)
    setPreActionNote({ id: Date.now(), text: describeAutoAction(action, preActionToCall), tone: 'done' })
  }, [
    isConnected,
    isInHand,
    isMyTurn,
    legalActions,
    me?.status,
    submitAction,
    preActionToCall,
    queuedPreAction,
    settingsOpen,
    state.handNumber,
    state.round,
  ])

  // What you face when the action reaches you, spelled out.
  const turnPromptInput = useMemo<TurnPromptInput | null>(() => (
    me && isMyTurn
      ? {
        round: state.round,
        toCall: Math.max(0, toCall),
        stack: me.stack,
        myBet: me.bet,
        currentBet: state.currentBet,
        isSB: me.isSB,
        isBB: me.isBB,
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        hasActedThisRound: me.hasActedThisRound,
      }
      : null
  ), [isMyTurn, me, state.bigBlind, state.currentBet, state.round, state.smallBlind, toCall])
  const turnPrompt = useMemo(
    () => turnPromptInput ? getTurnPrompt(turnPromptInput) : null,
    [turnPromptInput]
  )
  const heroTurnKey = isMyTurn && isInHand
    ? `${state.handNumber}:${state.round ?? 'none'}:${state.actionSequence ?? 0}`
    : null

  // One-time beginner tip for a blind's first decision.
  const [blindTipDismissed, setBlindTipDismissed] = useState(true)
  useEffect(() => {
    try {
      setBlindTipDismissed(window.localStorage.getItem(BLIND_TIP_STORAGE_KEY) === '1')
    } catch {
      setBlindTipDismissed(false)
    }
  }, [])
  const dismissBlindTip = useCallback(() => {
    setBlindTipDismissed(true)
    try {
      window.localStorage.setItem(BLIND_TIP_STORAGE_KEY, '1')
    } catch {
      // Storage is optional; the tip just stays hidden for this session.
    }
  }, [])
  const blindTip = !blindTipDismissed && turnPromptInput && !queuedPreAction
    ? getBlindTip(turnPromptInput)
    : null
  // Seen once is enough: when the decision it explained is over, retire it.
  const blindTipShownRef = useRef(false)
  useEffect(() => {
    if (blindTip) {
      blindTipShownRef.current = true
    } else if (blindTipShownRef.current && !isMyTurn) {
      blindTipShownRef.current = false
      dismissBlindTip()
    }
  }, [blindTip, dismissBlindTip, isMyTurn])

  // A short buzz on phones when the action reaches you (the chime is played
  // by the room soundscape and follows the mute setting).
  useEffect(() => {
    if (!heroTurnKey || !isMobileViewport || queuedPreAction) {
      return
    }
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return
    }
    try {
      navigator.vibrate([35, 60, 35])
    } catch {
      // Some browsers refuse without a recent user gesture.
    }
    // Only a new decision should buzz, not a queue change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroTurnKey, isMobileViewport])

  const maxRaise = me ? me.stack + me.bet : 0
  const effectiveMin = Math.min(state.minRaise, maxRaise)
  const [raiseAmount, setRaiseAmount] = useState(effectiveMin)
  const bettingDecisionKey = `${state.handNumber}:${state.round ?? 'none'}:${state.actingPlayerId ?? 'none'}`
  // 2D tray: Fold / Call / Raise first; sizing only opens after tapping Raise.
  const [raiseSizingOpen, setRaiseSizingOpen] = useState(false)

  useEffect(() => {
    setRaiseSizingOpen(false)
  }, [bettingDecisionKey])

  // Phones: the pre-action chips reserve the plain action tray's height, so
  // the table doesn't shift up and down every time the action reaches you.
  const mobileTrayRef = useRef<HTMLDivElement | null>(null)
  const [mobileTrayHeight, setMobileTrayHeight] = useState(0)
  const measureMobileTray = isMobileViewport && hasActionTray
  useEffect(() => {
    const tray = mobileTrayRef.current
    if (!measureMobileTray || !tray) {
      return
    }
    const read = () => {
      if (!tray.isConnected || tray.offsetHeight === 0) {
        return
      }
      // The plain tray: leave out the optional rows (blind tip, auto-action
      // note, raise sizing) that come and go on top of it.
      const gap = parseFloat(getComputedStyle(tray).rowGap) || 0
      let height = tray.offsetHeight
      tray.querySelectorAll<HTMLElement>(':scope > .blind-tip, :scope > .pre-action-note, :scope > .mobile-raise-sizing').forEach(row => {
        height -= row.offsetHeight + gap
      })
      height = Math.round(height)
      setMobileTrayHeight(current => (Math.abs(current - height) > 1 ? height : current))
    }
    read()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(read)
    observer.observe(tray)
    return () => observer.disconnect()
  }, [measureMobileTray])

  useEffect(() => {
    setRaiseAmount(current => resolveRaiseDraftAmount({
      currentAmount: current,
      effectiveMin,
      maxRaise,
      resetToMinimum: isMyTurn,
    }))
  }, [bettingDecisionKey, effectiveMin, isMyTurn, maxRaise])

  const quickBets = useMemo(() => (
    me
      ? buildRaisePresetBets({
        totalPot: state.totalPot,
        currentBet: state.currentBet,
        toCall: Math.max(0, toCall),
        effectiveMin,
        maxRaise,
      })
      : []
  ), [effectiveMin, maxRaise, me, state.currentBet, state.totalPot, toCall])

  // Raw text in the desktop raise box while the player types; clamped only
  // on blur / Enter / submit so "150" is never rewritten mid-keystroke.
  const [raiseDraft, setRaiseDraft] = useState<string | null>(null)
  const raiseInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setRaiseDraft(null)
  }, [bettingDecisionKey])

  const clampRaiseAmount = useCallback((amount: number) => {
    if (maxRaise <= 0) {
      return 0
    }

    return Math.max(effectiveMin, Math.min(maxRaise, amount))
  }, [effectiveMin, maxRaise])

  const parsedRaiseDraft = raiseDraft === null ? null : parseRaiseDraft(raiseDraft)
  const displayRaiseAmount = parsedRaiseDraft === null
    ? raiseAmount
    : clampRaiseAmount(parsedRaiseDraft)
  const raiseDraftHint = parsedRaiseDraft !== null && parsedRaiseDraft < effectiveMin
    ? 'below-min'
    : parsedRaiseDraft !== null && parsedRaiseDraft > maxRaise
      ? 'above-max'
      : null

  const setClampedRaiseAmount = useCallback((amount: number) => {
    setRaiseDraft(null)
    setRaiseAmount(clampRaiseAmount(amount))
  }, [clampRaiseAmount])

  const commitRaiseDraft = useCallback((): number => {
    const amount = clampRaiseAmount(parsedRaiseDraft ?? raiseAmount)
    setRaiseDraft(null)
    setRaiseAmount(amount)
    return amount
  }, [clampRaiseAmount, parsedRaiseDraft, raiseAmount])

  const adjustRaiseAmount = useCallback((delta: number) => {
    const base = clampRaiseAmount(parsedRaiseDraft ?? raiseAmount)
    setRaiseDraft(null)
    setRaiseAmount(clampRaiseAmount(base + delta))
  }, [clampRaiseAmount, parsedRaiseDraft, raiseAmount])

  const handleRaise = useCallback(() => {
    if (!isConnected) {
      onFeedback('You are reconnecting. Raise is disabled until the table is live again.', 'error')
      return
    }

    submitAction('raise', commitRaiseDraft())
  }, [commitRaiseDraft, isConnected, submitAction, onFeedback])

  const turnTimer = useTurnTimer(
    state.actionTimerStart,
    state.actionTimerDuration,
    state.serverNow
  )
  // Everyone sees the acting opponent's clock drain on their nameplate.
  const opponentTimerVisible = isInHand && Boolean(actingPlayer) && !isMyTurn && Boolean(state.actionTimerStart)

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

  const activeSocialByPlayer = useMemo(
    () => buildActiveSocialByPlayer(socialState.active, socialTick),
    [socialState.active, socialTick]
  )
  const heroSocial = activeSocialByPlayer.get(yourId) ?? {}

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
  const winnerSeatMap = useMemo(() => new Map([
    [yourId, 0],
    ...orderedOpponents.map(player => [player.id, player.visualSeat] as const),
  ]), [orderedOpponents, yourId])
  const winnerSeatTargets = WINNER_SEAT_TARGETS
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
          displayName: getMobileSeatName(player),
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
  // Auto-deal needs two funded seats. When a hand leaves fewer (e.g. a heads-up
  // bust), keep the lobby controls reachable once the showdown has played out.
  const fundedSeatCount = state.players.filter(player => (
    player.stack > 0 && player.status !== 'disconnected' && player.status !== 'sitting_out'
  )).length
  const showLobbyControls = betweenHands && (
    winnerDisplays.length === 0 ||
    (fundedSeatCount < 2 && (!showdownPresentation.isShowdown || showdownPresentation.complete))
  )
  const showManualRabbitHunt = canManualRabbitHunt(state) && Boolean(onRabbitHunt)
  const hasVisibleRabbitRunout = rabbitCardCount > 0

  // Hold the payout until the showdown presentation reaches it: winners keep
  // their pre-payout stacks and the pot stays in the middle, then it empties.
  const winnerTotals = new Map<string, number>()
  for (const winner of state.winners ?? []) {
    winnerTotals.set(winner.playerId, (winnerTotals.get(winner.playerId) ?? 0) + winner.amount)
  }
  const hasHandResult = betweenHands && winnerTotals.size > 0
  const isPayoutPending = hasHandResult &&
    showdownPresentation.isShowdown &&
    !showdownPresentation.payoutStarted
  const presentedPot = hasHandResult
    ? isPayoutPending ? [...winnerTotals.values()].reduce((sum, amount) => sum + amount, 0) : 0
    : state.totalPot
  const getDisplayStack = (player: Pick<SeatPlayer, 'id' | 'stack'>) => (
    isPayoutPending ? Math.max(0, player.stack - (winnerTotals.get(player.id) ?? 0)) : player.stack
  )
  const everyoneFolded = hasHandResult && !isTrueShowdown(state) && !acceptedRunItTwice
  // Busted: no chips left once the hand is over (still seated, or already on the rail).
  const isBustedViewer = !isSpectator && hasHandResult && Boolean(me) && me!.stack <= 0 &&
    (!showdownPresentation.isShowdown || showdownPresentation.complete)
  const isRailBusted = Boolean(lobbyMe?.isSpectator && lobbyMe.stack <= 0 && !me)
  const openSeatCount = Math.max(0, 8 - state.players.length)
  const spectatorRailState = getSpectatorRailState(lobbyMe, isConnected, { openSeats: openSeatCount })
  const canRetakeSeat = Boolean(spectatorRailState?.canTakeSeat)
  // On the rail (not in a chair): the watching bar / dock is always up.
  const isOnRail = Boolean(lobbyMe?.isSpectator && !me)

  const tableCenterLabel = me
      ? me.nickname.toUpperCase()
      : 'TABLE VIEW'
  // One short line: the action bar already shows what a call costs.
  const mobileHeroStatus = !isConnected
    ? 'Reconnecting'
    : betweenHands && isPayoutPending
      ? 'Showdown'
      : betweenHands
      ? showWinnerResults && myWinnerAmount > 0
        ? `Won ${formatAmount(myWinnerAmount)}`
        : isBustedViewer
          ? 'Out of chips'
          : 'Waiting'
      : isMyTurn
        ? 'Your turn'
        : me?.status === 'folded'
          ? 'Folded'
          : me?.status === 'all_in'
            ? 'All-in'
            : actingPlayer
              ? `${getMobileSeatName(actingPlayer)}'s turn`
              : 'In hand'

  const othersCanRespond = canAnyOpponentRespond(state.players, yourId)
  const actionButtonDescriptors = useMemo(
    () => buildActionButtonDescriptors({
      legalActions: trayActions,
      toCall,
      raiseAmount: displayRaiseAmount,
      allInAmount: me ? me.stack + me.bet : undefined,
      othersCanRespond,
      isOpeningBet: state.currentBet === 0,
    }),
    [displayRaiseAmount, me, othersCanRespond, state.currentBet, toCall, trayActions]
  )

  const actionButtons = useMemo(() => {
    return actionButtonDescriptors.map(actionButton => {
      const onClick = actionButton.key === 'raise'
        ? handleRaise
        : () => submitAction(actionButton.key)

      return {
        ...actionButton,
        onClick,
      }
    })
  }, [actionButtonDescriptors, handleRaise, submitAction])
  // Facing an all-in with only Fold / Call left there is nothing to size.
  const showDesktopRaiseSizing = effectiveMin > 0 &&
    actionButtons.some(actionButton => actionButton.key === 'raise')

  // Desktop keyboard shortcuts: F fold, C check/call, R size the raise,
  // A all-in, Enter confirm the raise, Up/Down nudge the size by a big blind.
  useEffect(() => {
    if (!hasActionTray || isMobileViewport || settingsOpen || isTrayReconnecting) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
        return
      }

      const target = event.target instanceof HTMLElement ? event.target : null
      if (target && target === raiseInputRef.current) {
        return
      }
      const isRange = target instanceof HTMLInputElement && target.type === 'range'
      const isTyping = Boolean(target && (
        target.isContentEditable ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        (target.tagName === 'INPUT' && !isRange)
      ))
      if (isTyping) {
        return
      }

      const byKey = (key: PokerAction) => actionButtons.find(actionButton => actionButton.key === key)
      let handled = true
      switch (event.key.toLowerCase()) {
        case 'f':
          if (byKey('fold')) byKey('fold')!.onClick()
          else handled = false
          break
        case 'c': {
          const checkOrCall = byKey('check') ?? byKey('call')
          if (checkOrCall) checkOrCall.onClick()
          else handled = false
          break
        }
        case 'a':
          if (byKey('all_in')) byKey('all_in')!.onClick()
          else handled = false
          break
        case 'r':
          if (raiseInputRef.current) {
            raiseInputRef.current.focus()
            raiseInputRef.current.select()
          } else handled = false
          break
        case 'enter':
          // A focused button already activates itself on Enter.
          if (target?.tagName !== 'BUTTON' && byKey('raise')) byKey('raise')!.onClick()
          else handled = false
          break
        case 'arrowup':
        case 'arrowdown':
          if (!isRange && showDesktopRaiseSizing) {
            adjustRaiseAmount((event.key === 'ArrowUp' ? 1 : -1) * Math.max(state.bigBlind, 1))
          } else handled = false
          break
        default:
          handled = false
      }

      if (handled) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    actionButtons,
    adjustRaiseAmount,
    hasActionTray,
    isMobileViewport,
    isTrayReconnecting,
    settingsOpen,
    showDesktopRaiseSizing,
    state.bigBlind,
  ])

  const mobileFoldAction = actionButtons.find(actionButton => actionButton.key === 'fold')
  const mobileCheckCallAction = actionButtons.find(actionButton => actionButton.key === 'call' || actionButton.key === 'check')
  const mobileBetRaiseAction = actionButtons.find(actionButton => actionButton.key === 'raise')
  const mobileAllInAction = actionButtons.find(actionButton => actionButton.key === 'all_in')
  const mobileRaiseStep = Math.max(state.bigBlind, 1)
  const mobileRaiseBlindCount = state.bigBlind > 0
    ? Math.max(1, Math.round(raiseAmount / state.bigBlind))
    : raiseAmount
  const canMobileRaise = Boolean(mobileBetRaiseAction) && effectiveMin > 0
  // Sizing to the whole stack sends the existing all-in action, exactly like the old All In button.
  const mobileRaiseIsAllIn = Boolean(mobileAllInAction) && (
    !canMobileRaise || (maxRaise > 0 && raiseAmount >= maxRaise)
  )
  const mobileRaiseLabel = mobileRaiseIsAllIn
    ? 'All-in'
    : state.currentBet > 0
      ? 'Raise to'
      : 'Bet'
  const mobileRaiseFill = maxRaise > effectiveMin
    ? Math.round(((raiseAmount - effectiveMin) / (maxRaise - effectiveMin)) * 1000) / 10
    : 100
  const mobileQuickBets = [
    { key: 'min', label: 'Min', amount: effectiveMin },
    { key: 'half', label: '½ Pot', amount: Math.floor(state.totalPot / 2) },
    { key: 'three-quarter', label: '¾ Pot', amount: Math.floor((state.totalPot * 3) / 4) },
    { key: 'pot', label: 'Pot', amount: state.totalPot },
    { key: 'all-in', label: 'All-in', amount: maxRaise },
  ]
  const activeMobileQuickBet = mobileQuickBets.find(quickBet => (
    clampRaiseAmount(quickBet.amount) === raiseAmount
  ))?.key
  // While the tray is up the note rides inside it instead.
  const preActionNoteElement = preActionNote ? (
    <div
      key={preActionNote.id}
      className={`pre-action-note is-${preActionNote.tone}`}
      role="status"
      aria-live="polite"
    >
      {preActionNote.text}
    </div>
  ) : null
  const preActionDock = showPreActionBar || (preActionNote && !hasActionTray) ? (
    <div className="check-fold-pre-action-dock" data-has-bar={showPreActionBar ? 'true' : 'false'}>
      {preActionNote && !hasActionTray && (
        <div
          key={preActionNote.id}
          className={`pre-action-note is-${preActionNote.tone}`}
          role="status"
          aria-live="polite"
        >
          {preActionNote.text}
        </div>
      )}
      {showPreActionBar && preActionOptions.length > 0 && (
        <PreActionBar
          options={preActionOptions}
          queued={queuedPreAction}
          onToggle={togglePreAction}
          disabled={!canQueuePreAction}
          showShortcuts={!isMobileViewport}
        />
      )}
    </div>
  ) : null

  // Desktop: 1 / 2 / 3 toggle the pre-action chips while someone else acts.
  useEffect(() => {
    if (!showPreActionBar || !canQueuePreAction || isMobileViewport || preActionOptions.length === 0) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
        return
      }
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target && (
        target.isContentEditable ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'INPUT'
      )) {
        return
      }
      const index = (PRE_ACTION_SHORTCUT_KEYS as readonly string[]).indexOf(event.key)
      const option = index >= 0 ? preActionOptions[index] : undefined
      if (!option) {
        return
      }
      event.preventDefault()
      togglePreAction(option.kind)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canQueuePreAction, isMobileViewport, preActionOptions, showPreActionBar, togglePreAction])

  const tableWaitingCopy = !isConnected
    ? 'Restoring the room snapshot and reconnecting your seat.'
    : state.players.length < 2
      ? 'Share the room code and fill the open seats to kick off the next hand.'
      : isHost
        ? 'The table is ready. Deal whenever everyone looks settled.'
        : 'The table is ready. Waiting for the game creator to deal.'
  const waitingStatusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const desktopWaitingBannerTitle = !isConnected
    ? 'Reconnecting'
    : state.players.length < 2
      ? 'Waiting for players'
      : 'Ready for the next hand'
  const desktopWaitingBannerCopy = tableWaitingCopy
  const bettingTrayHeader = turnPrompt?.headline ?? (
    toCall > 0 ? `To call ${formatAmount(toCall)}` : 'Action live'
  )
  const turnFocusDetail = isMyTurn
    ? turnPrompt?.headline ?? 'Your decision'
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

  const handleBuyShot = useCallback(() => {
    if (!targetedPlayer || !onBuyShot) return
    onBuyShot(targetedPlayer.id)
    closeTargetedEmote()
  }, [closeTargetedEmote, onBuyShot, targetedPlayer])

  const handleFlickChip = useCallback(() => {
    if (!targetedPlayer || !onFlickChip) return
    onFlickChip(targetedPlayer.id)
    setFlickReadyAt(Date.now() + CHIP_FLICK_COOLDOWN_MS)
    closeTargetedEmote()
  }, [closeTargetedEmote, onFlickChip, targetedPlayer])

  // Pranks: desktop only (phones have none of it, either direction), fun mode
  // on, you are seated, and the target is someone else at the table.
  const canPrankTarget = Boolean(
    !isMobileViewport &&
    targetedPlayer &&
    me &&
    targetedPlayer.id !== yourId &&
    targetedPlayer.drinkCapable === true &&
    state.funModeEnabled !== false &&
    (onBuyShot || onFlickChip)
  )
  const canShootTarget = Boolean(canPrankTarget && onBuyShot)
  const shotBlockReason = targetedPlayer && canShootTarget
    ? getShotBlockReasonFromState(me?.drinks, targetedPlayer.drinks, state.handNumber, targetedPlayer.nickname)
    : null
  const targetIsLive = Boolean(targetedPlayer && isLiveInHand({
    phase: state.phase,
    status: targetedPlayer.status,
    holdsCards: targetedPlayer.hasCards,
  }))
  const shotsAlreadyWaiting = targetedPlayer?.drinks?.shotsWaiting ?? 0
  const shotCooldownHands = Math.max(0, (me?.drinks?.shotReadyAtHand ?? 0) - state.handNumber)
  // Tooltip only: the table itself stays wordless.
  const shotNote = shotBlockReason ?? (
    shotsAlreadyWaiting > 0
      ? `${shotsAlreadyWaiting} already waiting; they land one at a time`
      : targetIsLive
        ? '+3, poured after this hand'
        : '+3, one every 5 hands'
  )

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

  const showdownCinematic = (
    <ShowdownCinematic
      state={state}
      presentation={showdownPresentation}
      onSoundCue={onSoundCue}
    />
  )
  const showMobileWinnerSummary = betweenHands &&
    showWinnerResults &&
    winnerDisplays.length > 0 &&
    !acceptedRunItTwice
  const nameForPlayerId = (playerId: string): string => {
    if (playerId === yourId) {
      return 'You'
    }
    const seated = state.players.find(player => player.id === playerId)
    if (seated) {
      return getMobileSeatName(seated)
    }
    return state.lobbyPlayers.find(player => player.id === playerId)?.nickname ?? 'Someone'
  }
  const showMobileShowCardsToggle = Boolean(
    isMobileViewport && canAdjustShownCards && me && !isSpectator && !settingsOpen && !heroWentToShowdown
  )
  const heroCardsShownToTable = Boolean(me && me.showCards !== 'none')
  const mobileAllInAnnouncement = activeAllInAnnouncement
    ? { ...activeAllInAnnouncement, nickname: activeAllInAnnouncement.nickname.replace(/^Bot\s+/i, '') }
    : null

  return (
    <div
      className="table-scene"
      data-phase={state.phase}
      data-hero-seat={shouldShowOwnHand ? 'true' : 'false'}
      data-crowded-reveal={state.players.filter(player => player.id !== yourId && (player.holeCards?.length ?? 0) > 0).length >= 3 ? 'true' : 'false'}
      data-player-count={state.players.length}
      data-show-cards={canAdjustShownCards && !settingsOpen ? 'true' : 'false'}
      data-suit-colors={suitColorMode}
      data-tray-open={hasActionTray ? 'true' : 'false'}
      data-desktop-three={threeTableView ? 'true' : 'false'}
      data-showdown={showdownPresentation.isShowdown ? 'true' : 'false'}
      data-run-it-twice={state.runItTwice?.status ?? 'none'}
      data-showdown-stage={showdownPresentation.stage}
      data-settings-open={settingsOpen ? 'true' : 'false'}
      data-layout={isMobileViewport ? '2d' : 'desktop'}
      data-acting-timer={opponentTimerVisible ? (turnTimer.percent < 25 ? 'low' : 'live') : 'none'}
      style={{
        ...(isMobileViewport && mobileTrayHeight > 0 ? { ['--mobile-tray-h' as string]: `${mobileTrayHeight}px` } : {}),
      } as CSSProperties}
    >
      {threeTableView ? (
        <DesktopPokerRoom3D
          view={presentedThreeTableView ?? threeTableView}
          prankEvents={prankEvents}
          drinkEvents={drinkContext?.events}
          emoteReactions={threeEmoteReactions}
          chatMessages={threeChatMessages}
          selectedTargetId={targetEmotePlayerId}
          onSelectPlayer={handleSelectEmoteTarget}
          cardRevealActions={cardRevealActions}
          onRequestCardReveal={onRequestCardReveal}
          highlightedCards={highlightedWinningCards}
          actingTimerPercent={opponentTimerVisible ? turnTimer.percent : undefined}
        />
      ) : null}
      {!isMobileViewport && showdownCinematic}
      {!isMobileViewport && lobbyMe?.isSpectator && spectatorRailState && !settingsOpen ? (
        <div className="spectator-watch-bar" role="status" aria-label="Watching">
          <span className="spectator-watch-live" aria-hidden="true" />
          <strong>Watching</strong>
          <span className="spectator-watch-detail">{spectatorRailState.message}</span>
          {spectatorRailState.canTakeSeat && (
            <button type="button" className="btn-subtle btn-subtle-gold" onClick={onSeatMe}>
              {spectatorRailState.actionLabel}
            </button>
          )}
        </div>
      ) : null}
      {!isMobileViewport && handOddsView && !settingsOpen ? (
        <div className="hand-odds-dock">
          <HandOddsPanel view={handOddsView} names={playerNamesById} yourId={yourId} />
        </div>
      ) : null}
      {!isMobileViewport && <BountyToast bounty={presentedBounty} players={state.players} />}
      {/* Both layouts: the desktop 3D room stays mounted through a socket drop. */}
      {!isConnected && (
        <div className="mobile-reconnect-banner" role="status" aria-live="polite">
          <span className="mobile-reconnect-dot" aria-hidden="true" />
          Reconnecting…
        </div>
      )}
      {/* Held back while it is your turn so it never covers the action. */}
      {pendingIncomingCardRequest && incomingCardRequester && !settingsOpen && !hasActionTray ? (
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
          <div
            className="mobile-poker-field"
            role="region"
            aria-label="Mobile poker field"
            data-seat-count={mobileEdgeOpponents.length}
            data-hero-lane={shouldShowOwnHand && visibleOwnPlayer ? 'true' : 'false'}
          >
            <div className="mobile-arena">
            <div
              className="mobile-seat-grid mobile-edge-seats"
              aria-label="Players"
              data-seat-count={mobileEdgeOpponents.length}
            >
              {mobileEdgeOpponents.map((player, seatIndex) => {
                const seatSocial = activeSocialByPlayer.get(player.id) ?? {}
                const isActingSeat = state.actingPlayerId === player.id

                return (
                  <div
                    key={player.id}
                    className={`mobile-edge-seat-position mobile-seat-position-${player.visualSeat}`}
                    data-slot={getMobileSeatSlot(seatIndex, mobileEdgeOpponents.length)}
                  >
                    <MobileEdgeSeat
                      player={player}
                      visualSeat={player.visualSeat}
                      displayStack={getDisplayStack(player)}
                      isActing={isActingSeat}
                      secondsLeft={isActingSeat ? turnTimer.secondsLeft : undefined}
                      timerPercent={isActingSeat ? turnTimer.percent : undefined}
                      isWinner={betweenHands && showWinnerHighlights && winnerAmounts.has(player.id)}
                      winnerAmount={winnerTotals.get(player.id)}
                      winningCards={winnerCardsByPlayer.get(player.id)}
                      cardRevealControl={cardRevealActionByPlayerId.has(player.id) ? (
                        <CardRevealSeatButton
                          action={cardRevealActionByPlayerId.get(player.id)!}
                          onRequest={onRequestCardReveal}
                        />
                      ) : null}
                      onNameClick={handleSelectEmoteTarget}
                      isSelf={player.id === yourId}
                      odds={handOddsView?.byPlayer.get(player.id)}
                      isHandLive={isInHand}
                    />
                    <CompanionBadge companion={presentedCompanion} playerId={player.id} />
                    {(seatSocial.message || seatSocial.emote) && (
                      <div className="mobile-edge-social" aria-live="polite">
                        {seatSocial.emote && seatSocial.emoteSenderId && (
                          <span className="mobile-social-from">
                            {nameForPlayerId(seatSocial.emoteSenderId)} →
                          </span>
                        )}
                        {seatSocial.emote && <EmojiGlyph emoji={seatSocial.emote} />}
                        {seatSocial.message && <span className="mobile-social-message">{seatSocial.message}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div
              className="mobile-board-zone"
              data-board-count={acceptedRunItTwice ? 'twice' : Math.min(state.communityCards.length, 5)}
            >
              <div className="mobile-board-notices">
                <BountyToast bounty={presentedBounty} players={state.players} />
                {mobileAllInAnnouncement ? (
                  <AllInAnnouncement
                    key={mobileAllInAnnouncement.actionKey}
                    announcement={mobileAllInAnnouncement}
                  />
                ) : null}
              </div>
              <div className="mobile-board-header">
                {showMobileWinnerSummary ? (
                  <div className="mobile-edge-winners" role="status" aria-live="assertive" aria-atomic="true">
                    {winnerDisplays.map(winner => {
                      const detail = winner.handDescription ?? (everyoneFolded ? 'Everyone folded' : null)
                      return (
                        <div key={winner.playerId} className="mobile-edge-winner-line">
                          <span>
                            <b>{formatWinnerPaymentLabel(winner.playerId === yourId ? 'You' : winner.displayName, winner.venmoUsername)}</b>
                            {detail && <small>{detail}</small>}
                          </span>
                          <strong>+{formatAmount(winner.amount)}</strong>
                        </div>
                      )
                    })}
                  </div>
                ) : acceptedRunItTwice && betweenHands && !isPayoutPending ? null : (
                  <div className="mobile-pot-wrap" key={`pot-${presentedPot}`}>
                    <PotDisplay
                      totalPot={presentedPot}
                      pots={presentedPot > 0 && !hasHandResult ? state.pots : []}
                      currentBet={hasHandResult ? 0 : state.currentBet}
                      toCall={isMyTurn ? Math.max(0, toCall) : 0}
                    />
                  </div>
                )}
              </div>
              {acceptedRunItTwice ? (
                <RunItTwiceBoards runItTwice={acceptedRunItTwice} players={state.players} />
              ) : (
                <CommunityCards
                  cards={boardCardsWithRabbit}
                  highlightedCards={highlightedWinningCards}
                  unplayedFromIndex={hasVisibleRabbitRunout ? playedBoardCards.length : undefined}
                />
              )}
              {hasVisibleRabbitRunout && (
                <div className="mobile-rabbit-label">Rabbit hunt — not played</div>
              )}
              <div className="mobile-board-footer">{showdownCinematic}</div>
            </div>
            </div>

            {shouldShowOwnHand && visibleOwnPlayer && (
              <div
                className={`mobile-hero-lane ${isMyTurn ? 'is-acting' : ''}`}
                data-show-cards={showMobileShowCardsToggle ? 'true' : 'false'}
                data-strength-slot={isInHand && ownHandCards.length > 0 ? 'true' : 'false'}
              >
                <MobileHeroSeat
                  player={visibleOwnPlayer}
                  displayStack={getDisplayStack(visibleOwnPlayer)}
                  isActing={isMyTurn}
                  isWinner={betweenHands && showWinnerHighlights && myWinnerAmount > 0}
                  status={mobileHeroStatus}
                  odds={handOddsView?.byPlayer.get(visibleOwnPlayer.id)}
                />
                <CompanionBadge companion={presentedCompanion} playerId={visibleOwnPlayer.id} placement="hero" canMute />

                <OwnHand
                  cards={ownHandCards}
                  isActing={isMyTurn}
                  isFolded={isOwnHandFolded}
                  isWinner={betweenHands && showWinnerHighlights && myWinnerAmount > 0}
                  winningCards={winnerCardsByPlayer.get(yourId)}
                  handDescription={hasVisibleRabbitRunout ? null : ownHandDescription}
                  showCardsMode={ownShowCardsMode}
                  revealChoiceActive={canAdjustShownCards && !heroWentToShowdown}
                  concealed={isInHand && !isTabledRunout}
                  onPeekChange={onPeekCards}
                  onSoundCue={onSoundCue}
                  socialMessage={heroSocial.message}
                  socialMessageExpiresAt={heroSocial.messageExpiresAt}
                  socialEmote={heroSocial.emote}
                  socialEmoteExpiresAt={heroSocial.emoteExpiresAt}
                  socialEmoteTargeted={heroSocial.emoteTargeted}
                  socialEmoteFrom={heroSocial.emoteSenderId ? nameForPlayerId(heroSocial.emoteSenderId) : undefined}
                  showCardsControl={showMobileShowCardsToggle && me ? (
                    <button
                      type="button"
                      className={`mobile-show-cards-toggle ${heroCardsShownToTable ? 'is-shown' : ''}`}
                      aria-pressed={heroCardsShownToTable}
                      disabled={!isConnected}
                      onClick={() => onSetShowCards(heroCardsShownToTable ? 'none' : 'both')}
                    >
                      {heroCardsShownToTable ? 'Hide cards' : 'Show cards'}
                    </button>
                  ) : null}
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
                  <SeatDrinkBadge drinks={player.drinks} nickname={player.nickname} />
                </div>
              )
            })}
          </div>

          <div className="table-surface">
            {acceptedRunItTwice ? (
              <RunItTwiceBoards runItTwice={acceptedRunItTwice} players={state.players} />
            ) : (
              <CommunityCards
                cards={boardCardsWithRabbit}
                highlightedCards={highlightedWinningCards}
                unplayedFromIndex={hasVisibleRabbitRunout ? playedBoardCards.length : undefined}
              />
            )}

            <PotDisplay
              totalPot={presentedPot}
              pots={presentedPot > 0 && !hasHandResult ? state.pots : []}
              currentBet={hasHandResult ? 0 : state.currentBet}
              toCall={isMyTurn ? Math.max(0, toCall) : 0}
            />

            <HeroTableBet amount={heroTableBetAmount} />

            {hasVisibleRabbitRunout && (
              <div className="table-rabbit-tag" role="note">
                <span className="table-rabbit-tag-title">Rabbit hunt — not played</span>
                <span className="table-rabbit-tag-cards">
                  {rabbitCards.map(card => (
                    <span
                      key={`${card.rank}${card.suit}`}
                      className={`table-rabbit-card is-${card.suit}`}
                      aria-label={`${card.rank === 'T' ? '10' : card.rank} of ${card.suit}`}
                    >
                      <b>{card.rank === 'T' ? '10' : card.rank}</b>
                      <i aria-hidden="true">{SUIT_GLYPHS[card.suit]}</i>
                    </span>
                  ))}
                </span>
              </div>
            )}

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
              aria-label={`${visibleOwnPlayer.nickname}, chips ${formatAmount(getDisplayStack(visibleOwnPlayer))}`}
            >
              <span className="hero-bottom-summary-name">{visibleOwnPlayer.nickname}</span>
              <span className="hero-bottom-summary-stack">{formatAmount(getDisplayStack(visibleOwnPlayer))}</span>
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
                concealed={isInHand && !isTabledRunout}
                onPeekChange={onPeekCards}
                onSoundCue={onSoundCue}
                socialMessage={heroSocial.message}
                socialMessageExpiresAt={heroSocial.messageExpiresAt}
                socialEmote={heroSocial.emote}
                socialEmoteExpiresAt={heroSocial.emoteExpiresAt}
                socialEmoteTargeted={heroSocial.emoteTargeted}
                socialEmoteFrom={heroSocial.emoteSenderId ? nameForPlayerId(heroSocial.emoteSenderId) : undefined}
                showCardsControl={
                  canAdjustShownCards && me && !isSpectator && !settingsOpen ? (
                    <ShowCardsControl
                      mode={me.showCards}
                      isConnected={isConnected}
                      onChangeMode={onSetShowCards}
                    />
                  ) : null
                }
              />
            </>
          )}
        </div>
        )}

        {!isMobileViewport && me && !isSpectator && (
          <div className="hero-inline-status">
            <span className="table-chip table-chip-soft">{formatAmount(getDisplayStack(me))}</span>
            {typeof me.equityPercent === 'number' && !handOddsView && (
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
            {me.isSB && <span className="table-chip hero-blind-role is-small">Small Blind</span>}
            {me.isBB && <span className="table-chip hero-blind-role is-big">Big Blind</span>}
            {isMyTurn && <span className="table-chip table-chip-soft">Your action</span>}
            {!isConnected && <span className="table-chip chip-warning">Reconnecting</span>}
          </div>
        )}
      </div>

      {preActionDock}

      {activeAllInAnnouncement && !isMobileViewport ? (
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
          isHost={isHost}
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
          onLeaveGame={onLeaveGame}
          onFeedback={onFeedback}
          onSendLedgerMessage={onSendLedgerMessage}
        />
      )}

      {!settingsOpen && (
        <TableSocialDock
          chatLog={socialState.chatLog}
          yourId={yourId}
          isConnected={isConnected}
          onSendChat={onSendChat}
          onSendEmote={onSendEmote}
        />
      )}

      {isMobileViewport && (showLobbyControls || isBustedViewer || isRailBusted || canRetakeSeat || isOnRail) && !settingsOpen && !hasActionTray && (
        <MobileBetweenHandsDock
          state={state}
          me={me}
          lobbyMe={lobbyMe}
          isHost={isHost}
          isConnected={isConnected}
          isBusted={isBustedViewer || isRailBusted}
          rebuyBlockedReason={getRebuyStatus(state, yourId).reason}
          onRebuy={requestRebuy}
          onStartGame={onStartGame}
          onAddBots={onAddBots}
          onSeatMe={onSeatMe}
          onFeedback={onFeedback}
        />
      )}

      {hasActionTray && me && (
        <div
          key={heroTurnKey ?? 'turn'}
          className={`turn-edge-glow ${turnTimer.secondsLeft <= 5 ? 'is-low' : ''}`}
          aria-hidden="true"
        />
      )}

      {hasActionTray && me && (
        isMobileViewport ? (
          <div
            ref={mobileTrayRef}
            className="mobile-betting-panel"
            data-raise={raiseSizingOpen && canMobileRaise ? 'open' : 'closed'}
            data-blind-tip={blindTip ? 'true' : 'false'}
            style={{ ['--turn-pct' as string]: Math.round(turnTimer.percent * 10) / 10 } as CSSProperties}
          >
            {preActionNoteElement}
            {blindTip && (
              <div className="blind-tip" role="note">
                <p>{blindTip}</p>
                <button type="button" className="blind-tip-dismiss" onClick={dismissBlindTip}>
                  Got it
                </button>
              </div>
            )}

            <div className="turn-prompt mobile-turn-prompt" role="status" aria-live="assertive">
              <div className="turn-prompt-copy">
                <span className="turn-prompt-kicker">{turnPrompt?.kicker ?? 'Your turn'}</span>
                <strong className="turn-prompt-headline">{bettingTrayHeader}</strong>
                {turnPrompt?.context && (
                  <span className="turn-prompt-context">{turnPrompt.context}</span>
                )}
              </div>
              <div
                className={`mobile-tray-timer ${turnTimer.secondsLeft <= 5 ? 'is-low' : ''}`}
                role="timer"
                aria-label={`${turnTimer.secondsLeft} seconds to act`}
              >
                <span className="mobile-tray-timer-fill" aria-hidden="true" />
                <span className="mobile-tray-timer-label">{turnTimer.secondsLeft}s</span>
              </div>
            </div>

            {raiseSizingOpen && canMobileRaise && (
              <div className="mobile-raise-sizing" role="group" aria-label="Raise size">
                <div className="mobile-raise-control">
                  <button
                    type="button"
                    className="mobile-raise-step"
                    onClick={() => adjustRaiseAmount(-mobileRaiseStep)}
                    aria-label="Decrease bet"
                  >
                    −
                  </button>
                  <div className="mobile-bet-amount" aria-live="polite">
                    <strong>{formatAmount(raiseAmount)}</strong>
                    <span className="mobile-raise-bb">{mobileRaiseBlindCount} BB</span>
                  </div>
                  <button
                    type="button"
                    className="mobile-raise-step"
                    onClick={() => adjustRaiseAmount(mobileRaiseStep)}
                    aria-label="Increase bet"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="mobile-raise-close"
                    onClick={() => setRaiseSizingOpen(false)}
                    aria-label="Close raise sizing"
                  >
                    <PanelCloseIcon />
                  </button>
                </div>

                <input
                  type="range"
                  className="raise-slider mobile-raise-slider"
                  min={effectiveMin}
                  max={maxRaise}
                  step={mobileRaiseStep}
                  value={raiseAmount}
                  aria-label="Bet amount"
                  style={{ ['--raise-fill' as string]: `${mobileRaiseFill}%` } as CSSProperties}
                  onChange={event => setClampedRaiseAmount(Number(event.target.value))}
                />

                <div className="mobile-bet-row" role="group" aria-label="Quick bet sizes">
                  {mobileQuickBets.map(quickBet => (
                    <button
                      key={quickBet.label}
                      type="button"
                      className={`mobile-bet-quick ${quickBet.key === activeMobileQuickBet ? 'is-active' : ''} ${quickBet.key === 'all-in' ? 'is-all-in' : ''}`}
                      aria-pressed={quickBet.key === activeMobileQuickBet}
                      onClick={() => setClampedRaiseAmount(quickBet.amount)}
                    >
                      {quickBet.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mobile-main-actions" data-count={canMobileRaise ? 3 : 2}>
              <button
                type="button"
                className={`mobile-main-action mobile-action-fold ${mobileCheckCallAction?.key === 'check' ? 'is-check-free' : ''}`}
                data-action="fold"
                data-pending={isActionPending && pendingAction?.key === 'fold' ? 'true' : undefined}
                onClick={mobileFoldAction?.onClick}
                disabled={!mobileFoldAction}
              >
                <span>Fold</span>
                {mobileCheckCallAction?.key === 'check' && <small>Check is free</small>}
              </button>
              <button
                type="button"
                className="mobile-main-action mobile-action-call is-primary"
                data-action={mobileCheckCallAction?.key ?? 'check-call'}
                data-pending={isActionPending && pendingAction?.key === mobileCheckCallAction?.key ? 'true' : undefined}
                onClick={mobileCheckCallAction?.onClick}
                disabled={!mobileCheckCallAction}
              >
                <span>{getMobileCheckCallLabel(mobileCheckCallAction?.key)}</span>
                {toCall > 0 && <strong>{formatAmount(toCall)}</strong>}
              </button>
              {canMobileRaise && (raiseSizingOpen ? (
                <button
                  type="button"
                  className={`mobile-main-action mobile-action-raise ${mobileRaiseIsAllIn ? 'is-all-in' : ''}`}
                  data-action={mobileRaiseIsAllIn ? 'all_in' : 'raise'}
                  data-pending={isActionPending && pendingAction?.key === (mobileRaiseIsAllIn ? 'all_in' : 'raise') ? 'true' : undefined}
                  onClick={mobileRaiseIsAllIn ? mobileAllInAction?.onClick : mobileBetRaiseAction?.onClick}
                  disabled={mobileRaiseIsAllIn ? !mobileAllInAction : !mobileBetRaiseAction}
                >
                  <span>{mobileRaiseLabel}</span>
                  <strong>{formatAmount(raiseAmount)}</strong>
                </button>
              ) : (
                <button
                  type="button"
                  className="mobile-main-action mobile-action-raise is-opener"
                  data-action="open-raise"
                  aria-expanded={false}
                  onClick={() => setRaiseSizingOpen(true)}
                >
                  <span>{state.currentBet > 0 ? 'Raise' : 'Bet'}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`betting-tray ${isTrayReconnecting ? 'is-reconnecting' : ''}`}
            data-can-raise={showDesktopRaiseSizing ? 'true' : 'false'}
            aria-busy={isTrayReconnecting}
          >
            {preActionNoteElement}
            {blindTip && (
              <div className="blind-tip" role="note">
                <p>{blindTip}</p>
                <button type="button" className="blind-tip-dismiss" onClick={dismissBlindTip}>
                  Got it
                </button>
              </div>
            )}
            <div className="betting-tray-header turn-prompt" role="status" aria-live="assertive">
              <div className="turn-prompt-copy">
                <span className="turn-prompt-kicker">{turnPrompt?.kicker ?? 'Your turn'}</span>
                <strong className="betting-tray-kicker turn-prompt-headline">
                  {bettingTrayHeader}
                </strong>
                {turnPrompt?.context && (
                  <span className="turn-prompt-context">{turnPrompt.context}</span>
                )}
              </div>
              {isTrayReconnecting && (
                <span className="betting-tray-reconnecting" role="status" aria-live="polite">
                  <span className="betting-tray-reconnecting-dot" aria-hidden="true" />
                  Reconnecting…
                </span>
              )}
            </div>

            <div
              className="timer-bar-shell"
              data-urgency={turnTimer.percent <= 28 || turnTimer.secondsLeft <= 3 ? 'low' : turnTimer.percent <= 55 ? 'warn' : 'calm'}
            >
              <div className="timer-bar-header">
                <span>Time to act</span>
                <span className={`timer-bar-seconds ${turnTimer.secondsLeft <= 5 ? 'is-low' : ''}`}>
                  <b key={turnTimer.secondsLeft}>{turnTimer.secondsLeft}</b>s left
                </span>
              </div>
              <div className="timer-bar">
                <div
                  className={`timer-bar-fill ${turnTimer.percent < 20 ? 'timer-low' : ''}`}
                  style={{ transform: `scaleX(${turnTimer.percent / 100})` }}
                />
              </div>
            </div>

            {showDesktopRaiseSizing && (
              <div className="raise-slider-row">
                <div className="raise-quick-btns">
                  <button
                    type="button"
                    className="btn-quick"
                    disabled={isTrayReconnecting}
                    onClick={() => setClampedRaiseAmount(effectiveMin)}
                  >
                    Min
                  </button>
                  {quickBets.map(quickBet => (
                    <button
                      key={quickBet.label}
                      type="button"
                      className="btn-quick"
                      disabled={isTrayReconnecting}
                      title={`${state.currentBet > 0 ? 'Raise to' : 'Bet'} ${formatAmount(quickBet.amount)}`}
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
                  value={displayRaiseAmount}
                  disabled={isTrayReconnecting}
                  aria-label={state.currentBet > 0 ? 'Raise amount' : 'Bet amount'}
                  onChange={event => setClampedRaiseAmount(Number(event.target.value))}
                />

                <label className={`raise-input-wrap ${raiseDraftHint ? `is-${raiseDraftHint}` : ''}`}>
                  <input
                    ref={raiseInputRef}
                    type="number"
                    inputMode="numeric"
                    className="raise-input"
                    min={effectiveMin}
                    max={maxRaise}
                    step={Math.max(state.bigBlind, 1)}
                    value={raiseDraft ?? String(raiseAmount)}
                    disabled={isTrayReconnecting}
                    aria-label={`${state.currentBet > 0 ? 'Raise to' : 'Bet'} amount, minimum ${formatAmount(effectiveMin)}`}
                    aria-invalid={raiseDraftHint ? true : undefined}
                    onChange={event => {
                      const text = event.target.value
                      setRaiseDraft(text)
                      const typed = parseRaiseDraft(text)
                      if (typed !== null && typed >= effectiveMin && typed <= maxRaise) {
                        setRaiseAmount(typed)
                      }
                    }}
                    onBlur={() => {
                      if (raiseDraft !== null) commitRaiseDraft()
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleRaise()
                      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault()
                        adjustRaiseAmount((event.key === 'ArrowUp' ? 1 : -1) * Math.max(state.bigBlind, 1))
                      } else if (event.key === 'Escape') {
                        setRaiseDraft(null)
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span className="raise-input-hint" aria-live="polite">
                    {raiseDraftHint === 'above-max'
                      ? `max ${formatAmount(maxRaise)}`
                      : `min ${formatAmount(effectiveMin)}`}
                  </span>
                </label>
              </div>
            )}

            <div className="bet-action-row" data-count={actionButtons.length}>
              {actionButtons.map(actionButton => {
                const shortcut = ACTION_SHORTCUT_KEYS[actionButton.key]
                const isFreeCheckFold = actionButton.key === 'fold' && trayActions.includes('check')
                const subLabel = isFreeCheckFold ? 'Check is free' : actionButton.amountLabel
                return (
                  <button
                    key={actionButton.key}
                    type="button"
                    className={`btn-action ${actionButton.className} ${isFreeCheckFold ? 'is-check-free' : ''} ${actionButton.key === turnPrompt?.primary ? 'is-primary' : ''}`}
                    data-action={actionButton.key}
                    data-pending={isActionPending && pendingAction?.key === actionButton.key ? 'true' : undefined}
                    aria-busy={isActionPending && pendingAction?.key === actionButton.key ? true : undefined}
                    disabled={isTrayReconnecting}
                    aria-keyshortcuts={shortcut}
                    title={shortcut ? `Shortcut: ${shortcut}${actionButton.key === 'raise' ? ' to size, Enter to confirm' : ''}` : undefined}
                    aria-label={
                      actionButton.amountLabel
                        ? `${actionButton.label} ${actionButton.amountLabel}`
                        : actionButton.label
                    }
                    onClick={actionButton.onClick}
                  >
                    <span className="btn-action-main">{actionButton.label}</span>
                    {subLabel && (
                      <span className="btn-action-sub">{subLabel}</span>
                    )}
                    {shortcut && <kbd className="btn-action-key" aria-hidden="true">{shortcut}</kbd>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      )}

          {!isMobileViewport && showLobbyControls && (
            <div className="table-side-panels">
              <WaitingPanel
                state={state}
                me={me}
                lobbyMe={lobbyMe}
                isHost={isHost}
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
              prankControls={canPrankTarget ? (
                <PrankControls
                  targetName={targetedPlayer.nickname}
                  showShot={canShootTarget}
                  shotBlocked={Boolean(shotBlockReason)}
                  shotNote={shotNote}
                  shotBadge={shotCooldownHands > 0 ? shotCooldownHands : null}
                  flickReadyAt={flickReadyAt}
                  isConnected={isConnected}
                  onBuyShot={handleBuyShot}
                  onFlickChip={handleFlickChip}
                  onFlipOff={() => handleTargetedEmote(FLIP_OFF_EMOTE)}
                />
              ) : null}
              onSendEmote={handleTargetedEmote}
              onSendMessage={handleTargetedMessage}
              onClose={closeTargetedEmote}
              fullPickerOpen={targetEmotePickerOpen}
              onToggleFullPicker={() => setTargetEmotePickerOpen(current => !current)}
              quickEmotes={canPrankTarget ? withoutFlipOff(targetQuickEmotes) : targetQuickEmotes}
            />
          )}
    </div>
  )
}

function PanelCloseIcon() {
  return (
    <svg className="panel-close-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function ChatBubbleIcon() {
  return (
    <svg className="social-dock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.2 3.2a.5.5 0 0 1-.8-.4V17H4.5A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Messages from other players that arrived after `lastSeenAt`. */
export function countUnreadChat(
  chatLog: ReadonlyArray<Pick<TableChatEntry, 'playerId' | 'createdAt'>>,
  yourId: string,
  lastSeenAt: number
): number {
  return chatLog.filter(entry => entry.playerId !== yourId && entry.createdAt > lastSeenAt).length
}

function latestChatAt(chatLog: ReadonlyArray<Pick<TableChatEntry, 'createdAt'>>): number {
  return chatLog.reduce((latest, entry) => Math.max(latest, entry.createdAt), 0)
}

function TableSocialDock({
  chatLog,
  yourId,
  isConnected,
  onSendChat,
  onSendEmote,
}: {
  chatLog: TableChatEntry[]
  yourId: string
  isConnected: boolean
  onSendChat: (message: string) => void
  onSendEmote: (emote: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  // Only messages that arrive after the table loads count as unread.
  const [lastSeenAt, setLastSeenAt] = useState(() => latestChatAt(chatLog))
  const dockRef = useRef<HTMLElement>(null)
  const recentMessages = chatLog.slice(-6)
  const unreadCount = isOpen ? 0 : countUnreadChat(chatLog, yourId, lastSeenAt)

  useEffect(() => {
    if (isOpen) {
      setLastSeenAt(current => Math.max(current, latestChatAt(chatLog)))
    }
  }, [chatLog, isOpen])

  // Keep the panel inside the visible area when the on-screen keyboard opens.
  useEffect(() => {
    const dock = dockRef.current
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!isOpen || !dock || !viewport) {
      return
    }

    const sync = () => {
      dock.style.setProperty('--vv-top', `${Math.round(viewport.offsetTop)}px`)
      dock.style.setProperty('--vv-h', `${Math.round(viewport.height)}px`)
    }

    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      dock.style.removeProperty('--vv-top')
      dock.style.removeProperty('--vv-h')
    }
  }, [isOpen])

  const submitMessage = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || !isConnected) {
      return
    }

    onSendChat(trimmed)
    setMessage('')
  }, [isConnected, message, onSendChat])

  return (
    <aside
      ref={dockRef}
      className={`social-dock ${isOpen ? 'is-open' : ''}`}
      aria-label="Table chat and reactions"
    >
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
              <PanelCloseIcon />
            </button>
          </div>

          <div className="social-dock-messages" aria-live="polite">
            {recentMessages.length > 0 ? recentMessages.map(entry => (
              <div key={entry.id} className="social-dock-message">
                <span>{entry.playerId === yourId ? 'You' : entry.nickname}</span>
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
        aria-label={isOpen
          ? 'Close table chat'
          : unreadCount > 0
            ? `Open table chat and reactions, ${unreadCount} unread`
            : 'Open table chat and reactions'}
      >
        <span aria-hidden="true"><ChatBubbleIcon /></span>
        <strong>Table talk</strong>
        {unreadCount > 0 && <em aria-hidden="true">{Math.min(unreadCount, 99)}</em>}
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
  prankControls = null,
}: {
  target: SeatPlayer
  isConnected: boolean
  prankControls?: React.ReactNode
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
          <PanelCloseIcon />
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

          {prankControls}

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

/**
 * The action clock. It re-renders the table once per second (when the
 * seconds readout changes), never 10x a second: every bar and ring that drains
 * eases between those ticks with a 1s linear CSS transition, so `percent` is
 * the value the clock will reach at the *next* tick (where the transition
 * lands exactly on time).
 */
function useTurnTimer(
  timerStart: number | null,
  duration: number,
  serverNow: number
): { percent: number; secondsLeft: number } {
  const [timer, setTimer] = useState({
    percent: 100,
    secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
  })

  useEffect(() => {
    const update = (next: { percent: number; secondsLeft: number }) => {
      setTimer(previous => (
        previous.percent === next.percent && previous.secondsLeft === next.secondsLeft ? previous : next
      ))
    }
    if (!timerStart) {
      update({
        percent: 100,
        secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
      })
      return
    }

    const deadline = Date.now() + Math.max(0, timerStart + duration - serverNow)
    let timeout: number | null = null

    const tick = () => {
      const remainingMs = Math.max(0, deadline - Date.now())
      // Wake exactly when the whole-second readout changes.
      const untilNextTick = remainingMs % 1000 || 1000
      const remainingAtNextTick = Math.max(0, remainingMs - untilNextTick)
      update({
        percent: duration > 0 ? Math.round((remainingAtNextTick / duration) * 1000) / 10 : 0,
        secondsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
      })
      timeout = remainingMs > 0 ? window.setTimeout(tick, untilNextTick + 5) : null
    }

    tick()

    return () => {
      if (timeout !== null) window.clearTimeout(timeout)
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
  isHost,
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
  onLeaveGame = () => {},
  onFeedback,
  onSendLedgerMessage,
}: {
  state: TableState
  yourId: string
  isHost: boolean
  isConnected: boolean
  onSendLedgerMessage?: (message: LedgerC2SMessage) => void
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
    funModeEnabled?: boolean
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onCopyRoom: () => void
  onShareRoom: () => void
  onLeaveGame?: () => void
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

  const [activeTab, setActiveTab] = useState<'general' | 'avatar' | 'players' | 'hands' | 'ledger'>('general')
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
          <div className="settings-modal-heading">
            <div className="table-panel-kicker">Table console</div>
            <div id="table-settings-dialog-title" className="table-panel-title">Table menu</div>
          </div>
          <button type="button" className="btn-subtle settings-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-tabs" data-active={activeTab} data-count="5">
          <button
            type="button"
            className={`settings-tab ${activeTab === 'general' ? 'is-active' : ''}`}
            aria-pressed={activeTab === 'general'}
            onClick={() => setActiveTab('general')}
          >
            Settings
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'avatar' ? 'is-active' : ''}`}
            aria-pressed={activeTab === 'avatar'}
            onClick={() => setActiveTab('avatar')}
          >
            Outfit
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'players' ? 'is-active' : ''}`}
            aria-pressed={activeTab === 'players'}
            onClick={() => setActiveTab('players')}
          >
            Players ({state.lobbyPlayers.length})
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'hands' ? 'is-active' : ''}`}
            aria-pressed={activeTab === 'hands'}
            onClick={() => setActiveTab('hands')}
          >
            Last hands
          </button>
          <button
            type="button"
            className={`settings-tab ${activeTab === 'ledger' ? 'is-active' : ''}`}
            aria-pressed={activeTab === 'ledger'}
            onClick={() => setActiveTab('ledger')}
          >
            Ledger
          </button>
        </div>

        {activeTab === 'ledger' && (
          <LedgerPanel
            state={state}
            yourId={yourId}
            isHost={isHost}
            isConnected={isConnected}
            onSendLedgerMessage={onSendLedgerMessage}
          />
        )}

        {activeTab === 'hands' && (
          <div className="settings-modal-body">
            <HandHistoryList history={state.handHistory ?? []} players={state.players} yourId={yourId} />
          </div>
        )}

        {activeTab === 'general' && (
          <div className="settings-modal-body">
            <div className="settings-section settings-room-section">
              <div className="settings-section-title">Room</div>
              <div className="settings-room-code">
                <span>Room code: </span>
                <strong>{roomCode}</strong>
              </div>
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
                <button
                  type="button"
                  className="btn-subtle btn-subtle-danger"
                  onClick={onLeaveGame}
                  disabled={!isConnected}
                >
                  Leave game
                </button>
              </div>
            </div>

            <div className="settings-section settings-audio-section">
              <div className="settings-section-title">Cards &amp; sound</div>
              <div className="settings-rule-row">
                <div>
                  <div className="settings-rule-name">Suit colors</div>
                  <div className="settings-rule-copy">Four colors make flushes easier to spot.</div>
                </div>
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
              <PeekStylePicker />
              <div className="settings-rule-row settings-audio-controls">
                <div>
                  <div className="settings-rule-name">Soundscape</div>
                  <div className="settings-rule-copy">
                    Card, chip, action, and showdown sounds play in both table views.
                  </div>
                </div>
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
              </div>
              <label
                className="settings-volume-field"
                data-muted={soundMuted ? 'true' : 'false'}
                style={{ ['--volume-fill' as string]: `${Math.round(Math.max(0, Math.min(1, soundVolume)) * 100)}%` } as CSSProperties}
              >
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

            {isHost ? (
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
                      <div className="settings-rule-name">Fun mode</div>
                      <div className="settings-rule-copy">Beer, water and Lady Luck for players on the desktop 3D table. Phones and tablets always keep it simple. Turning it off sobers everyone up right away.</div>
                    </div>
                    <div className="settings-toggle-row">
                      <button
                        type="button"
                        className={`settings-pill ${state.funModeEnabled !== false ? 'is-active' : ''}`}
                        aria-pressed={state.funModeEnabled !== false}
                        disabled={!isConnected}
                        onClick={() => onUpdateSettings({ funModeEnabled: true })}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={`settings-pill ${state.funModeEnabled === false ? 'is-active' : ''}`}
                        aria-pressed={state.funModeEnabled === false}
                        disabled={!isConnected}
                        onClick={() => onUpdateSettings({ funModeEnabled: false })}
                      >
                        Off
                      </button>
                    </div>
                  </div>
                  <div className="settings-rule-row">
                    <div>
                      <div className="settings-rule-name">Rabbit hunting</div>
                      <div className="settings-rule-copy">On: after a fold, deal the unplayed streets face up (dimmed). Off: anyone can peek with the Rabbit hunt button.</div>
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
            ) : (
              <div className="settings-section">
                <div className="settings-section-title">Table settings</div>
                <div className="settings-section-copy">
                  Only the game creator can change blinds, stacks, timing, and table rules.
                </div>
              </div>
            )}
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
              <span className="table-chip table-chip-soft">
                {isHost ? 'Players stay on the rail at 0 chips' : 'Only the game creator can manage players'}
              </span>
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
                    <span
                      className="settings-player-avatar"
                      data-tone={getSeatTone(player)}
                      data-connected={player.isConnected ? 'true' : 'false'}
                      aria-hidden="true"
                    >
                      {getSeatInitials(player.nickname)}
                    </span>
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
                        <strong>{formatAmount(player.stack)}</strong> {'\u00b7'} {getLobbyStatusLabel(state, player)}
                      </div>
                    </div>
                    {!isHost && player.id === yourId && (
                      <div className="settings-player-actions">
                        <button
                          type="button"
                          className="btn-subtle"
                          disabled={!isConnected || (player.isSpectator && !player.isSeated && player.stack <= 0)}
                          aria-label={player.isSpectator ? 'Sit back down' : 'Stand up and watch'}
                          onClick={() => onSetPlayerSpectator(player.id, !player.isSpectator)}
                        >
                          {player.isSpectator
                            ? player.isSeated ? 'Stay seated' : 'Sit down'
                            : state.phase === 'in_hand' ? 'Watch after this hand' : 'Stand up and watch'}
                        </button>
                      </div>
                    )}
                    {isHost && <div className="settings-player-actions">
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
                          {state.phase === 'in_hand' ? 'Kick (folds now)' : 'Kick player'}
                        </button>
                      ) : (
                        <span className="table-chip table-chip-soft">Self removal blocked</span>
                      )}
                    </div>}
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

const HISTORY_SUIT_GLYPHS: Record<Card['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

function HistoryCards({ cards, label }: { cards: Card[]; label: string }) {
  if (cards.length === 0) {
    return <span className="hand-history-muted">No flop</span>
  }

  return (
    <span className="hand-history-cards" aria-label={`${label}: ${cards.map(card => `${card.rank === 'T' ? '10' : card.rank} of ${card.suit}`).join(', ')}`}>
      {cards.map((card, index) => (
        <span
          key={`${card.rank}${card.suit}${index}`}
          className={`hand-history-card is-${card.suit}`}
          aria-hidden="true"
        >
          {card.rank === 'T' ? '10' : card.rank}{HISTORY_SUIT_GLYPHS[card.suit]}
        </span>
      ))}
    </span>
  )
}

/** "Last hands": winners, amount, board and shown hands, newest first. */
export function HandHistoryList({
  history,
  players,
  yourId,
}: {
  history: HandHistoryEntry[]
  players: ReadonlyArray<Pick<SeatPlayer, 'id' | 'isBot' | 'nickname'>>
  yourId: string
}) {
  if (history.length === 0) {
    return <div className="settings-section-copy hand-history-empty">Finished hands show up here.</div>
  }

  const nameOf = (playerId: string, nickname: string) => {
    if (playerId === yourId) {
      return 'You'
    }
    const player = players.find(candidate => candidate.id === playerId)
    return player ? getMobileSeatName(player) : nickname
  }

  return (
    <ol className="hand-history-list" aria-label="Last hands">
      {history.map(entry => (
        <li key={entry.handNumber} className="hand-history-entry">
          <div className="hand-history-head">
            <span>Hand #{entry.handNumber}</span>
            <span>{entry.endedBy === 'fold' ? 'Everyone folded' : 'Showdown'} · Pot {formatAmount(entry.pot)}</span>
          </div>
          {entry.winners.map(winner => (
            <div key={winner.playerId} className="hand-history-winner">
              <b>{nameOf(winner.playerId, winner.nickname)}</b>
              <strong>+{formatAmount(winner.amount)}</strong>
              {winner.handDescription && <small>{winner.handDescription}</small>}
            </div>
          ))}
          {entry.boards?.length ? entry.boards.map((board, index) => (
            <div key={index} className="hand-history-row">
              <span className="hand-history-label">Run {index + 1}</span>
              <HistoryCards cards={board} label={`Run ${index + 1}`} />
            </div>
          )) : (
            <div className="hand-history-row">
              <span className="hand-history-label">Board</span>
              <HistoryCards cards={entry.board} label="Board" />
            </div>
          )}
          {entry.shown.map(hand => (
            <div key={hand.playerId} className="hand-history-row">
              <span className="hand-history-label">{nameOf(hand.playerId, hand.nickname)}</span>
              <HistoryCards cards={hand.cards} label={`${hand.nickname} showed`} />
            </div>
          ))}
        </li>
      ))}
    </ol>
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
        <span className="rabbit-hunt-kicker">Hand ended early</span>
        <span className="rabbit-hunt-title">Peek at the cards that would have come</span>
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
  isHost,
  isConnected,
  onStartGame,
  onAddBots,
  onSeatMe,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isHost: boolean
  isConnected: boolean
  onStartGame: () => void
  onAddBots: (count: number) => void
  onSeatMe: () => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const statusText = getWaitingStatusText(state, lobbyMe, isConnected)
  const seatedCount = state.players.length
  const canStart = isHost && seatedCount >= 2 && isConnected
  const canAddBots = isHost && isConnected && seatedCount < 8
  const openSeats = Math.max(0, 8 - seatedCount)
  const spectatorRail = getSpectatorRailState(lobbyMe, isConnected, { openSeats: Math.max(0, 8 - state.players.length) })

  return (
    <div className="table-panel status-panel">
      <div className="table-panel-header">
        <div className="table-panel-kicker">Table controls</div>
        {lobbyMe?.isSpectator && <span className="table-chip chip-warning">Spectating</span>}
      </div>
      <div className="table-panel-title">{statusText}</div>
      <div className="status-panel-seats">
        <div className="status-panel-pips" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} className={index < seatedCount ? 'is-filled' : ''} />
          ))}
        </div>
        <span>{seatedCount} seated · {openSeats} open</span>
      </div>
      <dl className="status-panel-stats">
        <div>
          <dt>Blinds</dt>
          <dd>{formatAmount(state.smallBlind)}/{formatAmount(state.bigBlind)}</dd>
        </div>
        <div>
          <dt>Buy-in</dt>
          <dd>{formatAmount(state.startingStack)}</dd>
        </div>
      </dl>
      <div className="table-panel-note">
        {spectatorRail
          ? spectatorRail.message
          : !isHost
            ? 'The game creator manages players and starts the table.'
            : me
              ? seatedCount < 2
                ? 'Add a bot or share the room code to fill a seat.'
                : 'Everyone settled? Deal the cards.'
              : 'Seat assignment is being restored.'}
      </div>
      {spectatorRail && (
        // Take seat lives on the always-visible Watching bar.
        <div className="spectator-rail-actions">
          <span className="table-chip table-chip-soft">Rail stack {formatAmount(lobbyMe?.stack ?? 0)}</span>
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
        {isHost && (
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
        )}
      </div>
    </div>
  )
}

function MobileBetweenHandsDock({
  state,
  me,
  lobbyMe,
  isHost,
  isConnected,
  isBusted,
  rebuyBlockedReason = null,
  onRebuy,
  onStartGame,
  onAddBots,
  onSeatMe,
  onFeedback,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isHost: boolean
  isConnected: boolean
  isBusted: boolean
  /** Why a self-serve rebuy is not available (rebuys off, cap reached), if so. */
  rebuyBlockedReason?: string | null
  onRebuy: () => void
  onStartGame: () => void
  onAddBots: (count: number) => void
  onSeatMe: () => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const seatedCount = state.players.length
  const canStart = isHost && seatedCount >= 2 && isConnected
  const canAddBots = isHost && isConnected && seatedCount < 8
  const openSeats = Math.max(0, 8 - seatedCount)
  const spectatorRail = getSpectatorRailState(lobbyMe, isConnected, { openSeats: Math.max(0, 8 - state.players.length) })
  // Rebuys are self-serve: any busted player can buy back in (host rules permitting).
  const canRebuy = isBusted && isConnected && !rebuyBlockedReason
  const showDeal = isHost && state.phase !== 'in_hand'
  // Busted hosts still run the table; Fill seats steps aside for the rebuy.
  const showFillSeats = canAddBots && openSeats > 1 && !canRebuy
  const actionCount = (canAddBots ? (showFillSeats ? 2 : 1) : 0) + (showDeal ? 1 : 0) + (canRebuy ? 1 : 0)
  const title = isBusted
    ? 'You’re out of chips'
    : spectatorRail
      ? spectatorRail.message
      : !isConnected
        ? 'Reconnecting…'
        : seatedCount < 2
          ? 'Waiting for players'
          : isHost
            ? 'Ready to deal'
            : 'Waiting for the host to deal'
  const detail = isBusted
    ? rebuyBlockedReason
      ? `${rebuyBlockedReason} Ask the host for chips to keep playing.`
      : `Rebuy for ${formatAmount(state.startingStack)} to keep playing.`
    : [
        `${seatedCount} seated`,
        lobbyMe?.isSpectator ? 'Watching' : me ? `Stack ${formatAmount(me.stack)}` : null,
      ].filter(Boolean).join(' · ')

  return (
    <div className="mobile-between-hands-dock" data-busted={isBusted ? 'true' : 'false'}>
      <div className="mobile-between-hands-card">
        <div className="mobile-between-hands-copy">
          <div className="mobile-between-hands-title">{title}</div>
          <div className="mobile-between-hands-meta">{detail}</div>
        </div>
        {spectatorRail?.canTakeSeat && !isBusted && (
          <button
            type="button"
            className="mobile-between-hands-btn mobile-between-hands-btn-primary"
            onClick={onSeatMe}
          >
            {spectatorRail.actionLabel}
          </button>
        )}
        {actionCount > 0 && (
          <div className="mobile-between-hands-actions" data-count={actionCount}>
            {canRebuy && (
              <button
                type="button"
                className="mobile-between-hands-btn mobile-between-hands-btn-primary"
                onClick={onRebuy}
              >
                Rebuy {formatAmount(state.startingStack)}
              </button>
            )}
            {canAddBots && (
              <>
                <button
                  type="button"
                  className="mobile-between-hands-btn mobile-between-hands-btn-secondary"
                  onClick={() => onAddBots(1)}
                >
                  Add bot
                </button>
                {showFillSeats && (
                  <button
                    type="button"
                    className="mobile-between-hands-btn mobile-between-hands-btn-secondary"
                    onClick={() => onAddBots(openSeats)}
                  >
                    Fill seats
                  </button>
                )}
              </>
            )}
            {showDeal && (
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
            )}
          </div>
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
