import type * as THREE from 'three'

/**
 * A NaN anywhere in the camera (a seat lookup for a player who just left, a
 * zero-size viewport aspect, a bad lens delta) makes every frame black, and
 * lerping toward NaN never recovers. These checks run once per frame and put
 * the camera back on its seat when that happens.
 */

interface XYZ { x: number; y: number; z: number }

export function isFiniteVector(vector: XYZ): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

export function isFiniteQuaternion(quaternion: XYZ & { w: number }): boolean {
  return isFiniteVector(quaternion) && Number.isFinite(quaternion.w)
}

/** The perspective camera can draw a frame: finite pose and a valid lens. */
export function isCameraUsable(camera: THREE.PerspectiveCamera): boolean {
  return (
    isFiniteVector(camera.position) &&
    isFiniteQuaternion(camera.quaternion) &&
    Number.isFinite(camera.fov) && camera.fov > 1 && camera.fov < 179 &&
    Number.isFinite(camera.aspect) && camera.aspect > 0 &&
    Number.isFinite(camera.near) && Number.isFinite(camera.far) && camera.far > camera.near
  )
}

export interface SafeCameraPose {
  position: XYZ
  lookAt: XYZ
  fov: number
  /** How far the live camera may drift from its seat before it is put back (inside a wall, under the floor). */
  maxDrift?: number
}

/**
 * Restores the seat pose when the camera (or its look target) went non-finite
 * or wandered far from the seat. Returns true when it had to reset.
 */
export function ensureSafeCamera(
  camera: THREE.PerspectiveCamera,
  lookAt: THREE.Vector3,
  safe: SafeCameraPose
): boolean {
  const maxDrift = safe.maxDrift ?? 4
  const dx = camera.position.x - safe.position.x
  const dy = camera.position.y - safe.position.y
  const dz = camera.position.z - safe.position.z
  const drifted = !(dx * dx + dy * dy + dz * dz <= maxDrift * maxDrift)
  const lookBroken = !isFiniteVector(lookAt)
  if (isCameraUsable(camera) && !drifted && !lookBroken) return false

  camera.position.set(safe.position.x, safe.position.y, safe.position.z)
  lookAt.set(safe.lookAt.x, safe.lookAt.y, safe.lookAt.z)
  if (!Number.isFinite(camera.aspect) || camera.aspect <= 0) camera.aspect = 16 / 9
  camera.fov = Number.isFinite(safe.fov) && safe.fov > 1 ? safe.fov : 55
  camera.quaternion.set(0, 0, 0, 1)
  camera.lookAt(lookAt)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return true
}

/** Viewport size for the renderer: never 0 (a collapsed or hidden host) and never NaN. */
export function getSafeViewportSize(
  width: number,
  height: number,
  previous: { width: number; height: number } | null
): { width: number; height: number } | null {
  const valid = (value: number) => Number.isFinite(value) && value >= 2
  if (valid(width) && valid(height)) return { width: Math.round(width), height: Math.round(height) }
  // A host that is momentarily 0x0 (display: none, mid-layout) keeps the last
  // real size instead of reallocating every render target at 1x1.
  return previous
}

/** Device pixel ratio for the 3D canvas: capped for big viewports, never NaN or below 0.75. */
export function getSafePixelRatio(devicePixelRatio: number, renderArea: number, reducedQuality: boolean): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const cap = renderArea > 2_200_000 ? 1.15 : renderArea > 1_300_000 ? 1.35 : 1.5
  return Math.max(0.75, Math.min(dpr, cap) * (reducedQuality ? 0.85 : 1))
}
