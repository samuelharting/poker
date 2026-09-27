import * as THREE from 'three'
import type {
  PlayerAvatarCustomization,
  PlayerAvatarGlassesStyle,
  PlayerAvatarHatStyle,
  PlayerAvatarJacketColor,
  PlayerAvatarJacketStyle,
  PlayerAvatarModelKey,
} from '@/lib/profile'
import { applyAvatarToonLook, createAvatarToonMaterial } from './avatarStyle'

type CosmeticSelection = Pick<
  PlayerAvatarCustomization,
  'hat' | 'glasses' | 'jacket' | 'jacketColor'
>

type RiggedCosmeticSelection = CosmeticSelection & Pick<PlayerAvatarCustomization, 'modelKey'>

export const AVATAR_JACKET_COLOR_HEX: Record<PlayerAvatarJacketColor, string> = {
  burgundy: '#8c2442',
  midnight: '#243c66',
  emerald: '#1f7358',
  ivory: '#e4dac2',
  gold: '#c8943a',
  violet: '#6a45a0',
}

export interface AvatarAccessorySet {
  groups: THREE.Group[]
  materials: THREE.Material[]
  restores?: Array<() => void>
}

interface HeadAccessoryCalibration {
  /** Head-space units per accessory unit. */
  scale: number
  /** +1 when the face looks down +Z in head space, -1 for -Z. */
  front: number
}

/**
 * Where accessories sit on a particular head, in accessory units (see
 * measureHeadFit). Fallback values are used for the procedural avatar and for
 * rigs that cannot be measured.
 */
export interface HeadFit {
  /** Widest half-width of the skull (incl. hair) above the eyes. */
  halfWidth: number
  /** Top of the skull/hair where a hat rests. */
  top: number
  /** Front/back middle and half-depth of the skull above the eyes. */
  centerZ: number
  depth: number
  /** Eye height, the face surface in front of the eyes, and each eye's |x|. */
  eyeY: number
  eyeFront: number
  eyeX: number
  /** Half-width of the face at the temples (where glasses arms run). */
  faceHalfWidth: number
  /** Height where the skull is still wide enough to seat a small crown. */
  crownSeatY?: number
}

const FALLBACK_HEAD: HeadAccessoryCalibration = { scale: 1, front: -1 }
const FALLBACK_FIT: HeadFit = {
  halfWidth: 0.41,
  top: 0.4,
  centerZ: 0,
  depth: 0.38,
  eyeY: 0.035,
  eyeFront: 0.33,
  eyeX: 0.132,
  faceHalfWidth: 0.37,
}

const RIGGED_ROOT_HEAD: HeadAccessoryCalibration = { scale: 0.43, front: 1 }

/** The bundled rigs' heads, measured in bind pose (used if measuring fails). */
const RIGGED_DEFAULT_FIT: HeadFit = {
  halfWidth: 0.27,
  top: 0.62,
  centerZ: 0.03,
  depth: 0.29,
  eyeY: 0.26,
  eyeFront: 0.255,
  eyeX: 0.1,
  faceHalfWidth: 0.25,
}

const RIGGED_JACKET_TARGETS: Record<PlayerAvatarModelKey, string> = {
  business_man: 'Suit_Body_1',
  casual: 'Casual2_Body_1',
  hoodie: 'Casual_Body_1',
  worker: 'Worker_Body_2',
  punk: 'Punk_Body_1',
  adventurer: 'Adventurer_Body_1',
}

export function getAvatarAppearanceKey(selection: CosmeticSelection): string {
  return [selection.hat, selection.glasses, selection.jacket, selection.jacketColor].join(':')
}

export function createFallbackAvatarAccessories(
  head: THREE.Object3D,
  avatarRoot: THREE.Object3D,
  selection: CosmeticSelection
): AvatarAccessorySet {
  const materials: THREE.Material[] = []
  const headGroup = createHeadAccessories(selection.hat, selection.glasses, FALLBACK_HEAD, FALLBACK_FIT, materials)
  head.add(headGroup)

  const jacketGroup = createJacket(selection.jacket, selection.jacketColor, {
    front: -1,
    centerY: 0.69,
    centerZ: -0.34,
    scale: 1,
  }, materials)
  avatarRoot.add(jacketGroup)

  return { groups: [headGroup, jacketGroup], materials }
}

