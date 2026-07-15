'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
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
import { getOpponentTableActionPose, getSeatedAvatarActionPose } from './pokerActionPose'
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
  type TableVisualSeat,
} from './tableWagerLayout'
import { getAvatarHeadTurn, getTurnCameraPose } from './turnFocus'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'

type Vec3 = [number, number, number]
type WebGLStatus = 'loading' | 'ready' | 'error'

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
  emoteReactions: ThreeEmoteReaction[]
  chatMessages: ThreeChatMessage[]
  selectedTargetId: string | null
  onSelectPlayer: (playerId: string) => void
}

interface SeatRuntime {
  root: THREE.Group
  body: THREE.Group
  fallbackAvatar: THREE.Group
  avatarMount: THREE.Group
  avatarOccluder: THREE.Mesh
  avatar: AvatarAssetInstance | null
  avatarMixer: THREE.AnimationMixer | null
  avatarIdleAction: THREE.AnimationAction | null
  avatarActiveAction: THREE.AnimationAction | null
  head: THREE.Group
  leftArm: THREE.Mesh
  rightArm: THREE.Mesh
  cards: THREE.Group
  cardMeshes: THREE.Mesh[]
  dealerButton: THREE.Mesh
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  winnerHalo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  winnerSparkles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  winnerLight: THREE.PointLight
  materials: THREE.MeshStandardMaterial[]
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
}

interface WagerRuntime {
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
}

interface PotRuntime {
  group: THREE.Group
  chipMeshes: THREE.Mesh[]
  chipBasePositions: THREE.Vector3[]
  materials: THREE.MeshStandardMaterial[]
  visibleChipCount: number
  bounceStartedAt: number
}

interface SceneRuntime {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  cameraLookAt: THREE.Vector3
  seats: Map<string, SeatRuntime>
  wagers: Map<string, WagerRuntime>
  pot: PotRuntime
  particleField: THREE.Points
  floorRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  ceilingRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
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

function createFeltGrainTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const random = createSeededRandom(0x504f4b45)

  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4
    const horizontalThread = index % size % 2 === 0 ? 18 : -10
    const verticalThread = Math.floor(index / size) % 3 === 0 ? 12 : -4
    const value = THREE.MathUtils.clamp(
      Math.round(142 + horizontalThread + verticalThread + (random() - 0.5) * 34),
      48,
      220
    )
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = 'procedural-felt-grain'
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 7)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
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

function applyFoldOpacity(material: THREE.Material, folded: boolean) {
  const stored = material.userData[FOLD_MATERIAL_BASELINE] as
    | { opacity: number; transparent: boolean }
    | undefined
  const baseline = stored ?? {
    opacity: material.opacity,
    transparent: material.transparent,
  }

  if (!stored) material.userData[FOLD_MATERIAL_BASELINE] = baseline

  const nextOpacity = folded ? baseline.opacity * 0.35 : baseline.opacity
  const nextTransparent = folded || baseline.transparent
  if (material.transparent !== nextTransparent) material.needsUpdate = true
  material.transparent = nextTransparent
  material.opacity = nextOpacity
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

function createHeartReliefGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.68)
  shape.bezierCurveTo(-0.16, -0.42, -0.8, -0.08, -0.8, 0.36)
  shape.bezierCurveTo(-0.8, 0.9, -0.16, 1.02, 0, 0.5)
  shape.bezierCurveTo(0.16, 1.02, 0.8, 0.9, 0.8, 0.36)
  shape.bezierCurveTo(0.8, -0.08, 0.16, -0.42, 0, -0.68)

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.035,
    bevelThickness: 0.035,
  })
}

