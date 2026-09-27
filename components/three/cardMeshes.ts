import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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

/**
 * Card faces must stay readable under any stage light (winner accent, light
 * cone, key spot glare). The lit result is re-expressed as one scalar light
 * level applied to the printed albedo, clamped to a band, so paper never
 * clips to white, ink never lifts to grey, and the face never feeds bloom.
 */
export const CARD_LIGHT_MIN = 0.5
export const CARD_LIGHT_MAX = 0.9

function clampCardLighting(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
        const vec3 cardLuma = vec3(0.2126, 0.7152, 0.0722);
        float cardAlbedo = max(dot(diffuseColor.rgb, cardLuma), 0.04);
        float cardLight = dot(outgoingLight, cardLuma) / cardAlbedo;
        outgoingLight = diffuseColor.rgb * vec3(1.0, 0.985, 0.95) * clamp(cardLight, ${CARD_LIGHT_MIN.toFixed(2)}, ${CARD_LIGHT_MAX.toFixed(2)});
      }
      #include <opaque_fragment>`
    )
  }
  material.customProgramCacheKey = () => 'poker-card-clamped-light'
  return material
}

const edgeMaterial = () => clampCardLighting(new THREE.MeshStandardMaterial({
  color: '#efe3c8',
  roughness: 0.6,
  metalness: 0,
}))

export interface CardMesh {
  group: THREE.Group
  faceMaterial: THREE.MeshStandardMaterial
  backMaterial: THREE.MeshStandardMaterial
  face: CardFace | null
  faceMesh: THREE.Mesh
  backMesh: THREE.Mesh
}

/**
 * A physical card: printed face on +Y, designed back on -Y, cream edge. The
 * group's +Y points up from the felt, so rotating it by PI on Z shows the back.
 */
export function createCardMesh(width: number): CardMesh {
  const geometry = getCardGeometry()
  const group = new THREE.Group()
  group.name = 'playing-card'
  const faceMaterial = clampCardLighting(new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.4,
  }))
  const backMaterial = clampCardLighting(new THREE.MeshStandardMaterial({
    map: getCardBackTexture(),
    roughness: 0.5,
    metalness: 0,
    envMapIntensity: 0.4,
  }))

  const faceMesh = new THREE.Mesh(geometry.face, faceMaterial)
  faceMesh.castShadow = false
  faceMesh.receiveShadow = true
  const backMesh = new THREE.Mesh(geometry.back, backMaterial)
  backMesh.receiveShadow = true
  const edgeMesh = new THREE.Mesh(geometry.edge, edgeMaterial())
  edgeMesh.castShadow = false
  edgeMesh.receiveShadow = true
  group.add(edgeMesh, faceMesh, backMesh)
  group.scale.setScalar(width)

  const card: CardMesh = { group, faceMaterial, backMaterial, face: null, faceMesh, backMesh }
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

const cardUp = new THREE.Vector3()
const cardToCamera = new THREE.Vector3()
const cardWorld = new THREE.Vector3()

/**
 * Only one printed side of a card can face the camera, so skip the draw for
 * the other (backface culling would discard its pixels anyway, but the draw
 * call itself is the cost). Call once per frame after cards are posed.
 */
export function cullHiddenCardSide(card: CardMesh, cameraPosition: THREE.Vector3) {
  const group = card.group
  if (!group.visible) return
  group.updateWorldMatrix(true, false)
  const elements = group.matrixWorld.elements
  cardUp.set(elements[4]!, elements[5]!, elements[6]!)
  cardWorld.setFromMatrixPosition(group.matrixWorld)
  const facing = cardUp.dot(cardToCamera.subVectors(cameraPosition, cardWorld))
  card.faceMesh.visible = facing > -1e-4
  card.backMesh.visible = facing < 1e-4
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
  /** Scene time the card started being swept off the felt (-inf while dealt). */
  leavingAt: number
  highlighted: boolean
  highlightMaterial: THREE.MeshBasicMaterial
  highlightMesh: THREE.Mesh
}

