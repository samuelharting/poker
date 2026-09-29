import { faceHash01, type FacePersonality } from './avatarFacePersonality'

/**
 * The face emotion model.
 *
 * A face is described by ~24 continuous channels (FACS-lite action units:
 * lid openness, lower-lid raise, brow inner/outer height, mouth corners, open,
 * teeth, blush, pallor...). Each named emotion is a sparse set of channel
 * deltas. The game state picks target weights per emotion; every weight is its
 * own damped spring (fast attack with a hint of overshoot, slower release) so
 * transitions are smooth and never pop. Channels are the weighted sum on top of
 * a personality-shifted resting face. Micro-expressions (a 200ms brow flash, a
 * lip twitch, a swallow) ride on extra emotion slots and leak the player's
 * "tell". Everything is allocation free after creation.
 */

// Channels. "A" is the personality's dominant side (the smirk side), "B" the other.
export const CH = {
  lidUA: 0, lidUB: 1, lidLA: 2, lidLB: 3,
  browIA: 4, browIB: 5, browOA: 6, browOB: 7, arch: 8,
  smileA: 9, smileB: 10, open: 11, width: 12, press: 13, purse: 14, teeth: 15, jaw: 16,
  pupil: 17, blush: 18, pallor: 19, sweat: 20, red: 21, wrinkle: 22, furrow: 23,
} as const
export const CHANNEL_COUNT = 24

type ChannelName = keyof typeof CH
type Sparse = Partial<Record<ChannelName, number>>

export type FaceEmotion =
  | 'focused' | 'thinking' | 'confident' | 'smirk' | 'happy' | 'joy' | 'laugh'
  | 'surprised' | 'sad' | 'angry' | 'fear' | 'tense' | 'disgust' | 'bored' | 'sleepy'
  | 'drunk' | 'hungover' | 'worried' | 'suspicious' | 'pain' | 'shock'
  | 'mBrow' | 'mLip' | 'mNose' | 'mSquint' | 'mSwallow'

