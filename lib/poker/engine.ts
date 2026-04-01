import type {
  Card,
  BountyMetadata,
  InternalGameState,
  InternalPlayer,
  Pot,
  SeatPlayer,
  TableState,
} from './types'
import { freshShuffledDeck, dealCards } from './deck'
import {
  buildSidePots,
  calculateMinRaise,
  countActionablePlayers,
  countPlayersInHand,
  findPlayerIndex,
  isRoundComplete,
} from './betting'
import { compareHands, evaluateHand } from './evaluator'

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function cloneState(state: InternalGameState): InternalGameState {
  return JSON.parse(JSON.stringify(state)) as InternalGameState
}

function addAction(state: InternalGameState, message: string): void {
  state.recentActions = [message, ...state.recentActions].slice(0, 20)
}

function getSeatedPlayers(state: InternalGameState): InternalPlayer[] {
  return state.players.filter(
    p => p.status !== 'waiting' && p.status !== 'sitting_out'
  )
}

function getActivePlayers(state: InternalGameState): InternalPlayer[] {
  return state.players.filter(
    p => p.status === 'active' || p.status === 'all_in'
  )
}

function seatIndexToPlayerIndex(
  players: InternalPlayer[],
  seatIndex: number
): number {
  return players.findIndex(p => p.seatIndex === seatIndex)
}

/** Find the next occupied seat index (clockwise) */
function nextSeatIndex(
  players: InternalPlayer[],
  fromSeatIndex: number,
  predicate: (p: InternalPlayer) => boolean
): number {
  const maxSeat = 8
  for (let i = 1; i <= maxSeat; i++) {
    const seat = (fromSeatIndex + i) % maxSeat
    const player = players.find(p => p.seatIndex === seat)
    if (player && predicate(player)) return seat
  }
  return fromSeatIndex
}

function isSevenTwoBountyHand(holeCards: InternalPlayer['holeCards']): boolean {
  if (holeCards.length !== 2) return false
  const ranks = new Set(holeCards.map(card => card.rank))
  return ranks.has('7') && ranks.has('2')
}

function isEligibleBountyPayer(player: InternalPlayer, recipientIds: Set<string>): boolean {
  if (recipientIds.has(player.id)) return false
  if (player.stack <= 0) return false

  // Only players who were actually dealt into the hand should pay the bounty.
  // This includes players who later folded, but excludes players who were never in the hand.
  if (player.holeCards.length !== 2) {
    return false
  }

  if (
    player.status === 'disconnected' ||
    player.status === 'waiting' ||
    player.status === 'sitting_out'
  ) {
    return false
  }

  return true
}

function revealCardsForNextHand(state: InternalGameState): void {
  for (const player of state.players) {
    if (player.holeCards.length > 0) {
      player.showCards = 'both'
    }
  }
}

function splitAmountByWeight(
  amount: number,
  recipients: string[],
  recipientWeights: Map<string, number>
): Map<string, number> {
  const shares = new Map<string, number>()
  if (amount <= 0 || recipients.length === 0) {
    return shares
  }

  const totalWeight = recipients.reduce((sum, id) => sum + (recipientWeights.get(id) ?? 0), 0)
  if (totalWeight <= 0) {
    const evenShare = Math.floor(amount / recipients.length)
    let remainder = amount - evenShare * recipients.length
    for (const id of recipients) {
      shares.set(id, evenShare)
    }
    for (let i = 0; i < remainder; i += 1) {
      const id = recipients[i % recipients.length]!
      shares.set(id, (shares.get(id) ?? 0) + 1)
    }
    return shares
  }

  let remaining = amount
  for (const id of recipients) {
    const share = Math.floor(((recipientWeights.get(id) ?? 0) * amount) / totalWeight)
    shares.set(id, share)
    remaining -= share
  }

  for (let i = 0; i < remaining; i += 1) {
    const id = recipients[i % recipients.length]!
    shares.set(id, (shares.get(id) ?? 0) + 1)
  }

  return shares
}

