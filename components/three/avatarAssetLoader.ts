import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import {
  getAvatarModelConfig,
  type RealisticAvatarModelConfig,
  type RealisticAvatarModelKey,
} from './avatarModelCatalog'

export const AVATAR_CLIP_NAMES = {
  idleNeutral: 'CharacterArmature|Idle_Neutral',
  interact: 'CharacterArmature|Interact',
  wave: 'CharacterArmature|Wave',
  hitReceive: 'CharacterArmature|HitRecieve',
} as const

export type AvatarClipRole = keyof typeof AVATAR_CLIP_NAMES

export type AvatarClipSet = Readonly<Record<AvatarClipRole, THREE.AnimationClip | undefined>>

export interface AvatarAssetTemplate {
  modelKey: RealisticAvatarModelKey
  path: string
  config: RealisticAvatarModelConfig
  scene: THREE.Group
  animations: readonly THREE.AnimationClip[]
  clips: AvatarClipSet
}

export interface AvatarAssetInstance {
  modelKey: RealisticAvatarModelKey
  path: string
  /** Catalog-calibrated root. Add this group to a seat or another animation pivot. */
  root: THREE.Group
  /** Skeleton-safe clone of the cached GLTF scene. Geometry remains shared. */
  model: THREE.Object3D
  animations: readonly THREE.AnimationClip[]
  clips: AvatarClipSet
  bones: ReadonlyMap<string, THREE.Bone>
  /** Materials cloned specifically for this instance and safe to mutate or dispose. */
  materials: readonly THREE.Material[]
}

export interface DisposeAvatarAssetInstanceOptions {
  mixer?: THREE.AnimationMixer
  /** Defaults to the catalog-calibrated instance root. */
  mixerRoot?: THREE.Object3D
}

const avatarLoader = new GLTFLoader()
const avatarTemplateCache = new Map<string, Promise<AvatarAssetTemplate>>()
const disposedAvatarRoots = new WeakSet<THREE.Object3D>()
const AVATAR_LOAD_TIMEOUT_MS = 20_000

export function getAvatarAssetCacheKey(modelKey: RealisticAvatarModelKey): string {
  const { path } = getAvatarModelConfig(modelKey)
  return `${modelKey}:${path}`
}

export function loadAvatarAssetTemplate(
  modelKey: RealisticAvatarModelKey
): Promise<AvatarAssetTemplate> {
  const cacheKey = getAvatarAssetCacheKey(modelKey)
  const cached = avatarTemplateCache.get(cacheKey)
  if (cached) return cached

  const config = getAvatarModelConfig(modelKey)
  let request: Promise<AvatarAssetTemplate>

  request = withTimeout(
    avatarLoader.loadAsync(config.path),
    AVATAR_LOAD_TIMEOUT_MS,
    `Timed out loading avatar asset ${config.path}`
  )
    .then(gltf => createAvatarAssetTemplate(modelKey, config, gltf))
    .catch(error => {
      // Failed requests must be retryable. Only remove the exact request that failed,
      // because a test or future cache reset may already have installed a replacement.
      if (avatarTemplateCache.get(cacheKey) === request) {
        avatarTemplateCache.delete(cacheKey)
      }
      throw error
    })

  avatarTemplateCache.set(cacheKey, request)
  return request
}

export async function createAvatarAssetInstance(
  modelKey: RealisticAvatarModelKey
): Promise<AvatarAssetInstance> {
  const template = await loadAvatarAssetTemplate(modelKey)
  return createAvatarAssetInstanceFromTemplate(template)
}

export function createAvatarAssetInstanceFromTemplate(
  template: AvatarAssetTemplate
): AvatarAssetInstance {
  const model = cloneSkeleton(template.scene)
  const materialClones = new Map<THREE.Material, THREE.Material>()

  model.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return

    mesh.castShadow = true
    mesh.receiveShadow = true
    // Animated limbs can leave the bind-pose bounds supplied by a GLB. Avoid
    // characters popping out when the camera moves toward another player.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(material => cloneInstanceMaterial(material, materialClones))
    } else if (mesh.material) {
      mesh.material = cloneInstanceMaterial(mesh.material, materialClones)
    }
  })

  const root = new THREE.Group()
  root.name = `avatar-${template.modelKey}`
  root.position.set(...template.config.position)
  root.rotation.set(...template.config.rotation)
  root.scale.set(...template.config.scale)
  root.add(model)

  return {
    modelKey: template.modelKey,
    path: template.path,
    root,
    model,
    animations: template.animations,
    clips: template.clips,
    bones: indexAvatarBones(model),
    materials: [...materialClones.values()],
  }
}