export function createRiggedAvatarAccessories(
  avatarRoot: THREE.Object3D,
  bones: ReadonlyMap<string, THREE.Bone>,
  selection: RiggedCosmeticSelection
): AvatarAccessorySet {
  const materials: THREE.Material[] = []
  const restores: Array<() => void> = []
  // Hide incompatible built-in headwear first so the head is measured bare.
  const restoreHeadwear = applyRiggedHeadwearCompatibility(
    avatarRoot,
    selection.modelKey,
    selection.hat
  )
  if (restoreHeadwear) restores.push(restoreHeadwear)

  const headBone = bones.get('Head')
  const headCalibration = headBone ? getRiggedHeadCalibration() : RIGGED_ROOT_HEAD
  const fit = headBone
    ? measureHeadFit(avatarRoot, headBone, headCalibration.scale) ?? RIGGED_DEFAULT_FIT
    : FALLBACK_FIT
  const headGroup = createHeadAccessories(
    selection.hat,
    selection.glasses,
    headCalibration,
    fit,
    materials
  )
  if (headBone) {
    headBone.add(headGroup)
  } else {
    headGroup.position.set(0, 1.56, 0.09)
    avatarRoot.add(headGroup)
  }

  const chestBone = bones.get('Chest')
  const jacketGroup = chestBone
    ? createFittedJacketAccent(
        selection.jacket,
        selection.jacketColor,
        measureChestBadgeSpot(avatarRoot, chestBone, 0.0043),
        0.0043,
        materials
      )
    : createEmptyJacketGroup(selection.jacket, selection.jacketColor)
  const jacketParent = chestBone ?? avatarRoot
  jacketParent.add(jacketGroup)

  const jacketOverride = applyRiggedJacketMaterial(
    avatarRoot,
    selection.modelKey,
    selection.jacket,
    selection.jacketColor
  )
  materials.push(...jacketOverride.materials)
  if (jacketOverride.restore) restores.push(jacketOverride.restore)

  return { groups: [headGroup, jacketGroup], materials, restores }
}

export function disposeAvatarAccessorySet(set: AvatarAccessorySet | null): void {
  if (!set) return

  const geometries = new Set<THREE.BufferGeometry>()
  for (const group of set.groups) {
    group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry)
    })
    group.removeFromParent()
  }

  set.restores?.slice().reverse().forEach(restore => restore())
  geometries.forEach(geometry => geometry.dispose())
  set.materials.forEach(material => material.dispose())
}

function getRiggedHeadCalibration(): HeadAccessoryCalibration {
  return {
    // Every bundled GLB has a 100x armature scale above Head. Counter it here;
    // the avatar root's ~2.3x display scale then restores head-sized props.
    scale: 0.0043,
    front: 1,
  }
}

/**
 * Measures the skull, face and eyes of a skinned avatar in Head-bone space
 * (bind pose, in calibration units) so hats and glasses fit each model: a hat
 * band sits just outside the hair, lenses sit just in front of the face, and
 * temple arms run back along the side of the head instead of sticking out.
 * Returns null when the rig has no skinned head geometry to measure.
 */
