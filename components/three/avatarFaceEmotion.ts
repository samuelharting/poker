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
  | 'smug' | 'wince' | 'relief' | 'sip'
  | 'mBrow' | 'mLip' | 'mNose' | 'mSquint' | 'mSwallow'

const EMOTION_DEFS: Record<FaceEmotion, Sparse> = {
  focused: { lidUA: -0.05, lidUB: -0.05, lidLA: 0.12, lidLB: 0.12, browIA: -0.36, browIB: -0.36, browOA: -0.04, browOB: -0.04, smileA: -0.12, smileB: -0.12, width: -0.08, press: 0.32, furrow: 0.45 },
  thinking: { lidUA: -0.05, lidUB: -0.05, lidLA: 0.12, browIA: 0.3, browIB: -0.15, browOA: 0.45, smileA: -0.02, smileB: -0.1, press: 0.38, purse: 0.25, jaw: 0.3, width: -0.1, furrow: 0.15 },
  confident: { lidUA: -0.06, lidUB: -0.06, lidLA: 0.2, lidLB: 0.12, browOA: 0.22, browOB: 0.14, browIA: 0.1, smileA: 0.55, smileB: 0.2, width: 0.04, jaw: 0.1, pupil: 0.05 },
  smirk: { lidUA: -0.08, lidUB: -0.03, lidLA: 0.42, lidLB: 0.1, browIA: 0.2, browOA: 0.32, browIB: -0.12, smileA: 0.85, smileB: 0.04, jaw: 0.4, width: 0.03, teeth: 0.06 },
  happy: { lidUA: -0.03, lidUB: -0.03, lidLA: 0.42, lidLB: 0.42, browIA: 0.12, browIB: 0.12, browOA: 0.22, browOB: 0.22, smileA: 0.62, smileB: 0.58, open: 0.12, teeth: 0.3, width: 0.12, blush: 0.12 },
  joy: { lidUA: -0.06, lidUB: -0.06, lidLA: 0.62, lidLB: 0.62, browIA: 0.3, browIB: 0.3, browOA: 0.4, browOB: 0.4, smileA: 1, smileB: 0.95, open: 0.62, teeth: 1, width: 0.28, blush: 0.3, pupil: 0.25 },
  laugh: { lidUA: -0.18, lidUB: -0.18, lidLA: 0.8, lidLB: 0.8, browIA: 0.1, browIB: 0.1, browOA: 0.3, browOB: 0.3, smileA: 1, smileB: 1, open: 0.8, teeth: 1, width: 0.3, blush: 0.35, sweat: 0.1 },
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
  // Lazy half-lidded eyes, the OTHER brow cocked, a one-sided closed-lip smirk: "told you so".
  smug: { lidUA: -0.32, lidUB: -0.14, lidLA: 0.36, lidLB: 0.16, browIA: -0.28, browOA: -0.12, browIB: 0.6, browOB: 0.95, arch: 0.35, smileA: 0.82, smileB: -0.06, jaw: 0.38, press: 0.3, width: 0.02 },
  // A lopsided grimace: eyes squeezed, one corner yanked down, teeth clenched, nose scrunched.
  wince: { lidUA: -0.64, lidUB: -0.5, lidLA: 0.92, lidLB: 0.78, browIA: -0.45, browIB: -0.25, browOA: -0.22, browOB: -0.12, smileA: -0.78, smileB: -0.2, teeth: 0.95, open: 0.2, width: 0.26, press: 0.1, jaw: -0.35, wrinkle: 0.9, furrow: 0.7 },
  // The exhale after tension: "phew". Brows lift in the middle, lids soften, lips part in a small O.
  relief: { lidUA: -0.4, lidUB: -0.4, lidLA: 0.22, lidLB: 0.22, browIA: 0.5, browIB: 0.5, browOA: -0.1, browOB: -0.1, smileA: 0.4, smileB: 0.38, open: 0.16, width: 0.02, purse: 0.12 },
  // Lips on the rim of a glass: pursed, eyes half closed.
  sip: { lidUA: -0.48, lidUB: -0.48, lidLA: 0.25, lidLB: 0.25, browIA: 0.22, browIB: 0.22, browOA: 0.05, browOB: 0.05, open: 0.03, purse: 0.8, press: 0.35, width: -0.22 },
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
/** Mouth shapes that fight a glass at the lips. */
const SIP_QUIET = (['smirk', 'smug', 'joy', 'laugh', 'happy', 'confident', 'surprised', 'shock', 'tense'] as const).map(name => EMOTION_INDEX[name])
/** Reactions a good poker face suppresses while the hand is live. */
const POKER_FACE_DAMPED = (['sad', 'angry', 'fear', 'worried', 'surprised', 'happy', 'joy', 'smug', 'wince'] as const).map(name => EMOTION_INDEX[name])

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
  /** 0..1 the glass is at the lips (drinking). */
  drinkLift: number
  /** 0..1 the satisfied exhale after putting a drink down. */
  drinkAfter: number
}

