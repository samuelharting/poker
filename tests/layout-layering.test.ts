import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

function expectRule(selector: string, declarations: string[]) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = Array.from(css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'gm')))

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
    expectRule('.table-center-winner-announcement', [
      'z-index: var(--room-layer-winner);',
    ])
    expect(css).not.toContain('--room-layer-public-reveals')
    expect(css).not.toContain('.public-card-reveals')
    expectRule('.betting-tray', [
      'z-index: var(--room-layer-action-tray);',
    ])
    expectRule('.settings-modal-overlay', [
      'z-index: var(--room-layer-modal);',
    ])
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

  it('allows the desktop 3D canvas to receive player-targeting pointer events', () => {
    expectRule('.desktop-3d-stage', [
      'pointer-events: auto;',
    ])
    expectRule('.desktop-3d-canvas', [
      'pointer-events: auto;',
    ])
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
      'left: calc(50% - clamp(170px, 13vw, 250px));',
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
      'left: calc(50% - clamp(170px, 13vw, 250px));',
      'top: 70%;',
      'transform: translate(-50%, -50%) perspective(720px) rotateX(12deg) scale(0.78);',
    ])
    expectRule(".table-scene[data-desktop-three='true'][data-hero-seat='true'] .own-hand-strength", [
      'bottom: calc(100% + 22px);',
      'max-width: min(260px, 24vw);',
    ])
  })

  it('anchors showdown winner announcements to winner seats instead of the table center', () => {
    expect(css).toContain('Seat-anchored showdown winner pass')

    expectRule('.table-seat-winner-announcements', [
      'position: absolute;',
      'inset: 0;',
      'pointer-events: none;',
    ])
    expectRule('.table-seat-winner-announcements .table-center-winner-announcement', [
      'left: var(--winner-announcement-x);',
      'top: var(--winner-announcement-y);',
      'transform: translate(-50%, -96%);',
      'width: min(224px, calc(100% - 40px));',
      'padding: 8px 9px;',
      'border-radius: 10px;',
    ])
    expectRule('.table-seat-winner-announcements .table-center-winner-title', [
      'font-size: 10px;',
    ])
    expectRule('.table-seat-winner-announcements .table-center-winner-line', [
      'padding: 5px 7px;',
      'font-size: 10px;',
    ])
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
  })
})
