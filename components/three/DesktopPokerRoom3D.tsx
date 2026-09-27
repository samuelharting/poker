'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  advanceActionPlaybackState,
  createActionPlaybackState,
  getActionPlaybackSnapshot,
  type ThreeActionPlaybackState,
} from './actionPlayback'
import {
  createAvatarAssetInstance,
  disposeAvatarAssetInstance,
  type AvatarAssetInstance,
} from './avatarAssetLoader'
import {
  ACTION_ANIMATION_DURATION_MS,
  getOpponentTableActionPose,
  getPokerActionMotionProfile,
  getSeatedAvatarActionPose,
  type PokerActionMotionProfile,
} from './pokerActionPose'
import {
  createFallbackAvatarAccessories,
  createRiggedAvatarAccessories,
  disposeAvatarAccessorySet,
  getAvatarAppearanceKey,
  type AvatarAccessorySet,
} from './avatarCustomization'
import {
  ANIMATED_BONES,
  createAvatarAnimatorState,
  FLIP_OFF_SECONDS,
  getFlipOffHand,
  updateAvatarAnimator,
  type AvatarAnchors,
  type AvatarAnimatorState,
  type AvatarPose,
} from './avatarAnimator'
import { getArmChain, getArmOvershoot, orientBoneFrame, solveArmIK } from './avatarIK'
import { applyBlink, getBlinkAmount, stylizeAvatar, type StylizedAvatar } from './avatarStyle'
import { createAvatarFace, disposeAvatarFace, updateAvatarFace, type AvatarFaceRig, type FaceMood } from './avatarFace'
import { createDrinkProp, disposeDrinkProp, DRINK_DURATION, type DrinkProp } from './drinkProps'
import {
  createFirstPersonDrink,
  disposeFirstPersonDrink,
  updateFirstPersonDrink,
  type FirstPersonDrink,
} from './firstPersonDrink'
import {
  animateConfetti,
  animateLightCone,
  animateShockwave,
  burstConfetti,
  createConfetti,
  createLightCone,
  createShockwave,
  disposeConfetti,
  disposeLightCone,
  disposeShockwave,
  triggerShockwave,
  type Confetti,
  type LightCone,
  type Shockwave,
} from './sceneEffects'
import {
  createCompanion,
  disposeCompanion,
  getCompanionBubbleAnchor,
  getCompanionLine,
  updateCompanion,
  type CompanionRuntime,
} from './companion3D'
import { DESKTOP_CAMERA_FRAMING } from './cameraFraming'
import {
  createPrankRuntime,
  disposePrankRuntime,
  getSeatPrankInput,
  queuePrank,
  queueSeatPop,
  updatePranks,
  type PrankRuntime,
  type SeatPrankInput,
} from './prankEffects'
import { popIconSvg } from './popIcons'
import type { PrankEvent } from '@/lib/pranks'
import { SHOT_DOWN_AT, SHOT_SHUDDER_END } from './prankTimeline'
import type { DrinkEvent } from '@/lib/drinks'
import {
  animateBoardRuntime,
  createBoardRuntime,
  createCardMesh,
  cullHiddenCardSide,
  disposeCardMesh,
  setCardFace,
  syncBoardRuntime,
  type BoardRuntime,
  type CardMesh,
} from './cardMeshes'
import {
  applyEnvironmentLighting,
  createPostFx,
  createStageLights,
  FrameBudget,
  type PostFx,
  type RenderQuality,
  type StageLights,
} from './sceneLighting'
import {
  disposeSceneTextures,
  drawSuit,
  getChipEdgeTexture,
  getChipFaceTexture,
  CHIP_DENOMINATIONS,
} from './sceneTextures'
import {
  createDecoCarpetTexture,
  createLoungeBackBar,
  createLoungeDecor,
  createLoungeWallTexture,
  createWainscotTexture,
} from './roomArt'
import {
  createStylizedChair,
  createStylizedTable,
  FELT_TOP_Y,
  getFeltEdgeToward,
  RAIL_PEAK_Y,
  RAIL_WIDTH,
  BOARD_Z,
} from './tableArt'
import type {
  ThreeActionCue,
  ThreeCardView,
  ThreeChatMessage,
  ThreeEmoteReaction,
  ThreePlayerView,
  ThreeTableViewModel,
} from './tableViewModel'
import { getThreeVisibleCardSlots } from './tableViewModel'
import {
  getTableWagerAnchor,
  getTableWagerStartPoint,
  getWagerChipCount,
  interpolateWagerArc,
  TABLE_SEAT_POSITIONS,
  TABLE_SEAT_SCALES,
  TABLE_WAGER_Y,
  type TableVisualSeat,
} from './tableWagerLayout'
import { getAvatarHeadTurn } from './turnFocus'
import { FunFx, type FunPoseInput } from './funFx'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'

type Vec3 = [number, number, number]
type WebGLStatus = 'loading' | 'ready' | 'error'

interface CardRevealSeatAction {
  playerId: string
  label: string
  ariaLabel: string
  status?: 'pending' | 'approved' | 'denied'
  disabled: boolean
}

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
  emoteReactions: ThreeEmoteReaction[]
  chatMessages: ThreeChatMessage[]
  selectedTargetId: string | null
  onSelectPlayer: (playerId: string) => void
  cardRevealActions: CardRevealSeatAction[]
  onRequestCardReveal: (playerId: string) => void
  /** Shots poured and chips flicked (server events, newest last). */
  prankEvents?: readonly PrankEvent[]
  /** Drink events: house-rule beers and free waters pop an icon over the seat. */
  drinkEvents?: readonly DrinkEvent[]
  /** Winning board cards to glow during the showdown highlight. */
  highlightedCards?: ReadonlyArray<{ rank: string; suit: ThreeCardView['suit'] }>
}

interface SeatRuntime {
  playerId: string
  root: THREE.Group
  body: THREE.Group
  fallbackAvatar: THREE.Group
  avatarMount: THREE.Group
  avatar: AvatarAssetInstance | null
  avatarMixer: THREE.AnimationMixer | null
  avatarIdleAction: THREE.AnimationAction | null
  avatarActiveAction: THREE.AnimationAction | null
  head: THREE.Group
  leftArm: THREE.Mesh
  rightArm: THREE.Mesh
  cards: THREE.Group
  cardMeshes: THREE.Object3D[]
  holeCards: CardMesh[]
  cardLocalZ: number
  animator: AvatarAnimatorState
  /** Server says this player is looking at their hole cards right now. */
  peeking: boolean
  chair: THREE.Group
  /** The player's own chip stack in front of them. */
  stack: ReturnType<typeof createChipSet>
  stackCount: number
  /** How far the chair and body slide in toward the rail (seat-local Z). */
  seatShiftZ: number
  anchors: AvatarAnchors
  anchorsFromRig: boolean
  avatarStyle: StylizedAvatar | null
  face: AvatarFaceRig | null
  drinkProp: DrinkProp | null
  drinkId: string
  isHero: boolean
  drinkStartedAt: number
  drunkLevel: number
  passedOut: boolean
  flipOff: { startedAt: number; targetId: string } | null
  skinBaseColor: THREE.Color | null
  loser: boolean
  lastPose: AvatarPose | null
  dealerButton: THREE.Mesh
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  winnerHalo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  winnerSparkles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  materials: THREE.MeshStandardMaterial[]
  foldMaterials: THREE.MeshStandardMaterial[]
  visualSeat: number
  baseY: number
  phase: number
  acting: boolean
  winner: boolean
  folded: boolean
  keepFoldedCardsVisible: boolean
  actionCue: ThreeActionCue
  actionKey: string
  playback: ThreeActionPlaybackState
  hadCards: boolean
  dealStartedAt: number
  avatarGeneration: number
  requestedAvatarKey: ThreePlayerView['avatarProfile']['modelKey']
  avatarLoadStatus: 'idle' | 'loading' | 'loaded' | 'failed'
  avatarRetryAt: number
  avatarFailureCount: number
  avatarBoneOffsets: Map<THREE.Bone, THREE.Euler>
  fallbackAccessories: AvatarAccessorySet
  riggedAccessories: AvatarAccessorySet | null
  appearanceKey: string
  avatarProfile: ThreePlayerView['avatarProfile']
  wagerIntensity: number
  /** Blackout bonk / dazed / hangover / trip pose inputs (set each frame by FunFx). */
  funPose?: FunPoseInput
  /** The lips, in the Head bone's local space (measured from the rig). */
  mouthInHead?: THREE.Vector3
}

interface WagerRuntime {
  playerId: string
  group: THREE.Group
  chipMeshes: THREE.Mesh[]
  chipBasePositions: THREE.Vector3[]
  materials: THREE.MeshStandardMaterial[]
  visualSeat: number
  amount: number
  actionKey: string
  start: THREE.Vector3
  target: THREE.Vector3
  startedAt: number
  animating: boolean
  /** End-of-street sweep into the pot. */
  collectStartedAt: number
  collectCount: number
  /** Where the sweep goes: the pot mid-hand, or the winner when the hand ends. */
  collectDest: THREE.Vector3 | null
  motionProfile: PokerActionMotionProfile
}

interface PotRuntime {
  group: THREE.Group
  chipMeshes: THREE.Mesh[]
  chipBasePositions: THREE.Vector3[]
  materials: THREE.MeshStandardMaterial[]
  visibleChipCount: number
  bounceStartedAt: number
  /** Winner ids the pot was last paid out to ('' when no payout is showing). */
  payoutKey: string
  payoutStartedAt: number
  payoutCount: number
  payoutTargets: THREE.Vector3[]
  /** Winner ids already paid, so a lingering winner flag never replays the payout. */
  paidKey: string
  /** Pot total being shipped (drives the counting-down pot readout). */
  payoutAmount: number
  /** Last pot total seen before the payout began. */
  lastPotAmount: number
}

interface SceneRuntime {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  cameraLookAt: THREE.Vector3
  seats: Map<string, SeatRuntime>
  wagers: Map<string, WagerRuntime>
  pot: PotRuntime
  board: BoardRuntime
  lights: StageLights
  postFx: PostFx | null
  frameBudget: FrameBudget
  neonMaterials: THREE.MeshStandardMaterial[]
  overlayElements: Map<string, HTMLElement>
  /** Lady Luck, the win-streak companion. */
  companion: CompanionRuntime | null
  /** The local player's own drink, seen first-person (their avatar is hidden). */
  firstPersonDrink: FirstPersonDrink
  /** Shots, chip flicks and house-rule icon pops. */
  pranks: PrankRuntime
  effects: { cone: LightCone; confetti: Confetti; shockwave: Shockwave; winnerKey: string; allInKey: string }
  /** Scene time when community cards last landed. */
  boardRevealAt: number
  anyWinner: boolean
  chipInstancer: ChipInstancer
  /** Development-only camera override used by scripts/snap-3d.mjs close-ups. */
  debugCamera: { position: Vec3; lookAt: Vec3; fov?: number } | null
  feltMaterial: THREE.MeshStandardMaterial
  startTime: number
  animationFrame: number
  resizeObserver: ResizeObserver
  disposed: boolean
  suspended: boolean
  reducedMotion: boolean
  pause: () => void
  resume: () => void
  dispose: () => void
}

const SUIT_SYMBOLS: Record<ThreeCardView['suit'], string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
}

const AVATAR_RETRY_BASE_MS = 3_000
const AVATAR_RETRY_MAX_MS = 30_000

export function getAvatarRetryDelayMs(failureCount: number): number {
  const safeFailureCount = Math.max(1, Math.floor(failureCount))
  return Math.min(
    AVATAR_RETRY_MAX_MS,
    AVATAR_RETRY_BASE_MS * Math.pow(2, safeFailureCount - 1)
  )
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function getStatusLabel(player: ThreePlayerView): string {
  if (player.awayLabel) return player.awayLabel
  if (player.isOutOfHand) return 'Folded'
  if (player.isActing) return 'Acting'
  return player.statusAction ?? ''
}

function CinematicCardSlot({
  card,
  side,
}: {
  card: ThreeCardView | null
  side: 'left' | 'right'
}) {
  if (!card) {
    return <i className={`is-back is-${side}`} aria-hidden="true" />
  }

  return (
    <i
      className={`is-face is-${card.suit} is-${side}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <b>{card.rank}</b>
      <small>{SUIT_SYMBOLS[card.suit]}</small>
    </i>
  )
}

function CinematicHoleCards({ player }: { player: ThreePlayerView }) {
  const slots = getThreeVisibleCardSlots(player.showCards, player.visibleCards)
  const hasRevealedCards = Boolean(slots.left || slots.right)

  return (
    <span className={`cinematic-hole-cards ${hasRevealedCards ? 'has-revealed-cards' : ''}`}>
      <CinematicCardSlot card={slots.left} side="left" />
      <CinematicCardSlot card={slots.right} side="right" />
    </span>
  )
}

function createStandardMaterial(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshStandardMaterialParameters> = {}
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.08,
    ...options,
  })
}

const FOLD_MATERIAL_BASELINE = 'pokerFoldMaterialBaseline'

/**
 * Folded players stay solid (transparent skinned meshes sort badly against the
 * table) and instead sink into shadow: their materials dim toward the room.
 */
function applyFoldTint(material: THREE.Material, folded: boolean) {
  const tinted = material as THREE.MeshStandardMaterial
  if (!tinted.color) return
  const stored = material.userData[FOLD_MATERIAL_BASELINE] as { color: THREE.Color } | undefined
  const baseline = stored ?? { color: tinted.color.clone() }
  if (!stored) material.userData[FOLD_MATERIAL_BASELINE] = baseline
  tinted.color.copy(baseline.color)
  if (folded) tinted.color.multiplyScalar(0.5)
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  position: Vec3 = [0, 0, 0]
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  const materials = Array.isArray(material) ? material : [material]
  const usesLitMaterial = materials.some(item => (
    item instanceof THREE.MeshStandardMaterial || item instanceof THREE.MeshPhysicalMaterial
  ))
  mesh.castShadow = usesLitMaterial
  mesh.receiveShadow = usesLitMaterial
  parent.add(mesh)
  return mesh
}

function createCanvasTexture(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
  repeat?: [number, number]
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...repeat)
  }
  return texture
}

function createCarpetTexture() {
  return createDecoCarpetTexture()
}

function createWallPanelTexture() {
  return createLoungeWallTexture()
}

function createNeonSignTexture(text: string) {
  return createCanvasTexture(1024, 256, context => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
    context.clearRect(0, 0, 1024, 256)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 104px ${font ? `${font}, ` : ''}'Arial Black', sans-serif`
    // Neon tube: a saturated glow and stroke around a warm (not white) core,
    // so bloom reads as neon rather than a blown-out white blob.
    context.shadowColor = '#ff5a3a'
    context.shadowBlur = 22
    context.strokeStyle = '#ff7f57'
    context.lineWidth = 7
    context.strokeText(text, 512, 132)
    context.shadowBlur = 0
    // Coral core (not white) so bloom keeps the letterforms legible.
    context.fillStyle = '#ffb58f'
    context.fillText(text, 512, 132)
  })
}

function createPosterTexture(title: string, subtitle: string, suit: 'spades' | 'hearts') {
  return createCanvasTexture(512, 720, context => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
    const family = `${font ? `${font}, ` : ''}'Arial Black', sans-serif`
    const background = context.createLinearGradient(0, 0, 0, 720)
    background.addColorStop(0, suit === 'hearts' ? '#3a0f1a' : '#0f2a2a')
    background.addColorStop(1, '#0a0c0e')
    context.fillStyle = background
    context.fillRect(0, 0, 512, 720)
    context.strokeStyle = 'rgba(242, 199, 102, 0.8)'
    context.lineWidth = 6
    context.strokeRect(22, 22, 468, 676)
    context.strokeStyle = 'rgba(242, 199, 102, 0.35)'
    context.lineWidth = 2
    context.strokeRect(36, 36, 440, 648)
    for (let ray = 0; ray < 18; ray += 1) {
      const angle = (ray / 18) * Math.PI * 2
      context.strokeStyle = 'rgba(242, 199, 102, 0.08)'
      context.lineWidth = 18
      context.beginPath()
      context.moveTo(256, 300)
      context.lineTo(256 + Math.cos(angle) * 420, 300 + Math.sin(angle) * 420)
      context.stroke()
    }
    drawSuit(context, suit, 256, 290, 250, suit === 'hearts' ? '#e2505c' : '#f2c766')
    context.textAlign = 'center'
    context.fillStyle = '#fff4de'
    context.font = `800 62px ${family}`
    context.fillText(title, 256, 560)
    context.fillStyle = 'rgba(242, 199, 102, 0.9)'
    context.font = `600 24px ${family}`
    context.fillText(subtitle, 256, 610)
  })
}

function createPoster(
  scene: THREE.Scene,
  x: number,
  title: string,
  subtitle: string,
  suit: 'spades' | 'hearts',
  brassMaterial: THREE.MeshStandardMaterial
) {
  const poster = new THREE.Group()
  poster.name = 'framed-poster'
  poster.position.set(x, 2.1, -9.3)
  scene.add(poster)
  addMesh(poster, new THREE.BoxGeometry(1.9, 2.6, 0.08), brassMaterial).castShadow = false
  const art = addMesh(
    poster,
    new THREE.PlaneGeometry(1.72, 2.42),
    new THREE.MeshStandardMaterial({ map: createPosterTexture(title, subtitle, suit), roughness: 0.6 }),
    [0, 0, 0.045]
  )
  art.castShadow = false
}

function createBackBar(scene: THREE.Scene, brassMaterial: THREE.MeshStandardMaterial) {
  createLoungeBackBar(scene, brassMaterial)
}

function createWallSconce(scene: THREE.Scene, x: number, brassMaterial: THREE.MeshStandardMaterial) {
  const sconce = new THREE.Group()
  sconce.name = 'art-deco-wall-sconce'
  sconce.position.set(x, 2.1, -9.05)
  scene.add(sconce)

  addMesh(sconce, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24), brassMaterial, [0, 0, 0]).rotation.x = Math.PI / 2
  addMesh(sconce, new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), brassMaterial, [0, 0, 0.18]).rotation.x = Math.PI / 2
  const shade = addMesh(
    sconce,
    new THREE.CylinderGeometry(0.16, 0.3, 0.38, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#ffb66b',
      emissive: '#ff9a40',
      emissiveIntensity: 1.6,
      side: THREE.DoubleSide,
      roughness: 0.6,
    }),
    [0, 0.14, 0.36]
  )
  shade.castShadow = false

  // No real light here: the emissive shade reads as lit, and every extra
  // dynamic light costs every pixel in the room.
}

function createPendantLamp(scene: THREE.Scene, x: number, z: number, brassMaterial: THREE.MeshStandardMaterial) {
  const lamp = new THREE.Group()
  lamp.name = 'pendant-lamp'
  lamp.position.set(x, 7.1, z)
  scene.add(lamp)

  addMesh(lamp, new THREE.CylinderGeometry(0.012, 0.012, 3, 6), brassMaterial, [0, 1.5, 0])
  const shade = addMesh(
    lamp,
    new THREE.LatheGeometry([
      new THREE.Vector2(0.08, 0.34),
      new THREE.Vector2(0.18, 0.3),
      new THREE.Vector2(0.52, 0.02),
      new THREE.Vector2(0.62, -0.08),
      new THREE.Vector2(0.6, -0.1),
    ], 40),
    new THREE.MeshStandardMaterial({
      color: '#0f7a57',
      roughness: 0.25,
      metalness: 0.35,
      side: THREE.DoubleSide,
    })
  )
  shade.castShadow = false
  const bulb = addMesh(
    lamp,
    new THREE.SphereGeometry(0.14, 20, 12),
    new THREE.MeshStandardMaterial({
      color: '#fff3d6',
      emissive: '#ffd9a0',
      emissiveIntensity: 2.2,
    }),
    [0, 0.02, 0]
  )
  bulb.castShadow = false
  const rimGlow = addMesh(
    lamp,
    new THREE.TorusGeometry(0.61, 0.018, 8, 48),
    brassMaterial,
    [0, -0.09, 0]
  )
  rimGlow.rotation.x = Math.PI / 2
}

