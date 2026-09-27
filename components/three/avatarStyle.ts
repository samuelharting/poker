import * as THREE from 'three'

/**
 * Stylized look for the rigged avatars: cel-shaded toon materials with a
 * stepped light ramp, a skinned ink outline (inverted hull), and eye blinks.
 */

let toonRamp: THREE.DataTexture | null = null

function getToonRamp() {
  if (toonRamp) return toonRamp
  // Three painted tones (shadow, mid, lit) with narrow soft steps between them:
  // linear filtering across the repeated texels gives a crisp-but-not-aliased
  // terminator instead of the old four hard bands.
  const steps = new Uint8Array([
    118, 118, 118, 118, 118, 118, 118,
    190, 190, 190, 190, 190,
    255, 255, 255, 255,
  ])
  toonRamp = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  toonRamp.minFilter = THREE.LinearFilter
  toonRamp.magFilter = THREE.LinearFilter
  toonRamp.generateMipmaps = false
  toonRamp.needsUpdate = true
  return toonRamp
}

/**
 * Warm-key / cool-shadow grade plus a soft fresnel rim so characters separate
 * from the dark lounge. Injected once; every avatar toon material shares the
 * same program (the cache key is this function's source).
 */
function avatarToonLook(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `{
      float toonLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      float toonLit = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114)) / max(toonLuma, 0.02);
      float toonWarm = smoothstep(0.08, 0.7, toonLit);
      outgoingLight *= mix(vec3(0.84, 0.9, 1.1), vec3(1.06, 1.0, 0.92), toonWarm);
      float toonFacing = saturate(dot(normal, geometryViewDir));
      float toonRim = smoothstep(0.52, 0.86, 1.0 - toonFacing) * saturate(normal.y * 0.6 + 0.55);
      outgoingLight += (diffuseColor.rgb * 0.55 + vec3(0.07, 0.075, 0.09)) * toonRim * 0.55;
    }
    #include <opaque_fragment>`
  )
}

/** Converts a material to the shared avatar toon look (also used for re-coloured clones). */
export function applyAvatarToonLook(material: THREE.Material) {
  if (!(material as THREE.MeshToonMaterial).isMeshToonMaterial) return
  material.onBeforeCompile = avatarToonLook
  material.needsUpdate = true
}

function toToonMaterial(source: THREE.Material) {
  const standard = source as THREE.MeshStandardMaterial
  const toon = new THREE.MeshToonMaterial({
    name: source.name,
    color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
    map: standard.map ?? null,
    gradientMap: getToonRamp(),
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
  })
  // Lift skin and cloth slightly so the ramp's darkest band never goes muddy.
  toon.color.offsetHSL(0, 0.04, 0.02)
  applyAvatarToonLook(toon)
  return toon
}

/** Outline thickness as a fraction of each mesh's bounding radius (rigs use different units). */
const OUTLINE_WIDTH_RATIO = 0.0075

function createOutlineMaterial(width: number) {
  const material = new THREE.MeshBasicMaterial({
    color: '#120a07',
    side: THREE.BackSide,
    transparent: false,
  })
  material.name = 'avatar-ink-outline'
  material.onBeforeCompile = shader => {
    shader.uniforms.outlineWidth = { value: width }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\n  float outlineNormalLength = length(objectNormal);\n  if (outlineNormalLength > 1e-4) transformed += (objectNormal / outlineNormalLength) * outlineWidth;'
      )
  }
  // Every outline shares one program even though materials are per seat.
  return material
}

/** Per-player colouring for the shared GLB bodies. */
export interface AvatarLook {
  /** sRGB hex from the avatar profile (also used by the HUD swatch). */
  skinColor?: string
  /** Stable per-player seed string (player id). */
  seed?: string
}

type Palette = Record<string, string>

