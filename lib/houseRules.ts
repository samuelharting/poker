/**
 * House rules: automatic drinks the table hands out once a hand is over
 * (never mid-hand). Pure, so the room applies exactly what the tests check.
 *
 * Shots (a "house shot": +3, poured by the bartender, opens the 20s chaser
 * window, bypasses every shot limit):
 * - seven_two: went to showdown and lost to a winner holding 7-2.
 * - rivered: was ahead (best or tied best) among the showdown players on the
 *   turn and is not best on the river. Run-it-twice: judged per board, at most
 *   one shot.
 * - cheers: someone at showdown makes quads or better: EVERY drink-capable
 *   seated player takes one together.
 * Beers (forced, counted as beers, at most 2 per hand in total):
 * - big_loss: lost more than 10% of the hand-start stack (1), more than 25% (2).
 * - bad_beat: lost at showdown holding three of a kind or better that the hole
 *   cards made (a better category than the board plays on its own) (1).
 * - lost_showdown: lost any contested showdown: a sip (half a beer).
 * - scared_money: folded 3 dealt-in hands in a row (1); the streak then resets.
 * - bubble: at the end of each orbit the shortest stack at the table drinks (1).
 * - dealer: dealer's round, whoever had the button this hand drinks (1).
 * - waterfall: every WATERFALL_EVERY_HANDS hands the whole table drinks (1).
 * Water:
 * - big_win: won a pot worth more than 50% of the hand-start stack: a free,
 *   instant -2 water.
 * Applied per player in that order: shots, then beers, then the free water.
 * Only drink-capable players (desktop 3D; bots) are ever affected.
 */
import { computeBigLossBeers } from './drinks'
import { compareHands, evaluateHand } from './poker/evaluator'
import type { Card, HandResult } from './poker/types'

export type HouseShotRule = 'seven_two' | 'rivered' | 'cheers'
export type HouseBeerRule = 'big_loss' | 'bad_beat' | 'lost_showdown' | 'scared_money' | 'bubble' | 'dealer' | 'waterfall'

export const HOUSE_SHOT_RULES: readonly HouseShotRule[] = ['seven_two', 'rivered', 'cheers']
/** Forced beers from one hand never exceed this. */
export const HOUSE_BEER_CAP = 2
/** Win a pot worth more than this share of your hand-start stack: free water. */
export const BIG_WIN_FRACTION = 0.5
/** Losing any showdown: a beer (owner wanted more automatic drinking). */
export const LOST_SHOWDOWN_BEERS = 1
/** Every this many hands the whole table drinks together. */
export const WATERFALL_EVERY_HANDS = 12
/** Folds in a row (dealt-in hands) that cost a beer. */
export const SCARED_MONEY_FOLDS = 3
/** Quads (rankIndex 7) or better at showdown: cheers. */
const QUADS_RANK_INDEX = 7
const THREE_OF_A_KIND_RANK_INDEX = 3

export interface HouseRulePlayer {
  id: string
  drinkCapable: boolean
  /** Holding cards when the hand ended (dealt in). */
  holeCards: readonly Card[]
  folded: boolean
  /** Stack plus blinds when the hand started (undefined: not dealt in). */
  startStack?: number
  endStack: number
  /** Chips collected from the pot(s) this hand. */
  won: number
  /** Dealt-in hands folded in a row, including this one (room-tracked). */
  foldStreak?: number
}

export interface HouseRuleHand {
  /** The hand ended in a real showdown (not everyone-folded). */
  showdown: boolean
  /** The final board(s): one, or two when run twice. */
  boards: ReadonlyArray<readonly Card[]>
  players: readonly HouseRulePlayer[]
  /** An orbit just finished: these shortest-stack players drink (room-decided). */
  bubbleIds?: readonly string[]
  /** Who had the dealer button this hand (dealer's round). */
  dealerId?: string | null
  /** A waterfall hand: everyone dealt in drinks. */
  waterfall?: boolean
}

export interface HouseRuleOutcome {
  playerId: string
  shots: HouseShotRule[]
  beers: number
  beerRules: HouseBeerRule[]
  freeWater: boolean
}

function isSevenTwo(cards: readonly Card[]): boolean {
  const ranks = new Set(cards.map(card => card.rank))
  return cards.length === 2 && ranks.has('7') && ranks.has('2')
}

