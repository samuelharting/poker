'use client'

import type { Card } from '@/lib/poker/types'
import clsx from 'clsx'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface OwnHandProps {
  cards: Card[]
  isActing: boolean
}

export function OwnHand({ cards, isActing }: OwnHandProps) {
  if (cards.length === 0) {
    return null
  }

  return (
    <div className={clsx('own-hand-area', isActing && 'is-acting')}>
      <div className="own-card-row">
        {cards.map((card, index) => (
          <div
            key={`${card.rank}-${card.suit}-${index}`}
            className={clsx(
              'own-card-slot',
              index === 0 ? 'own-card-slot-left' : 'own-card-slot-right'
            )}
          >
            <PlayingCard card={card} size="lg" animateIn />
          </div>
        ))}
      </div>
    </div>
  )
}
