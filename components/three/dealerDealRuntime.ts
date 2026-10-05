import * as THREE from 'three'
import type { AvatarAnchors } from './avatarAnimator'
import {
  buildBoardDealSchedule,
  buildHoleDealSchedule,
  canDealerDeal,
  findDealCard,
  getBoardCardOffsets,
  getDealCardRelease,
  getHoleDealTiming,
  planBoardDeal,
  type DealerSchedule,
} from './dealerDeal'
import type { Vec3 } from './pokerActionPose'
import { BOARD_XS, BOARD_Z, FELT_TOP_Y } from './tableArt'

/**
 * The scene side of the dealer's deal: turns the pure timeline (dealerDeal.ts)
 * into world positions, using the seat's real hand when its rig is loaded and
 * the timeline's own hand position otherwise (an unloaded rig, the hidden hero).
 * Lives outside the room file; the room only keeps one DealerRuntime and calls in.
 */

/** The bits of a seat the dealer's deal reads (SeatRuntime satisfies this structurally). */
export interface DealerSeatLike {
  playerId: string
  root: THREE.Object3D
  avatar: { bones: ReadonlyMap<string, THREE.Bone> } | null
  anchors: AvatarAnchors
  isHero: boolean
  cards: THREE.Object3D
  cardLocalZ: number
}

export interface DealerRuntime {
  seatId: string
  schedule: DealerSchedule
  kind: 'hole' | 'board'
  /** Hole deals: how many seats are dealt in (cards per round). */
  count: number
}

/** The player-view fields that decide whether the dealer deals by hand. */
export interface DealerPlayerLike {
  id: string
  isDealer: boolean
  isHero: boolean
  isOutOfHand: boolean
  awayLabel?: string
  drinks?: { passedOut?: boolean } | null
}

/** The seat that will physically deal this hand or street, or null (fall back to the deck point). */
export function findDealingSeat<S extends DealerSeatLike & { avatarLoaded?: boolean }>(
  players: readonly DealerPlayerLike[],
  seats: ReadonlyMap<string, S>,
  reducedMotion: boolean,
  isRigLoaded: (seat: S) => boolean
): S | null {
  const dealer = players.find(player => player.isDealer)
  if (!dealer) return null
  const seat = seats.get(dealer.id)
  if (!seat) return null
  const ok = canDealerDeal({
    reducedMotion,
    isHero: dealer.isHero,
    hasRig: isRigLoaded(seat),
    away: Boolean(dealer.awayLabel),
    passedOut: Boolean(dealer.drinks?.passedOut),
    folded: dealer.isOutOfHand,
  })
  return ok ? seat : null
}

const worldPoint = new THREE.Vector3()
const localPoint = new THREE.Vector3()
const wristWorld = new THREE.Vector3()
const knuckleWorld = new THREE.Vector3()
const expected = new THREE.Vector3()
const expectedLocal: Vec3 = [0, 0, 0]

/** A world point in the dealer seat's space. */
export function toSeatSpace(seat: DealerSeatLike, x: number, y: number, z: number): Vec3 {
  seat.root.updateWorldMatrix(true, false)
  localPoint.set(x, y, z)
  seat.root.worldToLocal(localPoint)
  return [localPoint.x, localPoint.y, localPoint.z]
}

/** Where a seat's hole cards lie (world). */
function holeCardsWorld(seat: DealerSeatLike, out: THREE.Vector3) {
  seat.root.updateWorldMatrix(true, false)
  const restY = Number(seat.cards.userData.restY ?? seat.anchors.cards[1])
  return seat.root.localToWorld(out.set(0, restY, seat.cardLocalZ))
}

/** Hole-card deal for `recipients` (in dealing order, the dealer's own seat last). */
export function createHoleDeal(dealer: DealerSeatLike, recipients: readonly DealerSeatLike[], startedAt: number): DealerRuntime {
  const targets = recipients.map(seat => {
    holeCardsWorld(seat, worldPoint)
    return toSeatSpace(dealer, worldPoint.x, worldPoint.y, worldPoint.z)
  })
  const timing = getHoleDealTiming(recipients.length, true)
  return {
    seatId: dealer.playerId,
    schedule: buildHoleDealSchedule(startedAt, targets, timing),
    kind: 'hole',
    count: recipients.length,
  }
}

/** The plan and card offsets for dealing the board slots in `slots` (ascending). */
export function planDealerBoard(slots: readonly number[]) {
  const plan = planBoardDeal(slots)
  return { plan, offsets: getBoardCardOffsets(plan) }
}

/** Board deal (burn cards included) starting at scene time `startedAt`. */
export function createBoardDeal(dealer: DealerSeatLike, plan: ReturnType<typeof planBoardDeal>, startedAt: number): DealerRuntime {
  const slotTargets = BOARD_XS.map(x => toSeatSpace(dealer, x, FELT_TOP_Y + 0.05, BOARD_Z))
  return {
    seatId: dealer.playerId,
    schedule: buildBoardDealSchedule(startedAt, plan, slotTargets),
    kind: 'board',
    count: 0,
  }
}

/**
 * The hero's own hands are drawn on the camera, so while they deal the card has to
 * leave those drawn fingertips (set by the room; see getHeroDealTipWorld).
 */
let heroTipProvider: ((out: THREE.Vector3) => boolean) | null = null
export function setHeroDealTipProvider(provider: ((out: THREE.Vector3) => boolean) | null, onlyIf?: (out: THREE.Vector3) => boolean) {
  // (A disposing scene only clears its own provider, never a newer scene's.)
  if (onlyIf && heroTipProvider !== onlyIf) return
  heroTipProvider = provider
}

/**
 * Where card `cardIndex` of the dealer's schedule leaves the hand, in world
 * space. Reads the live fingertips when the rig is loaded (and they are where
 * the gesture says they should be), else the timeline's own release point.
 */
export function getDealerReleaseWorld(deal: DealerRuntime, dealer: DealerSeatLike, cardIndex: number, out: THREE.Vector3): boolean {
  if (cardIndex < 0 || cardIndex >= deal.schedule.cards.length) return false
  if (dealer.isHero && heroTipProvider && heroTipProvider(out)) return true
  dealer.root.updateWorldMatrix(true, false)
  getDealCardRelease(deal.schedule, cardIndex, dealer.anchors, expectedLocal)
  expected.set(expectedLocal[0], expectedLocal[1], expectedLocal[2])
  dealer.root.localToWorld(expected)
  const wrist = dealer.isHero ? undefined : dealer.avatar?.bones.get('WristR')
  if (wrist) {
    wrist.getWorldPosition(wristWorld)
    const knuckle = dealer.avatar?.bones.get('Middle1R')
    if (knuckle) {
      knuckle.getWorldPosition(knuckleWorld)
      wristWorld.lerp(knuckleWorld, 0.75)
    }
    // A hand that is nowhere near the gesture (a rig mid-load) is not a launch point.
    if (Number.isFinite(wristWorld.x + wristWorld.y + wristWorld.z) && wristWorld.distanceTo(expected) < 1.4) {
      out.copy(wristWorld)
      return true
    }
  }
  out.copy(expected)
  return true
}

/** Convenience for the room: the card index for a hole card or board slot. */
export function findHoleCardIndex(deal: DealerRuntime, order: number, round: number): number {
  return deal.kind === 'hole' ? findDealCard(deal.schedule, 'hole', order, round, deal.count) : -1
}

export function findBoardCardIndex(deal: DealerRuntime, slot: number): number {
  return deal.kind === 'board' ? findDealCard(deal.schedule, 'board', slot, 0, 0) : -1
}