function safeEvaluate(cards: Card[]): HandResult | null {
  try {
    return cards.length >= 5 ? evaluateHand(cards) : null
  } catch {
    return null
  }
}

/** Ids holding the best hand (ties included) on `board`. */
function bestOn(board: readonly Card[], players: readonly HouseRulePlayer[]): Set<string> {
  let best: HandResult | null = null
  let ids = new Set<string>()
  for (const player of players) {
    const result = safeEvaluate([...player.holeCards, ...board])
    if (!result) continue
    const order = best ? compareHands(result, best) : 1
    if (order > 0) {
      best = result
      ids = new Set([player.id])
    } else if (order === 0) {
      ids.add(player.id)
    }
  }
  return ids
}

/** The hole cards made the hand: it is a better category than the board plays alone. */
function beatsBoardAlone(result: HandResult, board: readonly Card[]): boolean {
  const boardOnly = safeEvaluate([...board])
  return !boardOnly || result.rankIndex > boardOnly.rankIndex
}

export function computeHouseRules(hand: HouseRuleHand): HouseRuleOutcome[] {
  const showdownPlayers = hand.showdown
    ? hand.players.filter(player => !player.folded && player.holeCards.length === 2)
    : []
  const winners = new Set(hand.players.filter(player => player.won > 0).map(player => player.id))
  const fullBoards = hand.boards.filter(board => board.length === 5)
  const contested = showdownPlayers.length >= 2

  const sevenTwoWon = contested && showdownPlayers.some(player => winners.has(player.id) && isSevenTwo(player.holeCards))
  const cheers = contested && showdownPlayers.some(player =>
    fullBoards.some(board => (safeEvaluate([...player.holeCards, ...board])?.rankIndex ?? 0) >= QUADS_RANK_INDEX)
  )
  const rivered = new Set<string>()
  if (contested) {
    for (const board of fullBoards) {
      const aheadOnTurn = bestOn(board.slice(0, 4), showdownPlayers)
      const bestOnRiver = bestOn(board, showdownPlayers)
      for (const id of aheadOnTurn) {
        if (!bestOnRiver.has(id)) rivered.add(id)
      }
    }
  }

  const outcomes: HouseRuleOutcome[] = []
  for (const player of hand.players) {
    if (!player.drinkCapable) continue
    const atShowdown = showdownPlayers.includes(player)
    const lostShowdown = atShowdown && contested && !winners.has(player.id)
    const shots: HouseShotRule[] = []
    if (sevenTwoWon && lostShowdown) shots.push('seven_two')
    if (rivered.has(player.id)) shots.push('rivered')
    if (cheers) shots.push('cheers')

    const beerRules: HouseBeerRule[] = []
    let beers = 0
    if (player.startStack !== undefined) {
      const lossBeers = computeBigLossBeers(player.startStack, player.endStack)
      if (lossBeers > 0) {
        beers += lossBeers
        beerRules.push('big_loss')
      }
    }
    if (lostShowdown) {
      const madeHand = fullBoards.some(board => {
        const result = safeEvaluate([...player.holeCards, ...board])
        return Boolean(result && result.rankIndex >= THREE_OF_A_KIND_RANK_INDEX && beatsBoardAlone(result, board))
      })
      if (madeHand) {
        beers += 1
        beerRules.push('bad_beat')
      }
      beers += LOST_SHOWDOWN_BEERS
      beerRules.push('lost_showdown')
    }
    if ((player.foldStreak ?? 0) >= SCARED_MONEY_FOLDS) {
      beers += 1
      beerRules.push('scared_money')
    }
    if (hand.bubbleIds?.includes(player.id)) {
      beers += 1
      beerRules.push('bubble')
    }
    if (hand.dealerId && hand.dealerId === player.id && player.startStack !== undefined) {
      beers += 1
      beerRules.push('dealer')
    }
    if (hand.waterfall && player.startStack !== undefined) {
      beers += 1
      beerRules.push('waterfall')
    }
    beers = Math.min(HOUSE_BEER_CAP, beers)

    const freeWater = player.startStack !== undefined &&
      player.startStack > 0 &&
      player.won > player.startStack * BIG_WIN_FRACTION

    if (shots.length > 0 || beers > 0 || freeWater) {
      outcomes.push({ playerId: player.id, shots, beers, beerRules, freeWater })
    }
  }
  return outcomes
}
