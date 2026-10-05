/**
 * Table themes: whole-room looks the local player can pick in Settings.
 *
 * A theme is pure data (colours, light levels, texture recipes, which lounge
 * decor stays, which prop set to build). themeApply.ts turns the data into a
 * scene change in place, and themeProps.ts builds the prop groups. Nothing
 * here touches three.js or the network: the choice is local to one browser and
 * never leaves it, so the PartyKit protocol is untouched.
 *
 * The "lounge" theme is the original room. Its values mirror the constants in
 * DesktopPokerRoom3D.tsx and sceneLighting.ts (tests/table-themes.test.ts keeps
 * them in step), so picking it restores the shipped look exactly.
 */

export type TableThemeId = 'lounge' | 'highroller' | 'basement' | 'rooftop'

export const TABLE_THEME_IDS: readonly TableThemeId[] = ['lounge', 'highroller', 'basement', 'rooftop']
export const DEFAULT_TABLE_THEME: TableThemeId = 'lounge'

/** localStorage key for the local player's choice. */
export const TABLE_THEME_STORAGE_KEY = 'poker-night:table-theme'

export function isTableThemeId(value: unknown): value is TableThemeId {
  return typeof value === 'string' && (TABLE_THEME_IDS as readonly string[]).includes(value)
}

/** Anything that is not a known theme id falls back to the lounge. */
export function normalizeTableTheme(value: unknown): TableThemeId {
  return isTableThemeId(value) ? value : DEFAULT_TABLE_THEME
}

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Blocked storage (private mode, policy) throws on access.
    return null
  }
}

