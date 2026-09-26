import * as THREE from 'three'
import {
  getCardBackTexture,
  getCardFaceTexture,
  type CardSuit,
} from './sceneTextures'
import {
  BOARD_CARD_DEPTH,
  BOARD_CARD_WIDTH,
  BOARD_XS,
  BOARD_Z,
  FELT_TOP_Y,
} from './tableArt'

export interface CardFace {
  rank: string
  suit: CardSuit
}

const CARD_THICKNESS = 0.012

function roundedCardShape(width: number, depth: number, radius: number) {
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -depth / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + depth - radius)
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth)
  shape.lineTo(x + radius, y + depth)
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  return shape
}

let sharedGeometry: {
  face: THREE.ShapeGeometry
  back: THREE.ShapeGeometry
  edge: THREE.ExtrudeGeometry
} | null = null

/** Unit card geometry (width 1). Callers scale the group to the size they need. */
function getCardGeometry() {
  if (sharedGeometry) return sharedGeometry
  const depth = 88 / 63
  const shape = roundedCardShape(1, depth, 0.07)

  const face = new THREE.ShapeGeometry(shape, 6)
  const uv = face.getAttribute('uv')
  const position = face.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    uv.setXY(index, position.getX(index) + 0.5, position.getY(index) / depth + 0.5)
  }
  face.rotateX(-Math.PI / 2)
  face.translate(0, CARD_THICKNESS / 2 + 0.0005, 0)

  const back = face.clone()
  back.rotateZ(Math.PI)
  back.translate(0, 0, 0)

  const edge = new THREE.ExtrudeGeometry(shape, {
    depth: CARD_THICKNESS,
    bevelEnabled: false,
    curveSegments: 6,
  })
  edge.rotateX(-Math.PI / 2)
  edge.translate(0, -CARD_THICKNESS / 2, 0)

  sharedGeometry = { face, back, edge }
  return sharedGeometry
}

const edgeMaterial = () => new THREE.MeshStandardMaterial({
  color: '#efe3c8',
  roughness: 0.6,
  metalness: 0,
})

export interface CardMesh {
  group: THREE.Group
  faceMaterial: THREE.MeshStandardMaterial
  backMaterial: THREE.MeshStandardMaterial
  face: CardFace | null
}

/**
 * A physical card: printed face on +Y, designed back on -Y, cream edge. The
 * group's +Y points up from the felt, so rotating it by PI on Z shows the back.
 */
export function createCardMesh(width: number): CardMesh {
  const geometry = getCardGeometry()
  const group = new THREE.Group()
  group.name = 'playing-card'
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 0.6,
  })
  const backMaterial = new THREE.MeshStandardMaterial({
    map: getCardBackTexture(),
    roughness: 0.38,
    metalness: 0,
    envMapIntensity: 0.6,
  })

  const faceMesh = new THREE.Mesh(geometry.face, faceMaterial)
  faceMesh.castShadow = false
  faceMesh.receiveShadow = true
  const backMesh = new THREE.Mesh(geometry.back, backMaterial)
  backMesh.receiveShadow = true
  const edgeMesh = new THREE.Mesh(geometry.edge, edgeMaterial())
  edgeMesh.castShadow = true
  edgeMesh.receiveShadow = true
  group.add(edgeMesh, faceMesh, backMesh)
  group.scale.setScalar(width)

  const card: CardMesh = { group, faceMaterial, backMaterial, face: null }
  setCardFace(card, null)
  return card
}

export function setCardFace(card: CardMesh, face: CardFace | null) {
  const sameFace = card.face?.rank === face?.rank && card.face?.suit === face?.suit
  if (sameFace && card.faceMaterial.map) return
  card.face = face
  card.faceMaterial.map = face ? getCardFaceTexture(face.rank, face.suit) : getCardBackTexture()
  card.faceMaterial.needsUpdate = true
}

export function disposeCardMesh(card: CardMesh) {
  card.group.removeFromParent()
  card.faceMaterial.dispose()
  card.backMaterial.dispose()
  card.group.traverse(object => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material !== card.faceMaterial && mesh.material !== card.backMaterial) {
      mesh.material.dispose()
    }
  })
}

interface BoardSlot {
  card: CardMesh
  key: string
  dealtAt: number
  highlighted: boolean
  highlightMaterial: THREE.MeshBasicMaterial
  highlightMesh: THREE.Mesh
}

