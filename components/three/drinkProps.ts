import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import {
  getBeerFoamTexture,
  getBeerLiquidTexture,
  getGlassDropletTexture,
  getLemonWheelTexture,
  getWaterLiquidTexture,
} from './sceneTextures'

/**
 * Glass drink props the avatars pick up: a foamy beer mug and a glass of
 * water. Props live in world space and follow the drinker's right hand.
 *
 * Mesh order is load-bearing (firstPersonDrink.ts reads it by index): glass,
 * liquid (must stay a CylinderGeometry: it reads `parameters.height` and
 * rescales it as the drink drains), then foam (beer) or lemon (water). Anything
 * added after that is decoration.
 */

export type DrinkKind = 'beer' | 'water'

export interface DrinkProp {
  group: THREE.Group
  kind: DrinkKind
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
}

/** Solid thick glass base (the heavy bottom of a pint or tumbler). */
function thickBase(radius: number, height: number) {
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.002),
    new THREE.Vector2(radius - 0.008, 0.002),
    new THREE.Vector2(radius - 0.0015, 0.007),
    new THREE.Vector2(radius, 0.016),
    new THREE.Vector2(radius + 0.0015, height),
    new THREE.Vector2(0, height),
  ], 28)
}

/**
 * Real glass is clear where you look straight through it and dense towards
 * the silhouette (Fresnel). Scaling the wall's alpha by the viewing angle keeps
 * the beer golden through the front of the glass while the edges still read.
 */
function glassFresnelAlpha(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `{
      float glassFacing = abs(dot(normal, normalize(vViewPosition)));
      diffuseColor.a = clamp(diffuseColor.a * mix(1.9, 0.5, smoothstep(0.1, 0.85, glassFacing)), 0.14, 0.95);
    }
    #include <opaque_fragment>`
  )
}

export interface DrinkPropOptions {
  /** Held in front of the camera: the glass is nearly opaque so hand and sleeve never smear through it. */
  firstPerson?: boolean
}

