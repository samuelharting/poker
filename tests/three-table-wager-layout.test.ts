import { describe, expect, it } from 'vitest'
import {
  MAX_WAGER_CHIPS,
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_SEAT_POSITIONS,
  TABLE_SEAT_SCALES,
  TABLE_VISUAL_SEATS,
  getTableWagerAnchor,
  getTableWagerStartPoint,
  getWagerChipCount,
  getWagerChipLayout,
  interpolateWagerArc,
  TABLE_POT_POSITION,
  WAGER_CHIPS_PER_COLUMN,
  type TableVec3,
  type TableVisualSeat,
} from '@/components/three/tableWagerLayout'
import { BOARD_CARD_DEPTH, BOARD_Z } from '@/components/three/tableArt'

const mirroredSeatPairs: ReadonlyArray<readonly [TableVisualSeat, TableVisualSeat]> = [
  [1, 7],
  [2, 6],
  [3, 5],
]

describe('desktop table wager layout', () => {
  it('exports the canonical mirrored eight-seat layout', () => {
    expect(TABLE_VISUAL_SEATS).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(Object.keys(TABLE_SEAT_POSITIONS)).toHaveLength(8)
    expect(Object.keys(TABLE_SEAT_SCALES)).toHaveLength(8)

    for (const [leftSeat, rightSeat] of mirroredSeatPairs) {
      const left = TABLE_SEAT_POSITIONS[leftSeat]
      const right = TABLE_SEAT_POSITIONS[rightSeat]

      expect(left[0]).toBeCloseTo(-right[0], 8)
      expect(left[1]).toBeCloseTo(right[1], 8)
      expect(left[2]).toBeCloseTo(right[2], 8)
      expect(TABLE_SEAT_SCALES[leftSeat]).toBe(TABLE_SEAT_SCALES[rightSeat])
    }
  })

  it('places every committed wager inside the felt and inward from its seat edge', () => {
    for (const visualSeat of TABLE_VISUAL_SEATS) {
      const seat = TABLE_SEAT_POSITIONS[visualSeat]
      const anchor = getTableWagerAnchor(visualSeat)
      const start = getTableWagerStartPoint(visualSeat)
      const feltEquation =
        (anchor[0] * anchor[0]) / (TABLE_FELT_SEMI_AXIS_X * TABLE_FELT_SEMI_AXIS_X) +
        (anchor[2] * anchor[2]) / (TABLE_FELT_SEMI_AXIS_Z * TABLE_FELT_SEMI_AXIS_Z)

      expect(feltEquation).toBeLessThan(1)
      expect(Math.hypot(anchor[0], anchor[2])).toBeLessThan(Math.hypot(start[0], start[2]))
      expect(Math.sign(anchor[0])).toBe(Math.sign(seat[0]))
      expect(Math.sign(anchor[2])).toBe(Math.sign(seat[2]))
    }
  })

  it('keeps wager anchors and starts mirror-symmetric across the table', () => {
    for (const [leftSeat, rightSeat] of mirroredSeatPairs) {
      expectMirrored(getTableWagerAnchor(leftSeat), getTableWagerAnchor(rightSeat))
      expectMirrored(getTableWagerStartPoint(leftSeat), getTableWagerStartPoint(rightSeat))
    }

    const near = getTableWagerAnchor(0)
    const far = getTableWagerAnchor(4)
    expect(near[0]).toBe(0)
    expect(far[0]).toBe(0)
    expect(near[2]).toBeCloseTo(-far[2], 8)
  })

  it('returns a monotonic visual chip count with zero and hard-cap behavior', () => {
    expect(getWagerChipCount(0, 20)).toBe(0)
    expect(getWagerChipCount(-20, 20)).toBe(0)
    expect(getWagerChipCount(Number.NaN, 20)).toBe(0)
    expect(getWagerChipCount(1, 20)).toBe(1)

    const counts = [1, 20, 21, 40, 80, 160, 500, 5_000].map(bet => (
      getWagerChipCount(bet, 20)
    ))

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]!)
    }

    expect(counts.at(-1)).toBe(MAX_WAGER_CHIPS)
    expect(getWagerChipCount(5_000, 20, 5)).toBe(5)
  })

  it('reads bet size at a glance: blinds are a few chips, a shove is a spread pile', () => {
    const blind = getWagerChipCount(20, 20)
    const potRaise = getWagerChipCount(200, 20)
    const shove = getWagerChipCount(1_000, 20)
    expect(blind).toBeGreaterThanOrEqual(3)
    expect(blind).toBeLessThanOrEqual(6)
    expect(potRaise).toBeGreaterThan(blind * 2)
    expect(shove).toBeGreaterThanOrEqual(20)
    expect(shove).toBeLessThanOrEqual(MAX_WAGER_CHIPS)

    const shoveLayout = getWagerChipLayout(shove, 0.274)
    const blindLayout = getWagerChipLayout(blind, 0.274)
    const columns = (slots: ReturnType<typeof getWagerChipLayout>) => new Set(slots.map(slot => `${slot.x},${slot.z}`)).size
    expect(columns(blindLayout)).toBe(1)
    expect(columns(shoveLayout)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...shoveLayout.map(slot => slot.level))).toBeLessThan(WAGER_CHIPS_PER_COLUMN)
    // Big bets bring in the big denominations (black 3 / purple 4).
    expect(shoveLayout.some(slot => slot.denomination >= 3)).toBe(true)
    expect(blindLayout.every(slot => slot.denomination <= 1)).toBe(true)
    // A second row only ever grows in toward the centre, never onto the player's cards.
    expect(shoveLayout.every(slot => slot.z <= 0)).toBe(true)
  })

  it('keeps the pot off the board and well clear of the hero betting spot', () => {
    const hero = getTableWagerAnchor(0)
    const potReach = 0.56 + 0.13
    const heroBetReach = 0.274 + 0.13
    const gap = Math.hypot(TABLE_POT_POSITION[0] - hero[0], TABLE_POT_POSITION[2] - hero[2]) - potReach - heroBetReach
    expect(gap).toBeGreaterThanOrEqual(0.3)
    // In front of (nearer the hero than) the board's front edge, so it never
    // rises into the board from the first-person camera.
    expect(TABLE_POT_POSITION[2] - 0.44 - 0.13).toBeGreaterThan(BOARD_Z + BOARD_CARD_DEPTH / 2 + 0.3)
  })

  it('travels through exact endpoints with a smooth elevated midpoint', () => {
    const start = getTableWagerStartPoint(3)
    const end = getTableWagerAnchor(3)
    const before = interpolateWagerArc(start, end, -1)
    const halfway = interpolateWagerArc(start, end, 0.5)
    const after = interpolateWagerArc(start, end, 2)

    expect(before).toEqual(start)
    expect(after).toEqual(end)
    expect(halfway[0]).toBeCloseTo((start[0] + end[0]) / 2, 8)
    expect(halfway[2]).toBeCloseTo((start[2] + end[2]) / 2, 8)
    expect(halfway[1]).toBeGreaterThan(Math.max(start[1], end[1]) + 0.3)

    const early = interpolateWagerArc(start, end, 0.01)
    const late = interpolateWagerArc(start, end, 0.99)
    expect(distance(early, start)).toBeLessThan(distance(halfway, start) * 0.01)
    expect(distance(late, end)).toBeLessThan(distance(halfway, end) * 0.01)
  })
})

function expectMirrored(left: TableVec3, right: TableVec3) {
  expect(left[0]).toBeCloseTo(-right[0], 8)
  expect(left[1]).toBeCloseTo(right[1], 8)
  expect(left[2]).toBeCloseTo(right[2], 8)
}

function distance(left: TableVec3, right: TableVec3): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  )
}
