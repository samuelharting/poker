/**
 * Wardrobe data and seeded choices for the rigged avatars: outfit palettes per
 * outfit family, natural hair colours and punk dye sets, the small accent
 * colours (shoes, jeans wash, buckles) and which jewellery a player wears.
 * Pure data and maths (no three.js) so it can be unit tested exhaustively.
 *
 * Every pick is deterministic in the player's seed, and independent fields use
 * independent salts so that, say, the shirt does not decide the hair.
 */

export type Palette = Record<string, string>

/** Jewel-toned wardrobe that sits well against the teal lounge and green felt. Keys are GLB material names. */
export const OUTFIT_PALETTES: Record<string, Palette[]> = {
  // Suit: jacket, shirt, tie. Shirts and ties vary so a table of suits is not a row of white-shirt clones.
  Suit: [
    { Suit: '#27324d', White: '#efe8d8', Tie: '#a3263c' },
    { Suit: '#3a2a45', White: '#f1ead9', Tie: '#d8a23a' },
    { Suit: '#1f3b3a', White: '#ece6d6', Tie: '#c2573a' },
    { Suit: '#2c2c33', White: '#f2ecde', Tie: '#2f8f83' },
    { Suit: '#34475f', White: '#d6e2ee', Tie: '#c9a24a' },
    { Suit: '#1c1d22', White: '#f4f1e8', Tie: '#c4223a' },
    { Suit: '#5a2330', White: '#efdcd6', Tie: '#2f3340' },
    { Suit: '#8c6a46', White: '#f1ead9', Tie: '#23324f' },
    { Suit: '#5b6068', White: '#e4def0', Tie: '#1f6a4c' },
    { Suit: '#4a5238', White: '#ece6d6', Tie: '#b4622f' },
  ],
  // Casual2: tee (LightBrown), jeans (LightBlue), sneaker sole (White) and uppers (Red_Dark).
  Casual2: [
    { LightBrown: '#d2a03f', LightBlue: '#35507a', White: '#ece6da', Red_Dark: '#8f2433' },
    { LightBrown: '#c8604e', LightBlue: '#2f3f5e', White: '#ece6da', Red_Dark: '#1f5c55' },
    { LightBrown: '#7fa36a', LightBlue: '#3b4f78', White: '#ece6da', Red_Dark: '#7a2a3a' },
    { LightBrown: '#e0d3b4', LightBlue: '#2c4a6e', White: '#ece6da', Red_Dark: '#b8403a' },
    { LightBrown: '#2f8f86', LightBlue: '#34363f', White: '#e8e2d4', Red_Dark: '#d2a03f' },
    { LightBrown: '#7c4a7e', LightBlue: '#3f5a82', White: '#ece6da', Red_Dark: '#2f3f5e' },
    { LightBrown: '#5c7fa8', LightBlue: '#2c3a52', White: '#f0ebe0', Red_Dark: '#a33a2c' },
    { LightBrown: '#b5532f', LightBlue: '#5d7fa6', White: '#ece6da', Red_Dark: '#2c2f3a' },
    { LightBrown: '#3d4047', LightBlue: '#3b4f78', White: '#ece6da', Red_Dark: '#c8604e' },
  ],
  // Casual: hoodie (Purple), jeans (LightBlue), sneakers (White; Purple laces/upper).
  Casual: [
    { Purple: '#5d3a8a', LightBlue: '#34496e', White: '#ece6da' },
    { Purple: '#1f7f7a', LightBlue: '#2e3f5c', White: '#ece6da' },
    { Purple: '#a83246', LightBlue: '#33476a', White: '#ece6da' },
    { Purple: '#3f64a8', LightBlue: '#2c3a52', White: '#ece6da' },
    { Purple: '#2f5d46', LightBlue: '#34363f', White: '#e8e2d4' },
    { Purple: '#3b3f4a', LightBlue: '#3f5a82', White: '#ece6da' },
    { Purple: '#c0622f', LightBlue: '#2c3a52', White: '#f0ebe0' },
    { Purple: '#c97b92', LightBlue: '#33476a', White: '#ece6da' },
    { Purple: '#a68a2c', LightBlue: '#2e3f5c', White: '#ece6da' },
  ],
  Worker: [
    { Worker_Vest: '#e0692c', Worker_Yellow: '#e8b640', LightBrown: '#7c95a6', Brown: '#46506a', Brown2: '#2c2f3a' },
    { Worker_Vest: '#d9a32e', Worker_Yellow: '#e8c35a', LightBrown: '#b0544a', Brown: '#3b4a5e', Brown2: '#2c2f3a' },
    { Worker_Vest: '#2f8f7a', Worker_Yellow: '#e2ae3a', LightBrown: '#d8cdb3', Brown: '#40465a', Brown2: '#2c2f3a' },
    { Worker_Vest: '#a8c53a', Worker_Yellow: '#e8d04a', LightBrown: '#4a5a72', Brown: '#4a4538', Brown2: '#2c2f3a' },
    { Worker_Vest: '#d8452c', Worker_Yellow: '#e8b640', LightBrown: '#d9d2c2', Brown: '#3a4256', Brown2: '#2c2f3a' },
    { Worker_Vest: '#e0852c', Worker_Yellow: '#dcdcdc', LightBrown: '#5b7a58', Brown: '#4a4a52', Brown2: '#2c2f3a' },
  ],
  // Punk: vest (Black), tank (White), jeans (LightBlue).
  Punk: [
    { Black: '#26242c', White: '#ebe4d6', LightBlue: '#2f3e58' },
    { Black: '#3a1f2c', White: '#e8e0cf', LightBlue: '#27324a' },
    { Black: '#1f2c34', White: '#f0e8d8', LightBlue: '#353148' },
    { Black: '#2c2a24', White: '#cfd3da', LightBlue: '#2f3e58' },
    { Black: '#201a2e', White: '#e8c4c8', LightBlue: '#2a2f3a' },
    { Black: '#23302a', White: '#ebe4d6', LightBlue: '#3a3048' },
    { Black: '#32211f', White: '#8fd0c8', LightBlue: '#27324a' },
  ],
  Adventurer: [
    { Green: '#3f6d55', LightGreen: '#c4a46a', Brown: '#6e4a2c', Brown2: '#3a3140', Gold: '#e0b04a' },
    { Green: '#7a3b33', LightGreen: '#d6c29a', Brown: '#5c3e28', Brown2: '#2e3244', Gold: '#e0b04a' },
    { Green: '#34577a', LightGreen: '#c9b07a', Brown: '#6a4630', Brown2: '#33303c', Gold: '#e0b04a' },
    { Green: '#5a3d6b', LightGreen: '#d8c9a8', Brown: '#5c4030', Brown2: '#2e2a38', Gold: '#c5cbd4' },
    { Green: '#2f6a6e', LightGreen: '#d9c9a0', Brown: '#6e4a2c', Brown2: '#2e3244', Gold: '#c47a4a' },
    { Green: '#a77a2b', LightGreen: '#e6d8b4', Brown: '#4e3524', Brown2: '#2a2630', Gold: '#e0b04a' },
    { Green: '#4a4f58', LightGreen: '#b8a888', Brown: '#6a4630', Brown2: '#33303c', Gold: '#d9a441' },
  ],
}

