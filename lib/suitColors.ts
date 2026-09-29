export type SuitColorMode = 'two' | 'four'
export type SuitName = 'clubs' | 'diamonds' | 'hearts' | 'spades'

/**
 * Card ink for every renderer (DOM cards use the matching CSS in globals.css,
 * the 3D felt cards paint these onto their canvas textures). Two-color mode is
 * the classic black/red deck; four-color mode is spades black, hearts red,
 * diamonds blue, clubs green so flushes read at a glance.
 */
export const SUIT_INK: Record<SuitColorMode, Record<SuitName, string>> = {
  two: {
    spades: '#111417',
    clubs: '#111417',
    hearts: '#d0202f',
    diamonds: '#d0202f',
  },
  four: {
    spades: '#111417',
    hearts: '#d0202f',
    diamonds: '#1f62dd',
    clubs: '#12873f',
  },
}

export function getSuitInk(suit: SuitName, mode: SuitColorMode = 'two') {
  return SUIT_INK[mode][suit]
}

export function normalizeSuitColorMode(value: unknown): SuitColorMode {
  return value === 'four' ? 'four' : 'two'
}
