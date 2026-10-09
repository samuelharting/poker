'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TableState } from '@/lib/poker/types'
import { LADY_LUCK_MUTE_EVENT } from '@/lib/ladyLuckLines'
import type { PlayerProfile } from '@/lib/profile'
import {
  MAX_CHAT_LENGTH,
  parseS2C,
  sanitizeEmote,
  sanitizeText,
  type C2SMessage,
  type DrinkEvent,
  type DrinkKind,
  type DevFunAction,
  type MushroomEvent,
  type NoticeKind,
  type PrivateMushroomState,
  type PlayerSocialState,
  type PrankEvent,
  type SessionEndedReason,
  type SocialSnapshot,
  type S2CMessage,
  type TableChatEntry,
} from '@/shared/protocol'

// In production, set NEXT_PUBLIC_PARTYKIT_HOST to your deployed PartyKit domain.
// Local dev defaults to localhost:1999 so `npm run dev` continues working.
const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999'
const PARTY_NAME = process.env.NEXT_PUBLIC_PARTY_NAME ?? 'main'
const LOCAL_PARTYKIT_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/i
const BACKGROUND_RECONNECT_THRESHOLD_MS = 10_000
const MAX_DRINK_EVENTS = 12
const MAX_ROOM_NOTICES = 4
/** How long a reconnecting tab keeps its last table while waiting for its own snapshot. */
const REJOIN_SNAPSHOT_GRACE_MS = 4_000
/** The same rejection twice in this window shows one toast. */
const ERROR_TOAST_DEDUPE_MS = 4_000

/**
 * Server rejections that are expected noise, not news: races the UI already
 * resolves (a double-clicked action, an auto-seat that was already done) or
 * messages sent while the socket was still rejoining.
 */
const QUIET_REJECTIONS: RegExp[] = [
  /^Join the room before/i,
  /^Already seated$/i,
  /not your turn/i,
  /^Hand already in progress$/i,
  /^Invalid message format$/i,
  /^Unknown message type$/i,
  /^Player profile not found$/i,
]

export function isQuietRejection(message: string): boolean {
  return QUIET_REJECTIONS.some(pattern => pattern.test(message.trim()))
}

function buildConnectionIssue(): string {
  if (LOCAL_PARTYKIT_HOST_PATTERN.test(PARTYKIT_HOST)) {
    return `Can't reach the local table server at ${PARTYKIT_HOST}. Start \`npm run dev\` or \`npm run dev:party\`, then retry.`
  }

  return `Can't reach the live table server at ${PARTYKIT_HOST}. Check that the PartyKit host is running and reachable, then retry.`
}

function reconnectTokenStorageKey(roomCode: string): string {
  return `poker_reconnect_${roomCode}`
}

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window[kind]
  } catch {
    return null
  }
}