export function measureHeadFit(
  avatarRoot: THREE.Object3D,
  headBone: THREE.Bone,
  scale: number
): HeadFit | null {
  const skull: THREE.Vector3[] = []
  const skin: THREE.Vector3[] = []
  const eyes: THREE.Vector3[] = []
  const toHead = new THREE.Matrix4()
  const point = new THREE.Vector3()
  avatarRoot.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.visible || /outline/i.test(mesh.name)) return
    const headIndex = mesh.skeleton.bones.indexOf(headBone)
    if (headIndex < 0) return
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    if (!position || !skinIndex || !skinWeight) return
    toHead.multiplyMatrices(mesh.skeleton.boneInverses[headIndex]!, mesh.bindMatrix)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const name = materials[0]?.name ?? ''
    const kind = /^eye$/i.test(name)
      ? 'eye'
      : /^skin/i.test(name)
        ? 'skin'
        : /moustache|beard|earring/i.test(name)
          ? 'detail'
          : 'skull'
    if (kind === 'detail') return
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let weight = 0
      for (let slot = 0; slot < 4; slot += 1) {
        if (skinIndex.getComponent(vertex, slot) === headIndex) weight += skinWeight.getComponent(vertex, slot)
      }
      if (weight < 0.5) continue
      point.fromBufferAttribute(position, vertex).applyMatrix4(toHead).divideScalar(scale)
      const copy = point.clone()
      if (kind === 'eye') eyes.push(copy)
      else {
        skull.push(copy)
        if (kind === 'skin') skin.push(copy)
      }
    }
  })
  if (skin.length < 20 || skull.length < 20) return null

  const eyeBox = eyes.length >= 6 ? new THREE.Box3().setFromPoints(eyes) : null
  const skinBox = new THREE.Box3().setFromPoints(skin)
  const eyeY = eyeBox ? (eyeBox.min.y + eyeBox.max.y) / 2 : skinBox.min.y + (skinBox.max.y - skinBox.min.y) * 0.5
  const eyeX = eyeBox ? Math.max(0.06, (eyeBox.max.x - eyeBox.min.x) / 2 - (eyeBox.max.x - eyeBox.min.x) / 8) : 0.1
  // The skull above the eyes decides hat size; narrow tufts (a mohawk, a
  // ponytail) are ignored when finding where a hat would rest.
  const upper = skull.filter(p => p.y > eyeY)
  let halfWidth = 0
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of upper) {
    halfWidth = Math.max(halfWidth, Math.abs(p.x))
  }
  let top = -Infinity
  for (const p of upper) {
    if (Math.abs(p.x) > halfWidth * 0.3) top = Math.max(top, p.y)
    if (p.y > eyeY + 0.08 && p.y < eyeY + 0.3) {
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
  }
  if (!Number.isFinite(top) || !Number.isFinite(minZ)) return null
  let eyeFront = -Infinity
  let faceHalfWidth = 0
  for (const p of skin) {
    if (Math.abs(p.y - eyeY) < 0.045) eyeFront = Math.max(eyeFront, p.z)
    if (Math.abs(p.y - eyeY) < 0.07) faceHalfWidth = Math.max(faceHalfWidth, Math.abs(p.x))
  }
  if (!Number.isFinite(eyeFront)) eyeFront = skinBox.max.z
  // Built-in headwear (the worker's hard hat) makes the skull look huge;
  // clamp to a sane head so glasses still fit.
  halfWidth = Math.min(halfWidth, Math.max(faceHalfWidth * 1.3, 0.2))
  // Walk down from the top until the skull is wide enough to hold a crown.
  let crownSeatY = top - 0.07
  for (let y = top; y > eyeY + 0.1; y -= 0.01) {
    let widthHere = 0
    for (const p of upper) if (Math.abs(p.y - y) < 0.02) widthHere = Math.max(widthHere, Math.abs(p.x))
    if (widthHere >= halfWidth * 0.66) {
      crownSeatY = y
      break
    }
  }
  return {
    crownSeatY,
    halfWidth,
    top,
    centerZ: (minZ + maxZ) / 2,
    depth: Math.max(0.15, (maxZ - minZ) / 2),
    eyeY,
    eyeFront,
    eyeX,
    faceHalfWidth: Math.max(faceHalfWidth, eyeX + 0.08),
  }
}

