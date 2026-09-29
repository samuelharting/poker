import * as THREE from 'three'

/**
 * Expressive cartoon faces for the rigged avatars.
 *
 * The source models paint tiny eyes and brows onto the head. We locate those
 * painted regions in the skinned mesh (by material name), hide them, and mount
 * real eyes (sclera, pupil, eyelids), brows and a morphing mouth on the Head
 * bone at the same spots. The eyes blink, dart around and look at the action,
 * and the whole face can emote: focused, surprised, happy, sad, bored.
 *
 * Cost: per eye 3 meshes, 2 brows, 1 mouth ribbon. The mouth vertex buffer is
 * 22 floats rewritten only when the shape actually changes.
 */

export type FaceMood = 'neutral' | 'focused' | 'surprised' | 'happy' | 'sad' | 'bored'

interface EyeRig {
  root: THREE.Group
  ball: THREE.Mesh
  pupil: THREE.Group
  upperLid: THREE.Mesh
  lowerLid: THREE.Mesh
  radius: number
  side: 1 | -1
}

interface BrowRig {
  mesh: THREE.Mesh
  base: THREE.Vector3
  side: 1 | -1
}

/** One dynamic ribbon mesh that morphs between a line, smile, frown and open "O" (a single draw). */
interface MouthRig {
  mesh: THREE.Mesh
  positions: THREE.BufferAttribute
  halfWidth: number
  thickness: number
  /** Last written shape, to skip redundant buffer uploads. */
  last: [number, number, number]
}

export interface AvatarFaceRig {
  eyes: EyeRig[]
  brows: BrowRig[]
  mouth: MouthRig | null
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
  /** Painted-over eye/brow patches and lids: they follow the live skin colour (flush, folded shading). */
  skinFollowers: THREE.MeshToonMaterial[]
  skinSource: THREE.MeshToonMaterial | null
  /** Smoothed expression channels. */
  state: {
    open: number
    lookX: number
    lookY: number
    browLift: number
    browTilt: number
    squint: number
    smile: number
    mouthOpen: number
    mouthWidth: number
    time: number
    saccadeX: number
    saccadeY: number
    nextSaccade: number
    seed: number
  }
}

const MOUTH_SEGMENTS = 10

function createMouthGeometry() {
  const geometry = new THREE.BufferGeometry()
  const positions = new THREE.BufferAttribute(new Float32Array((MOUTH_SEGMENTS + 1) * 2 * 3), 3)
  positions.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positions)
  const indices: number[] = []
  for (let i = 0; i < MOUTH_SEGMENTS; i += 1) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  geometry.setIndex(indices)
  return { geometry, positions }
}

/** smile: -1 frown .. +1 smile; open: 0 closed .. 1 wide "O"; width: horizontal scale. */
function writeMouth(mouth: MouthRig, smile: number, open: number, width: number) {
  const last = mouth.last
  if (Math.abs(last[0] - smile) + Math.abs(last[1] - open) + Math.abs(last[2] - width) < 0.002) return
  last[0] = smile
  last[1] = open
  last[2] = width
  const halfW = mouth.halfWidth * width
  const array = mouth.positions.array as Float32Array
  const bend = halfW * 0.5 * smile
  const openHeight = halfW * 0.85 * open
  for (let i = 0; i <= MOUTH_SEGMENTS; i += 1) {
    const u = (i / MOUTH_SEGMENTS) * 2 - 1
    const edge = 1 - u * u
    const centerY = bend * (u * u - 0.4)
    const thick = mouth.thickness * (0.35 + 0.65 * edge) * (1 + open * 0.3)
    const o = i * 6
    array[o] = u * halfW
    array[o + 1] = centerY + thick
    array[o + 2] = 0
    array[o + 3] = u * halfW
    array[o + 4] = centerY - thick - openHeight * Math.pow(edge, 0.7)
    array[o + 5] = 0
  }
  mouth.positions.needsUpdate = true
  mouth.mesh.geometry.computeBoundingSphere()
}

