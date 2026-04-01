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

export interface SeatPlayer {
  id: string
  nickname: string
  isBot?: boolean
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
  seatIndex: number    // 0-7
  hasActedThisRound: boolean
  equityPercent?: number
}

export interface Pot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface LobbyPlayer {
  id: string
  nickname: string
  stack: number
  status: PlayerStatus | 'spectating'
  isConnected: boolean
  isBot?: boolean
  isSeated: boolean
  isSpectator: boolean
}

export interface TableState {
  roomCode: string
  phase: GamePhase
  autoStartEnabled?: boolean
  autoStartDelay?: number
  round: BettingRound | null
  players: SeatPlayer[]
  communityCards: Card[]
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
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
  handNumber: number
  recentActions: string[]
  lobbyPlayers: LobbyPlayer[]
  winners?: Array<{ playerId: string; amount: number; handDescription?: string }>
  bounty?: BountyMetadata
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
  sevenTwoRuleEnabled: boolean
  sevenTwoBountyPercent: number
  handNumber: number
  recentActions: string[]
  winners?: Array<{ playerId: string; amount: number; handDescription?: string }>
  bounty?: BountyMetadata
}