export function createFaceContext(): FaceContext {
  return {
    acting: false, folded: false, winner: false, loser: false, passedOut: false, hungover: false, tripping: false,
    dazed: false, drunk: 0, tableHeat: 0, cue: 'ready', cueElapsed: Infinity, cueStartedAt: 0, wager: 0, peeking: false, inHand: false,
    bonked: false, burning: false, cheers: 0, flipOffGiven: false, flipOffReceived: false, otherActing: false,
    anyWinner: false, actingFor: 0, emote: null, emoteAmount: 0, tilt: 0, drinkLift: 0, drinkAfter: 0,
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
  /** Depth of the current blink (a few blinks are partial). */
  blinkAmp: number
  seed: number
  /** Extra emphasis for far-away faces (0..0.4) so expressions read at table distance. */
  boost: number
  /** Reaction clocks (face time the event started, -1e9 = never) and the variant roll 0..1 of the latest event. */
  winAt: number
  loseAt: number
  otherWinAt: number
  reactRoll: number
  wasWinner: boolean
  wasLoser: boolean
  wasOtherWin: boolean
  /** Eye roll: start time, sweep direction, and this frame's offsets (yaw/pitch radians, upper-lid delta). */
  eyeRollAt: number
  eyeRollDir: number
  rollYaw: number
  rollPitch: number
  rollLid: number
  /** 0..1 how far into the eye roll (the gaze hands over to the roll). */
  rollEnv: number
  /** Channel values of the previous frame (per-frame slew limit). */
  prevParams: Float32Array
  hasPrev: boolean
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
    blinkAmp: 1,
    seed,
    boost: 0,
    winAt: -1e9,
    loseAt: -1e9,
    otherWinAt: -1e9,
    reactRoll: faceHash01(seed * 2.9),
    wasWinner: false,
    wasLoser: false,
    wasOtherWin: false,
    eyeRollAt: -1e9,
    eyeRollDir: 1,
    rollYaw: 0,
    rollPitch: 0,
    rollLid: 0,
    rollEnv: 0,
    prevParams: BASE.slice(),
    hasPrev: false,
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

/** A rise at `start`, a hold of `length`, a softer fall (all seconds of `t`). */
function pulse(t: number, start: number, length: number) {
  return smooth((t - start) / 0.18) * (1 - smooth((t - start - length) / 0.5))
}

/** "Ha-ha-ha ... ha-ha": laughter comes in bursts with breaths between, not a constant buzz. */
function laughBurst(time: number, seed: number) {
  const cycle = time * 0.42 + seed * 7
  const f = cycle - Math.floor(cycle)
  return smooth(f / 0.1) * (1 - smooth((f - 0.5) / 0.15))
}

/** How a player celebrates this win: 0 smug-then-grin, 1 elated (wide-eyed, laughing), 2 relieved exhale then grin. */
function winStyle(person: FacePersonality, roll: number) {
  if (person.idle === 'smirk') return roll < 0.65 ? 0 : 1
  if (person.expressiveness > 1) return roll < 0.7 ? 1 : 0
  if (person.expressiveness < 0.85) return roll < 0.5 ? 2 : roll < 0.75 ? 0 : 1
  return roll < 0.4 ? 1 : roll < 0.75 ? 2 : 0
}

/** How a player takes a bad beat: 0 sulk, 1 fume, 2 eye roll, 3 wince. */
function loseStyle(person: FacePersonality, roll: number) {
  if (person.idle === 'smirk') return roll < 0.45 ? 2 : roll < 0.8 ? 1 : 3
  if (person.reactivity > 1.15) return roll < 0.5 ? 1 : roll < 0.8 ? 3 : 0
  if (person.pokerFace > 0.7) return roll < 0.5 ? 0 : roll < 0.8 ? 3 : 2
  return roll < 0.35 ? 0 : roll < 0.6 ? 3 : roll < 0.8 ? 2 : 1
}

function startEyeRoll(state: EmotionState, time: number) {
  state.eyeRollAt = time
  state.eyeRollDir = faceHash01(state.seed * 5.1 + time * 0.7) < 0.5 ? -1 : 1
}

const EYE_ROLL_SECONDS = 1.1

/** The eye roll: up and over from one side to the other, lids sagging a touch. Writes roll offsets. */
function updateEyeRoll(state: EmotionState, time: number) {
  const s = (time - state.eyeRollAt) / EYE_ROLL_SECONDS
  if (!(s >= 0 && s < 1)) {
    state.rollYaw = 0
    state.rollPitch = 0
    state.rollLid = 0
    state.rollEnv = 0
    return
  }
  const theta = Math.PI * smooth(s)
  const env = Math.sin(Math.PI * s)
  state.rollYaw = -state.eyeRollDir * Math.cos(theta) * 0.3 * env
  state.rollPitch = Math.sin(theta) * 0.42 * Math.min(1, env * 1.6)
  state.rollLid = -0.12 * env
  state.rollEnv = Math.min(1, env * 1.8)
}

/** Maps the game context onto target emotion weights (0..1). Writes `state.targets`. */
export function directEmotions(state: EmotionState, ctx: FaceContext, person: FacePersonality, time: number) {
  const t = state.targets
  t.fill(0)
  tgt = t
  const ex = person.expressiveness

  // Reaction clocks: each win / loss starts its own performance, with a fresh variant roll.
  if (ctx.winner && !state.wasWinner) {
    state.winAt = time
    state.reactRoll = faceHash01(state.seed * 31.7 + time * 1.37)
  }
  if (ctx.loser && !state.wasLoser) {
    state.loseAt = time
    state.reactRoll = faceHash01(state.seed * 23.3 + time * 1.91)
  }
  const otherWin = ctx.anyWinner && !ctx.winner
  if (otherWin && !state.wasOtherWin) {
    state.otherWinAt = time
    if (!ctx.loser) state.reactRoll = faceHash01(state.seed * 13.9 + time * 2.3)
  }
  state.wasWinner = ctx.winner
  state.wasLoser = ctx.loser
  state.wasOtherWin = otherWin
  // Per-cue variant (stable for the whole cue, also under reduced motion).
  const cueRoll = faceHash01(state.seed * 17.3 + ctx.cueStartedAt * 3.3)

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
      if (person.idle === 'smirk' && cueRoll < 0.6) {
        // Bravado: a smug shove, with the nerves leaking underneath.
        add('smug', 0.7 * fade)
        add('tense', 0.6 * fade)
      } else {
        // Wide-eyed commitment: a gulp of fear, then the jaw set.
        add('tense', 1.15 * fade)
        add('fear', (0.6 + 0.25 * pulse(since, 0, 0.5)) * fade * (1 - person.pokerFace * 0.4))
        if (person.idle === 'smirk') add('smirk', 0.25 * fade)
      }
    } else if (ctx.cue === 'raise' || ctx.cue === 'bet') {
      // Bluff or value, the face rarely tells: smirk types smirk or cock a brow, stoic types tighten.
      if (person.idle === 'smirk' || person.expressiveness > 1) add(cueRoll < 0.5 ? 'smug' : 'smirk', 0.75 * strength)
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
    // A bad beat: a wide-eyed sting first ("no way"), then the player's own way of taking it.
    const since = time - state.loseAt
    const sting = smooth(since / 0.12) * (1 - smooth((since - 0.55) / 0.6))
    add('shock', (person.pokerFace > 0.7 ? 0.35 : 0.75) * sting * Math.min(1.2, person.reactivity))
    const after = smooth((since - 0.45) / 0.7)
    const style = loseStyle(person, state.reactRoll)
    if (style === 0) {
      add('sad', 1.05 * after)
      add('worried', 0.25 * after)
    } else if (style === 1) {
      add('angry', 0.75 * after)
      add('sad', 0.45 * after)
      add('wince', 0.6 * pulse(since, 0.5, 1.2))
    } else if (style === 2) {
      add('sad', 0.6 * after)
      add('disgust', 0.4 * after)
      if (since > 0.8 && state.eyeRollAt < state.loseAt) startEyeRoll(state, time)
    } else {
      add('wince', 0.9 * pulse(since, 0.35, 1.3))
      add('sad', 0.9 * after)
    }
    t[EMOTION_INDEX.focused] = 0
    t[EMOTION_INDEX.bored] = 0
  } else if (ctx.anyWinner && !ctx.winner && !ctx.folded && ctx.inHand) {
    add('sad', 0.32)
    // Smug types roll their eyes at someone else's lucky pot.
    const since = time - state.otherWinAt
    if (person.idle === 'smirk' && state.reactRoll < 0.5 && since > 0.6 && state.eyeRollAt < state.otherWinAt) startEyeRoll(state, time)
  }

  if (ctx.winner) {
    const since = time - state.winAt
    const laughy = person.expressiveness > 0.95
    const burst = laughBurst(time, state.seed)
    const style = winStyle(person, state.reactRoll)
    if (style === 0) {
      // "Of course." A smug beat, then it breaks into a grin (and a chuckle for the laughy ones).
      const smugW = 1 - smooth((since - 1.4) / 1.0)
      set('smug', 0.9 * smugW)
      add('confident', 0.3 * smugW)
      set('joy', 0.8 * smooth((since - 1.0) / 1.0))
      if (laughy) set('laugh', 0.45 * burst * smooth((since - 1.3) / 0.6))
    } else if (style === 1) {
      // "YES!" Wide eyes for a beat, then a big open grin and bursts of laughter.
      add('surprised', 0.7 * smooth(since / 0.12) * (1 - smooth((since - 0.35) / 0.6)))
      set('joy', 0.95 * smooth((since - 0.15) / 0.5))
      set('laugh', (laughy ? 0.75 : 0.45) * burst * smooth((since - 0.5) / 0.5))
    } else {
      // "Phew." A long exhale, then a warm grin.
      add('relief', 0.85 * smooth(since / 0.25) * (1 - smooth((since - 0.8) / 0.6)))
      set('happy', 0.75 * smooth((since - 0.35) / 0.5))
      set('joy', 0.75 * smooth((since - 0.8) / 0.6))
      if (laughy) set('laugh', 0.35 * burst * smooth((since - 1.2) / 0.6))
    }
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
    if (person.idle === 'smirk') {
      // Unimpressed: an eye roll and a smug look back.
      add('smug', 0.5)
      if (time - state.eyeRollAt > 5) startEyeRoll(state, time)
    } else {
      add('surprised', 0.45)
      add('angry', 0.4)
    }
  }
  if (ctx.drinkLift > 0.02) {
    // Lips on the rim: purse, lids half down; mouth shapes that fight the glass fade out.
    set('sip', ctx.drinkLift)
    const quiet = 1 - 0.75 * ctx.drinkLift
    for (let i = 0; i < SIP_QUIET.length; i += 1) t[SIP_QUIET[i]!] = t[SIP_QUIET[i]!]! * quiet
  }
  if (ctx.drinkAfter > 0.01) {
    // "Aah": the satisfied exhale after a sip.
    add('relief', 0.75 * ctx.drinkAfter)
    add('happy', 0.22 * ctx.drinkAfter)
  }
  if (ctx.burning) {
    // The shot burns: a lopsided wince with a shudder of disgust.
    set('wince', 0.85)
    add('disgust', 0.5)
    add('pain', 0.2)
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
    if (name === 'sleepy' || name === 'hungover' || name === 'drunk' || name === 'pain' || name === 'shock' || name === 'sip') continue
    t[i] = t[i]! * (name === 'joy' || name === 'laugh' ? Math.min(1.1, ex) : ex)
  }
  // A good poker face suppresses reactions to the hand while it is live.
  if (ctx.inHand && !ctx.folded && !ctx.winner && !ctx.loser) {
    const damp = 1 - person.pokerFace * 0.32
    for (let i = 0; i < POKER_FACE_DAMPED.length; i += 1) t[POKER_FACE_DAMPED[i]!] = t[POKER_FACE_DAMPED[i]!]! * damp
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
    // All in and waiting for the cards: nervous swallows and lip presses come much more often.
    const sweating = active && ctx.cue === 'all_in' && !ctx.winner && !ctx.loser
    if (sweating && !ctx.passedOut) {
      trigger(state, time, faceHash01(time * 1.9 + state.seed * 7) < 0.6 ? EMOTION_INDEX.mSwallow : tellIndex, 0.6 * leak + 0.25)
      state.nextMicro = time + 1.8 + faceHash01(time * 1.3 + state.seed * 5) * 1.8
    } else {
      if (active && !ctx.passedOut) trigger(state, time, faceHash01(time * 2.3 + state.seed * 19) < 0.7 ? tellIndex : randomIndex, 0.55 * leak + 0.15)
      state.nextMicro = time + person.tellPeriod * (0.6 + faceHash01(time * 1.7 + state.seed * 33) * 0.8)
    }
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
    const s = state.seed * 40
    const breath = 0.5 + 0.5 * Math.sin(time * 1.65 + state.seed * 20)
    p[CH.open] = p[CH.open]! + 0.012 + 0.028 * breath * (1 - Math.min(1, p[CH.press]! * 1.5))
    // Breathing reaches the upper face a little: brows and lids lift a hair on each inhale.
    p[CH.browIA] = p[CH.browIA]! + 0.018 * breath
    p[CH.browIB] = p[CH.browIB]! + 0.018 * breath
    p[CH.lidUA] = p[CH.lidUA]! + 0.012 * breath
    p[CH.lidUB] = p[CH.lidUB]! + 0.012 * breath
    // Idle mouth life (slow, never twitchy): the lips drift a touch sideways, one corner wanders,
    // and now and then the lips press together or purse, as a resting mouth does.
    const calm = 1 - Math.min(1, p[CH.open]! * 2)
    const drift = Math.sin(time * 0.37 + s) + 0.6 * Math.sin(time * 0.61 + s * 1.7)
    const wander = Math.sin(time * 0.29 + s * 2.3) + 0.5 * Math.sin(time * 0.83 + s * 0.9)
    const pressWave = Math.max(0, Math.sin(time * 0.23 + s * 0.4))
    const purseWave = Math.max(0, Math.sin(time * 0.17 + s * 1.3 + 2))
    p[CH.jaw] = p[CH.jaw]! + 0.05 * drift * calm
    p[CH.smileA] = p[CH.smileA]! + 0.022 * wander * calm
    p[CH.smileB] = p[CH.smileB]! - 0.014 * wander * calm
    p[CH.press] = p[CH.press]! + 0.12 * pressWave * pressWave * pressWave * calm
    p[CH.purse] = p[CH.purse]! + 0.1 * purseWave * purseWave * purseWave * purseWave * calm
    const drunkW = w[EMOTION_INDEX.drunk]!
    if (drunkW > 0.02) {
      p[CH.lidUA] = p[CH.lidUA]! + 0.09 * drunkW * Math.sin(time * 0.83 + 1.3)
      p[CH.lidUB] = p[CH.lidUB]! + 0.09 * drunkW * Math.sin(time * 0.71 + 0.2)
      p[CH.jaw] = p[CH.jaw]! + 0.18 * drunkW * Math.sin(time * 0.6)
    }
    const laughW = w[EMOTION_INDEX.laugh]! + w[EMOTION_INDEX.joy]! * 0.35
    if (laughW > 0.05) {
      // "Ha-ha-ha": a smooth ~3.5 Hz bounce of the jaw and cheeks (each person a little different).
      const rate = 3.1 + faceHash01(state.seed * 4.7) * 0.9
      const wave = 0.5 + 0.5 * Math.sin(time * rate * Math.PI * 2 + state.seed * 9)
      const bounce = wave * wave
      p[CH.open] = p[CH.open]! + 0.2 * laughW * bounce
      p[CH.lidLA] = p[CH.lidLA]! + 0.12 * laughW * bounce
      p[CH.lidLB] = p[CH.lidLB]! + 0.12 * laughW * bounce
      p[CH.browIA] = p[CH.browIA]! + 0.06 * laughW * bounce
      p[CH.browIB] = p[CH.browIB]! + 0.06 * laughW * bounce
    }
  }
  updateEyeRoll(state, time)
  p[CH.lidUA] = p[CH.lidUA]! + state.rollLid
  p[CH.lidUB] = p[CH.lidUB]! + state.rollLid

  // Map A/B (dominant side / other side) is resolved by the consumer; clamp here.
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    const value = p[c]!
    p[c] = value === value ? Math.min(CHANNEL_MAX[c]!, Math.max(CHANNEL_MIN[c]!, value)) : BASE[c]!
  }

  // Safety net against pops: no channel moves more than MAX_CHANNEL_RATE per second (springs and
  // procedural motion stay well inside this; only a stacked onset ever reaches it).
  const prev = state.prevParams
  if (!instant && state.hasPrev && dt > 0) {
    const step = MAX_CHANNEL_RATE * dt
    for (let c = 0; c < CHANNEL_COUNT; c += 1) {
      const from = prev[c]!
      const value = p[c]!
      if (value > from + step) p[c] = from + step
      else if (value < from - step) p[c] = from - step
    }
  }
  prev.set(p)
  state.hasPrev = true
}

