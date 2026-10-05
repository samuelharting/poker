import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PlayerAvatarModelKey } from '@/lib/profile'
import { createAvatarToonMaterial } from './avatarStyle'
import {
  pickJewelry,
  type JewelryMetal,
  type JewelrySpec,
  type WristPiece,
} from './avatarWardrobe'

/**
 * Rigged jewellery by seed: wrist watches and bracelets on the forearm bones and
 * a chain necklace on the chest. Each piece is measured off the avatar's own
 * skinned geometry (bind pose) so it hugs that model's arm or collar, then built
 * as ONE merged mesh per bone that shares a single vertex-coloured toon material
 * (gold, steel, leather and dial colours live in the vertex colours), so the
 * whole set costs at most three draw calls per seat.
 */

export const AVATAR_MODEL_FAMILY: Record<PlayerAvatarModelKey, string> = {
  business_man: 'Suit',
  casual: 'Casual2',
  hoodie: 'Casual',
  worker: 'Worker',
  punk: 'Punk',
  adventurer: 'Adventurer',
}

const METALS: Record<JewelryMetal, string> = { gold: '#e4b24c', silver: '#b4bcc8' }

/** A forearm's cross-section near the wrist, in the lower-arm bone's local space. */
export interface ForearmFit {
  /** Unit vector along the bone toward the wrist. */
  axis: THREE.Vector3
  /** Unit vector pointing out of the back of the hand. */
  dorsal: THREE.Vector3
  /** Unit vector across the arm (axis x dorsal). */
  across: THREE.Vector3
  /** Bone-to-wrist distance. */
  length: number
  /** Cross-section centre offset (along `across`, `dorsal`) and half extents there. */
  centerAcross: number
  centerDorsal: number
  halfAcross: number
  halfDorsal: number
}

const _toBone = new THREE.Matrix4()

/** Vertices (bone-local) of skinned meshes that follow `bone` by at least `minWeight`. */
export function collectBonePoints(
  avatarRoot: THREE.Object3D,
  bone: THREE.Bone,
  minWeight: number,
  accept: (mesh: THREE.SkinnedMesh, materialName: string) => boolean = () => true,
  frame: THREE.Bone = bone
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  avatarRoot.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.visible || /outline/i.test(mesh.name)) return
    const index = mesh.skeleton.bones.indexOf(bone)
    if (index < 0) return
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    if (!position || !skinIndex || !skinWeight) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!accept(mesh, material?.name ?? '')) return
    const frameIndex = mesh.skeleton.bones.indexOf(frame)
    if (frameIndex < 0) return
    _toBone.multiplyMatrices(mesh.skeleton.boneInverses[frameIndex]!, mesh.bindMatrix)
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let weight = 0
      for (let slot = 0; slot < 4; slot += 1) {
        if (skinIndex.getComponent(vertex, slot) === index) weight += skinWeight.getComponent(vertex, slot)
      }
      if (weight < minWeight) continue
      points.push(new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(_toBone))
    }
  })
  return points
}

/**
 * Where the arm is round enough to wear a watch: the forearm's cross-section at
 * 70-97% of the way to the wrist, plus which way the back of the hand faces.
 * These rigs bind with palms down, so the back of the hand is the bind pose's
 * "up" taken perpendicular to the forearm (the finger bones are collapsed onto
 * the wrist by the procedural hands, so they cannot say which side is which).
 */
