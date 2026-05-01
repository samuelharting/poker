import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'
import type { SocialSnapshot } from '@/shared/protocol'
import { REALISTIC_AVATAR_MODEL_KEYS, type RealisticAvatarModelKey } from './avatarModelCatalog'

export type ThreeActionCue = 'ready' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in'
export type ThreeBlindRole = 'small' | 'big' | null

export interface ThreeCardView {
  id: string
  rank: string
  suit: Card['suit']
  visible: boolean
}

export type ThreeAvatarHairStyle = 'crop' | 'side_part' | 'waves' | 'cap'
export type ThreeAvatarBuild = 'lean' | 'standard' | 'broad'
export type ThreeAvatarFaceStyle = 'calm' | 'focused' | 'smirk'
export type ThreeAvatarAccessory = 'none' | 'glasses' | 'mustache'
export type ThreeAvatarFaceShape = 'oval' | 'round' | 'square'
export type ThreeAvatarBrowWeight = 'low' | 'medium' | 'high'

export interface ThreeAvatarProfile {
  modelKey: RealisticAvatarModelKey
  accentColor: string
  skinColor: string
  hairColor: string
  shirtColor: string
  sleeveColor: string
  lapelColor: string
  chairColor: string
  chairTrimColor: string
  hairStyle: ThreeAvatarHairStyle
  build: ThreeAvatarBuild
  faceStyle: ThreeAvatarFaceStyle
  accessory: ThreeAvatarAccessory
  faceShape: ThreeAvatarFaceShape
  browWeight: ThreeAvatarBrowWeight
}

export interface ThreePlayerView {
  id: string
  nickname: string
  visualSeat: number
  stack: number
  bet: number
  status: SeatPlayer['status']
  isActing: boolean
  isWinner: boolean
  isOutOfHand: boolean
  isDealer: boolean
  blindRole: ThreeBlindRole
  hasCards: boolean
  visibleCards: ThreeCardView[]
  accentColor: string
  avatarColor: string
  hairColor: string
  avatarProfile: ThreeAvatarProfile
  actionCue: ThreeActionCue
  actionKey: string
  lastAction?: string
  lastActionId?: string
}

export interface ThreeAllInAnnouncement {
  actionKey: string
  playerId: string
  nickname: string
  visualSeat: number
  amountLabel: string | null
  isHero: boolean
}

export interface ThreeTableViewModel {
  roomCode: string
  phase: TableState['phase']
  players: ThreePlayerView[]
  hero: ThreePlayerView | null
  actingPlayerId: string | null
  actingPlayerName: string | null
  actingVisualSeat: number | null
  isHeroTurn: boolean
  communityCards: ThreeCardView[]
  heroCards: ThreeCardView[]
  pot: number
  currentBet: number
  smallBlind: number
  bigBlind: number
  actionCue: ThreeActionCue
  actionKey: string
  lastAction: string
  allInAnnouncement: ThreeAllInAnnouncement | null
}

export interface ThreeEmoteReaction {
  id: string
  senderId: string
  targetId: string
  emote: string
  expiresAt: number
  targeted: boolean
}

const AVATAR_ACCENT_COLORS = [
  '#7a1f34',
  '#1d3d5c',
  '#2f4f46',
  '#5a3f27',
  '#4a2e64',
  '#2e515f',
  '#6a3428',
  '#263756',
]

const AVATAR_SKIN_COLORS = [
  '#d7b088',
  '#c99678',
  '#b88469',
  '#9f6f55',
  '#e0b996',
  '#8f604b',
]

const AVATAR_HAIR_COLORS = [
  '#21150f',
  '#2b211c',
  '#3a2b22',
  '#5b3427',
  '#161412',
  '#4a3426',
]

const AVATAR_SHIRT_COLORS = [
  ['#172131', '#0f151f'],
  ['#432232', '#2b1520'],
  ['#1f3a34', '#132520'],
  ['#3e2f1f', '#241b12'],
  ['#2d2544', '#1c182c'],
  ['#173744', '#0e242d'],
] as const

const AVATAR_CHAIR_COLORS = [
  '#4b1830',
  '#1e2c46',
  '#14382f',
  '#3b261c',
  '#2a2141',
  '#4a1f25',
]

const AVATAR_CHAIR_TRIM_COLORS = [
  '#d9b56d',
  '#c79a4d',
  '#e2c77e',
  '#b98645',
]

const AVATAR_HAIR_STYLES: ThreeAvatarHairStyle[] = ['crop', 'side_part', 'waves', 'cap']
const AVATAR_BUILDS: ThreeAvatarBuild[] = ['lean', 'standard', 'broad']
const AVATAR_FACE_STYLES: ThreeAvatarFaceStyle[] = ['calm', 'focused', 'smirk']
const AVATAR_ACCESSORIES: ThreeAvatarAccessory[] = ['none', 'glasses', 'mustache']
const AVATAR_FACE_SHAPES: ThreeAvatarFaceShape[] = ['oval', 'round', 'square']
const AVATAR_BROW_WEIGHTS: ThreeAvatarBrowWeight[] = ['low', 'medium', 'high']

