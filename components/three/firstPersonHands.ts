import * as THREE from 'three'
import { createCardMesh, disposeCardMesh, type CardMesh } from './cardMeshes'
import {
  createHeroHandsAnchors,
  createHeroHandsPose,
  evaluateHeroHands,
  followHandPose,
  createHandVelocity,
  type HandVelocity,
  MIN_HAND_DEPTH,
  type HandPose,
  type HeroHandsAnchors,
  type HeroDealInput,
  type HeroHandsInput,
  type HeroHandsPose,
} from './firstPersonHandPose'
import { buildHandGeometry, createHandMaterial, HAND_MORPH, HAND_SCALE, type HandColors } from './firstPersonHandMesh'
import { getActionPlaybackSnapshot, type ThreeActionPlaybackState } from './actionPlayback'
import { getPokerActionMotionProfile } from './pokerActionPose'
import type { ThreeActionCue } from './tableViewModel'

/**
 * The hero's own forearms and hands, first-person, riding on the camera like
 * the first-person drink. Two draw calls (one merged, morphing hand mesh per
 * hand) plus two toss cards that only exist during a fold. The pose comes from
 * firstPersonHandPose.ts; this file builds the meshes, places them and adapts
 * the room's seat/wager/prank state into the pose input.
 */

const CARD_WIDTH = 0.082
/** Everything the rig draws must stay clear of the lens plane. */
const MIN_FORWARD = MIN_HAND_DEPTH

export interface FirstPersonHands {
  root: THREE.Group
  right: THREE.Mesh
  left: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.MeshToonMaterial
  colors: HandColors
  colorKey: string
  cards: CardMesh[]
  /** Smoothed pose actually drawn. */
  shown: HeroHandsPose
  /** Spring velocities that carry each drawn hand to its target (no sudden starts). */
  velocity: { right: HandVelocity; left: HandVelocity }
  /** Target pose for this frame (scratch). */
  target: HeroHandsPose
  input: HeroHandsInput
  anchors: HeroHandsAnchors
  /** Scratch for the dealer gesture. */
  deal: HeroDealInput
  /** The hands were hidden last frame (they ease back in). */
  wasHidden: boolean
  winnerSince: number
  lastTime: number
  measureAt: number
  /** Dev/test: force a gesture on a fixed clock (scripts/snap-fp-hands.mjs). */
  /** Dev/test: hide the rig entirely (perf comparisons). */
  forceHide?: boolean
  debugForce: { cue: ThreeActionCue; elapsedMs: number; peeking?: boolean; winnerSeconds?: number; flickSeconds?: number } | null
}

export function createFirstPersonHands(camera: THREE.Camera): FirstPersonHands {
  const root = new THREE.Group()
  root.name = 'first-person-hands'
  root.renderOrder = 9
  const colors: HandColors = {
    skin: new THREE.Color('#d9a27c'),
    sleeve: new THREE.Color('#2b2f3a'),
    cuff: new THREE.Color('#f4efe6'),
  }
  const geometry = buildHandGeometry()
  const material = createHandMaterial(colors)
  const makeHand = (mirror: boolean) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = mirror ? 'first-person-hand-left' : 'first-person-hand-right'
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 9
    mesh.matrixAutoUpdate = true
    mesh.rotation.order = 'YXZ'
    root.add(mesh)
    return mesh
  }
  const right = makeHand(false)
  const left = makeHand(true)
  const cards = [createCardMesh(CARD_WIDTH), createCardMesh(CARD_WIDTH)]
  for (const card of cards) {
    // Just the card: no contact shadow on the felt, no printed face (the back is what shows).
    card.shadowMesh.visible = false
    card.faceMesh.visible = false
    card.group.visible = false
    card.group.renderOrder = 10
    card.group.traverse(object => {
      object.frustumCulled = false
      object.castShadow = false
      object.receiveShadow = false
    })
    root.add(card.group)
  }
  camera.add(root)
  const hands: FirstPersonHands = {
    root,
    right,
    left,
    geometry,
    material,
    colors,
    colorKey: '',
    cards,
    shown: createHeroHandsPose(),
    velocity: { right: createHandVelocity(), left: createHandVelocity() },
    target: createHeroHandsPose(),
    input: {
      cue: 'ready',
      elapsedMs: Number.POSITIVE_INFINITY,
      profile: { foldStyle: 'slide', checkStyle: 'single', wagerStyle: 'slide', wagerIntensity: 0 },
      peeking: false,
      winnerSeconds: -1,
      flickSeconds: -1,
      deal: null,
      time: 0,
      drunkLevel: 0,
      reducedMotion: false,
      anchors: createHeroHandsAnchors(),
    },
    anchors: createHeroHandsAnchors(),
    deal: { weight: 0, rightX: 0, rightY: 0, leftX: 0, leftY: 0, pinch: 0, cock: 0, snap: 0, holdLeft: 0 },
    wasHidden: true,
    winnerSince: -1,
    lastTime: 0,
    measureAt: 0,
    debugForce: null,
  }
  hands.input.anchors = hands.anchors
  root.visible = false
  return hands
}

