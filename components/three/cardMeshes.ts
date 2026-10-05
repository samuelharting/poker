import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  getCardBackTexture,
  getCardFaceTexture,
  type CardSuit,
  type SuitColorMode,
} from './sceneTextures'
import { getSuitInk } from '@/lib/suitColors'
import {
  BOARD_CARD_DEPTH,
  BOARD_CARD_TILT,
  BOARD_CARD_WIDTH,
  BOARD_STAND_DEPTH,
  BOARD_STAND_HEIGHT,
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
  face: THREE.BufferGeometry
  back: THREE.BufferGeometry
  edge: THREE.BufferGeometry
} | null = null

/**
 * Real stock is never perfectly flat: it bows across its width, curls a little
 * along its length and picks up a slight twist. Unit-card space, always >= 0 so
 * a card lying on the felt never dips into it (the lowest corner just touches).
 */
const CARD_BEND_ACROSS = 0.011
const CARD_BEND_ALONG = 0.004
const CARD_BEND_TWIST = 0.007

function cardBend(x: number, z: number, depth: number) {
  const u = x * 2
  const v = (z * 2) / depth
  return CARD_BEND_ACROSS * u * u + CARD_BEND_ALONG * v * v + CARD_BEND_TWIST * (u * v + 1) * 0.5
}

/**
 * Unit card geometry (width 1). Callers scale the group to the size they need.
 * The faces are a gridded rounded rectangle (not a two-triangle plate) so they
 * can hold a bend; the edge band follows the same bent outline.
 */
function getCardGeometry() {
  if (sharedGeometry) return sharedGeometry
  const depth = 88 / 63
  const radius = 0.085
  // Enough steps that the rounded corners stay round even when a card fills the screen.
  const arcSegments = 12
  const columns = 10
  const interiorRows = 14
  const half = { x: 0.5, y: depth / 2 }
  const faceY = CARD_THICKNESS / 2 + 0.0005

  // Row list (shape-space y, half-extent in x): a quarter-circle run at each
  // end so the corners are truly rounded, uniform rows in between.
  const rows: Array<{ y: number; span: number }> = []
  for (let step = 0; step <= arcSegments; step += 1) {
    const angle = (step / arcSegments) * (Math.PI / 2)
    rows.push({ y: -half.y + radius * (1 - Math.cos(angle)), span: half.x - radius * (1 - Math.sin(angle)) })
  }
  for (let row = 1; row <= interiorRows; row += 1) {
    const t = row / (interiorRows + 1)
    rows.push({ y: -half.y + radius + t * (depth - radius * 2), span: half.x })
  }
  for (let step = arcSegments; step >= 0; step -= 1) {
    const angle = (step / arcSegments) * (Math.PI / 2)
    rows.push({ y: half.y - radius * (1 - Math.cos(angle)), span: half.x - radius * (1 - Math.sin(angle)) })
  }
  const stride = columns + 1

  const buildFace = (sign: 1 | -1) => {
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (const row of rows) {
      for (let column = 0; column <= columns; column += 1) {
        const shapeX = -row.span + (column / columns) * row.span * 2
        // rotateX(-PI/2) sends shape-y to world -z.
        const z = -row.y
        // The back is the front turned over (rotateZ(PI)): mirrored in x, same UVs.
        const worldX = sign > 0 ? shapeX : -shapeX
        positions.push(worldX, sign * faceY + cardBend(worldX, z, depth), z)
        uvs.push(shapeX + 0.5, row.y / depth + 0.5)
      }
    }
    for (let row = 0; row < rows.length - 1; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = row * stride + column
        const b = a + 1
        const c = a + stride
        const d = c + 1
        // Columns run +x for the front and -x for the back, so one winding
        // yields +Y normals on the front and -Y normals on the back.
        indices.push(a, b, c, b, d, c)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
  }
  const face = buildFace(1)
  const back = buildFace(-1)

  // Edge band: walk the outline of the front and join it to the back's.
  const loop: number[] = []
  for (let column = 0; column < columns; column += 1) loop.push(column)
  for (let row = 0; row < rows.length - 1; row += 1) loop.push(row * stride + columns)
  for (let column = columns; column > 0; column -= 1) loop.push((rows.length - 1) * stride + column)
  for (let row = rows.length - 1; row > 0; row -= 1) loop.push(row * stride)
  const edgePositions: number[] = []
  const edgeIndices: number[] = []
  const frontPosition = face.getAttribute('position')
  const backPosition = back.getAttribute('position')
  const backOf = (index: number) => {
    // The back's vertex at the same physical outline point has the mirrored column.
    const row = Math.floor(index / stride)
    const column = index % stride
    return row * stride + (columns - column)
  }
  loop.forEach(index => {
    edgePositions.push(frontPosition.getX(index), frontPosition.getY(index), frontPosition.getZ(index))
    const other = backOf(index)
    edgePositions.push(backPosition.getX(other), backPosition.getY(other), backPosition.getZ(other))
  })
  const sides = loop.length
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    const a = index * 2
    const b = next * 2
    // (front_i, back_i, front_next, back_next); winding checked against the outward direction.
    const outward = new THREE.Vector3(edgePositions[a * 3]!, 0, edgePositions[a * 3 + 2]!)
    const edgeA = new THREE.Vector3(edgePositions[b * 3]! - edgePositions[a * 3]!, edgePositions[b * 3 + 1]! - edgePositions[a * 3 + 1]!, edgePositions[b * 3 + 2]! - edgePositions[a * 3 + 2]!)
    const down = new THREE.Vector3(0, -1, 0)
    const facing = new THREE.Vector3().crossVectors(edgeA, down).dot(outward)
    if (facing < 0) edgeIndices.push(a, a + 1, b, b, a + 1, b + 1)
    else edgeIndices.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const edge = new THREE.BufferGeometry()
  edge.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  edge.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(edgePositions.length / 3 * 2), 2))
  edge.setIndex(edgeIndices)
  edge.computeVertexNormals()

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

