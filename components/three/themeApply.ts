import * as THREE from 'three'
import { CHILL_HIDDEN_NAMES } from './sceneMode'
import type { LightCone } from './sceneEffects'
import type { PostFx, StageLights } from './sceneLighting'
import { FELT_LAYOUT } from './tableArt'
import {
  DEFAULT_TABLE_THEME,
  TABLE_THEMES,
  THEME_MANAGED_NAMES,
  type SurfaceSpec,
  type TableThemeDef,
  type TableThemeId,
} from './tableThemes'
import { buildThemeProps, disposeThemeBuild, type ThemeBuild } from './themeProps'
import { createSurfaceTexture, createThemedFeltTexture } from './themeTextures'

/**
 * Applies a table theme to a live scene, in place.
 *
 * A theme switch never rebuilds the room, the table, the seats, the chips or
 * the cards. It (1) restores every material it patched earlier, (2) patches the
 * shell and table materials for the new theme, (3) retunes the existing stage
 * lights, background, fog and bloom (no light is added or removed, so no shader
 * is invalidated), (4) disposes the old prop group and builds the new one into
 * its own named Group, and (5) shows or hides lounge decor by name. The chill
 * room keeps working: both layers hide independently and a name is shown only
 * when neither wants it hidden.
 */

/** What the theme layer needs from the room runtime (SceneRuntime satisfies it). */
export interface ThemeHost {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.Camera
  lights: StageLights
  feltMaterial: THREE.MeshStandardMaterial
  neonMaterials: THREE.MeshStandardMaterial[]
  postFx: PostFx | null
  effects: { cone: LightCone }
  disposed: boolean
  /** Owned by this module: null until a non-lounge theme is first applied. */
  theme: ThemeState | null
  /**
   * Runs a restyle with temporary effects (the pill trip) parked and their
   * saved baselines re-read afterwards, so a switch is never undone by one.
   */
  retheme?: (apply: () => void) => void
}

/** Properties the theme layer may change on an existing material. */
const PATCH_KEYS = [
  'color', 'roughness', 'metalness', 'envMapIntensity', 'emissive', 'emissiveIntensity',
  'map', 'bumpMap', 'bumpScale', 'emissiveMap', 'clearcoat', 'clearcoatRoughness',
  'sheen', 'sheenRoughness',
] as const

type PatchKey = (typeof PATCH_KEYS)[number]
type Baseline = Partial<Record<PatchKey, unknown>>

export interface ThemeState {
  /** Theme currently applied, or null before the first apply. */
  applied: TableThemeId | null
  /** Bloom strength multiplier the render loop reads each frame. */
  bloomScale: number
  build: ThemeBuild | null
  /** Textures painted for material patches (felt, floor, walls). */
  patchTextures: THREE.Texture[]
  /** Meshes whose materials this theme patched (compiled up front). */
  patchedMeshes: THREE.Mesh[]
  /** Lounge values of every material this layer ever patched. */
  baselines: Map<THREE.Material, Baseline>
  chill: boolean
  /** Lower render-quality tiers hide the additive glow group. */
  fxLite: boolean
}

export interface ThemeApplyOptions {
  /** The chill room is on: decor and glows hide, the shell stays. */
  chill: boolean
}

const chillNames = new Set(CHILL_HIDDEN_NAMES)

// ---------------------------------------------------------------------------
// Finding the room's parts

interface RoomParts {
  floor: THREE.Mesh | null
  backWall: THREE.Mesh | null
  sideWalls: THREE.Mesh[]
  wainscot: THREE.Mesh | null
  chairRail: THREE.Mesh | null
  trim: THREE.Mesh | null
  byName: Map<string, THREE.Mesh>
  rail: THREE.Mesh | null
  inlay: THREE.Mesh | null
  apron: THREE.Mesh | null
}

function boxParams(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as THREE.BoxGeometry
  return geometry?.type === 'BoxGeometry' ? geometry.parameters : null
}

function near(a: number | undefined, b: number) {
  return a !== undefined && Math.abs(a - b) < 0.011
}

/**
 * Finds the shell and table meshes and names the lounge's unnamed ones
 * ('room-wainscot' and so on) so visibility can be managed by name. Soft: a
 * part that cannot be found is simply left alone.
 */
