import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OwnHand } from '@/components/table/OwnHand'

describe('OwnHand strength badge', () => {
  it('shows the hand readout without coaching-style label text', () => {
    const markup = renderToStaticMarkup(
      <OwnHand
        cards={[
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ]}
        isActing={false}
        handDescription="Straight, Nine-high"
      />
    )

    expect(markup).toContain('Straight, Nine-high')
    expect(markup).not.toContain('Best hand')
    expect(markup).not.toContain('best hand')
    expect(markup).not.toContain('You have')
  })

  it('keeps folded hero cards in place face-down and flips selected cards up', () => {
    const markup = renderToStaticMarkup(
      <OwnHand
        cards={[
          { rank: '9', suit: 'spades' },
          { rank: 'K', suit: 'diamonds' },
        ]}
        isActing={false}
        isFolded
        showCardsMode="right"
        showCardsControl={<button type="button">R</button>}
      />
    )

    expect(markup).toContain('own-hand-area')
    expect(markup).toContain('is-folded')
    expect(markup).toContain('is-face-down')
    expect(markup).toContain('is-shown')
    expect(markup).toContain('Face-down card')
    expect(markup).toContain('K of diamonds')
    expect(markup).toContain('own-hand-show-cards')
    expect(markup).toContain('R')
  })

  it('starts an optional post-hand reveal face-down and flips only the selected card', () => {
    const cards = [
      { rank: 'A' as const, suit: 'spades' as const },
      { rank: 'K' as const, suit: 'diamonds' as const },
    ]

    const hiddenMarkup = renderToStaticMarkup(
      <OwnHand
        cards={cards}
        isActing={false}
        revealChoiceActive
        showCardsMode="none"
      />
    )
    const leftMarkup = renderToStaticMarkup(
      <OwnHand
        cards={cards}
        isActing={false}
        revealChoiceActive
        showCardsMode="left"
      />
    )

    expect(hiddenMarkup.match(/Face-down card/g)).toHaveLength(2)
    expect(hiddenMarkup).not.toContain('A of spades')
    expect(hiddenMarkup).not.toContain('K of diamonds')
    expect(leftMarkup).toContain('A of spades')
    expect(leftMarkup).not.toContain('K of diamonds')
    expect(leftMarkup).toContain('own-card-slot-left is-shown')
    expect(leftMarkup).toContain('own-card-slot-right is-face-down')
  })
})
