'use client'

import type { Card } from '@/lib/poker/types'
import type { ShowCardsMode } from '@/lib/poker/types'
import clsx from 'clsx'
import React from 'react'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'

interface OwnHandProps {
  cards: Card[]
  isActing: boolean
  isFolded?: boolean
  isWinner?: boolean
  winningCards?: Card[]
  handDescription?: string | null
  showCardsMode?: ShowCardsMode
  revealChoiceActive?: boolean
  socialMessage?: string
  socialMessageExpiresAt?: number
  socialEmote?: string
  socialEmoteExpiresAt?: number
  socialEmoteTargeted?: boolean
  showCardsControl?: React.ReactNode
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
  socialMessage,
  socialMessageExpiresAt,
  socialEmote,
  socialEmoteExpiresAt,
  socialEmoteTargeted = false,
  showCardsControl = null,
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

  const socialBubbleTtl = Math.max(0, socialMessageExpiresAt ? socialMessageExpiresAt - Date.now() : 0)
  const socialEmoteTtl = Math.max(0, socialEmoteExpiresAt ? socialEmoteExpiresAt - Date.now() : 0)

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
      {(socialMessage || socialEmote) && (
        <div className="own-hand-social" aria-live="polite">
          {socialMessage && (
            <div
              key={`${socialMessage}-${socialMessageExpiresAt}`}
              className="player-chat-bubble"
              style={{ ['--chat-ttl' as any]: `${socialBubbleTtl}ms` }}
            >
              {socialMessage}
            </div>
          )}
          {socialEmote && (
            <div
              key={`${socialEmote}-${socialEmoteExpiresAt}`}
              className={clsx(
                'player-emote-badge',
                socialEmoteTargeted && 'player-emote-badge-targeted'
              )}
              style={{ ['--chat-ttl' as any]: `${socialEmoteTtl}ms` }}
            >
              <EmojiGlyph emoji={socialEmote} />
            </div>
          )}
        </div>
      )}
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
      {showCardsControl && <div className="own-hand-show-cards">{showCardsControl}</div>}
    </div>
  )
}
