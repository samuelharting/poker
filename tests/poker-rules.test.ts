import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canPlayerRaise,
  createInitialGameState,
  foldLeavingPlayer,
  prepareNextHand,
  processAction,
  startHand,
  toTableState,
  voteRunItTwice,
} from '@/lib/poker/engine'
import { buildSidePots } from '@/lib/poker/betting'
import { createDeck } from '@/lib/poker/deck'
import { compareHands, evaluateHand } from '@/lib/poker/evaluator'
import type { Card, InternalGameState, InternalPlayer } from '@/lib/poker/types'
import { bestReferenceHand, compareReference } from './helpers/bruteForceHand'

/**
 * No-Limit Hold'em rules (TDA / Robert's Rules), checked hand by hand against
 * the engine. Every hand is deterministic: rigged hole cards and board, bots
 * (no run-it-twice vote), 7-2 bounty off.
 */

type Action = 'fold' | 'check' | 'call' | 'raise' | 'all_in'

const SUITS: Record<string, Card['suit']> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }
const c = (code: string): Card => ({ rank: code[0] as Card['rank'], suit: SUITS[code[1]!]! })
const cards = (codes: string) => codes.split(' ').filter(Boolean).map(c)
const key = (card: Card) => `${card.rank}${card.suit}`

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A table of bots. `stacks` maps id -> chips, seated in order from seat 0
 * (or at `seats`). The first hand's button lands on `buttonSeat`.
 */
function table(
  stacks: Record<string, number>,
  { blinds = [10, 20] as [number, number], seats, buttonSeat = 0 }: { blinds?: [number, number]; seats?: number[]; buttonSeat?: number } = {}
): InternalGameState {
  const state = createInitialGameState('RULES', blinds[0], blinds[1], 1000)
  state.sevenTwoRuleEnabled = false
  Object.entries(stacks).forEach(([id, stack], index) => {
    state.players.push(newPlayer(id, seats?.[index] ?? index, stack))
  })
  state.players.sort((a, b) => a.seatIndex - b.seatIndex)
  // The first hand puts the button on the next player after dealerSeatIndex.
  const occupied = state.players.map(player => player.seatIndex)
  const before = [...occupied].reverse().find(seat => seat < buttonSeat) ?? occupied[occupied.length - 1]!
  state.dealerSeatIndex = before
  return state
}

function newPlayer(id: string, seatIndex: number, stack: number): InternalPlayer {
  return {
    id,
    nickname: id,
    isBot: true,
    stack,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    holeCards: [],
    showCards: 'none',
    isConnected: true,
    seatIndex,
    hasActedThisRound: false,
  }
}

/** Rig hole cards and the board (burn cards are taken from the unused rest of the deck). */
function rig(state: InternalGameState, holes: Record<string, string>, board: string): InternalGameState {
  const s = structuredClone(state)
  const used = new Set<string>()
  for (const [id, codes] of Object.entries(holes)) {
    const player = s.players.find(candidate => candidate.id === id)!
    player.holeCards = cards(codes)
    player.holeCards.forEach(card => used.add(key(card)))
  }
  const boardCards = cards(board)
  boardCards.forEach(card => used.add(key(card)))
  // Anyone not rigged gets unused cards so no card exists twice.
  const spare = createDeck().filter(card => !used.has(key(card)))
  for (const player of s.players) {
    if (player.holeCards.length === 2 && !holes[player.id]) player.holeCards = [spare.shift()!, spare.shift()!]
  }
  const [f1, f2, f3, turn, river] = boardCards
  s.deck = [spare.shift()!, f1!, f2!, f3!, spare.shift()!, turn!, spare.shift()!, river!, ...spare]
  return s
}

const act = (state: InternalGameState, id: string, action: Action, amount?: number) =>
  processAction(state, id, action, amount)

const player = (state: InternalGameState, id: string) => state.players.find(candidate => candidate.id === id)!
/** Chips on the table: stacks, plus what is in the pot while a hand is live (it is paid out after). */
const totalChips = (state: InternalGameState) =>
  state.players.reduce((sum, p) => sum + p.stack + (state.phase === 'in_hand' ? p.totalInPot : 0), 0)
const wonBy = (state: InternalGameState) =>
  Object.fromEntries((state.winners ?? []).map(winner => [winner.playerId, winner.amount]))

/** Finish the hand and set up the next one (a bust = stack set to 0 between hands). */
function nextHand(state: InternalGameState, edit?: (s: InternalGameState) => void): InternalGameState {
  let s = state
  while (s.phase === 'in_hand' && s.actingPlayerId) s = act(s, s.actingPlayerId, 'fold')
  s = prepareNextHand(s)
  edit?.(s)
  return startHand(s)
}

