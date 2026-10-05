/**
 * Showdown cinematic camera (pure, allocation-free per frame, no three.js).
 *
 * The 3D room keeps its seated first-person camera. While a showdown plays out
 * this module produces a *shot* (camera position, look-at point, lens zoom and
 * a 0..1 blend weight) that the render loop mixes over the normal camera
 * target. The story, in order:
 *
 *   1. overview   a gentle lift toward the table while the board runout and
 *                 the reveal intro finish;
 *   2. tour       a dolly/orbit to each showing opponent in the order their
 *                 cards turn over, with a brief push-in on cards and face;
 *   3. board      a held beat on the board once the winning five are lit;
 *   4. winner     a low-angle hero shot of the winner (an over-the-shoulder
 *                 view of the cards and chips when the local player won, one
 *                 wide framing for a split pot);
 *   5. release    an eased hand-back to the normal camera, never a jump.
 *
 * Folded-out hands get only the short winner beat. The tour is driven by what
 * the table view model *shows* (cards flipping face up, winner flags), so it
 * follows the server pacing instead of lengthening it, and every phase is
 * skippable: `cancel()` (click, key press) and the next hand starting both ease
 * the shot back out in a fraction of a second. Reduced motion never moves the
 * camera. All-in runouts get a mild board lean per street.
 */
import { DESKTOP_CAMERA_FRAMING } from './cameraFraming'
import {
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_SEAT_POSITIONS,
  TABLE_WAGER_Y,
} from './tableWagerLayout'
import type { ThreeTableViewModel } from './tableViewModel'

/** Every number that shapes the cinematic. Times are seconds, lengths scene units. */
export const SHOWDOWN_CAMERA_TUNING = {
  /** Blend weight ramp in for the main shot. */
  enterSeconds: 0.55,
  /** Height the camera rises by while entering or leaving a shot, so it clears the hero's chair. */
  liftHump: 0.9,
  /** Ease-out back to the normal camera: longer the farther the last shot is from it. */
  release: { baseSeconds: 0.6, perUnit: 0.05, minSeconds: 0.65, maxSeconds: 0.9 },
  /** Ease-out used when the viewer skips or the next hand starts. */
  cancelSeconds: 0.38,
  /** The server intro (runout settles, nothing flips yet) lasts about 0.9s. */
  introMinSeconds: 0.8,
  /** Hands that never flip (already tabled) start touring after this long. */
  noRevealFallbackSeconds: 1.15,
  /** The tour starts this long after the first card turns. */
  tourLeadSeconds: 0.05,
  tourBudgetSeconds: 1.2,
  minDwellSeconds: 0.4,
  maxDwellSeconds: 0.7,
  /** More showing hands than this are sampled evenly (still in reveal order). */
  maxStops: 3,
  /** Moving between scenes: longer for longer moves (seconds = base + perUnit * distance). */
  transit: { baseSeconds: 0.35, perUnit: 0.15, minSeconds: 0.35, maxSeconds: 0.9 },
  boardMinSeconds: 0.35,
  /** How long the board is held after the winning five light up. */
  boardAfterHighlightSeconds: 0.35,
  /** Longest wait for the winner flags before moving on anyway. */
  waitForWinnersSeconds: 3.4,
  winnerHoldSeconds: 1.4,
  /** The whole shot never runs longer than this before easing out. */
  maxShotSeconds: 3.4,
  /** A fold-out win: a quick winner beat only. */
  foldout: { enterSeconds: 0.6, holdSeconds: 0.8, peakWeight: 0.6 },
  /**
   * Hole cards and face of a showing opponent, shot with a long lens from the
   * near side of the table (so the board never looms in the foreground): the
   * camera slides toward the target's side (`follow` of its x), rises a little
   * and pushes in while the lens narrows to frame about `frameHeight` units at
   * the target, shrinking to `frameHeightEnd`.
   */
  stop: { follow: 0.4, height: 2.5, z: 5.7, pushIn: 0.55, frameHeight: 4.6, frameHeightEnd: 3.8, lookY: 1.1, minZoom: 0.34, maxZoom: 0.8 },
  /** The board: overview (while hands turn) and the held beat. */
  board: { position: [0, 3.0, 4.7], look: [0, 0.6, -0.35], zoom: 0.8, overviewZoom: 0.95, dolly: 0.4 },
  /** A single opponent winner: low angle from the hero side of the table. */
  winner: { distance: 6.4, pushIn: 0.6, height: 1.6, sideDegrees: 32, zoom: 0.46, lookY: 1.6 },
  /** The local player won: over the shoulder onto their cards and chips. */
  overShoulder: { position: [-0.65, 2.65, 6.5], look: [0.45, 0.5, 2.7], zoom: 0.78, dolly: 0.35 },
  /** Split pots: one wide frame around every winner. */
  split: { baseDistance: 3.8, perSpread: 0.55, maxDistance: 9.5, height: 2.6, perSpreadHeight: 0.08, maxHeight: 3.4, sideDegrees: 20, minZoom: 0.62, maxZoom: 1, lookY: 1.4 },
  /** Mild lean toward the board for each street of an all-in runout. */
  runout: { position: [0, 2.5, 5.0], zoom: 0.88, delaySeconds: 0.25, attackSeconds: 0.55, holdSeconds: 0.35, decaySeconds: 0.95, peak: [0.5, 0.58, 0.68] as readonly number[] },
  /** Where the camera may be, whatever the shot asks for. */
  bounds: {
    halfWidth: 8.2,
    minZ: -7.2,
    maxZ: 8.9,
    /** Above the rail (0.66) with room for the near plane. */
    minY: 1.08,
    maxY: 5.2,
    /** A person at the table: head and hat reach about 2.9; chair back and shoulders about 0.8 out. */
    seatCoreRadius: 0.8,
    seatOuterRadius: 1.3,
    seatTop: 2.9,
    /** The near seat is the local player's: their avatar is hidden, only the chair and a head of height remain. */
    heroSeatTop: 2.45,
    /** The board and its cards (up to ~1.15 high) stay clear. */
    boardHalfX: 2.7,
    boardMinZ: -0.95,
    boardMaxZ: 0.3,
    boardMinY: 1.6,
    boardMargin: 0.35,
  },
} as const