function createHeadAccessories(
  hat: PlayerAvatarHatStyle,
  glasses: PlayerAvatarGlassesStyle,
  calibration: HeadAccessoryCalibration,
  fit: HeadFit,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-head-accessories-${hat}-${glasses}`

  // Pieces are modelled facing +Z; heads that face -Z get the group turned.
  const glassesGroup = createGlasses(glasses, calibration, fit, materials)
  const hatGroup = createHat(hat, calibration, fit, materials)
  if (calibration.front < 0) {
    for (const piece of [glassesGroup, hatGroup]) {
      piece.position.z *= -1
      piece.rotation.y += Math.PI
    }
  }
  group.add(glassesGroup, hatGroup)
  return group
}

function createGlasses(
  style: PlayerAvatarGlassesStyle,
  calibration: HeadAccessoryCalibration,
  fit: HeadFit,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-glasses-${style}`
  if (style === 'none') return group

  const s = calibration.scale
  const frame = standardMaterial(style === 'aviator' ? '#c8a95f' : '#171a1c', {
    roughness: 0.28,
    metalness: 0.78,
  })
  const lens = standardMaterial(style === 'shades' ? '#071014' : '#273b42', {
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: style === 'shades' ? 0.92 : 0.3,
  })
  materials.push(frame, lens)

  // Lenses sit just in front of the face at eye height.
  const lensZ = fit.eyeFront + 0.035
  group.position.set(0, fit.eyeY * s, lensZ * s)
  const eyeX = fit.eyeX
  const radius = Math.min(0.1, Math.max(0.06, eyeX * 0.82))

  if (style === 'shades') {
    for (const side of [-1, 1]) {
      const glass = mesh(
        new THREE.BoxGeometry(radius * 2.15 * s, radius * 1.15 * s, 0.022 * s),
        lens,
        [side * eyeX * s, 0, 0]
      )
      glass.rotation.z = side * 0.04
      glass.rotation.y = side * 0.12
      group.add(glass)
    }
  } else {
    for (const side of [-1, 1]) {
      const rim = mesh(
        new THREE.TorusGeometry((style === 'aviator' ? radius * 1.06 : radius) * s, 0.011 * s, 6, 24),
        frame,
        [side * eyeX * s, 0, 0]
      )
      if (style === 'aviator') rim.scale.set(1.05, 0.84, 1)
      rim.rotation.y = side * 0.1
      group.add(rim)
      const glass = mesh(
        new THREE.CircleGeometry(radius * 0.93 * s, 24),
        lens,
        [side * eyeX * s, 0, 0.004 * s]
      )
      if (style === 'aviator') glass.scale.set(1.05, 0.84, 1)
      glass.rotation.y = side * 0.1
      group.add(glass)
    }
  }

  // Bridge over the nose.
  group.add(mesh(
    new THREE.BoxGeometry(Math.max(0.03, eyeX * 2 - radius * 2 + 0.02) * s, 0.014 * s, 0.014 * s),
    frame,
    [0, 0.012 * s, 0]
  ))
  // Temple arms: a short hinge out to the side of the head, then back along
  // it to the ear — hugging the head, never sticking out.
  const templeX = Math.max(fit.faceHalfWidth, eyeX + radius) + 0.012
  const armBack = Math.max(0.12, lensZ - (fit.centerZ - 0.02))
  for (const side of [-1, 1]) {
    const hingeWidth = Math.max(0.01, templeX - (eyeX + radius * 0.95))
    group.add(mesh(
      new THREE.BoxGeometry(hingeWidth * s, 0.016 * s, 0.016 * s),
      frame,
      [side * (templeX - hingeWidth / 2) * s, 0.01 * s, -0.012 * s]
    ))
    group.add(mesh(
      new THREE.BoxGeometry(0.014 * s, 0.016 * s, armBack * s),
      frame,
      [side * templeX * s, 0.01 * s, -(armBack / 2 + 0.012) * s]
    ))
  }

  return group
}

/** A hat brim: a flat ring whose outer edge curls up by `curl`. */
function createBrimGeometry(inner: number, outer: number, curl: number, thickness: number) {
  const profile = [
    new THREE.Vector2(inner, 0),
    new THREE.Vector2(inner + (outer - inner) * 0.55, -thickness * 0.2),
    new THREE.Vector2(outer * 0.97, curl * 0.7),
    new THREE.Vector2(outer, curl + thickness * 0.5),
    new THREE.Vector2(outer * 0.97, curl + thickness),
    new THREE.Vector2(inner + (outer - inner) * 0.55, thickness * 0.8),
    new THREE.Vector2(inner, thickness),
    new THREE.Vector2(inner, 0),
  ]
  return new THREE.LatheGeometry(profile, 40)
}

