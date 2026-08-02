import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createFallbackAvatarAccessories,
  createRiggedAvatarAccessories,
  disposeAvatarAccessorySet,
  getAvatarAppearanceKey,
} from '@/components/three/avatarCustomization'
import type { PlayerAvatarCustomization } from '@/lib/profile'

const customizedLook: PlayerAvatarCustomization = {
  modelKey: 'punk',
  hat: 'cowboy',
  glasses: 'aviator',
  jacket: 'western',
  jacketColor: 'gold',
  idleTell: 'chip_shuffle',
  celebration: 'fist_pump',
}

describe('3D avatar customization geometry', () => {
  it('builds named fallback hat, glasses, and jacket groups that can be disposed', () => {
    const head = new THREE.Group()
    const avatar = new THREE.Group()
    avatar.add(head)

    const set = createFallbackAvatarAccessories(head, avatar, customizedLook)

    expect(head.getObjectByName('avatar-hat-cowboy')).toBeTruthy()
    expect(head.getObjectByName('avatar-glasses-aviator')).toBeTruthy()
    expect(avatar.getObjectByName('avatar-jacket-western-gold')).toBeTruthy()
    expect(set.materials.length).toBeGreaterThanOrEqual(4)

    disposeAvatarAccessorySet(set)

    expect(head.getObjectByName('avatar-hat-cowboy')).toBeFalsy()
    expect(avatar.getObjectByName('avatar-jacket-western-gold')).toBeFalsy()
  })

  it('parents rigged headwear and fitted jacket accents to animated bones', () => {
    const avatarRoot = new THREE.Group()
    const headBone = new THREE.Bone()
    headBone.name = 'Head'
    headBone.scale.setScalar(100)
    const chestBone = new THREE.Bone()
    chestBone.name = 'Chest'
    chestBone.scale.setScalar(100)
    avatarRoot.add(headBone, chestBone)

    const set = createRiggedAvatarAccessories(
      avatarRoot,
      new Map([
        ['Head', headBone],
        ['Chest', chestBone],
      ]),
      { ...customizedLook, hat: 'crown', glasses: 'shades', jacket: 'tuxedo' }
    )

    const crown = headBone.getObjectByName('avatar-hat-crown')
    const shades = headBone.getObjectByName('avatar-glasses-shades')
    expect(crown).toBeTruthy()
    expect(shades).toBeTruthy()
    const jacket = avatarRoot.getObjectByName('avatar-jacket-tuxedo-gold')
    expect(jacket).toBeTruthy()
    expect(jacket!.parent).toBe(chestBone)
    let fittedJacketMeshCount = 0
    jacket!.traverse(object => {
      if ((object as THREE.Mesh).isMesh) fittedJacketMeshCount += 1
    })
    expect(fittedJacketMeshCount).toBeGreaterThan(0)

    avatarRoot.updateMatrixWorld(true)
    const crownSize = new THREE.Box3().setFromObject(crown!).getSize(new THREE.Vector3())
    expect(crownSize.x).toBeGreaterThan(0.1)
    expect(crownSize.x).toBeLessThan(0.5)
    expect(shades!.position.y).toBeCloseTo(0.26 * 0.0043, 6)
    expect(shades!.position.z).toBeCloseTo(0.29 * 0.0043, 6)

    disposeAvatarAccessorySet(set)
  })

  it('isolates jacket tinting and temporarily replaces incompatible built-in headwear', () => {
    const avatarRoot = new THREE.Group()
    const headBone = new THREE.Bone()
    headBone.name = 'Head'
    avatarRoot.add(headBone)

    const sharedMaterial = new THREE.MeshStandardMaterial({ color: '#d4a52c' })
    const vestMaterial = new THREE.MeshStandardMaterial({ color: '#a33a20' })
    const body = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterial)
    body.name = 'Worker_Body_1'
    const hardhat = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterial)
    hardhat.name = 'Worker_Head_1'
    const vest = new THREE.Mesh(new THREE.BoxGeometry(), vestMaterial)
    vest.name = 'Worker_Body_2'
    avatarRoot.add(body, hardhat, vest)

    const set = createRiggedAvatarAccessories(avatarRoot, new Map([['Head', headBone]]), {
      ...customizedLook,
      modelKey: 'worker',
      hat: 'fedora',
      jacket: 'varsity',
      jacketColor: 'emerald',
    })

    expect(hardhat.visible).toBe(false)
    expect(body.material).toBe(sharedMaterial)
    expect(vest.material).not.toBe(vestMaterial)
    expect((vest.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('1c5746')

    disposeAvatarAccessorySet(set)

    expect(hardhat.visible).toBe(true)
    expect(vest.material).toBe(vestMaterial)
  })

  it('uses only visible cosmetic fields for the rebuild key', () => {
    const key = getAvatarAppearanceKey(customizedLook)
    const tellChanged: PlayerAvatarCustomization = {
      ...customizedLook,
      idleTell: 'table_drum',
    }
    const hatChanged: PlayerAvatarCustomization = {
      ...customizedLook,
      hat: 'fedora',
    }

    expect(key).toBe('cowboy:aviator:western:gold')
    expect(getAvatarAppearanceKey(tellChanged)).toBe(key)
    expect(getAvatarAppearanceKey(hatChanged)).not.toBe(key)
  })
})