export function measureForearm(
  avatarRoot: THREE.Object3D,
  lowerArm: THREE.Bone,
  wrist: THREE.Bone,
  up: { head: THREE.Bone | undefined; hips: THREE.Bone | undefined }
): ForearmFit | null {
  const skeleton = findSharedSkeleton(avatarRoot, [lowerArm, wrist])
  if (!skeleton) return null
  // Everything in the lower arm's bind-pose local frame (animation may have posed the live bones).
  const wristPosition = bindLocalOrigin(skeleton, lowerArm, wrist)
  const length = wristPosition.length()
  if (length < 1e-9) return null
  const axis = wristPosition.clone().divideScalar(length)

  const lowerArmInverse = skeleton.boneInverses[skeleton.bones.indexOf(lowerArm)]!
  const worldUp = up.head && up.hips && skeleton.bones.includes(up.head) && skeleton.bones.includes(up.hips)
    ? bindWorldOrigin(skeleton, up.head).sub(bindWorldOrigin(skeleton, up.hips)).normalize()
    : new THREE.Vector3(0, 1, 0)
  const dorsal = worldUp.clone().transformDirection(lowerArmInverse)
  dorsal.sub(axis.clone().multiplyScalar(dorsal.dot(axis)))
  if (dorsal.lengthSq() < 1e-10) dorsal.set(0, 1, 0).sub(axis.clone().multiplyScalar(axis.y))
  dorsal.normalize()
  const across = new THREE.Vector3().crossVectors(axis, dorsal).normalize()

  const points = collectBonePoints(avatarRoot, lowerArm, 0.5)
  const slice = points.filter(point => {
    const t = point.dot(axis)
    return t > length * 0.7 && t < length * 0.97
  })
  if (slice.length < 6) return null
  let minAcross = Infinity
  let maxAcross = -Infinity
  let minDorsal = Infinity
  let maxDorsal = -Infinity
  for (const point of slice) {
    const a = point.dot(across)
    const d = point.dot(dorsal)
    minAcross = Math.min(minAcross, a)
    maxAcross = Math.max(maxAcross, a)
    minDorsal = Math.min(minDorsal, d)
    maxDorsal = Math.max(maxDorsal, d)
  }
  return {
    axis,
    dorsal,
    across,
    length,
    centerAcross: (minAcross + maxAcross) / 2,
    centerDorsal: (minDorsal + maxDorsal) / 2,
    halfAcross: (maxAcross - minAcross) / 2,
    halfDorsal: (maxDorsal - minDorsal) / 2,
  }
}

/** The skeleton of a skinned mesh that contains all of `bones` (its boneInverses are the bind pose). */
function findSharedSkeleton(avatarRoot: THREE.Object3D, bones: readonly THREE.Bone[]): THREE.Skeleton | null {
  let found: THREE.Skeleton | null = null
  avatarRoot.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (found || !mesh.isSkinnedMesh) return
    if (bones.every(bone => mesh.skeleton.bones.includes(bone))) found = mesh.skeleton
  })
  return found
}

function bindWorldOrigin(skeleton: THREE.Skeleton, bone: THREE.Bone) {
  return new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[skeleton.bones.indexOf(bone)]!.clone().invert())
}

/** `bone`'s origin expressed in `frame`'s bind-pose local space. */
function bindLocalOrigin(skeleton: THREE.Skeleton, frame: THREE.Bone, bone: THREE.Bone) {
  const frameInverse = skeleton.boneInverses[skeleton.bones.indexOf(frame)]!
  const boneBind = skeleton.boneInverses[skeleton.bones.indexOf(bone)]!.clone().invert()
  return new THREE.Vector3().setFromMatrixPosition(boneBind).applyMatrix4(frameInverse)
}

/** Collects vertex-coloured parts and merges them into one geometry. */
class PartBuilder {
  private readonly parts: THREE.BufferGeometry[] = []

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: string) {
    const part = geometry.index ? geometry : geometry
    part.applyMatrix4(matrix)
    const count = part.getAttribute('position').count
    const rgb = new THREE.Color(color)
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = rgb.r
      colors[index * 3 + 1] = rgb.g
      colors[index * 3 + 2] = rgb.b
    }
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') part.deleteAttribute(name)
    }
    this.parts.push(part)
  }

  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null
    const merged = mergeGeometries(this.parts, false)
    this.parts.forEach(part => part.dispose())
    return merged
  }
}

/** Basis matrix with columns x, y, z at `origin`. */
function basis(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, origin: THREE.Vector3) {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin)
}

