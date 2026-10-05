import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { NeonSpec, ThemePropsId } from './tableThemes'
import {
  BASEMENT_ATLAS,
  BASEMENT_ATLAS_SIZE,
  createBasementAtlasTexture,
  createRadialGlowTexture,
  createSparkleTexture,
  createSurfaceTexture,
  createThemedNeonTexture,
  type AtlasRect,
  type TextureSink,
} from './themeTextures'

/**
 * Theme-specific props, built into named THREE.Groups so a theme switch can
 * dispose the old set and build the new one without a reload.
 *
 *   theme-props          the root added to the scene
 *     theme-decor        set dressing; hidden by the chill room
 *     theme-fx           additive glows, cones and twinkles; hidden by chill
 *                        and by the lower render-quality tiers
 *
 * Everything is merged by material (vertex colours carry the per-object
 * colour), so each theme costs a handful of draw calls. Props never cast
 * shadows and never move: their matrices are baked by themeApply.ts, and any
 * animation (twinkle, flicker) lives in shaders driven by themeClock().
 */

export interface ThemeBuild {
  group: THREE.Group
  decor: THREE.Group
  fx: THREE.Group
  /** Neon sign materials the room's flicker loop drives (see runtime.neonMaterials). */
  neonMaterials: THREE.MeshStandardMaterial[]
  /** Textures this build owns (disposed with it). */
  textures: THREE.Texture[]
}

export const THEME_GROUP_NAMES = {
  root: 'theme-props',
  decor: 'theme-decor',
  fx: 'theme-fx',
} as const

// ---------------------------------------------------------------------------
// Clock (reduced motion aware)

let motionQuery: MediaQueryList | null | undefined

function reducedMotion() {
  if (motionQuery === undefined) {
    motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  }
  return motionQuery?.matches ?? false
}

/** Seconds for shader animation; frozen at 0 when the user prefers reduced motion. */
export function themeClock() {
  if (reducedMotion()) return 0
  return (performance.now() / 1000) % 1000
}

// ---------------------------------------------------------------------------
// Geometry helpers

type ColoredPart = readonly [THREE.BufferGeometry, THREE.ColorRepresentation]

/** Merges parts into one geometry carrying a per-part vertex colour. */
export function mergeColored(parts: readonly ColoredPart[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null
  const color = new THREE.Color()
  const prepared = parts.map(([source, value]) => {
    const geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) source.dispose()
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name)
    }
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
    }
    color.set(value)
    const count = geometry.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geometry
  })
  const merged = mergeGeometries(prepared, false)
  prepared.forEach(geometry => geometry.dispose())
  return merged
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

function cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, segments = 14) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y, z)
}

function plain(geometry: THREE.BufferGeometry | null, material: THREE.Material, parent: THREE.Object3D, name: string) {
  if (!geometry) {
    material.dispose()
    return null
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = false
  mesh.receiveShadow = false
  parent.add(mesh)
  return mesh
}

function vertexColorMaterial(options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, ...options })
}

/** Emissive tubes and strips: unlit, over-bright so bloom picks them up. */
function neonTubeMaterial(color: string, gain: number) {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(gain), toneMapped: false })
  material.fog = false
  return material
}

/** Remaps a plane's UVs onto a rect of a square atlas (rect y runs down from the top). */
function atlasUv(geometry: THREE.BufferGeometry, rect: AtlasRect, size = BASEMENT_ATLAS_SIZE) {
  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      (rect.x + uv.getX(index) * rect.w) / size,
      1 - (rect.y + (1 - uv.getY(index)) * rect.h) / size
    )
  }
  uv.needsUpdate = true
  return geometry
}

function circleAtlasUv(geometry: THREE.CircleGeometry, rect: AtlasRect, size = BASEMENT_ATLAS_SIZE) {
  const radius = geometry.parameters.radius
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index += 1) {
    const u = position.getX(index) / (radius * 2) + 0.5
    const v = position.getY(index) / (radius * 2) + 0.5
    uv.setXY(index, (rect.x + u * rect.w) / size, 1 - (rect.y + (1 - v) * rect.h) / size)
  }
  uv.needsUpdate = true
  return geometry
}