export interface BoardRuntime {
  group: THREE.Group
  slots: BoardSlot[]
  visibleCount: number
  clearedAt: number
  /** Faint printed outlines marking the five board spots. */
  slotOutlines: THREE.Mesh
}

const DEALER_ORIGIN = new THREE.Vector3(0, FELT_TOP_Y + 1.6, -3.2)
/** Where finished boards are swept to (the muck, beside the dealer). */
const MUCK_ORIGIN = new THREE.Vector3(0, FELT_TOP_Y + 0.02, -2.1)
/** Radians the board leans toward the hero's seat. */
const BOARD_TILT = 0.32
/** Seconds the board takes to flip over and slide off to the muck. */
export const BOARD_CLEAR_SECONDS = 0.34

/** A rounded-rect frame (outer minus inner) lying flat on the XZ plane. */
function roundedFrameGeometry(width: number, depth: number, radius: number, border: number) {
  const outer = roundedCardShape(width + border * 2, depth + border * 2, radius + border)
  outer.holes.push(roundedCardShape(width, depth, radius))
  const geometry = new THREE.ShapeGeometry(outer, 6)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** Five community cards that deal out of the far side and flip onto the felt. */
export function createBoardRuntime(scene: THREE.Scene): BoardRuntime {
  const group = new THREE.Group()
  group.name = 'board-cards-3d'
  scene.add(group)

  // Winning cards get a thin gold rim hugging the card (in card-unit space, so
  // it tilts and lifts with the card) instead of any brightening of the face.
  const rimGeometry = roundedFrameGeometry(1.0, 88 / 63, 0.07, 0.07)

  // All five slot outlines merge into one faint draw on the felt.
  const outlineParts = BOARD_XS.map(x => {
    const part = roundedFrameGeometry(BOARD_CARD_WIDTH * 1.04, BOARD_CARD_DEPTH * 1.04, 0.05, 0.012)
    part.translate(x, 0, BOARD_Z)
    return part
  })
  const outlineGeometry = mergeGeometries(outlineParts, false) ?? outlineParts[0]!
  outlineParts.forEach(part => { if (part !== outlineGeometry) part.dispose() })
  const slotOutlines = new THREE.Mesh(outlineGeometry, new THREE.MeshBasicMaterial({
    color: '#e9f5dc',
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  }))
  slotOutlines.name = 'board-slot-outlines'
  slotOutlines.position.y = FELT_TOP_Y + 0.003
  slotOutlines.renderOrder = 1
  group.add(slotOutlines)

  const slots: BoardSlot[] = BOARD_XS.map(x => {
    const card = createCardMesh(BOARD_CARD_WIDTH)
    card.group.position.set(x, FELT_TOP_Y + 0.008, BOARD_Z)
    card.group.visible = false
    group.add(card.group)

    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: '#f2c766',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const highlightMesh = new THREE.Mesh(rimGeometry, highlightMaterial)
    highlightMesh.name = 'board-card-winning-rim'
    highlightMesh.visible = false
    card.group.add(highlightMesh)

    return {
      card,
      key: '',
      dealtAt: Number.NEGATIVE_INFINITY,
      leavingAt: Number.NEGATIVE_INFINITY,
      highlighted: false,
      highlightMaterial,
      highlightMesh,
    }
  })

  return { group, slots, visibleCount: 0, clearedAt: Number.NEGATIVE_INFINITY, slotOutlines }
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
      // A finished board is swept off (flip + slide to the muck) instead of
      // vanishing in one frame; animateBoardRuntime hides it when done.
      if (slot.key && slot.card.group.visible && slot.leavingAt === Number.NEGATIVE_INFINITY) {
        slot.leavingAt = now + index * 0.03
        board.clearedAt = now
      }
      slot.key = ''
      slot.highlighted = false
      return
    }
    const key = `${card.rank}${card.suit}`
    if (slot.key !== key) {
      slot.key = key
      slot.leavingAt = Number.NEGATIVE_INFINITY
      // Flop cards deal together with a stagger; turn and river on their own.
      // A new deal waits for the previous board to finish clearing.
      const clearing = Math.max(0, board.clearedAt + BOARD_CLEAR_SECONDS + 0.12 - now)
      slot.dealtAt = now + clearing + dealtThisSync * 0.16
      dealtThisSync += 1
      setCardFace(slot.card, { rank: card.rank, suit: card.suit })
    }
    slot.card.group.visible = true
    slot.highlighted = highlighted.some(item => item.rank === card.rank && item.suit === card.suit)
  })
  board.visibleCount = count
}

