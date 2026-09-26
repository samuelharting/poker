import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_CAMERA_FRAMING } from '@/components/three/cameraFraming'

const sceneSource = readFileSync(
  join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
  'utf8'
)

describe('desktop 3D camera framing', () => {
  it('sits the camera in the hero chair at avatar eye height', () => {
    const [, cameraY, cameraZ] = DESKTOP_CAMERA_FRAMING.position
    const [, lookAtY, lookAtZ] = DESKTOP_CAMERA_FRAMING.lookAt
    const downwardPitchDegrees = Math.atan2(
      cameraY - lookAtY,
      cameraZ - lookAtZ
    ) * 180 / Math.PI

    // Eye height matches the seated avatars (heads sit around 1.8–2.2 units).
    expect(cameraY).toBeGreaterThan(1.8)
    expect(cameraY).toBeLessThan(2.4)
    expect(downwardPitchDegrees).toBeGreaterThan(10)
    expect(downwardPitchDegrees).toBeLessThan(18)
  })

  it('wires the shared framing into the live Three.js camera', () => {
    expect(sceneSource).toContain(
      'new THREE.PerspectiveCamera(DESKTOP_CAMERA_FRAMING.fov, 1, 0.1, 60)'
    )
    expect(sceneSource).toContain(
      'camera.position.set(...DESKTOP_CAMERA_FRAMING.position)'
    )
    expect(sceneSource).toContain(
      'new THREE.Vector3(...DESKTOP_CAMERA_FRAMING.lookAt)'
    )
  })
})
