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

const SUIT_ICON: Record<Card['suit'], JSX.Element> = {
  spades: (
    <svg viewBox="0 0 24 24" className="playing-card-icon-spades" aria-hidden="true">
      <ellipse cx="8.7" cy="10" rx="4.1" ry="4.8" />
      <ellipse cx="15.3" cy="10" rx="4.1" ry="4.8" />
      <path d="M12 13.8c-.5 0-.5 0-.8-.1-1.5-1.1-4.4-3.7-4.4-6.2 0-2.1 1.6-3.7 3.7-3.7 1.2 0 2.3.6 3 1.6.7-1 1.8-1.6 3-1.6 2.1 0 3.7 1.6 3.7 3.7 0 2.5-2.9 5.1-4.4 6.2-.3.2-.3.2-.8.2" />
      <path d="M10.4 13.8 12 21l1.6-7.2z" />
    </svg>
  ),
  hearts: (
    <svg viewBox="0 0 24 24" className="playing-card-icon-hearts" aria-hidden="true">
      <path d="M12 20.8s-.1-.1-.2-.2C7 16 4 13.2 4 9.7 4 7 6 5 8.6 5c1.7 0 3.2 1 3.6 2.4.3-1.4 1.8-2.4 3.5-2.4C17.4 5 19.4 7 19.4 9.7c0 3.5-3 6.3-7.8 11-.1.1-.2.2-.6.4-.3-.2-.4-.3-.6-.4Z" />
    </svg>
  ),
  diamonds: (
    <svg viewBox="0 0 24 24" className="playing-card-icon-diamonds" aria-hidden="true">
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8z" />
    </svg>
  ),
  clubs: (
    <svg viewBox="0 0 24 24" className="playing-card-icon-clubs" aria-hidden="true">
      <circle cx="12" cy="6.7" r="3.1" />
      <circle cx="7.9" cy="11.4" r="3.1" />
      <circle cx="16.1" cy="11.4" r="3.1" />
      <path d="M10.9 10.8H13v9.6h-2.1v-7.3h-.7l-.9 4.4h-1.9l1.2-4.4h-1.3V10.8z" />
    </svg>
  ),
}

const SUIT_SYMBOL: Record<string, JSX.Element> = SUIT_ICON

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
