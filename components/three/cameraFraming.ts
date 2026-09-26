export type CameraPoint = readonly [number, number, number]

/**
 * First-person seated view: the camera sits in the hero's chair at the same
 * eye height as the seated avatars, pitched down just enough to read the board.
 */
export const DESKTOP_CAMERA_FRAMING = {
  fov: 60,
  // Eye level just above the seated opponents' eyes, right behind the hero's cards.
  position: [0, 1.95, 6.05] as CameraPoint,
  lookAt: [0, 0.5, -1.4] as CameraPoint,
} as const
