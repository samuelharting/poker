import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CLIP_NAMES,
  clearAvatarAssetCache,
  createAvatarAssetInstance,
  createAvatarAssetInstanceFromTemplate,
  disposeAvatarAssetInstance,
  findAvatarBone,
  findAvatarClip,
  getAvatarAssetCacheKey,
  getAvatarAssetCacheKeys,
  getAvatarClipSet,
  isAvatarAssetInstanceDisposed,
  loadAvatarAssetTemplate,
  type AvatarAssetTemplate,
} from '@/components/three/avatarAssetLoader'
import { getAvatarModelConfig } from '@/components/three/avatarModelCatalog'

interface SyntheticAvatarAsset {
  gltf: GLTF
  geometry: THREE.BufferGeometry
  material: THREE.Material
  head: THREE.Bone
}

describe('native Three avatar asset loader', () => {
  beforeEach(() => {
    clearAvatarAssetCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearAvatarAssetCache()
  })

  it('deduplicates in-flight and resolved GLTF requests by catalog key and path', async () => {
    const asset = createSyntheticAvatarAsset()
    const loadAsync = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(asset.gltf)

    const [first, second] = await Promise.all([
      loadAvatarAssetTemplate('business_man'),
      loadAvatarAssetTemplate('business_man'),
    ])
    const third = await loadAvatarAssetTemplate('business_man')

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(loadAsync).toHaveBeenCalledTimes(1)
    expect(loadAsync).toHaveBeenCalledWith('/models/avatars/business-man.glb')
    expect(getAvatarAssetCacheKeys()).toEqual([getAvatarAssetCacheKey('business_man')])
  })

  it('evicts a failed request so the same model can be retried', async () => {
    const asset = createSyntheticAvatarAsset()
    const loadAsync = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(asset.gltf)

    await expect(loadAvatarAssetTemplate('casual')).rejects.toThrow('network unavailable')
    expect(getAvatarAssetCacheKeys()).toEqual([])

    await expect(loadAvatarAssetTemplate('casual')).resolves.toMatchObject({ modelKey: 'casual' })
    expect(loadAsync).toHaveBeenCalledTimes(2)
  })

  it('creates skeleton-safe instances with shared geometry and seat-owned materials', async () => {
    const asset = createSyntheticAvatarAsset()
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(asset.gltf)

    const first = await createAvatarAssetInstance('hoodie')
    const second = await createAvatarAssetInstance('hoodie')
    const firstMeshes = collectMeshes(first.model)
    const secondMeshes = collectMeshes(second.model)

    expect(first.model).not.toBe(asset.gltf.scene)
    expect(second.model).not.toBe(first.model)
    expect(firstMeshes).toHaveLength(2)
    expect(firstMeshes[0]?.geometry).toBe(asset.geometry)
    expect(secondMeshes[0]?.geometry).toBe(asset.geometry)
    expect(firstMeshes[0]?.material).not.toBe(asset.material)
    expect(secondMeshes[0]?.material).not.toBe(firstMeshes[0]?.material)
    expect(first.materials).toHaveLength(1)
    expect(second.materials).toHaveLength(1)
    expect(firstMeshes.every(mesh => mesh.castShadow && mesh.receiveShadow)).toBe(true)

    const firstHead = findAvatarBone(first.bones, 'Head')
    const secondHead = findAvatarBone(second.bones, 'Head')
    const firstSkinnedMesh = firstMeshes.find(
      mesh => (mesh as THREE.SkinnedMesh).isSkinnedMesh
    ) as THREE.SkinnedMesh
    expect(firstHead).toBeDefined()
    expect(firstHead).not.toBe(asset.head)
    expect(secondHead).not.toBe(firstHead)
    expect(firstSkinnedMesh.skeleton.bones).toContain(firstHead)
    expect(firstSkinnedMesh.skeleton.bones).not.toContain(asset.head)
    expect(firstSkinnedMesh.frustumCulled).toBe(false)

    const config = getAvatarModelConfig('hoodie')
    expect(first.root.position.toArray()).toEqual(config.position)
    expect(first.root.rotation.toArray().slice(0, 3)).toEqual(config.rotation)
    expect(first.root.scale.toArray()).toEqual(config.scale)
  })

  it('rejects malformed meshless assets and keeps the cache retryable', async () => {
    const scene = new THREE.Group()
    const malformed = {
      animations: [],
      scene,
      scenes: [scene],
      cameras: [],
      asset: { version: '2.0' },
      parser: {} as GLTF['parser'],
      userData: {},
    } satisfies GLTF
    const valid = createSyntheticAvatarAsset()
    const loadAsync = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(valid.gltf)

    await expect(loadAvatarAssetTemplate('punk')).rejects.toThrow(
      'does not contain a renderable mesh'
    )
    expect(getAvatarAssetCacheKeys()).toEqual([])

    await expect(loadAvatarAssetTemplate('punk')).resolves.toMatchObject({ modelKey: 'punk' })
    expect(loadAsync).toHaveBeenCalledTimes(2)
  })

  it('finds the four poker-safe clips by exact name or rig-independent suffix', () => {
    const exactIdle = new THREE.AnimationClip(AVATAR_CLIP_NAMES.idleNeutral, 1.667, [])
    const alternateWave = new THREE.AnimationClip('AlternateRig|Wave', 1.667, [])
    const interact = new THREE.AnimationClip(AVATAR_CLIP_NAMES.interact, 1.25, [])
    const hitReceive = new THREE.AnimationClip(AVATAR_CLIP_NAMES.hitReceive, 0.542, [])
    const animations = [exactIdle, alternateWave, interact, hitReceive]

    expect(findAvatarClip(animations, 'idleNeutral')).toBe(exactIdle)
    expect(findAvatarClip(animations, 'wave')).toBe(alternateWave)
    expect(getAvatarClipSet(animations)).toEqual({
      idleNeutral: exactIdle,
      interact,
      wave: alternateWave,
      hitReceive,
    })
  })

  it('disposes only instance materials, never cached geometry or source materials', () => {
    const asset = createSyntheticAvatarAsset()
    const template = createTemplate(asset.gltf, 'worker')
    const instance = createAvatarAssetInstanceFromTemplate(template)
    const parent = new THREE.Group()
    parent.add(instance.root)

    let geometryDisposals = 0
    let sourceMaterialDisposals = 0
    let instanceMaterialDisposals = 0
    asset.geometry.addEventListener('dispose', () => { geometryDisposals += 1 })
    asset.material.addEventListener('dispose', () => { sourceMaterialDisposals += 1 })
    instance.materials[0]?.addEventListener('dispose', () => { instanceMaterialDisposals += 1 })

    const mixer = new THREE.AnimationMixer(instance.root)
    const stopAllAction = vi.spyOn(mixer, 'stopAllAction')
    const uncacheRoot = vi.spyOn(mixer, 'uncacheRoot')

    disposeAvatarAssetInstance(instance, { mixer })
    disposeAvatarAssetInstance(instance, { mixer })

    expect(instance.root.parent).toBeNull()
    expect(isAvatarAssetInstanceDisposed(instance)).toBe(true)
    expect(stopAllAction).toHaveBeenCalledTimes(1)
    expect(uncacheRoot).toHaveBeenCalledWith(instance.root)
    expect(instanceMaterialDisposals).toBe(1)
    expect(geometryDisposals).toBe(0)
    expect(sourceMaterialDisposals).toBe(0)
  })
})