const EMOTION_DEFS: Record<FaceEmotion, Sparse> = {
  focused: { lidUA: -0.05, lidUB: -0.05, lidLA: 0.12, lidLB: 0.12, browIA: -0.36, browIB: -0.36, browOA: -0.04, browOB: -0.04, smileA: -0.12, smileB: -0.12, width: -0.08, press: 0.32, furrow: 0.45 },
  thinking: { lidUA: -0.05, lidUB: -0.05, lidLA: 0.12, browIA: 0.3, browIB: -0.15, browOA: 0.45, smileA: -0.02, smileB: -0.1, press: 0.38, purse: 0.25, jaw: 0.3, width: -0.1, furrow: 0.15 },
  confident: { lidUA: -0.06, lidUB: -0.06, lidLA: 0.2, lidLB: 0.12, browOA: 0.22, browOB: 0.14, browIA: 0.1, smileA: 0.55, smileB: 0.2, width: 0.04, jaw: 0.1, pupil: 0.05 },
  smirk: { lidUA: -0.08, lidUB: -0.03, lidLA: 0.42, lidLB: 0.1, browIA: 0.2, browOA: 0.32, browIB: -0.12, smileA: 0.85, smileB: 0.04, jaw: 0.4, width: 0.03, teeth: 0.06 },
  happy: { lidUA: -0.03, lidUB: -0.03, lidLA: 0.42, lidLB: 0.42, browIA: 0.12, browIB: 0.12, browOA: 0.22, browOB: 0.22, smileA: 0.62, smileB: 0.58, open: 0.12, teeth: 0.3, width: 0.12, blush: 0.12 },
  joy: { lidUA: -0.12, lidUB: -0.12, lidLA: 0.82, lidLB: 0.82, browIA: 0.3, browIB: 0.3, browOA: 0.4, browOB: 0.4, smileA: 1, smileB: 0.95, open: 0.62, teeth: 1, width: 0.28, blush: 0.3, pupil: 0.25 },
  laugh: { lidUA: -0.28, lidUB: -0.28, lidLA: 1, lidLB: 1, browIA: 0.1, browIB: 0.1, browOA: 0.3, browOB: 0.3, smileA: 1, smileB: 1, open: 0.8, teeth: 1, width: 0.3, blush: 0.35, sweat: 0.1 },
  surprised: { lidUA: 0.34, lidUB: 0.34, lidLA: -0.18, lidLB: -0.18, browIA: 0.85, browIB: 0.85, browOA: 0.95, browOB: 0.95, arch: 0.5, smileA: -0.02, smileB: -0.02, open: 0.9, width: -0.2, teeth: 0.25, pupil: 0.3 },
  shock: { lidUA: 0.42, lidUB: 0.42, lidLA: -0.25, lidLB: -0.25, browIA: 1, browIB: 1, browOA: 1, browOB: 1, arch: 0.6, smileA: -0.15, smileB: -0.15, open: 1, width: -0.15, teeth: 0.35, pupil: 0.4, pallor: 0.25 },
  sad: { lidUA: -0.24, lidUB: -0.24, lidLA: 0.1, lidLB: 0.1, browIA: 0.95, browIB: 0.95, browOA: -0.6, browOB: -0.6, smileA: -0.8, smileB: -0.8, width: -0.15, purse: 0.6, press: 0.2, red: 0.3 },
  angry: { lidUA: -0.16, lidUB: -0.16, lidLA: 0.5, lidLB: 0.5, browIA: -0.95, browIB: -0.95, browOA: -0.05, browOB: -0.05, smileA: -0.5, smileB: -0.5, press: 0.55, teeth: 0.38, width: -0.1, wrinkle: 0.45, blush: 0.3, pupil: -0.2, furrow: 1 },
  fear: { lidUA: 0.24, lidUB: 0.24, lidLA: -0.06, lidLB: -0.06, browIA: 0.72, browIB: 0.72, browOA: 0.08, browOB: 0.08, arch: 0.3, smileA: -0.25, smileB: -0.25, open: 0.2, width: 0.12, pupil: 0.55, sweat: 0.6, pallor: 0.35, furrow: 0.5, red: 0.1 },
  tense: { lidUA: 0.22, lidUB: 0.22, lidLA: 0.14, lidLB: 0.14, browIA: 0.7, browIB: 0.7, browOA: 0.2, browOB: 0.2, smileA: -0.4, smileB: -0.4, width: -0.1, press: 0.7, pupil: 0.6, sweat: 0.8, pallor: 0.3, furrow: 0.5, arch: 0.25 },
  disgust: { lidUA: -0.2, lidUB: -0.2, lidLA: 0.72, lidLB: 0.72, browIA: -0.45, browIB: -0.45, browOA: -0.05, browOB: -0.05, smileA: -0.6, smileB: -0.3, teeth: 0.45, open: 0.16, width: -0.12, jaw: -0.2, wrinkle: 1 },
  bored: { lidUA: -0.2, lidUB: -0.2, browIA: -0.05, browIB: -0.05, browOA: -0.1, browOB: -0.1, smileA: -0.14, smileB: -0.14, width: -0.05, jaw: 0.15, press: 0.1 },
  sleepy: { lidUA: -0.62, lidUB: -0.62, lidLA: 0.1, lidLB: 0.1, browIA: 0.1, browIB: 0.1, browOA: -0.15, browOB: -0.15, smileA: -0.06, smileB: -0.06, open: 0.06, red: 0.3 },
  drunk: { lidUA: -0.28, lidUB: -0.16, lidLA: 0.18, lidLB: 0.18, browOA: -0.1, browIB: 0.18, smileA: 0.5, smileB: 0.22, open: 0.12, width: 0.12, jaw: -0.35, blush: 0.55, red: 0.65, pupil: 0.25, sweat: 0.25 },
  hungover: { lidUA: -0.42, lidUB: -0.42, lidLA: 0.2, lidLB: 0.2, browIA: 0.42, browIB: 0.42, browOA: -0.3, browOB: -0.3, smileA: -0.42, smileB: -0.42, width: -0.08, pallor: 0.9, red: 0.75, sweat: 0.35, pupil: -0.4, press: 0.3 },
  worried: { lidUA: 0.06, lidUB: 0.06, browIA: 0.6, browIB: 0.6, browOA: -0.22, browOB: -0.22, smileA: -0.22, smileB: -0.22, width: -0.05, press: 0.3, purse: 0.18, sweat: 0.12, arch: 0.15 },
  suspicious: { lidUA: -0.22, lidUB: -0.05, lidLA: 0.35, browIA: -0.6, browOA: -0.15, browIB: 0.38, browOB: 0.5, smileA: -0.1, smileB: 0.18, press: 0.3, jaw: 0.2 },
  pain: { lidUA: -0.5, lidUB: -0.5, lidLA: 0.95, lidLB: 0.95, browIA: -0.3, browIB: -0.3, browOA: -0.1, browOB: -0.1, open: 0.5, teeth: 0.85, width: 0.15, smileA: -0.4, smileB: -0.4, wrinkle: 0.5, blush: 0.15, sweat: 0.2 },
  mBrow: { browIA: 0.55, browIB: 0.55, browOA: 0.5, browOB: 0.5, lidUA: 0.12, lidUB: 0.12, arch: 0.3 },
  mLip: { smileA: 0.55, lidLA: 0.18, jaw: 0.2 },
  mNose: { wrinkle: 0.8, lidLA: 0.25, lidLB: 0.25, smileA: -0.1, smileB: -0.1 },
  mSquint: { lidLA: 0.55, lidLB: 0.55, lidUA: -0.1, lidUB: -0.1, browIA: -0.2, browIB: -0.2 },
  mSwallow: { press: 0.7, purse: 0.25, jaw: -0.15, lidUA: -0.05, lidUB: -0.05 },
}

