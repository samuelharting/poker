'use client'

import type { Card } from '@/lib/poker/types'
import clsx from 'clsx'

interface PlayingCardProps {
  card?: Card
  faceDown?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  animateIn?: boolean
  highlighted?: boolean
}

const SUIT_SYMBOL: Record<string, string> = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
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
      >
        <div className={clsx('card-face', suitClass, isRed && 'red')}>
          {card && (
            <>
              <div className="card-corner card-corner-top">
                <span className="card-rank-top">{getRankDisplay(card.rank)}</span>
                <span className={clsx('card-suit-top', suitClass)}>{SUIT_SYMBOL[card.suit]}</span>
              </div>
              <span className={clsx('card-center-suit', suitClass)}>{SUIT_SYMBOL[card.suit]}</span>
              <div className="card-corner card-corner-bottom">
                <span className="card-rank-top">{getRankDisplay(card.rank)}</span>
                <span className={clsx('card-suit-top', suitClass)}>{SUIT_SYMBOL[card.suit]}</span>
              </div>
            </>
          )}
        </div>

        <div className="card-back" />
      </div>
    </div>
  )
}
