'use client'

import type { Card } from '@/lib/poker/types'
import clsx from 'clsx'
import React from 'react'

interface PlayingCardProps {
  card?: Card
  faceDown?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  animateIn?: boolean
  highlighted?: boolean
}

const SUIT_SYMBOL: Record<Card['suit'], string> = {
  spades: '\u2660\uFE0E',
  hearts: '\u2665\uFE0E',
  diamonds: '\u2666\uFE0E',
  clubs: '\u2663\uFE0E',
}

const RANK_DISPLAY: Record<string, string> = {
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
}

function getRankDisplay(rank: string): string {
  return RANK_DISPLAY[rank] ?? rank
}

export function PlayingCard({
  card,
  faceDown = false,
  size = 'md',
  className,
  animateIn = false,
  highlighted = false,
}: PlayingCardProps) {
  const isRed = card?.suit === 'hearts' || card?.suit === 'diamonds'
  const showFaceDown = faceDown || !card
  const suitClass = card ? `card-suit-${card.suit}` : undefined
  const ariaLabel = card && !showFaceDown
    ? `${getRankDisplay(card.rank)} of ${card.suit}`
    : 'Face-down card'

  return (
    <div className={clsx('card-container', className)}>
      <div
        className={clsx(
          'card',
          size === 'xl' && 'card-xl',
          size === 'lg' && 'card-lg',
          size === 'xs' && 'card-xs',
          size === 'sm' && 'card-sm',
          showFaceDown && 'face-down',
          animateIn && 'card-deal-anim',
          highlighted && 'card-highlighted'
        )}
        aria-label={ariaLabel}
      >
        <div className={clsx('card-face', suitClass, isRed && 'red')}>
          {card && (
            <>
              <div className="card-corner card-corner-top">
                <span className="card-rank-top">{getRankDisplay(card.rank)}</span>
                <span className={clsx('card-suit-top', suitClass)} aria-hidden="true">
                  {SUIT_SYMBOL[card.suit]}
                </span>
              </div>
              <span className={clsx('card-center-suit', suitClass)} aria-hidden="true">
                {SUIT_SYMBOL[card.suit]}
              </span>
              <div className="card-corner card-corner-bottom">
                <span className="card-rank-top">{getRankDisplay(card.rank)}</span>
                <span className={clsx('card-suit-top', suitClass)} aria-hidden="true">
                  {SUIT_SYMBOL[card.suit]}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="card-back" />
      </div>
    </div>
  )
}
