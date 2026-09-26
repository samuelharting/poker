import * as THREE from 'three'

/**
 * Expressive cartoon faces for the rigged avatars.
 *
 * The source models paint tiny eyes and brows onto the head. We locate those
 * painted regions in the skinned mesh (by material name), hide them, and mount
 * real eyes (sclera, pupil, glint, eyelids) and brows on the Head bone at the
 * same spots. The eyes can then blink, look at the action, and the whole face
 * can emote: focused, surprised, happy, sad, bored.
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

export interface AvatarFaceRig {
  eyes: EyeRig[]
  brows: BrowRig[]
  mouth: { smile: THREE.Mesh; line: THREE.Mesh; ring: THREE.Mesh } | null
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
  /** Smoothed expression channels. */
  state: { open: number; lookX: number; lookY: number; browLift: number; browTilt: number; squint: number }
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
  eyewear: 'none' | 'round' | 'aviator' | 'shades' | string = 'none'
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
  const radius = Math.max(eyeWidth, eyeHeight) * 1.15

  const sphere = new THREE.SphereGeometry(1, 20, 14)
  const pupilDisc = new THREE.CircleGeometry(1, 20)
  const lidGeometry = new THREE.SphereGeometry(1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
  geometries.push(sphere, pupilDisc, lidGeometry)

  const eyes: EyeRig[] = []
  for (const [box, side] of [[right, 1], [left, -1]] as const) {
    const eyeCenter = box.getCenter(new THREE.Vector3())
    const root = new THREE.Group()
    root.name = 'cartoon-eye'
    // Clear glasses sit in front: keep the eyes tucked in behind the lenses.
    root.position.copy(eyeCenter).addScaledVector(forward, radius * (eyewear === 'none' ? 0.22 : 0.02))
    root.quaternion.copy(quaternion)
    root.scale.setScalar(radius)

    const ball = new THREE.Mesh(sphere, sclera)
    ball.scale.set(0.9, 1.1, eyewear === 'none' ? 0.62 : 0.45)
    root.add(ball)

    const pupil = new THREE.Group()
    const irisMesh = new THREE.Mesh(pupilDisc, iris)
    irisMesh.scale.setScalar(0.46)
    pupil.add(irisMesh)
    pupil.position.z = 0.63
    root.add(pupil)

    const upperLid = new THREE.Mesh(lidGeometry, lid)
    upperLid.scale.set(0.94, 1.12, 0.7)
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

  // Opaque sunglasses hide the eyes (and brows sit above the frames).
  const shaded = eyewear === 'shades' || eyewear === 'aviator'
  for (const eye of eyes) eye.root.visible = !shaded

  // A simple cartoon mouth under the eyes that changes with mood.
  const mouthMaterial = basic('#3a1410')
  const mouthCenter = eyes[0]!.root.position.clone().lerp(eyes[1]!.root.position, 0.5)
    .add(new THREE.Vector3(0, -radius * 2.5, 0))
  const arc = new THREE.TorusGeometry(radius * 0.9, radius * 0.14, 6, 18, Math.PI)
  const line = new THREE.CapsuleGeometry(radius * 0.13, radius * 1.1, 3, 6)
  line.rotateZ(Math.PI / 2)
  const ring = new THREE.TorusGeometry(radius * 0.38, radius * 0.14, 6, 18)
  geometries.push(arc, line, ring)
  const makeMouthPart = (geometry: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geometry, mouthMaterial)
    mesh.position.copy(mouthCenter)
    mesh.quaternion.copy(quaternion)
    mesh.name = 'cartoon-mouth'
    headBone.add(mesh)
    return mesh
  }
  const smile = makeMouthPart(arc)
  const mouthLine = makeMouthPart(line)
  const mouthRing = makeMouthPart(ring)
  mouthRing.visible = false
  smile.visible = false

  return {
    eyes,
    brows,
    mouth: { smile, line: mouthLine, ring: mouthRing },
    materials: created,
    geometries,
    state: { open: 1, lookX: 0, lookY: 0, browLift: 0, browTilt: 0, squint: 0 },
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

const MOODS: Record<FaceMood, { open: number; browLift: number; browTilt: number; squint: number }> = {
  neutral: { open: 1, browLift: 0, browTilt: 0, squint: 0 },
  focused: { open: 0.78, browLift: -0.35, browTilt: 0.35, squint: 0.2 },
  surprised: { open: 1.2, browLift: 0.9, browTilt: -0.1, squint: 0 },
  happy: { open: 0.55, browLift: 0.45, browTilt: -0.2, squint: 0.9 },
  sad: { open: 0.6, browLift: 0.2, browTilt: -0.55, squint: 0 },
  bored: { open: 0.5, browLift: -0.1, browTilt: 0, squint: 0 },
}

/** Applies blink, gaze, lids and brows for this frame. */
export function updateAvatarFace(face: AvatarFaceRig, input: FaceInput) {
  const target = MOODS[input.mood]
  const rate = input.reducedMotion ? 1 : 1 - Math.exp(-input.delta * 12)
  const state = face.state
  state.open += (target.open - state.open) * rate
  state.browLift += (target.browLift - state.browLift) * rate
  state.browTilt += (target.browTilt - state.browTilt) * rate
  state.squint += (target.squint - state.squint) * rate
  state.lookX += (THREE.MathUtils.clamp(input.lookX, -1, 1) - state.lookX) * rate
  state.lookY += (THREE.MathUtils.clamp(input.lookY, -1, 1) - state.lookY) * rate

  const open = Math.max(0, state.open * (1 - input.blink))
  for (const eye of face.eyes) {
    // Upper lid rotates down over the eye as it closes; the lower lid rises on a squint.
    // Positive X swings the upper cap's pole forward over the pupil (closed);
    // negative tucks it up and back (open). The lower cap rises on a squint.
    eye.upperLid.rotation.x = THREE.MathUtils.lerp(1.45, -0.95, Math.min(1.1, open))
    eye.ball.scale.y = 1.1 * (0.92 + Math.min(0.2, Math.max(0, state.open - 1)))
    eye.pupil.position.x = state.lookX * 0.28
    eye.pupil.position.y = -state.lookY * 0.22
  }
  if (face.mouth) {
    const { smile, line, ring } = face.mouth
    const mood = input.mood
    smile.visible = mood === 'happy' || mood === 'sad'
    // The arc opens upward for a smile and flips for a frown.
    smile.rotation.z = mood === 'sad' ? 0 : Math.PI
    ring.visible = mood === 'surprised'
    line.visible = !smile.visible && !ring.visible
    line.scale.x = mood === 'focused' ? 0.7 : 1
  }
  for (const brow of face.brows) {
    const lift = state.browLift * face.eyes[0]!.radius * 0.6
    brow.mesh.position.set(brow.base.x, brow.base.y + lift, brow.base.z)
    brow.mesh.rotation.z = brow.side * state.browTilt * 0.5
  }
}

export function disposeAvatarFace(face: AvatarFaceRig | null) {
  if (!face) return
  face.eyes.forEach(eye => eye.root.removeFromParent())
  face.brows.forEach(brow => brow.mesh.removeFromParent())
  if (face.mouth) Object.values(face.mouth).forEach(mesh => mesh.removeFromParent())
  face.materials.forEach(material => material.dispose())
  face.geometries.forEach(geometry => geometry.dispose())
}
