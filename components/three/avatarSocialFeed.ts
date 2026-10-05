import * as THREE from 'three'
import {
  SOCIAL_ACTION_WINDOW_SECONDS,
  createAvatarSocialInput,
  type AvatarSocialInput,
} from './avatarReactions'
import type { Vec3 } from './pokerActionPose'
import type { ThreeActionCue, ThreePlayerView } from './tableViewModel'

/**
 * Room-side feed for the social reactions (avatarReactions.ts): once per frame
 * it finds the latest actions, the pot winner and the hero's camera; per seat
 * it turns them into head bearings in that seat's own space and fills the
 * seat's pooled AvatarSocialInput. Allocation-free after setup.
 */

/** The parts of a seat runtime the feed reads (SeatRuntime satisfies this structurally). */
export interface SocialSeat {
  visualSeat: number
  isHero: boolean
  acting: boolean
  winner: boolean
  root: THREE.Object3D
  avatar: { bones: ReadonlyMap<string, THREE.Bone> } | null
  playback: { key: string; cue: ThreeActionCue; startedAtMs: number }
  wagerIntensity: number
  anchors: { chin: Vec3 }
  social: AvatarSocialInput
}

interface ActionRecord {
  seat: SocialSeat | null
  age: number
  cue: ThreeActionCue
  key: number
}

export interface TableSocialFrame {
  viewer: THREE.Vector3
  hasViewer: boolean
  hero: SocialSeat | null
  heroActing: boolean
  /** The two most recent actions (newest first), so a seat can skip its own. */
  latest: ActionRecord
  previous: ActionRecord
  winner: SocialSeat | null
  winnerSince: number
  inverse: THREE.Matrix4
  scratch: THREE.Vector3
}

function createRecord(): ActionRecord {
  return { seat: null, age: Number.POSITIVE_INFINITY, cue: 'ready', key: 0 }
}

export function createTableSocialFrame(): TableSocialFrame {
  return {
    viewer: new THREE.Vector3(0, 1.6, 6),
    hasViewer: false,
    hero: null,
    heroActing: false,
    latest: createRecord(),
    previous: createRecord(),
    winner: null,
    winnerSince: Number.NEGATIVE_INFINITY,
    inverse: new THREE.Matrix4(),
    scratch: new THREE.Vector3(),
  }
}

function setRecord(record: ActionRecord, seat: SocialSeat, age: number, cue: ThreeActionCue, key: number) {
  record.seat = seat
  record.age = age
  record.cue = cue
  record.key = key
}

/** Once per frame, before the seats animate. */
export function updateTableSocialFrame(
  frame: TableSocialFrame,
  seats: Iterable<SocialSeat>,
  camera: THREE.Object3D | null,
  time: number
) {
  if (camera) {
    camera.getWorldPosition(frame.viewer)
    frame.hasViewer = true
  }
  frame.hero = null
  frame.latest.seat = null
  frame.latest.age = Number.POSITIVE_INFINITY
  frame.previous.seat = null
  frame.previous.age = Number.POSITIVE_INFINITY
  let winner: SocialSeat | null = null
  for (const seat of seats) {
    if (seat.isHero) frame.hero = seat
    if (seat.winner && !winner) winner = seat
    const playback = seat.playback
    if (!playback.key || playback.cue === 'ready' || !Number.isFinite(playback.startedAtMs)) continue
    const age = time - playback.startedAtMs / 1000
    if (!(age >= 0 && age < SOCIAL_ACTION_WINDOW_SECONDS)) continue
    if (age < frame.latest.age) {
      const old = frame.latest
      if (old.seat) setRecord(frame.previous, old.seat, old.age, old.cue, old.key)
      setRecord(frame.latest, seat, age, playback.cue, playback.startedAtMs)
    } else if (age < frame.previous.age) {
      setRecord(frame.previous, seat, age, playback.cue, playback.startedAtMs)
    }
  }
  frame.heroActing = Boolean(frame.hero?.acting)
  frame.winner = winner
  if (winner) {
    if (!Number.isFinite(frame.winnerSince)) frame.winnerSince = time
  } else {
    frame.winnerSince = Number.NEGATIVE_INFINITY
  }
}

function seatSteps(a: number, b: number) {
  const diff = Math.abs(a - b) % 8
  return Math.min(diff, 8 - diff)
}

let bearingYaw = 0
let bearingPitch = 0

/** Head yaw / pitch (radians, +pitch down) from this seat's eyes to a world point. frame.inverse must be this seat's. */
function bearingTo(seat: SocialSeat, frame: TableSocialFrame, world: THREE.Vector3) {
  const local = frame.scratch.copy(world).applyMatrix4(frame.inverse)
  const chin = seat.anchors.chin
  // The head centre sits a little above and behind the chin anchor.
  const dx = local.x
  const dz = local.z - (chin[2] + 0.26)
  bearingYaw = Math.atan2(-dx, -dz)
  bearingPitch = Math.atan2(chin[1] + 0.11 - local.y, Math.hypot(dx, dz))
}

