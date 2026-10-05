import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CHILL_HIDDEN_NAMES } from '@/components/three/sceneMode'
import { createStageLights } from '@/components/three/sceneLighting'
import {
  DEFAULT_TABLE_THEME,
  LOUNGE_BACKGROUND,
  TABLE_THEMES,
  TABLE_THEME_IDS,
  TABLE_THEME_STORAGE_KEY,
  THEME_MANAGED_NAMES,
  getTableTheme,
  isTableThemeId,
  normalizeTableTheme,
  readStoredTableTheme,
  writeStoredTableTheme,
  type SurfaceSpec,
  type TableThemeDef,
} from '@/components/three/tableThemes'
import {
  applyTableTheme,
  applyThemeVisibility,
  collectRoomParts,
  disposeTableTheme,
  getThemeBloomScale,
  setThemeQuality,
  type ThemeHost,
} from '@/components/three/themeApply'
import { buildThemeProps, disposeThemeBuild, THEME_GROUP_NAMES } from '@/components/three/themeProps'
import { THEME_TEXTURE_KINDS } from '@/components/three/themeTextures'

const HEX = /^#[0-9a-f]{6}$/i

function surfaces(theme: TableThemeDef): Array<SurfaceSpec | null> {
  return [...Object.values(theme.shell), theme.rail, theme.brass, theme.apron]
}

describe('table theme definitions', () => {
  it('offers the lounge plus at least three more themes, each registered under its own id', () => {
    expect(TABLE_THEME_IDS[0]).toBe('lounge')
    expect(TABLE_THEME_IDS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(TABLE_THEME_IDS).size).toBe(TABLE_THEME_IDS.length)
    for (const id of TABLE_THEME_IDS) expect(TABLE_THEMES[id].id).toBe(id)
  })

  it('defines every field of every theme', () => {
    for (const id of TABLE_THEME_IDS) {
      const theme = TABLE_THEMES[id]
      expect(theme.label.length).toBeGreaterThan(2)
      expect(theme.blurb.length).toBeGreaterThan(10)
      expect(theme.background).toMatch(HEX)
      expect(theme.fog.color).toMatch(HEX)
      expect(theme.fog.density).toBeGreaterThan(0)
      expect(theme.environmentIntensity).toBeGreaterThan(0)
      for (const light of [theme.lights.key, theme.lights.rimLeft, theme.lights.rimRight, theme.lights.bounce, theme.lights.front]) {
        expect(light.color).toMatch(HEX)
        expect(light.intensity).toBeGreaterThan(0)
      }
      expect(theme.lights.fill.sky).toMatch(HEX)
      expect(theme.lights.fill.ground).toMatch(HEX)
      expect(theme.bloom.scale).toBeGreaterThan(0)
      expect(theme.bloom.threshold).toBeGreaterThan(0.5)
      expect(theme.cone.color).toMatch(HEX)
      expect(Array.isArray(theme.hide)).toBe(true)
      for (const spec of surfaces(theme)) {
        if (!spec) continue
        for (const color of [spec.color, spec.emissive]) if (color) expect(color).toMatch(HEX)
        if (spec.texture) expect(THEME_TEXTURE_KINDS).toContain(spec.texture.kind)
      }
      if (theme.felt) {
        for (const color of theme.felt.palette.pool) expect(color).toMatch(HEX)
        expect(theme.felt.palette.label.length).toBeGreaterThan(0)
        expect(theme.felt.palette.line).toMatch(/^\d+, \d+, \d+$/)
      }
      if (theme.neon) {
        expect(theme.neon.text.length).toBeGreaterThan(0)
        expect(theme.neon.glow).toMatch(HEX)
        expect(theme.neon.core).toMatch(HEX)
      }
    }
  })

  it('lets every non-lounge theme carry its own props, neon sign and felt', () => {
    for (const id of TABLE_THEME_IDS) {
      if (id === 'lounge') continue
      const theme = TABLE_THEMES[id]
      expect(theme.props).not.toBeNull()
      expect(theme.neon).not.toBeNull()
      expect(theme.felt).not.toBeNull()
      expect(theme.hide.length).toBeGreaterThan(0)
    }
  })

  it('only hides objects the lounge actually builds, or the unnamed parts themeApply names', () => {
    const known = new Set([
      ...CHILL_HIDDEN_NAMES,
      'lounge-decor', 'emerald-back-bar', 'room-wainscot', 'room-trim-brass', 'room-chair-rail',
      'side-wainscot', 'pendant-haze',
    ])
    for (const name of THEME_MANAGED_NAMES) expect(known.has(name)).toBe(true)
  })
})

