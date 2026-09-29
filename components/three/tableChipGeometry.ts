import * as THREE from 'three'

/**
 * A casino chip with a chamfered rim: a printed face on each side (dished
 * slightly, with the ivory inlay set in a shallow recess), a 45-degree bevel
 * that catches the key light, and a straight edge band whose six inlay stripes
 * sit recessed into the moulding. Material groups match THREE.CylinderGeometry
 * (0 = side, 1 = top cap, 2 = bottom cap) so it is a drop-in replacement and
 * the whole chip stays one draw call.
 */
export function createBeveledChipGeometry(radius: number, height: number, radialSegments = 48) {
  // The edge inlays need a few segments each to read as recesses.
  const segments = Math.max(radialSegments, 72)
  const bevel = Math.min(height * 0.2, radius * 0.08)
  const faceRadius = radius - bevel
  const half = height / 2
  // How far the inlay stripes and the printed inlay disc sink into the plastic.
  const stripeDepth = radius * 0.028
  const dish = height * 0.06

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const groups: Array<{ start: number; count: number; materialIndex: number }> = []

  // Side band as three strips (bottom chamfer, straight edge, top chamfer).
  // v spans the whole band so the edge texture's hairline seams land on the chamfers.
  const rings = [
    { r: faceRadius, y: -half, v: 0, nr: 0.7071, ny: -0.7071, notch: false },
    { r: radius, y: -half + bevel, v: 0.125, nr: 0.7071, ny: -0.7071, notch: true },
    { r: radius, y: -half + bevel, v: 0.125, nr: 1, ny: 0, notch: true },
    { r: radius, y: half - bevel, v: 0.875, nr: 1, ny: 0, notch: true },
    { r: radius, y: half - bevel, v: 0.875, nr: 0.7071, ny: 0.7071, notch: true },
    { r: faceRadius, y: half, v: 1, nr: 0.7071, ny: 0.7071, notch: false },
  ]
  const columns = segments + 1
  for (const ring of rings) {
    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments
      const angle = u * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      // Six stripes, each spanning the middle 36% of its 1/6 pitch (matches the edge texture).
      const within = (u * 6) % 1
      const stripe = ring.notch
        ? THREE.MathUtils.smoothstep(within, 0.26, 0.33) * (1 - THREE.MathUtils.smoothstep(within, 0.67, 0.74))
        : 0
      const r = ring.r - stripe * stripeDepth
      positions.push(sin * r, ring.y, cos * r)
      normals.push(sin * ring.nr, ring.ny, cos * ring.nr)
      uvs.push(u, ring.v)
    }
  }
  const sideStart = indices.length
  for (const strip of [0, 2, 4]) {
    for (let column = 0; column < segments; column += 1) {
      const a = strip * columns + column
      const b = (strip + 1) * columns + column
      indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  groups.push({ start: sideStart, count: indices.length - sideStart, materialIndex: 0 })

  // Faces: a centre vertex fanned to concentric rings. The middle sinks a hair
  // (a dished, moulded face) and the ivory inlay disc sits in a small recess
  // with a raised lip just outside it (the printed disc is at 0.44 of the face).
  const faceProfile: Array<{ r: number; sink: number }> = [
    { r: 0.0, sink: dish },
    { r: 0.42, sink: dish * 1.05 },
    { r: 0.455, sink: dish * 0.2 },
    { r: 0.5, sink: dish * 0.1 },
    { r: 0.75, sink: dish * 0.25 },
    { r: 0.96, sink: 0.0 },
    { r: 1.0, sink: 0.0 },
  ]
  for (const [sign, materialIndex] of [[1, 1], [-1, 2]] as const) {
    const start = indices.length
    const centre = positions.length / 3
    positions.push(0, sign * (half - faceProfile[0]!.sink), 0)
    normals.push(0, sign, 0)
    uvs.push(0.5, 0.5)
    const ringStart: number[] = []
    for (let index = 1; index < faceProfile.length; index += 1) {
      const entry = faceProfile[index]!
      const before = faceProfile[index - 1]!
      const after = faceProfile[Math.min(faceProfile.length - 1, index + 1)]!
      // Height above the base plane is -sink, so d(height)/d(r) = -slope; the
      // shading normal leans against the climb.
      const slope = (after.sink - before.sink) / Math.max(1e-4, (after.r - before.r) * faceRadius)
      const lean = Math.atan(-slope)
      ringStart.push(positions.length / 3)
      for (let column = 0; column <= segments; column += 1) {
        const angle = (column / segments) * Math.PI * 2
        const sin = Math.sin(angle)
        const cos = Math.cos(angle)
        positions.push(sin * faceRadius * entry.r, sign * (half - entry.sink), cos * faceRadius * entry.r)
        normals.push(-sin * Math.sin(lean), sign * Math.cos(lean), -cos * Math.sin(lean))
        uvs.push(sin * 0.5 * entry.r + 0.5, cos * 0.5 * entry.r * sign + 0.5)
      }
    }
    for (let column = 0; column < segments; column += 1) {
      const a = ringStart[0]! + column
      if (sign > 0) indices.push(centre, a, a + 1)
      else indices.push(centre, a + 1, a)
    }
    for (let ring = 0; ring < ringStart.length - 1; ring += 1) {
      for (let column = 0; column < segments; column += 1) {
        const a = ringStart[ring]! + column
        const b = ringStart[ring + 1]! + column
        if (sign > 0) indices.push(a, b, a + 1, a + 1, b, b + 1)
        else indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
    groups.push({ start, count: indices.length - start, materialIndex })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex)
  return geometry
}

/**
 * Material for the instanced blob shadows under chip columns. The per-instance
 * colour's red channel is used as the shadow's strength (0..1) so a column
 * lifted off the felt (a bet in flight) fades out instead of leaving a hard
 * black patch on the cloth.
 */
export function createContactShadowMaterial(map: THREE.Texture) {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      #ifdef USE_INSTANCING_COLOR
        diffuseColor.a *= vColor.r;
      #endif`
    )
  }
  material.customProgramCacheKey = () => 'poker-contact-shadow-fade'
  return material
}

/** Shadow strength for something `lift` units above the felt: full when resting, gone by ~0.3. */
export function getContactShadowStrength(lift: number) {
  return 1 - THREE.MathUtils.smoothstep(lift, 0.01, 0.3)
}