export function createThreeTableViewModel(state: TableState, yourId: string): ThreeTableViewModel {
  const heroPlayer = state.players.find(player => player.id === yourId) ?? null
  const heroSeatIndex = heroPlayer?.seatIndex ?? 0
  const winnerIds = new Set((state.winners ?? []).map(winner => winner.playerId))
  const players = state.players
    .map((player): ThreePlayerView => {
      const avatarProfile = createAvatarProfile(player)
      const actionCue = player.lastAction ? getActionCue(player.lastAction) : 'ready'
      const isOutOfHand = state.phase === 'in_hand' && (
        player.status === 'folded' ||
        player.status === 'sitting_out' ||
        player.status === 'disconnected'
      )

      return {
        id: player.id,
        nickname: player.nickname,
        visualSeat: getVisualSeat(player.seatIndex, heroSeatIndex),
        stack: player.stack,
        bet: player.bet,
        status: player.status,
        isActing: state.actingPlayerId === player.id,
        isWinner: winnerIds.has(player.id),
        isOutOfHand,
        isDealer: player.isDealer,
        blindRole: getBlindRole(player),
        hasCards: player.hasCards,
        visibleCards: (player.holeCards ?? []).map((card, index) => (
          toThreeCard(card, `${player.id}-card-${index}`, true)
        )),
        accentColor: avatarProfile.accentColor,
        avatarColor: avatarProfile.skinColor,
        hairColor: avatarProfile.hairColor,
        avatarProfile,
        actionCue,
        actionKey: getPlayerAnimationKey(player, actionCue, state),
        lastAction: player.lastAction,
        lastActionId: player.lastActionId,
      }
    })
    .sort((a, b) => a.visualSeat - b.visualSeat)

  const hero = players.find(player => player.id === yourId) ?? null
  const actingPlayer = players.find(player => player.id === state.actingPlayerId) ?? null
  const lastAction = heroPlayer?.lastAction ?? state.recentActions[0] ?? getPhaseActionLabel(state)
  const actionCue = hero?.actionCue ?? 'ready'
  const actionKey = hero?.actionKey ?? ''
  const allInAnnouncement = createAllInAnnouncement(players)

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    players,
    hero,
    actingPlayerId: actingPlayer?.id ?? null,
    actingPlayerName: actingPlayer?.nickname ?? null,
    actingVisualSeat: actingPlayer?.visualSeat ?? null,
    isHeroTurn: state.actingPlayerId === yourId,
    communityCards: state.communityCards.map((card, index) => toThreeCard(card, `board-${index}`, true)),
    heroCards: (heroPlayer?.holeCards ?? []).map((card, index) => toThreeCard(card, `hero-${index}`, true)),
    pot: state.totalPot,
    currentBet: state.currentBet,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    actionCue,
    actionKey,
    lastAction,
    allInAnnouncement,
  }
}

export function createThreeEmoteReactions(
  socialState: Pick<SocialSnapshot, 'active'>,
  playerIds: Iterable<string>,
  now = Date.now(),
  mapEmote: (emote: string) => string | undefined = emote => emote
): ThreeEmoteReaction[] {
  const knownPlayerIds = new Set(playerIds)

  return socialState.active.reduce<ThreeEmoteReaction[]>((acc, entry) => {
    if (
      !entry.emote ||
      !entry.emoteExpiresAt ||
      entry.emoteExpiresAt <= now ||
      !knownPlayerIds.has(entry.playerId)
    ) {
      return acc
    }

    const targetId = entry.targetPlayerId?.trim() || entry.playerId
    if (!knownPlayerIds.has(targetId)) {
      return acc
    }

    const emote = mapEmote(entry.emote)
    if (!emote) {
      return acc
    }

    acc.push({
      id: `${entry.playerId}:${targetId}:${emote}:${entry.emoteExpiresAt}`,
      senderId: entry.playerId,
      targetId,
      emote,
      expiresAt: entry.emoteExpiresAt,
      targeted: targetId !== entry.playerId,
    })

    return acc
  }, [])
}

