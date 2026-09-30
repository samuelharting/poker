import { describe, expect, it } from 'vitest'
import { advanceRound, createInitialGameState, processAction, startHand, voteRunItTwice } from '@/lib/poker/engine'
import type { InternalGameState, InternalPlayer } from '@/lib/poker/types'

function table(count: number): InternalGameState {
  const state = createInitialGameState('RIT')
  for (let index = 0; index < count; index += 1) {
    const player: InternalPlayer = {
      id: `p${index}`,
      nickname: `P${index}`,
      stack: 1000,
      bet: 0,
      totalInPot: 0,
      status: 'waiting',
      isDealer: false,
      isSB: false,
      isBB: false,
      holeCards: [],
      showCards: 'none',
      isConnected: true,
      seatIndex: index,
      hasActedThisRound: false,
    }
    state.players.push(player)
  }
  return state
}

const key = (card: { rank: string; suit: string }) => `${card.rank}${card.suit}`

/** Plays checks/calls until `street` cards are out, then shoves and calls. */
function allInAt(players: number, street: 0 | 3 | 4): InternalGameState {
  let state = startHand(table(players))
  let guard = 0
  while (state.communityCards.length < street && state.phase === 'in_hand' && guard < 50) {
    guard += 1
    const acting = state.actingPlayerId
    if (!acting) {
      state = advanceRound(state)
      continue
    }
    const player = state.players.find(candidate => candidate.id === acting)!
    state = processAction(state, acting, player.bet >= state.currentBet ? 'check' : 'call')
  }
  guard = 0
  let shoved = false
  while (state.actingPlayerId && guard < 20) {
    guard += 1
    state = processAction(state, state.actingPlayerId, shoved ? 'call' : 'all_in')
    shoved = true
  }
  return state
}

describe('run it twice never deals a card twice', () => {
  for (const players of [2]) {
    for (const street of [0, 3, 4] as const) {
      it(`${players} players, all-in with ${street} board cards out`, () => {
        let ran = 0
        for (let hand = 0; hand < 150; hand += 1) {
          let state = allInAt(players, street)
          if (state.runItTwice?.status !== 'voting') continue
          for (const id of state.runItTwice.eligiblePlayerIds) state = voteRunItTwice(state, id, 'yes')
          expect(state.runItTwice?.status).toBe('accepted')
          ran += 1
          const boards = state.runItTwice!.boards!.map(board => board.cards)
          const shared = boards[0]!.filter((card, index) => key(card) === key(boards[1]![index]!))
          const cards = [
            ...state.players.flatMap(player => player.holeCards),
            ...boards[0]!,
            ...boards[1]!.slice(shared.length),
          ].map(key)
          expect(new Set(cards).size, `duplicate in ${cards.join(' ')}`).toBe(cards.length)
          for (const board of boards) expect(board).toHaveLength(5)
        }
        expect(ran).toBeGreaterThan(20)
      })
    }
  }
})
