import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CommunityCards } from '@/components/table/CommunityCards'

const polishCss = readFileSync(join(process.cwd(), 'app', 'poker-polish.css'), 'utf8')

describe('mobile card layout hardening', () => {
  it('exposes the number of dealt board cards for the phone layout', () => {
    expect(renderToStaticMarkup(<CommunityCards cards={[]} />)).toContain(
      'data-visible-count="0"'
    )

    expect(renderToStaticMarkup(
      <CommunityCards cards={[
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'clubs' },
      ]} />
    )).toContain('data-visible-count="3"')
  })

  it('removes ghost board slots and keeps the real hero hand above its identity', () => {
    expect(polishCss).toContain(".mobile-board-zone .community-cards[data-visible-count='0']")
    expect(polishCss).toMatch(
      /\.mobile-board-zone \.community-card-slot:not\(\.is-live\)\s*\{[^}]*display:\s*none;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-hero-lane \.own-hand-area\s*\{[^}]*order:\s*1;[^}]*transform:\s*none;/s
    )
    expect(polishCss).toMatch(
      /\.table-scene\[data-hero-seat='true'\] \.mobile-hero-lane \.own-hand-area,[\s\S]*?transform:\s*none;/s
    )
    expect(polishCss).toMatch(/\.mobile-hero-seat\s*\{[^}]*order:\s*2;/s)
    expect(polishCss).toMatch(/\.mobile-hero-seat-cards\s*\{[^}]*display:\s*none;/s)
  })

  it('lifts lower seats above the tray and simplifies tiny card faces', () => {
    expect(polishCss).toMatch(
      /\.table-scene\[data-tray-open='true'\] \.mobile-seat-position-1,[\s\S]*?\.mobile-seat-position-7\s*\{[^}]*bottom:\s*24%;/s
    )
    expect(polishCss).toMatch(
      /\.table-scene\[data-tray-open='true'\] \.social-dock\s*\{[^}]*top:\s*calc\(76px \+ env\(safe-area-inset-top\)\);[^}]*bottom:\s*auto;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-board-zone \.card-corner-bottom,[\s\S]*?\.mobile-hero-lane \.card-corner-bottom\s*\{[^}]*display:\s*none;/s
    )
  })
})
