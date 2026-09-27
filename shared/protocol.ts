import type { TableState } from '../lib/poker/types'
import type { ShowCardsMode } from '../lib/poker/types'
import {
  normalizeEmail,
  normalizePlayerAvatarCustomization,
  normalizeVenmoUsername,
  validatePlayerProfile,
  type PlayerAvatarCustomization,
} from '../lib/profile'
import { DRINK_EVENT_KINDS, type DrinkEvent, type DrinkKind } from '../lib/drinks'
import { isValidPrankEvent, type PrankEvent } from '../lib/pranks'
import {
  isValidMushroomEvent,
  isValidPrivateMushroomState,
  type MushroomEvent,
  type PrivateMushroomState,
} from '../lib/mushroom'

export type { DrinkEvent, DrinkKind } from '../lib/drinks'
export type { PrankEvent } from '../lib/pranks'
export type { MushroomEvent, PrivateMushroomState } from '../lib/mushroom'

/** Development-only table tricks for capturing effects (ignored by production servers). */
export type DevFunAction = 'mushroom' | 'trip' | 'blackout' | 'hangover' | 'sober'
export const DEV_FUN_ACTIONS: readonly DevFunAction[] = ['mushroom', 'trip', 'blackout', 'hangover', 'sober']

export interface TableChatEntry {
  id: string
  playerId: string
  nickname: string
  message: string
  createdAt: number
  targetPlayerId?: string
}

export interface PlayerSocialState {
  playerId: string
  message?: string
  messageExpiresAt?: number
  messageTargetPlayerId?: string
  emote?: string
  emoteExpiresAt?: number
  targetPlayerId?: string
}

export interface SocialSnapshot {
  active: PlayerSocialState[]
  chatLog: TableChatEntry[]
}

// Client -> Server messages
export type C2SMessage =
  | {
    type: 'join_room'
    nickname: string
    /** Legacy profile fields accepted for older clients, but no longer collected. */
    email?: string
    venmoUsername?: string
    avatar?: PlayerAvatarCustomization
    reconnectToken?: string
  }
  | { type: 'update_avatar'; avatar: PlayerAvatarCustomization }
  | { type: 'seat_me'; seatIndex?: number }
  | { type: 'start_game' }
  | { type: 'add_bots'; count: number }
  | { type: 'set_auto_start'; enabled: boolean }
  | { type: 'rabbit_hunt' }
  | { type: 'run_it_twice_vote'; vote: 'yes' | 'no' }
  | { type: 'player_action'; action: 'fold' | 'check' | 'call' | 'raise' | 'all_in'; amount?: number }
  | {
    type: 'update_table_settings'
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
    funModeEnabled?: boolean
  }
  | { type: 'leave_room' }
  | { type: 'rebuy'; amount: number }
  | { type: 'remove_player'; targetId: string }
  | { type: 'adjust_player_stack'; targetId: string; amount: number }
  | { type: 'set_player_spectator'; targetId: string; spectator: boolean }
  | { type: 'set_show_cards'; mode: ShowCardsMode }
  | { type: 'request_card_reveal'; targetId: string }
  | { type: 'respond_card_reveal'; requesterId: string; allow: boolean }
  | { type: 'table_chat'; message: string; targetId?: string }
  | { type: 'table_emote'; emote: string; targetId?: string }
  | { type: 'order_drink'; kind: DrinkKind }
  /** Buy another seated player a shot (+3 drunk levels). */
  | { type: 'buy_shot'; targetId: string }
  /** Flick a (cosmetic) chip at another seated player's head. */
  | { type: 'flick_chip'; targetId: string }
  /** This client can (desktop 3D) or cannot (phone / 2D layout) order drinks. */
  | { type: 'set_drink_capable'; capable: boolean }
  /** Secretly slip your mushroom into another seated player's next water. */
  | { type: 'spike_water'; targetId: string }
  /** Dev builds only (localhost server): force a fun effect on the sender or a target. */
  | { type: 'dev_fun'; action: DevFunAction; targetId?: string }
  | { type: 'companion_mute' }
  /** The sender is privately looking at (squeezing) their own hole cards. */
  | { type: 'peek_cards'; peeking: boolean }
  /** Sit out of upcoming hands (false = I'm back). */
  | { type: 'set_sitting_out'; sittingOut: boolean }