const roles = (state: InternalGameState) => ({
  button: state.players.find(p => p.isDealer)?.id,
  sb: state.players.find(p => p.isSB)?.id ?? null,
  bb: state.players.find(p => p.isBB)?.id,
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Incomplete all-in raises do not reopen the betting
// ---------------------------------------------------------------------------

describe('1. reopening the betting', () => {
  // Button A (seat 0), SB B, BB C, UTG D. Preflop order: D, A, B, C.
  it('an incomplete all-in does not reopen betting to players who already acted: call or fold only', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 130, D: 1000 }))
    expect(roles(s)).toEqual({ button: 'A', sb: 'B', bb: 'C' })
    expect(s.actingPlayerId).toBe('D')
    s = act(s, 'D', 'raise', 100) // raise of 80
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'fold')
    s = act(s, 'C', 'all_in') // 130: only 30 more, less than a full raise of 80
    expect(s.currentBet).toBe(130)
    expect(s.minRaise).toBe(210) // the last full raise (80) still sets the minimum

    expect(s.actingPlayerId).toBe('D')
    expect(canPlayerRaise(s, 'D')).toBe(false)
    expect(toTableState(s, 'D').canRaise).toBe(false)
    expect(() => act(s, 'D', 'raise', 300)).toThrow(/not reopened/)
    expect(() => act(s, 'D', 'all_in')).toThrow(/not reopened/)
    s = act(s, 'D', 'call')
    expect(player(s, 'D').bet).toBe(130)

    expect(s.actingPlayerId).toBe('A')
    expect(canPlayerRaise(s, 'A')).toBe(false)
    expect(() => act(s, 'A', 'raise', 1000)).toThrow(/not reopened/)
    s = act(s, 'A', 'call')

    expect(s.round).toBe('flop')
    expect(s.totalPot).toBe(130 * 3 + 10)
  })

  it('a full all-in raise reopens the betting', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 200, D: 1000 }))
    s = act(s, 'D', 'raise', 100)
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'fold')
    s = act(s, 'C', 'all_in') // 200: a raise of 100, at least the 80 before it
    expect(canPlayerRaise(s, 'D')).toBe(true)
    expect(toTableState(s, 'D').canRaise).toBe(true)
    expect(s.minRaise).toBe(300)
    expect(() => act(s, 'D', 'raise', 299)).toThrow(/Minimum raise is \$300/)
    s = act(s, 'D', 'raise', 300)
    expect(s.actingPlayerId).toBe('A')
    expect(canPlayerRaise(s, 'A')).toBe(true)
  })

  it('players who have not acted yet may re-raise after an incomplete all-in', () => {
    let s = startHand(table({ A: 130, B: 1000, C: 1000, D: 1000 }))
    s = act(s, 'D', 'raise', 100)
    s = act(s, 'A', 'all_in') // 130: incomplete
    expect(s.actingPlayerId).toBe('B')
    expect(canPlayerRaise(s, 'B')).toBe(true) // the small blind has not acted
    expect(() => act(s, 'B', 'raise', 209)).toThrow(/Minimum raise is \$210/)
    s = act(s, 'B', 'call')
    expect(canPlayerRaise(s, 'C')).toBe(true) // nor has the big blind
    s = act(s, 'C', 'call')
    // Back to the original raiser, who only faces the short all-in.
    expect(s.actingPlayerId).toBe('D')
    expect(canPlayerRaise(s, 'D')).toBe(false)
    s = act(s, 'D', 'call')
    expect(s.round).toBe('flop')
  })

  it('several short all-ins that add up to a full raise reopen the betting', () => {
    let s = startHand(table({ A: 220, B: 1000, C: 170, D: 1000 }))
    s = act(s, 'D', 'call')
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    s = act(s, 'C', 'check')
    expect(s.round).toBe('flop')
    expect(s.actingPlayerId).toBe('B') // first live player left of the button

    s = act(s, 'B', 'raise', 100) // bet 100
    s = act(s, 'C', 'all_in') // 150: short (+50)
    s = act(s, 'D', 'call') // D answers 150
    s = act(s, 'A', 'all_in') // 200: short again (+50), but +100 since B bet
    expect(s.currentBet).toBe(200)

    expect(s.actingPlayerId).toBe('B')
    expect(canPlayerRaise(s, 'B')).toBe(true) // faces a full raise in total
    expect(() => act(s, 'B', 'raise', 299)).toThrow(/Minimum raise is \$300/)
    s = act(s, 'B', 'call')

    expect(s.actingPlayerId).toBe('D')
    expect(canPlayerRaise(s, 'D')).toBe(false) // only 50 more since D acted
    expect(() => act(s, 'D', 'raise', 400)).toThrow(/not reopened/)
    s = act(s, 'D', 'call')
    expect(s.round).toBe('turn')
  })

  it('an opening all-in for less than the big blind does not reopen betting to a player who checked', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 30 }))
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    s = act(s, 'C', 'check')
    s = act(s, 'B', 'check')
    s = act(s, 'C', 'all_in') // 10, less than a 20 bet
    expect(s.currentBet).toBe(10)
    expect(s.minRaise).toBe(30)
    expect(canPlayerRaise(s, 'A')).toBe(true) // has not acted on this street
    expect(() => act(s, 'A', 'raise', 29)).toThrow(/Minimum raise is \$30/)
    s = act(s, 'A', 'call')
    expect(s.actingPlayerId).toBe('B')
    expect(canPlayerRaise(s, 'B')).toBe(false)
    s = act(s, 'B', 'call')
    expect(s.round).toBe('turn')
  })

  it('nobody may raise when everyone else is all-in', () => {
    let s = startHand(table({ A: 1000, B: 300, C: 1000 }))
    s = act(s, 'A', 'fold')
    s = act(s, 'B', 'all_in')
    expect(canPlayerRaise(s, 'C')).toBe(false)
    expect(() => act(s, 'C', 'raise', 1000)).toThrow(/Everyone else is all-in/)
    expect(() => act(s, 'C', 'all_in')).toThrow(/Everyone else is all-in/)
    s = act(s, 'C', 'call')
    expect(s.phase).toBe('between_hands')
  })
})