describe('the lounge theme is the shipped look', () => {
  it('matches the stage light constants', () => {
    const lights = createStageLights(new THREE.Scene())
    const lounge = TABLE_THEMES.lounge
    const pairs: Array<[THREE.Light, { color: string; intensity: number }]> = [
      [lights.key, lounge.lights.key],
      [lights.rimLeft, lounge.lights.rimLeft],
      [lights.rimRight, lounge.lights.rimRight],
      [lights.bounce, lounge.lights.bounce],
      [lights.front, lounge.lights.front],
    ]
    for (const [light, spec] of pairs) {
      expect(`#${light.color.getHexString()}`).toBe(spec.color.toLowerCase())
      expect(light.intensity).toBe(spec.intensity)
    }
    expect(`#${lights.fill.color.getHexString()}`).toBe(lounge.lights.fill.sky)
    expect(`#${lights.fill.groundColor.getHexString()}`).toBe(lounge.lights.fill.ground)
    expect(lights.fill.intensity).toBe(lounge.lights.fill.intensity)
  })

  it('matches the scene background, fog, environment and bloom constants', () => {
    const lounge = TABLE_THEMES.lounge
    // DesktopPokerRoom3D: background #081413, FogExp2('#081413', 0.012), environmentIntensity 0.3.
    expect(lounge.background).toBe('#081413')
    expect(LOUNGE_BACKGROUND).toBe('#081413')
    expect(lounge.fog).toEqual({ color: '#081413', density: 0.012 })
    expect(lounge.environmentIntensity).toBe(0.3)
    // createPostFx: UnrealBloomPass(..., strength, radius 0.32, threshold 0.97); cone colour #ffe2b0.
    expect(lounge.bloom).toEqual({ scale: 1, threshold: 0.97, radius: 0.32 })
    expect(lounge.cone.color).toBe('#ffe2b0')
  })

  it('changes nothing: no patches, no props, no hidden decor', () => {
    const lounge = TABLE_THEMES.lounge
    expect(lounge.felt).toBeNull()
    expect(lounge.rail).toBeNull()
    expect(lounge.brass).toBeNull()
    expect(lounge.apron).toBeNull()
    expect(lounge.neon).toBeNull()
    expect(lounge.props).toBeNull()
    expect(lounge.hide).toHaveLength(0)
    for (const spec of Object.values(lounge.shell)) expect(spec).toBeNull()
  })

  it('is the default theme', () => {
    expect(DEFAULT_TABLE_THEME).toBe('lounge')
    expect(getTableTheme(undefined).id).toBe('lounge')
  })
})

describe('theme persistence', () => {
  it('accepts only known theme ids and falls back to the lounge for anything else', () => {
    for (const id of TABLE_THEME_IDS) {
      expect(isTableThemeId(id)).toBe(true)
      expect(normalizeTableTheme(id)).toBe(id)
    }
    for (const bad of ['', 'Basement', 'neon', null, undefined, 3, {}, [], '__proto__', 'constructor']) {
      expect(isTableThemeId(bad)).toBe(false)
      expect(normalizeTableTheme(bad)).toBe('lounge')
    }
  })

  it('reads a saved theme and shrugs off bad stored values', () => {
    const store = (value: string | null) => ({ getItem: (key: string) => (key === TABLE_THEME_STORAGE_KEY ? value : null) })
    expect(readStoredTableTheme(store('basement'))).toBe('basement')
    expect(readStoredTableTheme(store('rooftop'))).toBe('rooftop')
    expect(readStoredTableTheme(store('garbage'))).toBe('lounge')
    expect(readStoredTableTheme(store('{"id":"basement"}'))).toBe('lounge')
    expect(readStoredTableTheme(store(null))).toBe('lounge')
    expect(readStoredTableTheme(null)).toBe('lounge')
  })

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readStoredTableTheme(blocked)).toBe('lounge')
    expect(writeStoredTableTheme('highroller', blocked)).toBe(false)
    expect(writeStoredTableTheme('highroller', null)).toBe(false)
  })

  it('round-trips through storage', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
    }
    expect(writeStoredTableTheme('highroller', storage)).toBe(true)
    expect(data.get(TABLE_THEME_STORAGE_KEY)).toBe('highroller')
    expect(readStoredTableTheme(storage)).toBe('highroller')
  })
})

