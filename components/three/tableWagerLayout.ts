export const TABLE_VISUAL_SEATS = [0, 1, 2, 3, 4, 5, 6, 7] as const

export type TableVisualSeat = (typeof TABLE_VISUAL_SEATS)[number]
export type TableVec3 = readonly [number, number, number]

/**
 * Canonical desktop seat layout: the hero sits at the near edge and the seven
 * opponents form a horseshoe around the far half, all inside the first-person
 * camera's field of view (nobody sits beside the camera, off-screen).
 * Opponents are spaced every 24° around the felt ellipse from 198° to 342°. Keep the renderer and wager geometry on this
 * shared coordinate system so committed chips cannot drift away from a seat.
 */
export const TABLE_SEAT_POSITIONS = {
  0: [0, -0.08, 4.48],
  1: [-5.28, 0.02, -1.27],
  2: [-4.12, 0.02, -2.75],
  3: [-2.26, 0.02, -3.75],
  4: [0, 0.02, -4.11],
  5: [2.26, 0.02, -3.75],
  6: [4.12, 0.02, -2.75],
  7: [5.28, 0.02, -1.27],
} as const satisfies Record<TableVisualSeat, TableVec3>

export const TABLE_SEAT_SCALES = {
  // Real perspective already shrinks the far seats; don't make them dolls.
  0: 1,
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 1,
  7: 1,
} as const satisfies Record<TableVisualSeat, number>

/** The visible felt is a radius-2.96 cylinder stretched 1.56x on X. */
export const TABLE_FELT_SEMI_AXIS_X = 2.96 * 1.56
export const TABLE_FELT_SEMI_AXIS_Z = 2.96

/** The existing gold betting line is a radius-1.63 ring stretched 1.62x. */
export const TABLE_WAGER_SEMI_AXIS_X = 1.63 * 1.62
export const TABLE_WAGER_SEMI_AXIS_Z = 1.63

/** Matches FELT_TOP_Y in tableArt.ts: chip stacks sit directly on the felt. */
export const TABLE_WAGER_Y = 0.4
/** Enough for a pushed all-in to read as a real pile (see getWagerChipCount). */
export const MAX_WAGER_CHIPS = 30
/** Chips per wager column before the pile spreads into another column. */
export const WAGER_CHIPS_PER_COLUMN = 6

/**
 * The collected pot sits front-left of the board, between it and the hero's
 * betting spot: it never covers a board card from the first-person camera
 * (the camera looks over it, not through it at the board) and stays well clear
 * of the hero's own committed chips on the betting line.
 */
export const TABLE_POT_POSITION: TableVec3 = [-1.5, TABLE_WAGER_Y, 1.3]

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
 * Log-scaled in big blinds so size reads at a glance: a blind is 3-5 chips, a
 * pot-sized raise about a dozen, and a 50bb+ shove a spread pile of 20-30.
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

  const count = Math.round(1 + 3.6 * Math.log2(1 + bet / chipUnit))
  return Math.min(cap, Math.max(1, count))
}

export interface WagerChipSlot {
  /** Local offsets: +x runs along the betting line, -z in toward the table centre. */
  x: number
  z: number
  level: number
  /** Index into CHIP_DENOMINATIONS (0 red, 1 blue, 2 green, 3 black, 4 purple). */
  denomination: number
}

/**
 * Column footprints (in chip pitches) for 1-5 columns: a row along the line,
 * then a second row pushed further in (never back toward the player's cards).
 */
const WAGER_COLUMN_SPOTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0]],
  [[-0.5, 0], [0.5, 0]],
  [[-0.5, 0], [0.5, 0], [0, -0.86]],
  [[-1, 0], [0, 0], [1, 0], [0.5, -0.86]],
  [[-1, 0], [0, 0], [1, 0], [-0.5, -0.86], [0.5, -0.86]],
]

/**
 * Physical layout for `count` wager chips: neat columns of up to six that
 * spread along the betting line as the bet grows (a big bet or all-in is a
 * pushed-out pile, not a taller tower). Bigger bets bring in bigger
 * denominations, so the colours also hint at size.
 */
export function getWagerChipLayout(count: number, pitch: number): WagerChipSlot[] {
  const total = Math.max(0, Math.min(MAX_WAGER_CHIPS, Math.floor(count)))
  const columns = Math.max(1, Math.min(WAGER_COLUMN_SPOTS.length, Math.ceil(total / WAGER_CHIPS_PER_COLUMN)))
  const spots = WAGER_COLUMN_SPOTS[columns - 1]!
  // Denominations present grow with the bet: reds/blues for blinds, greens
  // from a real raise, blacks for big bets and purple for a shove.
  const palette = total <= 5 ? [0, 1] : total <= 12 ? [1, 0, 2] : total <= 20 ? [2, 1, 3, 0] : [3, 4, 2, 1, 3]
  const slots: WagerChipSlot[] = []
  for (let index = 0; index < total; index += 1) {
    const column = index % columns
    const level = Math.floor(index / columns)
    const [spotX, spotZ] = spots[column]!
    slots.push({
      x: spotX * pitch,
      z: spotZ * pitch,
      level,
      // Each column is mostly one colour with a contrasting cap every few chips.
      denomination: palette[(column + (level >= 4 ? 1 : 0)) % palette.length]!,
    })
  }
  return slots
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