export const FACE_EMOTIONS = Object.keys(EMOTION_DEFS) as FaceEmotion[]
export const EMOTION_COUNT = FACE_EMOTIONS.length
export const EMOTION_INDEX = FACE_EMOTIONS.reduce((map, name, index) => {
  map[name] = index
  return map
}, {} as Record<FaceEmotion, number>)

const EMOTION_ROWS = new Float32Array(EMOTION_COUNT * CHANNEL_COUNT)
FACE_EMOTIONS.forEach((name, row) => {
  const def = EMOTION_DEFS[name]
  for (const key of Object.keys(def) as ChannelName[]) {
    EMOTION_ROWS[row * CHANNEL_COUNT + CH[key]] = def[key]!
  }
})
const MICRO_FIRST = EMOTION_INDEX.mBrow

/** Resting face. */
const BASE = new Float32Array(CHANNEL_COUNT)
BASE[CH.lidUA] = 0.98
BASE[CH.lidUB] = 0.98
BASE[CH.smileA] = 0.05
BASE[CH.smileB] = 0.05
BASE[CH.width] = 1

const CHANNEL_MIN = new Float32Array(CHANNEL_COUNT).fill(-1)
const CHANNEL_MAX = new Float32Array(CHANNEL_COUNT).fill(1)
CHANNEL_MIN[CH.lidUA] = CHANNEL_MIN[CH.lidUB] = 0
CHANNEL_MAX[CH.lidUA] = CHANNEL_MAX[CH.lidUB] = 1.32
CHANNEL_MIN[CH.lidLA] = CHANNEL_MIN[CH.lidLB] = -0.4
CHANNEL_MIN[CH.open] = 0
CHANNEL_MIN[CH.width] = 0.55
CHANNEL_MAX[CH.width] = 1.2
for (const channel of [CH.press, CH.purse, CH.teeth, CH.blush, CH.pallor, CH.sweat, CH.red, CH.wrinkle, CH.furrow]) CHANNEL_MIN[channel] = 0

/** Everything the emotion director may read about a seat this frame. */
export interface FaceContext {
  acting: boolean
  folded: boolean
  winner: boolean
  loser: boolean
  passedOut: boolean
  hungover: boolean
  tripping: boolean
  dazed: boolean
  /** Drunk level 0..10. */
  drunk: number
  /** Table-wide excitement 0..1 (someone else's big move). */
  tableHeat: number
  /** Current action cue and seconds since it started. */
  cue: 'ready' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in' | string
  cueElapsed: number
  /** Internal: when the current cue was first seen (director timer). */
  cueStartedAt: number
  /** 0..1 how big the wager is. */
  wager: number
  peeking: boolean
  /** Holding cards and still in the hand. */
  inHand: boolean
  bonked: boolean
  burning: boolean
  /** 0..1 clinking glasses. */
  cheers: number
  flipOffGiven: boolean
  flipOffReceived: boolean
  otherActing: boolean
  anyWinner: boolean
  /** Seconds the seat has been the acting player. */
  actingFor: number
  /** A table emote this face is currently reacting to / making (null = none). */
  emote: FaceEmotion | null
  emoteAmount: number
  /** 0..1 how badly the player is on tilt (consecutive lost showdowns). */
  tilt: number
}

