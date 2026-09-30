import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { describe, expect, it } from 'vitest'
import { shareClonedSkeletons } from '@/components/three/avatarAssetLoader'
import {
  attachHairSway,
  getHairSwayAngles,
  hairSwayWeight,
  HAIR_SWAY_BONE,
  prepareHairSwayTemplate,
  updateHairSway,
} from '@/components/three/avatarBodyHair'

/** Head-local positions are given in seat-ish units (x 1/234 in bind units, like the real rigs). */
const U = 1 / 234

function buildTemplate() {
  const scene = new THREE.Group()
  const root = new THREE.Bone()
  root.name = 'Root'
  const head = new THREE.Bone()
  head.name = 'Head'
  head.position.set(0, 1, 0)
  root.add(head)
  scene.add(root)
  scene.updateMatrixWorld(true)
  const crown = [0, 1 + 0.6 * U, 0]
  const backLow = [0, 1 + 0.12 * U, -0.26 * U]
  const fringe = [0, 1 + 0.35 * U, 0.3 * U]
  const positions = new Float32Array([...crown, ...backLow, ...fringe])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const material = new THREE.MeshBasicMaterial()
  material.name = 'Hair'
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.name = 'Suit_Head_2'
  scene.add(mesh)
  mesh.bind(new THREE.Skeleton([root, head]))
  return { scene, mesh }
}

function instance(template: THREE.Object3D) {
  const model = cloneSkeleton(template)
  shareClonedSkeletons(model)
  attachHairSway(model)
  let mesh: THREE.SkinnedMesh | null = null
  model.traverse(object => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) mesh = object as THREE.SkinnedMesh
  })
  return { model, mesh: mesh! as THREE.SkinnedMesh }
}

describe('hair secondary motion', () => {
  it('pins the crown, the face and the fringe, and frees the hanging ends', () => {
    expect(hairSwayWeight('hang', 0, 0.6, 0)).toBe(0)
    expect(hairSwayWeight('hang', 0, 0.12, -0.26)).toBeGreaterThan(0.5)
    // Beard / moustache in front of the face never move.
    expect(hairSwayWeight('hang', 0, 0.1, 0.25)).toBe(0)
    expect(hairSwayWeight('ponytail', 0, 0.1, -0.45)).toBeGreaterThan(0.9)
    expect(hairSwayWeight('crest', 0, 0.85, 0)).toBeGreaterThan(0.9)
    expect(hairSwayWeight('crest', 0, 0.05, 0.25)).toBe(0)
  })

  it('adds one joint per instance without touching the shared template skeleton', () => {
    const { scene, mesh } = buildTemplate()
    prepareHairSwayTemplate('business_man', scene)
    expect(mesh.geometry.userData.hairSway).toBeTruthy()
    const weights = mesh.geometry.getAttribute('skinWeight')
    expect(weights.getComponent(0, 1)).toBe(0)
    expect(weights.getComponent(1, 1)).toBeGreaterThan(0.3)
    expect(weights.getComponent(2, 1)).toBe(0)

    const a = instance(scene)
    const b = instance(scene)
    // Skeleton.clone() shares the boneInverses array: the template must stay 2 long.
    expect(mesh.skeleton.bones.length).toBe(2)
    expect(mesh.skeleton.boneInverses.length).toBe(2)
    for (const { mesh: skinned } of [a, b]) {
      expect(skinned.skeleton.bones.length).toBe(3)
      expect(skinned.skeleton.boneInverses.length).toBe(3)
      expect(skinned.skeleton.bones[2]!.name).toBe(HAIR_SWAY_BONE)
      expect(skinned.skeleton.bones[2]!.parent).toBe(skinned.skeleton.bones[1])
    }
    expect(a.mesh.skeleton.boneInverses).not.toBe(b.mesh.skeleton.boneInverses)
  })

  it('leaves the rest pose untouched and swings the ends a little when the head nods', () => {
    const { scene } = buildTemplate()
    prepareHairSwayTemplate('business_man', scene)
    const { model, mesh } = instance(scene)
    model.updateMatrixWorld(true)
    const rest = mesh.getVertexPosition(1, new THREE.Vector3())
    const head = mesh.skeleton.bones[1]!
    updateHairSway(head, 1 / 60, false)
    model.updateMatrixWorld(true)
    mesh.skeleton.update()
    expect(mesh.getVertexPosition(1, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-9)

    // A quick nod: the head pitches down and back up.
    let peak = 0
    for (let frame = 0; frame < 90; frame += 1) {
      head.rotation.x = 0.35 * Math.sin(Math.min(1, frame / 12) * Math.PI)
      model.updateMatrixWorld(true)
      updateHairSway(head, 1 / 60, false)
      const angles = getHairSwayAngles(head)!
      peak = Math.max(peak, Math.abs(angles.x))
      expect(Number.isFinite(angles.x + angles.y + angles.z)).toBe(true)
    }
    expect(peak).toBeGreaterThan(0.005)
    expect(peak).toBeLessThanOrEqual(0.05 + 1e-9)
    // Settles once the head is still again.
    expect(Math.abs(getHairSwayAngles(head)!.x)).toBeLessThan(0.01)
  })
})