describe('theme props', () => {
  it('builds nothing for the lounge', () => {
    expect(buildThemeProps(null, null)).toBeNull()
  })

  it('builds named groups with decor and fx children for every prop set', () => {
    for (const id of TABLE_THEME_IDS) {
      const theme = TABLE_THEMES[id]
      const build = buildThemeProps(theme.props, theme.neon)
      if (!theme.props) continue
      expect(build).not.toBeNull()
      expect(build!.group.name).toBe(THEME_GROUP_NAMES.root)
      expect(build!.group.getObjectByName(THEME_GROUP_NAMES.decor)).toBe(build!.decor)
      expect(build!.group.getObjectByName(THEME_GROUP_NAMES.fx)).toBe(build!.fx)
      expect(build!.decor.children.length).toBeGreaterThan(0)
      expect(build!.neonMaterials.length).toBe(1)
      expect(build!.neonMaterials[0]!.userData.baseEmissive).toBe(theme.neon!.intensity)
      // Props never cast shadows: the key light's shadow pass must stay cheap.
      build!.group.traverse(object => {
        if ((object as THREE.Mesh).isMesh || (object as THREE.Points).isPoints) expect(object.castShadow).toBe(false)
      })
      disposeThemeBuild(build!)
    }
  })

  it('disposes every geometry, material and texture it owns, but not shared sprite geometry', () => {
    const theme = TABLE_THEMES.highroller
    const build = buildThemeProps(theme.props, theme.neon)!
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const sharedSpriteGeometries = new Set<THREE.BufferGeometry>()
    build.group.traverse(object => {
      const target = object as THREE.Mesh
      if ((object as THREE.Sprite).isSprite) sharedSpriteGeometries.add(target.geometry)
      else if (target.geometry) geometries.add(target.geometry)
      const list = Array.isArray(target.material) ? target.material : target.material ? [target.material] : []
      list.forEach(material => materials.add(material))
    })
    expect(geometries.size).toBeGreaterThan(3)
    expect(materials.size).toBeGreaterThan(3)
    expect(build.textures.length).toBeGreaterThan(0)
    const textures = [...build.textures]
    const spies = [
      ...[...geometries].map(item => vi.spyOn(item, 'dispose')),
      ...[...materials].map(item => vi.spyOn(item, 'dispose')),
      ...textures.map(item => vi.spyOn(item, 'dispose')),
    ]
    const spriteSpies = [...sharedSpriteGeometries].map(item => vi.spyOn(item, 'dispose'))
    const parent = new THREE.Scene()
    parent.add(build.group)

    disposeThemeBuild(build)

    for (const spy of spies) expect(spy).toHaveBeenCalled()
    for (const spy of spriteSpies) expect(spy).not.toHaveBeenCalled()
    expect(build.group.parent).toBeNull()
    expect(parent.children).toHaveLength(0)
    expect(build.textures).toHaveLength(0)
    expect(build.neonMaterials).toHaveLength(0)
    // Twice is harmless.
    expect(() => disposeThemeBuild(build)).not.toThrow()
  })

  it('keeps each theme to a handful of draw-call objects', () => {
    for (const id of TABLE_THEME_IDS) {
      const theme = TABLE_THEMES[id]
      const build = buildThemeProps(theme.props, theme.neon)
      if (!build) continue
      let drawables = 0
      build.group.traverse(object => {
        const item = object as THREE.Mesh
        if (item.isMesh || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) {
          drawables += Array.isArray(item.material) ? item.material.length : 1
        }
      })
      // The lounge theme budget is roughly 40 extra draws; props are merged to stay well inside it.
      expect(drawables).toBeLessThanOrEqual(30)
      disposeThemeBuild(build)
    }
  })
})

