'use client'

import type { Card } from '@/lib/poker/types'
import type { ShowCardsMode } from '@/lib/poker/types'
import clsx from 'clsx'
import React from 'react'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface OwnHandProps {
  cards: Card[]
  isActing: boolean
  isFolded?: boolean
  isWinner?: boolean
  handDescription?: string | null
  showCardsMode?: ShowCardsMode
  showCardsControl?: React.ReactNode
}

export function OwnHand({
  cards,
  isActing,
  isFolded = false,
  isWinner = false,
  handDescription = null,
  showCardsMode = 'none',
  showCardsControl = null,
}: OwnHandProps) {
  if (cards.length === 0) {
    return null
  }

  const isCardFaceUp = (index: number) => {
    if (!isFolded) {
      return true
    }

    if (showCardsMode === 'both') {
      return true
    }

    if (showCardsMode === 'left') {
      return index === 0
    }

    if (showCardsMode === 'right') {
      return index === 1
    }

    return false
  }

  return (
    <div
      className={clsx(
        'own-hand-area',
        handDescription && 'has-strength',
        isActing && 'is-acting',
        isFolded && 'is-folded',
        isWinner && 'is-winner'
      )}
      aria-label={handDescription ? `Your hand: ${handDescription}` : 'Your hand'}
    >
      {isActing && <div className="own-hand-turn-chip">Your turn</div>}
      {handDescription && (
        <div className="own-hand-strength" role="status" aria-live="polite">
          <span className="own-hand-strength-value">{handDescription}</span>
        </div>
      )}
      <div className={clsx('own-card-row', isWinner && 'is-winner', isFolded && 'is-folded')}>
        {cards.map((card, index) => (
          <div
            key={`${card.rank}-${card.suit}-${index}`}
            className={clsx(
              'own-card-slot',
              index === 0 ? 'own-card-slot-left' : 'own-card-slot-right',
              isFolded && !isCardFaceUp(index) && 'is-face-down',
              isFolded && isCardFaceUp(index) && 'is-shown'
            )}
          >
            <PlayingCard card={card} size="xl" animateIn highlighted={isWinner} faceDown={!isCardFaceUp(index)} />
          </div>
        ))}
      </div>
      {showCardsControl && <div className="own-hand-show-cards">{showCardsControl}</div>}
    </div>
  )
}
