import * as THREE from 'three'

/**
 * Glass drink props the avatars pick up: a foamy beer mug and a glass of
 * water. Props live in world space and follow the drinker's right hand.
 */

export type DrinkKind = 'beer' | 'water'

export interface DrinkProp {
  group: THREE.Group
  kind: DrinkKind
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
}

export function createDrinkProp(kind: DrinkKind): DrinkProp {
  const group = new THREE.Group()
  group.name = `drink-${kind}`
  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  // Lit like the rest of the table (standard PBR under the key spot and the
  // room environment), so glass catches real highlights instead of reading as
  // a flat toon cylinder.
  const lit = (parameters: THREE.MeshStandardMaterialParameters) => {
    const material = new THREE.MeshStandardMaterial(parameters)
    materials.push(material)
    return material
  }
  const glassMaterial = (tint: string) => lit({
    color: tint,
    transparent: true,
    opacity: 0.32,
    roughness: 0.08,
    metalness: 0,
    envMapIntensity: 1.6,
    depthWrite: false,
    // Both walls show through each other, like a real glass.
    side: THREE.DoubleSide,
  })
  // A bright lip and a thick base: the two things that make a glass read as glass.
  const rimMaterial = lit({ color: '#f4fbff', emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.15, envMapIntensity: 1.4 })
  const baseMaterial = lit({ color: '#d7ebe8', transparent: true, opacity: 0.7, roughness: 0.12, envMapIntensity: 1.4 })
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
    const glass = glassMaterial('#fff6e4')
    // Gentle emissive only: brighter reads as a light bulb under the bloom pass.
    const beer = lit({ color: '#f29a12', emissive: '#b86200', emissiveIntensity: 0.3, roughness: 0.25, envMapIntensity: 0.9 })
    const foam = lit({ color: '#fbf1dc', emissive: '#fff1d6', emissiveIntensity: 0.05, roughness: 0.92 })
    // Order matters: glass, liquid, foam first (firstPersonDrink reads them by index).
    add(new THREE.CylinderGeometry(0.1, 0.09, 0.24, 20, 1, true), glass, [0, 0.12, 0])
    add(new THREE.CylinderGeometry(0.088, 0.08, 0.19, 20), beer, [0, 0.105, 0])
    const head = add(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), foam, [0, 0.22, 0])
    head.scale.y = 0.55
    const handle = add(new THREE.TorusGeometry(0.055, 0.016, 8, 16, Math.PI), glassMaterial('#fff6e4'), [0.1, 0.12, 0])
    handle.rotation.z = -Math.PI / 2
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 20), baseMaterial, [0, 0.006, 0])
    const lip = add(new THREE.TorusGeometry(0.1, 0.006, 6, 28), rimMaterial, [0, 0.24, 0])
    lip.rotation.x = Math.PI / 2
  } else {
    const glass = glassMaterial('#eefaff')
    const water = lit({ color: '#a9dcf0', emissive: '#1f6f9a', emissiveIntensity: 0.14, transparent: true, opacity: 0.62, roughness: 0.1, envMapIntensity: 1.2, depthWrite: false })
    // Order matters: glass, liquid, lemon first (firstPersonDrink reads them by index).
    add(new THREE.CylinderGeometry(0.075, 0.065, 0.22, 20, 1, true), glass, [0, 0.11, 0])
    add(new THREE.CylinderGeometry(0.066, 0.058, 0.16, 20), water, [0, 0.085, 0])
    const lemon = add(new THREE.TorusGeometry(0.045, 0.012, 6, 14), lit({ color: '#f2d24a', roughness: 0.6 }), [0.07, 0.2, 0])
    lemon.rotation.y = Math.PI / 2
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.012, 20), baseMaterial, [0, 0.006, 0])
    const lip = add(new THREE.TorusGeometry(0.075, 0.005, 6, 28), rimMaterial, [0, 0.22, 0])
    lip.rotation.x = Math.PI / 2
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