function createHat(
  style: PlayerAvatarHatStyle,
  calibration: HeadAccessoryCalibration,
  fit: HeadFit,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-hat-${style}`
  if (style === 'none') return group

  const s = calibration.scale
  const colors: Record<Exclude<PlayerAvatarHatStyle, 'none'>, [string, string]> = {
    fedora: ['#3a3230', '#8d283e'],
    cowboy: ['#7a5234', '#3b2618'],
    beanie: ['#9b2d45', '#efe4cc'],
    visor: ['#1c5b48', '#123d31'],
    crown: ['#d8ad43', '#c0392b'],
  }
  const [primaryColor, trimColor] = colors[style]
  const primary = standardMaterial(primaryColor, {
    roughness: style === 'crown' ? 0.24 : 0.72,
    metalness: style === 'crown' ? 0.72 : 0.04,
  })
  const trim = standardMaterial(trimColor, {
    roughness: style === 'crown' ? 0.3 : 0.5,
    metalness: style === 'crown' ? 0.4 : 0.05,
  })
  primary.side = THREE.DoubleSide
  trim.side = THREE.DoubleSide
  materials.push(primary, trim)

  // Everything is placed relative to the measured skull, centred front/back.
  const width = fit.halfWidth
  const depthScale = THREE.MathUtils.clamp(fit.depth / width, 0.8, 1.25)
  group.position.set(0, 0, fit.centerZ * s)
  const oval = (object: THREE.Object3D) => {
    object.scale.z *= depthScale
    return object
  }

  if (style === 'beanie') {
    // Knit cap hugging the skull down to the brow, a folded cuff and a pom-pom.
    const radius = width * 1.2
    const cuffY = fit.eyeY + 0.13
    const domeHeight = Math.max(0.2, fit.top + 0.06 - cuffY)
    const dome = oval(mesh(
      new THREE.SphereGeometry(radius * s, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      primary,
      [0, cuffY * s, 0]
    ))
    dome.scale.y = domeHeight / radius
    group.add(dome)
    // A thick, folded-up cuff in a contrasting knit.
    const cuff = mesh(
      new THREE.TorusGeometry(radius * 1.02 * s, 0.05 * s, 8, 32),
      trim,
      [0, (cuffY + 0.03) * s, 0],
      [Math.PI / 2, 0, 0]
    )
    // Lying flat, the torus's local Y runs front-to-back and Z runs up.
    cuff.scale.set(1, depthScale, 1.5)
    group.add(cuff)
    group.add(mesh(
      new THREE.SphereGeometry(0.075 * s, 14, 10),
      trim,
      [0, (cuffY + domeHeight + 0.045) * s, 0]
    ))
    return group
  }

  if (style === 'visor') {
    // A sweatband around the forehead with a bill out front.
    const bandY = fit.eyeY + 0.17
    const radius = width * 1.04
    group.add(oval(mesh(
      new THREE.CylinderGeometry(radius * s, radius * s, 0.07 * s, 32, 1, true),
      trim,
      [0, bandY * s, 0]
    )))
    const bill = mesh(
      new THREE.CylinderGeometry(radius * 0.95 * s, radius * 0.95 * s, 0.022 * s, 28, 1, false, -Math.PI / 2, Math.PI),
      primary,
      [0, (bandY - 0.03) * s, 0]
    )
    bill.scale.z = (fit.depth * 1.6) / radius
    bill.rotation.x = 0.16
    group.add(bill)
    return group
  }

  if (style === 'crown') {
    // A small crown perched on top of the head.
    const radius = width * 0.64
    const baseY = (fit.crownSeatY ?? fit.top - 0.07) + 0.02
    group.add(oval(mesh(
      new THREE.CylinderGeometry(radius * s, radius * 0.94 * s, 0.09 * s, 28, 1, true),
      primary,
      [0, baseY * s, 0]
    )))
    for (let index = 0; index < 7; index += 1) {
      const angle = index / 7 * Math.PI * 2
      const spike = mesh(
        new THREE.ConeGeometry(0.036 * s, 0.13 * s, 4),
        primary,
        [Math.sin(angle) * radius * 0.97 * s, (baseY + 0.1) * s, Math.cos(angle) * radius * depthScale * 0.97 * s]
      )
      group.add(spike)
      group.add(mesh(
        new THREE.SphereGeometry(0.02 * s, 8, 6),
        trim,
        [Math.sin(angle) * radius * 1.01 * s, baseY * s, Math.cos(angle) * radius * depthScale * 1.01 * s]
      ))
    }
    return group
  }

  // Fedora and cowboy: a tapered crown with a pinched top, a band, and a
  // brim that curls up at the edge (much wider and curlier for the cowboy).
  const cowboy = style === 'cowboy'
  const crownRadius = width * 1.06
  const bandY = fit.top - (cowboy ? 0.2 : 0.19)
  const crownHeight = cowboy ? 0.25 : 0.21
  const crown = oval(mesh(
    new THREE.CylinderGeometry(crownRadius * (cowboy ? 0.82 : 0.86) * s, crownRadius * s, crownHeight * s, 28, 1, true),
    primary,
    [0, (bandY + crownHeight / 2) * s, 0]
  ))
  group.add(crown)
  // Pinched top: a shallow dome with a front-to-back crease.
  const cap = oval(mesh(
    new THREE.SphereGeometry(crownRadius * (cowboy ? 0.82 : 0.86) * s, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    primary,
    [0, (bandY + crownHeight) * s, 0]
  ))
  cap.scale.y = cowboy ? 0.2 : 0.26
  cap.scale.x = 0.92
  group.add(cap)
  const crease = mesh(
    new THREE.BoxGeometry(0.02 * s, 0.03 * s, crownRadius * 1.3 * depthScale * s),
    trim,
    [0, (bandY + crownHeight + 0.03) * s, 0]
  )
  crease.visible = !cowboy
  group.add(crease)
  group.add(oval(mesh(
    new THREE.CylinderGeometry(crownRadius * 1.012 * s, crownRadius * 1.012 * s, 0.055 * s, 28, 1, true),
    trim,
    [0, (bandY + 0.035) * s, 0]
  )))
  const brim = oval(mesh(
    createBrimGeometry(crownRadius * 0.98 * s, crownRadius * (cowboy ? 1.95 : 1.5) * s, (cowboy ? 0.1 : 0.035) * s, 0.018 * s),
    primary,
    [0, bandY * s, 0]
  ))
  // Fedoras snap down a touch at the front; cowboy brims roll up at the sides.
  brim.rotation.x = cowboy ? 0 : 0.07
  if (cowboy) brim.scale.z *= 0.82
  group.add(brim)
  return group
}

function createJacket(
  style: PlayerAvatarJacketStyle,
  colorKey: PlayerAvatarJacketColor,
  calibration: { front: number; centerY: number; centerZ: number; scale: number; fitted?: boolean },
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-jacket-${style}-${colorKey}`
  if (style === 'none') return group

  const scale = calibration.scale
  const front = calibration.front
  const color = AVATAR_JACKET_COLOR_HEX[colorKey]
  const body = standardMaterial(style === 'tuxedo' ? '#16191d' : color, {
    roughness: style === 'leather' ? 0.3 : 0.64,
    metalness: style === 'leather' ? 0.3 : 0.08,
  })
  const trimColor = style === 'varsity'
    ? '#ded5bd'
    : style === 'western'
      ? '#b58b51'
      : style === 'smoking' || style === 'tuxedo'
        ? '#d8b768'
        : '#2b2022'
  const trim = standardMaterial(trimColor, { roughness: 0.48, metalness: 0.22 })
  materials.push(body, trim)

  group.position.set(0, calibration.centerY, calibration.centerZ)
  for (const side of [-1, 1]) {
    if (!calibration.fitted) {
      const panel = mesh(
        new THREE.BoxGeometry(
          (style === 'western' ? 0.24 : 0.31) * scale,
          0.64 * scale,
          0.12 * scale
        ),
        body,
        [side * 0.17 * scale, 0, front * 0.035 * scale]
      )
      panel.rotation.z = side * (style === 'western' ? 0.025 : 0.045)
      group.add(panel)
    }

    const lapel = mesh(
      new THREE.BoxGeometry(
        (calibration.fitted ? 0.055 : 0.085) * scale,
        (calibration.fitted ? 0.34 : 0.43) * scale,
        0.035 * scale
      ),
      trim,
      [
        side * (calibration.fitted ? 0.072 : 0.085) * scale,
        0.07 * scale,
        front * (calibration.fitted ? 0.08 : 0.105) * scale,
      ]
    )
    lapel.rotation.z = side * (calibration.fitted ? 0.36 : 0.3)
    group.add(lapel)
  }

  if (style === 'varsity') {
    group.add(mesh(
      new THREE.BoxGeometry(0.66 * scale, 0.055 * scale, 0.13 * scale),
      trim,
      [0, -0.3 * scale, front * 0.03 * scale]
    ))
  }
  if (style === 'leather') {
    const zipper = mesh(
      new THREE.BoxGeometry(0.022 * scale, 0.56 * scale, 0.025 * scale),
      trim,
      [0, -0.01 * scale, front * 0.115 * scale]
    )
    zipper.rotation.z = -0.08
    group.add(zipper)
  }
  if (style === 'western') {
    for (const side of [-1, 1]) {
      group.add(mesh(
        new THREE.BoxGeometry(0.1 * scale, 0.02 * scale, 0.025 * scale),
        trim,
        [side * 0.17 * scale, 0.12 * scale, front * 0.11 * scale]
      ))
    }
  }

  return group
}