/** Collects the bind-pose positions (in Head-bone space) of vertices painted with a material. */
function collectRegion(
  model: THREE.Object3D,
  headBone: THREE.Bone,
  materialPattern: RegExp
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  model.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.material) return
    const headIndex = mesh.skeleton.bones.indexOf(headBone)
    if (headIndex < 0) return
    const toHead = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[headIndex]!, mesh.bindMatrix)
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    // GLTF splits multi-material meshes into one primitive per material, so a
    // single-material mesh has no groups: treat it as one group spanning it all.
    const groups = mesh.geometry.groups.length > 0
      ? mesh.geometry.groups
      : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }]
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]
      if (!material || !materialPattern.test(material.name)) continue
      for (let cursor = group.start; cursor < group.start + group.count; cursor += 1) {
        const vertex = index ? index.getX(cursor) : cursor
        points.push(new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(toHead))
      }
    }
  })
  return points
}

function splitBySide(points: THREE.Vector3[]) {
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(Math.max(1, points.length))
  const left = points.filter(point => point.x < center.x)
  const right = points.filter(point => point.x >= center.x)
  const box = (list: THREE.Vector3[]) => new THREE.Box3().setFromPoints(list)
  return { center, left: left.length ? box(left) : null, right: right.length ? box(right) : null }
}

/** Hides the painted eyes/brows by matching them to the skin tone. */
function paintOver(materials: readonly THREE.Material[], pattern: RegExp, skin: THREE.Color | null) {
  if (!skin) return
  for (const material of materials) {
    const tinted = material as THREE.MeshToonMaterial
    if (pattern.test(material.name) && tinted.color) tinted.color.copy(skin)
  }
}

