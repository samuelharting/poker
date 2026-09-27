import { buildSidePots } from './betting'
import { createDeck } from './deck'
import { compareHands, evaluateHand } from './evaluator'
import type { Card, HandOddsMode, HandOddsSnapshot, HandResult, Pot, SeatPlayer, TableState } from './types'

const MAX_EXACT_RUNOUTS = 25_000
const MAX_MONTE_CARLO_SAMPLES = 6_000
// Multiway preflop spots scale the sample count down to keep the server snappy.
const MONTE_CARLO_EVALUATION_BUDGET = 12_000
const MIN_MONTE_CARLO_SAMPLES = 2_500
const ODDS_CACHE_LIMIT = 48

type PublicPotPlayer = Pick<SeatPlayer, 'id' | 'status' | 'totalInPot'>

function cardKey(card: Card): string {
  return `${card.rank}_${card.suit}`
}

function isLivePlayer(player: SeatPlayer): boolean {
  return player.status === 'active' || player.status === 'all_in'
}

function getPots(state: TableState): Pot[] {
  const existingPotTotal = state.pots.reduce((sum, pot) => sum + pot.amount, 0)

  if (state.pots.length > 0 && existingPotTotal === state.totalPot) {
    return state.pots
  }

  return buildSidePots(state.players as PublicPotPlayer[])
}

function countCombinations(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0
  }

  if (k === 0 || k === n) {
    return 1
  }

  const effectiveK = Math.min(k, n - k)
  let total = 1

  for (let index = 1; index <= effectiveK; index += 1) {
    total = (total * (n - effectiveK + index)) / index
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      return Number.MAX_SAFE_INTEGER
    }
  }

  return Math.round(total)
}

/** Small deterministic PRNG so a cached-or-not Monte Carlo result never jitters. */
function createSeededRandom(seedText: string): () => number {
  let seed = 2166136261
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleRunout(deck: Card[], count: number, random: () => number): Card[] {
  if (count <= 0) {
    return []
  }

  const pool = [...deck]
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(random() * (pool.length - index))
    const temp = pool[index]!
    pool[index] = pool[swapIndex]!
    pool[swapIndex] = temp
  }

  return pool.slice(0, count)
}

function enumerateRunouts(
  deck: Card[],
  count: number,
  onRunout: (cards: Card[]) => void,
  startIndex = 0,
  current: Card[] = []
): void {
  if (current.length === count) {
    onRunout([...current])
    return
  }

  const remainingToPick = count - current.length
  const maxIndex = deck.length - remainingToPick

  for (let index = startIndex; index <= maxIndex; index += 1) {
    current.push(deck[index]!)
    enumerateRunouts(deck, count, onRunout, index + 1, current)
    current.pop()
  }
}

interface OddsHand {
  id: string
  holeCards: Card[]
}

export interface LiveHandOdds {
  /** Share of the pot each player wins on average, 0-1 (side pots respected). */
  equity: Map<string, number>
  /** Outright wins of the best hand across all live players, 0-1. */
  win: Map<string, number>
  /** Split best hands, 0-1. */
  tie: Map<string, number>
  exact: boolean
  samples: number
}

const oddsCache = new Map<string, LiveHandOdds>()
let oddsComputations = 0

/** Test hook: how many times the (expensive) odds were actually computed. */
export function getHandOddsComputationCount(): number {
  return oddsComputations
}

export function clearHandOddsCache(): void {
  oddsCache.clear()
  oddsComputations = 0
}

/**
 * Side pots only change pot equity when some pot is not contested by every
 * live hand. Otherwise equity is just wins plus split shares, so the pots are
 * left out of the cache key and a bet never forces a recompute.
 */
function hasUnevenSidePots(hands: OddsHand[], pots: Pot[]): boolean {
  const liveIds = new Set(hands.map(hand => hand.id))
  return pots.some(pot => {
    if (pot.amount <= 0) return false
    const contested = pot.eligiblePlayerIds.filter(id => liveIds.has(id))
    return contested.length !== liveIds.size
  })
}