// ---------------------------------------------------------------------------
// 2. Minimum bets and raises
// ---------------------------------------------------------------------------

describe('2. minimum bet and raise', () => {
  it('preflop the big blind is the bet: the minimum raise is to two big blinds, then by the last full raise', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    expect(s.currentBet).toBe(20)
    expect(s.minRaise).toBe(40)
    expect(() => act(s, 'A', 'raise', 39)).toThrow(/Minimum raise is \$40/)
    expect(() => act(s, 'A', 'raise', 40.5)).toThrow(/whole number/)
    s = act(s, 'A', 'raise', 40)
    expect(s.minRaise).toBe(60)
    s = act(s, 'B', 'raise', 100) // raise of 60
    expect(s.minRaise).toBe(160)
    expect(() => act(s, 'C', 'raise', 159)).toThrow(/Minimum raise is \$160/)
    s = act(s, 'C', 'raise', 160)
    expect(s.currentBet).toBe(160)
  })

  it('postflop the minimum bet is the big blind', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    s = act(s, 'C', 'check')
    expect(s.minRaise).toBe(20)
    expect(() => act(s, 'B', 'raise', 19)).toThrow(/Minimum bet is \$20/)
    s = act(s, 'B', 'raise', 20)
    expect(() => act(s, 'C', 'raise', 39)).toThrow(/Minimum raise is \$40/)
    s = act(s, 'C', 'raise', 40)
    expect(s.currentBet).toBe(40)
  })

  it('an all-in for less than the minimum raise is allowed (by all-in or by a raise for the whole stack)', () => {
    let s = startHand(table({ A: 1000, B: 50, C: 1000 }))
    s = act(s, 'A', 'raise', 40)
    s = act(s, 'B', 'raise', 50) // whole stack: an incomplete raise, treated as all-in
    expect(player(s, 'B').status).toBe('all_in')
    expect(s.currentBet).toBe(50)
    expect(s.minRaise).toBe(70)

    let t = startHand(table({ A: 1000, B: 1000, C: 30 }))
    t = act(t, 'A', 'raise', 60)
    t = act(t, 'B', 'call')
    t = act(t, 'C', 'all_in') // a call for less
    expect(player(t, 'C').totalInPot).toBe(30)
    expect(player(t, 'A').totalInPot).toBe(60)
    expect(t.round).toBe('flop')
  })

  it('a short big blind still makes everyone call the full big blind', () => {
    const s = startHand(table({ A: 1000, B: 1000, C: 15 }))
    expect(player(s, 'C').status).toBe('all_in')
    expect(player(s, 'C').bet).toBe(15)
    expect(s.currentBet).toBe(20)
    const t = act(s, 'A', 'call')
    expect(player(t, 'A').bet).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// 3. Heads-up and button / blind movement
// ---------------------------------------------------------------------------

describe('3. heads-up, button and blinds', () => {
  it('heads-up the button posts the small blind, acts first preflop and last after the flop', () => {
    let s = startHand(table({ A: 1000, B: 1000 }))
    expect(roles(s)).toEqual({ button: 'A', sb: 'A', bb: 'B' })
    expect(s.actingPlayerId).toBe('A')
    s = act(s, 'A', 'call')
    expect(s.actingPlayerId).toBe('B') // big blind option
    s = act(s, 'B', 'check')
    expect(s.round).toBe('flop')
    expect(s.actingPlayerId).toBe('B')
    s = act(s, 'B', 'check')
    expect(s.actingPlayerId).toBe('A')

    s = nextHand(s)
    expect(roles(s)).toEqual({ button: 'B', sb: 'B', bb: 'A' })
    s = nextHand(s)
    expect(roles(s)).toEqual({ button: 'A', sb: 'A', bb: 'B' })
  })

  it('the blinds move one seat per hand with a full table', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000, D: 1000 }))
    const seen = [roles(s)]
    for (let i = 0; i < 4; i++) {
      s = nextHand(s)
      seen.push(roles(s))
    }
    expect(seen.map(r => r.bb)).toEqual(['C', 'D', 'A', 'B', 'C'])
    expect(seen.map(r => r.sb)).toEqual(['B', 'C', 'D', 'A', 'B'])
    expect(seen.map(r => r.button)).toEqual(['A', 'B', 'C', 'D', 'A'])
  })

  it('going from three players to heads-up never gives anyone the big blind twice in a row', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    expect(roles(s)).toEqual({ button: 'A', sb: 'B', bb: 'C' })
    s = nextHand(s, next => { player(next, 'A').stack = 0 }) // the button busts
    expect(roles(s)).toEqual({ button: 'C', sb: 'C', bb: 'B' })
    expect(s.actingPlayerId).toBe('C')
  })

  it('when the big blind busts, the big blind still moves forward one player and the small blind is dead', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000, D: 1000 }))
    expect(roles(s)).toEqual({ button: 'A', sb: 'B', bb: 'C' })
    s = nextHand(s, next => { player(next, 'C').stack = 0 })
    expect(roles(s)).toEqual({ button: 'B', sb: null, bb: 'D' })
    expect(s.totalPot).toBe(20)
    expect(s.actingPlayerId).toBe('A')
    s = nextHand(s)
    expect(roles(s)).toEqual({ button: 'B', sb: 'D', bb: 'A' })
    s = nextHand(s)
    expect(roles(s)).toEqual({ button: 'D', sb: 'A', bb: 'B' })
    s = nextHand(s)
    expect(roles(s).bb).toBe('D')
  })

  it('when the small blind busts, the next player still gets the big blind', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000, D: 1000 }))
    s = nextHand(s, next => { player(next, 'B').stack = 0 })
    expect(roles(s)).toEqual({ button: 'A', sb: 'C', bb: 'D' })
  })

  it('a new player can join between hands without a double blind or a crash', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }, { seats: [0, 2, 4] }))
    expect(roles(s)).toEqual({ button: 'A', sb: 'B', bb: 'C' })
    s = nextHand(s, next => {
      next.players.push({ ...newPlayer('N', 3, 1000), status: 'waiting' })
      next.players.sort((a, b) => a.seatIndex - b.seatIndex)
    })
    const r = roles(s)
    expect(r.bb).toBe('A') // forward one from C
    expect(r.sb).toBe('C')
    expect(new Set([r.button, r.sb, r.bb]).size).toBe(3)
  })

  it('random busts, rebuys, joins and sit-outs: one big blind, no double blind, and nobody skips the big blind', () => {
    const rng = mulberry32(99)
    vi.spyOn(Math, 'random').mockImplementation(rng)
    let s = startHand(table({ A: 1000, B: 1000, C: 1000, D: 1000, E: 1000, F: 1000 }, { seats: [0, 1, 3, 4, 6, 7] }))
    let previousBb: number | null = null
    for (let hand = 0; hand < 600; hand++) {
      const dealt = s.players.filter(p => p.holeCards.length === 2)
      const sbs = s.players.filter(p => p.isSB)
      const bbs = s.players.filter(p => p.isBB)
      expect(bbs).toHaveLength(1)
      expect(sbs.length).toBeLessThanOrEqual(1)
      expect(s.players.some(p => p.isSB && p.isBB)).toBe(false)
      if (dealt.length === 2) expect(sbs[0]?.isDealer).toBe(true)
      const bbSeat = bbs[0]!.seatIndex
      if (previousBb !== null) {
        expect(bbSeat).not.toBe(previousBb)
        const gap = (bbSeat - previousBb + 8) % 8
        const skipped = dealt.filter(p => {
          const offset = (p.seatIndex - previousBb! + 8) % 8
          return offset > 0 && offset < gap
        })
        expect(skipped).toEqual([])
      }
      previousBb = bbSeat
      s = nextHand(s, next => {
        for (const p of next.players) {
          const roll = rng()
          if (roll < 0.06) p.stack = 0 // bust
          else if (roll < 0.1 && p.stack === 0) { p.stack = 1000; p.status = 'waiting' } // rebuy
          else if (roll < 0.13) p.status = p.status === 'sitting_out' && p.stack > 0 ? 'waiting' : 'sitting_out'
        }
        if (next.players.filter(p => p.stack > 0 && p.status !== 'sitting_out').length < 2) {
          for (const p of next.players) { p.stack = 1000; p.status = 'waiting' }
          previousBb = null
        }
      })
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Big blind option, check-around, postflop order
// ---------------------------------------------------------------------------

describe('4. big blind option and action order', () => {
  it('when everyone limps the big blind gets the option, and a check closes preflop', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    expect(s.round).toBe('preflop')
    expect(s.actingPlayerId).toBe('C')
    expect(canPlayerRaise(s, 'C')).toBe(true)
    expect(toTableState(s, 'C').canRaise).toBe(true)
    s = act(s, 'C', 'check')
    expect(s.round).toBe('flop')
    expect(s.communityCards).toHaveLength(3)
    expect(s.actingPlayerId).toBe('B') // first live player left of the button
  })

  it('the big blind may raise its option and everyone acts again', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    s = act(s, 'C', 'raise', 60)
    expect(s.actingPlayerId).toBe('A')
    expect(canPlayerRaise(s, 'A')).toBe(true)
  })

  it('a check-around ends each street; postflop action starts left of the button, skipping folded players', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000, D: 1000 }))
    s = act(s, 'D', 'call')
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'fold')
    s = act(s, 'C', 'check')
    expect(s.round).toBe('flop')
    expect(s.actingPlayerId).toBe('C')
    s = act(s, 'C', 'check')
    s = act(s, 'D', 'check')
    expect(s.round).toBe('flop')
    s = act(s, 'A', 'check')
    expect(s.round).toBe('turn')
    expect(s.communityCards).toHaveLength(4)
    expect(s.actingPlayerId).toBe('C')
  })

  it('a bet makes everyone who checked act again before the street ends', () => {
    let s = startHand(table({ A: 1000, B: 1000, C: 1000 }))
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'call')
    s = act(s, 'C', 'check')
    s = act(s, 'B', 'check')
    s = act(s, 'C', 'raise', 50)
    s = act(s, 'A', 'call')
    expect(s.actingPlayerId).toBe('B')
    s = act(s, 'B', 'call')
    expect(s.round).toBe('turn')
  })
})

