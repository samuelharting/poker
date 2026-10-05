/**
 * Blind schedules: how long each blind level lasts before the blinds double
 * (always between hands). The last duration repeats forever.
 */
export type BlindScheduleId = 'off' | 'steady' | 'turbo' | 'hyper' | 'one_hour' | 'two_hour'

export interface BlindSchedule {
  id: BlindScheduleId
  label: string
  description: string
  /** Minutes per level; the last entry repeats. Empty = blinds never move. */
  levelMinutes: number[]
  /** Rungs up the blind ladder per raise (1 = about 1.4x, 2 = about 2x). */
  raiseSteps: number
}

/** Listed from slowest to fastest blind growth (the settings pills follow this order). */
export const BLIND_SCHEDULES: readonly BlindSchedule[] = [
  { id: 'off', label: 'Off', description: 'Blinds stay where you set them.', levelMinutes: [], raiseSteps: 0 },
  { id: 'steady', label: 'Steady', description: 'Blinds go up one step (about 1.4x) every 30 minutes.', levelMinutes: [30], raiseSteps: 1 },
  { id: 'two_hour', label: '2-hour game', description: 'Blinds about double after 60 min, then 30, 15, 10, then every 5.', levelMinutes: [60, 30, 15, 10, 5], raiseSteps: 2 },
  { id: 'turbo', label: 'Turbo', description: 'Blinds go up one step (about 1.4x) every 15 minutes.', levelMinutes: [15], raiseSteps: 1 },
  { id: 'one_hour', label: '1-hour game', description: 'Blinds about double after 30 min, then 10, then every 5: the game wraps up in about an hour.', levelMinutes: [30, 10, 5], raiseSteps: 2 },
  { id: 'hyper', label: 'Hyper', description: 'Blinds go up one step (about 1.4x) every 5 minutes.', levelMinutes: [5], raiseSteps: 1 },
]

export function isBlindScheduleId(value: unknown): value is BlindScheduleId {
  return typeof value === 'string' && BLIND_SCHEDULES.some(schedule => schedule.id === value)
}

export function getBlindSchedule(id: BlindScheduleId | undefined): BlindSchedule {
  return BLIND_SCHEDULES.find(schedule => schedule.id === id) ?? BLIND_SCHEDULES[0]!
}

/** Length of blind level `level` (0 = the first) in ms, or null when the schedule is off. */
export function getBlindLevelMs(id: BlindScheduleId | undefined, level: number): number | null {
  const minutes = getBlindSchedule(id).levelMinutes
  if (minutes.length === 0) return null
  return minutes[Math.min(Math.max(0, level), minutes.length - 1)]! * 60_000
}

/** Casino-style small-blind ladder (big blind is always twice the small blind). */
const SMALL_BLIND_LADDER = [
  // Every rung is 1.25-1.5x the last, so one step feels like ~1.4x and two ~2x.
  1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500, 750,
  1_000, 1_500, 2_000, 3_000, 4_000, 5_000, 7_500, 10_000, 15_000, 20_000,
  30_000, 40_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000, 400_000, 500_000,
]

/**
 * The small blind after one raise: `steps` rungs up the ladder from the first
 * rung above the current blind (off-ladder custom blinds snap up to it).
 */
export function getRaisedSmallBlind(current: number, steps: number): number {
  if (steps <= 0) return current
  let index = SMALL_BLIND_LADDER.findIndex(rung => rung > current)
  if (index < 0) return Math.min(500_000, Math.round(current * 1.5))
  index = Math.min(SMALL_BLIND_LADDER.length - 1, index + steps - 1)
  return SMALL_BLIND_LADDER[index]!
}
