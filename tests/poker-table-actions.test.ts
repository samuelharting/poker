import { describe, expect, it } from 'vitest'
import {
  buildActionButtonDescriptors,
  buildPlayerManagementTags,
  canSaveTableSettings,
  formatPlayerStatsSummary,
  getSpectatorRailState,
  getVisibleOwnHandDescription,
} from '@/components/table/PokerTable'
import type { Card, LobbyPlayer } from '@/lib/poker/types'

function cards(...specs: string[]): Card[] {
  return specs.map(s => {
    const rank = s.slice(0, -1) as Card['rank']
    const suitChar = s.slice(-1)
    const suit = ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[suitChar]!
    return { rank, suit }
  })
}

describe('PokerTable action button descriptors', () => {
  it('keeps wager actions easy to scan without changing legal action order', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      toCall: 40,
      raiseAmount: 120,
      allInAmount: 940,
    })).toEqual([
      { key: 'call', label: 'Call', amountLabel: '$40', className: 'btn-call' },
      { key: 'raise', label: 'Raise to', amountLabel: '$120', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$940', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })

  it('shows check as the primary no-cost action when call is not legal', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'check', 'raise', 'all_in'],
      toCall: 0,
      raiseAmount: 80,
      allInAmount: 1000,
    })).toEqual([
      { key: 'check', label: 'Check', className: 'btn-check' },
      { key: 'raise', label: 'Raise to', amountLabel: '$80', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$1,000', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })
})

describe('getVisibleOwnHandDescription', () => {
  it('describes a pocket pair before the board is dealt', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Ah'),
      []
    )).toBe('Pair of Aces')
  })

  it('describes the best live hand from hole cards and the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Kh'),
      cards('Qd', 'Jc', 'Th')
    )).toBe('Straight, Ace-high')
  })

  it('describes a straight that is entirely on the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Kh'),
      cards('9d', '8c', '7h', '6s', '5d')
    )).toBe('Straight, Nine-high')
  })

  it('describes two pair that is entirely on the board', () => {
    expect(getVisibleOwnHandDescription(
      cards('As', 'Qh'),
      cards('Kd', 'Kc', '8h', '8s', '3d')
    )).toBe('Two Pair, Kings and Eights')
  })
})

function makeLobbyPlayer(overrides: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    id: 'p1',
    nickname: 'Alice',
    stack: 1000,
    status: 'waiting',
    isConnected: true,
    isSeated: true,
    isSpectator: false,
    ...overrides,
  }
}

describe('settings and player management helpers', () => {
  it('labels roster rows with operational tags', () => {
    expect(buildPlayerManagementTags(makeLobbyPlayer({ id: 'host' }), {
      yourId: 'host',
    })).toEqual(['You', 'Seated'])

    expect(buildPlayerManagementTags(makeLobbyPlayer({
      id: 'bot_1',
      isBot: true,
      isConnected: false,
      status: 'disconnected',
    }), {
      yourId: 'host',
    })).toEqual(['Bot', 'Seated', 'Away'])

    expect(buildPlayerManagementTags(makeLobbyPlayer({
      isSeated: false,
      isSpectator: true,
      status: 'spectating',
    }), {
      yourId: 'host',
    })).toEqual(['Spectator'])
  })

  it('requires chips before a spectator can take a seat', () => {
    expect(getSpectatorRailState(makeLobbyPlayer({
      stack: 0,
      isSeated: false,
      isSpectator: true,
      status: 'spectating',
    }), true)).toEqual({
      canTakeSeat: false,
      actionLabel: undefined,
      message: 'Add chips from the Players tab before you take a seat.',
    })

    expect(getSpectatorRailState(makeLobbyPlayer({
      stack: 500,
      isSeated: false,
      isSpectator: true,
      status: 'spectating',
    }), true)).toEqual({
      canTakeSeat: true,
      actionLabel: 'Take seat',
      message: 'You have chips again and can take the next open seat.',
    })
  })

  it('allows any connected player to save table settings between hands', () => {
    expect(canSaveTableSettings({
      isConnected: true,
      hasSettingsChanges: true,
      phase: 'between_hands',
    })).toBe(true)
  })

  it('allows table-setting saves during live hands', () => {
    expect(canSaveTableSettings({
      isConnected: true,
      hasSettingsChanges: true,
      phase: 'in_hand',
    })).toBe(true)

    expect(canSaveTableSettings({
      isConnected: true,
      hasSettingsChanges: true,
      phase: 'between_hands',
    })).toBe(true)
  })
})

describe('player stats summary', () => {
  it('formats fold percentage, games played, and games won for the opponent panel', () => {
    expect(formatPlayerStatsSummary({
      handsPlayed: 12,
      folds: 3,
      wins: 5,
      totalWon: 1400,
      foldRate: 0.25,
    })).toEqual([
      { label: 'Fold', value: '25%' },
      { label: 'Games', value: '12' },
      { label: 'Won', value: '5' },
    ])
  })

  it('uses zeroed public stats when a player has not played yet', () => {
    expect(formatPlayerStatsSummary(undefined)).toEqual([
      { label: 'Fold', value: '0%' },
      { label: 'Games', value: '0' },
      { label: 'Won', value: '0' },
    ])
  })
})
