import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sceneSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')

describe('desktop room rendering stability', () => {
  it('uses a bounded native WebGL renderer and disposes its resources', () => {
    expect(sceneSource).toContain('new THREE.WebGLRenderer')
    expect(sceneSource).toContain('renderer.setPixelRatio(Math.min')
    expect(sceneSource).toContain("canvas.addEventListener('webglcontextlost'")
    expect(sceneSource).toContain("canvas.addEventListener('webglcontextrestored'")
    expect(sceneSource).toContain("document.addEventListener('visibilitychange'")
    expect(sceneSource).toContain('resizeObserver.disconnect()')
    expect(sceneSource).toContain('disposeObject(scene)')
    expect(sceneSource).toContain('renderer.dispose()')
    expect(sceneSource).not.toContain('renderer.forceContextLoss()')
    expect(sceneSource).not.toContain('@react-three/fiber')
    expect(sceneSource).not.toContain('ContactShadows')
    expect(sceneSource).not.toContain('useGLTF')
  })

  it('uses cached local rigged avatars while retaining an immediate procedural fallback', () => {
    expect(sceneSource).toContain('new THREE.SphereGeometry')
    expect(sceneSource).toContain('new THREE.CylinderGeometry')
    expect(sceneSource).toContain('new THREE.TorusGeometry')
    expect(sceneSource).toContain('createAvatarAssetInstance')
    expect(sceneSource).toContain('disposeAvatarAssetInstance')
    expect(sceneSource).toContain('fallbackAvatar.visible')
    expect(sceneSource).toContain('avatarGeneration')
    expect(sceneSource).toContain("avatarLoadStatus: 'idle' | 'loading' | 'loaded' | 'failed'")
    expect(sceneSource).toContain("seat.avatarLoadStatus = 'failed'")
    expect(sceneSource).toContain('performance.now() + getAvatarRetryDelayMs(seat.avatarFailureCount)')
    expect(sceneSource).toContain('seat.fallbackAvatar.visible = seat.avatar === null')
    expect(sceneSource).toContain('host.dataset.avatarRenderer')
  })

  it('honors reduced motion and restores material render modes after folds', () => {
    expect(sceneSource).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(sceneSource).toContain("motionPreference.addEventListener('change'")
    expect(sceneSource).toContain('animateWagers(runtime, time, reducedMotion)')
    expect(sceneSource).toContain('const smoothing = reducedMotion ? 1')
    expect(sceneSource).toContain("const FOLD_MATERIAL_BASELINE = 'pokerFoldMaterialBaseline'")
    expect(sceneSource).toContain('material.transparent = nextTransparent')
    expect(sceneSource).toContain('material.opacity = nextOpacity')
    expect(sceneSource).toContain('restoreAvatarBoneOffsets(seat)')
    expect(sceneSource).toContain('returnAvatarToIdle(seat)')
  })

  it('adds deterministic table detail, staggered props, and a readable winner celebration', () => {
    expect(sceneSource).toContain("texture.name = 'procedural-felt-grain'")
    expect(sceneSource).toContain('createSeededRandom(0x3344524f)')
    expect(sceneSource).toContain('seat.cardMeshes.forEach')
    expect(sceneSource).toContain('wager.chipMeshes.forEach')
    expect(sceneSource).toContain('animatePot(runtime, time, reducedMotion)')
    expect(sceneSource).toContain('seat.winnerHalo.visible = seat.winner')
    expect(sceneSource).toContain('seat.winnerLight.intensity')
    expect(sceneSource).toContain('data-winner-count')
  })
})