function applyBountyPayout(
  state: InternalGameState,
  winnerTotals: Map<string, number>
): BountyMetadata {
  if (!state.sevenTwoRuleEnabled) {
    return {
      active: false,
      amount: 0,
      percentage: state.sevenTwoBountyPercent,
      contributors: [],
      recipientPlayerIds: [],
      reason: '7-2 rule disabled',
    }
  }

  const recipientPlayerIds = Array.from(winnerTotals.keys()).filter(id => {
    const idx = findPlayerIndex(state.players, id)
    return idx >= 0 && isSevenTwoBountyHand(state.players[idx]!.holeCards)
  })

  if (recipientPlayerIds.length === 0) {
    return {
      active: false,
      amount: 0,
      percentage: state.sevenTwoBountyPercent,
      contributors: [],
      recipientPlayerIds,
      reason: 'No 7-2 hand in winner list',
    }
  }

  const recipientSet = new Set(recipientPlayerIds)
  const contributors = state.players.filter(player => isEligibleBountyPayer(player, recipientSet))
  if (contributors.length === 0) {
    return {
      active: false,
      amount: 0,
      percentage: state.sevenTwoBountyPercent,
      contributors: [],
      recipientPlayerIds,
      reason: 'No eligible bounty contributors',
    }
  }

  const bountyContribution = Math.max(
    1,
    Math.floor((state.startingStack * state.sevenTwoBountyPercent) / 100)
  )

  let amount = 0
  const contributorIds: string[] = []
  for (const player of contributors) {
    const contribution = Math.min(bountyContribution, player.stack)
    player.stack -= contribution
    if (contribution > 0) {
      amount += contribution
      contributorIds.push(player.id)
    }
  }

  if (amount === 0) {
    return {
      active: false,
      amount: 0,
      percentage: state.sevenTwoBountyPercent,
      contributors: contributorIds,
      recipientPlayerIds,
      reason: 'No eligible bounty contributor had chips',
    }
  }

  const weightedRecipients = recipientPlayerIds.sort((a, b) => {
    const diff = (winnerTotals.get(b) ?? 0) - (winnerTotals.get(a) ?? 0)
    if (diff !== 0) return diff
    return a.localeCompare(b)
  })
  const recipientShare = splitAmountByWeight(amount, weightedRecipients, winnerTotals)

  for (const [recipientId, share] of recipientShare) {
    const idx = findPlayerIndex(state.players, recipientId)
    if (idx >= 0) {
      state.players[idx]!.stack += share
    }
  }

  return {
    active: true,
    amount,
    percentage: state.sevenTwoBountyPercent,
    contributors: contributorIds,
    recipientPlayerIds,
    reason: `${recipientPlayerIds.length} winner(s) with 7-2 collected ${state.sevenTwoBountyPercent}% of the table buy-in from each eligible opponent`,
  }
}