function createRoom(scene: THREE.Scene) {
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: createCarpetTexture(),
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.2,
  })
  const floor = addMesh(scene, new THREE.CircleGeometry(20, 96), floorMaterial, [0, -2, 0])
  floor.rotation.x = -Math.PI / 2
  floor.castShadow = false

  const panelMaterial = new THREE.MeshStandardMaterial({
    map: createWallPanelTexture(),
    roughness: 0.82,
    metalness: 0.05,
    envMapIntensity: 0.3,
  })
  const backWall = addMesh(scene, new THREE.BoxGeometry(32, 14, 0.2), panelMaterial, [0, 5, -9.55])
  backWall.name = 'visible-back-wall'
  backWall.castShadow = false

  const sideMaterial = panelMaterial.clone()
  for (const x of [-12.5, 12.5]) {
    const sideWall = addMesh(scene, new THREE.BoxGeometry(0.24, 14, 22), sideMaterial, [x, 5, 0])
    sideWall.castShadow = false
  }

  // Raised-panel walnut wainscot up to a brass chair rail (painted panels, one box).
  const wainscotMaterial = new THREE.MeshStandardMaterial({
    map: createWainscotTexture(14),
    roughness: 0.46,
    metalness: 0.05,
    envMapIntensity: 0.5,
  })
  addMesh(scene, new THREE.BoxGeometry(32, 2.9, 0.3), wainscotMaterial, [0, -0.55, -9.4]).castShadow = false

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: '#e0b25a',
    roughness: 0.28,
    metalness: 1,
    envMapIntensity: 1.2,
  })
  addMesh(scene, new THREE.BoxGeometry(32, 0.08, 0.34), brassMaterial, [0, 0.92, -9.3])

  createBackBar(scene, brassMaterial)
  for (const x of [-4.6, 4.6]) createWallSconce(scene, x, brassMaterial)
  for (const x of [-9.4, 9.4]) createWallSconce(scene, x, brassMaterial)
  createPoster(scene, -7, 'ALL IN', 'NO GUTS · NO GLORY', 'hearts', brassMaterial)
  createPoster(scene, 7, 'ROYAL', 'FLUSH OR BUST', 'spades', brassMaterial)
  createPendantLamp(scene, -2.6, -0.4, brassMaterial)
  createPendantLamp(scene, 2.6, -0.4, brassMaterial)
  createLoungeDecor(scene, brassMaterial)

  const neonMaterial = new THREE.MeshStandardMaterial({
    map: createNeonSignTexture('POKER NIGHT'),
    emissive: '#ffffff',
    emissiveMap: createNeonSignTexture('POKER NIGHT'),
    emissiveIntensity: 0.95,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  neonMaterial.userData.baseEmissive = 0.95
  const neon = addMesh(scene, new THREE.PlaneGeometry(4.4, 1.1), neonMaterial, [0, 5.35, -9.3])
  neon.name = 'neon-sign'
  neon.castShadow = false
  neon.receiveShadow = false

  return { neonMaterials: [neonMaterial] }
}


const AVATAR_SEAT_LIFT = 0.28
const HAND_SPREAD = 0.24

function createDefaultAnchors(): AvatarAnchors {
  return {
    railR: [0.3, 0.9, -0.9],
    railL: [-0.3, 0.9, -0.9],
    cards: [0, 0.5, -1.6],
    chest: [0, 1.0, -0.2],
    chin: [0, 1.4, -0.3],
    shoulderR: [0.24, 1.2, -0.1],
    shoulderL: [-0.24, 1.2, -0.1],
    stack: [0.5, 0.5, -1.5],
    betSpot: [0, 0.5, -2.4],
    tap: [0.15, 0.5, -1.3],
    board: [0, 0.5, -4],
    drinkRest: [-0.5, 0.5, -1.5],
  }
}

function toSeatLocal(seat: SeatRuntime, x: number, y: number, z: number): Vec3 {
  const point = seat.root.worldToLocal(new THREE.Vector3(x, y, z))
  return [point.x, point.y, point.z]
}

function setSeatPosition(seat: SeatRuntime, visualSeat: number) {
  const safeSeat = (visualSeat >= 0 && visualSeat <= 7 ? visualSeat : 0) as TableVisualSeat
  const position = TABLE_SEAT_POSITIONS[safeSeat]
  const scale = TABLE_SEAT_SCALES[safeSeat]
  seat.visualSeat = visualSeat
  seat.baseY = position[1]
  seat.root.position.set(position[0], position[1], position[2])
  seat.root.scale.setScalar(scale)
  // Player faces, cards, and hands point down local -Z. This yaw makes that
  // direction point toward table center at every seat.
  seat.root.rotation.y = Math.atan2(position[0], position[2])
  seat.root.updateMatrixWorld(true)

  const { edge, normal } = getFeltEdgeToward(position[0], position[2])
  const at = (inset: number, y: number) => toSeatLocal(
    seat,
    edge.x + normal.x * inset,
    y,
    edge.y + normal.y * inset
  )

  // Slide chair and body in so the player's chest sits just behind the rail.
  const railOuter = at(RAIL_WIDTH, RAIL_PEAK_Y)
  seat.seatShiftZ = THREE.MathUtils.clamp(railOuter[2] + 0.18 - 0.12, -1.1, 0)
  seat.chair.position.z = seat.seatShiftZ

  // Forearms rest on the padded rail; hole cards sit on the felt just inside it.
  // The wrist target sits a forearm's thickness above the padding so arms lie
  // on the rail instead of sinking into it.
  const railRest = at(RAIL_WIDTH * 0.86, RAIL_PEAK_Y + 0.07)
  seat.anchors.railR = [HAND_SPREAD / scale, railRest[1], railRest[2]]
  seat.anchors.railL = [-HAND_SPREAD / scale, railRest[1], railRest[2]]
  const cardSpot = at(-0.42, FELT_TOP_Y + 0.012)
  seat.cardLocalZ = cardSpot[2]
  seat.anchors.cards = [0, cardSpot[1] + 0.02, cardSpot[2]]
  seat.cards.userData.restY = cardSpot[1]
  // The player's own chips sit to the right of their cards, just inside the rail.
  // Close enough to the chest that the bet/call/all-in hands actually land on it.
  const STACK_SIDE = 0.44
  const stackSpot = at(-0.1, FELT_TOP_Y)
  seat.anchors.stack = [STACK_SIDE / scale, stackSpot[1] + 0.06, stackSpot[2]]
  // The stack is a world object (not a child of the seat) so the hero, whose
  // seat is hidden, still sees their own chips in front of them.
  const stackWorld = seat.root.localToWorld(new THREE.Vector3(STACK_SIDE / scale, stackSpot[1], stackSpot[2]))
  seat.stack.group.position.copy(stackWorld)
  seat.stack.group.rotation.set(0, seat.root.rotation.y, 0)
  seat.stack.group.scale.setScalar(1)
  // Check taps land just inside the felt edge, within a leaning reach.
  const tapSpot = at(-0.06, FELT_TOP_Y + 0.02)
  seat.anchors.tap = [0.16 / scale, tapSpot[1], tapSpot[2]]
  const betWorld = getTableWagerAnchor(safeSeat)
  const betLocal = toSeatLocal(seat, betWorld[0], betWorld[1] + 0.05, betWorld[2])
  seat.anchors.betSpot = betLocal
  seat.anchors.board = toSeatLocal(seat, 0, FELT_TOP_Y + 0.1, BOARD_Z)
  // Cards are dealt from the middle of the table (in the cards group's space).
  const dealFrom = toSeatLocal(seat, 0, FELT_TOP_Y + 0.3, -0.2)
  seat.cards.userData.dealFrom = [dealFrom[0], dealFrom[1] - cardSpot[1], dealFrom[2] - cardSpot[2]]
  seat.anchors.drinkRest = [-0.66 / scale, stackSpot[1] + 0.02, stackSpot[2] + 0.08]
  // Dealer puck lies on the felt to the left of the dealer's hole cards.
  seat.dealerButton.position.set(-0.62, cardSpot[1] + 0.03 / scale, cardSpot[2] + 0.12)
  // Selection ring sits on the carpet under the chair.
  seat.ring.position.set(0, (-2 - position[1]) / scale + 0.03, 0.25)
  seat.cards.position.set(0, cardSpot[1], cardSpot[2])
  seat.anchorsFromRig = false
}

/**
 * Reads chest, chin, and shoulder anchors from the loaded rig (in seat-local
 * space) so gestures like chin rests and folded arms fit each model.
 */
function measureRigAnchors(seat: SeatRuntime) {
  const bones = seat.avatar?.bones
  if (!bones) return
  seat.root.updateMatrixWorld(true)
  const local = (name: string, forward = 0, up = 0): Vec3 | null => {
    const bone = bones.get(name)
    if (!bone) return null
    const point = seat.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))
    return [point.x, point.y + up, point.z - forward]
  }
  const chest = local('Chest', 0.2, 0.05)
  const chin = local('Head', 0.26, 0.02)
  const shoulderR = local('UpperArmR')
  const shoulderL = local('UpperArmL')
  if (chest) seat.anchors.chest = chest
  if (chin) seat.anchors.chin = chin
  if (shoulderR) seat.anchors.shoulderR = shoulderR
  if (shoulderL) seat.anchors.shoulderL = shoulderL
  const head = bones.get('Head')
  if (head) {
    // Lips sit ~0.05 up and ~0.24 forward of the head bone (top of the neck)
    // on every model; kept in head space so drinks follow the head's tilt.
    const headLocal = seat.root.worldToLocal(head.getWorldPosition(new THREE.Vector3()))
    const mouthWorld = seat.root.localToWorld(headLocal.add(new THREE.Vector3(0, 0.05, -0.24)))
    seat.mouthInHead = head.worldToLocal(mouthWorld)
  }
  seat.anchorsFromRig = true
}