export interface BoardRuntime {
  group: THREE.Group
  slots: BoardSlot[]
  visibleCount: number
  clearedAt: number
}

const DEALER_ORIGIN = new THREE.Vector3(0, FELT_TOP_Y + 1.6, -3.2)

/** Five community cards that deal out of the far side and flip onto the felt. */
export function createBoardRuntime(scene: THREE.Scene): BoardRuntime {
  const group = new THREE.Group()
  group.name = 'board-cards-3d'
  scene.add(group)

  const glowShape = roundedCardShape(BOARD_CARD_WIDTH * 1.16, BOARD_CARD_DEPTH * 1.12, 0.08)
  const glowGeometry = new THREE.ShapeGeometry(glowShape, 6)
  glowGeometry.rotateX(-Math.PI / 2)

  const slots: BoardSlot[] = BOARD_XS.map(x => {
    const card = createCardMesh(BOARD_CARD_WIDTH)
    card.group.position.set(x, FELT_TOP_Y + 0.008, BOARD_Z)
    card.group.visible = false
    group.add(card.group)

    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: '#ffd978',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const highlightMesh = new THREE.Mesh(glowGeometry, highlightMaterial)
    highlightMesh.position.set(x, FELT_TOP_Y + 0.004, BOARD_Z)
    highlightMesh.visible = false
    group.add(highlightMesh)

    return {
      card,
      key: '',
      dealtAt: Number.NEGATIVE_INFINITY,
      highlighted: false,
      highlightMaterial,
      highlightMesh,
    }
  })

  return { group, slots, visibleCount: 0, clearedAt: Number.NEGATIVE_INFINITY }
}

export function syncBoardRuntime(
  board: BoardRuntime,
  cards: ReadonlyArray<{ rank: string; suit: CardSuit }>,
  highlighted: ReadonlyArray<{ rank: string; suit: CardSuit }>,
  now: number
) {
  const count = Math.min(5, cards.length)
  let dealtThisSync = 0
  board.slots.forEach((slot, index) => {
    const card = cards[index]
    if (!card || index >= count) {
      slot.key = ''
      slot.card.group.visible = false
      slot.highlightMesh.visible = false
      slot.highlighted = false
      return
    }
    const key = `${card.rank}${card.suit}`
    if (slot.key !== key) {
      slot.key = key
      // Flop cards deal together with a stagger; turn and river on their own.
      slot.dealtAt = now + dealtThisSync * 0.16
      dealtThisSync += 1
      setCardFace(slot.card, { rank: card.rank, suit: card.suit })
    }
    slot.card.group.visible = true
    slot.highlighted = highlighted.some(item => item.rank === card.rank && item.suit === card.suit)
  })
  board.visibleCount = count
}

const scratch = new THREE.Vector3()

export function animateBoardRuntime(board: BoardRuntime, time: number, reducedMotion: boolean) {
  board.slots.forEach((slot, index) => {
    if (!slot.card.group.visible) return
    const target = new THREE.Vector3(BOARD_XS[index]!, FELT_TOP_Y + 0.008, BOARD_Z)
    const progress = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.dealtAt) / 0.62, 0, 1)
    const travel = 1 - Math.pow(1 - Math.min(1, progress / 0.62), 3)
    const flip = THREE.MathUtils.smoothstep(progress, 0.45, 1)
    scratch.lerpVectors(DEALER_ORIGIN, target, travel)
    scratch.y += Math.sin(travel * Math.PI) * 0.35 + (1 - flip) * 0.06
    const landing = progress >= 1 ? 0 : Math.sin(THREE.MathUtils.clamp((progress - 0.88) / 0.12, 0, 1) * Math.PI) * 0.015
    slot.card.group.position.set(scratch.x, scratch.y + landing, scratch.z)
    // Face down (rotation PI) while travelling, flipping over the long edge.
    slot.card.group.rotation.set(0, (1 - travel) * 0.6, Math.PI * (1 - flip))

    const glow = slot.highlighted ? 0.55 + (reducedMotion ? 0 : Math.sin(time * 4 + index) * 0.2) : 0
    slot.highlightMesh.visible = glow > 0
    slot.highlightMaterial.opacity = glow
    const lift = slot.highlighted && progress >= 1 ? 0.04 : 0
    slot.card.group.position.y += lift
  })
}