/**
 * Printed faces are two-tone (paper + one suit ink), so when a card is
 * magnified past its texture (close-ups, a card filling the screen) the
 * bilinear ramp at each glyph edge can be re-thresholded into a crisp,
 * screen-space antialiased edge instead of a soft, stair-stepped blur. The
 * paper behind a partly-inked texel is recovered from the known ink, so the
 * paper tint and fibres survive. Off at normal distances (mipmaps win there).
 */
interface CardFaceUniforms {
  uCardInk: { value: THREE.Color }
  uCardSharp: { value: number }
}

function sharpenCardFace(material: THREE.MeshStandardMaterial) {
  clampCardLighting(material)
  const uniforms: CardFaceUniforms = { uCardInk: { value: new THREE.Color('#111111') }, uCardSharp: { value: 0 } }
  material.userData.cardFace = uniforms
  const clamp = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    clamp.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCardInk;\nuniform float uCardSharp;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec2 cardTexels = fwidth(vMapUv) * vec2(textureSize(map, 0));
          float cardPixelsPerTexel = 1.0 / max(max(cardTexels.x, cardTexels.y), 1e-5);
          float cardSharp = uCardSharp * smoothstep(1.3, 2.6, cardPixelsPerTexel);
          vec3 cardTexel = diffuseColor.rgb;
          if (cardSharp > 0.001) {
            // Cubic B-spline reconstruction (4 bilinear taps): bilinear
            // isolines wobble at every texel boundary once thresholded.
            vec2 cardSize = vec2(textureSize(map, 0));
            vec2 cardSt = vMapUv * cardSize - 0.5;
            vec2 cardI = floor(cardSt);
            vec2 cardF = cardSt - cardI;
            vec2 cardF2 = cardF * cardF;
            vec2 cardF3 = cardF2 * cardF;
            vec2 cardW0 = (1.0 - 3.0 * cardF + 3.0 * cardF2 - cardF3) / 6.0;
            vec2 cardW1 = (4.0 - 6.0 * cardF2 + 3.0 * cardF3) / 6.0;
            vec2 cardW2 = (1.0 + 3.0 * cardF + 3.0 * cardF2 - 3.0 * cardF3) / 6.0;
            vec2 cardW3 = cardF3 / 6.0;
            vec2 cardG0 = cardW0 + cardW1;
            vec2 cardG1 = cardW2 + cardW3;
            vec2 cardH0 = (cardI - 0.5 + cardW1 / cardG0) / cardSize;
            vec2 cardH1 = (cardI + 1.5 + cardW3 / cardG1) / cardSize;
            vec3 cardCubic =
              cardG0.y * (cardG0.x * textureLod(map, vec2(cardH0.x, cardH0.y), 0.0).rgb + cardG1.x * textureLod(map, vec2(cardH1.x, cardH0.y), 0.0).rgb) +
              cardG1.y * (cardG0.x * textureLod(map, vec2(cardH0.x, cardH1.y), 0.0).rgb + cardG1.x * textureLod(map, vec2(cardH1.x, cardH1.y), 0.0).rgb);
            cardTexel = diffuse * cardCubic;
          }
          const vec3 cardLumaW = vec3(0.2126, 0.7152, 0.0722);
          float cardInkL = dot(uCardInk, cardLumaW);
          float cardT = clamp((0.86 - dot(cardTexel, cardLumaW)) / max(0.86 - cardInkL, 0.05), 0.0, 1.0);
          vec3 cardPaper = cardT < 0.85 ? (cardTexel - uCardInk * cardT) / (1.0 - cardT) : vec3(0.93, 0.88, 0.76);
          float cardK = clamp(0.7 / cardPixelsPerTexel, 0.02, 0.5);
          float cardInk = smoothstep(0.5 - cardK, 0.5 + cardK, cardT);
          diffuseColor.rgb = mix(cardTexel, mix(clamp(cardPaper, 0.0, 1.0), uCardInk, cardInk), cardSharp);
        }
        #endif`
      )
  }
  material.customProgramCacheKey = () => 'poker-card-face-sharp'
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
  /** Suit-color mode the current face texture was painted for. */
  suitMode: SuitColorMode
  /** Propped up on a stand: its shadow is the footprint, not a lifted card's. */
  propped: boolean
  faceMesh: THREE.Mesh
  backMesh: THREE.Mesh
  /** Soft contact shadow kept flat on the felt under the card (see cullHiddenCardSide). */
  shadowMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
}

