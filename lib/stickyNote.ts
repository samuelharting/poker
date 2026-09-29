/**
 * "Sticky note on the forehead": one short word stuck on another player's
 * avatar for the rest of the hand. Pure helpers shared by the protocol, the
 * room and the UI. No word filtering (private friends game): the only
 * sanitising is technical, so text can't break the layout.
 */

export const STICKY_NOTE_MAX_LENGTH = 10
/** A sender may stick one note per hand, and at most this often overall. */
export const STICKY_NOTE_COOLDOWN_MS = 8_000
/** A target can wear at most this many notes (one at a time, replaced) per hand. */
export const STICKY_NOTE_MAX_PER_TARGET_PER_HAND = 2

/** Public note as carried on a seated player in the room snapshot. */
export interface StickyNote {
  text: string
  fromId: string
  fromNickname: string
  at: number
}

// Control chars become spaces (tabs, newlines); zero-width, bidi embeddings/overrides/isolates,
// soft hyphen, variation selectors 1-15 and the BOM are dropped. Notes are plain text, so the
// emoji joiner (200D) goes too.
const hex = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`
const classOf = (ranges: ReadonlyArray<readonly [number, number]>) =>
  new RegExp(`[${ranges.map(([lo, hi]) => (lo === hi ? hex(lo) : `${hex(lo)}-${hex(hi)}`)).join('')}]`, 'gu')
const CONTROL_RE = classOf([[0x00, 0x1f], [0x7f, 0x9f]])
const INVISIBLE_RE = classOf([
  [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180e],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0e],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb],
])

export type StickyTextResult = { ok: true; text: string } | { ok: false; reason: string }

/** Trim, collapse whitespace, strip invisibles, cap stacked accents, enforce 1-10 code points. */
export function sanitizeStickyText(raw: unknown): StickyTextResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'Write a word for the sticky note.' }
  const text = raw
    .normalize('NFC')
    .replace(CONTROL_RE, ' ')
    .replace(INVISIBLE_RE, '')
    // Zalgo guard: at most one combining mark per letter.
    .replace(/(\p{M})\p{M}+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!text) return { ok: false, reason: 'Write a word for the sticky note.' }
  if (Array.from(text).length > STICKY_NOTE_MAX_LENGTH) {
    return { ok: false, reason: `Sticky notes are ${STICKY_NOTE_MAX_LENGTH} characters max.` }
  }
  return { ok: true, text }
}

export function isValidStickyNote(raw: unknown): raw is StickyNote {
  if (typeof raw !== 'object' || raw === null) return false
  const note = raw as Partial<StickyNote>
  return (
    typeof note.text === 'string' && sanitizeStickyText(note.text).ok &&
    typeof note.fromId === 'string' &&
    typeof note.fromNickname === 'string' &&
    typeof note.at === 'number' && Number.isFinite(note.at)
  )
}