// Jewel-toned wardrobe that sits well against the teal lounge and green felt.
// Keys are the GLB material names; each model gets a few variants per player.
const OUTFIT_PALETTES: Record<string, Palette[]> = {
  Suit: [
    { Suit: '#27324d', White: '#efe8d8', Tie: '#a3263c' },
    { Suit: '#3a2a45', White: '#f1ead9', Tie: '#d8a23a' },
    { Suit: '#1f3b3a', White: '#ece6d6', Tie: '#c2573a' },
    { Suit: '#2c2c33', White: '#f2ecde', Tie: '#2f8f83' },
  ],
  Casual2: [
    { LightBrown: '#d2a03f', LightBlue: '#35507a', White: '#ece6da', Red_Dark: '#8f2433' },
    { LightBrown: '#c8604e', LightBlue: '#2f3f5e', White: '#ece6da', Red_Dark: '#1f5c55' },
    { LightBrown: '#7fa36a', LightBlue: '#3b4f78', White: '#ece6da', Red_Dark: '#7a2a3a' },
    { LightBrown: '#e0d3b4', LightBlue: '#2c4a6e', White: '#ece6da', Red_Dark: '#b8403a' },
  ],
  Casual: [
    { Purple: '#5d3a8a', LightBlue: '#34496e', White: '#ece6da' },
    { Purple: '#1f7f7a', LightBlue: '#2e3f5c', White: '#ece6da' },
    { Purple: '#a83246', LightBlue: '#33476a', White: '#ece6da' },
    { Purple: '#3f64a8', LightBlue: '#2c3a52', White: '#ece6da' },
  ],
  Worker: [
    { Worker_Vest: '#e0692c', Worker_Yellow: '#e8b640', LightBrown: '#7c95a6', Brown: '#46506a', Brown2: '#2c2f3a' },
    { Worker_Vest: '#d9a32e', Worker_Yellow: '#e8c35a', LightBrown: '#b0544a', Brown: '#3b4a5e', Brown2: '#2c2f3a' },
    { Worker_Vest: '#2f8f7a', Worker_Yellow: '#e2ae3a', LightBrown: '#d8cdb3', Brown: '#40465a', Brown2: '#2c2f3a' },
  ],
  Punk: [
    { Black: '#26242c', White: '#ebe4d6', LightBlue: '#2f3e58' },
    { Black: '#3a1f2c', White: '#e8e0cf', LightBlue: '#27324a' },
    { Black: '#1f2c34', White: '#f0e8d8', LightBlue: '#353148' },
  ],
  Adventurer: [
    { Green: '#3f6d55', LightGreen: '#c4a46a', Brown: '#6e4a2c', Brown2: '#3a3140', Gold: '#e0b04a' },
    { Green: '#7a3b33', LightGreen: '#d6c29a', Brown: '#5c3e28', Brown2: '#2e3244', Gold: '#e0b04a' },
    { Green: '#34577a', LightGreen: '#c9b07a', Brown: '#6a4630', Brown2: '#33303c', Gold: '#e0b04a' },
  ],
}

// Natural hair plus a couple of playful dyes; punks get the loud ones.
const HAIR_COLORS = ['#1c1613', '#3a2419', '#5e3520', '#8a3a1e', '#b8612a', '#d9ae5e', '#e6dcc0', '#8d8a86', '#2d2a33']
const PUNK_HAIR_COLORS = ['#d8345f', '#1fb3a6', '#c8283c', '#8150d8', '#f0a030']

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function detectOutfitFamily(model: THREE.Object3D) {
  let family: string | null = null
  model.traverse(object => {
    if (family || !(object as THREE.Mesh).isMesh) return
    const match = /^(Suit|Casual2|Casual|Worker|Punk|Adventurer)_/.exec(object.name)
    if (match) family = match[1]!
  })
  return family as string | null
}