function oddsCacheKey(hands: OddsHand[], board: Card[], pots: Pot[], unevenPots: boolean): string {
  const handKey = [...hands]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(hand => `${hand.id}:${hand.holeCards.map(cardKey).join(',')}`)
    .join(';')
  const potKey = unevenPots
    ? pots
        .map(pot => `${pot.amount}>${[...pot.eligiblePlayerIds].sort().join(',')}`)
        .join(';')
    : 'even'
  return `${board.map(cardKey).join(',')}|${handKey}|${potKey}`
}

/**
 * Win / tie / pot-equity odds for fully visible live hands. Results are cached
 * by (board, hands, pots) so every viewer of the same street shares one
 * computation, and Monte Carlo runs are seeded by that key so the figures
 * never jitter between snapshots.
 */
export function computeLiveHandOdds(
  hands: OddsHand[],
  board: Card[],
  pots: Pot[]
): LiveHandOdds | null {
  if (hands.length < 2 || hands.some(hand => hand.holeCards.length !== 2)) {
    return null
  }

  const missingCommunityCards = 5 - board.length
  if (missingCommunityCards < 0) {
    return null
  }

  const unevenPots = hasUnevenSidePots(hands, pots)
  const key = oddsCacheKey(hands, board, pots, unevenPots)
  const cached = oddsCache.get(key)
  if (cached) {
    // Refresh recency for the LRU.
    oddsCache.delete(key)
    oddsCache.set(key, cached)
    return cached
  }

  oddsComputations += 1

  const knownCards = new Set(
    [...board, ...hands.flatMap(hand => hand.holeCards)].map(cardKey)
  )
  const remainingDeck = createDeck().filter(card => !knownCards.has(cardKey(card)))
  const totalRunouts = countCombinations(remainingDeck.length, missingCommunityCards)
  const totalPot = unevenPots ? pots.reduce((sum, pot) => sum + pot.amount, 0) : 0

  const equityTotals = new Map<string, number>()
  const winTotals = new Map<string, number>()
  const tieTotals = new Map<string, number>()
  let simulationCount = 0

  const scoreRunout = (runout: Card[]) => {
    const fullBoard = runout.length > 0 ? [...board, ...runout] : board
    const results = new Map<string, HandResult>()
    for (const hand of hands) {
      results.set(hand.id, evaluateHand([...hand.holeCards, ...fullBoard]))
    }

    let best: HandResult | null = null
    let bestIds: string[] = []
    for (const hand of hands) {
      const result = results.get(hand.id)!
      const comparison = best ? compareHands(result, best) : 1
      if (comparison > 0) {
        best = result
        bestIds = [hand.id]
      } else if (comparison === 0) {
        bestIds.push(hand.id)
      }
    }
    if (bestIds.length === 1) {
      winTotals.set(bestIds[0]!, (winTotals.get(bestIds[0]!) ?? 0) + 1)
    } else {
      for (const id of bestIds) {
        tieTotals.set(id, (tieTotals.get(id) ?? 0) + 1)
      }
    }

    if (totalPot > 0) {
      const payouts = allocatePayouts(results, pots)
      for (const hand of hands) {
        const payout = payouts.get(hand.id) ?? 0
        equityTotals.set(hand.id, (equityTotals.get(hand.id) ?? 0) + payout / totalPot)
      }
    } else {
      // Every pot goes to the best hand: equity is the share of the best hand.
      for (const id of bestIds) {
        equityTotals.set(id, (equityTotals.get(id) ?? 0) + 1 / bestIds.length)
      }
    }

    simulationCount += 1
  }

  const exact = missingCommunityCards === 0 || totalRunouts <= MAX_EXACT_RUNOUTS
  if (missingCommunityCards === 0) {
    scoreRunout([])
  } else if (exact) {
    enumerateRunouts(remainingDeck, missingCommunityCards, scoreRunout)
  } else {
    const random = createSeededRandom(key)
    const sampleCount = Math.min(
      totalRunouts,
      Math.max(
        MIN_MONTE_CARLO_SAMPLES,
        Math.min(MAX_MONTE_CARLO_SAMPLES, Math.floor(MONTE_CARLO_EVALUATION_BUDGET / hands.length))
      )
    )
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      scoreRunout(sampleRunout(remainingDeck, missingCommunityCards, random))
    }
  }

  if (simulationCount === 0) {
    return null
  }

  const normalize = (totals: Map<string, number>) => new Map(
    hands.map(hand => [hand.id, (totals.get(hand.id) ?? 0) / simulationCount])
  )
  const odds: LiveHandOdds = {
    equity: normalize(equityTotals),
    win: normalize(winTotals),
    tie: normalize(tieTotals),
    exact,
    samples: simulationCount,
  }

  oddsCache.set(key, odds)
  while (oddsCache.size > ODDS_CACHE_LIMIT) {
    const oldestKey = oddsCache.keys().next().value
    if (oldestKey === undefined) break
    oddsCache.delete(oldestKey)
  }

  return odds
}

