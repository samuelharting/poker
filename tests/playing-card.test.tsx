import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlayingCard } from '@/components/ui/PlayingCard'
import type { Card } from '@/lib/poker/types'

describe('PlayingCard suit rendering', () => {
  it('renders standard suit glyphs for every card suit', () => {
    const expectedSymbols: Array<[Card['suit'], string]> = [
      ['spades', '\u2660'],
      ['hearts', '\u2665'],
      ['diamonds', '\u2666'],
      ['clubs', '\u2663'],
    ]

    for (const [suit, symbol] of expectedSymbols) {
      const markup = renderToStaticMarkup(<PlayingCard card={{ rank: 'A', suit }} />)

      expect(markup).toContain(symbol)
      expect(markup).not.toContain('<svg')
    }
  })
})
