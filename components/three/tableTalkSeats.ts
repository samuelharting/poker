import * as THREE from 'three'
import {
  chatWindowIndex,
  createTableChat,
  fillSeatChat,
  planTableTalk,
  type TableChat,
  type TableTalkPlan,
  type TalkCandidate,
} from './tableTalk'

/**
 * Maps the table-talk schedule (tableTalk.ts) onto the seat runtimes: who can
 * take part, and which way each side has to turn to face the other.
 */

/** The parts of a seat runtime this needs (SeatRuntime satisfies it structurally). */
export interface TableTalkSeat {
  playerId: string
  visualSeat: number
  isHero: boolean
  passedOut: boolean
  root: THREE.Object3D
  avatar: object | null
  /** Per-seat storage for the chat (rewritten in place every frame). */
  chatSlot?: TableChat
}

const plans = new WeakMap<object, TableTalkPlan>()
const scratch = new THREE.Vector3()
const MAX_TURN = 1.35

function canTalk(seat: TableTalkSeat) {
  return !seat.isHero && seat.root.visible && seat.avatar !== null
}

function getPlan(seats: ReadonlyMap<string, TableTalkSeat>, windowIndex: number): TableTalkPlan {
  const cached = plans.get(seats)
  if (cached && cached.windowIndex === windowIndex) return cached
  // Once a window (not per frame): the seated opponents in seat order. Someone who is passed out
  // at the start of the window is not asked to talk; anyone who leaves mid-window just ends it.
  const candidates: TalkCandidate[] = []
  for (const seat of seats.values()) {
    if (canTalk(seat) && !seat.passedOut) candidates.push({ playerId: seat.playerId, visualSeat: seat.visualSeat })
  }
  candidates.sort((a, b) => a.visualSeat - b.visualSeat)
  const plan = planTableTalk(windowIndex, candidates)
  plans.set(seats, plan)
  return plan
}

/**
 * This seat's part in the current conversation, or null. The returned object is
 * the seat's own slot (rewritten every call), so nothing is allocated per frame.
 * Whether the seat is free to chat (not acting, drinking, celebrating...) is the
 * animator's call: it knows the whole state.
 */
export function getSeatTableChat(seat: TableTalkSeat, seats: ReadonlyMap<string, TableTalkSeat>, time: number): TableChat | null {
  if (!canTalk(seat) || !Number.isFinite(time)) return null
  const plan = getPlan(seats, chatWindowIndex(time))
  if (plan.conversations.length === 0) return null
  const chat = seat.chatSlot ?? (seat.chatSlot = createTableChat())
  if (!fillSeatChat(plan, seat.playerId, time, chat)) return null
  const partner = seats.get(chat.partnerId)
  if (!partner || !canTalk(partner) || partner.passedOut) return null
  // Which way to turn: the partner's position in this seat's frame (-Z faces the table, +X is the
  // player's right), in the animator's turn convention.
  partner.root.getWorldPosition(scratch)
  seat.root.worldToLocal(scratch)
  const yaw = Math.atan2(-scratch.x, -scratch.z)
  chat.yaw = yaw > MAX_TURN ? MAX_TURN : yaw < -MAX_TURN ? -MAX_TURN : yaw
  return chat
}
