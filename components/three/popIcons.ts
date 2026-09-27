/**
 * Drawn icons for the 3D table pops and nameplate badges. Emoji glyphs depend
 * on the viewer's system font (some Windows builds and headless browsers draw
 * 🥃 as a blank picture frame), so every icon that floats over the 3D scene is
 * a small inline SVG instead: crisp at any size, identical on every machine.
 */

export type PopIconKind = 'shot' | 'bonk' | 'beer' | 'beer2' | 'water'

const INK = '#2a2118'

const SHOT = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
<path d="M15 10H49L44 53.5Q43.5 57 40 57H24Q20.5 57 20 53.5Z" fill="#eaf6ff" fill-opacity=".62"/>
<path d="M18 27H46L43.2 49H20.8Z" fill="#e0861f"/>
<path d="M18 27H46L45.6 30.6H18.4Z" fill="#ffc862"/>
<path d="M21 49H43L42.6 53.3Q42.2 55 40.2 55H23.8Q21.8 55 21.4 53.3Z" fill="#f4fbff" fill-opacity=".9"/>
<path d="M21 14.5L24.6 46" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>
<path d="M15 10H49L44 53.5Q43.5 57 40 57H24Q20.5 57 20 53.5Z" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
</svg>`

const BONK = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
<path d="M32 3L37.4 17.2L50.6 8.6L46.6 23.4L61 24.6L49.4 33.4L60.4 43L45.6 43.6L48.6 58.6L36 50.4L30.6 61L25.8 49.6L12.4 56.6L17 42.2L3 39.6L15 31L5 20.4L19.6 20.6L17.4 6L29 15.2Z" fill="#ffcf33" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M32 17L35.2 25.4L43.6 22.4L39.8 30.6L47.4 35L38.8 36.6L39.8 45.4L32.8 40.2L27 46.8L26.2 38L17.4 37.6L24 31.4L18.4 24.6L27.2 25.4Z" fill="#fff6cf"/>
<circle cx="32" cy="32" r="4.2" fill="#ff5b3a"/>
</svg>`

const BEER = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
<path d="M45 25H51Q56 25 56 30V42Q56 47 51 47H45" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
<path d="M45 25H51Q56 25 56 30V42Q56 47 51 47H45" fill="none" stroke="#fff3cf" stroke-width="2.6" stroke-linecap="round"/>
<rect x="12" y="18" width="34" height="40" rx="5" fill="#f2a516"/>
<path d="M12 44H46V53Q46 58 41 58H17Q12 58 12 53Z" fill="#d9860c"/>
<path d="M18 26V50" stroke="#ffd96a" stroke-width="3.4" stroke-linecap="round"/>
<circle cx="30" cy="40" r="1.8" fill="#ffe7a0"/><circle cx="36" cy="31" r="1.4" fill="#ffe7a0"/><circle cx="26" cy="49" r="1.3" fill="#ffe7a0"/>
<rect x="12" y="18" width="34" height="40" rx="5" fill="none" stroke="${INK}" stroke-width="3.2"/>
<path d="M10 20Q9 12 17 12Q19 6 27 8Q32 3 38 8Q47 6 48 14Q52 18 47 22Q44 26 38 23Q34 27 29 23Q24 27 20 23Q12 26 10 20Z" fill="#fffdf6" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
</svg>`

const WATER = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
<path d="M32 5C32 5 12 29 12 41.5A20 20 0 0 0 52 41.5C52 29 32 5 32 5Z" fill="#47b3f0" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>
<path d="M32 13C32 13 18 31 18 41.5A14 14 0 0 0 26 54" fill="none" stroke="#9fdcff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
<ellipse cx="23.5" cy="40" rx="3.6" ry="6.5" fill="#fff" opacity=".85" transform="rotate(18 23.5 40)"/>
</svg>`

const ICONS: Record<Exclude<PopIconKind, 'beer2'>, string> = { shot: SHOT, bonk: BONK, beer: BEER, water: WATER }

/** Bare SVG markup for one icon (nameplate badges). */
export function popIconSvg(kind: Exclude<PopIconKind, 'beer2'>): string {
  return ICONS[kind]
}

/** Inline SVG markup for a pop icon (two mugs for a double). */
export function popIconMarkup(kind: PopIconKind): string {
  if (kind === 'beer2') return `<i class="pop-icon is-back">${BEER}</i><i class="pop-icon">${BEER}</i>`
  return `<i class="pop-icon">${ICONS[kind]}</i>`
}