/** The garment that carries the outfit, per family: kept off the player's skin and hair colours. */
export const OUTFIT_MAIN_KEY: Record<string, string> = {
  Suit: 'Suit',
  Casual2: 'LightBrown',
  Casual: 'Purple',
  Worker: 'Worker_Vest',
  Punk: 'Black',
  Adventurer: 'Green',
}

/** Natural hair colours, commonest first-ish: dark and brown dominate, a few reds, blondes and greys. */
export const HAIR_COLORS = [
  '#1c1613', '#2b1d14', '#3a2419', '#5e3520', '#7a4a2a',
  '#8a3a1e', '#a24a1f', '#b8612a', '#c99a52', '#d9ae5e',
  '#e6dcc0', '#8d8a86', '#b9b6b0', '#2d2a33', '#4a2c34',
]

/** Playful non-punk dyes (rare). */
export const FUN_HAIR_COLORS = ['#2f6fa8', '#a1385f', '#2f8f83', '#6a4aa8', '#d96a8a']

/** Punk dye sets: crest colour and the accent for the darker sideburn/goatee hair. */
export const PUNK_DYE_SETS: Array<{ main: string; accent: string }> = [
  { main: '#d8345f', accent: '#6b1b57' },
  { main: '#1fb3a6', accent: '#0f3f66' },
  { main: '#c8283c', accent: '#2a1d3a' },
  { main: '#8150d8', accent: '#25a8d8' },
  { main: '#f0a030', accent: '#b8203c' },
  { main: '#2f7bd8', accent: '#e03a8a' },
  { main: '#9be22f', accent: '#1b6e55' },
  { main: '#e8e8f0', accent: '#d8345f' },
  { main: '#ff5d8f', accent: '#3a2a7a' },
  { main: '#1a1a22', accent: '#d8345f' },
]

