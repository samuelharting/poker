export type CameraPoint = readonly [number, number, number]

/**
 * First-person seated view: the camera sits in the hero's chair at the same
 * eye height as the seated avatars, pitched down just enough to read the board.
 */
export const DESKTOP_CAMERA_FRAMING = {
  fov: 60,
  position: [0, 2.45, 6.35] as CameraPoint,
  lookAt: [0, 0.6, -1.25] as CameraPoint,
} as const