export function findAvatarClip(
  animations: readonly THREE.AnimationClip[],
  role: AvatarClipRole
): THREE.AnimationClip | undefined {
  const expectedName = AVATAR_CLIP_NAMES[role]
  const exact = animations.find(clip => clip.name === expectedName)
  if (exact) return exact

  const separatorIndex = expectedName.lastIndexOf('|')
  const suffix = separatorIndex >= 0 ? expectedName.slice(separatorIndex) : expectedName
  return animations.find(clip => clip.name.endsWith(suffix))
}

export function getAvatarClipSet(
  animations: readonly THREE.AnimationClip[]
): AvatarClipSet {
  return {
    idleNeutral: findAvatarClip(animations, 'idleNeutral'),
    interact: findAvatarClip(animations, 'interact'),
    wave: findAvatarClip(animations, 'wave'),
    hitReceive: findAvatarClip(animations, 'hitReceive'),
  }
}

export function indexAvatarBones(root: THREE.Object3D): ReadonlyMap<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>()

  root.traverse(object => {
    const bone = object as THREE.Bone
    if (bone.isBone && bone.name && !bones.has(bone.name)) {
      bones.set(bone.name, bone)
    }
  })

  return bones
}

export function findAvatarBone(
  bones: ReadonlyMap<string, THREE.Bone>,
  name: string
): THREE.Bone | undefined {
  return bones.get(name)
}

export function disposeAvatarAssetInstance(
  instance: AvatarAssetInstance,
  options: DisposeAvatarAssetInstanceOptions = {}
): void {
  if (disposedAvatarRoots.has(instance.root)) return
  disposedAvatarRoots.add(instance.root)

  if (options.mixer) {
    options.mixer.stopAllAction()
    options.mixer.uncacheRoot(options.mixerRoot ?? instance.root)
  }

  instance.root.removeFromParent()

  // Instance materials are the only GPU resources owned by a seat. GLTF geometry
  // and animation clips are shared by the cache and deliberately remain alive.
  for (const material of instance.materials) {
    material.dispose()
  }
}

export function isAvatarAssetInstanceDisposed(instance: AvatarAssetInstance): boolean {
  return disposedAvatarRoots.has(instance.root)
}

/** Drops cache references without disposing shared geometry that live instances may use. */
export function clearAvatarAssetCache(): void {
  avatarTemplateCache.clear()
}

/** Read-only cache diagnostics for focused tests and development tooling. */
export function getAvatarAssetCacheKeys(): readonly string[] {
  return [...avatarTemplateCache.keys()]
}

function createAvatarAssetTemplate(
  modelKey: RealisticAvatarModelKey,
  config: RealisticAvatarModelConfig,
  gltf: GLTF
): AvatarAssetTemplate {
  validateAvatarScene(modelKey, gltf.scene)

  return {
    modelKey,
    path: config.path,
    config,
    scene: gltf.scene,
    animations: gltf.animations,
    clips: getAvatarClipSet(gltf.animations),
  }
}

function validateAvatarScene(modelKey: RealisticAvatarModelKey, scene: THREE.Group) {
  let meshCount = 0
  scene.traverse(object => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1
  })

  if (meshCount === 0) {
    throw new Error(`Avatar asset ${modelKey} does not contain a renderable mesh`)
  }

  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  const size = bounds.getSize(new THREE.Vector3())
  const values = [...bounds.min.toArray(), ...bounds.max.toArray(), ...size.toArray()]
  const hasFiniteBounds = values.every(Number.isFinite)
  const isUsefulScale = size.lengthSq() > 0.0001 && size.lengthSq() < 1_000_000

  if (bounds.isEmpty() || !hasFiniteBounds || !isUsefulScale) {
    throw new Error(`Avatar asset ${modelKey} has invalid scene bounds`)
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      value => {
        globalThis.clearTimeout(timeout)
        resolve(value)
      },
      error => {
        globalThis.clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function cloneInstanceMaterial(
  source: THREE.Material,
  materialClones: Map<THREE.Material, THREE.Material>
): THREE.Material {
  const cached = materialClones.get(source)
  if (cached) return cached

  const clone = source.clone()
  materialClones.set(source, clone)
  return clone
}