let cardShadowTexture: THREE.CanvasTexture | null = null
let cardShadowGeometry: THREE.PlaneGeometry | null = null
const CARD_SHADOW_OPACITY = 0.5

/** A blurred rounded rectangle: a card's soft contact shadow on the felt. */
function getCardShadowTexture() {
  if (cardShadowTexture) return cardShadowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 80
  const context = canvas.getContext('2d')
  if (context) {
    context.filter = 'blur(6px)'
    context.fillStyle = 'rgba(0, 0, 0, 0.85)'
    context.beginPath()
    context.roundRect?.(12, 12, 40, 56, 6)
    if (!context.roundRect) context.rect(12, 12, 40, 56)
    context.fill()
  }
  cardShadowTexture = new THREE.CanvasTexture(canvas)
  cardShadowTexture.matrixAutoUpdate = false
  return cardShadowTexture
}

function createCardShadow() {
  // Unit-card space (width 1): the blur spills ~20% past each edge.
  cardShadowGeometry ??= new THREE.PlaneGeometry(1.6, (88 / 63) * 1.43).rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(cardShadowGeometry, new THREE.MeshBasicMaterial({
    map: getCardShadowTexture(),
    transparent: true,
    opacity: CARD_SHADOW_OPACITY,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    // A flat decal: one pass is enough (transparent + DoubleSide otherwise draws it twice).
    forceSinglePass: true,
  }))
  mesh.name = 'card-contact-shadow'
  mesh.userData.contactShadow = true
  mesh.renderOrder = 1
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  return mesh
}

/**
 * A physical card: printed face on +Y, designed back on -Y, cream edge. The
 * group's +Y points up from the felt, so rotating it by PI on Z shows the back.
 */
