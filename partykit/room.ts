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
import type { CardRevealRequest, HandHistoryEntry, InternalGameState, InternalPlayer, LobbyPlayer, PlayerStats, SeatPlayer } from '../lib/poker/types'
import { buildHandHistoryEntry, upsertHandHistory } from '../lib/poker/handHistory'
import { normalizePlayerUsername, type PlayerAvatarCustomization } from '../lib/profile'
import {
  advanceAllInRunout,
  createInitialGameState,
  foldLeavingPlayer,
  isBettingClosed,
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
} from '../lib/poker/showdown'
import {
  advanceLadyLuckForNewHand,
  applyLadyLuckHandOutcome,
  createLadyLuckTracker,
  getVisibleLadyLuck,
  muteLadyLuck,
  type LadyLuckTracker,
} from '../lib/poker/ladyLuck'
import {
  applyHandCompleted as applyDrinkHandCompleted,
  applyQueuedWaters,
  applyQueuedWater,
  WATER_LANDS_MS,
  chooseBotDrink,
  computeSoberTax,
  BUZZ,
  createDrinkLedgerEntry,
  createSeatedDrinkLedgerEntry,
  discardQueuedWater,
  endHangoverIfOver,
  deliverShot,
  getShotBlockReason,
  getShotHandsRemaining,
  isLiveInHand,
  recordShotBought,
  forceBeers,
  pourFreeWater,
  pourHouseShot,
  orderDrink,
  BLACKOUT_MS,
  PASS_OUT_LEVEL,
  CHASER_WINDOW_MS,
  WAKE_UP_LEVEL,
  WATER_KICK_IN_MS,
  toPublicDrinkState,
  wakeIfRested,
  type DrinkEvent,
  type DrinkEventKind,
  type DrinkKind,
  type DrinkLedgerEntry,
} from '../lib/drinks'
import {
  clearMushrooms,
  createMushroomTable,
  drinkSpikedWater,
  endTripIfOver,
  expireStaleMushroom,
  getPrivateMushroomState,
  getPublicTrip,
  getSpikeBlockReason,
  maybeSpawnMushroom,
  armAutoSpike,
  getDueAutoSpike,
  giveMushroom,
  MUSHROOM_AUTO_SPIKE_MS,
  MUSHROOM_BOT_SPIKE_MAX_MS,
  MUSHROOM_BOT_SPIKE_MIN_MS,
  refreshSuggestedVictim,
  removeMushroomPlayer,
  spikeWater,
  startTripIfReady,
  type MushroomEvent,
  type MushroomTable,
} from '../lib/mushroom'
import { CHIP_FLICK_COOLDOWN_MS, HOUSE_ID, type PrankEvent, type PrankKind } from '../lib/pranks'
import { computeHouseRules, WATERFALL_EVERY_HANDS } from '../lib/houseRules'
import {
  DEFAULT_LEDGER_SETTINGS,
  MAX_CHIP_VALUE,
  MAX_REBUYS_LIMIT,
  MIN_CHIP_VALUE,
  buildLedgerPayments,
  createLedger,
  describeRebuyBlock,
  ensureAccount,
  getRebuyBlockReason,
  recordBuyIn,
  recordHostAdjustment,
  recordRebuy,
  totalBoughtIn,
  type LedgerAccount,
  type LedgerData,
  type LedgerRow,
  type LedgerSettings,
  type LedgerSnapshot,
} from '../lib/poker/ledger'
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
  /** Drinks and Lady Luck. Optional so rooms saved before it existed default to on. */
  funModeEnabled?: boolean
  /** Self-serve rebuys (default on), cap per player (0 = unlimited) and $ per chip. */
  allowRebuys?: boolean
  maxRebuys?: number
  chipValue?: number
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
  statsByUsername: Record<string, TrackedPlayerStats>
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
  ladyLuck: LadyLuckTracker
  handHistory: HandHistoryEntry[]
  membership: MembershipData
  /** Buy-ins, rebuys and host adjustments per player identity (see lib/poker/ledger). */
  ledger: LedgerData
}

/**
 * Seat bookkeeping that survives people coming and going: who joined when
 * (host succession), chips carried out by departed players (so leaving and
 * rejoining never mints a fresh stack), and the away / sitting-out tracker.
 */
interface MembershipData {
  joinedAt: Record<string, number>
  /** Stack a departed human walked away with, keyed by normalized nickname. */
  departedStacks: Record<string, number>
  /** Humans sitting out until they tap "I'm back". */
  awayIds: Record<string, true>
  /** Consecutive hands missed (timed out or disconnected at the deal). */
  missedHands: Record<string, number>
  /** Players dealt into the current / most recent hand. */
  dealtIn: string[]
  timedOutThisHand: Record<string, true>
  actedThisHand: Record<string, true>
  /** Hand number the missed-hand check last ran for. */
  countedForHand?: number
  /** Nicknames the host kicked: if they come back they start on the rail, not in a seat. */
  kickedNames: Record<string, true>
}

export const MISSED_HANDS_BEFORE_SIT_OUT = 2

function createMembershipData(): MembershipData {
  return {
    joinedAt: {},
    departedStacks: {},
    awayIds: {},
    missedHands: {},
    dealtIn: [],
    timedOutThisHand: {},
    actedThisHand: {},
    kickedNames: {},
  }
}

/** True when this socket came in through a local dev server (never a deployed PartyKit host). */
function isLocalDevConnection(conn: Connection): boolean {
  try {
    const hostname = new URL(conn.uri).hostname.replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')
  } catch {
    return false
  }
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
  funModeEnabled: true,
}

export const AUTO_FOLD_DELAY = DEFAULT_SETTINGS.actionTimerDuration
export const BOT_ACTION_DELAY = 1200
/** A peek the client never lowers (tab closed mid-hold) is dropped after this. */
export const PEEK_MAX_DURATION_MS = 12_000
const PEEK_RATE_WINDOW_MS = 2_000
const PEEK_RATE_MAX_CHANGES = 8
const CHAT_BUBBLE_DURATION = 9000
const EMOTE_DURATION = 6000
/** A pot this many big blinds or bigger counts as "big" for a bot's victory shot. */
const BOT_SHOT_BIG_POT_BLINDS = 15
const BOT_SHOT_CHANCE = 0.5
const BOT_SHOT_DELAY_MS = 2_200

interface QueuedShot {
  id: string
  fromId: string
  fromNickname: string
  targetId: string
}
const MAX_CHAT_HISTORY = 18
export const AUTO_START_DELAY = DEFAULT_SETTINGS.autoStartDelay
export const HOST_DISCONNECT_GRACE_MS = 20_000
const BOT_NAMES = ['Maverick', 'River', 'Bluff', 'Ace', 'Nova', 'Dealer Dan', 'Pocket', 'Lucky', 'Tilt', 'Rook']

function formatCurrency(amount: number): string {
  return `$${Math.abs(Math.trunc(amount)).toLocaleString()}`
}

