import * as THREE from 'three'
import type { AvatarFaceRig } from './avatarFace'

/**
 * A yellow sticky note on an avatar's forehead. One shared quad geometry; the
 * note (paper, curled corner, soft shadow, marker text) is a canvas texture
 * cached per text and reference counted. The note hangs off a small anchor
 * group on the Head bone (positioned by avatarFace's forehead measurement), so
 * it follows every head movement. It slaps on with a squash and peels off
 * (falls away) when cleared.
 */

const TEXTURE_SIZE = 256
const POP_SECONDS = 0.34
const PEEL_SECONDS = 0.75
/** Unused textures kept around for quick re-use before the oldest are freed. */
const CACHE_SPARE = 12

interface CachedNote {
  texture: THREE.CanvasTexture
  material: THREE.MeshBasicMaterial
  users: number
}

const cache = new Map<string, CachedNote>()
let sharedGeometry: THREE.PlaneGeometry | null = null

const HAND_FONT = "'Segoe Print', 'Bradley Hand', 'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Comic Neue', cursive"

function drawNote(text: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const size = TEXTURE_SIZE
  const margin = size * 0.09
  const paper = size - margin * 2
  const curl = paper * 0.2

  // Soft drop shadow under the whole sheet.
  ctx.save()
  ctx.shadowColor = 'rgba(40, 25, 0, 0.42)'
  ctx.shadowBlur = size * 0.05
  ctx.shadowOffsetY = size * 0.018
  ctx.fillStyle = '#f7d63a'
  ctx.beginPath()
  ctx.moveTo(margin, margin)
  ctx.lineTo(margin + paper, margin)
  ctx.lineTo(margin + paper, margin + paper - curl)
  ctx.lineTo(margin + paper - curl, margin + paper)
  ctx.lineTo(margin, margin + paper)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Paper: a light-to-warm gradient, brighter strip along the sticky top edge.
  const gradient = ctx.createLinearGradient(0, margin, 0, margin + paper)
  gradient.addColorStop(0, '#ffe860')
  gradient.addColorStop(1, '#f2c92c')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(margin, margin)
  ctx.lineTo(margin + paper, margin)
  ctx.lineTo(margin + paper, margin + paper - curl)
  ctx.lineTo(margin + paper - curl, margin + paper)
  ctx.lineTo(margin, margin + paper)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = size * 0.012
  ctx.strokeStyle = 'rgba(120, 80, 0, 0.55)'
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.fillRect(margin, margin, paper, paper * 0.09)

  // Curled corner: the folded-up flap, darker with a small shadow.
  ctx.save()
  ctx.shadowColor = 'rgba(60, 35, 0, 0.5)'
  ctx.shadowBlur = size * 0.03
  ctx.fillStyle = '#c99a12'
  ctx.beginPath()
  ctx.moveTo(margin + paper, margin + paper - curl)
  ctx.lineTo(margin + paper - curl, margin + paper)
  ctx.lineTo(margin + paper - curl * 0.95, margin + paper - curl * 0.95)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Marker handwriting, shrunk to fit the sheet width.
  const inner = paper * 0.84
  const words = text.length > 5 && text.includes(' ') ? text.split(' ') : [text]
  const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words
  let fontSize = size * (lines.length > 1 ? 0.3 : 0.42)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${fontSize}px ${HAND_FONT}`
  const widest = Math.max(...lines.map(line => ctx.measureText(line).width))
  if (widest > inner) fontSize *= inner / widest
  ctx.font = `800 ${fontSize}px ${HAND_FONT}`
  ctx.fillStyle = '#1e2350'
  ctx.lineJoin = 'round'
  const centerY = margin + paper * 0.46
  lines.forEach((line, index) => {
    const y = centerY + (index - (lines.length - 1) / 2) * fontSize * 1.05
    ctx.fillText(line, size / 2 - size * 0.01, y, inner)
  })
  return canvas
}

function acquire(text: string): CachedNote {
  let entry = cache.get(text)
  if (!entry) {
    const texture = new THREE.CanvasTexture(drawNote(text))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
    // Sits just in front of hair, hats and glasses.
    material.polygonOffset = true
    material.polygonOffsetFactor = -4
    entry = { texture, material, users: 0 }
    cache.set(text, entry)
  }
  entry.users += 1
  return entry
}

function release(text: string) {
  const entry = cache.get(text)
  if (!entry) return
  entry.users = Math.max(0, entry.users - 1)
  if (entry.users > 0) return
  const idle = Array.from(cache.entries()).filter(([, item]) => item.users === 0)
  for (const [key, item] of idle.slice(0, Math.max(0, idle.length - CACHE_SPARE))) {
    item.texture.dispose()
    item.material.dispose()
    cache.delete(key)
  }
}

/** Frees every cached texture (scene teardown). */
export function disposeStickyNoteCache() {
  for (const entry of cache.values()) {
    entry.texture.dispose()
    entry.material.dispose()
  }
  cache.clear()
  sharedGeometry?.dispose()
  sharedGeometry = null
}

export interface StickyNoteFx {
  text: string
  anchor: THREE.Group
  mesh: THREE.Mesh
  roll: number
  age: number
  /** Seconds into the peel-off, or null while stuck on. */
  peeling: number | null
}

function rollFor(text: string) {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) | 0
  return (((hash >>> 0) % 1000) / 1000 - 0.5) * 0.32 + 0.06
}

const raycaster = new THREE.Raycaster()
const scratchOrigin = new THREE.Vector3()
const scratchDirection = new THREE.Vector3()
const scratchScale = new THREE.Vector3()
const scratchQuaternion = new THREE.Quaternion()
const SAMPLES: ReadonlyArray<readonly [number, number]> = [[0, 0], [-0.4, 0], [0.4, 0], [0, 0.35], [-0.4, 0.35], [0.4, 0.35]]

/**
 * How far in front of the skin the note must sit to clear hair, hats and frames:
 * rays fired at the forehead from well in front, the outermost hit wins. Runs once
 * per note (a handful of rays). Result is in Head-space units along the note's normal.
 */
function measureClearance(anchor: THREE.Group, size: number, root: THREE.Object3D | null): number {
  if (!root) return 0
  anchor.updateWorldMatrix(true, false)
  anchor.matrixWorld.decompose(scratchOrigin, scratchQuaternion, scratchScale)
  const worldScale = scratchScale.x
  const reach = size * 6
  let best = 0
  scratchDirection.set(0, 0, -1).transformDirection(anchor.matrixWorld)
  for (const [sx, sy] of SAMPLES) {
    scratchOrigin.set(sx * size, sy * size, reach).applyMatrix4(anchor.matrixWorld)
    raycaster.set(scratchOrigin, scratchDirection)
    raycaster.far = reach * worldScale * 1.5
    const hit = raycaster.intersectObject(root, true).find(item => !item.object.userData.stickyNote && item.object.visible)
    if (hit) best = Math.max(best, reach - hit.distance / worldScale)
  }
  return Math.min(best, size * 1.2)
}

export function createStickyNoteFx(face: AvatarFaceRig, text: string, clearanceRoot: THREE.Object3D | null = null): StickyNoteFx {
  const entry = acquire(text)
  sharedGeometry ??= new THREE.PlaneGeometry(1, 1)
  const anchor = new THREE.Group()
  anchor.name = 'sticky-note'
  anchor.position.copy(face.forehead.position)
  anchor.quaternion.copy(face.forehead.quaternion)
  const mesh = new THREE.Mesh(sharedGeometry, entry.material)
  mesh.renderOrder = 6
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  const size = face.forehead.size
  mesh.scale.setScalar(0.0001)
  mesh.userData.stickyNote = true
  anchor.userData.size = size
  face.headBone.add(anchor)
  anchor.userData.clearance = measureClearance(anchor, size, clearanceRoot) + size * 0.04
  anchor.add(mesh)
  return { text, anchor, mesh, roll: rollFor(text), age: 0, peeling: null }
}

/** Starts the peel-off; the note removes itself once it has fallen away. */
export function peelStickyNote(fx: StickyNoteFx, immediate = false) {
  if (immediate) fx.peeling = PEEL_SECONDS
  else if (fx.peeling === null) fx.peeling = 0
}

/** Advances the pop-in / peel animation. Returns false once the note is gone (already disposed). */
export function updateStickyNoteFx(fx: StickyNoteFx, delta: number, reducedMotion = false): boolean {
  const size = fx.anchor.userData.size as number
  const mesh = fx.mesh
  if (fx.peeling !== null) {
    fx.peeling += delta
    const t = Math.min(1, fx.peeling / PEEL_SECONDS)
    if (t >= 1) {
      disposeStickyNoteFx(fx)
      return false
    }
    // Lifts at a corner, then flutters down and away.
    const ease = t * t
    const s = size * (1 - 0.45 * ease)
    mesh.scale.set(s, s, 1)
    mesh.position.set(Math.sin(t * 9) * size * 0.06 * t, -size * 1.6 * ease, (fx.anchor.userData.clearance as number) + size * 0.5 * ease)
    mesh.rotation.z = fx.roll + t * 1.4
    mesh.rotation.x = -t * 0.9
    return true
  }
  fx.age += delta
  const t = reducedMotion ? 1 : Math.min(1, fx.age / POP_SECONDS)
  // Slap: comes in big, squashes flat against the forehead, settles.
  const pop = t < 0.55 ? 1.5 - 0.5 * (t / 0.55) - 0.1 * (t / 0.55) : 0.9 + 0.1 * ((t - 0.55) / 0.45)
  const squash = t < 0.55 ? 1 : 1 + 0.1 * Math.sin(((t - 0.55) / 0.45) * Math.PI)
  const grow = reducedMotion ? 1 : Math.min(1, t * 3)
  const scale = size * pop * grow
  mesh.scale.set(scale * squash, scale / squash, 1)
  const clearance = fx.anchor.userData.clearance as number
  mesh.position.set(0, 0, clearance + (t < 0.55 ? size * 0.25 * (1 - t / 0.55) : 0))
  mesh.rotation.set(0, 0, fx.roll)
  return true
}

export function disposeStickyNoteFx(fx: StickyNoteFx) {
  if (fx.mesh.userData.disposed) return
  fx.anchor.removeFromParent()
  fx.mesh.userData.disposed = true
  release(fx.text)
}

/**
 * Keeps a seat's note in step with the server text ('' = none): slaps a new
 * one on (replacing any old one) or peels the current one off. Call each frame;
 * returns the note state to store back on the seat.
 */
export function syncStickyNoteFx(
  fx: StickyNoteFx | null,
  face: AvatarFaceRig | null,
  wantedText: string,
  delta: number,
  reducedMotion = false,
  clearanceRoot: THREE.Object3D | null = null
): StickyNoteFx | null {
  let current = fx
  if (current && (current.peeling === null ? current.text !== wantedText : Boolean(wantedText))) {
    if (current.peeling === null && !wantedText) peelStickyNote(current, reducedMotion)
    else {
      // Replaced by another note (or re-stuck mid-peel): the old one just goes.
      disposeStickyNoteFx(current)
      current = null
    }
  }
  if (!current && wantedText && face) current = createStickyNoteFx(face, wantedText, clearanceRoot)
  if (current && !updateStickyNoteFx(current, delta, reducedMotion)) current = null
  return current
}