/** A minimal room: the lounge parts the theme layer touches, built by name like createRoom does. */
function makeHost() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(LOUNGE_BACKGROUND)
  scene.fog = new THREE.FogExp2(LOUNGE_BACKGROUND, 0.012)
  scene.environmentIntensity = 0.3
  const lights = createStageLights(scene)
  const physical = () => new THREE.MeshPhysicalMaterial({ color: '#808080', roughness: 0.8, bumpScale: 0.9 })
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name = '') => {
    const item = new THREE.Mesh(geometry, material)
    item.name = name
    scene.add(item)
    return item
  }
  mesh(new THREE.CircleGeometry(20, 8), physical(), 'lounge-carpet')
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  mesh(new THREE.BoxGeometry(32, 14, 0.2), wallMaterial, 'visible-back-wall')
  mesh(new THREE.BoxGeometry(0.24, 14, 22), wallMaterial.clone())
  mesh(new THREE.BoxGeometry(32, 2.9, 0.3), new THREE.MeshStandardMaterial())
  mesh(new THREE.BoxGeometry(32, 0.08, 0.34), new THREE.MeshStandardMaterial())
  const dressing = new THREE.Group()
  dressing.name = 'room-dressing'
  scene.add(dressing)
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  dressing.add(trim)
  for (const name of ['wall-pilasters', 'coffered-ceiling', 'side-wainscot', 'gallery-prints']) {
    const item = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#9a7b66' }))
    item.name = name
    dressing.add(item)
  }
  for (const name of ['lounge-decor', 'framed-poster', 'art-deco-wall-sconce', 'pendant-lamp', 'neon-sign', 'emerald-back-bar']) {
    const group = new THREE.Group()
    group.name = name
    scene.add(group)
  }
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1, 2, 3), new THREE.MeshBasicMaterial())
  cone.name = 'light-cone'
  const haze = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color('#ffe2b0') } } })
  cone.userData.hazes = [haze]
  const pendantHaze = new THREE.Mesh(new THREE.CylinderGeometry(1, 2, 3), new THREE.MeshBasicMaterial())
  pendantHaze.name = 'pendant-haze'
  cone.add(pendantHaze)
  scene.add(cone)
  const table = new THREE.Group()
  table.name = 'stylized-poker-table'
  scene.add(table)
  const felt = new THREE.MeshStandardMaterial({ color: '#b4b4b4' })
  for (const [name, material] of [
    ['printed-felt', felt],
    ['padded-leather-rail', new THREE.MeshPhysicalMaterial({ color: '#ffffff' })],
    ['brass-felt-inlay', new THREE.MeshStandardMaterial({ color: '#c99a4c' })],
    ['wood-apron', new THREE.MeshPhysicalMaterial({ color: '#ffffff' })],
  ] as const) {
    const item = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    item.name = name
    table.add(item)
  }
  const compile = vi.fn()
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 4 },
    compile,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    info: { programs: [] },
  } as unknown as THREE.WebGLRenderer
  const host: ThemeHost = {
    scene,
    renderer,
    camera: new THREE.PerspectiveCamera(),
    lights,
    feltMaterial: felt,
    neonMaterials: [],
    postFx: null,
    effects: { cone: { mesh: cone, material: haze } },
    disposed: false,
    theme: null,
  }
  return { host, scene, felt, compile }
}

function visibilityOf(scene: THREE.Scene, name: string) {
  return scene.getObjectByName(name)!.visible
}

