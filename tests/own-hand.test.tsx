import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OwnHand } from '@/components/table/OwnHand'
import { DEFAULT_PEEK_STYLE, PEEK_STYLES, PEEK_STYLE_LABELS, normalizePeekStyle } from '@/lib/peekStyle'

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

describe('OwnHand peeking (live hand)', () => {
  const cards = [
    { rank: '8' as const, suit: 'clubs' as const },
    { rank: '8' as const, suit: 'hearts' as const },
  ]

  it('deals your cards face-down under the card back and hides the strength until you peek', () => {
    const markup = renderToStaticMarkup(
      <OwnHand cards={cards} isActing handDescription="Pair of Eights" concealed />
    )

    expect(markup).toContain('own-card-row is-concealed')
    expect(markup).toContain('own-card-cover-back')
    expect(markup).toContain('data-peek="idle"')
    expect(markup).toContain('role="button"')
    expect(markup).not.toContain('Pair of Eights')
    expect(markup).not.toContain('has-strength')
    expect(markup).toContain('own-card-peek-face" aria-hidden="true"')
  })

  it('shows the short look hint until the first peek of the session', () => {
    const markup = renderToStaticMarkup(<OwnHand cards={cards} isActing={false} concealed />)
    expect(markup).toContain('Hold or tap to look')
    expect(markup).toContain('Hold Space or click to look')
    expect(markup).not.toContain('Tap to peek')
  })

  it('tags the card row with a swappable reveal style (light wipe by default)', () => {
    expect(renderToStaticMarkup(<OwnHand cards={cards} isActing={false} concealed />)).toContain('data-peek-style="wipe"')
    expect(renderToStaticMarkup(<OwnHand cards={cards} isActing={false} concealed peekStyle="wipe" />)).toContain('data-peek-style="wipe"')
  })

  it('offers the sideways peel-up style alongside the others, keeping light wipe as the default', () => {
    expect(PEEK_STYLES).toEqual(['wipe', 'curl', 'spin', 'slide', 'peel'])
    expect(DEFAULT_PEEK_STYLE).toBe('wipe')
    expect(PEEK_STYLE_LABELS.peel.name).toBe('Peel up')
    expect(normalizePeekStyle('peel')).toBe('peel')
    const markup = renderToStaticMarkup(<OwnHand cards={cards} isActing={false} concealed peekStyle="peel" />)
    expect(markup).toContain('data-peek-style="peel"')
    expect(markup).toContain('own-card-peek-turn')
    expect(markup).toContain('own-card-cover-back')
  })

  it('reveals the cards and strength as before once the hand is over', () => {
    const markup = renderToStaticMarkup(
      <OwnHand cards={cards} isActing={false} handDescription="Pair of Eights" revealChoiceActive />
    )

    expect(markup).not.toContain('own-card-cover')
    expect(markup).not.toContain('to look')
    expect(markup).toContain('Pair of Eights')
    expect(markup).toContain('8 of clubs')
  })
})
