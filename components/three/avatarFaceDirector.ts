import * as THREE from 'three'
import type { AvatarFaceRig, FaceInput } from './avatarFace'
import { GAZE, type GazeTargets } from './avatarFaceGaze'
import { winnerPointFocus } from './avatarAnimator'
import { emoteToEmotion } from './avatarFaceEmotion'
import { BOARD_Z, FELT_TOP_Y } from './tableArt'
import { TABLE_POT_POSITION } from './tableWagerLayout'
import { chatLaughAmount, chatSmileAmount, chatTalkAmount, type TableChat } from './tableTalk'

/**
 * Turns the live game state of a seat into the inputs the face system wants:
 * an emotion context (what just happened to this player) and a set of weighted
 * gaze targets (what they would plausibly be looking at right now). Lives outside
 * the room file so the render loop only makes one small call per seat.
 */

/** The bits of a seat runtime the director reads (SeatRuntime satisfies this structurally). */
export interface FaceDirectorSeat {
  playerId: string
  visualSeat: number
  root: THREE.Object3D
  face: AvatarFaceRig | null
  avatar: { bones: ReadonlyMap<string, THREE.Bone> } | null
  cards: THREE.Object3D
  acting: boolean
  folded: boolean
  winner: boolean
  loser: boolean
  passedOut: boolean
  drunkLevel: number
  peeking: boolean
  hadCards: boolean
  wagerIntensity: number
  isHero: boolean
  funPose?: { hungover?: boolean; tripping?: boolean; blackoutElapsed?: number | null; dazedElapsed?: number | null }
  flipOff: { startedAt: number; targetId: string } | null
  /** This frame's body pose (drinkLift: the glass is at the lips 0..1). */
  lastPose?: { drinkLift: number } | null
  /** When the current drink started (same clock as env.time). */
  drinkStartedAt?: number
  /** This seat's part in an idle table conversation, set only while the animator has it taking part. */
  chat?: TableChat | null
  /** 0..1 yawn through the middle of the stretch idle (from the animator). */
  yawn?: number
  /** The winner's animator state (the point-at-the-pot beat puts the eyes on the pot). */
  animator?: { winnerSince: number; winFlair: number }
}

/** Seconds of a drink (matches drinkProps DRINK_DURATION); the "aah" follows the swallow near the end. */
const DRINK_SECONDS = 2.6

export interface FaceDirectorEnv {
  delta: number
  time: number
  reducedMotion: boolean
  actingVisualSeat: number | null
  tableHeat: number
  anyWinner: boolean
  runtimeSeats: ReadonlyMap<string, FaceDirectorSeat>
  cue: string
  bonked: boolean
  burning: boolean
  cheers: number
  /** Legacy head-relative look (eye counter-rotation) used if no gaze target is available. */
  fallbackYaw: number
  fallbackPitch: number
}

const scene = {
  viewer: new THREE.Vector3(0, 1.6, 6),
  hasViewer: false,
  board: new THREE.Vector3(0, FELT_TOP_Y + 0.05, BOARD_Z),
  pot: new THREE.Vector3(TABLE_POT_POSITION[0], FELT_TOP_Y + 0.08, TABLE_POT_POSITION[2]),
}

/** Called once per frame with the render camera (the viewer players make eye contact with). */
export function setFaceViewer(camera: THREE.Object3D) {
  camera.getWorldPosition(scene.viewer)
  scene.hasViewer = true
}

const EYE_LEVEL = 0.12

function headPosition(seat: FaceDirectorSeat, out: THREE.Vector3): boolean {
  const bone = seat.avatar?.bones.get('Head')
  if (!bone) return false
  const e = bone.matrixWorld.elements
  out.set(e[12]!, e[13]! + EYE_LEVEL, e[14]!)
  return true
}

const scratch = new THREE.Vector3()

