'use client'

import { memo, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
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
import { getArmChain, solveArmIK } from './avatarIK'
import { updateAvatarHands } from './avatarHands'
import { solveAvatarArms, type ArmSolveContext } from './avatarBodyArms'
import { updateHatSecondary } from './avatarBodySecondary'
import { applyBlink, getBlinkAmount, stylizeAvatar, type StylizedAvatar } from './avatarStyle'
import { disposeStickyNoteFx, syncStickyNoteFx, type StickyNoteFx } from './stickyNote'
import { createAvatarFace, disposeAvatarFace, updateAvatarFace, type AvatarFaceRig } from './avatarFace'
import { buildFaceInput, setFaceViewer, triggerFaceEmote } from './avatarFaceDirector'
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
  fadeOutConfetti,
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
import { PERSONAL_STACK_MAX_CHIPS, PersonalChipStack, StackSparkles } from './personalChipStack'
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
  DEAL_DECK_POINT,
  DEAL_LAUNCH_SECONDS,
  disposeCardMesh,
  applySuitColorMode,
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
  type SuitColorMode,
} from './sceneTextures'
import {
  createDecoCarpetTexture,
  createLoungeBackBar,
  createSconceShadeMaterial,
  createRoomDressing,
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
  BOARD_CARD_DEPTH,
  BOARD_CARD_TILT,
  BOARD_CARD_WIDTH,
  BOARD_XS,
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
import { createBeveledChipGeometry, createContactShadowMaterial, getContactShadowStrength } from './tableChipGeometry'
import {
  getTableWagerAnchor,
  getTableWagerStartPoint,
  getWagerChipCount,
  getWagerChipLayout,
  interpolateWagerArc,
  MAX_WAGER_CHIPS,
  TABLE_POT_POSITION,
  TABLE_SEAT_POSITIONS,
  TABLE_SEAT_SCALES,
  TABLE_WAGER_Y,
  type TableVisualSeat,
} from './tableWagerLayout'
import { getAvatarHeadTurn } from './turnFocus'
import { FunFx, type FunPoseInput } from './funFx'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'
import { StickyNoteChip } from '@/components/table/StickyNoteChip'
import { OddsPill } from '@/components/table/HandOdds'

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
  /** The acting opponent's clock (0-100), drained on their nameplate. */
  actingTimerPercent?: number
  /** Settings: classic two-color deck or four-color suits (applies to every 3D card). */
  suitColorMode?: SuitColorMode
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
  /** Lays out and animates the personal stack (short stack to chip tower). */
  stackFx: PersonalChipStack
  stackCount: number
  lastStackAmount: number
  /** How far the chair and body slide in toward the rail (seat-local Z). */
  seatShiftZ: number
  anchors: AvatarAnchors
  anchorsFromRig: boolean
  avatarStyle: StylizedAvatar | null
  face: AvatarFaceRig | null
  /** Sticky note text the server says is on this player's forehead ('' = none), and its 3D note. */
  stickyText: string
  sticky: StickyNoteFx | null
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
  /** Hand number the current hole cards were dealt in (a new hand re-deals). */
  dealtHand?: number
  /** Per-card launch delays for the current deal (clockwise, one card a round). */
  dealDelays?: [number, number]
  /** Showdown flip per card: when it started and which way it is heading. */
  flipAnim?: Array<{ from: number; to: number; startedAt: number }>
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
  /** Faces the columns along the betting line (same yaw as the owner's seat). */
  yaw: number
  /** Chip count the columns are currently laid out for. */
  layoutCount: number
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
  /** Chip count the mound grows to once the swept-in bets land (and when). */
  pendingCount?: number
  pendingGrowAt?: number
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
  /** Glints on personal stacks as chips land (one draw for the whole table). */
  stackSparkles: StackSparkles
  /** Development-only camera override used by scripts/snap-3d.mjs close-ups. */
  debugCamera: { position: Vec3; lookAt: Vec3; fov?: number } | null
  feltMaterial: THREE.MeshStandardMaterial
  startTime: number
  animationFrame: number
  /** performance.now() of the last frame the loop finished (black-screen watchdog heartbeat). */
  lastFrameAt: number
  resizeObserver: ResizeObserver
  disposed: boolean
  suspended: boolean
  reducedMotion: boolean
  pause: () => void
  resume: () => void
  dispose: () => void
  /** Set by the component: the scene is unusable (black output) and must be rebuilt. */
  onBroken?: () => void
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
    createSconceShadeMaterial(),
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
    // Lifted a little and slightly glossier so the carpet catches the warm pool.
    color: new THREE.Color(1.35, 1.3, 1.25),
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.32,
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
  createRoomDressing(scene, brassMaterial)

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
  // Close enough to the chest that the bet/call/all-in hands actually land on it
  // (the hands aim between the front columns of the stack's block, see
  // personalChipStack.ts). The hero has no body to reach with, so their stack
  // sits further right, clear of the pot and board in the first-person view.
  // Opponents' block clears their own (slightly splayed) right hole card and
  // the neighbour's cards; the gap differs per seat around the curve.
  const STACK_SIDE = seat.isHero ? HERO_STACK_SIDE : OPPONENT_STACK_SIDES[safeSeat]
  const stackSpot = at(-0.1, FELT_TOP_Y)
  seat.anchors.stack = [(STACK_SIDE + 0.07) / scale, stackSpot[1] + 0.06, stackSpot[2]]
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
  // Cards are dealt from the dealer's deck (in the cards group's space).
  const dealFrom = toSeatLocal(seat, DEAL_DECK_POINT.x, DEAL_DECK_POINT.y, DEAL_DECK_POINT.z)
  seat.cards.userData.dealFrom = [dealFrom[0], dealFrom[1] - cardSpot[1], dealFrom[2] - cardSpot[2]]
  seat.anchors.drinkRest = [-0.66 / scale, stackSpot[1] + 0.02, stackSpot[2] + 0.08]
  // Dealer puck lies on open felt just in front (and a touch right) of the
  // dealer's hole cards: clear of the rail, the drink spot, every stack (side
  // seats sit only ~1.35 apart, so beside the cards is taken) and the betting
  // line. Folded cards land front-left, away from it.
  seat.dealerButton.position.set(0.34, cardSpot[1] + DEALER_PUCK_HEIGHT / 2 - 0.008, cardSpot[2] - 0.6)
  // Keep the D upright for the hero at the near edge whichever seat holds the button.
  seat.dealerButton.rotation.y = -seat.root.rotation.y + DEALER_PUCK_YAW
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
  // Headroom over the visible cap so chips can leave while others drop in.
  const personalStack = createChipSet(PERSONAL_STACK_MAX_CHIPS + 12)
  personalStack.group.name = `personal-stack-${player.id}`
  const personalStackFx = new PersonalChipStack(
    personalStack.chipMeshes,
    CHIP_HEIGHT + 0.002,
    CHIP_HEIGHT,
    Array.from(player.id).reduce((sum, char) => sum + char.charCodeAt(0), 1)
  )
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
    const card = createCardMesh(HOLE_CARD_WIDTH)
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

  // Dark edge band with a faint warm glow so the puck reads at any seat, even
  // in the rail's shadow; ivory face (not paper white) under the key light.
  const dealerMaterial = new THREE.MeshStandardMaterial({
    color: '#23262c',
    roughness: 0.45,
    metalness: 0.2,
    emissive: '#d9a441',
    emissiveIntensity: 0.16,
  })
  const dealerFace = new THREE.MeshStandardMaterial({
    map: getDealerPuckTexture(),
    roughness: 0.55,
    emissive: '#fff1d6',
    emissiveIntensity: 0.06,
  })
  materials.push(dealerMaterial, dealerFace)
  const dealerButton = addMesh(
    root,
    new THREE.CylinderGeometry(DEALER_PUCK_RADIUS, DEALER_PUCK_RADIUS * 1.04, DEALER_PUCK_HEIGHT, 40),
    [dealerMaterial, dealerFace, dealerMaterial],
    [-0.7, 0.5, -1.4]
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
    stackFx: personalStackFx,
    stackCount: 0,
    lastStackAmount: 0,
    seatShiftZ: 0,
    anchors: createDefaultAnchors(),
    anchorsFromRig: false,
    avatarStyle: null,
    face: null,
    stickyText: '',
    sticky: null,
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

  if (seat.sticky) disposeStickyNoteFx(seat.sticky)
  seat.sticky = null
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
    seat.face = createAvatarFace(avatar.model, avatar.bones.get('Head'), style.materials, style.skinColor, seat.avatarProfile.glasses, seat.animator.seed, seat.avatarProfile)
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
    precompileScene(runtime.renderer, runtime.scene, runtime.camera, runtime.postFx)
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

/** Hole cards: each card's flight, the stagger between seats and the flip. */
const DEAL_STEP_SECONDS = 0.05
const DEAL_FLIGHT_SECONDS = 0.36
const SHOWDOWN_FLIP_SECONDS = 0.35

/** Seats in dealing order: clockwise, starting left of the button. */
function getDealOrder(players: readonly ThreePlayerView[]) {
  const dealer = players.find(player => player.isDealer)?.visualSeat ?? -1
  const dealt = players
    .filter(player => player.hasCards)
    .map(player => ({ id: player.id, rank: (player.visualSeat - dealer - 1 + 16) % 8 }))
    .sort((left, right) => left.rank - right.rank)
  return new Map(dealt.map((entry, index) => [entry.id, index]))
}

interface SeatDealInfo {
  handNumber?: number
  /** This seat's place in the dealing order and how many seats are dealt in. */
  order: number
  count: number
}

function syncSeat(seat: SeatRuntime, player: ThreePlayerView, now: number, deal: SeatDealInfo = { order: 0, count: 1 }) {
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

  // A fresh deal: first cards, or a new hand while last hand's cards are still
  // on the felt (they used to just flip face-down in place).
  const newHand = deal.handNumber !== undefined && seat.dealtHand !== undefined && seat.dealtHand !== deal.handNumber
  if (player.hasCards && (!seat.hadCards || newHand)) {
    seat.dealStartedAt = now
    // One card per seat per round, clockwise from the button.
    seat.dealDelays = [
      deal.order * DEAL_STEP_SECONDS,
      (deal.order + deal.count) * DEAL_STEP_SECONDS,
    ]
    // The new cards arrive face down; never flip the old faces in place.
    seat.flipAnim = undefined
    seat.cardMeshes.forEach(card => { card.userData.flip = Math.PI })
  }
  if (player.hasCards && deal.handNumber !== undefined) seat.dealtHand = deal.handNumber
  seat.hadCards = player.hasCards
  seat.peeking = Boolean(player.isPeeking)
  seat.stickyText = player.stickyNote?.text ?? ''
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
  const dealOrder = getDealOrder(view.players)
  const displayPlayers = withDistinctOutfits(view.players)
  for (const player of displayPlayers) {
    let seat = runtime.seats.get(player.id)
    if (!seat) {
      seat = createSeatRuntime(player, now)
      runtime.seats.set(player.id, seat)
      runtime.scene.add(seat.root)
      runtime.scene.add(seat.stack.group)
    }
    syncSeat(seat, player, now, {
      handNumber: view.handNumber,
      order: dealOrder.get(player.id) ?? 0,
      count: Math.max(1, dealOrder.size),
    })
    // Personal chip stack: sized against the starting stack, from one short
    // column up to a chip tower. Winnings drop in once the payout has landed.
    const startingStack = view.startingStack > 0 ? view.startingStack : Math.max(1, view.bigBlind) * 100
    const grew = player.stack > seat.lastStackAmount
    // Winnings start stacking as the first payout chips land (the stack update
    // can arrive a beat after the payout started).
    const landing = POT_PAYOUT_STAGGER_SECONDS * 0.4 + CHIP_FLIGHT_SECONDS
    const paying = runtime.pot.payoutKey.split(',').includes(player.id)
    const delay = !grew ? 0 : paying
      ? Math.max(0, runtime.pot.payoutStartedAt + landing - now)
      : player.isWinner ? landing : 0
    seat.stackFx.sync(player.stack, startingStack, now, {
      delay,
      // The hero's own stack sits just below the camera: keep it low.
      maxLevels: player.isHero ? HERO_STACK_MAX_LEVELS : undefined,
      reducedMotion: runtime.reducedMotion,
    })
    seat.lastStackAmount = player.stack
    seat.stackCount = seat.stackFx.count
    seat.stack.group.visible = true
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
/** Tallest column the hero's own stack may build (it sits under the camera). */
const HERO_STACK_MAX_LEVELS = 14
/** How far right of the hero's chair their own stack sits. */
const HERO_STACK_SIDE = 0.95
/**
 * Opponents' stack offset (right of the chair) per visual seat. Each seat's
 * stack sits between its own right hole card and the next seat's cards; seat 2
 * (right toward seat 1, where the table curves hardest) has the least room.
 */
const OPPONENT_STACK_SIDES: Record<TableVisualSeat, number> = {
  0: HERO_STACK_SIDE,
  1: 0.66,
  2: 0.55,
  3: 0.58,
  4: 0.6,
  5: 0.64,
  6: 0.66,
  7: 0.66,
}
/** Opponents' hole cards: closer to the board cards' size so they don't read as toys. */
const HOLE_CARD_WIDTH = 0.48
const DEALER_PUCK_RADIUS = 0.2
const DEALER_PUCK_HEIGHT = 0.07
/** Yaw that puts the cap's D upright as seen from the hero's seat. */
const DEALER_PUCK_YAW = Math.PI / 2
let sharedChipGeometry: THREE.BufferGeometry | null = null

function getChipGeometry() {
  // One shared cylinder: the side group takes the edge-spot band and both caps
  // take the printed face, so each chip is a single draw with no detail mesh.
  sharedChipGeometry ??= createBeveledChipGeometry(CHIP_RADIUS, CHIP_HEIGHT, 48)
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

/**
 * Chips sit right under the key spot: their light is soft-clipped above a knee
 * (like the cards' clamp, but gentler so the clay keeps its sheen) so ivory
 * inlays and edge spots never blow out to white or feed the bloom. The gold
 * "just won" flash rides on the instance tint and raises the ceiling with it.
 */
function softClipChipLighting(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
        float chipKnee = 0.62;
        #if defined( USE_INSTANCING_COLOR )
          chipKnee += max(vColor.r - 1.0, 0.0) * 1.6;
        #endif
        float chipLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
        if (chipLuma > chipKnee) {
          float over = chipLuma - chipKnee;
          float compressed = chipKnee + over / (1.0 + over * 3.0);
          outgoingLight *= compressed / chipLuma;
        }
      }
      #include <opaque_fragment>`
    )
  }
  material.customProgramCacheKey = () => 'poker-chip-soft-clip'
  return material
}

function getSharedChipMaterials() {
  sharedChipMaterials ??= CHIP_DENOMINATIONS.flatMap((_, index) => [
    softClipChipLighting(new THREE.MeshStandardMaterial({
      map: getChipEdgeTexture(index),
      roughness: 0.48,
      metalness: 0.02,
      envMapIntensity: 0.55,
    })),
    softClipChipLighting(new THREE.MeshStandardMaterial({
      map: getChipFaceTexture(index),
      roughness: 0.52,
      metalness: 0.02,
      envMapIntensity: 0.5,
    })),
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
    // Per-chip tint (white = as printed): lets freshly won chips flash gold.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHIP_INSTANCE_CAPACITY * 3).fill(1), 3)
    mesh.count = 0
    scene.add(mesh)
    return mesh
  })
  const contactGeometry = new THREE.PlaneGeometry(CHIP_RADIUS * 3.1, CHIP_RADIUS * 3.1)
  contactGeometry.rotateX(-Math.PI / 2)
  const contact = new THREE.InstancedMesh(
    contactGeometry,
    createContactShadowMaterial(getContactShadowTexture()),
    CHIP_INSTANCE_CAPACITY
  )
  // Red channel = shadow strength, faded out as a column lifts off the felt.
  contact.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHIP_INSTANCE_CAPACITY * 3).fill(1), 3)
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
    const slot = counts[denomination]!
    mesh.setMatrixAt(slot, chip.matrixWorld)
    const tint = mesh.instanceColor?.array as Float32Array | undefined
    if (tint) {
      // Glow (0..1) pushes the chip toward a bright gold that the bloom picks up.
      const glow = Number(chip.userData.glow ?? 0)
      tint[slot * 3] = 1 + glow * 0.8
      tint[slot * 3 + 1] = 1 + glow * 0.58
      tint[slot * 3 + 2] = 1 + glow * 0.08
    }
    counts[denomination]! += 1
    // The bottom chip of each column grounds it with a soft blob on the felt
    // (fades out as the chip lifts off during a toss).
    if (chip.userData.level === 0 && contactCount < CHIP_INSTANCE_CAPACITY) {
      contactPosition.setFromMatrixPosition(chip.matrixWorld)
      const lift = contactPosition.y - FELT_TOP_Y - CHIP_HEIGHT / 2
      if (lift < 0.35) {
        const scale = 1 + Math.max(0, lift) * 3
        contactMatrix.makeScale(scale, 1, scale)
        contactMatrix.setPosition(contactPosition.x, FELT_TOP_Y + 0.0025, contactPosition.z)
        instancer.contact.setMatrixAt(contactCount, contactMatrix)
        if (instancer.contact.instanceColor) (instancer.contact.instanceColor.array as Float32Array)[contactCount * 3] = getContactShadowStrength(lift)
        contactCount += 1
      }
    }
  }
  instancer.contact.count = contactCount
  instancer.contact.instanceMatrix.needsUpdate = true
  if (instancer.contact.instanceColor) instancer.contact.instanceColor.needsUpdate = true
  instancer.meshes.forEach((mesh, index) => {
    mesh.count = counts[index]!
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
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

const leaderStacks: SeatRuntime[] = []

/**
 * Personal stacks: drop-in growth, shrinking bets, and a gold glint loop on
 * the chip leader's stack (only when they are clearly ahead of the table).
 */
function animatePersonalStacks(runtime: SceneRuntime, time: number, delta: number, reducedMotion: boolean) {
  leaderStacks.length = 0
  let best = 0
  let runnerUp = 0
  for (const seat of runtime.seats.values()) {
    const amount = seat.lastStackAmount
    if (amount > best) {
      runnerUp = best
      best = amount
      leaderStacks.length = 0
      leaderStacks.push(seat)
    } else if (amount > runnerUp) {
      runnerUp = amount
    }
  }
  const leader = leaderStacks[0]
  const clearLeader = leader && runtime.seats.size > 1 && best > runnerUp * 1.15 && (leader.stackFx.layout.ratio >= 1.25)
  for (const seat of runtime.seats.values()) {
    seat.stackFx.setLeader(Boolean(clearLeader && seat === leader), time)
    seat.stackFx.update(time, delta, reducedMotion, seat.stack.group, runtime.stackSparkles)
  }
  runtime.stackSparkles.update(time)
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
  const chips = createChipSet(MAX_WAGER_CHIPS, 'stack')
  const visualSeat = toVisualSeat(player.visualSeat)
  const start = toVector3(getTableWagerStartPoint(visualSeat))
  const target = toVector3(getTableWagerAnchor(visualSeat))
  chips.group.name = `committed-wager-${player.id}`
  chips.group.position.copy(target)
  const yaw = Math.atan2(target.x, target.z)
  chips.group.rotation.set(0, yaw, 0)
  scene.add(chips.group)

  return {
    yaw,
    layoutCount: -1,
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
      // Starts empty so the first bet (usually a blind) slides in too.
      wager.amount = 0
      runtime.wagers.set(player.id, wager)
    }

    const visualSeat = toVisualSeat(player.visualSeat)
    const seatChanged = wager.visualSeat !== visualSeat
    const actionChanged = Boolean(player.actionKey) && wager.actionKey !== player.actionKey
    // A hand won by everyone folding ends with the last street's bets still on
    // the players (the engine only zeroes them when the next hand is prepared).
    // Those chips are off the table the moment the hand is over: sweep them to
    // the winner now, instead of hiding them and then replaying a stale sweep
    // into the pot when the next hand zeroes the bets.
    const bet = view.phase === 'in_hand' ? player.bet : 0
    const amountIncreased = bet > wager.amount
    let blindPost = false
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
    wager.yaw = Math.atan2(wager.target.x, wager.target.z)

    if (seatChanged) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (amountIncreased && (wager.amount === 0 || (actionChanged && isWagerAction(player.actionCue)))) {
      // The street's first chips (blinds included) always slide out; later
      // raises animate on their action. Give the hand ~0.25s to reach the
      // stack first (a posted blind has no reach, so it goes almost at once).
      blindPost = !isWagerAction(player.actionCue)
      wager.startedAt = now + (blindPost ? 0.05 : 0.25)
      wager.animating = true
      wager.group.position.copy(wager.start)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (!wager.animating) {
      wager.group.position.copy(wager.target)
    }

    if (wager.amount > 0 && bet === 0) {
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
    wager.amount = bet
    wager.actionKey = player.actionKey
    if (actionChanged) {
      wager.motionProfile = getPokerActionMotionProfile(player.actionCue, {
        actionKey: player.actionKey,
        playerId: player.id,
        wagerIntensity: player.wagerIntensity,
      })
    }
    // A posted blind is a calm push, never a flick.
    if (blindPost) wager.motionProfile = { ...wager.motionProfile, wagerStyle: 'slide', wagerIntensity: 0 }
    const collecting = now - wager.collectStartedAt < WAGER_COLLECT_SECONDS
    const chipCount = collecting
      ? wager.collectCount
      : getWagerChipCount(bet, view.bigBlind, wager.chipMeshes.length)
    if (chipCount > 0 && chipCount !== wager.layoutCount) {
      layoutWagerChips(wager, chipCount)
      if (!wager.animating && !collecting) resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    }
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

/** When the chips currently being swept off the betting line land (-inf if none). */
function getWagerCollectEndsAt(runtime: SceneRuntime, now: number, potOnly = false) {
  let endsAt = Number.NEGATIVE_INFINITY
  for (const wager of runtime.wagers.values()) {
    if (potOnly && wager.collectDest) continue
    const end = wager.collectStartedAt + WAGER_COLLECT_SECONDS
    if (end > now) endsAt = Math.max(endsAt, end)
  }
  return endsAt
}

function animateWagers(runtime: SceneRuntime, time: number, reducedMotion: boolean) {
  for (const wager of runtime.wagers.values()) {
    const collectProgress = (time - wager.collectStartedAt) / WAGER_COLLECT_SECONDS
    if (collectProgress >= 0 && collectProgress < 1 && !reducedMotion) {
      const potPosition = wager.collectDest ?? runtime.pot.group.position
      const position = interpolateWagerArc(
        [wager.target.x, wager.target.y, wager.target.z],
        [potPosition.x, potPosition.y, potPosition.z],
        collectProgress,
        // High enough to clear the propped board cards when sweeping across the felt.
        0.95
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
      wager.group.rotation.set(0, wager.yaw, 0)
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
    wager.group.rotation.set(0, wager.yaw, 0)
    // Chip offsets are computed in world space; the columns' group is turned
    // to face along the betting line, so rotate each offset into it.
    const yawCos = Math.cos(wager.yaw)
    const yawSin = Math.sin(wager.yaw)

    // The stagger spans the chips actually thrown (a big bet's pile lands in
    // the same time as a blind, just in a denser stream).
    const thrown = Math.max(1, Math.min(wager.chipMeshes.length, wager.layoutCount))
    const baseStagger = wagerStyle === 'flick'
      ? 0.038 + wagerIntensity * 0.008
      : wagerStyle === 'shove'
        ? 0.009
        : 0.015
    const staggerStep = baseStagger * Math.min(1, 11 / Math.max(1, thrown - 1))
    const progressBoost = 1 + staggerStep * Math.max(0, thrown - 1)
    wager.chipMeshes.forEach((chip, index) => {
      const base = wager.chipBasePositions[index]
      if (!base) return
      if (index >= thrown) return
      const orderedIndex = variant === 1
        ? (index * 5) % thrown
        : variant === 2
          ? thrown - index - 1
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
      const offsetX = chipWorld[0] - position[0]
      const offsetZ = chipWorld[2] - position[2]
      chip.position.set(
        base.x + offsetX * yawCos - offsetZ * yawSin,
        base.y + chipWorld[1] - position[1] + landingBounce,
        base.z + offsetX * yawSin + offsetZ * yawCos
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
      wager.group.rotation.set(0, wager.yaw, 0)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    }
  }
}

/** Lays a wager's chips out as columns along the betting line (see getWagerChipLayout). */
function layoutWagerChips(wager: WagerRuntime, count: number) {
  wager.layoutCount = count
  const slots = getWagerChipLayout(count, CHIP_RADIUS * 2 + 0.014)
  slots.forEach((slot, index) => {
    const chip = wager.chipMeshes[index]
    const base = wager.chipBasePositions[index]
    if (!chip || !base) return
    // A millimetre of hand-stacked slop per chip, fixed so it never shimmers.
    const jitter = ((index * 37) % 11) / 11 - 0.5
    base.set(
      slot.x + jitter * 0.005,
      CHIP_HEIGHT / 2 + slot.level * (CHIP_HEIGHT + 0.002),
      slot.z - jitter * 0.004
    )
    chip.userData.denomination = slot.denomination
    chip.userData.level = slot.level
  })
}

/**
 * Pot mound column spots (x, z, levels): a low, wide pile rather than a tower,
 * so it never rises into the board from the seated camera. Filled in order,
 * so a small pot is one neat stack that spreads out as it grows.
 */
const POT_MOUND_COLUMNS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const columns: Array<readonly [number, number, number]> = [[0, 0, 4]]
  const ring = [0.3, 1.35, 2.4, 3.45, 4.5, 5.55]
  ring.forEach(angle => columns.push([Math.cos(angle) * 0.3, Math.sin(angle) * 0.25, 3]))
  // Outer spill on the side away from the board and the hero's bet.
  for (const angle of [3.0, 3.75, 2.25, 4.5]) columns.push([Math.cos(angle) * 0.56, Math.sin(angle) * 0.44, 2])
  return columns
})()

function createPotRuntime(scene: THREE.Scene): PotRuntime {
  const pot = createChipSet(MAX_WAGER_CHIPS)
  pot.group.name = 'table-pot-chip-mound'
  pot.group.position.set(...TABLE_POT_POSITION)
  pot.group.position.y = FELT_TOP_Y
  let chipIndex = 0
  POT_MOUND_COLUMNS.forEach(([x, z, levels], column) => {
    for (let level = 0; level < levels && chipIndex < pot.chipMeshes.length; level += 1) {
      const chip = pot.chipMeshes[chipIndex]!
      const jitter = ((chipIndex * 53) % 13) / 13 - 0.5
      pot.chipBasePositions[chipIndex]!.set(
        x + jitter * 0.014,
        CHIP_HEIGHT / 2 + level * (CHIP_HEIGHT + 0.002),
        z - jitter * 0.01
      )
      chip.position.copy(pot.chipBasePositions[chipIndex]!)
      // Mostly one denomination per column, the odd contrasting chip on top.
      chip.userData.denomination = (column + (level === levels - 1 && column % 3 === 1 ? 2 : 0)) % CHIP_DENOMINATIONS.length
      chip.userData.level = level
      chipIndex += 1
    }
  })
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
const PAYOUT_ARC_PEAK = 1.05

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
        // Land on top of the winner's tallest column.
        winnerSeat.stack.group.updateWorldMatrix(true, false)
        return winnerSeat.stack.group.localToWorld(winnerSeat.stackFx.getLandingPoint(new THREE.Vector3()))
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
  // Chips being swept in from the betting line: the mound keeps its old size
  // until they arrive, then grows with the bounce (animatePot applies it).
  const sweepLandsAt = count > pot.visibleChipCount && !pot.payoutKey
    ? getWagerCollectEndsAt(runtime, now, true)
    : Number.NEGATIVE_INFINITY
  if (sweepLandsAt > now) {
    pot.pendingCount = count
    pot.pendingGrowAt = sweepLandsAt
  } else {
    if (count > pot.visibleChipCount && !pot.payoutKey) {
      pot.bounceStartedAt = now
    }
    pot.visibleChipCount = count
    pot.pendingGrowAt = undefined
  }
  const shown = pot.payoutKey ? pot.payoutCount : pot.visibleChipCount
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
  const readout = cachedQuery(host, '.payout-pot-readout')
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
    // Fades out on the last chip's landing (never parks on "$0").
    updatePayoutReadout(host, pot.payoutAmount > 0 && remaining > 0 && elapsed < POT_PAYOUT_SECONDS + 0.35 ? remaining : null)
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
  if (pot.pendingGrowAt !== undefined && time >= pot.pendingGrowAt) {
    pot.pendingGrowAt = undefined
    pot.visibleChipCount = pot.pendingCount ?? pot.visibleChipCount
    pot.bounceStartedAt = time
    pot.group.visible = pot.visibleChipCount > 0
    pot.chipMeshes.forEach((chip, index) => { chip.visible = index < pot.visibleChipCount })
  }
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

const armContexts = new WeakMap<SeatRuntime, ArmSolveContext>()

/**
 * Reaches each hand to its animator target and orients it (arm IK with elbow
 * clearance, shoulder assist, hand frames and forearm twist: avatarBodyArms.ts).
 */
function solveSeatArms(seat: SeatRuntime, pose: AvatarPose, flipTarget: Vec3 | null = null, delta = 1 / 60) {
  const avatar = seat.avatar
  if (!avatar) return
  let context = armContexts.get(seat)
  if (!context) {
    context = {
      root: seat.root,
      bones: avatar.bones,
      anchors: seat.anchors,
      model: avatar.model,
      applyOffset: (bone, x, y, z) => applyAvatarBoneOffset(seat, bone, x, y, z),
    }
    armContexts.set(seat, context)
  }
  context.bones = avatar.bones
  context.model = avatar.model
  context.anchors = seat.anchors
  context.cardsVisible = seat.cards.visible
  solveAvatarArms(context, pose, { flipTarget, delta })
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
  dealerPuckTexture = createCanvasTexture(256, 256, context => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
    // Dark bevelled edge, gold ring, ivory face: reads against green felt and
    // never clips to a white blob under the key light.
    context.fillStyle = '#1f2228'
    context.fillRect(0, 0, 256, 256)
    context.fillStyle = '#efe5cd'
    context.beginPath()
    context.arc(128, 128, 112, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#c8923a'
    context.lineWidth = 10
    context.beginPath()
    context.arc(128, 128, 98, 0, Math.PI * 2)
    context.stroke()
    context.fillStyle = '#16191c'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 176px ${font ? `${font}, ` : ''}'Arial Black', sans-serif`
    context.fillText('D', 128, 144)
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
  // Held in the left hand: the glass sits on the felt to the player's left.
  const wrist = seat.avatar?.bones.get('WristL')
  // Grip centre: halfway from the wrist to the knuckle row (the palm), where a fist closes on a glass.
  const knuckle = seat.avatar?.bones.get('Middle2L')
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
    drinkWristWorld.lerp(drinkKnuckleWorld, 0.5)
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
      // The fist goes with the glass: re-reach the arm so the grip (the same
      // point the glass hangs from above) lands on the glass at the lips,
      // instead of the glass floating up to the mouth out of a lower hand.
      const chain = getArmChain(seat.avatar?.bones.get('UpperArmL'), seat.avatar?.bones.get('LowerArmL'), wrist)
      if (chain && at > 0.001) {
        // Elbow down and a little out/forward: the forearm comes up from
        // below to the mouth instead of lying across the face.
        const shoulderL = seat.anchors.shoulderL
        drinkElbowPole.set(shoulderL[0] + 0.1, shoulderL[1] - 1.7, shoulderL[2] - 0.05)
        seat.root.localToWorld(drinkElbowPole)
        // Two passes: the grip-to-wrist offset depends on the solved forearm.
        for (let pass = 0; pass < 2; pass += 1) {
          wrist.getWorldPosition(drinkGripOffset)
          drinkGripTarget.copy(drinkGripOffset)
          if (knuckle) drinkGripTarget.lerp(knuckle.getWorldPosition(drinkKnuckleWorld), 0.5)
          // Grip offset from the wrist bone, as measured on the live hand.
          drinkGripOffset.subVectors(drinkGripTarget, drinkGripOffset)
          // Where the grip should be on the (tipped) glass: low on its body.
          // (The fist wraps the glass from its own, left, side.)
          drinkGripTarget.copy(prop.group.position).addScaledVector(drinkAxis, 0.08 * size / 0.95).sub(drinkGripOffset)
          drinkGripTarget.addScaledVector(drinkSide.set(-1, 0, 0).applyQuaternion(seat.root.quaternion), 0.045 * scale)
          solveArmIK(chain, drinkGripTarget, drinkElbowPole, at)
        }
      }
    }
  }
  prop.group.scale.setScalar(size)
}

const drinkGripOffset = new THREE.Vector3()
const drinkGripTarget = new THREE.Vector3()
const drinkElbowPole = new THREE.Vector3()
const drinkSide = new THREE.Vector3()

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
    solveSeatArms(seat, pose, flipOff?.target ?? null, delta)
    const blink = seat.passedOut ? 1 : reducedMotion ? 0 : getBlinkAmount(time, seat.animator.seed)
    placeDrinkProp(seat, pose, time)
    flushCheeks(seat)
    if (seat.face) {
      // A bonk startles; the shot's burn scrunches the face.
      const bonked = prank?.bonkElapsed !== null && prank?.bonkElapsed !== undefined && prank.bonkElapsed < 1.2
      const burning = prank?.shotElapsed !== null && prank?.shotElapsed !== undefined && prank.shotElapsed > SHOT_DOWN_AT && prank.shotElapsed < SHOT_SHUDDER_END
      // The face director turns the seat's game state into emotion weights and gaze targets.
      updateAvatarFace(seat.face, buildFaceInput(seat.face, seat, {
        delta,
        time,
        reducedMotion,
        actingVisualSeat,
        tableHeat,
        anyWinner,
        runtimeSeats,
        cue: playback.cue,
        bonked,
        burning,
        cheers: prank?.cheersRaise ?? 0,
        fallbackYaw: -(poseBones.Head[1] + poseBones.Neck[1]) * 1.6,
        fallbackPitch: (poseBones.Head[0] + poseBones.Neck[0]) * 1.4,
      }))
      seat.sticky = syncStickyNoteFx(seat.sticky, seat.face, seat.stickyText, delta, reducedMotion, seat.avatar?.root ?? null)
    } else if (seat.avatarStyle) {
      applyBlink(seat.avatarStyle, blink)
    }
    updateAvatarHands(seat.animator.hands, bones, pose.handShapeR, pose.handShapeL, {
      time,
      delta,
      reducedMotion,
      seed: seat.animator.seed,
    })
    updateHatSecondary(seat.riggedAccessories, bones.get('Head'), delta, reducedMotion)

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
  // Kept under the bloom threshold: at 2.4 the acting ring clipped to a white band with a blue halo.
  seat.ring.material.emissiveIntensity = seat.winner ? 1.5 : seat.acting ? 0.95 : 0.8

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
      // Dealt clockwise from the button, one card per player per round.
      const dealDelay = seat.dealDelays?.[index] ?? (seat.visualSeat + index * 8) * DEAL_STEP_SECONDS
      const cardProgress = reducedMotion
        ? 1
        : THREE.MathUtils.clamp((time - seat.dealStartedAt - dealDelay) / DEAL_FLIGHT_SECONDS, 0, 1)
      const cardEase = 1 - Math.pow(1 - cardProgress, 3)
      card.visible = cardProgress > 0
      const baseX = Number(card.userData.baseX ?? (index === 0 ? -0.17 : 0.17))
      const baseYaw = Number(card.userData.baseYaw ?? 0)
      // Showdown flips a card over its long edge once its face is known: a
      // timed ease with a small lift, not an exponential chase.
      const faceUp = Boolean(seat.holeCards[index]?.face)
      const flipTarget = faceUp ? 0 : Math.PI
      const currentFlip = Number(card.userData.flip ?? Math.PI)
      const flips = seat.flipAnim ?? (seat.flipAnim = [])
      let anim = flips[index]
      if (!anim || anim.to !== flipTarget) {
        anim = { from: currentFlip, to: flipTarget, startedAt: time }
        flips[index] = anim
      }
      const flipT = reducedMotion ? 1 : THREE.MathUtils.clamp((time - anim.startedAt) / SHOWDOWN_FLIP_SECONDS, 0, 1)
      const flipEase = flipT < 0.5 ? 4 * flipT * flipT * flipT : 1 - Math.pow(-2 * flipT + 2, 3) / 2
      const flip = anim.from + (anim.to - anim.from) * flipEase
      card.userData.flip = flip
      const flipArc = anim.from === anim.to ? 0 : Math.sin(flipT * Math.PI) * 0.08
      const travel = 1 - cardEase
      // Launch: a quick grow out of the deck so nothing pops into being.
      const launch = reducedMotion ? 1 : THREE.MathUtils.clamp((time - seat.dealStartedAt - dealDelay) / DEAL_LAUNCH_SECONDS, 0, 1)
      const baseScale = Number(card.userData.baseScale ?? (card.userData.baseScale = card.scale.x))
      card.scale.setScalar(baseScale * Math.max(0.001, launch))
      card.position.set(
        baseX * cardEase + dealFrom[0] * travel,
        index * 0.014 + flipArc + dealFrom[1] * travel + Math.sin(cardProgress * Math.PI) * 0.18,
        dealFrom[2] * travel
      )
      // Cards skim in with a little spin and settle flat and square.
      card.rotation.set(0, baseYaw * cardEase + travel * Math.PI * 0.6, flip)
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
  // Landing spot: a short way toward the middle and off to the player's left
  // (the dealer puck sits front-right), flat on the felt, short of their own
  // bet on the betting line.
  const FOLD_SIDE = -0.3
  const land: Vec3 = [
    rest[0] + (board[0] - rest[0]) * 0.17 + FOLD_SIDE,
    restY,
    rest[2] + (board[2] - rest[2]) * 0.17,
  ]
  const skid: Vec3 = [
    rest[0] + (board[0] - rest[0]) * 0.2 + FOLD_SIDE * 1.1,
    restY,
    rest[2] + (board[2] - rest[2]) * 0.2,
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
      // The contact shadow is always transparent and fades itself (cardMeshes.ts).
      if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.userData.contactShadow) return
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
const WAGER_LABEL_LIFT = 0.14
const BOARD_LABEL_HALF_SPAN = BOARD_XS[4]! + BOARD_CARD_WIDTH / 2 + 0.2
const BOARD_LABEL_CLEARANCE = Math.sin(BOARD_CARD_TILT) * BOARD_CARD_DEPTH + 0.05

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
  const scratch = overlayScratch
  const placedPlates: Array<{ element: HTMLElement; x: number; y: number; extra: number }> = []
  // Everything below is computed first and written last: no DOM read (hover,
  // querySelector) ever follows a style write in the same frame, so the frame
  // never forces a synchronous style recalc.
  // The pot readout floats just above the pot chips on the felt. Its position
  // is written on the two readouts themselves, never on .table-scene: a custom
  // property changed on the scene root is inherited by (and re-styles) the whole
  // table DOM every frame.
  scratch.copy(runtime.pot.group.position)
  // Just past the mound's left edge: the hero's bet (and its label) sits to
  // the pot's right, so the two readouts never stack on each other.
  scratch.x -= 0.74
  scratch.y += 0.12
  scratch.project(runtime.camera)
  const potX = (scratch.x * 0.5 + 0.5) * width
  const potY = (-scratch.y * 0.5 + 0.5) * height
  let heroBet: { x: number; y: number } | null = null
  for (const seat of runtime.seats.values()) {
    if (!seat.root.visible) {
      // The hero's own bet label rides on their chips in front of the camera.
      const heroWager = runtime.wagers.get(seat.playerId)
      if (heroWager) {
        scratch.copy(heroWager.target)
        scratch.y += 0.2
        scratch.project(runtime.camera)
        heroBet = { x: (scratch.x * 0.5 + 0.5) * width, y: (-scratch.y * 0.5 + 0.5) * height }
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
    // A spectator at a full table stands behind the near player: projected,
    // that player's plate (and tabled cards) would land on the board, so it
    // docks at the bottom of the screen like a hero bar instead.
    const nearSpectated = seat.visualSeat === 0 && !seat.isHero
    const x = nearSpectated ? width / 2 : THREE.MathUtils.clamp(rawX, margin, width - margin)
    const y = nearSpectated
      ? height - 18
      : THREE.MathUtils.clamp((-scratch.y * 0.5 + 0.5) * height, 150, height - 260)
    const pinned = !nearSpectated && x !== rawX
    const isLocal = element.classList.contains('is-local-player')
    // Revealed hole cards sit above the plate and need clearance too.
    const extra = !isLocal && element.querySelector('.has-revealed-cards') ? 62 : 0
    placedPlates.push({ element, x, y, extra: isLocal ? -1 : extra })
    toggleClass(element, 'is-edge-pinned', pinned)
    toggleClass(element, 'is-near-spectated', nearSpectated)
    setStyleVar(element, '--seat-depth', (TABLE_SEAT_SCALES[toVisualSeat(seat.visualSeat)] ?? 1).toFixed(3))

    const wager = runtime.wagers.get(seat.playerId)
    if (wager) {
      scratch.copy(wager.target)
      scratch.y += WAGER_LABEL_LIFT
      // Once the board is out, a bet behind the propped board would print its label over the cards
      // from the seated camera: float it above the card tops instead.
      if (runtime.board.visibleCount > 0 && scratch.z < BOARD_Z - 0.2 && Math.abs(scratch.x) < BOARD_LABEL_HALF_SPAN) scratch.y += BOARD_LABEL_CLEARANCE
      scratch.project(runtime.camera)
      const betPosition = {
        x: (scratch.x * 0.5 + 0.5) * width,
        y: (-scratch.y * 0.5 + 0.5) * height,
      }
      overlayBetPositions.set(element, betPosition)
      betLabelScratch.push(betPosition)
    } else {
      overlayBetPositions.delete(element)
    }
  }
  // Bet labels never sit on top of each other: neighbours' bets (and bets lifted
  // above the board) would otherwise stack into one unreadable pile of "$20 $40".
  resolveBetLabelOverlaps(betLabelScratch)
  betLabelScratch.length = 0
  // Resolve collisions: nudge plates apart so no two nameplates overlap, even
  // when the camera pushes in or neighbours pin to the same screen edge.
  const compact = width < 1366 || height < 820
  const plateWidth = compact ? 168 : 196
  const plateHeight = compact ? 62 : 72
  const plates = placedPlates.filter(plate => plate.extra >= 0)
  plates.sort((a, b) => a.y - b.y)
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < plates.length; i += 1) {
      for (let j = i + 1; j < plates.length; j += 1) {
        const upper = plates[i]!
        const lower = plates[j]!
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

  // Write phase: only values that changed reach the DOM.
  const tableScene = host.closest<HTMLElement>('.table-scene')
  // Whole pixels: the camera's slow breathing would otherwise nudge these by a
  // fraction of a pixel (and cost a style pass) on every single frame.
  const potXValue = `${Math.round(potX)}px`
  const potYValue = `${Math.round(potY)}px`
  for (const readout of [cachedQuery(tableScene, '.table-surface .pot-display'), cachedQuery(host, '.payout-pot-readout')]) {
    if (!readout) continue
    setStyleVar(readout, '--pot-x', potXValue)
    setStyleVar(readout, '--pot-y', potYValue)
  }
  if (heroBet) {
    const heroBetLabel = cachedQuery(tableScene, '.hero-table-bet')
    if (heroBetLabel) {
      setStyleVar(heroBetLabel, '--hero-bet-x', `${Math.round(heroBet.x)}px`)
      setStyleVar(heroBetLabel, '--hero-bet-y', `${Math.round(heroBet.y)}px`)
    }
  }
  for (const plate of placedPlates) {
    // The hero's own plate is hidden (display: none): nothing to move.
    if (plate.extra < 0) continue
    let x = plate.x
    let y = plate.y
    if (plate.extra >= 0) {
      // Steady plates: ignore sub-pixel sway, ease real moves, and freeze a plate
      // under the pointer so it can be clicked (targeted emotes).
      const previous = plateScreenPositions.get(plate.element)
      if (previous) {
        const hovered = hoveredOverlayElement === plate.element
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
    }
    setStyleVar(plate.element, '--seat-x', `${x.toFixed(1)}px`)
    setStyleVar(plate.element, '--seat-y', `${y.toFixed(1)}px`)
    const bet = overlayBetPositions.get(plate.element)
    // Written on the bet label itself (a leaf) so the rest of the plate is not re-styled.
    const betLabel = bet ? cachedQuery(plate.element, '.cinematic-seat-bet') : null
    if (bet && betLabel) {
      setStyleVar(betLabel, '--bet-x', `${Math.round(bet.x - x)}px`)
      setStyleVar(betLabel, '--bet-y', `${Math.round(bet.y - y)}px`)
    }
  }
}

const overlayScratch = new THREE.Vector3()
const overlayBetPositions = new WeakMap<HTMLElement, { x: number; y: number }>()
const betLabelScratch: Array<{ x: number; y: number }> = []
const BET_LABEL_WIDTH = 90
const BET_LABEL_HEIGHT = 40
const compareBetLabelY = (a: { y: number }, b: { y: number }) => a.y - b.y

/**
 * Labels hang above their anchor (bottom edge on the anchor). Side-by-side
 * labels slide apart horizontally; stacked ones lift the farther label up, so
 * every label stays on or just above its own chips.
 */
function resolveBetLabelOverlaps(labels: Array<{ x: number; y: number }>) {
  if (labels.length < 2) return
  labels.sort(compareBetLabelY)
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const upper = labels[i]!
        const lower = labels[j]!
        const dx = lower.x - upper.x
        const overlapX = BET_LABEL_WIDTH - Math.abs(dx)
        const overlapY = BET_LABEL_HEIGHT - Math.abs(lower.y - upper.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        if (overlapX <= overlapY * 1.4) {
          const push = overlapX / 2 + 1
          const direction = dx >= 0 ? 1 : -1
          upper.x -= push * direction
          lower.x += push * direction
        } else {
          upper.y -= overlapY + 1
        }
      }
    }
  }
}
/** The seat plate under the pointer (kept by pointer events, never read from :hover per frame). */
let hoveredOverlayElement: HTMLElement | null = null
const styleVarCache = new WeakMap<HTMLElement, Map<string, string>>()

/** Writes a CSS custom property only when its value actually changed. */
function setStyleVar(element: HTMLElement, name: string, value: string) {
  let values = styleVarCache.get(element)
  if (!values) {
    values = new Map()
    styleVarCache.set(element, values)
  }
  if (values.get(name) === value) return
  values.set(name, value)
  element.style.setProperty(name, value)
}

function toggleClass(element: HTMLElement, name: string, on: boolean) {
  if (element.classList.contains(name) !== on) element.classList.toggle(name, on)
}

const queryCache = new WeakMap<Element, Map<string, HTMLElement>>()
/** querySelector memoised per root until the element leaves the document. */
function cachedQuery(root: Element | null, selector: string): HTMLElement | null {
  if (!root) return null
  let entries = queryCache.get(root)
  if (!entries) {
    entries = new Map()
    queryCache.set(root, entries)
  }
  const cached = entries.get(selector)
  if (cached?.isConnected && root.contains(cached)) return cached
  const found = root.querySelector<HTMLElement>(selector)
  if (found) entries.set(selector, found)
  else entries.delete(selector)
  return found
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
  // The result is over (next deal): clear the paper instead of raining it
  // over the new hand.
  if (!winnerKey && effects.winnerKey) fadeOutConfetti(effects.confetti)
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
      // Keep the hat tag (see avatarBodySecondary) on the baked mesh.
      for (let node: THREE.Object3D | null = meshes[0]!; node && node !== group; node = node.parent) {
        if (node.userData.accessoryKind) {
          combined.userData.accessoryKind = node.userData.accessoryKind
          break
        }
      }
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

/** Bakes a static subtree's matrices and skips it in every later matrix update. */
function freezeStaticObject(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  root.traverse(object => {
    object.matrixAutoUpdate = false
  })
  root.matrixWorldAutoUpdate = false
}

function precompileScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, postFx: PostFx | null = null) {
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
  const previousTarget = renderer.getRenderTarget()
  try {
    // Direct-to-canvas variant (quality 2: no post)...
    renderer.compile(scene, camera)
    // ...and the render-target variant the composer draws into (linear output,
    // no tone mapping): a different program for every lit material, which
    // otherwise compiled mid-hand (a ~1s freeze when the first cards landed).
    if (postFx) {
      renderer.setRenderTarget(postFx.composer.readBuffer)
      renderer.compile(scene, camera)
    }
    // compile() only links programs; the first draw with each one still
    // blocks on the link and reads back every uniform location (three's
    // onFirstUse). Pay that here too, or the first deal stalls on the card,
    // chip and board programs that were hidden until then.
    for (const program of renderer.info.programs ?? []) program.getUniforms()
  } finally {
    renderer.setRenderTarget(previousTarget)
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

  const bubble = cachedQuery(host, '.lady-luck-bubble-3d')
  if (!bubble) return
  const line = getCompanionLine(companion)
  if (!line || !getCompanionBubbleAnchor(companion, companionBubbleWorld)) {
    if (bubble.dataset.visible !== 'false') bubble.dataset.visible = 'false'
    return
  }
  companionBubbleWorld.project(runtime.camera)
  const x = THREE.MathUtils.clamp((companionBubbleWorld.x * 0.5 + 0.5) * width, 140, width - 140)
  const y = THREE.MathUtils.clamp((-companionBubbleWorld.y * 0.5 + 0.5) * height, 90, height - 200)
  if (bubble.dataset.visible !== 'true') bubble.dataset.visible = 'true'
  if (bubble.textContent !== line) bubble.textContent = line
  setStyleVar(bubble, '--bubble-x', `${x.toFixed(1)}px`)
  setStyleVar(bubble, '--bubble-y', `${y.toFixed(1)}px`)
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
  // Checking every new shader's compile log is a synchronous GPU round trip
  // (40ms+ per program on ANGLE/D3D11): development keeps it, players skip it.
  renderer.debug.checkShaderErrors = process.env.NODE_ENV !== 'production'
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
  const beforeRoom = new Set(scene.children)
  const { neonMaterials } = createRoom(scene)
  const roomObjects = scene.children.filter(child => !beforeRoom.has(child))
  // Only the table (rail onto felt) keeps casting among the static set.
  scene.children.forEach(child => {
    child.traverse(object => { if ((object as THREE.Mesh).isMesh) object.castShadow = false })
  })
  const table = createStylizedTable()
  scene.add(table.group)
  // The room and the table never move: compute their matrices once and take
  // them (hundreds of objects) out of the per-frame matrix walk. The scene root
  // itself never moves either, so it must not force-update every child.
  scene.matrixAutoUpdate = false
  for (const object of [...roomObjects, table.group]) freezeStaticObject(object)
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
    stackSparkles: new StackSparkles(scene),
    debugCamera: null as SceneRuntime['debugCamera'],
    feltMaterial,
    startTime: performance.now(),
    animationFrame: 0,
    lastFrameAt: performance.now(),
    resizeObserver: null as unknown as ResizeObserver,
    disposed: false as boolean,
    suspended: document.hidden,
    reducedMotion: motionPreference.matches,
    pause: () => {},
    resume: () => {},
    dispose: () => {},
    onBroken: undefined as (() => void) | undefined,
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
    // Top tier: 4x MSAA on the composer (crisp card, chip and rail edges);
    // lower tiers keep single-sample targets and the cheap FXAA pass.
    runtime.postFx?.setMultisample(quality === 0 ? 4 : 0)
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
  // Which seat plate is under the pointer, tracked by events so the frame loop
  // never has to ask the style engine (matches(':hover')) mid-frame.
  const handlePointerOver = (event: PointerEvent) => {
    hoveredOverlayElement = (event.target as Element | null)?.closest<HTMLElement>('[data-seat-player]') ?? null
  }
  const handlePointerLeave = () => {
    hoveredOverlayElement = null
  }
  host.addEventListener('pointerover', handlePointerOver)
  host.addEventListener('pointerleave', handlePointerLeave)
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
  let frameErrorReported = false
  const animate = () => {
    if (runtime.disposed || runtime.suspended) return
    runtime.animationFrame = window.requestAnimationFrame(animate)
    runtime.lastFrameAt = performance.now()
    try {
      renderFrame()
    } catch (error) {
      // One bad update (a half-synced seat, a missing bone) must never leave the
      // canvas frozen or black: report it once and still draw the scene.
      if (!frameErrorReported) {
        frameErrorReported = true
        console.error('3D frame update failed; rendering without it.', error)
      }
      try {
        renderer.render(scene, camera)
        // The canvas stays transparent until the scene is ready: never let a
        // failing update keep it hidden (a black table).
        renderedFrames += 1
        if (renderedFrames >= 4 && host.dataset.sceneReady !== 'true') host.dataset.sceneReady = 'true'
      } catch {
        // The context itself is gone; the context-loss handler rebuilds the scene.
      }
    }
  }
  const renderFrame = () => {
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
    setFaceViewer(runtime.camera)
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
    animatePersonalStacks(runtime, time, delta, reducedMotion)
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
      // Full-table spectator: stand up behind the near player instead of sitting in their head,
      // high enough to look over them onto the board (their plate docks at the bottom).
      targetCamera.y += 2.2
      targetCamera.z += 1.5
      targetLook.y -= 0.55
      targetLook.z -= 0.25
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
      heroActing: viewRef.current.isHeroTurn,
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
    // Black-canvas watchdog: the room is never pure black (the walls, the
    // felt, the fog colour), so an all-black frame means the output path broke.
    if (renderedFrames === 30 || renderedFrames === 120) checkForBlackFrame()
  }
  const blackProbe = new Uint8Array(4)
  let blackSuspected = false
  const checkForBlackFrame = () => {
    const gl = renderer.getContext()
    if (gl.isContextLost()) return
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const points: Array<[number, number]> = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]]
    const black = points.every(([u, v]) => {
      gl.readPixels(Math.floor(width * u), Math.floor(height * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, blackProbe)
      return blackProbe[0]! + blackProbe[1]! + blackProbe[2]! === 0
    })
    if (!black) {
      blackSuspected = false
      return
    }
    // A single black sample can be a mid-swap frame; act only when the next
    // sample (a few frames later) is black too.
    if (!blackSuspected) {
      blackSuspected = true
      renderedFrames = renderedFrames >= 120 ? 110 : 20
      return
    }
    blackSuspected = false
    if (runtime.postFx) {
      // Most likely the post-processing chain (render targets, passes): drop it.
      console.warn('3D table rendered black through post effects; falling back to direct rendering.')
      runtime.postFx.dispose()
      runtime.postFx = null
      host.dataset.postFx = 'off'
      renderedFrames = 60
      return
    }
    console.warn('3D table rendered black; rebuilding the scene.')
    runtime.onBroken?.()
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
    host.removeEventListener('pointerover', handlePointerOver)
    host.removeEventListener('pointerleave', handlePointerLeave)
    hoveredOverlayElement = null
    motionPreference.removeEventListener('change', handleMotionPreference)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    for (const seat of runtime.seats.values()) {
      seat.avatarGeneration += 1
      detachRiggedAvatar(seat)
      seat.holeCards.forEach(disposeCardMesh)
    }
    runtime.board.slots.forEach(slot => disposeCardMesh(slot.card))
    runtime.board.disposables.forEach(item => item.dispose())
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
  precompileScene(renderer, scene, camera, postFx)
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

/**
 * Memoised: the table component re-renders for things the room never shows
 * (the raise slider while dragging, the clock tick, chat drafts), and every one
 * of those used to rebuild all the nameplates too.
 */
export const DesktopPokerRoom3D = memo(function DesktopPokerRoom3D({
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
  actingTimerPercent,
  suitColorMode = 'two',
}: DesktopPokerRoom3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const viewRef = useRef(view)
  const highlightRef = useRef(highlightedCards)
  const [webGLStatus, setWebGLStatus] = useState<WebGLStatus>('loading')
  /**
   * Bumped to throw the whole WebGL scene away and build it again on a fresh
   * canvas (a lost context that never comes back, a failed start, a black
   * frame). A canvas whose context was lost can never make a new one.
   */
  const [sceneGeneration, setSceneGeneration] = useState(0)
  const failedStartsRef = useRef(0)

  viewRef.current = view
  highlightRef.current = highlightedCards

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let disposed = false
    let rebuildTimer = 0
    const rebuild = (delayMs: number) => {
      window.clearTimeout(rebuildTimer)
      rebuildTimer = window.setTimeout(() => {
        if (!disposed) setSceneGeneration(generation => generation + 1)
      }, delayMs)
    }
    const handleContextLost = (event: Event) => {
      // preventDefault asks the browser to restore the context; if it does not
      // within a moment (GPU reset, too many contexts), rebuild regardless.
      event.preventDefault()
      if (!disposed) {
        runtimeRef.current?.pause()
        setWebGLStatus('error')
        rebuild(2_000)
      }
    }
    const handleContextRestored = () => {
      // Rebuilding from scratch is more reliable than resuming three.js state.
      if (!disposed) rebuild(0)
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    canvas.addEventListener('webglcontextrestored', handleContextRestored)

    try {
      const runtime = createSceneRuntime(canvas, host, viewRef, highlightRef)
      runtimeRef.current = runtime
      runtime.onBroken = () => {
        runtime.pause()
        rebuild(0)
      }
      failedStartsRef.current = 0
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
      // A start can fail transiently (context limit, GPU busy): retry a few times.
      // Never give up for good: a black table with a stuck message is the worst
      // outcome, so keep retrying with a capped backoff.
      failedStartsRef.current += 1
      rebuild(Math.min(8_000, 700 * failedStartsRef.current))
    }

    // Black-screen watchdog: a loop that stopped producing frames while the tab
    // is visible (a lost context nobody reported, a stuck pause) or a canvas
    // collapsed to nothing is rebuilt instead of being left black.
    let stalledChecks = 0
    const watchdog = window.setInterval(() => {
      const runtime = runtimeRef.current
      if (disposed || !runtime || runtime.disposed || document.hidden) {
        stalledChecks = 0
        return
      }
      const contextLost = runtime.renderer.getContext().isContextLost()
      const collapsed = host.clientWidth > 0 && host.clientHeight > 0 && (canvas.width < 2 || canvas.height < 2)
      const stalled = performance.now() - runtime.lastFrameAt > 3_000
      if (!contextLost && !collapsed && !stalled) {
        stalledChecks = 0
        return
      }
      stalledChecks += 1
      // Give a browser-driven context restore a moment before rebuilding.
      if (stalledChecks < 2) return
      stalledChecks = 0
      console.warn('3D table stopped drawing; rebuilding the scene.', { contextLost, collapsed, stalled })
      runtime.pause()
      rebuild(0)
    }, 2_000)

    return () => {
      disposed = true
      window.clearTimeout(rebuildTimer)
      window.clearInterval(watchdog)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      const finished = runtimeRef.current
      finished?.dispose()
      runtimeRef.current = null
    }
  }, [sceneGeneration])

  // Four-color suits: swap the cached per-mode face textures on every live card
  // (board + hole cards) in place; the scene is never rebuilt for this.
  useEffect(() => {
    const runtime = runtimeRef.current
    const cards: CardMesh[] = []
    if (runtime) {
      runtime.board.slots.forEach(slot => cards.push(slot.card))
      runtime.seats.forEach(seat => cards.push(...seat.holeCards))
    }
    applySuitColorMode(cards, suitColorMode)
  }, [suitColorMode, sceneGeneration])

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
      // No icon pops over seats for beers or water (owner): the 3D drinking
      // animation is the only tell. Keeps the event loop for future cues.
      void event
      void queueSeatPop
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
      triggerFaceEmote(runtime.seats.get(reaction.senderId)?.face, reaction.emote, 'sender')
      if (reaction.targeted && reaction.targetId !== reaction.senderId) triggerFaceEmote(runtime.seats.get(reaction.targetId)?.face, reaction.emote, 'target')
      if (!reaction.emote.includes('\u{1F595}') || !reaction.targeted) continue
      const sender = runtime.seats.get(reaction.senderId)
      if (sender) sender.flipOff = { startedAt: now, targetId: reaction.targetId }
    }
  }, [emoteReactions])

  useEffect(() => {
    if (!runtimeRef.current) return
    // A throw here would unmount the whole table page (React has no boundary
    // for it): isolate each sync so one bad seat cannot blank the screen.
    const syncSafely = (label: string, run: () => void) => {
      try {
        run()
      } catch (error) {
        console.error(`3D ${label} sync failed; the scene keeps running.`, error)
      }
    }
    const liveRuntime = runtimeRef.current
    syncSafely('player', () => syncPlayers(liveRuntime, view))
    syncSafely('wager', () => syncWagers(liveRuntime, view))
    syncSafely('pot', () => syncPot(liveRuntime, view))
    syncSafely('board', () => {
      const runtimeNow = (performance.now() - liveRuntime.startTime) / 1000
      if (view.communityCards.length > liveRuntime.board.visibleCount) liveRuntime.boardRevealAt = runtimeNow
      liveRuntime.anyWinner = view.players.some(player => player.isWinner)
      // A street that closed with bets out deals its cards once the chips
      // have been swept into the pot, not through the middle of the sweep.
      const sweepEndsAt = getWagerCollectEndsAt(liveRuntime, runtimeNow)
      syncBoardRuntime(
        liveRuntime.board,
        view.communityCards,
        highlightedCards,
        runtimeNow,
        sweepEndsAt > runtimeNow ? sweepEndsAt + 0.1 : Number.NEGATIVE_INFINITY
      )
      // New seats, avatars and accessories arrive with every sync.
      for (const seat of liveRuntime.seats.values()) {
        mergeAccessoryMeshes(seat.fallbackAccessories)
        mergeAccessoryMeshes(seat.riggedAccessories)
        pruneShadowCasters(seat.root)
      }
    })
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
        key={sceneGeneration}
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
          // Committed chips this street; a fold-win ends the hand with bets still set, but the chips are gone.
          const showBetChip = player.bet > 0 && view.phase === 'in_hand'
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
                          {view.players.find(sender => sender.id === reaction.senderId)?.nickname ?? reaction.senderName ?? 'Someone'} →
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

                <span
                  className="cinematic-seat-panel"
                  // Set on the acting plate only (not the table root) so a clock tick re-styles one plate.
                  style={player.isActing && actingTimerPercent !== undefined
                    ? { ['--acting-timer-pct' as string]: actingTimerPercent / 100 } as CSSProperties
                    : undefined}
                >
                <span className="cinematic-seat-topline">
                  <strong>{player.nickname}</strong>
                  <StickyNoteChip note={player.stickyNote} />
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
                    <em className="cinematic-drink-badge is-hungover" aria-label="Hungover">🤮</em>
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
                  {showBetChip && (
                    <em className="cinematic-seat-in-bet" aria-label={`$${player.bet.toLocaleString()} in this street`}>
                      <i aria-hidden="true" />${player.bet.toLocaleString()}
                    </em>
                  )}
                  {player.odds && (
                    <OddsPill odds={player.odds} playerName={player.nickname} className="cinematic-odds-pill" />
                  )}
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
                    <small>{showBetChip ? statusLabel.replace(/\s+(?:to\s+)?\$[\d,]+.*$/i, '') : statusLabel}</small>
                  ) : null}
                </span>
                </span>

                {/* A fold-win ends the hand with bets still set; the chips are gone, so is the label. */}
                {player.bet > 0 && view.phase === 'in_hand' && (
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
})
