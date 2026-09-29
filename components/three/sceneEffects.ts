import * as THREE from 'three'
import { FELT_TOP_Y, RAIL_PEAK_Y, RAIL_WIDTH } from './tableArt'
import { TABLE_FELT_SEMI_AXIS_X, TABLE_FELT_SEMI_AXIS_Z } from './tableWagerLayout'

/**
 * Cinematic effects for the lounge: a soft light cone over the felt,
 * confetti bursts for winners, and an all-in shockwave.
 * Everything is pooled and allocation-free per frame.
 */

export interface LightCone {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
}

const HAZE_VERTEX = /* glsl */ `
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAngle;
  void main() {
    vHeight = position.y;
    vAngle = atan(position.x, position.z);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const HAZE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float intensity;
  uniform float height;
  uniform float time;
  uniform float seed;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAngle;
  void main() {
    float along = clamp(-vHeight / height, 0.0, 1.0);
    float facing = abs(dot(vNormal, vView));
    float edge = smoothstep(0.0, 0.65, facing);
    // Fades out well above the felt so the cone never washes the board cards.
    float fade = smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.45, 0.9, along));
    // Shafts: slow angular streaks, as if dust and smoke were catching the beam unevenly.
    float streak = 0.72
      + 0.16 * sin(vAngle * 9.0 + seed + time * 0.11 + along * 2.0)
      + 0.12 * sin(vAngle * 17.0 - seed * 1.7 - time * 0.07);
    gl_FragColor = vec4(color * intensity * edge * fade * streak, 1.0);
  }
`

function createHazeMaterial(intensity: number, height: number, seed: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color('#ffe2b0') },
      intensity: { value: intensity },
      height: { value: height },
      time: { value: 0 },
      seed: { value: seed },
    },
    vertexShader: HAZE_VERTEX,
    fragmentShader: HAZE_FRAGMENT,
  })
}

/** Slow dust motes drifting through the beams: one Points draw, animated entirely in the vertex shader. */
function createDustMotes(height: number, centres: ReadonlyArray<readonly [number, number, number]>) {
  const count = 56
  const positions = new Float32Array(count * 3)
  const phases = new Float32Array(count * 3)
  let seed = 0xd057
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let index = 0; index < count; index += 1) {
    const [cx, cy, cz] = centres[index % centres.length]!
    const along = 0.12 + random() * 0.7
    const spread = 0.35 + along * 1.6
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * spread
    positions[index * 3] = cx + Math.cos(angle) * radius
    positions[index * 3 + 1] = cy - along * height
    positions[index * 3 + 2] = cz + Math.sin(angle) * radius
    phases[index * 3] = random() * Math.PI * 2
    phases[index * 3 + 1] = 0.05 + random() * 0.09
    phases[index * 3 + 2] = 0.5 + random() * 1.4
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 3))
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, span: { value: height * 0.8 } },
    vertexShader: /* glsl */ `
      attribute vec3 phase;
      uniform float time;
      uniform float span;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        // Rise slowly and wrap; sway sideways.
        p.y += mod(time * phase.y * 1.6 + phase.x * 3.0, span) - span * 0.5;
        p.x += sin(time * 0.31 * phase.z + phase.x) * 0.22;
        p.z += cos(time * 0.27 * phase.z + phase.x * 1.7) * 0.22;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(26.0 / max(0.5, -mv.z), 1.0, 2.6);
        vAlpha = 0.45 + 0.55 * sin(time * (0.6 + phase.z * 0.5) + phase.x * 5.0) * sin(time * 0.37 + phase.x);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, d) * max(vAlpha, 0.0);
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a * 0.32, 1.0);
      }
    `,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'dust-motes'
  points.frustumCulled = false
  points.renderOrder = 6
  return points
}

/**
 * A soft additive cone from the overhead lamp down to the felt, with two
 * thinner beams under the pendant shades and a scatter of dust motes drifting
 * through all three. The hazes are children of the main cone, so they share
 * its placement, animation and disposal.
 */