function mergeShownHands(
  previous: HandHistoryEntry['shown'],
  next: HandHistoryEntry['shown']
): HandHistoryEntry['shown'] {
  const merged = new Map(previous.map(hand => [hand.playerId, hand]))
  for (const hand of next) {
    const known = merged.get(hand.playerId)
    if (!known || hand.cards.length >= known.cards.length) {
      merged.set(hand.playerId, hand)
    }
  }
  return [...merged.values()]
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
  private allInRunoutTimeout: ReturnType<typeof setTimeout> | null = null
  private allInRunoutDeadline: number | null = null
  /**
   * Deal all-in runouts street by street (TV style) so everyone watches the
   * odds move. Tests that want the old instant runout can switch it off.
   */
  allInRunoutPacing = true
  private hostTransferTimeout: ReturnType<typeof setTimeout> | null = null
  private revealSettleTimeout: ReturnType<typeof setTimeout> | null = null
  private disconnectedHostId: string | null = null
  /** Drink state lives beside, not inside, the game engine. */
  private drinkLedger: Record<string, DrinkLedgerEntry> = {}
  private drinkWaterTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private drinkWearOffHand = 0
  private botDrinkTimers = new Set<ReturnType<typeof setTimeout>>()
  /** Injectable so tests can make bot drinking deterministic. */
  botDrinkRandom: () => number = Math.random
  /** Random thirst (BUZZ.autoBeerChance every BUZZ.autoBeerEveryMs); injectable for tests. */
  autoBeerRandom: () => number = Math.random
  private autoBeerTimer: ReturnType<typeof setInterval> | null = null
  /** Last chip flick per sender (cosmetic prank rate limit). */
  private lastChipFlickAt = new Map<string, number>()
  /** Bought shots waiting for their target to be out of the hand, oldest first. */
  private shotQueue: QueuedShot[] = []
  /** Shot took them to the edge mid-hand: blackout waits until they fold or the hand ends. */
  private pendingBlackouts = new Set<string>()
  /** House rules across hands: dealt-in folds in a row, and hands into the current orbit. */
  private foldStreaks = new Map<string, number>()
  private orbitHands = 0
  /** Clients that reported drink controls (desktop 3D). Unknown = false. */
  private drinkCapableByPlayer = new Map<string, boolean>()
  /** Stack (plus blinds posted) of every dealt-in player when the hand started. */
  private handStartStacks = new Map<string, number>()
  private botShotTimers = new Set<ReturnType<typeof setTimeout>>()
  /** Injectable so tests can make bots buying shots deterministic. */
  botShotRandom: () => number = Math.random
  /** Wake-up checks for blacked-out drinkers (min and max blackout length). */
  private blackoutTimers = new Map<string, ReturnType<typeof setTimeout>[]>()
  /** The one mushroom at the table (see lib/mushroom.ts). */
  private mushrooms: MushroomTable
  /** `${playerId}:${waterId}` of the spiked glass, so its kick-in starts a trip instead. */
  private spikedWaterKeys = new Set<string>()
  private tripTimer: ReturnType<typeof setTimeout> | null = null
  private botSpikeTimer: ReturnType<typeof setTimeout> | null = null
  /** Injectable so tests can make mushroom spawns and bot spiking deterministic. */
  mushroomRandom: () => number = Math.random
  /** Who is privately looking at their hole cards, keyed to the hand they peeked in. */
  private peekingByPlayer = new Map<string, { handNumber: number; timer: ReturnType<typeof setTimeout> }>()
  private peekRateByPlayer = new Map<string, number[]>()
  private botPeekTimers = new Set<ReturnType<typeof setTimeout>>()
  /** Injectable so tests can make bot peeking deterministic. */
  botPeekRandom: () => number = Math.random

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
      statsByUsername: {},
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
      ladyLuck: createLadyLuckTracker(),
      handHistory: [],
      membership: createMembershipData(),
      ledger: createLedger(),
    }
    this.mushrooms = createMushroomTable(this.mushroomRandom)
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
          this.handleRebuy(sender)
          break
        case 'settle_up':
          this.handleSettleUp(sender)
          break
        case 'set_venmo':
          this.handleSetVenmo(sender, msg.venmoUsername)
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
        case 'order_drink':
          this.handleOrderDrink(sender, msg.kind)
          break
        case 'buy_shot':
          this.handleBuyShot(sender, msg.targetId)
          break
        case 'flick_chip':
          this.handleFlickChip(sender, msg.targetId)
          break
        case 'set_drink_capable':
          this.handleSetDrinkCapable(sender, msg.capable)
          break
        case 'spike_water':
          this.handleSpikeWater(sender, msg.targetId)
          break
        case 'dev_fun':
          this.handleDevFun(sender, msg.action, msg.targetId)
          break
        case 'companion_mute':
          this.handleCompanionMute(sender)
          break
        case 'set_sitting_out':
          this.handleSetSittingOut(sender, msg.sittingOut)
          break
        case 'peek_cards':
          this.handlePeekCards(sender, msg.peeking)
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

    if (this.data.hostId === playerId) {
      this.scheduleDisconnectedHostTransfer(playerId)
    }

    const player = this.getPlayer(playerId)
    if (player) {
      player.isConnected = false
      this.clearPlayerSocialState(playerId)
      if (this.data.gameState.phase !== 'in_hand') {
        this.markPlayerDisconnected(player)
      }
    }

    this.finalizeState()
    // Keep the acting player's original deadline: dropping the socket must not
    // buy a fresh clock.
    this.syncActionTimer()
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

    if (gameState.phase === 'in_hand' && gameState.allInRunout) {
      const remainingMs = gameState.allInRunout.nextStreetAt - Date.now()
      if (remainingMs > 25) {
        void this.room.storage.setAlarm(gameState.allInRunout.nextStreetAt)
        return
      }

      this.dealNextAllInStreet()
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
    email = '',
    venmoUsername = '',
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
      this.resumePlayer(conn, reconnectPlayerId, email, venmoUsername, avatar)
      return
    }

    // Without a token the nickname is the identity at a friends' table: the
    // same name coming back reclaims its seat, chips and stats.
    const namedPlayerId = this.findHumanByNickname(trimmed)
    if (namedPlayerId) {
      if (this.isPlayerLive(namedPlayerId)) {
        this.sendSessionEnded(
          conn,
          'name_taken',
          `${this.data.playerNicknames[namedPlayerId] ?? trimmed} is already playing at this table. ` +
          'Close it on your other device, or join with a different nickname.'
        )
        return
      }
      this.resumePlayer(conn, namedPlayerId, email, venmoUsername, avatar)
      return
    }

    // Left (or was removed) mid-hand and came straight back: the seat is
    // still finishing the hand, so take it back instead of minting a new one.
    const leavingSeat = this.data.gameState.players.find(player => (
      this.data.pendingRemovals[player.id] &&
      !player.isBot &&
      !this.data.playerNicknames[player.id] &&
      normalizePlayerUsername(player.nickname) === normalizePlayerUsername(trimmed)
    ))
    if (leavingSeat) {
      delete this.data.pendingRemovals[leavingSeat.id]
      const kickedKey = normalizePlayerUsername(leavingSeat.nickname)
      if (this.data.membership.kickedNames[kickedKey]) {
        // Kicked, then straight back: watch from the rail once this hand ends.
        delete this.data.membership.kickedNames[kickedKey]
        this.data.pendingSpectators[leavingSeat.id] = true
        this.data.spectatorIds[leavingSeat.id] = true
      }
      this.data.playerNicknames[leavingSeat.id] = leavingSeat.nickname
      this.data.reconnectTokens[leavingSeat.id] = generateReconnectToken()
      this.resumePlayer(conn, leavingSeat.id, email, venmoUsername, avatar)
      return
    }

    const playerId = generateId()
    this.bindConnection(conn, playerId)
    this.data.reconnectTokens[playerId] = generateReconnectToken()
    this.data.playerNicknames[playerId] = trimmed
    this.data.playerProfiles[playerId] = { email, venmoUsername, avatar }
    this.data.membership.joinedAt[playerId] = Date.now()
    this.ensureStats(trimmed)

    // Chips walk out with a player and walk back in with them.
    const carriedKey = normalizePlayerUsername(trimmed)
    const carriedStack = this.data.membership.departedStacks[carriedKey]
    if (carriedStack !== undefined) {
      delete this.data.membership.departedStacks[carriedKey]
      this.data.spectatorStacks[playerId] = carriedStack
      if (carriedStack <= 0) {
        this.data.spectatorIds[playerId] = true
      }
    }
    if (this.data.membership.kickedNames[carriedKey]) {
      // A kicked player may come back, but only to the rail: the host (or
      // they, deliberately) can seat them again.
      delete this.data.membership.kickedNames[carriedKey]
      this.data.spectatorIds[playerId] = true
      this.data.spectatorStacks[playerId] ??= this.issueBuyIn(playerId)
    }

    if (!this.data.hostId) {
      this.data.hostId = playerId
    }

    this.broadcastState()
  }

  /** Re-attach a known player (token or nickname) to a fresh connection. */
  private resumePlayer(
    conn: Connection,
    playerId: string,
    email: string,
    venmoUsername: string,
    avatar?: PlayerAvatarCustomization
  ) {
    const previousConnId = this.data.playerToConnection[playerId]
    if (previousConnId && previousConnId !== conn.id) {
      const previousConn = this.room.getConnection(previousConnId)
      if (previousConn) {
        this.sendSessionEnded(
          previousConn,
          'replaced',
          'Your seat was opened in another tab or device, so this one stopped following the table.'
        )
      }
    }

    this.bindConnection(conn, playerId)
    this.cancelDisconnectedHostTransfer(playerId)
    this.data.membership.joinedAt[playerId] ??= Date.now()
    if (!this.data.hostId || this.isBotPlayer(this.data.hostId)) {
      this.data.hostId = playerId
    }
    if (!this.data.playerProfiles[playerId]) {
      this.data.playerProfiles[playerId] = { email, venmoUsername, avatar }
    } else {
      if (avatar) {
        this.data.playerProfiles[playerId].avatar = avatar
      }
      if (venmoUsername) {
        this.data.playerProfiles[playerId].venmoUsername = venmoUsername
      }
    }
    this.ensureStats(this.data.playerNicknames[playerId] ?? '')

    const player = this.getPlayer(playerId)
    if (player) {
      player.isConnected = true
      if (player.status === 'disconnected') {
        player.status = player.stack > 0 ? 'waiting' : 'sitting_out'
      }
    }

    this.finalizeState()
    // Reconnecting resumes the same deadline rather than restarting it.
    this.syncActionTimer()
    this.broadcastState()
  }

  private findHumanByNickname(nickname: string): string | undefined {
    const key = normalizePlayerUsername(nickname)
    return Object.entries(this.data.playerNicknames).find(([playerId, name]) => (
      !this.isBotPlayer(playerId) && normalizePlayerUsername(name) === key
    ))?.[0]
  }

  /** True when the player has a socket that is still open. */
  private isPlayerLive(playerId: string): boolean {
    const connId = this.data.playerToConnection[playerId]
    return Boolean(connId && this.room.getConnection(connId))
  }

  private sendSessionEnded(
    conn: Connection,
    reason: Extract<S2CMessage, { type: 'session_ended' }>['reason'],
    message: string
  ) {
    this.sendMessage(conn, { type: 'session_ended', reason, message })
  }

  private broadcastNotice(notice: Omit<Extract<S2CMessage, { type: 'notice' }>, 'type'>) {
    for (const conn of Array.from(this.room.getConnections())) {
      this.sendMessage(conn, { type: 'notice', ...notice })
    }
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
      this.data.spectatorStacks[playerId] ??= this.issueBuyIn(playerId)
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
      Math.floor(this.data.spectatorStacks[playerId] ?? this.issueBuyIn(playerId))
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
    this.syncActingPlayerIndex()
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
    this.updateMissedHands()

    const seatedPlayers = this.data.gameState.players.filter(
      player => player.stack > 0 && player.status !== 'disconnected' && player.status !== 'sitting_out'
    )
    if (seatedPlayers.length < 2) {
      this.sendActionFailed(conn, 'Need at least 2 players with chips who are at the table')
      this.broadcastState()
      return
    }

    try {
      this.clearAutoStart()
      this.data.cardRevealRequests = {}
      this.data.gameState = startHand({ ...this.data.gameState, pacedRunout: this.allInRunoutPacing })
      this.recordDealtIn()
      this.recordHandsPlayedForCurrentHand()
      this.wakeRestedDrinkers()
      this.advanceMushroomsForNewHand()
      this.scheduleBotDrinks()
      this.scheduleBotPeeks()
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

    // Mid-hand bots take their seat as 'waiting' and are dealt in next hand.
    const addedMidHand = this.data.gameState.phase === 'in_hand'
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
      this.issueBuyIn(botId)

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
    this.syncActingPlayerIndex()
    this.sendActionResult(
      conn,
      `Added ${toAdd} bot${toAdd === 1 ? '' : 's'}${addedMidHand ? '. They join next hand.' : ''}`
    )
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
      this.markPlayerPresent(playerId)
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

    const ledgerSettingKeys = ['allowRebuys', 'maxRebuys', 'chipValue']
    if (msg.allowRebuys !== undefined || msg.maxRebuys !== undefined || msg.chipValue !== undefined) {
      // Money rules apply immediately: they never touch a hand in progress.
      const maxRebuysValid = msg.maxRebuys === undefined || (
        Number.isSafeInteger(msg.maxRebuys) && msg.maxRebuys >= 0 && msg.maxRebuys <= MAX_REBUYS_LIMIT
      )
      const chipValueValid = msg.chipValue === undefined || (
        Number.isFinite(msg.chipValue) && msg.chipValue >= MIN_CHIP_VALUE && msg.chipValue <= MAX_CHIP_VALUE
      )
      if (!maxRebuysValid || !chipValueValid) {
        this.sendActionFailed(conn, `Use 0-${MAX_REBUYS_LIMIT} max rebuys (0 = unlimited) and a chip value above $0.`)
        return
      }
      if (msg.allowRebuys !== undefined) this.data.tableSettings.allowRebuys = msg.allowRebuys
      if (msg.maxRebuys !== undefined) this.data.tableSettings.maxRebuys = msg.maxRebuys
      if (msg.chipValue !== undefined) this.data.tableSettings.chipValue = msg.chipValue
      if (Object.keys(msg).every(key => key === 'type' || ledgerSettingKeys.includes(key))) {
        this.sendActionResult(conn, 'Rebuy and settle-up settings saved.')
        this.broadcastState()
        return
      }
    }

    if (msg.funModeEnabled !== undefined) {
      // Cosmetic, so it applies immediately instead of waiting for the next hand.
      this.setFunMode(msg.funModeEnabled)
      const onlyFunMode = Object.keys(msg).every(key => key === 'type' || key === 'funModeEnabled')
      if (onlyFunMode) {
        this.sendActionResult(conn, msg.funModeEnabled ? 'Fun mode on: drinks and Lady Luck are back.' : 'Fun mode off: no drinks or Lady Luck.')
        this.broadcastState()
        return
      }
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

  private isFunModeEnabled(): boolean {
    return this.data.tableSettings.funModeEnabled !== false
  }

  /** Turning fun mode off sobers everyone up and sends Lady Luck home. */
  private setFunMode(enabled: boolean) {
    this.data.tableSettings.funModeEnabled = enabled
    if (enabled) return
    for (const timer of Array.from(this.drinkWaterTimers.values())) clearTimeout(timer)
    this.drinkWaterTimers.clear()
    this.clearBlackoutTimers()
    this.clearAllMushrooms()
    this.drinkLedger = {}
    for (const timer of this.botShotTimers) clearTimeout(timer)
    this.botShotTimers.clear()
    this.lastChipFlickAt.clear()
    this.shotQueue = []
    this.data.ladyLuck = createLadyLuckTracker()
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

    this.cancelDisconnectedHostTransfer(playerId)
    this.sendActionResult(conn)
    this.evictPlayer(playerId)
    this.broadcastState()
  }

  /**
   * Self-serve rebuy: one full buy-in (the starting stack), allowed while you
   * hold less than a starting stack. Chips never change under a live hand, so
   * a rebuy asked for mid-hand is queued and lands the moment the hand ends.
   */
  private handleRebuy(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.isBotPlayer(playerId)) {
      this.sendActionFailed(conn, 'Join the room before rebuying')
      return
    }

    const seated = this.getPlayer(playerId)
    const onRail = !seated && (
      Boolean(this.data.spectatorIds[playerId]) || this.data.spectatorStacks[playerId] !== undefined
    )
    if (!seated && !onRail) {
      this.sendActionFailed(conn, 'Take a seat before rebuying')
      return
    }

    const account = this.ledgerAccountFor(playerId)
    if (!account) {
      this.sendActionFailed(conn, 'Take a seat before rebuying')
      return
    }

    const settings = this.getLedgerSettings()
    const startingStack = this.data.tableSettings.startingStack
    const chips = seated ? seated.stack : Math.max(0, this.data.spectatorStacks[playerId] ?? 0)
    const blocked = getRebuyBlockReason({
      settings,
      rebuysUsed: account.rebuys,
      chips,
      startingStack,
      queued: Boolean(this.data.ledger.pendingRebuys[account.key]),
    })
    if (blocked) {
      this.sendActionFailed(conn, describeRebuyBlock(blocked, startingStack, settings.maxRebuys))
      return
    }

    if (seated && this.isPlayerLiveInHand(playerId)) {
      this.data.ledger.pendingRebuys[account.key] = true
      this.sendActionResult(conn, `Rebuy queued: ${formatCurrency(startingStack)} lands when this hand ends.`)
      this.broadcastState()
      return
    }

    this.applyRebuy(playerId, account)
    this.sendActionResult(conn, `Rebought ${formatCurrency(startingStack)}.`)
    this.finalizeState()
    this.broadcastState()
  }

  private applyRebuy(playerId: string, account: LedgerAccount) {
    const amount = this.data.tableSettings.startingStack
    const seated = this.getPlayer(playerId)
    if (seated) {
      seated.stack += amount
      if (this.data.gameState.phase === 'in_hand') {
        if (seated.status === 'waiting' || seated.status === 'sitting_out') {
          seated.status = 'waiting'
        }
      } else if (seated.status !== 'disconnected') {
        seated.status = seated.isConnected ? 'waiting' : 'disconnected'
      }
    } else {
      const previous = Math.max(0, Math.floor(this.data.spectatorStacks[playerId] ?? 0))
      this.data.spectatorStacks[playerId] = previous + amount
      // Busted onto the rail: the rebuy is a ticket straight back to a seat.
      if (previous <= 0 && this.data.spectatorIds[playerId] && !this.data.pendingSpectators[playerId]) {
        const seatIndex = this.findAvailableSeat()
        if (seatIndex >= 0) {
          this.seatPlayerAt(playerId, seatIndex)
        }
      }
    }

    recordRebuy(this.data.ledger, account, amount)
    this.broadcastNotice({
      kind: 'ledger',
      playerId,
      message: `${account.name} rebought ${formatCurrency(amount)}`,
    })
  }

  /** Runs whenever no hand is live: land rebuys that were asked for mid-hand. */
  private applyQueuedRebuys() {
    const keys = Object.keys(this.data.ledger.pendingRebuys)
    if (keys.length === 0) {
      return
    }

    for (const key of keys) {
      delete this.data.ledger.pendingRebuys[key]
      const account = this.data.ledger.accounts[key]
      const playerId = this.findPlayerIdForLedgerKey(key)
      if (!account || !playerId) {
        continue
      }
      const seated = this.getPlayer(playerId)
      const chips = seated ? seated.stack : Math.max(0, this.data.spectatorStacks[playerId] ?? 0)
      const settings = this.getLedgerSettings()
      const blocked = getRebuyBlockReason({
        settings,
        rebuysUsed: account.rebuys,
        chips,
        startingStack: this.data.tableSettings.startingStack,
        queued: false,
      })
      if (blocked) {
        const connId = this.data.playerToConnection[playerId]
        const conn = connId ? this.room.getConnection(connId) : undefined
        if (conn) {
          this.sendActionFailed(conn, `Rebuy skipped. ${describeRebuyBlock(blocked, this.data.tableSettings.startingStack, settings.maxRebuys)}`)
        }
        continue
      }
      this.applyRebuy(playerId, account)
    }
  }

  private handleSettleUp(conn: Connection) {
    if (!this.requireGameCreator(conn, 'call the settle-up')) {
      return
    }

    this.data.ledger.settleUpAt = Date.now()
    this.sendActionResult(conn, 'Settle-up shared with the table.')
    this.broadcastState()
  }

  private handleSetVenmo(conn: Connection, venmoUsername: string) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before adding your Venmo')
      return
    }

    const profile = this.data.playerProfiles[playerId] ??= { email: '', venmoUsername: '' }
    profile.venmoUsername = venmoUsername
    const key = this.ledgerKeyFor(playerId)
    const account = key ? this.data.ledger.accounts[key] : undefined
    if (account) {
      account.venmoUsername = venmoUsername || undefined
    }
    this.sendActionResult(conn, venmoUsername ? `Venmo set to ${venmoUsername}.` : 'Venmo removed.')
    this.broadcastState()
  }

  private getLedgerSettings(): LedgerSettings {
    const settings = this.data.tableSettings
    return {
      allowRebuys: settings.allowRebuys ?? DEFAULT_LEDGER_SETTINGS.allowRebuys,
      maxRebuys: settings.maxRebuys ?? DEFAULT_LEDGER_SETTINGS.maxRebuys,
      chipValue: settings.chipValue ?? DEFAULT_LEDGER_SETTINGS.chipValue,
    }
  }

  /** Ledger identity: the stats identity (normalized nickname), or `bot:<id>`. */
  private ledgerKeyFor(playerId: string, nickname?: string): string | null {
    if (this.isBotPlayer(playerId)) {
      return `bot:${playerId}`
    }
    const name = this.data.playerNicknames[playerId] ?? nickname ?? this.getPlayer(playerId)?.nickname
    return name ? normalizePlayerUsername(name) : null
  }

  private ledgerAccountFor(playerId: string, nickname?: string): LedgerAccount | null {
    const key = this.ledgerKeyFor(playerId, nickname)
    if (!key) {
      return null
    }
    const name = this.data.playerNicknames[playerId] ?? nickname ?? this.getPlayer(playerId)?.nickname ?? 'Player'
    const account = ensureAccount(this.data.ledger, key, name, key.startsWith('bot:'))
    const venmo = this.data.playerProfiles[playerId]?.venmoUsername
    if (venmo) {
      account.venmoUsername = venmo
    }
    return account
  }

  /** Mint a starting stack for a player sitting down fresh, on the books. */
  private issueBuyIn(playerId: string): number {
    const amount = this.data.tableSettings.startingStack
    const account = this.ledgerAccountFor(playerId)
    if (account) {
      recordBuyIn(this.data.ledger, account, amount)
    }
    return amount
  }

  private findPlayerIdForLedgerKey(key: string): string | undefined {
    if (key.startsWith('bot:')) {
      const botId = key.slice(4)
      return this.getPlayer(botId) || this.data.playerNicknames[botId] ? botId : undefined
    }
    const seated = this.data.gameState.players.find(player => (
      !player.isBot && this.ledgerKeyFor(player.id, player.nickname) === key && !this.data.pendingRemovals[player.id]
    ))
    if (seated) {
      return seated.id
    }
    return Object.keys(this.data.playerNicknames).find(playerId => (
      !this.isBotPlayer(playerId) && this.ledgerKeyFor(playerId) === key
    ))
  }

  /** Chips each ledger identity holds right now, wherever they sit (committed chips count). */
  private ledgerChipsByKey(): Map<string, number> {
    const chips = new Map<string, number>()
    const add = (key: string | null, amount: number) => {
      if (!key) return
      chips.set(key, (chips.get(key) ?? 0) + Math.max(0, amount))
    }
    const inHand = this.data.gameState.phase === 'in_hand'
    for (const player of this.data.gameState.players) {
      add(this.ledgerKeyFor(player.id, player.nickname), player.stack + (inHand ? player.totalInPot : 0))
    }
    for (const [playerId, stack] of Object.entries(this.data.spectatorStacks)) {
      add(this.ledgerKeyFor(playerId), stack)
    }
    for (const [key, stack] of Object.entries(this.data.membership.departedStacks)) {
      add(key, stack)
    }
    for (const account of Object.values(this.data.ledger.accounts)) {
      add(account.key, account.cashedOut)
    }
    return chips
  }

  private buildLedgerSnapshot(): LedgerSnapshot {
    const settings = this.getLedgerSettings()
    const chipsByKey = this.ledgerChipsByKey()
    const rows: LedgerRow[] = Object.values(this.data.ledger.accounts).map(account => {
      const playerId = this.findPlayerIdForLedgerKey(account.key)
      const seated = playerId ? this.getPlayer(playerId) : undefined
      const where: LedgerRow['where'] = seated && !this.data.pendingRemovals[seated.id]
        ? 'seated'
        : playerId
          ? 'rail'
          : 'left'
      const venmoUsername = (playerId ? this.data.playerProfiles[playerId]?.venmoUsername : undefined) || account.venmoUsername
      const boughtIn = totalBoughtIn(account)
      const chips = chipsByKey.get(account.key) ?? 0
      return {
        key: account.key,
        name: account.name,
        isBot: account.isBot,
        ...(playerId ? { playerId } : {}),
        where,
        ...(venmoUsername ? { venmoUsername } : {}),
        boughtIn,
        chips,
        net: chips - boughtIn,
        rebuys: account.rebuys,
        rebuyQueued: Boolean(this.data.ledger.pendingRebuys[account.key]),
      }
    }).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name))

    return {
      settings,
      buyInAmount: this.data.tableSettings.startingStack,
      rows,
      payments: buildLedgerPayments(rows, settings.chipValue),
      totalBoughtIn: rows.reduce((sum, row) => sum + row.boughtIn, 0),
      totalChips: rows.reduce((sum, row) => sum + row.chips, 0),
      events: this.data.ledger.events.slice(-20).reverse(),
      settleUpAt: this.data.ledger.settleUpAt,
    }
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
    const wasAllIn = seatedPlayer?.status === 'all_in'
    const targetConnId = this.data.playerToConnection[targetId]
    const targetConn = targetConnId ? this.room.getConnection(targetConnId) : undefined
    if (targetConn) {
      this.sendSessionEnded(targetConn, 'kicked', 'The host removed you from the table.')
    }

    if (this.data.gameState.phase === 'in_hand' && !seatedPlayer) {
      this.removeSessionMetadata(targetId)
      delete this.data.pendingRemovals[targetId]
      this.sendActionResult(conn, `Kicked ${targetName} from the table.`)
      this.finalizeState()
      this.broadcastState()
      return
    }

    this.evictPlayer(targetId)
    if (seatedPlayer && !seatedPlayer.isBot && !this.isBotPlayer(targetId)) {
      this.data.membership.kickedNames[normalizePlayerUsername(targetName)] = true
    }
    this.sendActionResult(
      conn,
      !removedMidHand
        ? `Kicked ${targetName} from the table.`
        : wasAllIn
          ? `Kicked ${targetName}. Their all-in plays out, then they leave the table.`
          : `Kicked ${targetName}. They fold now and leave the table after this hand.`
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
      const stackBefore = player.stack
      player.stack = Math.max(0, player.stack + delta)
      this.recordHostChipAdjustment(conn, targetId, player.stack - stackBefore, player.nickname)
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
      const stackBefore = Math.max(0, Math.floor(this.data.spectatorStacks[targetId] ?? 0))
      const nextStack = Math.max(0, Math.floor(stackBefore + delta))
      this.data.spectatorStacks[targetId] = nextStack
      this.recordHostChipAdjustment(conn, targetId, nextStack - stackBefore, playerName)
      this.sendActionResult(conn, describeChipAdjustment(playerName, delta))
      this.broadcastState()
      return
    }

    this.sendActionFailed(conn, 'Player not found')
  }

  /** Every host add/remove goes on the books and is announced to the table. */
  private recordHostChipAdjustment(conn: Connection, targetId: string, appliedDelta: number, targetName: string) {
    if (appliedDelta === 0) {
      return
    }
    const account = this.ledgerAccountFor(targetId, targetName)
    if (!account) {
      return
    }
    const hostId = this.data.connectionToPlayer[conn.id]
    const hostName = (hostId && this.data.playerNicknames[hostId]) || 'Host'
    recordHostAdjustment(this.data.ledger, account, appliedDelta, hostName)
    const target = hostId === targetId ? 'their own stack' : account.name
    this.broadcastNotice({
      kind: 'ledger',
      playerId: targetId,
      message: appliedDelta > 0
        ? `${hostName} added ${formatCurrency(appliedDelta)} to ${target}`
        : `${hostName} removed ${formatCurrency(appliedDelta)} from ${target}`,
    })
  }

  private handleSetPlayerSpectator(conn: Connection, targetId: string, spectator: boolean) {
    const senderId = this.data.connectionToPlayer[conn.id]
    if (senderId && senderId === targetId) {
      this.handleSelfSpectator(conn, senderId, spectator)
      return
    }

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
        this.foldDepartingPlayer(targetId)
        this.finalizeState()
        this.syncActionTimer(wasActingPlayer)
        this.sendActionResult(conn, `Moved ${targetName} to spectator mode. They fold now and watch the rest of this hand.`)
        this.broadcastState()
        return
      }

      if (seatedPlayer) {
        this.data.spectatorStacks[targetId] = seatedPlayer.stack
        this.removePlayerFromTable(targetId)
      } else {
        // Never seated yet: give them the buy-in a full-table newcomer gets,
        // so "Take seat" works from the rail.
        this.data.spectatorStacks[targetId] ??= this.issueBuyIn(targetId)
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

  /**
   * Anyone may stand up to watch, or sit back down, themselves. Standing up
   * never folds a live hand: they play it out and move to the rail after it.
   */
  private handleSelfSpectator(conn: Connection, playerId: string, spectator: boolean) {
    const seatedPlayer = this.getPlayer(playerId)
    const inHand = this.data.gameState.phase === 'in_hand'

    if (!spectator) {
      if (seatedPlayer) {
        delete this.data.pendingSpectators[playerId]
        delete this.data.spectatorIds[playerId]
        this.sendActionResult(conn, 'You stay in your seat.')
        this.broadcastState()
        return
      }
      this.handleSeatMe(conn)
      return
    }

    if (seatedPlayer && inHand) {
      this.data.pendingSpectators[playerId] = true
      this.data.spectatorIds[playerId] = true
      this.sendActionResult(conn, 'You move to the rail after this hand.')
      this.broadcastState()
      return
    }

    if (seatedPlayer) {
      this.data.spectatorStacks[playerId] = seatedPlayer.stack
      this.removePlayerFromTable(playerId)
    } else {
      this.data.spectatorStacks[playerId] ??= this.issueBuyIn(playerId)
    }
    this.data.spectatorIds[playerId] = true
    this.sendActionResult(conn, 'You are watching from the rail.')
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
    this.recordHandHistory(true)
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

    // Spectators react from the rail too: their emote lands on the seat they
    // aim at (or just goes in the chat log when untargeted).
    const player = this.getPlayer(playerId)
    if (!player && !this.isKnownPlayer(playerId)) {
      this.sendActionFailed(conn, 'Join the room before emoting')
      return
    }

    const normalizedTargetId = typeof targetId === 'string' && targetId.trim().length > 0
      ? targetId.trim()
      : playerId

    if (normalizedTargetId !== playerId && !this.isKnownPlayer(normalizedTargetId)) {
      this.sendActionFailed(conn, 'That player is not available to receive a targeted emote')
      return
    }

    const nickname = this.data.playerNicknames[playerId] ?? player?.nickname ?? 'Player'
    const targetNickname =
      normalizedTargetId === playerId
        ? ''
        : this.getPlayer(normalizedTargetId)?.nickname ??
          this.data.playerNicknames[normalizedTargetId] ??
          'Player'
    const message = normalizedTargetId === playerId
      ? emote
      : `to ${targetNickname}: ${emote}`
    const now = Date.now()

    this.data.social.activeByPlayer[playerId] = {
      ...this.data.social.activeByPlayer[playerId],
      emote,
      emoteExpiresAt: now + EMOTE_DURATION,
      targetPlayerId: normalizedTargetId !== playerId ? normalizedTargetId : undefined,
    }

    this.appendChatEntry(playerId, nickname, message, now)

    this.broadcastState()
  }

  private handleOrderDrink(conn: Connection, kind: DrinkKind) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, 'Join the room before ordering a drink')
      return
    }

    const player = this.getPlayer(playerId)
    if (!player) {
      this.sendActionFailed(conn, 'Take a seat before ordering a drink')
      return
    }

    if (!this.isFunModeEnabled()) {
      this.sendActionFailed(conn, 'Fun mode is off at this table')
      return
    }

    const result = this.orderDrinkFor(playerId, kind)
    if (!result.ok) {
      this.sendActionFailed(conn, result.reason)
      return
    }

    this.sendActionResult(conn)
    this.broadcastState()
  }

  private orderDrinkFor(playerId: string, kind: DrinkKind): { ok: true } | { ok: false; reason: string } {
    const player = this.getPlayer(playerId)
    if (!player) return { ok: false, reason: 'Take a seat before ordering a drink' }
    const entry = this.drinkLedger[playerId] ??= this.newSeatedDrinkEntry()
    const state = this.data.gameState
    const now = Date.now()
    const result = orderDrink(entry, {
      kind,
      now,
      drinkId: generateId(10),
      handNumber: state.handNumber,
      isDealtIntoLiveHand: state.phase === 'in_hand' && player.holeCards.length === 2,
    })

    if (!result.ok) {
      return { ok: false, reason: result.reason }
    }

    this.broadcastDrinkEvent(playerId, result.chaser ? 'chaser' : kind)

    // Slow water waits for the next hand; but the victim's next water is the
    // spiked one: it does nothing else and starts the trip once the sip is
    // down. Nobody can tell yet.
    if (result.water && this.isFunModeEnabled() && drinkSpikedWater(this.mushrooms, playerId)) {
      discardQueuedWater(entry, result.water.id)
      this.scheduleSpikedWater(playerId, result.water.id)
    } else if (result.water) {
      this.scheduleWaterLanding(playerId, result.water.id)
    }

    if (result.passedOut) {
      this.handlePassedOut(playerId)
    }

    return { ok: true }
  }

  /**
   * A blackout is purely visual: the player is never folded, skipped or sat
   * out and keeps their normal action timer. Announce it and schedule the
   * wake-up checks (they also run whenever a new hand starts).
   */
  private handlePassedOut(playerId: string) {
    this.clearWaterTimers(playerId)
    this.broadcastDrinkEvent(playerId, 'passed_out')
    this.clearBlackoutTimers(playerId)
    const timers = [BLACKOUT_MS].map(delay => setTimeout(() => {
      const entry = this.drinkLedger[playerId]
      if (entry && wakeIfRested(entry, this.data.gameState.handNumber, Date.now())) {
        this.clearBlackoutTimers(playerId)
        this.broadcastDrinkEvent(playerId, 'woke_up')
        this.broadcastState()
      }
    }, delay + 5))
    this.blackoutTimers.set(playerId, timers)
  }

  private clearBlackoutTimers(playerId?: string) {
    for (const [id, timers] of Array.from(this.blackoutTimers.entries())) {
      if (playerId && id !== playerId) continue
      timers.forEach(timer => clearTimeout(timer))
      this.blackoutTimers.delete(id)
    }
  }

  /**
   * Common checks for a prank aimed at another seated player. Returns the
   * sender's player id, or null after telling the sender why not.
   */
  private validatePrank(conn: Connection, targetId: string, noun: string): string | null {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      this.sendActionFailed(conn, `Join the room before ${noun}`)
      return null
    }
    if (!this.getPlayer(playerId)) {
      this.sendActionFailed(conn, `Take a seat before ${noun}`)
      return null
    }
    if (!this.isFunModeEnabled()) {
      this.sendActionFailed(conn, 'Fun mode is off at this table')
      return null
    }
    if (targetId === playerId) {
      this.sendActionFailed(conn, 'Nice try. Pick someone else.')
      return null
    }
    if (!this.getPlayer(targetId)) {
      this.sendActionFailed(conn, 'That player is not at the table')
      return null
    }
    // Phones (the 2D layout) have none of the drinking or prank features,
    // in either direction.
    if (!this.isDrinkCapable({ id: playerId })) {
      this.sendActionFailed(conn, 'Pranks are only at the desktop table')
      return null
    }
    if (!this.isDrinkCapable({ id: targetId })) {
      this.sendActionFailed(conn, "They're on their phone — no bar service")
      return null
    }
    return playerId
  }

  private handleBuyShot(conn: Connection, targetId: string) {
    const playerId = this.validatePrank(conn, targetId, 'buying a shot')
    if (!playerId) return
    const result = this.buyShotFor(playerId, targetId)
    if (!result.ok) {
      this.sendActionFailed(conn, result.reason)
      return
    }
    this.sendActionResult(conn)
    this.broadcastState()
  }

  /** Phones have no bar service: only players who can actually drink can be bought shots. */
  private isDrinkCapable(player: Pick<InternalPlayer, 'id'>): boolean {
    return this.isBotPlayer(player.id) || this.drinkCapableByPlayer.get(player.id) === true
  }

  private handleSetDrinkCapable(conn: Connection, capable: boolean) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || this.drinkCapableByPlayer.get(playerId) === capable) return
    this.drinkCapableByPlayer.set(playerId, capable)
    this.broadcastState()
  }

  /**
   * Buys the shot now (the buyer's one-per-five-hands limit is spent) and
   * queues it; it is poured only once the target is out of the hand.
   */
  private buyShotFor(buyerId: string, targetId: string): { ok: true; queued: boolean } | { ok: false; reason: string } {
    const target = this.getPlayer(targetId)
    if (!target || !this.getPlayer(buyerId) || buyerId === targetId) {
      return { ok: false, reason: 'That player is not at the table' }
    }
    if (!this.isDrinkCapable(target)) {
      return { ok: false, reason: "They're on their phone — no bar service" }
    }
    const buyerEntry = this.drinkLedger[buyerId] ??= this.newSeatedDrinkEntry()
    const blocked = getShotBlockReason(buyerEntry, this.drinkLedger[targetId], this.data.gameState.handNumber, target.nickname)
    if (blocked) {
      return { ok: false, reason: blocked }
    }

    recordShotBought(buyerEntry, this.data.gameState.handNumber)
    const shot: QueuedShot = {
      id: generateId(10),
      fromId: buyerId,
      fromNickname: this.getPlayer(buyerId)?.nickname ?? 'Player',
      targetId,
    }
    this.shotQueue.push(shot)
    const delivered = this.deliverQueuedShots()
    const queued = !delivered.has(shot.id)
    if (queued) {
      this.broadcastPrankEvent('shot_queued', buyerId, targetId)
    }
    return { ok: true, queued }
  }

  /**
   * Pours every queued shot whose target is out of the hand, awake and off
   * their 3-hand receive cooldown: at most one per target at a time, the rest
   * keep waiting. Runs before every broadcast, so a fold or the end of a hand
   * delivers straight away. Returns the delivered shot ids.
   */
  private deliverQueuedShots(): Set<string> {
    const delivered = new Set<string>()
    if (this.shotQueue.length === 0) return delivered
    if (!this.isFunModeEnabled()) {
      this.shotQueue = []
      return delivered
    }
    const servedTargets = new Set<string>()
    const now = Date.now()
    this.shotQueue = this.shotQueue.filter(shot => {
      const target = this.getPlayer(shot.targetId)
      if (!target || !this.isDrinkCapable(target)) return false
      if (servedTargets.has(target.id)) return true
      const entry = this.drinkLedger[target.id] ??= this.newSeatedDrinkEntry()
      const pendingWatersBefore = [...entry.pendingWaters]
      const hungoverBefore = entry.hungoverThroughHand
      const result = deliverShot(entry, { ...this.getShotContext(target), now })
      if (!result.ok) return true
      if (result.passedOut && this.isHoldingLiveCards(target)) {
        // Owner: a shot that would black them out mid-hand keeps them awake on
        // the edge (9.5) until they fold or the hand ends; chasing it with
        // water in time can still save them.
        entry.passedOut = false
        entry.passedOutAt = null
        entry.level = PASS_OUT_LEVEL - 0.5
        entry.pendingWaters = pendingWatersBefore
        entry.hungoverThroughHand = hungoverBefore
        entry.chaserUntil = now + CHASER_WINDOW_MS
        this.pendingBlackouts.add(target.id)
        result.passedOut = false
      }
      servedTargets.add(target.id)
      delivered.add(shot.id)
      this.broadcastPrankEvent('shot', shot.fromId, target.id, {
        level: entry.level,
        levelAdded: result.levelAdded,
        passedOut: result.passedOut,
      }, shot.fromNickname)
      if (result.passedOut) {
        // Out of the hand, so the blackout never starts mid-hand for them.
        this.handlePassedOut(target.id)
      }
      return false
    })
    return delivered
  }

  /** Runs the random-thirst clock only while fun mode is on and a drink-capable player is seated. */
  private syncAutoBeerTimer() {
    const wanted = this.isFunModeEnabled() &&
      this.data.gameState.players.some(player => this.isDrinkCapable(player))
    if (wanted && !this.autoBeerTimer) {
      this.autoBeerTimer = setInterval(() => this.rollAutoBeers(), BUZZ.autoBeerEveryMs)
    } else if (!wanted && this.autoBeerTimer) {
      clearInterval(this.autoBeerTimer)
      this.autoBeerTimer = null
    }
  }

  /** Each drink-capable seated player may down a beer on their own (accidental blackouts welcome). */
  private rollAutoBeers() {
    if (!this.isFunModeEnabled()) return
    const state = this.data.gameState
    const now = Date.now()
    let drank = false
    for (const player of state.players) {
      if (!this.isDrinkCapable(player)) continue
      const entry = this.drinkLedger[player.id] ??= this.newSeatedDrinkEntry()
      if (entry.passedOut || this.autoBeerRandom() >= BUZZ.autoBeerChance) continue
      const blackedOut = forceBeers(entry, 1, { drinkId: generateId(10), now, handNumber: state.handNumber })
      this.broadcastDrinkEvent(player.id, 'house_beer', 1)
      if (blackedOut) this.handlePassedOut(player.id)
      drank = true
    }
    if (drank) this.broadcastState()
  }

  /** Holds unfolded cards in a live hand (all-in counts). */
  private isHoldingLiveCards(target: InternalPlayer): boolean {
    return isLiveInHand({
      phase: this.data.gameState.phase,
      status: target.status,
      holdsCards: target.holeCards.length > 0,
    })
  }

  /** Deferred shot blackouts land once the player is out of the hand (unless they chased it). */
  private syncPendingBlackouts() {
    for (const playerId of Array.from(this.pendingBlackouts)) {
      const target = this.getPlayer(playerId)
      const entry = this.drinkLedger[playerId]
      if (!target || !entry || !this.isFunModeEnabled() || entry.passedOut) {
        this.pendingBlackouts.delete(playerId)
        continue
      }
      if (this.isHoldingLiveCards(target)) continue
      this.pendingBlackouts.delete(playerId)
      if (entry.level < PASS_OUT_LEVEL - 0.5) continue
      entry.level = PASS_OUT_LEVEL
      entry.passedOut = true
      entry.passedOutAt = Date.now()
      entry.pendingWaters = []
      entry.hungoverThroughHand = null
      entry.chaserUntil = null
      this.handlePassedOut(playerId)
    }
  }

  private getShotContext(target: InternalPlayer) {
    const state = this.data.gameState
    // Owner: a shot lands right away, even mid-hand. The one exception is the
    // few seconds it's the target's turn: it pours the moment they act, so a
    // shot never lands in the middle of a decision.
    return {
      handNumber: state.handNumber,
      targetIsLive: state.phase === 'in_hand' && state.actingPlayerId === target.id,
    }
  }

  private handleFlickChip(conn: Connection, targetId: string) {
    const playerId = this.validatePrank(conn, targetId, 'flicking chips')
    if (!playerId) return
    const now = Date.now()
    const lastAt = this.lastChipFlickAt.get(playerId)
    if (lastAt !== undefined && now - lastAt < CHIP_FLICK_COOLDOWN_MS) {
      const seconds = Math.ceil((CHIP_FLICK_COOLDOWN_MS - (now - lastAt)) / 1000)
      this.sendActionFailed(conn, `Reloading. Next chip in ${seconds}s.`)
      return
    }
    this.lastChipFlickAt.set(playerId, now)
    // Purely cosmetic: no chips move between stacks.
    this.broadcastPrankEvent('chip_flick', playerId, targetId)
    this.sendActionResult(conn)
  }

  private broadcastPrankEvent(
    kind: PrankKind,
    fromId: string,
    targetId: string,
    extra: Pick<PrankEvent, 'level' | 'levelAdded' | 'passedOut' | 'rule'> = {},
    fromNickname?: string
  ) {
    const nameOf = (id: string) => this.getPlayer(id)?.nickname ?? this.data.playerNicknames[id] ?? 'Player'
    const event: PrankEvent = {
      id: generateId(12),
      kind,
      fromId,
      fromNickname: fromNickname ?? nameOf(fromId),
      targetId,
      targetNickname: nameOf(targetId),
      at: Date.now(),
      ...extra,
    }
    for (const conn of Array.from(this.room.getConnections())) {
      this.sendMessage(conn, { type: 'prank_event', event })
    }
  }

  /**
   * House rules (see lib/houseRules), applied once the hand is over (never
   * mid-hand) to drink-capable players with fun mode on. Per player: house
   * shots, then forced beers (max 2), then the big-win free water.
   */
  private applyHouseRules(winnerAmounts: ReadonlyMap<string, number>) {
    const starts = this.handStartStacks
    this.handStartStacks = new Map()
    if (!this.isFunModeEnabled()) return
    const state = this.data.gameState
    if (state.phase !== 'between_hands') return
    const runBoards = state.runItTwice?.status === 'accepted'
      ? (state.runItTwice.boards ?? []).map(board => board.cards)
      : []
    // Scared money: dealt-in folds in a row. Bubble: shortest stack drinks as each orbit ends.
    const dealtIn = state.players.filter(player => starts.has(player.id))
    for (const player of dealtIn) {
      this.foldStreaks.set(player.id, player.status === 'folded' ? (this.foldStreaks.get(player.id) ?? 0) + 1 : 0)
    }
    this.orbitHands += 1
    let bubbleIds: string[] = []
    if (dealtIn.length >= 2 && this.orbitHands >= dealtIn.length) {
      this.orbitHands = 0
      const alive = dealtIn.filter(player => player.stack > 0 && this.isDrinkCapable(player))
      const shortest = Math.min(...alive.map(player => player.stack))
      bubbleIds = alive.filter(player => player.stack === shortest).map(player => player.id)
    }
    const outcomes = computeHouseRules({
      showdown: isTrueShowdown(state),
      boards: runBoards.length > 0 ? runBoards : [state.communityCards],
      players: state.players.map(player => ({
        id: player.id,
        drinkCapable: this.isDrinkCapable(player),
        holeCards: player.holeCards,
        folded: player.status === 'folded',
        startStack: starts.get(player.id),
        endStack: player.stack,
        won: winnerAmounts.get(player.id) ?? 0,
        foldStreak: this.foldStreaks.get(player.id) ?? 0,
      })),
      bubbleIds,
      dealerId: state.players.find(player => player.isDealer)?.id ?? null,
      waterfall: state.handNumber > 0 && state.handNumber % WATERFALL_EVERY_HANDS === 0,
    })
    for (const outcome of outcomes) {
      if (outcome.beerRules.includes('scared_money')) this.foldStreaks.set(outcome.playerId, 0)
    }
    const now = Date.now()
    for (const outcome of outcomes) {
      const entry = this.drinkLedger[outcome.playerId] ??= this.newSeatedDrinkEntry()
      for (const rule of outcome.shots) {
        const result = pourHouseShot(entry, { handNumber: state.handNumber, now })
        if (!result.ok) break
        this.broadcastPrankEvent('house_shot', HOUSE_ID, outcome.playerId, {
          level: entry.level,
          levelAdded: result.levelAdded,
          passedOut: result.passedOut,
          rule,
        }, 'The house')
        if (result.passedOut) this.handlePassedOut(outcome.playerId)
      }
      if (outcome.beers > 0 && !entry.passedOut) {
        const blackedOut = forceBeers(entry, outcome.beers, { drinkId: generateId(10), now, handNumber: state.handNumber })
        this.broadcastDrinkEvent(outcome.playerId, 'house_beer', outcome.beers)
        if (blackedOut) this.handlePassedOut(outcome.playerId)
      }
      if (outcome.freeWater && pourFreeWater(entry) > 0) {
        this.broadcastDrinkEvent(outcome.playerId, 'house_water')
      }
    }
  }

  /**
   * After a bot drags in a big pot it sometimes buys a random human a shot,
   * under the same one-shot-per-five-hands rule as everyone else.
   */
  private maybeScheduleBotShot(winnerAmounts: ReadonlyMap<string, number>) {
    if (!this.isFunModeEnabled()) return
    const bigPot = Math.max(1, this.data.tableSettings.bigBlind) * BOT_SHOT_BIG_POT_BLINDS
    const handNumber = this.data.gameState.handNumber
    for (const [botId, amount] of winnerAmounts) {
      if (amount < bigPot || !this.isBotPlayer(botId)) continue
      if (getShotHandsRemaining(this.drinkLedger[botId], handNumber) > 0) continue
      if (this.botShotRandom() > BOT_SHOT_CHANCE) continue
      const humans = this.data.gameState.players.filter(player =>
        !this.isBotPlayer(player.id) &&
        this.isDrinkCapable(player) &&
        getShotBlockReason(this.drinkLedger[botId], this.drinkLedger[player.id], handNumber) === null
      )
      if (humans.length === 0) return
      const target = humans[Math.min(humans.length - 1, Math.floor(this.botShotRandom() * humans.length))]!
      const timer = setTimeout(() => {
        this.botShotTimers.delete(timer)
        if (!this.isFunModeEnabled()) return
        // Same path as a human purchase: queued, delivered only outside a live hand.
        if (this.buyShotFor(botId, target.id).ok) this.broadcastState()
      }, BOT_SHOT_DELAY_MS)
      this.botShotTimers.add(timer)
      // One round per pot is plenty.
      return
    }
  }

  /**
   * Bots grab the odd beer (and water once they're tipsy) mid-hand so the
   * drinking animations show up even at a table of one human and bots.
   * They never drink themselves past level 4.
   */
  /** Humans sit down in the sweet spot (tests can override via seatedStartLevel). */
  seatedStartLevel: number = BUZZ.startLevel

  private newSeatedDrinkEntry() {
    return createSeatedDrinkLedgerEntry(this.seatedStartLevel)
  }

  private scheduleBotDrinks() {
    for (const timer of this.botDrinkTimers) clearTimeout(timer)
    this.botDrinkTimers.clear()
    if (!this.isFunModeEnabled()) return
    for (const player of this.data.gameState.players) {
      if (!this.isBotPlayer(player.id)) continue
      // Bots sit down with a buzz already on, so a fresh table isn't all designated drivers.
      this.drinkLedger[player.id] ??= { ...createDrinkLedgerEntry(), level: 2 + Math.round(this.botDrinkRandom() * 4) / 2 }
      const kind = chooseBotDrink(this.drinkLedger[player.id]!.level, this.botDrinkRandom)
      if (!kind) continue
      const delay = 1500 + this.botDrinkRandom() * 9000

      const timer = setTimeout(() => {
        this.botDrinkTimers.delete(timer)
        if (!this.isFunModeEnabled() || !this.getPlayer(player.id)) return
        if (this.orderDrinkFor(player.id, kind).ok) this.broadcastState()
      }, delay)
      this.botDrinkTimers.add(timer)
    }
  }

  /** An ordinary water sobers them up WATER_LANDS_MS after ordering. */
  private scheduleWaterLanding(playerId: string, waterId: string) {
    const timerKey = `${playerId}:${waterId}`
    const timer = setTimeout(() => {
      this.drinkWaterTimers.delete(timerKey)
      const entry = this.drinkLedger[playerId]
      if (entry && applyQueuedWater(entry, waterId) > 0) {
        this.broadcastDrinkEvent(playerId, 'water_kicked_in')
      }
      this.broadcastState()
    }, WATER_LANDS_MS)
    this.drinkWaterTimers.set(timerKey, timer)
  }

  /** The spiked glass lands once the sip is down: the trip starts (or queues if they're live). */
  private scheduleSpikedWater(playerId: string, waterId: string) {
    const timerKey = `${playerId}:${waterId}`
    this.spikedWaterKeys.add(timerKey)
    const timer = setTimeout(() => {
      this.drinkWaterTimers.delete(timerKey)
      this.spikedWaterKeys.delete(timerKey)
      this.syncTrips()
      this.broadcastState()
    }, WATER_KICK_IN_MS)
    this.drinkWaterTimers.set(timerKey, timer)
  }

  private clearWaterTimers(playerId: string) {
    for (const [timerKey, timer] of Array.from(this.drinkWaterTimers.entries())) {
      if (timerKey.startsWith(`${playerId}:`)) {
        clearTimeout(timer)
        this.drinkWaterTimers.delete(timerKey)
        // A spiked glass cut short (blackout) still delivers its trip.
        if (this.spikedWaterKeys.delete(timerKey)) this.syncTrips()
      }
    }
  }

  // -------------------------------------------------------------------------
  // The Mushroom (lib/mushroom.ts)
  // -------------------------------------------------------------------------

  private handleSpikeWater(conn: Connection, targetId: string) {
    const playerId = this.validatePrank(conn, targetId, 'spiking a drink')
    if (!playerId) return
    const result = this.spikeWaterFor(playerId, targetId)
    if (!result.ok) {
      this.sendActionFailed(conn, result.reason)
      return
    }
    this.sendActionResult(conn)
    this.broadcastState()
  }

  private spikeWaterFor(spikerId: string, targetId: string): { ok: true } | { ok: false; reason: string } {
    const spiker = this.getPlayer(spikerId)
    const target = this.getPlayer(targetId)
    if (!spiker || !target) return { ok: false, reason: 'That player is not at the table' }
    const blocked = getSpikeBlockReason(this.mushrooms, spikerId, targetId)
    if (blocked) return { ok: false, reason: blocked }
    if (!this.isDrinkCapable(target)) {
      return { ok: false, reason: `${target.nickname} can't order drinks on their device.` }
    }
    const result = spikeWater(this.mushrooms, spikerId, spiker.nickname, targetId, this.data.gameState.handNumber)
    if (!result.ok) return result
    // Secret: only the spiker hears about it.
    this.sendMushroomEvent(
      { kind: 'spiked', spikerId, spikerNickname: spiker.nickname, victimId: targetId, victimNickname: target.nickname },
      [spikerId]
    )
    return { ok: true }
  }

  private sendMushroomEvent(fields: Omit<MushroomEvent, 'id' | 'at'>, toPlayerIds: readonly string[] | 'all') {
    const event: MushroomEvent = { id: generateId(12), at: Date.now(), ...fields }
    for (const conn of Array.from(this.room.getConnections())) {
      const playerId = this.data.connectionToPlayer[conn.id]
      if (toPlayerIds !== 'all' && (!playerId || !toPlayerIds.includes(playerId))) continue
      this.sendMessage(conn, { type: 'mushroom_event', event })
    }
  }

  private isPlayerLiveInHand(playerId: string): boolean {
    const player = this.getPlayer(playerId)
    return Boolean(player && isLiveInHand({
      phase: this.data.gameState.phase,
      status: player.status,
      holdsCards: player.holeCards.length > 0,
    }))
  }

  /**
   * Starts a queued trip once its victim is out of the live hand (folded or
   * the hand is over) and ends finished ones. Runs before every broadcast, so
   * a fold or a hand ending starts it on the spot.
   */
  private syncTrips() {
    const trip = this.mushrooms.trip
    if (!trip) return
    const handNumber = this.data.gameState.handNumber
    const victim = this.getPlayer(trip.victimId)
    if (!victim || !this.isFunModeEnabled()) {
      removeMushroomPlayer(this.mushrooms, trip.victimId, handNumber, this.mushroomRandom)
      this.clearTripTimer()
      return
    }
    // Still sipping: the slot is reserved but the glass hasn't kicked in yet.
    const prefix = `${trip.victimId}:`
    if (Array.from(this.spikedWaterKeys).some(key => key.startsWith(prefix))) return
    const now = Date.now()
    if (startTripIfReady(this.mushrooms, this.isPlayerLiveInHand(trip.victimId), now, handNumber)) {
      this.sendMushroomEvent({
        kind: 'trip_started',
        spikerId: trip.spikerId,
        spikerNickname: trip.spikerNickname,
        victimId: victim.id,
        victimNickname: victim.nickname,
      }, 'all')
      this.clearTripTimer()
      this.tripTimer = setTimeout(() => {
        this.tripTimer = null
        this.broadcastState()
      }, Math.max(0, (this.mushrooms.trip?.endsAt ?? now) - now) + 5)
      return
    }
    const handOver = this.data.gameState.phase !== 'in_hand'
    const endedVictimId = endTripIfOver(this.mushrooms, now, handNumber, handOver, this.mushroomRandom)
    if (endedVictimId) {
      this.clearTripTimer()
      this.sendMushroomEvent({ kind: 'trip_ended', victimId: endedVictimId, victimNickname: victim.nickname }, 'all')
    }
  }

  private clearTripTimer() {
    if (this.tripTimer) clearTimeout(this.tripTimer)
    this.tripTimer = null
  }

  /** Called when a hand starts: old mushrooms go bad, a new one may turn up, bots may use theirs. */
  private advanceMushroomsForNewHand() {
    if (!this.isFunModeEnabled()) return

    const handNumber = this.data.gameState.handNumber
    const expired = expireStaleMushroom(this.mushrooms, handNumber, this.mushroomRandom)
    if (expired?.kind === 'held') {
      this.sendMushroomEvent({ kind: 'lost' }, [expired.holderId])
    }
    // Only desktop players (drink-capable) can hold or receive it; bots can too.
    const holderId = maybeSpawnMushroom(
      this.mushrooms,
      handNumber,
      this.getMushroomEligible().filter(candidate => {
        const player = this.getPlayer(candidate.id)
        return Boolean(player && (player.isConnected || candidate.isBot))
      }),
      this.mushroomRandom
    )
    if (holderId) {
      this.sendMushroomEvent({ kind: 'found' }, [holderId])
    }
  }

  /** Seated players who can drink (desktop clients and bots). */
  private getMushroomEligible() {
    return this.data.gameState.players
      .filter(player => this.isDrinkCapable(player))
      .map(player => ({ id: player.id, isBot: this.isBotPlayer(player.id) }))
  }

  /**
   * Keeps the holder's prompt honest: a random pre-selected victim, and a
   * countdown (armed once it isn't their turn) after which the server spikes
   * that victim itself, so a holder who ignores it or disconnects can't stall
   * the mushroom. With nobody eligible it just waits.
   */
  private syncMushroomPrompt() {
    const mushroom = this.mushrooms.mushroom
    if (!mushroom || mushroom.status !== 'held' || !this.isFunModeEnabled()) {
      this.clearBotSpikeTimer()
      return
    }
    const holderIsBot = this.isBotPlayer(mushroom.holderId)
    refreshSuggestedVictim(this.mushrooms, this.getMushroomEligible(), holderIsBot, this.mushroomRandom)
    const delay = holderIsBot
      ? MUSHROOM_BOT_SPIKE_MIN_MS + this.mushroomRandom() * (MUSHROOM_BOT_SPIKE_MAX_MS - MUSHROOM_BOT_SPIKE_MIN_MS)
      : MUSHROOM_AUTO_SPIKE_MS
    const holderIsActing = this.data.gameState.phase === 'in_hand' && this.data.gameState.actingPlayerId === mushroom.holderId
    armAutoSpike(this.mushrooms, Date.now(), delay, holderIsActing)
    if (mushroom.autoSpikeAt === null) {
      this.clearBotSpikeTimer()
      return
    }
    if (this.botSpikeTimer) return
    this.botSpikeTimer = setTimeout(() => {
      this.botSpikeTimer = null
      const due = getDueAutoSpike(this.mushrooms, Date.now())
      if (due && this.isFunModeEnabled()) {
        const result = this.spikeWaterFor(due.holderId, due.victimId)
        if (!result.ok) {
          // The pick became invalid: choose again on the next sync.
          const held = this.mushrooms.mushroom
          if (held?.status === 'held') {
            held.suggestedVictimId = null
            held.autoSpikeAt = null
          }
        }
      }
      this.broadcastState()
    }, Math.max(0, mushroom.autoSpikeAt - Date.now()) + 5)
  }

  private clearBotSpikeTimer() {
    if (this.botSpikeTimer) clearTimeout(this.botSpikeTimer)
    this.botSpikeTimer = null
  }

  private forgetMushroomPlayer(playerId: string) {
    const wasVictim = this.mushrooms.trip?.victimId === playerId
    if (removeMushroomPlayer(this.mushrooms, playerId, this.data.gameState.handNumber, this.mushroomRandom) && wasVictim) {
      this.clearTripTimer()
    }
    for (const key of Array.from(this.spikedWaterKeys)) {
      if (key.startsWith(`${playerId}:`)) this.spikedWaterKeys.delete(key)
    }
  }

  private clearAllMushrooms() {
    clearMushrooms(this.mushrooms, this.data.gameState.handNumber, this.mushroomRandom)
    this.spikedWaterKeys.clear()
    this.clearTripTimer()
    if (this.botSpikeTimer) clearTimeout(this.botSpikeTimer)
    this.botSpikeTimer = null
  }

  /**
   * Development-only shortcuts for capturing effects: only honoured when the
   * socket reached a local dev server (production PartyKit hosts never match).
   */
  private handleDevFun(conn: Connection, action: string, targetId?: string) {
    if (!isLocalDevConnection(conn)) {
      this.sendError(conn, 'Unknown message type')
      return
    }
    const senderId = this.data.connectionToPlayer[conn.id]
    const subjectId = targetId && this.getPlayer(targetId) ? targetId : senderId
    if (!senderId || !subjectId || !this.getPlayer(subjectId)) {
      this.sendActionFailed(conn, 'Take a seat first')
      return
    }
    const handNumber = this.data.gameState.handNumber
    switch (action) {
      case 'mushroom':
        this.clearAllMushrooms()
        giveMushroom(this.mushrooms, subjectId, handNumber)
        this.sendMushroomEvent({ kind: 'found' }, [subjectId])
        break
      case 'trip': {
        this.clearAllMushrooms()
        const spikerId = senderId === subjectId
          ? this.data.gameState.players.find(player => player.id !== subjectId)?.id ?? senderId
          : senderId
        this.mushrooms.trip = {
          victimId: subjectId,
          spikerId,
          spikerNickname: this.getPlayer(spikerId)?.nickname ?? 'Someone',
          queued: true,
          startedAt: null,
          endsAfterHand: null,
          endsAt: null,
        }
        this.syncTrips()
        break
      }
      case 'blackout': {
        const entry = this.drinkLedger[subjectId] ??= this.newSeatedDrinkEntry()
        entry.level = PASS_OUT_LEVEL
        entry.passedOut = true
        entry.passedOutAt = Date.now()
        entry.hungoverThroughHand = null
        entry.pendingWaters = []
        this.handlePassedOut(subjectId)
        break
      }
      default:
        this.applyDevDrinkState(subjectId, action)
    }
    this.sendActionResult(conn)
    this.broadcastState()
  }

  /** Dev: jump straight into a hangover, or to the edge of the sober tax. */
  private applyDevDrinkState(playerId: string, action: string) {
    const entry = this.drinkLedger[playerId] ??= this.newSeatedDrinkEntry()
    if (action === 'hangover') {
      this.clearBlackoutTimers(playerId)
      entry.passedOut = false
      entry.passedOutAt = null
      entry.level = WAKE_UP_LEVEL
      entry.hungoverThroughHand = this.data.gameState.handNumber + 1
    } else if (action === 'sober') {
      entry.level = 0
      entry.hungoverThroughHand = null
      entry.soberHands = Math.max(entry.soberHands, 1)
    }
  }


  private forgetDrinks(playerId: string) {
    this.forgetMushroomPlayer(playerId)
    this.clearWaterTimers(playerId)
    this.clearBlackoutTimers(playerId)

    delete this.drinkLedger[playerId]
  }

  /** Wakes passed-out drinkers when the first hand after the one they slept through starts. */
  /**
   * A hand just started: blackouts that ran their course end, hangovers from
   * two hands ago wear off, queued slow waters land, and sober players pay
   * the sober tax into the pot.
   */
  private wakeRestedDrinkers() {
    const handNumber = this.data.gameState.handNumber
    for (const [playerId, entry] of Object.entries(this.drinkLedger)) {
      if (wakeIfRested(entry, handNumber, Date.now())) {
        this.clearBlackoutTimers(playerId)
        this.broadcastDrinkEvent(playerId, 'woke_up')
      }
      endHangoverIfOver(entry, handNumber)
      if (applyQueuedWaters(entry) > 0) {
        this.broadcastDrinkEvent(playerId, 'water_kicked_in')
      }
    }
    this.postSoberTaxes()
  }

  /** Fun mode on and the client can drink (bots always can). */
  private isBuzzTaxable(player: Pick<InternalPlayer, 'id'>): boolean {
    return this.isFunModeEnabled() && this.isDrinkCapable(player)
  }

  /**
   * Too sober: players who finished their last hand(s) at buzz <= 1 post the
   * sober tax straight into the pot at the deal, like an ante (it counts
   * toward their stake in the pot, and never puts them all-in).
   */
  private postSoberTaxes() {
    if (!BUZZ.soberPenaltiesEnabled) return
    const state = this.data.gameState
    if (state.phase !== 'in_hand') return
    let changed = false
    for (const player of state.players) {
      const entry = this.drinkLedger[player.id]
      if (!entry) continue
      entry.soberTax = null
      if (player.holeCards.length !== 2 || player.status !== 'active' || !this.isBuzzTaxable(player)) continue
      if (entry.passedOut || entry.hungoverThroughHand !== null) continue
      const amount = computeSoberTax({
        soberHands: entry.soberHands,
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        stack: player.stack,
      })
      if (amount <= 0) continue
      player.stack -= amount
      player.totalInPot += amount
      entry.soberTax = { hand: state.handNumber, amount }
      state.recentActions = [...state.recentActions, `💸 ${player.nickname} pays sober tax $${amount}`]
      changed = true
    }
    if (changed) {
      state.totalPot = state.players.reduce((sum, player) => sum + player.totalInPot, 0)
    }
  }

  /**
   * Once per completed hand: everyone sobers up by half a level, and the
   * sober-tax counter moves for dealt-in, drink-capable players.
   */
  private recordDrinkWearOff(handNumber: number) {
    if (handNumber <= this.drinkWearOffHand) {
      return
    }

    this.drinkWearOffHand = handNumber
    for (const player of this.data.gameState.players) {
      if (this.isBuzzTaxable(player)) this.drinkLedger[player.id] ??= this.newSeatedDrinkEntry()
    }
    for (const [playerId, entry] of Object.entries(this.drinkLedger)) {
      const player = this.getPlayer(playerId)
      applyDrinkHandCompleted(entry, {
        dealtIn: Boolean(player && player.holeCards.length === 2),
        taxable: Boolean(player && this.isBuzzTaxable(player)),
      })
    }
  }

  private broadcastDrinkEvent(playerId: string, kind: DrinkEventKind, amount?: number) {
    const entry = this.drinkLedger[playerId]
    const event: DrinkEvent = {
      id: generateId(12),
      kind,
      playerId,
      nickname: this.getPlayer(playerId)?.nickname ?? this.data.playerNicknames[playerId] ?? 'Player',
      level: entry?.level ?? 0,
      beers: entry?.beers ?? 0,
      at: Date.now(),
      ...(amount !== undefined ? { amount } : {}),
    }

    for (const conn of Array.from(this.room.getConnections())) {
      this.sendMessage(conn, { type: 'drink_event', event })
    }
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
      // Out of turn too: nobody should wait on a player who already left.
      this.foldDepartingPlayer(playerId)

      const remainingPlayer = this.getPlayer(playerId)
      if (remainingPlayer) {
        remainingPlayer.isConnected = false
      }
    } else {
      this.recordDepartedStack(player)
      this.removePlayerFromTable(playerId)
    }

    this.finalizeState()
    this.syncActionTimer(wasActingPlayer)
  }

  /**
   * Fold a player who is leaving the hand right now, on turn or not, and
   * settle a run-it-twice vote they can no longer answer (one board).
   */
  private foldDepartingPlayer(playerId: string) {
    if (this.data.gameState.phase !== 'in_hand') {
      return
    }

    const player = this.getPlayer(playerId)
    if (player?.status === 'active') {
      try {
        if (this.data.gameState.actingPlayerId === playerId) {
          this.clearAutoFold()
        }
        this.data.gameState = foldLeavingPlayer(this.data.gameState, playerId)
        this.recordFold(playerId)
        this.recordCompletedHandStats()
      } catch {
        // Ignore impossible forced-fold transitions.
      }
    }

    const runItTwice = this.data.gameState.runItTwice
    if (
      runItTwice?.status === 'voting' &&
      runItTwice.eligiblePlayerIds.includes(playerId) &&
      !runItTwice.votes[playerId]
    ) {
      try {
        this.data.gameState = resolveRunItTwiceDecision(this.data.gameState, false)
        this.recordCompletedHandStats()
      } catch {
        // The vote already resolved.
      }
    }

    this.syncActingPlayerIndex()
  }

  /** Remember what a departing human carried out so rejoining restores it. */
  private recordDepartedStack(player: Pick<InternalPlayer, 'id' | 'nickname' | 'stack' | 'isBot'>) {
    if (player.isBot || this.isBotPlayer(player.id)) {
      // A bot never comes back: its chips leave with it, on the books.
      const account = this.data.ledger.accounts[`bot:${player.id}`]
      if (account) {
        account.cashedOut += Math.max(0, player.stack)
      }
      return
    }
    this.data.membership.departedStacks[normalizePlayerUsername(player.nickname)] = Math.max(0, player.stack)
  }

  /**
   * Seat order is by seatIndex, so anyone inserted or removed mid-hand shifts
   * array positions; keep the engine's acting index pointing at the actor.
   */
  private syncActingPlayerIndex() {
    const state = this.data.gameState
    if (!state.actingPlayerId) {
      return
    }
    const index = state.players.findIndex(player => player.id === state.actingPlayerId)
    if (index >= 0) {
      state.actingPlayerIndex = index
    }
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

    const nickname = this.data.playerNicknames[playerId]
    const spectatorStack = this.data.spectatorStacks[playerId]
    if (nickname && !this.getPlayer(playerId) && spectatorStack !== undefined) {
      this.recordDepartedStack({ id: playerId, nickname, stack: spectatorStack })
    }

    delete this.data.playerToConnection[playerId]
    delete this.data.reconnectTokens[playerId]
    delete this.data.playerNicknames[playerId]
    delete this.data.spectatorIds[playerId]
    delete this.data.spectatorStacks[playerId]
    delete this.data.pendingSpectators[playerId]
    delete this.data.membership.joinedAt[playerId]
    delete this.data.membership.awayIds[playerId]
    delete this.data.membership.missedHands[playerId]
    for (const [key, request] of Object.entries(this.data.cardRevealRequests)) {
      if (request.requesterId === playerId) {
        delete this.data.cardRevealRequests[key]
      }
    }
    this.clearPlayerSocialState(playerId)
    this.forgetDrinks(playerId)

    if (this.data.hostId === playerId) {
      this.cancelDisconnectedHostTransfer(playerId)
      this.assignHost(this.selectNextHost(playerId))
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
      // Before busted players are swept to the rail, so a queued rebuy keeps its seat.
      this.applyQueuedRebuys()
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

      if (isPostHandRevealWindow) {
        this.scheduleRevealSettle()
      } else {
        this.applyAwayStatuses()
      }
    } else {
      this.syncActingPlayerIndex()
    }

    if (
      this.data.hostId &&
      (!this.data.playerNicknames[this.data.hostId] || this.isBotPlayer(this.data.hostId))
    ) {
      this.assignHost(this.selectNextHost(this.data.hostId))
    } else if (!this.data.hostId) {
      const nextHostId = this.selectNextHost()
      if (nextHostId) {
        this.assignHost(nextHostId)
      }
    }

    this.syncAutoStart()
  }

  /**
   * Departing, benched and busted players stay in their chairs through the
   * showdown reveal. If no next hand comes along to clear them (the table is
   * down to one player), clear them once the reveal is over so nobody lingers
   * as a ghost seat.
   */
  private scheduleRevealSettle() {
    const hasSomethingToSettle = (
      Object.keys(this.data.pendingRemovals).length > 0 ||
      Object.keys(this.data.pendingSpectators).length > 0 ||
      this.data.gameState.players.some(player => player.stack <= 0)
    )
    if (!hasSomethingToSettle || this.revealSettleTimeout) {
      return
    }

    const handNumber = this.data.gameState.handNumber
    this.revealSettleTimeout = setTimeout(() => {
      this.revealSettleTimeout = null
      if (this.data.gameState.phase === 'in_hand' || this.data.gameState.handNumber !== handNumber) {
        return
      }
      this.flushPendingRemovals()
      this.flushPendingSpectators()
      this.moveZeroStackPlayersToSpectators()
      this.broadcastState()
    }, this.getAutoStartDelayMs() + 250)
  }

  private assignHost(nextHostId: string | null) {
    const previousHostId = this.data.hostId
    this.data.hostId = nextHostId
    if (nextHostId && nextHostId !== previousHostId) {
      const nickname = this.data.playerNicknames[nextHostId] ?? 'A player'
      this.broadcastNotice({
        kind: 'host_changed',
        playerId: nextHostId,
        message: `${nickname} is now the host`,
      })
    }
  }

  /** Mark a player as here: any real action clears their missed-hand streak. */
  private markPlayerPresent(playerId: string) {
    this.data.membership.actedThisHand[playerId] = true
    delete this.data.membership.missedHands[playerId]
  }

  /** Away players keep their seat and chips but are not dealt in. */
  private applyAwayStatuses() {
    const away = this.data.membership.awayIds
    for (const player of this.data.gameState.players) {
      if (away[player.id] && player.isConnected && player.stack > 0) {
        player.status = 'sitting_out'
      }
    }
  }

  /**
   * Run right before a deal: a human who timed out of the last hand without
   * acting, or who is disconnected for this deal, has missed a hand. Two in a
   * row and they sit out until they tap "I'm back".
   */
  private updateMissedHands() {
    const membership = this.data.membership
    // A failed or retried deal must not count the same hand twice.
    const upcomingHand = this.data.gameState.handNumber + 1
    if (membership.countedForHand === upcomingHand) {
      this.applyAwayStatuses()
      return
    }
    membership.countedForHand = upcomingHand
    const seated = new Map(this.data.gameState.players.map(player => [player.id, player]))
    const missedNow = new Set<string>()

    for (const playerId of membership.dealtIn) {
      if (!seated.has(playerId) || membership.actedThisHand[playerId]) continue
      if (membership.timedOutThisHand[playerId]) missedNow.add(playerId)
    }
    for (const player of this.data.gameState.players) {
      if (
        !player.isBot &&
        !this.isBotPlayer(player.id) &&
        player.stack > 0 &&
        !membership.awayIds[player.id] &&
        (!player.isConnected || player.status === 'disconnected')
      ) {
        missedNow.add(player.id)
      }
    }

    for (const playerId of missedNow) {
      const missed = (membership.missedHands[playerId] ?? 0) + 1
      membership.missedHands[playerId] = missed
      if (missed >= MISSED_HANDS_BEFORE_SIT_OUT && !membership.awayIds[playerId]) {
        membership.awayIds[playerId] = true
        const player = seated.get(playerId)
        if (player?.isConnected) {
          player.status = 'sitting_out'
        }
      }
    }

    membership.timedOutThisHand = {}
    membership.actedThisHand = {}
    this.applyAwayStatuses()
  }

  /** Call after startHand: remember who was dealt in for the missed-hand check. */
  private recordDealtIn() {
    this.data.membership.dealtIn = this.data.gameState.players
      .filter(player => player.holeCards.length === 2)
      .map(player => player.id)
    // House rules measure losses against what each player started the hand with
    // (blinds already posted count as still theirs).
    this.handStartStacks = new Map(this.data.gameState.players
      .filter(player => player.holeCards.length === 2)
      .map(player => [player.id, player.stack + player.totalInPot]))
  }

  private handleSetSittingOut(conn: Connection, sittingOut: boolean) {
    const playerId = this.data.connectionToPlayer[conn.id]
    const player = playerId ? this.getPlayer(playerId) : undefined
    if (!playerId || !player) {
      this.sendActionFailed(conn, 'Take a seat first')
      return
    }

    const membership = this.data.membership
    const dealtIntoLiveHand = this.data.gameState.phase === 'in_hand' && player.holeCards.length === 2
    if (sittingOut) {
      membership.awayIds[playerId] = true
      if (!dealtIntoLiveHand && player.stack > 0) {
        player.status = 'sitting_out'
      }
      this.sendActionResult(conn, dealtIntoLiveHand ? 'You will sit out from the next hand.' : 'You are sitting out.')
    } else {
      delete membership.awayIds[playerId]
      delete membership.missedHands[playerId]
      membership.actedThisHand[playerId] = true
      if (!dealtIntoLiveHand && player.status === 'sitting_out' && player.stack > 0) {
        player.status = 'waiting'
      }
      this.sendActionResult(conn, 'Welcome back. You are dealt in next hand.')
    }

    this.finalizeState()
    this.broadcastState()
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
    for (const player of this.data.gameState.players) {
      if (pendingSet.has(player.id)) {
        this.recordDepartedStack(player)
      }
    }
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

  /**
   * The next host is a connected human: seated before spectating, then
   * whoever has been at the table longest. Never a bot, never someone
   * offline; with nobody eligible the room has no host until a human returns.
   */
  private selectNextHost(excludedPlayerId?: string): string | null {
    const seatedIds = new Set(
      this.data.gameState.players
        .filter(player => !this.data.pendingSpectators[player.id])
        .map(player => player.id)
    )
    const joinedAt = (playerId: string) => this.data.membership.joinedAt[playerId] ?? Number.MAX_SAFE_INTEGER
    const candidates = Object.keys(this.data.playerNicknames).filter(playerId => (
      playerId !== excludedPlayerId &&
      !this.isBotPlayer(playerId) &&
      !this.data.pendingRemovals[playerId] &&
      Boolean(this.data.playerToConnection[playerId])
    ))

    candidates.sort((a, b) => (
      Number(seatedIds.has(b)) - Number(seatedIds.has(a)) ||
      joinedAt(a) - joinedAt(b)
    ))

    return candidates[0] ?? null
  }

  private scheduleDisconnectedHostTransfer(playerId: string) {
    this.cancelDisconnectedHostTransfer()
    this.disconnectedHostId = playerId
    this.hostTransferTimeout = setTimeout(() => {
      this.hostTransferTimeout = null
      this.disconnectedHostId = null

      if (this.data.hostId !== playerId || this.data.playerToConnection[playerId]) {
        return
      }

      this.assignHost(this.selectNextHost(playerId))
      this.finalizeState()
      this.broadcastState()
    }, HOST_DISCONNECT_GRACE_MS)
  }

  private cancelDisconnectedHostTransfer(playerId?: string) {
    if (playerId && this.disconnectedHostId !== playerId) {
      return
    }

    if (this.hostTransferTimeout) {
      clearTimeout(this.hostTransferTimeout)
    }
    this.hostTransferTimeout = null
    this.disconnectedHostId = null
  }

  private buildSnapshotFor(connId: string): Extract<S2CMessage, { type: 'room_snapshot' }> {
    const playerId = this.data.connectionToPlayer[connId] ?? ''
    const isSpectatorViewer = Boolean(
      playerId && (this.data.spectatorIds[playerId] || this.data.pendingSpectators[playerId])
    )
    // A spectator is never live in this hand; the extra check is a guard so a
    // half-moved player can never see opponents' cards while holding their own.
    const viewerSeat = playerId ? this.getPlayer(playerId) : undefined
    const viewerIsLiveInHand = Boolean(
      viewerSeat &&
      viewerSeat.holeCards.length > 0 &&
      (viewerSeat.status === 'active' || viewerSeat.status === 'all_in')
    )
    const spectatorCanSeeLiveHands = (
      isSpectatorViewer &&
      !viewerIsLiveInHand &&
      this.data.gameState.phase === 'in_hand'
    )
    const bettingClosed = isBettingClosed(this.data.gameState)
    const isCardRevealWindow = this.data.gameState.phase === 'in_hand' || (
      this.data.gameState.phase === 'between_hands' && Boolean(this.data.gameState.winners?.length)
    )
    const currentCardRevealRequests = isCardRevealWindow
      ? Object.values(this.data.cardRevealRequests).filter(request => (
          request.handNumber === this.data.gameState.handNumber &&
          (request.requesterId === playerId || request.targetId === playerId)
        ))
      : []
    const permittedHoleCardPlayerIds = spectatorCanSeeLiveHands
      ? this.data.gameState.players.map(player => player.id)
      : currentCardRevealRequests
          .filter(request => request.requesterId === playerId && request.status === 'approved')
          .map(request => request.targetId)
    // Broadcast odds: everyone once the all-in is tabled, spectators always.
    // The odds are cached per (board, hands, pots), so every viewer of the
    // same street shares one computation.
    const publicState = withVisibleHandOdds(
      toTableState(this.data.gameState, playerId, { permittedHoleCardPlayerIds }),
      { oddsMode: bettingClosed ? 'all_in' : spectatorCanSeeLiveHands ? 'spectator' : undefined }
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
        handHistory: this.data.handHistory ?? [],
        funModeEnabled: this.isFunModeEnabled(),
        companion: this.isFunModeEnabled()
          ? getVisibleLadyLuck(this.data.ladyLuck, this.getSeatedPlayerIds())
          : null,
        ledger: this.buildLedgerSnapshot(),
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
        const isBot = seatedPlayer?.isBot ?? id.startsWith('bot_')
        // Bots have no socket: benched ones are not "away".
        const isConnected = isBot || Boolean(
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
          isBot,
          isSeated,
          isSpectator,
          ...(this.data.membership.awayIds[id] ? { isAway: true } : {}),
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
      ...(this.isFunModeEnabled() && getPrivateMushroomState(this.mushrooms, playerId)
        ? { mushroom: getPrivateMushroomState(this.mushrooms, playerId)! }
        : {}),
    }
  }

  private withPublicPlayerMetadata(player: SeatPlayer): SeatPlayer {
    return {
      ...player,
      avatar: this.data.playerProfiles[player.id]?.avatar,
      venmoUsername: this.data.playerProfiles[player.id]?.venmoUsername,
      stats: this.getPublicStats(player.id),
      drinkCapable: this.isDrinkCapable(player),
      ...(this.isFunModeEnabled() && getPublicTrip(this.mushrooms, player.id)
        ? { trip: getPublicTrip(this.mushrooms, player.id)! }
        : {}),
      drinks: {
        ...toPublicDrinkState(this.drinkLedger[player.id] ?? (this.isBotPlayer(player.id) ? undefined : this.newSeatedDrinkEntry())),
        shotsWaiting: this.shotQueue.filter(shot => shot.targetId === player.id).length,
      },
      ...(this.isPlayerPeeking(player.id) ? { isPeeking: true } : {}),
      ...(this.data.membership.awayIds[player.id] ? { isAway: true } : {}),
    }
  }

  /** Only a live hand's dealt-in, not-folded player can be seen peeking. */
  private canPeek(playerId: string): boolean {
    const state = this.data.gameState
    const player = this.getPlayer(playerId)
    return Boolean(
      state.phase === 'in_hand' &&
      player &&
      player.holeCards.length === 2 &&
      (player.status === 'active' || player.status === 'all_in')
    )
  }

  private isPlayerPeeking(playerId: string): boolean {
    const peek = this.peekingByPlayer.get(playerId)
    return Boolean(peek && peek.handNumber === this.data.gameState.handNumber && this.canPeek(playerId))
  }

  private handlePeekCards(conn: Connection, peeking: boolean) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId || !this.getPlayer(playerId)) {
      return
    }

    const now = Date.now()
    const recent = (this.peekRateByPlayer.get(playerId) ?? []).filter(at => now - at < PEEK_RATE_WINDOW_MS)
    if (recent.length >= PEEK_RATE_MAX_CHANGES) {
      this.peekRateByPlayer.set(playerId, recent)
      // Over the limit: still honour "stop peeking" so nobody gets stuck looking.
      if (peeking || !this.peekingByPlayer.has(playerId)) {
        return
      }
    }
    recent.push(now)
    this.peekRateByPlayer.set(playerId, recent)

    if (this.setPeeking(playerId, peeking)) {
      this.broadcastState()
    }
  }

  /** Returns true when the public peek state changed. */
  private setPeeking(playerId: string, peeking: boolean, durationMs = PEEK_MAX_DURATION_MS): boolean {
    const wasPeeking = this.isPlayerPeeking(playerId)
    const existing = this.peekingByPlayer.get(playerId)
    if (existing) {
      clearTimeout(existing.timer)
      this.peekingByPlayer.delete(playerId)
    }

    if (!peeking || !this.canPeek(playerId)) {
      return wasPeeking
    }

    const handNumber = this.data.gameState.handNumber
    const timer = setTimeout(() => {
      const current = this.peekingByPlayer.get(playerId)
      if (current?.timer !== timer) return
      this.peekingByPlayer.delete(playerId)
      if (current.handNumber === this.data.gameState.handNumber && this.canPeek(playerId)) this.broadcastState()
    }, durationMs)
    this.peekingByPlayer.set(playerId, { handNumber, timer })
    return !wasPeeking
  }

  /** Bots glance at their cards right after the deal so the 3D peek animation shows up at bot tables. */
  private scheduleBotPeeks() {
    for (const timer of this.botPeekTimers) clearTimeout(timer)
    this.botPeekTimers.clear()
    for (const player of this.data.gameState.players) {
      if (!this.isBotPlayer(player.id) || this.botPeekRandom() > 0.75) continue
      this.scheduleBotPeek(player.id, 500 + this.botPeekRandom() * 2600, 1300 + this.botPeekRandom() * 1100)
    }
  }

  private scheduleBotPeek(playerId: string, delayMs: number, durationMs: number) {
    const handNumber = this.data.gameState.handNumber
    const timer = setTimeout(() => {
      this.botPeekTimers.delete(timer)
      if (this.data.gameState.handNumber !== handNumber) return
      if (this.setPeeking(playerId, true, durationMs)) this.broadcastState()
    }, delayMs)
    this.botPeekTimers.add(timer)
  }

  private ensureStats(statsKey: string): TrackedPlayerStats {
    const normalizedKey = statsKey.startsWith('bot:')
      ? statsKey
      : normalizePlayerUsername(statsKey)
    this.data.statsByUsername[normalizedKey] ??= {
      handsPlayed: 0,
      folds: 0,
      wins: 0,
      totalWon: 0,
    }

    return this.data.statsByUsername[normalizedKey]!
  }

  private getPlayerStatsKey(playerId: string): string | undefined {
    if (this.isBotPlayer(playerId)) {
      return `bot:${playerId}`
    }

    return this.data.playerNicknames[playerId]
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

    this.data.ladyLuck = advanceLadyLuckForNewHand(
      this.data.ladyLuck,
      handNumber,
      this.getSeatedPlayerIds(),
      Date.now()
    )

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
    this.recordLadyLuckOutcome()
    this.recordDrinkWearOff(handNumber)
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
    this.maybeScheduleBotShot(winnerAmounts)
    this.applyHouseRules(winnerAmounts)

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
    this.recordHandHistory()
  }

  /**
   * Keeps a short public log of completed hands. `refreshOnly` updates the
   * current hand's entry (e.g. someone chose to show) without adding one.
   */
  private recordHandHistory(refreshOnly = false) {
    const state = this.data.gameState
    if (state.phase !== 'between_hands' || !state.winners?.length) {
      return
    }

    const history = this.data.handHistory ?? []
    if (refreshOnly && !history.some(entry => entry.handNumber === state.handNumber)) {
      return
    }

    const previous = history.find(entry => entry.handNumber === state.handNumber)
    const entry = buildHandHistoryEntry(toTableState(state, ''), previous?.endedAt ?? Date.now())
    if (!entry) {
      return
    }

    if (previous) {
      // The board and winners are fixed when the hand ends; only shown hands can change.
      entry.board = previous.board
      entry.shown = mergeShownHands(previous.shown, entry.shown)
    }

    const soberTax = Object.entries(this.drinkLedger)
      .filter(([, drinks]) => drinks.soberTax?.hand === state.handNumber)
      .map(([playerId, drinks]) => ({
        playerId,
        nickname: this.getPlayer(playerId)?.nickname ?? this.data.playerNicknames[playerId] ?? 'Player',
        amount: drinks.soberTax!.amount,
      }))
    if (soberTax.length > 0) entry.soberTax = soberTax
    else if (previous?.soberTax) entry.soberTax = previous.soberTax

    this.data.handHistory = upsertHandHistory(history, entry)
  }

  private getSeatedPlayerIds(): Set<string> {
    return new Set(
      this.data.gameState.players
        .filter(player => !this.data.spectatorIds[player.id] && !this.data.pendingRemovals[player.id])
        .map(player => player.id)
    )
  }

  /** Only Lady Luck's current owner may tell her to shut up; anyone else is ignored. */
  private handleCompanionMute(conn: Connection) {
    const playerId = this.data.connectionToPlayer[conn.id]
    if (!playerId) {
      return
    }
    const next = muteLadyLuck(this.data.ladyLuck, playerId)
    if (next === this.data.ladyLuck) {
      return
    }
    this.data.ladyLuck = next
    this.broadcastState()
  }

  /** Cosmetic only: feeds the finished hand to the Lady Luck companion rules. */
  private recordLadyLuckOutcome() {
    const state = this.data.gameState
    if (!state.winners?.length || !this.isFunModeEnabled()) {
      return
    }

    this.data.ladyLuck = applyLadyLuckHandOutcome(this.data.ladyLuck, {
      handNumber: state.handNumber,
      now: Date.now(),
      winners: state.winners,
      players: state.players.map(player => ({
        id: player.id,
        dealtIn: player.holeCards.length === 2,
      })),
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
    this.syncAllInRunout()
    this.deliverQueuedShots()
    this.syncPendingBlackouts()
    this.syncAutoBeerTimer()
    this.syncTrips()
    this.syncMushroomPrompt()
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
      // The clock ran out: count toward sitting them out if it keeps happening.
      this.data.membership.timedOutThisHand[playerId] = true
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
    // Now and then a bot re-checks its cards while "thinking".
    if (this.botPeekRandom() < 0.3 && !this.isPlayerPeeking(playerId)) {
      this.scheduleBotPeek(playerId, 80, BOT_ACTION_DELAY - 250)
    }

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

  /** Keep one timer armed for the next street of a paced all-in runout. */
  private syncAllInRunout() {
    const state = this.data.gameState
    const runout = state.phase === 'in_hand' ? state.allInRunout : undefined
    if (!runout) {
      this.clearAllInRunoutTimeout()
      return
    }

    if (this.allInRunoutTimeout && this.allInRunoutDeadline === runout.nextStreetAt) {
      return
    }

    this.clearAllInRunoutTimeout()
    this.allInRunoutDeadline = runout.nextStreetAt
    void this.room.storage.setAlarm(runout.nextStreetAt)
    this.allInRunoutTimeout = setTimeout(() => {
      this.allInRunoutTimeout = null
      this.allInRunoutDeadline = null
      this.dealNextAllInStreet()
    }, Math.max(0, runout.nextStreetAt - Date.now()))
  }

  private dealNextAllInStreet() {
    const state = this.data.gameState
    if (state.phase !== 'in_hand' || !state.allInRunout) {
      return
    }

    try {
      this.data.gameState = advanceAllInRunout(state)
      this.recordCompletedHandStats()
      this.finalizeState()
      this.syncActionTimer()
      this.broadcastState()
    } catch {
      this.finalizeState()
    }
  }

  private clearAllInRunoutTimeout() {
    if (this.allInRunoutTimeout) {
      clearTimeout(this.allInRunoutTimeout)
    }

    this.allInRunoutTimeout = null
    this.allInRunoutDeadline = null
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

    // The creator must explicitly start the game. Auto-deal only owns the
    // transition between hands after hand #1 has begun.
    if (this.data.gameState.handNumber <= 0) {
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
        this.updateMissedHands()
        if (!this.shouldAutoStartNow()) {
          this.broadcastState()
          return
        }
        this.data.cardRevealRequests = {}
        this.data.gameState = startHand({ ...this.data.gameState, pacedRunout: this.allInRunoutPacing })
        this.recordDealtIn()
        this.recordHandsPlayedForCurrentHand()
        this.wakeRestedDrinkers()
        this.advanceMushroomsForNewHand()
        this.scheduleBotDrinks()
        this.scheduleBotPeeks()
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

    // Run it twice is the long cinematic: play both runouts, then give the
    // table the full configured pause (showdownAt is when both accepted).
    if (state.runItTwice?.status === 'accepted') {
      return Math.max(0, presentationDuration + configuredDelay - elapsed)
    }

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
    const runItTwice = this.data.gameState.runItTwice
    return getShowdownMinimumDurationMs(this.getShowdownParticipantCount(), {
      runItTwiceSharedCardCount: runItTwice?.status === 'accepted'
        ? runItTwice.sharedCardCount ?? 0
        : null,
    })
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