const T = SHOWDOWN_CAMERA_TUNING

/** A showdown camera shot. `weight` 0 means "leave the normal camera alone". */
export interface ShowdownShot {
  px: number
  py: number
  pz: number
  lx: number
  ly: number
  lz: number
  /** Multiplier on the normal field of view (below 1 zooms in). */
  zoom: number
  weight: number
  /** Extra height while the camera travels between the normal view and a shot, so it rises over the chair. */
  lift: number
}

export function createShowdownShot(): ShowdownShot {
  return { px: 0, py: 2, pz: 6, lx: 0, ly: 0.5, lz: -1, zoom: 1, weight: 0, lift: 0 }
}

export interface ShowdownSnapshotPlayer {
  id: string
  visualSeat: number
  isHero: boolean
  isWinner: boolean
  /** Still contesting the pot (not folded, has cards). */
  live: boolean
  allIn: boolean
  /** Hole cards the table can see face up (0-2). */
  revealed: number
}

export interface ShowdownSnapshot {
  /** Changes with every hand (the server hand number). */
  handKey: string | number
  phase: string
  communityCount: number
  players: readonly ShowdownSnapshotPlayer[]
}

export function createShowdownSnapshot(view: ThreeTableViewModel): ShowdownSnapshot {
  return {
    handKey: view.handNumber ?? view.roomCode,
    phase: view.phase,
    communityCount: view.communityCards.length,
    players: view.players.map(player => ({
      id: player.id,
      visualSeat: player.visualSeat,
      isHero: player.isHero,
      isWinner: player.isWinner,
      live: player.hasCards && (player.status === 'active' || player.status === 'all_in') && !player.isOutOfHand,
      allIn: player.status === 'all_in',
      revealed: player.visibleCards.length === 0
        ? 0
        : player.showCards === 'both'
          ? 2
          : player.showCards === 'left' || player.showCards === 'right' ? 1 : 0,
    })),
  }
}

// ---------------------------------------------------------------------------
// Math helpers

