import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(
  join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
  'utf8'
)
const table = readFileSync(
  join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
  'utf8'
)

describe('desktop 3D board cards', () => {
  it('keeps community cards out of the desktop 3D canvas', () => {
    expect(renderer).not.toContain('<BoardCards2D cards={view.communityCards} />')
    expect(renderer).not.toContain('function BoardCards2D')
    expect(renderer).not.toContain('function BoardCard2D')
    expect(renderer).not.toContain('const boardCardTableTilt')
    expect(renderer).not.toContain('<planeGeometry args={[boardCardWidth, boardCardHeight]} />')
  })

  it('marks the table scene when the desktop 3D layer is active', () => {
    expect(table).toContain("data-desktop-three={threeTableView ? 'true' : 'false'}")
    expect(table).toContain('highlightedCards={highlightedWinningCards}')
  })

  it('removes the duplicate turn banner when the desktop 3D layer is active', () => {
    expect(table).toContain('{isInHand && actingPlayer && !threeTableView && !isMobileViewport && (')
  })

  it('renders spectator-visible player cards inside the desktop seat layer', () => {
    expect(renderer).toContain("player.isHero ? 'is-local-player' : ''")
    expect(renderer).toContain('!player.isOutOfHand || player.visibleCards.length > 0')
    expect(renderer).toContain('player.visibleCards.length > 0')
    expect(renderer).toContain('getThreeVisibleCardSlots(player.showCards, player.visibleCards)')
    expect(renderer).toContain('<CinematicCardSlot card={slots.left} side="left" />')
    expect(renderer).toContain('<CinematicCardSlot card={slots.right} side="right" />')
    expect(renderer).toContain('aria-label={`${card.rank} of ${card.suit}`}')
    expect(renderer).toContain('className={`is-face is-${card.suit} is-${side}`}')
    expect(renderer).toContain('keepFoldedCardsVisible: player.visibleCards.length > 0')
    expect(renderer).toContain('seat.cards.visible = seat.keepFoldedCardsVisible || (')
  })

  it('renders persistent world-space wager stacks and a physical pot mound', () => {
    expect(renderer).toContain('function syncWagers')
    expect(renderer).toContain('getTableWagerAnchor')
    expect(renderer).toContain('getTableWagerStartPoint')
    expect(renderer).toContain('interpolateWagerArc')
    expect(renderer).toContain('committed-wager-')
    expect(renderer).toContain('table-pot-chip-mound')
    expect(renderer).toContain('view.collectedPot')
    expect(renderer).toContain("view.phase === 'in_hand'")
    expect(renderer).toContain('data-table-wager-count')
    expect(renderer).toContain('data-pot-amount')
  })
})