export function createAvatarFace(
  model: THREE.Object3D,
  headBone: THREE.Bone | undefined,
  materials: readonly THREE.Material[],
  skinColor: THREE.Color | null,
  eyewear: 'none' | 'round' | 'aviator' | 'shades' | string = 'none',
  seed = 0.5
): AvatarFaceRig | null {
  if (!headBone) return null
  const eyePoints = collectRegion(model, headBone, /^eye$/i)
  if (eyePoints.length < 6) return null
  const browPoints = collectRegion(model, headBone, /^eyebrows?$/i)

  const { center, left, right } = splitBySide(eyePoints)
  if (!left || !right) return null
  // Face forward in Head space: from the head origin through the eyes, flattened.
  const forward = new THREE.Vector3(center.x * 0, 0, center.z).normalize()
  if (forward.lengthSq() < 0.5) forward.set(0, 0, 1)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward)

  const created: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  const toon = (color: THREE.ColorRepresentation) => {
    const material = new THREE.MeshToonMaterial({ color })
    created.push(material)
    return material
  }
  const basic = (color: THREE.ColorRepresentation) => {
    const material = new THREE.MeshBasicMaterial({ color })
    created.push(material)
    return material
  }
  const sclera = toon('#fbf8f2')
  const iris = basic('#1d1410')
  const lid = toon(skinColor ?? '#d9a37c')
  const browMaterial = toon('#2a1a12')

  const eyeWidth = Math.max(left.max.x - left.min.x, right.max.x - right.min.x)
  const eyeHeight = Math.max(left.max.y - left.min.y, right.max.y - right.min.y)
  const radius = Math.max(eyeWidth, eyeHeight) * 1.05

  const sphere = new THREE.SphereGeometry(1, 20, 14)
  const pupilDisc = new THREE.CircleGeometry(1, 20)
  const lidGeometry = new THREE.SphereGeometry(1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
  geometries.push(sphere, pupilDisc, lidGeometry)

  // The face surface around each eye (skin in Head space), so the cartoon
  // eyes sit *on* the head instead of bulging out of it in profile.
  const skinPoints = collectRegion(model, headBone, /^skin$/i)
  const surfaceDepthAt = (center: THREE.Vector3) => {
    let best = -Infinity
    for (const point of skinPoints) {
      if (Math.abs(point.x - center.x) < radius * 0.9 && Math.abs(point.y - center.y) < radius * 0.9) {
        best = Math.max(best, point.dot(forward))
      }
    }
    return Number.isFinite(best) ? best : center.dot(forward) + radius * 0.3
  }
  const BALL_DEPTH = 0.5
  const eyes: EyeRig[] = []
  for (const [box, side] of [[right, 1], [left, -1]] as const) {
    const eyeCenter = box.getCenter(new THREE.Vector3())
    const root = new THREE.Group()
    root.name = 'cartoon-eye'
    // Only a shallow dome of the eyeball shows in front of the face (less
    // still behind glasses, so the lenses clear them).
    const protrude = radius * (eyewear === 'none' ? 0.26 : 0.14)
    const along = eyeCenter.dot(forward)
    root.position.copy(eyeCenter).addScaledVector(forward, surfaceDepthAt(eyeCenter) + protrude - radius * BALL_DEPTH - along)
    // Follow the curve of the face: each eye turns slightly outward.
    root.quaternion.copy(quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.22))
    root.scale.setScalar(radius)

    const ball = new THREE.Mesh(sphere, sclera)
    ball.scale.set(0.9, 1.1, BALL_DEPTH)
    root.add(ball)

    const pupil = new THREE.Group()
    const irisMesh = new THREE.Mesh(pupilDisc, iris)
    irisMesh.scale.setScalar(0.56)
    pupil.add(irisMesh)
    pupil.position.z = BALL_DEPTH + 0.015
    root.add(pupil)

    const upperLid = new THREE.Mesh(lidGeometry, lid)
    upperLid.scale.set(0.94, 1.12, BALL_DEPTH + 0.08)
    root.add(upperLid)
    // A single upper lid handles blinks, squints and droops (one draw per eye).
    const lowerLid = upperLid

    headBone.add(root)
    eyes.push({ root, ball, pupil, upperLid, lowerLid, radius, side })
  }

  const brows: BrowRig[] = []
  const browSplit = browPoints.length > 6 ? splitBySide(browPoints) : null
  const browGeometry = new THREE.CapsuleGeometry(0.22, 1.1, 4, 8)
  browGeometry.rotateZ(Math.PI / 2)
  geometries.push(browGeometry)
  for (const eye of eyes) {
    const browBox = eye.side === 1 ? browSplit?.right : browSplit?.left
    const base = browBox
      ? browBox.getCenter(new THREE.Vector3()).addScaledVector(forward, radius * 0.5).add(new THREE.Vector3(0, radius * 0.45, 0))
      : eye.root.position.clone().add(new THREE.Vector3(0, radius * 1.5, 0))
    const mesh = new THREE.Mesh(browGeometry, browMaterial)
    mesh.name = 'cartoon-brow'
    mesh.position.copy(base)
    mesh.quaternion.copy(quaternion)
    mesh.scale.setScalar(radius * 0.9)
    headBone.add(mesh)
    brows.push({ mesh, base, side: eye.side })
  }

  paintOver(materials, /^eye$/i, skinColor)
  paintOver(materials, /^eyebrows?$/i, skinColor)
  const skinSource = (materials.find(material => /^skin$/i.test(material.name)) as THREE.MeshToonMaterial | undefined) ?? null
  const skinFollowers: THREE.MeshToonMaterial[] = skinSource
    ? materials.filter(material => /^(eye|eyebrows?)$/i.test(material.name) && (material as THREE.MeshToonMaterial).color) as THREE.MeshToonMaterial[]
    : []
  if (skinSource) skinFollowers.push(lid)

  // Opaque sunglasses hide the eyes (and brows sit above the frames).
  const shaded = eyewear === 'shades' || eyewear === 'aviator'
  for (const eye of eyes) eye.root.visible = !shaded

  // A single morphing mouth ribbon sitting on the face surface under the nose.
  const mouthMaterial = new THREE.MeshBasicMaterial({ color: '#3a1410', side: THREE.DoubleSide })
  created.push(mouthMaterial)
  const eyeMid = eyes[0]!.root.position.clone().lerp(eyes[1]!.root.position, 0.5)
  const mouthProbe = new THREE.Vector3(eyeMid.x, eyeMid.y - radius * 2.7, eyeMid.z)
  let mouthDepth: number | null = null
  {
    const depths: number[] = []
    for (const point of skinPoints) {
      if (Math.abs(point.x - mouthProbe.x) < radius * 0.9 && Math.abs(point.y - mouthProbe.y) < radius * 0.55) {
        depths.push(point.dot(forward))
      }
    }
    if (depths.length > 0) {
      depths.sort((a, b) => b - a)
      const top = depths.slice(0, 3)
      mouthDepth = top.reduce((sum, value) => sum + value, 0) / top.length
    }
  }
  const { geometry: mouthGeometry, positions: mouthPositions } = createMouthGeometry()
  geometries.push(mouthGeometry)
  const mouthMesh = new THREE.Mesh(mouthGeometry, mouthMaterial)
  mouthMesh.name = 'cartoon-mouth'
  const mouthAlong = mouthProbe.dot(forward)
  const depth = mouthDepth ?? eyes[0]!.root.position.dot(forward) - radius * 0.1
  mouthMesh.position.copy(mouthProbe).addScaledVector(forward, depth + radius * 0.07 - mouthAlong)
  mouthMesh.quaternion.copy(quaternion)
  mouthMesh.frustumCulled = false
  headBone.add(mouthMesh)
  const mouth: MouthRig = {
    mesh: mouthMesh,
    positions: mouthPositions,
    halfWidth: radius * 0.85,
    thickness: radius * 0.11,
    last: [9, 9, 9],
  }
  writeMouth(mouth, 0.1, 0, 1)

  return {
    eyes,
    brows,
    mouth,
    materials: created,
    geometries,
    skinFollowers,
    skinSource,
    state: {
      open: 1, lookX: 0, lookY: 0, browLift: 0, browTilt: 0, squint: 0,
      smile: 0.1, mouthOpen: 0, mouthWidth: 1,
      time: seed * 40, saccadeX: 0, saccadeY: 0, nextSaccade: 1 + seed * 2, seed,
    },
  }
}