/** Seeded points for twinkles; deterministic so the set looks the same each switch. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const TWINKLE_VERTEX = /* glsl */ `
  attribute float phase;
  uniform float time;
  uniform float size;
  uniform float speed;
  uniform float base;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = pow(max(0.0, sin(time * speed + phase * 6.2831)), 6.0);
    vAlpha = base + (1.0 - base) * tw;
    gl_PointSize = clamp(size * (0.55 + 0.9 * tw) / max(0.5, -mv.z), 2.0, 46.0);
  }
`

const TWINKLE_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    float a = texture2D(map, gl_PointCoord).a;
    gl_FragColor = vec4(color * a * vAlpha, 1.0);
  }
`

/** Additive twinkling sprites in one draw call. */
function createTwinklePoints(
  positions: Float32Array,
  options: { map: THREE.Texture; color: string; size: number; speed: number; base: number; seed: number },
  name: string
) {
  const count = positions.length / 3
  const random = seeded(options.seed)
  const phases = new Float32Array(count)
  for (let index = 0; index < count; index += 1) phases[index] = random()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
  const uniforms = {
    time: { value: 0 },
    size: { value: options.size },
    speed: { value: options.speed },
    base: { value: options.base },
    map: { value: options.map },
    color: { value: new THREE.Color(options.color) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TWINKLE_VERTEX,
    fragmentShader: TWINKLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.name = name
  points.frustumCulled = false
  points.renderOrder = 6
  points.onBeforeRender = () => { uniforms.time.value = themeClock() }
  return points
}

const CONE_VERTEX = /* glsl */ `
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vHeight = position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const CONE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float intensity;
  uniform float height;
  uniform float time;
  uniform float flicker;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float along = clamp(-vHeight / height, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.65, abs(dot(vNormal, vView)));
    float fade = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.5, 0.95, along));
    float wobble = 1.0 + flicker * (0.5 * sin(time * 31.0) + 0.5 * sin(time * 13.0 + 1.7));
    gl_FragColor = vec4(color * intensity * edge * fade * wobble, 1.0);
  }