function createSeatRuntime(player: ThreePlayerView, now: number): SeatRuntime {
  const root = new THREE.Group()
  root.name = `player-${player.id}`

  const profile = player.avatarProfile
  const materials = [
    createStandardMaterial(profile.chairColor, { roughness: 0.5, metalness: 0.24 }),
    createStandardMaterial(profile.chairTrimColor, { roughness: 0.34, metalness: 0.6 }),
    createStandardMaterial(profile.shirtColor, { roughness: 0.76 }),
    createStandardMaterial(profile.sleeveColor, { roughness: 0.78 }),
    createStandardMaterial(profile.skinColor, { roughness: 0.88 }),
    createStandardMaterial(profile.hairColor, { roughness: 0.9 }),
  ]
  const [chairMaterial, trimMaterial, shirtMaterial, sleeveMaterial, skinMaterial, hairMaterial] = materials
  const foldMaterials = [shirtMaterial, sleeveMaterial, skinMaterial, hairMaterial]

  const chair = createStylizedChair(chairMaterial.color, trimMaterial.color)
  root.add(chair.group)
  const chairGroup = chair.group
  const personalStack = createChipSet(20)
  personalStack.group.name = `personal-stack-${player.id}`
  materials.push(...chair.materials)

  const body = new THREE.Group()
  body.position.set(0, 0.12, 0.03)
  root.add(body)

  const fallbackAvatar = new THREE.Group()
  fallbackAvatar.name = `fallback-avatar-${player.id}`
  body.add(fallbackAvatar)

  const avatarMount = new THREE.Group()
  avatarMount.name = `rigged-avatar-${player.id}`
  body.add(avatarMount)

  const torso = addMesh(fallbackAvatar, new THREE.SphereGeometry(0.62, 28, 20), shirtMaterial, [0, 0.66, 0.08])
  torso.scale.set(profile.build === 'broad' ? 1.12 : profile.build === 'lean' ? 0.9 : 1, 1.08, 0.72)

  const neck = addMesh(
    fallbackAvatar,
    new THREE.CylinderGeometry(0.16, 0.2, 0.3, 20),
    skinMaterial,
    [0, 1.27, -0.01]
  )
  neck.rotation.x = -0.06

  const head = new THREE.Group()
  head.position.set(0, 1.52, -0.03)
  fallbackAvatar.add(head)
  const headMesh = addMesh(head, new THREE.SphereGeometry(0.39, 28, 22), skinMaterial)
  headMesh.scale.set(
    profile.faceShape === 'round' ? 1.05 : profile.faceShape === 'square' ? 1.02 : 0.96,
    profile.faceShape === 'oval' ? 1.12 : 1,
    0.96
  )
  const hair = addMesh(head, new THREE.SphereGeometry(0.405, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMaterial, [0, 0.1, 0])
  hair.scale.set(1.02, profile.hairStyle === 'waves' ? 0.62 : 0.52, 1.02)

  const fallbackAccessories = createFallbackAvatarAccessories(head, fallbackAvatar, profile)

  const leftArm = addMesh(fallbackAvatar, new THREE.CylinderGeometry(0.105, 0.12, 0.92, 18), sleeveMaterial, [-0.52, 0.5, -0.28])
  const rightArm = addMesh(fallbackAvatar, new THREE.CylinderGeometry(0.105, 0.12, 0.92, 18), sleeveMaterial, [0.52, 0.5, -0.28])
  leftArm.rotation.set(1.08, 0, -0.22)
  rightArm.rotation.set(1.08, 0, 0.22)
  addMesh(fallbackAvatar, new THREE.SphereGeometry(0.13, 18, 14), skinMaterial, [-0.57, 0.29, -0.68])
  addMesh(fallbackAvatar, new THREE.SphereGeometry(0.13, 18, 14), skinMaterial, [0.57, 0.29, -0.68])

  const cards = new THREE.Group()
  cards.position.set(0, 0.55, -1.02)
  root.add(cards)
  const cardMeshes: THREE.Object3D[] = []
  const holeCards: CardMesh[] = []
  for (const [index, x] of [-0.17, 0.17].entries()) {
    const card = createCardMesh(0.46)
    // Face down by default; showdown flips each card over its long edge.
    card.group.rotation.set(0, index === 0 ? -0.16 : 0.12, Math.PI)
    card.group.position.set(x, index * 0.014, 0)
    card.group.userData.baseX = x
    card.group.userData.baseYaw = card.group.rotation.y
    card.group.userData.baseRoll = 0
    cards.add(card.group)
    cardMeshes.push(card.group)
    holeCards.push(card)
  }

  const dealerMaterial = new THREE.MeshStandardMaterial({ color: '#fff8ea', roughness: 0.4, metalness: 0.05 })
  const dealerFace = new THREE.MeshStandardMaterial({ map: getDealerPuckTexture(), roughness: 0.4 })
  materials.push(dealerMaterial, dealerFace)
  const dealerButton = addMesh(
    root,
    new THREE.CylinderGeometry(0.17, 0.17, 0.05, 36),
    [dealerMaterial, dealerFace, dealerMaterial],
    [0.62, 0.5, -1.4]
  )
  dealerButton.name = 'dealer-puck'
  dealerButton.visible = player.isDealer

  const ringMaterial = createStandardMaterial('#d3b65f', {
    emissive: '#b58f35',
    emissiveIntensity: 1.3,
    transparent: true,
    opacity: 0,
    roughness: 0.3,
    metalness: 0.42,
  })
  const ring = addMesh(root, new THREE.TorusGeometry(1.05, 0.05, 8, 72), ringMaterial, [0, 0.03, 0.2]) as THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  ring.rotation.x = Math.PI / 2

  const winnerHalo = addMesh(
    root,
    new THREE.TorusGeometry(0.68, 0.025, 8, 72),
    new THREE.MeshBasicMaterial({
      color: '#f6d982',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    [0, 2.08, -0.02]
  ) as THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  winnerHalo.rotation.x = Math.PI / 2
  winnerHalo.visible = false

  const sparkleRandom = createSeededRandom(
    [...player.id].reduce((seed, character) => seed + character.charCodeAt(0), 0x57494e)
  )
  const sparklePositions = new Float32Array(22 * 3)
  for (let index = 0; index < 22; index += 1) {
    const offset = index * 3
    const angle = sparkleRandom() * Math.PI * 2
    const radius = 0.65 + sparkleRandom() * 0.48
    sparklePositions[offset] = Math.cos(angle) * radius
    sparklePositions[offset + 1] = 0.38 + sparkleRandom() * 1.9
    sparklePositions[offset + 2] = Math.sin(angle) * radius * 0.58
  }
  const sparkleGeometry = new THREE.BufferGeometry()
  sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3))
  const winnerSparkles = new THREE.Points(
    sparkleGeometry,
    new THREE.PointsMaterial({
      color: '#ffe8a0',
      size: 0.065,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  winnerSparkles.name = `winner-sparkles-${player.id}`
  winnerSparkles.visible = false
  root.add(winnerSparkles)

  const seatRuntime: SeatRuntime = {
    playerId: player.id,
    root,
    body,
    fallbackAvatar,
    avatarMount,
    avatar: null,
    avatarMixer: null,
    avatarIdleAction: null,
    avatarActiveAction: null,
    head,
    leftArm,
    rightArm,
    cards,
    cardMeshes,
    holeCards,
    cardLocalZ: -1.02,
    peeking: false,
    animator: createAvatarAnimatorState(player.id),
    chair: chairGroup,
    stack: personalStack,
    stackCount: 0,
    seatShiftZ: 0,
    anchors: createDefaultAnchors(),
    anchorsFromRig: false,
    avatarStyle: null,
    face: null,
    drinkProp: null,
    drinkId: player.drinks?.lastDrink?.id ?? '',
    isHero: player.isHero,
    drinkStartedAt: Number.NEGATIVE_INFINITY,
    drunkLevel: player.drinks?.level ?? 0,
    passedOut: player.drinks?.passedOut ?? false,
    flipOff: null,
    skinBaseColor: null,
    loser: false,
    lastPose: null,
    dealerButton,
    ring,
    winnerHalo,
    winnerSparkles,
    materials,
    foldMaterials,
    visualSeat: player.visualSeat,
    baseY: 0,
    phase: player.visualSeat * 0.9,
    acting: player.isActing,
    winner: player.isWinner,
    folded: player.isOutOfHand,
    keepFoldedCardsVisible: player.visibleCards.length > 0,
    actionCue: player.actionCue,
    actionKey: player.actionKey,
    playback: createActionPlaybackState(player.actionKey, player.actionCue),
    hadCards: player.hasCards,
    dealStartedAt: now,
    avatarGeneration: 0,
    requestedAvatarKey: player.avatarProfile.modelKey,
    avatarLoadStatus: 'idle',
    avatarRetryAt: 0,
    avatarFailureCount: 0,
    avatarBoneOffsets: new Map(),
    fallbackAccessories,
    riggedAccessories: null,
    appearanceKey: getAvatarAppearanceKey(profile),
    avatarProfile: profile,
    wagerIntensity: player.wagerIntensity,
  }
  setSeatPosition(seatRuntime, player.visualSeat)
  return seatRuntime
}

function updateAvatarDiagnostics(runtime: SceneRuntime) {
  const host = runtime.renderer.domElement.parentElement
  if (!host) return

  const loaded = [...runtime.seats.values()].filter(seat => seat.avatar !== null).length
  host.dataset.avatarModelsLoaded = String(loaded)
  host.dataset.avatarRenderer = loaded > 0 ? 'rigged-glb' : 'procedural-fallback'
}

function restoreAvatarBoneOffsets(seat: SeatRuntime) {
  for (const [bone, offset] of seat.avatarBoneOffsets) {
    bone.rotation.x -= offset.x
    bone.rotation.y -= offset.y
    bone.rotation.z -= offset.z
  }
  seat.avatarBoneOffsets.clear()
}

function applyAvatarBoneOffset(
  seat: SeatRuntime,
  bone: THREE.Bone | undefined,
  x: number,
  y: number,
  z: number
) {
  if (!bone) return

  bone.rotation.x += x
  bone.rotation.y += y
  bone.rotation.z += z
  const existing = seat.avatarBoneOffsets.get(bone)
  if (existing) {
    existing.x += x
    existing.y += y
    existing.z += z
  } else {
    seat.avatarBoneOffsets.set(bone, new THREE.Euler(x, y, z, bone.rotation.order))
  }
}

function detachRiggedAvatar(seat: SeatRuntime) {
  restoreAvatarBoneOffsets(seat)
  disposeAvatarAccessorySet(seat.riggedAccessories)
  seat.riggedAccessories = null
  if (seat.avatar) {
    disposeAvatarAssetInstance(seat.avatar, {
      mixer: seat.avatarMixer ?? undefined,
      mixerRoot: seat.avatar.model,
    })
  } else {
    seat.avatarMixer?.stopAllAction()
  }

  disposeAvatarFace(seat.face)
  seat.face = null
  disposeDrinkProp(seat.drinkProp)
  seat.drinkProp = null
  seat.avatar = null
  seat.avatarStyle = null
  seat.avatarMixer = null
  seat.avatarIdleAction = null
  seat.avatarActiveAction = null
  seat.avatarFailureCount = 0
  seat.fallbackAvatar.visible = true
}

function startAvatarIdle(seat: SeatRuntime, fadeSeconds = 0) {
  const avatar = seat.avatar
  const mixer = seat.avatarMixer
  const clip = avatar?.clips.idleNeutral
  if (!avatar || !mixer || !clip) return

  const idle = mixer.clipAction(clip, avatar.model)
  idle.stopFading()
  if (!idle.isRunning()) idle.reset()
  idle.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
  idle.enabled = true
  idle.setEffectiveWeight(1)
  if (fadeSeconds > 0) idle.fadeIn(fadeSeconds)
  idle.play()
  if (idle.time === 0) idle.time = (seat.phase % 1) * clip.duration
  seat.avatarIdleAction = idle
}

function returnAvatarToIdle(seat: SeatRuntime, fadeSeconds = 0.18) {
  const active = seat.avatarActiveAction
  if (!active) return

  active.fadeOut(fadeSeconds)
  seat.avatarActiveAction = null
  startAvatarIdle(seat, fadeSeconds)
}

// Rigged avatars are performed procedurally (see avatarAnimator.ts). Only the
// idle clip runs on the mixer so authored clips never fight the seated poses.

function applySeatFoldVisualState(seat: SeatRuntime) {
  seat.foldMaterials.forEach(material => {
    applyFoldTint(material, seat.folded)
  })
  seat.avatar?.materials.forEach(material => {
    applyFoldTint(material, seat.folded)
  })
  seat.fallbackAccessories.materials.forEach(material => {
    applyFoldTint(material, seat.folded)
  })
  seat.riggedAccessories?.materials.forEach(material => {
    applyFoldTint(material, seat.folded)
  })
}

async function requestRiggedAvatar(
  runtime: SceneRuntime,
  playerId: string,
  seat: SeatRuntime,
  modelKey: ThreePlayerView['avatarProfile']['modelKey']
) {
  const generation = seat.avatarGeneration + 1
  const modelChanged = seat.requestedAvatarKey !== modelKey
  seat.avatarGeneration = generation
  seat.requestedAvatarKey = modelKey
  seat.avatarLoadStatus = 'loading'
  if (modelChanged) seat.avatarFailureCount = 0

  try {
    const avatar = await createAvatarAssetInstance(modelKey)
    const isCurrent = !runtime.disposed &&
      seat.avatarGeneration === generation &&
      seat.requestedAvatarKey === modelKey &&
      runtime.seats.get(playerId) === seat

    if (!isCurrent) {
      disposeAvatarAssetInstance(avatar)
      return
    }

    detachRiggedAvatar(seat)
    const style = stylizeAvatar(avatar.model, avatar.materials, { skinColor: seat.avatarProfile.skinColor, seed: playerId })
    seat.avatar = { ...avatar, materials: style.materials }
    seat.avatarStyle = style
    seat.face = createAvatarFace(avatar.model, avatar.bones.get('Head'), style.materials, style.skinColor, seat.avatarProfile.glasses)
    seat.skinBaseColor = style.skinColor ? style.skinColor.clone() : null
    seat.avatarMount.add(avatar.root)
    seat.avatarMount.position.set(0, AVATAR_SEAT_LIFT, 0)
    seat.anchorsFromRig = false
    seat.riggedAccessories = createRiggedAvatarAccessories(
      avatar.root,
      avatar.bones,
      seat.avatarProfile
    )
    avatar.model.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) mesh.renderOrder = 2
    })
    seat.avatarMixer = new THREE.AnimationMixer(avatar.model)
    seat.avatarLoadStatus = 'loaded'
    seat.avatarRetryAt = 0
    seat.avatarFailureCount = 0
    seat.fallbackAvatar.visible = false
    applySeatFoldVisualState(seat)
    startAvatarIdle(seat)
    precompileScene(runtime.renderer, runtime.scene, runtime.camera)
    // The load + compile is a one-off stall; keep it out of the frame budget.
    runtime.frameBudget.settle((performance.now() - runtime.startTime) / 1000)
    updateAvatarDiagnostics(runtime)
  } catch (error) {
    if (runtime.disposed || seat.avatarGeneration !== generation) return
    console.warn(`Unable to load rigged avatar ${modelKey}; keeping the current safe fallback.`, error)
    seat.avatarLoadStatus = 'failed'
    seat.avatarFailureCount += 1
    seat.avatarRetryAt = performance.now() + getAvatarRetryDelayMs(seat.avatarFailureCount)
    // When a profile changes while an older model is already live, retain the
    // healthy instance until the requested replacement succeeds.
    seat.fallbackAvatar.visible = seat.avatar === null
    updateAvatarDiagnostics(runtime)
  }
}

function syncSeatAppearance(
  seat: SeatRuntime,
  profile: ThreePlayerView['avatarProfile']
) {
  const nextAppearanceKey = getAvatarAppearanceKey(profile)
  const appearanceChanged = seat.appearanceKey !== nextAppearanceKey
  seat.avatarProfile = profile

  if (!appearanceChanged) return

  disposeAvatarAccessorySet(seat.fallbackAccessories)
  seat.fallbackAccessories = createFallbackAvatarAccessories(
    seat.head,
    seat.fallbackAvatar,
    profile
  )

  // A model swap loads asynchronously. Keep accessories calibrated to the
  // mounted model until its replacement is ready instead of briefly attaching
  // the new model's offsets to the old skeleton.
  if (!seat.avatar || seat.avatar.modelKey === profile.modelKey) {
    disposeAvatarAccessorySet(seat.riggedAccessories)
    seat.riggedAccessories = seat.avatar
      ? createRiggedAvatarAccessories(seat.avatar.root, seat.avatar.bones, profile)
      : null
  }
  seat.appearanceKey = nextAppearanceKey
}

function syncSeat(seat: SeatRuntime, player: ThreePlayerView, now: number) {
  if (seat.visualSeat !== player.visualSeat) setSeatPosition(seat, player.visualSeat)
  // Desktop is framed from the local player's chair. Their physical avatar would
  // sit between the camera and their DOM-rendered hole cards, so keep that seat
  // out of the 3D scene while retaining its readable fixed hand and stack HUD.
  seat.root.visible = !player.isHero
  seat.isHero = player.isHero

  seat.acting = player.isActing
  seat.winner = player.isWinner
  seat.folded = player.isOutOfHand
  seat.keepFoldedCardsVisible = player.visibleCards.length > 0
  seat.actionCue = player.actionCue
  seat.wagerIntensity = player.wagerIntensity
  syncSeatAppearance(seat, player.avatarProfile)

  const drinks = player.drinks
  seat.drunkLevel = drinks?.level ?? 0
  seat.passedOut = drinks?.passedOut ?? false
  const lastDrink = drinks?.lastDrink ?? null
  if (lastDrink && lastDrink.id !== seat.drinkId) {
    seat.drinkId = lastDrink.id
    seat.drinkStartedAt = now
    if (!seat.drinkProp || seat.drinkProp.kind !== lastDrink.kind) {
      disposeDrinkProp(seat.drinkProp)
      seat.drinkProp = createDrinkProp(lastDrink.kind)
      seat.root.parent?.add(seat.drinkProp.group)
    }
  }

  seat.playback = advanceActionPlaybackState(
    seat.playback,
    player.actionKey,
    player.actionCue,
    now * 1000
  )
  seat.actionKey = player.actionKey

  if (!seat.hadCards && player.hasCards) seat.dealStartedAt = now
  seat.hadCards = player.hasCards
  seat.peeking = Boolean(player.isPeeking)
  seat.cards.visible = player.hasCards && (
    !player.isOutOfHand || seat.keepFoldedCardsVisible
  )
  seat.dealerButton.visible = player.isDealer

  applySeatFoldVisualState(seat)

  const slots = getThreeVisibleCardSlots(player.showCards, player.visibleCards)
  ;[slots.left, slots.right].forEach((card, index) => {
    const holeCard = seat.holeCards[index]
    if (holeCard) setCardFace(holeCard, card ? { rank: card.rank, suit: card.suit } : null)
  })

  const ringColor = player.isWinner ? '#ffd46b' : player.isActing ? '#7fd0ff' : '#39c795'
  seat.ring.material.color.set(ringColor)
  seat.ring.material.emissive.set(ringColor)
}

const OUTFIT_HATS = ['none', 'fedora', 'cowboy', 'beanie', 'visor', 'crown'] as const
const OUTFIT_JACKETS = ['none', 'tuxedo', 'leather', 'varsity', 'western', 'smoking'] as const
const OUTFIT_MODELS = ['business_man', 'casual', 'hoodie', 'worker', 'punk', 'adventurer'] as const

/**
 * Bots often share a look. For display only, nudge any repeated model+outfit
 * combination to a different model/hat/jacket so the table never has clones.
 */
function withDistinctOutfits(players: ThreePlayerView[]): ThreePlayerView[] {
  const used = new Set<string>()
  const usedModels = new Map<string, number>()
  return players.map((player, index) => {
    let profile = player.avatarProfile
    const keyOf = (candidate: typeof profile) => `${candidate.modelKey}|${candidate.hat}|${candidate.jacket}|${candidate.glasses}`
    let attempt = 0
    while ((used.has(keyOf(profile)) || (usedModels.get(profile.modelKey) ?? 0) >= 2) && attempt < 12) {
      attempt += 1
      const model = OUTFIT_MODELS[(OUTFIT_MODELS.indexOf(profile.modelKey as typeof OUTFIT_MODELS[number]) + attempt) % OUTFIT_MODELS.length]!
      profile = {
        ...profile,
        modelKey: model as typeof profile.modelKey,
        hat: OUTFIT_HATS[(index + attempt) % OUTFIT_HATS.length] as typeof profile.hat,
        jacket: OUTFIT_JACKETS[(index * 2 + attempt) % OUTFIT_JACKETS.length] as typeof profile.jacket,
      }
    }
    used.add(keyOf(profile))
    usedModels.set(profile.modelKey, (usedModels.get(profile.modelKey) ?? 0) + 1)
    return profile === player.avatarProfile ? player : { ...player, avatarProfile: profile }
  })
}

function syncPlayers(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const now = (performance.now() - runtime.startTime) / 1000
  const activeIds = new Set(view.players.map(player => player.id))

  for (const [playerId, seat] of runtime.seats) {
    if (activeIds.has(playerId)) continue
    seat.avatarGeneration += 1
    detachRiggedAvatar(seat)
    runtime.scene.remove(seat.root)
    seat.stack.group.removeFromParent()
    disposeObject(seat.root)
    runtime.seats.delete(playerId)
  }

  const hasWinner = view.players.some(player => player.isWinner)
  const displayPlayers = withDistinctOutfits(view.players)
  for (const player of displayPlayers) {
    let seat = runtime.seats.get(player.id)
    if (!seat) {
      seat = createSeatRuntime(player, now)
      runtime.seats.set(player.id, seat)
      runtime.scene.add(seat.root)
      runtime.scene.add(seat.stack.group)
    }
    syncSeat(seat, player, now)
    // Personal chip stack: denser for deeper stacks, capped for readability.
    const bigBlind = Math.max(1, view.bigBlind)
    seat.stackCount = player.stack <= 0 ? 0 : Math.min(20, Math.max(2, Math.round(Math.log2(player.stack / bigBlind + 1) * 3.2)))
    seat.stack.group.visible = seat.stackCount > 0
    seat.stack.chipMeshes.forEach((chip, index) => {
      chip.visible = index < seat.stackCount
    })
    // Anyone who reached the showdown and didn't win reacts to the loss.
    seat.loser = hasWinner && !player.isWinner && !player.isOutOfHand && player.hasCards

    const avatarKeyChanged = seat.requestedAvatarKey !== player.avatarProfile.modelKey
    const retryReady = seat.avatarLoadStatus === 'failed' && performance.now() >= seat.avatarRetryAt
    if (
      !player.isHero &&
      (avatarKeyChanged || seat.avatarLoadStatus === 'idle' || retryReady)
    ) {
      void requestRiggedAvatar(runtime, player.id, seat, player.avatarProfile.modelKey)
    }
  }

  updateAvatarDiagnostics(runtime)
}

const CHIP_RADIUS = 0.13
const CHIP_HEIGHT = 0.042
const CHIPS_PER_COLUMN = 5
const WAGER_CHIPS_PER_COLUMN = 6
let sharedChipGeometry: THREE.CylinderGeometry | null = null

function getChipGeometry() {
  // One shared cylinder: the side group takes the edge-spot band and both caps
  // take the printed face, so each chip is a single draw with no detail mesh.
  sharedChipGeometry ??= new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 36)
  return sharedChipGeometry
}

/**
 * Chips are animated as lightweight proxy meshes on a hidden layer, and drawn
 * each frame by one InstancedMesh per denomination (≈10 draw calls for every
 * chip on the table instead of one draw per chip).
 */
const CHIP_PROXY_LAYER = 3
const chipProxies = new Set<THREE.Mesh>()
let sharedChipMaterials: THREE.MeshStandardMaterial[] | null = null

function getSharedChipMaterials() {
  sharedChipMaterials ??= CHIP_DENOMINATIONS.flatMap((_, index) => [
    new THREE.MeshStandardMaterial({
      map: getChipEdgeTexture(index),
      roughness: 0.38,
      metalness: 0.05,
      envMapIntensity: 0.7,
    }),
    new THREE.MeshStandardMaterial({
      map: getChipFaceTexture(index),
      roughness: 0.34,
      metalness: 0.05,
      envMapIntensity: 0.7,
    }),
  ])
  sharedChipMaterials.forEach(material => { material.userData.shared = true })
  return sharedChipMaterials
}

interface ChipInstancer {
  meshes: THREE.InstancedMesh[]
  /** Soft contact shadows under every chip column resting on the felt (one draw). */
  contact: THREE.InstancedMesh
}

let contactShadowTexture: THREE.CanvasTexture | null = null

function getContactShadowTexture() {
  if (contactShadowTexture) return contactShadowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.62)')
    gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.42)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  contactShadowTexture = new THREE.CanvasTexture(canvas)
  return contactShadowTexture
}

const CHIP_INSTANCE_CAPACITY = 520

