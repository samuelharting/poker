/**
 * Table talk and the yawn: the two idle social behaviours that live between
 * hands.
 *
 * Table talk is a deterministic schedule with no shared state. Time is cut into
 * fixed windows; the window index seeds everything (is there a conversation,
 * who speaks, who listens, when it starts, how long it lasts, whether it ends
 * in a laugh), so every seat computes the same plan on its own and agrees on
 * who is talking to whom. Not every window has a conversation; a busy table
 * (five or more opponents) can have two at once. This file is pure (no three,
 * no allocation per frame): tableTalkSeats.ts maps it onto seat runtimes, the
 * animator turns a seat's part into body language, and the face director into
 * a talking jaw, a listener's smile and a laugh.
 */

/** Seconds per schedule window. */
export const CHAT_WINDOW_SECONDS = 10
/** Chance a window holds a conversation, and (on a table of five or more) a second one. */
const CHAT_CHANCE = 0.55
const SECOND_CHAT_CHANCE = 0.35
/** Opponents farther apart than this many visual seats are not neighbours. */
const MAX_SEAT_GAP = 2

export interface TalkCandidate {
  playerId: string
  visualSeat: number
}

export interface TableConversation {
  speakerId: string
  listenerId: string
  /** Seconds after the window start, and how long the exchange lasts (including the laugh, if any). */
  start: number
  duration: number
  /** Seconds into the exchange when the speaker stops talking (a laugh follows when `laugh`). */
  talkEnd: number
  laugh: boolean
}

export interface TableTalkPlan {
  windowIndex: number
  conversations: TableConversation[]
}

/** One seat's part in a conversation (the room keeps one of these per seat and rewrites it in place). */
export interface TableChat {
  role: 'speak' | 'listen'
  partnerId: string
  /** Direction to the partner in seat space (animator turn convention: positive turns toward the seat's -x side). */
  yaw: number
  /** Seconds since the exchange began, and its total length. */
  elapsed: number
  duration: number
  /** When the speaker stops talking (seconds into the exchange). */
  talkEnd: number
  laugh: boolean
}

export function createTableChat(): TableChat {
  return { role: 'listen', partnerId: '', yaw: 0, elapsed: 0, duration: 0, talkEnd: 0, laugh: false }
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  // Consecutive window indices give correlated first draws: stir them.
  next()
  next()
  next()
  return next
}

export function chatWindowIndex(time: number) {
  return Math.floor(time / CHAT_WINDOW_SECONDS)
}

/**
 * The conversations of one window. `candidates` must be sorted by visual seat
 * (opponents who are seated and in view); the result only depends on the window
 * index and that list.
 */
export function planTableTalk(windowIndex: number, candidates: readonly TalkCandidate[]): TableTalkPlan {
  const plan: TableTalkPlan = { windowIndex, conversations: [] }
  if (candidates.length < 2) return plan
  const random = seededRandom((Math.imul(windowIndex + 1, 2654435761) ^ 0x9e3779b9) >>> 0)
  const taken = new Set<string>()
  const slots = candidates.length >= 5 ? 2 : 1
  for (let slot = 0; slot < slots; slot += 1) {
    const chance = slot === 0 ? CHAT_CHANCE : SECOND_CHAT_CHANCE
    // Always draw the same numbers per slot, so one slot's outcome never shifts the next.
    const roll = random()
    const pick = random()
    const sideRoll = random()
    const stepRoll = random()
    const startRoll = random()
    const lengthRoll = random()
    const laughRoll = random()
    if (roll > chance) continue
    const free = candidates.filter(candidate => !taken.has(candidate.playerId))
    if (free.length < 2) continue
    const speaker = free[Math.floor(pick * free.length)]!
    const index = free.indexOf(speaker)
    const wanted = (sideRoll < 0.5 ? 1 : -1) * (stepRoll < 0.7 ? 1 : 2)
    let listener: TalkCandidate | undefined
    for (const step of [wanted, -wanted, wanted > 0 ? 1 : -1, wanted > 0 ? -1 : 1]) {
      const other = free[index + step]
      if (other && Math.abs(other.visualSeat - speaker.visualSeat) <= MAX_SEAT_GAP) {
        listener = other
        break
      }
    }
    if (!listener) continue
    const laugh = laughRoll < 0.45
    const duration = Math.max(laugh ? 3.6 : 2.6, 2.6 + lengthRoll * 2.8)
    plan.conversations.push({
      speakerId: speaker.playerId,
      listenerId: listener.playerId,
      start: 0.5 + startRoll * 2.2,
      duration,
      talkEnd: laugh ? duration - 1.5 : duration - 0.4,
      laugh,
    })
    taken.add(speaker.playerId)
    taken.add(listener.playerId)
  }
  return plan
}