// Server -> Client messages
export type S2CMessage =
  | { type: 'room_snapshot'; state: TableState }
  | { type: 'social_snapshot'; social: SocialSnapshot }
  | {
    type: 'private_session'
    yourId: string
    reconnectToken: string
    isHost: boolean
    /** Only ever present for the mushroom's holder or spiker. */
    mushroom?: PrivateMushroomState
  }
  | { type: 'action_result'; success: true; message?: string }
  | { type: 'action_failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'drink_event'; event: DrinkEvent }
  | { type: 'prank_event'; event: PrankEvent }
  /** Mushroom news: private (found / spiked / lost) or table-wide (trip started / ended). */
  | { type: 'mushroom_event'; event: MushroomEvent }
  /** This connection no longer speaks for a player (kicked, opened elsewhere, name in use). */
  | { type: 'session_ended'; reason: SessionEndedReason; message: string }
  /** Table-wide heads-up, e.g. a new host. */
  | { type: 'notice'; kind: 'host_changed'; message: string; playerId?: string }

export type SessionEndedReason = 'kicked' | 'replaced' | 'name_taken'

export const MAX_CHAT_LENGTH = 140
const ALLOWED_CHAT_MESSAGE_RE = /\s+/g
const FORBIDDEN_CONTROL_RE = /[\u0000-\u001f\u007f\u0080-\u009f]/g
const EMOJI_ONLY_RE = /^(?:\p{Emoji}|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u

export function sanitizeText(raw: string, maxLength = MAX_CHAT_LENGTH): string {
  return raw
    .replace(FORBIDDEN_CONTROL_RE, '')
    .replace(ALLOWED_CHAT_MESSAGE_RE, ' ')
    .trim()
    .slice(0, maxLength)
}

export function sanitizeEmote(raw: string, maxLength = 16): string {
  const value = raw
    .replace(FORBIDDEN_CONTROL_RE, '')
    .trim()
    .slice(0, maxLength)

  return value && EMOJI_ONLY_RE.test(value) ? value : ''
}

export function isAllowedEmote(value: unknown): value is string {
  return typeof value === 'string' && sanitizeEmote(value, 16).length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseShowCardsMode(raw: unknown): ShowCardsMode | null {
  if (typeof raw === 'string') {
    return raw === 'none' || raw === 'left' || raw === 'right' || raw === 'both'
      ? raw
      : null
  }

  if (typeof raw === 'boolean') {
    return raw ? 'both' : 'none'
  }

  return null
}

// Helper to parse incoming C2S messages safely
export function parseC2S(raw: string): C2SMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      return null
    }

    const type = parsed.type

    switch (type) {
      case 'join_room': {
        const nickname = typeof parsed.nickname === 'string' ? parsed.nickname : ''
        const email = typeof parsed.email === 'string' ? normalizeEmail(parsed.email) : ''
        const venmoUsername =
          typeof parsed.venmoUsername === 'string' ? normalizeVenmoUsername(parsed.venmoUsername) : ''
        const reconnectToken =
          parsed.reconnectToken === undefined || typeof parsed.reconnectToken === 'string'
            ? parsed.reconnectToken
            : undefined
        const avatar = parsed.avatar === undefined
          ? undefined
          : normalizePlayerAvatarCustomization(parsed.avatar)
        const profile = validatePlayerProfile({ nickname, email, venmoUsername, avatar })
        return profile.ok
          ? {
            type,
            nickname,
            email: profile.profile.email,
            venmoUsername: profile.profile.venmoUsername,
            ...(profile.profile.avatar ? { avatar: profile.profile.avatar } : {}),
            reconnectToken,
          }
          : null
      }

      case 'update_avatar':
        return isObject(parsed.avatar)
          ? { type, avatar: normalizePlayerAvatarCustomization(parsed.avatar) }
          : null

      case 'seat_me': {
        if (parsed.seatIndex === undefined) {
          return { type }
        }
        const seatIndex = Number(parsed.seatIndex)
        return Number.isInteger(seatIndex) ? { type, seatIndex } : null
      }

      case 'start_game':
        return { type }

      case 'add_bots': {
        const count = Number(parsed.count)
        return Number.isInteger(count) ? { type, count } : null
      }

      case 'set_auto_start': {
        return typeof parsed.enabled === 'boolean' ? { type, enabled: parsed.enabled } : null
      }

      case 'rabbit_hunt':
        return { type }

      case 'run_it_twice_vote': {
        const vote = parsed.vote
        return vote === 'yes' || vote === 'no' ? { type, vote } : null
      }

      case 'player_action': {
        const action = parsed.action
        if (
          action !== 'fold' &&
          action !== 'check' &&
          action !== 'call' &&
          action !== 'raise' &&
          action !== 'all_in'
        ) {
          return null
        }

        if (action === 'raise' && parsed.amount !== undefined) {
          const amount = Number(parsed.amount)
          return Number.isFinite(amount) ? { type, action, amount } : null
        }

        return { type, action }
      }

      case 'update_table_settings': {
        const next: Extract<C2SMessage, { type: 'update_table_settings' }> = { type }
        if (typeof parsed.smallBlind === 'number') {
          next.smallBlind = Math.max(0, Math.floor(parsed.smallBlind))
        }
        if (typeof parsed.bigBlind === 'number') {
          next.bigBlind = Math.max(0, Math.floor(parsed.bigBlind))
        }
        if (typeof parsed.startingStack === 'number') {
          next.startingStack = Math.max(0, Math.floor(parsed.startingStack))
        }
        if (typeof parsed.actionTimerDuration === 'number') {
          next.actionTimerDuration = Math.max(1000, Math.floor(parsed.actionTimerDuration))
        }
        if (typeof parsed.autoStartDelay === 'number') {
          next.autoStartDelay = Math.max(1000, Math.floor(parsed.autoStartDelay))
        }
        if (typeof parsed.rabbitHuntingEnabled === 'boolean') {
          next.rabbitHuntingEnabled = parsed.rabbitHuntingEnabled
        }
        if (typeof parsed.sevenTwoRuleEnabled === 'boolean') {
          next.sevenTwoRuleEnabled = parsed.sevenTwoRuleEnabled
        }
        if (typeof parsed.sevenTwoBountyPercent === 'number') {
          next.sevenTwoBountyPercent = Math.max(0, Number(parsed.sevenTwoBountyPercent))
        }
        if (typeof parsed.funModeEnabled === 'boolean') {
          next.funModeEnabled = parsed.funModeEnabled
        }
        return next
      }

      case 'leave_room':
        return { type }

      case 'rebuy': {
        const amount = Number(parsed.amount)
        return Number.isFinite(amount) ? { type, amount } : null
      }

      case 'remove_player': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : ''
        return targetId ? { type, targetId } : null
      }

      case 'adjust_player_stack': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : ''
        const amount = Number(parsed.amount)
        return targetId && Number.isFinite(amount) ? { type, targetId, amount } : null
      }

      case 'set_player_spectator': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : ''
        return targetId && typeof parsed.spectator === 'boolean'
          ? { type, targetId, spectator: parsed.spectator }
          : null
      }

      case 'set_show_cards': {
        const mode = parseShowCardsMode(parsed.mode ?? parsed.show)
        return mode ? { type, mode } : null
      }

      case 'request_card_reveal': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : ''
        return targetId ? { type, targetId } : null
      }

      case 'respond_card_reveal': {
        const requesterId = typeof parsed.requesterId === 'string' ? parsed.requesterId.trim() : ''
        return requesterId && typeof parsed.allow === 'boolean'
          ? { type, requesterId, allow: parsed.allow }
          : null
      }

      case 'table_chat': {
        const message = typeof parsed.message === 'string' ? sanitizeText(parsed.message) : ''
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : undefined
        return message ? { type, message, targetId } : null
      }

      case 'table_emote': {
        const emote = typeof parsed.emote === 'string' ? sanitizeEmote(parsed.emote, 16) : ''
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : undefined
        return emote ? { type, emote, targetId } : null
      }

      case 'order_drink': {
        const kind = parsed.kind
        return kind === 'beer' || kind === 'water' ? { type, kind } : null
      }

      case 'buy_shot':
      case 'flick_chip': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : ''
        return targetId && targetId.length <= 64 ? { type, targetId } : null
      }

      case 'set_drink_capable':
        return typeof parsed.capable === 'boolean' ? { type, capable: parsed.capable } : null

      case 'spike_water': {
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim() : ''
        return targetId && targetId.length <= 64 ? { type, targetId } : null
      }

      case 'dev_fun': {
        const action = parsed.action
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId.trim().slice(0, 64) : undefined
        return typeof action === 'string' && (DEV_FUN_ACTIONS as readonly string[]).includes(action)
          ? { type, action: action as DevFunAction, ...(targetId ? { targetId } : {}) }
          : null
      }

      case 'companion_mute':
        return { type }

      case 'peek_cards':
        return typeof parsed.peeking === 'boolean' ? { type, peeking: parsed.peeking } : null

      case 'set_sitting_out':
        return typeof parsed.sittingOut === 'boolean' ? { type, sittingOut: parsed.sittingOut } : null

      default:
        return null
    }
  } catch {
    return null
  }
}