interface ChestBadgeSpot {
  /** Point on the shirt surface (chest units) and the outward surface normal. */
  position: THREE.Vector3
  normal: THREE.Vector3
}

/**
 * Finds a spot on the wearer's left breast, on the surface of the part of the
 * shirt that moves with the Chest bone, so a badge stays flush with the shirt
 * through every lean and twist (never drifting down to the belly).
 */
export function measureChestBadgeSpot(
  avatarRoot: THREE.Object3D,
  chestBone: THREE.Bone,
  scale: number
): ChestBadgeSpot | null {
  const points: THREE.Vector3[] = []
  const toChest = new THREE.Matrix4()
  avatarRoot.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.visible || /outline/i.test(mesh.name)) return
    const chestIndex = mesh.skeleton.bones.indexOf(chestBone)
    if (chestIndex < 0) return
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    if (!position || !skinIndex || !skinWeight) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (material && /skin/i.test(material.name)) return
    toChest.multiplyMatrices(mesh.skeleton.boneInverses[chestIndex]!, mesh.bindMatrix)
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let weight = 0
      for (let slot = 0; slot < 4; slot += 1) {
        if (skinIndex.getComponent(vertex, slot) === chestIndex) weight += skinWeight.getComponent(vertex, slot)
      }
      if (weight < 0.75) continue
      points.push(new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(toChest).divideScalar(scale))
    }
  })
  if (points.length < 30) return null
  const box = new THREE.Box3().setFromPoints(points)
  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  const targetX = (box.min.x + box.max.x) / 2 + width * 0.2
  const targetY = box.min.y + height * 0.62
  let best: THREE.Vector3 | null = null
  for (const point of points) {
    if (Math.abs(point.x - targetX) > width * 0.08 || Math.abs(point.y - targetY) > height * 0.12) continue
    if (!best || point.z > best.z) best = point
  }
  if (!best) return null
  // Surface normal from the front-most points around the spot.
  const near = points.filter(point => point.distanceTo(best!) < Math.max(width, height) * 0.15 && point.z > best!.z - height * 0.12)
  const center = near.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(Math.max(1, near.length))
  const normal = new THREE.Vector3(center.x - (box.min.x + box.max.x) / 2, 0, center.z - (box.min.z + box.max.z) / 2 + width * 0.5)
  if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1)
  normal.normalize()
  return { position: best.clone(), normal }
}