const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (value: number, edge0: number, edge1: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Sine ease in-out: zero velocity at both ends, gentle peak speed (1.57x the average). */
const smoother = (value: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(value, 0, 1))

// ---------------------------------------------------------------------------
// Seat geometry (static: the seats never move)

interface SeatGeometry {
  x: number
  z: number
  /** Unit vector from the seat toward the table centre. */
  dx: number
  dz: number
  faceX: number
  faceZ: number
  cardsX: number
  cardsZ: number
  /** Where the person's body is (the chair slides in toward the rail). */
  personX: number
  personZ: number
}

const FACE_INSET = 0.61
const PERSON_INSET = 0.35
const CARDS_INSET = 0.42
const FACE_Y = 1.58
const CARDS_Y = TABLE_WAGER_Y + 0.05

const SEAT_GEOMETRY: readonly SeatGeometry[] = Array.from({ length: 8 }, (_, seat) => {
  const [x, , z] = TABLE_SEAT_POSITIONS[seat as 0]
  const length = Math.hypot(x, z) || 1
  const dx = -x / length
  const dz = -z / length
  // Hole cards lie just inside the felt edge nearest the seat.
  const angle = Math.atan2(z / TABLE_FELT_SEMI_AXIS_Z, x / TABLE_FELT_SEMI_AXIS_X)
  const edgeX = Math.cos(angle) * TABLE_FELT_SEMI_AXIS_X
  const edgeZ = Math.sin(angle) * TABLE_FELT_SEMI_AXIS_Z
  const nx = Math.cos(angle) / TABLE_FELT_SEMI_AXIS_X
  const nz = Math.sin(angle) / TABLE_FELT_SEMI_AXIS_Z
  const normalLength = Math.hypot(nx, nz) || 1
  return {
    x,
    z,
    dx,
    dz,
    faceX: x + dx * FACE_INSET,
    faceZ: z + dz * FACE_INSET,
    cardsX: edgeX - (nx / normalLength) * CARDS_INSET,
    cardsZ: edgeZ - (nz / normalLength) * CARDS_INSET,
    personX: x + dx * PERSON_INSET,
    personZ: z + dz * PERSON_INSET,
  }
})

function seatGeometry(seat: number): SeatGeometry {
  return SEAT_GEOMETRY[seat >= 0 && seat < 8 ? seat : 0]!
}

// ---------------------------------------------------------------------------
// Constraints

export interface MutableVec3 {
  x: number
  y: number
  z: number
}

/**
 * Keeps a camera position above the felt, inside the room, over (never through)
 * every seat and above the board. A continuous projection: nearby inputs give nearby
 * outputs, so a shot that brushes a limit slides along it instead of popping.
 */
export function constrainShowdownCamera(position: MutableVec3): void {
  const B = T.bounds
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    position.x = 0
    position.y = 1.95
    position.z = 6.05
    return
  }
  position.x = clamp(position.x, -B.halfWidth, B.halfWidth)
  position.z = clamp(position.z, B.minZ, B.maxZ)

  // Over people, never through them: each seat is a dome (full height inside
  // the core radius, fading to nothing at the outer radius), so a camera whose
  // straight path crosses a person rides up and over their head instead of
  // being shoved sideways (which would pop when the path crosses the middle).
  let domeFloor = 0
  for (let seat = 0; seat < SEAT_GEOMETRY.length; seat += 1) {
    const g = SEAT_GEOMETRY[seat]!
    const distance = Math.hypot(position.x - g.personX, position.z - g.personZ)
    if (distance >= B.seatOuterRadius) continue
    domeFloor = Math.max(domeFloor, (seat === 0 ? B.heroSeatTop : B.seatTop) * (1 - smoothstep(distance, B.seatCoreRadius, B.seatOuterRadius)))
  }

  // Above the felt (and the board's standing cards): the floor lifts smoothly
  // as the camera nears the board's footprint.
  const outsideX = Math.max(0, Math.abs(position.x) - B.boardHalfX)
  const outsideZ = Math.max(position.z - B.boardMaxZ, B.boardMinZ - position.z, 0)
  const nearBoard = 1 - smoothstep(Math.hypot(outsideX, outsideZ), 0, B.boardMargin)
  const floorY = Math.max(lerp(B.minY, B.boardMinY, nearBoard), domeFloor)
  position.y = clamp(position.y, floorY, B.maxY)
}

function constrainShowdownLook(look: MutableVec3): void {
  const B = T.bounds
  if (!Number.isFinite(look.x) || !Number.isFinite(look.y) || !Number.isFinite(look.z)) {
    look.x = 0
    look.y = 0.6
    look.z = -0.3
    return
  }
  look.x = clamp(look.x, -B.halfWidth, B.halfWidth)
  look.y = clamp(look.y, 0.3, B.maxY)
  look.z = clamp(look.z, B.minZ, B.maxZ)
}

/**
 * Mixes a shot into the normal camera target in place and returns the lens
 * zoom to apply. Safe to call every frame (no allocation).
 */
export function blendShowdownShot(shot: ShowdownShot, position: MutableVec3, look: MutableVec3): number {
  const w = clamp(shot.weight, 0, 1)
  if (w <= 0) return 1
  position.x += (shot.px - position.x) * w
  position.y += (shot.py - position.y) * w + shot.lift
  position.z += (shot.pz - position.z) * w
  constrainShowdownCamera(position)
  look.x += (shot.lx - look.x) * w
  look.y += (shot.ly - look.y) * w
  look.z += (shot.lz - look.z) * w
  constrainShowdownLook(look)
  return 1 + (shot.zoom - 1) * w
}

// ---------------------------------------------------------------------------
// Poses (the camera a scene asks for, before blending with the normal one)

const MODE_NONE = 0
const MODE_SHOWDOWN = 1
const MODE_FOLDOUT = 2

const KIND_OVERVIEW = 0
const KIND_STOP = 1
const KIND_BOARD = 2
const KIND_WINNER = 3
const MAX_SCENES = 16

/** The runout lean: a little higher and forward, eyes on the board, kept well behind the hero's seat. */
function runoutPose(out: ShowdownShot) {
  out.px = T.runout.position[0]
  out.py = T.runout.position[1]
  out.pz = T.runout.position[2]
  out.lx = T.board.look[0]
  out.ly = T.board.look[1]
  out.lz = T.board.look[2]
  out.zoom = T.runout.zoom
}