const scratchPoint = new THREE.Vector3()
const clamp = (value: number, min: number, max: number) => (value < min ? min : value > max ? max : value)

function applyHand(mesh: THREE.Mesh, pose: HandPose, side: 1 | -1, tanHalf: number, aspect: number, visible: boolean) {
  const shown = visible && pose.show > 0.02
  mesh.visible = shown
  if (!shown) return
  const depth = Math.max(MIN_FORWARD, pose.depth)
  // A hand that slides away goes straight down the screen.
  const ndcY = pose.y - (1 - pose.show) * 0.55
  mesh.position.set(pose.x * depth * tanHalf * aspect, ndcY * depth * tanHalf, -depth)
  mesh.rotation.set(pose.pitch, pose.yaw * side, pose.roll * side)
  mesh.scale.set(side * HAND_SCALE, HAND_SCALE, HAND_SCALE)
  const influences = mesh.morphTargetInfluences
  if (influences) {
    influences[HAND_MORPH.fist] = pose.fist
    influences[HAND_MORPH.open] = pose.open
    influences[HAND_MORPH.pinch] = pose.pinch
    influences[HAND_MORPH.flutter] = pose.flutter
  }
}

function applyCards(hands: FirstPersonHands, tanHalf: number, aspect: number) {
  const pose = hands.shown.cards
  const [a, b] = hands.cards
  if (!a || !b) return
  a.group.visible = pose.visible
  b.group.visible = pose.visible
  if (!pose.visible) return
  const depth = Math.max(MIN_FORWARD, pose.depth)
  const fan = pose.spread
  const place = (card: CardMesh, dir: number) => {
    card.group.position.set(
      (pose.x + dir * 0.03 * fan) * depth * tanHalf * aspect,
      (pose.y + dir * 0.012 * fan) * depth * tanHalf,
      -depth
    )
    // Back up, lying on the rail seen from above: lean the top away.
    card.group.rotation.set(-Math.PI / 2 + 0.35, pose.yaw, pose.roll + dir * 0.28 * fan, 'ZYX')
    card.group.scale.setScalar(CARD_WIDTH * pose.scale)
  }
  place(a, -1)
  place(b, 1)
}

/** The seat fields the hands read (SeatRuntime satisfies this structurally). */
/** The dealer gesture's output (dealerDeal.DealerPose): wrists in the seat's own space. */
export interface HeroDealPoseLike {
  weight: number
  handR: readonly [number, number, number]
  handL: readonly [number, number, number]
  pinch: number
  cock: number
  snap: number
  holdL: number
}

export interface HeroHandsSeatLike {
  playerId: string
  root: THREE.Object3D
  dealPose?: HeroDealPoseLike
  isHero: boolean
  playback: ThreeActionPlaybackState
  actionKey: string
  actionCue: ThreeActionCue
  peeking: boolean
  winner: boolean
  passedOut: boolean
  drunkLevel: number
  wagerIntensity: number
}

