import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
const polishCss = readFileSync(join(process.cwd(), 'app', 'poker-polish.css'), 'utf8')
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
    ])
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

    expectRule('.table-panel.targeted-emote-panel', [
      'position: fixed;',
      'width: min(300px, calc(100vw - 44px));',
      'max-height: min(760px, calc(100dvh - 44px));',
      'overflow-y: auto;',
      'overscroll-behavior: contain;',
    ], polishCss)
    expectRule('.table-panel.targeted-emote-panel.is-picker-open', [
      'width: min(360px, calc(100vw - 44px));',
    ], polishCss)
    expectRule('.targeted-emote-panel.is-picker-open .table-panel-header', [
      'position: sticky;',
      'top: 0;',
    ], polishCss)
    expectRule('.targeted-emote-panel .emoji-picker-shell', [
      'width: 100%;',
      'max-width: 100%;',
      'min-width: 0;',
    ])
    expectRule('.targeted-emote-panel .EmojiPickerReact', [
      'width: 100% !important;',
      'max-width: 100% !important;',
      'min-width: 0 !important;',
    ])

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
    expect(css).toContain('All-in announcement pop')
    expect(css).toContain('--room-layer-all-in: 226;')

    expectRule('.all-in-announcement', [
      'position: fixed;',
      'z-index: var(--room-layer-all-in, 226);',
      'pointer-events: none;',
      'animation: allInAnnouncementPop 2600ms cubic-bezier(0.18, 0.86, 0.26, 1) forwards;',
    ])
    expectRule('.all-in-chip', [
      'animation: allInChipBurst 920ms cubic-bezier(0.16, 0.9, 0.18, 1) forwards;',
    ])
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
    expectRule('.mobile-edge-winners', [
      'left: 12px;',
      'right: 12px;',
      'top: calc(50% - 30px);',
      'max-height: min(42svh, 340px);',
    ], polishCss)
    expect(pokerTableSource).toContain('className="table-hand-result-summary"')
    expect(pokerTableSource).toContain("winnerDisplays.length > 1 ? 'Split pot' : 'Hand winner'")
    expect(pokerTableSource).not.toContain('className="table-center-winner-announcement"')
  })

  it('makes the winner chip payout large, bright, and visible on mobile', () => {
    expect(pokerTableSource).toContain(
      'className="table-center-winner-chip-trails mobile-winner-chip-trails"'
    )
    expect(polishCss).toContain('@keyframes winnerChipTravelEmphasis')
    expectRule('.table-center-winner-chip-trail', [
      'animation: winnerChipTravelEmphasis 1200ms',
      'will-change: left, top, opacity, transform, filter;',
    ], polishCss)
    expectRule('.table-center-winner-chip-trail .chip-stack-display', [
      'transform: scale(1.62);',
      'drop-shadow(0 0 13px rgba(255, 220, 115, 0.72))',
    ], polishCss)
    expectRule('.mobile-winner-chip-trails', [
      'z-index: calc(var(--room-layer-winner) - 1);',
      'border-radius: 0;',
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
    expectRule(".table-scene[data-showdown='true'] .mobile-edge-seat-cards.is-revealed", [
      'height: 50px;',
      'z-index: 18;',
    ], polishCss)
    expectRule(".desktop-3d-stage[data-phase='between_hands'] .cinematic-hole-cards.has-revealed-cards", [
      'top: -72px;',
      'left: 18px;',
      'z-index: 8;',
    ], polishCss)
  })

  it('keeps settings, between-hand chat, and four-card reveal controls collision free', () => {
    expectRule('.settings-footer', [
      'position: static;',
      'bottom: auto;',
      'margin-top: 16px;',
    ], polishCss)
    expectRule(".table-scene[data-phase='between_hands'] .social-dock", [
      'top: calc(76px + env(safe-area-inset-top));',
      'right: 10px;',
      'bottom: auto;',
      'left: auto;',
    ], polishCss)
    expectRule('.show-cards-toggle', [
      'grid-template-columns: repeat(4, minmax(0, 1fr));',
      'min-width: 220px;',
    ], polishCss)
    expectRule('.show-cards-toggle-button', [
      'min-width: 0;',
      'padding-inline: 8px;',
    ], polishCss)
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

  it('uses one large bottom-right bubble for the check/fold pre-action', () => {
    expectRule('.check-fold-pre-action-dock', [
      'position: fixed;',
      'right: calc(20px + env(safe-area-inset-right));',
      'bottom: calc(20px + env(safe-area-inset-bottom));',
    ], polishCss)
    expectRule('.own-hand-pre-action-button', [
      'min-width: 176px;',
      'min-height: 64px;',
      'pointer-events: auto;',
    ], polishCss)
    expect(pokerTableSource).toContain('<div className="check-fold-pre-action-dock">')
    expect(pokerTableSource).not.toContain('own-hand-pre-action-mark')
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

  it('uses a tableless mobile poker field with reference-style header, seats, board, and controls', () => {
    expect(css).toContain('Mobile edge arena restructure')
    expect(css).toContain('Mobile reference poker app layout')
    expect(polishCss).toContain('Mobile tableless edge layout')

    expectRule('.mobile-poker-field', [
      'position: relative;',
      'height: 100%;',
      'overflow: hidden;',
    ])
    expectRule('.mobile-board-zone .community-cards', [
      'position: static;',
      'transform: none;',
    ])
    expectRule('.mobile-seat-number', [
      'border-radius: 999px;',
      'background: rgba(255, 255, 255, 0.13);',
    ])
    expectRule('.mobile-edge-seat-position', [
      'position: absolute;',
      'z-index: 2;',
    ])
    expectRule('.mobile-hero-lane .own-hand-area', [
      'position: relative;',
      'left: auto;',
      'bottom: auto;',
    ])
    expectRule('.table-scene .mobile-hero-lane .own-hand-strength', [
      'display: inline-flex;',
      'bottom: calc(100% + 8px);',
    ], polishCss)
    expectRule('.mobile-edge-seat-timer', [
      'position: absolute;',
      'min-width: 32px;',
    ], polishCss)
    expectRule('.room-hud-mobile-topline', [
      'grid-template-columns: 44px minmax(0, 1fr) 44px;',
    ])
    expectRule('.room-hud-mobile-game-pill', [
      'border-radius: 999px;',
      'justify-content: center;',
    ])
    expectRule('.mobile-betting-panel', [
      'position: fixed;',
      'bottom: 0;',
      'border-radius: 18px 18px 0 0;',
    ])
    expectRule('.mobile-main-actions', [
      'grid-template-columns: repeat(3, minmax(0, 1fr));',
    ])
    expectRule('.mobile-poker-field::before', [
      'content: none;',
      'display: none;',
    ], polishCss)
    expectRule('.mobile-poker-field::after', [
      'content: none;',
      'display: none;',
    ], polishCss)
    expectRule(".table-scene[data-phase='in_hand']:not([data-tray-open='true'])", [
      'padding-bottom: calc(8px + env(safe-area-inset-bottom));',
    ], polishCss)
    expectRule('.mobile-edge-seat', [
      'border: 0;',
      'background: transparent;',
      'box-shadow: none;',
    ], polishCss)
    expectRule('.mobile-seat-position-2', [
      'left: env(safe-area-inset-left, 0px);',
    ], polishCss)
    expectRule('.mobile-seat-position-6', [
      'right: env(safe-area-inset-right, 0px);',
    ], polishCss)
  })
})