export function createDrinkProp(kind: DrinkKind, options: DrinkPropOptions = {}): DrinkProp {
  const firstPerson = options.firstPerson === true
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
  const droplets = getGlassDropletTexture()
  const glassMaterial = (tint: string, opacity = firstPerson ? 0.62 : 0.33) => {
    const material = lit({
      color: tint,
      map: droplets,
      transparent: true,
      opacity,
      roughness: 0.06,
      metalness: 0,
      envMapIntensity: firstPerson ? 0.45 : 1.0,
      depthWrite: firstPerson,
      // Both walls show through each other, like a real glass.
      side: THREE.DoubleSide,
    })
    material.onBeforeCompile = glassFresnelAlpha
    material.customProgramCacheKey = () => 'drink-glass-fresnel'
    return material
  }
  // A bright lip and a thick base: the two things that make a glass read as glass.
  const rimMaterial = lit({
    color: '#f4fbff',
    transparent: true,
    opacity: firstPerson ? 0.9 : 0.6,
    emissive: '#ffffff',
    emissiveIntensity: 0,
    roughness: 0.12,
    envMapIntensity: 1.1,
  })
  const baseMaterial = lit({
    color: '#b4cfcd',
    transparent: true,
    opacity: firstPerson ? 0.8 : 0.3,
    roughness: 0.1,
    envMapIntensity: 0.8,
    depthWrite: firstPerson,
  })
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], position: [number, number, number]) => {
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
    const liquidTexture = getBeerLiquidTexture()
    // Gentle emissive only (the map carries the gradient): brighter reads as a
    // light bulb under the bloom pass.
    const beer = lit({
      color: '#ffffff',
      map: liquidTexture,
      emissive: '#ffffff',
      emissiveMap: liquidTexture,
      emissiveIntensity: firstPerson ? 0.1 : 0.26,
      roughness: 0.2,
      envMapIntensity: 0.9,
    })
    const foam = lit({
      // From above (first person) the head reads as beer foam, not a bowl of cream.
      color: firstPerson ? '#d8bd86' : '#eadfc4',
      map: getBeerFoamTexture(),
      roughness: 0.96,
    })
    // Order matters: glass, liquid, foam first (firstPersonDrink reads them by index).
    add(new THREE.CylinderGeometry(0.1, 0.09, 0.24, 28, 1, true), glass, [0, 0.12, 0])
    add(new THREE.CylinderGeometry(0.088, 0.082, 0.172, 28), beer, [0, 0.116, 0])
    // A creamy head with an irregular dome, seated right under the rim. Its
    // origin is the beer surface so the drain animation only moves it in Y.
    // (Lathe profiles run bottom to top so the faces point outward.)
    const head = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.03),
      new THREE.Vector2(0.09, -0.03),
      new THREE.Vector2(0.0925, -0.006),
      new THREE.Vector2(0.09, 0.004),
      new THREE.Vector2(0.077, 0.014),
      new THREE.Vector2(0.052, 0.024),
      new THREE.Vector2(0.026, 0.029),
      new THREE.Vector2(0, 0.03),
    ], 28, 0, Math.PI * 2)
    const headPosition = head.getAttribute('position')
    for (let index = 0; index < headPosition.count; index += 1) {
      const x = headPosition.getX(index)
      const y = headPosition.getY(index)
      const z = headPosition.getZ(index)
      if (y > 0.002) {
        headPosition.setY(index, y + Math.sin(x * 95 + z * 40) * 0.0016 + Math.cos(z * 110 - x * 30) * 0.0014)
      }
    }
    head.computeVertexNormals()
    add(head, foam, [0, 0.214, 0])
    // A proper D handle: a glass tube running out of the wall and back in.
    const handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.093, 0.205, 0),
      new THREE.Vector3(0.138, 0.2, 0),
      new THREE.Vector3(0.17, 0.164, 0),
      new THREE.Vector3(0.174, 0.12, 0),
      new THREE.Vector3(0.166, 0.076, 0),
      new THREE.Vector3(0.136, 0.048, 0),
      new THREE.Vector3(0.092, 0.042, 0),
    ])
    add(new THREE.TubeGeometry(handleCurve, 28, 0.0125, 8, false), glassMaterial('#fff6e4', firstPerson ? 0.42 : 0.34), [0, 0, 0])
    add(thickBase(0.0905, 0.032), baseMaterial, [0, 0, 0])
    const lip = add(new THREE.TorusGeometry(0.1, 0.0045, 6, 36), rimMaterial, [0, 0.24, 0])
    lip.rotation.x = Math.PI / 2
  } else {
    const glass = glassMaterial('#eefaff', 0.24)
    const water = lit({
      color: '#ffffff',
      map: getWaterLiquidTexture(),
      emissive: '#1f6f9a',
      emissiveIntensity: 0.16,
      transparent: true,
      opacity: firstPerson ? 0.92 : 0.7,
      roughness: 0.06,
      envMapIntensity: 1.1,
      depthWrite: firstPerson,
    })
    // Order matters: glass, liquid, lemon first (firstPersonDrink reads them by index).
    add(new THREE.CylinderGeometry(0.075, 0.065, 0.22, 28, 1, true), glass, [0, 0.11, 0])
    add(new THREE.CylinderGeometry(0.0665, 0.0605, 0.152, 28), water, [0, 0.104, 0])
    // Lemon wheel straddling the rim: rind edge, pale pith, radial segments.
    const rind = lit({ color: '#e8c322', roughness: 0.55 })
    const pulp = lit({ color: '#ffffff', map: getLemonWheelTexture(), roughness: 0.4, emissive: '#5a4a00', emissiveIntensity: 0.12 })
    const lemon = add(new THREE.CylinderGeometry(0.038, 0.038, 0.008, 28), [rind, pulp, pulp], [0.072, 0.2, 0])
    lemon.rotation.set(Math.PI / 2, 0, 0.32)
    add(thickBase(0.0655, 0.028), baseMaterial, [0, 0, 0])
    const lip = add(new THREE.TorusGeometry(0.075, 0.004, 6, 36), rimMaterial, [0, 0.22, 0])
    lip.rotation.x = Math.PI / 2
    // Three ice cubes bobbing at the surface, merged into one mesh.
    const cubes: THREE.BufferGeometry[] = []
    for (const [x, y, z, rx, ry] of [[-0.02, 0.17, 0.012, 0.4, 0.3], [0.024, 0.172, -0.012, 0.2, 0.9], [-0.004, 0.16, -0.034, 0.7, 0.1]] as const) {
      const cube = new RoundedBoxGeometry(0.036, 0.036, 0.036, 2, 0.007)
      cube.rotateX(rx)
      cube.rotateY(ry)
      cube.translate(x, y, z)
      cubes.push(cube)
    }
    const ice = mergeGeometries(cubes, false)
    cubes.forEach(cube => cube.dispose())
    if (ice) {
      add(ice, lit({
        color: '#dcf2fb',
        transparent: true,
        opacity: 0.34,
        roughness: 0.04,
        envMapIntensity: 2.2,
        depthWrite: false,
      }), [0, 0, 0])
    }
  }

  group.visible = false
  return { group, kind, materials, geometries }
}

export function disposeDrinkProp(prop: DrinkProp | null) {
  if (!prop) return
  prop.group.removeFromParent()
  // Textures are shared through the scene texture cache; only per-prop
  // materials and geometry are released here.
  prop.materials.forEach(material => material.dispose())
  prop.geometries.forEach(geometry => geometry.dispose())
}

/** Seconds for one full drink: reach, lift, sip, lower. */
export const DRINK_DURATION = 2.6
