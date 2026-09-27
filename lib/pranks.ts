/**
 * "Mess with your friends" table pranks: buying someone a shot and flicking a
 * chip at their head. The server validates and broadcasts a PrankEvent; the
 * clients turn it into a toast, a 3D animation or a 2D pop. Pure module so
 * the room, the hooks and the tests share one source of truth.
 */
import { SHOT_LEVEL_BOOST } from './drinks'

export type PrankKind = 'shot' | 'chip_flick'

export const PRANK_KINDS: readonly PrankKind[] = ['shot', 'chip_flick']

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
    (event.passedOut === undefined || typeof event.passedOut === 'boolean')
  )
}

/** Toast copy, from the point of view of `viewerId`. */
export function describePrankEvent(
  event: Pick<PrankEvent, 'kind' | 'fromId' | 'fromNickname' | 'targetId' | 'targetNickname' | 'levelAdded' | 'passedOut'>,
  viewerId = ''
): { icon: string; text: string } {
  const from = event.fromId === viewerId ? 'You' : event.fromNickname
  const target = event.targetId === viewerId ? 'you' : event.targetNickname
  if (event.kind === 'shot') {
    const added = event.levelAdded ?? SHOT_LEVEL_BOOST
    const knockout = event.passedOut ? ' Lights out.' : ''
    return { icon: '🥃', text: `${from} bought ${target} a shot 🥃 (+${added})${knockout}` }
  }
  return { icon: '🪙', text: `${from} flicked a chip at ${target}. Bonk!` }
}