// Helper to parse outgoing S2C messages safely
export function parseS2C(raw: string): S2CMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      return null
    }

    const type = parsed.type
    switch (type) {
      case 'room_snapshot':
        return isObject(parsed.state) ? { type, state: parsed.state as unknown as TableState } : null

      case 'social_snapshot':
        return isValidSocialSnapshot(parsed.social as unknown)
          ? { type, social: parsed.social as unknown as SocialSnapshot }
          : null

      case 'private_session': {
        const yourId = typeof parsed.yourId === 'string' ? parsed.yourId : ''
        const reconnectToken = typeof parsed.reconnectToken === 'string' ? parsed.reconnectToken : ''
        const isHost = typeof parsed.isHost === 'boolean' ? parsed.isHost : false
        const mushroom = isValidPrivateMushroomState(parsed.mushroom) ? parsed.mushroom : undefined
        return yourId && reconnectToken
          ? { type, yourId, reconnectToken, isHost, ...(mushroom ? { mushroom } : {}) }
          : null
      }

      case 'action_result': {
        if (typeof parsed.success !== 'boolean' || parsed.success !== true) {
          return null
        }
        const message = typeof parsed.message === 'string' ? parsed.message : undefined
        return { type, success: true, message }
      }

      case 'action_failed': {
        const message = typeof parsed.message === 'string' ? parsed.message : ''
        return message ? { type, message } : null
      }

      case 'error': {
        const message = typeof parsed.message === 'string' ? parsed.message : ''
        return message ? { type, message } : null
      }

      case 'drink_event':
        return isValidDrinkEvent(parsed.event)
          ? { type, event: { ...parsed.event, nickname: sanitizeText(parsed.event.nickname, 40) } }
          : null

      case 'prank_event':
        return isValidPrankEvent(parsed.event)
          ? {
            type,
            event: {
              ...parsed.event,
              fromNickname: sanitizeText(parsed.event.fromNickname, 40),
              targetNickname: sanitizeText(parsed.event.targetNickname, 40),
            },
          }
          : null

      case 'mushroom_event':
        return isValidMushroomEvent(parsed.event)
          ? {
            type,
            event: {
              ...parsed.event,
              ...(parsed.event.spikerNickname !== undefined ? { spikerNickname: sanitizeText(parsed.event.spikerNickname, 40) } : {}),
              ...(parsed.event.victimNickname !== undefined ? { victimNickname: sanitizeText(parsed.event.victimNickname, 40) } : {}),
            },
          }
          : null

      case 'session_ended': {
        const reason = parsed.reason
        const message = typeof parsed.message === 'string' ? sanitizeText(parsed.message, 240) : ''
        return (reason === 'kicked' || reason === 'replaced' || reason === 'name_taken')
          ? { type, reason, message }
          : null
      }

      case 'notice': {
        const message = typeof parsed.message === 'string' ? sanitizeText(parsed.message, 160) : ''
        const playerId = typeof parsed.playerId === 'string' ? parsed.playerId : undefined
        return parsed.kind === 'host_changed' && message
          ? { type, kind: 'host_changed', message, ...(playerId ? { playerId } : {}) }
          : null
      }

      default:
        return null
    }
  } catch {
    return null
  }
}

