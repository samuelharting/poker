import * as THREE from 'three'
import type {
  PlayerAvatarCustomization,
  PlayerAvatarGlassesStyle,
  PlayerAvatarHatStyle,
  PlayerAvatarJacketColor,
  PlayerAvatarJacketStyle,
  PlayerAvatarModelKey,
} from '@/lib/profile'

type CosmeticSelection = Pick<
  PlayerAvatarCustomization,
  'hat' | 'glasses' | 'jacket' | 'jacketColor'
>

type RiggedCosmeticSelection = CosmeticSelection & Pick<PlayerAvatarCustomization, 'modelKey'>

export const AVATAR_JACKET_COLOR_HEX: Record<PlayerAvatarJacketColor, string> = {
  burgundy: '#6f2138',
  midnight: '#17253d',
  emerald: '#1c5746',
  ivory: '#d8cfb8',
  gold: '#a77a2e',
  violet: '#52366f',
}

export interface AvatarAccessorySet {
  groups: THREE.Group[]
  materials: THREE.Material[]
  restores?: Array<() => void>
}

interface HeadAccessoryCalibration {
  scale: number
  front: number
  eyeY: number
  eyeDepth: number
  hatY: number
}

const FALLBACK_HEAD: HeadAccessoryCalibration = {
  scale: 1,
  front: -1,
  eyeY: 0.035,
  eyeDepth: 0.355,
  hatY: 0.37,
}