export interface HeroHandsSceneLike {
  camera: THREE.PerspectiveCamera
  seats: ReadonlyMap<string, HeroHandsSeatLike>
  wagers: ReadonlyMap<string, { start: THREE.Vector3; target: THREE.Vector3 }>
  firstPersonDrink: { root: { visible: boolean } }
  pranks: {
    firstPerson: { root: { visible: boolean } }
    flicks: ReadonlyMap<string, { fromHero: boolean; startedAt: number }>
  }
  /** The dealer's deal in progress (its seat id says who is dealing). */
  dealer: { seatId: string } | null
  firstPersonHands: FirstPersonHands
}

export interface HeroHandsFrame {
  time: number
  delta: number
  width: number
  height: number
  reducedMotion: boolean
  /** The hero is seated at the table (not a spectator). */
  hero: { id: string; avatarProfile: { skinColor: string; sleeveColor: string } } | null
  /** The camera is the hero's eyes (not the full-table spectator view). */
  firstPerson: boolean
  host: HTMLElement | null
}

/** Re-measures the hole cards and the action tray (a few times a second) so the hands rest between them. */
function measureLayout(hands: FirstPersonHands, frame: HeroHandsFrame) {
  const host = frame.host
  const { anchors } = hands
  const { width, height } = frame
  // Defaults when the DOM is not there (spectators, tests): cards low and centred.
  let cardsLeft = width * 0.5 - 105
  let cardsRight = width * 0.5 + 105
  let cardsMidY = height - 130
  let trayLeft = width
  if (host) {
    const hostRect = host.getBoundingClientRect()
    const cardsEl = host.querySelector('.own-card-row') as HTMLElement | null
    const cardsBox = cardsEl?.getBoundingClientRect()
    // Only a settled, on-screen row counts (mid-animation boxes can be wild).
    if (
      cardsBox && cardsBox.width > 20 && cardsBox.width < width * 0.5 && cardsBox.height > 20 &&
      cardsBox.left - hostRect.left > 0 && cardsBox.right - hostRect.left < width &&
      cardsBox.top - hostRect.top > height * 0.5 && cardsBox.bottom - hostRect.top < height + 40
    ) {
      cardsLeft = cardsBox.left - hostRect.left
      cardsRight = cardsBox.right - hostRect.left
      cardsMidY = (cardsBox.top + cardsBox.bottom) / 2 - hostRect.top
    }
    const trayEl = host.querySelector('.betting-tray') as HTMLElement | null
    const trayBox = trayEl?.getBoundingClientRect()
    if (trayBox && trayBox.width > 20) trayLeft = trayBox.left - hostRect.left
  }
  const toNdcX = (px: number) => (px / width) * 2 - 1
  const toNdcY = (px: number) => 1 - (px / height) * 2
  anchors.cardsX = clamp(toNdcX((cardsLeft + cardsRight) / 2), -0.4, 0.4)
  anchors.cardsY = clamp(toNdcY(cardsMidY), -0.92, -0.45)
  const clearance = 62
  // Left hand just left of the cards; right hand just right of them, but never under the tray.
  anchors.restLeftX = clamp(toNdcX(cardsLeft - clearance), -0.6, -0.12)
  anchors.restRightX = clamp(toNdcX(Math.min(cardsRight + clearance, trayLeft - 70)), 0.12, 0.6)
}

function projectToNdc(point: THREE.Vector3, camera: THREE.Camera, out: { x: number; y: number }) {
  scratchPoint.copy(point).project(camera)
  // A point behind the lens projects to nonsense: keep it on screen.
  out.x = clamp(scratchPoint.x, -1, 1)
  out.y = clamp(scratchPoint.y, -1, 1)
}

const ndc = { x: 0, y: 0 }

