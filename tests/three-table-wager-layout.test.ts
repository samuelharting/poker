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
  interpolateWagerArc,
  type TableVec3,
  type TableVisualSeat,
} from '@/components/three/tableWagerLayout'

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