export function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** A different well-mixed 32-bit value of `seed` per `salt` (so fields do not correlate). */
export function mixSeed(seed: number, salt: number) {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.replace(/./g, '$&$&') : value
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** sRGB hex to CIE Lab (D65). */
export function hexToLab(hex: string): [number, number, number] {
  const lin = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hexToRgb(hex).map(lin) as [number, number, number]
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIE76 colour difference: ~2 is a just-noticeable step, 20+ is clearly a different colour. */
export function colorDistance(a: string, b: string) {
  const [l1, a1, b1] = hexToLab(a)
  const [l2, a2, b2] = hexToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** Clearly different from skin: a garment the same tone as the wearer's skin reads as bare. */
export const MIN_GARMENT_SKIN_DISTANCE = 20
/** Hair needs less separation from skin (it has its own shape and outline). */
export const MIN_HAIR_SKIN_DISTANCE = 16

export function pickOutfitPalette(family: string | null, seed: number, skinHex?: string | null): Palette {
  const variants = family ? OUTFIT_PALETTES[family] : undefined
  if (!family || !variants) return {}
  const start = seed % variants.length
  const mainKey = OUTFIT_MAIN_KEY[family]
  if (skinHex && mainKey) {
    for (let step = 0; step < variants.length; step += 1) {
      const candidate = variants[(start + step) % variants.length]!
      const main = candidate[mainKey]
      if (!main || colorDistance(main, skinHex) >= MIN_GARMENT_SKIN_DISTANCE) return candidate
    }
  }
  return variants[start]!
}

export interface HairChoice {
  main: string
  /** Darker/contrast hair (sideburns and goatee on the punk). */
  accent: string | null
  /** True for dyed hair (any non-natural colour). */
  dyed: boolean
}

export function pickHairColor(family: string | null, seed: number, skinHex?: string | null): HairChoice {
  if (family === 'Punk') {
    const set = PUNK_DYE_SETS[mixSeed(seed, 3) % PUNK_DYE_SETS.length]!
    return { main: set.main, accent: set.accent, dyed: true }
  }
  if (mixSeed(seed, 4) % 100 < 7) {
    return { main: FUN_HAIR_COLORS[mixSeed(seed, 5) % FUN_HAIR_COLORS.length]!, accent: null, dyed: true }
  }
  const start = mixSeed(seed, 6) % HAIR_COLORS.length
  for (let step = 0; step < HAIR_COLORS.length; step += 1) {
    const candidate = HAIR_COLORS[(start + step) % HAIR_COLORS.length]!
    if (!skinHex || colorDistance(candidate, skinHex) >= MIN_HAIR_SKIN_DISTANCE) return { main: candidate, accent: null, dyed: false }
  }
  return { main: HAIR_COLORS[start]!, accent: null, dyed: false }
}

/** Whether this player's hair carries highlights and a root-to-tip shade (about two in three). */
export function hairHighlights(seed: number) {
  return mixSeed(seed, 9) % 100 < 65
}

/**
 * Whether this player's garment `materialName` carries collar/cuff trim (about three in four). Each
 * garment decides on its own, so a suit can be piped while the shirt under it is plain, and the same
 * seed always dresses the same.
 */
export function clothTrim(seed: number, materialName: string) {
  return mixSeed(seed ^ hashString(materialName), 11) % 100 < 75
}

export type JewelryMetal = 'gold' | 'silver'
export type WristPieceKind = 'watch' | 'bracelet' | 'beads' | 'cuff'

export interface WristPiece {
  side: 'L' | 'R'
  kind: WristPieceKind
  metal: JewelryMetal
  /** Strap/bead colour (hex). */
  color: string
}

export interface JewelrySpec {
  wrist: WristPiece[]
  chain: { metal: JewelryMetal; pendant: boolean } | null
}

const STRAP_COLORS = ['#2b2022', '#5a3a28', '#1f3b5c', '#8f2433', '#2f6a5a']
const BEAD_COLORS = ['#c0392b', '#2f8f83', '#d8a23a', '#34577a', '#e8e0cf']

/**
 * Jewellery by family and seed. Suits: a watch, no chain over the tie. Workers
 * keep to a watch. The punk and the adventurer lean into chains and wrist wear.
 */
export function pickJewelry(family: string | null, seed: number): JewelrySpec {
  const roll = (salt: number) => (mixSeed(seed, 20 + salt) % 1000) / 1000
  const pick = <T,>(values: readonly T[], salt: number) => values[mixSeed(seed, 40 + salt) % values.length]!
  const lean = family === 'Punk' || family === 'Adventurer'
  const formal = family === 'Suit'
  const worker = family === 'Worker'
  const watchChance = formal ? 0.6 : worker ? 0.35 : 0.3
  const braceletChance = formal ? 0.1 : worker ? 0.12 : lean ? 0.5 : 0.28
  const chainChance = formal || worker ? 0 : family === 'Punk' ? 0.6 : family === 'Adventurer' ? 0.4 : 0.28

  const wrist: WristPiece[] = []
  const watchSide: 'L' | 'R' = roll(0) < 0.85 ? 'L' : 'R'
  const metal = (salt: number): JewelryMetal => (roll(salt) < 0.5 ? 'gold' : 'silver')
  if (roll(1) < watchChance) {
    wrist.push({ side: watchSide, kind: 'watch', metal: metal(2), color: pick(STRAP_COLORS, 1) })
  }
  if (roll(3) < braceletChance) {
    const kindRoll = roll(4)
    const kind: WristPieceKind = kindRoll < 0.4 ? 'beads' : kindRoll < 0.75 ? 'cuff' : 'bracelet'
    wrist.push({
      side: watchSide === 'L' ? 'R' : 'L',
      kind,
      metal: metal(5),
      color: kind === 'beads' ? pick(BEAD_COLORS, 2) : pick(STRAP_COLORS, 3),
    })
  }
  const chain = roll(6) < chainChance ? { metal: metal(7), pendant: roll(8) < 0.55 } : null
  return { wrist, chain }
}
