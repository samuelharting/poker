'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import type { Card } from '@/lib/poker/types'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface CommunityCardsProps {
  cards: Card[]
}

const CARD_REVEAL_STAGGER_MS = 180
const CARD_REVEAL_SETTLE_MS = 620

export function getVisibleCommunityCardCount(cards: Card[]): number {
  return Math.min(cards.length, 5)
}

export function CommunityCards({ cards }: CommunityCardsProps) {
  const visibleCount = getVisibleCommunityCardCount(cards)
  const [revealedCount, setRevealedCount] = useState(visibleCount)
  const [revealingIndexes, setRevealingIndexes] = useState<number[]>([])
  const isFirstRenderRef = useRef(true)
  const previousVisibleCountRef = useRef(visibleCount)

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      previousVisibleCountRef.current = visibleCount
      setRevealedCount(visibleCount)
      return
    }

    const previousVisibleCount = previousVisibleCountRef.current
    previousVisibleCountRef.current = visibleCount

    if (visibleCount <= previousVisibleCount) {
      setRevealedCount(visibleCount)
      setRevealingIndexes([])
      return
    }

    const timers: number[] = []

    for (let index = previousVisibleCount; index < visibleCount; index += 1) {
      const delay = (index - previousVisibleCount) * CARD_REVEAL_STAGGER_MS

      timers.push(
        window.setTimeout(() => {
          setRevealedCount((current) => Math.max(current, index + 1))
          setRevealingIndexes((current) =>
            current.includes(index) ? current : [...current, index]
          )
        }, delay)
      )

      timers.push(
        window.setTimeout(() => {
          setRevealingIndexes((current) => current.filter((item) => item !== index))
        }, delay + CARD_REVEAL_SETTLE_MS)
      )
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [visibleCount])

  return (
    <div className="community-cards">
      {Array.from({ length: 5 }, (_, i) => {
        const card = cards[i]
        const isBoardCard = i < visibleCount && card !== undefined
        const isRevealed = i < revealedCount && isBoardCard
        const isAnimating = revealingIndexes.includes(i)

        return (
          <div
            key={i}
            className={clsx(
              'community-card-slot',
              (isRevealed || isAnimating) && 'is-live',
              isAnimating && 'is-revealing'
            )}
          >
            <PlayingCard
              card={isBoardCard ? card : undefined}
              faceDown={!isRevealed}
              size="xl"
              className="community-card"
            />
          </div>
        )
      })}
    </div>
  )
}