/**
 * A ring (open cylinder, `height` long along the arm) around the forearm: an
 * ellipse of the measured cross-section scaled by `grow`, centred at `t` along the bone.
 */
function addBand(builder: PartBuilder, fit: ForearmFit, t: number, height: number, grow: number, color: string) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
  // Cylinder: unit radius around Y, unit height. Map Y -> axis, X -> across, Z -> dorsal.
  const centre = fit.axis.clone().multiplyScalar(t)
    .addScaledVector(fit.across, fit.centerAcross)
    .addScaledVector(fit.dorsal, fit.centerDorsal)
  const x = fit.across.clone().multiplyScalar(fit.halfAcross * grow)
  const y = fit.axis.clone().multiplyScalar(height)
  const z = fit.dorsal.clone().multiplyScalar(fit.halfDorsal * grow)
  builder.add(geometry, basis(x, y, z, centre), color)
}

function addWatch(builder: PartBuilder, fit: ForearmFit, piece: WristPiece) {
  const metal = METALS[piece.metal]
  const unit = (fit.halfAcross + fit.halfDorsal) / 2
  const t = fit.length * 0.84
  // Strap and, a touch wider, the metal case frame.
  addBand(builder, fit, t, unit * 0.62, 1.06, piece.color)
  const centre = fit.axis.clone().multiplyScalar(t)
    .addScaledVector(fit.across, fit.centerAcross)
    .addScaledVector(fit.dorsal, fit.centerDorsal + fit.halfDorsal * 1.06)
  const caseRadius = unit * 0.36
  builder.add(
    new THREE.CylinderGeometry(1, 1, 1, 14),
    basis(
      fit.across.clone().multiplyScalar(caseRadius),
      fit.dorsal.clone().multiplyScalar(unit * 0.17),
      fit.axis.clone().multiplyScalar(caseRadius),
      centre.clone().addScaledVector(fit.dorsal, unit * 0.04)
    ),
    metal
  )
  // Dial: dark face on top of the case.
  builder.add(
    new THREE.CylinderGeometry(1, 1, 1, 14),
    basis(
      fit.across.clone().multiplyScalar(caseRadius * 0.78),
      fit.dorsal.clone().multiplyScalar(unit * 0.03),
      fit.axis.clone().multiplyScalar(caseRadius * 0.78),
      centre.clone().addScaledVector(fit.dorsal, unit * 0.14)
    ),
    piece.metal === 'gold' ? '#1d2a3a' : '#f1ece0'
  )
  // Crown nub on the thumb side is skipped: it only costs vertices at this size.
}

function addBracelet(builder: PartBuilder, fit: ForearmFit, piece: WristPiece) {
  const metal = METALS[piece.metal]
  const unit = (fit.halfAcross + fit.halfDorsal) / 2
  const t = fit.length * 0.72
  if (piece.kind === 'cuff') {
    addBand(builder, fit, t, unit * 0.5, 1.07, metal)
    return
  }
  if (piece.kind === 'bracelet') {
    addBand(builder, fit, t, unit * 0.16, 1.07, metal)
    addBand(builder, fit, t - unit * 0.3, unit * 0.16, 1.07, piece.color)
    return
  }
  // Beads: a ring of small spheres in two alternating colours.
  const count = 14
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    const centre = fit.axis.clone().multiplyScalar(t)
      .addScaledVector(fit.across, fit.centerAcross + Math.cos(angle) * fit.halfAcross * 1.1)
      .addScaledVector(fit.dorsal, fit.centerDorsal + Math.sin(angle) * fit.halfDorsal * 1.1)
    const radius = unit * 0.2
    builder.add(
      new THREE.SphereGeometry(1, 6, 4),
      basis(new THREE.Vector3(radius, 0, 0), new THREE.Vector3(0, radius, 0), new THREE.Vector3(0, 0, radius), centre),
      index % 3 === 2 ? metal : piece.color
    )
  }
}



