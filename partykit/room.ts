import type {
  Connection,
  Room,
  Server as PartyServer,
} from 'partykit/server'
import type {
  C2SMessage,
  PlayerSocialState,
  S2CMessage,
  SocialSnapshot,
  TableChatEntry,
} from '../shared/protocol'
import type { ShowCardsMode } from '../lib/poker/types'
import type { InternalGameState, InternalPlayer, LobbyPlayer, PlayerStats, SeatPlayer } from '../lib/poker/types'
import {
  createInitialGameState,
  processAction,
  startHand,
  toTableState,
} from '../lib/poker/engine'
import { withVisibleHandOdds } from '../lib/poker/odds'
import { MAX_CHAT_LENGTH, parseC2S } from '../shared/protocol'

interface TableSettings {
  smallBlind: number
  bigBlind: number
  startingStack: number
  maxPlayers: number
  actionTimerDuration: number
  autoStartDelay: number
  rabbitHuntingEnabled: boolean
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
}

interface PlayerProfileRecord {
  email: string
  venmoUsername: string
}

interface TrackedPlayerStats {
  handsPlayed: number
  folds: number
  wins: number
  totalWon: number
}

interface RoomData {
  gameState: InternalGameState
  hostId: string | null
  connectionToPlayer: Record<string, string>
  playerToConnection: Record<string, string>
  reconnectTokens: Record<string, string>
  playerNicknames: Record<string, string>
  playerProfiles: Record<string, PlayerProfileRecord>
  statsByEmail: Record<string, TrackedPlayerStats>
  countedHandPlayers: Record<string, true>
  countedFolds: Record<string, true>
  countedWinHands: Record<number, true>
  spectatorIds: Record<string, true>
  spectatorStacks: Record<string, number>
  pendingRemovals: Record<string, true>
  pendingSpectators: Record<string, true>
  social: {
    activeByPlayer: Record<string, Omit<PlayerSocialState, 'playerId'>>
    chatLog: TableChatEntry[]
  }
  tableSettings: TableSettings
  autoStartEnabled: boolean
}

