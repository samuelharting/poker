export type CameraPoint = readonly [number, number, number]

/**
 * A seated desktop view: low enough to face the other players across the
 * table, but still pitched down enough to keep bets and the board readable.
 */
export const DESKTOP_CAMERA_FRAMING = {
  fov: 40,
  position: [0, 5.9, 12.2] as CameraPoint,
  lookAt: [0, 0.4, -0.6] as CameraPoint,
} as const
