export const TABLE_VISUAL_SEATS = [0, 1, 2, 3, 4, 5, 6, 7] as const

export type TableVisualSeat = (typeof TABLE_VISUAL_SEATS)[number]
export type TableVec3 = readonly [number, number, number]

/**
 * Canonical desktop seat layout. Keep the renderer and wager geometry on this
 * shared coordinate system so committed chips cannot drift away from a seat.
 */
export const TABLE_SEAT_POSITIONS = {
  0: [0, -0.08, 4.48],
  1: [-4.35, -0.02, 3.05],
  2: [-5.55, 0.02, 0.38],
  3: [-4.28, 0.02, -2.78],
  4: [0, 0.02, -4.12],
  5: [4.28, 0.02, -2.78],
  6: [5.55, 0.02, 0.38],
  7: [4.35, -0.02, 3.05],
} as const satisfies Record<TableVisualSeat, TableVec3>

export const TABLE_SEAT_SCALES = {
  0: 1.03,
  1: 0.93,
  2: 0.88,
  3: 0.82,
  4: 0.78,
  5: 0.82,
  6: 0.88,
  7: 0.93,
} as const satisfies Record<TableVisualSeat, number>

/** The visible felt is a radius-2.96 cylinder stretched 1.56x on X. */
export const TABLE_FELT_SEMI_AXIS_X = 2.96 * 1.56
export const TABLE_FELT_SEMI_AXIS_Z = 2.96

/** The existing gold betting line is a radius-1.63 ring stretched 1.62x. */
export const TABLE_WAGER_SEMI_AXIS_X = 1.63 * 1.62
export const TABLE_WAGER_SEMI_AXIS_Z = 1.63

export const TABLE_WAGER_Y = 0.435
export const MAX_WAGER_CHIPS = 12

const SEAT_EDGE_INSET = 0.88
const DEFAULT_WAGER_ARC_HEIGHT = 0.34

/** Returns the persistent committed-chip position on the inward betting line. */
export function getTableWagerAnchor(visualSeat: TableVisualSeat): TableVec3 {
  return pointOnEllipseTowardSeat(
    TABLE_SEAT_POSITIONS[visualSeat],
    TABLE_WAGER_SEMI_AXIS_X,
    TABLE_WAGER_SEMI_AXIS_Z,
    TABLE_WAGER_Y
  )
}

/** Returns the animation origin just inside the felt edge nearest the player. */
export function getTableWagerStartPoint(visualSeat: TableVisualSeat): TableVec3 {
  return pointOnEllipseTowardSeat(
    TABLE_SEAT_POSITIONS[visualSeat],
    TABLE_FELT_SEMI_AXIS_X * SEAT_EDGE_INSET,
    TABLE_FELT_SEMI_AXIS_Z * SEAT_EDGE_INSET,
    TABLE_WAGER_Y
  )
}

/**
 * Converts a monetary wager into a readable, bounded number of physical chips.
 * The displayed amount remains authoritative; this count is visual density.
 */
export function getWagerChipCount(
  bet: number,
  bigBlind: number,
  maxChips = MAX_WAGER_CHIPS
): number {
  if (!Number.isFinite(bet) || bet <= 0) return 0

  const chipUnit = Number.isFinite(bigBlind) && bigBlind > 0 ? bigBlind : 1
  const cap = Number.isFinite(maxChips)
    ? Math.max(1, Math.floor(maxChips))
    : MAX_WAGER_CHIPS

  return Math.min(cap, Math.max(1, Math.ceil(bet / chipUnit)))
}

/**
 * Smoothly carries chips between two table points. Progress is clamped and
 * eased so both endpoints have zero velocity; the vertical arc also settles
 * exactly onto the table at each end.
 */
export function interpolateWagerArc(
  start: TableVec3,
  end: TableVec3,
  progress: number,
  arcHeight = DEFAULT_WAGER_ARC_HEIGHT
): TableVec3 {
  const clampedProgress = clamp01(progress)
  if (clampedProgress === 0) return [...start]
  if (clampedProgress === 1) return [...end]

  const easedProgress = smoothstep(clampedProgress)
  const lift = Math.sin(easedProgress * Math.PI) * Math.max(0, arcHeight)

  return [
    lerp(start[0], end[0], easedProgress),
    lerp(start[1], end[1], easedProgress) + lift,
    lerp(start[2], end[2], easedProgress),
  ]
}

function pointOnEllipseTowardSeat(
  seatPosition: TableVec3,
  semiAxisX: number,
  semiAxisZ: number,
  y: number
): TableVec3 {
  const seatDistance = Math.hypot(seatPosition[0], seatPosition[2])
  if (seatDistance === 0) return [0, y, 0]

  const directionX = seatPosition[0] / seatDistance
  const directionZ = seatPosition[2] / seatDistance
  const radius = 1 / Math.sqrt(
    (directionX * directionX) / (semiAxisX * semiAxisX) +
    (directionZ * directionZ) / (semiAxisZ * semiAxisZ)
  )

  return [directionX * radius, y, directionZ * radius]
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 1 : 0
  return Math.max(0, Math.min(1, value))
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}
