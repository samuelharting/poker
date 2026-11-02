import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocialSnapshot } from '@/shared/protocol'
import type { Card, RunItTwiceState, SeatPlayer, TableState } from '@/lib/poker/types'
import { createDeck } from '@/lib/poker/deck'
import { compareHands, evaluateHand } from '@/lib/poker/evaluator'
import { getVisibleOwnHandDescription } from '@/lib/poker/handLabel'
import { CommunityCards } from '@/components/table/CommunityCards'
import { RunItTwiceBoards } from '@/components/table/RunItTwice'
import { getWinningHandLabel } from '@/components/table/ShowdownCinematic'
import {
  createThreeTableViewModel,
  getThreeBoardCards,
  getThreeVisibleCardSlots,
  type ThreeTableViewModel,
} from '@/components/three/tableViewModel'
import { TWO_D_LAYOUT_QUERY } from '@/lib/layoutMode'
import { bestReferenceHand, compareReference } from './helpers/bruteForceHand'
import { findSnapshotProblems, findViewModelProblems } from './helpers/snapshotInvariants'

/**
 * Display truth: what a player sees (2D table, 3D view model, hand labels)
 * is exactly the server's cards. Nothing on the client may swap, invent or
 * duplicate a card, and every hand name is the brute-force best hand.
 */

function DesktopPokerRoom3DMock(_props: { view: ThreeTableViewModel }) {
  return <div className="desktop-3d-stage" />
}
vi.mock('next/dynamic', () => ({ default: () => DesktopPokerRoom3DMock }))
vi.mock('@/components/three/DesktopPokerRoom3D', () => ({ DesktopPokerRoom3D: DesktopPokerRoom3DMock }))

import { PokerTable } from '@/components/table/PokerTable'

const SUIT: Record<string, Card['suit']> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }
const cards = (...codes: string[]): Card[] => codes.map(code => ({ rank: code[0] as Card['rank'], suit: SUIT[code[1]!]! }))
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

function deal(random: () => number, count: number): Card[] {
  const deck = createDeck()
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[deck[index], deck[swap]] = [deck[swap]!, deck[index]!]
  }
  return deck.slice(0, count)
}

function seat(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'hero', nickname: 'Hero', stack: 1000, bet: 0, totalInPot: 0, status: 'active',
    isDealer: false, isSB: false, isBB: false, hasCards: true, showCards: 'none', isConnected: true,
    seatIndex: 0, hasActedThisRound: false,
    ...overrides,
  }
}

function table(overrides: Partial<TableState>): TableState {
  return {
    roomCode: '1', phase: 'in_hand', serverNow: 1, viewerId: 'hero', round: 'flop', players: [], communityCards: [],
    pots: [], totalPot: 0, currentBet: 0, minRaise: 20, actingPlayerId: null, dealerSeatIndex: 0,
    smallBlind: 10, bigBlind: 20, startingStack: 1000, actionTimerStart: null, actionTimerDuration: 30000,
    rabbitHuntingEnabled: true, sevenTwoRuleEnabled: false, sevenTwoBountyPercent: 0, handNumber: 7,
    recentActions: [], lobbyPlayers: [],
    ...overrides,
  }
}

/** Every face-up card in rendered markup, in order (PlayingCard aria-label "<rank> of <suit>"). */
function faceUpCards(markup: string): string[] {
  return Array.from(markup.matchAll(/aria-label="(10|[2-9JQKA]) of (spades|hearts|diamonds|clubs)"/g))
    .map(match => `${match[1] === '10' ? 'T' : match[1]}${match[2]}`)
}