export function loadStoredReconnectToken(roomCode: string): string | null {
  const key = reconnectTokenStorageKey(roomCode)
  const persistentStorage = getBrowserStorage('localStorage')
  const sessionStorage = getBrowserStorage('sessionStorage')

  try {
    // This tab's own identity first: two tabs of one browser (different
    // nicknames) share localStorage, and a reload must not pick up the other
    // tab's token. A brand-new tab falls back to the browser-wide one.
    const tabToken = sessionStorage?.getItem(key) ?? null
    if (tabToken) {
      if (!persistentStorage?.getItem(key)) {
        persistentStorage?.setItem(key, tabToken)
      }
      return tabToken
    }

    return persistentStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function storeReconnectToken(roomCode: string, token: string): void {
  const key = reconnectTokenStorageKey(roomCode)
  for (const storage of [getBrowserStorage('localStorage'), getBrowserStorage('sessionStorage')]) {
    try {
      storage?.setItem(key, token)
    } catch {
      // Storage can be unavailable in private browsing; the in-memory ref still reconnects this tab.
    }
  }
}

export function clearStoredReconnectToken(roomCode: string): void {
  const key = reconnectTokenStorageKey(roomCode)
  for (const storage of [getBrowserStorage('localStorage'), getBrowserStorage('sessionStorage')]) {
    try {
      storage?.removeItem(key)
    } catch {
      // Leaving the room should still continue when browser storage is unavailable.
    }
  }
}

interface RoomSocket {
  readyState: number
  close: () => void
  reconnect: () => void
  send: (message: string) => void
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => void
}

/** Why this tab stopped speaking for a player (kicked, opened elsewhere, name in use). */
export interface SessionEnded {
  reason: SessionEndedReason
  message: string
}

export interface RoomNotice {
  id: string
  /** Server notices, plus 'error' for an action the server turned down. */
  kind: NoticeKind | 'error'
  message: string
  playerId?: string
}

export interface RoomState {
  tableState: TableState | null
  socialState: SocialSnapshot
  yourId: string
  isHost: boolean
  isConnected: boolean
  connectionIssue: string | null
  sendAction: (
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
    amount?: number
  ) => void
  seatMe: () => void
  sendMessage: (msg: C2SMessage) => void
  /** Most recent drink events (beers, waters, pass-outs), oldest first. */
  drinkEvents: DrinkEvent[]
  orderDrink: (kind: DrinkKind) => void
  /** Most recent pranks (shots bought, chips flicked), oldest first. */
  prankEvents: PrankEvent[]
  buyShot: (targetId: string) => void
  flickChip: (targetId: string) => void
  /** Stick a short word on a seated player's forehead for the rest of the hand. */
  stickyNote: (targetId: string, text: string) => void
  /** The pill (internally "mushroom"): public reveals and this player's private news, oldest first. */
  mushroomEvents: MushroomEvent[]
  /** What only this player knows about the pill (holding it / who they spiked). */
  privateMushroom: PrivateMushroomState | null
  spikeWater: (targetId: string) => void
  /** Set once the server ends this tab's session; the socket is closed and stays closed. */
  sessionEnded: SessionEnded | null
  /** Table-wide notices (e.g. a new host), newest last. */
  notices: RoomNotice[]
  dismissNotice: (id: string) => void
}

export function useRoom(
  roomCode: string,
  profile: PlayerProfile
): RoomState {
  const socketRef = useRef<RoomSocket | null>(null)
  const latestProfileRef = useRef(profile)
  latestProfileRef.current = profile
  const reconnectTokenRef = useRef<string | null>(null)
  const hasSeated = useRef(false)
  const hasEverConnectedRef = useRef(false)
  const connectionIssueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerIdsRef = useRef<Set<string>>(new Set())
  /** Last player id this tab spoke for: set means a reconnect is a rejoin. */
  const knownPlayerIdRef = useRef('')
  /** Rejoining: snapshots built for an anonymous socket are held back until ours arrives. */
  const rejoinUntilRef = useRef(0)
  const heldSnapshotRef = useRef<TableState | null>(null)
  const lastSocialRawRef = useRef('')
  const lastSnapshotKeyRef = useRef('')
  const lastErrorRef = useRef<{ message: string; at: number } | null>(null)
  /** The player id this tab last auto-seated (a new id after a server restart seats again). */
  const autoSeatedIdRef = useRef<string | null>(null)
  const [tableState, setTableState] = useState<TableState | null>(null)
  const [socialState, setSocialState] = useState<SocialSnapshot>({ active: [], chatLog: [] })
  const [yourId, setYourId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null)
  const [drinkEvents, setDrinkEvents] = useState<DrinkEvent[]>([])
  const [prankEvents, setPrankEvents] = useState<PrankEvent[]>([])
  const [mushroomEvents, setMushroomEvents] = useState<MushroomEvent[]>([])
  const [privateMushroom, setPrivateMushroom] = useState<PrivateMushroomState | null>(null)
  const [sessionEnded, setSessionEnded] = useState<SessionEnded | null>(null)
  const [notices, setNotices] = useState<RoomNotice[]>([])
  const sessionEndedRef = useRef(false)
  const dismissNotice = useCallback((id: string) => {
    setNotices(previous => previous.filter(notice => notice.id !== id))
  }, [])
  const sendMessage = useCallback((msg: C2SMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const sendAction = useCallback(
    (action: 'fold' | 'check' | 'call' | 'raise' | 'all_in', amount?: number) => {
      sendMessage({ type: 'player_action', action, amount })
    },
    [sendMessage]
  )

  const seatMe = useCallback(() => {
    sendMessage({ type: 'seat_me' })
  }, [sendMessage])

  const orderDrink = useCallback((kind: DrinkKind) => {
    sendMessage({ type: 'order_drink', kind })
  }, [sendMessage])

  const buyShot = useCallback((targetId: string) => {
    sendMessage({ type: 'buy_shot', targetId })
  }, [sendMessage])

  const flickChip = useCallback((targetId: string) => {
    sendMessage({ type: 'flick_chip', targetId })
  }, [sendMessage])

  const stickyNote = useCallback((targetId: string, text: string) => {
    sendMessage({ type: 'sticky_note', targetId, text })
  }, [sendMessage])

  const spikeWater = useCallback((targetId: string) => {
    sendMessage({ type: 'spike_water', targetId })
  }, [sendMessage])

  // Development builds only: `window.__pokerDev.fun('trip')` etc. for effect
  // captures (the server also ignores these unless it is a local dev server).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const dev = { fun: (action: DevFunAction, targetId?: string) => sendMessage({ type: 'dev_fun', action, targetId }) }
    ;(window as unknown as { __pokerDev?: typeof dev }).__pokerDev = dev
    return () => {
      delete (window as unknown as { __pokerDev?: typeof dev }).__pokerDev
    }
  }, [sendMessage])

  // Lady Luck's "shut up" button dispatches a window event (see lib/ladyLuckLines).
  useEffect(() => {
    const onMute = () => sendMessage({ type: 'companion_mute' })
    window.addEventListener(LADY_LUCK_MUTE_EVENT, onMute)
    return () => window.removeEventListener(LADY_LUCK_MUTE_EVENT, onMute)
  }, [sendMessage])

  useEffect(() => {
    if (!roomCode || !profile.nickname) {
      return
    }

    hasSeated.current = false
    autoSeatedIdRef.current = null
    knownPlayerIdRef.current = ''
    rejoinUntilRef.current = 0
    heldSnapshotRef.current = null
    lastSocialRawRef.current = ''
    lastSnapshotKeyRef.current = ''
    hasEverConnectedRef.current = false
    sessionEndedRef.current = false
    setSessionEnded(null)
    setNotices([])
    setTableState(null)
    setSocialState({ active: [], chatLog: [] })
    setDrinkEvents([])
    setMushroomEvents([])
    setPrivateMushroom(null)
    setYourId('')
    setIsHost(false)
    setIsConnected(false)
    setConnectionIssue(null)

    if (connectionIssueTimerRef.current) {
      clearTimeout(connectionIssueTimerRef.current)
      connectionIssueTimerRef.current = null
    }

    reconnectTokenRef.current = loadStoredReconnectToken(roomCode)
    let active = true
    let removeLifecycleListeners: (() => void) | null = null

    ;(async () => {
      try {
        const module = await import('partysocket')
        if (!active) {
          return
        }

        const PartySocket = module.default
        const socket = new PartySocket({
          host: PARTYKIT_HOST,
          room: roomCode.toLowerCase(),
          party: PARTY_NAME,
          startClosed: true,
          // Back quickly after a server restart (a deploy): the default backoff
          // (1-5s growing to 10s) left players staring at "Reconnecting" long
          // after the table was back. Jittered so a full table does not stampede.
          minReconnectionDelay: 400 + Math.random() * 800,
          maxReconnectionDelay: 4_000,
        }) as unknown as RoomSocket

        socketRef.current = socket
        let inactiveAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null

        const markInactive = () => {
          inactiveAt ??= Date.now()
        }
        const refreshConnection = (force = false) => {
          if (!active || socketRef.current !== socket || sessionEndedRef.current) {
            return
          }

          if (force || socket.readyState !== WebSocket.OPEN) {
            socket.reconnect()
          }
        }
        const markActive = () => {
          const inactiveDuration = inactiveAt === null ? 0 : Date.now() - inactiveAt
          inactiveAt = null
          refreshConnection(inactiveDuration >= BACKGROUND_RECONNECT_THRESHOLD_MS)
        }
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'hidden') {
            markInactive()
          } else {
            markActive()
          }
        }
        const handleOnline = () => refreshConnection(true)
        const handlePageShow = () => markActive()

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('blur', markInactive)
        window.addEventListener('focus', markActive)
        window.addEventListener('online', handleOnline)
        window.addEventListener('pageshow', handlePageShow)
        removeLifecycleListeners = () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('blur', markInactive)
          window.removeEventListener('focus', markActive)
          window.removeEventListener('online', handleOnline)
          window.removeEventListener('pageshow', handlePageShow)
        }

        connectionIssueTimerRef.current = setTimeout(() => {
          if (active && !hasEverConnectedRef.current) {
            setConnectionIssue(buildConnectionIssue())
          }
        }, 2500)

        socket.addEventListener('open', () => {
          hasEverConnectedRef.current = true
          if (connectionIssueTimerRef.current) {
            clearTimeout(connectionIssueTimerRef.current)
            connectionIssueTimerRef.current = null
          }
          setIsConnected(true)
          setConnectionIssue(null)
          // A fresh socket gets an anonymous snapshot before our join lands;
          // a returning player keeps showing their own table until theirs arrives.
          rejoinUntilRef.current = knownPlayerIdRef.current ? Date.now() + REJOIN_SNAPSHOT_GRACE_MS : 0
          heldSnapshotRef.current = null
          lastSnapshotKeyRef.current = ''
          lastSocialRawRef.current = ''
          const latestProfile = latestProfileRef.current
          const joinMsg: C2SMessage = {
            type: 'join_room',
            nickname: latestProfile.nickname,
            avatar: latestProfile.avatar,
            reconnectToken: reconnectTokenRef.current ?? undefined,
          }
          socket.send(JSON.stringify(joinMsg))
        })

        socket.addEventListener('message', event => {
          const payload = event as MessageEvent
          const msg = parseS2C(payload.data as string)
          if (!msg) {
            return
          }

          switch (msg.type) {
            case 'room_snapshot': {
              if (msg.state.viewerId === '' && rejoinUntilRef.current > Date.now()) {
                heldSnapshotRef.current = msg.state
                break
              }
              rejoinUntilRef.current = 0
              heldSnapshotRef.current = null
              // A broadcast that changes nothing for this viewer (other than the
              // server clock) would still re-render the whole table.
              const snapshotKey = typeof payload.data === 'string'
                ? payload.data.replace(/"serverNow":\d+,?/, '')
                : ''
              if (snapshotKey && snapshotKey === lastSnapshotKeyRef.current) {
                break
              }
              lastSnapshotKeyRef.current = snapshotKey
              setTableState(msg.state)
              playerIdsRef.current = new Set(
                (msg.state.lobbyPlayers?.length
                  ? msg.state.lobbyPlayers.map(player => player.id)
                  : msg.state.players.map(player => player.id))
              )
              break
            }

            case 'social_snapshot': {
              // Sent with every table broadcast; most are unchanged.
              const socialRaw = typeof payload.data === 'string' ? payload.data : ''
              if (socialRaw && socialRaw === lastSocialRawRef.current) {
                break
              }
              lastSocialRawRef.current = socialRaw
              const playerIds = playerIdsRef.current
              setSocialState(previous => {
                const sanitized = sanitizeSocialSnapshot(msg.social, playerIds)
                return {
                  ...sanitized,
                  chatLog: combineChatLogs(sanitized.chatLog, previous.chatLog),
                }
              })
              break
            }

            case 'private_session': {
              knownPlayerIdRef.current = msg.yourId
              if (heldSnapshotRef.current) {
                // Joined, but our own snapshot has not come yet: the held one is
                // better than nothing (e.g. the server lost the table and made us new).
                setTableState(heldSnapshotRef.current)
                heldSnapshotRef.current = null
              }
              rejoinUntilRef.current = 0
              setYourId(msg.yourId)
              setIsHost(msg.isHost)
              reconnectTokenRef.current = msg.reconnectToken
              storeReconnectToken(roomCode, msg.reconnectToken)
              setPrivateMushroom(previous => {
                const next = msg.mushroom ?? null
                return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
              })
              break
            }

            case 'mushroom_event': {
              const event = msg.event
              setMushroomEvents(previous => [
                ...previous.filter(entry => entry.id !== event.id),
                event,
              ].slice(-MAX_DRINK_EVENTS))
              break
            }

            case 'drink_event': {
              const event = msg.event
              setDrinkEvents(previous => [
                ...previous.filter(entry => entry.id !== event.id),
                event,
              ].slice(-MAX_DRINK_EVENTS))
              break
            }

            case 'prank_event': {
              const event = msg.event
              setPrankEvents(previous => [
                ...previous.filter(entry => entry.id !== event.id),
                event,
              ].slice(-MAX_DRINK_EVENTS))
              break
            }

            case 'session_ended': {
              // Stop following the table: no auto-reconnect, no stale seat.
              sessionEndedRef.current = true
              if (msg.reason === 'kicked') {
                clearStoredReconnectToken(roomCode)
                reconnectTokenRef.current = null
              }
              setSessionEnded({ reason: msg.reason, message: msg.message })
              setYourId('')
              setIsHost(false)
              socket.close()
              break
            }

            case 'notice': {
              const notice: RoomNotice = {
                id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                kind: msg.kind,
                message: msg.message,
                playerId: msg.playerId,
              }
              setNotices(previous => [...previous, notice].slice(-MAX_ROOM_NOTICES))
              break
            }

            case 'action_failed':
            case 'error': {
              // Every rejection used to vanish silently; show the ones that matter.
              const message = msg.message.trim()
              if (!message || isQuietRejection(message)) break
              const now = Date.now()
              const last = lastErrorRef.current
              if (last && last.message === message && now - last.at < ERROR_TOAST_DEDUPE_MS) break
              lastErrorRef.current = { message, at: now }
              const notice: RoomNotice = {
                id: `error_${now}_${Math.random().toString(36).slice(2, 7)}`,
                kind: 'error',
                message,
              }
              setNotices(previous => [...previous, notice].slice(-MAX_ROOM_NOTICES))
              break
            }

            case 'action_result':
              break
          }
        })

        socket.addEventListener('close', () => {
          setIsConnected(false)
          if (!hasEverConnectedRef.current) {
            setConnectionIssue(buildConnectionIssue())
          }
        })

        socket.addEventListener('error', () => {
          setIsConnected(false)
          if (!hasEverConnectedRef.current) {
            setConnectionIssue(buildConnectionIssue())
          }
        })

        socket.reconnect()
      } catch {
        if (active) {
          setIsConnected(false)
          setConnectionIssue('Unable to load the live table connection.')
        }
      }
    })()

    return () => {
      active = false
      removeLifecycleListeners?.()
      removeLifecycleListeners = null
      if (connectionIssueTimerRef.current) {
        clearTimeout(connectionIssueTimerRef.current)
        connectionIssueTimerRef.current = null
      }
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [profile.nickname, roomCode])

  useEffect(() => {
    if (!yourId || !tableState || !isConnected) {
      return
    }

    const lobbySelf = tableState.lobbyPlayers?.find(player => player.id === yourId)
    if (lobbySelf?.isSpectator) {
      hasSeated.current = false
      autoSeatedIdRef.current = yourId
      return
    }

    if (tableState.players.some(player => player.id === yourId)) {
      hasSeated.current = true
      autoSeatedIdRef.current = yourId
      return
    }

    // Keyed by player id: if the table server restarted without our seat and
    // handed out a new identity, sit that new player down once as well.
    if (hasSeated.current && autoSeatedIdRef.current === yourId) {
      return
    }

    hasSeated.current = true
    autoSeatedIdRef.current = yourId
    sendMessage({ type: 'seat_me' })
  }, [isConnected, sendMessage, tableState, yourId])

  return {
    tableState,
    socialState,
    yourId,
    isHost,
    isConnected,
    connectionIssue,
    sendAction,
    seatMe,
    sendMessage,
    drinkEvents,
    orderDrink,
    prankEvents,
    buyShot,
    flickChip,
    stickyNote,
    mushroomEvents,
    privateMushroom,
    spikeWater,
    sessionEnded,

    notices,
    dismissNotice,
  }
}

function sanitizeSocialSnapshot(
  snapshot: SocialSnapshot,
  playerIds: Set<string> | null
): SocialSnapshot {
  const playerIdSet = playerIds ?? new Set<string>()
  const hasKnownPlayers = playerIdSet.size > 0
  const active = Array.isArray(snapshot.active)
    ? snapshot.active.reduce((acc, entry) => {
      const social = sanitizeSocialEntry(entry)
      if (!social) {
        return acc
      }

      if (
        (hasKnownPlayers && !playerIdSet.has(social.playerId)) ||
        (!social.message && !social.emote)
      ) {
        return acc
      }

      acc.push(social)
      return acc
    }, [] as PlayerSocialState[])
    : []

  const chatLog = Array.isArray(snapshot.chatLog)
    ? snapshot.chatLog.reduce((acc, entry) => {
      const chat = sanitizeChatLog(entry)
      if (!chat) {
        return acc
      }

      if (hasKnownPlayers && !playerIdSet.has(chat.playerId)) {
        return acc
      }

      acc.push(chat)
      return acc
    }, [] as TableChatEntry[])
      .slice(-20)
    : []

  return { active, chatLog }
}

function combineChatLogs(next: TableChatEntry[], previous: TableChatEntry[]): TableChatEntry[] {
  const merged = [...previous, ...next]
    .reduce((acc: TableChatEntry[], entry) => {
      if (acc.some(item => item.id === entry.id)) {
        return acc
      }
      acc.push(entry)
      return acc
    }, [])

  merged.sort((a, b) => a.createdAt - b.createdAt)
  return merged.slice(-20)
}

function sanitizeSocialEntry(raw: unknown): PlayerSocialState | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<PlayerSocialState>
  const playerId = typeof candidate.playerId === 'string' ? candidate.playerId.trim() : ''
  if (!playerId) {
    return null
  }

  const entry: PlayerSocialState = { playerId }
  if (typeof candidate.message === 'string') {
    const message = sanitizeText(candidate.message, MAX_CHAT_LENGTH)
    if (message) {
      entry.message = message
    }
  }

  if (typeof candidate.emote === 'string') {
    const emote = sanitizeEmote(candidate.emote, 16)
    if (emote) {
      entry.emote = emote
    }
    entry.emoteExpiresAt = typeof candidate.emoteExpiresAt === 'number'
      ? candidate.emoteExpiresAt
      : undefined
  }

  if (typeof candidate.targetPlayerId === 'string') {
    const targetPlayerId = candidate.targetPlayerId.trim()
    if (targetPlayerId) {
      entry.targetPlayerId = targetPlayerId
    }
  }

  if (typeof candidate.messageTargetPlayerId === 'string') {
    const messageTargetPlayerId = candidate.messageTargetPlayerId.trim()
    if (messageTargetPlayerId) {
      entry.messageTargetPlayerId = messageTargetPlayerId
    }
  }

  const messageExpiresAt = typeof candidate.messageExpiresAt === 'number'
    ? candidate.messageExpiresAt
    : undefined
  const emoteExpiresAt = typeof candidate.emoteExpiresAt === 'number'
    ? candidate.emoteExpiresAt
    : undefined

  if (typeof messageExpiresAt === 'number' && messageExpiresAt > Date.now()) {
    entry.messageExpiresAt = messageExpiresAt
  }
  if (typeof emoteExpiresAt === 'number' && emoteExpiresAt > Date.now()) {
    entry.emoteExpiresAt = emoteExpiresAt
  }

  return entry.message || entry.emote ? entry : null
}

function sanitizeChatLog(raw: unknown): TableChatEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<TableChatEntry>
  const playerId = typeof candidate.playerId === 'string' ? candidate.playerId.trim() : ''
  const nickname = typeof candidate.nickname === 'string' ? candidate.nickname.trim() : 'Player'

  if (!playerId) {
    return null
  }

  const message = typeof candidate.message === 'string'
    ? sanitizeText(candidate.message, MAX_CHAT_LENGTH)
    : ''

  if (!message || nickname.toLowerCase() === 'system' || nickname.toLowerCase() === 'bot') {
    return null
  }

  const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : `chat_${Date.now()}`
  const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
    ? candidate.createdAt
    : Date.now()

  const targetPlayerId = typeof candidate.targetPlayerId === 'string'
    ? candidate.targetPlayerId.trim() || undefined
    : undefined

  return { id, playerId, nickname, message, createdAt, targetPlayerId }
}
