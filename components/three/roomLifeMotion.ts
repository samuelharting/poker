import * as THREE from 'three'

/**
 * Two bits of quiet life for the lounge that cost nothing to draw: the neon sign
 * buzzes and now and then stutters like a tired transformer, and the wall
 * sconces' shades flicker like a live flame (a slow breathing, quick shivers and
 * a rare guttering dip). Both only change a material's emissive intensity, so
 * there are no extra draw calls and nothing is allocated per frame.
 */

/** Seconds between neon stutters. */
export const NEON_CYCLE_SECONDS = 14.5

/**
 * Neon brightness multiplier: a faint hum plus a rare stutter (off, on, off,
 * nearly on, half, steady) in the first half second of each cycle.
 */
export function neonBuzz(time: number): number {
  const hum = 1 + 0.012 * Math.sin(time * 61) + 0.01 * Math.sin(time * 3.1)
  const local = (((time + 5) % NEON_CYCLE_SECONDS) + NEON_CYCLE_SECONDS) % NEON_CYCLE_SECONDS
  if (local >= 0.5) return hum
  const level = local < 0.07 ? 0.4 : local < 0.15 ? 1 : local < 0.24 ? 0.3 : local < 0.31 ? 0.92 : local < 0.42 ? 0.55 : 1
  return level * hum
}

/** Multiplier for one flame (`phase` keeps the sconces out of step with each other). */
export function flameFlicker(time: number, phase: number): number {
  const dip = Math.max(0, Math.sin(time * 0.37 + phase * 3)) ** 24
  return 1 + 0.05 * Math.sin(time * 6.3 + phase) + 0.035 * Math.sin(time * 17.1 + phase * 2.3) - 0.12 * dip
}

interface Flame {
  material: THREE.MeshStandardMaterial
  base: number
  phase: number
}

const flames = new WeakMap<THREE.Object3D, Flame[]>()

/** Finds the glowing sconce shades once per scene. */
function findFlames(scene: THREE.Object3D): Flame[] {
  const found: Flame[] = []
  let index = 0
  scene.traverse(object => {
    if (object.name !== 'art-deco-wall-sconce') return
    object.traverse(child => {
      const mesh = child as THREE.Mesh
      const material = mesh.isMesh && !Array.isArray(mesh.material) ? (mesh.material as THREE.MeshStandardMaterial) : null
      if (!material || !(material.emissiveIntensity > 0.5)) return
      found.push({ material, base: material.emissiveIntensity, phase: index * 1.7 + 0.3 })
    })
    index += 1
  })
  return found
}

/** Call once per frame; under reduced motion the flames hold steady. */
export function animateSconceFlames(scene: THREE.Object3D, time: number, reducedMotion: boolean) {
  let list = flames.get(scene)
  if (!list) {
    list = findFlames(scene)
    flames.set(scene, list)
  }
  for (let index = 0; index < list.length; index += 1) {
    const flame = list[index]!
    flame.material.emissiveIntensity = flame.base * (reducedMotion ? 1 : flameFlicker(time, flame.phase))
  }
}