// ---------------------------------------------------------------------------
// 5. Side pots and odd chips
// ---------------------------------------------------------------------------

describe('5. side pots', () => {
  it('builds main and side pots from all-ins of different sizes and pays only eligible players', () => {
    // Button A, SB B, BB C, UTG D.
    let s = startHand(table({ A: 100, B: 200, C: 1000, D: 50 }))
    s = rig(s, { D: 'Ah Ad', A: 'Kh Kd', B: 'Qh Qd', C: '7c 2d' }, '3s 8c 9d Js 4h')
    s = act(s, 'D', 'all_in') // 50
    s = act(s, 'A', 'all_in') // 100
    s = act(s, 'B', 'all_in') // 200
    expect(() => act(s, 'C', 'all_in')).toThrow(/Everyone else is all-in/)
    s = act(s, 'C', 'call') // 200
    expect(s.phase).toBe('between_hands')
    expect(s.pots).toEqual([
      { amount: 200, eligiblePlayerIds: ['A', 'B', 'C', 'D'] },
      { amount: 150, eligiblePlayerIds: ['A', 'B', 'C'] },
      { amount: 200, eligiblePlayerIds: ['B', 'C'] },
    ])
    expect(wonBy(s)).toEqual({ D: 200, A: 150, B: 200 })
    expect(Object.fromEntries(s.players.map(p => [p.id, p.stack]))).toEqual({ A: 150, B: 200, C: 800, D: 200 })
    expect(totalChips(s)).toBe(1350)
  })

  it('folded players chips stay in the pot, and a folded hand never wins', () => {
    // C (big blind) folds the nuts to a shove; their 20 stays in the pot.
    let s = startHand(table({ A: 1000, B: 300, C: 1000 }))
    s = rig(s, { A: '2c 7d', B: '3c 3d', C: 'As Ks' }, 'Qs Js Ts 9h 4c')
    s = act(s, 'A', 'all_in')
    s = act(s, 'B', 'call') // all-in for 300
    s = act(s, 'C', 'fold')
    expect(s.phase).toBe('between_hands')
    // A's 700 more than B could match was never called: returned before the showdown.
    expect(s.recentActions).toContain('$700 uncalled returned to A')
    expect(wonBy(s)).toEqual({ B: 620 })
    expect(player(s, 'A').stack).toBe(700)
    expect(player(s, 'B').stack).toBe(620)
    expect(player(s, 'C').stack).toBe(980)
    expect(totalChips(s)).toBe(2300)
  })

  it('pot eligibility only counts hands still in play', () => {
    const pots = buildSidePots([
      { id: 'a', status: 'all_in', totalInPot: 50 },
      { id: 'b', status: 'folded', totalInPot: 100 },
      { id: 'c', status: 'active', totalInPot: 100 },
      { id: 'd', status: 'sitting_out', totalInPot: 0 },
    ])
    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ['a', 'c'] },
      { amount: 100, eligiblePlayerIds: ['c'] },
    ])
  })

  it('an odd chip goes to the first winner left of the button', () => {
    // Blinds 5/10. Button p0 (seat 0), SB p1, BB p2, UTG p3. Pot 35, p0 and p3 split.
    let s = startHand(table({ p0: 1000, p1: 1000, p2: 1000, p3: 1000 }, { blinds: [5, 10] }))
    s = rig(s, { p0: 'Jh Th', p3: 'Jd Tc', p2: '3c 4d', p1: 'Qc Qh' }, 'As Ks Qd 7c 2h')
    s = act(s, 'p3', 'call')
    s = act(s, 'p0', 'call')
    s = act(s, 'p1', 'fold')
    s = act(s, 'p2', 'check')
    for (let street = 0; street < 3; street++) {
      s = act(s, 'p2', 'check')
      s = act(s, 'p3', 'check')
      s = act(s, 'p0', 'check')
    }
    expect(s.round).toBe('showdown')
    expect(wonBy(s)).toEqual({ p3: 18, p0: 17 })
  })

  it('the board plays: a three-way split hands the two odd chips to the first winners left of the button', () => {
    let s = startHand(table({ p0: 1000, p1: 1000, p2: 1000, p3: 1000 }, { blinds: [5, 10] }))
    s = rig(s, { p0: '2c 3d', p2: '4c 5d', p3: '2h 3h', p1: '6c 7c' }, 'Ts Js Qs Ks As')
    s = act(s, 'p3', 'call')
    s = act(s, 'p0', 'call')
    s = act(s, 'p1', 'fold')
    s = act(s, 'p2', 'check')
    for (let street = 0; street < 3; street++) {
      s = act(s, 'p2', 'check')
      s = act(s, 'p3', 'check')
      s = act(s, 'p0', 'check')
    }
    expect(wonBy(s)).toEqual({ p2: 12, p3: 12, p0: 11 })
    expect(s.winners?.every(winner => winner.handDescription === 'Royal Flush')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Hand evaluation
// ---------------------------------------------------------------------------

describe('6. hand evaluation', () => {
  const evaluate = (codes: string) => evaluateHand(cards(codes))
  const beats = (a: string, b: string) => compareHands(evaluate(a), evaluate(b))

  it('ranks every category in order', () => {
    const ladder = [
      'As Kd 9c 7h 4s 3d 2c', // high card
      'As Ad 9c 7h 4s 3d 2c', // pair
      'As Ad 9c 9h 4s 3d 2c', // two pair
      'As Ad Ac 9h 4s 3d 2c', // trips
      '5s 6d 7c 8h 9s 2d 2c', // straight
      'As 9s 7s 4s 2s 3d 3c', // flush
      'As Ad Ac 9h 9s 3d 2c', // full house
      'As Ad Ac Ah 9s 3d 2c', // quads
      '5s 6s 7s 8s 9s 2d 2c', // straight flush
      'Ts Js Qs Ks As 2d 2c', // royal flush
    ]
    ladder.forEach((hand, index) => {
      expect(evaluate(hand).rankIndex).toBe(index)
      if (index > 0) expect(beats(hand, ladder[index - 1]!)).toBeGreaterThan(0)
    })
  })

  it('kickers, the wheel, the steel wheel and the board playing', () => {
    expect(beats('As Ad Kc 9h 4s 3d 2c', 'Ah Ac Qc 9d 4h 3s 2d')).toBeGreaterThan(0) // pair, kicker
    expect(beats('As Ad Kc Kh 4s 3d 2c', 'Ah Ac Kd Ks 3s 2d 2h')).toBeGreaterThan(0) // two pair, kicker
    expect(evaluate('As 2d 3c 4h 5s 9d Kc').description).toBe('Straight, Five-high')
    expect(beats('2s 3d 4c 5h 6s 9d Kc', 'As 2d 3c 4h 5s 9d Kc')).toBeGreaterThan(0) // six-high beats the wheel
    expect(evaluate('As 2s 3s 4s 5s 9d Kc').description).toBe('Straight Flush, Five-high')
    expect(beats('6s 2s 3s 4s 5s 9d Kc', 'As 2s 3s 4s 5s 9d Kh')).toBeGreaterThan(0)
    // Board plays: both hole cards below the board's kickers.
    expect(beats('2c 3d As Ks Qd Jh 9c', '4c 5d As Ks Qd Jh 9c')).toBe(0)
    // Three pairs: best two plus the best remaining card as kicker.
    expect(evaluate('As Ad Kc Kh Qs Qd 2c').tiebreakers).toEqual([14, 13, 12])
    // Two sets: full house, the higher set full of the lower.
    expect(evaluate('9s 9d 9c 4h 4s 4d 2c').description).toBe('Full House, Nines full of Fours')
    // Flush beats straight on the same seven cards' worth of options.
    expect(evaluate('4s 5s 6s 7d 8s Ks 2c').rank).toBe('flush')
  })

  it('matches a brute-force best-5-of-7 reference on random hands', () => {
    const rng = mulberry32(2026)
    const deck = createDeck()
    const draw = (n: number) => {
      const pool = [...deck]
      const hand: Card[] = []
      for (let i = 0; i < n; i++) hand.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!)
      return hand
    }
    for (let i = 0; i < 4000; i++) {
      const a = draw(7)
      const b = draw(7)
      const ea = evaluateHand(a)
      const eb = evaluateHand(b)
      const ra = bestReferenceHand(a)
      const rb = bestReferenceHand(b)
      expect(ea.rankIndex).toBe(ra.category)
      expect(ea.description).toBe(ra.description)
      expect(Math.sign(compareHands(ea, eb))).toBe(Math.sign(compareReference(ra, rb)))
      // The highlighted five are a real best hand.
      expect(compareReference(bestReferenceHand(ea.cards), ra)).toBe(0)
    }
  })

  it('matches the reference when two hands share a board (ties included)', () => {
    const rng = mulberry32(77)
    let ties = 0
    for (let i = 0; i < 3000; i++) {
      const pool = [...createDeck()]
      const take = () => pool.splice(Math.floor(rng() * pool.length), 1)[0]!
      const board = [take(), take(), take(), take(), take()]
      const a = [take(), take(), ...board]
      const b = [take(), take(), ...board]
      const engine = Math.sign(compareHands(evaluateHand(a), evaluateHand(b)))
      const reference = Math.sign(compareReference(bestReferenceHand(a), bestReferenceHand(b)))
      expect(engine).toBe(reference)
      if (reference === 0) ties += 1
    }
    expect(ties).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 7 & 8. Showdown and chip conservation
// ---------------------------------------------------------------------------

describe('7. showdown', () => {
  it('a bet nobody calls takes the whole pot (the bettor gets their own chips back with it)', () => {
    let s = startHand(table({ A: 1000, B: 1000 }))
    s = rig(s, { A: 'Ah Kh', B: 'Qc Qd' }, '2s 7d 9c Jh 3s')
    s = act(s, 'A', 'call')
    s = act(s, 'B', 'check')
    for (let street = 0; street < 2; street++) {
      s = act(s, 'B', 'check')
      s = act(s, 'A', 'check')
    }
    s = act(s, 'B', 'check')
    s = act(s, 'A', 'raise', 100)
    s = act(s, 'B', 'fold')
    // A won by a fold: every chip in the pot goes to A (40 of it was theirs).
    expect(wonBy(s)).toEqual({ A: 140 })
    expect(player(s, 'A').stack).toBe(1020)
  })

  it('an all-in for more than the caller has: the excess comes back before the cards are judged', () => {
    let s = startHand(table({ A: 1000, B: 400 }))
    s = rig(s, { A: '7c 2d', B: 'Ac Ad' }, 'Ks 8h 5c 3d 9s')
    s = act(s, 'A', 'all_in')
    s = act(s, 'B', 'call')
    expect(s.recentActions).toContain('$600 uncalled returned to A')
    expect(wonBy(s)).toEqual({ B: 800 })
    expect(player(s, 'A').stack).toBe(600)
    expect(s.pots).toEqual([{ amount: 800, eligiblePlayerIds: ['A', 'B'] }])
  })
})

describe('7b. run it twice', () => {
  it('a hand that ends during the run-it-twice vote (a player leaves) is paid once, never again by a late vote', () => {
    const humans = table({ A: 1000, B: 400 })
    humans.players.forEach(p => { p.isBot = false })
    let s = startHand(humans)
    s = act(s, 'A', 'raise', 600)
    s = act(s, 'B', 'call') // all-in for 400: A's other 200 goes back
    expect(s.runItTwice?.status).toBe('voting')
    expect(player(s, 'A').stack).toBe(600)
    s = voteRunItTwice(s, 'A', 'yes')
    s = foldLeavingPlayer(s, 'A')
    expect(s.phase).toBe('between_hands')
    expect(wonBy(s)).toEqual({ B: 800 })
    expect(s.runItTwice).toBeUndefined()
    expect(() => voteRunItTwice(s, 'B', 'yes')).toThrow()
    expect(player(s, 'A').stack + player(s, 'B').stack).toBe(1400)
  })
})

describe('8. chip conservation', () => {
  it('random legal play never creates or loses a chip, and only legal raises are accepted', () => {
    const rng = mulberry32(4242)
    vi.spyOn(Math, 'random').mockImplementation(rng)
    let s = startHand(table({ A: 1000, B: 600, C: 1500, D: 300, E: 1000 }, { seats: [0, 2, 3, 5, 7] }))
    let total = totalChips(s)
    let raises = 0
    let closed = 0
    for (let step = 0; step < 40_000 && s.handNumber < 400; step++) {
      if (s.phase !== 'in_hand' || !s.actingPlayerId) {
        expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(total)
        s = prepareNextHand(s)
        // Busted players rebuy: that adds chips, so the total moves with it.
        for (const p of s.players) if (p.stack === 0) { p.stack = 500; p.status = 'waiting' }
        total = s.players.reduce((sum, p) => sum + p.stack, 0)
        s = startHand(s)
        expect(totalChips(s)).toBe(total)
        continue
      }
      const before = totalChips(s)
      const id = s.actingPlayerId
      const me = player(s, id)
      const mayRaise = canPlayerRaise(s, id)
      if (!mayRaise && me.stack + me.bet > s.currentBet) closed += 1
      const roll = rng()
      const raiseTo = s.minRaise + Math.floor(rng() * 3) * s.bigBlind
      const action: [Action, number?] = roll < 0.15 ? ['fold']
        : roll < 0.6 ? [me.bet >= s.currentBet ? 'check' : 'call']
          : roll < 0.85 ? ['raise', Math.min(raiseTo, me.stack + me.bet)]
            : ['all_in']
      let next: InternalGameState
      try {
        next = act(s, id, action[0], action[1])
      } catch {
        // Only a raise can be refused, and only when it really is illegal.
        expect(['raise', 'all_in']).toContain(action[0])
        const allIn = action[0] === 'all_in' || action[1] === me.stack + me.bet
        const bigEnough = allIn || action[1]! >= s.minRaise
        expect(mayRaise && bigEnough).toBe(false)
        next = act(s, id, me.bet >= s.currentBet ? 'check' : 'call')
      }
      if (next.players.find(p => p.id === id)!.totalInPot - me.totalInPot > s.currentBet - me.bet) raises += 1
      s = next
      expect(totalChips(s)).toBe(before)
      for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0)
      if (s.phase === 'in_hand') {
        const potSum = buildSidePots(s.players).reduce((sum, pot) => sum + pot.amount, 0)
        expect(potSum).toBe(s.players.reduce((sum, p) => sum + p.totalInPot, 0))
      }
    }
    expect(s.handNumber).toBeGreaterThan(100)
    expect(raises).toBeGreaterThan(50)
    expect(closed).toBeGreaterThan(0)
  })
})