/**
 * Rigged jackets recolour the model's own clothing; this adds one small,
 * flush accent on the left breast (pin, pocket square, patch) attached to
 * the Chest bone.
 */
function createFittedJacketAccent(
  style: PlayerAvatarJacketStyle,
  colorKey: PlayerAvatarJacketColor,
  spot: ChestBadgeSpot | null,
  scale: number,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-jacket-${style}-${colorKey}`
  if (style === 'none') return group
  const color = style === 'varsity'
    ? '#ded5bd'
    : style === 'western'
      ? '#b58b51'
      : style === 'leather'
        ? '#b9bec4'
        : '#d8b768'
  const material = standardMaterial(color, {
    roughness: 0.45,
    metalness: style === 'leather' || style === 'tuxedo' || style === 'smoking' ? 0.6 : 0.1,
  })
  materials.push(material)
  const position = spot?.position ?? new THREE.Vector3(0.1, 0.1, 0.16)
  const normal = spot?.normal ?? new THREE.Vector3(0, 0, 1)
  const size = style === 'varsity' ? [0.09, 0.1] : style === 'western' ? [0.1, 0.045] : style === 'leather' ? [0.02, 0.07] : [0.07, 0.035]
  const accent = mesh(
    new THREE.BoxGeometry(size[0]! * scale, size[1]! * scale, 0.014 * scale),
    material
  )
  accent.name = 'avatar-jacket-accent'
  // Sit a hair outside the surface, facing along its normal.
  accent.position.copy(position).addScaledVector(normal, 0.006).multiplyScalar(scale)
  accent.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  accent.castShadow = false
  group.add(accent)
  return group
}

function createEmptyJacketGroup(
  style: PlayerAvatarJacketStyle,
  colorKey: PlayerAvatarJacketColor
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-jacket-${style}-${colorKey}`
  return group
}