function createAvatarProfile(player: SeatPlayer): ThreeAvatarProfile {
  const seed = hashPlayerIdentity(`${player.id}:${player.nickname}`)
  const shirt = pickSeeded(AVATAR_SHIRT_COLORS, seed + 11)

  return {
    modelKey: pickSeeded(REALISTIC_AVATAR_MODEL_KEYS, seed + 43),
    accentColor: pickSeeded(AVATAR_ACCENT_COLORS, seed),
    skinColor: pickSeeded(AVATAR_SKIN_COLORS, seed + 3),
    hairColor: pickSeeded(AVATAR_HAIR_COLORS, seed + 5),
    shirtColor: shirt[0],
    sleeveColor: shirt[1],
    lapelColor: pickSeeded(AVATAR_ACCENT_COLORS, seed + 19),
    chairColor: pickSeeded(AVATAR_CHAIR_COLORS, seed + 23),
    chairTrimColor: pickSeeded(AVATAR_CHAIR_TRIM_COLORS, seed + 29),
    hairStyle: pickSeeded(AVATAR_HAIR_STYLES, seed + 7),
    build: pickSeeded(AVATAR_BUILDS, seed + 13),
    faceStyle: pickSeeded(AVATAR_FACE_STYLES, seed + 17),
    accessory: pickSeeded(AVATAR_ACCESSORIES, seed + 31),
    faceShape: pickSeeded(AVATAR_FACE_SHAPES, seed + 37),
    browWeight: pickSeeded(AVATAR_BROW_WEIGHTS, seed + 41),
  }
}

function pickSeeded<T>(values: readonly T[], seed: number): T {
  return values[Math.abs(seed) % values.length]!
}

function hashPlayerIdentity(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getPlayerAnimationKey(
  player: SeatPlayer,
  actionCue: ThreeActionCue,
  state: TableState
) {
  if (!player.lastAction || actionCue === 'ready') {
    return ''
  }

  if (player.lastActionId) {
    return `${player.id}:${player.lastActionId}`
  }

  if (!player.hasActedThisRound && player.status !== 'folded' && player.status !== 'all_in') {
    return ''
  }

  return `${player.id}:legacy:${state.handNumber}:${state.round ?? 'none'}:${player.lastAction}:${player.bet}:${player.status}`
}

function createAllInAnnouncement(players: ThreePlayerView[]): ThreeAllInAnnouncement | null {
  const latestPlayer = players.reduce<ThreePlayerView | null>((latest, player) => {
    if (player.actionCue !== 'all_in' || !player.actionKey) {
      return latest
    }

    if (!latest) {
      return player
    }

    return getActionOrderScore(player) >= getActionOrderScore(latest) ? player : latest
  }, null)

  if (!latestPlayer) {
    return null
  }

  return {
    actionKey: latestPlayer.actionKey,
    playerId: latestPlayer.id,
    nickname: latestPlayer.nickname,
    visualSeat: latestPlayer.visualSeat,
    amountLabel: getAllInAmountLabel(latestPlayer),
    isHero: latestPlayer.visualSeat === 0,
  }
}

function getActionOrderScore(player: ThreePlayerView): number {
  const source = player.lastActionId || player.actionKey
  const numericParts = source.match(/\d+/g)

  if (!numericParts?.length) {
    return 0
  }

  return numericParts
    .slice(-3)
    .reduce((score, part) => score * 1000 + Number(part), 0)
}

function getAllInAmountLabel(player: ThreePlayerView): string | null {
  const amountMatch = player.lastAction?.match(/\$([0-9][0-9,]*)/)

  if (amountMatch?.[1]) {
    return `$${amountMatch[1]}`
  }

  if (player.bet > 0) {
    return `$${player.bet.toLocaleString()}`
  }

  return null
}

function getBlindRole(player: SeatPlayer): ThreeBlindRole {
  if (player.isBB) {
    return 'big'
  }

  if (player.isSB) {
    return 'small'
  }

  return null
}

function getVisualSeat(playerSeatIndex: number, heroSeatIndex: number): number {
  return (playerSeatIndex - heroSeatIndex + 8) % 8
}

function toThreeCard(card: Card, prefix: string, visible: boolean): ThreeCardView {
  return {
    id: `${prefix}-${card.rank}-${card.suit}`,
    rank: card.rank,
    suit: card.suit,
    visible,
  }
}

function getActionCue(lastAction: string): ThreeActionCue {
  const normalized = lastAction.toLowerCase()

  if (normalized.includes('fold')) {
    return 'fold'
  }

  if (normalized.includes('check')) {
    return 'check'
  }

  if (normalized.includes('all-in') || normalized.includes('all in')) {
    return 'all_in'
  }

  if (normalized.includes('call')) {
    return 'call'
  }

  if (normalized.includes('raise')) {
    return 'raise'
  }

  if (normalized.includes('bet')) {
    return 'bet'
  }

  return 'ready'
}

function getPhaseActionLabel(state: TableState): string {
  if (state.phase === 'in_hand') {
    return 'Hand live'
  }

  if (state.phase === 'between_hands') {
    return 'Between hands'
  }

  return 'Waiting for players'
}