describe('applying a theme in place', () => {
  it('does nothing at all for the lounge when no other theme was ever applied', () => {
    const { host, scene, compile } = makeHost()
    const before = scene.children.length
    expect(applyTableTheme(host, 'lounge', { chill: false })).toBeNull()
    expect(host.theme).toBeNull()
    expect(scene.children).toHaveLength(before)
    expect(compile).not.toHaveBeenCalled()
  })

  it('swaps in a theme, then restores the lounge exactly (materials, lights, fog, visibility)', () => {
    const { host, scene, felt } = makeHost()
    const keyColor = host.lights.key.color.getHexString()
    const feltColor = felt.color.getHexString()
    const floor = collectRoomParts(scene).floor!.material as THREE.MeshPhysicalMaterial
    const floorColor = floor.color.getHexString()

    applyTableTheme(host, 'basement', { chill: false })
    expect(host.theme?.applied).toBe('basement')
    expect(host.lights.key.color.getHexString()).not.toBe(keyColor)
    expect(host.lights.key.intensity).toBe(TABLE_THEMES.basement.lights.key.intensity)
    expect(felt.map).not.toBeNull()
    expect(floor.map).not.toBeNull()
    expect(floor.bumpMap).toBeNull()
    expect(visibilityOf(scene, 'pendant-lamp')).toBe(false)
    expect(scene.getObjectByName(THEME_GROUP_NAMES.root)).toBeDefined()
    expect(host.neonMaterials).toHaveLength(1)
    expect((scene.background as THREE.Color).getHexString()).toBe('0b0705')
    expect(getThemeBloomScale(host)).toBe(TABLE_THEMES.basement.bloom.scale)

    applyTableTheme(host, 'lounge', { chill: false })
    expect(host.theme?.applied).toBe('lounge')
    expect(host.lights.key.color.getHexString()).toBe(keyColor)
    expect(host.lights.key.intensity).toBe(88)
    expect(host.lights.rimLeft.intensity).toBe(74)
    expect(felt.color.getHexString()).toBe(feltColor)
    expect(floor.color.getHexString()).toBe(floorColor)
    expect(floor.map).toBeNull()
    expect(floor.bumpScale).toBe(0.9)
    expect(visibilityOf(scene, 'pendant-lamp')).toBe(true)
    expect(visibilityOf(scene, 'neon-sign')).toBe(true)
    expect(scene.getObjectByName(THEME_GROUP_NAMES.root)).toBeUndefined()
    expect(host.neonMaterials).toHaveLength(0)
    expect((scene.background as THREE.Color).getHexString()).toBe('081413')
    expect((scene.fog as THREE.FogExp2).density).toBe(0.012)
    expect(getThemeBloomScale(host)).toBe(1)
    const hazeColor = (host.effects.cone.mesh.userData.hazes as THREE.ShaderMaterial[])[0]!.uniforms.color!.value as THREE.Color
    expect(hazeColor.getHexString()).toBe('ffe2b0')
  })

  it('disposes the old prop group and its textures when switching theme, with no leaked groups', () => {
    const { host, scene } = makeHost()
    applyTableTheme(host, 'highroller', { chill: false })
    const first = host.theme!.build!
    const firstTextures = [...first.textures, ...host.theme!.patchTextures]
    expect(firstTextures.length).toBeGreaterThan(2)
    const spies = firstTextures.map(texture => vi.spyOn(texture, 'dispose'))

    applyTableTheme(host, 'rooftop', { chill: false })

    for (const spy of spies) expect(spy).toHaveBeenCalled()
    expect(first.group.parent).toBeNull()
    expect(scene.children.filter(child => child.name === THEME_GROUP_NAMES.root)).toHaveLength(1)
    expect(host.neonMaterials).toHaveLength(1)
    expect(host.theme!.build).not.toBe(first)
  })

  it('is cheap and idempotent when the theme is unchanged', () => {
    const { host, compile } = makeHost()
    applyTableTheme(host, 'rooftop', { chill: false })
    const build = host.theme!.build
    const compiles = compile.mock.calls.length
    applyTableTheme(host, 'rooftop', { chill: false })
    expect(host.theme!.build).toBe(build)
    expect(compile.mock.calls.length).toBe(compiles)
  })

  it('shows the lounge decor again when the theme goes back to the lounge', () => {
    const { host, scene } = makeHost()
    applyTableTheme(host, 'rooftop', { chill: false })
    for (const name of TABLE_THEMES.rooftop.hide) {
      if (scene.getObjectByName(name)) expect(visibilityOf(scene, name)).toBe(false)
    }
    applyTableTheme(host, 'lounge', { chill: false })
    for (const name of THEME_MANAGED_NAMES) {
      if (scene.getObjectByName(name)) expect(visibilityOf(scene, name)).toBe(true)
    }
  })

  it('does not apply after the scene was disposed', () => {
    const { host } = makeHost()
    host.disposed = true
    expect(applyTableTheme(host, 'basement', { chill: false })).toBeNull()
    expect(host.theme).toBeNull()
  })

  it('disposeTableTheme restores the lounge and frees the layer', () => {
    const { host, scene, felt } = makeHost()
    const feltColor = felt.color.getHexString()
    applyTableTheme(host, 'highroller', { chill: false })
    disposeTableTheme(host)
    expect(host.theme).toBeNull()
    expect(felt.map).toBeNull()
    expect(felt.color.getHexString()).toBe(feltColor)
    expect(scene.getObjectByName(THEME_GROUP_NAMES.root)).toBeUndefined()
  })

  it('parks the temporary-effect layer around the restyle when it offers a hook', () => {
    const { host } = makeHost()
    const retheme = vi.fn((apply: () => void) => apply())
    host.retheme = retheme
    applyTableTheme(host, 'basement', { chill: false })
    expect(retheme).toHaveBeenCalledTimes(1)
    expect(host.theme?.applied).toBe('basement')
  })
})

