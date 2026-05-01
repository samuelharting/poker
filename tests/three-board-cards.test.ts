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
    expect(table).toContain('<CommunityCards cards={state.communityCards} />')
  })

  it('removes the duplicate turn banner when the desktop 3D layer is active', () => {
    expect(table).toContain('{isInHand && actingPlayer && !threeTableView && !isMobileViewport && (')
  })

  it('renders spectator-visible player cards inside the desktop 3D seat props', () => {
    expect(renderer).toContain('<OpponentHoleCards3D cards={player.visibleCards}')
    expect(renderer).toContain('function OpponentHoleCardFace')
    expect(renderer).toContain('const hasVisibleFaces = cards.some(card => card.visible)')
  })

  it('keeps 3D pot and wager chip stacks off the table surface', () => {
    expect(renderer).not.toContain('<DealerChipArea')
    expect(renderer).not.toContain('<HeroChips')
    expect(renderer).not.toContain('<CommittedWagerChips')
    expect(renderer).not.toContain('ref={chipPushRef}')
    expect(renderer).not.toContain('{player.bet > 0 && !isHero && (')
  })
})