/**
 * Writes `playerId`'s part in this window's plan into `out` (no allocation).
 * Returns false when the seat is not talking right now. `yaw` is left for the
 * caller, which knows where the partner sits.
 */
export function fillSeatChat(plan: TableTalkPlan, playerId: string, time: number, out: TableChat): boolean {
  if (chatWindowIndex(time) !== plan.windowIndex) return false
  const local = time - plan.windowIndex * CHAT_WINDOW_SECONDS
  for (let index = 0; index < plan.conversations.length; index += 1) {
    const talk = plan.conversations[index]!
    const speaking = talk.speakerId === playerId
    if (!speaking && talk.listenerId !== playerId) continue
    const elapsed = local - talk.start
    if (elapsed < 0 || elapsed > talk.duration) return false
    out.role = speaking ? 'speak' : 'listen'
    out.partnerId = speaking ? talk.listenerId : talk.speakerId
    out.elapsed = elapsed
    out.duration = talk.duration
    out.talkEnd = talk.talkEnd
    out.laugh = talk.laugh
    return true
  }
  return false
}

function smooth(value: number) {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value
  return clamped * clamped * (3 - 2 * clamped)
}

/** 0..1: fades in over the first half second and out over the last 0.6s of the exchange. */
export function chatWeight(chat: TableChat) {
  return Math.min(smooth(chat.elapsed / 0.5), smooth((chat.duration - chat.elapsed) / 0.6))
}

/** 0..1: the speaker is talking (a short beat after the turn, a short beat before the end). */
export function chatTalkAmount(chat: TableChat) {
  if (chat.role !== 'speak') return 0
  return smooth((chat.elapsed - 0.3) / 0.3) * smooth((chat.talkEnd - chat.elapsed) / 0.3)
}

/** 0..1: a warm smile while listening (builds as the story goes), or the speaker's grin at the punchline. */
export function chatSmileAmount(chat: TableChat) {
  const fade = smooth((chat.duration - chat.elapsed) / 0.7)
  if (chat.role === 'listen') return smooth((chat.elapsed - 0.5) / 0.9) * fade
  return chat.laugh ? smooth((chat.elapsed - (chat.talkEnd - 0.5)) / 0.5) * fade : 0
}

/** 0..1: laughing at the end of a conversation that ends in a joke (the listener most of all). */
export function chatLaughAmount(chat: TableChat) {
  if (!chat.laugh) return 0
  return smooth((chat.elapsed - (chat.talkEnd - 0.1)) / 0.3) * smooth((chat.duration - chat.elapsed) / 0.45)
}

/** 0..1 emphasis beats of speech, about two a second, never a metronome. */
export function speechBeat(time: number, seed: number) {
  const wave = Math.max(0, Math.sin(time * 12 + seed * 40))
  const gate = 0.4 + 0.6 * smooth(0.5 + 0.5 * Math.sin(time * 1.3 + seed * 9) + 0.25 * Math.sin(time * 3.1 + seed * 3))
  return wave * wave * gate
}

/** 0..1 nods of a listener, roughly one every second or so, skipped now and then. */
export function listenerNod(time: number, seed: number) {
  const wave = Math.max(0, Math.sin(time * 3.7 + seed * 11))
  const gate = smooth(0.5 + 1.4 * Math.sin(time * 0.83 + seed * 5))
  return wave * wave * wave * gate
}

/** Seconds into a stretch when the yawn starts, peaks and ends. */
export const YAWN_START = 0.5
export const YAWN_END = 2.15

/** 0..1 yawn through the middle of the stretch (`elapsed` = seconds since the stretch began). */
export function yawnAmount(elapsed: number) {
  if (elapsed <= YAWN_START || elapsed >= YAWN_END) return 0
  return smooth((elapsed - YAWN_START) / 0.5) * (1 - smooth((elapsed - (YAWN_END - 0.6)) / 0.6))
}