export function collectRoomParts(scene: THREE.Object3D): RoomParts {
  const parts: RoomParts = {
    floor: null, backWall: null, sideWalls: [], wainscot: null, chairRail: null, trim: null,
    byName: new Map(), rail: null, inlay: null, apron: null,
  }
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    switch (mesh.name) {
      case 'lounge-carpet': parts.floor = mesh; return
      case 'visible-back-wall': parts.backWall = mesh; return
      case 'padded-leather-rail': parts.rail = mesh; return
      case 'brass-felt-inlay': parts.inlay = mesh; return
      case 'wood-apron': parts.apron = mesh; return
      case 'room-side-wall': parts.sideWalls.push(mesh); return
      case 'room-wainscot': parts.wainscot = mesh; return
      case 'room-chair-rail': parts.chairRail = mesh; return
      case 'room-trim-brass': parts.trim = mesh; return
      case '': break
      default:
        parts.byName.set(mesh.name, mesh)
        return
    }
    const box = boxParams(mesh)
    if (mesh.parent === scene && box) {
      if (near(box.width, 0.24) && near(box.height, 14) && near(box.depth, 22)) {
        mesh.name = 'room-side-wall'
        parts.sideWalls.push(mesh)
      } else if (near(box.width, 32) && near(box.height, 2.9) && near(box.depth, 0.3)) {
        mesh.name = 'room-wainscot'
        parts.wainscot = mesh
      } else if (near(box.width, 32) && near(box.height, 0.08) && near(box.depth, 0.34)) {
        mesh.name = 'room-chair-rail'
        parts.chairRail = mesh
      }
    } else if (mesh.parent?.name === 'room-dressing') {
      mesh.name = 'room-trim-brass'
      parts.trim = mesh
    }
  })
  return parts
}

// ---------------------------------------------------------------------------
// Material patching

function singleMaterial(mesh: THREE.Mesh | null | undefined): THREE.MeshStandardMaterial | null {
  if (!mesh) return null
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  return (material as THREE.MeshStandardMaterial | undefined)?.isMeshStandardMaterial ? (material as THREE.MeshStandardMaterial) : null
}

function snapshot(material: THREE.MeshStandardMaterial): Baseline {
  const baseline: Baseline = {}
  const source = material as unknown as Record<string, unknown>
  for (const key of PATCH_KEYS) {
    if (!(key in source)) continue
    const value = source[key]
    baseline[key] = value instanceof THREE.Color ? value.clone() : value
  }
  return baseline
}

function restore(material: THREE.Material, baseline: Baseline) {
  const target = material as unknown as Record<string, unknown>
  for (const key of PATCH_KEYS) {
    if (!(key in baseline)) continue
    const value = baseline[key]
    const current = target[key]
    if (value instanceof THREE.Color && current instanceof THREE.Color) current.copy(value)
    else target[key] = value
  }
  material.needsUpdate = true
}

function baselineOf(state: ThemeState, material: THREE.MeshStandardMaterial) {
  let baseline = state.baselines.get(material)
  if (!baseline) {
    baseline = snapshot(material)
    state.baselines.set(material, baseline)
  }
  return baseline
}

function setIfPresent(material: THREE.Material, key: PatchKey, value: unknown) {
  if (key in material) (material as unknown as Record<string, unknown>)[key] = value
}

function patchSurface(
  state: ThemeState,
  mesh: THREE.Mesh | null | undefined,
  spec: SurfaceSpec | null,
  anisotropy: number
) {
  const material = singleMaterial(mesh)
  if (!mesh || !material) return
  baselineOf(state, material)
  if (!spec) return
  state.patchedMeshes.push(mesh)
  if (spec.texture) {
    const texture = createSurfaceTexture(state.patchTextures, spec.texture.kind, spec.texture.repeat, anisotropy)
    material.map = texture
  } else if (spec.plain) {
    material.map = null
  }
  if (spec.glowTexture) material.emissiveMap = material.map
  if (spec.flat) {
    material.bumpMap = null
    setIfPresent(material, 'bumpScale', 0)
    setIfPresent(material, 'sheen', 0)
  }
  if (spec.color !== undefined) material.color.set(spec.color)
  if (spec.roughness !== undefined) material.roughness = spec.roughness
  if (spec.metalness !== undefined) material.metalness = spec.metalness
  if (spec.envMapIntensity !== undefined) material.envMapIntensity = spec.envMapIntensity
  if (spec.emissive !== undefined) material.emissive.set(spec.emissive)
  if (spec.emissiveIntensity !== undefined) material.emissiveIntensity = spec.emissiveIntensity
  if (spec.clearcoat !== undefined) setIfPresent(material, 'clearcoat', spec.clearcoat)
  if (spec.clearcoatRoughness !== undefined) setIfPresent(material, 'clearcoatRoughness', spec.clearcoatRoughness)
  material.needsUpdate = true
}