/** Recolours the converted toon materials for this player (skin, hair, outfit). */
function applyLook(model: THREE.Object3D, materials: Iterable<THREE.MeshToonMaterial>, look: AvatarLook) {
  const seed = hashString(look.seed ?? '')
  const family = detectOutfitFamily(model)
  const variants = family ? OUTFIT_PALETTES[family] : undefined
  const palette: Palette = variants ? variants[seed % variants.length]! : {}
  const hairChoices = family === 'Punk' ? PUNK_HAIR_COLORS : HAIR_COLORS
  const hair = new THREE.Color(hairChoices[(seed >>> 8) % hairChoices.length]!)
  const skin = look.skinColor ? new THREE.Color(look.skinColor) : null
  if (skin) skin.offsetHSL(0, 0.06, -0.035)

  for (const material of materials) {
    const name = material.name
    if (skin && /^skin$/i.test(name)) material.color.copy(skin)
    else if (skin && /^skin_darker$/i.test(name)) material.color.copy(skin).multiplyScalar(0.84)
    else if (/^(hair|moustache)$/i.test(name) || (family === 'Punk' && /^red(_dark)?$/i.test(name))) {
      material.color.copy(hair)
      if (/^red_dark$/i.test(name)) material.color.multiplyScalar(0.72)
    } else if (palette[name]) material.color.set(palette[name]!)
    else if (/^black$/i.test(name)) material.color.set('#22222a')
    else if (/^grey$/i.test(name)) material.color.set('#3a3a44')
  }
}

const SMOOTH_CREASE_COS = Math.cos(THREE.MathUtils.degToRad(62))
const outlineGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

function groupByPosition(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const groups = new Map<string, number[]>()
  for (let index = 0; index < position.count; index += 1) {
    const key = `${Math.round(position.getX(index) * 1e4)},${Math.round(position.getY(index) * 1e4)},${Math.round(position.getZ(index) * 1e4)}`
    const list = groups.get(key)
    if (list) list.push(index)
    else groups.set(key, [index])
  }
  return groups
}

/**
 * The low-poly GLBs ship flat per-face normals, which the toon ramp turns into
 * a patchwork of facets. Average normals across coincident vertices within a
 * crease angle so curved surfaces shade as one form while hat brims, collars
 * and shoe soles keep a crisp edge. Runs once per shared template geometry.
 */
function smoothTemplateNormals(geometry: THREE.BufferGeometry) {
  if (geometry.userData.toonSmoothed) return
  geometry.userData.toonSmoothed = true
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!normal) return
  const source = new Float32Array(normal.count * 3)
  for (let index = 0; index < normal.count; index += 1) {
    source[index * 3] = normal.getX(index)
    source[index * 3 + 1] = normal.getY(index)
    source[index * 3 + 2] = normal.getZ(index)
  }
  const result = new Float32Array(source)
  for (const members of groupByPosition(geometry).values()) {
    if (members.length < 2) continue
    for (const a of members) {
      let x = 0
      let y = 0
      let z = 0
      for (const b of members) {
        const dot = source[a * 3]! * source[b * 3]! + source[a * 3 + 1]! * source[b * 3 + 1]! + source[a * 3 + 2]! * source[b * 3 + 2]!
        if (dot < SMOOTH_CREASE_COS) continue
        x += source[b * 3]!
        y += source[b * 3 + 1]!
        z += source[b * 3 + 2]!
      }
      const length = Math.hypot(x, y, z) || 1
      result[a * 3] = x / length
      result[a * 3 + 1] = y / length
      result[a * 3 + 2] = z / length
    }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(result, 3))
}

/**
 * Outline hulls need one normal per position (fully averaged) or the hull
 * splits into shards along every hard edge. Shares every other attribute with
 * the source geometry so no skinning data is duplicated on the GPU.
 */
function getOutlineGeometry(geometry: THREE.BufferGeometry) {
  const cached = outlineGeometries.get(geometry)
  if (cached) return cached
  const outline = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name !== 'normal') outline.setAttribute(name, attribute)
  }
  outline.setIndex(geometry.index)
  for (const group of geometry.groups) outline.addGroup(group.start, group.count, group.materialIndex)
  const normal = geometry.getAttribute('normal')
  const averaged = new Float32Array(normal.count * 3)
  for (const members of groupByPosition(geometry).values()) {
    let x = 0
    let y = 0
    let z = 0
    for (const index of members) {
      x += normal.getX(index)
      y += normal.getY(index)
      z += normal.getZ(index)
    }
    const length = Math.hypot(x, y, z) || 1
    for (const index of members) {
      averaged[index * 3] = x / length
      averaged[index * 3 + 1] = y / length
      averaged[index * 3 + 2] = z / length
    }
  }
  outline.setAttribute('normal', new THREE.BufferAttribute(averaged, 3))
  geometry.computeBoundingSphere()
  outline.boundingSphere = geometry.boundingSphere
  outline.boundingBox = geometry.boundingBox
  outlineGeometries.set(geometry, outline)
  return outline
}

