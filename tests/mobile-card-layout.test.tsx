import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CommunityCards } from '@/components/table/CommunityCards'
import {
  getSeatActionChip,
  getSeatInitials,
  getSeatTone,
} from '@/components/table/PokerTable'

const table2dCss = readFileSync(join(process.cwd(), 'app', 'styles', 'table-2d.css'), 'utf8')
const layoutSource = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8')
const pokerTableSource = readFileSync(
  join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
  'utf8'
)

describe('2D table card layout', () => {
  it('exposes the number of dealt board cards for the 2D table', () => {
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

  it('loads the 2D stylesheet after the legacy layers', () => {
    expect(layoutSource.indexOf("import './styles/table-2d.css'")).toBeGreaterThan(
      layoutSource.indexOf("import './poker-polish.css'")
    )
  })

  it('keeps the board a stable width with printed guides for streets still to come', () => {
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-cards\[data-visible-count='0'\] \.community-card-slot\s*\{[^}]*visibility:\s*hidden;/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-card-slot:not\(\.is-live\)\s*\{[^}]*border:\s*1\.5px dashed/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-card-slot\s*\{[^}]*width:\s*var\(--board-card-w\);/s
    )
    expect(table2dCss).toContain('@keyframes boardCardDeal')
  })

  it('fans the hero hand in the thumb zone and simplifies small card faces', () => {
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.own-card-slot-left\s*\{[^}]*transform:\s*rotate\(-7deg\)/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.own-card-slot-right\s*\{[^}]*transform:\s*rotate\(7deg\)/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.card-corner-bottom,\s*\[data-layout='2d'\] \.mobile-board-zone \.card-corner-bottom\s*\{[^}]*display:\s*none;/s
    )
    expect(table2dCss).toMatch(/\.mobile-hero-lane\s*\{[^}]*margin-top:\s*calc\(var\(--hero-card-h\) \* -0\.5\);/s)
  })

  it('shows revealed opponent hands over the avatar puck, fanned apart', () => {
    expect(pokerTableSource).toContain("hasVisibleHoleCards ? 'has-visible-cards' : ''")
    expect(table2dCss).toMatch(
      /\.mobile-edge-seat-cards\.is-revealed \.card-container:first-child\s*\{[^}]*transform:\s*rotate\(-5deg\);/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-edge-seat-cards\.is-revealed \.card-container:last-child\s*\{[^}]*transform:\s*rotate\(5deg\);/s
    )
  })

  it('animates wagers out from each seat and collects them into the pot', () => {
    expect(pokerTableSource).toContain('function MobileBetIndicator')
    expect(pokerTableSource).toContain('function MobileBetCollect')
    expect(pokerTableSource).toContain('key={`${player.id}-${player.bet}`}')
    expect(pokerTableSource).toContain('key={`${visibleOwnPlayer.id}-${visibleOwnPlayer.bet}`}')
    expect(pokerTableSource).toContain('className="mobile-edge-bet-anchor"')
    expect(pokerTableSource).toContain('className="mobile-hero-bet-anchor"')
    expect(table2dCss).toContain('@keyframes mobileBetCommit')
    expect(table2dCss).toMatch(/\.mobile-bet-indicator\s*\{[^}]*animation:\s*mobileBetCommit 420ms/s)
    expect(table2dCss).toContain('@keyframes chipsToPot')
    expect(table2dCss).toContain('calc((50 - var(--sx, 50)) * 1cqw - var(--bx, 0px))')
  })

  it('places every seat on the rail and keeps edge seats on screen', () => {
    for (let seat = 0; seat <= 7; seat += 1) {
      expect(table2dCss).toMatch(new RegExp(`\\.mobile-seat-position-${seat} \\{ --sx: \\d+; --sy: \\d+; \\}`))
    }
    expect(pokerTableSource).not.toContain('MOBILE_SEAT_NUMBERS_BY_VISUAL_SEAT')
    expect(pokerTableSource).not.toContain('mobile-seat-number')
  })

  it('keeps card reveal controls above the seat and at least a comfortable tap size', () => {
    expect(table2dCss).toMatch(
      /\.mobile-card-reveal-control\s*\{[^}]*top:\s*calc\(var\(--avatar\) \* -0\.6\);/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-card-reveal-control \.card-reveal-seat-button\s*\{[^}]*min-width:\s*44px;/s
    )
  })
})

describe('2D seat helpers', () => {
  it('builds avatar initials without the bot prefix', () => {
    expect(getSeatInitials('Bot Bluff')).toBe('B')
    expect(getSeatInitials('Bot Dealer Dan')).toBe('DD')
    expect(getSeatInitials('sam harting')).toBe('SH')
    expect(getSeatInitials('   ')).toBe('?')
  })

  it('uses the jacket colour for the avatar tone, or a stable fallback', () => {
    expect(getSeatTone({ id: 'a', avatar: { jacketColor: 'emerald' } as never })).toBe('emerald')
    expect(getSeatTone({ id: 'player-1' })).toBe(getSeatTone({ id: 'player-1' }))
  })

  it('labels the latest action on the current street', () => {
    const base = { status: 'active' as const, hasActedThisRound: true }
    expect(getSeatActionChip({ ...base, lastAction: 'Called $20' })).toEqual({ label: 'Call $20', tone: 'call' })
    expect(getSeatActionChip({ ...base, lastAction: 'Raised $80' })).toEqual({ label: 'Raise $80', tone: 'raise' })
    expect(getSeatActionChip({ ...base, lastAction: 'Checked' })).toEqual({ label: 'Check', tone: 'check' })
    expect(getSeatActionChip({ ...base, lastAction: 'Called $20', hasActedThisRound: false })).toBeNull()
    expect(getSeatActionChip({ status: 'folded', hasActedThisRound: false })).toEqual({ label: 'Fold', tone: 'fold' })
    expect(getSeatActionChip({ status: 'all_in', hasActedThisRound: true, lastAction: 'All-in $900' })).toEqual({
      label: 'All-in',
      tone: 'all-in',
    })
  })
})