function boardPose(u: number, zoom: number, out: ShowdownShot) {
  const board = T.board
  out.px = board.position[0]
  out.py = board.position[1]
  out.pz = board.position[2] - board.dolly * u
  out.lx = board.look[0]
  out.ly = board.look[1]
  out.lz = board.look[2]
  out.zoom = zoom
}

/** The camera orbits to the hero side of the table so it never rides through the far seats. */
function pickSide(seat: SeatGeometry, baseAngle: number, spread: number): number {
  const plus = Math.sin(baseAngle + spread)
  const minus = Math.sin(baseAngle - spread)
  if (Math.abs(plus - minus) < 0.02) return seat.x >= 0 ? -1 : 1
  return plus >= minus ? 1 : -1
}

function stopPose(seatIndex: number, u: number, out: ShowdownShot) {
  const S = T.stop
  const g = seatGeometry(seatIndex)
  out.lx = lerp(g.cardsX, g.faceX, 0.5)
  out.lz = lerp(g.cardsZ, g.faceZ, 0.5)
  out.ly = S.lookY
  out.px = out.lx * S.follow
  out.pz = S.z - S.pushIn * u
  out.py = S.height
  // Long lens: frame a fixed height at the target whatever its distance.
  const reach = Math.hypot(out.lx - out.px, out.lz - out.pz)
  const frame = lerp(S.frameHeight, S.frameHeightEnd, u)
  out.zoom = clamp((2 * Math.atan(frame / 2 / reach) * 180) / Math.PI / DESKTOP_CAMERA_FRAMING.fov, S.minZoom, S.maxZoom)
}

function overShoulderPose(u: number, out: ShowdownShot) {
  const S = T.overShoulder
  out.px = S.position[0]
  out.py = S.position[1]
  out.pz = S.position[2] - S.dolly * u
  out.lx = S.look[0]
  out.ly = S.look[1]
  out.lz = S.look[2]
  out.zoom = S.zoom
}

function winnerPose(mask: number, heroSeat: number, u: number, out: ShowdownShot) {
  if (mask === 0) {
    boardPose(u, T.board.zoom, out)
    return
  }
  // Count winners and find the centre of their faces.
  let count = 0
  let sumX = 0
  let sumZ = 0
  let lastSeat = 0
  for (let seat = 0; seat < 8; seat += 1) {
    if ((mask & (1 << seat)) === 0) continue
    const g = SEAT_GEOMETRY[seat]!
    count += 1
    sumX += g.faceX
    sumZ += g.faceZ
    lastSeat = seat
  }
  if (count === 1 && lastSeat === heroSeat) {
    overShoulderPose(u, out)
    return
  }
  if (count === 1) {
    const S = T.winner
    const g = SEAT_GEOMETRY[lastSeat]!
    out.lx = g.faceX + g.dx * 0.05
    out.lz = g.faceZ + g.dz * 0.05
    out.ly = S.lookY
    const base = Math.atan2(g.dz, g.dx)
    const spread = (S.sideDegrees * Math.PI) / 180
    const angle = base + pickSide(g, base, spread) * spread
    const distance = S.distance - S.pushIn * u
    out.px = out.lx + Math.cos(angle) * distance
    out.pz = out.lz + Math.sin(angle) * distance
    out.py = S.height
    out.zoom = S.zoom
    return
  }
  // Several winners (a split pot): one frame around all of them.
  const S = T.split
  const cx = sumX / count
  const cz = sumZ / count
  let spreadWidth = 0
  for (let a = 0; a < 8; a += 1) {
    if ((mask & (1 << a)) === 0) continue
    for (let b = a + 1; b < 8; b += 1) {
      if ((mask & (1 << b)) === 0) continue
      spreadWidth = Math.max(spreadWidth, Math.hypot(SEAT_GEOMETRY[a]!.faceX - SEAT_GEOMETRY[b]!.faceX, SEAT_GEOMETRY[a]!.faceZ - SEAT_GEOMETRY[b]!.faceZ))
    }
  }
  const centreLength = Math.hypot(cx, cz)
  // Looking back from the middle of the table toward the centroid; when the
  // winners flank the table the centroid sits at the centre, so look from the hero side.
  const dirX = centreLength > 1.2 ? -cx / centreLength : 0
  const dirZ = centreLength > 1.2 ? -cz / centreLength : 1
  const base = Math.atan2(dirZ, dirX)
  const spread = (S.sideDegrees * Math.PI) / 180
  const sign = Math.sin(base + spread) >= Math.sin(base - spread) ? 1 : -1
  const angle = base + sign * spread
  const distance = Math.min(S.maxDistance, S.baseDistance + S.perSpread * spreadWidth) - 0.35 * u
  out.lx = cx
  out.lz = cz
  out.ly = S.lookY
  out.px = cx + Math.cos(angle) * distance
  out.pz = cz + Math.sin(angle) * distance
  out.py = Math.min(S.maxHeight, S.height + S.perSpreadHeight * spreadWidth)
  out.zoom = lerp(S.minZoom, S.maxZoom, clamp(spreadWidth / 9, 0, 1))
}

