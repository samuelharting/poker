import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sceneSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')
const styleSource = readFileSync(join(process.cwd(), 'app', 'poker-polish.css'), 'utf8')

describe('desktop opponent panel readability', () => {
  it('keeps identity, stack, and action status together in each seat panel', () => {
    expect(sceneSource).toContain('className="cinematic-seat-panel"')
    expect(sceneSource).toContain('className="cinematic-seat-topline"')
    expect(sceneSource).toContain('className="cinematic-seat-meta"')
    expect(sceneSource).toContain('{player.nickname}')
    expect(sceneSource).toContain('player.stack.toLocaleString()')
    expect(sceneSource).toContain('statusLabel ? (')
    expect(sceneSource).toContain('className="cinematic-winner-label"')
    expect(styleSource).toContain('.cinematic-seat-meta .cinematic-winner-label')
  })

  it('keeps blind roles and state contrast visible', () => {
    expect(sceneSource).toContain("player.blindRole === 'big' ? 'BB' : 'SB'")
    expect(styleSource).toContain('.cinematic-seat.is-acting')
    expect(styleSource).toContain('.cinematic-seat.is-winner')
    expect(styleSource).toContain('.cinematic-seat.is-folded')
  })

  it('roughly doubles revealed opponent cards without enlarging live card backs', () => {
    expect(sceneSource).toContain("hasRevealedCards ? 'has-revealed-cards' : ''")
    expect(styleSource).toMatch(/\.cinematic-hole-cards\.has-revealed-cards\s*\{[^}]*top:\s*-60px;/s)
    expect(styleSource).toMatch(/\.cinematic-hole-cards\.has-revealed-cards i\s*\{[^}]*width:\s*38px;[^}]*height:\s*53px;/s)
    expect(styleSource).toMatch(/\.cinematic-hole-cards i\s*\{[^}]*width:\s*20px;[^}]*height:\s*28px;/s)
  })

  it('keeps the hero identity in the fixed two-dimensional summary', () => {
    expect(styleSource).toMatch(/\.cinematic-seat\.is-local-player\s*\{\s*display:\s*none;/)
    expect(styleSource).not.toMatch(/\.cinematic-seat-0\s*\{\s*display:\s*none;/)
  })
})
