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
})