export function createLightCone(scene: THREE.Scene, apex: THREE.Vector3, baseY: number, baseRadius: number): LightCone {
  const height = apex.y - baseY
  const geometry = new THREE.CylinderGeometry(0.35, baseRadius, height, 48, 1, true)
  geometry.translate(0, -height / 2, 0)
  const material = createHazeMaterial(0.06, height, 0)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'light-cone'
  mesh.position.copy(apex)
  mesh.renderOrder = 5

  // Pendant beams: the two lamps at x = +-2.6 (see createPendantLamp).
  const pendantHeight = 7.0 - baseY
  const pendantGeometry = new THREE.CylinderGeometry(0.5, 1.45, pendantHeight, 32, 1, true)
  pendantGeometry.translate(0, -pendantHeight / 2, 0)
  const hazes: THREE.ShaderMaterial[] = [material]
  const pendantOffsets: Array<readonly [number, number, number]> = []
  for (const [side, seed] of [[-1, 1.7], [1, 4.1]] as const) {
    const pendantMaterial = createHazeMaterial(0.03, pendantHeight, seed)
    // Far wall of the cone only: half the overdraw, same look from outside.
    pendantMaterial.side = THREE.BackSide
    const beam = new THREE.Mesh(pendantGeometry, pendantMaterial)
    beam.name = 'pendant-haze'
    beam.position.set(side * 2.6 - apex.x, 7.0 - apex.y, -0.4 - apex.z)
    beam.renderOrder = 5
    mesh.add(beam)
    hazes.push(pendantMaterial)
    pendantOffsets.push([beam.position.x, beam.position.y, beam.position.z])
  }
  const motes = createDustMotes(height, [[0, 0, 0], ...pendantOffsets])
  mesh.add(motes)
  mesh.userData.hazes = hazes
  mesh.userData.motes = motes.material
  scene.add(mesh)

  return { mesh, material }
}

export function animateLightCone(cone: LightCone, time: number, reducedMotion: boolean, boost: number) {
  const intensity = 0.032 + boost * 0.018 + (reducedMotion ? 0 : Math.sin(time * 0.7) * 0.004)
  cone.material.uniforms.intensity!.value = intensity
  const hazes = cone.mesh.userData.hazes as THREE.ShaderMaterial[] | undefined
  const drift = reducedMotion ? 0 : time
  if (hazes) {
    for (let index = 0; index < hazes.length; index += 1) {
      const haze = hazes[index]!
      haze.uniforms.time!.value = drift
      // Pendant beams ride at about half the main cone's strength.
      if (index > 0) haze.uniforms.intensity!.value = intensity * 0.5
    }
  }
  const motes = cone.mesh.userData.motes as THREE.ShaderMaterial | undefined
  if (motes) motes.uniforms.time!.value = drift
}

export function disposeLightCone(cone: LightCone) {
  cone.mesh.removeFromParent()
  const seen = new Set<THREE.BufferGeometry>()
  cone.mesh.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.geometry || seen.has(mesh.geometry)) return
    seen.add(mesh.geometry)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })
  cone.material.dispose()
}

const CONFETTI_COUNT = 260
const CONFETTI_COLORS = ['#f2c766', '#ff7a3d', '#e2505c', '#39c795', '#7fd0ff', '#a98bff', '#fff8ea']

export interface Confetti {
  mesh: THREE.InstancedMesh
  velocities: Float32Array
  spins: Float32Array
  life: Float32Array
  positions: Float32Array
  rotations: Float32Array
  cursor: number
}

export function createConfetti(scene: THREE.Scene): Confetti {
  const geometry = new THREE.PlaneGeometry(0.07, 0.11)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })
  const mesh = new THREE.InstancedMesh(geometry, material, CONFETTI_COUNT)
  mesh.name = 'confetti'
  mesh.frustumCulled = false
  const color = new THREE.Color()
  for (let index = 0; index < CONFETTI_COUNT; index += 1) {
    mesh.setColorAt(index, color.set(CONFETTI_COLORS[index % CONFETTI_COLORS.length]!))
    mesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0))
  }
  mesh.instanceColor!.needsUpdate = true
  scene.add(mesh)
  return {
    mesh,
    velocities: new Float32Array(CONFETTI_COUNT * 3),
    spins: new Float32Array(CONFETTI_COUNT * 3),
    life: new Float32Array(CONFETTI_COUNT),
    positions: new Float32Array(CONFETTI_COUNT * 3),
    rotations: new Float32Array(CONFETTI_COUNT * 3),
    cursor: 0,
  }
}

/** Fires `amount` pieces of confetti upward from `origin`. */
export function burstConfetti(confetti: Confetti, origin: THREE.Vector3, amount = 120) {
  for (let piece = 0; piece < amount; piece += 1) {
    const index = confetti.cursor
    confetti.cursor = (confetti.cursor + 1) % CONFETTI_COUNT
    const angle = Math.random() * Math.PI * 2
    const speed = 1.4 + Math.random() * 2.4
    confetti.positions.set([origin.x, origin.y, origin.z], index * 3)
    confetti.velocities.set([
      Math.cos(angle) * speed * 0.45,
      3.4 + Math.random() * 2.6,
      Math.sin(angle) * speed * 0.45,
    ], index * 3)
    confetti.spins.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], index * 3)
    confetti.rotations.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], index * 3)
    confetti.life[index] = 3.2 + Math.random() * 1.2
  }
}

