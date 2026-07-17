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
import type { CardRevealRequest, InternalGameState, InternalPlayer, LobbyPlayer, PlayerStats, SeatPlayer } from '../lib/poker/types'
import type { PlayerAvatarCustomization } from '../lib/profile'
import {
  createInitialGameState,
  processAction,
  resolveRunItTwiceDecision,
  runRabbitHunt,
  setPlayerLastAction,
  startHand,
  toTableState,
  voteRunItTwice,
} from '../lib/poker/engine'
import { withVisibleHandOdds } from '../lib/poker/odds'
import {
  getShowdownMinimumDurationMs,
  isTrueShowdown,
  RUN_IT_TWICE_PRESENTATION_DURATION_MS,
} from '../lib/poker/showdown'
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
  avatar?: PlayerAvatarCustomization
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
  cardRevealRequests: Record<string, CardRevealRequest>
  social: {
    activeByPlayer: Record<string, Omit<PlayerSocialState, 'playerId'>>
    chatLog: TableChatEntry[]
  }
  tableSettings: TableSettings
  pendingTableSettings: Partial<TableSettings> | null
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
  actionTimerDuration: 10000,
  autoStartDelay: 5000,
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
  private runItTwiceTimeout: ReturnType<typeof setTimeout> | null = null
  private runItTwiceDeadline: number | null = null

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
      cardRevealRequests: {},
      social: {
        activeByPlayer: {},
        chatLog: [],
      },
      tableSettings: { ...DEFAULT_SETTINGS },
      pendingTableSettings: null,
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
          this.handleJoinRoom(
            sender,
            msg.nickname,
            msg.email,
            msg.venmoUsername,
            msg.avatar,
            msg.reconnectToken
          )
          break
        case 'update_avatar':
          this.handleUpdateAvatar(sender, msg.avatar)
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
        case 'rabbit_hunt':
          this.handleRabbitHunt(sender)
          break
        case 'run_it_twice_vote':
          this.handleRunItTwiceVote(sender, msg.vote)
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
        case 'request_card_reveal':
          this.handleCardRevealRequest(sender, msg.targetId)
          break
        case 'respond_card_reveal':
          this.handleCardRevealResponse(sender, msg.requesterId, msg.allow)
          break
        case 'table_chat':
          this.handleTableChat(sender, msg.message, msg.targetId)
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
    const runItTwice = gameState.runItTwice
    if (runItTwice?.status === 'voting' && runItTwice.expiresAt) {
      const remainingMs = runItTwice.expiresAt - Date.now()
      if (remainingMs > 25) {
        void this.room.storage.setAlarm(runItTwice.expiresAt)
        return
      }

      this.expireRunItTwiceVote()
      return
    }

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
    avatar?: PlayerAvatarCustomization,
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
        this.data.playerProfiles[reconnectPlayerId] = { email, venmoUsername, avatar }
      } else if (avatar) {
        this.data.playerProfiles[reconnectPlayerId].avatar = avatar
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
    this.data.playerProfiles[playerId] = { email, venmoUsername, avatar }
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

    const wasSpectator = Boolean(this.data.spectatorIds[playerId])
    if (wasSpectator) {
      const spectatorStack = Math.max(0, Math.floor(this.data.spectatorStacks[playerId] ?? 0))
      if (spectatorStack <= 0) {
        this.sendActionFailed(conn, 'Add chips before taking a seat')
        return
      }
    }

    const seatIndex = this.findAvailableSeat(preferredSeat)

    if (seatIndex < 0) {
      this.data.spectatorIds[playerId] = true
      this.data.spectatorStacks[playerId] ??= this.data.tableSettings.startingStack
      delete this.data.pendingSpectators[playerId]
      this.sendActionResult(conn, 'Table is full. You are watching until a seat opens.')
      this.broadcastState()
      return
    }

    this.seatPlayerAt(playerId, seatIndex)

    this.sendActionResult(conn)
    this.broadcastState()
  }

  private handleUpdateAvatar(conn: Connection, avatar: PlayerAvatarCustomization) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before updating your avatar')
      return
    }

    const profile = this.data.playerProfiles[playerId]
    if (!profile) {
      this.sendActionFailed(conn, 'Player profile not found')
      return
    }

    profile.avatar = avatar
    this.sendActionResult(conn, 'Avatar updated')
    this.broadcastState()
  }

  private findAvailableSeat(preferredSeat?: number): number {
    const occupiedSeats = new Set(this.data.gameState.players.map(player => player.seatIndex))
    const maxPlayers = this.data.tableSettings.maxPlayers

    if (
      preferredSeat !== undefined &&
      Number.isInteger(preferredSeat) &&
      preferredSeat >= 0 &&
      preferredSeat < maxPlayers &&
      !occupiedSeats.has(preferredSeat)
    ) {
      return preferredSeat
    }

    for (let seatIndex = 0; seatIndex < maxPlayers; seatIndex += 1) {
      if (!occupiedSeats.has(seatIndex)) {
        return seatIndex
      }
    }

    return -1
  }

  private seatPlayerAt(playerId: string, seatIndex: number) {
    const nickname = this.data.playerNicknames[playerId] ?? 'Player'
    const stack = Math.max(
      0,
      Math.floor(this.data.spectatorStacks[playerId] ?? this.data.tableSettings.startingStack)
    )
    const isBot = playerId.startsWith('bot_')
    const newPlayer: InternalPlayer = {
      id: playerId,
      nickname,
      isBot,
      stack,
      bet: 0,
      totalInPot: 0,
      status: stack > 0 ? 'waiting' : 'sitting_out',
      isDealer: false,
      isSB: false,
      isBB: false,
      holeCards: [],
      showCards: 'none',
      isConnected: isBot || Boolean(this.data.playerToConnection[playerId]),
      seatIndex,
      hasActedThisRound: false,
    }

    this.data.gameState.players.push(newPlayer)
    this.data.gameState.players.sort((a, b) => a.seatIndex - b.seatIndex)
    delete this.data.spectatorIds[playerId]
    delete this.data.spectatorStacks[playerId]
    delete this.data.pendingSpectators[playerId]
  }

  private requireGameCreator(conn: Connection, action: string): string | null {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, `Join the room before you ${action}`)
      return null
    }

    if (this.data.hostId !== playerId) {
      this.sendActionFailed(conn, `Only the game creator can ${action}.`)
      return null
    }

    return playerId
  }

  private handleStartGame(conn: Connection) {
    if (!this.requireGameCreator(conn, 'start the game')) {
      return
    }

    this.finalizeState()

    if (this.data.gameState.phase === 'in_hand') {
      this.sendActionFailed(conn, 'Hand already in progress')
      return
    }

    const showdownHoldRemaining = this.getShowdownRemainingDurationMs()
    if (showdownHoldRemaining > 0) {
      const secondsRemaining = Math.max(1, Math.ceil(showdownHoldRemaining / 1000))
      this.sendActionFailed(
        conn,
        `Showdown in progress. Next hand is ready in ${secondsRemaining}s.`
      )
      return
    }

    this.flushPendingRemovals()
    this.flushPendingSpectators()
    this.moveZeroStackPlayersToSpectators()

    const seatedPlayers = this.data.gameState.players.filter(
      player => player.stack > 0 && player.status !== 'disconnected'
    )
    if (seatedPlayers.length < 2) {
      this.sendActionFailed(conn, 'Need at least 2 players with chips')
      this.broadcastState()
      return
    }

    try {
      this.clearAutoStart()
      this.data.cardRevealRequests = {}
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
    if (!this.requireGameCreator(conn, 'add bots')) {
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
    if (!this.requireGameCreator(conn, 'change auto-deal settings')) {
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
    if (!this.requireGameCreator(conn, 'change table settings')) {
      return
    }

    const settingsPatch: Partial<TableSettings> = {}
    if (msg.smallBlind !== undefined) settingsPatch.smallBlind = msg.smallBlind
    if (msg.bigBlind !== undefined) settingsPatch.bigBlind = msg.bigBlind
    if (msg.startingStack !== undefined) settingsPatch.startingStack = msg.startingStack
    if (msg.actionTimerDuration !== undefined) settingsPatch.actionTimerDuration = msg.actionTimerDuration
    if (msg.autoStartDelay !== undefined) settingsPatch.autoStartDelay = msg.autoStartDelay
    if (msg.rabbitHuntingEnabled !== undefined) settingsPatch.rabbitHuntingEnabled = msg.rabbitHuntingEnabled
    if (msg.sevenTwoRuleEnabled !== undefined) settingsPatch.sevenTwoRuleEnabled = msg.sevenTwoRuleEnabled
    if (msg.sevenTwoBountyPercent !== undefined) settingsPatch.sevenTwoBountyPercent = msg.sevenTwoBountyPercent

    const effectiveSettings = {
      ...this.data.tableSettings,
      ...this.data.pendingTableSettings,
      ...settingsPatch,
    }
    const nextSmallBlind = effectiveSettings.smallBlind
    const nextBigBlind = effectiveSettings.bigBlind
    const nextStartingStack = effectiveSettings.startingStack
    const nextActionTimerDuration = effectiveSettings.actionTimerDuration
    const nextAutoStartDelay = effectiveSettings.autoStartDelay
    const nextBountyPercent = effectiveSettings.sevenTwoBountyPercent
    const settingsAreValid = (
      Number.isSafeInteger(nextSmallBlind) && nextSmallBlind >= 1 && nextSmallBlind <= 1_000_000 &&
      Number.isSafeInteger(nextBigBlind) && nextBigBlind >= nextSmallBlind && nextBigBlind <= 1_000_000 &&
      Number.isSafeInteger(nextStartingStack) &&
      nextStartingStack >= nextBigBlind * 10 &&
      nextStartingStack <= 1_000_000_000 &&
      Number.isSafeInteger(nextActionTimerDuration) &&
      nextActionTimerDuration >= 5_000 &&
      nextActionTimerDuration <= 60_000 &&
      Number.isSafeInteger(nextAutoStartDelay) &&
      nextAutoStartDelay >= 1_000 &&
      nextAutoStartDelay <= 30_000 &&
      Number.isFinite(nextBountyPercent) &&
      nextBountyPercent >= 0 &&
      nextBountyPercent <= 100
    )
    if (!settingsAreValid) {
      this.sendActionFailed(
        conn,
        'Use valid blinds, a stack of at least 10 big blinds, timers within their displayed limits, and a bounty from 0 to 100%.'
      )
      return
    }

    if (this.data.gameState.phase === 'in_hand') {
      this.data.pendingTableSettings = {
        ...this.data.pendingTableSettings,
        ...settingsPatch,
      }
      this.sendActionResult(conn, 'Settings saved. Changes will apply automatically next hand.')
      this.broadcastState()
      return
    }

    this.applyTableSettings(settingsPatch)
    this.sendActionResult(conn, 'Updated table settings.')
    this.broadcastState()
  }

  private handleRunItTwiceVote(conn: Connection, vote: 'yes' | 'no') {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before voting')
      return
    }

    try {
      this.data.gameState = voteRunItTwice(this.data.gameState, playerId, vote)
      this.recordCompletedHandStats()
      this.finalizeState()
      this.syncActionTimer()

      const stillVoting = this.data.gameState.runItTwice?.status === 'voting'
      this.sendActionResult(
        conn,
        stillVoting
          ? 'Vote locked. Waiting for the other player.'
          : vote === 'yes'
            ? 'Both players agreed. Running it twice.'
            : 'Running the board once.'
      )
      this.broadcastState()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Run it twice vote failed'
      this.sendActionFailed(conn, message)
    }
  }

  private applyTableSettings(settings: Partial<TableSettings>) {
    if (settings.smallBlind !== undefined) this.data.tableSettings.smallBlind = settings.smallBlind
    if (settings.bigBlind !== undefined) this.data.tableSettings.bigBlind = settings.bigBlind
    if (settings.startingStack !== undefined) this.data.tableSettings.startingStack = settings.startingStack
    if (settings.actionTimerDuration !== undefined) {
      this.data.tableSettings.actionTimerDuration = Math.min(
        60000,
        Math.max(5000, Math.floor(settings.actionTimerDuration))
      )
    }
    if (settings.autoStartDelay !== undefined) {
      this.clearAutoStart()
      this.data.tableSettings.autoStartDelay = Math.min(
        30000,
        Math.max(1000, Math.floor(settings.autoStartDelay))
      )
    }
    if (settings.rabbitHuntingEnabled !== undefined) {
      this.data.tableSettings.rabbitHuntingEnabled = settings.rabbitHuntingEnabled
    }
    if (settings.sevenTwoRuleEnabled !== undefined) {
      this.data.tableSettings.sevenTwoRuleEnabled = settings.sevenTwoRuleEnabled
    }
    if (settings.sevenTwoBountyPercent !== undefined) {
      this.data.tableSettings.sevenTwoBountyPercent = Math.min(
        100,
        Math.max(0, settings.sevenTwoBountyPercent)
      )
    }

    this.data.gameState.smallBlind = this.data.tableSettings.smallBlind
    this.data.gameState.bigBlind = this.data.tableSettings.bigBlind
    this.data.gameState.startingStack = this.data.tableSettings.startingStack
    this.data.gameState.minRaise = this.data.tableSettings.bigBlind * 2
    this.data.gameState.actionTimerDuration = this.data.tableSettings.actionTimerDuration
    this.data.gameState.rabbitHuntingEnabled = this.data.tableSettings.rabbitHuntingEnabled
    this.data.gameState.sevenTwoRuleEnabled = this.data.tableSettings.sevenTwoRuleEnabled
    this.data.gameState.sevenTwoBountyPercent = this.data.tableSettings.sevenTwoBountyPercent
  }

  private applyPendingTableSettings() {
    if (!this.data.pendingTableSettings) {
      return
    }

    const pendingSettings = this.data.pendingTableSettings
    this.data.pendingTableSettings = null
    this.applyTableSettings(pendingSettings)
  }

  private handleRabbitHunt(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before rabbit hunting')
      return
    }

    try {
      const huntedState = runRabbitHunt(this.data.gameState)
      this.clearAutoStart()
      this.data.gameState = huntedState
      this.sendActionResult(conn, 'Rabbit hunt revealed the board.')
      this.broadcastState()
      this.syncAutoStart()
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Rabbit hunt is available after a folded hand before the river'
      this.sendActionFailed(conn, message)
    }
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
    const playerId = this.requireGameCreator(conn, 'change player chip counts')
    if (!playerId) {
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
    const playerId = this.requireGameCreator(conn, 'kick players')
    if (!playerId) {
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
    if (!this.requireGameCreator(conn, 'change player chip counts')) {
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
              setPlayerLastAction(this.data.gameState, player, 'Folded')
              this.recordFold(targetId)
            }

            const refreshedPlayer = this.getPlayer(targetId)
            if (
              refreshedPlayer &&
              refreshedPlayer.stack === 0 &&
              refreshedPlayer.status === 'active'
            ) {
              refreshedPlayer.status = 'all_in'
              setPlayerLastAction(this.data.gameState, refreshedPlayer, 'All-in')
              refreshedPlayer.hasActedThisRound = true
            }
          } else {
            player.status = 'all_in'
            setPlayerLastAction(this.data.gameState, player, 'All-in')
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
    if (!this.requireGameCreator(conn, 'seat or spectate players')) {
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
            setPlayerLastAction(this.data.gameState, seatedPlayer, 'Folded')
            this.recordFold(targetId)
          }
        } else if (seatedPlayer.status === 'active') {
          seatedPlayer.status = 'folded'
          setPlayerLastAction(this.data.gameState, seatedPlayer, 'Folded')
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
    const seatedPlayer = this.getPlayer(targetId)
    if (seatedPlayer) {
      delete this.data.pendingSpectators[targetId]
      delete this.data.spectatorIds[targetId]
      this.sendActionResult(conn, `${targetName} will remain seated for the next hand.`)
      this.broadcastState()
      return
    }

    const spectatorStack = Math.max(0, Math.floor(this.data.spectatorStacks[targetId] ?? 0))
    if (spectatorStack <= 0) {
      this.sendActionFailed(conn, 'Add chips before seating this player')
      return
    }

    const seatIndex = this.findAvailableSeat()
    if (seatIndex < 0) {
      this.sendActionFailed(conn, 'Table is full')
      return
    }

    this.seatPlayerAt(targetId, seatIndex)
    this.sendActionResult(conn, `Seated ${targetName}.`)
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

    if (this.data.gameState.phase !== 'between_hands' || !this.data.gameState.winners?.length) {
      this.sendActionFailed(conn, 'You can only show cards after the hand has a winner.')
      return
    }

    player.showCards = mode
    this.sendActionResult(conn)
    this.broadcastState()
  }

  private handleCardRevealRequest(conn: Connection, targetId: string) {
    const requesterId = this.data.connectionToPlayer[conn.id]
    if (!requesterId) {
      this.sendActionFailed(conn, 'Join the room before requesting cards')
      return
    }

    const state = this.data.gameState
    const requester = this.getPlayer(requesterId)
    const isCardRevealWindow = state.phase === 'in_hand' || (
      state.phase === 'between_hands' && Boolean(state.winners?.length)
    )
    if (!isCardRevealWindow || requester?.status !== 'folded') {
      this.sendActionFailed(conn, 'You can only request cards after folding in the current hand.')
      return
    }

    const target = this.getPlayer(targetId)
    if (
      !target ||
      target.id === requesterId ||
      target.holeCards.length !== 2 ||
      target.status === 'waiting' ||
      target.status === 'sitting_out' ||
      target.status === 'disconnected'
    ) {
      this.sendActionFailed(conn, 'That player cannot share cards right now.')
      return
    }

    const key = this.cardRevealRequestKey(state.handNumber, requesterId, targetId)
    const existing = this.data.cardRevealRequests[key]
    if (existing) {
      const message = existing.status === 'pending'
        ? `Waiting for ${target.nickname} to answer.`
        : existing.status === 'approved'
          ? `${target.nickname} already shared their cards for this hand.`
          : `${target.nickname} chose to keep their cards hidden this hand.`
      this.sendActionFailed(conn, message)
      return
    }

    const status = target.isBot ? 'approved' : 'pending'
    this.data.cardRevealRequests[key] = {
      requesterId,
      targetId,
      handNumber: state.handNumber,
      status,
    }
    this.sendActionResult(conn)
    this.broadcastState()
  }

  private handleCardRevealResponse(conn: Connection, requesterId: string, allow: boolean) {
    const targetId = this.data.connectionToPlayer[conn.id]
    if (!targetId) {
      this.sendActionFailed(conn, 'Join the room before answering card requests')
      return
    }

    const state = this.data.gameState
    const key = this.cardRevealRequestKey(state.handNumber, requesterId, targetId)
    const request = this.data.cardRevealRequests[key]
    const isCardRevealWindow = state.phase === 'in_hand' || (
      state.phase === 'between_hands' && Boolean(state.winners?.length)
    )
    if (!isCardRevealWindow || !request || request.status !== 'pending') {
      this.sendActionFailed(conn, 'That card request is no longer active.')
      return
    }

    request.status = allow ? 'approved' : 'denied'
    this.sendActionResult(conn)
    this.broadcastState()
  }

  private cardRevealRequestKey(handNumber: number, requesterId: string, targetId: string): string {
    return `${handNumber}:${requesterId}:${targetId}`
  }

  private handleTableChat(conn: Connection, message: string, targetId?: string) {
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
    const normalizedTargetId = typeof targetId === 'string' && targetId.trim().length > 0
      ? targetId.trim()
      : undefined

    if (normalizedTargetId && !this.isKnownPlayer(normalizedTargetId)) {
      this.sendActionFailed(conn, 'That player is not available to receive a message')
      return
    }

    const now = Date.now()
    this.data.social.activeByPlayer[playerId] = {
      ...this.data.social.activeByPlayer[playerId],
      message: trimmed,
      messageExpiresAt: now + CHAT_BUBBLE_DURATION,
      messageTargetPlayerId: normalizedTargetId,
    }

    this.appendChatEntry(playerId, nickname, trimmed, now, normalizedTargetId)

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

  private appendChatEntry(
    playerId: string,
    nickname: string,
    message: string,
    createdAt: number,
    targetPlayerId?: string
  ) {
    this.data.social.chatLog.unshift({
      id: generateId(12),
      playerId,
      nickname,
      message,
      createdAt,
      targetPlayerId,
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
      this.applyPendingTableSettings()
      this.clearAutoFold()
      this.data.gameState.actionTimerStart = null
      const isPostHandRevealWindow = (
        this.data.gameState.phase === 'between_hands' &&
        Boolean(this.data.gameState.winners?.length)
      )
      if (!isPostHandRevealWindow) {
        this.data.cardRevealRequests = {}
        this.flushPendingRemovals()
        this.flushPendingSpectators()
        this.moveZeroStackPlayersToSpectators()
      }

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

  private moveZeroStackPlayersToSpectators() {
    const bustedPlayers = this.data.gameState.players.filter(player => player.stack <= 0)
    if (bustedPlayers.length === 0) {
      return
    }

    const bustedIds = new Set(bustedPlayers.map(player => player.id))
    for (const player of bustedPlayers) {
      this.data.spectatorIds[player.id] = true
      this.data.spectatorStacks[player.id] = 0
      delete this.data.pendingSpectators[player.id]
      delete this.data.pendingRemovals[player.id]
    }

    this.data.gameState.players = this.data.gameState.players.filter(player => !bustedIds.has(player.id))
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
    const isCardRevealWindow = this.data.gameState.phase === 'in_hand' || (
      this.data.gameState.phase === 'between_hands' && Boolean(this.data.gameState.winners?.length)
    )
    const currentCardRevealRequests = isCardRevealWindow
      ? Object.values(this.data.cardRevealRequests).filter(request => (
          request.handNumber === this.data.gameState.handNumber &&
          (request.requesterId === playerId || request.targetId === playerId)
        ))
      : []
    const permittedHoleCardPlayerIds = spectatorCanSeeAllHands
      ? this.data.gameState.players.map(player => player.id)
      : currentCardRevealRequests
          .filter(request => request.requesterId === playerId && request.status === 'approved')
          .map(request => request.targetId)
    const publicState = withVisibleHandOdds(
      toTableState(this.data.gameState, playerId, { permittedHoleCardPlayerIds })
    )
    const winners = publicState.winners?.map(winner => ({
      ...winner,
      venmoUsername: this.data.playerProfiles[winner.playerId]?.venmoUsername,
    }))
    const pendingTableSettings = this.data.pendingTableSettings
      ? {
          smallBlind: this.data.pendingTableSettings.smallBlind ?? this.data.tableSettings.smallBlind,
          bigBlind: this.data.pendingTableSettings.bigBlind ?? this.data.tableSettings.bigBlind,
          startingStack: this.data.pendingTableSettings.startingStack ?? this.data.tableSettings.startingStack,
          actionTimerDuration: this.data.pendingTableSettings.actionTimerDuration ?? this.data.tableSettings.actionTimerDuration,
          autoStartDelay: this.data.pendingTableSettings.autoStartDelay ?? this.data.tableSettings.autoStartDelay,
          rabbitHuntingEnabled: this.data.pendingTableSettings.rabbitHuntingEnabled ?? this.data.tableSettings.rabbitHuntingEnabled,
          sevenTwoRuleEnabled: this.data.pendingTableSettings.sevenTwoRuleEnabled ?? this.data.tableSettings.sevenTwoRuleEnabled,
          sevenTwoBountyPercent: this.data.pendingTableSettings.sevenTwoBountyPercent ?? this.data.tableSettings.sevenTwoBountyPercent,
        }
      : undefined

    return {
      type: 'room_snapshot',
      state: {
        ...publicState,
        cardRevealRequests: currentCardRevealRequests,
        players: publicState.players.map(player => this.withPublicPlayerMetadata(player)),
        winners,
        autoStartEnabled: true,
        autoStartDelay: this.data.tableSettings.autoStartDelay,
        pendingTableSettings,
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
          avatar: this.data.playerProfiles[id]?.avatar,
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
      avatar: this.data.playerProfiles[player.id]?.avatar,
      venmoUsername: this.data.playerProfiles[player.id]?.venmoUsername,
      stats: this.getPublicStats(player.id),
    }
  }

  private ensureStats(statsKey: string): TrackedPlayerStats {
    this.data.statsByEmail[statsKey] ??= {
      handsPlayed: 0,
      folds: 0,
      wins: 0,
      totalWon: 0,
    }

    return this.data.statsByEmail[statsKey]!
  }

  private getPlayerStatsKey(playerId: string): string | undefined {
    if (this.isBotPlayer(playerId)) {
      return `bot:${playerId}`
    }

    return this.data.playerProfiles[playerId]?.email
  }

  private ensurePlayerStats(playerId: string): TrackedPlayerStats | undefined {
    const statsKey = this.getPlayerStatsKey(playerId)
    return statsKey ? this.ensureStats(statsKey) : undefined
  }

  private getPublicStats(playerId: string): PlayerStats | undefined {
    const stats = this.ensurePlayerStats(playerId)
    if (!stats) {
      return undefined
    }

    return {
      handsPlayed: stats.handsPlayed,
      folds: stats.folds,
      wins: stats.wins,
      totalWon: stats.totalWon,
      foldRate: stats.handsPlayed > 0 ? stats.folds / stats.handsPlayed : 0,
    }
  }

  private recordHandsPlayedForCurrentHand() {
    const handNumber = this.data.gameState.handNumber
    if (handNumber <= 0) {
      return
    }

    for (const player of this.data.gameState.players) {
      if (player.holeCards.length !== 2) {
        continue
      }

      const stats = this.ensurePlayerStats(player.id)
      if (!stats) {
        continue
      }

      const key = `${handNumber}:${player.id}`
      if (this.data.countedHandPlayers[key]) {
        continue
      }

      this.data.countedHandPlayers[key] = true
      stats.handsPlayed += 1
    }
  }

  private recordFold(playerId: string) {
    const handNumber = this.data.gameState.handNumber
    const stats = this.ensurePlayerStats(playerId)
    if (!stats || handNumber <= 0) {
      return
    }

    const key = `${handNumber}:${playerId}`
    if (this.data.countedFolds[key]) {
      return
    }

    this.data.countedFolds[key] = true
    stats.folds += 1
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
    const winnerAmounts = new Map<string, number>()
    for (const winner of this.data.gameState.winners) {
      winnerAmounts.set(winner.playerId, (winnerAmounts.get(winner.playerId) ?? 0) + winner.amount)
    }

    for (const player of this.data.gameState.players) {
      if (player.holeCards.length !== 2) {
        continue
      }

      const stats = this.ensurePlayerStats(player.id)
      if (!stats) {
        continue
      }

      const wonAmount = winnerAmounts.get(player.id) ?? 0
      if (wonAmount > 0) {
        stats.wins += 1
        stats.totalWon += wonAmount
      }
    }

    this.data.gameState.winners = this.data.gameState.winners.map(winner => {
      const profile = this.data.playerProfiles[winner.playerId]
      if (!profile) {
        return winner
      }

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
    this.syncRunItTwiceVote()
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

  private syncRunItTwiceVote() {
    const runItTwice = this.data.gameState.runItTwice
    if (
      runItTwice?.status !== 'voting' ||
      !runItTwice.expiresAt
    ) {
      this.clearRunItTwiceVoteTimeout()
      return
    }

    if (
      this.runItTwiceTimeout &&
      this.runItTwiceDeadline === runItTwice.expiresAt
    ) {
      return
    }

    this.clearRunItTwiceVoteTimeout()
    this.runItTwiceDeadline = runItTwice.expiresAt
    const remainingMs = Math.max(0, runItTwice.expiresAt - Date.now())
    void this.room.storage.setAlarm(runItTwice.expiresAt)
    this.runItTwiceTimeout = setTimeout(() => {
      this.runItTwiceTimeout = null
      this.runItTwiceDeadline = null
      this.expireRunItTwiceVote()
    }, remainingMs)
  }

  private expireRunItTwiceVote() {
    if (this.data.gameState.runItTwice?.status !== 'voting') {
      return
    }

    try {
      this.data.gameState = resolveRunItTwiceDecision(this.data.gameState, false)
      this.recordCompletedHandStats()
      this.finalizeState()
      this.syncActionTimer()
      this.broadcastState()
    } catch {
      this.finalizeState()
    }
  }

  private clearRunItTwiceVoteTimeout() {
    if (this.runItTwiceTimeout) {
      clearTimeout(this.runItTwiceTimeout)
    }

    this.runItTwiceTimeout = null
    this.runItTwiceDeadline = null
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
        this.flushPendingRemovals()
        this.flushPendingSpectators()
        this.moveZeroStackPlayersToSpectators()
        if (!this.shouldAutoStartNow()) {
          this.broadcastState()
          return
        }
        this.data.cardRevealRequests = {}
        this.data.gameState = startHand(this.data.gameState)
        this.recordHandsPlayedForCurrentHand()
        this.clearAutoFold()
        this.syncActionTimer(true)
        this.broadcastState()
      } catch {
        this.syncAutoStart()
      }
    }, this.getAutoStartDelayMs())
  }

  private getAutoStartDelayMs(): number {
    const configuredDelay = this.data.tableSettings.autoStartDelay
    const state = this.data.gameState

    if (!isTrueShowdown(state) || !state.showdownAt) {
      return configuredDelay
    }

    const presentationDuration = this.getShowdownPresentationDurationMs()
    const elapsed = Math.max(0, Date.now() - state.showdownAt)

    return Math.max(0, Math.max(configuredDelay, presentationDuration) - elapsed)
  }

  private getShowdownRemainingDurationMs(): number {
    const state = this.data.gameState
    if (!isTrueShowdown(state) || !state.showdownAt) {
      return 0
    }

    const presentationDuration = this.getShowdownPresentationDurationMs()
    const elapsed = Math.max(0, Date.now() - state.showdownAt)
    return Math.max(0, presentationDuration - elapsed)
  }

  private getShowdownParticipantCount(): number {
    const state = this.data.gameState
    const eligiblePlayerIds = new Set(state.pots.flatMap(pot => pot.eligiblePlayerIds))
    return state.players.filter(player => (
      player.holeCards.length === 2 &&
      (
        eligiblePlayerIds.has(player.id) ||
        player.status === 'active' ||
        player.status === 'all_in'
      )
    )).length
  }

  private getShowdownPresentationDurationMs(): number {
    const standardDuration = getShowdownMinimumDurationMs(
      this.getShowdownParticipantCount()
    )

    return this.data.gameState.runItTwice?.status === 'accepted'
      ? Math.max(standardDuration, RUN_IT_TWICE_PRESENTATION_DURATION_MS)
      : standardDuration
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
        nextState.messageTargetPlayerId = social.messageTargetPlayerId
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