function copyPose(from: ShowdownShot, to: ShowdownShot) {
  to.px = from.px
  to.py = from.py
  to.pz = from.pz
  to.lx = from.lx
  to.ly = from.ly
  to.lz = from.lz
  to.zoom = from.zoom
}

function mixPose(a: ShowdownShot, b: ShowdownShot, t: number, out: ShowdownShot) {
  out.px = lerp(a.px, b.px, t)
  out.py = lerp(a.py, b.py, t)
  out.pz = lerp(a.pz, b.pz, t)
  out.lx = lerp(a.lx, b.lx, t)
  out.ly = lerp(a.ly, b.ly, t)
  out.lz = lerp(a.lz, b.lz, t)
  out.zoom = lerp(a.zoom, b.zoom, t)
}

// ---------------------------------------------------------------------------
// The director

export interface ShowdownDirectorDebug {
  mode: 'none' | 'showdown' | 'foldout'
  stops: number[]
  winnersMask: number
  planSeconds: number
  scenes: Array<{ kind: 'overview' | 'stop' | 'board' | 'winner'; seat: number; start: number }>
}

export class ShowdownDirector {
  private mode = MODE_NONE
  private startAt = 0
  private cancelAt = -1
  private cancelWeight = 0
  private doneKey = ''
  private lastInHandKey = ''
  private sawInHand = false
  private planDirty = false
  private fallbackArmed = false
  private reveals: Array<{ seat: number; at: number }> = []
  private revealedSeen = new Uint8Array(8)
  private contested = new Uint8Array(8)
  private winnersMask = 0
  private winnersAt = -1
  private heroSeat = -1

  private sceneCount = 0
  private readonly sceneKind = new Int8Array(MAX_SCENES)
  private readonly sceneSeat = new Int8Array(MAX_SCENES)
  private readonly sceneStart = new Float64Array(MAX_SCENES)
  private readonly sceneEnd = new Float64Array(MAX_SCENES)
  private stopSeats = new Int8Array(8)
  private planEnd = Number.POSITIVE_INFINITY
  private enterSeconds: number = T.enterSeconds
  private releaseSeconds: number = T.release.minSeconds
  private peakWeight = 1

  private curIndex = -1
  private curKind = -1
  private curSeat = -1
  private curMask = -1
  private curStart = 0
  private curTransit = 0.5
  private hasLast = false
  private readonly from = createShowdownShot()
  private readonly last = createShowdownShot()
  private readonly target = createShowdownShot()
  private readonly poseMain = createShowdownShot()
  private readonly posePulse = createShowdownShot()

  private pulseStart = Number.NEGATIVE_INFINITY
  private pulsePeak = 0
  private pulseCancelAt = -1
  private pulseCancelWeight = 0
  private pulseKey = ''
  private prevCommunity = -1

  /** True while any shot (showdown or runout lean) may still be moving the camera. */
  get active(): boolean {
    return this.mode !== MODE_NONE || this.pulseStart > Number.NEGATIVE_INFINITY
  }

  /**
   * Feed the latest table view (call when the view changes, not every frame).
   * `now` is seconds on the same clock `sample` uses.
   */
  sync(snapshot: ShowdownSnapshot, now: number): void {
    const key = String(snapshot.handKey)
    if (snapshot.phase === 'in_hand') {
      // The next hand started: whatever was playing eases out.
      if (this.mode !== MODE_NONE) this.cancel(now)
      this.sawInHand = true
      this.lastInHandKey = key
      this.updateRunout(snapshot, key, now)
      return
    }
    this.prevCommunity = -1
    if (snapshot.phase !== 'between_hands') {
      this.sawInHand = false
      this.cancel(now)
      return
    }
    if (this.mode === MODE_NONE) {
      // Only a hand we watched end can play a cinematic (never a reload mid-showdown).
      if (!this.sawInHand || key !== this.lastInHandKey || key === this.doneKey) return
      let live = 0
      let winners = 0
      for (const player of snapshot.players) {
        if (player.live) live += 1
        if (player.isWinner) winners += 1
      }
      if (live >= 2) this.begin(snapshot, key, now, MODE_SHOWDOWN)
      else if (winners > 0) this.begin(snapshot, key, now, MODE_FOLDOUT)
      return
    }
    if (this.cancelAt < 0) this.updateFacts(snapshot, now)
  }