export interface StylizedAvatar {
  materials: THREE.Material[]
  outlineMeshes: THREE.Object3D[]
  eyeMaterials: THREE.MeshToonMaterial[]
  eyeColors: THREE.Color[]
  skinColor: THREE.Color | null
}

/**
 * Converts every mesh in the rig to toon shading and adds an ink outline to
 * skinned meshes. Returns the new per-instance materials (the originals are
 * disposed) plus the eye materials used for blinking.
 */
export function stylizeAvatar(
  model: THREE.Object3D,
  previous: readonly THREE.Material[],
  look: AvatarLook = {}
): StylizedAvatar {
  const converted = new Map<THREE.Material, THREE.MeshToonMaterial>()
  const outlineMeshes: THREE.Object3D[] = []
  const skinnedMeshes: THREE.SkinnedMesh[] = []

  model.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const convert = (material: THREE.Material) => {
      let toon = converted.get(material)
      if (!toon) {
        toon = toToonMaterial(material)
        converted.set(material, toon)
      }
      return toon
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
    smoothTemplateNormals(mesh.geometry)
    // Cel-shaded characters read cleaner without self-shadow acne from the
    // key light's soft shadow map (it broke skin and cloth into dithered blotches).
    mesh.receiveShadow = false
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(mesh as THREE.SkinnedMesh)
  })
  applyLook(model, converted.values(), look)

  const outlineMaterials: THREE.Material[] = []
  for (const mesh of skinnedMeshes) {
    // Legs/feet hide under the table skirt and tiny painted parts don't need
    // their own ink line; skip them to save draw calls.
    const vertexCount = mesh.geometry.getAttribute('position').count
    if (/legs|feet|foot/i.test(mesh.name) || vertexCount < 120) continue
    mesh.geometry.computeBoundingSphere()
    const radius = mesh.geometry.boundingSphere?.radius ?? 1
    const outlineMaterial = createOutlineMaterial(radius * OUTLINE_WIDTH_RATIO)
    outlineMaterials.push(outlineMaterial)
    const outline = new THREE.SkinnedMesh(getOutlineGeometry(mesh.geometry), outlineMaterial)
    outline.name = `${mesh.name}-outline`
    outline.bind(mesh.skeleton, mesh.bindMatrix)
    outline.frustumCulled = false
    outline.castShadow = false
    outline.receiveShadow = false
    outline.renderOrder = mesh.renderOrder
    outline.position.copy(mesh.position)
    outline.quaternion.copy(mesh.quaternion)
    outline.scale.copy(mesh.scale)
    mesh.parent?.add(outline)
    outlineMeshes.push(outline)
  }

  previous.forEach(material => material.dispose())

  const materials = [...converted.values(), ...outlineMaterials]
  const eyeMaterials = [...converted.values()].filter(material => /^eye$/i.test(material.name))
  const skin = [...converted.values()].find(material => /^skin$/i.test(material.name))
  return {
    materials,
    outlineMeshes,
    eyeMaterials,
    eyeColors: eyeMaterials.map(material => material.color.clone()),
    skinColor: skin ? skin.color.clone() : null,
  }
}

/** Closes the eyes (eye colour → skin colour) for `closed` in 0..1. */
export function applyBlink(style: StylizedAvatar, closed: number) {
  if (!style.skinColor) return
  style.eyeMaterials.forEach((material, index) => {
    const open = style.eyeColors[index]
    if (open) material.color.copy(open).lerp(style.skinColor!, closed)
  })
}

/** A natural blink schedule: quick double-blinks now and then. */
export function getBlinkAmount(time: number, seed: number) {
  const period = 3.4 + seed * 2.2
  const phase = (time + seed * 17) % period
  const blink = (start: number) => {
    const t = (phase - start) / 0.13
    return t >= 0 && t <= 1 ? Math.sin(t * Math.PI) : 0
  }
  return Math.max(blink(0), seed > 0.6 ? blink(0.22) : 0)
}