const EYE_RISE = 0.12

/** World position of a seat's face (its head bone), or a guess from the seat root. */
function facePosition(target: SocialSeat, out: THREE.Vector3) {
  const bone = target.avatar?.bones.get('Head')
  if (bone) {
    const e = bone.matrixWorld.elements
    out.set(e[12]!, e[13]! + EYE_RISE, e[14]!)
  } else {
    target.root.getWorldPosition(out)
    out.y += 1.45 * target.root.scale.y
  }
}

/** Sets the per-hand facts that change with the table state (not per frame). */
export function setSeatSocialStats(
  social: AvatarSocialInput,
  player: Pick<ThreePlayerView, 'bet' | 'stack' | 'committed' | 'status' | 'hasCards' | 'isOutOfHand' | 'odds'>,
  view: { currentBet: number; bigBlind: number }
) {
  const inHand = player.hasCards && !player.isOutOfHand
  social.allIn = inHand && player.status === 'all_in'
  const committed = Math.max(player.committed ?? 0, player.bet)
  social.atRisk = !inHand
    ? 0
    : social.allIn
      ? 1
      : Math.min(1, (1.3 * committed) / Math.max(1, committed + player.stack))
  const toCall = Math.max(0, view.currentBet - player.bet)
  social.facingBet = Math.max(0, Math.min(1, Math.log2(toCall / Math.max(1, view.bigBlind) + 1) / 3.5))
  social.oddsWin = player.odds && Number.isFinite(player.odds.winPercent) ? player.odds.winPercent : -1
}

/** Per seat, per frame: fills the moment-to-moment social input (events and bearings). */
export function fillSeatSocial(seat: SocialSeat, frame: TableSocialFrame, time: number): AvatarSocialInput {
  const social = seat.social
  const playback = seat.playback
  if (playback.key && playback.cue !== 'ready' && Number.isFinite(playback.startedAtMs)) {
    social.selfCue = playback.cue
    social.selfCueAge = Math.max(0, time - playback.startedAtMs / 1000)
    social.selfKey = playback.startedAtMs
  } else {
    social.selfCue = 'ready'
    social.selfCueAge = Number.POSITIVE_INFINITY
    social.selfKey = 0
  }

  social.actorCue = 'ready'
  social.actorAge = Number.POSITIVE_INFINITY
  social.heroActing = false
  social.actorIsHero = false
  social.winnerAge = Number.POSITIVE_INFINITY
  social.winnerIsHero = false
  // The hero's own (first-person, hidden) avatar reacts to nobody.
  if (seat.isHero) return social

  const actor = frame.latest.seat === seat ? frame.previous : frame.latest
  const actorSeat = actor.seat && actor.seat !== seat ? actor.seat : null
  const winnerSeat = frame.winner && frame.winner !== seat ? frame.winner : null
  const heroSeat = frame.hero && frame.hero !== seat && frame.hasViewer ? frame.hero : null
  const heroActing = Boolean(heroSeat && frame.heroActing)
  if (!actorSeat && !winnerSeat && !heroActing) return social

  frame.inverse.copy(seat.root.matrixWorld).invert()

  if (heroActing) {
    bearingTo(seat, frame, frame.viewer)
    social.heroActing = true
    social.heroYaw = bearingYaw
    social.heroPitch = bearingPitch
  }
  if (actorSeat && !(actorSeat.isHero && !frame.hasViewer)) {
    social.actorCue = actor.cue
    social.actorAge = actor.age
    social.actorKey = actor.key
    social.actorWager = Math.max(0, Math.min(1, actorSeat.wagerIntensity))
    social.actorSteps = seatSteps(seat.visualSeat, actorSeat.visualSeat)
    social.actorIsHero = actorSeat.isHero
    if (actorSeat.isHero) {
      bearingTo(seat, frame, frame.viewer)
    } else {
      facePosition(actorSeat, actorFacePoint)
      bearingTo(seat, frame, actorFacePoint)
    }
    social.actorYaw = bearingYaw
    social.actorPitch = bearingPitch
  }
  if (winnerSeat && !(winnerSeat.isHero && !frame.hasViewer)) {
    social.winnerAge = Math.max(0, time - frame.winnerSince)
    social.winnerKey = Math.round(frame.winnerSince * 1000)
    social.winnerSteps = seatSteps(seat.visualSeat, winnerSeat.visualSeat)
    social.winnerIsHero = winnerSeat.isHero
    if (winnerSeat.isHero) {
      bearingTo(seat, frame, frame.viewer)
    } else {
      facePosition(winnerSeat, actorFacePoint)
      bearingTo(seat, frame, actorFacePoint)
    }
    social.winnerYaw = bearingYaw
    social.winnerPitch = bearingPitch
  }
  return social
}

const actorFacePoint = new THREE.Vector3()

export { createAvatarSocialInput }
