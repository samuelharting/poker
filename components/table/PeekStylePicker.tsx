'use client'

import clsx from 'clsx'
import React, { useEffect, useState } from 'react'
import { PlayingCard } from '@/components/ui/PlayingCard'
import type { Card } from '@/lib/poker/types'
import { PEEK_STYLES, PEEK_STYLE_LABELS, usePeekStyle, type PeekStyle } from '@/lib/peekStyle'

const PREVIEW_CARDS: Card[] = [
  { rank: 'A', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
]

/** Settings row: pick how your cards animate when you look at them. */
export function PeekStylePicker() {
  const [style, setStyle] = usePeekStyle()

  return (
    <div className="settings-rule-row peek-style-row">
      <div className="peek-style-head">
        <div>
          <div className="settings-rule-name">Card peek style</div>
          <div className="settings-rule-copy">{PEEK_STYLE_LABELS[style].blurb}.</div>
        </div>
        <PeekStylePreview key={style} style={style} />
      </div>
      <div className="peek-style-options" role="radiogroup" aria-label="Card peek style">
        {PEEK_STYLES.map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={style === option}
            className={clsx('settings-pill', style === option && 'is-active')}
            data-peek-style-option={option}
            onClick={() => setStyle(option)}
          >
            {PEEK_STYLE_LABELS[option].name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A tiny pair of cards that plays the chosen reveal on a loop (tap to replay). */
function PeekStylePreview({ style }: { style: PeekStyle }) {
  const [up, setUp] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const loop = (next: boolean) => {
      setUp(next)
      timer = setTimeout(() => loop(!next), next ? 1400 : 900)
    }
    timer = setTimeout(() => loop(true), 250)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="peek-style-preview" aria-hidden="true">
      <div
        className={clsx('own-card-row', 'is-concealed', up && 'is-peeking', up && 'is-peek-held')}
        data-peek-style={style}
      >
        {PREVIEW_CARDS.map((card, index) => (
          <div
            key={`${card.rank}-${card.suit}`}
            className={clsx('own-card-slot', index === 0 ? 'own-card-slot-left' : 'own-card-slot-right')}
          >
            <div className="own-card-peek">
              <div className="own-card-peek-body">
                <div className="own-card-peek-face">
                  <PlayingCard card={card} size="xl" animateIn={false} />
                </div>
                <span className="own-card-peek-shade" />
                <div className="own-card-cover">
                  <div className="own-card-cover-curl">
                    <div className="own-card-cover-back" />
                    <span className="own-card-cover-sheen" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
