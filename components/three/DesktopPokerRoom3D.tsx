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
  updateAvatarAnimator,
  type AvatarAnchors,
  type AvatarAnimatorState,
  type AvatarPose,
} from './avatarAnimator'
import { getArmChain, solveArmIK } from './avatarIK'
import { applyBlink, getBlinkAmount, stylizeAvatar, type StylizedAvatar } from './avatarStyle'
import { createAvatarFace, disposeAvatarFace, updateAvatarFace, type AvatarFaceRig, type FaceMood } from './avatarFace'
import { createDrinkProp, disposeDrinkProp, DRINK_DURATION, type DrinkProp } from './drinkProps'
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
  animateBoardRuntime,
  createBoardRuntime,
  createCardMesh,
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
  winnerLight: THREE.PointLight
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
  if (player.isOutOfHand) return 'Folded'
  if (player.isActing) return 'Acting'
  return player.lastAction ?? ''
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
  return createCanvasTexture(512, 512, context => {
    context.fillStyle = '#10262a'
    context.fillRect(0, 0, 512, 512)
    const random = createSeededRandom(0x3344524f)
    context.globalAlpha = 0.18
    for (let index = 0; index < 5000; index += 1) {
      context.fillStyle = random() > 0.5 ? '#1f4448' : '#081416'
      context.fillRect(random() * 512, random() * 512, 2, 2)
    }
    context.globalAlpha = 1
    context.strokeStyle = 'rgba(217, 164, 65, 0.32)'
    context.lineWidth = 4
    for (const [x, y] of [[0, 0], [256, 256], [512, 0], [0, 512], [512, 512]] as const) {
      context.beginPath()
      context.moveTo(x, y - 110)
      context.lineTo(x + 110, y)
      context.lineTo(x, y + 110)
      context.lineTo(x - 110, y)
      context.closePath()
      context.stroke()
    }
    context.fillStyle = 'rgba(226, 80, 92, 0.28)'
    for (const [x, y] of [[256, 256], [0, 0], [512, 0], [0, 512], [512, 512]] as const) {
      context.beginPath()
      context.arc(x, y, 12, 0, Math.PI * 2)
      context.fill()
    }
  }, [7, 7])
}

function createWallPanelTexture() {
  return createCanvasTexture(512, 512, context => {
    const gradient = context.createLinearGradient(0, 0, 0, 512)
    gradient.addColorStop(0, '#0c2a2a')
    gradient.addColorStop(1, '#123634')
    context.fillStyle = gradient
    context.fillRect(0, 0, 512, 512)
    context.strokeStyle = 'rgba(242, 199, 102, 0.22)'
    context.lineWidth = 3
    for (let x = 32; x < 512; x += 64) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, 512)
      context.stroke()
    }
    context.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    context.lineWidth = 10
    for (let x = 0; x < 512; x += 64) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, 512)
      context.stroke()
    }
  }, [10, 1])
}

