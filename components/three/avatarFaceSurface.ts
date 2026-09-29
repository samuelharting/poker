import * as THREE from 'three'

/**
 * The face surface of a rigged avatar, measured once in Head-bone space.
 *
 * Eyes, brows, lips and skin decals are mounted on the head bone. To make them
 * sit *on* the skin instead of floating or sinking, we keep the head's face
 * triangles (skin, painted eye/brow patches, optionally facial hair) and answer
 * "how far forward is the surface at this (x, y)?" with an exact ray test along
 * the face's forward axis. Built at creation only; nothing here runs per frame.
 */
export interface FaceSurface {
  /** Forward depth (along `forward`) of the front-most surface at (x, y), or null. */
  depthAt: (x: number, y: number, useFacialHair?: boolean) => number | null
}

const SURFACE_PATTERN = /^(skin|eye|eyebrows?)$/i
const FACIAL_HAIR_PATTERN = /moustache|mustache|beard|goatee|hair/i

interface Triangles {
  data: Float32Array
  count: number
  /** Per-triangle x/y bounds (minX, maxX, minY, maxY) for cheap rejection. */
  bounds: Float32Array
}

function collectTriangles(
  model: THREE.Object3D,
  headBone: THREE.Bone,
  pattern: RegExp,
  bounds: { minY: number; maxY: number; maxX: number }
): Triangles {
  const out: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  model.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.material) return
    const headIndex = mesh.skeleton.bones.indexOf(headBone)
    if (headIndex < 0) return
    const toHead = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[headIndex]!, mesh.bindMatrix)
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = mesh.geometry.groups.length > 0
      ? mesh.geometry.groups
      : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }]
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]
      if (!material || !pattern.test(material.name)) continue
      for (let cursor = group.start; cursor + 2 < group.start + group.count; cursor += 3) {
        const i0 = index ? index.getX(cursor) : cursor
        const i1 = index ? index.getX(cursor + 1) : cursor + 1
        const i2 = index ? index.getX(cursor + 2) : cursor + 2
        a.fromBufferAttribute(position, i0).applyMatrix4(toHead)
        b.fromBufferAttribute(position, i1).applyMatrix4(toHead)
        c.fromBufferAttribute(position, i2).applyMatrix4(toHead)
        const minY = Math.min(a.y, b.y, c.y)
        const maxY = Math.max(a.y, b.y, c.y)
        if (maxY < bounds.minY || minY > bounds.maxY) continue
        if (Math.min(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x)) > bounds.maxX) continue
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      }
    }
  })
  const data = new Float32Array(out)
  const count = out.length / 9
  const boxes = new Float32Array(count * 4)
  for (let t = 0; t < count; t += 1) {
    const o = t * 9
    boxes[t * 4] = Math.min(data[o]!, data[o + 3]!, data[o + 6]!)
    boxes[t * 4 + 1] = Math.max(data[o]!, data[o + 3]!, data[o + 6]!)
    boxes[t * 4 + 2] = Math.min(data[o + 1]!, data[o + 4]!, data[o + 7]!)
    boxes[t * 4 + 3] = Math.max(data[o + 1]!, data[o + 4]!, data[o + 7]!)
  }
  return { data, count, bounds: boxes }
}

/**
 * Builds the surface lookup. Coordinates are Head-bone space; `forward` is the
 * unit vector the face looks along (depth is `point.dot(forward)`). The face is
 * assumed to look roughly along +Z, so the ray test projects onto the X/Y plane.
 */
export function createFaceSurface(
  model: THREE.Object3D,
  headBone: THREE.Bone,
  forward: THREE.Vector3,
  bounds: { minY: number; maxY: number; maxX: number }
): FaceSurface {
  const face = collectTriangles(model, headBone, SURFACE_PATTERN, bounds)
  const hair = collectTriangles(model, headBone, FACIAL_HAIR_PATTERN, bounds)
  const fx = forward.x
  const fy = forward.y
  const fz = forward.z

  const test = (tris: Triangles, x: number, y: number) => {
    let best = -Infinity
    const d = tris.data
    const box = tris.bounds
    for (let t = 0; t < tris.count; t += 1) {
      if (x < box[t * 4]! || x > box[t * 4 + 1]! || y < box[t * 4 + 2]! || y > box[t * 4 + 3]!) continue
      const o = t * 9
      const ax = d[o]!
      const ay = d[o + 1]!
      const bx = d[o + 3]!
      const by = d[o + 4]!
      const cx = d[o + 6]!
      const cy = d[o + 7]!
      const v0x = cx - ax
      const v0y = cy - ay
      const v1x = bx - ax
      const v1y = by - ay
      const v2x = x - ax
      const v2y = y - ay
      const dot00 = v0x * v0x + v0y * v0y
      const dot01 = v0x * v1x + v0y * v1y
      const dot02 = v0x * v2x + v0y * v2y
      const dot11 = v1x * v1x + v1y * v1y
      const dot12 = v1x * v2x + v1y * v2y
      const denom = dot00 * dot11 - dot01 * dot01
      if (Math.abs(denom) < 1e-20) continue
      const inv = 1 / denom
      const u = (dot11 * dot02 - dot01 * dot12) * inv
      const v = (dot00 * dot12 - dot01 * dot02) * inv
      if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue
      const az = d[o + 2]!
      const bz = d[o + 5]!
      const cz = d[o + 8]!
      const z = az + (cz - az) * u + (bz - az) * v
      // Depth along `forward` at this (x, y).
      const depth = x * fx + y * fy + z * fz
      if (depth > best) best = depth
    }
    return best
  }

  return {
    depthAt(x, y, useFacialHair = false) {
      let best = face.count > 0 ? test(face, x, y) : -Infinity
      if (useFacialHair && hair.count > 0) best = Math.max(best, test(hair, x, y))
      return Number.isFinite(best) ? best : null
    },
  }
}
