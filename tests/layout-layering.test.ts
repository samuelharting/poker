import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TWO_D_LAYOUT_QUERY } from '@/lib/layoutMode'

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
const polishCss = readFileSync(join(process.cwd(), 'app', 'poker-polish.css'), 'utf8')
const table2dCss = readFileSync(join(process.cwd(), 'app', 'styles', 'table-2d.css'), 'utf8')
const panelsCss = readFileSync(join(process.cwd(), 'app', 'styles', 'panels.css'), 'utf8')
const pokerTableSource = readFileSync(join(process.cwd(), 'components', 'table', 'PokerTable.tsx'), 'utf8')
const desktopThreeSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')
const emojiPickerSource = readFileSync(join(process.cwd(), 'components', 'ui', 'SearchableEmojiPicker.tsx'), 'utf8')

function expectRule(selector: string, declarations: string[], source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = Array.from(source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'gm')))

  expect(matches.length, `${selector} rule is present`).toBeGreaterThan(0)

  const hasExpectedRule = matches.some(match => {
    const body = match[1] ?? ''
    return declarations.every(declaration => body.includes(declaration))
  })

  expect(hasExpectedRule, `${selector} includes expected declarations`).toBe(true)
}

describe('room UI layering', () => {
  it('keeps result and control surfaces above resting hero cards', () => {
    expect(css).toContain('Room layering guardrails')

    expectRule(".table-scene[data-phase='between_hands'] .own-hand-area", [
      'z-index: var(--room-layer-own-hand-resting);',
      'opacity: 0.58;',
    ])
    expectRule('.table-hand-result-summary', [
      'z-index: var(--room-layer-winner);',
    ], polishCss)
    expect(css).not.toContain('--room-layer-public-reveals')
    expect(css).not.toContain('.public-card-reveals')
    expectRule('.betting-tray', [
      'z-index: var(--room-layer-action-tray);',
    ])
    expectRule('.settings-modal-overlay', [
      'z-index: var(--room-layer-modal);',
    ], panelsCss)
    expectRule(".table-scene[data-settings-open='true']", [
      'z-index: var(--room-layer-modal);',
    ])
    expect(pokerTableSource).toContain("data-settings-open={settingsOpen ? 'true' : 'false'}")
    expect(pokerTableSource).toContain('{runItTwiceVote && !settingsOpen ? (')
  })

  it('pins desktop 3D card overlays to the viewport instead of the moving camera', () => {
    expect(css).toContain('Desktop 3D fixed card overlays')

    expectRule(".table-scene[data-desktop-three='true'] .community-cards", [
      'position: fixed;',
      'left: 50%;',
      'top: 50%;',
      'transform: translate(-50%, -50%);',
      'pointer-events: none;',
    ])
    expectRule(".table-scene[data-desktop-three='true'] .own-hand-area", [
      'position: fixed;',
      'left: 50%;',
      'bottom: clamp(58px, 7vh, 82px);',
      'transform: translateX(-50%) perspective(900px) rotateX(2deg) scale(0.9);',
    ])
    expectRule(".table-scene[data-desktop-three='true'][data-tray-open='true'] .own-hand-area", [
      'position: fixed;',
      'left: 50%;',
      'bottom: clamp(58px, 7vh, 82px);',
      'transform: translateX(-50%) perspective(900px) rotateX(2deg) scale(0.9);',
    ])
  })

  it('keeps the WebGL canvas passive while player target buttons remain interactive', () => {
    expectRule('.desktop-3d-stage', [
      'pointer-events: none;',
    ], polishCss)
    expectRule('.desktop-3d-canvas', [
      'pointer-events: none;',
    ], polishCss)
    expectRule('.cinematic-seat', [
      'pointer-events: auto;',
    ], polishCss)
  })

  it('renders the targeted emoji picker as a viewport-owned, scrollable overlay', () => {
    expect(pokerTableSource).not.toContain('className="table-side-panels chat-dock"')
    expect(pokerTableSource).toContain("data-picker-open={fullPickerOpen ? 'true' : 'false'}")
    expect(pokerTableSource).toContain('{!fullPickerOpen && (')
    expect(pokerTableSource).toContain('{!fullPickerOpen && quickEmotes.map')

    // Desktop: floats above the table-talk toggle in the bottom-left corner.
    expectRule('.table-panel.targeted-emote-panel', [
      'position: fixed;',
      'width: min(320px, calc(100vw - 40px));',
      'max-height: min(680px, calc(100dvh - 180px));',
      'overflow-y: auto;',
      'overscroll-behavior: contain;',
    ], panelsCss)
    expectRule('.table-panel.targeted-emote-panel.is-picker-open', [
      'width: min(360px, calc(100vw - 40px));',
    ], panelsCss)
    expectRule('.targeted-emote-panel.is-picker-open .table-panel-header', [
      'position: sticky;',
      'top: 0;',
    ], panelsCss)
    expectRule('.targeted-emote-panel .emoji-picker-shell', [
      'width: 100%;',
      'max-width: 100%;',
      'min-width: 0;',
    ], panelsCss)
    expectRule('.targeted-emote-panel .EmojiPickerReact', [
      'width: 100% !important;',
      'max-width: 100% !important;',
      'min-width: 0 !important;',
    ], panelsCss)

    expect(pokerTableSource).toContain('height="clamp(240px, calc(100dvh - 260px), 360px)"')
    expect(emojiPickerSource).toContain('height?: string | number')
    expect(emojiPickerSource).toContain('height={height}')
  })

  it('keeps desktop 3D board cards as a readable 2D overlay', () => {
    expectRule(".table-scene[data-desktop-three='true'] .community-cards", [
      'position: fixed;',
      'top: 50%;',
      'opacity: 1;',
      'pointer-events: none;',
    ])
  })

  it('places all-in announcements above active controls without using the modal layer', () => {
    expect(panelsCss).toContain('All-in: slam, shake, ember flare, chip burst')
    expect(css).toContain('--room-layer-all-in: 226;')

    expectRule('.all-in-announcement', [
      'position: fixed;',
      'z-index: var(--room-layer-all-in, 226);',
      'pointer-events: none;',
      'animation: allInSlam 2600ms var(--ease-out) forwards;',
    ], panelsCss)
    expect(panelsCss).toContain('@keyframes allInSlam')
    expectRule('.all-in-chip', [
      'animation: allInChipBurst 920ms cubic-bezier(0.16, 0.9, 0.18, 1) forwards;',
    ], panelsCss)
  })

  it('declutters desktop center overlays while the action tray is open', () => {
    expect(css).toContain('Desktop center-overlay declutter pass')

    expectRule(".table-scene[data-tray-open='true'] .own-hand-turn-chip", [
      'display: none !important;',
    ])
    expectRule(".table-scene[data-tray-open='true'] .turn-focus-detail", [
      'display: none;',
    ])
    expectRule(".table-scene[data-tray-open='true'] .own-hand-area", [
      'bottom: clamp(40px, 6vh, 78px);',
    ])
    expectRule(".table-scene[data-tray-open='true'] .own-hand-strength", [
      'top: auto;',
      'bottom: calc(100% + 12px);',
    ])
    expectRule(".table-scene[data-tray-open='true'] .pot-display", [
      'top: clamp(156px, 22vh, 226px);',
      'transform: translateX(-50%) scale(0.9);',
    ])
    expectRule(".table-scene[data-desktop-three='true'][data-tray-open='true'] .hero-table-bet", [
      'left: 72%;',
      'top: 78%;',
      'transform: translate(-50%, -50%) perspective(720px) rotateX(12deg) scale(0.78);',
    ])
    expectRule(".table-scene[data-desktop-three='true'][data-hero-seat='true'] .own-hand-area", [
      'bottom: clamp(58px, 7vh, 82px);',
    ])
    expectRule('.hero-bottom-summary', [
      'position: fixed;',
      'bottom: calc(8px + env(safe-area-inset-bottom));',
    ])
    expectRule('.hero-bottom-summary-name', [
      'max-width: min(220px, 42vw);',
    ])
    expectRule('.hero-bottom-summary-stack', [
      'border-left: 1px solid rgba(242, 222, 161, 0.2);',
      'font-size: 15px;',
    ])
    expectRule(".table-scene[data-tray-open='true'] .community-card-slot:not(.is-live)", [
      'opacity: 0.04;',
    ])
    expectRule(".table-scene[data-tray-open='true'] .community-cards::before", [
      'background: rgba(3, 7, 8, 0.12);',
    ])
  })

  it('keeps the desktop 3D hero bet pill clear of the hand readout', () => {
    expect(css).toContain('Desktop 3D hero hand readability')

    expectRule(".table-scene[data-desktop-three='true'][data-hero-seat='true'] .hero-table-bet", [
      'left: calc(50% - clamp(230px, 18vw, 300px));',
      'top: 70%;',
      'transform: translate(-50%, -50%) perspective(720px) rotateX(12deg) scale(0.78);',
    ])
    expectRule(".table-scene[data-desktop-three='true'][data-hero-seat='true'] .own-hand-strength", [
      'bottom: calc(100% + 22px);',
      'max-width: min(260px, 24vw);',
    ])
  })

  it('uses one consolidated, collision-safe showdown result on desktop and mobile', () => {
    expect(polishCss).toContain('Consolidated showdown result')

    expectRule('.table-seat-winner-announcements', [
      'position: absolute;',
      'inset: 0;',
      'pointer-events: none;',
    ], polishCss)
    expectRule('.table-hand-result-summary', [
      'left: 50%;',
      'top: 50%;',
      'width: min(430px, calc(100% - 32px));',
      'max-height: min(42svh, 360px);',
      'background:',
    ], polishCss)
    // 2D layout: the result card takes the pot's line above the board, with a
    // simple brass outline.
    expectRule('.mobile-edge-winners', [
      'width: min(100%, 360px);',
      'border: 1px solid var(--c-brass-400);',
    ], table2dCss)
    expectRule('.mobile-board-footer', [
      'display: flex;',
      'justify-content: center;',
    ], table2dCss)
    expect(table2dCss).toMatch(/\.mobile-board-header,\s*\.mobile-board-footer \{/)
    expect(pokerTableSource).toContain('className="table-hand-result-summary"')
    expect(pokerTableSource).toContain("winnerDisplays.length > 1 ? 'Split pot' : 'Hand winner'")
    expect(pokerTableSource).not.toContain('className="table-center-winner-announcement"')
  })

  it('keeps the large winner chip payout on desktop and a simple highlight on 2D', () => {
    // The 2D layout marks the winner in their seat chip ("+$180") instead of
    // flying chips across the screen.
    expect(pokerTableSource).not.toContain('mobile-winner-chip-trails')
    expect(table2dCss).not.toContain('mobile-winner-chip-trails')
    expectRule('.mobile-seat-status.is-win .mobile-seat-action', [
      'color: var(--c-brass-200);',
    ], table2dCss)
    expectRule('.mobile-edge-seat.is-winner', [
      'border-color: var(--c-brass-400);',
    ], table2dCss)
    expect(polishCss).toContain('@keyframes winnerChipTravelEmphasis')
    expectRule('.table-center-winner-chip-trail', [
      'animation: winnerChipTravelEmphasis 1200ms',
      'will-change: left, top, opacity, transform, filter;',
    ], polishCss)
    expectRule('.table-center-winner-chip-trail .chip-stack-display', [
      'transform: scale(1.62);',
      'drop-shadow(0 0 13px rgba(255, 220, 115, 0.72))',
    ], polishCss)
  })

  it('enlarges showdown cards at their existing seats instead of opening a new screen', () => {
    expect(polishCss).toContain('In-place showdown hand readability')
    expect(pokerTableSource).toContain("data-showdown={showdownPresentation.isShowdown ? 'true' : 'false'}")
    expect(desktopThreeSource).toContain('data-phase={view.phase}')

    expectRule(".table-scene[data-showdown='true'] .player-held-cards.is-revealed", [
      'top: -58px;',
      'width: 116px;',
      'z-index: 24;',
    ], polishCss)
    expectRule(".table-scene[data-showdown='true'] .player-held-cards.is-revealed.is-winner", [
      'top: -68px;',
      'width: 128px;',
      'z-index: 30;',
    ], polishCss)
    // 2D layout: shown hands get a compact row inside the seat chip.
    expectRule('.mobile-edge-seat > .mobile-edge-seat-cards.is-revealed', [
      'grid-area: cards;',
    ], table2dCss)
    expectRule('.mobile-edge-seat-cards.is-revealed .card.card-xs', [
      'width: 24px;',
      'height: 34px;',
    ], table2dCss)
    expectRule(".desktop-3d-stage[data-phase='between_hands'] .cinematic-hole-cards.has-revealed-cards", [
      'top: -72px;',
      'left: 18px;',
      'z-index: 8;',
    ], polishCss)
  })

  it('keeps settings, between-hand chat, and four-card reveal controls collision free', () => {
    // The save bar sticks to the bottom of the scrolling settings body.
    expectRule('.settings-footer', [
      'position: sticky;',
      'z-index: 2;',
    ], panelsCss)
    // 2D table: the table-talk toggle sits in the top bar in every phase.
    expectRule(".table-scene[data-layout='2d'] .social-dock", [
      'position: fixed;',
      'top: calc(var(--vv-top, 0px) + env(safe-area-inset-top) + (var(--hud-h, 56px) - 44px) / 2);',
      'bottom: auto;',
    ], table2dCss)
    expectRule('.show-cards-toggle', [
      'grid-template-columns: repeat(4, minmax(0, 1fr));',
      'min-width: 220px;',
    ], panelsCss)
    expectRule('.show-cards-toggle-button', [
      'min-width: 0;',
      'padding-inline: 8px;',
    ], panelsCss)
    expectRule(".table-scene[data-tray-open='true'] .cinematic-seat-7", [
      'right: 12px;',
      'bottom: 44%;',
      'transform: none;',
    ], polishCss)
    expectRule(".table-scene[data-tray-open='true'] .cinematic-seat-6", [
      'top: 36%;',
    ], polishCss)
    expectRule(".table-scene[data-tray-open='true'] .cinematic-seat-5 .cinematic-seat-bet", [
      'left: 0;',
    ], polishCss)
    expectRule(".table-scene[data-tray-open='true'] .cinematic-seat-6 .cinematic-seat-bet", [
      'right: calc(100% + 8px);',
      'top: 50%;',
      'transform: translateY(-50%);',
    ], polishCss)
    expectRule('.cinematic-seat-topline strong', [
      'flex: 1 1 auto;',
      'min-width: 0;',
      'text-overflow: ellipsis;',
    ], polishCss)
    expectRule('.cinematic-seat-4', [
      'top: 14%;',
    ], polishCss)
    expect(desktopThreeSource).not.toContain('Live 3D')
    expect(polishCss).not.toContain('.three-live-badge')
  })

  it('makes folded players visually fall out of the live hand', () => {
    expect(css).toContain('Folded player clarity pass')

    expectRule('.player-seat.is-folded', [
      'filter: grayscale(0.95) saturate(0.24) brightness(0.62);',
      'transform: translate(-50%, -50%) scale(0.9);',
    ])
    expectRule('.player-seat.is-folded .player-held-cards', [
      'opacity: 0.18;',
      'filter: grayscale(1) blur(0.2px);',
    ])
    expectRule('.player-seat.is-folded .player-action-badge', [
      'background: rgba(15, 15, 14, 0.72);',
    ])
  })

  it('keeps folded hero show-card controls attached to the hero hand', () => {
    expectRule('.own-hand-show-cards', [
      'position: absolute;',
      'left: calc(100% + 14px);',
      'pointer-events: auto;',
    ])
    expectRule('.own-card-slot.is-face-down .card', [
      'transform: rotateY(180deg);',
    ])
    expectRule('.own-card-slot.is-shown .card', [
      '0 0 0 2px rgba(242, 222, 161, 0.55);',
    ])
  })

  it('docks the pre-action chips bottom-right, where the action tray appears', () => {
    expectRule('.check-fold-pre-action-dock', [
      'position: fixed;',
      'right: calc(20px + env(safe-area-inset-right));',
      'bottom: calc(20px + env(safe-area-inset-bottom));',
    ], polishCss)
    expectRule('.pre-action-bar', [
      'pointer-events: auto;',
    ], panelsCss)
    expectRule('.pre-action-chip', [
      'min-height: 44px;',
    ], panelsCss)
    expect(pokerTableSource).toContain('<div className="check-fold-pre-action-dock"')
    expect(pokerTableSource).not.toContain('own-hand-pre-action-button')
  })

  it('cleans up desktop 3D room overlays', () => {
    expect(css).toContain('Desktop 3D room HUD cleanup')

    expectRule(".table-scene[data-desktop-three='true'] .turn-focus-banner", [
      'display: none !important;',
    ])
    expectRule(".table-scene[data-desktop-three='true'] .pot-display", [
      'top: clamp(24px, 4vh, 44px);',
      'transform: translateX(-50%) scale(0.92);',
    ])
    expectRule('.hud-settings-trigger', [
      'width: 82px;',
      'min-height: 74px;',
    ])
  })

  it('uses one simple, table-free 2D layout for every width under 1024px and every touch-first device', () => {
    // The old tableless edge layout and the 769-1023px tablet table are gone.
    expect(css).not.toContain('Mobile edge arena restructure')
    expect(polishCss).not.toContain('Mobile tableless edge layout')
    expect(css).not.toMatch(/@media \(min-width: 769px\) and \(max-width: 1023px\)/)
    expect(polishCss).not.toMatch(/@media \(min-width: 769px\) and \(max-width: 1023px\)/)
    expect(pokerTableSource).toContain('useMediaQuery(TWO_D_LAYOUT_QUERY)')
    expect(TWO_D_LAYOUT_QUERY).toBe('(max-width: 1023px), (hover: none) and (pointer: coarse)')
    // The stylesheet switches on exactly the same condition as the component.
    expect(table2dCss).toContain('@media (max-width: 1023px), (hover: none) and (pointer: coarse) {')
    expect(pokerTableSource).toContain("data-layout={isMobileViewport ? '2d' : 'desktop'}")

    expectRule(".table-scene[data-layout='2d']", [
      'height: 100dvh;',
      'padding: calc(var(--hud-h, 56px) + env(safe-area-inset-top)) 0 0;',
      'flex-direction: column;',
    ], table2dCss)
    // No drawn felt table on 2D: seats are a tidy grid of small chips.
    expect(table2dCss).not.toMatch(/\.mobile-table(-felt|-zone)?\s*\{/)
    expect(pokerTableSource).not.toContain('mobile-table-felt')
    expectRule('.mobile-seat-grid', [
      'display: flex;',
      'flex-wrap: wrap;',
    ], table2dCss)
    expectRule('.mobile-edge-seat-position', [
      'flex: 0 0 calc((100% - (var(--cols) - 1) * var(--seat-gap)) / var(--cols));',
    ], table2dCss)
    expectRule('.mobile-board-zone', [
      'flex: 1 1 auto;',
      // Pot and board sit just above the hero's hand.
      'justify-content: flex-end;',
    ], table2dCss)
    expectRule('.mobile-seat-ring', [
      'conic-gradient(var(--ring) calc(var(--turn-pct) * 1%)',
    ], table2dCss)
    expectRule('.room-hud-mobile-topline', [
      // Chat slot, centred game info, sound + settings: one menu button only.
      'grid-template-columns: 94px minmax(0, 1fr) 94px;',
    ], table2dCss)
    expectRule('.mobile-betting-panel', [
      'border-radius: 22px 22px 0 0;',
      'env(safe-area-inset-bottom)',
    ], table2dCss)
    expectRule('.mobile-main-actions', [
      'grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 1fr);',
    ], table2dCss)
    expectRule('.mobile-bet-quick', [
      'min-height: 44px;',
    ], table2dCss)
    expectRule('.mobile-raise-step', [
      'width: 44px;',
      'height: 44px;',
    ], table2dCss)
  })

  it('keeps drinks off the 2D layout and Lady Luck small', () => {
    expect(table2dCss).toMatch(
      /@media \(max-width: 1023px\), \(hover: none\) and \(pointer: coarse\) \{\s*\.drink-controls,\s*\.seat-drink-badge,\s*\.drink-toasts,\s*\.drunk-vision \{\s*display: none !important;/
    )
    expectRule(".table-scene[data-layout='2d'] .lady-luck-badge", [
      '--ll-size: 22px;',
    ], table2dCss)
    expect(table2dCss).toMatch(
      /\.table-scene\[data-layout='2d'\] \.lady-luck-bubble,[\s\S]*?\{\s*display: none;/
    )
  })
})