/** Triangles (flat xyz x3 per triangle, `frame`-local bind pose) whose vertices all follow one of `bones`. */
function collectSurfaceTriangles(
  avatarRoot: THREE.Object3D,
  bones: readonly THREE.Bone[],
  frame: THREE.Bone,
  accept: (mesh: THREE.SkinnedMesh, materialName: string) => boolean
): number[] {
  const triangles: number[] = []
  const toFrame = new THREE.Matrix4()
  const point = new THREE.Vector3()
  avatarRoot.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.visible || /outline/i.test(mesh.name)) return
    const frameIndex = mesh.skeleton.bones.indexOf(frame)
    if (frameIndex < 0) return
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    if (!position || !skinIndex || !skinWeight) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!accept(mesh, material?.name ?? '')) return
    const wanted = new Set(bones.map(bone => mesh.skeleton.bones.indexOf(bone)).filter(index => index >= 0))
    toFrame.multiplyMatrices(mesh.skeleton.boneInverses[frameIndex]!, mesh.bindMatrix)
    const qualifies = new Uint8Array(position.count)
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let weight = 0
      for (let slot = 0; slot < 4; slot += 1) {
        if (wanted.has(skinIndex.getComponent(vertex, slot))) weight += skinWeight.getComponent(vertex, slot)
      }
      qualifies[vertex] = weight >= 0.3 ? 1 : 0
    }
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : position.count
    for (let corner = 0; corner + 2 < count; corner += 3) {
      const ids = [0, 1, 2].map(offset => (index ? index.getX(corner + offset) : corner + offset))
      if (!ids.every(id => qualifies[id])) continue
      for (const id of ids) {
        point.fromBufferAttribute(position, id).applyMatrix4(toFrame)
        triangles.push(point.x, point.y, point.z)
      }
    }
  })
  return triangles
}

/** Neck and upper-chest fit for a necklace, in the chest bone's bind-pose local space. */
export interface NeckFit {
  /** Unit axes in chest-local space. */
  right: THREE.Vector3
  up: THREE.Vector3
  forward: THREE.Vector3
  /** Neck-base centre. */
  origin: THREE.Vector3
  /** Body scale: the chest-to-head distance. */
  unit: number
  /** Neck half extents (right, forward) at the base and its centre offset along forward. */
  halfRight: number
  halfForward: number
  centerForward: number
  /** Front-most chest-surface depth (along forward, from origin) near (right, height). */
  frontAt: (right: number, height: number) => number
}

