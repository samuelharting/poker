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
    expect(styleSource).toMatch(/\.cinematic-seat-meta \.cinematic-winner-label\s*\{[^}]*max-width:\s*62px;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s)
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

  it('keeps the far-center nameplate above the customized face', () => {
    expect(styleSource).toMatch(/\.cinematic-seat-4\s*\{[^}]*left:\s*35%;[^}]*top:\s*14%;/s)
    expect(styleSource).toMatch(/@media \(min-width: 1024px\) and \(max-height: 1023px\)[\s\S]*?\.desktop-3d-stage\[data-phase='between_hands'\] \.cinematic-seat-4\s*\{[^}]*top:\s*22%;/s)
  })

  it('contains simultaneous chat and reaction stacks between adjacent seats', () => {
    expect(styleSource).toMatch(/\.cinematic-seat-social\s*\{[^}]*max-width:\s*150px;/s)
    expect(styleSource).toMatch(/\.cinematic-seat-message\s*\{[^}]*max-width:\s*150px;/s)
    expect(styleSource).toMatch(/\.cinematic-seat-3 \.cinematic-seat-social,[\s\S]*?\.cinematic-seat-4 \.cinematic-seat-social\s*\{[^}]*left:\s*calc\(100% \+ 12px\);[^}]*top:\s*50%;[^}]*bottom:\s*auto;/s)
    expect(styleSource).toMatch(/\.cinematic-seat-5 \.cinematic-seat-social\s*\{[^}]*right:\s*calc\(100% \+ 12px\);[^}]*left:\s*auto;[^}]*top:\s*50%;/s)
  })

  it('keeps the normal camera stable while preserving the short all-in impact', () => {
    expect(sceneSource).toContain('const baseCameraPosition = camera.position.clone()')
    expect(sceneSource).toContain('const baseCameraLookAt = cameraLookAt.clone()')
    expect(sceneSource).toContain('targetCamera.copy(baseCameraPosition)')
    expect(sceneSource).toContain('targetLook.copy(baseCameraLookAt)')
    expect(sceneSource).not.toContain('getTurnCameraPose(actingSeat)')
    expect(sceneSource).toContain('getAllInCameraImpact(runtime.seats.values(), time, reducedMotion)')
    expect(sceneSource).toContain('const microShake = Math.sin(time * 61)')
    expect(sceneSource).toContain('targetCamera.z -= allInImpact.strength * 0.72')
  })
})