describe('hand labels come from the real cards (brute force)', () => {
  it('evaluator agrees with a brute-force best-of-21 on random 5, 6 and 7 card hands', () => {
    const random = mulberry32(20261102)
    for (let trial = 0; trial < 6000; trial += 1) {
      const size = 5 + (trial % 3)
      const hand = deal(random, size)
      const result = evaluateHand(hand)
      const reference = bestReferenceHand(hand)
      expect(result.description, hand.map(key).join(' ')).toBe(reference.description)
      expect(result.rankIndex).toBe(reference.category)
    }
  })

  it('evaluator orders hands exactly like the brute force (who wins is right)', () => {
    const random = mulberry32(99)
    for (let trial = 0; trial < 3000; trial += 1) {
      const dealt = deal(random, 9)
      const board = dealt.slice(4)
      const a = [...dealt.slice(0, 2), ...board]
      const b = [...dealt.slice(2, 4), ...board]
      const engine = Math.sign(compareHands(evaluateHand(a), evaluateHand(b)))
      const reference = Math.sign(compareReference(bestReferenceHand(a), bestReferenceHand(b)))
      expect(engine, `${a.map(key)} vs ${b.map(key)}`).toBe(reference)
    }
  })

  it('names every special shape correctly', () => {
    const cases: Array<[string[], string]> = [
      [['Js', 'Jh', 'Jd', '4c', '4s', '9h', '2c'], 'Full House, Jacks full of Fours'],
      [['Js', 'Jh', 'Jd', '4c', '4s', '4h', '2c'], 'Full House, Jacks full of Fours'],
      [['Js', 'Jh', '8d', '4c', '3s', '9h', 'Jc'], 'Three of a Kind, Jacks'],
      [['As', '2h', '3d', '4c', '5s', 'Kh', 'Kc'], 'Straight, Five-high'],
      [['As', '2s', '3s', '4s', '5s', 'Ks', 'Kc'], 'Straight Flush, Five-high'],
      [['As', 'Ks', 'Qs', 'Js', 'Ts', '9s', 'Kc'], 'Royal Flush'],
      [['6s', '6h', '6d', '6c', 'Ks', 'Kh', 'Kc'], 'Four of a Kind, Sixes'],
      [['Ah', 'Kh', '9h', '5h', '2h', 'Ac', 'Ad'], 'Flush, Ace-high'],
    ]
    for (const [hand, label] of cases) {
      expect(evaluateHand(cards(...hand)).description).toBe(label)
      expect(bestReferenceHand(cards(...hand)).description).toBe(label)
    }
  })

  it('the own-hand hint is the brute-force hand on every street', () => {
    const random = mulberry32(5)
    for (let trial = 0; trial < 3000; trial += 1) {
      const dealt = deal(random, 7)
      const hole = dealt.slice(0, 2)
      for (const boardLength of [3, 4, 5]) {
        const board = dealt.slice(2, 2 + boardLength)
        expect(getVisibleOwnHandDescription(hole, board)).toBe(bestReferenceHand([...hole, ...board]).description)
      }
    }
    expect(getVisibleOwnHandDescription(cards('Js', 'Jh'), [])).toBe('Pair of Jacks')
    expect(getVisibleOwnHandDescription(cards('As', '6h'), [])).toBe('Ace-high')
  })

  it('never names a hand from an impossible holding', () => {
    // A card seen twice (the old drunk "misread" could do this) must not become trips.
    expect(getVisibleOwnHandDescription(cards('Js', 'Jh'), cards('Js', '4c', '9d'))).toBeNull()
    expect(getVisibleOwnHandDescription(cards('Js', 'Jh'), cards('4c', '9d'))).toBeNull()
    expect(getVisibleOwnHandDescription(cards('Js'), cards('4c', '9d', '2s'))).toBeNull()
    expect(getVisibleOwnHandDescription(cards('Js', 'Jh'), cards('4c', '9d', '2s', '3s', '5s', '6s'))).toBeNull()
  })

  it('names every distinct winning hand in the showdown banner', () => {
    expect(getWinningHandLabel([
      { playerId: 'a', amount: 100, handDescription: 'Flush, King-high' },
      { playerId: 'b', amount: 40, handDescription: 'Pair of Jacks' },
      { playerId: 'c', amount: 40, handDescription: 'Pair of Jacks' },
    ])).toBe('Flush, King-high / Pair of Jacks')
    expect(getWinningHandLabel([{ playerId: 'a', amount: 10 }])).toBeNull()
  })
})