  /** Skip: a click or key press. Eases the shot out quickly. */
  cancel(now: number): void {
    if (this.mode !== MODE_NONE && this.cancelAt < 0) {
      this.cancelWeight = this.mainEnvelope(now)
      this.cancelAt = now
    }
    if (this.pulseStart > Number.NEGATIVE_INFINITY && this.pulseCancelAt < 0) {
      this.pulseCancelWeight = this.pulseEnvelope(now)
      this.pulseCancelAt = now
    }
  }

  /**
   * Writes the combined shot for `now` into `out`. Returns true when the camera
   * should be mixed (out.weight > 0). Allocation-free.
   */
  sample(now: number, reducedMotion: boolean, out: ShowdownShot): boolean {
    out.weight = 0
    out.lift = 0
    if (reducedMotion) {
      this.mode = MODE_NONE
      this.pulseStart = Number.NEGATIVE_INFINITY
      this.hasLast = false
      return false
    }
    const mainWeight = this.mainWeight(now)
    const pulseWeight = this.pulseWeight(now)
    if (mainWeight <= 0 && pulseWeight <= 0) return false
    if (mainWeight > 0) this.evaluateMain(now, this.poseMain)
    if (pulseWeight > 0) runoutPose(this.posePulse)
    const total = 1 - (1 - mainWeight) * (1 - pulseWeight)
    if (total <= 1e-5) return false
    const pulseShare = pulseWeight * (1 - mainWeight)
    const a = this.posePulse
    const b = this.poseMain
    out.px = (a.px * pulseShare + b.px * mainWeight) / total
    out.py = (a.py * pulseShare + b.py * mainWeight) / total
    out.pz = (a.pz * pulseShare + b.pz * mainWeight) / total
    out.lx = (a.lx * pulseShare + b.lx * mainWeight) / total
    out.ly = (a.ly * pulseShare + b.ly * mainWeight) / total
    out.lz = (a.lz * pulseShare + b.lz * mainWeight) / total
    out.zoom = (a.zoom * pulseShare + b.zoom * mainWeight) / total
    out.weight = total
    out.lift = T.liftHump * Math.sin(Math.PI * clamp(mainWeight, 0, 1))
    return true
  }

  /** Test and dev inspection. Allocates; never call per frame. */
  describe(): ShowdownDirectorDebug {
    const names = ['overview', 'stop', 'board', 'winner'] as const
    const scenes: ShowdownDirectorDebug['scenes'] = []
    for (let index = 0; index < this.sceneCount; index += 1) {
      scenes.push({ kind: names[this.sceneKind[index]!]!, seat: this.sceneSeat[index]!, start: this.sceneStart[index]! })
    }
    return {
      mode: this.mode === MODE_SHOWDOWN ? 'showdown' : this.mode === MODE_FOLDOUT ? 'foldout' : 'none',
      stops: scenes.filter(scene => scene.kind === 'stop').map(scene => scene.seat),
      winnersMask: this.winnersMask,
      planSeconds: this.planEnd + this.releaseSeconds,
      scenes,
    }
  }

  // -- facts ---------------------------------------------------------------

  private begin(snapshot: ShowdownSnapshot, key: string, now: number, mode: number) {
    this.mode = mode
    this.startAt = now
    this.cancelAt = -1
    this.cancelWeight = 0
    this.doneKey = key
    this.sawInHand = false
    this.reveals = []
    this.revealedSeen.fill(0)
    this.contested.fill(0)
    this.winnersMask = 0
    this.winnersAt = -1
    this.heroSeat = -1
    this.fallbackArmed = false
    this.curIndex = -1
    this.curKind = -1
    this.curSeat = -1
    this.curMask = -1
    this.hasLast = false
    this.planDirty = true
    for (const player of snapshot.players) {
      const seat = clamp(Math.round(player.visualSeat), 0, 7)
      if (player.isHero) {
        this.heroSeat = seat
        continue
      }
      if (!player.live) continue
      this.contested[seat] = 1
      // Hands already face up (tabled during an all-in runout) count as shown now.
      if (mode === MODE_SHOWDOWN && player.revealed > 0) {
        this.revealedSeen[seat] = 1
        this.reveals.push({ seat, at: now })
      }
    }
    // Tabled hands share one moment: tour them in seat order.
    this.reveals.sort((a, b) => a.seat - b.seat)
    this.updateFacts(snapshot, now)
    if (mode === MODE_FOLDOUT && this.winnersMask !== 0) this.winnersAt = now
  }

  private updateFacts(snapshot: ShowdownSnapshot, now: number) {
    let mask = 0
    for (const player of snapshot.players) {
      const seat = clamp(Math.round(player.visualSeat), 0, 7)
      if (player.isWinner) mask |= 1 << seat
      if (
        this.mode === MODE_SHOWDOWN && !player.isHero && player.live &&
        player.revealed > 0 && this.revealedSeen[seat] === 0
      ) {
        this.revealedSeen[seat] = 1
        this.contested[seat] = 1
        this.reveals.push({ seat, at: now })
        this.planDirty = true
      }
    }
    if (mask !== this.winnersMask) {
      if (this.winnersMask === 0 && mask !== 0) this.winnersAt = now
      this.winnersMask = mask
      this.planDirty = true
    }
  }