export function createFaceContext(): FaceContext {
  return {
    acting: false, folded: false, winner: false, loser: false, passedOut: false, hungover: false, tripping: false,
    dazed: false, drunk: 0, tableHeat: 0, cue: 'ready', cueElapsed: Infinity, cueStartedAt: 0, wager: 0, peeking: false, inHand: false,
    bonked: false, burning: false, cheers: 0, flipOffGiven: false, flipOffReceived: false, otherActing: false,
    anyWinner: false, actingFor: 0, emote: null, emoteAmount: 0, tilt: 0,
  }
}

export interface EmotionState {
  weights: Float32Array
  velocity: Float32Array
  targets: Float32Array
  /** Final channel values (already mapped to A/B sides). */
  params: Float32Array
  time: number
  nextMicro: number
  microIndex: number
  microStart: number
  microAmp: number
  prevCue: string
  prevPeeking: boolean
  prevActing: boolean
  prevWinner: boolean
  /** Scheduled delayed micro-expression (tension after committing chips). */
  pendingMicroAt: number
  pendingMicroIndex: number
  pendingMicroAmp: number
  /** Blink state. */
  nextBlink: number
  blinkStart: number
  blinkDuration: number
  blinkSecond: number
  blinkValue: number
  seed: number
  /** Extra emphasis for far-away faces (0..0.4) so expressions read at table distance. */
  boost: number
}

export function createEmotionState(seed: number): EmotionState {
  return {
    weights: new Float32Array(EMOTION_COUNT),
    velocity: new Float32Array(EMOTION_COUNT),
    targets: new Float32Array(EMOTION_COUNT),
    params: BASE.slice(),
    time: seed * 30,
    nextMicro: 3 + faceHash01(seed * 9.1) * 5,
    microIndex: -1,
    microStart: -10,
    microAmp: 0,
    prevCue: 'ready',
    prevPeeking: false,
    prevActing: false,
    prevWinner: false,
    pendingMicroAt: -1,
    pendingMicroIndex: -1,
    pendingMicroAmp: 0,
    nextBlink: 0.8 + faceHash01(seed * 5.3) * 2.4,
    blinkStart: -10,
    blinkDuration: 0.2,
    blinkSecond: -1,
    blinkValue: 0,
    seed,
    boost: 0,
  }
}

const TELL_TO_MICRO = { brow: 'mBrow', lip: 'mLip', nose: 'mNose', squint: 'mSquint', swallow: 'mSwallow' } as const

let tgt: Float32Array = new Float32Array(EMOTION_COUNT)
function set(name: FaceEmotion, value: number) {
  const index = EMOTION_INDEX[name]
  if (value > tgt[index]!) tgt[index] = value
}
function add(name: FaceEmotion, value: number) {
  const index = EMOTION_INDEX[name]
  tgt[index] = Math.min(1.2, tgt[index]! + value)
}

