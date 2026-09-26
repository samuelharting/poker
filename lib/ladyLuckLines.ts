import type { LadyLuckCompanionState } from './poker/types'

/**
 * Lady Luck's voice: a cheeky pool-party cocktail server and hype-girl.
 * Flirty but PG, always short (<= 5 words + an emoji). Shared by the 3D
 * renderer (speech bubble) and the 2D badge + table toast. `{name}` is
 * replaced with another player's nickname.
 */

export type LadyLuckLineContext =
  | 'arrive_streak'
  | 'arrive_big_win'
  | 'flirt'
  | 'cheer'
  | 'sulk_leave'
  | 'owner_folded'
  | 'owner_bet'
  | 'owner_check'
  | 'owner_all_in'
  | 'other_all_in'
  | 'sass_other'
  | 'serve'
  | 'muted'

export const LADY_LUCK_LINES: Record<LadyLuckLineContext, readonly string[]> = {
  arrive_streak: [
    'Stick with me, lucky 🍀',
    'Two in a row? Hi 😘',
    'Somebody’s on fire 🔥',
    'Hot streak? I’m yours 💁‍♀️',
  ],
  arrive_big_win: [
    'Ooh, big spender 😘',
    'Now THAT’s a pot 💰',
  ],
  flirt: [
    'Don’t fold on me 😉',
    'You look expensive 💎',
    'Deal ’em, gorgeous ✨',
    'I’m your lucky charm 🍀',
    'Winners get extra cherries 🍒',
    'Keep that streak warm 🔥',
    'Table’s yours, champ 👑',
    'Chips look good on you 💅',
    'Another round, lucky? 🍹',
    'Eyes on the prize 😘',
  ],
  cheer: [
    'Again?! Legend 😍',
    'Cha-ching! 💸',
    'That’s my lucky charm 🍀',
    'Keep ’em coming 💋',
    'Unstoppable, darling 🔥',
    'Pay the winner! 💰',
  ],
  sulk_leave: [
    'Ew. I’m outta here 🙄',
    'Call me when lucky 💅',
    'Hmph! Cold streak 🥶',
    'Bye, butterfingers 💔',
    'Tab’s closed, sweetie 🧾',
  ],
  owner_folded: [
    'Ew, a fold? 🙄',
    'Boring! 🥱',
    'Folding? Really? 😤',
    'Coward… cute though 😏',
  ],
  owner_bet: [
    'Ooh, bold move 😍',
    'Make ’em sweat 💦',
    'Bet it, baby 💸',
    'That’s my player 🔥',
  ],
  owner_check: [
    'Sneaky… I like it 😏',
    'Slow-playing? Cute 😉',
  ],
  owner_all_in: [
    'ALL IN?! Marry me 💍',
    'Go big, gorgeous 🔥',
    'Now we’re talking 💰',
  ],
  other_all_in: [
    '{name} is bluffing 🙄',
    'Cute shove, {name} 😂',
    'Easy, {name} 💅',
  ],
  sass_other: [
    '{name}? Please 🙄',
    'Nice try, {name} 😂',
    '{name} needs a nap 😴',
    'Tip your server, {name} 💅',
    'Sorry {name}, I’m taken 💁‍♀️',
  ],
  serve: [
    'On the house 🍹',
    'Your usual, champ 🍹',
    'Drink up, lucky 🥂',
  ],
  muted: [
    'Fine. 🙄',
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

/** Counts words, ignoring emoji-only tokens (used to keep her lines short). */
export function countLadyLuckWords(line: string): number {
  return line.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length
}

export function pickLadyLuckLine(context: LadyLuckLineContext, seed: string | number, name?: string): string {
  const pool = LADY_LUCK_LINES[context]
  const numericSeed = typeof seed === 'number' ? Math.abs(Math.floor(seed)) : hashLadyLuckSeed(seed)
  const line = pool[numericSeed % pool.length]!
  return line.replace('{name}', name?.trim() || 'hon')
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

function describeStreak(companion: LadyLuckCompanionState) {
  return `${Math.max(2, companion.streak)} wins in a row!`
}

/**
 * Table-wide toast text for a companion change, or null when nothing worth
 * announcing happened (mood-only changes such as flirt -> cheer, or a mute).
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
      text: `💃 Lady Luck dumped ${who(previous.ownerId)} for ${target} — ${describeStreak(next)}`,
    }
  }

  return {
    key: `${next.id}:arrive`,
    kind: 'arrive',
    text: `💃 Lady Luck is all over ${target} — ${describeStreak(next)}`,
  }
}

/** Browser event the room hook listens for to send `companion_mute`. */
export const LADY_LUCK_MUTE_EVENT = 'poker:lady-luck-mute'

/** Ask the room connection to tell Lady Luck to shut up (owner only; the server enforces it). */
export function requestLadyLuckMute(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LADY_LUCK_MUTE_EVENT))
}
