'use client'

import type { Card } from '@/lib/poker/types'
import clsx from 'clsx'
import React from 'react'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { ChipStack } from '@/components/ui/ChipStack'

interface OwnHandProps {
  cards: Card[]
  bet: number
  isActing: boolean
  isWinner?: boolean
  handDescription?: string | null
}

export function OwnHand({
  cards,
  bet,
  isActing,
  isWinner = false,
  handDescription = null,
}: OwnHandProps) {
  if (cards.length === 0) {
    return null
  }

  return (
    <div
      className={clsx(
        'own-hand-area',
        handDescription && 'has-strength',
        isActing && 'is-acting',
        isWinner && 'is-winner'
      )}
      aria-label={handDescription ? `Your best hand: ${handDescription}` : 'Your hand'}
    >
      {isActing && <div className="own-hand-turn-chip">Your turn</div>}
      {handDescription && (
        <div className="own-hand-strength" role="status" aria-live="polite">
          <span className="own-hand-strength-kicker">Best hand</span>
          <span className="own-hand-strength-value">{handDescription}</span>
        </div>
      )}
      <div className={clsx('own-card-row', isWinner && 'is-winner')}>
        {bet > 0 && (
          <div className="own-hand-bet-stack-anchor">
            <div className="own-hand-bet-stack">
              <ChipStack amount={bet} compact />
            </div>
          </div>
        )}

        {cards.map((card, index) => (
          <div
            key={`${card.rank}-${card.suit}-${index}`}
            className={clsx(
              'own-card-slot',
              index === 0 ? 'own-card-slot-left' : 'own-card-slot-right'
            )}
          >
            <PlayingCard card={card} size="xl" animateIn highlighted={isWinner} />
          </div>
        ))}
      </div>
    </div>
  )
}
