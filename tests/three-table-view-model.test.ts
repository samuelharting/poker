import { describe, expect, it } from 'vitest'
import { createThreeEmoteReactions, createThreeTableViewModel } from '@/components/three/tableViewModel'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'
import type { SocialSnapshot } from '@/shared/protocol'

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

  it('maps small blind and big blind roles into the desktop 3D player views', () => {
    const state = makeTable({
      players: [
        makePlayer({ id: 'hero', nickname: 'Hero', seatIndex: 0, isSB: true }),
        makePlayer({ id: 'big-blind', nickname: 'Maya', seatIndex: 1, isBB: true }),
        makePlayer({ id: 'button', nickname: 'Button', seatIndex: 2, isDealer: true }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.players.find(player => player.id === 'hero')?.blindRole).toBe('small')
    expect(view.players.find(player => player.id === 'big-blind')?.blindRole).toBe('big')
    expect(view.players.find(player => player.id === 'button')?.blindRole).toBeNull()
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

  it('carries every visible player hand into the desktop 3D view for spectator snapshots', () => {
    const state = makeTable({
      players: [
        makePlayer({
          id: 'alice',
          nickname: 'Alice',
          seatIndex: 0,
          holeCards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'K', suit: 'hearts' },
          ],
          showCards: 'both',
        }),
        makePlayer({
          id: 'bob',
          nickname: 'Bob',
          seatIndex: 1,
          holeCards: [
            { rank: 'Q', suit: 'clubs' },
            { rank: 'J', suit: 'diamonds' },
          ],
          showCards: 'both',
        }),
      ],
    })

    const view = createThreeTableViewModel(state, 'rail')
    const alice = view.players.find(player => player.id === 'alice')
    const bob = view.players.find(player => player.id === 'bob')

    expect(alice?.visibleCards).toEqual([
      { id: 'alice-card-0-A-spades', rank: 'A', suit: 'spades', visible: true },
      { id: 'alice-card-1-K-hearts', rank: 'K', suit: 'hearts', visible: true },
    ])
    expect(bob?.visibleCards).toEqual([
      { id: 'bob-card-0-Q-clubs', rank: 'Q', suit: 'clubs', visible: true },
      { id: 'bob-card-1-J-diamonds', rank: 'J', suit: 'diamonds', visible: true },
    ])
  })

  it('keeps hidden opponent cards out of the desktop 3D view model', () => {
    const state = makeTable({
      players: [
        makePlayer({
          id: 'hero',
          seatIndex: 0,
          holeCards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'K', suit: 'hearts' },
          ],
        }),
        makePlayer({
          id: 'villain',
          seatIndex: 1,
          hasCards: true,
          holeCards: undefined,
        }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')
    const villain = view.players.find(player => player.id === 'villain')

    expect(villain?.hasCards).toBe(true)
    expect(villain?.visibleCards).toEqual([])
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
      isOutOfHand: true,
    })
  })

  it('surfaces the latest all-in action for a table-level announcement', () => {
    const state = makeTable({
      players: [
        makePlayer({
          id: 'hero',
          nickname: 'Hero',
          seatIndex: 3,
          status: 'all_in',
          stack: 0,
          bet: 980,
          lastAction: 'Hero goes all-in for $980',
          lastActionId: '4:12',
        }),
        makePlayer({
          id: 'villain',
          nickname: 'Maya',
          seatIndex: 6,
          status: 'all_in',
          stack: 0,
          bet: 420,
          lastAction: 'Maya goes all-in for $420',
          lastActionId: '4:10',
        }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.allInAnnouncement).toEqual({
      actionKey: 'hero:4:12',
      playerId: 'hero',
      nickname: 'Hero',
      visualSeat: 0,
      amountLabel: '$980',
      isHero: true,
    })
  })

  it('keeps the same all-in announcement key when only pot totals change', () => {
    const before = createThreeTableViewModel(
      makeTable({
        totalPot: 980,
        players: [
          makePlayer({
            id: 'hero',
            status: 'all_in',
            stack: 0,
            bet: 980,
            lastAction: 'Hero goes all-in for $980',
            lastActionId: '4:12',
          }),
        ],
      }),
      'hero'
    )
    const after = createThreeTableViewModel(
      makeTable({
        totalPot: 1180,
        players: [
          makePlayer({
            id: 'hero',
            status: 'all_in',
            stack: 0,
            bet: 980,
            lastAction: 'Hero goes all-in for $980',
            lastActionId: '4:12',
          }),
        ],
      }),
      'hero'
    )

    expect(after.allInAnnouncement?.actionKey).toBe(before.allInAnnouncement?.actionKey)
  })

  it('treats a call all-in action as an all-in announcement event', () => {
    const view = createThreeTableViewModel(
      makeTable({
        players: [
          makePlayer({
            id: 'hero',
            status: 'all_in',
            stack: 0,
            bet: 120,
            lastAction: 'Hero calls all-in $120',
            lastActionId: '4:13',
          }),
        ],
      }),
      'hero'
    )

    expect(view.actionCue).toBe('all_in')
    expect(view.allInAnnouncement).toMatchObject({
      actionKey: 'hero:4:13',
      amountLabel: '$120',
    })
  })

  it('marks only live-hand folded players as out of hand for 3D presentation', () => {
    const liveView = createThreeTableViewModel(
      makeTable({
        phase: 'in_hand',
        players: [
          makePlayer({ id: 'hero', status: 'active' }),
          makePlayer({ id: 'folder', seatIndex: 1, status: 'folded' }),
          makePlayer({ id: 'all-in', seatIndex: 2, status: 'all_in' }),
        ],
      }),
      'hero'
    )
    const betweenHandsView = createThreeTableViewModel(
      makeTable({
        phase: 'between_hands',
        players: [
          makePlayer({ id: 'hero', status: 'waiting' }),
          makePlayer({ id: 'former-folder', seatIndex: 1, status: 'folded' }),
        ],
      }),
      'hero'
    )

    expect(liveView.players.find(player => player.id === 'folder')?.isOutOfHand).toBe(true)
    expect(liveView.players.find(player => player.id === 'all-in')?.isOutOfHand).toBe(false)
    expect(betweenHandsView.players.find(player => player.id === 'former-folder')?.isOutOfHand).toBe(false)
  })

  it('does not expose a streak companion flag from legacy win-streak stats', () => {
    const state = makeTable({
      players: [
        makePlayer({
          id: 'hero',
          stats: {
            handsPlayed: 3,
            folds: 0,
            wins: 2,
            totalWon: 240,
            foldRate: 0,
            currentWinStreak: 2,
          } as SeatPlayer['stats'] & { currentWinStreak: number },
        }),
        makePlayer({
          id: 'villain',
          seatIndex: 1,
          stats: {
            handsPlayed: 3,
            folds: 1,
            wins: 1,
            totalWon: 120,
            foldRate: 1 / 3,
            currentWinStreak: 1,
          } as SeatPlayer['stats'] & { currentWinStreak: number },
        }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')
    const hero = view.players.find(player => player.id === 'hero')
    const villain = view.players.find(player => player.id === 'villain')

    expect(hero).not.toHaveProperty('hasCompanion')
    expect(villain).not.toHaveProperty('hasCompanion')
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

  it('creates only live 3D emote reactions for occupied seats', () => {
    const now = 5000
    const socialState: SocialSnapshot = {
      active: [
        {
          playerId: 'hero',
          emote: '\uD83D\uDE02',
          emoteExpiresAt: now + 1400,
          targetPlayerId: 'villain',
        },
        {
          playerId: 'villain',
          emote: '\uD83D\uDC4B',
          emoteExpiresAt: now + 900,
        },
        {
          playerId: 'hero',
          emote: '\uD83D\uDE21',
          emoteExpiresAt: now - 20,
          targetPlayerId: 'villain',
        },
        {
          playerId: 'ghost',
          emote: '\uD83D\uDC80',
          emoteExpiresAt: now + 900,
          targetPlayerId: 'hero',
        },
        {
          playerId: 'hero',
          emote: '\uD83D\uDE2D',
          emoteExpiresAt: now + 900,
          targetPlayerId: 'empty-seat',
        },
      ],
      chatLog: [],
    }

    expect(createThreeEmoteReactions(socialState, ['hero', 'villain'], now)).toEqual([
      {
        id: `hero:villain:\uD83D\uDE02:${now + 1400}`,
        senderId: 'hero',
        targetId: 'villain',
        emote: '\uD83D\uDE02',
        expiresAt: now + 1400,
        targeted: true,
      },
      {
        id: `villain:villain:\uD83D\uDC4B:${now + 900}`,
        senderId: 'villain',
        targetId: 'villain',
        emote: '\uD83D\uDC4B',
        expiresAt: now + 900,
        targeted: false,
      },
    ])
  })
})
