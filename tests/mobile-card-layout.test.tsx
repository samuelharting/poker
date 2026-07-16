import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CommunityCards } from '@/components/table/CommunityCards'

const polishCss = readFileSync(join(process.cwd(), 'app', 'poker-polish.css'), 'utf8')
const pokerTableSource = readFileSync(
  join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
  'utf8'
)

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

  it('keeps revealed opponent cards separated from each other and the seat badge', () => {
    expect(pokerTableSource).toContain("hasVisibleHoleCards ? 'has-visible-cards' : ''")
    expect(polishCss).toMatch(
      /\.mobile-edge-seat\.has-visible-cards > \.mobile-seat-number\s*\{[^}]*margin-bottom:\s*4px;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-edge-seat-cards\.is-revealed\s*\{[^}]*gap:\s*4px;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-edge-seat-cards\.is-revealed \.card-container:first-child\s*\{[^}]*transform:\s*rotate\(-3deg\);/s
    )
    expect(polishCss).toMatch(
      /\.mobile-edge-seat-cards\.is-revealed \.card-container:last-child\s*\{[^}]*transform:\s*rotate\(3deg\);/s
    )
    expect(polishCss).toMatch(
      /\.table-scene\[data-showdown='true'\] \.mobile-edge-seat-cards\.is-revealed\s*\{[^}]*margin-top:\s*0;/s
    )
  })

  it('moves the post-hand mobile reveal controls below the table content', () => {
    expect(polishCss).toMatch(
      /\.table-scene\[data-phase='between_hands'\]\[data-show-cards='true'\] \.mobile-hero-lane\s*\{[^}]*bottom:\s*calc\(92px \+ env\(safe-area-inset-bottom\)\);/s
    )
    expect(polishCss).toMatch(
      /@media \(max-width: 390px\) and \(max-height: 740px\)[\s\S]*?\.table-scene\[data-phase='between_hands'\]\[data-show-cards='true'\] \.mobile-hero-lane\s*\{[^}]*bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\);/s
    )
  })

  it('animates current-street wagers in front of mobile opponent and hero cards', () => {
    expect(pokerTableSource).toContain('function MobileBetIndicator')
    expect(pokerTableSource).toContain('key={`${player.id}-${player.bet}`}')
    expect(pokerTableSource).toContain('key={`${visibleOwnPlayer.id}-${visibleOwnPlayer.bet}`}')
    expect(pokerTableSource).toContain('className="mobile-edge-bet-anchor"')
    expect(pokerTableSource).toContain('className="mobile-hero-bet-anchor"')
    expect(polishCss).toContain('@keyframes mobileBetCommit')
    expect(polishCss).toMatch(
      /\.mobile-bet-indicator\s*\{[^}]*animation:\s*mobileBetCommit 420ms/s
    )
    expect(polishCss).toMatch(
      /\.mobile-seat-1 \.mobile-edge-bet-anchor,[\s\S]*?left:\s*calc\(50% \+ 5px\);/s
    )
    expect(polishCss).toMatch(
      /\.mobile-seat-5 \.mobile-edge-bet-anchor,[\s\S]*?right:\s*calc\(50% \+ 5px\);/s
    )
    expect(polishCss).toMatch(
      /@media \(max-width: 390px\) and \(max-height: 620px\)[\s\S]*?\.table-scene\[data-tray-open='true'\] \.mobile-board-zone\s*\{[^}]*top:\s*31%;/s
    )
  })

  it('keeps mobile card reveal controls clear of wager badges', () => {
    expect(polishCss).toMatch(
      /\.mobile-card-reveal-control\s*\{[^}]*left:\s*calc\(50% \+ 25px\);[^}]*top:\s*3px;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-seat-position-5 \.mobile-card-reveal-control,[\s\S]*?right:\s*calc\(50% \+ 25px\);[^}]*left:\s*auto;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-seat-position-0 \.mobile-card-reveal-control,[\s\S]*?\.mobile-seat-position-4 \.mobile-card-reveal-control\s*\{[^}]*left:\s*calc\(50% \+ 50px\);[^}]*top:\s*29px;/s
    )
    expect(polishCss).toMatch(
      /\.mobile-seat-position-2 \.mobile-card-reveal-control,[\s\S]*?\.mobile-seat-position-6 \.mobile-card-reveal-control\s*\{[^}]*top:\s*-23px;/s
    )
  })
})
