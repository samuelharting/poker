'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TableState } from '@/lib/poker/types'
import {
  MAX_CHAT_LENGTH,
  parseS2C,
  sanitizeEmote,
  sanitizeText,
  type C2SMessage,
  type PlayerSocialState,
  type SocialSnapshot,
  type S2CMessage,
  type TableChatEntry,
} from '@/shared/protocol'

// In production, set NEXT_PUBLIC_PARTYKIT_HOST to your deployed PartyKit domain.
// Local dev defaults to localhost:1999 so `npm run dev` continues working.
const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999'
const PARTY_NAME = process.env.NEXT_PUBLIC_PARTY_NAME ?? 'main'
const LOCAL_PARTYKIT_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/i

function buildConnectionIssue(): string {
  if (LOCAL_PARTYKIT_HOST_PATTERN.test(PARTYKIT_HOST)) {
    return `Can't reach the local table server at ${PARTYKIT_HOST}. Start \`npm run dev\` or \`npm run dev:party\`, then retry.`
  }

  return `Can't reach the live table server at ${PARTYKIT_HOST}. Check that the PartyKit host is running and reachable, then retry.`
}

type SystemTone = 'info' | 'success' | 'error'

interface UseRoomOptions {
  onSystemMessage?: (message: string, tone: SystemTone) => void
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
  sendMessage: (msg: C2SMessage) => void
}

export function useRoom(
  roomCode: string,
  nickname: string,
  options: UseRoomOptions = {}
): RoomState {
  const socketRef = useRef<RoomSocket | null>(null)
  const reconnectTokenRef = useRef<string | null>(null)
  const hasSeated = useRef(false)
  const hasEverConnectedRef = useRef(false)
  const connectionIssueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerIdsRef = useRef<Set<string>>(new Set())
  const [tableState, setTableState] = useState<TableState | null>(null)
  const [socialState, setSocialState] = useState<SocialSnapshot>({ active: [], chatLog: [] })
  const [yourId, setYourId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null)
  const { onSystemMessage } = options

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

  useEffect(() => {
    if (!roomCode || !nickname) {
      return
    }

    hasSeated.current = false
    hasEverConnectedRef.current = false
    setTableState(null)
    setSocialState({ active: [], chatLog: [] })
    setYourId('')
    setIsHost(false)
    setIsConnected(false)
    setConnectionIssue(null)

    if (connectionIssueTimerRef.current) {
      clearTimeout(connectionIssueTimerRef.current)
      connectionIssueTimerRef.current = null
    }

    const tokenStorageKey = `poker_reconnect_${roomCode}`
    reconnectTokenRef.current = sessionStorage.getItem(tokenStorageKey)
    let active = true

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
        }) as unknown as RoomSocket

        socketRef.current = socket
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
          const joinMsg: C2SMessage = {
            type: 'join_room',
            nickname,
            reconnectToken: reconnectTokenRef.current ?? undefined,
          }
          socket.send(JSON.stringify(joinMsg))
        })

        socket.addEventListener('message', event => {
          const payload = event as MessageEvent
          const msg = parseS2C(payload.data as string)
          if (!msg) {
            onSystemMessage?.('Invalid server payload. Refreshing table state...', 'error')
            return
          }

          switch (msg.type) {
            case 'room_snapshot': {
              setTableState(msg.state)
              playerIdsRef.current = new Set(
                (msg.state.lobbyPlayers?.length
                  ? msg.state.lobbyPlayers.map(player => player.id)
                  : msg.state.players.map(player => player.id))
              )
              break
            }

            case 'social_snapshot': {
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
              setYourId(msg.yourId)
              setIsHost(msg.isHost)
              reconnectTokenRef.current = msg.reconnectToken
              sessionStorage.setItem(tokenStorageKey, msg.reconnectToken)
              break
            }

            case 'action_result': {
              if (msg.message) {
                onSystemMessage?.(msg.message, 'success')
              }
              break
            }

            case 'action_failed':
              onSystemMessage?.(msg.message, 'error')
              break

            case 'error':
              onSystemMessage?.(msg.message, 'error')
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
          onSystemMessage?.('Unable to load the live table connection.', 'error')
        }
      }
    })()

    return () => {
      active = false
      if (connectionIssueTimerRef.current) {
        clearTimeout(connectionIssueTimerRef.current)
        connectionIssueTimerRef.current = null
      }
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [nickname, onSystemMessage, roomCode])

  useEffect(() => {
    if (!yourId || !tableState || !isConnected) {
      return
    }

    const lobbySelf = tableState.lobbyPlayers?.find(player => player.id === yourId)
    if (lobbySelf?.isSpectator) {
      hasSeated.current = false
      return
    }

    if (tableState.players.some(player => player.id === yourId)) {
      hasSeated.current = true
      return
    }

    if (hasSeated.current) {
      return
    }

    hasSeated.current = true
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
    sendMessage,
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

  return { id, playerId, nickname, message, createdAt }
}