export function createCardMesh(width: number): CardMesh {
  const geometry = getCardGeometry()
  const group = new THREE.Group()
  group.name = 'playing-card'
  const faceMaterial = sharpenCardFace(new THREE.MeshStandardMaterial({
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
  const shadowMesh = createCardShadow()
  group.add(edgeMesh, faceMesh, backMesh, shadowMesh)
  group.scale.setScalar(width)

  const card: CardMesh = { group, faceMaterial, backMaterial, face: null, suitMode: activeSuitMode, propped: false, faceMesh, backMesh, shadowMesh }
  setCardFace(card, null)
  return card
}

/** Suit-color mode every new face texture is painted for (settings toggle). */
let activeSuitMode: SuitColorMode = 'two'

export function getActiveSuitMode() {
  return activeSuitMode
}

export function setCardFace(card: CardMesh, face: CardFace | null, mode: SuitColorMode = activeSuitMode) {
  const sameFace = card.face?.rank === face?.rank && card.face?.suit === face?.suit
  if (sameFace && card.suitMode === mode && card.faceMaterial.map) return
  card.face = face
  card.suitMode = mode
  card.faceMaterial.map = face ? getCardFaceTexture(face.rank, face.suit, mode) : getCardBackTexture()
  const faceUniforms = card.faceMaterial.userData.cardFace as CardFaceUniforms | undefined
  if (faceUniforms) {
    // Only a printed face is two-tone; the back art (shown while face-down) is not.
    faceUniforms.uCardSharp.value = face ? 1 : 0
    if (face) faceUniforms.uCardInk.value.set(getSuitInk(face.suit, mode))
  }
  card.faceMaterial.needsUpdate = true
}

/**
 * Switches every card to the given suit-color mode without recreating meshes:
 * only the cached per-mode textures are swapped. Returns true if it changed.
 */
export function applySuitColorMode(cards: Iterable<CardMesh>, mode: SuitColorMode) {
  const changed = activeSuitMode !== mode
  activeSuitMode = mode
  for (const card of cards) setCardFace(card, card.face, mode)
  return changed
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
  placeCardShadow(card, elements)
}

const shadowWorld = new THREE.Matrix4()
const shadowParentInverse = new THREE.Matrix4()
const shadowQuaternion = new THREE.Quaternion()
const shadowScale = new THREE.Vector3()
const shadowPosition = new THREE.Vector3()
const shadowYawAxis = new THREE.Vector3(0, 1, 0)

/**
 * Keeps the card's contact shadow flat on the felt right under it (whatever
 * the card's tilt or flip), fading as the card lifts off or turns on edge.
 */
function placeCardShadow(card: CardMesh, elements: ArrayLike<number>) {
  const shadow = card.shadowMesh
  const unitScale = Math.hypot(elements[0]!, elements[1]!, elements[2]!)
  const flat = Math.abs(cardUp.y) / Math.max(1e-6, unitScale)
  // A propped card rests on its stand: full-strength footprint shadow.
  const lift = card.propped ? 0 : cardWorld.y - FELT_TOP_Y
  const liftFade = 1 - THREE.MathUtils.smoothstep(lift, 0.01, 0.26)
  const edgeFade = card.propped ? 1 : THREE.MathUtils.smoothstep(flat, 0.35, 0.85)
  // Follow the fold fade (the card's own materials go transparent as it goes).
  const cardOpacity = card.faceMaterial.transparent ? card.faceMaterial.opacity : 1
  const opacity = CARD_SHADOW_OPACITY * liftFade * (0.35 + 0.65 * edgeFade) * cardOpacity
  shadow.visible = opacity > 0.01 && unitScale > 0.01
  if (!shadow.visible) return
  shadow.material.opacity = opacity
  // Card's long axis yaw, laid flat; a lifted card's shadow spreads and softens.
  const yaw = Math.atan2(elements[8]!, elements[10]!)
  shadowQuaternion.setFromAxisAngle(shadowYawAxis, yaw)
  const spread = unitScale * (1 + Math.max(0, lift) * 2)
  // A propped card only covers the felt under its footprint (plus a soft spill).
  shadowScale.set(spread, 1, card.propped ? spread * (0.42 + 0.58 * flat) : spread)
  shadowPosition.set(cardWorld.x, FELT_TOP_Y + 0.003, cardWorld.z)
  shadowWorld.compose(shadowPosition, shadowQuaternion, shadowScale)
  shadowParentInverse.copy(card.group.matrixWorld).invert()
  shadow.matrix.multiplyMatrices(shadowParentInverse, shadowWorld)
  shadow.matrixWorldNeedsUpdate = true
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
  /** The small lip the propped card is seated in. */
  stand: THREE.Mesh
  /** Where the card left the dealer's hand (world), once it has launched. */
  origin: THREE.Vector3
  /** The launch point has been asked for (once per deal of this slot). */
  launched: boolean
  /** The card flies from `origin` (the dealer's hand) instead of the deck point. */
  fromHand: boolean
}

export interface BoardRuntime {
  group: THREE.Group
  slots: BoardSlot[]
  visibleCount: number
  clearedAt: number
  /** Faint printed outlines marking the five board spots. */
  slotOutlines: THREE.Mesh
  /** Shared stand geometry/material, disposed with the scene. */
  disposables: Array<{ dispose(): void }>
  /**
   * When set, asked once as a card launches: write where it leaves the dealer's
   * hand (world) into `out` and return true, or return false to fly from the deck.
   */
  launch?: (slotIndex: number, out: THREE.Vector3) => boolean
}

/**
 * The dealer's deck: one low point on the far felt, just right of the muck and
 * behind the far betting line. Hole cards and the board both launch from here.
 */
export const DEAL_DECK_POINT = new THREE.Vector3(0.45, FELT_TOP_Y + 0.05, -2.0)
/** Seconds a dealt card takes to grow out of the deck (no popping into being). */
export const DEAL_LAUNCH_SECONDS = 0.06
/** Where finished boards are swept to (the muck, beside the dealer). */
const MUCK_ORIGIN = new THREE.Vector3(0, FELT_TOP_Y + 0.02, -2.1)
/** Radians the board leans back toward the hero's seat (see BOARD_CARD_TILT). */
const BOARD_TILT = BOARD_CARD_TILT
/** How far the card's bottom edge sinks into its stand's slot. */
const STAND_SINK = 0
/** World Z of the card's bottom edge (where its stand sits) relative to the slot centre. */
const STAND_Z_OFFSET = (BOARD_CARD_DEPTH / 2) * Math.cos(BOARD_TILT)
/** Height of the group's centre so the tilted card's bottom edge rests in the stand. */
function proppedLift(angle: number, sink: number) {
  return Math.sin(angle) * BOARD_CARD_DEPTH * 0.5 + sink
}
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
  const rimGeometry = roundedFrameGeometry(1.0, 88 / 63, 0.085, 0.07)

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

  // Each card leans back in a small dark-walnut stand with a brass lip, so it
  // reads as physically propped rather than floating.
  const standShape = roundedCardShape(BOARD_CARD_WIDTH * 1.08, BOARD_STAND_DEPTH, 0.045)
  const standGeometry = new THREE.ExtrudeGeometry(standShape, {
    depth: BOARD_STAND_HEIGHT,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    bevelSegments: 2,
    curveSegments: 6,
  })
  standGeometry.rotateX(-Math.PI / 2)
  const standMaterial = new THREE.MeshStandardMaterial({ color: '#2e1c12', roughness: 0.42, metalness: 0.25 })
  const disposables: Array<{ dispose(): void }> = [rimGeometry, standGeometry, standMaterial]

  const slots: BoardSlot[] = BOARD_XS.map(x => {
    const card = createCardMesh(BOARD_CARD_WIDTH)
    card.propped = true
    card.group.position.set(x, FELT_TOP_Y + 0.008, BOARD_Z)
    const stand = new THREE.Mesh(standGeometry, standMaterial)
    stand.name = 'board-card-stand'
    stand.position.set(x, FELT_TOP_Y + 0.002, BOARD_Z + STAND_Z_OFFSET)
    stand.castShadow = false
    stand.receiveShadow = true
    stand.visible = false
    group.add(stand)
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
      stand,
      origin: new THREE.Vector3(),
      launched: false,
      fromHand: false,
    }
  })

  return { group, slots, visibleCount: 0, clearedAt: Number.NEGATIVE_INFINITY, slotOutlines, disposables }
}

export function syncBoardRuntime(
  board: BoardRuntime,
  cards: ReadonlyArray<{ rank: string; suit: CardSuit }>,
  highlighted: ReadonlyArray<{ rank: string; suit: CardSuit }>,
  now: number,
  /** Scene time new cards may start dealing (e.g. once the bets are swept in). */
  notBefore = Number.NEGATIVE_INFINITY,
  /**
   * Seconds after the deal starts that each newly dealt card launches, in deal
   * order (a dealer avatar pitching them); default is a quick 0.16s stagger.
   */
  dealOffsets?: readonly number[]
): number | null {
  const count = Math.min(5, cards.length)
  let dealtThisSync = 0
  let startAt: number | null = null
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
      const base = Math.max(now + clearing, notBefore)
      slot.dealtAt = base + (dealOffsets ? dealOffsets[Math.min(dealtThisSync, dealOffsets.length - 1)] ?? 0 : dealtThisSync * 0.16)
      slot.launched = false
      slot.fromHand = false
      startAt = base
      dealtThisSync += 1
      setCardFace(slot.card, { rank: card.rank, suit: card.suit })
    }
    slot.card.group.visible = true
    slot.highlighted = highlighted.some(item => item.rank === card.rank && item.suit === card.suit)
  })
  board.visibleCount = count
  // When the new cards' deal begins (null when nothing new was dealt).
  return startAt
}