const RIGGED_ROOT_HEAD: HeadAccessoryCalibration = {
  scale: 0.43,
  front: 1,
  eyeY: 0.035,
  eyeDepth: 0.355,
  hatY: 0.385,
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
  const headGroup = createHeadAccessories(selection.hat, selection.glasses, FALLBACK_HEAD, materials)
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
  const headBone = bones.get('Head')
  const headCalibration = headBone
    ? getRiggedHeadCalibration(selection.modelKey, selection.hat)
    : RIGGED_ROOT_HEAD
  const headGroup = createHeadAccessories(
    selection.hat,
    selection.glasses,
    headCalibration,
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
    ? createJacket(selection.jacket, selection.jacketColor, {
        front: 1,
        centerY: 0.02 * 0.0043,
        centerZ: 0.12 * 0.0043,
        scale: 0.0043,
        fitted: true,
      }, materials)
    : createEmptyJacketGroup(selection.jacket, selection.jacketColor)
  const jacketParent = chestBone ?? avatarRoot
  jacketParent.add(jacketGroup)

  const restores: Array<() => void> = []
  const restoreHeadwear = applyRiggedHeadwearCompatibility(
    avatarRoot,
    selection.modelKey,
    selection.hat
  )
  if (restoreHeadwear) restores.push(restoreHeadwear)

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

function getRiggedHeadCalibration(
  modelKey: PlayerAvatarModelKey,
  hat: PlayerAvatarHatStyle
): HeadAccessoryCalibration {
  let hatY = 0.5
  if (modelKey === 'hoodie') hatY = 0.53
  if (modelKey === 'worker') hatY = 0.4
  if (modelKey === 'punk') {
    hatY = hat === 'crown'
      ? 0.67
      : hat === 'visor'
        ? 0.39
        : 0.46
  }

  return {
    // Every bundled GLB has a 100x armature scale above Head. Counter it here;
    // the avatar root's ~2.3x display scale then restores head-sized props.
    scale: 0.0043,
    front: 1,
    eyeY: 0.26,
    eyeDepth: 0.29,
    hatY,
  }
}

function createHeadAccessories(
  hat: PlayerAvatarHatStyle,
  glasses: PlayerAvatarGlassesStyle,
  calibration: HeadAccessoryCalibration,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-head-accessories-${hat}-${glasses}`

  const glassesGroup = createGlasses(glasses, calibration, materials)
  group.add(glassesGroup)

  const hatGroup = createHat(hat, calibration, materials)
  group.add(hatGroup)

  return group
}

function createGlasses(
  style: PlayerAvatarGlassesStyle,
  calibration: HeadAccessoryCalibration,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-glasses-${style}`
  if (style === 'none') return group

  const scale = calibration.scale
  const frame = standardMaterial(style === 'aviator' ? '#c8a95f' : '#171a1c', {
    roughness: 0.28,
    metalness: 0.78,
  })
  const lens = standardMaterial(style === 'shades' ? '#071014' : '#273b42', {
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: style === 'shades' ? 0.92 : 0.36,
  })
  materials.push(frame, lens)

  const front = calibration.front
  group.position.set(
    0,
    calibration.eyeY * scale,
    front * calibration.eyeDepth * scale
  )

  if (style === 'shades') {
    for (const side of [-1, 1]) {
      const glass = mesh(
        new THREE.BoxGeometry(0.235 * scale, 0.12 * scale, 0.025 * scale),
        lens,
        [side * 0.135 * scale, 0, 0]
      )
      glass.rotation.z = side * 0.035
      group.add(glass)
    }
  } else {
    for (const side of [-1, 1]) {
      const rim = mesh(
        new THREE.TorusGeometry(
          (style === 'aviator' ? 0.112 : 0.105) * scale,
          0.014 * scale,
          6,
          24
        ),
        frame,
        [side * 0.132 * scale, 0, 0]
      )
      if (style === 'aviator') rim.scale.set(1.08, 0.82, 1)
      group.add(rim)

      const glass = mesh(
        new THREE.CircleGeometry(0.094 * scale, 24),
        lens,
        [side * 0.132 * scale, 0, front * 0.009 * scale]
      )
      if (style === 'aviator') glass.scale.set(1.08, 0.82, 1)
      group.add(glass)
    }
  }

  group.add(mesh(
    new THREE.BoxGeometry(0.08 * scale, 0.018 * scale, 0.02 * scale),
    frame,
    [0, 0.005 * scale, 0]
  ))
  for (const side of [-1, 1]) {
    const arm = mesh(
      new THREE.BoxGeometry(0.16 * scale, 0.018 * scale, 0.018 * scale),
      frame,
      [side * 0.27 * scale, 0.012 * scale, -front * 0.055 * scale]
    )
    arm.rotation.y = side * front * 0.3
    group.add(arm)
  }

  return group
}

function createHat(
  style: PlayerAvatarHatStyle,
  calibration: HeadAccessoryCalibration,
  materials: THREE.Material[]
): THREE.Group {
  const group = new THREE.Group()
  group.name = `avatar-hat-${style}`
  if (style === 'none') return group

  const scale = calibration.scale
  const primary = standardMaterial(
    style === 'crown' ? '#d8ad43' : style === 'visor' ? '#1c5b48' : '#252229',
    { roughness: style === 'crown' ? 0.24 : 0.68, metalness: style === 'crown' ? 0.72 : 0.08 }
  )
  const trim = standardMaterial(
    style === 'crown' ? '#f3de83' : style === 'cowboy' ? '#b88442' : '#8d283e',
    { roughness: 0.42, metalness: style === 'crown' ? 0.56 : 0.16 }
  )
  materials.push(primary, trim)

  const front = calibration.front
  group.position.set(0, calibration.hatY * scale, 0)

  if (style === 'beanie') {
    const cap = mesh(
      new THREE.SphereGeometry(0.315 * scale, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56),
      primary
    )
    cap.scale.y = 0.76
    group.add(cap)
    group.add(mesh(
      new THREE.TorusGeometry(0.255 * scale, 0.035 * scale, 8, 28),
      trim,
      [0, -0.02 * scale, 0],
      [Math.PI / 2, 0, 0]
    ))
    return group
  }

  if (style === 'crown') {
    group.add(mesh(
      new THREE.CylinderGeometry(0.27 * scale, 0.27 * scale, 0.105 * scale, 24),
      primary,
      [0, 0.02 * scale, 0]
    ))
    for (let index = 0; index < 7; index += 1) {
      const angle = index / 7 * Math.PI * 2
      group.add(mesh(
        new THREE.ConeGeometry(0.058 * scale, 0.22 * scale, 5),
        index % 2 === 0 ? trim : primary,
        [
          Math.cos(angle) * 0.205 * scale,
          0.16 * scale,
          Math.sin(angle) * 0.205 * scale,
        ]
      ))
    }
    return group
  }

  if (style === 'visor') {
    group.add(mesh(
      new THREE.TorusGeometry(0.255 * scale, 0.052 * scale, 8, 32),
      primary,
      [0, 0, 0],
      [Math.PI / 2, 0, 0]
    ))
    const bill = mesh(
      new THREE.CylinderGeometry(0.29 * scale, 0.29 * scale, 0.028 * scale, 32, 1, false, 0, Math.PI),
      trim,
      [0, -0.04 * scale, front * 0.22 * scale]
    )
    bill.scale.z = 0.62
    group.add(bill)
    return group
  }

  const brim = mesh(
    new THREE.CylinderGeometry(
      (style === 'cowboy' ? 0.44 : 0.37) * scale,
      (style === 'cowboy' ? 0.44 : 0.37) * scale,
      0.035 * scale,
      36
    ),
    primary,
    [0, 0, 0]
  )
  brim.scale.z = style === 'cowboy' ? 0.68 : 0.82
  if (style === 'cowboy') brim.rotation.z = 0.035
  group.add(brim)

  const crown = mesh(
    new THREE.CylinderGeometry(
      (style === 'cowboy' ? 0.19 : 0.205) * scale,
      0.25 * scale,
      (style === 'cowboy' ? 0.31 : 0.25) * scale,
      28
    ),
    primary,
    [0, (style === 'cowboy' ? 0.17 : 0.14) * scale, 0]
  )
  crown.scale.z = 0.88
  group.add(crown)
  group.add(mesh(
    new THREE.TorusGeometry(0.225 * scale, 0.026 * scale, 6, 32),
    trim,
    [0, 0.07 * scale, 0],
    [Math.PI / 2, 0, 0]
  ))
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
    ? '#15191f'
    : style === 'leather'
      ? new THREE.Color(AVATAR_JACKET_COLOR_HEX[colorKey]).multiplyScalar(0.58)
      : AVATAR_JACKET_COLOR_HEX[colorKey]
  clonedMaterials.forEach(material => {
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
): THREE.MeshStandardMaterial {
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
