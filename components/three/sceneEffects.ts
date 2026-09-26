import * as THREE from 'three'

/**
 * Cinematic effects for the lounge: a soft light cone over the felt,
 * confetti bursts for winners, and an all-in shockwave.
 * Everything is pooled and allocation-free per frame.
 */

export interface LightCone {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
}

/** A soft additive cone from the overhead lamp down to the felt. */
export function createLightCone(scene: THREE.Scene, apex: THREE.Vector3, baseY: number, baseRadius: number): LightCone {
  const height = apex.y - baseY
  const geometry = new THREE.CylinderGeometry(0.35, baseRadius, height, 48, 1, true)
  geometry.translate(0, -height / 2, 0)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color('#ffe2b0') },
      intensity: { value: 0.06 },
      height: { value: height },
    },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vHeight = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float intensity;
      uniform float height;
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float along = clamp(-vHeight / height, 0.0, 1.0);
        float facing = abs(dot(vNormal, vView));
        float edge = smoothstep(0.0, 0.65, facing);
        float fade = smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.85, 1.0, along));
        gl_FragColor = vec4(color * intensity * edge * fade, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'light-cone'
  mesh.position.copy(apex)
  mesh.renderOrder = 5
  scene.add(mesh)

  return { mesh, material }
}

export function animateLightCone(cone: LightCone, time: number, reducedMotion: boolean, boost: number) {
  cone.material.uniforms.intensity!.value = 0.05 + boost * 0.07 + (reducedMotion ? 0 : Math.sin(time * 0.7) * 0.006)
}

export function disposeLightCone(cone: LightCone) {
  cone.mesh.removeFromParent()
  cone.mesh.geometry.dispose()
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
    color: '#ff9a4d',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), material)
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
  wave.mesh.scale.setScalar(0.2 + eased * 3.2)
  wave.material.opacity = (1 - progress) * 0.9
}

export function disposeShockwave(wave: Shockwave) {
  wave.mesh.removeFromParent()
  wave.mesh.geometry.dispose()
  wave.material.dispose()
}