const flickScan = { latest: -1, time: 0 }
/** Module-level so the per-frame scan allocates no closure. */
function scanFlick(flick: { fromHero: boolean; startedAt: number }) {
  if (flick.fromHero) flickScan.latest = flickScan.time - flick.startedAt
}

function wobbleHand(hand: HandPose, t: number, wobble: number) {
  hand.x += Math.sin(t * 2.3 + hand.x * 5) * 0.03 * wobble
  hand.y += Math.sin(t * 3.1 + 1.3) * 0.02 * wobble
  hand.roll += Math.sin(t * 1.9) * 0.1 * wobble
}

/**
 * Per-frame update, after the camera's final matrices (it projects the stack
 * and the betting spot through the camera). Cheap when there is no hero.
 */
export function updateHeroHands(scene: HeroHandsSceneLike, frame: HeroHandsFrame) {
  const hands = scene.firstPersonHands
  const heroSeat = frame.hero ? scene.seats.get(frame.hero.id) : undefined
  const dt = Math.min(0.1, Math.max(0, frame.time - hands.lastTime))
  hands.lastTime = frame.time
  const active = Boolean(heroSeat && frame.hero && frame.firstPerson && !heroSeat.passedOut && !hands.forceHide)
  if (!active || !heroSeat || !frame.hero) {
    hands.root.visible = false
    hands.wasHidden = true
    hands.winnerSince = -1
    return
  }
  hands.root.visible = true

  const { colors } = hands
  const key = `${frame.hero.avatarProfile.skinColor}|${frame.hero.avatarProfile.sleeveColor}`
  if (hands.colorKey !== key) {
    hands.colorKey = key
    // The same small lift the avatars' skin gets, so the hands match the body that is hidden.
    colors.skin.set(frame.hero.avatarProfile.skinColor).offsetHSL(0, 0.04, 0.02)
    colors.sleeve.set(frame.hero.avatarProfile.sleeveColor)
  }

  if (frame.time - hands.measureAt > 0.35 || hands.wasHidden) {
    hands.measureAt = frame.time
    measureLayout(hands, frame)
  }

  const { camera } = scene
  const anchors = hands.anchors
  const wager = scene.wagers.get(frame.hero.id)
  if (wager) {
    projectToNdc(wager.start, camera, ndc)
    anchors.stackX = ndc.x
    anchors.stackY = ndc.y
    projectToNdc(wager.target, camera, ndc)
    anchors.betX = ndc.x
    anchors.betY = ndc.y
  }

  const input = hands.input
  const nowMs = frame.time * 1000
  const forced = hands.debugForce
  if (forced) {
    input.cue = forced.cue
    input.elapsedMs = forced.elapsedMs
    input.peeking = Boolean(forced.peeking)
    input.winnerSeconds = forced.winnerSeconds ?? -1
    input.flickSeconds = forced.flickSeconds ?? -1
  } else {
    const snapshot = getActionPlaybackSnapshot(heroSeat.playback, nowMs)
    input.cue = snapshot.cue
    input.elapsedMs = snapshot.elapsedMs
    input.peeking = heroSeat.peeking
    if (heroSeat.winner) {
      if (hands.winnerSince < 0) hands.winnerSince = frame.time
      input.winnerSeconds = frame.time - hands.winnerSince
    } else {
      hands.winnerSince = -1
      input.winnerSeconds = -1
    }
    input.flickSeconds = -1
    if (scene.pranks.flicks.size > 0) {
      flickScan.latest = -1
      flickScan.time = frame.time
      scene.pranks.flicks.forEach(scanFlick)
      input.flickSeconds = flickScan.latest
    }
  }
  // Dealing by hand: the timeline's wrist targets (hero seat space) projected onto the screen.
  input.deal = null
  const dealPose = heroSeat.dealPose
  if (!forced && !frame.reducedMotion && scene.dealer?.seatId === heroSeat.playerId && dealPose && dealPose.weight > 0) {
    const deal = hands.deal
    heroSeat.root.updateWorldMatrix(true, false)
    scratchPoint.set(dealPose.handR[0], dealPose.handR[1], dealPose.handR[2])
    heroSeat.root.localToWorld(scratchPoint).project(camera)
    deal.rightX = clamp(scratchPoint.x, -1, 1)
    deal.rightY = clamp(scratchPoint.y, -1, 1)
    scratchPoint.set(dealPose.handL[0], dealPose.handL[1], dealPose.handL[2])
    heroSeat.root.localToWorld(scratchPoint).project(camera)
    deal.leftX = clamp(scratchPoint.x, -1, 1)
    deal.leftY = clamp(scratchPoint.y, -1, 1)
    deal.weight = dealPose.weight
    deal.pinch = dealPose.pinch
    deal.cock = dealPose.cock
    deal.snap = dealPose.snap
    deal.holdLeft = dealPose.holdL
    input.deal = deal
  }
  const profile = getPokerActionMotionProfile(input.cue, {
    actionKey: heroSeat.actionKey,
    playerId: heroSeat.playerId,
    wagerIntensity: heroSeat.wagerIntensity,
  })
  input.profile = profile
  input.time = frame.time
  input.drunkLevel = heroSeat.drunkLevel
  input.reducedMotion = frame.reducedMotion
  evaluateHeroHands(input, hands.target)

  // Drunk hands wander a little.
  const wobble = frame.reducedMotion ? 0 : Math.min(1, heroSeat.drunkLevel / 8)
  if (wobble > 0) {
    wobbleHand(hands.target.right, frame.time, wobble)
    wobbleHand(hands.target.left, frame.time, wobble)
  }
  // The drink and the shot each bring their own hand: step the matching one aside.
  const drinking = scene.firstPersonDrink.root.visible
  const shooting = scene.pranks.firstPerson.root.visible
  hands.target.left.show = drinking ? 0 : 1
  hands.target.right.show = shooting ? 0 : 1

  // First frame after being hidden: start from the target so the hands do not swoop in from stale values.
  const snap = frame.reducedMotion || hands.wasHidden
  hands.wasHidden = false
  const shown = hands.shown
  followHandPose(shown.right, hands.target.right, dt, snap, hands.velocity.right)
  followHandPose(shown.left, hands.target.left, dt, snap, hands.velocity.left)
  const cardsTarget = hands.target.cards
  Object.assign(shown.cards, cardsTarget)

  const lens = camera
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(lens.fov / 2))
  const aspect = lens.aspect
  applyHand(hands.right, shown.right, 1, tanHalf, aspect, true)
  applyHand(hands.left, shown.left, -1, tanHalf, aspect, true)
  applyCards(hands, tanHalf, aspect)
}

