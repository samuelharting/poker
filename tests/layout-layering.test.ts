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
    expectRule('.betting-tray', [
      'z-index: var(--room-layer-action-tray);',
    ])
    expectRule('.settings-modal-overlay', [
      'z-index: var(--room-layer-modal);',
    ])
  })
})
