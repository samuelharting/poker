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

  it('keeps folded hero cards face-up to their owner and marks which ones the table sees', () => {
    const markup = renderToStaticMarkup(
      <OwnHand
        cards={[
          { rank: '9', suit: 'spades' },
          { rank: 'K', suit: 'diamonds' },
        ]}
        isActing={false}
        isFolded
        revealChoiceActive
        showCardsMode="right"
        showCardsControl={<button type="button">R</button>}
      />
    )

    expect(markup).toContain('own-hand-area')
    expect(markup).toContain('is-folded')
    expect(markup).not.toContain('Face-down card')
    expect(markup).toContain('9 of spades')
    expect(markup).toContain('K of diamonds')
    expect(markup).toContain('own-card-slot-left is-private')
    expect(markup).toContain('own-card-slot-right is-shown')
    expect(markup).not.toContain('Hidden from table')
    expect(markup).toContain('own-hand-show-cards')
  })

  it('never flips your own cards over after a mucked hand; it marks them hidden from the table', () => {
    const cards = [
      { rank: 'A' as const, suit: 'spades' as const },
      { rank: 'K' as const, suit: 'diamonds' as const },
    ]

    const mucked = renderToStaticMarkup(
      <OwnHand cards={cards} isActing={false} isWinner revealChoiceActive showCardsMode="none" />
    )
    const live = renderToStaticMarkup(
      <OwnHand cards={cards} isActing={false} showCardsMode="none" />
    )

    expect(mucked).not.toContain('Face-down card')
    expect(mucked).toContain('A of spades')
    expect(mucked).toContain('K of diamonds')
    expect(mucked).toContain('Hidden from table')
    expect(live).not.toContain('Hidden from table')
    expect(live).not.toContain('is-private')
  })

  it('labels a targeted emote with its sender', () => {
    const markup = renderToStaticMarkup(
      <OwnHand
        cards={[{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]}
        isActing={false}
        socialEmote={String.fromCodePoint(0x1f595)}
        socialEmoteExpiresAt={Date.now() + 5000}
        socialEmoteTargeted
        socialEmoteFrom="Maverick"
      />
    )

    expect(markup).toContain('Maverick →')
  })
})
