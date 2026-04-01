import { buildSidePots } from './betting'
import { createDeck } from './deck'
import { compareHands, evaluateHand } from './evaluator'
import type { Card, HandResult, Pot, SeatPlayer, TableState } from './types'

const MAX_EXACT_RUNOUTS = 25_000
const MAX_MONTE_CARLO_SAMPLES = 6_000

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

function sampleRunout(deck: Card[], count: number): Card[] {
  if (count <= 0) {
    return []
  }

  const pool = [...deck]
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(Math.random() * (pool.length - index))
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

function allocateSamplePayouts(
  livePlayers: SeatPlayer[],
  communityCards: Card[],
  pots: Pot[]
): Map<string, number> {
  const payouts = new Map<string, number>()
  const handResults = new Map<string, HandResult>()

  for (const player of livePlayers) {
    const holeCards = player.holeCards ?? []
    if (holeCards.length !== 2) {
      continue
    }

    handResults.set(player.id, evaluateHand([...holeCards, ...communityCards]))
  }

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

    const rankedHands = eligible
      .map(playerId => ({
        playerId,
        result: handResults.get(playerId)!,
      }))
      .sort((left, right) => compareHands(right.result, left.result))

    const bestResult = rankedHands[0]!.result
    const winners = rankedHands.filter(({ result }) => compareHands(result, bestResult) === 0)
    const share = Math.floor(pot.amount / winners.length)
    const remainder = pot.amount - share * winners.length

    for (let index = 0; index < winners.length; index += 1) {
      const winnerId = winners[index]!.playerId
      const payout = share + (index === 0 ? remainder : 0)
      payouts.set(winnerId, (payouts.get(winnerId) ?? 0) + payout)
    }
  }

  return payouts
}

export function withVisibleHandOdds(state: TableState): TableState {
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

  const missingCommunityCards = 5 - state.communityCards.length
  if (missingCommunityCards < 0) {
    return state
  }

  const knownCards = new Set(
    [
      ...state.communityCards,
      ...state.players.flatMap(player => player.holeCards ?? []),
    ].map(cardKey)
  )

  const remainingDeck = createDeck().filter(card => !knownCards.has(cardKey(card)))
  const totalRunouts = countCombinations(remainingDeck.length, missingCommunityCards)
  const pots = getPots(state)
  const totalPot = pots.reduce((sum, pot) => sum + pot.amount, 0)

  if (totalPot <= 0) {
    return state
  }

  const equityTotals = new Map<string, number>()
  let simulationCount = 0

  const scoreRunout = (runout: Card[]) => {
    const board = [...state.communityCards, ...runout]
    const payouts = allocateSamplePayouts(livePlayers, board, pots)

    for (const player of livePlayers) {
      const payout = payouts.get(player.id) ?? 0
      equityTotals.set(player.id, (equityTotals.get(player.id) ?? 0) + payout / totalPot)
    }

    simulationCount += 1
  }

  if (missingCommunityCards === 0) {
    scoreRunout([])
  } else if (totalRunouts <= MAX_EXACT_RUNOUTS) {
    enumerateRunouts(remainingDeck, missingCommunityCards, scoreRunout)
  } else {
    const sampleCount = Math.min(MAX_MONTE_CARLO_SAMPLES, totalRunouts)
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      scoreRunout(sampleRunout(remainingDeck, missingCommunityCards))
    }
  }

  if (simulationCount === 0) {
    return state
  }

  return {
    ...state,
    players: state.players.map(player => {
      if (!isLivePlayer(player)) {
        return {
          ...player,
          equityPercent: undefined,
        }
      }

      const equityPercent = ((equityTotals.get(player.id) ?? 0) / simulationCount) * 100

      return {
        ...player,
        equityPercent: Number(equityPercent.toFixed(1)),
      }
    }),
  }
}
