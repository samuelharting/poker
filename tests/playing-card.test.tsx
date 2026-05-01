import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { PlayingCard } from '@/components/ui/PlayingCard'

describe('PlayingCard suit icons', () => {
  it('renders club icons as unified path artwork instead of separated circle blobs', () => {
    const markup = renderToStaticMarkup(
      <PlayingCard card={{ rank: 'K', suit: 'clubs' }} />
    )

    expect(markup.match(/<svg class="card-suit-icon /g)?.length).toBe(3)
    expect(markup).toContain('viewBox="0 0 64 64"')
    expect(markup.match(/card-suit-main/g)?.length).toBe(3)
    expect(markup).not.toContain('<circle')
    expect(markup).not.toContain('card-suit-lobe')
    expect(markup).not.toContain('\u2663')
  })

  it('keeps center suit pips smaller than the card corners and ranks', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

    expect(css).toMatch(/\.card-suit-top\s*{[^}]*width:\s*0\.44em;/s)
    expect(css).toMatch(/\.card-center-suit\s*{[^}]*width:\s*1\.68em;/s)
    expect(css).toMatch(/\.card-center-suit\.card-suit-spades,[\s\S]*?width:\s*1\.56em;/)
    expect(css).toMatch(/\.card\.card-xs \.card-center-suit\s*{[^}]*width:\s*0\.84em;/s)
  })
})
