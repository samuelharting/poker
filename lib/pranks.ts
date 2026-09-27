/**
 * "Mess with your friends" table pranks: buying someone a shot and flicking a
 * chip at their head. The server validates and broadcasts a PrankEvent; the
 * desktop client turns it into pictures only (a shot glass sliding across the
 * felt, icon pops), never sentences. Pure module shared by room, hooks, tests.
 */
import { HOUSE_SHOT_RULES, type HouseShotRule } from './houseRules'

/**
 * `shot_queued`: bought for someone still live in a hand, waiting;
 * `shot`: poured (delivered) - the animation, +3 and chaser start now;
 * `house_shot`: the house pours one (lost to the 7-2), fromId HOUSE_ID;
 * `chip_flick`: purely cosmetic bonk.
 */
export type PrankKind = 'shot' | 'shot_queued' | 'house_shot' | 'chip_flick'

export const PRANK_KINDS: readonly PrankKind[] = ['shot', 'shot_queued', 'house_shot', 'chip_flick']

/** Sender id for house shots (the bartender, not a player). */
export const HOUSE_ID = 'house'

/** One chip flick per sender every this many milliseconds. Purely cosmetic. */
export const CHIP_FLICK_COOLDOWN_MS = 8_000

export interface PrankEvent {
  id: string
  kind: PrankKind
  fromId: string
  fromNickname: string
  targetId: string
  targetNickname: string
  at: number
  /** Shots: the target's drunk level after the shot. */
  level?: number
  /** Shots: how many levels the shot actually added (clamped at 10). */
  levelAdded?: number
  /** Shots: the shot knocked the target out. */
  passedOut?: boolean
  /** house_shot: which house rule poured it. */
  rule?: HouseShotRule
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidPrankEvent(raw: unknown): raw is PrankEvent {
  if (!isObject(raw)) return false
  const event = raw as Partial<PrankEvent>
  return (
    isNonEmptyString(event.id) &&
    typeof event.kind === 'string' && (PRANK_KINDS as readonly string[]).includes(event.kind) &&
    isNonEmptyString(event.fromId) &&
    isNonEmptyString(event.targetId) &&
    event.fromId !== event.targetId &&
    typeof event.fromNickname === 'string' &&
    typeof event.targetNickname === 'string' &&
    typeof event.at === 'number' && Number.isFinite(event.at) &&
    (event.level === undefined || (Number.isInteger(event.level) && event.level >= 0 && event.level <= 10)) &&
    (event.levelAdded === undefined || (Number.isInteger(event.levelAdded) && event.levelAdded >= 0 && event.levelAdded <= 10)) &&
    (event.passedOut === undefined || typeof event.passedOut === 'boolean') &&
    (event.rule === undefined || (HOUSE_SHOT_RULES as readonly string[]).includes(event.rule))
  )
}