/** Maps the game context onto target emotion weights (0..1). Writes `state.targets`. */
export function directEmotions(state: EmotionState, ctx: FaceContext, person: FacePersonality, time: number) {
  const t = state.targets
  t.fill(0)
  tgt = t
  const ex = person.expressiveness

  // Resting personality: the face drifts towards its idle habit between events.
  if (person.idle === 'smirk') set('smirk', 0.3)
  else if (person.idle === 'focused') set('focused', 0.28)
  else if (person.idle === 'happy') set('happy', 0.25)

  const drunkW = Math.min(1, Math.max(0, (ctx.drunk - 1) / 6))
  if (drunkW > 0) set('drunk', drunkW)

  if (ctx.inHand && !ctx.folded) {
    // Playing a hand: attentive, a poker face (personality decides how well).
    add('focused', 0.14 * (1 + person.pokerFace))
    if (ctx.otherActing) add('suspicious', 0.14 * (1 - person.pokerFace * 0.5) * (0.5 + 0.5 * Math.sin(time * 0.31 + state.seed * 50)))
  }

  if (ctx.folded) {
    set('bored', 0.68)
    t[EMOTION_INDEX.focused] = 0
  }

  if (ctx.acting) {
    const worry = Math.min(1, ctx.actingFor / 9)
    add('thinking', 0.85 - worry * 0.15)
    add('worried', 0.18 * worry * (1 - person.pokerFace * 0.4))
    if (person.idle === 'smirk') add('smirk', 0.15)
  }

  // The action they just committed to.
  const since = ctx.cueElapsed
  if (since < 7) {
    const fade = 1 - Math.min(1, Math.max(0, (since - 3.4) / 3.2))
    const strength = fade * (0.5 + 0.5 * ctx.wager)
    if (ctx.cue === 'all_in') {
      add('tense', 1.15 * fade)
      add('fear', 0.6 * fade * (1 - person.pokerFace * 0.4))
      if (person.idle === 'smirk') add('smirk', 0.25 * fade)
    } else if (ctx.cue === 'raise' || ctx.cue === 'bet') {
      // Bluff or value, the face rarely tells: smirk types show teeth, stoic types tighten.
      if (person.idle === 'smirk' || person.expressiveness > 1) add('smirk', 0.75 * strength)
      else add('confident', 0.7 * strength)
      add('confident', 0.4 * strength)
      add('focused', 0.2 * strength)
    } else if (ctx.cue === 'call') {
      add('focused', 0.25 * fade)
    } else if (ctx.cue === 'fold') {
      add('bored', 0.5 * fade)
      add('sad', 0.15 * fade)
    } else if (ctx.cue === 'check') {
      add('thinking', 0.05 * fade)
    }
  }

  // Chips are in and the cards are not turned yet: a low hum of tension.
  if (ctx.cue === 'all_in' && ctx.inHand && !ctx.winner && !ctx.loser) add('tense', 0.32)

  if (ctx.peeking) {
    set('focused', 0.55)
    add('thinking', 0.18)
  }

  if (ctx.tableHeat > 0.15 && !ctx.acting) {
    add('worried', 0.5 * ctx.tableHeat)
    add('surprised', 0.35 * ctx.tableHeat)
  }

  if (ctx.loser) {
    // A bad beat: stung first, then either sulk or fume (personality).
    add('sad', 1.1)
    if (person.idle === 'smirk' || person.reactivity > 1.15) add('angry', 0.55)
    else add('disgust', 0.25)
    t[EMOTION_INDEX.focused] = 0
    t[EMOTION_INDEX.bored] = 0
  } else if (ctx.anyWinner && !ctx.winner && !ctx.folded && ctx.inHand) {
    add('sad', 0.32)
  }

  if (ctx.winner) {
    const laughy = person.expressiveness > 0.95
    set('joy', 0.85)
    if (laughy) set('laugh', 0.35 + 0.4 * Math.max(0, Math.sin(time * 1.9 + state.seed * 30)))
    t[EMOTION_INDEX.focused] = 0
    t[EMOTION_INDEX.bored] = 0
    t[EMOTION_INDEX.sad] = 0
    t[EMOTION_INDEX.thinking] = 0
  }

  if (ctx.tilt > 0 && !ctx.winner) {
    // On tilt: simmering between hands, worse when they have to act.
    add('angry', ctx.tilt * (ctx.acting ? 0.45 : 0.28))
    if (!ctx.loser) add('suspicious', ctx.tilt * 0.12)
  }

  if (ctx.emote) {
    // An emote the player just sent or received: a clear, short expression.
    add(ctx.emote, ctx.emoteAmount)
    if (ctx.emote !== 'focused' && ctx.emote !== 'thinking') t[EMOTION_INDEX.focused] = t[EMOTION_INDEX.focused]! * 0.3
  }
  if (ctx.cheers > 0) add('happy', 0.7 * ctx.cheers)
  if (ctx.flipOffGiven) {
    set('smirk', 0.95)
    t[EMOTION_INDEX.focused] = 0
  }
  if (ctx.flipOffReceived) {
    add('surprised', 0.45)
    add('angry', 0.4)
  }
  if (ctx.burning) {
    set('disgust', 1)
    add('pain', 0.4)
    t[EMOTION_INDEX.drunk] *= 0.4
  }
  if (ctx.bonked) {
    set('pain', 1)
    add('shock', 0.7)
    t[EMOTION_INDEX.focused] = 0
  }
  if (ctx.dazed) {
    add('drunk', 0.6)
    add('shock', 0.2)
  }
  if (ctx.tripping) {
    add('joy', 0.4)
    add('surprised', 0.35)
  }
  if (ctx.hungover) {
    set('hungover', 0.95)
    t[EMOTION_INDEX.smirk] = 0
    t[EMOTION_INDEX.joy] = 0
  }
  if (ctx.passedOut) {
    t.fill(0)
    set('sleepy', 1)
  }

  // Expressiveness scales everything except sleep/illness and micro slots.
  for (let i = 0; i < MICRO_FIRST; i += 1) {
    const name = FACE_EMOTIONS[i]!
    if (name === 'sleepy' || name === 'hungover' || name === 'drunk' || name === 'pain' || name === 'shock') continue
    t[i] = t[i]! * (name === 'joy' || name === 'laugh' ? Math.min(1.1, ex) : ex)
  }
  // A good poker face suppresses reactions to the hand while it is live.
  if (ctx.inHand && !ctx.folded && !ctx.winner && !ctx.loser) {
    const damp = 1 - person.pokerFace * 0.32
    for (const name of ['sad', 'angry', 'fear', 'worried', 'surprised', 'happy', 'joy'] as const) {
      t[EMOTION_INDEX[name]] = t[EMOTION_INDEX[name]]! * damp
    }
  }
}

