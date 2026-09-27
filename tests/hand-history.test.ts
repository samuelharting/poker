import { describe, expect, it } from 'vitest'
import type { Room } from 'partykit/server'
import PokerRoom from '@/partykit/room'
import {
  HAND_HISTORY_LIMIT,
  buildHandHistoryEntry,
  getRabbitHuntCardCount,
  upsertHandHistory,
} from '@/lib/poker/handHistory'
import type { HandHistoryEntry, SeatPlayer, TableState } from '@/lib/poker/types'
import type { S2CMessage } from '@/shared/protocol'

function seat(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'p',
    nickname: 'P',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'waiting',
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

function endedState(overrides: Partial<TableState> = {}): TableState {
  return {
    roomCode: 'ROOM01',
    phase: 'between_hands',
    serverNow: 1,
    round: 'showdown',
    players: [
      seat({ id: 'a', nickname: 'Alice', holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }] }),
      seat({ id: 'b', nickname: 'Bob', seatIndex: 1, holeCards: [{ rank: 'K', suit: 'clubs' }, { rank: 'Q', suit: 'clubs' }] }),
      seat({ id: 'c', nickname: 'Cleo', seatIndex: 2, status: 'folded' }),
    ],
    communityCards: [
      { rank: '2', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: '3', suit: 'spades' },
    ],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 4,
    recentActions: [],
    lobbyPlayers: [],
    winners: [{ playerId: 'a', amount: 240, handDescription: 'Pair of Aces' }],
    ...overrides,
  }
}

describe('hand history', () => {
  it('counts rabbit-hunt cards from the latest action only', () => {
    expect(getRabbitHuntCardCount(['Rabbit hunt: flop As Kh Qd | turn Jc | river 10s'])).toBe(5)
    expect(getRabbitHuntCardCount(['Rabbit hunt: turn Jc | river 10s'])).toBe(2)
    expect(getRabbitHuntCardCount(['Rabbit hunt: river 10s'])).toBe(1)
    expect(getRabbitHuntCardCount(['Alice wins $40', 'Rabbit hunt: river 10s'])).toBe(0)
    expect(getRabbitHuntCardCount([])).toBe(0)
  })

  it('summarises winners, the played board and only the hands the table saw', () => {
    const entry = buildHandHistoryEntry(endedState(), 1234)

    expect(entry).toMatchObject({
      handNumber: 4,
      endedAt: 1234,
      endedBy: 'showdown',
      pot: 240,
      winners: [{ playerId: 'a', nickname: 'Alice', amount: 240, handDescription: 'Pair of Aces' }],
    })
    expect(entry?.board).toHaveLength(5)
    expect(entry?.shown.map(hand => hand.nickname)).toEqual(['Alice', 'Bob'])
  })

  it('leaves rabbit-hunt cards off the board and marks fold wins', () => {
    const entry = buildHandHistoryEntry(endedState({
      round: null,
      players: [seat({ id: 'a', nickname: 'Alice' }), seat({ id: 'b', nickname: 'Bob', status: 'folded' })],
      recentActions: ['Rabbit hunt: turn Jc | river 3s'],
      winners: [{ playerId: 'a', amount: 30 }],
    }), 1)

    expect(entry?.endedBy).toBe('fold')
    expect(entry?.board).toHaveLength(3)
    expect(entry?.shown).toEqual([])
  })

  it('keeps one entry per hand, newest first, capped', () => {
    let history: HandHistoryEntry[] = []
    for (let handNumber = 1; handNumber <= HAND_HISTORY_LIMIT + 3; handNumber += 1) {
      history = upsertHandHistory(history, buildHandHistoryEntry(endedState({ handNumber }), handNumber)!)
    }
    history = upsertHandHistory(history, { ...history[0]!, pot: 999 })

    expect(history).toHaveLength(HAND_HISTORY_LIMIT)
    expect(history[0]).toMatchObject({ handNumber: HAND_HISTORY_LIMIT + 3, pot: 999 })
    expect(history.at(-1)?.handNumber).toBe(4)
  })
})

describe('PokerRoom hand history snapshot', () => {
  it('publishes completed hands without leaking private hole cards', () => {
    const connections = new Map<string, { id: string; messages: S2CMessage[] }>()
    const room = {
      id: 'HIST01',
      storage: { setAlarm: () => {}, deleteAlarm: () => {} },
      getConnection: (id: string) => connections.get(id),
      getConnections: () => connections.values(),
    }
    const server = new PokerRoom(room as unknown as Room)
  // Random thirst off unless a test turns it on.
  server.autoBeerRandom = () => 1
    const join = (id: string, nickname: string) => {
      const connection = {
        id,
        uri: `ws://mock/${id}`,
        readyState: 1,
        messages: [] as S2CMessage[],
        send(message: string) { this.messages.push(JSON.parse(message) as S2CMessage) },
        setState() {},
        serializeAttachment() {},
        deserializeAttachment() { return null },
      }
      connections.set(id, connection)
      server.onConnect(connection as never)
      server.onMessage(JSON.stringify({ type: 'join_room', nickname, email: `${id}@x.com`, venmoUsername: `@${id}` }), connection as never)
      server.onMessage(JSON.stringify({ type: 'seat_me' }), connection as never)
      const session = [...connection.messages].reverse().find(message => message.type === 'private_session')
      return { connection, playerId: (session as Extract<S2CMessage, { type: 'private_session' }>).yourId }
    }
    const alice = join('alice', 'Alice')
    const bob = join('bob', 'Bob')

    const internals = server as unknown as {
      data: {
        gameState: {
          phase: string
          round: string | null
          handNumber: number
          communityCards: unknown[]
          players: Array<{ id: string; holeCards: unknown[]; showCards: string; status: string }>
          winners?: Array<{ playerId: string; amount: number }>
        }
      }
      recordCompletedHandStats: () => void
      buildSnapshotFor: (connId: string) => Extract<S2CMessage, { type: 'room_snapshot' }>
    }

    const state = internals.data.gameState
    state.phase = 'between_hands'
    state.round = null
    state.handNumber = 1
    for (const player of state.players) {
      player.holeCards = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]
      player.showCards = 'none'
      player.status = player.id === bob.playerId ? 'folded' : 'waiting'
    }
    state.winners = [{ playerId: alice.playerId, amount: 30 }]
    internals.recordCompletedHandStats()

    const history = internals.buildSnapshotFor(bob.connection.id).state.handHistory ?? []
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      handNumber: 1,
      endedBy: 'fold',
      winners: [{ playerId: alice.playerId, nickname: 'Alice', amount: 30 }],
      shown: [],
    })

    // Alice chooses to show after the fold win: the entry picks it up.
    server.onMessage(JSON.stringify({ type: 'set_show_cards', mode: 'both' }), alice.connection as never)
    const refreshed = internals.buildSnapshotFor(bob.connection.id).state.handHistory ?? []
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.shown).toEqual([
      { playerId: alice.playerId, nickname: 'Alice', cards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }] },
    ])
  })
})
