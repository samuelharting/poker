import type { LadyLuckCompanionState } from './poker/types'

/**
 * Lady Luck's voice: cheeky casino hype-girl, flirty but PG. Shared by the 3D
 * renderer (speech bubble) and the 2D badge + table toast.
 */

export type LadyLuckLineContext =
  | 'arrive_streak'
  | 'arrive_big_win'
  | 'flirt'
  | 'cheer'
  | 'sulk_leave'
  | 'owner_folded'

export const LADY_LUCK_LINES: Record<LadyLuckLineContext, readonly string[]> = {
  arrive_streak: [
    'Stick with me, lucky 🍀',
    'Two in a row? I noticed 😘',
    'Hot hands? I love a hot streak 🔥',
    'Is this seat taken, lucky? 💅',
  ],
  arrive_big_win: [
    'Ooh, big spender 😘',
    'Now THAT is a pot, darling 💰',
    'Cha-ching! I’m all yours, sugar ✨',
    'Did somebody say jackpot? 💎',
  ],
  flirt: [
    'Don’t you dare fold on me 😉',
    'I only date chip leaders 💁‍♀️',
    'Deal ’em, gorgeous ✨',
    'Mmm, those chips look good on you 💋',
    'Go on, make me proud 🍀',
    'I’m your good luck charm, hon 😘',
  ],
  cheer: [
    'Again?! You’re spoiling me 😍',
    'Cha-ching! 💸',
    'That’s my lucky charm! 🍀',
    'Keep ’em coming, darling 💋',
    'Somebody stop this legend 🔥',
  ],
  sulk_leave: [
    'Ew, a loss? I’m outta here 🙄',
    'Call me when you’re lucky again 💅',
    'Hmph! I don’t do cold streaks 🥶',
    'It’s not me, it’s your cards 💔',
  ],
  owner_folded: [
    'Ew, a fold? 🙄',
    'Boring! Play a hand, darling 🥱',
    'Folding? In front of me? 😤',
  ],
}

/** Deterministic string hash (FNV-1a) so every client picks the same line. */
export function hashLadyLuckSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function pickLadyLuckLine(context: LadyLuckLineContext, seed: string | number): string {
  const pool = LADY_LUCK_LINES[context]
  const numericSeed = typeof seed === 'number' ? Math.abs(Math.floor(seed)) : hashLadyLuckSeed(seed)
  return pool[numericSeed % pool.length]!
}

/** The line that fits the companion's current mood. */
export function getLadyLuckMoodContext(companion: Pick<LadyLuckCompanionState, 'mood' | 'reason'>): LadyLuckLineContext {
  switch (companion.mood) {
    case 'arrive':
      return companion.reason === 'big_win' ? 'arrive_big_win' : 'arrive_streak'
    case 'cheer':
      return 'cheer'
    case 'sulk_leave':
      return 'sulk_leave'
    default:
      return 'flirt'
  }
}

export function getLadyLuckMoodLine(companion: LadyLuckCompanionState): string {
  return pickLadyLuckLine(getLadyLuckMoodContext(companion), `${companion.id}:${companion.mood}:${companion.since}`)
}

export type LadyLuckToastKind = 'arrive' | 'switch' | 'leave'

export interface LadyLuckToast {
  key: string
  kind: LadyLuckToastKind
  text: string
}

function describeReason(companion: LadyLuckCompanionState) {
  if (companion.reason === 'big_win') {
    return companion.streak >= 2 ? `${companion.streak} wins in a row and a monster pot!` : 'what a pot!'
  }
  return `${companion.streak} wins in a row!`
}

/**
 * Table-wide toast text for a companion change, or null when nothing worth
 * announcing happened (mood-only changes such as flirt -> cheer).
 */
export function describeLadyLuckChange(
  previous: LadyLuckCompanionState | null,
  next: LadyLuckCompanionState | null,
  nameOf: (playerId: string) => string,
  yourId?: string | null
): LadyLuckToast | null {
  const who = (playerId: string) => (yourId && playerId === yourId ? 'you' : nameOf(playerId))

  if (next && next.mood === 'sulk_leave') {
    if (previous?.id === next.id && previous.mood === 'sulk_leave') return null
    return {
      key: `${next.id}:leave`,
      kind: 'leave',
      text: `💨 Lady Luck storms off on ${who(next.ownerId)}. Hmph!`,
    }
  }

  if (!next) {
    if (!previous || previous.mood === 'sulk_leave') return null
    return {
      key: `${previous.id}:gone`,
      kind: 'leave',
      text: `💨 Lady Luck ditched ${who(previous.ownerId)}.`,
    }
  }

  if (previous?.id === next.id) return null

  const target = who(next.ownerId)
  if (previous && previous.mood !== 'sulk_leave' && previous.ownerId !== next.ownerId) {
    return {
      key: `${next.id}:switch`,
      kind: 'switch',
      text: `💃 Lady Luck dumped ${who(previous.ownerId)} for ${target} — ${describeReason(next)}`,
    }
  }

  return {
    key: `${next.id}:arrive`,
    kind: 'arrive',
    text: `💃 Lady Luck is all over ${target} — ${describeReason(next)}`,
  }
}
