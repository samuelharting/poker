import * as THREE from 'three'

/**
 * Toon-shaded drink props the avatars pick up: a foamy beer mug and a glass of
 * water. Props live in world space and follow the drinker's right hand.
 */

export type DrinkKind = 'beer' | 'water'

export interface DrinkProp {
  group: THREE.Group
  kind: DrinkKind
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
}

function ramp() {
  const data = new Uint8Array([90, 170, 255])
  const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

export function createDrinkProp(kind: DrinkKind): DrinkProp {
  const group = new THREE.Group()
  group.name = `drink-${kind}`
  const gradientMap = ramp()
  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  const toon = (parameters: THREE.MeshToonMaterialParameters) => {
    const material = new THREE.MeshToonMaterial({ gradientMap, ...parameters })
    materials.push(material)
    return material
  }
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) => {
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }

  if (kind === 'beer') {
    // Clear glass so the beer reads golden rather than muddy.
    const glass = toon({ color: '#fffaf0', transparent: true, opacity: 0.26, depthWrite: false })
    const beer = toon({ color: '#ffb52e', emissive: '#c46f00', emissiveIntensity: 0.55 })
    const foam = toon({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 0.4 })
    add(new THREE.CylinderGeometry(0.1, 0.09, 0.24, 18), glass, [0, 0.12, 0])
    add(new THREE.CylinderGeometry(0.088, 0.08, 0.19, 18), beer, [0, 0.105, 0])
    const head = add(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), foam, [0, 0.22, 0])
    head.scale.y = 0.55
    const handle = add(new THREE.TorusGeometry(0.055, 0.016, 8, 16, Math.PI), glass, [0.1, 0.12, 0])
    handle.rotation.z = -Math.PI / 2
  } else {
    const glass = toon({ color: '#eefaff', transparent: true, opacity: 0.26, depthWrite: false })
    const water = toon({ color: '#9fe0ff', emissive: '#2b86b8', emissiveIntensity: 0.45, transparent: true, opacity: 0.8 })
    add(new THREE.CylinderGeometry(0.075, 0.065, 0.22, 18), glass, [0, 0.11, 0])
    add(new THREE.CylinderGeometry(0.066, 0.058, 0.16, 18), water, [0, 0.085, 0])
    const lemon = add(new THREE.TorusGeometry(0.045, 0.012, 6, 14), toon({ color: '#ffe066' }), [0.07, 0.2, 0])
    lemon.rotation.y = Math.PI / 2
  }

  group.visible = false
  return { group, kind, materials, geometries }
}

export function disposeDrinkProp(prop: DrinkProp | null) {
  if (!prop) return
  prop.group.removeFromParent()
  prop.materials.forEach(material => material.dispose())
  prop.geometries.forEach(geometry => geometry.dispose())
}

/** Seconds for one full drink: reach, lift, sip, lower. */
export const DRINK_DURATION = 2.6
