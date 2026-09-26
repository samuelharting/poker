import * as THREE from 'three'

/**
 * Stylized look for the rigged avatars: cel-shaded toon materials with a
 * stepped light ramp, a skinned ink outline (inverted hull), and eye blinks.
 */

let toonRamp: THREE.DataTexture | null = null

function getToonRamp() {
  if (toonRamp) return toonRamp
  // Four soft bands: core shadow, shadow, mid, lit.
  const steps = new Uint8Array([72, 128, 196, 255])
  toonRamp = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  toonRamp.minFilter = THREE.NearestFilter
  toonRamp.magFilter = THREE.NearestFilter
  toonRamp.generateMipmaps = false
  toonRamp.needsUpdate = true
  return toonRamp
}

function toToonMaterial(source: THREE.Material) {
  const standard = source as THREE.MeshStandardMaterial
  const toon = new THREE.MeshToonMaterial({
    name: source.name,
    color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
    map: standard.map ?? null,
    gradientMap: getToonRamp(),
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
  })
  // Lift skin and cloth slightly so the ramp's darkest band never goes muddy.
  toon.color.offsetHSL(0, 0.04, 0.02)
  return toon
}

/** Outline thickness as a fraction of each mesh's bounding radius (rigs use different units). */
const OUTLINE_WIDTH_RATIO = 0.0075

function createOutlineMaterial(width: number) {
  const material = new THREE.MeshBasicMaterial({
    color: '#120a07',
    side: THREE.BackSide,
    transparent: false,
  })
  material.name = 'avatar-ink-outline'
  material.onBeforeCompile = shader => {
    shader.uniforms.outlineWidth = { value: width }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\n  float outlineNormalLength = length(objectNormal);\n  if (outlineNormalLength > 1e-4) transformed += (objectNormal / outlineNormalLength) * outlineWidth;'
      )
  }
  // Every outline shares one program even though materials are per seat.
  return material
}

export interface StylizedAvatar {
  materials: THREE.Material[]
  outlineMeshes: THREE.Object3D[]
  eyeMaterials: THREE.MeshToonMaterial[]
  eyeColors: THREE.Color[]
  skinColor: THREE.Color | null
}

/**
 * Converts every mesh in the rig to toon shading and adds an ink outline to
 * skinned meshes. Returns the new per-instance materials (the originals are
 * disposed) plus the eye materials used for blinking.
 */
export function stylizeAvatar(model: THREE.Object3D, previous: readonly THREE.Material[]): StylizedAvatar {
  const converted = new Map<THREE.Material, THREE.MeshToonMaterial>()
  const outlineMeshes: THREE.Object3D[] = []
  const skinnedMeshes: THREE.SkinnedMesh[] = []

  model.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const convert = (material: THREE.Material) => {
      let toon = converted.get(material)
      if (!toon) {
        toon = toToonMaterial(material)
        converted.set(material, toon)
      }
      return toon
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(mesh as THREE.SkinnedMesh)
  })

  const outlineMaterials: THREE.Material[] = []
  for (const mesh of skinnedMeshes) {
    mesh.geometry.computeBoundingSphere()
    const radius = mesh.geometry.boundingSphere?.radius ?? 1
    const outlineMaterial = createOutlineMaterial(radius * OUTLINE_WIDTH_RATIO)
    outlineMaterials.push(outlineMaterial)
    const outline = new THREE.SkinnedMesh(mesh.geometry, outlineMaterial)
    outline.name = `${mesh.name}-outline`
    outline.bind(mesh.skeleton, mesh.bindMatrix)
    outline.frustumCulled = false
    outline.castShadow = false
    outline.receiveShadow = false
    outline.renderOrder = mesh.renderOrder
    outline.position.copy(mesh.position)
    outline.quaternion.copy(mesh.quaternion)
    outline.scale.copy(mesh.scale)
    mesh.parent?.add(outline)
    outlineMeshes.push(outline)
  }

  previous.forEach(material => material.dispose())

  const materials = [...converted.values(), ...outlineMaterials]
  const eyeMaterials = [...converted.values()].filter(material => /^eye$/i.test(material.name))
  const skin = [...converted.values()].find(material => /^skin$/i.test(material.name))
  return {
    materials,
    outlineMeshes,
    eyeMaterials,
    eyeColors: eyeMaterials.map(material => material.color.clone()),
    skinColor: skin ? skin.color.clone() : null,
  }
}

/** Closes the eyes (eye colour → skin colour) for `closed` in 0..1. */
export function applyBlink(style: StylizedAvatar, closed: number) {
  if (!style.skinColor) return
  style.eyeMaterials.forEach((material, index) => {
    const open = style.eyeColors[index]
    if (open) material.color.copy(open).lerp(style.skinColor!, closed)
  })
}

/** A natural blink schedule: quick double-blinks now and then. */
export function getBlinkAmount(time: number, seed: number) {
  const period = 3.4 + seed * 2.2
  const phase = (time + seed * 17) % period
  const blink = (start: number) => {
    const t = (phase - start) / 0.13
    return t >= 0 && t <= 1 ? Math.sin(t * Math.PI) : 0
  }
  return Math.max(blink(0), seed > 0.6 ? blink(0.22) : 0)
}
