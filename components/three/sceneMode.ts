import * as THREE from 'three'

/**
 * Room style: the full lounge, or a chill room with far less going on.
 * Chill hides decoration and ambient effects only; the table, chairs, seats,
 * cards, chips and players are untouched so nothing about play changes.
 */
export type SceneMode = 'classic' | 'chill'

export const SCENE_MODES: readonly SceneMode[] = ['classic', 'chill']

export function normalizeSceneMode(value: unknown): SceneMode {
  return value === 'chill' ? 'chill' : 'classic'
}

/** Named room objects the chill room hides. Everything else stays as it is. */
export const CHILL_HIDDEN_NAMES: readonly string[] = [
  'lounge-decor',
  'framed-poster',
  'art-deco-wall-sconce',
  'pendant-lamp',
  'neon-sign',
  'back-bar-bottles',
  'back-bar-mirror',
  'back-bar-shelves',
  'wall-pilasters',
  'coffered-ceiling',
  'gallery-prints',
  'lamp-halos-and-washes',
  'carpet-light-pool',
  'light-cone',
  'dust-motes',
  'pendant-haze',
]

const hiddenNames = new Set(CHILL_HIDDEN_NAMES)

/** Bloom and showy effects scale by this in chill (1 = classic). */
export const CHILL_BLOOM_SCALE = 0.35

/**
 * Show or hide the clutter by name. Safe to call repeatedly; the scene is
 * never rebuilt. Returns how many objects were toggled.
 */
export function applySceneMode(scene: THREE.Object3D, mode: SceneMode): number {
  const visible = mode !== 'chill'
  let toggled = 0
  scene.traverse(object => {
    if (!hiddenNames.has(object.name)) return
    if (object.visible !== visible) toggled += 1
    object.visible = visible
  })
  return toggled
}
