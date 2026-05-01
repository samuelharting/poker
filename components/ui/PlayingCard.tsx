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

const SUIT_PATHS: Record<Card['suit'], string> = {
  clubs:
    'M32 5.5c-7.8 0-13.6 5.8-13.6 13.2 0 3.8 1.5 7.1 3.9 9.5a15.5 15.5 0 0 0-5-.9C9.6 27.3 4 33 4 40.4c0 7.7 5.8 13.2 13.4 13.2 4.6 0 8.1-2.1 10.2-5.5-.5 5.1-3.5 9-9.1 11.4h27c-5.6-2.4-8.6-6.3-9.1-11.4 2.1 3.4 5.6 5.5 10.2 5.5C54.2 53.6 60 48.1 60 40.4c0-7.4-5.6-13.1-13.3-13.1-1.8 0-3.4.3-5 .9 2.4-2.4 3.9-5.7 3.9-9.5C45.6 11.3 39.8 5.5 32 5.5Z',
  spades:
    'M32 4.5C23.7 16.2 10.3 26 10.3 39.7c0 8.2 5.5 13.9 13.1 13.9 4.4 0 7.7-2 9.7-5.4-.4 5.2-3.4 9-9 11.3h15.8c-5.6-2.3-8.6-6.1-9-11.3 2 3.4 5.3 5.4 9.7 5.4 7.6 0 13.1-5.7 13.1-13.9C53.7 26 40.3 16.2 32 4.5Z',
  hearts:
    'M32 57.5C21.1 48.5 8.5 37.1 8.5 23.7c0-8.4 5.9-14.1 13.3-14.1 4.7 0 8.3 2.4 10.2 6.4 1.9-4 5.5-6.4 10.2-6.4 7.4 0 13.3 5.7 13.3 14.1 0 13.4-12.6 24.8-23.5 33.8Z',
  diamonds:
    'M32 4.5 54.5 32 32 59.5 9.5 32 32 4.5Z',
}

function SuitIcon({ suit }: { suit: Card['suit'] }) {
  const className = `card-suit-icon card-suit-icon-${suit}`

  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <path className="card-suit-main" d={SUIT_PATHS[suit]} />
    </svg>
  )
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
                  <SuitIcon suit={card.suit} />
                </span>
              </div>
              <span className={clsx('card-center-suit', suitClass)} aria-hidden="true">
                <SuitIcon suit={card.suit} />
              </span>
              <div className="card-corner card-corner-bottom">
                <span className="card-rank-top">{getRankDisplay(card.rank)}</span>
                <span className={clsx('card-suit-top', suitClass)} aria-hidden="true">
                  <SuitIcon suit={card.suit} />
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
