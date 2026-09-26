'use client'

import { useEffect, useReducer, useRef } from 'react'
import { getDrunkEffectProfile, normalizeDrinkState, pickMisreadCard } from '@/lib/drinks'
import type { Card, TableState } from '@/lib/poker/types'

export interface CardMisread {
  key: string
  target: 'hole' | 'board'
  index: number
  card: Card
  until: number
}

// Includes the ~400ms deal/flip animation, so the wrong face is visible for roughly 0.6-1s.
const HOLE_MISREAD_MS = [1100, 1500] as const
const BOARD_MISREAD_MS = [1000, 1400] as const

function cardsKey(cards: readonly Card[]): string {
  return cards.map(card => `${card.rank}${card.suit[0]}`).join(',')
}

/** Board indices that were just dealt for a board of `length` cards. */
export function newlyDealtBoardIndices(length: number): number[] {
  if (length >= 5) return [4]
  if (length === 4) return [3]
  if (length === 3) return [0, 1, 2]
  return []
}

/**
 * Returns a copy of `state` where one of the viewer's own cards (or a board
 * card) shows the misread card. Purely presentational: the server state is
 * never touched and other players' hidden cards are never involved.
 */
export function applyCardMisread(state: TableState, yourId: string, misread: CardMisread | null): TableState {
  if (!misread) {
    return state
  }

  if (misread.target === 'board') {
    if (!state.communityCards[misread.index]) {
      return state
    }
    const communityCards = state.communityCards.slice()
    communityCards[misread.index] = misread.card
    return { ...state, communityCards }
  }

  const players = state.players.map(player => {
    if (player.id !== yourId || !player.holeCards?.[misread.index]) {
      return player
    }
    const holeCards = player.holeCards.slice()
    holeCards[misread.index] = misread.card
    return { ...player, holeCards }
  })
  return { ...state, players }
}

/**
 * Level 3+: when you first look at a new card it is sometimes the wrong one
 * for about a second before your eyes "correct" it.
 */
export function useDrunkHallucination(state: TableState | null, yourId: string): TableState | null {
  const [, forceRender] = useReducer((count: number) => count + 1, 0)
  const decisionsRef = useRef(new Map<string, CardMisread | null>())
  const handRef = useRef<number | null>(null)

  const me = state?.players.find(player => player.id === yourId)
  const drinks = normalizeDrinkState(me?.drinks)
  const chance = getDrunkEffectProfile(drinks.level, drinks.passedOut).hallucinationChance
  const holeCards = me?.holeCards ?? []
  const board = state?.communityCards ?? []
  const now = Date.now()

  if (state && handRef.current !== state.handNumber) {
    handRef.current = state.handNumber
    decisionsRef.current.clear()
  }

  // Decide during render (once per newly seen card set) so the true card never flashes first.
  const decide = (
    key: string | null,
    target: CardMisread['target'],
    candidates: number[],
    duration: readonly [number, number]
  ): CardMisread | null => {
    if (!key || candidates.length === 0) {
      return null
    }
    if (!decisionsRef.current.has(key)) {
      let decision: CardMisread | null = null
      if (chance > 0 && Math.random() < chance) {
        decision = {
          key,
          target,
          index: candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0]!,
          card: pickMisreadCard([...holeCards, ...board]),
          until: now + duration[0] + Math.random() * (duration[1] - duration[0]),
        }
      }
      decisionsRef.current.set(key, decision)
    }
    return decisionsRef.current.get(key) ?? null
  }

  const holeKey = state && holeCards.length === 2
    ? `hole:${state.handNumber}:${cardsKey(holeCards)}`
    : null
  const boardKey = state && board.length >= 3
    ? `board:${state.handNumber}:${board.length}:${cardsKey(board)}`
    : null
  const holeMisread = decide(holeKey, 'hole', [0, 1], HOLE_MISREAD_MS)
  const boardMisread = decide(boardKey, 'board', newlyDealtBoardIndices(board.length), BOARD_MISREAD_MS)
  const active = [boardMisread, holeMisread].find(misread => misread && misread.until > now) ?? null

  const activeKey = active?.key ?? ''
  const activeUntil = active?.until ?? 0
  const activeTarget = active?.target ?? ''
  useEffect(() => {
    if (!activeKey) {
      return
    }
    document.documentElement.dataset.drunkMisread = activeTarget
    const timer = window.setTimeout(() => {
      delete document.documentElement.dataset.drunkMisread
      forceRender()
    }, Math.max(0, activeUntil - Date.now()) + 16)
    return () => {
      window.clearTimeout(timer)
      delete document.documentElement.dataset.drunkMisread
    }
  }, [activeKey, activeTarget, activeUntil])

  if (!state) {
    return null
  }

  return applyCardMisread(state, yourId, active)
}
