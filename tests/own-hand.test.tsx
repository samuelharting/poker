import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OwnHand } from '@/components/table/OwnHand'

describe('OwnHand strength badge', () => {
  it('labels the readout as the best hand, not only hole-card contribution', () => {
    const markup = renderToStaticMarkup(
      <OwnHand
        cards={[
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ]}
        bet={0}
        isActing={false}
        handDescription="Straight, Nine-high"
      />
    )

    expect(markup).toContain('Best hand')
    expect(markup).toContain('Straight, Nine-high')
    expect(markup).not.toContain('You have')
  })
})