/** Wrist to fingertip along the drawn hand (metres, at HAND_SCALE). */
const HAND_REACH = 0.12

/**
 * Where the drawn right-hand fingertips are in the world while the hero deals by
 * hand, so a card leaves the fingers the player sees (the hands ride on the
 * camera, away from the table point the gesture works). False when the hero is
 * not dealing or the hands are hidden.
 */
export function getHeroDealTipWorld(hands: FirstPersonHands, camera: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
  if (!hands.root.visible || hands.deal.weight <= 0.001) return false
  const pose = hands.shown.right
  const depth = Math.max(MIN_FORWARD, pose.depth)
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  out.set(
    pose.x * depth * tanHalf * camera.aspect,
    pose.y * depth * tanHalf + HAND_REACH * Math.sin(pose.pitch),
    -depth - HAND_REACH * Math.cos(pose.pitch)
  )
  camera.updateMatrixWorld()
  camera.localToWorld(out)
  return Number.isFinite(out.x + out.y + out.z)
}

export function disposeFirstPersonHands(hands: FirstPersonHands | null) {
  if (!hands) return
  hands.cards.forEach(card => disposeCardMesh(card))
  hands.geometry.dispose()
  const map = hands.material.gradientMap
  map?.dispose()
  hands.material.dispose()
  hands.root.removeFromParent()
}