function applyHandPayouts(
  state: InternalGameState,
  winnerTotals: Map<string, number>,
  winnerDescriptions: Map<string, string>
): void {
  for (const [playerId, amount] of Array.from(winnerTotals.entries())) {
    const idx = findPlayerIndex(state.players, playerId)
    if (idx >= 0) {
      state.players[idx]!.stack += amount
      state.players[idx]!.lastAction = `Won $${amount}`
    }
  }

  const bounty = applyBountyPayout(state, winnerTotals)

  state.bounty = bounty

  state.winners = Array.from(winnerTotals.entries()).map(([playerId, amount]) => ({
    playerId,
    amount,
    handDescription: winnerDescriptions.get(playerId),
  }))

  if (bounty.active) {
    addAction(
      state,
      `${bounty.recipientPlayerIds.join(', ')} won bounty ${bounty.amount}`
    )
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize a fresh game state for a room.
 * Players may already be sitting; this just sets up the structure.
 */
export function createInitialGameState(
  roomCode: string,
  smallBlind = 10,
  bigBlind = 20,
  startingStack = 1000,
  actionTimerDuration = 30000
): InternalGameState {
  return {
    roomCode,
    phase: 'waiting',
    round: null,
    players: [],
    deck: [],
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    lastRaiseSize: bigBlind,
    minRaise: bigBlind * 2,
    actingPlayerId: null,
    actingPlayerIndex: -1,
    dealerSeatIndex: 0,
    smallBlind,
    bigBlind,
    startingStack,
    actionTimerStart: null,
    actionTimerDuration,
    sevenTwoRuleEnabled: true,
    sevenTwoBountyPercent: 2,
    handNumber: 0,
    recentActions: [],
  }
}

/**
 * Start a new hand.
 * Assigns dealer button, posts blinds, deals hole cards.
 */
export function startHand(state: InternalGameState): InternalGameState {
  const s = cloneState(state)

  const eligible = s.players.filter(
    p => p.stack > 0 && p.status !== 'sitting_out' && p.status !== 'disconnected'
  )

  if (eligible.length < 2) {
    throw new Error('Need at least 2 players with chips to start a hand')
  }

  // Reset per-hand state
  s.phase = 'in_hand'
  s.round = 'preflop'
  s.communityCards = []
  s.pots = []
  s.totalPot = 0
  s.currentBet = s.bigBlind
  s.lastRaiseSize = s.bigBlind
  s.minRaise = s.bigBlind * 2
  s.winners = undefined
  s.bounty = undefined
  s.handNumber += 1

  // Reset all players
  for (const player of s.players) {
    player.bet = 0
    player.totalInPot = 0
    player.holeCards = []
    player.hasActedThisRound = false
    player.lastAction = undefined
    player.isDealer = false
    player.isSB = false
    player.isBB = false
    player.showCards = 'none'
    if (player.stack > 0 && player.status !== 'sitting_out' && player.status !== 'disconnected') {
      player.status = 'active'
    } else if (player.stack === 0) {
      player.status = 'sitting_out'
    }
  }

  // Advance dealer button to next eligible player
  s.dealerSeatIndex = nextSeatIndex(
    s.players,
    s.dealerSeatIndex,
    p => eligible.some(e => e.id === p.id)
  )

  // Assign dealer, SB, BB
  const dealerPlayerIdx = seatIndexToPlayerIndex(s.players, s.dealerSeatIndex)
  if (dealerPlayerIdx >= 0) {
    s.players[dealerPlayerIdx]!.isDealer = true
  }

  // SB = next after dealer
  const sbSeatIndex = nextSeatIndex(
    s.players,
    s.dealerSeatIndex,
    p => eligible.some(e => e.id === p.id)
  )
  const sbPlayerIdx = seatIndexToPlayerIndex(s.players, sbSeatIndex)

  // BB = next after SB
  const bbSeatIndex = nextSeatIndex(
    s.players,
    sbSeatIndex,
    p => eligible.some(e => e.id === p.id)
  )
  const bbPlayerIdx = seatIndexToPlayerIndex(s.players, bbSeatIndex)

  // Post small blind
  if (sbPlayerIdx >= 0) {
    const sbPlayer = s.players[sbPlayerIdx]!
    s.players[sbPlayerIdx]!.isSB = true
    const sbAmount = Math.min(s.smallBlind, sbPlayer.stack)
    sbPlayer.bet = sbAmount
    sbPlayer.totalInPot = sbAmount
    sbPlayer.stack -= sbAmount
    if (sbPlayer.stack === 0) sbPlayer.status = 'all_in'
    addAction(s, `${sbPlayer.nickname} posts small blind $${sbAmount}`)
  }

  // Post big blind
  if (bbPlayerIdx >= 0) {
    const bbPlayer = s.players[bbPlayerIdx]!
    s.players[bbPlayerIdx]!.isBB = true
    const bbAmount = Math.min(s.bigBlind, bbPlayer.stack)
    bbPlayer.bet = bbAmount
    bbPlayer.totalInPot = bbAmount
    bbPlayer.stack -= bbAmount
    if (bbPlayer.stack === 0) bbPlayer.status = 'all_in'
    addAction(s, `${bbPlayer.nickname} posts big blind $${bbAmount}`)
  }

  // Deal hole cards (2 per player, in seat order)
  s.deck = freshShuffledDeck()
  for (const player of eligible) {
    const idx = findPlayerIndex(s.players, player.id)
    if (idx >= 0) {
      s.players[idx]!.holeCards = dealCards(s.deck, 2)
    }
  }

  // First to act preflop = player after BB
  const firstActSeatIndex = nextSeatIndex(
    s.players,
    bbSeatIndex,
    p => p.status === 'active' && p.stack > 0
  )
  const firstActIdx = seatIndexToPlayerIndex(s.players, firstActSeatIndex)

  if (firstActIdx >= 0) {
    s.actingPlayerId = s.players[firstActIdx]!.id
    s.actingPlayerIndex = firstActIdx
    s.actionTimerStart = Date.now()
  }

  s.totalPot = s.players.reduce((sum, p) => sum + p.totalInPot, 0)

  addAction(s, `Hand #${s.handNumber} started`)
  return s
}

/**
 * Process a player action (fold, check, call, raise, all_in).
 * Returns new state or throws on invalid action.
 */
export function processAction(
  state: InternalGameState,
  playerId: string,
  action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
  amount?: number
): InternalGameState {
  const s = cloneState(state)

  if (s.actingPlayerId !== playerId) {
    throw new Error(`Not your turn. Acting player is ${s.actingPlayerId}`)
  }

  const playerIdx = findPlayerIndex(s.players, playerId)
  if (playerIdx < 0) throw new Error('Player not found')

  const player = s.players[playerIdx]!

  if (player.status !== 'active') {
    throw new Error(`Player ${player.nickname} cannot act (status: ${player.status})`)
  }

  player.hasActedThisRound = true
  player.lastAction = undefined

  switch (action) {
    case 'fold': {
      player.status = 'folded'
      player.lastAction = 'Folded'
      addAction(s, `${player.nickname} folds`)

      // Check if everyone else folded
      const playersLeft = getActivePlayers(s)
      if (playersLeft.length === 1) {
        // Award pot to last player
        return awardLastPlayer(s, playersLeft[0]!.id)
      }
      break
    }

    case 'check': {
      if (player.bet < s.currentBet) {
        throw new Error(
          `Cannot check, must call $${s.currentBet - player.bet} or fold`
        )
      }
      player.lastAction = 'Checked'
      addAction(s, `${player.nickname} checks`)
      break
    }

    case 'call': {
      const callAmount = Math.min(s.currentBet - player.bet, player.stack)
      player.bet += callAmount
      player.totalInPot += callAmount
      player.stack -= callAmount
      if (player.stack === 0) {
        player.status = 'all_in'
        player.lastAction = 'All-in'
        addAction(s, `${player.nickname} calls all-in $${player.totalInPot}`)
      } else {
        player.lastAction = `Called $${callAmount}`
        addAction(s, `${player.nickname} calls $${callAmount}`)
      }
      break
    }

    case 'raise': {
      if (amount === undefined) throw new Error('Raise amount required')
      const minRaise = calculateMinRaise(s.currentBet, s.lastRaiseSize, s.bigBlind)
      if (amount < minRaise && amount !== player.stack + player.bet) {
        throw new Error(`Minimum raise is $${minRaise}, got $${amount}`)
      }
      const raiseExtra = amount - player.bet
      if (raiseExtra > player.stack) {
        throw new Error(`Not enough chips: need $${raiseExtra}, have $${player.stack}`)
      }
      const oldBet = s.currentBet
      s.lastRaiseSize = amount - oldBet
      s.currentBet = amount
      s.minRaise = calculateMinRaise(s.currentBet, s.lastRaiseSize, s.bigBlind)
      player.stack -= raiseExtra
      player.bet = amount
      player.totalInPot += raiseExtra
      if (player.stack === 0) {
        player.status = 'all_in'
        player.lastAction = `All-in $${amount}`
      } else {
        player.lastAction = `Raised $${amount}`
      }
      // Reset other players' hasActedThisRound so they can re-act
      for (const p of s.players) {
        if (p.id !== playerId && (p.status === 'active' || p.status === 'all_in')) {
          if (p.status === 'active') p.hasActedThisRound = false
        }
      }
      addAction(s, `${player.nickname} raises to $${amount}`)
      break
    }

    case 'all_in': {
      const allInAmount = player.stack + player.bet
      const raiseExtra = player.stack
      const oldCurrentBet = s.currentBet
      player.totalInPot += player.stack
      player.bet = allInAmount
      player.stack = 0
      player.status = 'all_in'
      player.lastAction = `All-in $${allInAmount}`

      // If this all-in constitutes a raise, update current bet
      if (allInAmount > oldCurrentBet) {
        const raiseSize = allInAmount - oldCurrentBet
        if (raiseSize >= s.lastRaiseSize) {
          s.lastRaiseSize = raiseSize
          s.minRaise = calculateMinRaise(allInAmount, raiseSize, s.bigBlind)
          // Reset others' action flags
          for (const p of s.players) {
            if (p.id !== playerId && p.status === 'active') {
              p.hasActedThisRound = false
            }
          }
        }
        s.currentBet = Math.max(s.currentBet, allInAmount)
      }

      addAction(s, `${player.nickname} goes all-in for $${allInAmount}`)
      break
    }
  }

  s.totalPot = s.players.reduce((sum, p) => sum + p.totalInPot, 0)
  s.actionTimerStart = null

  // Advance to next actor or next round
  return advanceAction(s)
}

/** Move action to next player, or advance to next betting round. */
function advanceAction(state: InternalGameState): InternalGameState {
  const s = state

  // Check if only one player remains
  const playersInHand = getActivePlayers(s)
  if (playersInHand.length <= 1) {
    if (playersInHand.length === 1) {
      return awardLastPlayer(s, playersInHand[0]!.id)
    }
    return s
  }

  // Check if round is complete
  const activePlayers = s.players.filter(p => p.status === 'active' && p.stack > 0)

  if (activePlayers.length === 0 || isRoundComplete(s.players.filter(p => p.status === 'active'), s.currentBet)) {
    // Also check: if all remaining are all-in or only 1 actionable
    if (activePlayers.length <= 1 && countPlayersInHand(s.players) >= 2) {
      return advanceRound(s)
    }
    if (isRoundComplete(s.players.filter(p => p.status === 'active' && p.stack > 0), s.currentBet)) {
      return advanceRound(s)
    }
  }

  // Find next player to act
  let nextIdx = s.actingPlayerIndex
  let found = false
  for (let i = 1; i <= s.players.length; i++) {
    const idx = (s.actingPlayerIndex + i) % s.players.length
    const p = s.players[idx]!
    if (p.status === 'active' && p.stack > 0 && !p.hasActedThisRound) {
      nextIdx = idx
      found = true
      break
    }
  }

  if (!found) {
    return advanceRound(s)
  }

  s.actingPlayerIndex = nextIdx
  s.actingPlayerId = s.players[nextIdx]!.id
  s.actionTimerStart = Date.now()

  return s
}

/**
 * Advance to the next betting round (flop → turn → river → showdown).
 * Deals community cards and resets bets.
 */
export function advanceRound(state: InternalGameState): InternalGameState {
  const s = cloneState(state)

  // Collect bets into pots
  s.pots = buildSidePots(s.players)
  s.totalPot = s.pots.reduce((sum, p) => sum + p.amount, 0)

  // Reset per-round state
  for (const player of s.players) {
    player.bet = 0
    player.hasActedThisRound = false
  }
  s.currentBet = 0
  s.lastRaiseSize = s.bigBlind
  s.minRaise = s.bigBlind

  const playersInHand = getActivePlayers(s)

  // If only 1 or fewer players can act, run out the board automatically
  const actionable = countActionablePlayers(s.players)

  switch (s.round) {
    case 'preflop': {
      s.round = 'flop'
      // Burn + deal 3
      dealCards(s.deck, 1) // burn
      s.communityCards = dealCards(s.deck, 3)
      addAction(s, `Flop: ${s.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(' ')}`)
      break
    }
    case 'flop': {
      s.round = 'turn'
      dealCards(s.deck, 1) // burn
      s.communityCards.push(...dealCards(s.deck, 1))
      addAction(s, `Turn: ${s.communityCards[3]!.rank}${s.communityCards[3]!.suit[0]}`)
      break
    }
    case 'turn': {
      s.round = 'river'
      dealCards(s.deck, 1) // burn
      s.communityCards.push(...dealCards(s.deck, 1))
      addAction(s, `River: ${s.communityCards[4]!.rank}${s.communityCards[4]!.suit[0]}`)
      break
    }
    case 'river': {
      return resolveShowdown(s)
    }
    default:
      return s
  }

  // If all remaining players are all-in, run out the board
  if (actionable <= 1 && playersInHand.length >= 2) {
    return advanceRound(s)
  }

  // First to act post-flop = first active player left of dealer
  const firstActSeat = nextSeatIndex(
    s.players,
    s.dealerSeatIndex,
    p => p.status === 'active' && p.stack > 0
  )
  const firstActIdx = seatIndexToPlayerIndex(s.players, firstActSeat)

  if (firstActIdx >= 0) {
    s.actingPlayerId = s.players[firstActIdx]!.id
    s.actingPlayerIndex = firstActIdx
    s.actionTimerStart = Date.now()
  } else {
    s.actingPlayerId = null
    s.actingPlayerIndex = -1
  }

  return s
}

/**
 * Award all pots to the last remaining player (everyone else folded).
 */
function awardLastPlayer(
  state: InternalGameState,
  winnerId: string
): InternalGameState {
  const s = state
  if (s.phase === 'between_hands' && s.winners) {
    return s
  }

  const winnerIdx = findPlayerIndex(s.players, winnerId)
  if (winnerIdx < 0) return s

  const winner = s.players[winnerIdx]!

  // Build final pots
  s.pots = buildSidePots(s.players)
  s.totalPot = s.pots.reduce((sum, p) => sum + p.amount, 0)

  // Award everything
  const winnerTotals = new Map<string, number>([[winnerId, s.totalPot]])
  const winnerDescriptions = new Map<string, string>()
  if (winner.holeCards.length === 2 && s.communityCards.length >= 3) {
    const result = evaluateHand([...winner.holeCards, ...s.communityCards])
    winnerDescriptions.set(winnerId, result.description)
  }
  applyHandPayouts(s, winnerTotals, winnerDescriptions)
  revealCardsForNextHand(s)
  s.phase = 'between_hands'
  s.round = null
  s.actingPlayerId = null
  s.actingPlayerIndex = -1

  addAction(s, `${winner.nickname} wins $${s.totalPot}`)
  return s
}

/**
 * Resolve the showdown: evaluate hands, award pots, handle split pots.
 */
export function resolveShowdown(state: InternalGameState): InternalGameState {
  const s = cloneState(state)
  if (s.phase === 'between_hands' && s.winners) {
    return s
  }

  s.round = 'showdown'
  s.actingPlayerId = null
  s.actingPlayerIndex = -1

  // Finalize pots
  s.pots = buildSidePots(s.players)
  s.totalPot = s.pots.reduce((sum, p) => sum + p.amount, 0)

  const communityCards = s.communityCards

  // Evaluate hands for all eligible players
  const handResults = new Map<
    string,
    ReturnType<typeof evaluateHand>
  >()

  for (const player of s.players) {
    if (player.status === 'active' || player.status === 'all_in') {
      if (player.holeCards.length === 2) {
        const allCards = [...player.holeCards, ...communityCards]
        try {
          handResults.set(player.id, evaluateHand(allCards))
        } catch {
          // Player has incomplete hand (shouldn't happen)
        }
      }
    }
  }

  // Award each pot
  const winnerTotals = new Map<string, number>()
  const winnerDescriptions = new Map<string, string>()

  for (const pot of s.pots) {
    const eligible = pot.eligiblePlayerIds.filter(id => handResults.has(id))

    if (eligible.length === 0) {
      // Give back to the contributing player (edge case)
      continue
    }

    if (eligible.length === 1) {
      const id = eligible[0]!
      winnerTotals.set(id, (winnerTotals.get(id) ?? 0) + pot.amount)
      const result = handResults.get(id)
      if (result) winnerDescriptions.set(id, result.description)
      continue
    }

    // Find best hand(s)
    const sorted = eligible
      .map(id => ({ id, result: handResults.get(id)! }))
      .sort((a, b) => compareHands(b.result, a.result))

    const bestResult = sorted[0]!.result
    const winners = sorted.filter(
      ({ result }) => compareHands(result, bestResult) === 0
    )

    // Split pot (handle odd chips - give remainder to first winner clockwise)
    const share = Math.floor(pot.amount / winners.length)
    const remainder = pot.amount - share * winners.length

    for (let i = 0; i < winners.length; i++) {
      const id = winners[i]!.id
      const extra = i === 0 ? remainder : 0
      winnerTotals.set(id, (winnerTotals.get(id) ?? 0) + share + extra)
      winnerDescriptions.set(id, winners[i]!.result.description)
    }
  }

  applyHandPayouts(s, winnerTotals, winnerDescriptions)
  revealCardsForNextHand(s)

  // Log results
  for (const w of s.winners ?? []) {
    const player = s.players.find(p => p.id === w.playerId)
    if (player) {
      addAction(
        s,
        `${player.nickname} wins $${w.amount}${w.handDescription ? ` with ${w.handDescription}` : ''}`
      )
    }
  }

  s.phase = 'between_hands'
  return s
}

/**
 * Prepare the state for the next hand.
 * Removes busted players, rotates dealer, resets hand state.
 */
export function prepareNextHand(state: InternalGameState): InternalGameState {
  const s = cloneState(state)

  s.phase = 'between_hands'
  s.round = null
  s.communityCards = []
  s.winners = undefined
  s.actingPlayerId = null
  s.actingPlayerIndex = -1

  // Sit out players with no chips
  for (const player of s.players) {
    if (player.stack === 0) {
      player.status = 'sitting_out'
    } else if (player.status !== 'disconnected' && player.status !== 'sitting_out') {
      player.status = 'active'
    }
    player.bet = 0
    player.totalInPot = 0
    player.holeCards = []
    player.hasActedThisRound = false
    player.showCards = 'none'
    player.lastAction = undefined
    player.isDealer = false
    player.isSB = false
    player.isBB = false
  }

  s.pots = []
  s.totalPot = 0
  s.currentBet = 0
  s.bounty = undefined

  return s
}

/**
 * Convert internal game state to a public TableState for a specific viewer.
 * Sanitizes hole cards (only shows them to the owning player).
 */
export function toTableState(
  state: InternalGameState,
  viewerPlayerId: string,
  options: {
    revealAllHoleCards?: boolean
  } = {}
): TableState {
  const revealAllHoleCards = options.revealAllHoleCards === true

  const revealCards = (player: InternalPlayer): Card[] | undefined => {
    if (player.holeCards.length === 0) {
      return undefined
    }

    if (revealAllHoleCards) {
      return player.holeCards
    }

    if (state.phase === 'in_hand') {
      return undefined
    }

    if (player.showCards === 'both') {
      return player.holeCards
    }

    if (player.showCards === 'left' && player.holeCards.length > 0) {
      return [player.holeCards[0] as Card]
    }

    if (player.showCards === 'right' && player.holeCards.length > 0) {
      return [player.holeCards[Math.min(player.holeCards.length - 1, 1)] as Card]
    }

    return undefined
  }

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    round: state.round,
    players: state.players.map((p): SeatPlayer => ({
      id: p.id,
      nickname: p.nickname,
      isBot: p.isBot,
      stack: p.stack,
      bet: p.bet,
      totalInPot: p.totalInPot,
      status: p.status,
      isDealer: p.isDealer,
      isSB: p.isSB,
      isBB: p.isBB,
      holeCards: p.id === viewerPlayerId ? p.holeCards : revealCards(p),
      hasCards: p.holeCards.length > 0,
      showCards: revealAllHoleCards && p.holeCards.length > 0 ? 'both' : p.showCards,
      isConnected: p.isConnected,
      lastAction: p.lastAction,
      seatIndex: p.seatIndex,
      hasActedThisRound: p.hasActedThisRound,
    })),
    communityCards: state.communityCards,
    pots: state.pots,
    totalPot: state.totalPot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actingPlayerId: state.actingPlayerId,
    dealerSeatIndex: state.dealerSeatIndex,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    startingStack: state.startingStack,
    actionTimerStart: state.actionTimerStart,
    actionTimerDuration: state.actionTimerDuration,
    sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: state.sevenTwoBountyPercent,
    handNumber: state.handNumber,
    recentActions: state.recentActions,
    lobbyPlayers: [],
    winners: state.winners,
    bounty: state.bounty,
  }
}
