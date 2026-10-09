import type { PlayerAvatarCustomization } from '../profile'
import type { PlayerDrinkState } from '../drinks'
import type { LedgerSnapshot } from './ledger'

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export type HandRank =
  | 'high_card'
  | 'pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush'
  | 'royal_flush'

export interface HandResult {
  rank: HandRank
  rankIndex: number    // 0-9, higher = better
  tiebreakers: number[] // for comparing same-rank hands
  cards: Card[]        // best 5 cards
  description: string
}

export type ShowCardsMode = 'none' | 'left' | 'right' | 'both'

export type CardRevealRequestStatus = 'pending' | 'approved' | 'denied'

export interface CardRevealRequest {
  requesterId: string
  targetId: string
  handNumber: number
  status: CardRevealRequestStatus
}

export type PlayerStatus = 'waiting' | 'active' | 'folded' | 'all_in' | 'sitting_out' | 'disconnected'
export type BettingRound = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
export type GamePhase = 'waiting' | 'in_hand' | 'between_hands'

export interface BountyMetadata {
  active: boolean
  amount: number
  percentage: number
  contributors: string[]
  recipientPlayerIds: string[]
  reason: string
}

export interface PlayerStats {
  handsPlayed: number
  folds: number
  wins: number
  totalWon: number
  foldRate: number
}

export interface SeatPlayer {
  id: string
  nickname: string
  avatar?: PlayerAvatarCustomization
  isBot?: boolean
  venmoUsername?: string
  stats?: PlayerStats
  stack: number
  bet: number          // current bet this round
  totalInPot: number   // total committed this hand
  status: PlayerStatus
  isDealer: boolean
  isSB: boolean
  isBB: boolean
  holeCards?: Card[]   // populated when this player's cards are visible to the viewer
  hasCards: boolean    // true if player has cards (for showing card backs)
  showCards: ShowCardsMode
  isConnected: boolean
  lastAction?: string
  lastActionId?: string
  seatIndex: number    // 0-7
  hasActedThisRound: boolean
  equityPercent?: number
  /** Public drink state (beers, drunk level, pass-out). Absent means sober. */
  drinks?: PlayerDrinkState
  /** True while the player is privately looking at their own hole cards. Never carries card values. */
  isPeeking?: boolean
  /** Sitting out (missed hands or chose to): keeps seat and chips, not dealt in. */
  isAway?: boolean
  /**
   * The player's client has drink controls (the desktop 3D table). Phones and
   * the touch 2D layout can't drink, so they can't be bought shots. Bots: true.
   */
  drinkCapable?: boolean
  /** On a mushroom trip (only once it has kicked in; a queued trip is secret). Visual only. */
  trip?: { startedAt: number; endsAfterHand: number }
  /** A sticky note someone stuck on this player's forehead for the rest of the hand. Public. */
  stickyNote?: { text: string; fromId: string; fromNickname: string; at: number }
}

export interface Pot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface HandWinner {
  playerId: string
  amount: number
  handDescription?: string
  winningCards?: Card[]
  venmoUsername?: string
}

export type RunItTwiceVote = 'yes' | 'no'

export interface RunItTwiceBoard {
  cards: Card[]
  winners: HandWinner[]
}

export interface RunItTwiceState {
  status: 'voting' | 'declined' | 'accepted'
  eligiblePlayerIds: string[]
  votes: Record<string, RunItTwiceVote>
  sharedCardCount?: number
  expiresAt?: number
  startedAt?: number
  boards?: RunItTwiceBoard[]
}

export interface LobbyPlayer {
  id: string
  nickname: string
  avatar?: PlayerAvatarCustomization
  venmoUsername?: string
  stats?: PlayerStats
  stack: number
  status: PlayerStatus | 'spectating'
  isConnected: boolean
  isBot?: boolean
  isSeated: boolean
  isSpectator: boolean
  /** Sitting out until they say they are back. */
  isAway?: boolean
}

/** Public summary of a completed hand for the "Last hands" view. */
export interface HandHistoryEntry {
  handNumber: number
  endedAt: number
  endedBy: 'showdown' | 'fold'
  pot: number
  /** The board that was actually played (never rabbit-hunt cards). */
  board: Card[]
  /** Both runouts when the hand was run twice. */
  boards?: Card[][]
  winners: Array<{ playerId: string; nickname: string; amount: number; handDescription?: string }>
  /** Hands the whole table saw (showdown or chosen to show). */
  shown: Array<{ playerId: string; nickname: string; cards: Card[] }>
  /** Sober tax posted into this pot at the deal (drinking game). */
  soberTax?: Array<{ playerId: string; nickname: string; amount: number }>
  /** How every dealt-in player's hand ended, so disputes can be settled. */
  outcomes?: HandOutcome[]
}

/** Why a player's hand ended before the showdown. */
export type HandExitReason =
  /** They pressed fold (or a queued pre-action did). */
  | 'fold'
  /** Their clock ran out facing a bet. */
  | 'timeout'
  /** They left the table mid-hand. */
  | 'left'
  /** The host kicked them. */
  | 'kicked'
  /** The host moved them to the rail mid-hand. */
  | 'moved_to_rail'

