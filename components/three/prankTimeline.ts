/**
 * Shared timing for the table pranks (seconds since the server event lands),
 * so the avatar poses, the flying props and the first-person view stay in sync.
 */

/** Shot glass slides across the felt and stops in front of the target. */
export const SHOT_ARRIVE_AT = 1.15
/** Glass reaches the lips. */
export const SHOT_MOUTH_AT = 1.62
/** Head is all the way back, glass empty. */
export const SHOT_DOWN_AT = 1.95
/** Empty glass slammed upside down on the felt. */
export const SHOT_SLAM_AT = 2.18
/** Shudder / face scrunch ends. */
export const SHOT_SHUDDER_END = 3.25
/** Everything (glass fade included) is gone. */
export const SHOT_TOTAL_SECONDS = 4.4

/** The sender's flick releases the chip. */
export const CHIP_LAUNCH_AT = 0.36
/** Chip flight time to the target's head. */
export const CHIP_FLIGHT_SECONDS = 0.6
export const CHIP_IMPACT_AT = CHIP_LAUNCH_AT + CHIP_FLIGHT_SECONDS
/** Sender's flick gesture length. */
export const CHIP_FLICK_GESTURE_SECONDS = 1.05
/** Target's flinch and head rub, from impact. */
export const CHIP_BONK_REACT_SECONDS = 2.7
export const CHIP_TOTAL_SECONDS = CHIP_IMPACT_AT + 2.2

/** Cheers (house rule): everyone holds their glass up to the middle before drinking. */
export const CHEERS_RAISE_AT = SHOT_ARRIVE_AT + 0.25
export const CHEERS_RAISE_SECONDS = 1.0
/** The glasses meet (clink) this far into the raise. */
export const CHEERS_CLINK_AT = CHEERS_RAISE_AT + 0.55

/**
 * Maps real seconds-since-delivery onto the plain shot timeline. A cheers
 * shot pauses the timeline while the glass is raised, then carries on.
 */
export function getShotLocalTime(elapsed: number, cheers: boolean): number {
  if (!cheers || elapsed < CHEERS_RAISE_AT) return elapsed
  if (elapsed < CHEERS_RAISE_AT + CHEERS_RAISE_SECONDS) return CHEERS_RAISE_AT
  return elapsed - CHEERS_RAISE_SECONDS
}

/** 0..1 how far the glass is raised for the cheers (0 for a plain shot). */
export function getCheersRaise(elapsed: number, cheers: boolean): number {
  if (!cheers) return 0
  const t = elapsed - CHEERS_RAISE_AT
  if (t <= 0 || t >= CHEERS_RAISE_SECONDS) return 0
  const up = Math.min(1, t / 0.25)
  const down = Math.min(1, (CHEERS_RAISE_SECONDS - t) / 0.25)
  const eased = (value: number) => value * value * (3 - 2 * value)
  return Math.min(eased(up), eased(down))
}

export function getShotTotalSeconds(cheers: boolean): number {
  return SHOT_TOTAL_SECONDS + (cheers ? CHEERS_RAISE_SECONDS : 0)
}