describe('the chill room and themes together', () => {
  it('keeps chill decor hidden under a theme and hides theme decor and glows too', () => {
    const { host, scene } = makeHost()
    applyTableTheme(host, 'highroller', { chill: true })
    const build = host.theme!.build!
    expect(build.decor.visible).toBe(false)
    expect(build.fx.visible).toBe(false)
    // Lounge names in both lists stay hidden.
    expect(visibilityOf(scene, 'framed-poster')).toBe(false)
    // High Roller keeps the sconces, but the chill room hides them.
    expect(visibilityOf(scene, 'art-deco-wall-sconce')).toBe(false)

    applyTableTheme(host, 'highroller', { chill: false })
    expect(build.decor.visible).toBe(true)
    expect(build.fx.visible).toBe(true)
    expect(visibilityOf(scene, 'art-deco-wall-sconce')).toBe(true)
    // The theme still hides what it replaced.
    expect(visibilityOf(scene, 'framed-poster')).toBe(false)
  })

  it('a name is visible only when neither the theme nor chill hides it', () => {
    const { scene } = makeHost()
    // Hidden by the theme only (the back bar is not in the chill list).
    applyThemeVisibility(scene, TABLE_THEMES.basement, false)
    expect(visibilityOf(scene, 'emerald-back-bar')).toBe(false)
    applyThemeVisibility(scene, TABLE_THEMES.lounge, true)
    expect(visibilityOf(scene, 'emerald-back-bar')).toBe(true)
    // Hidden by chill only.
    expect(visibilityOf(scene, 'lounge-decor')).toBe(false)
    applyThemeVisibility(scene, TABLE_THEMES.lounge, false)
    expect(visibilityOf(scene, 'lounge-decor')).toBe(true)
    // Hidden by both: still hidden until neither wants it hidden.
    applyThemeVisibility(scene, TABLE_THEMES.basement, true)
    expect(visibilityOf(scene, 'framed-poster')).toBe(false)
    applyThemeVisibility(scene, TABLE_THEMES.basement, false)
    expect(visibilityOf(scene, 'framed-poster')).toBe(false)
    applyThemeVisibility(scene, TABLE_THEMES.lounge, false)
    expect(visibilityOf(scene, 'framed-poster')).toBe(true)
  })

  it('lower render-quality tiers drop the glow group only', () => {
    const { host } = makeHost()
    applyTableTheme(host, 'basement', { chill: false })
    const build = host.theme!.build!
    setThemeQuality(host, 1)
    expect(build.fx.visible).toBe(false)
    expect(build.decor.visible).toBe(true)
    setThemeQuality(host, 0)
    expect(build.fx.visible).toBe(true)
  })
})