function applyRiggedJacketMaterial(
  avatarRoot: THREE.Object3D,
  modelKey: PlayerAvatarModelKey,
  style: PlayerAvatarJacketStyle,
  colorKey: PlayerAvatarJacketColor
): { materials: THREE.Material[]; restore?: () => void } {
  if (style === 'none') return { materials: [] }

  const target = avatarRoot.getObjectByName(RIGGED_JACKET_TARGETS[modelKey]) as
    | THREE.Mesh
    | undefined
  if (!target?.isMesh || !target.material) return { materials: [] }

  // GLTF primitives may share one material across a jacket, shoes, backpack,
  // or built-in helmet. Clone only the intended clothing primitive so one
  // cosmetic choice cannot recolor the rest of the model.
  const originalMaterial = target.material
  const sourceMaterials = Array.isArray(originalMaterial)
    ? originalMaterial
    : [originalMaterial]
  const clonedMaterials = sourceMaterials.map(material => material.clone())
  target.material = Array.isArray(originalMaterial)
    ? clonedMaterials
    : clonedMaterials[0]!

  const selectedColor = style === 'tuxedo'
    ? '#222838'
    : style === 'leather'
      ? new THREE.Color(AVATAR_JACKET_COLOR_HEX[colorKey]).multiplyScalar(0.7)
      : AVATAR_JACKET_COLOR_HEX[colorKey]
  clonedMaterials.forEach(material => {
    // Rigged bodies are already toon-shaded by stylizeAvatar; clones drop the
    // shared look hook, so re-apply it along with the chosen colour.
    if ((material as THREE.MeshToonMaterial).isMeshToonMaterial) {
      const toon = material as THREE.MeshToonMaterial
      toon.color.set(selectedColor)
      if (style === 'leather') toon.color.offsetHSL(0, -0.05, 0.02)
      applyAvatarToonLook(toon)
      return
    }
    if (!(material instanceof THREE.MeshStandardMaterial)) return
    material.color.set(selectedColor)
    material.roughness = style === 'leather' ? 0.3 : style === 'smoking' ? 0.52 : 0.62
    material.metalness = style === 'leather' ? 0.28 : 0.08
    material.needsUpdate = true
  })

  return {
    materials: clonedMaterials,
    restore: () => {
      target.material = originalMaterial
    },
  }
}

function applyRiggedHeadwearCompatibility(
  avatarRoot: THREE.Object3D,
  modelKey: PlayerAvatarModelKey,
  hat: PlayerAvatarHatStyle
): (() => void) | undefined {
  if (hat === 'none') return undefined

  const meshName = modelKey === 'worker'
    ? 'Worker_Head_1'
    : modelKey === 'punk' && ['fedora', 'cowboy', 'beanie'].includes(hat)
      ? 'Punk_Head_4'
      : undefined
  if (!meshName) return undefined

  const builtInHeadwear = avatarRoot.getObjectByName(meshName)
  if (!builtInHeadwear) return undefined

  const wasVisible = builtInHeadwear.visible
  builtInHeadwear.visible = false
  return () => {
    builtInHeadwear.visible = wasVisible
  }
}

function standardMaterial(
  color: string,
  parameters: Omit<THREE.MeshStandardMaterialParameters, 'color'> = {}
): THREE.MeshStandardMaterial | THREE.MeshToonMaterial {
  // Opaque accessories share the avatars' toon look (hats, frames, lapels) so
  // they don't read as glossy plastic on a cel-shaded body; glass stays PBR.
  if (!parameters.transparent) {
    return createAvatarToonMaterial(color, { metallic: (parameters.metalness ?? 0) >= 0.5 })
  }
  return new THREE.MeshStandardMaterial({ color, ...parameters })
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0]
): THREE.Mesh {
  const value = new THREE.Mesh(geometry, material)
  value.position.set(...position)
  value.rotation.set(...rotation)
  value.castShadow = true
  value.receiveShadow = true
  return value
}