function generateId(length = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function generateReconnectToken(): string {
  return generateId(32)
}

const DEFAULT_SETTINGS: TableSettings = {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  maxPlayers: 8,
  actionTimerDuration: 35000,
  autoStartDelay: 3000,
  rabbitHuntingEnabled: false,
  sevenTwoRuleEnabled: true,
  sevenTwoBountyPercent: 2,
}

export const AUTO_FOLD_DELAY = DEFAULT_SETTINGS.actionTimerDuration
export const BOT_ACTION_DELAY = 1200
const CHAT_BUBBLE_DURATION = 9000
const EMOTE_DURATION = 6000
const MAX_CHAT_HISTORY = 18
export const AUTO_START_DELAY = DEFAULT_SETTINGS.autoStartDelay
const BOT_NAMES = ['Maverick', 'River', 'Bluff', 'Ace', 'Nova', 'Dealer Dan', 'Pocket', 'Lucky', 'Tilt', 'Rook']

function formatCurrency(amount: number): string {
  return `$${Math.abs(Math.trunc(amount)).toLocaleString()}`
}

function describeChipAdjustment(playerName: string, delta: number): string {
  const amount = formatCurrency(delta)
  return delta > 0
    ? `Added ${amount} to ${playerName}.`
    : `Removed ${amount} from ${playerName}.`
}

export default class PokerRoom implements PartyServer {
  private data: RoomData
  private autoFoldTimeout: ReturnType<typeof setTimeout> | null = null
  private autoFoldPlayerId: string | null = null
  private autoFoldDeadline: number | null = null
  private autoStartTimeout: ReturnType<typeof setTimeout> | null = null
  private botActionTimeout: ReturnType<typeof setTimeout> | null = null
  private botActionPlayerId: string | null = null

  constructor(readonly room: Room) {
    const roomCode = room.id.toUpperCase()
    this.data = {
      gameState: createInitialGameState(
        roomCode,
        DEFAULT_SETTINGS.smallBlind,
        DEFAULT_SETTINGS.bigBlind,
        DEFAULT_SETTINGS.startingStack,
        DEFAULT_SETTINGS.actionTimerDuration
      ),
      hostId: null,
      connectionToPlayer: {},
      playerToConnection: {},
      reconnectTokens: {},
      playerNicknames: {},
      playerProfiles: {},
      statsByEmail: {},
      countedHandPlayers: {},
      countedFolds: {},
      countedWinHands: {},
      spectatorIds: {},
      spectatorStacks: {},
      pendingRemovals: {},
      pendingSpectators: {},
      social: {
        activeByPlayer: {},
        chatLog: [],
      },
      tableSettings: { ...DEFAULT_SETTINGS },
      autoStartEnabled: true,
    }
  }

  onConnect(conn: Connection) {
    this.sendMessage(conn, this.buildSnapshotFor(conn.id))
    this.sendMessage(conn, this.buildSocialSnapshotMessage())
  }

  onMessage(message: string, sender: Connection) {
    const msg = parseC2S(message)
    if (!msg) {
      this.sendError(sender, 'Invalid message format')
      return
    }

    try {
      switch (msg.type) {
        case 'join_room':
          this.handleJoinRoom(sender, msg.nickname, msg.email, msg.venmoUsername, msg.reconnectToken)
          break
        case 'seat_me':
          this.handleSeatMe(sender, msg.seatIndex)
          break
        case 'start_game':
          this.handleStartGame(sender)
          break
        case 'add_bots':
          this.handleAddBots(sender, msg.count)
          break
        case 'set_auto_start':
          this.handleSetAutoStart(sender, msg.enabled)
          break
        case 'player_action':
          this.handlePlayerAction(sender, msg.action, msg.amount)
          break
        case 'update_table_settings':
          this.handleUpdateSettings(sender, msg)
          break
        case 'leave_room':
          this.handleLeave(sender)
          break
        case 'rebuy':
          this.handleRebuy(sender, msg.amount)
          break
        case 'remove_player':
          this.handleRemovePlayer(sender, msg.targetId)
          break
        case 'adjust_player_stack':
          this.handleAdjustPlayerStack(sender, msg.targetId, msg.amount)
          break
        case 'set_player_spectator':
          this.handleSetPlayerSpectator(sender, msg.targetId, msg.spectator)
          break
        case 'set_show_cards':
          this.handleSetShowCards(sender, msg.mode)
          break
        case 'table_chat':
          this.handleTableChat(sender, msg.message)
          break
        case 'table_emote':
          this.handleTableEmote(sender, msg.emote, msg.targetId)
          break
        default:
          this.sendError(sender, 'Unknown message type')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      this.sendError(sender, errorMessage)
    }
  }

  onClose(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.playerToConnection[playerId] !== conn.id) {
      return
    }

    this.detachConnection(conn.id)

    const player = this.getPlayer(playerId)
    if (player) {
      player.isConnected = false
      this.clearPlayerSocialState(playerId)
      if (this.data.gameState.phase !== 'in_hand') {
        this.markPlayerDisconnected(player)
      }
    }

    this.finalizeState()
    this.syncActionTimer(this.data.gameState.actingPlayerId === playerId)
    this.broadcastState()
  }

  onAlarm() {
    const gameState = this.data.gameState
    const actingPlayerId = gameState.actingPlayerId
    if (
      gameState.phase !== 'in_hand' ||
      !actingPlayerId ||
      this.isBotPlayer(actingPlayerId)
    ) {
      return
    }

    const timerStart = gameState.actionTimerStart
    if (!timerStart) {
      return
    }

    const deadline = timerStart + gameState.actionTimerDuration
    const remainingMs = deadline - Date.now()
    if (remainingMs > 25) {
      void this.room.storage.setAlarm(deadline)
      return
    }

    this.runAutoFold(actingPlayerId)
  }

  private handleJoinRoom(
    conn: Connection,
    nickname: string,
    email: string,
    venmoUsername: string,
    reconnectToken?: string
  ) {
    const trimmed = nickname.trim().slice(0, 20)
    if (!trimmed) {
      this.sendActionFailed(conn, 'Nickname cannot be empty')
      return
    }

    const reconnectPlayerId = reconnectToken
      ? Object.entries(this.data.reconnectTokens).find(([, token]) => token === reconnectToken)?.[0]
      : undefined

    if (reconnectPlayerId) {
      this.bindConnection(conn, reconnectPlayerId)
      this.data.reconnectTokens[reconnectPlayerId] = generateReconnectToken()
      if (!this.data.playerProfiles[reconnectPlayerId]) {
        this.data.playerProfiles[reconnectPlayerId] = { email, venmoUsername }
      }
      this.ensureStats(email)

      const player = this.getPlayer(reconnectPlayerId)
      if (player) {
        player.isConnected = true
        if (player.status === 'disconnected') {
          player.status = player.stack > 0 ? 'waiting' : 'sitting_out'
        }
      }

      this.finalizeState()
      this.syncActionTimer(this.data.gameState.actingPlayerId === reconnectPlayerId)
      this.broadcastState()
      return
    }

    const playerId = generateId()
    this.bindConnection(conn, playerId)
    this.data.reconnectTokens[playerId] = generateReconnectToken()
    this.data.playerNicknames[playerId] = trimmed
    this.data.playerProfiles[playerId] = { email, venmoUsername }
    this.ensureStats(email)

    if (!this.data.hostId) {
      this.data.hostId = playerId
    }

    this.broadcastState()
  }

  private handleSeatMe(conn: Connection, preferredSeat?: number) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before taking a seat')
      return
    }

    if (this.data.gameState.players.some(player => player.id === playerId)) {
      this.sendActionFailed(conn, 'Already seated')
      return
    }

    if (this.data.spectatorIds[playerId]) {
      delete this.data.spectatorIds[playerId]
    }

    const occupiedSeats = new Set(this.data.gameState.players.map(player => player.seatIndex))
    const maxPlayers = this.data.tableSettings.maxPlayers

    let seatIndex = -1
    if (
      preferredSeat !== undefined &&
      Number.isInteger(preferredSeat) &&
      preferredSeat >= 0 &&
      preferredSeat < maxPlayers &&
      !occupiedSeats.has(preferredSeat)
    ) {
      seatIndex = preferredSeat
    } else {
      for (let i = 0; i < maxPlayers; i++) {
        if (!occupiedSeats.has(i)) {
          seatIndex = i
          break
        }
      }
    }

    if (seatIndex < 0) {
      this.sendActionFailed(conn, 'Table is full')
      return
    }

    const nickname = this.data.playerNicknames[playerId] ?? 'Player'
    const stack = Math.max(
      0,
      Math.floor(this.data.spectatorStacks[playerId] ?? this.data.tableSettings.startingStack)
    )
    const newPlayer: InternalPlayer = {
      id: playerId,
      nickname,
      stack,
      bet: 0,
      totalInPot: 0,
      status: stack > 0 ? 'waiting' : 'sitting_out',
      isDealer: false,
      isSB: false,
      isBB: false,
      holeCards: [],
      showCards: 'none',
      isConnected: true,
      seatIndex,
      hasActedThisRound: false,
    }

    this.data.gameState.players.push(newPlayer)
    this.data.gameState.players.sort((a, b) => a.seatIndex - b.seatIndex)
    delete this.data.spectatorStacks[playerId]
    delete this.data.pendingSpectators[playerId]

    this.sendActionResult(conn)
    this.broadcastState()
  }

  private handleStartGame(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can start the game')
      return
    }

    this.finalizeState()

    const seatedPlayers = this.data.gameState.players.filter(
      player => player.stack > 0 && player.status !== 'disconnected'
    )
    if (seatedPlayers.length < 2) {
      this.sendActionFailed(conn, 'Need at least 2 players with chips')
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.sendActionFailed(conn, 'Hand already in progress')
      return
    }

    try {
      this.clearAutoStart()
      this.data.gameState = startHand(this.data.gameState)
      this.recordHandsPlayedForCurrentHand()
      this.syncActionTimer(true)
      this.sendActionResult(conn, this.data.gameState.handNumber > 1 ? 'Dealing next hand.' : 'Dealing the first hand.')
      this.broadcastState()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start hand'
      this.sendActionFailed(conn, message)
    }
  }

  private handleAddBots(conn: Connection, count: number) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can add bots')
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.sendActionFailed(conn, 'Cannot add bots during a hand')
      return
    }

    const occupiedSeats = new Set(this.data.gameState.players.map(player => player.seatIndex))
    const openSeats = Array.from({ length: this.data.tableSettings.maxPlayers }, (_, index) => index)
      .filter(index => !occupiedSeats.has(index))

    const toAdd = Math.max(0, Math.min(Math.floor(count), openSeats.length))
    if (toAdd <= 0) {
      this.sendActionFailed(conn, 'No open seats available for bots')
      return
    }

    for (let i = 0; i < toAdd; i += 1) {
      const botId = `bot_${generateId(6)}`
      const seatIndex = openSeats[i]!
      const nickname = this.generateBotNickname()
      this.data.playerNicknames[botId] = nickname

      const botPlayer: InternalPlayer = {
        id: botId,
        nickname,
        isBot: true,
        stack: this.data.tableSettings.startingStack,
        bet: 0,
        totalInPot: 0,
        status: 'waiting',
        isDealer: false,
        isSB: false,
        isBB: false,
        holeCards: [],
        showCards: 'none',
        isConnected: true,
        seatIndex,
        hasActedThisRound: false,
      }

      this.data.gameState.players.push(botPlayer)
    }

    this.data.gameState.players.sort((a, b) => a.seatIndex - b.seatIndex)
    this.sendActionResult(conn, `Added ${toAdd} bot${toAdd === 1 ? '' : 's'}`)
    this.broadcastState()
  }

  private handleSetAutoStart(conn: Connection, enabled: boolean) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can change auto-start settings')
      return
    }

    if (!enabled) {
      this.sendActionFailed(conn, 'Auto-deal stays on. Use the delay setting instead.')
      return
    }

    this.data.autoStartEnabled = true
    this.finalizeState()
    this.sendActionResult(conn)
  }

  private handlePlayerAction(
    conn: Connection,
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
    amount?: number
  ) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before acting')
      return
    }

    try {
      this.clearAutoFold()
      this.data.gameState = processAction(this.data.gameState, playerId, action, amount)
      if (action === 'fold') {
        this.recordFold(playerId)
      }
      this.recordCompletedHandStats()
      this.finalizeState()
      this.syncActionTimer()
      this.sendActionResult(conn)
      this.broadcastState()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed'
      this.sendActionFailed(conn, message)
    }
  }

  private handleUpdateSettings(
    conn: Connection,
    msg: Extract<C2SMessage, { type: 'update_table_settings' }>
  ) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can change settings')
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.sendActionFailed(conn, 'Cannot change settings during a hand')
      return
    }

    if (msg.smallBlind !== undefined) this.data.tableSettings.smallBlind = msg.smallBlind
    if (msg.bigBlind !== undefined) this.data.tableSettings.bigBlind = msg.bigBlind
    if (msg.startingStack !== undefined) this.data.tableSettings.startingStack = msg.startingStack
    if (msg.actionTimerDuration !== undefined) {
      this.data.tableSettings.actionTimerDuration = Math.min(
        60000,
        Math.max(5000, Math.floor(msg.actionTimerDuration))
      )
    }
    if (msg.autoStartDelay !== undefined) {
      this.clearAutoStart()
      this.data.tableSettings.autoStartDelay = Math.min(
        30000,
        Math.max(1000, Math.floor(msg.autoStartDelay))
      )
    }
    if (msg.rabbitHuntingEnabled !== undefined) {
      this.data.tableSettings.rabbitHuntingEnabled = msg.rabbitHuntingEnabled
    }
    if (msg.sevenTwoRuleEnabled !== undefined) {
      this.data.tableSettings.sevenTwoRuleEnabled = msg.sevenTwoRuleEnabled
    }
    if (msg.sevenTwoBountyPercent !== undefined) {
      this.data.tableSettings.sevenTwoBountyPercent = Math.min(
        100,
        Math.max(0, msg.sevenTwoBountyPercent)
      )
    }

    this.data.gameState.smallBlind = this.data.tableSettings.smallBlind
    this.data.gameState.bigBlind = this.data.tableSettings.bigBlind
    this.data.gameState.startingStack = this.data.tableSettings.startingStack
    this.data.gameState.actionTimerDuration = this.data.tableSettings.actionTimerDuration
    this.data.gameState.rabbitHuntingEnabled = this.data.tableSettings.rabbitHuntingEnabled
    this.data.gameState.sevenTwoRuleEnabled = this.data.tableSettings.sevenTwoRuleEnabled
    this.data.gameState.sevenTwoBountyPercent = this.data.tableSettings.sevenTwoBountyPercent

    this.sendActionResult(conn, 'Updated table settings.')
    this.broadcastState()
  }

  private handleLeave(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      return
    }

    this.sendActionResult(conn)
    this.evictPlayer(playerId)
    this.broadcastState()
  }

  private handleRebuy(conn: Connection, amount: number) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before rebuying')
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.sendActionFailed(conn, 'Cannot rebuy during a hand')
      return
    }

    const player = this.getPlayer(playerId)
    if (!player) {
      this.sendActionFailed(conn, 'Take a seat before rebuying')
      return
    }

    player.stack += Math.max(0, amount)
    if (player.stack > 0 && player.status !== 'disconnected') {
      player.status = 'waiting'
    }

    this.sendActionResult(conn, `Rebuy added ${formatCurrency(amount)} to your stack.`)
    this.broadcastState()
  }

  private handleRemovePlayer(conn: Connection, targetId: string) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can remove players')
      return
    }

    if (targetId === playerId) {
      this.sendActionFailed(conn, 'Use leave room to remove yourself')
      return
    }

    if (!this.isKnownPlayer(targetId)) {
      this.sendActionFailed(conn, 'Player not found')
      return
    }

    const targetName =
      this.getPlayer(targetId)?.nickname ??
      this.data.playerNicknames[targetId] ??
      'That player'
    const seatedPlayer = this.getPlayer(targetId)
    const removedMidHand = this.data.gameState.phase === 'in_hand' && Boolean(seatedPlayer)

    if (this.data.gameState.phase === 'in_hand' && !seatedPlayer) {
      this.removeSessionMetadata(targetId)
      delete this.data.pendingRemovals[targetId]
      this.sendActionResult(conn, `Kicked ${targetName} from the table.`)
      this.finalizeState()
      this.broadcastState()
      return
    }

    this.evictPlayer(targetId)
    this.sendActionResult(
      conn,
      removedMidHand
        ? `Kicked ${targetName}. They fold now and leave the table after this hand.`
        : `Kicked ${targetName} from the table.`
    )
    this.broadcastState()
  }

  private handleAdjustPlayerStack(conn: Connection, targetId: string, amount: number) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can change player chips')
      return
    }

    const delta = Math.trunc(amount)
    if (!Number.isFinite(delta) || delta === 0) {
      this.sendActionFailed(conn, 'Enter a chip amount to add or remove')
      return
    }

    const player = this.getPlayer(targetId)
    if (player) {
      const message = describeChipAdjustment(player.nickname, delta)
      const wasActingPlayer = this.data.gameState.actingPlayerId === targetId
      player.stack = Math.max(0, player.stack + delta)
      if (this.data.gameState.phase === 'in_hand') {
        if (player.status === 'disconnected') {
          player.status = player.stack > 0 ? 'disconnected' : 'sitting_out'
        } else if (player.status === 'waiting' || player.status === 'sitting_out') {
          player.status = player.stack > 0 ? 'waiting' : 'sitting_out'
        } else if (player.stack === 0 && player.status === 'active') {
          if (player.id === this.data.gameState.actingPlayerId) {
            try {
              this.clearAutoFold()
              const forcedAction = player.bet >= this.data.gameState.currentBet ? 'check' : 'fold'
              this.data.gameState = processAction(this.data.gameState, targetId, forcedAction)
              if (forcedAction === 'fold') {
                this.recordFold(targetId)
              }
              this.recordCompletedHandStats()
            } catch {
              player.status = 'folded'
              player.lastAction = 'Folded'
              this.recordFold(targetId)
            }

            const refreshedPlayer = this.getPlayer(targetId)
            if (
              refreshedPlayer &&
              refreshedPlayer.stack === 0 &&
              refreshedPlayer.status === 'active'
            ) {
              refreshedPlayer.status = 'all_in'
              refreshedPlayer.lastAction = 'All-in'
              refreshedPlayer.hasActedThisRound = true
            }
          } else {
            player.status = 'all_in'
            player.lastAction = 'All-in'
            player.hasActedThisRound = true
          }
        }
      } else {
        player.status = player.stack > 0
          ? (player.isConnected ? 'waiting' : 'disconnected')
          : 'sitting_out'
      }

      this.finalizeState()
      this.syncActionTimer(wasActingPlayer)
      this.sendActionResult(conn, message)
      this.broadcastState()
      return
    }

    if (this.data.spectatorIds[targetId] || this.data.playerNicknames[targetId]) {
      const playerName = this.data.playerNicknames[targetId] ?? 'That player'
      const nextStack = Math.max(0, Math.floor((this.data.spectatorStacks[targetId] ?? 0) + delta))
      this.data.spectatorStacks[targetId] = nextStack
      this.sendActionResult(conn, describeChipAdjustment(playerName, delta))
      this.broadcastState()
      return
    }

    this.sendActionFailed(conn, 'Player not found')
  }

  private handleSetPlayerSpectator(conn: Connection, targetId: string, spectator: boolean) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.data.hostId !== playerId) {
      this.sendActionFailed(conn, 'Only the host can change spectator mode')
      return
    }

    if (!this.isKnownPlayer(targetId)) {
      this.sendActionFailed(conn, 'Player not found')
      return
    }

    if (spectator) {
      const seatedPlayer = this.getPlayer(targetId)
      const targetName = seatedPlayer?.nickname ?? this.data.playerNicknames[targetId] ?? 'That player'
      if (seatedPlayer && this.data.gameState.phase === 'in_hand') {
        const wasActingPlayer = this.data.gameState.actingPlayerId === targetId
        this.data.pendingSpectators[targetId] = true
        this.data.spectatorIds[targetId] = true
        if (seatedPlayer.status === 'active' && this.data.gameState.actingPlayerId === targetId) {
          try {
            this.clearAutoFold()
            this.data.gameState = processAction(this.data.gameState, targetId, 'fold')
            this.recordFold(targetId)
            this.recordCompletedHandStats()
          } catch {
            seatedPlayer.status = 'folded'
            this.recordFold(targetId)
          }
        } else if (seatedPlayer.status === 'active') {
          seatedPlayer.status = 'folded'
          seatedPlayer.lastAction = 'Folded'
          this.recordFold(targetId)
        }
        this.finalizeState()
        this.syncActionTimer(wasActingPlayer)
        this.sendActionResult(conn, `Moved ${targetName} to spectator mode. They fold now and watch the rest of this hand.`)
        this.broadcastState()
        return
      }

      if (seatedPlayer) {
        this.data.spectatorStacks[targetId] = seatedPlayer.stack
        this.removePlayerFromTable(targetId)
      }
      this.data.spectatorIds[targetId] = true
      this.sendActionResult(conn, `Moved ${targetName} to spectator mode.`)
      this.broadcastState()
      return
    }

    const targetName = this.data.playerNicknames[targetId] ?? this.getPlayer(targetId)?.nickname ?? 'That player'
    delete this.data.pendingSpectators[targetId]
    delete this.data.spectatorIds[targetId]
    this.sendActionResult(conn, `${targetName} can rejoin the table.`)
    this.broadcastState()
  }

  private handleSetShowCards(conn: Connection, mode: ShowCardsMode) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before changing card visibility')
      return
    }

    const player = this.getPlayer(playerId)
    if (!player) {
      this.sendActionFailed(conn, 'Take a seat before showing cards')
      return
    }

    if (this.data.gameState.phase === 'in_hand' && player.status !== 'folded') {
      this.sendActionFailed(conn, 'You can only show cards after folding or after the hand.')
      return
    }

    player.showCards = mode
    this.sendActionResult(conn)
    this.broadcastState()
  }

  private handleTableChat(conn: Connection, message: string) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before chatting')
      return
    }

    const trimmed = message.trim().slice(0, MAX_CHAT_LENGTH)
    if (!trimmed) {
      this.sendActionFailed(conn, 'Message cannot be empty')
      return
    }

    const nickname = this.data.playerNicknames[playerId] ?? this.getPlayer(playerId)?.nickname ?? 'Player'

    const now = Date.now()
    this.data.social.activeByPlayer[playerId] = {
      ...this.data.social.activeByPlayer[playerId],
      message: trimmed,
      messageExpiresAt: now + CHAT_BUBBLE_DURATION,
    }

    this.appendChatEntry(playerId, nickname, trimmed, now)

    this.broadcastState()
  }

  private handleTableEmote(conn: Connection, emote: string, targetId?: string) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before emoting')
      return
    }

    const player = this.getPlayer(playerId)
    if (!player) {
      this.sendActionFailed(conn, 'Take a seat before emoting')
      return
    }

    const normalizedTargetId = typeof targetId === 'string' && targetId.trim().length > 0
      ? targetId.trim()
      : player.id

    if (normalizedTargetId !== player.id && !this.isKnownPlayer(normalizedTargetId)) {
      this.sendActionFailed(conn, 'That player is not available to receive a targeted emote')
      return
    }

    const nickname = this.data.playerNicknames[playerId] ?? player.nickname ?? 'Player'
    const targetNickname =
      normalizedTargetId === player.id
        ? ''
        : this.getPlayer(normalizedTargetId)?.nickname ??
          this.data.playerNicknames[normalizedTargetId] ??
          'Player'
    const message = normalizedTargetId === player.id
      ? emote
      : `to ${targetNickname}: ${emote}`
    const now = Date.now()

    this.data.social.activeByPlayer[playerId] = {
      ...this.data.social.activeByPlayer[playerId],
      emote,
      emoteExpiresAt: now + EMOTE_DURATION,
      targetPlayerId: normalizedTargetId !== player.id ? normalizedTargetId : undefined,
    }

    this.appendChatEntry(playerId, nickname, message, now)

    this.broadcastState()
  }

  private appendChatEntry(playerId: string, nickname: string, message: string, createdAt: number) {
    this.data.social.chatLog.unshift({
      id: generateId(12),
      playerId,
      nickname,
      message,
      createdAt,
    })
    this.data.social.chatLog = this.data.social.chatLog.slice(0, MAX_CHAT_HISTORY)
  }

  private evictPlayer(playerId: string) {
    const wasActingPlayer = this.data.gameState.actingPlayerId === playerId
    const player = this.getPlayer(playerId)

    this.removeSessionMetadata(playerId)

    if (!player) {
      this.finalizeState()
      this.syncActionTimer(false)
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.data.pendingRemovals[playerId] = true

      if (wasActingPlayer && player.status === 'active') {
        try {
          this.clearAutoFold()
          this.data.gameState = processAction(this.data.gameState, playerId, 'fold')
          this.recordFold(playerId)
          this.recordCompletedHandStats()
        } catch {
          // Ignore impossible forced-fold transitions.
        }
      }

      const remainingPlayer = this.getPlayer(playerId)
      if (remainingPlayer) {
        remainingPlayer.isConnected = false
      }
    } else {
      this.removePlayerFromTable(playerId)
    }

    this.finalizeState()
    this.syncActionTimer(wasActingPlayer)
  }

  private isBotPlayer(playerId: string): boolean {
    return playerId.startsWith('bot_') || Boolean(this.getPlayer(playerId)?.isBot)
  }

  private generateBotNickname(): string {
    const used = new Set(this.data.gameState.players.map(player => player.nickname))
    for (const baseName of BOT_NAMES) {
      const candidate = `Bot ${baseName}`
      if (!used.has(candidate)) {
        return candidate
      }
    }

    let index = 1
    while (used.has(`Bot ${index}`)) {
      index += 1
    }
    return `Bot ${index}`
  }

  private getPlayer(playerId: string): InternalPlayer | undefined {
    return this.data.gameState.players.find(player => player.id === playerId)
  }

  private isKnownPlayer(playerId: string): boolean {
    return Boolean(
      this.data.playerNicknames[playerId] ||
      this.getPlayer(playerId) ||
      this.data.pendingRemovals[playerId] ||
      this.data.pendingSpectators[playerId] ||
      this.data.spectatorIds[playerId]
    )
  }

  private bindConnection(conn: Connection, playerId: string) {
    const existingConnId = this.data.playerToConnection[playerId]
    if (existingConnId && existingConnId !== conn.id) {
      delete this.data.connectionToPlayer[existingConnId]
    }

    const existingPlayerId = this.data.connectionToPlayer[conn.id]
    if (existingPlayerId && existingPlayerId !== playerId) {
      delete this.data.playerToConnection[existingPlayerId]
    }

    this.data.connectionToPlayer[conn.id] = playerId
    this.data.playerToConnection[playerId] = conn.id
  }

  private detachConnection(connId: string) {
    const playerId = this.data.connectionToPlayer[connId]
    if (!playerId) {
      return
    }

    delete this.data.connectionToPlayer[connId]
    if (this.data.playerToConnection[playerId] === connId) {
      delete this.data.playerToConnection[playerId]
    }
  }

  private removeSessionMetadata(playerId: string) {
    const connId = this.data.playerToConnection[playerId]
    if (connId) {
      delete this.data.connectionToPlayer[connId]
    }

    delete this.data.playerToConnection[playerId]
    delete this.data.reconnectTokens[playerId]
    delete this.data.playerNicknames[playerId]
    delete this.data.spectatorIds[playerId]
    delete this.data.spectatorStacks[playerId]
    delete this.data.pendingSpectators[playerId]
    this.clearPlayerSocialState(playerId)

    if (this.data.hostId === playerId) {
      this.data.hostId = this.selectNextHost()
    }
  }

  private removePlayerFromTable(playerId: string) {
    this.data.gameState.players = this.data.gameState.players.filter(player => player.id !== playerId)
    delete this.data.pendingRemovals[playerId]
  }

  private markPlayerDisconnected(player: InternalPlayer) {
    if (player.stack > 0) {
      player.status = 'disconnected'
    } else {
      player.status = 'sitting_out'
    }
  }

  private finalizeState() {
    if (this.data.gameState.phase !== 'in_hand') {
      this.clearAutoFold()
      this.data.gameState.actionTimerStart = null
      this.flushPendingRemovals()
      this.flushPendingSpectators()

      for (const player of this.data.gameState.players) {
        if (!player.isConnected) {
          this.markPlayerDisconnected(player)
        } else if (player.status === 'disconnected') {
          player.status = player.stack > 0 ? 'waiting' : 'sitting_out'
        }
      }
    }

    if (this.data.hostId && !this.data.playerNicknames[this.data.hostId]) {
      this.data.hostId = this.selectNextHost()
    }

    this.syncAutoStart()
  }

  private flushPendingRemovals() {
    const pendingIds = Object.keys(this.data.pendingRemovals)
    if (pendingIds.length === 0) {
      return
    }

    const pendingSet = new Set(pendingIds)
    this.data.gameState.players = this.data.gameState.players.filter(player => !pendingSet.has(player.id))
    for (const playerId of pendingIds) {
      delete this.data.pendingRemovals[playerId]
    }
  }

  private flushPendingSpectators() {
    const pendingIds = Object.keys(this.data.pendingSpectators)
    if (pendingIds.length === 0) {
      return
    }

    for (const playerId of pendingIds) {
      const seatedPlayer = this.getPlayer(playerId)
      if (seatedPlayer) {
        this.data.spectatorStacks[playerId] = seatedPlayer.stack
      }
      this.removePlayerFromTable(playerId)
      this.data.spectatorIds[playerId] = true
      delete this.data.pendingSpectators[playerId]
    }
  }

  private selectNextHost(): string | null {
    const joinedIds = new Set(Object.keys(this.data.playerNicknames))
    const seatedIds = this.data.gameState.players.map(player => player.id)
    const connectedIds = Object.keys(this.data.playerToConnection).filter(
      playerId => joinedIds.has(playerId) && !this.isBotPlayer(playerId)
    )

    const preferredOrder = [
      ...seatedIds.filter(playerId => connectedIds.includes(playerId)),
      ...connectedIds.filter(playerId => !seatedIds.includes(playerId)),
      ...seatedIds.filter(playerId => joinedIds.has(playerId)),
      ...Object.keys(this.data.playerNicknames).filter(playerId => !seatedIds.includes(playerId)),
    ]

    return preferredOrder[0] ?? null
  }

  private buildSnapshotFor(connId: string): Extract<S2CMessage, { type: 'room_snapshot' }> {
    const playerId = this.data.connectionToPlayer[connId] ?? ''
    const spectatorCanSeeAllHands = Boolean(
      playerId && (this.data.spectatorIds[playerId] || this.data.pendingSpectators[playerId])
    )

    const publicState = withVisibleHandOdds(
      toTableState(this.data.gameState, playerId, {
        revealAllHoleCards: spectatorCanSeeAllHands,
      })
    )
    const winners = publicState.winners?.map(winner => ({
      ...winner,
      venmoUsername: this.data.playerProfiles[winner.playerId]?.venmoUsername,
    }))

    return {
      type: 'room_snapshot',
      state: {
        ...publicState,
        players: publicState.players.map(player => this.withPublicPlayerMetadata(player)),
        winners,
        autoStartEnabled: true,
        autoStartDelay: this.data.tableSettings.autoStartDelay,
        lobbyPlayers: this.buildLobbyPlayers(),
      },
    }
  }

  private buildLobbyPlayers(): LobbyPlayer[] {
    const knownIds = new Set<string>([
      ...Object.keys(this.data.playerNicknames),
      ...this.data.gameState.players.map(player => player.id),
      ...Object.keys(this.data.spectatorIds),
      ...Object.keys(this.data.pendingRemovals),
      ...Object.keys(this.data.pendingSpectators),
    ])

    return Array.from(knownIds)
      .map(id => {
        const seatedPlayer = this.getPlayer(id)
        const isSpectator = Boolean(
          this.data.spectatorIds[id]
          || this.data.pendingSpectators[id]
          || this.data.pendingRemovals[id]
        )
        const isSeated = Boolean(seatedPlayer)
        const isConnected = Boolean(
          seatedPlayer?.isConnected ?? this.data.playerToConnection[id]
        )

        return {
          id,
          nickname: seatedPlayer?.nickname ?? this.data.playerNicknames[id] ?? 'Player',
          venmoUsername: this.data.playerProfiles[id]?.venmoUsername,
          stats: this.getPublicStats(id),
          stack: seatedPlayer?.stack ?? this.data.spectatorStacks[id] ?? 0,
          status: isSpectator ? 'spectating' : seatedPlayer?.status ?? 'waiting',
          isConnected,
          isBot: seatedPlayer?.isBot ?? id.startsWith('bot_'),
          isSeated,
          isSpectator,
        } satisfies LobbyPlayer
      })
      .sort((a, b) => {
        if (a.isSeated !== b.isSeated) {
          return a.isSeated ? -1 : 1
        }
        if (a.isSpectator !== b.isSpectator) {
          return a.isSpectator ? 1 : -1
        }
        return a.nickname.localeCompare(b.nickname)
      })
  }

  private buildPrivateSession(playerId: string): Extract<S2CMessage, { type: 'private_session' }> | null {
    const reconnectToken = this.data.reconnectTokens[playerId]
    if (!reconnectToken) {
      return null
    }

    return {
      type: 'private_session',
      yourId: playerId,
      reconnectToken,
      isHost: this.data.hostId === playerId,
    }
  }

  private withPublicPlayerMetadata(player: SeatPlayer): SeatPlayer {
    return {
      ...player,
      venmoUsername: this.data.playerProfiles[player.id]?.venmoUsername,
      stats: this.getPublicStats(player.id),
    }
  }

  private ensureStats(email: string): TrackedPlayerStats {
    this.data.statsByEmail[email] ??= {
      handsPlayed: 0,
      folds: 0,
      wins: 0,
      totalWon: 0,
    }

    return this.data.statsByEmail[email]!
  }

  private getPublicStats(playerId: string): PlayerStats | undefined {
    const profile = this.data.playerProfiles[playerId]
    if (!profile) {
      return undefined
    }

    const stats = this.ensureStats(profile.email)
    return {
      ...stats,
      foldRate: stats.handsPlayed > 0 ? stats.folds / stats.handsPlayed : 0,
    }
  }

  private recordHandsPlayedForCurrentHand() {
    const handNumber = this.data.gameState.handNumber
    if (handNumber <= 0) {
      return
    }

    for (const player of this.data.gameState.players) {
      if (this.isBotPlayer(player.id) || player.holeCards.length !== 2) {
        continue
      }

      const profile = this.data.playerProfiles[player.id]
      if (!profile) {
        continue
      }

      const key = `${handNumber}:${player.id}`
      if (this.data.countedHandPlayers[key]) {
        continue
      }

      this.data.countedHandPlayers[key] = true
      this.ensureStats(profile.email).handsPlayed += 1
    }
  }

  private recordFold(playerId: string) {
    if (this.isBotPlayer(playerId)) {
      return
    }

    const profile = this.data.playerProfiles[playerId]
    const handNumber = this.data.gameState.handNumber
    if (!profile || handNumber <= 0) {
      return
    }

    const key = `${handNumber}:${playerId}`
    if (this.data.countedFolds[key]) {
      return
    }

    this.data.countedFolds[key] = true
    this.ensureStats(profile.email).folds += 1
  }

  private recordCompletedHandStats() {
    const handNumber = this.data.gameState.handNumber
    if (
      handNumber <= 0 ||
      this.data.gameState.phase !== 'between_hands' ||
      !this.data.gameState.winners?.length ||
      this.data.countedWinHands[handNumber]
    ) {
      return
    }

    this.data.countedWinHands[handNumber] = true
    this.data.gameState.winners = this.data.gameState.winners.map(winner => {
      const profile = this.data.playerProfiles[winner.playerId]
      if (!profile) {
        return winner
      }

      const stats = this.ensureStats(profile.email)
      stats.wins += 1
      stats.totalWon += winner.amount

      return {
        ...winner,
        venmoUsername: profile.venmoUsername,
      }
    })
  }

  private buildSocialSnapshot(): SocialSnapshot {
    this.cleanupSocialState()

    return {
      active: Object.entries(this.data.social.activeByPlayer).map(([playerId, social]) => ({
        playerId,
        ...social,
      })),
      chatLog: this.data.social.chatLog,
    }
  }

  private buildSocialSnapshotMessage(): Extract<S2CMessage, { type: 'social_snapshot' }> {
    return {
      type: 'social_snapshot',
      social: this.buildSocialSnapshot(),
    }
  }

  private broadcastState() {
    this.finalizeState()
    const socialSnapshot = this.buildSocialSnapshotMessage()

    for (const conn of Array.from(this.room.getConnections())) {
      this.sendMessage(conn, this.buildSnapshotFor(conn.id))
      this.sendMessage(conn, socialSnapshot)

      const playerId = this.data.connectionToPlayer[conn.id]
      if (!playerId) {
        continue
      }

      const session = this.buildPrivateSession(playerId)
      if (session) {
        this.sendMessage(conn, session)
      }
    }
  }

  private syncActionTimer(resetCurrentTimer = false) {
    const actingPlayerId = this.data.gameState.actingPlayerId
    if (this.data.gameState.phase !== 'in_hand' || !actingPlayerId) {
      this.clearAutoFold()
      this.clearBotAction()
      this.data.gameState.actionTimerStart = null
      return
    }

    if (this.isBotPlayer(actingPlayerId)) {
      this.clearAutoFold()
      this.scheduleBotAction(actingPlayerId)
      return
    }

    if (
      !resetCurrentTimer &&
      this.autoFoldPlayerId === actingPlayerId &&
      this.autoFoldDeadline &&
      this.autoFoldDeadline > Date.now()
    ) {
      void this.room.storage.setAlarm(this.autoFoldDeadline)
      return
    }

    this.scheduleAutoFold(actingPlayerId)
  }

  private scheduleAutoFold(playerId: string) {
    this.clearBotAction()
    this.clearAutoFold(false)
    this.autoFoldPlayerId = playerId
    this.data.gameState.actionTimerStart = Date.now()
    this.autoFoldDeadline = this.data.gameState.actionTimerStart + this.data.gameState.actionTimerDuration
    void this.room.storage.setAlarm(this.autoFoldDeadline)

    this.autoFoldTimeout = setTimeout(() => {
      this.runAutoFold(playerId)
    }, this.data.gameState.actionTimerDuration)
  }

  private runAutoFold(playerId: string) {
    this.clearAutoFold()

    const gameState = this.data.gameState
    if (gameState.phase !== 'in_hand' || gameState.actingPlayerId !== playerId) {
      return
    }

    try {
      const actingPlayer = this.getPlayer(playerId)
      const shouldCheck = actingPlayer ? actingPlayer.bet >= gameState.currentBet : false
      const action = shouldCheck ? 'check' : 'fold'
      this.data.gameState = processAction(gameState, playerId, action)
      if (action === 'fold') {
        this.recordFold(playerId)
      }
      this.recordCompletedHandStats()
      this.finalizeState()
      this.syncActionTimer()
      this.broadcastState()
    } catch {
      this.finalizeState()
    }
  }

  private clearAutoFold(clearAlarm = true) {
    if (this.autoFoldTimeout) {
      clearTimeout(this.autoFoldTimeout)
    }

    this.autoFoldTimeout = null
    this.autoFoldPlayerId = null
    this.autoFoldDeadline = null
    if (clearAlarm) {
      void this.room.storage.deleteAlarm()
    }
  }

  private scheduleBotAction(playerId: string) {
    if (this.botActionTimeout && this.botActionPlayerId === playerId) {
      return
    }

    this.clearBotAction()
    this.botActionPlayerId = playerId
    this.data.gameState.actionTimerStart = Date.now()

    this.botActionTimeout = setTimeout(() => {
      this.botActionTimeout = null
      this.botActionPlayerId = null

      if (this.data.gameState.phase !== 'in_hand' || this.data.gameState.actingPlayerId !== playerId) {
        return
      }

      try {
        const botAction = this.chooseBotAction(playerId)
        this.data.gameState = processAction(
          this.data.gameState,
          playerId,
          botAction.action,
          botAction.amount
        )
        if (botAction.action === 'fold') {
          this.recordFold(playerId)
        }
        this.recordCompletedHandStats()
        this.finalizeState()
        this.syncActionTimer()
        this.broadcastState()
      } catch {
        try {
          this.data.gameState = processAction(this.data.gameState, playerId, 'fold')
          this.recordFold(playerId)
          this.recordCompletedHandStats()
          this.finalizeState()
          this.syncActionTimer()
          this.broadcastState()
        } catch {
          this.finalizeState()
        }
      }
    }, BOT_ACTION_DELAY)
  }

  private clearBotAction() {
    if (this.botActionTimeout) {
      clearTimeout(this.botActionTimeout)
    }

    this.botActionTimeout = null
    this.botActionPlayerId = null
  }

  private chooseBotAction(playerId: string): {
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in'
    amount?: number
  } {
    const player = this.getPlayer(playerId)
    if (!player) {
      return { action: 'fold' }
    }

    const toCall = Math.max(0, this.data.gameState.currentBet - player.bet)
    const maxTotalBet = player.stack + player.bet

    if (toCall === 0) {
      if (player.stack > this.data.gameState.bigBlind * 2 && Math.random() < 0.22) {
        const raiseTo = Math.min(
          maxTotalBet,
          Math.max(this.data.gameState.minRaise, this.data.gameState.currentBet + this.data.gameState.bigBlind)
        )
        if (raiseTo > this.data.gameState.currentBet) {
          return { action: 'raise', amount: raiseTo }
        }
      }
      return { action: 'check' }
    }

    if (toCall >= player.stack) {
      return player.stack <= this.data.gameState.bigBlind * 3
        ? { action: 'all_in' }
        : { action: 'fold' }
    }

    const pressureThreshold = Math.max(this.data.gameState.bigBlind * 2, Math.floor(player.stack * 0.18))
    if (toCall <= pressureThreshold) {
      if (player.stack > toCall + this.data.gameState.bigBlind * 2 && Math.random() < 0.14) {
        const raiseTo = Math.min(
          maxTotalBet,
          Math.max(this.data.gameState.minRaise, this.data.gameState.currentBet + this.data.gameState.bigBlind)
        )
        if (raiseTo > this.data.gameState.currentBet) {
          return { action: 'raise', amount: raiseTo }
        }
      }
      return { action: 'call' }
    }

    if (toCall <= this.data.gameState.bigBlind * 4 && Math.random() < 0.35) {
      return { action: 'call' }
    }

    return { action: 'fold' }
  }

  private syncAutoStart() {
    if (this.shouldAutoStartNow()) {
      this.scheduleAutoStart()
      return
    }

    this.clearAutoStart()
  }

  private shouldAutoStartNow(): boolean {
    if (!this.data.autoStartEnabled) {
      return false
    }

    if (this.data.gameState.phase === 'in_hand') {
      return false
    }

    if (!this.data.hostId) {
      return false
    }

    if (!this.data.playerToConnection[this.data.hostId]) {
      return false
    }

    const readyPlayers = this.data.gameState.players.filter(
      player => player.stack > 0 && player.status !== 'disconnected' && player.status !== 'sitting_out'
    )

    return readyPlayers.length >= 2
  }

  private scheduleAutoStart() {
    if (this.autoStartTimeout) {
      return
    }

    this.autoStartTimeout = setTimeout(() => {
      this.autoStartTimeout = null

      if (!this.shouldAutoStartNow()) {
        return
      }

      try {
        this.data.gameState = startHand(this.data.gameState)
        this.recordHandsPlayedForCurrentHand()
        this.clearAutoFold()
        this.syncActionTimer(true)
        this.broadcastState()
      } catch {
        this.syncAutoStart()
      }
    }, this.data.tableSettings.autoStartDelay)
  }

  private clearAutoStart() {
    if (this.autoStartTimeout) {
      clearTimeout(this.autoStartTimeout)
    }

    this.autoStartTimeout = null
  }

  private cleanupSocialState() {
    const now = Date.now()

    for (const [playerId, social] of Object.entries(this.data.social.activeByPlayer)) {
      const nextState: Omit<PlayerSocialState, 'playerId'> = {}

      if (social.message && social.messageExpiresAt && social.messageExpiresAt > now) {
        nextState.message = social.message
        nextState.messageExpiresAt = social.messageExpiresAt
      }

      if (social.emote && social.emoteExpiresAt && social.emoteExpiresAt > now) {
        nextState.emote = social.emote
        nextState.emoteExpiresAt = social.emoteExpiresAt
        nextState.targetPlayerId = social.targetPlayerId
      }

      if (nextState.message || nextState.emote) {
        this.data.social.activeByPlayer[playerId] = nextState
      } else {
        delete this.data.social.activeByPlayer[playerId]
      }
    }
  }

  private clearPlayerSocialState(playerId: string) {
    delete this.data.social.activeByPlayer[playerId]
  }

  private sendActionResult(conn: Connection, message?: string) {
    this.sendMessage(conn, { type: 'action_result', success: true, message })
  }

  private sendActionFailed(conn: Connection, message: string) {
    this.sendMessage(conn, { type: 'action_failed', message })
  }

  private sendError(conn: Connection, message: string) {
    this.sendMessage(conn, { type: 'error', message })
  }

  private sendMessage(conn: Connection, message: S2CMessage) {
    conn.send(JSON.stringify(message))
  }
}