export function measureNeck(
  avatarRoot: THREE.Object3D,
  bones: ReadonlyMap<string, THREE.Bone>
): NeckFit | null {
  const chest = bones.get('Chest')
  const neck = bones.get('Neck')
  const head = bones.get('Head')
  const hips = bones.get('Hips')
  if (!chest || !neck || !head || !hips) return null
  const skeleton = findSharedSkeleton(avatarRoot, [chest, neck, head, hips])
  if (!skeleton) return null
  const chestInverse = skeleton.boneInverses[skeleton.bones.indexOf(chest)]!
  const worldUp = bindWorldOrigin(skeleton, head).sub(bindWorldOrigin(skeleton, hips)).normalize()
  const up = worldUp.clone().transformDirection(chestInverse)
  // Forward is where the face looks: from the skull's centre toward the eyes (the rig's own axes
  // do not say which way is front), flattened onto the horizontal plane.
  const eyePoints = collectBonePoints(avatarRoot, head, 0.5, (_mesh, name) => /^eye$/i.test(name), chest)
  const skinPoints = collectBonePoints(avatarRoot, head, 0.5, (_mesh, name) => /^skin/i.test(name), chest)
  if (eyePoints.length < 4 || skinPoints.length < 20) return null
  const centroid = (points: THREE.Vector3[]) => points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length)
  const forward = centroid(eyePoints).sub(centroid(skinPoints))
  forward.sub(up.clone().multiplyScalar(forward.dot(up)))
  if (forward.lengthSq() < 1e-14) return null
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(up, forward).normalize()
  const origin = bindLocalOrigin(skeleton, chest, neck)
  const unit = bindLocalOrigin(skeleton, chest, head).length()
  if (unit < 1e-9) return null

  const bodyOnly = (_mesh: THREE.SkinnedMesh, name: string) => !/hair|beard|moustache|eye|brow/i.test(name)
  const neckPoints = collectBonePoints(avatarRoot, neck, 0.5, bodyOnly, chest)
  // The chest surface is whatever follows the chest, torso or shoulders (shirt and collar
  // vertices are split across them), as triangles: a flat low-poly shirt front has no vertex
  // near the sternum to sample, so the chain finds the surface by ray casting instead.
  const surfaceBones = ['Chest', 'Torso', 'ShoulderL', 'ShoulderR'].map(name => bones.get(name)).filter((bone): bone is THREE.Bone => Boolean(bone))
  const triangles = collectSurfaceTriangles(avatarRoot, surfaceBones, chest, bodyOnly)
  if (neckPoints.length < 10 || triangles.length < 20) return null
  const local = (point: THREE.Vector3) => {
    const d = point.clone().sub(origin)
    return { r: d.dot(right), h: d.dot(up), f: d.dot(forward) }
  }
  // Neck cross-section around its lower third.
  const neckLocal = neckPoints.map(local)
  const hs = neckLocal.map(point => point.h)
  const hLow = Math.min(...hs)
  const hHigh = Math.max(...hs)
  const band = neckLocal.filter(point => point.h < hLow + (hHigh - hLow) * 0.45)
  if (band.length < 6) return null
  const rs = band.map(point => point.r)
  const fs = band.map(point => point.f)
  const minR = Math.min(...rs), maxR = Math.max(...rs), minF = Math.min(...fs), maxF = Math.max(...fs)
  const rayOrigin = new THREE.Vector3()
  const rayDirection = forward.clone().negate()
  const ray = new THREE.Ray()
  const hit = new THREE.Vector3()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const frontAt = (r: number, h: number) => {
    rayOrigin.copy(origin).addScaledVector(right, r).addScaledVector(up, h).addScaledVector(forward, unit)
    ray.set(rayOrigin, rayDirection)
    let best = -Infinity
    for (let index = 0; index < triangles.length; index += 9) {
      a.set(triangles[index]!, triangles[index + 1]!, triangles[index + 2]!)
      b.set(triangles[index + 3]!, triangles[index + 4]!, triangles[index + 5]!)
      c.set(triangles[index + 6]!, triangles[index + 7]!, triangles[index + 8]!)
      if (!ray.intersectTriangle(a, b, c, false, hit)) continue
      best = Math.max(best, hit.clone().sub(origin).dot(forward))
    }
    return best
  }
  return {
    right, up, forward, origin, unit,
    halfRight: (maxR - minR) / 2,
    halfForward: (maxF - minF) / 2,
    centerForward: (maxF + minF) / 2,
    frontAt,
  }
}

function addChain(builder: PartBuilder, fit: NeckFit, metal: JewelryMetal, pendant: boolean) {
  const u = fit.unit
  const baseH = -u * 0.02
  const drop = u * 0.3
  const count = 36
  const points: THREE.Vector3[] = []
  let lowest = { h: Infinity, point: new THREE.Vector3(), normalF: 1 }
  for (let index = 0; index < count; index += 1) {
    const phi = (index / count) * Math.PI * 2
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const front = Math.max(0, cosPhi)
    const h = baseH - drop * front ** 1.6
    const r = sinPhi * (fit.halfRight * 1.18 + u * 0.01)
    let f = fit.centerForward + cosPhi * (fit.halfForward * 1.18 + u * 0.01)
    if (cosPhi > 0) {
      const surface = fit.frontAt(r, h)
      if (Number.isFinite(surface)) f = Math.max(f, surface + u * 0.02)
    }
    const point = fit.origin.clone()
      .addScaledVector(fit.right, r)
      .addScaledVector(fit.up, h)
      .addScaledVector(fit.forward, f)
    points.push(point)
    if (h < lowest.h) lowest = { h, point, normalF: f }
  }
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal')
  builder.add(new THREE.TubeGeometry(curve, 48, u * 0.014, 4, true), new THREE.Matrix4(), METALS[metal])
  if (pendant) {
    const centre = lowest.point.clone().addScaledVector(fit.up, -u * 0.045).addScaledVector(fit.forward, u * 0.012)
    builder.add(
      new THREE.CylinderGeometry(1, 1, 1, 10),
      basis(
        fit.right.clone().multiplyScalar(u * 0.05),
        fit.forward.clone().multiplyScalar(u * 0.012),
        fit.up.clone().multiplyScalar(u * 0.05),
        centre
      ),
      METALS[metal]
    )
  }
}