function createFramedSuitRelief(
  scene: THREE.Scene,
  x: number,
  suit: 'heart' | 'spade',
  brassMaterial: THREE.MeshStandardMaterial
) {
  const group = new THREE.Group()
  group.name = `framed-${suit}-wall-relief`
  group.position.set(x, 1.34, -9.18)
  scene.add(group)

  const frameBacking = addMesh(
    group,
    new THREE.BoxGeometry(1.78, 2.18, 0.16),
    brassMaterial
  )
  frameBacking.castShadow = false

  addMesh(
    group,
    new THREE.BoxGeometry(1.54, 1.92, 0.13),
    createStandardMaterial('#0b241d', {
      emissive: '#071712',
      emissiveIntensity: 0.42,
      roughness: 0.76,
      metalness: 0.18,
    }),
    [0, 0, 0.12]
  )

  const innerLine = addMesh(
    group,
    new THREE.RingGeometry(0.52, 0.535, 64),
    new THREE.MeshBasicMaterial({
      color: '#d9bd72',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
    [0, 0.05, 0.2]
  )
  innerLine.scale.y = 1.28

  const suitMaterial = createStandardMaterial(suit === 'heart' ? '#8f2735' : '#d0b56e', {
    emissive: suit === 'heart' ? '#4a0c16' : '#66501f',
    emissiveIntensity: suit === 'heart' ? 0.72 : 0.5,
    roughness: 0.34,
    metalness: suit === 'heart' ? 0.3 : 0.68,
  })
  const pip = addMesh(group, createHeartReliefGeometry(), suitMaterial, [0, 0.08, 0.22])
  pip.scale.setScalar(0.56)
  if (suit === 'spade') {
    pip.rotation.z = Math.PI
    addMesh(
      group,
      new THREE.BoxGeometry(0.24, 0.46, 0.1),
      suitMaterial,
      [0, -0.53, 0.25]
    )
    const foot = addMesh(
      group,
      new THREE.BoxGeometry(0.48, 0.13, 0.1),
      suitMaterial,
      [0, -0.74, 0.25]
    )
    foot.rotation.z = -0.04
  }

  for (const y of [-0.82, 0.82]) {
    addMesh(group, new THREE.BoxGeometry(0.54, 0.025, 0.025), brassMaterial, [0, y, 0.23])
  }
}

function createBackBar(scene: THREE.Scene, brassMaterial: THREE.MeshStandardMaterial) {
  const bar = new THREE.Group()
  bar.name = 'emerald-back-bar'
  bar.position.set(0, 1.3, -9.2)
  scene.add(bar)

  const frame = addMesh(
    bar,
    new THREE.BoxGeometry(5.45, 2.34, 0.18),
    brassMaterial
  )
  frame.castShadow = false

  addMesh(
    bar,
    new THREE.BoxGeometry(5.14, 2.04, 0.16),
    createStandardMaterial('#061c18', {
      emissive: '#082f26',
      emissiveIntensity: 0.66,
      roughness: 0.34,
      metalness: 0.48,
    }),
    [0, 0, 0.13]
  )

  const mirrorMaterial = createStandardMaterial('#15372f', {
    emissive: '#0b2c24',
    emissiveIntensity: 0.48,
    roughness: 0.2,
    metalness: 0.72,
  })
  for (const x of [-1.68, 0, 1.68]) {
    addMesh(bar, new THREE.BoxGeometry(1.52, 1.78, 0.035), mirrorMaterial, [x, 0, 0.24])
  }

  const shelfMaterial = createStandardMaterial('#9d7133', {
    emissive: '#5d3513',
    emissiveIntensity: 0.5,
    roughness: 0.34,
    metalness: 0.56,
  })
  for (const y of [-0.48, 0.22]) {
    addMesh(bar, new THREE.BoxGeometry(4.82, 0.085, 0.38), shelfMaterial, [0, y, 0.35])
  }

  const bottleColors = ['#7e2638', '#b66a22', '#0e6b58', '#d0aa54', '#4f2f68']
  const bottleRows = [
    { shelfY: -0.48, xs: [-2.08, -1.48, -0.82, 0.82, 1.48, 2.08] },
    { shelfY: 0.22, xs: [-1.76, -1.08, -0.38, 0.38, 1.08, 1.76] },
  ]
  bottleRows.forEach((row, rowIndex) => {
    row.xs.forEach((x, index) => {
      const height = 0.34 + ((index + rowIndex) % 3) * 0.07
      const bottleBaseY = row.shelfY + 0.0525
      const color = bottleColors[(index + rowIndex * 2) % bottleColors.length]
      const bottleMaterial = createStandardMaterial(color, {
        emissive: color,
        emissiveIntensity: 0.24,
        transparent: true,
        opacity: 0.9,
        roughness: 0.28,
        metalness: 0.18,
      })
      addMesh(
        bar,
        new THREE.CylinderGeometry(0.09, 0.11, height, 16),
        bottleMaterial,
        [x, bottleBaseY + height / 2, 0.53]
      )
      addMesh(
        bar,
        new THREE.CylinderGeometry(0.045, 0.055, 0.14, 12),
        bottleMaterial,
        [x, bottleBaseY + height + 0.08, 0.53]
      )
      addMesh(
        bar,
        new THREE.CylinderGeometry(0.052, 0.052, 0.035, 12),
        brassMaterial,
        [x, bottleBaseY + height + 0.16, 0.53]
      )
    })
  })

  const crestRing = addMesh(
    bar,
    new THREE.RingGeometry(0.24, 0.275, 48),
    new THREE.MeshBasicMaterial({
      color: '#ead58f',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
    [0, 0.77, 0.55]
  )
  crestRing.scale.y = 1.08
  const crestDiamond = addMesh(
    bar,
    new THREE.BoxGeometry(0.23, 0.23, 0.055),
    brassMaterial,
    [0, 0.77, 0.57]
  )
  crestDiamond.rotation.z = Math.PI / 4

  const shelfGlow = new THREE.PointLight('#55b89a', 4.8, 5.2, 2)
  shelfGlow.position.set(0, 0.02, 1.1)
  bar.add(shelfGlow)
}

function createWallSconce(
  scene: THREE.Scene,
  x: number,
  brassMaterial: THREE.MeshStandardMaterial
) {
  const sconce = new THREE.Group()
  sconce.name = 'art-deco-wall-sconce'
  sconce.position.set(x, 1.36, -9.03)
  scene.add(sconce)

  addMesh(
    sconce,
    new THREE.BoxGeometry(0.26, 1.24, 0.16),
    createStandardMaterial('#3a2617', {
      emissive: '#2b1709',
      emissiveIntensity: 0.46,
      roughness: 0.46,
      metalness: 0.48,
    })
  )
  const halo = addMesh(
    sconce,
    new THREE.TorusGeometry(0.34, 0.035, 10, 48),
    brassMaterial,
    [0, 0.08, 0.16]
  )
  halo.scale.y = 1.24
  addMesh(sconce, new THREE.BoxGeometry(0.52, 0.08, 0.2), brassMaterial, [0, -0.4, 0.19])

  const bulbMaterial = createStandardMaterial('#fff0c2', {
    emissive: '#ffbd66',
    emissiveIntensity: 2.8,
    roughness: 0.22,
    metalness: 0.02,
  })
  const bulb = addMesh(sconce, new THREE.SphereGeometry(0.24, 24, 16), bulbMaterial, [0, 0.08, 0.32])
  bulb.scale.y = 1.32

  const light = new THREE.PointLight('#f2b867', 9.5, 6.5, 2)
  light.position.set(0, 0.03, 0.82)
  sconce.add(light)
}

function createRoom(scene: THREE.Scene) {
  const floorMaterial = createStandardMaterial('#07110f', {
    roughness: 0.94,
    metalness: 0.04,
  })
  const floor = addMesh(scene, new THREE.CircleGeometry(18, 96), floorMaterial, [0, -0.63, 0])
  floor.rotation.x = -Math.PI / 2

  const floorInset = addMesh(
    scene,
    new THREE.RingGeometry(5.6, 8.4, 96),
    new THREE.MeshBasicMaterial({
      color: '#1c5c49',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    }),
    [0, -0.615, 0]
  )
  floorInset.rotation.x = -Math.PI / 2
  floorInset.scale.x = 1.42

  const wallMaterial = createStandardMaterial('#0a1d18', {
    emissive: '#04100d',
    emissiveIntensity: 0.32,
    roughness: 0.86,
    metalness: 0.12,
  })
  const backWall = addMesh(
    scene,
    new THREE.BoxGeometry(30, 13, 0.2),
    wallMaterial,
    [0, 5.2, -9.55]
  )
  backWall.name = 'visible-back-wall'
  backWall.castShadow = false

  for (const x of [-11.8, 11.8]) {
    const sideWall = addMesh(
      scene,
      new THREE.BoxGeometry(0.24, 11.5, 19.5),
      createStandardMaterial('#081612', {
        emissive: '#030b09',
        emissiveIntensity: 0.2,
        roughness: 0.9,
      }),
      [x, 4.85, -0.1]
    )
    sideWall.castShadow = false
  }

  const lowerWallMaterial = createStandardMaterial('#102921', {
    emissive: '#06150f',
    emissiveIntensity: 0.34,
    roughness: 0.72,
    metalness: 0.18,
  })
  const lowerWall = addMesh(
    scene,
    new THREE.BoxGeometry(24, 1.62, 0.2),
    lowerWallMaterial,
    [0, 0.12, -9.37]
  )
  lowerWall.castShadow = false

  const columnMaterial = createStandardMaterial('#173127', {
    emissive: '#08150f',
    emissiveIntensity: 0.26,
    roughness: 0.58,
    metalness: 0.34,
  })
  for (const x of [-9.2, -6.7, 6.7, 9.2]) {
    addMesh(scene, new THREE.BoxGeometry(0.22, 8.8, 0.3), columnMaterial, [x, 3.2, -9.18])
  }

  const brassMaterial = createStandardMaterial('#b9984d', {
    emissive: '#5e491f',
    emissiveIntensity: 0.54,
    roughness: 0.36,
    metalness: 0.76,
  })
  addMesh(scene, new THREE.BoxGeometry(20, 0.075, 0.11), brassMaterial, [0, 2.5, -9.18])
  addMesh(scene, new THREE.BoxGeometry(23.5, 0.13, 0.15), brassMaterial, [0, 0.91, -9.15])
  addMesh(scene, new THREE.BoxGeometry(18.5, 0.035, 0.08), brassMaterial, [0, -0.55, -9.14])

  createBackBar(scene, brassMaterial)
  createFramedSuitRelief(scene, -4.15, 'heart', brassMaterial)
  createFramedSuitRelief(scene, 4.15, 'spade', brassMaterial)
  createWallSconce(scene, -5.8, brassMaterial)
  createWallSconce(scene, 5.8, brassMaterial)

  const floorRing = addMesh(
    scene,
    new THREE.TorusGeometry(5.4, 0.025, 8, 128),
    new THREE.MeshBasicMaterial({ color: '#c8aa5d', transparent: true, opacity: 0.28 }),
    [0, -0.58, 0]
  ) as THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  floorRing.rotation.x = Math.PI / 2
  floorRing.scale.x = 1.55

  const ceilingRing = addMesh(
    scene,
    new THREE.TorusGeometry(4.8, 0.035, 8, 128),
    new THREE.MeshBasicMaterial({ color: '#79c8aa', transparent: true, opacity: 0.22 }),
    [0, 7.2, -1.6]
  ) as THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  ceilingRing.rotation.x = Math.PI / 2
  ceilingRing.scale.x = 1.5

  const random = createSeededRandom(0x3344524f)
  const particlePositions = new Float32Array(180 * 3)
  for (let index = 0; index < 180; index += 1) {
    const offset = index * 3
    particlePositions[offset] = (random() - 0.5) * 22
    particlePositions[offset + 1] = random() * 8.5 - 0.25
    particlePositions[offset + 2] = random() * 14 - 7
  }
  const particlesGeometry = new THREE.BufferGeometry()
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  const particleField = new THREE.Points(
    particlesGeometry,
    new THREE.PointsMaterial({
      color: '#cce9dc',
      size: 0.026,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
  )
  scene.add(particleField)

  return { floorRing, ceilingRing, particleField }
}

function createPokerTable(scene: THREE.Scene) {
  const pedestalMaterial = createStandardMaterial('#080d0c', {
    roughness: 0.52,
    metalness: 0.42,
  })
  const pedestal = addMesh(scene, new THREE.CylinderGeometry(1.55, 2.15, 1.8, 64), pedestalMaterial, [0, -1.08, 0])
  pedestal.scale.x = 1.3

  const foot = addMesh(scene, new THREE.CylinderGeometry(2.45, 2.75, 0.32, 64), pedestalMaterial, [0, -1.88, 0])
  foot.scale.x = 1.45

  const baseMaterial = createStandardMaterial('#0a0f0e', {
    roughness: 0.48,
    metalness: 0.46,
  })
  const base = addMesh(scene, new THREE.CylinderGeometry(3.46, 3.35, 0.58, 96), baseMaterial, [0, -0.18, 0])
  base.scale.x = 1.56

  const railMaterial = new THREE.MeshPhysicalMaterial({
    color: '#b99a50',
    emissive: '#4d3b18',
    emissiveIntensity: 0.28,
    roughness: 0.24,
    metalness: 0.72,
    clearcoat: 0.82,
    clearcoatRoughness: 0.2,
  })
  const rail = addMesh(scene, new THREE.CylinderGeometry(3.3, 3.3, 0.52, 96), railMaterial, [0, 0.02, 0])
  rail.scale.x = 1.56

  const innerRailMaterial = createStandardMaterial('#151f1b', {
    roughness: 0.52,
    metalness: 0.32,
  })
  const innerRail = addMesh(scene, new THREE.CylinderGeometry(3.14, 3.14, 0.53, 96), innerRailMaterial, [0, 0.075, 0])
  innerRail.scale.x = 1.56

  const feltGrain = createFeltGrainTexture()
  const feltMaterial = createStandardMaterial('#087052', {
    emissive: '#063f31',
    emissiveIntensity: 0.25,
    roughness: 0.98,
    metalness: 0.01,
    roughnessMap: feltGrain,
    bumpMap: feltGrain,
    bumpScale: 0.012,
  })
  const felt = addMesh(scene, new THREE.CylinderGeometry(2.96, 2.96, 0.5, 96), feltMaterial, [0, 0.14, 0])
  felt.scale.x = 1.56

  const bettingLineMaterial = new THREE.MeshBasicMaterial({
    color: '#d9c477',
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  })
  const bettingLine = addMesh(scene, new THREE.RingGeometry(1.62, 1.64, 96), bettingLineMaterial, [0, 0.405, 0])
  bettingLine.rotation.x = -Math.PI / 2
  bettingLine.scale.x = 1.62

  const railGlow = addMesh(
    scene,
    new THREE.TorusGeometry(3.055, 0.018, 8, 128),
    new THREE.MeshBasicMaterial({
      color: '#e3ca7b',
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
    [0, 0.342, 0]
  )
  railGlow.rotation.x = Math.PI / 2
  railGlow.scale.x = 1.56

  const boardPlinth = addMesh(
    scene,
    new THREE.BoxGeometry(4.25, 0.06, 1.12),
    createStandardMaterial('#03271d', {
      transparent: true,
      opacity: 0.82,
      roughness: 0.88,
    }),
    [0, 0.43, -0.08]
  )
  boardPlinth.rotation.y = 0

  const boardSlotMaterial = createStandardMaterial('#071a15', {
    emissive: '#04100d',
    emissiveIntensity: 0.24,
    roughness: 0.9,
    metalness: 0.04,
  })
  const boardSlotEdgeMaterial = createStandardMaterial('#8f7c48', {
    emissive: '#30250f',
    emissiveIntensity: 0.24,
    roughness: 0.48,
    metalness: 0.42,
  })
  for (const x of [-1.46, -0.73, 0, 0.73, 1.46]) {
    addMesh(
      scene,
      new THREE.BoxGeometry(0.62, 0.032, 0.86),
      [boardSlotEdgeMaterial, boardSlotEdgeMaterial, boardSlotMaterial, boardSlotEdgeMaterial, boardSlotEdgeMaterial, boardSlotEdgeMaterial],
      [x, 0.47, -0.08]
    )
  }

  const markMaterial = new THREE.MeshBasicMaterial({
    color: '#d8c785',
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
  })
  const mark = addMesh(scene, new THREE.RingGeometry(0.56, 0.59, 64), markMaterial, [0, 0.452, 0.08])
  mark.rotation.x = -Math.PI / 2
  mark.scale.x = 1.55

  return feltMaterial
}

function createLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#dff9ec', '#07100d', 1.65))

  const key = new THREE.DirectionalLight('#ffe1a3', 3.2)
  key.position.set(-5.5, 8.5, 6.5)
  scene.add(key)

  const tableSpot = new THREE.SpotLight('#fff0bd', 58, 28, 0.66, 0.78, 1.25)
  tableSpot.position.set(0, 10.5, 3.2)
  tableSpot.target.position.set(0, 0, -0.35)
  tableSpot.castShadow = true
  tableSpot.shadow.mapSize.set(1536, 1536)
  tableSpot.shadow.bias = -0.00008
  tableSpot.shadow.normalBias = 0.025
  tableSpot.shadow.camera.near = 1
  tableSpot.shadow.camera.far = 24
  scene.add(tableSpot, tableSpot.target)

  const greenRim = new THREE.SpotLight('#60d0a7', 26, 24, 0.72, 0.82, 1.4)
  greenRim.position.set(4.8, 6.5, -5.8)
  greenRim.target.position.set(0, 0.2, 0)
  scene.add(greenRim, greenRim.target)

  const warmRim = new THREE.PointLight('#d8a356', 18, 16, 1.7)
  warmRim.position.set(-6, 3.2, 3.4)
  scene.add(warmRim)

  const coolRim = new THREE.PointLight('#4eb395', 15, 16, 1.8)
  coolRim.position.set(6, 3.1, -3.8)
  scene.add(coolRim)
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

  const chair = new THREE.Group()
  root.add(chair)
  const chairBack = addMesh(chair, new THREE.BoxGeometry(1.34, 1.6, 0.28), chairMaterial, [0, 0.72, 0.53])
  chairBack.scale.set(1, 1, 1)
  addMesh(chair, new THREE.BoxGeometry(1.42, 0.08, 0.32), trimMaterial, [0, 1.47, 0.51])
  const chairCushion = addMesh(
    chair,
    new THREE.BoxGeometry(1.22, 0.18, 0.82, 3, 1, 3),
    chairMaterial,
    [0, -0.02, 0.22]
  )
  chairCushion.rotation.x = -0.05
  for (const side of [-1, 1]) {
    addMesh(
      chair,
      new THREE.BoxGeometry(0.11, 0.12, 0.72),
      trimMaterial,
      [side * 0.68, 0.38, 0.08]
    )
  }
  addMesh(chair, new THREE.CylinderGeometry(0.12, 0.16, 0.9, 20), chairMaterial, [0, -0.24, 0.52])

  const body = new THREE.Group()
  body.position.set(0, 0.12, 0.03)
  root.add(body)

  const fallbackAvatar = new THREE.Group()
  fallbackAvatar.name = `fallback-avatar-${player.id}`
  body.add(fallbackAvatar)

  const avatarMount = new THREE.Group()
  avatarMount.name = `rigged-avatar-${player.id}`
  body.add(avatarMount)
  const avatarOccluder = addMesh(
    avatarMount,
    new THREE.BoxGeometry(2.65, 1.05, 0.62),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true }),
    [0, 0.36, -0.38]
  )
  avatarOccluder.name = `avatar-bust-occluder-${player.id}`
  avatarOccluder.castShadow = false
  avatarOccluder.receiveShadow = false
  avatarOccluder.renderOrder = 1
  avatarOccluder.visible = false

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

  if (profile.accessory === 'glasses') {
    const glassesMaterial = createStandardMaterial('#171a18', { roughness: 0.38, metalness: 0.7 })
    materials.push(glassesMaterial)
    addMesh(head, new THREE.TorusGeometry(0.12, 0.018, 6, 18), glassesMaterial, [-0.14, 0.01, -0.36])
    addMesh(head, new THREE.TorusGeometry(0.12, 0.018, 6, 18), glassesMaterial, [0.14, 0.01, -0.36])
    addMesh(head, new THREE.BoxGeometry(0.1, 0.018, 0.02), glassesMaterial, [0, 0.01, -0.37])
  }

  const leftArm = addMesh(fallbackAvatar, new THREE.CylinderGeometry(0.105, 0.12, 0.92, 18), sleeveMaterial, [-0.52, 0.5, -0.28])
  const rightArm = addMesh(fallbackAvatar, new THREE.CylinderGeometry(0.105, 0.12, 0.92, 18), sleeveMaterial, [0.52, 0.5, -0.28])
  leftArm.rotation.set(1.08, 0, -0.22)
  rightArm.rotation.set(1.08, 0, 0.22)
  addMesh(fallbackAvatar, new THREE.SphereGeometry(0.13, 18, 14), skinMaterial, [-0.57, 0.29, -0.68])
  addMesh(fallbackAvatar, new THREE.SphereGeometry(0.13, 18, 14), skinMaterial, [0.57, 0.29, -0.68])

  const cards = new THREE.Group()
  cards.position.set(0, 0.55, -1.02)
  root.add(cards)
  const cardBack = createStandardMaterial('#721d2b', {
    emissive: '#26070d',
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.14,
  })
  const cardEdge = createStandardMaterial('#e6d9b5', { roughness: 0.7 })
  materials.push(cardBack, cardEdge)
  const cardMeshes: THREE.Mesh[] = []
  for (const [index, x] of [-0.2, 0.2].entries()) {
    const card = addMesh(
      cards,
      new THREE.BoxGeometry(0.47, 0.035, 0.68),
      [cardEdge, cardEdge, cardBack, cardEdge, cardEdge, cardEdge],
      [x, 0, 0]
    )
    card.rotation.y = index === 0 ? -0.12 : 0.12
    card.rotation.z = index === 0 ? -0.04 : 0.04
    card.userData.baseX = x
    card.userData.baseYaw = card.rotation.y
    card.userData.baseRoll = card.rotation.z
    cardMeshes.push(card)

    const backInlay = addMesh(
      card,
      new THREE.RingGeometry(0.105, 0.12, 28),
      new THREE.MeshBasicMaterial({
        color: '#d5b968',
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      [0, 0.021, 0]
    )
    backInlay.rotation.x = -Math.PI / 2
    backInlay.scale.y = 1.35
  }

  const dealerMaterial = createStandardMaterial('#eee4c8', { roughness: 0.55, metalness: 0.12 })
  materials.push(dealerMaterial)
  const dealerButton = addMesh(
    root,
    new THREE.CylinderGeometry(0.2, 0.2, 0.06, 32),
    dealerMaterial,
    [-0.88, 0.51, -1.05]
  )
  dealerButton.visible = player.isDealer

  const ringMaterial = createStandardMaterial('#d3b65f', {
    emissive: '#b58f35',
    emissiveIntensity: 1.3,
    transparent: true,
    opacity: 0,
    roughness: 0.3,
    metalness: 0.42,
  })
  const ring = addMesh(root, new THREE.TorusGeometry(0.82, 0.035, 8, 64), ringMaterial, [0, 0.03, 0.2]) as THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
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
  root.add(winnerLight)

  const seatRuntime: SeatRuntime = {
    root,
    body,
    fallbackAvatar,
    avatarMount,
    avatarOccluder,
    avatar: null,
    avatarMixer: null,
    avatarIdleAction: null,
    avatarActiveAction: null,
    head,
    leftArm,
    rightArm,
    cards,
    cardMeshes,
    dealerButton,
    ring,
    winnerHalo,
    winnerSparkles,
    winnerLight,
    materials,
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
  if (seat.avatar) {
    disposeAvatarAssetInstance(seat.avatar, {
      mixer: seat.avatarMixer ?? undefined,
      mixerRoot: seat.avatar.model,
    })
  } else {
    seat.avatarMixer?.stopAllAction()
  }

  seat.avatar = null
  seat.avatarMixer = null
  seat.avatarIdleAction = null
  seat.avatarActiveAction = null
  seat.avatarFailureCount = 0
  seat.avatarOccluder.visible = false
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

function playAvatarOneShot(seat: SeatRuntime, cue: ThreeActionCue, winner = false) {
  const avatar = seat.avatar
  const mixer = seat.avatarMixer
  if (!avatar || !mixer) return

  const clip = winner
    ? avatar.clips.wave
    : cue === 'fold'
      ? avatar.clips.hitReceive
      : cue === 'ready'
        ? undefined
        : avatar.clips.interact
  if (!clip) return

  const action = mixer.clipAction(clip, avatar.model)
  const previous = seat.avatarActiveAction
  if (previous && previous !== action) previous.fadeOut(0.1)
  action.stopFading()
  action.stopWarping()
  action.reset()
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.setDuration(winner ? 1.5 : cue === 'all_in' ? 1.08 : cue === 'check' ? 0.72 : 0.92)
  action.setEffectiveWeight(1)
  seat.avatarIdleAction?.fadeOut(0.16)
  action.fadeIn(0.16).play()
  seat.avatarActiveAction = action
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
    seat.avatar = avatar
    seat.avatarMount.add(avatar.root)
    avatar.model.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) mesh.renderOrder = 2
    })
    seat.avatarMixer = new THREE.AnimationMixer(avatar.model)
    seat.avatarLoadStatus = 'loaded'
    seat.avatarRetryAt = 0
    seat.avatarFailureCount = 0
    seat.fallbackAvatar.visible = false
    seat.avatarOccluder.visible = true
    startAvatarIdle(seat)
    if (seat.winner) playAvatarOneShot(seat, 'ready', true)
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
    seat.avatarOccluder.visible = seat.avatar !== null
    updateAvatarDiagnostics(runtime)
  }
}

function syncSeat(seat: SeatRuntime, player: ThreePlayerView, now: number) {
  if (seat.visualSeat !== player.visualSeat) setSeatPosition(seat, player.visualSeat)
  const actionChanged = seat.actionKey !== player.actionKey
  const becameWinner = !seat.winner && player.isWinner

  // Desktop is framed from the local player's chair. Their physical avatar would
  // sit between the camera and their DOM-rendered hole cards, so keep that seat
  // out of the 3D scene while retaining its readable fixed hand and stack HUD.
  seat.root.visible = !player.isHero

  seat.acting = player.isActing
  seat.winner = player.isWinner
  seat.folded = player.isOutOfHand
  seat.keepFoldedCardsVisible = player.visibleCards.length > 0
  seat.actionCue = player.actionCue

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

  seat.materials.forEach(material => {
    if (material !== seat.ring.material) applyFoldOpacity(material, player.isOutOfHand)
  })
  seat.avatar?.materials.forEach(material => {
    applyFoldOpacity(material, player.isOutOfHand)
  })

  const ringColor = player.isWinner ? '#f4d77e' : player.isActing ? '#d8bd68' : '#69bfa0'
  seat.ring.material.color.set(ringColor)
  seat.ring.material.emissive.set(ringColor)

  if (becameWinner) {
    playAvatarOneShot(seat, 'ready', true)
  } else if (actionChanged && player.actionKey) {
    playAvatarOneShot(seat, player.actionCue)
  }
}

function syncPlayers(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const now = (performance.now() - runtime.startTime) / 1000
  const activeIds = new Set(view.players.map(player => player.id))

  for (const [playerId, seat] of runtime.seats) {
    if (activeIds.has(playerId)) continue
    seat.avatarGeneration += 1
    detachRiggedAvatar(seat)
    runtime.scene.remove(seat.root)
    disposeObject(seat.root)
    runtime.seats.delete(playerId)
  }

  for (const player of view.players) {
    let seat = runtime.seats.get(player.id)
    if (!seat) {
      seat = createSeatRuntime(player, now)
      runtime.seats.set(player.id, seat)
      runtime.scene.add(seat.root)
    }
    syncSeat(seat, player, now)

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

const CHIP_STYLES = [
  { body: '#a82938', stripe: '#f6e8c7' },
  { body: '#24528b', stripe: '#f5e5bd' },
  { body: '#d0a63e', stripe: '#291d0c' },
  { body: '#23775a', stripe: '#f0dfb0' },
  { body: '#e4d8b4', stripe: '#6f2430' },
] as const

function createChipSet(maxChips: number) {
  const group = new THREE.Group()
  const materials = CHIP_STYLES.flatMap(style => [
    createStandardMaterial(style.body, { roughness: 0.34, metalness: 0.24 }),
    createStandardMaterial(style.stripe, { roughness: 0.3, metalness: 0.18 }),
  ])
  const chipMeshes: THREE.Mesh[] = []
  const chipBasePositions: THREE.Vector3[] = []
  const stackCount = Math.ceil(maxChips / 4)

  for (let index = 0; index < maxChips; index += 1) {
    const styleIndex = index % CHIP_STYLES.length
    const bodyMaterial = materials[styleIndex * 2]!
    const stripeMaterial = materials[styleIndex * 2 + 1]!
    const stackIndex = Math.floor(index / 4)
    const stackLevel = index % 4
    const chip = addMesh(
      group,
      new THREE.CylinderGeometry(0.14, 0.14, 0.05, 32),
      bodyMaterial,
      [(stackIndex - (stackCount - 1) / 2) * 0.29, stackLevel * 0.052, (stackIndex % 2) * 0.08 - 0.04]
    )
    chip.name = `casino-chip-${index}`
    chip.visible = false

    const topRing = addMesh(
      chip,
      new THREE.TorusGeometry(0.087, 0.011, 6, 28),
      stripeMaterial,
      [0, 0.027, 0]
    )
    topRing.rotation.x = Math.PI / 2
    topRing.castShadow = false
    for (const rotation of [0, Math.PI / 2]) {
      const inlay = addMesh(
        chip,
        new THREE.BoxGeometry(0.024, 0.006, 0.23),
        stripeMaterial,
        [0, 0.028, 0]
      )
      inlay.rotation.y = rotation
      inlay.castShadow = false
    }

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
    ...chips,
    visualSeat,
    amount: player.bet,
    actionKey: player.actionKey,
    start,
    target,
    startedAt: now,
    animating: false,
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
    wager.start.copy(toVector3(getTableWagerStartPoint(visualSeat)))
    wager.target.copy(toVector3(getTableWagerAnchor(visualSeat)))

    if (seatChanged) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (actionChanged && amountIncreased && isWagerAction(player.actionCue)) {
      wager.startedAt = now
      wager.animating = true
      wager.group.position.copy(wager.start)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
    } else if (!wager.animating) {
      wager.group.position.copy(wager.target)
    }

    wager.amount = player.bet
    wager.actionKey = player.actionKey
    const chipCount = view.phase === 'in_hand'
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
    chip.rotation.set(0, 0, 0)
  })
}

function animateWagers(runtime: SceneRuntime, time: number, reducedMotion: boolean) {
  for (const wager of runtime.wagers.values()) {
    if (!wager.animating) continue

    if (reducedMotion) {
      wager.animating = false
      wager.group.position.copy(wager.target)
      wager.group.rotation.set(0, 0, 0)
      resetChipTransforms(wager.chipMeshes, wager.chipBasePositions)
      continue
    }

    const progress = THREE.MathUtils.clamp((time - wager.startedAt) / 0.68, 0, 1)
    const position = interpolateWagerArc(
      [wager.start.x, wager.start.y, wager.start.z],
      [wager.target.x, wager.target.y, wager.target.z],
      progress
    )
    wager.group.position.set(position[0], position[1], position[2])
    const settle = Math.sin(progress * Math.PI)
    wager.group.rotation.z = (wager.visualSeat % 2 === 0 ? 1 : -1) * settle * 0.08
    wager.chipMeshes.forEach((chip, index) => {
      const base = wager.chipBasePositions[index]
      if (!base) return
      const arrival = THREE.MathUtils.clamp(progress * 1.18 - index * 0.018, 0, 1)
      const lift = Math.sin(arrival * Math.PI) * 0.075
      chip.position.set(base.x, base.y + lift, base.z)
      chip.rotation.y = (index % 2 === 0 ? 1 : -1) * arrival * 0.7
      chip.rotation.z = (index % 2 === 0 ? 1 : -1) * Math.sin(arrival * Math.PI) * 0.09
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
  const pot = createChipSet(18)
  pot.group.name = 'table-pot-chip-mound'
  pot.group.position.set(0, 0.435, 0.96)
  pot.group.scale.setScalar(0.9)
  scene.add(pot.group)
  return {
    ...pot,
    visibleChipCount: 0,
    bounceStartedAt: Number.NEGATIVE_INFINITY,
  }
}

function syncPot(runtime: SceneRuntime, view: ThreeTableViewModel) {
  const count = getWagerChipCount(view.collectedPot, view.bigBlind, runtime.pot.chipMeshes.length)
  if (count > runtime.pot.visibleChipCount) {
    runtime.pot.bounceStartedAt = (performance.now() - runtime.startTime) / 1000
  }
  runtime.pot.visibleChipCount = count
  runtime.pot.group.visible = count > 0
  runtime.pot.chipMeshes.forEach((chip, index) => {
    chip.visible = index < count
  })

  const host = runtime.renderer.domElement.parentElement
  if (host) {
    host.dataset.potChipCount = String(count)
    host.dataset.potAmount = String(view.pot)
    host.dataset.collectedPotAmount = String(view.collectedPot)
  }
}

function animatePot(runtime: SceneRuntime, time: number, reducedMotion: boolean) {
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

function animateSeat(
  seat: SeatRuntime,
  time: number,
  delta: number,
  actingVisualSeat: number | null,
  reducedMotion: boolean
) {
  const idle = reducedMotion ? 0 : Math.sin(time * 1.15 + seat.phase)
  // Furniture and table props stay grounded. Only the player breathes, shifts,
  // and reacts to action playback.
  seat.root.position.y = seat.baseY

  const playback = getActionPlaybackSnapshot(
    seat.playback,
    reducedMotion ? Number.POSITIVE_INFINITY : time * 1000
  )
  const avatarPose = getSeatedAvatarActionPose(playback.cue, playback.elapsedMs)
  const tablePose = getOpponentTableActionPose(
    seat.folded && seat.keepFoldedCardsVisible ? 'ready' : playback.cue,
    seat.folded && seat.keepFoldedCardsVisible
      ? Number.POSITIVE_INFINITY
      : playback.elapsedMs
  )
  const alertLift = seat.acting && !reducedMotion
    ? Math.sin(time * 3.2 + seat.phase) * 0.018
    : 0

  seat.body.position.set(
    avatarPose.bodyPosition[0],
    0.12 + idle * 0.012 + alertLift + avatarPose.bodyPosition[1],
    0.03 + avatarPose.bodyPosition[2]
  )
  seat.body.rotation.set(
    -0.035 + idle * 0.006 + avatarPose.bodyRotation[0],
    avatarPose.bodyRotation[1],
    idle * 0.006 + avatarPose.bodyRotation[2]
  )

  const bothArms = playback.cue === 'all_in'
  const armX = avatarPose.armRotation[0] * 2.35
  const armY = avatarPose.armRotation[1] * 1.6
  const armZ = avatarPose.armRotation[2] * 1.5
  seat.leftArm.rotation.set(
    1.08 - (bothArms ? armX : armX * 0.22),
    bothArms ? -armY : 0,
    -0.22 - (bothArms ? armZ : 0)
  )
  seat.rightArm.rotation.set(1.08 - armX, armY, 0.22 + armZ)

  const headTurn = getAvatarHeadTurn(seat.visualSeat, actingVisualSeat)
  seat.head.rotation.y = headTurn.yaw + (
    seat.acting && !reducedMotion
      ? Math.sin(time * 1.8 + seat.phase) * 0.035
      : idle * 0.018
  )
  seat.head.rotation.x = (seat.folded ? 0.18 : headTurn.pitch) + avatarPose.headRotation[0]
  seat.head.rotation.z = avatarPose.headRotation[2]

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

    // The bundled models provide polished motion and a full hand rig, while
    // these post-mixer offsets make that generic motion read as poker actions.
    const bones = seat.avatar.bones
    const headBone = bones.get('Head')
    const chestBone = bones.get('Chest')
    const upperArmRight = bones.get('UpperArmR')
    const lowerArmRight = bones.get('LowerArmR')
    const upperArmLeft = bones.get('UpperArmL')
    const lowerArmLeft = bones.get('LowerArmL')

    // The source idle clip is a standing neutral. A small symmetrical bend
    // settles both forearms toward the rail so players read as seated poker
    // participants even when no action clip is running.
    applyAvatarBoneOffset(seat, upperArmRight, -0.14, 0, 0.08)
    applyAvatarBoneOffset(seat, lowerArmRight, -0.3, 0, 0.04)
    applyAvatarBoneOffset(seat, upperArmLeft, -0.14, 0, -0.08)
    applyAvatarBoneOffset(seat, lowerArmLeft, -0.3, 0, -0.04)

    applyAvatarBoneOffset(
      seat,
      headBone,
      headTurn.pitch * 0.58 + avatarPose.headRotation[0] * 0.42,
      headTurn.yaw * 0.72 + avatarPose.headRotation[1] * 0.42,
      avatarPose.headRotation[2] * 0.36
    )
    applyAvatarBoneOffset(
      seat,
      chestBone,
      avatarPose.bodyRotation[0] * 0.34,
      avatarPose.bodyRotation[1] * 0.32,
      avatarPose.bodyRotation[2] * 0.32
    )
    applyAvatarBoneOffset(
      seat,
      upperArmRight,
      -avatarPose.armRotation[0] * 0.82,
      avatarPose.armRotation[1] * 0.52,
      avatarPose.armRotation[2] * 0.68
    )
    applyAvatarBoneOffset(
      seat,
      lowerArmRight,
      -avatarPose.armRotation[0] * 0.5,
      0,
      avatarPose.armRotation[2] * 0.38
    )

    const wristRight = bones.get('WristR')
    applyAvatarBoneOffset(
      seat,
      wristRight,
      tablePose.hand.rotation[0] * 0.22,
      tablePose.hand.rotation[1] * 0.3,
      tablePose.hand.rotation[2] * 0.28
    )
    for (const name of ['Index1R', 'Middle1R', 'Ring1R', 'Pinky1R']) {
      applyAvatarBoneOffset(seat, bones.get(name), tablePose.hand.fingerCurl * 0.34, 0, 0)
    }
    applyAvatarBoneOffset(
      seat,
      bones.get('Thumb1R'),
      tablePose.hand.fingerCurl * 0.16,
      -tablePose.hand.fingerCurl * 0.12,
      0
    )

    if (playback.cue === 'all_in') {
      applyAvatarBoneOffset(
        seat,
        upperArmLeft,
        -avatarPose.armRotation[0] * 0.82,
        -avatarPose.armRotation[1] * 0.52,
        -avatarPose.armRotation[2] * 0.68
      )
      applyAvatarBoneOffset(
        seat,
        lowerArmLeft,
        -avatarPose.armRotation[0] * 0.5,
        0,
        -avatarPose.armRotation[2] * 0.38
      )
      for (const name of ['Index1L', 'Middle1L', 'Ring1L', 'Pinky1L']) {
        applyAvatarBoneOffset(seat, bones.get(name), tablePose.hand.fingerCurl * 0.34, 0, 0)
      }
    }
  }

  const ringPulse = reducedMotion
    ? 1
    : 1 + Math.sin(time * (seat.winner ? 4.4 : 3.2) + seat.phase) * 0.07
  seat.ring.scale.setScalar(ringPulse)
  seat.ring.material.opacity = seat.winner
    ? 0.72 + (reducedMotion ? 0 : Math.sin(time * 4.4) * 0.18)
    : seat.acting
      ? 0.52 + (reducedMotion ? 0 : Math.sin(time * 3.2) * 0.15)
      : 0
  seat.ring.material.emissiveIntensity = seat.winner ? 2.1 : 1.45

  seat.winnerHalo.visible = seat.winner
  seat.winnerSparkles.visible = seat.winner
  if (seat.winner) {
    const celebrationPulse = reducedMotion ? 1 : 0.88 + Math.sin(time * 3.8 + seat.phase) * 0.12
    seat.winnerHalo.position.y = 2.08 + (reducedMotion ? 0 : Math.sin(time * 2.4) * 0.035)
    seat.winnerHalo.rotation.z = reducedMotion ? 0 : time * 0.42
    seat.winnerHalo.scale.setScalar(celebrationPulse)
    seat.winnerHalo.material.opacity = reducedMotion
      ? 0.78
      : 0.64 + Math.sin(time * 3.8 + seat.phase) * 0.16
    seat.winnerSparkles.rotation.y = reducedMotion ? 0 : time * 0.34
    seat.winnerSparkles.position.y = reducedMotion ? 0 : Math.sin(time * 1.7 + seat.phase) * 0.06
    seat.winnerSparkles.material.opacity = reducedMotion
      ? 0.64
      : 0.5 + Math.sin(time * 4.6 + seat.phase) * 0.18
    seat.winnerLight.intensity = reducedMotion
      ? 4.2
      : 3.8 + Math.sin(time * 3.8 + seat.phase) * 1.15
  } else {
    seat.winnerHalo.material.opacity = 0
    seat.winnerSparkles.material.opacity = 0
    seat.winnerLight.intensity = 0
  }

  if (seat.hadCards) {
    const seatDelay = (seat.visualSeat % 4) * 0.045
    const dealProgress = reducedMotion
      ? 1
      : THREE.MathUtils.clamp((time - seat.dealStartedAt - seatDelay) / 0.74, 0, 1)
    const eased = 1 - Math.pow(1 - dealProgress, 3)
    const actionCardsVisible = playback.cue === 'fold' ? tablePose.cards.visible : true
    seat.cards.visible = seat.keepFoldedCardsVisible || (
      actionCardsVisible && (!seat.folded || playback.isActive)
    )
    seat.cards.position.set(
      tablePose.cards.position[0],
      0.55 + (1 - eased) * 2.4 + tablePose.cards.position[1],
      -1.02 + tablePose.cards.position[2]
    )
    seat.cards.rotation.set(
      tablePose.cards.rotation[0],
      tablePose.cards.rotation[1],
      (1 - eased) * (seat.visualSeat % 2 === 0 ? 0.8 : -0.8) + tablePose.cards.rotation[2]
    )
    seat.cards.scale.setScalar(0.72 + eased * 0.28)
    seat.cardMeshes.forEach((card, index) => {
      const cardProgress = reducedMotion
        ? 1
        : THREE.MathUtils.clamp(
            (time - seat.dealStartedAt - seatDelay - index * 0.095) / 0.62,
            0,
            1
          )
      const cardEase = 1 - Math.pow(1 - cardProgress, 3)
      const baseX = Number(card.userData.baseX ?? (index === 0 ? -0.2 : 0.2))
      const baseYaw = Number(card.userData.baseYaw ?? 0)
      const baseRoll = Number(card.userData.baseRoll ?? 0)
      card.position.set(baseX * cardEase, (1 - cardEase) * 0.12, 0)
      card.rotation.y = baseYaw * cardEase
      card.rotation.z = baseRoll * cardEase + (1 - cardEase) * (index === 0 ? -0.34 : 0.34)
    })
  } else {
    seat.cards.visible = false
  }
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
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    material.dispose()
  })
}

function createSceneRuntime(
  canvas: HTMLCanvasElement,
  host: HTMLDivElement,
  viewRef: MutableRefObject<ThreeTableViewModel>
): SceneRuntime {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#06100e')
  scene.fog = new THREE.FogExp2('#06100e', 0.027)

  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 60)
  camera.position.set(0, 7.25, 11.4)
  const cameraLookAt = new THREE.Vector3(0, 0.25, -0.45)
  camera.lookAt(cameraLookAt)

  createLighting(scene)
  const { floorRing, ceilingRing, particleField } = createRoom(scene)
  const feltMaterial = createPokerTable(scene)
  const pot = createPotRuntime(scene)
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  if (feltMaterial.roughnessMap) {
    feltMaterial.roughnessMap.anisotropy = Math.min(8, maxAnisotropy)
    feltMaterial.roughnessMap.needsUpdate = true
  }

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')

  const runtime = {
    renderer,
    scene,
    camera,
    cameraLookAt,
    seats: new Map<string, SeatRuntime>(),
    wagers: new Map<string, WagerRuntime>(),
    pot,
    particleField,
    floorRing,
    ceilingRing,
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

  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    const renderArea = width * height
    const pixelRatioCap = renderArea > 2_200_000 ? 1.15 : renderArea > 1_300_000 ? 1.35 : 1.5
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.fov = camera.aspect < 1.28 ? 43 : camera.aspect > 2.15 ? 41 : 39
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  runtime.resizeObserver = resizeObserver
  resize()

  let lastTime = (performance.now() - runtime.startTime) / 1000
  const targetCamera = new THREE.Vector3()
  const targetLook = new THREE.Vector3()
  const animate = () => {
    if (runtime.disposed || runtime.suspended) return
    runtime.animationFrame = window.requestAnimationFrame(animate)
    const time = (performance.now() - runtime.startTime) / 1000
    const delta = Math.min(0.05, Math.max(0.001, time - lastTime))
    lastTime = time
    const reducedMotion = runtime.reducedMotion

    runtime.particleField.rotation.y = reducedMotion ? 0 : time * 0.006
    runtime.particleField.position.y = reducedMotion ? 0 : Math.sin(time * 0.16) * 0.08
    runtime.floorRing.rotation.z = reducedMotion ? 0 : time * 0.018
    runtime.ceilingRing.rotation.z = reducedMotion ? 0 : -time * 0.012
    runtime.feltMaterial.emissiveIntensity = reducedMotion
      ? 0.22
      : 0.22 + Math.sin(time * 0.72) * 0.035

    const actingSeat = viewRef.current.actingVisualSeat
    for (const seat of runtime.seats.values()) {
      animateSeat(seat, time, delta, actingSeat, reducedMotion)
    }
    animateWagers(runtime, time, reducedMotion)
    animatePot(runtime, time, reducedMotion)

    const focusPose = getTurnCameraPose(actingSeat)
    const drift = reducedMotion ? 0 : Math.sin(time * 0.14) * 0.16
    targetCamera.set(
      drift + focusPose.position[0] * 2.1,
      7.25 + (focusPose.position[1] - 4.08) * 1.3,
      11.4 + (focusPose.position[2] - 6.26) * 1.8
    )
    targetLook.set(
      focusPose.lookAt[0] * 1.65,
      0.25 + (focusPose.lookAt[1] - 0.92) * 1.2,
      -0.45 + (focusPose.lookAt[2] - 0.02) * 1.2
    )
    const smoothing = reducedMotion ? 1 : 1 - Math.exp(-delta * 1.65)
    camera.position.lerp(targetCamera, smoothing)
    cameraLookAt.lerp(targetLook, smoothing)
    camera.lookAt(cameraLookAt)

    renderer.render(scene, camera)
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
    }
    disposeObject(scene)
    renderer.dispose()
  }

  syncPlayers(runtime, viewRef.current)
  syncWagers(runtime, viewRef.current)
  syncPot(runtime, viewRef.current)
  renderer.render(scene, camera)
  if (!runtime.suspended) animate()
  return runtime
}

export function DesktopPokerRoom3D({
  view,
  emoteReactions,
  chatMessages,
  selectedTargetId,
  onSelectPlayer,
}: DesktopPokerRoom3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const viewRef = useRef(view)
  const [webGLStatus, setWebGLStatus] = useState<WebGLStatus>('loading')

  viewRef.current = view

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
      const runtime = createSceneRuntime(canvas, host, viewRef)
      runtimeRef.current = runtime
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

  useEffect(() => {
    if (!runtimeRef.current) return
    syncPlayers(runtimeRef.current, view)
    syncWagers(runtimeRef.current, view)
    syncPot(runtimeRef.current, view)
  }, [view])

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

      {webGLStatus === 'loading' && (
        <div className="three-webgl-status" role="status">Warming up the 3D table…</div>
      )}
      {webGLStatus === 'error' && (
        <div className="three-webgl-status is-error" role="alert">
          The 3D table was interrupted. Restoring automatically; reload if this message stays.
        </div>
      )}
      {webGLStatus === 'ready' && (
        <div className="three-live-badge" aria-hidden="true">
          <i /> Live 3D
        </div>
      )}

      <div className="cinematic-seats" aria-label="Poker players">
        {view.players.map(player => {
          const reaction = emoteReactions.find(item => item.targetId === player.id)
          const chatMessage = chatMessages.find(item => item.targetId === player.id)
          const statusLabel = getStatusLabel(player)

          return (
            <button
              key={player.id}
              type="button"
              className={`cinematic-seat cinematic-seat-${player.visualSeat} ${player.isHero ? 'is-local-player' : ''} ${player.isActing ? 'is-acting' : ''} ${player.isWinner ? 'is-winner' : ''} ${player.isOutOfHand ? 'is-folded' : ''} ${selectedTargetId === player.id ? 'is-selected' : ''}`}
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
                !player.isOutOfHand || player.visibleCards.length > 0
              ) && !player.isHero && (
                <CinematicHoleCards player={player} />
              )}

              <span className="cinematic-seat-panel">
                <span className="cinematic-seat-topline">
                  <strong>{player.nickname}</strong>
                  {player.blindRole && <em>{player.blindRole === 'big' ? 'BB' : 'SB'}</em>}
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
          )
        })}
      </div>
    </div>
  )
}