/** Winds every live piece down within `seconds` (a new hand is being dealt). */
export function fadeOutConfetti(confetti: Confetti, seconds = 0.35) {
  for (let index = 0; index < CONFETTI_COUNT; index += 1) {
    if (confetti.life[index]! > seconds) confetti.life[index] = seconds
  }
}

const RAIL_SCALE = 1 + RAIL_WIDTH / TABLE_FELT_SEMI_AXIS_Z

/** Height paper settles at over the table (felt, then rail), or null past the rail. */
function getConfettiFloor(x: number, z: number): number | null {
  const e = (x / TABLE_FELT_SEMI_AXIS_X) ** 2 + (z / TABLE_FELT_SEMI_AXIS_Z) ** 2
  if (e < 1) return FELT_TOP_Y + 0.004
  if (e < RAIL_SCALE * RAIL_SCALE) return RAIL_PEAK_Y + 0.004
  return null
}

const confettiMatrix = new THREE.Matrix4()
const confettiQuaternion = new THREE.Quaternion()
const confettiEuler = new THREE.Euler()
const confettiPosition = new THREE.Vector3()
const confettiScale = new THREE.Vector3()

export function animateConfetti(confetti: Confetti, delta: number) {
  let any = false
  for (let index = 0; index < CONFETTI_COUNT; index += 1) {
    if (confetti.life[index]! <= 0) continue
    any = true
    confetti.life[index]! -= delta
    const v = index * 3
    // Paper drag: fast fall is damped so confetti flutters down.
    confetti.velocities[v + 1] = Math.max(-1.1, confetti.velocities[v + 1]! - 6.5 * delta)
    confetti.velocities[v]! *= 1 - 1.2 * delta
    confetti.velocities[v + 2]! *= 1 - 1.2 * delta
    for (let axis = 0; axis < 3; axis += 1) {
      confetti.positions[v + axis]! += confetti.velocities[v + axis]! * delta
      confetti.rotations[v + axis]! += confetti.spins[v + axis]! * delta
    }
    // Paper lands and lies flat on the felt or rail instead of sinking
    // through the table.
    const floor = getConfettiFloor(confetti.positions[v]!, confetti.positions[v + 2]!)
    if (floor !== null && confetti.velocities[v + 1]! < 0 && confetti.positions[v + 1]! <= floor) {
      confetti.positions[v + 1] = floor
      confetti.velocities.fill(0, v, v + 3)
      confetti.spins.fill(0, v, v + 3)
      confetti.rotations[v] = -Math.PI / 2
      confetti.rotations[v + 2] = 0
      // Resting pieces fade out a little sooner.
      confetti.life[index] = Math.min(confetti.life[index]!, 1.4)
    }
    const alive = Math.min(1, confetti.life[index]! / 0.6)
    confettiPosition.set(confetti.positions[v]!, confetti.positions[v + 1]!, confetti.positions[v + 2]!)
    confettiQuaternion.setFromEuler(confettiEuler.set(confetti.rotations[v]!, confetti.rotations[v + 1]!, confetti.rotations[v + 2]!))
    confettiScale.setScalar(alive)
    confetti.mesh.setMatrixAt(index, confettiMatrix.compose(confettiPosition, confettiQuaternion, confettiScale))
  }
  if (any) confetti.mesh.instanceMatrix.needsUpdate = true
}

export function disposeConfetti(confetti: Confetti) {
  confetti.mesh.removeFromParent()
  confetti.mesh.geometry.dispose()
  ;(confetti.mesh.material as THREE.Material).dispose()
  confetti.mesh.dispose()
}

export interface Shockwave {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  startedAt: number
}

export function createShockwave(scene: THREE.Scene): Shockwave {
  const material = new THREE.MeshBasicMaterial({
    color: '#ffb36b',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 72), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.visible = false
  mesh.name = 'all-in-shockwave'
  scene.add(mesh)
  return { mesh, material, startedAt: Number.NEGATIVE_INFINITY }
}

export function triggerShockwave(wave: Shockwave, position: THREE.Vector3, time: number) {
  wave.mesh.position.copy(position)
  wave.startedAt = time
}

export function animateShockwave(wave: Shockwave, time: number) {
  const progress = (time - wave.startedAt) / 0.9
  wave.mesh.visible = progress >= 0 && progress < 1
  if (!wave.mesh.visible) return
  const eased = 1 - Math.pow(1 - progress, 3)
  wave.mesh.scale.setScalar(0.2 + eased * 2.1)
  // A crisp thin ring that fades fast, rather than a thick smeared band.
  wave.material.opacity = Math.pow(1 - progress, 1.6) * 0.55
}

export function disposeShockwave(wave: Shockwave) {
  wave.mesh.removeFromParent()
  wave.mesh.geometry.dispose()
  wave.material.dispose()
}