function patchFelt(state: ThemeState, host: ThemeHost, def: TableThemeDef, anisotropy: number, feltMesh: THREE.Mesh | null) {
  const material = host.feltMaterial
  baselineOf(state, material)
  const felt = def.felt
  if (!felt) return
  if (feltMesh) state.patchedMeshes.push(feltMesh)
  const texture = createThemedFeltTexture(state.patchTextures, FELT_LAYOUT, felt.palette)
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  material.map = texture
  if (felt.tint) material.color.set(felt.tint)
  if (felt.roughness !== undefined) material.roughness = felt.roughness
  if (felt.envMapIntensity !== undefined) material.envMapIntensity = felt.envMapIntensity
  if (felt.bumpScale !== undefined) material.bumpScale = felt.bumpScale
  material.needsUpdate = true
}

/** Puts every patched material back to its lounge values, then frees the textures made for the old theme. */
function restoreMaterials(state: ThemeState) {
  for (const [material, baseline] of state.baselines) restore(material, baseline)
  state.patchTextures.forEach(texture => texture.dispose())
  state.patchTextures.length = 0
}

function applyShellAndTable(state: ThemeState, host: ThemeHost, def: TableThemeDef, parts: RoomParts) {
  const anisotropy = Math.min(16, host.renderer.capabilities.getMaxAnisotropy())
  const { shell } = def
  state.patchedMeshes.length = 0
  patchSurface(state, parts.floor, shell.floor, anisotropy)
  patchSurface(state, parts.backWall, shell.backWall, anisotropy)
  // The side walls may share a material; patching it twice is harmless (the second pass re-applies the same spec).
  for (const wall of parts.sideWalls) patchSurface(state, wall, shell.sideWalls, anisotropy)
  patchSurface(state, parts.wainscot, shell.wainscot, anisotropy)
  patchSurface(state, parts.byName.get('side-wainscot'), shell.sideWainscot, anisotropy)
  patchSurface(state, parts.byName.get('coffered-ceiling'), shell.ceiling, anisotropy)
  patchSurface(state, parts.byName.get('wall-pilasters'), shell.pilasters, anisotropy)
  patchSurface(state, parts.chairRail, shell.chairRail, anisotropy)
  patchSurface(state, parts.rail, def.rail, anisotropy)
  patchSurface(state, parts.inlay, def.brass, anisotropy)
  patchSurface(state, parts.apron, def.apron, anisotropy)
  patchFelt(state, host, def, anisotropy, parts.byName.get('printed-felt') ?? null)
}

// ---------------------------------------------------------------------------
// Lights, background, bloom

function applyAtmosphere(state: ThemeState, host: ThemeHost, def: TableThemeDef) {
  const { lights, scene } = host
  const set = (light: THREE.SpotLight | THREE.PointLight, spec: { color: string; intensity: number }) => {
    light.color.set(spec.color)
    light.intensity = spec.intensity
  }
  set(lights.key, def.lights.key)
  set(lights.rimLeft, def.lights.rimLeft)
  set(lights.rimRight, def.lights.rimRight)
  set(lights.bounce, def.lights.bounce)
  set(lights.front, def.lights.front)
  lights.fill.color.set(def.lights.fill.sky)
  lights.fill.groundColor.set(def.lights.fill.ground)
  lights.fill.intensity = def.lights.fill.intensity
  if (scene.background instanceof THREE.Color) scene.background.set(def.background)
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.set(def.fog.color)
    scene.fog.density = def.fog.density
  }
  scene.environmentIntensity = def.environmentIntensity
  state.bloomScale = def.bloom.scale
  if (host.postFx) {
    host.postFx.bloom.threshold = def.bloom.threshold
    host.postFx.bloom.radius = def.bloom.radius
  }
  const hazes = host.effects.cone.mesh.userData.hazes as THREE.ShaderMaterial[] | undefined
  for (const haze of hazes ?? []) (haze.uniforms.color?.value as THREE.Color | undefined)?.set(def.cone.color)
}

// ---------------------------------------------------------------------------
// Visibility

/**
 * Shows or hides lounge decor by name for this theme and the chill room
 * together. A name is visible only when neither layer hides it.
 */
export function applyThemeVisibility(scene: THREE.Object3D, def: TableThemeDef, chill: boolean) {
  const hiddenByTheme = new Set(def.hide)
  const managed = new Set(THEME_MANAGED_NAMES)
  scene.traverse(object => {
    if (!managed.has(object.name)) return
    object.visible = !hiddenByTheme.has(object.name) && !(chill && chillNames.has(object.name))
  })
}

function applyBuildVisibility(state: ThemeState) {
  const build = state.build
  if (!build) return
  build.decor.visible = !state.chill
  build.fx.visible = !state.chill && !state.fxLite
}

// ---------------------------------------------------------------------------
// Compile and freeze

function freezeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  root.traverse(object => { object.matrixAutoUpdate = false })
  root.matrixWorldAutoUpdate = false
}

