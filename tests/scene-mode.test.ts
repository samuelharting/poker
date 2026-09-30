import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CHILL_HIDDEN_NAMES, applySceneMode, normalizeSceneMode } from '@/components/three/sceneMode'

describe('scene mode', () => {
  it('only recognises chill, everything else is the classic lounge', () => {
    expect(normalizeSceneMode('chill')).toBe('chill')
    expect(normalizeSceneMode('classic')).toBe('classic')
    expect(normalizeSceneMode(null)).toBe('classic')
    expect(normalizeSceneMode('nope')).toBe('classic')
  })

  it('hides the clutter by name and leaves the table and players alone', () => {
    const scene = new THREE.Scene()
    const made: Record<string, THREE.Object3D> = {}
    for (const name of [...CHILL_HIDDEN_NAMES, 'stylized-poster-table', 'club-chair', 'printed-felt', 'avatar']) {
      const object = new THREE.Group()
      object.name = name
      scene.add(object)
      made[name] = object
    }
    // Nested objects (the light cone owns its haze) are found too.
    const nested = new THREE.Group()
    nested.name = 'room-dressing'
    const halo = new THREE.Mesh()
    halo.name = 'lamp-halos-and-washes'
    nested.add(halo)
    scene.add(nested)

    const hidden = applySceneMode(scene, 'chill')
    expect(hidden).toBe(CHILL_HIDDEN_NAMES.length + 1)
    for (const name of CHILL_HIDDEN_NAMES) expect(scene.getObjectByName(name)!.visible).toBe(false)
    for (const name of ['club-chair', 'printed-felt', 'avatar', 'room-dressing']) {
      expect(scene.getObjectByName(name)!.visible).toBe(true)
    }

    applySceneMode(scene, 'classic')
    for (const name of CHILL_HIDDEN_NAMES) expect(scene.getObjectByName(name)!.visible).toBe(true)
  })
})
