import { describe, expect, it } from 'vitest'
import { BLIND_SCHEDULES, getBlindLevelMs, getRaisedSmallBlind } from '@/lib/poker/blindSchedule'

/** Small blind at each raise and the minute it happens, from 10/20. */
function run(id: (typeof BLIND_SCHEDULES)[number]['id'], raises: number) {
  const steps = BLIND_SCHEDULES.find(schedule => schedule.id === id)!.raiseSteps
  let small = 10
  let minute = 0
  const out: Array<[number, number]> = []
  for (let level = 0; level < raises; level += 1) {
    minute += getBlindLevelMs(id, level)! / 60_000
    small = getRaisedSmallBlind(small, steps)
    out.push([minute, small])
  }
  return out
}

describe('blind schedules', () => {
  it('steady mode climbs gently on round numbers every 30 minutes', () => {
    expect(run('steady', 6)).toEqual([[30, 15], [60, 20], [90, 30], [120, 40], [150, 50], [180, 75]])
  })

  it('the 1-hour game roughly doubles and speeds up so it ends near the hour', () => {
    expect(run('one_hour', 6)).toEqual([[30, 20], [40, 40], [45, 75], [50, 150], [55, 300], [60, 500]])
  })

  it('the 2-hour game follows 60, 30, 15, 10 then every 5 minutes', () => {
    expect(run('two_hour', 6).map(([minute]) => minute)).toEqual([60, 90, 105, 115, 120, 125])
  })

  it('every step is between 1.25x and 2x and never goes down', () => {
    let small = 1
    while (small < 500_000) {
      const next = getRaisedSmallBlind(small, 1)
      expect(next).toBeGreaterThan(small)
      expect(next / small).toBeLessThanOrEqual(2)
      small = next
    }
    expect(getRaisedSmallBlind(25, 1)).toBe(30)
    expect(getRaisedSmallBlind(10, 0)).toBe(10)
  })

  it('off never raises', () => {
    expect(getBlindLevelMs('off', 0)).toBeNull()
  })
})