function createChipInstancer(scene: THREE.Scene): ChipInstancer {
  const materials = getSharedChipMaterials()
  const meshes = CHIP_DENOMINATIONS.map((_, index) => {
    const edge = materials[index * 2]!
    const face = materials[index * 2 + 1]!
    const mesh = new THREE.InstancedMesh(getChipGeometry(), [edge, face, face], CHIP_INSTANCE_CAPACITY)
    mesh.name = `chip-instances-${index}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.count = 0
    scene.add(mesh)
    return mesh
  })
  const contactGeometry = new THREE.PlaneGeometry(CHIP_RADIUS * 3.1, CHIP_RADIUS * 3.1)
  contactGeometry.rotateX(-Math.PI / 2)
  const contact = new THREE.InstancedMesh(contactGeometry, new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }), CHIP_INSTANCE_CAPACITY)
  contact.name = 'chip-contact-shadows'
  contact.frustumCulled = false
  contact.renderOrder = 1
  contact.count = 0
  scene.add(contact)
  return { meshes, contact }
}

const contactMatrix = new THREE.Matrix4()
const contactPosition = new THREE.Vector3()

function isChipShown(chip: THREE.Object3D, scene: THREE.Scene) {
  let node: THREE.Object3D | null = chip
  while (node) {
    if (!node.visible) return false
    if (node === scene) return true
    node = node.parent
  }
  return false
}

/** Copies every visible chip proxy into its denomination's instanced mesh. */
const chipInstanceCounts: number[] = []

function updateChipInstances(instancer: ChipInstancer, scene: THREE.Scene) {
  const counts = chipInstanceCounts
  counts.length = instancer.meshes.length
  counts.fill(0)
  let contactCount = 0
  for (const chip of chipProxies) {
    if (!chip.parent) {
      chipProxies.delete(chip)
      continue
    }
    if (!isChipShown(chip, scene)) continue
    const denomination = Number(chip.userData.denomination ?? 0)
    const mesh = instancer.meshes[denomination]
    if (!mesh || counts[denomination]! >= CHIP_INSTANCE_CAPACITY) continue
    chip.updateWorldMatrix(true, false)
    mesh.setMatrixAt(counts[denomination]!, chip.matrixWorld)
    counts[denomination]! += 1
    // The bottom chip of each column grounds it with a soft blob on the felt
    // (fades out as the chip lifts off during a toss).
    if (chip.userData.level === 0 && contactCount < CHIP_INSTANCE_CAPACITY) {
      contactPosition.setFromMatrixPosition(chip.matrixWorld)
      const lift = contactPosition.y - FELT_TOP_Y - CHIP_HEIGHT / 2
      if (lift < 0.35) {
        const scale = 1 + Math.max(0, lift) * 1.6
        contactMatrix.makeScale(scale, 1, scale)
        contactMatrix.setPosition(contactPosition.x, FELT_TOP_Y + 0.0025, contactPosition.z)
        instancer.contact.setMatrixAt(contactCount, contactMatrix)
        contactCount += 1
      }
    }
  }
  instancer.contact.count = contactCount
  instancer.contact.instanceMatrix.needsUpdate = true
  instancer.meshes.forEach((mesh, index) => {
    mesh.count = counts[index]!
    mesh.instanceMatrix.needsUpdate = true
  })
}

/**
 * mound: loose clustered columns (pot, personal stacks).
 * stack: a bet as one or two neat, squared columns side by side.
 */
function createChipSet(maxChips: number, layout: 'mound' | 'stack' = 'mound') {
  const group = new THREE.Group()
  const materials = getSharedChipMaterials()
  const chipMeshes: THREE.Mesh[] = []
  const chipBasePositions: THREE.Vector3[] = []
  const chipBodyGeometry = getChipGeometry()
  const random = createSeededRandom(maxChips * 7919)

  for (let index = 0; index < maxChips; index += 1) {
    const neat = layout === 'stack'
    const perColumn = neat ? WAGER_CHIPS_PER_COLUMN : CHIPS_PER_COLUMN
    const column = Math.floor(index / perColumn)
    const level = index % perColumn
    const styleIndex = neat
      ? (column * 2 + Math.floor(level / 3)) % CHIP_DENOMINATIONS.length
      : column % CHIP_DENOMINATIONS.length
    const edgeMaterial = materials[styleIndex * 2]!
    const faceMaterial = materials[styleIndex * 2 + 1]!
    // Columns sit in a tight cluster; each chip is nudged so stacks look hand-placed.
    const angle = column * 2.4
    const radius = neat ? 0 : column === 0 ? 0 : 0.24 + Math.floor((column - 1) / 6) * 0.2
    const neatX = neat ? column * (CHIP_RADIUS * 2 + 0.012) : 0
    const jitter = neat ? 0.004 : 0.012
    const chip = addMesh(
      group,
      chipBodyGeometry,
      [edgeMaterial, faceMaterial, faceMaterial],
      [
        neatX + Math.cos(angle) * radius + (random() - 0.5) * jitter,
        CHIP_HEIGHT / 2 + level * (CHIP_HEIGHT + 0.002),
        Math.sin(angle) * radius * 0.8 + (random() - 0.5) * jitter,
      ]
    )
    chip.rotation.y = random() * Math.PI * 2
    chip.userData.baseYaw = chip.rotation.y
    chip.userData.denomination = styleIndex
    chip.userData.level = level
    chip.name = `casino-chip-${index}`
    chip.visible = false
    // Proxy only: the instancer draws it, so hide it from the camera and shadows.
    chip.layers.set(CHIP_PROXY_LAYER)
    chip.castShadow = false
    chipProxies.add(chip)
    chipMeshes.push(chip)
    chipBasePositions.push(chip.position.clone())
  }

  return { group, chipMeshes, chipBasePositions, materials }
}

function toVisualSeat(value: number): TableVisualSeat {
  return (value >= 0 && value <= 7 ? value : 0) as TableVisualSeat
}

function toVector3(value: readonly [number, number, number]) {
  return new THREE.Vector3(value[0], value[1], value[2])
}

function isWagerAction(cue: ThreeActionCue) {
  return cue === 'call' || cue === 'bet' || cue === 'raise' || cue === 'all_in'
}

function createWagerRuntime(
  scene: THREE.Scene,
  player: ThreePlayerView,
  now: number
): WagerRuntime {
  const chips = createChipSet(12, 'stack')
  const visualSeat = toVisualSeat(player.visualSeat)
  const start = toVector3(getTableWagerStartPoint(visualSeat))
  const target = toVector3(getTableWagerAnchor(visualSeat))
  chips.group.name = `committed-wager-${player.id}`
  chips.group.position.copy(target)
  scene.add(chips.group)

  return {
    playerId: player.id,
    ...chips,
    visualSeat,
    amount: player.bet,
    actionKey: player.actionKey,
    start,
    target,
    startedAt: now,
    animating: false,
    collectStartedAt: Number.NEGATIVE_INFINITY,
    collectCount: 0,
    collectDest: null,
    motionProfile: getPokerActionMotionProfile(player.actionCue, {
      actionKey: player.actionKey,
      playerId: player.id,
      wagerIntensity: player.wagerIntensity,
    }),
  }
}

function syncWagers(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const now = (performance.now() - runtime.startTime) / 1000
  const activeIds = new Set(view.players.map(player => player.id))

  for (const [playerId, wager] of runtime.wagers) {
    if (activeIds.has(playerId)) continue
    wager.group.removeFromParent()
    disposeObject(wager.group)
    runtime.wagers.delete(playerId)
  }

  for (const player of view.players) {
    let wager = runtime.wagers.get(player.id)
    if (!wager) {
      wager = createWagerRuntime(runtime.scene, player, now)
      runtime.wagers.set(player.id, wager)
    }

    const visualSeat = toVisualSeat(player.visualSeat)
    const seatChanged = wager.visualSeat !== visualSeat
    const actionChanged = Boolean(player.actionKey) && wager.actionKey !== player.actionKey
    const amountIncreased = player.bet > wager.amount
    wager.visualSeat = visualSeat
    const ownerSeat = runtime.seats.get(player.id)
    if (ownerSeat) {
      // Chips leave the player's own stack (where the hand grabs them).
      ownerSeat.stack.group.getWorldPosition(wager.start)
      wager.start.y = TABLE_WAGER_Y
    } else {
      wager.start.copy(toVector3(getTableWagerStartPoint(visualSeat)))
    }
    wager.target.copy(toVector3(getTableWagerAnchor(visualSeat)))

    if (seatChanged) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (actionChanged && amountIncreased && isWagerAction(player.actionCue)) {
      // Give the hand ~0.25s to reach the stack before the chips move.
      wager.startedAt = now + 0.25
      wager.animating = true
      wager.group.position.copy(wager.start)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (!wager.animating) {
      wager.group.position.copy(wager.target)
    }

    if (wager.amount > 0 && player.bet === 0) {
      // The street closed: sweep this stack into the pot, or straight to the
      // winner when everyone else folded, instead of popping it away.
      const winner = view.players.find(candidate => candidate.isWinner)
      const winnerSeat = winner ? runtime.seats.get(winner.id) : undefined
      wager.collectDest = null
      if (view.phase !== 'in_hand' && winner) {
        wager.collectDest = new THREE.Vector3()
        if (winnerSeat?.root.visible) winnerSeat.stack.group.getWorldPosition(wager.collectDest)
        else wager.collectDest.set(...getTableWagerStartPoint(toVisualSeat(winner.visualSeat)))
        wager.collectDest.y = TABLE_WAGER_Y
      }
      wager.collectStartedAt = now
      wager.collectCount = getWagerChipCount(wager.amount, view.bigBlind, wager.chipMeshes.length)
      wager.animating = false
    }
    wager.amount = player.bet
    wager.actionKey = player.actionKey
    if (actionChanged) {
      wager.motionProfile = getPokerActionMotionProfile(player.actionCue, {
        actionKey: player.actionKey,
        playerId: player.id,
        wagerIntensity: player.wagerIntensity,
      })
    }
    const collecting = now - wager.collectStartedAt < WAGER_COLLECT_SECONDS
    const chipCount = collecting
      ? wager.collectCount
      : view.phase === 'in_hand'
        ? getWagerChipCount(player.bet, view.bigBlind, wager.chipMeshes.length)
        : 0
    wager.group.visible = chipCount > 0
    wager.chipMeshes.forEach((chip, index) => {
      chip.visible = index < chipCount
    })
  }

  const host = runtime.renderer.domElement.parentElement
  if (host) {
    const visibleWagers = view.phase === 'in_hand'
      ? view.players.filter(player => player.bet > 0)
      : []
    host.dataset.tableWagerCount = String(visibleWagers.length)
    host.dataset.tableWagerTotal = String(visibleWagers.reduce((sum, player) => sum + player.bet, 0))
  }
}

function resetChipTransforms(chips: THREE.Mesh[], basePositions: THREE.Vector3[]) {
  chips.forEach((chip, index) => {
    const base = basePositions[index]
    if (base) chip.position.copy(base)
    chip.rotation.set(0, Number(chip.userData.baseYaw ?? 0), 0)
  })
}

const WAGER_COLLECT_SECONDS = 0.55

function animateWagers(runtime: SceneRuntime, time: number, reducedMotion: boolean) {
  for (const wager of runtime.wagers.values()) {
    const collectProgress = (time - wager.collectStartedAt) / WAGER_COLLECT_SECONDS
    if (collectProgress >= 0 && collectProgress < 1 && !reducedMotion) {
      const potPosition = wager.collectDest ?? runtime.pot.group.position
      const position = interpolateWagerArc(
        [wager.target.x, wager.target.y, wager.target.z],
        [potPosition.x, potPosition.y, potPosition.z],
        collectProgress,
        // High enough to clear the board cards when sweeping across the felt.
        0.5
      )
      wager.group.position.set(position[0], position[1], position[2])
      wager.group.visible = true
      continue
    }
    if (collectProgress >= 1 && wager.amount === 0 && wager.group.visible) {
      wager.group.visible = false
      wager.group.position.copy(wager.target)
    }
    if (!wager.animating) continue

    if (reducedMotion) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      wager.group.rotation.set(0, 0, 0)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
      continue
    }

    const { wagerStyle, wagerIntensity, variant } = wager.motionProfile
    const duration = wagerStyle === 'flick'
      ? 0.78 - wagerIntensity * 0.08
      : wagerStyle === 'shove'
        ? 0.62 - wagerIntensity * 0.06
        : 0.72
    const progress = THREE.MathUtils.clamp((time - wager.startedAt) / duration, 0, 1)
    const arcHeight = wagerStyle === 'flick'
      ? 0.42 + wagerIntensity * 0.2
      : wagerStyle === 'shove'
        ? 0.16 + wagerIntensity * 0.08
        : 0.1 + wagerIntensity * 0.07
    const leaderProgress = THREE.MathUtils.clamp(progress * 1.04, 0, 1)
    const position = interpolateWagerArc(
      [wager.start.x, wager.start.y, wager.start.z],
      [wager.target.x, wager.target.y, wager.target.z],
      leaderProgress,
      arcHeight * 0.72
    )
    wager.group.position.set(position[0], position[1], position[2])
    wager.group.rotation.set(0, 0, 0)

    const staggerStep = wagerStyle === 'flick'
      ? 0.038 + wagerIntensity * 0.008
      : wagerStyle === 'shove'
        ? 0.009
        : 0.015
    const progressBoost = 1 + staggerStep * Math.min(11, wager.chipMeshes.length - 1)
    wager.chipMeshes.forEach((chip, index) => {
      const base = wager.chipBasePositions[index]
      if (!base) return
      const orderedIndex = variant === 1
        ? (index * 5) % wager.chipMeshes.length
        : variant === 2
          ? wager.chipMeshes.length - index - 1
          : index
      const chipProgress = THREE.MathUtils.clamp(
        progress * progressBoost - orderedIndex * staggerStep,
        0,
        1
      )
      const chipWorld = interpolateWagerArc(
        [wager.start.x, wager.start.y, wager.start.z],
        [wager.target.x, wager.target.y, wager.target.z],
        chipProgress,
        arcHeight + (index % 3) * 0.025
      )
      const landingBounce = chipProgress > 0.82
        ? Math.sin((chipProgress - 0.82) / 0.18 * Math.PI) * 0.035 * (1 - wagerIntensity * 0.35)
        : 0
      chip.position.set(
        base.x + chipWorld[0] - position[0],
        base.y + chipWorld[1] - position[1] + landingBounce,
        base.z + chipWorld[2] - position[2]
      )
      const spinDirection = (index + variant) % 2 === 0 ? 1 : -1
      const spinRate = wagerStyle === 'flick' ? 5.4 : wagerStyle === 'shove' ? 1.25 : 2.1
      chip.rotation.x = spinDirection * chipProgress * Math.PI * (wagerStyle === 'flick' ? 1.8 : 0.24)
      chip.rotation.y = spinDirection * chipProgress * Math.PI * spinRate
      chip.rotation.z = spinDirection * Math.sin(chipProgress * Math.PI) * (
        wagerStyle === 'flick' ? 0.32 : wagerStyle === 'shove' ? 0.08 : 0.15
      )
    })

    if (progress >= 1) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      wager.group.rotation.set(0, 0, 0)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    }
  }
}

function createPotRuntime(scene: THREE.Scene): PotRuntime {
  const pot = createChipSet(30)
  pot.group.name = 'table-pot-chip-mound'
  pot.group.position.set(0, FELT_TOP_Y, 1.28)
  pot.group.scale.setScalar(1.15)
  scene.add(pot.group)
  return {
    ...pot,
    visibleChipCount: 0,
    bounceStartedAt: Number.NEGATIVE_INFINITY,
    payoutKey: '',
    payoutStartedAt: Number.NEGATIVE_INFINITY,
    payoutCount: 0,
    payoutTargets: [],
    paidKey: '',
    payoutAmount: 0,
    lastPotAmount: 0,
  }
}

/** Launch window for the pot's chips; each chip then flies CHIP_FLIGHT_SECONDS. */
const POT_PAYOUT_STAGGER_SECONDS = 0.32
const CHIP_FLIGHT_SECONDS = 0.5
const POT_PAYOUT_SECONDS = POT_PAYOUT_STAGGER_SECONDS + CHIP_FLIGHT_SECONDS + 0.05
/** Payout chips peak this high above the felt so they clear the board cards. */
const PAYOUT_ARC_PEAK = 0.62

function getPayoutChipDelay(index: number, count: number) {
  return count <= 1 ? 0 : (index / (count - 1)) * POT_PAYOUT_STAGGER_SECONDS
}

function syncPot(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const now = (performance.now() - runtime.startTime) / 1000
  const count = getWagerChipCount(view.collectedPot, view.bigBlind, runtime.pot.chipMeshes.length)
  const pot = runtime.pot
  const winners = view.players.filter(player => player.isWinner)
  const winnerKey = winners.map(player => player.id).join(',')
  const payoutRunning = pot.payoutKey !== '' && now - pot.payoutStartedAt < POT_PAYOUT_SECONDS
  if (winners.length > 0 && winnerKey !== pot.payoutKey && winnerKey !== pot.paidKey) {
    // Payout: the pot's chips arc high over the board and land on each
    // winner's own stack, while the pot readout counts down.
    pot.payoutKey = winnerKey
    pot.payoutStartedAt = now
    pot.payoutCount = Math.min(pot.chipMeshes.length, Math.max(pot.visibleChipCount, count, 6))
    pot.payoutAmount = Math.max(view.pot, pot.lastPotAmount)
    pot.payoutTargets = winners.map(winner => {
      const winnerSeat = runtime.seats.get(winner.id)
      if (winnerSeat) {
        const target = winnerSeat.stack.group.getWorldPosition(new THREE.Vector3())
        // Land on top of the winner's centre column.
        const levels = Math.min(CHIPS_PER_COLUMN, Math.max(1, winnerSeat.stackCount))
        target.y = FELT_TOP_Y + levels * (CHIP_HEIGHT + 0.002) + CHIP_HEIGHT / 2
        return target
      }
      const fallback = toVector3(getTableWagerStartPoint(toVisualSeat(winner.visualSeat)))
      fallback.y = FELT_TOP_Y + CHIP_HEIGHT / 2
      return fallback
    })
  } else if (winners.length === 0) {
    pot.paidKey = ''
    if (!payoutRunning) {
      pot.payoutKey = ''
      pot.payoutTargets = []
    }
  }
  if (!pot.payoutKey && winners.length === 0) {
    pot.lastPotAmount = Math.max(view.pot, view.collectedPot)
  }
  if (count > pot.visibleChipCount && !pot.payoutKey) {
    pot.bounceStartedAt = now
  }
  pot.visibleChipCount = count
  const shown = pot.payoutKey ? pot.payoutCount : count
  pot.group.visible = shown > 0
  pot.chipMeshes.forEach((chip, index) => {
    chip.visible = index < shown
  })

  const host = runtime.renderer.domElement.parentElement
  if (host) {
    host.dataset.potChipCount = String(count)
    host.dataset.potAmount = String(view.pot)
    host.dataset.collectedPotAmount = String(view.collectedPot)
  }
}

const payoutStart = new THREE.Vector3()
const payoutEnd = new THREE.Vector3()
const payoutPoint = new THREE.Vector3()

/** Formats a chip amount like the DOM pot label ($1,600 / $12.5K). */
function formatPotAmount(amount: number) {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`
  if (amount >= 10000) return `$${(amount / 1000).toFixed(1)}K`
  return `$${Math.round(amount).toLocaleString()}`
}

/**
 * The DOM pot label disappears the moment the payout starts; this readout
 * takes its place and counts down as each chip lands on the winner's stack.
 */
function updatePayoutReadout(host: HTMLElement, amount: number | null) {
  const readout = host.querySelector<HTMLElement>('.payout-pot-readout')
  if (!readout) return
  const visible = amount !== null
  if (readout.dataset.visible !== String(visible)) readout.dataset.visible = String(visible)
  if (amount === null) return
  const value = readout.querySelector('b')
  const text = formatPotAmount(amount)
  if (value && value.textContent !== text) value.textContent = text
}

function animatePot(runtime: SceneRuntime, time: number, reducedMotion: boolean, host: HTMLElement) {
  const pot = runtime.pot
  if (pot.payoutKey && pot.payoutTargets.length > 0) {
    const elapsed = reducedMotion ? POT_PAYOUT_SECONDS : time - pot.payoutStartedAt
    const count = pot.payoutCount
    let landed = 0
    pot.group.updateWorldMatrix(true, false)
    pot.chipMeshes.forEach((chip, index) => {
      const base = pot.chipBasePositions[index]
      const target = pot.payoutTargets[index % pot.payoutTargets.length]
      if (!base || !target || index >= count) {
        chip.visible = false
        return
      }
      // Top of the mound leaves first so the pile visibly shrinks.
      const order = count - 1 - index
      const progress = THREE.MathUtils.clamp((elapsed - getPayoutChipDelay(order, count)) / CHIP_FLIGHT_SECONDS, 0, 1)
      if (progress >= 1) {
        landed += 1
        chip.visible = false
        return
      }
      chip.visible = true
      if (progress <= 0) {
        chip.position.copy(base)
        chip.rotation.set(0, Number(chip.userData.baseYaw ?? 0), 0)
        return
      }
      payoutStart.copy(base)
      pot.group.localToWorld(payoutStart)
      // Chips fan out a little so they stack beside each other on arrival.
      const spread = ((index * 7) % 5 - 2) * 0.018
      payoutEnd.set(target.x + spread, target.y + (order % 3) * 0.004, target.z - spread * 0.6)
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
      payoutPoint.lerpVectors(payoutStart, payoutEnd, eased)
      // A high arc that always clears the (tilted, lifted) board cards.
      const peak = FELT_TOP_Y + PAYOUT_ARC_PEAK + (order % 4) * 0.03
      const arcBase = Math.max(payoutStart.y, payoutEnd.y)
      payoutPoint.y += 4 * eased * (1 - eased) * Math.max(0, peak - arcBase)
      pot.group.worldToLocal(payoutPoint)
      chip.position.copy(payoutPoint)
      // One clean flip in flight, flat again on landing.
      const direction = index % 2 === 0 ? 1 : -1
      chip.rotation.set(eased * Math.PI * 2 * direction, Number(chip.userData.baseYaw ?? 0) + eased * 1.4, 0)
    })
    const remaining = elapsed >= POT_PAYOUT_SECONDS ? 0 : pot.payoutAmount * (1 - landed / Math.max(1, count))
    updatePayoutReadout(host, pot.payoutAmount > 0 && elapsed < POT_PAYOUT_SECONDS + 0.35 ? remaining : null)
    if (elapsed >= POT_PAYOUT_SECONDS + 0.35) {
      // Done: remember who was paid so the lingering winner flag never replays it.
      pot.paidKey = pot.payoutKey
      pot.payoutKey = ''
      pot.payoutTargets = []
      resetChipTransforms(pot.chipMeshes, pot.chipBasePositions)
      pot.chipMeshes.forEach((chip, index) => { chip.visible = index < pot.visibleChipCount })
      pot.group.visible = pot.visibleChipCount > 0
    } else {
      pot.group.visible = true
    }
    return
  }
  updatePayoutReadout(host, null)
  if (pot.bounceStartedAt === Number.POSITIVE_INFINITY) return

  const progress = reducedMotion
    ? 1
    : THREE.MathUtils.clamp((time - pot.bounceStartedAt) / 0.72, 0, 1)
  if (progress >= 1) {
    resetChipTransforms(pot.chipMeshes, pot.chipBasePositions)
    // Settled: skip the per-chip work until the next bounce.
    pot.bounceStartedAt = Number.POSITIVE_INFINITY
    return
  }

  pot.chipMeshes.forEach((chip, index) => {
    const base = pot.chipBasePositions[index]
    if (!base) return
    const delayed = THREE.MathUtils.clamp(progress * 1.35 - index * 0.025, 0, 1)
    const bounce = Math.sin(delayed * Math.PI) * 0.095 * (1 - delayed * 0.35)
    chip.position.set(base.x, base.y + bounce, base.z)
    chip.rotation.z = (index % 2 === 0 ? 1 : -1) * Math.sin(delayed * Math.PI) * 0.06
  })
}

const ikTarget = new THREE.Vector3()
const ikPole = new THREE.Vector3()
const raiseUp = new THREE.Vector3()
const raiseSide = new THREE.Vector3()
const faceGuardCenter = new THREE.Vector3()
const faceGuardOffset = new THREE.Vector3()
/** Skull radius (seat units) the wrists are kept outside of. */
const FACE_GUARD_RADIUS = 0.2

const flipUp = new THREE.Vector3()
const flipSide = new THREE.Vector3()
const flipToward = new THREE.Vector3()
const flipWrist = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Reaches each hand to its animator target with two-bone arm IK. Targets past
 * a comfortable (soft-elbow) reach lean the chest in rather than locking the
 * arm straight; during a flick-off the right hand is turned knuckles-out with
 * the fingers up.
 */
function solveSeatArms(seat: SeatRuntime, pose: AvatarPose, flipTarget: Vec3 | null = null) {
  const bones = seat.avatar?.bones
  if (!bones) return
  const sides = [
    { side: 'R', hand: pose.handR, shoulder: seat.anchors.shoulderR, out: 1 },
    { side: 'L', hand: pose.handL, shoulder: seat.anchors.shoulderL, out: -1 },
  ] as const
  // Lean in for far reaches (pushing chips, shoving all-in) before solving.
  let overshoot = 0
  for (const { side, hand } of sides) {
    const chain = getArmChain(bones.get(`UpperArm${side}`), bones.get(`LowerArm${side}`), bones.get(`Wrist${side}`))
    if (!chain) continue
    ikTarget.set(hand[0], hand[1], hand[2])
    seat.root.localToWorld(ikTarget)
    overshoot = Math.max(overshoot, getArmOvershoot(chain, ikTarget))
  }
  if (overshoot > 0.001) {
    // Lean over the (wide) rail to reach the felt, keeping the eyes up so the
    // face stays readable from across the table.
    const lean = Math.min(0.55, (overshoot / Math.max(0.2, seat.root.scale.x)) * 0.9)
    applyAvatarBoneOffset(seat, bones.get('Chest'), lean * 0.62, 0, 0)
    applyAvatarBoneOffset(seat, bones.get('Torso'), lean * 0.38, 0, 0)
    applyAvatarBoneOffset(seat, bones.get('Head'), -lean * 0.65, 0, 0)
    seat.avatar?.model.updateMatrixWorld(true)
  }
  const splay = THREE.MathUtils.clamp(pose.elbowOut, 0, 1)
  const raiseAll = THREE.MathUtils.clamp(pose.elbowUp, 0, 1)
  // Face guard: the live skull, as a sphere a little above the head bone
  // (which sits at the top of the neck), in seat space. A wrist target that
  // would pass through it (hands travelling to or from behind the head, a rub
  // on the crown) is slid out sideways, toward its own shoulder, so the hand
  // goes round the side of the head and never in front of the face.
  const headBone = bones.get('Head')
  let guardRadius = 0
  if (headBone) {
    seat.root.worldToLocal(headBone.getWorldPosition(faceGuardCenter))
    faceGuardCenter.y += 0.13
    guardRadius = FACE_GUARD_RADIUS
  }
  for (const { side, hand, shoulder, out } of sides) {
    const chain = getArmChain(bones.get(`UpperArm${side}`), bones.get(`LowerArm${side}`), bones.get(`Wrist${side}`))
    if (!chain) continue
    ikTarget.set(hand[0], hand[1], hand[2])
    if (guardRadius > 0) {
      faceGuardOffset.subVectors(ikTarget, faceGuardCenter)
      const across = guardRadius * guardRadius - faceGuardOffset.y * faceGuardOffset.y - faceGuardOffset.z * faceGuardOffset.z
      if (across > 0) {
        const clearX = Math.sqrt(across)
        if (faceGuardOffset.x * out < clearX) ikTarget.x = faceGuardCenter.x + out * clearX
      }
    }
    seat.root.localToWorld(ikTarget)
    // Elbows swing out to the side and down/back, like arms resting on a rail;
    // folded on the rail (passed out) they splay out level with the hands;
    // a hand raised to or above the head (elbowUp) lifts its own elbow only.
    const raise = raiseAll * THREE.MathUtils.smoothstep(hand[1], shoulder[1] - 0.05, shoulder[1] + 0.2)
    ikPole.set(
      shoulder[0] + out * (0.7 + 0.5 * splay + 0.3 * raise),
      shoulder[1] - (0.7 * (1 - splay) + 0.12 * splay) * (1 - raise) + 0.5 * raise,
      shoulder[2] + (0.45 * (1 - splay) + 0.05 * splay) * (1 - raise) + 0.15 * raise
    )
    seat.root.localToWorld(ikPole)
    solveArmIK(chain, ikTarget, ikPole)

    if (raise > 0.01) {
      // Raised arms: fingers up and back over the skull, palms to the head,
      // instead of the hands jutting straight inward across the face.
      const middle = bones.get(`Middle2${side}`)
      const index = bones.get(`Index2${side}`)
      const pinky = bones.get(`Pinky2${side}`)
      if (middle && index && pinky) {
        raiseUp.set(0, 0.75, 0.66).transformDirection(seat.root.matrixWorld)
        raiseSide.set(0, -0.6, 0.8).transformDirection(seat.root.matrixWorld)
        orientBoneFrame(chain.hand, middle, index, pinky, raiseUp, raiseSide, raise)
      }
    }

    if (flipTarget && side === getFlipOffHand(flipTarget) && pose.middleFinger > 0.01) {
      const middle = bones.get(`Middle2${side}`)
      const index = bones.get(`Index2${side}`)
      const pinky = bones.get(`Pinky2${side}`)
      if (middle && index && pinky) {
        chain.hand.getWorldPosition(flipWrist)
        flipToward.set(flipTarget[0], flipTarget[1], flipTarget[2])
        seat.root.localToWorld(flipToward)
        flipToward.sub(flipWrist).setY(0)
        if (flipToward.lengthSq() > 1e-6) {
          flipToward.normalize()
          // Fingers up (tipped a touch toward the target), back of the hand to
          // them: index-to-pinky runs to the sender's left (right, for the left hand).
          flipUp.copy(WORLD_UP).addScaledVector(flipToward, 0.28).normalize()
          flipSide.crossVectors(WORLD_UP, flipToward).normalize().multiplyScalar(side === 'R' ? 1 : -1)
          orientBoneFrame(chain.hand, middle, index, pinky, flipUp, flipSide, pose.middleFinger)
        }
      }
    }
  }
}

const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Pinky'] as const
/** Radians per joint (knuckle → tip) at a full fist. */
const FINGER_FIST_CURL = [1.25, 1.45, 0.9] as const
/** A relaxed hand is never flat: a little natural bend at every joint. */
const FINGER_REST_CURL = [0.1, 0.16, 0.1] as const
/** Outer fingers curl a bit more than the index for a natural cascade. */
const FINGER_CASCADE: Record<(typeof FINGER_NAMES)[number], number> = { Index: -0.06, Middle: 0, Ring: 0.06, Pinky: 0.12 }

/** Curls one hand: 0 = relaxed open, 1 = fist; `middleUp` extends only the middle finger. */
function curlHand(seat: SeatRuntime, bones: ReadonlyMap<string, THREE.Bone>, side: 'R' | 'L', curl: number, middleUp = 0) {
  const fist = Math.max(curl, middleUp)
  for (const finger of FINGER_NAMES) {
    const extended = finger === 'Middle' ? middleUp : 0
    const amount = THREE.MathUtils.clamp(fist + FINGER_CASCADE[finger] * (1 - fist), 0, 1)
    for (let joint = 0; joint < 3; joint += 1) {
      const bend = (FINGER_REST_CURL[joint] + amount * FINGER_FIST_CURL[joint]) * (1 - extended) - 0.05 * extended
      // On these rigs negative local X flexes a finger toward the palm
      // (positive bends it back toward the knuckles).
      applyAvatarBoneOffset(seat, bones.get(`${finger}${joint + 1}${side}`), -bend, 0, 0)
    }
  }
  // Thumb folds in over the curled fingers (tucked for the flick-off).
  const mirror = side === 'R' ? 1 : -1
  applyAvatarBoneOffset(seat, bones.get(`Thumb1${side}`), -(0.05 + fist * 0.3 + 0.25 * middleUp), -mirror * (fist * 0.3 + 0.3 * middleUp), 0)
  applyAvatarBoneOffset(seat, bones.get(`Thumb2${side}`), -(0.1 + fist * 0.45 + 0.25 * middleUp), 0, 0)
  applyAvatarBoneOffset(seat, bones.get(`Thumb3${side}`), -(0.08 + fist * 0.35), 0, 0)
}

const flipTargetWorld = new THREE.Vector3()

/** Converts an active flick-off into animator input (target in seat space). */
function getFlipOffInput(seat: SeatRuntime, time: number, seats: ReadonlyMap<string, SeatRuntime>) {
  const gesture = seat.flipOff
  if (!gesture) return null
  const elapsed = time - gesture.startedAt
  if (elapsed > FLIP_OFF_SECONDS) {
    seat.flipOff = null
    return null
  }
  const target = seats.get(gesture.targetId)
  // Aim at the target's face (their head bone when it is loaded).
  const targetHead = target?.avatar?.bones.get('Head')
  if (targetHead) {
    targetHead.getWorldPosition(flipTargetWorld)
    flipTargetWorld.y += 0.12
  } else {
    if (target) target.root.getWorldPosition(flipTargetWorld)
    else flipTargetWorld.set(0, 0, 4.4)
    flipTargetWorld.y += 1.4
  }
  const local = seat.root.worldToLocal(flipTargetWorld.clone())
  return { elapsed, target: [local.x, local.y, local.z] as Vec3 }
}

let dealerPuckTexture: THREE.CanvasTexture | null = null

/** Cream puck face with a bold "D" (shared across seats). */
function getDealerPuckTexture() {
  if (dealerPuckTexture) return dealerPuckTexture
  dealerPuckTexture = createCanvasTexture(128, 128, context => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
    context.fillStyle = '#fff8ea'
    context.fillRect(0, 0, 128, 128)
    context.strokeStyle = '#d9a441'
    context.lineWidth = 8
    context.beginPath()
    context.arc(64, 64, 54, 0, Math.PI * 2)
    context.stroke()
    context.fillStyle = '#16191c'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 68px ${font ? `${font}, ` : ''}'Arial Black', sans-serif`
    context.fillText('D', 64, 70)
  })
  return dealerPuckTexture
}

const IDENTITY_QUATERNION = new THREE.Quaternion()
const drinkWristWorld = new THREE.Vector3()
const drinkKnuckleWorld = new THREE.Vector3()
const drinkForward = new THREE.Vector3()

const drinkMouthWorld = new THREE.Vector3()
const drinkRestWorld = new THREE.Vector3()
const drinkAxis = new THREE.Vector3()
const drinkUp = new THREE.Vector3(0, 1, 0)
const drinkTilt = new THREE.Quaternion()
const drinkYaw = new THREE.Quaternion()
/** Glass height (rim above base) at prop scale 1. */
const DRINK_RIM_HEIGHT = 0.23

/**
 * The drink's whole life on the table: it lands on the felt beside the
 * drinker with a little bounce, the hand takes it, the rim goes to the
 * actual mouth (tipped along the hand-to-mouth line), it is set back down on
 * the same spot, and shrinks away once the hand has left it.
 */
function placeDrinkProp(seat: SeatRuntime, pose: AvatarPose, time: number) {
  const prop = seat.drinkProp
  if (!prop) return
  prop.group.visible = seat.root.visible
  if (!seat.root.visible) return
  const elapsed = time - seat.drinkStartedAt
  const END = DRINK_DURATION + 0.3
  if (elapsed < 0 || elapsed > END || seat.passedOut) {
    prop.group.visible = false
    return
  }
  const scale = seat.root.scale.x
  // Arrives with a small overshoot, leaves with a quick shrink.
  const arrive = THREE.MathUtils.clamp(elapsed / 0.22, 0, 1)
  const arriveScale = arrive >= 1 ? 1 : 1 + 2.4 * Math.pow(arrive - 1, 3) + 1.4 * Math.pow(arrive - 1, 2)
  const leave = THREE.MathUtils.smoothstep(elapsed, DRINK_DURATION - 0.05, END)
  const size = scale * 0.95 * Math.max(0.001, arriveScale * (1 - leave))

  const rest = seat.anchors.drinkRest
  seat.root.localToWorld(drinkRestWorld.set(rest[0], rest[1] - 0.02, rest[2]))
  const inHand = THREE.MathUtils.smoothstep(elapsed, 0.26, 0.4) * (1 - THREE.MathUtils.smoothstep(elapsed, 2.14, 2.3))
  const wrist = seat.avatar?.bones.get('WristR')
  const knuckle = seat.avatar?.bones.get('Middle1R')
  drinkYaw.setFromAxisAngle(drinkUp, seat.root.rotation.y)
  if (!wrist || inHand <= 0.001) {
    prop.group.position.copy(drinkRestWorld)
    prop.group.quaternion.copy(drinkYaw)
    prop.group.scale.setScalar(size)
    return
  }
  wrist.getWorldPosition(drinkWristWorld)
  if (knuckle) {
    knuckle.getWorldPosition(drinkKnuckleWorld)
    drinkWristWorld.lerp(drinkKnuckleWorld, 0.7)
  }
  // Base of the glass in the fist, just in front of the palm.
  drinkForward.set(0, 0, -1).applyQuaternion(seat.root.quaternion)
  drinkWristWorld.addScaledVector(drinkForward, 0.06 * scale)
  drinkWristWorld.y -= 0.12 * scale
  prop.group.position.lerpVectors(drinkRestWorld, drinkWristWorld, inHand)
  prop.group.quaternion.copy(drinkYaw)

  const lift = THREE.MathUtils.clamp(pose.drinkLift, 0, 1)
  const head = seat.avatar?.bones.get('Head')
  const mouth = seat.mouthInHead
  if (lift > 0.001 && head && mouth) {
    // Tip the glass so its rim meets the lips: the glass axis swings from
    // upright to the line from the fist to the mouth.
    head.localToWorld(drinkMouthWorld.copy(mouth))
    const rim = DRINK_RIM_HEIGHT * size
    drinkAxis.subVectors(drinkMouthWorld, prop.group.position)
    const reach = drinkAxis.length()
    if (reach > 1e-4) {
      drinkAxis.divideScalar(reach)
      // Past vertical: the glass tips over the lips as the head goes back.
      drinkAxis.addScaledVector(drinkForward, 0.35 * lift).normalize()
      drinkTilt.setFromUnitVectors(drinkUp, drinkAxis)
      prop.group.quaternion.premultiply(drinkTilt.slerp(IDENTITY_QUATERNION, 1 - lift))
      const at = THREE.MathUtils.smoothstep(lift, 0.25, 1)
      // Base where it has to be for the rim to touch the mouth.
      drinkAxis.copy(drinkUp).applyQuaternion(prop.group.quaternion)
      drinkRestWorld.copy(drinkMouthWorld).addScaledVector(drinkAxis, -rim)
      prop.group.position.lerp(drinkRestWorld, at)
    }
  }
  prop.group.scale.setScalar(size)
}

/** Rosy cheeks creep in as the beers go down. */
function flushCheeks(seat: SeatRuntime) {
  const skin = seat.avatar?.materials.find(material => /^skin$/i.test(material.name)) as THREE.MeshToonMaterial | undefined
  if (!skin?.color || !seat.skinBaseColor) return
  const flush = Math.min(1, seat.drunkLevel / 10) * 0.38
  skin.color.copy(seat.skinBaseColor).lerp(DRUNK_FLUSH, flush)
  if (seat.folded) skin.color.multiplyScalar(0.5)
}

const DRUNK_FLUSH = new THREE.Color('#ff6b6b')


function animateSeat(
  seat: SeatRuntime,
  time: number,
  delta: number,
  actingVisualSeat: number | null,
  reducedMotion: boolean,
  tableHeat = 0,
  runtimeSeats: ReadonlyMap<string, SeatRuntime> = new Map(),
  boardRevealAge = Number.POSITIVE_INFINITY,
  anyWinner = false,
  prank: SeatPrankInput | null = null
) {
  // Furniture and table props stay grounded. Only the player breathes, shifts,
  // and reacts to action playback.
  seat.root.position.y = seat.baseY

  const playback = getActionPlaybackSnapshot(
    seat.playback,
    reducedMotion ? Number.POSITIVE_INFINITY : time * 1000
  )
  const actionPoseOptions = {
    actionKey: seat.actionKey,
    playerId: seat.playerId,
    wagerIntensity: seat.wagerIntensity,
  }
  const tablePose = getOpponentTableActionPose(
    seat.folded && seat.keepFoldedCardsVisible ? 'ready' : playback.cue,
    seat.folded && seat.keepFoldedCardsVisible
      ? Number.POSITIVE_INFINITY
      : playback.elapsedMs,
    actionPoseOptions
  )
  const headTurn = getAvatarHeadTurn(seat.visualSeat, actingVisualSeat)
  // A passed-out player can't flick anyone off (the emote itself still sends).
  const flipOff = seat.passedOut ? null : getFlipOffInput(seat, time, runtimeSeats)
  const pose = updateAvatarAnimator(seat.animator, {
    time,
    delta,
    reducedMotion,
    acting: seat.acting,
    folded: seat.folded,
    winner: seat.winner,
    loser: seat.loser,
    hasCards: seat.hadCards && seat.cards.visible,
    peeking: seat.peeking,
    cue: playback.cue,
    cueElapsedMs: playback.elapsedMs,
    cueActive: playback.isActive,
    actionKey: seat.actionKey,
    playerId: seat.playerId,
    wagerIntensity: seat.wagerIntensity,
    lookYaw: headTurn.yaw,
    lookPitch: headTurn.pitch,
    tableHeat,
    idleTell: seat.avatarProfile.idleTell,
    celebration: seat.avatarProfile.celebration,
    anchors: seat.anchors,
    drinkElapsed: time - seat.drinkStartedAt < DRINK_DURATION ? time - seat.drinkStartedAt : null,
    drunkLevel: seat.drunkLevel,
    passedOut: seat.passedOut,
    flipOff,
    boardRevealAge,
    otherWinner: anyWinner && !seat.winner,
    shotElapsed: prank?.shotElapsed ?? null,
    cheersRaise: prank?.cheersRaise ?? 0,
    bonkElapsed: prank?.bonkElapsed ?? null,
    chipFlick: prank?.chipFlick ?? null,
    ...seat.funPose,
  })
  seat.lastPose = pose

  seat.body.position.set(
    pose.bodyPosition[0],
    0.12 + pose.bodyPosition[1],
    0.03 + seat.seatShiftZ + pose.bodyPosition[2]
  )
  seat.body.rotation.set(-0.035 + pose.bodyRotation[0], pose.bodyRotation[1], pose.bodyRotation[2])

  // The primitive fallback avatar mirrors the same performance at a coarser level.
  const { bones: poseBones } = pose
  seat.head.rotation.set(
    poseBones.Head[0] + poseBones.Neck[0],
    poseBones.Head[1] + poseBones.Neck[1],
    poseBones.Head[2]
  )
  const leftLift = pose.handL[1] - seat.anchors.railL[1]
  const rightLift = pose.handR[1] - seat.anchors.railR[1]
  seat.leftArm.rotation.set(1.08 - leftLift * 1.6, 0, -0.22)
  seat.rightArm.rotation.set(1.08 - rightLift * 1.6, 0, 0.22)

  if (seat.avatar && seat.avatarMixer) {
    // AnimationMixer only rewrites bones that have tracks in the active clip.
    // Remove our previous additive pose before advancing so untracked bones do
    // not slowly drift into broken rotations over a long session.
    restoreAvatarBoneOffsets(seat)
    if (reducedMotion && seat.avatarActiveAction) {
      seat.avatarActiveAction.stop()
      seat.avatarActiveAction = null
      startAvatarIdle(seat)
    }
    seat.avatarMixer.update(reducedMotion ? 0 : delta)

    if (seat.avatarActiveAction && !seat.avatarActiveAction.isRunning()) {
      returnAvatarToIdle(seat)
    }

    const bones = seat.avatar.bones
    // Seat the standing rig: thighs forward onto the cushion, shins down.
    for (const side of ['R', 'L'] as const) {
      applyAvatarBoneOffset(seat, bones.get(`UpperLeg${side}`), -1.45, 0, side === 'R' ? 0.06 : -0.06)
      applyAvatarBoneOffset(seat, bones.get(`LowerLeg${side}`), 1.5, 0, 0)
    }
    for (const name of ANIMATED_BONES) {
      const offset = poseBones[name]
      applyAvatarBoneOffset(seat, bones.get(name), offset[0], offset[1], offset[2])
    }
    seat.avatar.model.updateMatrixWorld(true)
    if (!seat.anchorsFromRig) measureRigAnchors(seat)
    solveSeatArms(seat, pose, flipOff?.target ?? null)
    const blink = seat.passedOut ? 1 : reducedMotion ? 0 : getBlinkAmount(time, seat.animator.seed)
    placeDrinkProp(seat, pose, time)
    flushCheeks(seat)
    if (seat.face) {
      // A bonk startles; the shot's burn scrunches the face.
      const bonked = prank?.bonkElapsed !== null && prank?.bonkElapsed !== undefined && prank.bonkElapsed < 1.2
      const burning = prank?.shotElapsed !== null && prank?.shotElapsed !== undefined && prank.shotElapsed > SHOT_DOWN_AT && prank.shotElapsed < SHOT_SHUDDER_END
      const mood: FaceMood = bonked
        ? 'surprised'
        : burning
          ? 'sad'
          : seat.winner
        ? 'happy'
        : seat.loser
          ? 'sad'
          : tableHeat > 0.3 && !seat.acting
            ? 'surprised'
            : seat.acting
              ? 'focused'
              : seat.folded || seat.drunkLevel >= 4
                ? 'bored'
                : 'neutral'
      updateAvatarFace(seat.face, {
        delta,
        blink,
        mood,
        lookX: -(poseBones.Head[1] + poseBones.Neck[1]) * 1.6,
        lookY: (poseBones.Head[0] + poseBones.Neck[0]) * 1.4,
        reducedMotion,
      })
    } else if (seat.avatarStyle) {
      applyBlink(seat.avatarStyle, blink)
    }
    const flipHand = flipOff ? getFlipOffHand(flipOff.target) : 'R'
    curlHand(seat, bones, 'R', pose.fingerCurlR, flipHand === 'R' ? pose.middleFinger : 0)
    curlHand(seat, bones, 'L', pose.fingerCurlL, flipHand === 'L' ? pose.middleFinger : 0)

    if (process.env.NODE_ENV !== 'production') {
      // Development-only live pose tuning: window.__avatarTweak = { Bone: [x, y, z] }.
      const tweak = (globalThis as { __avatarTweak?: Record<string, Vec3> }).__avatarTweak
      if (tweak) {
        for (const [name, offset] of Object.entries(tweak)) {
          if (name === 'mount') seat.avatarMount.position.set(...offset)
          else applyAvatarBoneOffset(seat, bones.get(name), offset[0], offset[1], offset[2])
        }
      }
    }
  }

  const ringPulse = reducedMotion
    ? 1
    : 1 + Math.sin(time * (seat.winner ? 4.4 : 3.2) + seat.phase) * 0.07
  seat.ring.scale.setScalar(ringPulse)
  seat.ring.material.opacity = seat.winner
    ? 0.8 + (reducedMotion ? 0 : Math.sin(time * 4.4) * 0.15)
    : seat.acting
      ? 0.62 + (reducedMotion ? 0 : Math.sin(time * 3.2) * 0.18)
      : 0
  seat.ring.material.emissiveIntensity = seat.winner ? 2.6 : 1.8

  seat.winnerHalo.visible = seat.winner
  seat.winnerSparkles.visible = seat.winner
  if (seat.winner) {
    const celebrationPulse = reducedMotion ? 1 : 0.88 + Math.sin(time * 3.8 + seat.phase) * 0.12
    seat.winnerHalo.position.y = 2.28 + pose.bodyPosition[1] + (reducedMotion ? 0 : Math.sin(time * 2.4) * 0.035)
    seat.winnerHalo.rotation.z = reducedMotion ? 0 : time * 0.42
    seat.winnerHalo.scale.setScalar(celebrationPulse)
    seat.winnerHalo.material.opacity = reducedMotion
      ? 0.78
      : 0.64 + Math.sin(time * 3.8 + seat.phase) * 0.16
    seat.winnerSparkles.rotation.y = reducedMotion ? 0 : time * 0.34
    seat.winnerSparkles.position.y = reducedMotion ? 0 : Math.sin(time * 1.7 + seat.phase) * 0.06 + (time % 3) * 0.05
    seat.winnerSparkles.material.opacity = reducedMotion
      ? 0.64
      : 0.6 + Math.sin(time * 4.6 + seat.phase) * 0.25
  } else {
    seat.winnerHalo.material.opacity = 0
    seat.winnerSparkles.material.opacity = 0
  }

  if (seat.hadCards) {
    const actionCardsVisible = playback.cue === 'fold'
      ? (seat.avatar && !reducedMotion ? playback.isActive : tablePose.cards.visible)
      : true
    seat.cards.visible = seat.keepFoldedCardsVisible || (
      actionCardsVisible && (!seat.folded || playback.isActive)
    )
    const restY = Number(seat.cards.userData.restY ?? 0)
    const peekLift = pose.cardLift
    // Cards fly in from the dealer (table centre) and slide into place. A peek
    // tilts the near edge up (hinged on the far edge) so only the owner sees the faces.
    const peekTilt = peekLift * 0.78
    const foldToss = seat.avatar && playback.cue === 'fold' && playback.isActive && !seat.keepFoldedCardsVisible && !reducedMotion
      ? getFoldTossPose(seat, playback.elapsedMs / ACTION_ANIMATION_DURATION_MS, restY)
      : null
    if (foldToss) {
      seat.cards.position.set(...foldToss.position)
      seat.cards.rotation.set(...foldToss.rotation)
    } else {
      seat.cards.position.set(
        tablePose.cards.position[0],
        restY + tablePose.cards.position[1] + Math.sin(peekTilt) * 0.13 + peekLift * 0.015,
        seat.cardLocalZ + tablePose.cards.position[2] * 0.6 - (1 - Math.cos(peekTilt)) * 0.13
      )
      seat.cards.rotation.set(
        tablePose.cards.rotation[0] - peekTilt,
        tablePose.cards.rotation[1],
        tablePose.cards.rotation[2]
      )
    }
    if (!foldToss) seat.cards.userData.foldRelease = undefined
    setHoleCardFade(seat, foldToss?.fade ?? 0)
    const dealFrom = (seat.cards.userData.dealFrom as Vec3 | undefined) ?? [0, 0.3, -1.5]
    seat.cards.scale.setScalar(1)
    seat.cardMeshes.forEach((card, index) => {
      // Dealt clockwise from the dealer, one card per player per round.
      const dealDelay = (seat.visualSeat + index * 8) * 0.075
      const cardProgress = reducedMotion
        ? 1
        : THREE.MathUtils.clamp((time - seat.dealStartedAt - dealDelay) / 0.46, 0, 1)
      const cardEase = 1 - Math.pow(1 - cardProgress, 3)
      card.visible = cardProgress > 0
      const baseX = Number(card.userData.baseX ?? (index === 0 ? -0.17 : 0.17))
      const baseYaw = Number(card.userData.baseYaw ?? 0)
      // Showdown flips a card over its long edge once its face is known.
      const faceUp = Boolean(seat.holeCards[index]?.face)
      const flipTarget = faceUp ? 0 : Math.PI
      const currentFlip = Number(card.userData.flip ?? Math.PI)
      const flip = reducedMotion
        ? flipTarget
        : currentFlip + (flipTarget - currentFlip) * (1 - Math.exp(-delta * 9))
      card.userData.flip = flip
      const flipArc = Math.sin(flip) * 0.12
      const travel = 1 - cardEase
      card.position.set(
        baseX * cardEase + dealFrom[0] * travel,
        index * 0.014 + flipArc + dealFrom[1] * travel + Math.sin(cardProgress * Math.PI) * 0.28,
        dealFrom[2] * travel
      )
      // Cards skim in spinning and settle flat and square.
      card.rotation.set(0, baseYaw * cardEase + travel * Math.PI * 2.5, flip)
    })
  } else {
    seat.cards.visible = false
  }
}

const foldWrist = new THREE.Vector3()

/**
 * A rigged player's fold, in the cards group's (seat-local) space: the hand
 * reaches the cards, they rise with the fingers as the wrist cocks, then they
 * are released on the flick and sail in a low arc toward the middle, skid
 * flat on the felt and fade out. Timed against the animator's fold (reach by
 * ~0.2, cock to ~0.36, flick ~0.34-0.44 of the cue).
 */
function getFoldTossPose(seat: SeatRuntime, t: number, restY: number): { position: Vec3; rotation: Vec3; fade: number } {
  const rest: Vec3 = [0, restY, seat.cardLocalZ]
  const board = seat.anchors.board
  // Landing spot: a good way toward the middle, flat on the felt.
  const land: Vec3 = [
    rest[0] + (board[0] - rest[0]) * 0.34,
    restY,
    rest[2] + (board[2] - rest[2]) * 0.34,
  ]
  const skid: Vec3 = [
    rest[0] + (board[0] - rest[0]) * 0.42,
    restY,
    rest[2] + (board[2] - rest[2]) * 0.42,
  ]
  const wrist = seat.avatar?.bones.get('WristR')
  let held: Vec3 = rest
  if (wrist) {
    seat.root.worldToLocal(wrist.getWorldPosition(foldWrist))
    // Cards pinched under the fingertips, a little ahead of and below the wrist.
    held = [foldWrist.x - 0.04, Math.max(restY, foldWrist.y - 0.07), foldWrist.z - 0.1]
  }
  const RELEASE = 0.42
  const LAND = 0.68
  if (t < RELEASE) {
    const grip = THREE.MathUtils.smoothstep(t, 0.17, 0.27)
    const position: Vec3 = [
      rest[0] + (held[0] - rest[0]) * grip,
      rest[1] + (held[1] - rest[1]) * grip,
      rest[2] + (held[2] - rest[2]) * grip,
    ]
    // Near edge lifts as they come up off the felt.
    return { position, rotation: [-0.35 * grip, 0, 0.08 * grip], fade: 0 }
  }
  // Release point: where the fingers let go (remembered for the flight).
  const from = (seat.cards.userData.foldRelease as Vec3 | undefined) ?? held
  if (!seat.cards.userData.foldRelease) seat.cards.userData.foldRelease = [...held]
  if (t < LAND) {
    const f = (t - RELEASE) / (LAND - RELEASE)
    const ease = 1 - (1 - f) * (1 - f)
    const arc = Math.sin(f * Math.PI) * 0.1
    return {
      position: [
        from[0] + (land[0] - from[0]) * ease,
        from[1] + (land[1] - from[1]) * f + arc,
        from[2] + (land[2] - from[2]) * ease,
      ],
      // Sails flat with a lazy spin, settling level as it lands.
      rotation: [-0.35 * (1 - f), 0.9 * ease, 0.08 * (1 - f)],
      fade: 0,
    }
  }
  const k = THREE.MathUtils.smoothstep(t, LAND, 0.82)
  return {
    position: [land[0] + (skid[0] - land[0]) * k, restY, land[2] + (skid[2] - land[2]) * k],
    rotation: [0, 0.9 + 0.15 * k, 0],
    fade: THREE.MathUtils.smoothstep(t, 0.76, 0.97),
  }
}

/** Fades both hole cards (0 = solid). Materials only go transparent while fading. */
function setHoleCardFade(seat: SeatRuntime, fade: number) {
  const fading = fade > 0.001
  if (!fading && !seat.cards.userData.faded) return
  seat.cards.userData.faded = fading
  for (const card of seat.holeCards) {
    card.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (material.transparent !== fading) {
        material.transparent = fading
        material.depthWrite = !fading
        material.needsUpdate = true
      }
      material.opacity = fading ? 1 - fade : 1
    })
  }
}

function getAllInCameraImpact(
  seats: Iterable<SeatRuntime>,
  time: number,
  reducedMotion: boolean
): { strength: number; visualSeat: number | null } {
  if (reducedMotion) return { strength: 0, visualSeat: null }

  for (const seat of seats) {
    if (seat.actionCue !== 'all_in') continue
    const playback = getActionPlaybackSnapshot(seat.playback, time * 1000)
    if (!playback.isActive) continue

    const progress = THREE.MathUtils.clamp(
      playback.elapsedMs / ACTION_ANIMATION_DURATION_MS,
      0,
      1
    )
    const punch = Math.sin(THREE.MathUtils.clamp((progress - 0.12) / 0.72, 0, 1) * Math.PI)
    return {
      strength: punch * (0.7 + seat.wagerIntensity * 0.3),
      visualSeat: seat.visualSeat,
    }
  }

  return { strength: 0, visualSeat: null }
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materialsToDispose = new Set<THREE.Material>()
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach(material => materialsToDispose.add(material))
  })

  geometries.forEach(geometry => geometry.dispose())
  materialsToDispose.forEach(material => {
    // Shared (instanced) materials outlive any one seat or wager group.
    if (material.userData.shared) return
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    material.dispose()
  })
}

/** Head-top anchor, in seat-root space, that each DOM nameplate follows. */
const NAMEPLATE_ANCHOR = new THREE.Vector3(0, 2.32, 0.08)
const WAGER_LABEL_LIFT = 0.28

function getTableHeat(runtime: SceneRuntime, time: number) {
  // A live raise or all-in from one seat makes everyone else react.
  let heat = 0
  let sourceId: string | null = null
  for (const seat of runtime.seats.values()) {
    if (seat.actionCue !== 'all_in' && seat.actionCue !== 'raise') continue
    const playback = getActionPlaybackSnapshot(seat.playback, time * 1000)
    if (!playback.isActive) continue
    const intensity = seat.actionCue === 'all_in' ? 1 : 0.35 + seat.wagerIntensity * 0.5
    if (intensity > heat) {
      heat = intensity
      sourceId = seat.playerId
    }
  }
  return { heat, sourceId }
}

/**
 * Projects each seat's head anchor (and wager stack) to screen space and hands
 * the DOM layer pixel coordinates, so nameplates stay glued to avatars even as
 * the camera drifts, pushes in on all-ins, and pans toward winners.
 */
function projectSeatOverlays(runtime: SceneRuntime, host: HTMLDivElement, width: number, height: number) {
  const scratch = new THREE.Vector3()
  const placedPlates: Array<{ element: HTMLElement; x: number; y: number; extra: number }> = []
  // The pot readout floats just above the pot chips on the felt.
  const tableScene = host.closest<HTMLElement>('.table-scene')
  if (tableScene) {
    scratch.copy(runtime.pot.group.position)
    scratch.x += 0.42
    scratch.y += 0.12
    scratch.project(runtime.camera)
    tableScene.style.setProperty('--pot-x', `${((scratch.x * 0.5 + 0.5) * width).toFixed(1)}px`)
    tableScene.style.setProperty('--pot-y', `${((-scratch.y * 0.5 + 0.5) * height).toFixed(1)}px`)
  }
  for (const seat of runtime.seats.values()) {
    if (!seat.root.visible && tableScene) {
      // The hero's own bet label rides on their chips in front of the camera.
      const heroWager = runtime.wagers.get(seat.playerId)
      if (heroWager) {
        scratch.copy(heroWager.target)
        scratch.y += 0.2
        scratch.project(runtime.camera)
        tableScene.style.setProperty('--hero-bet-x', `${((scratch.x * 0.5 + 0.5) * width).toFixed(1)}px`)
        tableScene.style.setProperty('--hero-bet-y', `${((-scratch.y * 0.5 + 0.5) * height).toFixed(1)}px`)
      }
    }
    let element = runtime.overlayElements.get(seat.playerId)
    if (!element || !element.isConnected) {
      element = host.querySelector<HTMLElement>(`[data-seat-player="${CSS.escape(seat.playerId)}"]`) ?? undefined
      if (element) runtime.overlayElements.set(seat.playerId, element)
    }
    if (!element) continue

    const liftY = (seat.lastPose?.bodyPosition[1] ?? 0)
    scratch.set(NAMEPLATE_ANCHOR.x, NAMEPLATE_ANCHOR.y + liftY, NAMEPLATE_ANCHOR.z)
    seat.root.localToWorld(scratch)
    scratch.project(runtime.camera)
    // Neighbours beside or behind the seated camera pin to the screen edge.
    const behind = scratch.z > 1
    const rawX = (scratch.x * 0.5 + 0.5) * width * (behind ? -1 : 1)
    const margin = 110
    const x = THREE.MathUtils.clamp(rawX, margin, width - margin)
    const y = THREE.MathUtils.clamp((-scratch.y * 0.5 + 0.5) * height, 150, height - 260)
    const pinned = x !== rawX
    element.classList.toggle('is-edge-pinned', pinned)
    if (!element.classList.contains('is-local-player')) {
      // Revealed hole cards sit above the plate and need clearance too.
      const extra = element.querySelector('.has-revealed-cards') ? 62 : 0
      placedPlates.push({ element, x, y, extra })
    }
    element.style.setProperty('--seat-x', `${x.toFixed(1)}px`)
    element.style.setProperty('--seat-y', `${y.toFixed(1)}px`)
    element.style.setProperty('--seat-depth', `${(TABLE_SEAT_SCALES[toVisualSeat(seat.visualSeat)] ?? 1).toFixed(3)}`)

    const wager = runtime.wagers.get(seat.playerId)
    if (wager) {
      scratch.copy(wager.target)
      scratch.y += WAGER_LABEL_LIFT
      scratch.project(runtime.camera)
      element.style.setProperty('--bet-x', `${((scratch.x * 0.5 + 0.5) * width - x).toFixed(1)}px`)
      element.style.setProperty('--bet-y', `${((-scratch.y * 0.5 + 0.5) * height - y).toFixed(1)}px`)
    }
  }
  // Resolve collisions: nudge plates apart so no two nameplates overlap, even
  // when the camera pushes in or neighbours pin to the same screen edge.
  const compact = width < 1366 || height < 820
  const plateWidth = compact ? 168 : 196
  const plateHeight = compact ? 62 : 72
  placedPlates.sort((a, b) => a.y - b.y)
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < placedPlates.length; i += 1) {
      for (let j = i + 1; j < placedPlates.length; j += 1) {
        const upper = placedPlates[i]!
        const lower = placedPlates[j]!
        const overlapX = plateWidth - Math.abs(upper.x - lower.x)
        const overlapY = plateHeight + lower.extra - Math.abs(lower.y - upper.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        if (overlapY < overlapX) lower.y += overlapY
        else lower.x += (lower.x >= upper.x ? 1 : -1) * overlapX
        // Clamp inside the pass so the screen edge can't undo a nudge.
        lower.x = THREE.MathUtils.clamp(lower.x, 110, width - 110)
      }
    }
  }
  for (const plate of placedPlates) {
    // Steady plates: ignore sub-pixel sway, ease real moves, and freeze a plate
    // under the pointer so it can be clicked (targeted emotes).
    const previous = plateScreenPositions.get(plate.element)
    let x = plate.x
    let y = plate.y
    if (previous) {
      const hovered = plate.element.matches(':hover')
      const dx = x - previous.x
      const dy = y - previous.y
      if (hovered || Math.hypot(dx, dy) < 4) {
        x = previous.x
        y = previous.y
      } else {
        x = previous.x + dx * 0.35
        y = previous.y + dy * 0.35
      }
    }
    plateScreenPositions.set(plate.element, { x, y })
    plate.element.style.setProperty('--seat-x', `${x.toFixed(1)}px`)
    plate.element.style.setProperty('--seat-y', `${y.toFixed(1)}px`)
  }
}

const plateScreenPositions = new WeakMap<HTMLElement, { x: number; y: number }>()

const effectPoint = new THREE.Vector3()

/** Light cone breathing, winner confetti and all-in shockwaves. */
function animateEffects(runtime: SceneRuntime, time: number, delta: number, reducedMotion: boolean) {
  const effects = runtime.effects
  const winners = [...runtime.seats.values()].filter(seat => seat.winner)
  const winnerKey = winners.map(seat => seat.playerId).join(',')
  if (winnerKey && winnerKey !== effects.winnerKey && !reducedMotion) {
    for (const seat of winners) {
      // The hero's burst rains over the table rather than into the camera.
      if (seat.root.visible) seat.root.getWorldPosition(effectPoint)
      else effectPoint.set(0, -0.5, 0.6)
      effectPoint.y += 2.3
      burstConfetti(effects.confetti, effectPoint, 110)
    }
  }
  effects.winnerKey = winnerKey

  for (const seat of runtime.seats.values()) {
    if (seat.actionCue !== 'all_in' || !seat.actionKey || seat.actionKey === effects.allInKey) continue
    effects.allInKey = seat.actionKey
    const anchor = getTableWagerAnchor(toVisualSeat(seat.visualSeat))
    effectPoint.set(anchor[0], FELT_TOP_Y + 0.01, anchor[2])
    if (!reducedMotion) triggerShockwave(effects.shockwave, effectPoint, time)
  }

  animateLightCone(effects.cone, time, reducedMotion, winners.length > 0 ? 1 : 0)
  animateConfetti(effects.confetti, delta)
  animateShockwave(effects.shockwave, time)
}

/**
 * Compiles every shader in the scene up front — including hidden things like
 * confetti, the all-in shockwave, winner halos and Lady Luck — so the first
 * showdown doesn't stall for seconds compiling programs mid-animation.
 */
/** Meshes under this many vertices never earn a place in the shadow pass. */
const SHADOW_CASTER_MIN_VERTICES = 300

/**
 * Shadow-pass budget: the key light's shadow only needs to carry players,
 * chips and the table rail onto the felt. Room props, chairs, pucks and small
 * accessory parts are switched off (each caster is another draw every
 * shadow refresh). Skinned avatar parts are pruned in stylizeAvatar.
 */
const mergedAccessorySets = new WeakSet<AvatarAccessorySet>()
const accessoryInverse = new THREE.Matrix4()
const accessoryRelative = new THREE.Matrix4()

/**
 * Draw-call budget: procedural accessories (glasses, hats, jackets) are built
 * from many small static meshes that share a few materials. Bake each
 * accessory group's static meshes into one mesh per material (glasses: 9
 * draws -> 2). Disposal is unaffected (the set still traverses its groups).
 */
function mergeAccessoryMeshes(set: AvatarAccessorySet | null) {
  if (!set || mergedAccessorySets.has(set)) return
  mergedAccessorySets.add(set)
  for (const group of set.groups) {
    group.updateMatrixWorld(true)
    accessoryInverse.copy(group.matrixWorld).invert()
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>()
    group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material)) return
      if (mesh.morphTargetInfluences || !mesh.geometry.getAttribute('normal')) return
      for (let node: THREE.Object3D | null = mesh; node && node !== group; node = node.parent) {
        if (!node.visible) return
      }
      const list = byMaterial.get(mesh.material) ?? []
      list.push(mesh)
      byMaterial.set(mesh.material, list)
    })
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue
      const parts = meshes.map(mesh => {
        const part = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone())
        for (const name of Object.keys(part.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') part.deleteAttribute(name)
        }
        accessoryRelative.multiplyMatrices(accessoryInverse, mesh.matrixWorld)
        part.applyMatrix4(accessoryRelative)
        return part
      })
      const hasUv = parts.every(part => part.getAttribute('uv'))
      if (!hasUv) parts.forEach(part => part.deleteAttribute('uv'))
      const merged = mergeGeometries(parts, false)
      parts.forEach(part => part.dispose())
      if (!merged) continue
      const combined = new THREE.Mesh(merged, material)
      combined.name = `${group.name || 'accessory'}-merged`
      combined.castShadow = meshes.some(mesh => mesh.castShadow)
      combined.receiveShadow = meshes.some(mesh => mesh.receiveShadow)
      combined.renderOrder = meshes[0]!.renderOrder
      group.add(combined)
      for (const mesh of meshes) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
      }
    }
  }
}

function pruneShadowCasters(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.castShadow || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
    const vertices = mesh.geometry?.getAttribute('position')?.count ?? 0
    if (vertices < SHADOW_CASTER_MIN_VERTICES || /chair|puck|ring|halo|sconce|poster|lamp/i.test(`${mesh.name} ${mesh.parent?.name ?? ''}`)) {
      mesh.castShadow = false
    }
  })
}

function precompileScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const hidden: THREE.Object3D[] = []
  scene.traverse(object => {
    // Lights keep their real state: toggling one changes every lit shader's variant.
    if (!object.visible && !(object as THREE.Light).isLight) {
      hidden.push(object)
      object.visible = true
    }
  })
  // Synchronous on purpose: compileAsync's readiness poll throws if an avatar
  // swap disposes a material mid-compile. This only runs at load time anyway.
  try {
    renderer.compile(scene, camera)
  } finally {
    hidden.forEach(object => { object.visible = false })
  }
}

/** Drives the hero's own first-person drink; returns the head-tilt amount. */
function updateHeroDrink(runtime: SceneRuntime, view: ThreeTableViewModel, time: number, reducedMotion: boolean) {
  let heroSeat: SeatRuntime | null = null
  for (const seat of runtime.seats.values()) {
    if (seat.isHero) heroSeat = seat
  }
  const hero = view.players.find(player => player.isHero)
  const elapsed = heroSeat && heroSeat.drinkProp && !heroSeat.passedOut ? time - heroSeat.drinkStartedAt : null
  return updateFirstPersonDrink(runtime.firstPersonDrink, {
    elapsed,
    kind: heroSeat?.drinkProp?.kind ?? 'beer',
    skinColor: hero?.avatarProfile.skinColor ?? '#d9a27c',
    sleeveColor: hero?.avatarProfile.sleeveColor ?? '#2b2f3a',
    drunkLevel: heroSeat?.drunkLevel ?? 0,
    time,
    reducedMotion,
  })
}

const companionBubbleWorld = new THREE.Vector3()

/** Drives Lady Luck beside her owner's seat and floats her speech bubble. */
function updateLadyLuck(
  runtime: SceneRuntime,
  view: ThreeTableViewModel,
  host: HTMLDivElement,
  time: number,
  delta: number,
  reducedMotion: boolean,
  width: number,
  height: number
) {
  const companion = runtime.companion
  if (!companion) return
  const state = view.companion ?? null
  const owner = state ? view.players.find(player => player.id === state.ownerId) ?? null : null
  const ownerSeat = owner ? runtime.seats.get(owner.id)?.root ?? null : null
  updateCompanion(companion, {
    time,
    delta,
    reducedMotion,
    camera: runtime.camera,
    state,
    ownerSeat,
    ownerIsHero: Boolean(owner?.isHero),
    ownerFolded: owner?.status === 'folded',
    table: {
      ownerActionKey: owner?.actionKey,
      ownerActionCue: owner?.actionCue,
      otherPlayerNames: view.players.filter(player => player.id !== owner?.id).map(player => player.nickname),
      allIn: view.allInAnnouncement,
    },
  })

  const bubble = host.querySelector<HTMLElement>('.lady-luck-bubble-3d')
  if (!bubble) return
  const line = getCompanionLine(companion)
  if (!line || !getCompanionBubbleAnchor(companion, companionBubbleWorld)) {
    bubble.dataset.visible = 'false'
    return
  }
  companionBubbleWorld.project(runtime.camera)
  const x = THREE.MathUtils.clamp((companionBubbleWorld.x * 0.5 + 0.5) * width, 140, width - 140)
  const y = THREE.MathUtils.clamp((-companionBubbleWorld.y * 0.5 + 0.5) * height, 90, height - 200)
  bubble.dataset.visible = 'true'
  if (bubble.textContent !== line) bubble.textContent = line
  bubble.style.setProperty('--bubble-x', `${x.toFixed(1)}px`)
  bubble.style.setProperty('--bubble-y', `${y.toFixed(1)}px`)
}

function createSceneRuntime(
  canvas: HTMLCanvasElement,
  host: HTMLDivElement,
  viewRef: MutableRefObject<ThreeTableViewModel>,
  highlightRef: MutableRefObject<ReadonlyArray<{ rank: string; suit: ThreeCardView['suit'] }>>
): SceneRuntime {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  // r184 folds PCFSoft into PCF (hardware-filtered, soft via shadow.radius).
  renderer.shadowMap.type = THREE.PCFShadowMap
  // Shadows refresh on a fixed clock (see animate), not every frame.
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#081413')
  scene.fog = new THREE.FogExp2('#081413', 0.012)

  const camera = new THREE.PerspectiveCamera(DESKTOP_CAMERA_FRAMING.fov, 1, 0.1, 60)
  camera.position.set(...DESKTOP_CAMERA_FRAMING.position)
  const cameraLookAt = new THREE.Vector3(...DESKTOP_CAMERA_FRAMING.lookAt)
  const baseCameraPosition = camera.position.clone()
  const baseCameraLookAt = cameraLookAt.clone()
  camera.lookAt(cameraLookAt)

  const environment = applyEnvironmentLighting(renderer, scene)
  const lights = createStageLights(scene)
  const { neonMaterials } = createRoom(scene)
  // Only the table (rail onto felt) keeps casting among the static set.
  scene.children.forEach(child => {
    child.traverse(object => { if ((object as THREE.Mesh).isMesh) object.castShadow = false })
  })
  const table = createStylizedTable()
  scene.add(table.group)
  const feltMaterial = table.feltMaterial
  const pot = createPotRuntime(scene)
  const board = createBoardRuntime(scene)
  let companion: CompanionRuntime | null = null
  const effects = {
    cone: createLightCone(scene, new THREE.Vector3(0, 7.2, -0.35), FELT_TOP_Y, 3.6),
    confetti: createConfetti(scene),
    shockwave: createShockwave(scene),
    winnerKey: '',
    allInKey: '',
  }
  // The camera joins the scene so the first-person drink can ride on it.
  scene.add(camera)
  const firstPersonDrink = createFirstPersonDrink(camera)
  // One loose chip for flicks: the shared chip look, a touch oversized so it reads.
  const pranks = createPrankRuntime(scene, camera, host, () => {
    const chipMaterials = getSharedChipMaterials()
    const edge = chipMaterials[4] ?? chipMaterials[0]!
    const face = chipMaterials[5] ?? chipMaterials[1]!
    const chip = new THREE.Mesh(getChipGeometry(), [edge, face, face])
    chip.name = 'prank-chip'
    chip.castShadow = true
    return chip
  })
  try {
    companion = createCompanion(scene)
  } catch (error) {
    console.warn('Lady Luck could not be created.', error)
  }
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  if (feltMaterial.map) {
    feltMaterial.map.anisotropy = Math.min(16, maxAnisotropy)
    feltMaterial.map.needsUpdate = true
  }

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  let postFx: PostFx | null = null
  try {
    postFx = createPostFx(renderer, scene, camera)
  } catch (error) {
    console.warn('Post effects unavailable; rendering directly.', error)
  }

  const runtime = {
    renderer,
    scene,
    camera,
    cameraLookAt,
    seats: new Map<string, SeatRuntime>(),
    wagers: new Map<string, WagerRuntime>(),
    pot,
    board,
    lights,
    postFx,
    frameBudget: new FrameBudget(0),
    neonMaterials,
    overlayElements: new Map<string, HTMLElement>(),
    companion,
    firstPersonDrink,
    pranks,
    effects,
    boardRevealAt: Number.NEGATIVE_INFINITY,
    anyWinner: false,
    chipInstancer: createChipInstancer(scene),
    debugCamera: null as SceneRuntime['debugCamera'],
    feltMaterial,
    startTime: performance.now(),
    animationFrame: 0,
    resizeObserver: null as unknown as ResizeObserver,
    disposed: false as boolean,
    suspended: document.hidden,
    reducedMotion: motionPreference.matches,
    pause: () => {},
    resume: () => {},
    dispose: () => {},
  } satisfies SceneRuntime

  // Blackout bonks, hangovers and the pill trip (see funFx.ts).
  const funFx = new FunFx({
    scene,
    camera,
    postFx,
    feltMaterial,
    lights: [lights.key, lights.fill, lights.rimLeft, lights.rimRight, lights.bounce, lights.front],
    chipMaterials: runtime.chipInstancer.meshes.flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])),
    companionGroup: companion?.group ?? null,
  })
  let lastTripFx = ''

  let viewportWidth = 1
  let viewportHeight = 1
  /** Adaptive render quality from the frame budget (see FrameBudget). */
  let quality: RenderQuality = 0
  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    viewportWidth = width
    viewportHeight = height
    const renderArea = width * height
    const pixelRatioCap = renderArea > 2_200_000 ? 1.15 : renderArea > 1_300_000 ? 1.35 : 1.5
    const pixelRatio = Math.max(0.75, Math.min(window.devicePixelRatio || 1, pixelRatioCap) * (quality >= 1 ? 0.85 : 1))
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    runtime.postFx?.setSize(width, height, pixelRatio)
    runtime.postFx?.setReducedBloom(quality >= 1)
    host.dataset.postFx = !runtime.postFx || quality >= 2 ? 'off' : quality === 1 ? 'reduced' : 'on'
    runtime.frameBudget.settle((performance.now() - runtime.startTime) / 1000, 1.5)
    camera.aspect = width / height
    // Narrow windows widen the lens so the far seats stay in view.
    camera.fov = camera.aspect < 1.28
      ? 66
      : camera.aspect < 1.5
        ? 61
        : camera.aspect > 2.15
          ? 50
          : DESKTOP_CAMERA_FRAMING.fov
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  runtime.resizeObserver = resizeObserver
  resize()

  let lastTime = (performance.now() - runtime.startTime) / 1000
  let lastShadowAt = Number.NEGATIVE_INFINITY
  let renderedFrames = 0
  const targetCamera = new THREE.Vector3()
  const targetLook = new THREE.Vector3()
  const winnerFocus = new THREE.Vector3()
  const actingFocus = new THREE.Vector3()
  const accentTarget = new THREE.Vector3()
  let heroHeadTilt = 0
  const animate = () => {
    if (runtime.disposed || runtime.suspended) return
    runtime.animationFrame = window.requestAnimationFrame(animate)
    const time = (performance.now() - runtime.startTime) / 1000
    const delta = Math.min(0.05, Math.max(0.001, time - lastTime))
    lastTime = time
    const reducedMotion = runtime.reducedMotion

    // Shadow casters move slowly (idle avatars, chips): a fixed 30Hz refresh
    // (20Hz once quality steps down) keeps them smooth for far fewer passes.
    if (time - lastShadowAt >= (quality === 0 ? 1 / 30 : 1 / 20) - 0.002) {
      renderer.shadowMap.needsUpdate = true
      lastShadowAt = time
    }
    const nextQuality = runtime.frameBudget.push(delta, time)
    if (nextQuality !== null && nextQuality !== quality) {
      quality = nextQuality
      resize()
    }

    const actingSeat = viewRef.current.actingVisualSeat
    funFx.reducedMotion = reducedMotion
    funFx.update(viewRef.current, runtime.seats, time)
    const { heat, sourceId } = getTableHeat(runtime, time)
    let winnerSeat: SeatRuntime | null = null
    for (const seat of runtime.seats.values()) {
      animateSeat(
        seat, time, delta, actingSeat, reducedMotion, seat.playerId === sourceId ? 0 : heat, runtime.seats,
        time - runtime.boardRevealAt, runtime.anyWinner,
        reducedMotion ? null : getSeatPrankInput(runtime.pranks, seat, time, runtime.seats)
      )
      if (seat.winner && seat.root.visible && !winnerSeat) winnerSeat = seat
    }
    funFx.afterSeats(viewRef.current, runtime.seats, time, delta)
    animateWagers(runtime, time, reducedMotion)
    animatePot(runtime, time, reducedMotion, host)
    animateBoardRuntime(runtime.board, time, reducedMotion)
    animateEffects(runtime, time, delta, reducedMotion)

    // Stage lighting reacts to the table: an ember swell on all-ins, a gold
    // pool over the winner, and a slow neon flicker in the background.
    const allInImpact = getAllInCameraImpact(runtime.seats.values(), time, reducedMotion)
    const accent = runtime.lights.accent
    if (winnerSeat) {
      // Pool of gold over and slightly behind the winner (pushed away from the
      // board) so it rims the player instead of flooding the felt and cards.
      winnerSeat.root.getWorldPosition(accentTarget)
      accentTarget.x *= 1.18
      accentTarget.z *= 1.18
      accentTarget.y += 2.9
      accent.color.set('#ffcf73')
    } else {
      accentTarget.set(0, 4.6, -0.4)
      accent.color.set('#ff7a3d')
    }
    accent.position.lerp(accentTarget, 1 - Math.exp(-delta * 4))
    const accentGoal = winnerSeat ? 8 : allInImpact.strength * 5
    accent.intensity += (accentGoal - accent.intensity) * (1 - Math.exp(-delta * 5))
    const flicker = reducedMotion ? 1 : 1 + Math.sin(time * 23) * 0.012
    runtime.neonMaterials.forEach(material => {
      material.emissiveIntensity = Number(material.userData.baseEmissive ?? 1) * flicker
    })

    // A living camera: a slow breathing drift, a subtle lean toward whoever is
    // acting, a punch-in on all-ins, and a push toward the showdown winner.
    // Nameplates are re-projected every frame, so they stay attached.
    targetCamera.copy(baseCameraPosition)
    targetLook.copy(baseCameraLookAt)
    if (viewRef.current.players.some(player => player.visualSeat === 0 && !player.isHero)) {
      // Full-table spectator: stand up behind the near player instead of sitting in their head.
      targetCamera.y += 1.35
      targetCamera.z += 1.2
      targetLook.y -= 0.2
    }
    if (!reducedMotion) {
      // Seated breathing: a gentle head sway rather than a floating camera.
      targetCamera.x += Math.sin(time * 0.13) * 0.07
      targetCamera.y += Math.sin(time * 0.09 + 1.2) * 0.035
      targetLook.x += Math.sin(time * 0.11 + 0.4) * 0.05
    }
    if (actingSeat !== null && actingSeat !== 0 && !winnerSeat) {
      // Glance toward whoever is acting, like turning your head at the table.
      const actingPosition = TABLE_SEAT_POSITIONS[toVisualSeat(actingSeat)]
      actingFocus.set(actingPosition[0] * 0.85, 1.05, actingPosition[2] * 0.85)
      targetLook.lerp(actingFocus, 0.34)
      // Neighbours sit almost beside the camera, so an unclamped glance swings
      // the board out of frame; keep the felt centre in view.
      targetLook.x = THREE.MathUtils.clamp(targetLook.x, -0.95, 0.95)
      targetCamera.x += actingPosition[0] * 0.04
    }
    if (winnerSeat) {
      winnerSeat.root.getWorldPosition(winnerFocus)
      targetLook.lerp(winnerFocus.setY(1.1), 0.22)
      targetCamera.x += winnerFocus.x * 0.04
      targetCamera.z -= 0.35
      targetCamera.y += 0.05
    }
    if (allInImpact.strength > 0) {
      const impactSeat = allInImpact.visualSeat === null
        ? null
        : TABLE_SEAT_POSITIONS[toVisualSeat(allInImpact.visualSeat)]
      const microShake = Math.sin(time * 61) * allInImpact.strength * 0.026
      targetCamera.x += microShake + (impactSeat?.[0] ?? 0) * allInImpact.strength * 0.018
      targetCamera.y -= allInImpact.strength * 0.06
      targetCamera.z -= allInImpact.strength * 0.3
      targetLook.x += (impactSeat?.[0] ?? 0) * allInImpact.strength * 0.035
      targetLook.z += (impactSeat?.[2] ?? 0) * allInImpact.strength * 0.025
    }
    const smoothing = reducedMotion ? 1 : 1 - Math.exp(
      -delta * (allInImpact.strength > 0 ? 3.8 : winnerSeat ? 1.1 : 1.35)
    )
    camera.position.lerp(targetCamera, smoothing)
    cameraLookAt.lerp(targetLook, smoothing)
    if (runtime.debugCamera) {
      camera.position.set(...runtime.debugCamera.position)
      cameraLookAt.set(...runtime.debugCamera.lookAt)
      if (runtime.debugCamera.fov && camera.fov !== runtime.debugCamera.fov) {
        camera.fov = runtime.debugCamera.fov
        camera.updateProjectionMatrix()
      }
    }
    camera.lookAt(cameraLookAt)
    const headTilt = updateHeroDrink(runtime, viewRef.current, time, reducedMotion)
    const heroProfile = viewRef.current.players.find(player => player.isHero)?.avatarProfile
    const kick = updatePranks(runtime.pranks, {
      time,
      delta,
      width: viewportWidth,
      height: viewportHeight,
      reducedMotion,
      seats: runtime.seats,
      heroColors: { skin: heroProfile?.skinColor ?? '#d9a27c', sleeve: heroProfile?.sleeveColor ?? '#2b2f3a' },
    })
    // Tip the head back with a sip or a shot, eased so a low frame rate never
    // turns it into a one-frame snap of the whole view.
    const tiltGoal = headTilt * 0.13 + kick.headTilt * 0.2
    heroHeadTilt += (tiltGoal - heroHeadTilt) * (reducedMotion ? 1 : 1 - Math.exp(-delta * 9))
    if (!runtime.debugCamera) {
      if (heroHeadTilt > 0.0005) camera.rotateX(heroHeadTilt)
      // Jolt on a slam or a chip to the face.
      if (kick.pitch || kick.yaw || kick.roll) {
        camera.rotateX(kick.pitch)
        camera.rotateY(kick.yaw)
        camera.rotateZ(kick.roll)
      }
    }
    if (!runtime.debugCamera) funFx.applyCamera(camera, time)
    camera.updateMatrixWorld()

    updateLadyLuck(runtime, viewRef.current, host, time, delta, reducedMotion, viewportWidth, viewportHeight)
    projectSeatOverlays(runtime, host, viewportWidth, viewportHeight)
    updateChipInstances(runtime.chipInstancer, scene)
    for (const seat of runtime.seats.values()) {
      if (seat.root.visible && seat.cards.visible) seat.holeCards.forEach(card => cullHiddenCardSide(card, camera.position))
    }
    runtime.board.slots.forEach(slot => cullHiddenCardSide(slot.card, camera.position))

    // Pill trip: shader pass when post FX runs, a CSS hue fallback otherwise.
    const tripFx = funFx.heroTripLevel > 0 ? (runtime.postFx && quality < 2 ? 'post' : 'css') : 'off'
    if (tripFx !== lastTripFx) {
      lastTripFx = tripFx
      host.dataset.tripFx = tripFx
    }
    if (runtime.postFx && quality < 2) {
      funFx.beforeRender(time, viewportWidth, viewportHeight)
      runtime.postFx.bloom.strength = 0.22 + (winnerSeat ? 0.1 : 0) + allInImpact.strength * 0.1
      runtime.postFx.composer.render(delta)
    } else {
      renderer.render(scene, camera)
    }
    renderedFrames += 1
    if (renderedFrames === 4) host.dataset.sceneReady = 'true'
  }

  runtime.pause = () => {
    if (runtime.disposed || runtime.suspended) return
    runtime.suspended = true
    window.cancelAnimationFrame(runtime.animationFrame)
    runtime.animationFrame = 0
  }

  runtime.resume = () => {
    if (runtime.disposed || !runtime.suspended || document.hidden) return
    runtime.suspended = false
    lastTime = (performance.now() - runtime.startTime) / 1000
    resize()
    renderer.resetState()
    animate()
  }

  const handleMotionPreference = (event: MediaQueryListEvent) => {
    runtime.reducedMotion = event.matches
  }
  const handleVisibilityChange = () => {
    if (document.hidden) runtime.pause()
    else runtime.resume()
  }
  motionPreference.addEventListener('change', handleMotionPreference)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  runtime.dispose = () => {
    if (runtime.disposed) return
    runtime.disposed = true
    window.cancelAnimationFrame(runtime.animationFrame)
    resizeObserver.disconnect()
    motionPreference.removeEventListener('change', handleMotionPreference)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    for (const seat of runtime.seats.values()) {
      seat.avatarGeneration += 1
      detachRiggedAvatar(seat)
      seat.holeCards.forEach(disposeCardMesh)
    }
    runtime.board.slots.forEach(slot => disposeCardMesh(slot.card))
    funFx.dispose()
    if (runtime.companion) disposeCompanion(runtime.companion)
    disposeFirstPersonDrink(runtime.firstPersonDrink)
    disposePrankRuntime(runtime.pranks)
    disposeLightCone(runtime.effects.cone)
    disposeConfetti(runtime.effects.confetti)
    disposeShockwave(runtime.effects.shockwave)
    runtime.postFx?.dispose()
    environment.dispose()
    disposeObject(scene)
    disposeSceneTextures()
    renderer.dispose()
  }

  syncPlayers(runtime, viewRef.current)
  syncWagers(runtime, viewRef.current)
  syncPot(runtime, viewRef.current)
  syncBoardRuntime(runtime.board, viewRef.current.communityCards, highlightRef.current, 0)
  precompileScene(renderer, scene, camera)
  renderer.render(scene, camera)
  if (!runtime.suspended) animate()
  return runtime
}

// Static, module-owned SVG strings (no user input): see popIcons.ts.
const SHOT_ICON_HTML = { __html: popIconSvg('shot') }
const BEER_ICON_HTML = { __html: popIconSvg('beer') }

const NO_HIGHLIGHTED_CARDS: ReadonlyArray<{ rank: string; suit: ThreeCardView['suit'] }> = []
const NO_PRANK_EVENTS: readonly PrankEvent[] = []
const NO_DRINK_EVENTS: readonly DrinkEvent[] = []

export function DesktopPokerRoom3D({
  view,
  emoteReactions,
  chatMessages,
  selectedTargetId,
  onSelectPlayer,
  cardRevealActions,
  onRequestCardReveal,
  prankEvents = NO_PRANK_EVENTS,
  drinkEvents = NO_DRINK_EVENTS,
  highlightedCards = NO_HIGHLIGHTED_CARDS,
}: DesktopPokerRoom3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const viewRef = useRef(view)
  const highlightRef = useRef(highlightedCards)
  const [webGLStatus, setWebGLStatus] = useState<WebGLStatus>('loading')

  viewRef.current = view
  highlightRef.current = highlightedCards

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let disposed = false
    let recoveryFrame = 0
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      if (!disposed) {
        runtimeRef.current?.pause()
        setWebGLStatus('error')
      }
    }
    const handleContextRestored = () => {
      window.cancelAnimationFrame(recoveryFrame)
      recoveryFrame = window.requestAnimationFrame(() => {
        if (disposed) return
        runtimeRef.current?.resume()
        setWebGLStatus('ready')
      })
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    canvas.addEventListener('webglcontextrestored', handleContextRestored)

    try {
      const runtime = createSceneRuntime(canvas, host, viewRef, highlightRef)
      runtimeRef.current = runtime
      if (process.env.NODE_ENV !== 'production') {
        // Development-only handle for inspecting the live scene from devtools.
        ;(host as HTMLDivElement & { __pokerRuntime?: SceneRuntime }).__pokerRuntime = runtime
        // Development-only: replay a prank locally (e.g. a house cheers) for visual checks.
        // Development-only: make a seat drink locally (animation review).
        ;(host as HTMLDivElement & { __playDrink?: (playerId: string, kind?: 'beer' | 'water') => void }).__playDrink = (playerId, kind = 'beer') => {
          const seat = runtime.seats.get(playerId)
          if (!seat) return
          seat.drinkStartedAt = (performance.now() - runtime.startTime) / 1000
          if (!seat.drinkProp || seat.drinkProp.kind !== kind) {
            disposeDrinkProp(seat.drinkProp)
            seat.drinkProp = createDrinkProp(kind)
            seat.root.parent?.add(seat.drinkProp.group)
          }
        }
        ;(host as HTMLDivElement & { __playPrank?: (event: PrankEvent) => void }).__playPrank = event => queuePrank(runtime.pranks, event, {
          time: (performance.now() - runtime.startTime) / 1000,
          reducedMotion: runtime.reducedMotion,
          seats: runtime.seats,
          heroActing: false,
        })
      }
      setWebGLStatus('ready')
    } catch (error) {
      console.error('Unable to start the desktop 3D poker room.', error)
      setWebGLStatus('error')
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(recoveryFrame)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      runtimeRef.current?.dispose()
      runtimeRef.current = null
    }
  }, [])

  // Pranks and house-rule drinks: each server event plays exactly once.
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const context = {
      time: (performance.now() - runtime.startTime) / 1000,
      reducedMotion: runtime.reducedMotion,
      seats: runtime.seats,
      heroActing: viewRef.current.players.some(player => player.isHero && player.isActing),
    }
    for (const event of prankEvents) queuePrank(runtime.pranks, event, context)
    for (const event of drinkEvents) {
      if (Date.now() - event.at > 6_000) continue
      if (event.kind === 'house_beer') {
        queueSeatPop(runtime.pranks, event.id, event.playerId, (event.amount ?? 1) >= 2 ? 'beer2' : 'beer', context)
      } else if (event.kind === 'house_water') {
        queueSeatPop(runtime.pranks, event.id, event.playerId, 'water', context)
      }
    }
  }, [prankEvents, drinkEvents])

  const seenGesturesRef = useRef(new Set<string>())
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const now = (performance.now() - runtime.startTime) / 1000
    for (const reaction of emoteReactions) {
      if (seenGesturesRef.current.has(reaction.id)) continue
      seenGesturesRef.current.add(reaction.id)
      if (!reaction.emote.includes('\u{1F595}') || !reaction.targeted) continue
      const sender = runtime.seats.get(reaction.senderId)
      if (sender) sender.flipOff = { startedAt: now, targetId: reaction.targetId }
    }
  }, [emoteReactions])

  useEffect(() => {
    if (!runtimeRef.current) return
    syncPlayers(runtimeRef.current, view)
    syncWagers(runtimeRef.current, view)
    syncPot(runtimeRef.current, view)
    const runtimeNow = (performance.now() - runtimeRef.current.startTime) / 1000
    if (view.communityCards.length > runtimeRef.current.board.visibleCount) runtimeRef.current.boardRevealAt = runtimeNow
    runtimeRef.current.anyWinner = view.players.some(player => player.isWinner)
    syncBoardRuntime(
      runtimeRef.current.board,
      view.communityCards,
      highlightedCards,
      (performance.now() - runtimeRef.current.startTime) / 1000
    )
    // New seats, avatars and accessories arrive with every sync.
    for (const seat of runtimeRef.current.seats.values()) {
      mergeAccessoryMeshes(seat.fallbackAccessories)
      mergeAccessoryMeshes(seat.riggedAccessories)
      pruneShadowCasters(seat.root)
    }
  }, [view, highlightedCards])

  return (
    <div
      ref={hostRef}
      className="desktop-3d-stage"
      data-phase={view.phase}
      data-renderer="three-webgl"
      data-webgl-status={webGLStatus}
      data-all-in-action-key={view.allInAnnouncement?.actionKey ?? ''}
      data-table-wager-count={view.phase === 'in_hand'
        ? view.players.filter(player => player.bet > 0).length
        : 0}
      data-table-wager-total={view.phase === 'in_hand'
        ? view.players.reduce((sum, player) => sum + player.bet, 0)
        : 0}
      data-pot-amount={view.pot}
      data-collected-pot-amount={view.collectedPot}
      data-rigged-avatar-targets={view.players.filter(player => !player.isHero).length}
      data-winner-count={view.players.filter(player => player.isWinner).length}
      data-winner-ids={view.players.filter(player => player.isWinner).map(player => player.id).join(',')}
    >
      <canvas
        ref={canvasRef}
        className="desktop-3d-canvas"
        aria-label="Animated 3D poker room"
      />
      {/* Blackout eyelids, hangover edges and trip washes: above the canvas, below every HUD layer. */}
      <div className="fun-vision-3d" aria-hidden="true">
        <span className="fun-lid is-top" />
        <span className="fun-lid is-bottom" />
      </div>

      <div className="lady-luck-bubble-3d" data-visible="false" aria-live="polite" />
      {/* Counts the pot down while its chips fly to the winner (driven by animatePot). */}
      <div className="payout-pot-readout" data-visible="false" aria-hidden="true">
        <span>Pot</span>
        <b />
      </div>

      {webGLStatus === 'loading' && (
        <div className="three-webgl-status" role="status">Warming up the 3D table…</div>
      )}
      {webGLStatus === 'error' && (
        <div className="three-webgl-status is-error" role="alert">
          The 3D table was interrupted. Restoring automatically; reload if this message stays.
        </div>
      )}
      <div className="cinematic-seats" aria-label="Poker players">
        {view.players.map(player => {
          const reaction = emoteReactions.find(item => item.targetId === player.id)
          const chatMessage = chatMessages.find(item => item.targetId === player.id)
          const statusLabel = getStatusLabel(player)
          const cardRevealAction = cardRevealActions.find(action => action.playerId === player.id)

          return (
            <div
              key={player.id}
              data-seat-player={player.id}
              className={`cinematic-seat cinematic-seat-${player.visualSeat} ${player.isHero ? 'is-local-player' : ''} ${player.isActing ? 'is-acting' : ''} ${player.isWinner ? 'is-winner' : ''} ${player.isOutOfHand ? 'is-folded' : ''} ${selectedTargetId === player.id ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="cinematic-seat-target"
                onClick={() => onSelectPlayer(player.id)}
                aria-label={`Send a reaction to ${player.nickname}`}
              >
                {(chatMessage || reaction) && (
                <span className="cinematic-seat-social" aria-live="polite">
                  {chatMessage && (
                    <span
                      className="cinematic-seat-message"
                      data-targeted={chatMessage.targeted ? 'true' : 'false'}
                    >
                      {chatMessage.message}
                    </span>
                  )}
                  {reaction && (
                    <span
                      className="cinematic-seat-reaction"
                      data-targeted={reaction.targeted ? 'true' : 'false'}
                      aria-hidden="true"
                    >
                      {reaction.targeted && (
                        <span className="cinematic-seat-reaction-from">
                          {view.players.find(sender => sender.id === reaction.senderId)?.nickname ?? 'Someone'} →
                        </span>
                      )}
                      <EmojiGlyph emoji={reaction.emote} />
                    </span>
                  )}
                </span>
                )}

                <span className="cinematic-avatar" aria-hidden="true">
                <span
                  className="cinematic-avatar-head"
                  style={{ backgroundColor: player.avatarProfile.skinColor }}
                />
                <span
                  className="cinematic-avatar-body"
                  style={{ backgroundColor: player.avatarProfile.shirtColor }}
                />
                </span>

                {player.hasCards && (
                  !player.isOutOfHand || player.visibleCards.length > 0 || cardRevealAction
                ) && !player.isHero && (
                  <CinematicHoleCards player={player} />
                )}

                <span className="cinematic-seat-panel">
                <span className="cinematic-seat-topline">
                  <strong>{player.nickname}</strong>
                  {player.shotsWaiting > 0 && (
                    // A shot is lined up for them, poured once they're out of the hand.
                    <em className="cinematic-shot-waiting" aria-label="Shot waiting" title="Shot waiting">
                      <i className="plate-icon" aria-hidden="true" dangerouslySetInnerHTML={SHOT_ICON_HTML} />
                    </em>
                  )}
                  {player.drinks?.passedOut ? (
                    <em className="cinematic-drink-badge is-passed-out" aria-label="Blacked out">💤</em>
                  ) : player.drinks?.tripping ? (
                    <em className="cinematic-drink-badge is-tripping" aria-label="Tripping">💊</em>
                  ) : player.drinks?.hungover ? (
                    <em className="cinematic-drink-badge is-hungover" aria-label="Hungover">🤕</em>
                  ) : player.drinks?.designatedDriver ? (
                    <em className="cinematic-drink-badge is-dd" aria-label="Sober: designated driver" title="Designated driver">🚗 DD</em>
                  ) : Math.round(player.drinks?.level ?? 0) > 0 ? (
                    <em className="cinematic-drink-badge" aria-label={`Buzz ${Math.round(player.drinks.level)}`}>
                      <i className="plate-icon" aria-hidden="true" dangerouslySetInnerHTML={BEER_ICON_HTML} />
                      {Math.round(player.drinks.level)}
                    </em>
                  ) : null}
                  {(player.drinks?.soberTax ?? 0) > 0 && (
                    <em className="cinematic-sober-tax" aria-label={`Sober tax $${player.drinks.soberTax}`} title="Sober tax">
                      💸 −${player.drinks.soberTax?.toLocaleString()}
                    </em>
                  )}

                  {player.blindRole && (
                    <em className={`cinematic-blind-role is-${player.blindRole}`}>
                      <b>{player.blindRole === 'big' ? 'BB' : 'SB'}</b>
                      <span>{player.blindRole === 'big' ? 'Big Blind' : 'Small Blind'}</span>
                    </em>
                  )}
                </span>
                <span className="cinematic-seat-meta">
                  <b>${player.stack.toLocaleString()}</b>
                  {player.isWinner ? (
                    <small
                      className="cinematic-winner-label"
                      aria-label={player.winnerHandDescription
                        ? `Hand winner, ${player.winnerHandDescription}`
                        : 'Hand winner'}
                    >
                      {player.winnerHandDescription ?? 'Winner'}
                    </small>
                  ) : statusLabel ? (
                    <small>{statusLabel}</small>
                  ) : null}
                </span>
                </span>

                {player.bet > 0 && (
                  <span className="cinematic-seat-bet">${player.bet.toLocaleString()}</span>
                )}
              </button>

              {cardRevealAction && (
                <button
                  type="button"
                  className={`card-reveal-seat-button cinematic-card-reveal-control${cardRevealAction.status ? ` is-${cardRevealAction.status}` : ''}`}
                  disabled={cardRevealAction.disabled}
                  onClick={() => onRequestCardReveal(player.id)}
                  aria-label={cardRevealAction.ariaLabel}
                  title={cardRevealAction.ariaLabel}
                >
                  {cardRevealAction.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