export function isValidDrinkEvent(raw: unknown): raw is DrinkEvent {
  if (!isObject(raw)) {
    return false
  }

  const event = raw as Partial<DrinkEvent>
  return (
    typeof event.id === 'string' && event.id.length > 0 &&
    typeof event.playerId === 'string' && event.playerId.trim().length > 0 &&
    typeof event.nickname === 'string' &&
    typeof event.kind === 'string' && (DRINK_EVENT_KINDS as readonly string[]).includes(event.kind) &&
    typeof event.level === 'number' && Number.isInteger(event.level) && event.level >= 0 && event.level <= 10 &&
    typeof event.beers === 'number' && Number.isInteger(event.beers) && event.beers >= 0 &&
    typeof event.at === 'number' && Number.isFinite(event.at)
  )
}

function isValidSocialSnapshot(raw: unknown): raw is SocialSnapshot {
  if (!isObject(raw)) {
    return false
  }

  const snapshot = raw as unknown as SocialSnapshot
  if (!Array.isArray(snapshot.active) || !Array.isArray(snapshot.chatLog)) {
    return false
  }

  return snapshot.active.every((entry): entry is PlayerSocialState => {
    if (!entry || typeof entry !== 'object') {
      return false
    }

    if (typeof entry.playerId !== 'string' || !entry.playerId.trim()) {
      return false
    }

    if (entry.message !== undefined && typeof entry.message !== 'string') {
      return false
    }

    if (entry.messageExpiresAt !== undefined && typeof entry.messageExpiresAt !== 'number') {
      return false
    }

    if (entry.messageTargetPlayerId !== undefined && typeof entry.messageTargetPlayerId !== 'string') {
      return false
    }

    if (entry.emote !== undefined && typeof entry.emote !== 'string') {
      return false
    }

    if (entry.emoteExpiresAt !== undefined && typeof entry.emoteExpiresAt !== 'number') {
      return false
    }

    return true
  }) && snapshot.chatLog.every((entry): entry is TableChatEntry => {
    if (!entry || typeof entry !== 'object') {
      return false
    }

    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      return false
    }

    if (typeof entry.playerId !== 'string' || !entry.playerId.trim()) {
      return false
    }

    if (typeof entry.nickname !== 'string') {
      return false
    }

    if (typeof entry.message !== 'string') {
      return false
    }

    if (entry.targetPlayerId !== undefined && typeof entry.targetPlayerId !== 'string') {
      return false
    }

    if (typeof entry.createdAt !== 'number' || Number.isNaN(entry.createdAt)) {
      return false
    }

    return true
  })
}

// Room state stored in PartyKit storage
export interface RoomStorageState {
  gameState: import('../lib/poker/types').InternalGameState | null
  hostId: string | null
  reconnectTokens: Record<string, string>
  playerNicknames: Record<string, string>
  tableSettings: {
    smallBlind: number
    bigBlind: number
    startingStack: number
    maxPlayers: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
    funModeEnabled?: boolean
  }
}