export interface FaceInput {
  delta: number
  blink: number
  mood: FaceMood
  /** Look direction, roughly -1..1 (yaw) and -1..1 (pitch, + = down). */
  lookX: number
  lookY: number
  reducedMotion: boolean
}

const MOODS: Record<FaceMood, {
  open: number
  browLift: number
  browTilt: number
  squint: number
  smile: number
  mouthOpen: number
  mouthWidth: number
}> = {
  neutral: { open: 0.93, browLift: 0, browTilt: 0, squint: 0, smile: 0.1, mouthOpen: 0, mouthWidth: 1 },
  focused: { open: 0.88, browLift: -0.35, browTilt: 0.35, squint: 0.2, smile: -0.12, mouthOpen: 0, mouthWidth: 0.78 },
  surprised: { open: 1.2, browLift: 0.9, browTilt: -0.1, squint: 0, smile: 0, mouthOpen: 1, mouthWidth: 0.5 },
  happy: { open: 0.6, browLift: 0.45, browTilt: -0.2, squint: 0.9, smile: 0.95, mouthOpen: 0.4, mouthWidth: 1.15 },
  sad: { open: 0.62, browLift: 0.2, browTilt: -0.55, squint: 0, smile: -0.75, mouthOpen: 0, mouthWidth: 0.85 },
  bored: { open: 0.62, browLift: -0.1, browTilt: 0, squint: 0, smile: -0.18, mouthOpen: 0, mouthWidth: 0.9 },
}