function smooth01(x: number) {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

/** A table emote was sent: the sender makes the face for it, the target reacts. */
export function triggerFaceEmote(face: AvatarFaceRig | null | undefined, emoji: string, role: 'sender' | 'target') {
  if (!face) return
  face.emote = {
    emotion: emoteToEmotion(emoji, role),
    until: face.emotion.time + (role === 'sender' ? 3.2 : 2.4),
    amount: role === 'sender' ? 0.95 : 0.7,
  }
}

/** Seats of the current frame as a flat array (one Map walk per frame, not per seat). */
const frameSeats: FaceDirectorSeat[] = []
let frameTime = Number.NaN

function prepareFrame(env: FaceDirectorEnv) {
  if (env.time === frameTime) return
  frameTime = env.time
  frameSeats.length = 0
  for (const seat of env.runtimeSeats.values()) frameSeats.push(seat)
}

interface FaceCost { ms: number; calls: number; cur: number; curTime: number; samples: number[]; head: number }

export function buildFaceInput(face: AvatarFaceRig, seat: FaceDirectorSeat, env: FaceDirectorEnv): FaceInput {
  const costStart = process.env.NODE_ENV !== 'production' ? performance.now() : 0
  const input = buildFaceInputInner(face, seat, env)
  if (costStart) {
    const cost = ((globalThis as { __faceCost?: FaceCost }).__faceCost ??= { ms: 0, calls: 0, cur: 0, curTime: -1, samples: [], head: 0 })
    if (cost.curTime !== env.time) {
      if (cost.curTime >= 0) {
        if (cost.samples.length < 600) cost.samples.push(cost.cur)
        else cost.samples[cost.head++ % 600] = cost.cur
      }
      cost.cur = 0
      cost.curTime = env.time
    }
    const spent = performance.now() - costStart
    cost.ms += spent
    cost.cur += spent
  }
  return input
}

function buildFaceInputInner(face: AvatarFaceRig, seat: FaceDirectorSeat, env: FaceDirectorEnv): FaceInput {
  const input = face.input
  const ctx = face.context
  const targets = face.targets

  // The hero's own (first-person, invisible) avatar needs no face.
  if (!seat.root.visible) {
    input.skip = true
    return input
  }

  // Level of detail: faces far from the camera update every 2nd/3rd frame (staggered per
  // seat) with the accumulated delta; at that size nobody can see the difference.
  const head = seat.avatar?.bones.get('Head')
  if (head && scene.hasViewer) {
    const e = head.matrixWorld.elements
    const d = Math.hypot(e[12]! - scene.viewer.x, e[13]! - scene.viewer.y, e[14]! - scene.viewer.z)
    if (Number.isFinite(d)) input.distance = d
  }
  const stride = (input.distance ?? 0) > 13 ? 3 : (input.distance ?? 0) > 7 ? 2 : 1
  const st = face.state
  if (!(st.accumDelta === st.accumDelta)) st.accumDelta = 0
  st.accumDelta += Number.isFinite(env.delta) ? Math.min(0.25, Math.max(0, env.delta)) : 0.016
  st.strideFrame += 1
  if (stride > 1 && !env.reducedMotion && (st.strideFrame + st.phase) % stride !== 0) {
    input.skip = true
    return input
  }
  input.skip = false
  const delta = st.accumDelta
  st.accumDelta = 0

  const inHand = seat.hadCards && seat.cards.visible && !seat.folded
  if (seat.loser && !st.prevLoser) st.lossStreak = Math.min(4, st.lossStreak + 1)
  if (seat.winner && !st.prevWinner) {
    st.lossStreak = 0
    // Snap out of whatever the eyes were on (often the pot, i.e. down) a beat after the win lands.
    face.gazeState.fixUntil = Math.min(face.gazeState.fixUntil, face.emotion.time + 0.25)
  }
  st.prevLoser = seat.loser
  st.prevWinner = seat.winner
  if (!seat.winner) st.prevPointing = false
  ctx.tilt = st.lossStreak >= 2 ? Math.min(1, (st.lossStreak - 1) * 0.4) : 0
  ctx.acting = seat.acting
  ctx.folded = seat.folded
  ctx.winner = seat.winner
  ctx.loser = seat.loser
  ctx.passedOut = seat.passedOut
  ctx.hungover = Boolean(seat.funPose?.hungover)
  ctx.tripping = Boolean(seat.funPose?.tripping)
  ctx.dazed = seat.funPose?.dazedElapsed != null && seat.funPose.dazedElapsed >= 0
  ctx.drunk = seat.drunkLevel
  ctx.tableHeat = env.tableHeat
  if (env.cue !== ctx.cue) ctx.cueStartedAt = face.emotion.time
  ctx.cue = env.cue
  // The playback clock saturates; keep our own so cue reactions can fade out.
  ctx.cueElapsed = face.emotion.time - ctx.cueStartedAt
  ctx.wager = Math.max(0, Math.min(1, seat.wagerIntensity))
  ctx.peeking = seat.peeking
  ctx.inHand = inHand
  ctx.bonked = env.bonked
  ctx.burning = env.burning
  ctx.cheers = env.cheers
  ctx.flipOffGiven = seat.flipOff !== null
  ctx.otherActing = env.actingVisualSeat !== null && env.actingVisualSeat !== seat.visualSeat
  ctx.anyWinner = env.anyWinner
  ctx.actingFor = seat.acting ? ctx.actingFor + delta : 0
  const lift = seat.lastPose?.drinkLift ?? 0
  ctx.drinkLift = seat.passedOut || !(lift > 0) ? 0 : Math.min(1, lift)
  const sinceDrink = env.time - (seat.drinkStartedAt ?? Number.NEGATIVE_INFINITY) - (DRINK_SECONDS - 0.85)
  ctx.drinkAfter = seat.passedOut || !(sinceDrink > 0 && sinceDrink < 1.6)
    ? 0
    : smooth01(sinceDrink / 0.25) * (1 - smooth01((sinceDrink - 0.8) / 0.6))
  // Table talk (the animator only reports a chat while the seat is really taking part) and the yawn.
  const chat = !env.reducedMotion && seat.chat ? seat.chat : null
  ctx.talk = chat ? chatTalkAmount(chat) : 0
  ctx.chatSmile = chat ? chatSmileAmount(chat) : 0
  ctx.chatLaugh = chat ? chatLaughAmount(chat) * (chat.role === 'listen' ? 1 : 0.6) : 0
  ctx.yawn = seat.passedOut || env.reducedMotion ? 0 : Math.max(0, Math.min(1, seat.yawn ?? 0))
  prepareFrame(env)
  let received = false
  for (let i = 0; i < frameSeats.length; i += 1) {
    const other = frameSeats[i]!
    if (other !== seat && other.flipOff && other.flipOff.targetId === seat.playerId) {
      received = true
      break
    }
  }
  ctx.flipOffReceived = received
  const emote = face.emote
  if (emote && face.emotion.time < emote.until) {
    ctx.emote = emote.emotion
    // Ease out over the last half second.
    ctx.emoteAmount = emote.amount * Math.min(1, (emote.until - face.emotion.time) / 0.5)
  } else {
    ctx.emote = null
    ctx.emoteAmount = 0
  }

  // ---- gaze targets ----
  const person = face.personality
  const avail = targets.available
  const w = targets.weights
  avail.fill(0)
  w.fill(0)
  const pos = targets.positions
  pos[GAZE.board]!.copy(scene.board)
  pos[GAZE.pot]!.copy(scene.pot)
  avail[GAZE.board] = 1
  avail[GAZE.pot] = 1
  if (scene.hasViewer) {
    pos[GAZE.viewer]!.copy(scene.viewer)
    avail[GAZE.viewer] = 1
  }
  if (inHand) {
    const e = seat.cards.matrixWorld.elements
    pos[GAZE.cards]!.set(e[12]!, e[13]!, e[14]!)
    avail[GAZE.cards] = 1
  }
  // The acting player (or the viewer, when the hero acts: their head is the camera).
  let actingSeat: FaceDirectorSeat | null = null
  if (env.actingVisualSeat !== null && env.actingVisualSeat !== seat.visualSeat) {
    for (let i = 0; i < frameSeats.length; i += 1) {
      if (frameSeats[i]!.visualSeat === env.actingVisualSeat) {
        actingSeat = frameSeats[i]!
        break
      }
    }
  }
  if (actingSeat) {
    if (actingSeat.isHero && scene.hasViewer) {
      pos[GAZE.acting]!.copy(scene.viewer)
      avail[GAZE.acting] = 1
    } else if (headPosition(actingSeat, pos[GAZE.acting]!)) {
      avail[GAZE.acting] = 1
    }
  }
  // Some other player to glance at.
  {
    let count = 0
    for (let i = 0; i < frameSeats.length; i += 1) {
      const other = frameSeats[i]!
      if (other !== seat && other.root.visible && other.avatar) count += 1
    }
    if (count > 0) {
      // Most glances go to a neighbour (alternating sides), the rest anywhere round the table.
      const gazeCount = face.gazeState.count
      let chosen: FaceDirectorSeat | null = null
      if (((gazeCount * 7 + Math.floor(face.state.seed * 11)) % 5) < 3) {
        const wantAbove = (gazeCount & 1) === 0
        let best = Infinity
        for (let i = 0; i < frameSeats.length; i += 1) {
          const other = frameSeats[i]!
          if (other === seat || !other.root.visible || !other.avatar) continue
          const diff = other.visualSeat - seat.visualSeat
          // Nearest seat on the wanted side; the far end of the other side stands in for wrap-around.
          const rank = wantAbove ? (diff > 0 ? diff : 100 + diff) : (diff < 0 ? -diff : 100 - diff)
          if (rank < best) {
            best = rank
            chosen = other
          }
        }
      }
      if (!chosen) {
        const pick = (gazeCount * 3 + Math.floor(face.state.seed * 7)) % count
        let n = 0
        for (let i = 0; i < frameSeats.length; i += 1) {
          const other = frameSeats[i]!
          if (other === seat || !other.root.visible || !other.avatar) continue
          if (n === pick) {
            chosen = other
            break
          }
          n += 1
        }
      }
      if (chosen && headPosition(chosen, scratch)) {
        pos[GAZE.other]!.copy(scratch)
        avail[GAZE.other] = 1
      }
    }
  }
  avail[GAZE.away] = 1

  const contact = person.eyeContact
  targets.awayMode = 'side'
  if (seat.passedOut) {
    // eyes are closed; nothing to look at.
    w[GAZE.board] = 1
  } else if (seat.peeking && inHand) {
    w[GAZE.cards] = 0.85
    w[GAZE.away] = 0.08
    targets.awayMode = 'think'
  } else if (seat.winner) {
    // The first beats of a win look up and out (at the table, the viewer), not down at the pot.
    const fresh = face.emotion.time - face.emotion.winAt < 3
    w[GAZE.viewer] = 0.25 + contact * 0.5 + (fresh ? 0.2 : 0)
    w[GAZE.pot] = fresh ? 0.04 : 0.3
    w[GAZE.other] = fresh ? 0.45 : 0.3
    w[GAZE.acting] = 0.05
    // Pointing at the pot: the eyes follow the finger.
    const aim = seat.animator ? winnerPointFocus(seat.animator.winnerSince, seat.animator.winFlair, env.time, env.reducedMotion) : 0
    if (aim > 0.01) {
      const rest = 1 - 0.9 * aim
      w[GAZE.viewer] *= rest
      w[GAZE.other] *= rest
      w[GAZE.acting] *= rest
      w[GAZE.pot] = Math.max(w[GAZE.pot]!, 0.2) + 3 * aim
      if (!st.prevPointing) face.gazeState.fixUntil = Math.min(face.gazeState.fixUntil, face.emotion.time + 0.1)
    }
    st.prevPointing = aim > 0.3
  } else if (seat.loser) {
    w[GAZE.cards] = 0.3
    w[GAZE.away] = 0.5
    w[GAZE.pot] = 0.2
    targets.awayMode = 'down'
  } else if (seat.folded) {
    w[GAZE.acting] = 0.32
    w[GAZE.other] = 0.3
    w[GAZE.away] = 0.28
    w[GAZE.viewer] = 0.08 + contact * 0.15
    w[GAZE.board] = 0.12
    targets.awayMode = 'side'
  } else if (seat.acting) {
    w[GAZE.pot] = 0.32
    w[GAZE.board] = 0.22
    w[GAZE.cards] = inHand ? 0.22 : 0
    w[GAZE.viewer] = 0.08 + contact * 0.3
    w[GAZE.other] = 0.16
    w[GAZE.away] = 0.24
    targets.awayMode = 'think'
  } else if (actingSeat) {
    w[GAZE.acting] = 0.52
    w[GAZE.pot] = 0.12
    w[GAZE.board] = 0.14
    w[GAZE.viewer] = 0.05 + contact * 0.18
    w[GAZE.other] = 0.1
    w[GAZE.cards] = inHand ? 0.08 : 0
    w[GAZE.away] = 0.06
  } else {
    w[GAZE.board] = 0.28
    w[GAZE.pot] = 0.12
    w[GAZE.other] = 0.3
    w[GAZE.viewer] = 0.07 + contact * 0.22
    w[GAZE.cards] = inHand ? 0.1 : 0
    w[GAZE.away] = 0.14
  }
  if (ctx.hungover || ctx.drunk > 4) {
    w[GAZE.away] += 0.25
    targets.awayMode = 'down'
  }
  // In conversation the eyes stay on the other person (with the odd look away), from the first beat.
  let chatting = false
  if (chat) {
    for (let i = 0; i < frameSeats.length; i += 1) {
      const other = frameSeats[i]!
      if (other.playerId === chat.partnerId && other !== seat && headPosition(other, pos[GAZE.other]!)) {
        avail[GAZE.other] = 1
        chatting = true
        break
      }
    }
  }
  if (chatting) {
    w.fill(0)
    w[GAZE.other] = 0.86
    w[GAZE.away] = 0.14
    targets.awayMode = chat!.role === 'speak' ? 'think' : 'side'
    if (!st.prevChatting) face.gazeState.fixUntil = Math.min(face.gazeState.fixUntil, face.emotion.time + 0.15)
  }
  st.prevChatting = chatting

  input.delta = delta
  input.blink = seat.passedOut ? 1 : 0
  input.reducedMotion = env.reducedMotion
  input.lookX = env.fallbackYaw
  input.lookY = env.fallbackPitch
  input.folded = seat.folded
  input.hasContext = true
  return input
}
