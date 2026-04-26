import { describe, expect, it } from 'vitest'
import { createThreeTableViewModel } from '@/components/three/tableViewModel'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'

function makePlayer(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'p1',
    nickname: 'Player',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
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

function makeTable(overrides: Partial<TableState>): TableState {
  return {
    roomCode: '123',
    phase: 'in_hand',
    serverNow: 1,
    round: 'flop',
    players: [],
    communityCards: [],
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
    rabbitHuntingEnabled: true,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
    ...overrides,
  }
}

describe('createThreeTableViewModel', () => {
  it('keeps the current player at hero seat and rotates opponents around them', () => {
    const state = makeTable({
      players: [
        makePlayer({ id: 'hero', nickname: 'Hero', seatIndex: 5 }),
        makePlayer({ id: 'left', nickname: 'Left', seatIndex: 6 }),
        makePlayer({ id: 'across', nickname: 'Across', seatIndex: 1 }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.hero?.id).toBe('hero')
    expect(view.players.map(player => [player.id, player.visualSeat])).toEqual([
      ['hero', 0],
      ['left', 1],
      ['across', 4],
    ])
  })

  it('maps table cards and hidden hero card state without changing poker card values', () => {
    const board: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'T', suit: 'hearts' },
    ]
    const heroCards: Card[] = [
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
    ]

    const view = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({
            id: 'hero',
            seatIndex: 2,
            holeCards: heroCards,
          }),
        ],
        communityCards: board,
      }),
      'hero'
    )

    expect(view.communityCards).toEqual([
      { id: 'board-0-A-spades', rank: 'A', suit: 'spades', visible: true },
      { id: 'board-1-T-hearts', rank: 'T', suit: 'hearts', visible: true },
    ])
    expect(view.heroCards).toEqual([
      { id: 'hero-0-Q-diamonds', rank: 'Q', suit: 'diamonds', visible: true },
      { id: 'hero-1-J-clubs', rank: 'J', suit: 'clubs', visible: true },
    ])
  })

  it('derives action cue from the latest hero action', () => {
    const state = makeTable({
      players: [
        makePlayer({ id: 'hero', lastAction: 'Raised $120', lastActionId: '1:4', bet: 120 }),
      ],
      recentActions: ['Hero raised to $120'],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.actionCue).toBe('raise')
    expect(view.actionKey).toBe('hero:1:4')
  })

  it('derives action cues and stable animation keys for every seated avatar', () => {
    const state = makeTable({
      players: [
        makePlayer({ id: 'hero', lastAction: 'Checked', lastActionId: '1:7', bet: 0 }),
        makePlayer({
          id: 'villain',
          nickname: 'Maya',
          seatIndex: 1,
          status: 'folded',
          lastAction: 'Folded',
          lastActionId: '1:8',
        }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')
    const hero = view.players.find(player => player.id === 'hero')
    const villain = view.players.find(player => player.id === 'villain')

    expect(hero).toMatchObject({
      actionCue: 'check',
      actionKey: 'hero:1:7',
    })
    expect(villain).toMatchObject({
      actionCue: 'fold',
      actionKey: 'villain:1:8',
    })
  })

  it('does not rekey the same hero action when only the display label changes', () => {
    const baseState = makeTable({
      players: [
        makePlayer({ id: 'hero', lastAction: 'Raised $120', lastActionId: '1:4', bet: 120 }),
      ],
      recentActions: ['Hero raised to $120'],
    })
    const relabeledState = makeTable({
      players: [
        makePlayer({ id: 'hero', lastAction: 'Raised to $120', lastActionId: '1:4', bet: 120 }),
      ],
      recentActions: ['Hero raised to $120'],
    })

    const baseView = createThreeTableViewModel(baseState, 'hero')
    const relabeledView = createThreeTableViewModel(relabeledState, 'hero')

    expect(relabeledView.actionCue).toBe('raise')
    expect(relabeledView.actionKey).toBe(baseView.actionKey)
  })

  it('exposes the active player focus for turn-following camera work', () => {
    const state = makeTable({
      actingPlayerId: 'villain',
      players: [
        makePlayer({ id: 'hero', nickname: 'Hero', seatIndex: 4 }),
        makePlayer({ id: 'villain', nickname: 'Maya', seatIndex: 1 }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.actingPlayerId).toBe('villain')
    expect(view.actingPlayerName).toBe('Maya')
    expect(view.actingVisualSeat).toBe(5)
    expect(view.isHeroTurn).toBe(false)
  })

  it('keeps each rich avatar profile stable when table order changes', () => {
    const firstView = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({ id: 'sam-player', nickname: 'Sam', seatIndex: 0 }),
          makePlayer({ id: 'maya-player', nickname: 'Maya', seatIndex: 1 }),
        ],
      }),
      'sam-player'
    )
    const reorderedView = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({ id: 'maya-player', nickname: 'Maya', seatIndex: 1 }),
          makePlayer({ id: 'sam-player', nickname: 'Sam', seatIndex: 0 }),
        ],
      }),
      'sam-player'
    )

    const firstSam = firstView.players.find(player => player.id === 'sam-player')
    const reorderedSam = reorderedView.players.find(player => player.id === 'sam-player')
    const firstMaya = firstView.players.find(player => player.id === 'maya-player')

    expect(firstSam?.avatarProfile).toEqual(reorderedSam?.avatarProfile)
    expect(firstSam?.avatarProfile).toMatchObject({
      accentColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      skinColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      hairColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      shirtColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      sleeveColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      lapelColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      chairColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      chairTrimColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
    })
    expect(['oval', 'round', 'square']).toContain(firstSam?.avatarProfile.faceShape)
    expect(['low', 'medium', 'high']).toContain(firstSam?.avatarProfile.browWeight)
    expect(['none', 'glasses', 'mustache']).toContain(firstSam?.avatarProfile.accessory)
    expect(typeof firstSam?.avatarProfile.modelKey).toBe('string')
    expect(firstSam?.avatarProfile.modelKey).toBe(reorderedSam?.avatarProfile.modelKey)
    expect(firstSam?.avatarProfile.modelKey).not.toBe(firstMaya?.avatarProfile.modelKey)
    expect(firstSam?.avatarProfile).not.toEqual(firstMaya?.avatarProfile)
  })

  it('does not retrigger the same hero action when only table totals change', () => {
    const before = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({ id: 'hero', lastAction: 'Called $20', lastActionId: '1:5', bet: 20 }),
          makePlayer({ id: 'villain', seatIndex: 1, lastAction: 'Raised $80', bet: 80 }),
        ],
        currentBet: 20,
        totalPot: 80,
        recentActions: ['Villain raised to $80', 'Hero called $20'],
      }),
      'hero'
    )
    const after = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({ id: 'hero', lastAction: 'Called $20', lastActionId: '1:5', bet: 20 }),
          makePlayer({ id: 'villain', seatIndex: 1, lastAction: 'Raised $80', bet: 80 }),
        ],
        currentBet: 80,
        totalPot: 140,
        recentActions: ['Villain raised to $80', 'Hero called $20'],
      }),
      'hero'
    )

    expect(before.actionCue).toBe('call')
    expect(after.actionCue).toBe('call')
    expect(after.actionKey).toBe(before.actionKey)
  })

  it('rekeys the same textual hero action on a new betting round', () => {
    const flopCheck = createThreeTableViewModel(
      makeTable({
        round: 'flop',
        players: [makePlayer({ id: 'hero', lastAction: 'Checked', lastActionId: '1:7', bet: 0 })],
      }),
      'hero'
    )
    const turnCheck = createThreeTableViewModel(
      makeTable({
        round: 'turn',
        players: [makePlayer({ id: 'hero', lastAction: 'Checked', lastActionId: '1:10', bet: 0 })],
      }),
      'hero'
    )

    expect(flopCheck.actionCue).toBe('check')
    expect(turnCheck.actionCue).toBe('check')
    expect(turnCheck.actionKey).not.toBe(flopCheck.actionKey)
  })
})