/** Micro-expression scheduling: leaks the player's tell, plus reactions to events. */
function trigger(state: EmotionState, time: number, index: number, amp: number) {
  state.microIndex = index
  state.microStart = time
  state.microAmp = amp
}

function driveMicro(state: EmotionState, ctx: FaceContext, person: FacePersonality, time: number) {
  const tellIndex = EMOTION_INDEX[TELL_TO_MICRO[person.tell]]
  const randomIndex = MICRO_FIRST + Math.floor(faceHash01(time * 3.1 + state.seed * 71) * 5) % 5

  const leak = 1 - person.pokerFace * 0.55
  if (ctx.cue !== state.prevCue) {
    if (ctx.cue === 'raise' || ctx.cue === 'bet' || ctx.cue === 'all_in') {
      state.pendingMicroAt = time + 0.35 + faceHash01(state.seed * 4.4) * 0.3
      state.pendingMicroIndex = ctx.cue === 'all_in' ? EMOTION_INDEX.mSwallow : tellIndex
      state.pendingMicroAmp = (ctx.cue === 'all_in' ? 1 : 0.75) * leak
    }
    state.prevCue = ctx.cue
  }
  if (ctx.peeking && !state.prevPeeking) {
    state.pendingMicroAt = time + 0.3
    state.pendingMicroIndex = faceHash01(state.seed * 8.7 + time) < 0.5 ? EMOTION_INDEX.mBrow : tellIndex
    state.pendingMicroAmp = 0.8 * leak
  }
  state.prevPeeking = ctx.peeking
  if (ctx.acting && !state.prevActing && faceHash01(state.seed * 6.1 + time) < 0.55) {
    state.pendingMicroAt = time + 0.6
    state.pendingMicroIndex = tellIndex
    state.pendingMicroAmp = 0.7 * leak
  }
  state.prevActing = ctx.acting
  state.prevWinner = ctx.winner

  if (state.pendingMicroAt > 0 && time >= state.pendingMicroAt) {
    trigger(state, time, state.pendingMicroIndex, state.pendingMicroAmp)
    state.pendingMicroAt = -1
  }
  if (time >= state.nextMicro) {
    const active = ctx.inHand && !ctx.folded
    if (active && !ctx.passedOut) trigger(state, time, faceHash01(time * 2.3 + state.seed * 19) < 0.7 ? tellIndex : randomIndex, 0.55 * leak + 0.15)
    state.nextMicro = time + person.tellPeriod * (0.6 + faceHash01(time * 1.7 + state.seed * 33) * 0.8)
  }

  // Envelope: a fast rise and a short release (~230ms total).
  if (state.microIndex >= 0) {
    const x = (time - state.microStart) / 0.34
    if (x >= 1) {
      state.microIndex = -1
    } else if (x >= 0) {
      const env = Math.sin(Math.PI * Math.min(1, x) ** 0.7)
      state.targets[state.microIndex] = env * state.microAmp
    }
  }
}

