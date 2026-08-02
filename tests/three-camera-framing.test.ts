import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_CAMERA_FRAMING } from '@/components/three/cameraFraming'

const sceneSource = readFileSync(
  join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
  'utf8'
)

describe('desktop 3D camera framing', () => {
  it('uses a seated perspective while keeping the table surface readable', () => {
    const [, cameraY, cameraZ] = DESKTOP_CAMERA_FRAMING.position
    const [, lookAtY, lookAtZ] = DESKTOP_CAMERA_FRAMING.lookAt
    const downwardPitchDegrees = Math.atan2(
      cameraY - lookAtY,
      cameraZ - lookAtZ
    ) * 180 / Math.PI

    expect(cameraY).toBe(5.25)
    expect(downwardPitchDegrees).toBeGreaterThan(20)
    expect(downwardPitchDegrees).toBeLessThan(25)
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