/** Deterministic pseudo-random in 0..1 (no allocations; reproducible per avatar). */
function hash01(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Applies blink, gaze, lids, brows and mouth for this frame. */
export function updateAvatarFace(face: AvatarFaceRig, input: FaceInput) {
  const target = MOODS[input.mood]
  const rate = input.reducedMotion ? 1 : 1 - Math.exp(-input.delta * 12)
  const slow = input.reducedMotion ? 1 : 1 - Math.exp(-input.delta * 7)
  const gazeRate = input.reducedMotion ? 1 : 1 - Math.exp(-input.delta * 18)
  const state = face.state
  state.time += input.delta
  state.open += (target.open - state.open) * rate
  state.browLift += (target.browLift - state.browLift) * rate
  state.browTilt += (target.browTilt - state.browTilt) * rate
  state.squint += (target.squint - state.squint) * rate
  state.smile += (target.smile - state.smile) * slow
  state.mouthOpen += (target.mouthOpen - state.mouthOpen) * slow
  state.mouthWidth += (target.mouthWidth - state.mouthWidth) * slow

  // Small darting eye movements (saccades) so the gaze never looks frozen.
  if (!input.reducedMotion && state.time >= state.nextSaccade) {
    const n = Math.floor(state.time * 3)
    state.saccadeX = (hash01(state.seed * 91 + n) - 0.5) * 0.3
    state.saccadeY = (hash01(state.seed * 53 + n * 1.7) - 0.5) * 0.18
    state.nextSaccade = state.time + 1.1 + hash01(state.seed * 17 + n * 2.3) * 2.6
  }
  const wantX = THREE.MathUtils.clamp(input.lookX, -1, 1) + state.saccadeX
  const wantY = THREE.MathUtils.clamp(input.lookY, -1, 1) + state.saccadeY
  state.lookX += (wantX - state.lookX) * gazeRate
  state.lookY += (wantY - state.lookY) * gazeRate

  // Looking down drops the lids a little, looking up lifts them.
  const gazeLid = THREE.MathUtils.clamp(state.lookY, -1, 1) * 0.05
  const open = Math.max(0, (state.open - gazeLid) * (1 - input.blink))
  for (const eye of face.eyes) {
    // Positive X swings the upper cap's pole forward over the pupil (closed);
    // negative tucks it up and back (open).
    eye.upperLid.rotation.x = THREE.MathUtils.lerp(1.45, -0.95, Math.min(1.1, open))
    eye.ball.scale.y = 1.1 * (0.92 + Math.min(0.2, Math.max(0, state.open - 1)))
    eye.pupil.position.x = THREE.MathUtils.clamp(state.lookX, -1.2, 1.2) * 0.26
    eye.pupil.position.y = -THREE.MathUtils.clamp(state.lookY, -1.2, 1.2) * 0.2
  }
  if (face.skinSource) {
    for (const follower of face.skinFollowers) follower.color.copy(face.skinSource.color)
  }
  if (face.mouth) writeMouth(face.mouth, state.smile, state.mouthOpen, state.mouthWidth)
  const radius = face.eyes[0]!.radius
  const blinkDip = input.blink * radius * 0.12
  for (const brow of face.brows) {
    const lift = state.browLift * radius * 0.6 - blinkDip
    brow.mesh.position.set(brow.base.x, brow.base.y + lift, brow.base.z)
    brow.mesh.rotation.z = brow.side * state.browTilt * 0.5
  }
}

export function disposeAvatarFace(face: AvatarFaceRig | null) {
  if (!face) return
  face.eyes.forEach(eye => eye.root.removeFromParent())
  face.brows.forEach(brow => brow.mesh.removeFromParent())
  face.mouth?.mesh.removeFromParent()
  face.materials.forEach(material => material.dispose())
  face.geometries.forEach(geometry => geometry.dispose())
}
