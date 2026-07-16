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
  winningCards?: Card[]
  handDescription?: string | null
  showCardsMode?: ShowCardsMode
  revealChoiceActive?: boolean
  showCardsControl?: React.ReactNode
  preActionControl?: React.ReactNode
}

export function OwnHand({
  cards,
  isActing,
  isFolded = false,
  isWinner = false,
  winningCards = [],
  handDescription = null,
  showCardsMode = 'none',
  revealChoiceActive = false,
  showCardsControl = null,
  preActionControl = null,
}: OwnHandProps) {
  if (cards.length === 0) {
    return null
  }

  const isCardFaceUp = (index: number) => {
    if (!isFolded && !revealChoiceActive) {
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
        isWinner && 'is-winner',
        preActionControl && 'has-pre-action'
      )}
      aria-label={handDescription ? `Your hand: ${handDescription}` : 'Your hand'}
    >
      {isActing && <div className="own-hand-turn-chip">Act now</div>}
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
              !isCardFaceUp(index) && 'is-face-down',
              (isFolded || revealChoiceActive) && isCardFaceUp(index) && 'is-shown'
            )}
          >
            <PlayingCard
              card={card}
              size="xl"
              animateIn
              highlighted={isWinner && (
                winningCards.length === 0 || winningCards.some(
                  winningCard => winningCard.rank === card.rank && winningCard.suit === card.suit
                )
              )}
              faceDown={!isCardFaceUp(index)}
            />
          </div>
        ))}
      </div>
      {preActionControl && <div className="own-hand-pre-action">{preActionControl}</div>}
      {showCardsControl && <div className="own-hand-show-cards">{showCardsControl}</div>}
    </div>
  )
}