const scratch = new THREE.Vector3()
const slotTarget = new THREE.Vector3()

export function animateBoardRuntime(board: BoardRuntime, time: number, reducedMotion: boolean) {
  board.slots.forEach((slot, index) => {
    const group = slot.card.group
    if (!group.visible) {
      slot.stand.visible = false
      return
    }
    slotTarget.set(BOARD_XS[index]!, FELT_TOP_Y + 0.008, BOARD_Z)

    if (slot.leavingAt !== Number.NEGATIVE_INFINITY) {
      const leave = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.leavingAt) / BOARD_CLEAR_SECONDS, 0, 1)
      if (leave >= 1) {
        group.visible = false
        slot.stand.visible = false
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
      const leaveTilt = BOARD_TILT * (1 - flip)
      scratch.y += proppedLift(leaveTilt, STAND_SINK * (1 - flip))
      group.position.copy(scratch)
      group.rotation.set(leaveTilt, slide * (index - 2) * 0.05, Math.PI * flip)
      slot.stand.visible = false
      group.scale.setScalar(BOARD_CARD_WIDTH * (1 - slide * 0.18))
      slot.highlightMesh.visible = false
      return
    }

    group.scale.setScalar(BOARD_CARD_WIDTH)
    if (time < slot.dealtAt && !reducedMotion) {
      // Parked out of sight until the previous board has cleared.
      group.position.set(DEAL_DECK_POINT.x, -10, DEAL_DECK_POINT.z)
      slot.highlightMesh.visible = false
      slot.stand.visible = false
      return
    }
    const progress = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.dealtAt) / 0.62, 0, 1)
    const travel = 1 - Math.pow(1 - Math.min(1, progress / 0.62), 3)
    const flip = THREE.MathUtils.smoothstep(progress, 0.45, 1)
    if (!slot.launched) {
      // First frame in the air: ask where the dealer's hand is right now.
      slot.launched = true
      slot.fromHand = !reducedMotion && board.launch !== undefined && board.launch(index, slot.origin)
    }
    scratch.lerpVectors(slot.fromHand ? slot.origin : DEAL_DECK_POINT, slotTarget, travel)
    const launch = reducedMotion ? 1 : THREE.MathUtils.clamp((time - slot.dealtAt) / DEAL_LAUNCH_SECONDS, 0, 1)
    group.scale.setScalar(BOARD_CARD_WIDTH * Math.max(0.001, launch))
    scratch.y += Math.sin(travel * Math.PI) * 0.35 + (1 - flip) * 0.06
    const landing = progress >= 1 ? 0 : Math.sin(THREE.MathUtils.clamp((progress - 0.88) / 0.12, 0, 1) * Math.PI) * 0.015
    group.position.set(scratch.x, scratch.y + landing, scratch.z)
    // Face down (rotation PI) while travelling, flipping over the long edge,
    // then propped slightly toward the seated player so the board reads easily.
    const prop = BOARD_TILT * flip
    group.rotation.set(prop, (1 - travel) * 0.6, Math.PI * (1 - flip))
    group.position.y += proppedLift(prop, STAND_SINK * flip)
    // The dark stands were removed: the card rests directly on the felt.
    slot.stand.visible = false

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
