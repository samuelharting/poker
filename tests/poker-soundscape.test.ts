import { describe, expect, it } from 'vitest'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'
import {
  DEFAULT_POKER_SOUND_PREFERENCES,
  POKER_SOUND_PREFERENCES_STORAGE_KEY,
  advancePokerSoundEventCursor,
  createPokerSoundEventCursor,
  derivePokerSoundEvents,
  loadPokerSoundPreferences,
  normalizePokerSoundPreferences,
  savePokerSoundPreferences,
  type PokerSoundPreferenceStorage,
} from '@/lib/poker/soundscape'

function makePlayer(overrides: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id: 'hero',
    nickname: 'Hero',
    stack: 980,
    bet: 20,
    totalInPot: 20,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: true,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

function makeState(overrides: Partial<TableState> = {}): TableState {
  return {
    roomCode: 'ABC123',
    phase: 'in_hand',
    serverNow: 1,
    round: 'preflop',
    players: [makePlayer()],
    communityCards: [],
    pots: [],
    totalPot: 30,
    currentBet: 20,
    minRaise: 40,
    actingPlayerId: 'hero',
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: 1,
    actionTimerDuration: 30_000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: true,
    sevenTwoBountyPercent: 2,
    handNumber: 1,
    actionSequence: 0,
    recentActions: [],
    lobbyPlayers: [],
    ...overrides,
  }
}

const flop: Card[] = [
  { rank: 'A', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
  { rank: 'Q', suit: 'clubs' },
]

describe('poker sound event derivation', () => {
  it('keeps initial, room-change, and reconnect baselines silent', () => {
    const snapshot = makeState()
    expect(derivePokerSoundEvents(undefined, snapshot, 'hero')).toEqual([])
    expect(derivePokerSoundEvents(
      makeState({ roomCode: 'OLD' }),
      snapshot,
      'hero'
    )).toEqual([])

    let frame = advancePokerSoundEventCursor(createPokerSoundEventCursor(), snapshot, 'hero')
    expect(frame.events).toEqual([])
    frame = advancePokerSoundEventCursor(frame.cursor, undefined, 'hero')
    expect(frame.events).toEqual([])
    frame = advancePokerSoundEventCursor(frame.cursor, snapshot, 'hero')
    expect(frame.events).toEqual([])
  })

  it('derives a stable player action once and deduplicates its action id', () => {
    const before = makeState({
      actingPlayerId: 'villain',
      players: [
        makePlayer(),
        makePlayer({ id: 'villain', nickname: 'Villain', seatIndex: 1, isBB: false }),
      ],
    })
    const after = makeState({
      actionSequence: 4,
      players: [
        makePlayer(),
        makePlayer({
          id: 'villain',
          nickname: 'Villain',
          seatIndex: 1,
          isBB: false,
          lastAction: 'Raised $80',
          lastActionId: '1:4',
        }),
      ],
    })

    let frame = advancePokerSoundEventCursor(
      { previous: before, seenEventIds: [] },
      after,
      'hero'
    )
    expect(frame.events).toMatchObject([
      { id: 'ABC123:action:villain:1:4', kind: 'raise', playerId: 'villain' },
      { kind: 'your_turn', playerId: 'hero' },
    ])

    frame = advancePokerSoundEventCursor(frame.cursor, after, 'hero')
    expect(frame.events).toEqual([])

    const withoutAction = makeState({
      ...after,
      players: after.players.map(player => player.id === 'villain'
        ? { ...player, lastAction: undefined, lastActionId: undefined }
        : player),
    })
    frame = advancePokerSoundEventCursor(frame.cursor, withoutAction, 'hero')
    frame = advancePokerSoundEventCursor(frame.cursor, after, 'hero')
    expect(frame.events).toEqual([])
  })

  it('emits hand start and a first-actor turn cue on a new hand', () => {
    const before = makeState({
      phase: 'between_hands',
      round: null,
      handNumber: 1,
      actingPlayerId: null,
    })
    const after = makeState({ handNumber: 2, actionSequence: 7 })

    expect(derivePokerSoundEvents(before, after, 'hero').map(event => event.kind)).toEqual([
      'hand_start',
      'your_turn',
    ])
  })

  it('emits every crossed board street when a snapshot jumps to the river', () => {
    const before = makeState({ actingPlayerId: 'villain' })
    const after = makeState({
      actingPlayerId: 'villain',
      round: 'river',
      communityCards: [
        ...flop,
        { rank: '2', suit: 'diamonds' },
        { rank: '9', suit: 'spades' },
      ],
    })

    const events = derivePokerSoundEvents(before, after, 'hero')
    expect(events.map(event => event.kind)).toEqual([
      'board_flop',
      'board_turn',
      'board_river',
    ])
    expect(events.map(event => event.id)).toEqual([
      'ABC123:1:board:flop',
      'ABC123:1:board:turn',
      'ABC123:1:board:river',
    ])
  })

  it('notifies a repeated hero turn when the street or action sequence advances', () => {
    const before = makeState({
      round: 'flop',
      actionSequence: 8,
      actingPlayerId: 'hero',
      communityCards: flop,
    })
    const after = makeState({
      round: 'turn',
      actionSequence: 9,
      actingPlayerId: 'hero',
      communityCards: [...flop, { rank: '2', suit: 'diamonds' }],
    })

    expect(derivePokerSoundEvents(before, after, 'hero').map(event => event.kind)).toEqual([
      'board_turn',
      'your_turn',
    ])
  })

  it('emits a fold-win cue but omits true-showdown winner and payout cues', () => {
    const before = makeState({ actingPlayerId: 'villain' })
    const foldWin = makeState({
      phase: 'between_hands',
      round: null,
      actingPlayerId: null,
      winners: [{ playerId: 'hero', amount: 30 }],
    })
    const showdown = makeState({
      phase: 'between_hands',
      round: 'showdown',
      actingPlayerId: null,
      communityCards: [
        ...flop,
        { rank: '2', suit: 'diamonds' },
        { rank: '9', suit: 'spades' },
      ],
      winners: [{ playerId: 'hero', amount: 120, handDescription: 'Straight' }],
    })

    expect(derivePokerSoundEvents(before, foldWin, 'hero').map(event => event.kind)).toEqual([
      'fold_win',
    ])
    expect(derivePokerSoundEvents(before, showdown, 'hero').map(event => event.kind)).toEqual([
      'board_flop',
      'board_turn',
      'board_river',
    ])
  })
})

describe('poker sound preferences', () => {
  it('normalizes partial values and clamps volume', () => {
    expect(normalizePokerSoundPreferences({ muted: true, volume: 4 })).toEqual({
      muted: true,
      volume: 1,
    })
    expect(normalizePokerSoundPreferences({ volume: -2 })).toEqual({
      muted: false,
      volume: 0,
    })
    expect(normalizePokerSoundPreferences({ muted: 'yes', volume: Number.NaN })).toEqual(
      DEFAULT_POKER_SOUND_PREFERENCES
    )
  })

  it('loads and saves through a storage-compatible object', () => {
    const values = new Map<string, string>()
    const storage: PokerSoundPreferenceStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
    }

    expect(loadPokerSoundPreferences(storage)).toEqual(DEFAULT_POKER_SOUND_PREFERENCES)
    expect(savePokerSoundPreferences({ muted: true, volume: 0.4 }, storage)).toBe(true)
    expect(values.get(POKER_SOUND_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ muted: true, volume: 0.4 })
    )
    expect(loadPokerSoundPreferences(storage)).toEqual({ muted: true, volume: 0.4 })
  })

  it('falls back safely when storage access or JSON parsing fails', () => {
    const throwingStorage: PokerSoundPreferenceStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const malformedStorage: PokerSoundPreferenceStorage = {
      getItem: () => '{not-json',
      setItem: () => {},
    }

    expect(loadPokerSoundPreferences(throwingStorage)).toEqual(DEFAULT_POKER_SOUND_PREFERENCES)
    expect(savePokerSoundPreferences({ muted: false, volume: 0.5 }, throwingStorage)).toBe(false)
    expect(loadPokerSoundPreferences(malformedStorage)).toEqual(DEFAULT_POKER_SOUND_PREFERENCES)
    expect(loadPokerSoundPreferences(null)).toEqual(DEFAULT_POKER_SOUND_PREFERENCES)
  })
})