`

/** A soft additive light cone from an apex at the group origin straight down. */
function createLightCone(color: string, intensity: number, height: number, radius: number, flicker: number) {
  const geometry = new THREE.CylinderGeometry(0.1, radius, height, 40, 1, true)
  geometry.translate(0, -height / 2, 0)
  const uniforms = {
    color: { value: new THREE.Color(color) },
    intensity: { value: intensity },
    height: { value: height },
    time: { value: 0 },
    flicker: { value: flicker },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CONE_VERTEX,
    fragmentShader: CONE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'theme-light-cone'
  mesh.renderOrder = 5
  mesh.onBeforeRender = () => {
    uniforms.time.value = themeClock()
    // Reduced motion: a steady cone, no flicker.
    uniforms.flicker.value = reducedMotion() ? 0 : flicker
  }
  return mesh
}

function createGlowSprite(texture: THREE.Texture, scale: number, name: string) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(scale, scale, 1)
  sprite.name = name
  sprite.renderOrder = 6
  return sprite
}

function createFloorPool(texture: THREE.Texture, width: number, depth: number, x: number, z: number, name: string) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    color: new THREE.Color(1, 1, 1),
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, -1.972, z)
  mesh.renderOrder = 1
  mesh.name = name
  return mesh
}

/** The themed neon sign: same tube look as the lounge sign, in the theme's colours. */
function createNeonSign(
  build: ThemeBuild,
  spec: NeonSpec,
  position: readonly [number, number, number],
  plate: { color: string; trim: string } | null
) {
  const sink = build.textures
  const texture = createThemedNeonTexture(sink, spec)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: '#ffffff',
    emissiveMap: texture,
    emissiveIntensity: spec.intensity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  material.userData.baseEmissive = spec.intensity
  build.neonMaterials.push(material)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), material)
  sign.position.set(...position)
  sign.name = 'theme-neon-sign'
  sign.renderOrder = 3
  build.decor.add(sign)
  if (plate) {
    const backing = mergeColored([
      [new THREE.BoxGeometry(5.2, 1.5, 0.06).translate(position[0], position[1], position[2] - 0.06), plate.color],
      [new THREE.BoxGeometry(5.3, 0.06, 0.1).translate(position[0], position[1] + 0.78, position[2] - 0.05), plate.trim],
      [new THREE.BoxGeometry(5.3, 0.06, 0.1).translate(position[0], position[1] - 0.78, position[2] - 0.05), plate.trim],
      [new THREE.BoxGeometry(0.06, 1.5, 0.1).translate(position[0] - 2.63, position[1], position[2] - 0.05), plate.trim],
      [new THREE.BoxGeometry(0.06, 1.5, 0.1).translate(position[0] + 2.63, position[1], position[2] - 0.05), plate.trim],
    ])
    plain(backing, vertexColorMaterial({ roughness: 0.3, metalness: 0.4 }), build.decor, 'theme-sign-plate')
  }
}

function createBuild(): ThemeBuild {
  const group = new THREE.Group()
  group.name = THEME_GROUP_NAMES.root
  const decor = new THREE.Group()
  decor.name = THEME_GROUP_NAMES.decor
  const fx = new THREE.Group()
  fx.name = THEME_GROUP_NAMES.fx
  group.add(decor, fx)
  return { group, decor, fx, neonMaterials: [], textures: [] }
}

// ---------------------------------------------------------------------------
// High Roller

/** Crystal chandeliers, all merged into the same few draw calls however many hang. */
function buildChandeliers(build: ThemeBuild, centers: readonly THREE.Vector3[]) {
  const gold: ColoredPart[] = []
  const bulbs: THREE.BufferGeometry[] = []
  const crystalMatrices: THREE.Matrix4[] = []
  const glintPositions: number[] = []
  const random = seeded(0xc4a1)
  for (const center of centers) {
    const tiers = [
      { radius: 1.7, y: -0.3, arms: 16, drops: 28 },
      { radius: 1.15, y: 0.15, arms: 12, drops: 18 },
      { radius: 0.62, y: 0.55, arms: 8, drops: 10 },
    ]
    // Chain up through the ceiling and the central column.
    gold.push([cylinder(0.025, 0.025, 8, 0, 4.2, 0, 6).translate(center.x, center.y, center.z), '#d9ad55'])
    gold.push([cylinder(0.09, 0.14, 1.1, 0, 0.55, 0, 12).translate(center.x, center.y, center.z), '#d9ad55'])
    for (const tier of tiers) {
      const ring = new THREE.TorusGeometry(tier.radius, 0.04, 8, 64).rotateX(Math.PI / 2).translate(center.x, center.y + tier.y, center.z)
      gold.push([ring, '#e8bd62'])
      for (let spoke = 0; spoke < 4; spoke += 1) {
        gold.push([cylinder(0.012, 0.012, tier.radius, 0, 0, 0, 5).rotateZ(Math.PI / 2)
          .translate(tier.radius / 2, 0, 0).rotateY((spoke * Math.PI) / 2)
          .translate(center.x, center.y + tier.y, center.z), '#d9ad55'])
      }
      for (let arm = 0; arm < tier.arms; arm += 1) {
        const angle = (arm / tier.arms) * Math.PI * 2
        const x = center.x + Math.cos(angle) * tier.radius
        const z = center.z + Math.sin(angle) * tier.radius
        // Candle cup and flame bulb.
        gold.push([cylinder(0.045, 0.03, 0.1, x, center.y + tier.y + 0.06, z, 8), '#e8bd62'])
        bulbs.push(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.5, 1).translate(x, center.y + tier.y + 0.17, z))
      }
      for (let drop = 0; drop < tier.drops; drop += 1) {
        const angle = (drop / tier.drops) * Math.PI * 2 + random() * 0.1
        const x = center.x + Math.cos(angle) * tier.radius
        const z = center.z + Math.sin(angle) * tier.radius
        const length = 0.22 + random() * 0.3
        const y = center.y + tier.y - 0.06 - length * 0.5
        crystalMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI, 0)),
          new THREE.Vector3(1, length / 0.2, 1)
        ))
        if (drop % 2 === 0) glintPositions.push(x, y - length * 0.2, z)
      }
    }
  }
  plain(mergeColored(gold), vertexColorMaterial({ roughness: 0.28, metalness: 1, envMapIntensity: 1.3 }), build.decor, 'theme-chandelier-gold')

  const bulbMerged = mergeGeometries(bulbs.map(geometry => {
    const indexed = geometry.index ? geometry.toNonIndexed() : geometry
    for (const name of Object.keys(indexed.attributes)) if (name !== 'position') indexed.deleteAttribute(name)
    return indexed
  }), false)
  bulbs.forEach(geometry => geometry.dispose())
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(2.6), toneMapped: false })
  bulbMaterial.fog = false
  plain(bulbMerged, bulbMaterial, build.decor, 'theme-chandelier-bulbs')

  const crystalGeometry = new THREE.OctahedronGeometry(0.09)
  crystalGeometry.scale(1, 2.2, 1)
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: '#dbe9ff',
    roughness: 0.04,
    metalness: 0.3,
    envMapIntensity: 2.4,
    emissive: '#8fb0ff',
    emissiveIntensity: 0.28,
  })
  const crystals = new THREE.InstancedMesh(crystalGeometry, crystalMaterial, crystalMatrices.length)
  crystalMatrices.forEach((matrix, index) => crystals.setMatrixAt(index, matrix))
  crystals.instanceMatrix.needsUpdate = true
  crystals.name = 'theme-chandelier-crystals'
  crystals.frustumCulled = false
  build.decor.add(crystals)

  const sparkle = createSparkleTexture(build.textures)
  build.fx.add(createTwinklePoints(new Float32Array(glintPositions), {
    map: sparkle, color: '#fff2d8', size: 150, speed: 1.1, base: 0.05, seed: 0x91a7,
  }, 'theme-chandelier-glints'))
  const haloTexture = createRadialGlowTexture(build.textures, '255, 214, 150', 0.5)
  for (const center of centers) {
    const halo = createGlowSprite(haloTexture, 6.5, 'theme-chandelier-halo')
    halo.position.copy(center).add(new THREE.Vector3(0, 0.1, 0))
    build.fx.add(halo)
  }
}

function buildVelvetRopes(build: ThemeBuild) {
  const posts: ColoredPart[] = []
  const rope: THREE.BufferGeometry[] = []
  const z = -8.3
  const xs = [-9, -6, -3, 0, 3, 6, 9]
  for (const x of xs) {
    posts.push([cylinder(0.3, 0.34, 0.07, x, -1.965, z, 24), '#e8bd62'])
    posts.push([cylinder(0.045, 0.06, 1.5, x, -1.2, z, 12), '#e8bd62'])
    posts.push([new THREE.SphereGeometry(0.1, 14, 10).translate(x, -0.4, z), '#f4d078'])
    posts.push([new THREE.TorusGeometry(0.075, 0.018, 6, 14).rotateX(Math.PI / 2).translate(x, -0.55, z), '#e8bd62'])
  }
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x0 = xs[index]!
    const x1 = xs[index + 1]!
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, -0.55, z),
      new THREE.Vector3(x0 + (x1 - x0) * 0.25, -0.78, z),
      new THREE.Vector3((x0 + x1) / 2, -0.88, z),
      new THREE.Vector3(x0 + (x1 - x0) * 0.75, -0.78, z),
      new THREE.Vector3(x1, -0.55, z),
    ])
    rope.push(new THREE.TubeGeometry(curve, 14, 0.04, 8, false))
  }
  plain(mergeColored(posts), vertexColorMaterial({ roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }), build.decor, 'theme-rope-posts')
  const ropeMerged = mergeGeometries(rope.map(geometry => geometry.toNonIndexed()), false)
  rope.forEach(geometry => geometry.dispose())
  plain(ropeMerged, new THREE.MeshPhysicalMaterial({
    color: '#9c1226',
    roughness: 0.7,
    sheen: 1,
    sheenColor: new THREE.Color('#ff6a7c'),
    sheenRoughness: 0.4,
  }), build.decor, 'theme-velvet-ropes')
}

function buildHighRoller(build: ThemeBuild, neon: NeonSpec | null) {
  buildChandeliers(build, [new THREE.Vector3(-5.2, 4.1, -5.8), new THREE.Vector3(5.2, 4.1, -5.8)])
  buildVelvetRopes(build)

  // Gold inlay rings in the marble around the table.
  const rings = mergeColored([
    [new THREE.RingGeometry(7.6, 7.78, 128).rotateX(-Math.PI / 2).translate(0, -1.984, 0), '#e0b25a'],
    [new THREE.RingGeometry(7.95, 8.02, 128).rotateX(-Math.PI / 2).translate(0, -1.984, 0), '#e0b25a'],
  ])
  plain(rings, vertexColorMaterial({ roughness: 0.3, metalness: 1, envMapIntensity: 1 }), build.decor, 'theme-floor-inlay')
  build.fx.add(createFloorPool(createRadialGlowTexture(build.textures, '255, 196, 110', 0.34), 19, 14, 0, -0.4, 'theme-floor-pool'))
  if (neon) createNeonSign(build, neon, [0, 4.8, -9.2], { color: '#0c0c11', trim: '#e0b25a' })
}

// ---------------------------------------------------------------------------
// Basement

function buildBasement(build: ThemeBuild, neon: NeonSpec | null) {
  const solids: ColoredPart[] = []
  const metals: ColoredPart[] = []
  const wall = -9.2
  const floor = -2

  const can = (x: number, y: number, z: number, color: string, lying = false, yaw = 0) => {
    const body = cylinder(0.065, 0.065, 0.24, 0, 0, 0, 12)
    const top = cylinder(0.055, 0.055, 0.02, 0, 0.125, 0, 12)
    for (const geometry of [body, top]) {
      if (lying) geometry.rotateZ(Math.PI / 2)
      geometry.rotateY(yaw).translate(x, y, z)
    }
    solids.push([body, color])
    metals.push([top, '#b8bdc2'])
  }

  // Fridge in the back-left corner: warm white, chrome bar handles.
  const fridge = { x: -9.3, z: -8.35 }
  solids.push([box(1.7, 4.2, 1.5, fridge.x, floor + 2.1, fridge.z), '#d8d2c0'])
  solids.push([box(1.7, 0.03, 1.52, fridge.x, floor + 1.35, fridge.z), '#6a655a'])
  metals.push([box(0.06, 1.0, 0.07, fridge.x + 0.68, floor + 2.3, fridge.z + 0.78), '#aeb4ba'])
  metals.push([box(0.06, 1.7, 0.07, fridge.x + 0.68, floor + 3.2, fridge.z + 0.78), '#aeb4ba'])
  solids.push([box(0.5, 0.35, 0.02, fridge.x - 0.3, floor + 3.0, fridge.z + 0.76), '#e8d9a0'])
  can(fridge.x + 0.1, floor + 4.32, fridge.z, '#c0392b')
  can(fridge.x - 0.4, floor + 4.32, fridge.z + 0.1, '#2f5fa8')

  // Wall shelf on the right with cans and a boombox.
  for (const y of [1.0, 2.2]) {
    solids.push([box(2.9, 0.08, 0.5, 8, y, wall + 0.25), '#4a3220'])
    solids.push([box(0.08, 0.4, 0.4, 6.7, y - 0.22, wall + 0.2), '#2a1c12'])
    solids.push([box(0.08, 0.4, 0.4, 9.3, y - 0.22, wall + 0.2), '#2a1c12'])
  }
  const palette = ['#c0392b', '#bfc5c9', '#2f5fa8', '#d4a72c', '#2f8f4e']
  for (let index = 0; index < 9; index += 1) can(6.9 + index * 0.17, 1.17, wall + 0.28, palette[index % palette.length]!)
  for (let index = 0; index < 5; index += 1) can(7.3 + index * 0.2, 2.37, wall + 0.3, palette[(index + 2) % palette.length]!)
  solids.push([box(0.95, 0.4, 0.3, 9.0, 2.45, wall + 0.28), '#2a2a2e'])
  metals.push([cylinder(0.11, 0.11, 0.04, 0, 0, 0, 16).rotateX(Math.PI / 2).translate(8.78, 2.45, wall + 0.44), '#7a7e84'])
  metals.push([cylinder(0.11, 0.11, 0.04, 0, 0, 0, 16).rotateX(Math.PI / 2).translate(9.22, 2.45, wall + 0.44), '#7a7e84'])

  // Cooler on the floor under the shelf.
  solids.push([box(1.4, 0.8, 0.7, 7.9, floor + 0.4, wall + 0.55), '#2d6aa0'])
  solids.push([box(1.45, 0.12, 0.75, 7.9, floor + 0.86, wall + 0.55), '#e6ecef'])

  // Cans around the floor: some standing, some tipped over, one crushed.
  can(5.2, floor + 0.12, -7.6, '#c0392b')
  can(-5.6, floor + 0.12, -7.8, '#d4a72c')
  can(-6.2, floor + 0.065, -7.2, '#2f5fa8', true, 0.7)
  can(10.2, floor + 0.065, -6.4, '#bfc5c9', true, 2.2)
  can(-10.4, floor + 0.12, -4.8, '#c0392b')
  can(10.8, floor + 0.12, -2.6, '#2f8f4e')
  solids.push([cylinder(0.065, 0.05, 0.1, 4.6, floor + 0.05, -7.4, 10).rotateZ(0.5), '#9aa0a6'])

  // Ceiling: drop-tile plane, joists, a duct and a pair of pipes.
  const ceilingY = 7.6
  const joists: ColoredPart[] = []
  for (const x of [-9.5, -4.8, 0, 4.8, 9.5]) joists.push([box(0.3, 0.5, 20.8, x, ceilingY - 0.25, 0.9), '#3a2616'])
  joists.push([box(25, 0.5, 0.5, 0, ceilingY - 0.25, -8.8), '#3a2616'])
  joists.push([box(25, 0.45, 0.8, 0, ceilingY - 0.5, -6.2), '#6e7076'])
  joists.push([cylinder(0.07, 0.07, 25, 0, 0, 0, 10).rotateZ(Math.PI / 2).translate(0, ceilingY - 0.3, -8.2), '#b87a4c'])
  joists.push([cylinder(0.09, 0.09, 25, 0, 0, 0, 10).rotateZ(Math.PI / 2).translate(0, ceilingY - 0.35, -7.5), '#c8c4b4'])
  plain(mergeColored(joists), vertexColorMaterial({ roughness: 0.7, metalness: 0.2 }), build.decor, 'theme-ceiling-fixtures')
  const ceilingTexture = createSurfaceTexture(build.textures, 'basement-ceiling', [10, 8])
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 20.85).rotateX(Math.PI / 2).translate(0, ceilingY, 0.975),
    new THREE.MeshStandardMaterial({ map: ceilingTexture, color: '#9a9488', roughness: 0.95, metalness: 0 })
  )
  ceiling.name = 'theme-ceiling'
  build.group.add(ceiling)

  // Wall dressing from one atlas: posters, dartboard, pennant, calendar.
  const atlas = createBasementAtlasTexture(build.textures)
  const art: THREE.BufferGeometry[] = []
  const frames: ColoredPart[] = []
  const hang = (rect: AtlasRect, width: number, x: number, y: number, frame = '#2a1c12') => {
    const height = (width * rect.h) / rect.w
    art.push(atlasUv(new THREE.PlaneGeometry(width, height), rect).translate(x, y, wall + 0.075))
    frames.push([box(width + 0.12, height + 0.12, 0.05, x, y, wall + 0.04), frame])
  }
  hang(BASEMENT_ATLAS.posterA, 1.55, -4.6, 2.1)
  hang(BASEMENT_ATLAS.posterB, 1.55, 3.4, 2.15, '#d8c9a0')
  hang(BASEMENT_ATLAS.calendar, 0.78, -7.0, 1.4, '#d8c9a0')
  art.push(atlasUv(new THREE.PlaneGeometry(1.5, (1.5 * BASEMENT_ATLAS.pennant.h) / BASEMENT_ATLAS.pennant.w), BASEMENT_ATLAS.pennant).translate(-7.2, 3.7, wall + 0.06))
  const dart = circleAtlasUv(new THREE.CircleGeometry(0.52, 40), BASEMENT_ATLAS.dartboard).translate(6.2, 3.9, wall + 0.08)
  art.push(dart)
  frames.push([cylinder(0.56, 0.56, 0.05, 0, 0, 0, 40).rotateX(Math.PI / 2).translate(6.2, 3.9, wall + 0.045), '#16100c'])
  const artMerged = mergeGeometries(art.map(geometry => (geometry.index ? geometry.toNonIndexed() : geometry)), false)
  art.forEach(geometry => geometry.dispose())
  plain(artMerged, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.85, metalness: 0 }), build.decor, 'theme-wall-art')
  solids.push(...frames)

  plain(mergeColored(solids), vertexColorMaterial({ roughness: 0.82 }), build.decor, 'theme-basement-props')
  plain(mergeColored(metals), vertexColorMaterial({ roughness: 0.38, metalness: 0.85, envMapIntensity: 0.6 }), build.decor, 'theme-basement-metal')

  if (neon) createNeonSign(build, neon, [-0.4, 4.9, wall + 0.1], null)

  // A bare bulb on a cord over the table, with its warm cone, halo and dust.
  const bulb = new THREE.Vector3(0, 4.5, -3.2)
  const hardware = mergeColored([
    [cylinder(0.012, 0.012, ceilingY - bulb.y, bulb.x, (ceilingY + bulb.y) / 2 + 0.07, bulb.z, 5), '#101010'],
    [cylinder(0.05, 0.06, 0.16, bulb.x, bulb.y + 0.15, bulb.z, 10), '#2a2420'],
  ])
  plain(hardware, vertexColorMaterial({ roughness: 0.6 }), build.decor, 'theme-bulb-cord')
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(2.8), toneMapped: false })
  bulbMaterial.fog = false
  const bulbMesh = plain(new THREE.SphereGeometry(0.12, 16, 12).scale(1, 1.25, 1).translate(bulb.x, bulb.y, bulb.z), bulbMaterial, build.decor, 'theme-bulb')
  if (bulbMesh) bulbMesh.renderOrder = 2
  const cone = createLightCone('#ffb55e', 0.075, bulb.y - 0.45, 2.7, 0.04)
  cone.position.copy(bulb)
  build.fx.add(cone)
  const halo = createGlowSprite(createRadialGlowTexture(build.textures, '255, 190, 110', 0.55), 2.2, 'theme-bulb-halo')
  halo.position.copy(bulb)
  build.fx.add(halo)
  const random = seeded(0xd057)
  const motes = new Float32Array(48 * 3)
  for (let index = 0; index < 48; index += 1) {
    const along = 0.1 + random() * 0.8
    const radius = Math.sqrt(random()) * (0.2 + along * 2.4)
    const angle = random() * Math.PI * 2
    motes[index * 3] = bulb.x + Math.cos(angle) * radius
    motes[index * 3 + 1] = bulb.y - along * (bulb.y - 0.5)
    motes[index * 3 + 2] = bulb.z + Math.sin(angle) * radius
  }
  build.fx.add(createTwinklePoints(motes, {
    map: createSparkleTexture(build.textures), color: '#ffc880', size: 26, speed: 0.5, base: 0.3, seed: 0x7a11,
  }, 'theme-dust'))
  build.fx.add(createFloorPool(createRadialGlowTexture(build.textures, '255, 170, 90', 0.26), 15, 11, 0, -1.2, 'theme-floor-pool'))
}

// ---------------------------------------------------------------------------
// Neon Rooftop

function buildRooftop(build: ThemeBuild, neon: NeonSpec | null) {
  const wall = -9.3
  const frame: ColoredPart[] = []
  const cyan: THREE.BufferGeometry[] = []
  const magenta: THREE.BufferGeometry[] = []

  // Glass wall mullions and transoms over the skyline.
  for (let x = -14; x <= 14; x += 4) frame.push([box(0.2, 14, 0.2, x, 5, wall), '#0b0818'])
  frame.push([box(32, 0.2, 0.2, 0, 6.6, wall), '#0b0818'])
  frame.push([box(32, 0.3, 0.3, 0, -1.8, wall), '#0b0818'])
  frame.push([box(32, 0.3, 0.3, 0, 11.8, wall), '#0b0818'])
  // Hanging cables for the neon rings.
  const ringCenter = new THREE.Vector3(0, 4.7, -2.4)
  for (const angle of [0.4, 2.5, 4.6]) {
    frame.push([cylinder(0.012, 0.012, 6, ringCenter.x + Math.cos(angle) * 3.4, ringCenter.y + 3, ringCenter.z + Math.sin(angle) * 3.4, 5), '#0b0818'])
  }
  plain(mergeColored(frame), vertexColorMaterial({ roughness: 0.4, metalness: 0.6 }), build.decor, 'theme-window-frame')

  // Neon strips: along every other mullion, the wall base, and the side walls.
  for (let x = -12; x <= 12; x += 8) cyan.push(box(0.05, 13, 0.05, x, 5, wall + 0.12))
  magenta.push(box(32, 0.07, 0.07, 0, -1.78, wall + 0.2))
  cyan.push(box(32, 0.05, 0.05, 0, 6.4, wall + 0.12))
  for (const side of [-1, 1]) {
    for (const z of [-7, -2.5, 2]) cyan.push(box(0.05, 13, 0.05, side * 12.3, 5, z))
    magenta.push(box(0.07, 0.07, 22, side * 12.28, -1.78, 0))
    magenta.push(box(0.05, 0.05, 22, side * 12.3, 6.4, 0))
  }
  // Two neon halos hung over the table.
  cyan.push(new THREE.TorusGeometry(2.5, 0.035, 8, 96).rotateX(Math.PI / 2).translate(ringCenter.x, ringCenter.y + 0.35, ringCenter.z))
  magenta.push(new THREE.TorusGeometry(3.4, 0.04, 8, 96).rotateX(Math.PI / 2).translate(ringCenter.x, ringCenter.y, ringCenter.z))
  // A glowing ring set into the floor around the table.
  cyan.push(new THREE.RingGeometry(7.4, 7.5, 128).rotateX(-Math.PI / 2).translate(0, -1.982, 0))
  magenta.push(new THREE.RingGeometry(7.75, 7.83, 128).rotateX(-Math.PI / 2).translate(0, -1.982, 0))
  const merge = (parts: THREE.BufferGeometry[]) => {
    const prepared = parts.map(geometry => {
      const next = geometry.index ? geometry.toNonIndexed() : geometry
      for (const name of Object.keys(next.attributes)) if (name !== 'position') next.deleteAttribute(name)
      return next
    })
    const merged = mergeGeometries(prepared, false)
    prepared.forEach(geometry => geometry.dispose())
    parts.forEach(geometry => geometry.dispose())
    return merged
  }
  plain(merge(cyan), neonTubeMaterial('#18dcff', 1.9), build.decor, 'theme-neon-cyan')
  plain(merge(magenta), neonTubeMaterial('#ff30b4', 1.9), build.decor, 'theme-neon-magenta')

  // A twinkling star dome for the open sky.
  const random = seeded(0x57a2)
  const stars = new Float32Array(170 * 3)
  for (let index = 0; index < 170; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 22 + random() * 18
    stars[index * 3] = Math.cos(angle) * radius
    stars[index * 3 + 1] = 11 + random() * 20
    stars[index * 3 + 2] = Math.sin(angle) * radius - 6
  }
  build.fx.add(createTwinklePoints(stars, {
    map: createSparkleTexture(build.textures), color: '#cfd8ff', size: 90, speed: 0.7, base: 0.25, seed: 0x5a17,
  }, 'theme-stars'))
  build.fx.add(createFloorPool(createRadialGlowTexture(build.textures, '255, 60, 190', 0.3), 19, 14, 0, -0.4, 'theme-floor-pool'))
  if (neon) createNeonSign(build, neon, [0, 5.1, wall + 0.25], { color: '#0a0716', trim: '#18dcff' })
}

// ---------------------------------------------------------------------------

/** Builds a theme's prop set. Returns null for themes without props (the lounge). */
export function buildThemeProps(id: ThemePropsId | null, neon: NeonSpec | null): ThemeBuild | null {
  if (!id) return null
  const build = createBuild()
  if (id === 'highroller') buildHighRoller(build, neon)
  else if (id === 'basement') buildBasement(build, neon)
  else buildRooftop(build, neon)
  return build
}

/**
 * Frees everything the build owns: geometries, materials (with any maps they
 * hold that the build created) and the textures it painted. Safe to call twice.
 */
export function disposeThemeBuild(build: ThemeBuild) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  build.group.traverse(object => {
    const target = object as THREE.Mesh
    // Sprites share one module-level geometry: never dispose it.
    if (target.geometry && !(object as THREE.Sprite).isSprite) geometries.add(target.geometry)
    if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose()
    const list = Array.isArray(target.material) ? target.material : target.material ? [target.material] : []
    list.forEach(material => materials.add(material))
  })
  build.group.removeFromParent()
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  build.textures.forEach(texture => texture.dispose())
  build.textures.length = 0
  build.neonMaterials.length = 0
}