/** Advances the emotion springs and composes the channel values. */
export function updateEmotion(
  state: EmotionState,
  ctx: FaceContext,
  person: FacePersonality,
  delta: number,
  instant: boolean,
  debugWeights: Float32Array | null
) {
  state.time += delta
  const time = state.time
  directEmotions(state, ctx, person, time)
  if (!instant) driveMicro(state, ctx, person, time)
  if (debugWeights) state.targets.set(debugWeights)

  // Never let a bad delta (NaN, huge) poison the springs: they would stay broken forever.
  const dt = delta === delta && delta > 0 ? Math.min(0.05, delta) : 0
  if (!(state.time === state.time)) state.time = state.seed * 30
  const speed = person.reactivity
  const w = state.weights
  const v = state.velocity
  for (let i = 0; i < EMOTION_COUNT; i += 1) {
    const target = state.targets[i]!
    if (instant) {
      w[i] = target
      v[i] = 0
      continue
    }
    const micro = i >= MICRO_FIRST
    const attack = target > w[i]!
    if (!(w[i]! === w[i]!) || !(v[i]! === v[i]!)) { w[i] = 0; v[i] = 0 }
    const omega = (micro ? 22 : attack ? 15 : 7.5) * speed
    const zeta = micro ? 1 : attack ? 0.7 : 1
    // Sub-step so omega * dt stays well inside the stability limit (no single-frame channel jumps).
    const steps = Math.min(8, Math.max(1, Math.ceil(omega * dt * 2)))
    const h = dt / steps
    let wi = w[i]!
    let vi = v[i]!
    for (let k = 0; k < steps; k += 1) {
      vi += (omega * omega * (target - wi) - 2 * zeta * omega * vi) * h
      wi += vi * h
    }
    w[i] = wi
    v[i] = vi
    if (w[i]! < -0.02) { w[i] = -0.02; v[i] = 0 }
    if (w[i]! > 1.25) { w[i] = 1.25; v[i] = 0 }
  }

  // Compose channels.
  const p = state.params
  p.set(BASE)
  let sum = 0
  for (let i = 0; i < MICRO_FIRST; i += 1) sum += Math.max(0, w[i]!)
  const scale = (sum > 1.35 ? 1.35 / sum : 1) * (1 + (state.boost === state.boost ? state.boost : 0))
  for (let i = 0; i < EMOTION_COUNT; i += 1) {
    const weight = w[i]! * (i < MICRO_FIRST ? scale : 1)
    if (Math.abs(weight) < 0.003) continue
    const row = i * CHANNEL_COUNT
    for (let c = 0; c < CHANNEL_COUNT; c += 1) p[c] = p[c]! + weight * EMOTION_ROWS[row + c]!
  }

  // Personality resting bias.
  p[CH.smileA] = p[CH.smileA]! + person.baseSmile
  p[CH.smileB] = p[CH.smileB]! + person.baseSmile * 0.6
  p[CH.browIA] = p[CH.browIA]! + person.baseBrow
  p[CH.browIB] = p[CH.browIB]! + person.baseBrow
  p[CH.browOA] = p[CH.browOA]! + person.baseBrow * 0.6
  p[CH.browOB] = p[CH.browOB]! + person.baseBrow * 0.6
  p[CH.lidUA] = p[CH.lidUA]! - person.lidHeavy * 0.3
  p[CH.lidUB] = p[CH.lidUB]! - person.lidHeavy * 0.3

  // Procedural life: breathing parts the lips a touch, drunk lids wander, laughs bounce.
  if (!instant) {
    const breath = 0.5 + 0.5 * Math.sin(time * 1.65 + state.seed * 20)
    p[CH.open] = p[CH.open]! + 0.012 + 0.028 * breath * (1 - Math.min(1, p[CH.press]! * 1.5))
    const drunkW = w[EMOTION_INDEX.drunk]!
    if (drunkW > 0.02) {
      p[CH.lidUA] = p[CH.lidUA]! + 0.09 * drunkW * Math.sin(time * 0.83 + 1.3)
      p[CH.lidUB] = p[CH.lidUB]! + 0.09 * drunkW * Math.sin(time * 0.71 + 0.2)
      p[CH.jaw] = p[CH.jaw]! + 0.18 * drunkW * Math.sin(time * 0.6)
    }
    const laughW = w[EMOTION_INDEX.laugh]! + w[EMOTION_INDEX.joy]! * 0.35
    if (laughW > 0.05) {
      const bounce = Math.max(0, Math.sin(time * 12.5 + state.seed * 9))
      p[CH.open] = p[CH.open]! + 0.22 * laughW * bounce
      p[CH.lidLA] = p[CH.lidLA]! + 0.12 * laughW * bounce
      p[CH.lidLB] = p[CH.lidLB]! + 0.12 * laughW * bounce
    }
  }

  // Map A/B (dominant side / other side) is resolved by the consumer; clamp here.
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    const value = p[c]!
    p[c] = value === value ? Math.min(CHANNEL_MAX[c]!, Math.max(CHANNEL_MIN[c]!, value)) : BASE[c]!
  }
}

/** How aroused/nervous the face currently is (drives blink rate). */
export function emotionArousal(state: EmotionState) {
  const w = state.weights
  return Math.max(0, Math.min(1.2, w[EMOTION_INDEX.fear]! + w[EMOTION_INDEX.tense]! + w[EMOTION_INDEX.worried]! * 0.6 + w[EMOTION_INDEX.angry]! * 0.4))
}