/** Reads the saved theme. Never throws: bad or missing data gives the lounge. */
export function readStoredTableTheme(storage: StorageReader | null = browserStorage()): TableThemeId {
  if (!storage) return DEFAULT_TABLE_THEME
  try {
    return normalizeTableTheme(storage.getItem(TABLE_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_TABLE_THEME
  }
}

/** Saves the theme. Returns false when storage refused (the choice still applies this session). */
export function writeStoredTableTheme(id: TableThemeId, storage: StorageWriter | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(TABLE_THEME_STORAGE_KEY, normalizeTableTheme(id))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Theme data

export interface LightSpec {
  color: string
  intensity: number
}

export interface FillSpec {
  sky: string
  ground: string
  intensity: number
}

/** Printed felt colours. `rgb` strings are "r, g, b" so they can take any alpha. */
export interface FeltPalette {
  /** Radial pool, centre to edge. */
  pool: readonly [string, string, string]
  /** Betting line and pinstripe. */
  line: string
  /** Crest, suits and the table name. */
  accent: string
  /** Edge shade and card dish. */
  shade: string
  /** Soft light blotches in the cloth. */
  highlight: string
  /** Table name printed under the crest. */
  label: string
}

export type ThemeTextureKind =
  | 'highroller-floor'
  | 'highroller-wall'
  | 'highroller-wainscot'
  | 'highroller-ceiling'
  | 'basement-paneling'
  | 'basement-floor'
  | 'basement-ceiling'
  | 'rooftop-skyline'
  | 'rooftop-glass'
  | 'rooftop-floor'

/** A change to one existing material. Anything left out keeps the lounge value. */
export interface SurfaceSpec {
  texture?: { kind: ThemeTextureKind; repeat?: readonly [number, number] }
  /** Also drive emissive from the texture (self-lit panels, windows, glowing seams). */
  glowTexture?: boolean
  color?: string
  roughness?: number
  metalness?: number
  envMapIntensity?: number
  emissive?: string
  emissiveIntensity?: number
  /** Drop the lounge's texture map (a plain painted or lacquered finish). */
  plain?: boolean
  /** Drop the lounge's fibre bump (marble, concrete and glass are smooth). */
  flat?: boolean
  clearcoat?: number
  clearcoatRoughness?: number
}

export interface FeltSpec {
  palette: FeltPalette
  /** Multiplies the printed palette (the stock felt uses a mid grey). */
  tint?: string
  roughness?: number
  envMapIntensity?: number
  bumpScale?: number
}

export interface NeonSpec {
  text: string
  /** Outer glow and tube stroke. */
  glow: string
  /** Tube core (warm or tinted, never pure white, so bloom stays legible). */
  core: string
  intensity: number
}

export type ThemePropsId = 'highroller' | 'basement' | 'rooftop'

export interface ShellSpec {
  floor: SurfaceSpec | null
  backWall: SurfaceSpec | null
  sideWalls: SurfaceSpec | null
  wainscot: SurfaceSpec | null
  sideWainscot: SurfaceSpec | null
  ceiling: SurfaceSpec | null
  chairRail: SurfaceSpec | null
  /** The merged pilaster, beam and moulding mesh (walnut in the lounge). */
  pilasters: SurfaceSpec | null
}

export interface TableThemeDef {
  id: TableThemeId
  label: string
  /** One line for the Settings picker. */
  blurb: string
  background: string
  fog: { color: string; density: number }
  environmentIntensity: number
  lights: {
    key: LightSpec
    rimLeft: LightSpec
    rimRight: LightSpec
    bounce: LightSpec
    front: LightSpec
    fill: FillSpec
  }
  /** Bloom feel: strength multiplier plus the pass's own threshold and radius. */
  bloom: { scale: number; threshold: number; radius: number }
  /** Colour of the light cone over the felt and its dust. */
  cone: { color: string }
  felt: FeltSpec | null
  rail: SurfaceSpec | null
  /** The shared metal on the felt inlay, rail bead and cup holders. */
  brass: SurfaceSpec | null
  apron: SurfaceSpec | null
  shell: ShellSpec
  /** Lounge decor (by object name) this theme hides. */
  hide: readonly string[]
  /** Replaces the lounge's POKER NIGHT sign; null keeps the stock sign. */
  neon: NeonSpec | null
  props: ThemePropsId | null
}

const NO_SHELL: ShellSpec = {
  floor: null,
  backWall: null,
  sideWalls: null,
  wainscot: null,
  sideWainscot: null,
  ceiling: null,
  chairRail: null,
  pilasters: null,
}

/** Scene background and fog colour of the original room. */
export const LOUNGE_BACKGROUND = '#081413'

const LOUNGE: TableThemeDef = {
  id: 'lounge',
  label: 'Deco Lounge',
  blurb: 'The original art deco lounge: emerald felt, brass and a warm key light.',
  background: LOUNGE_BACKGROUND,
  fog: { color: LOUNGE_BACKGROUND, density: 0.012 },
  environmentIntensity: 0.3,
  lights: {
    key: { color: '#ffe2b0', intensity: 88 },
    rimLeft: { color: '#7fb6ff', intensity: 74 },
    rimRight: { color: '#ffb27f', intensity: 64 },
    bounce: { color: '#2fbf8a', intensity: 6 },
    front: { color: '#ffd9b0', intensity: 8 },
    fill: { sky: '#b9d8ff', ground: '#1a0f08', intensity: 0.34 },
  },
  bloom: { scale: 1, threshold: 0.97, radius: 0.32 },
  cone: { color: '#ffe2b0' },
  felt: null,
  rail: null,
  brass: null,
  apron: null,
  shell: NO_SHELL,
  hide: [],
  neon: null,
  props: null,
}

/** Lounge decor every non-lounge theme drops: it is all warm-teal art deco. */
const LOUNGE_STYLE_DECOR = [
  'framed-poster',
  'gallery-prints',
  'wall-pilasters',
  'lamp-halos-and-washes',
  'carpet-light-pool',
  'pendant-lamp',
  'pendant-haze',
  'neon-sign',
  'emerald-back-bar',
] as const

const HIGH_ROLLER: TableThemeDef = {
  id: 'highroller',
  label: 'High Roller',
  blurb: 'Black marble, gold trim and midnight blue felt under a crystal chandelier.',
  background: '#07070d',
  fog: { color: '#07070d', density: 0.012 },
  environmentIntensity: 0.42,
  lights: {
    key: { color: '#fff0d2', intensity: 90 },
    rimLeft: { color: '#9db8ff', intensity: 66 },
    rimRight: { color: '#ffc77a', intensity: 72 },
    bounce: { color: '#3d62e6', intensity: 6.5 },
    front: { color: '#ffe6c4', intensity: 8 },
    fill: { sky: '#9aa8d8', ground: '#0a0a10', intensity: 0.3 },
  },
  bloom: { scale: 1.0, threshold: 0.96, radius: 0.34 },
  cone: { color: '#ffe9c0' },
  felt: {
    palette: {
      pool: ['#2250b0', '#16327f', '#0a1642'],
      line: '246, 208, 122',
      accent: '246, 214, 140',
      shade: '2, 8, 40',
      highlight: '150, 190, 255',
      label: 'HIGH ROLLER TABLE',
    },
    tint: '#c4c4c8',
    roughness: 0.9,
    envMapIntensity: 0.4,
  },
  rail: { color: '#34343a', roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.25, envMapIntensity: 1.2 },
  brass: { color: '#f0c466', roughness: 0.7, metalness: 1, envMapIntensity: 0.8 },
  apron: { color: '#2e2e36', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 },
  shell: {
    floor: {
      texture: { kind: 'highroller-floor', repeat: [5, 5] },
      color: '#ffffff',
      roughness: 0.22,
      metalness: 0.12,
      envMapIntensity: 1,
      flat: true,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
    },
    backWall: {
      texture: { kind: 'highroller-wall', repeat: [4, 1.6] },
      color: '#ffffff',
      roughness: 0.3,
      metalness: 0.1,
      envMapIntensity: 0.9,
    },
    sideWalls: {
      texture: { kind: 'highroller-wall', repeat: [3, 1.6] },
      color: '#ffffff',
      roughness: 0.3,
      metalness: 0.1,
      envMapIntensity: 0.9,
    },
    wainscot: {
      texture: { kind: 'highroller-wainscot', repeat: [8, 1] },
      color: '#ffffff',
      roughness: 0.34,
      metalness: 0.1,
      envMapIntensity: 0.8,
    },
    sideWainscot: {
      texture: { kind: 'highroller-wainscot', repeat: [6, 1] },
      color: '#ffffff',
      roughness: 0.34,
      metalness: 0.1,
      envMapIntensity: 0.8,
    },
    ceiling: {
      texture: { kind: 'highroller-ceiling', repeat: [6, 5] },
      color: '#ffffff',
      roughness: 0.6,
      emissive: '#ffe0a0',
      emissiveIntensity: 0.16,
      glowTexture: true,
    },
    chairRail: { color: '#f0c466', roughness: 0.35, envMapIntensity: 0.9 },
    // Black lacquer pilasters and beams under the gold trim.
    pilasters: { plain: true, color: '#17171d', roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 },
  },
  hide: LOUNGE_STYLE_DECOR.filter(name => name !== 'wall-pilasters'),
  neon: { text: 'HIGH ROLLERS', glow: '#f4b43c', core: '#ffe2a0', intensity: 0.8 },
  props: 'highroller',
}

const BASEMENT: TableThemeDef = {
  id: 'basement',
  label: 'Basement',
  blurb: 'A cozy, dim home game: wood paneling, a bare bulb, a fridge and cold ones.',
  background: '#0b0705',
  fog: { color: '#0b0705', density: 0.02 },
  environmentIntensity: 0.16,
  lights: {
    key: { color: '#ffb868', intensity: 78 },
    rimLeft: { color: '#e09a62', intensity: 26 },
    rimRight: { color: '#f2b070', intensity: 28 },
    bounce: { color: '#5fae7a', intensity: 4.5 },
    front: { color: '#ffc890', intensity: 7 },
    fill: { sky: '#a88a68', ground: '#150c06', intensity: 0.26 },
  },
  bloom: { scale: 0.8, threshold: 0.98, radius: 0.3 },
  cone: { color: '#ffcf8a' },
  felt: {
    palette: {
      pool: ['#2f8a5c', '#1f6a46', '#0e3a28'],
      line: '236, 224, 186',
      accent: '236, 224, 186',
      shade: '2, 24, 14',
      highlight: '170, 230, 190',
      label: 'FRIDAY NIGHT GAME',
    },
    tint: '#a8a8a8',
    roughness: 1,
    envMapIntensity: 0.2,
    bumpScale: 0.5,
  },
  rail: { color: '#d8b48c', roughness: 0.82, clearcoat: 0, envMapIntensity: 0.4 },
  brass: { color: '#9c7a55', roughness: 1, metalness: 0.55, envMapIntensity: 0.3 },
  apron: { color: '#c89a6a', roughness: 0.7, clearcoat: 0.1, clearcoatRoughness: 0.6 },
  shell: {
    floor: {
      texture: { kind: 'basement-floor' },
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.1,
      flat: true,
    },
    backWall: {
      texture: { kind: 'basement-paneling', repeat: [5, 1.4] },
      color: '#ffffff',
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.15,
    },
    sideWalls: {
      texture: { kind: 'basement-paneling', repeat: [4, 1.4] },
      color: '#ffffff',
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.15,
    },
    wainscot: null,
    sideWainscot: null,
    ceiling: null,
    chairRail: null,
    pilasters: null,
  },
  hide: [
    ...LOUNGE_STYLE_DECOR,
    'lounge-decor',
    'art-deco-wall-sconce',
    'coffered-ceiling',
    'side-wainscot',
    'room-wainscot',
    'room-trim-brass',
    'room-chair-rail',
  ],
  neon: { text: 'HOME GAME', glow: '#ff7a2a', core: '#ffb070', intensity: 0.8 },
  props: 'basement',
}

const ROOFTOP: TableThemeDef = {
  id: 'rooftop',
  label: 'Neon Rooftop',
  blurb: 'A night skyline, magenta and cyan neon, and dark glossy felt.',
  background: '#05030f',
  fog: { color: '#0a0620', density: 0.01 },
  environmentIntensity: 0.38,
  lights: {
    key: { color: '#efe4ff', intensity: 86 },
    rimLeft: { color: '#18dcff', intensity: 74 },
    rimRight: { color: '#ff30b4', intensity: 74 },
    bounce: { color: '#6f44ff', intensity: 5 },
    front: { color: '#ffd8f0', intensity: 8 },
    fill: { sky: '#6a5cff', ground: '#0a0214', intensity: 0.38 },
  },
  bloom: { scale: 1.05, threshold: 0.96, radius: 0.38 },
  cone: { color: '#d8a8ff' },
  felt: {
    palette: {
      pool: ['#3a2478', '#241450', '#0e0728'],
      line: '70, 232, 255',
      accent: '255, 120, 214',
      shade: '6, 0, 24',
      highlight: '170, 140, 255',
      label: 'MIDNIGHT HOLD’EM',
    },
    tint: '#d0d0d8',
    roughness: 0.58,
    envMapIntensity: 0.9,
    bumpScale: 0.12,
  },
  rail: { color: '#2c2640', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 1.4 },
  brass: { color: '#14e0ff', roughness: 0.4, metalness: 0.2, emissive: '#10d8ff', emissiveIntensity: 0.9 },
  apron: { color: '#241f36', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 },
  shell: {
    floor: {
      texture: { kind: 'rooftop-floor', repeat: [8, 8] },
      color: '#ffffff',
      roughness: 0.2,
      metalness: 0.25,
      envMapIntensity: 1.1,
      flat: true,
      glowTexture: true,
      emissive: '#ffffff',
      emissiveIntensity: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
    },
    backWall: {
      texture: { kind: 'rooftop-skyline' },
      color: '#8a8aa0',
      roughness: 0.4,
      metalness: 0,
      envMapIntensity: 0.4,
      glowTexture: true,
      emissive: '#ffffff',
      emissiveIntensity: 1,
    },
    sideWalls: {
      texture: { kind: 'rooftop-glass', repeat: [4, 1] },
      color: '#8a8aa8',
      roughness: 0.3,
      metalness: 0,
      envMapIntensity: 0.6,
      glowTexture: true,
      emissive: '#ffffff',
      emissiveIntensity: 0.8,
    },
    wainscot: null,
    sideWainscot: null,
    ceiling: null,
    chairRail: null,
    pilasters: null,
  },
  hide: [
    ...LOUNGE_STYLE_DECOR,
    'lounge-decor',
    'art-deco-wall-sconce',
    'coffered-ceiling',
    'side-wainscot',
    'room-wainscot',
    'room-trim-brass',
    'room-chair-rail',
  ],
  neon: { text: 'NEON NIGHTS', glow: '#ff2fb4', core: '#ff9ae0', intensity: 1.1 },
  props: 'rooftop',
}

export const TABLE_THEMES: Readonly<Record<TableThemeId, TableThemeDef>> = {
  lounge: LOUNGE,
  highroller: HIGH_ROLLER,
  basement: BASEMENT,
  rooftop: ROOFTOP,
}

export function getTableTheme(id: unknown): TableThemeDef {
  return TABLE_THEMES[normalizeTableTheme(id)]
}

/**
 * Every lounge object name some theme can hide, plus the unnamed shell parts
 * themeApply.ts names. The apply step owns the visibility of exactly these.
 */
export const THEME_MANAGED_NAMES: readonly string[] = Array.from(new Set(
  TABLE_THEME_IDS.flatMap(id => TABLE_THEMES[id].hide)
))