export interface HandOutcome {
  playerId: string
  nickname: string
  result: 'won' | 'lost' | 'folded'
  /** won / lost: decided at a showdown, or uncontested after everyone else folded. */
  via?: 'showdown' | 'uncontested'
  /** folded: why, and on which street. */
  reason?: HandExitReason
  street?: BettingRound
  /** Chips this player put in the pot this hand. */
  stake: number
  /** won: chips taken from the pot. */
  amount?: number
  /** Showdown hands (public at a showdown; omitted when the hand was run twice). */
  handDescription?: string
  /** Their connection was down when their hand ended. */
  disconnected?: boolean
  /** They had asked to sit out (or were marked away) when their hand ended. */
  away?: boolean
  /** Times the clock ran out with a free check this hand (checked for them, not folded). */
  timedOutChecks?: number
}

export interface TableSettingsSnapshot {
  smallBlind: number
  bigBlind: number
  startingStack: number
  actionTimerDuration: number
  autoStartDelay: number
  rabbitHuntingEnabled: boolean
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
}

export interface TableState {
  roomCode: string
  phase: GamePhase
  serverNow: number
  /**
   * Who this snapshot was built for ('' before the connection has joined). A
   * reconnecting client ignores the anonymous one so its own hole cards never
   * blink out for a round trip.
   */
  viewerId?: string
  autoStartEnabled?: boolean
  autoStartDelay?: number
  round: BettingRound | null
  players: SeatPlayer[]
  communityCards: Card[]
  /** Rabbit-hunt cards after a fold-ended hand: never played, never in hand labels. */
  rabbitCards?: Card[]
  pots: Pot[]
  totalPot: number
  currentBet: number
  minRaise: number
  actingPlayerId: string | null
  dealerSeatIndex: number
  smallBlind: number
  bigBlind: number
  startingStack: number
  actionTimerStart: number | null
  actionTimerDuration: number
  rabbitHuntingEnabled: boolean
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
  pendingTableSettings?: TableSettingsSnapshot
  handNumber: number
  actionSequence?: number
  showdownAt?: number
  runItTwice?: RunItTwiceState
  /** Betting is closed and the board is being dealt street by street (all-in runout). */
  allInRunout?: AllInRunoutState
  /**
   * Broadcast-style win odds for the live hands this viewer may see: everyone
   * once action is closed at an all-in, spectators on every street.
   */
  handOdds?: HandOddsSnapshot
  cardRevealRequests?: CardRevealRequest[]
  recentActions: string[]
  lobbyPlayers: LobbyPlayer[]
  winners?: HandWinner[]
  bounty?: BountyMetadata
  /** Last completed hands, newest first. */
  handHistory?: HandHistoryEntry[]
  /** Drinks and Lady Luck; absent means on. */
  funModeEnabled?: boolean
  /** Blind schedule id (lib/poker/blindSchedule); blinds double between hands. */
  blindSchedule?: import('./blindSchedule').BlindScheduleId
  /** When the next blind raise is due (ms epoch), or null when off. */
  nextBlindsUpAt?: number | null
  /** "Lady Luck" win-streak companion; null/absent when nobody is hot. */
  companion?: LadyLuckCompanionState | null
  /** Buy-ins, rebuys, host adjustments and the settle-up for the night. */
  ledger?: LedgerSnapshot
}

export type LadyLuckReason = 'big_win' | 'streak'
export type LadyLuckMood = 'arrive' | 'flirt' | 'cheer' | 'sulk_leave'

export interface LadyLuckCompanionState {
  /** Changes each time she (re)appears so renderers can replay an entrance. */
  id: string
  ownerId: string
  reason: LadyLuckReason
  streak: number
  mood: LadyLuckMood
  /** Server ms timestamp of the last mood change. */
  since: number
  /** Her owner told her to shut up: no speech until she leaves. */
  muted: boolean
}

// Internal game state used by the engine (includes full hole cards for all players)
export interface InternalPlayer extends Omit<SeatPlayer, 'holeCards' | 'hasCards'> {
  holeCards: Card[]
  hasActedThisRound: boolean
}

export interface InternalGameState {
  roomCode: string
  phase: GamePhase
  round: BettingRound | null
  players: InternalPlayer[]
  deck: Card[]
  communityCards: Card[]
  /** Streets a rabbit hunt showed after the hand ended; kept off the real board. */
  rabbitCards?: Card[]
  pots: Pot[]
  totalPot: number
  currentBet: number
  lastRaiseSize: number
  minRaise: number
  actingPlayerId: string | null
  actingPlayerIndex: number
  dealerSeatIndex: number
  smallBlind: number
  bigBlind: number
  startingStack: number
  actionTimerStart: number | null
  actionTimerDuration: number
  rabbitHuntingEnabled: boolean
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
  handNumber: number
  actionSequence?: number
  showdownAt?: number
  runItTwice?: RunItTwiceState
  /**
   * The room deals an all-in runout one street at a time (TV style) instead of
   * all at once. Off by default so engine callers keep the instant runout.
   */
  pacedRunout?: boolean
  allInRunout?: AllInRunoutState
  recentActions: string[]
  winners?: HandWinner[]
  bounty?: BountyMetadata
}

export interface AllInRunoutState {
  /** Server ms timestamp when the next street (or the showdown) is dealt. */
  nextStreetAt: number
}

export type HandOddsMode = 'all_in' | 'spectator'

export interface HandOddsPlayer {
  playerId: string
  /** Chance to win the whole hand outright (ties excluded), 0-100. */
  winPercent: number
  /** Chance to split the best hand, 0-100. */
  tiePercent: number
}

export interface HandOddsSnapshot {
  mode: HandOddsMode
  handNumber: number
  /** Board cards the odds were computed for (0, 3, 4 or 5). */
  boardCount: number
  /** True when the figures come from enumerating every runout. */
  exact: boolean
  players: HandOddsPlayer[]
}