const scratch = new THREE.Vector3()
const slotTarget = new THREE.Vector3()

export function animateBoardRuntime(board: BoardRuntime, time: number, reducedMotion: boolean) {
  board.slots.forEach((slot, index) => {
    const group = slot.card.group
    if (!group.visible) return
    slotTarget.set(BOARD_XS[index]!, FELT_TOP_Y + 0.008, BOARD_Z)

    if (slot.leavingAt !== Number.NEGATIVE_INFINITY) {
      const leave = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.leavingAt) / BOARD_CLEAR_SECONDS, 0, 1)
      if (leave >= 1) {
        group.visible = false
        slot.highlightMesh.visible = false
        slot.leavingAt = Number.NEGATIVE_INFINITY
        group.scale.setScalar(BOARD_CARD_WIDTH)
        return
      }
      // Flip face-down over the long edge while sliding into a squared pile.
      const flip = THREE.MathUtils.smoothstep(leave, 0, 0.55)
      const slide = THREE.MathUtils.smoothstep(leave, 0.2, 1)
      scratch.lerpVectors(slotTarget, MUCK_ORIGIN, slide)
      scratch.y += Math.sin(flip * Math.PI) * 0.12 + index * 0.004 * slide
      group.position.copy(scratch)
      group.rotation.set(BOARD_TILT * (1 - flip), slide * (index - 2) * 0.05, Math.PI * flip)
      group.scale.setScalar(BOARD_CARD_WIDTH * (1 - slide * 0.18))
      slot.highlightMesh.visible = false
      return
    }

    group.scale.setScalar(BOARD_CARD_WIDTH)
    if (time < slot.dealtAt && !reducedMotion) {
      // Parked out of sight until the previous board has cleared.
      group.position.set(DEALER_ORIGIN.x, -10, DEALER_ORIGIN.z)
      slot.highlightMesh.visible = false
      return
    }
    const progress = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.dealtAt) / 0.62, 0, 1)
    const travel = 1 - Math.pow(1 - Math.min(1, progress / 0.62), 3)
    const flip = THREE.MathUtils.smoothstep(progress, 0.45, 1)
    scratch.lerpVectors(DEALER_ORIGIN, slotTarget, travel)
    scratch.y += Math.sin(travel * Math.PI) * 0.35 + (1 - flip) * 0.06
    const landing = progress >= 1 ? 0 : Math.sin(THREE.MathUtils.clamp((progress - 0.88) / 0.12, 0, 1) * Math.PI) * 0.015
    group.position.set(scratch.x, scratch.y + landing, scratch.z)
    // Face down (rotation PI) while travelling, flipping over the long edge,
    // then propped slightly toward the seated player so the board reads easily.
    const prop = BOARD_TILT * flip
    group.rotation.set(prop, (1 - travel) * 0.6, Math.PI * (1 - flip))
    group.position.y += Math.sin(prop) * BOARD_CARD_DEPTH * 0.5

    // Winning cards rise a touch and wear a steady gold rim; the face itself
    // is never brightened so ranks and suits stay crisp.
    const rim = slot.highlighted && progress >= 1
      ? 0.82 + (reducedMotion ? 0 : Math.sin(time * 3.2 + index) * 0.12)
      : 0
    slot.highlightMesh.visible = rim > 0
    slot.highlightMaterial.opacity = rim
    group.position.y += rim > 0 ? 0.07 : 0
  })
}