function createSyntheticAvatarAsset(): SyntheticAvatarAsset {
  const scene = new THREE.Group()
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: '#7a4f35' })
  const vertexCount = geometry.getAttribute('position').count
  const skinIndices = new Uint16Array(vertexCount * 4)
  const skinWeights = new Float32Array(vertexCount * 4)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    skinWeights[vertex * 4] = 1
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))

  const body = new THREE.Bone()
  body.name = 'Body'
  const head = new THREE.Bone()
  head.name = 'Head'
  body.add(head)

  const firstMesh = new THREE.SkinnedMesh(geometry, material)
  firstMesh.add(body)
  firstMesh.bind(new THREE.Skeleton([body, head]))
  const secondMesh = new THREE.Mesh(geometry, material)
  secondMesh.position.x = 1.2
  scene.add(firstMesh, secondMesh)

  const animations = Object.values(AVATAR_CLIP_NAMES).map(
    name => new THREE.AnimationClip(name, 1, [])
  )

  return {
    gltf: {
      animations,
      scene,
      scenes: [scene],
      cameras: [],
      asset: { version: '2.0' },
      parser: {} as GLTF['parser'],
      userData: {},
    },
    geometry,
    material,
    head,
  }
}

function createTemplate(
  gltf: GLTF,
  modelKey: AvatarAssetTemplate['modelKey']
): AvatarAssetTemplate {
  const config = getAvatarModelConfig(modelKey)
  return {
    modelKey,
    path: config.path,
    config,
    scene: gltf.scene,
    animations: gltf.animations,
    clips: getAvatarClipSet(gltf.animations),
  }
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) meshes.push(mesh)
  })
  return meshes
}