  private updateRunout(snapshot: ShowdownSnapshot, key: string, now: number) {
    if (key !== this.pulseKey) {
      this.pulseKey = key
      this.prevCommunity = snapshot.communityCount
      return
    }
    let live = 0
    let active = 0
    let allIn = 0
    for (const player of snapshot.players) {
      if (!player.live) continue
      live += 1
      if (player.allIn) allIn += 1
      else active += 1
    }
    const runout = live >= 2 && active <= 1 && allIn >= 1
    const count = snapshot.communityCount
    if (runout && count > this.prevCommunity && count >= 3 && this.mode === MODE_NONE) {
      const peaks = T.runout.peak
      this.pulseStart = now + T.runout.delaySeconds
      this.pulsePeak = peaks[Math.min(peaks.length - 1, Math.max(0, count - 3))]!
      this.pulseCancelAt = -1
    }
    this.prevCommunity = count
  }

  // -- plan ----------------------------------------------------------------

  private addScene(kind: number, seat: number, start: number) {
    if (this.sceneCount >= MAX_SCENES) return
    this.sceneKind[this.sceneCount] = kind
    this.sceneSeat[this.sceneCount] = seat
    this.sceneStart[this.sceneCount] = start
    this.sceneCount += 1
  }

  private buildPlan() {
    this.planDirty = false
    this.sceneCount = 0
    if (this.mode === MODE_FOLDOUT) {
      this.enterSeconds = T.foldout.enterSeconds
      this.peakWeight = T.foldout.peakWeight
      this.addScene(KIND_WINNER, -1, 0)
      this.planEnd = T.foldout.holdSeconds
      this.setRelease()
      this.closeScenes()
      return
    }
    this.enterSeconds = T.enterSeconds
    this.peakWeight = 1
    this.addScene(KIND_OVERVIEW, -1, 0)

    let stopCount = 0
    let tourStart: number = T.noRevealFallbackSeconds
    if (this.reveals.length > 0) {
      const total = this.reveals.length
      const shown = Math.min(total, T.maxStops)
      for (let index = 0; index < shown; index += 1) {
        // Evenly sampled when the table is crowded, always in reveal order.
        const pick = shown === total ? index : Math.round((index * (total - 1)) / (shown - 1))
        this.stopSeats[stopCount++] = this.reveals[pick]!.seat
      }
      tourStart = Math.max(T.introMinSeconds, this.reveals[0]!.at - this.startAt + T.tourLeadSeconds)
    } else if (this.fallbackArmed) {
      for (let seat = 0; seat < 8 && stopCount < T.maxStops; seat += 1) if (this.contested[seat]) this.stopSeats[stopCount++] = seat
    } else {
      // Waiting for the first card to turn: hold the overview.
      this.planEnd = Number.POSITIVE_INFINITY
      this.setRelease()
      this.closeScenes()
      return
    }

    const dwell = stopCount > 0
      ? clamp(T.tourBudgetSeconds / stopCount, T.minDwellSeconds, T.maxDwellSeconds)
      : 0
    for (let index = 0; index < stopCount; index += 1) {
      this.addScene(KIND_STOP, this.stopSeats[index]!, tourStart + index * dwell)
    }
    const boardStart = tourStart + stopCount * dwell
    const winnersRel = this.winnersAt >= 0 ? this.winnersAt - this.startAt : -1
    const boardEnd = winnersRel >= 0
      ? Math.max(boardStart + T.boardMinSeconds, winnersRel + T.boardAfterHighlightSeconds)
      : Math.max(boardStart + T.boardMinSeconds, T.waitForWinnersSeconds)
    this.addScene(KIND_BOARD, -1, boardStart)
    this.addScene(KIND_WINNER, -1, boardEnd)
    this.planEnd = Math.min(boardEnd + T.winnerHoldSeconds, T.maxShotSeconds)
    this.setRelease()
    this.closeScenes()
  }

  /** The farther the last shot is from the normal camera, the longer the way home takes. */
  private setRelease() {
    const last = this.target
    winnerPose(this.winnersMask, this.heroSeat, 1, last)
    const home = DESKTOP_CAMERA_FRAMING.position
    const reach = Math.hypot(last.px - home[0], last.py - home[1], last.pz - home[2]) * this.peakWeight
    const R = T.release
    this.releaseSeconds = clamp(R.baseSeconds + R.perUnit * reach, R.minSeconds, R.maxSeconds)
  }

  private closeScenes() {
    for (let index = 0; index < this.sceneCount; index += 1) {
      this.sceneEnd[index] = index + 1 < this.sceneCount ? this.sceneStart[index + 1]! : this.planEnd
    }
  }