describe('3D view model shows the snapshot untouched', () => {
  const hero = seat({ holeCards: cards('Js', 'Jh') })
  const villain = seat({ id: 'v', nickname: 'Villain', seatIndex: 3, stack: 640, holeCards: cards('Ad', 'Kd'), showCards: 'both' })
  const state = table({ players: [hero, villain], communityCards: cards('Jd', '4c', '4s') })

  it('copies board, hero cards, seat cards and stacks exactly', () => {
    const view = createThreeTableViewModel(state, 'hero')
    expect(view.communityCards.map(card => `${card.rank}${card.suit}`)).toEqual(state.communityCards.map(key))
    expect(view.heroCards.map(card => `${card.rank}${card.suit}`)).toEqual(hero.holeCards!.map(key))
    const villainView = view.players.find(player => player.id === 'v')!
    expect(villainView.visibleCards.map(card => `${card.rank}${card.suit}`)).toEqual(villain.holeCards!.map(key))
    expect(villainView.stack).toBe(640)
    expect(findViewModelProblems(state)).toEqual([])
  })

  it('creates a fresh view per snapshot: the next hand never keeps the old board or cards', () => {
    const next = table({ handNumber: 8, players: [seat({ holeCards: cards('2c', '7d') }), seat({ id: 'v', nickname: 'Villain', seatIndex: 3 })], communityCards: [] })
    createThreeTableViewModel(state, 'hero')
    const view = createThreeTableViewModel(next, 'hero')
    expect(view.communityCards).toEqual([])
    expect(view.heroCards.map(card => `${card.rank}${card.suit}`)).toEqual(['2clubs', '7diamonds'])
    expect(view.players.find(player => player.id === 'v')!.visibleCards).toEqual([])
  })

  it('never puts rabbit cards on the 3D board', () => {
    const folded = table({ phase: 'between_hands', round: null, communityCards: cards('Jd', '4c', '4s'), rabbitCards: cards('Jc', '9h'), players: [hero, villain] })
    expect(getThreeBoardCards(folded).map(key)).toEqual(['Jdiamonds', '4clubs', '4spades'])
    expect(createThreeTableViewModel(folded, 'hero').communityCards).toHaveLength(3)
  })

  it('keeps a run-it-twice hand off the felt (the Run 1 / Run 2 panel is the only board)', () => {
    const runItTwice: RunItTwiceState = {
      status: 'accepted', eligiblePlayerIds: ['hero', 'v'], votes: {}, sharedCardCount: 3,
      boards: [
        { cards: cards('Jd', '4c', '4s', 'Jc', '9h'), winners: [] },
        { cards: cards('Jd', '4c', '4s', '2d', 'Kh'), winners: [] },
      ],
    }
    const ran = table({ phase: 'between_hands', round: 'showdown', communityCards: cards('Jd', '4c', '4s', 'Jc', '9h'), runItTwice, players: [hero, villain] })
    expect(createThreeTableViewModel(ran, 'hero').communityCards).toEqual([])
  })

  it('face-up slots only ever hold the player\'s own shown cards', () => {
    const [left, right] = cards('Ad', 'Kd').map((card, index) => ({ id: `c${index}`, ...card, visible: true }))
    expect(getThreeVisibleCardSlots('both', [left!, right!])).toEqual({ left, right })
    expect(getThreeVisibleCardSlots('left', [left!])).toEqual({ left, right: null })
    expect(getThreeVisibleCardSlots('right', [right!])).toEqual({ left: null, right })
    expect(getThreeVisibleCardSlots('none', [left!, right!])).toEqual({ left: null, right: null })
  })
})

