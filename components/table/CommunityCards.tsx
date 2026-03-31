'use client'

import type { Card, BettingRound } from '@/lib/poker/types'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface CommunityCardsProps {
  cards: Card[]
  round: BettingRound | null
}

// How many cards are visible per round
const ROUND_CARD_COUNTS: Partial<Record<BettingRound, number>> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
}

export function CommunityCards({ cards, round }: CommunityCardsProps) {
  const visibleCount = round ? (ROUND_CARD_COUNTS[round] ?? 0) : 0

  return (
    <div className="community-cards">
      {Array.from({ length: 5 }, (_, i) => {
        const card = cards[i]
        const isVisible = i < visibleCount && card !== undefined

        return (
          <div
            key={i}
            style={{
              transition: 'opacity 0.3s ease, transform 0.3s ease',
              opacity: isVisible ? 1 : 0.3,
            }}
          >
            <PlayingCard
              card={isVisible ? card : undefined}
              faceDown={!isVisible}
              size="lg"
              animateIn={isVisible}
            />
          </div>
        )
      })}
    </div>
  )
}