  // -- weights -------------------------------------------------------------

  /** Blend envelope of the main shot ignoring any cancel. */
  private mainEnvelope(now: number): number {
    if (this.mode === MODE_NONE) return 0
    const t = now - this.startAt
    let weight = this.peakWeight * smoother(t / this.enterSeconds)
    if (t > this.planEnd) weight *= 1 - smoother((t - this.planEnd) / this.releaseSeconds)
    return weight
  }

  private mainWeight(now: number): number {
    if (this.mode === MODE_NONE) return 0
    if (this.cancelAt >= 0) {
      const progress = (now - this.cancelAt) / T.cancelSeconds
      if (progress >= 1) {
        this.mode = MODE_NONE
        this.hasLast = false
        return 0
      }
      return this.cancelWeight * (1 - smoother(progress))
    }
    if (now - this.startAt > this.planEnd + this.releaseSeconds) {
      this.mode = MODE_NONE
      this.hasLast = false
      return 0
    }
    return this.mainEnvelope(now)
  }

  private pulseEnvelope(now: number): number {
    const R = T.runout
    const t = now - this.pulseStart
    if (t <= 0) return 0
    if (t < R.attackSeconds) return this.pulsePeak * smoother(t / R.attackSeconds)
    if (t < R.attackSeconds + R.holdSeconds) return this.pulsePeak
    const decay = (t - R.attackSeconds - R.holdSeconds) / R.decaySeconds
    return decay >= 1 ? 0 : this.pulsePeak * (1 - smoother(decay))
  }

  private pulseWeight(now: number): number {
    if (this.pulseStart === Number.NEGATIVE_INFINITY) return 0
    const R = T.runout
    if (this.pulseCancelAt >= 0) {
      const progress = (now - this.pulseCancelAt) / T.cancelSeconds
      if (progress >= 1) {
        this.pulseStart = Number.NEGATIVE_INFINITY
        this.pulseCancelAt = -1
        return 0
      }
      return this.pulseCancelWeight * (1 - smoother(progress))
    }
    if (now - this.pulseStart > R.attackSeconds + R.holdSeconds + R.decaySeconds) {
      this.pulseStart = Number.NEGATIVE_INFINITY
      return 0
    }
    return this.pulseEnvelope(now)
  }

  // -- main shot -----------------------------------------------------------

  private evaluateMain(now: number, out: ShowdownShot) {
    // A cancelled shot is frozen at the moment of the cancel while it fades.
    const t = (this.cancelAt >= 0 ? this.cancelAt : now) - this.startAt
    if (!this.fallbackArmed && this.reveals.length === 0 && t >= T.noRevealFallbackSeconds) {
      this.fallbackArmed = true
      this.planDirty = true
    }
    // Once the ease-out has begun its length is fixed: late facts cannot move it.
    if (this.planDirty) {
      if (t > this.planEnd) this.planDirty = false
      else this.buildPlan()
    }

    let index = 0
    for (let scene = 1; scene < this.sceneCount; scene += 1) {
      if (this.sceneStart[scene]! <= t) index = scene
    }
    const kind = this.sceneKind[index]!
    const seat = this.sceneSeat[index]!
    const start = this.sceneStart[index]!
    const end = this.sceneEnd[index]!
    const length = Number.isFinite(end) ? Math.max(0.05, end - start) : 1.5
    const u = clamp((t - start) / length, 0, 1)
    const target = this.target
    if (kind === KIND_STOP) stopPose(seat, u, target)
    else if (kind === KIND_BOARD) boardPose(u, T.board.zoom, target)
    else if (kind === KIND_WINNER) winnerPose(this.winnersMask, this.heroSeat, u, target)
    else boardPose(clamp(u * 0.5, 0, 1), T.board.overviewZoom, target)

    const retarget = index !== this.curIndex || kind !== this.curKind || seat !== this.curSeat ||
      (kind === KIND_WINNER && this.winnersMask !== this.curMask)
    if (retarget) {
      // Every scene change eases from wherever the camera is right now.
      copyPose(this.hasLast ? this.last : target, this.from)
      this.curIndex = index
      this.curKind = kind
      this.curSeat = seat
      this.curMask = this.winnersMask
      this.curStart = t
      const X = T.transit
      const travel = Math.hypot(target.px - this.from.px, target.py - this.from.py, target.pz - this.from.pz)
      this.curTransit = Math.min(
        clamp(X.baseSeconds + X.perUnit * travel, X.minSeconds, X.maxSeconds),
        Math.max(0.1, length * (kind === KIND_STOP ? 1.1 : 0.95))
      )
    }

    mixPose(this.from, target, smoother((t - this.curStart) / this.curTransit), out)
    copyPose(out, this.last)
    this.hasLast = true
  }
}