describe('2D table draws exactly the server cards', () => {
  it('the board shows the dealt cards and nothing else', () => {
    const board = cards('Jd', '4c', '4s', 'Jc')
    expect(faceUpCards(renderToStaticMarkup(<CommunityCards cards={board} />))).toEqual(board.map(key))
  })

  it('run it twice shows every physical card once (no fifth jack)', () => {
    const runItTwice: RunItTwiceState = {
      status: 'accepted', eligiblePlayerIds: ['hero', 'v'], votes: {}, sharedCardCount: 3,
      boards: [
        { cards: cards('Jd', 'Jc', '4s', 'Jh', '9h'), winners: [] },
        { cards: cards('Jd', 'Jc', '4s', '2d', 'Kh'), winners: [] },
      ],
    }
    const shown = faceUpCards(renderToStaticMarkup(<RunItTwiceBoards runItTwice={runItTwice} players={[]} />))
    expect(shown).toEqual(['Jdiamonds', 'Jclubs', '4spades', 'Jhearts', '9hearts', '2diamonds', 'Khearts'])
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('rabbit cards never sit in a board slot (2D and desktop)', () => {
    const social: SocialSnapshot = { active: [], chatLog: [] }
    const state = table({
      phase: 'between_hands', round: null, communityCards: cards('Jd', '4c', '4s'), rabbitCards: cards('Jc', '9h'),
      winners: [{ playerId: 'v', amount: 40 }],
      players: [
        seat({ status: 'folded', holeCards: cards('2s', '7h') }),
        seat({ id: 'v', nickname: 'Villain', seatIndex: 1, stack: 1020 }),
      ],
    })
    for (const media of [{ [TWO_D_LAYOUT_QUERY]: true }, { [TWO_D_LAYOUT_QUERY]: false, '(min-width: 1024px)': true }]) {
      vi.stubGlobal('window', {
        matchMedia: (query: string) => ({
          matches: media[query as keyof typeof media] ?? false, media: query,
          addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
        }),
      })
      const markup = renderToStaticMarkup(
        <PokerTable
          state={state} socialState={social} yourId="hero" isHost={false} isConnected startingStackSetting={1000}
          settingsOpen={false} suitColorMode="two" onAction={() => {}} onStartGame={() => {}} onAddBots={() => {}}
          autoStartEnabled onSetAutoStart={() => {}} onUpdateSettings={() => {}} onRemovePlayer={() => {}}
          onAdjustPlayerStack={() => {}} onSetPlayerSpectator={() => {}} onSeatMe={() => {}} onSetShowCards={() => {}}
          onSetSuitColorMode={() => {}} onCloseSettings={() => {}} onSendEmote={() => {}} onSendTargetEmote={() => {}}
          onFeedback={() => {}}
        />
      )
      vi.unstubAllGlobals()
      // The board element was handed the three played cards only (rabbit cards would make it 5).
      expect(markup).toContain('class="community-cards" aria-label="Board cards" data-visible-count="3"')
      expect(markup).not.toMatch(/data-visible-count="[45]"/)
      expect(markup).toContain('Rabbit hunt — not played')
      expect(markup).toContain('data-rabbit-hunt="true"')
      expect(markup).not.toContain('is-unplayed')
    }
  })
})

describe('snapshot checker catches what players complained about', () => {
  const players = [
    seat({ holeCards: cards('Js', 'Jh') }),
    seat({ id: 'v', nickname: 'Villain', seatIndex: 1, holeCards: cards('Jc', '9d'), showCards: 'both' }),
  ]

  it('accepts a sound snapshot', () => {
    expect(findSnapshotProblems(table({ players, communityCards: cards('Jd', '4c', '4s') }))).toEqual([])
  })

  it('flags five jacks (a card on screen twice)', () => {
    const problems = findSnapshotProblems(table({ players, communityCards: cards('Jd', 'Jc', '4s') }))
    expect(problems.join()).toContain('visible twice')
  })

  it('flags a board of the wrong size and a board from another hand', () => {
    expect(findSnapshotProblems(table({ players, communityCards: cards('Jd', '4c') })).join()).toContain('board has 2 cards')
  })

  it('flags a winner label that is not the brute-force hand', () => {
    const state = table({
      phase: 'between_hands', round: 'showdown', players, communityCards: cards('Jd', '4c', '4s', '2h', '8c'),
      winners: [{ playerId: 'v', amount: 40, handDescription: 'Full House, Jacks full of Fours' }],
    })
    expect(findSnapshotProblems(state).join()).toContain('holds "Two Pair, Jacks and Fours"')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