function createNeonSignTexture(text: string) {
  return createCanvasTexture(1024, 256, context => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-unbounded').trim()
    context.clearRect(0, 0, 1024, 256)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 104px ${font ? `${font}, ` : ''}'Arial Black', sans-serif`
    context.shadowColor = '#ff9a5c'
    context.shadowBlur = 36
    context.strokeStyle = '#ffd0a8'
    context.lineWidth = 10
    context.strokeText(text, 512, 132)
    context.shadowBlur = 12
    context.fillStyle = '#fff4e6'
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
  const bar = new THREE.Group()
  bar.name = 'emerald-back-bar'
  bar.position.set(0, 1.5, -9.2)
  scene.add(bar)

  const woodMaterial = createStandardMaterial('#4a2a1a', { roughness: 0.46, metalness: 0.08 })
  addMesh(bar, new THREE.BoxGeometry(6.2, 3.1, 0.3), woodMaterial).castShadow = false

  const backLight = new THREE.MeshStandardMaterial({
    color: '#0b2622',
    emissive: '#12574a',
    emissiveIntensity: 0.35,
    roughness: 0.4,
  })
  addMesh(bar, new THREE.BoxGeometry(5.6, 2.5, 0.05), backLight, [0, 0.05, 0.17])

  for (const y of [-0.62, 0.22, 1.0]) {
    addMesh(bar, new THREE.BoxGeometry(5.5, 0.07, 0.42), brassMaterial, [0, y, 0.38])
  }

  // Muted amber, green and smoky glass so the bar reads as a bar, not a toy shelf.
  const bottleColors = ['#8a4a1c', '#3e5b2a', '#b07a2e', '#2f4a44', '#6b2a2a', '#c9a45a', '#4b3a22']
  const random = createSeededRandom(0x0b0771e5)
  // Every bottle is merged into one mesh (vertex-coloured) so the whole shelf is a single draw.
  const bottleGeometries: THREE.BufferGeometry[] = []
  const tint = new THREE.Color()
  for (const [rowIndex, shelfY] of [-0.62, 0.22].entries()) {
    for (let index = 0; index < 11; index += 1) {
      const x = -2.4 + index * 0.48 + (random() - 0.5) * 0.1
      const height = 0.3 + random() * 0.34
      const shoulder = 0.45 + random() * 0.3
      const width = 0.07 + random() * 0.06
      const geometry = new THREE.LatheGeometry([
        new THREE.Vector2(0, 0),
        new THREE.Vector2(width, 0),
        new THREE.Vector2(width * 1.08, height * shoulder),
        new THREE.Vector2(width * 0.42, height * (shoulder + 0.16)),
        new THREE.Vector2(width * 0.36, height),
        new THREE.Vector2(0, height),
      ], 12)
      geometry.translate(x, shelfY + 0.035, 0.5)
      tint.set(bottleColors[(index + rowIndex * 3) % bottleColors.length]!)
      const colors = new Float32Array(geometry.getAttribute('position').count * 3)
      for (let vertex = 0; vertex < colors.length; vertex += 3) {
        colors[vertex] = tint.r
        colors[vertex + 1] = tint.g
        colors[vertex + 2] = tint.b
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      bottleGeometries.push(geometry)
    }
  }
  const mergedBottles = mergeGeometries(bottleGeometries, false)
  bottleGeometries.forEach(geometry => geometry.dispose())
  if (mergedBottles) {
    const bottles = addMesh(bar, mergedBottles, new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: '#2a1a0a',
      emissiveIntensity: 0.25,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9,
    }))
    bottles.name = 'back-bar-bottles'
    bottles.castShadow = false
  }
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

  const wainscotMaterial = createStandardMaterial('#3b2216', { roughness: 0.5, metalness: 0.06 })
  addMesh(scene, new THREE.BoxGeometry(32, 1.9, 0.3), wainscotMaterial, [0, -1.05, -9.4]).castShadow = false

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: '#e0b25a',
    roughness: 0.28,
    metalness: 1,
    envMapIntensity: 1.2,
  })
  addMesh(scene, new THREE.BoxGeometry(32, 0.08, 0.34), brassMaterial, [0, -0.08, -9.3])

  createBackBar(scene, brassMaterial)
  for (const x of [-4.6, 4.6]) createWallSconce(scene, x, brassMaterial)
  for (const x of [-9.4, 9.4]) createWallSconce(scene, x, brassMaterial)
  createPoster(scene, -7, 'ALL IN', 'NO GUTS · NO GLORY', 'hearts', brassMaterial)
  createPoster(scene, 7, 'ROYAL', 'FLUSH OR BUST', 'spades', brassMaterial)
  createPendantLamp(scene, -2.6, -0.4, brassMaterial)
  createPendantLamp(scene, 2.6, -0.4, brassMaterial)

  const neonMaterial = new THREE.MeshStandardMaterial({
    map: createNeonSignTexture('POKER NIGHT'),
    emissive: '#ffffff',
    emissiveMap: createNeonSignTexture('POKER NIGHT'),
    emissiveIntensity: 1.25,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const neon = addMesh(scene, new THREE.PlaneGeometry(4.4, 1.1), neonMaterial, [0, 3.58, -9.3])
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
  const railRest = at(RAIL_WIDTH * 0.86, RAIL_PEAK_Y + 0.02)
  seat.anchors.railR = [HAND_SPREAD / scale, railRest[1], railRest[2]]
  seat.anchors.railL = [-HAND_SPREAD / scale, railRest[1], railRest[2]]
  const cardSpot = at(-0.42, FELT_TOP_Y + 0.012)
  seat.cardLocalZ = cardSpot[2]
  seat.anchors.cards = [0, cardSpot[1] + 0.02, cardSpot[2]]
  seat.cards.userData.restY = cardSpot[1]
  // The player's own chips sit to the right of their cards, just inside the rail.
  const stackSpot = at(-0.26, FELT_TOP_Y)
  seat.anchors.stack = [0.62 / scale, stackSpot[1] + 0.06, stackSpot[2]]
  // The stack is a world object (not a child of the seat) so the hero, whose
  // seat is hidden, still sees their own chips in front of them.
  const stackWorld = seat.root.localToWorld(new THREE.Vector3(0.62 / scale, stackSpot[1], stackSpot[2]))
  seat.stack.group.position.copy(stackWorld)
  seat.stack.group.rotation.set(0, seat.root.rotation.y, 0)
  seat.stack.group.scale.setScalar(1)
  const tapSpot = at(-0.18, FELT_TOP_Y + 0.02)
  seat.anchors.tap = [0.16 / scale, tapSpot[1], tapSpot[2]]
  const betWorld = getTableWagerAnchor(safeSeat)
  const betLocal = toSeatLocal(seat, betWorld[0], betWorld[1] + 0.05, betWorld[2])
  seat.anchors.betSpot = betLocal
  seat.anchors.board = toSeatLocal(seat, 0, FELT_TOP_Y + 0.1, BOARD_Z)
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

  const winnerLight = new THREE.PointLight('#ffd978', 0, 4.2, 1.75)
  winnerLight.position.set(0, 1.45, -0.2)
  winnerLight.visible = false
  root.add(winnerLight)

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
    winnerLight,
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
    const style = stylizeAvatar(avatar.model, avatar.materials)
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
  return { meshes }
}

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
function updateChipInstances(instancer: ChipInstancer, scene: THREE.Scene) {
  const counts = instancer.meshes.map(() => 0)
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
  }
  instancer.meshes.forEach((mesh, index) => {
    mesh.count = counts[index]!
    mesh.instanceMatrix.needsUpdate = true
  })
}

function createChipSet(maxChips: number) {
  const group = new THREE.Group()
  const materials = getSharedChipMaterials()
  const chipMeshes: THREE.Mesh[] = []
  const chipBasePositions: THREE.Vector3[] = []
  const chipBodyGeometry = getChipGeometry()
  const random = createSeededRandom(maxChips * 7919)

  for (let index = 0; index < maxChips; index += 1) {
    const column = Math.floor(index / CHIPS_PER_COLUMN)
    const level = index % CHIPS_PER_COLUMN
    const styleIndex = column % CHIP_DENOMINATIONS.length
    const edgeMaterial = materials[styleIndex * 2]!
    const faceMaterial = materials[styleIndex * 2 + 1]!
    // Columns sit in a tight cluster; each chip is nudged so stacks look hand-placed.
    const angle = column * 2.4
    const radius = column === 0 ? 0 : 0.24 + Math.floor((column - 1) / 6) * 0.2
    const chip = addMesh(
      group,
      chipBodyGeometry,
      [edgeMaterial, faceMaterial, faceMaterial],
      [
        Math.cos(angle) * radius + (random() - 0.5) * 0.012,
        CHIP_HEIGHT / 2 + level * (CHIP_HEIGHT + 0.002),
        Math.sin(angle) * radius * 0.8 + (random() - 0.5) * 0.012,
      ]
    )
    chip.rotation.y = random() * Math.PI * 2
    chip.userData.baseYaw = chip.rotation.y
    chip.userData.denomination = styleIndex
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
  const chips = createChipSet(12)
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
        0.12
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
  }
}

const POT_PAYOUT_SECONDS = 1.35

function syncPot(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const now = (performance.now() - runtime.startTime) / 1000
  const count = getWagerChipCount(view.collectedPot, view.bigBlind, runtime.pot.chipMeshes.length)
  const pot = runtime.pot
  const winners = view.players.filter(player => player.isWinner)
  const winnerKey = winners.map(player => player.id).join(',')
  if (winners.length > 0 && winnerKey !== pot.payoutKey) {
    // Showdown payout: the pot's chips arc across the felt to each winner.
    pot.payoutKey = winnerKey
    pot.payoutStartedAt = now
    pot.payoutCount = Math.max(pot.visibleChipCount, count, 6)
    pot.payoutTargets = winners.map(winner => {
      const winnerSeat = runtime.seats.get(winner.id)
      if (winnerSeat?.root.visible) {
        const target = winnerSeat.stack.group.getWorldPosition(new THREE.Vector3())
        target.y = FELT_TOP_Y
        return target
      }
      return toVector3(getTableWagerStartPoint(toVisualSeat(winner.visualSeat)))
    })
  } else if (winners.length === 0) {
    pot.payoutKey = ''
    pot.payoutTargets = []
  }
  if (count > pot.visibleChipCount && !pot.payoutKey) {
    pot.bounceStartedAt = now
  }
  pot.visibleChipCount = count
  const shown = pot.payoutKey ? Math.min(pot.chipMeshes.length, pot.payoutCount) : count
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

function animatePot(runtime: SceneRuntime, time: number, reducedMotion: boolean) {
  const pot = runtime.pot
  if (pot.payoutKey && pot.payoutTargets.length > 0) {
    const elapsed = reducedMotion ? POT_PAYOUT_SECONDS : time - pot.payoutStartedAt
    const localTarget = new THREE.Vector3()
    pot.chipMeshes.forEach((chip, index) => {
      const base = pot.chipBasePositions[index]
      const target = pot.payoutTargets[index % pot.payoutTargets.length]
      if (!base || !target) return
      localTarget.copy(target)
      pot.group.worldToLocal(localTarget)
      const chipProgress = THREE.MathUtils.clamp((elapsed - index * 0.03) / 0.7, 0, 1)
      const position = interpolateWagerArc(
        [base.x, base.y, base.z],
        [localTarget.x, base.y, localTarget.z],
        chipProgress,
        0.9
      )
      chip.position.set(position[0], position[1], position[2])
      chip.rotation.x = chipProgress * Math.PI * 2 * (index % 2 === 0 ? 1 : -1)
      chip.visible = index < pot.payoutCount && chipProgress < 1
    })
    pot.group.visible = elapsed < POT_PAYOUT_SECONDS
    return
  }

  const progress = reducedMotion
    ? 1
    : THREE.MathUtils.clamp((time - runtime.pot.bounceStartedAt) / 0.72, 0, 1)

  runtime.pot.chipMeshes.forEach((chip, index) => {
    const base = runtime.pot.chipBasePositions[index]
    if (!base) return
    const delayed = THREE.MathUtils.clamp(progress * 1.35 - index * 0.025, 0, 1)
    const bounce = Math.sin(delayed * Math.PI) * 0.095 * (1 - delayed * 0.35)
    chip.position.set(base.x, base.y + bounce, base.z)
    chip.rotation.z = (index % 2 === 0 ? 1 : -1) * Math.sin(delayed * Math.PI) * 0.06
  })

  if (progress >= 1) {
    resetChipTransforms(runtime.pot.chipMeshes, runtime.pot.chipBasePositions)
  }
}

const ikTarget = new THREE.Vector3()
const ikPole = new THREE.Vector3()

/** Reaches each hand to its animator target with two-bone arm IK. */
function solveSeatArms(seat: SeatRuntime, pose: AvatarPose) {
  const bones = seat.avatar?.bones
  if (!bones) return
  const sides = [
    { side: 'R', hand: pose.handR, shoulder: seat.anchors.shoulderR, out: 1 },
    { side: 'L', hand: pose.handL, shoulder: seat.anchors.shoulderL, out: -1 },
  ] as const
  for (const { side, hand, shoulder, out } of sides) {
    const chain = getArmChain(bones.get(`UpperArm${side}`), bones.get(`LowerArm${side}`), bones.get(`Wrist${side}`))
    if (!chain) continue
    ikTarget.set(hand[0], hand[1], hand[2])
    seat.root.localToWorld(ikTarget)
    // Elbows swing out to the side and down/back, like arms resting on a rail.
    ikPole.set(shoulder[0] + out * 0.7, shoulder[1] - 0.7, shoulder[2] + 0.45)
    seat.root.localToWorld(ikPole)
    solveArmIK(chain, ikTarget, ikPole)
  }
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
  if (target) target.root.getWorldPosition(flipTargetWorld)
  else flipTargetWorld.set(0, 0, 4.4)
  flipTargetWorld.y += 1.4
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

const drinkWristWorld = new THREE.Vector3()
const drinkKnuckleWorld = new THREE.Vector3()
const drinkForward = new THREE.Vector3()

/** Keeps the drink in the right hand and tips it toward the mouth as it rises. */
function placeDrinkProp(seat: SeatRuntime, pose: AvatarPose, time: number) {
  const prop = seat.drinkProp
  if (!prop) return
  // The glass lives on the felt beside the drinker; it's only in hand mid-sip.
  prop.group.visible = seat.root.visible
  if (!seat.root.visible) return
  const elapsed = time - seat.drinkStartedAt
  const inHand = elapsed > 0.32 && elapsed < DRINK_DURATION - 0.3 && !seat.passedOut
  if (!inHand) {
    drinkWristWorld.set(...seat.anchors.drinkRest)
    seat.root.localToWorld(drinkWristWorld)
    prop.group.position.copy(drinkWristWorld)
    prop.group.position.y = FELT_TOP_Y
    prop.group.rotation.set(0, seat.root.rotation.y, 0)
    prop.group.scale.setScalar(seat.root.scale.x * 1.35)
    return
  }
  const wrist = seat.avatar?.bones.get('WristR')
  const knuckle = seat.avatar?.bones.get('Middle1R')
  if (!wrist) {
    prop.group.visible = false
    return
  }
  wrist.getWorldPosition(drinkWristWorld)
  if (knuckle) {
    knuckle.getWorldPosition(drinkKnuckleWorld)
    drinkWristWorld.lerp(drinkKnuckleWorld, 0.7)
  }
  const scale = seat.root.scale.x
  // Sit the glass in front of the palm (toward the table) so fingers wrap it.
  drinkForward.set(0, 0, -1).applyQuaternion(seat.root.quaternion)
  prop.group.position.copy(drinkWristWorld).addScaledVector(drinkForward, 0.07 * scale)
  prop.group.position.y -= 0.14 * scale * (1 - pose.drinkLift * 0.6)
  prop.group.rotation.set(0, seat.root.rotation.y, 0)
  prop.group.rotateX(pose.drinkLift * 1.35)
  prop.group.scale.setScalar(scale * 1.35)
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

const FINGER_BONES_R = ['Index1R', 'Middle1R', 'Ring1R', 'Pinky1R', 'Index2R', 'Middle2R', 'Ring2R', 'Pinky2R', 'Index3R', 'Middle3R', 'Ring3R', 'Pinky3R'] as const
const FINGER_BONES_L = ['Index1L', 'Middle1L', 'Ring1L', 'Pinky1L', 'Index2L', 'Middle2L', 'Ring2L', 'Pinky2L'] as const

function animateSeat(
  seat: SeatRuntime,
  time: number,
  delta: number,
  actingVisualSeat: number | null,
  reducedMotion: boolean,
  tableHeat = 0,
  runtimeSeats: ReadonlyMap<string, SeatRuntime> = new Map(),
  boardRevealAge = Number.POSITIVE_INFINITY,
  anyWinner = false
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
  const pose = updateAvatarAnimator(seat.animator, {
    time,
    delta,
    reducedMotion,
    acting: seat.acting,
    folded: seat.folded,
    winner: seat.winner,
    loser: seat.loser,
    hasCards: seat.hadCards && seat.cards.visible,
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
    flipOff: getFlipOffInput(seat, time, runtimeSeats),
    boardRevealAge,
    otherWinner: anyWinner && !seat.winner,
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
    solveSeatArms(seat, pose)
    const blink = seat.passedOut ? 1 : reducedMotion ? 0 : getBlinkAmount(time, seat.animator.seed)
    placeDrinkProp(seat, pose, time)
    flushCheeks(seat)
    if (seat.face) {
      const mood: FaceMood = seat.winner
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
    for (const name of FINGER_BONES_R) {
      // During a flick-off the middle finger straightens while the rest curl.
      // During a flick-off the middle finger straightens while the rest close into a fist.
      const isMiddle = name.startsWith('Middle')
      const curl = isMiddle
        ? pose.fingerCurlR * 0.55 * (1 - pose.middleFinger) - 0.12 * pose.middleFinger
        : pose.fingerCurlR * (0.55 + 0.95 * pose.middleFinger)
      applyAvatarBoneOffset(seat, bones.get(name), curl, 0, 0)
    }
    for (const name of FINGER_BONES_L) {
      applyAvatarBoneOffset(seat, bones.get(name), pose.fingerCurlL * 0.55, 0, 0)
    }
    applyAvatarBoneOffset(seat, bones.get('Thumb1R'), pose.fingerCurlR * (0.2 + 0.5 * pose.middleFinger), -pose.fingerCurlR * (0.16 + 0.4 * pose.middleFinger), 0)
    applyAvatarBoneOffset(seat, bones.get('Thumb1L'), pose.fingerCurlL * 0.2, pose.fingerCurlL * 0.16, 0)

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
  seat.winnerLight.visible = seat.winner
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
    seat.winnerLight.intensity = reducedMotion
      ? 5
      : 5 + Math.sin(time * 3.8 + seat.phase) * 1.4
  } else {
    seat.winnerHalo.material.opacity = 0
    seat.winnerSparkles.material.opacity = 0
    seat.winnerLight.intensity = 0
  }

  if (seat.hadCards) {
    const seatDelay = (seat.visualSeat % 4) * 0.07
    const dealProgress = reducedMotion
      ? 1
      : THREE.MathUtils.clamp((time - seat.dealStartedAt - seatDelay) / 0.7, 0, 1)
    const eased = 1 - Math.pow(1 - dealProgress, 3)
    const actionCardsVisible = playback.cue === 'fold' ? tablePose.cards.visible : true
    seat.cards.visible = seat.keepFoldedCardsVisible || (
      actionCardsVisible && (!seat.folded || playback.isActive)
    )
    const restY = Number(seat.cards.userData.restY ?? 0)
    const peekLift = pose.cardLift
    // Cards fly in from the dealer (table centre) and slide into place.
    seat.cards.position.set(
      tablePose.cards.position[0],
      restY + (1 - eased) * 0.9 + tablePose.cards.position[1] + peekLift * 0.05,
      seat.cardLocalZ * (0.35 + eased * 0.65) + tablePose.cards.position[2] * 0.6
    )
    seat.cards.rotation.set(
      tablePose.cards.rotation[0] - peekLift * 0.5,
      tablePose.cards.rotation[1],
      (1 - eased) * (seat.visualSeat % 2 === 0 ? 0.8 : -0.8) + tablePose.cards.rotation[2]
    )
    seat.cards.scale.setScalar(1)
    seat.cardMeshes.forEach((card, index) => {
      const cardProgress = reducedMotion
        ? 1
        : THREE.MathUtils.clamp(
            (time - seat.dealStartedAt - seatDelay - index * 0.12) / 0.6,
            0,
            1
          )
      const cardEase = 1 - Math.pow(1 - cardProgress, 3)
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
      card.position.set(baseX * cardEase, index * 0.014 + (1 - cardEase) * 0.12 + flipArc, 0)
      card.rotation.set(0, baseYaw * cardEase, flip + (1 - cardEase) * (index === 0 ? -0.34 : 0.34))
    })
  } else {
    seat.cards.visible = false
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
      }
    }
  }
  for (const plate of placedPlates) {
    plate.element.style.setProperty('--seat-x', `${THREE.MathUtils.clamp(plate.x, 110, width - 110).toFixed(1)}px`)
    plate.element.style.setProperty('--seat-y', `${plate.y.toFixed(1)}px`)
  }
}

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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Shadows refresh every other frame (see animate) to halve their cost.
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
    frameBudget: new FrameBudget(),
    neonMaterials,
    overlayElements: new Map<string, HTMLElement>(),
    companion,
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

  let viewportWidth = 1
  let viewportHeight = 1
  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    viewportWidth = width
    viewportHeight = height
    const renderArea = width * height
    const pixelRatioCap = renderArea > 2_200_000 ? 1.15 : renderArea > 1_300_000 ? 1.35 : 1.5
    const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    runtime.postFx?.setSize(width, height, pixelRatio)
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
  let frameIndex = 0
  let postFxFadeStartedAt = -1
  const targetCamera = new THREE.Vector3()
  const targetLook = new THREE.Vector3()
  const winnerFocus = new THREE.Vector3()
  const actingFocus = new THREE.Vector3()
  const accentTarget = new THREE.Vector3()
  const animate = () => {
    if (runtime.disposed || runtime.suspended) return
    runtime.animationFrame = window.requestAnimationFrame(animate)
    const time = (performance.now() - runtime.startTime) / 1000
    const delta = Math.min(0.05, Math.max(0.001, time - lastTime))
    lastTime = time
    const reducedMotion = runtime.reducedMotion

    frameIndex += 1
    if (frameIndex % 2 === 0) renderer.shadowMap.needsUpdate = true
    if (runtime.postFx && postFxFadeStartedAt < 0 && runtime.frameBudget.push(delta)) {
      // Sustained slow frames: fade the bloom out over a second, then drop post.
      postFxFadeStartedAt = time
    }
    if (runtime.postFx && postFxFadeStartedAt >= 0 && time - postFxFadeStartedAt > 1) {
      runtime.postFx.dispose()
      runtime.postFx = null
      host.dataset.postFx = 'off'
      renderer.setPixelRatio(1)
      renderer.setSize(viewportWidth, viewportHeight, false)
    }

    const actingSeat = viewRef.current.actingVisualSeat
    const { heat, sourceId } = getTableHeat(runtime, time)
    let winnerSeat: SeatRuntime | null = null
    for (const seat of runtime.seats.values()) {
      animateSeat(seat, time, delta, actingSeat, reducedMotion, seat.playerId === sourceId ? 0 : heat, runtime.seats, time - runtime.boardRevealAt, runtime.anyWinner)
      if (seat.winner && seat.root.visible && !winnerSeat) winnerSeat = seat
    }
    animateWagers(runtime, time, reducedMotion)
    animatePot(runtime, time, reducedMotion)
    animateBoardRuntime(runtime.board, time, reducedMotion)
    animateEffects(runtime, time, delta, reducedMotion)

    // Stage lighting reacts to the table: an ember swell on all-ins, a gold
    // pool over the winner, and a slow neon flicker in the background.
    const allInImpact = getAllInCameraImpact(runtime.seats.values(), time, reducedMotion)
    const accent = runtime.lights.accent
    if (winnerSeat) {
      winnerSeat.root.getWorldPosition(accentTarget)
      accentTarget.y += 2.6
      accent.color.set('#ffcf73')
    } else {
      accentTarget.set(0, 3.2, 0)
      accent.color.set('#ff7a3d')
    }
    accent.position.lerp(accentTarget, 1 - Math.exp(-delta * 4))
    const accentGoal = winnerSeat ? 18 : allInImpact.strength * 12
    accent.intensity += (accentGoal - accent.intensity) * (1 - Math.exp(-delta * 5))
    const flicker = reducedMotion ? 1 : 1 + Math.sin(time * 23) * 0.012
    runtime.neonMaterials.forEach(material => {
      material.emissiveIntensity = 1.25 * flicker
    })

    // A living camera: a slow breathing drift, a subtle lean toward whoever is
    // acting, a punch-in on all-ins, and a push toward the showdown winner.
    // Nameplates are re-projected every frame, so they stay attached.
    targetCamera.copy(baseCameraPosition)
    targetLook.copy(baseCameraLookAt)
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
      targetLook.lerp(actingFocus, 0.5)
      targetCamera.x += actingPosition[0] * 0.07
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
    camera.updateMatrixWorld()

    updateLadyLuck(runtime, viewRef.current, host, time, delta, reducedMotion, viewportWidth, viewportHeight)
    projectSeatOverlays(runtime, host, viewportWidth, viewportHeight)
    updateChipInstances(runtime.chipInstancer, scene)

    if (runtime.postFx) {
      const fade = postFxFadeStartedAt >= 0 ? Math.max(0, 1 - (time - postFxFadeStartedAt)) : 1
      runtime.postFx.bloom.strength = (0.22 + (winnerSeat ? 0.12 : 0) + allInImpact.strength * 0.12) * fade
      runtime.postFx.composer.render(delta)
    } else {
      renderer.render(scene, camera)
    }
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
    if (runtime.companion) disposeCompanion(runtime.companion)
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
  renderer.render(scene, camera)
  if (!runtime.suspended) animate()
  return runtime
}

const NO_HIGHLIGHTED_CARDS: ReadonlyArray<{ rank: string; suit: ThreeCardView['suit'] }> = []

export function DesktopPokerRoom3D({
  view,
  emoteReactions,
  chatMessages,
  selectedTargetId,
  onSelectPlayer,
  cardRevealActions,
  onRequestCardReveal,
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
      <div className="lady-luck-bubble-3d" data-visible="false" aria-live="polite" />

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
                    <span className="cinematic-seat-reaction" aria-hidden="true">
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
                  {player.drinks?.passedOut ? (
                    <em className="cinematic-drink-badge is-passed-out" aria-label="Passed out">💤</em>
                  ) : (player.drinks?.level ?? 0) > 0 ? (
                    <em className="cinematic-drink-badge" aria-label={`${player.drinks.level} drinks deep`}>
                      🍺{player.drinks.level}
                    </em>
                  ) : null}
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