/** Channel units per second (0.1 per frame at 60 fps). */
const MAX_CHANNEL_RATE = 6

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

function startBlink(state: EmotionState, time: number, heavy: number, durationScale: number, full = false) {
  state.blinkStart = time
  state.blinkDuration = (0.18 + heavy * 0.12) * durationScale
  // About one blink in nine is a lazy, partial one (not when tired: those close all the way, slowly).
  const partial = !full && heavy < 0.3 && faceHash01(time * 3.3 + state.seed * 29) < 0.11
  state.blinkAmp = partial ? 0.55 + 0.25 * faceHash01(time * 7.9 + state.seed) : 1
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
      startBlink(state, time, heavy, 1, true)
      state.nextBlink = time + person.blinkPeriod * (0.6 + faceHash01(time) * 0.6)
    } else if (state.blinkSecond > 0 && time >= state.blinkSecond) {
      state.blinkSecond = -1
      startBlink(state, time, heavy, 0.85, true)
    } else if (time >= state.nextBlink) {
      startBlink(state, time, heavy, 1)
      const rate = person.blinkPeriod * (1 + focus * 0.7 - arousal * 0.4)
      // Blinks cluster: now and then two or three come close together, followed by a longer
      // stare (the average rate stays the same). Nervous faces cluster more.
      const roll = faceHash01(time * 1.3 + state.seed * 12)
      const clusterChance = 0.22 + arousal * 0.2
      state.nextBlink = roll < clusterChance
        ? time + 0.45 + faceHash01(time * 2.9 + state.seed * 3) * 0.7
        : time + rate * (0.75 + (roll - clusterChance) / (1 - clusterChance) * 1.1)
    }
  }
  const x = (time - state.blinkStart) / state.blinkDuration
  if (x < 0 || x >= 1) {
    state.blinkValue = 0
  } else {
    // 30% closing, 10% hold, 60% opening.
    state.blinkValue = (x < 0.3 ? smooth(x / 0.3) : x < 0.4 ? 1 : 1 - smooth((x - 0.4) / 0.6)) * state.blinkAmp
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
