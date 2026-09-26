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

describe('2D layout cards and seats', () => {
  it('exposes the number of dealt board cards for the 2D layout', () => {
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

  it('keeps the board a stable width and hides empty guides before the flop', () => {
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-cards\[data-visible-count='0'\] \.community-card-slot\s*\{[^}]*visibility:\s*hidden;/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-card-slot:not\(\.is-live\)\s*\{[^}]*border:\s*1px dashed/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-board-zone \.community-card-slot\s*\{[^}]*width:\s*var\(--board-card-w\);/s
    )
    expect(table2dCss).toContain('@keyframes boardCardDeal')
  })

  it('shows the hero hand large with a gentle fan and simple card faces', () => {
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.own-card-slot-left,[^{]*\{[^}]*transform:\s*rotate\(-5deg\)/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.own-card-slot-right,[^{]*\{[^}]*transform:\s*rotate\(5deg\)/s
    )
    expect(table2dCss).toMatch(
      /\.mobile-hero-lane \.card-corner-bottom,\s*\[data-layout='2d'\] \.mobile-board-zone \.card-corner-bottom\s*\{[^}]*display:\s*none;/s
    )
    expect(table2dCss).toMatch(/--hero-card-w: clamp\(60px, 18vw, 96px\);/)
  })

  it('shows revealed opponent hands as a compact row inside the seat chip', () => {
    expect(pokerTableSource).toContain("hasVisibleHoleCards ? 'has-visible-cards' : ''")
    expect(table2dCss).toMatch(
      /\.mobile-edge-seat > \.mobile-edge-seat-cards\.is-revealed\s*\{[^}]*grid-area:\s*cards;/s
    )
  })

  it('shows each current bet as a small badge inside the seat chip', () => {
    expect(pokerTableSource).toContain('function MobileBetIndicator')
    expect(pokerTableSource).not.toContain('function MobileBetCollect')
    expect(pokerTableSource).toContain('key={`${player.id}-${player.bet}`}')
    expect(pokerTableSource).toContain('className="mobile-edge-bet-anchor"')
    expect(pokerTableSource).toContain('className="mobile-hero-bet-anchor"')
    expect(table2dCss).toContain('@keyframes mobileBetCommit')
    expect(table2dCss).toMatch(/\.mobile-bet-indicator\s*\{[^}]*animation:\s*mobileBetCommit 280ms/s)
    expect(table2dCss).not.toContain('@keyframes chipsToPot')
  })

  it('lays seats out as a balanced grid instead of positions around a table', () => {
    expect(table2dCss).toContain(".mobile-seat-grid[data-seat-count='7'] { --n: 7; --cols: 4; }")
    expect(table2dCss).toContain(".mobile-seat-grid[data-seat-count='5'] { --n: 5; --cols: 3; }")
    expect(table2dCss).not.toMatch(/--sx:/)
    expect(pokerTableSource).not.toContain('MOBILE_SEAT_NUMBERS_BY_VISUAL_SEAT')
    expect(pokerTableSource).not.toContain('MOBILE_EDGE_SAFE_SEATS_BY_COUNT')
    expect(pokerTableSource).not.toContain('mobile-seat-number')
  })

  it('keeps card reveal controls inside the chip and at least a comfortable tap size', () => {
    expect(table2dCss).toMatch(
      /\.mobile-card-reveal-control\s*\{[^}]*position:\s*absolute;[^}]*right:\s*4px;/s
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