function allocatePayouts(
  handResults: Map<string, HandResult>,
  pots: Pot[]
): Map<string, number> {
  const payouts = new Map<string, number>()

  for (const pot of pots) {
    const eligible = pot.eligiblePlayerIds.filter(playerId => handResults.has(playerId))
    if (eligible.length === 0) {
      continue
    }

    if (eligible.length === 1) {
      const onlyPlayerId = eligible[0]!
      payouts.set(onlyPlayerId, (payouts.get(onlyPlayerId) ?? 0) + pot.amount)
      continue
    }

    let bestResult = handResults.get(eligible[0]!)!
    for (const playerId of eligible) {
      const result = handResults.get(playerId)!
      if (compareHands(result, bestResult) > 0) {
        bestResult = result
      }
    }
    const winners = eligible.filter(playerId => compareHands(handResults.get(playerId)!, bestResult) === 0)
    const share = pot.amount / winners.length
    for (const winnerId of winners) {
      payouts.set(winnerId, (payouts.get(winnerId) ?? 0) + share)
    }
  }

  return payouts
}

function roundPercent(fraction: number): number {
  return Number((fraction * 100).toFixed(1))
}

export interface VisibleHandOddsOptions {
  /** Attach the broadcast odds overlay (`handOdds`) in this mode. */
  oddsMode?: HandOddsMode
}

/**
 * Adds pot equity to every live player when the viewer can see every live
 * hand (spectators, or the whole table once an all-in is tabled), plus the
 * broadcast `handOdds` block when an overlay mode is requested.
 */
export function withVisibleHandOdds(
  state: TableState,
  options: VisibleHandOddsOptions = {}
): TableState {
  if (state.phase !== 'in_hand') {
    return state
  }

  const livePlayers = state.players.filter(isLivePlayer)
  if (livePlayers.length < 2) {
    return state
  }

  if (livePlayers.some(player => (player.holeCards?.length ?? 0) !== 2)) {
    return state
  }

  if (state.communityCards.length > 5) {
    return state
  }

  const pots = getPots(state)
  const odds = computeLiveHandOdds(
    livePlayers.map(player => ({ id: player.id, holeCards: player.holeCards! })),
    state.communityCards,
    pots
  )
  if (!odds) {
    return state
  }

  const handOdds: HandOddsSnapshot | undefined = options.oddsMode
    ? {
        mode: options.oddsMode,
        handNumber: state.handNumber,
        boardCount: state.communityCards.length,
        exact: odds.exact,
        players: livePlayers.map(player => ({
          playerId: player.id,
          winPercent: roundPercent(odds.win.get(player.id) ?? 0),
          tiePercent: roundPercent(odds.tie.get(player.id) ?? 0),
        })),
      }
    : undefined

  return {
    ...state,
    ...(handOdds ? { handOdds } : {}),
    players: state.players.map(player => {
      if (!isLivePlayer(player)) {
        return {
          ...player,
          equityPercent: undefined,
        }
      }

      return {
        ...player,
        equityPercent: roundPercent(odds.equity.get(player.id) ?? 0),
      }
    }),
  }
}