/** How sleepy/heavy the eyes are (slows blinks). */
export function emotionHeaviness(state: EmotionState) {
  const w = state.weights
  return Math.max(0, Math.min(1, w[EMOTION_INDEX.sleepy]! + w[EMOTION_INDEX.drunk]! * 0.7 + w[EMOTION_INDEX.hungover]! * 0.8 + w[EMOTION_INDEX.bored]! * 0.4))
}

/** How locked-in the player is (suppresses blinks while concentrating). */
export function emotionFocus(state: EmotionState) {
  const w = state.weights
  return Math.max(0, Math.min(1, w[EMOTION_INDEX.focused]! + w[EMOTION_INDEX.thinking]! * 0.8 + w[EMOTION_INDEX.surprised]! * 0.6))
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

function startBlink(state: EmotionState, time: number, heavy: number, durationScale: number) {
  state.blinkStart = time
  state.blinkDuration = (0.18 + heavy * 0.12) * durationScale
  if (faceHash01(time * 5.7 + state.seed * 41) < 0.14 && state.blinkSecond < 0) state.blinkSecond = time + 0.3
}

/**
 * Natural blinking: a quick close, a beat, a slower open; occasional double
 * blinks; slower and heavier when tired or drunk, rarer while concentrating,
 * more frequent when nervous. `kick` forces a blink (after a big gaze shift).
 */
export function updateBlink(state: EmotionState, person: FacePersonality, kick: boolean) {
  const time = state.time
  const heavy = emotionHeaviness(state)
  const arousal = emotionArousal(state)
  const focus = emotionFocus(state)
  const blinking = time - state.blinkStart < state.blinkDuration
  if (!blinking) {
    if (kick && time > state.blinkStart + 0.6) {
      startBlink(state, time, heavy, 1)
      state.nextBlink = time + person.blinkPeriod * (0.6 + faceHash01(time) * 0.6)
    } else if (state.blinkSecond > 0 && time >= state.blinkSecond) {
      state.blinkSecond = -1
      startBlink(state, time, heavy, 0.85)
    } else if (time >= state.nextBlink) {
      startBlink(state, time, heavy, 1)
      const rate = person.blinkPeriod * (1 + focus * 0.7 - arousal * 0.4)
      state.nextBlink = time + rate * (0.55 + faceHash01(time * 1.3 + state.seed * 12) * 0.95)
    }
  }
  const x = (time - state.blinkStart) / state.blinkDuration
  if (x < 0 || x >= 1) {
    state.blinkValue = 0
  } else {
    // 30% closing, 10% hold, 60% opening.
    state.blinkValue = x < 0.3 ? smooth(x / 0.3) : x < 0.4 ? 1 : 1 - smooth((x - 0.4) / 0.6)
  }
  return state.blinkValue
}

const EMOTE_SETS: Array<{ chars: string; sender: FaceEmotion; target: FaceEmotion }> = [
  { chars: '😂🤣😆😄😁😝😜', sender: 'laugh', target: 'happy' },
  { chars: '😀😃😊🙂👍👏🎉🙌💪🔥💰🤑✅', sender: 'happy', target: 'happy' },
  { chars: '😍🥰❤💖😘😋', sender: 'joy', target: 'happy' },
  { chars: '😎😏😈👿🖕😉', sender: 'smirk', target: 'surprised' },
  { chars: '😡🤬😠😤💢', sender: 'angry', target: 'worried' },
  { chars: '😢😭😞🥺😔💔😥', sender: 'sad', target: 'sad' },
  { chars: '😮😱😲🤯😳👀', sender: 'surprised', target: 'surprised' },
  { chars: '🤔🧐🤨', sender: 'thinking', target: 'suspicious' },
  { chars: '😴🥱😪', sender: 'sleepy', target: 'bored' },
  { chars: '🤢🤮🥴', sender: 'disgust', target: 'disgust' },
  { chars: '😨😰😧', sender: 'fear', target: 'worried' },
]

/** Picks the face for a table emote (emoji) for the player who sent it or the one it was sent to. */
export function emoteToEmotion(emoji: string, role: 'sender' | 'target'): FaceEmotion {
  for (const set of EMOTE_SETS) {
    for (const char of set.chars) if (emoji.includes(char)) return role === 'sender' ? set.sender : set.target
  }
  return role === 'sender' ? 'happy' : 'surprised'
}