function createChainGroup(
  avatarRoot: THREE.Object3D,
  bones: ReadonlyMap<string, THREE.Bone>,
  chain: NonNullable<JewelrySpec['chain']>,
  material: THREE.Material
): THREE.Group | null {
  const chest = bones.get('Chest')
  if (!chest) return null
  const fit = measureNeck(avatarRoot, bones)
  if (!fit) return null
  const builder = new PartBuilder()
  addChain(builder, fit, chain.metal, chain.pendant)
  const geometry = builder.build()
  if (!geometry) return null
  const group = new THREE.Group()
  group.name = 'avatar-jewelry-chain'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'avatar-jewelry-chain-mesh'
  mesh.castShadow = false
  mesh.receiveShadow = false
  group.add(mesh)
  chest.add(group)
  return group
}

function createWristGroup(
  avatarRoot: THREE.Object3D,
  bones: ReadonlyMap<string, THREE.Bone>,
  side: 'L' | 'R',
  pieces: readonly WristPiece[],
  material: THREE.Material,
  materials: THREE.Material[]
): THREE.Group | null {
  const lowerArm = bones.get(`LowerArm${side}`)
  const wrist = bones.get(`Wrist${side}`)
  if (!lowerArm || !wrist || pieces.length === 0) return null
  const fit = measureForearm(avatarRoot, lowerArm, wrist, { head: bones.get('Head'), hips: bones.get('Hips') })
  if (!fit) return null
  const builder = new PartBuilder()
  for (const piece of pieces) {
    if (piece.kind === 'watch') addWatch(builder, fit, piece)
    else addBracelet(builder, fit, piece)
  }
  const geometry = builder.build()
  if (!geometry) return null
  const group = new THREE.Group()
  group.name = `avatar-jewelry-wrist-${side}`
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'avatar-jewelry-wrist-mesh'
  mesh.castShadow = false
  mesh.receiveShadow = false
  group.add(mesh)
  lowerArm.add(group)
  void materials
  return group
}

/** Builds the seed's jewellery and parents it to the bones. Returns the groups (for disposal) and the shared material. */
export function createRiggedJewelry(
  avatarRoot: THREE.Object3D,
  bones: ReadonlyMap<string, THREE.Bone>,
  modelKey: PlayerAvatarModelKey,
  seed: number,
  spec: JewelrySpec = pickJewelry(AVATAR_MODEL_FAMILY[modelKey] ?? null, seed)
): { groups: THREE.Group[]; materials: THREE.Material[]; spec: JewelrySpec } {
  const groups: THREE.Group[] = []
  const material = createAvatarToonMaterial('#ffffff', { metallic: false })
  ;(material as THREE.MeshToonMaterial).vertexColors = true
  ;(material as THREE.MeshToonMaterial).emissive.set('#241d12')
  material.name = 'avatar-jewelry'
  const materials: THREE.Material[] = [material]
  avatarRoot.updateMatrixWorld(true)
  for (const side of ['L', 'R'] as const) {
    const group = createWristGroup(avatarRoot, bones, side, spec.wrist.filter(piece => piece.side === side), material, materials)
    if (group) groups.push(group)
  }
  if (spec.chain) {
    const chain = createChainGroup(avatarRoot, bones, spec.chain, material)
    if (chain) groups.push(chain)
  }
  return { groups, materials, spec }
}