/**
 * Links the shaders the switch introduced (a theme switch is a user action, so
 * a short pause here beats a hitch when the first card lands). Only the new
 * props and the patched materials are visited, through throwaway proxy meshes,
 * not the whole scene. With post effects on it compiles the composer's target
 * variant (the one that draws); the direct-to-canvas variant is only needed at
 * the lowest quality tier and compiles on demand there.
 */
function compileChanges(host: ThemeHost, state: ThemeState) {
  const { renderer, scene, camera, postFx } = host
  const previous = renderer.getRenderTarget()
  const proxies = new THREE.Group()
  for (const mesh of state.patchedMeshes) {
    const proxy = new THREE.Mesh(mesh.geometry, mesh.material)
    proxy.castShadow = mesh.castShadow
    proxy.receiveShadow = mesh.receiveShadow
    proxies.add(proxy)
  }
  try {
    if (postFx) renderer.setRenderTarget(postFx.composer.readBuffer)
    if (proxies.children.length > 0) renderer.compile(proxies, camera, scene)
    if (state.build) renderer.compile(state.build.group, camera, scene)
    for (const program of renderer.info.programs ?? []) program.getUniforms()
  } catch (error) {
    console.warn('Table theme shaders could not be precompiled; they compile on first draw.', error)
  } finally {
    renderer.setRenderTarget(previous)
  }
}

// ---------------------------------------------------------------------------
// Public API

function createState(): ThemeState {
  return {
    applied: null,
    bloomScale: 1,
    build: null,
    patchTextures: [],
    patchedMeshes: [],
    baselines: new Map(),
    chill: false,
    fxLite: false,
  }
}

function removeBuild(host: ThemeHost, state: ThemeState) {
  const build = state.build
  if (!build) return
  for (const material of build.neonMaterials) {
    const index = host.neonMaterials.indexOf(material)
    if (index >= 0) host.neonMaterials.splice(index, 1)
  }
  disposeThemeBuild(build)
  state.build = null
}

/**
 * Applies `id` to the room. Cheap and idempotent when the theme is unchanged
 * (only the chill room's visibility is refreshed). The lounge, when nothing
 * else was ever applied, touches nothing at all.
 */
export function applyTableTheme(host: ThemeHost, id: TableThemeId, options: ThemeApplyOptions): ThemeState | null {
  if (host.disposed) return host.theme
  if (!host.theme && id === DEFAULT_TABLE_THEME) return null
  const def = TABLE_THEMES[id]
  const state = host.theme ?? createState()
  host.theme = state

  if (state.applied === id) {
    state.chill = options.chill
    applyThemeVisibility(host.scene, def, options.chill)
    applyBuildVisibility(state)
    return state
  }

  const run = () => {
    const t0 = performance.now()
    removeBuild(host, state)
    restoreMaterials(state)
    const parts = collectRoomParts(host.scene)
    applyShellAndTable(state, host, def, parts)
    applyAtmosphere(state, host, def)
    const t1 = performance.now()

    const build = buildThemeProps(def.props, def.neon)
    const t2 = performance.now()
    state.applied = id
    state.chill = options.chill
    if (build) {
      state.build = build
      host.scene.add(build.group)
      freezeStatic(build.group)
      host.neonMaterials.push(...build.neonMaterials)
    }
    // Compile with everything visible (as the load-time precompile does), then apply visibility.
    const t3 = performance.now()
    compileChanges(host, state)
    applyThemeVisibility(host.scene, def, options.chill)
    applyBuildVisibility(state)
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[theme ${id}] patch ${(t1 - t0).toFixed(0)}ms, props ${(t2 - t1).toFixed(0)}ms, freeze ${(t3 - t2).toFixed(0)}ms, compile ${(performance.now() - t3).toFixed(0)}ms`)
    }
  }
  if (host.retheme) host.retheme(run)
  else run()
  return state
}

/** Lower render tiers drop the additive glow group (cones, glints, pools). */
export function setThemeQuality(host: Pick<ThemeHost, 'theme'>, quality: number) {
  const state = host.theme
  if (!state) return
  const lite = quality >= 1
  if (state.fxLite === lite) return
  state.fxLite = lite
  applyBuildVisibility(state)
}

/** Current bloom multiplier (1 for the lounge). */
export function getThemeBloomScale(host: Pick<ThemeHost, 'theme'>) {
  return host.theme?.bloomScale ?? 1
}

/** Restores the lounge and frees everything the theme layer made. Used on teardown. */
export function disposeTableTheme(host: ThemeHost) {
  const state = host.theme
  if (!state) return
  removeBuild(host, state)
  restoreMaterials(state)
  state.baselines.clear()
  host.theme = null
}
