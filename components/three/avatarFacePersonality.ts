/**
 * Per-avatar facial personality: how expressive a player is, how often they
 * blink and look around, which side their smirk lives on, their nervous "tell",
 * eye colour and skin undertone. Everything is derived deterministically from
 * the avatar's seed and profile (face style, brow weight, face shape, idle tell),
 * so a player keeps the same face habits across a session.
 */

export type FaceIrisTone = 'dark' | 'brown' | 'hazel' | 'green' | 'blue' | 'gray'
export type FaceTell = 'brow' | 'lip' | 'nose' | 'squint' | 'swallow'

export interface FacePersonality {
  /** Scales how strongly emotions show (0.55 stoic .. 1.3 animated). */
  expressiveness: number
  /** Scales how fast emotions rise and fall (0.8 sluggish .. 1.3 twitchy). */
  reactivity: number
  /** Average seconds between blinks. */
  blinkPeriod: number
  /** 0 steady gaze .. 1 eyes constantly moving. */
  gazeRestless: number
  /** 0 avoids the camera .. 1 likes to lock eyes with it. */
  eyeContact: number
  /** Which eye/corner leads asymmetric expressions (1 or -1). */
  smirkSide: 1 | -1
  /** Resting mouth-corner bias (-0.1 .. 0.2). */
  baseSmile: number
  /** Resting brow height bias (-0.2 heavy .. 0.15 lifted). */
  baseBrow: number
  /** Resting upper-lid droop (0 wide awake .. 0.18 sleepy-eyed). */
  lidHeavy: number
  tell: FaceTell
  /** Seconds between involuntary micro-expressions. */
  tellPeriod: number
  /** 0..1: how much emotion is suppressed while playing a hand. */
  pokerFace: number
  iris: FaceIrisTone
  /** Lip colour strength 0..1. */
  lipTone: number
  /** Skin undertone: -1 cool/pink .. 1 warm/golden. */
  warmth: number
  /** Brow hair density/width multiplier. */
  browThickness: number
  /** The resting emotion the face drifts towards between events. */
  idle: 'neutral' | 'focused' | 'smirk' | 'happy'
}

export interface FacePersonalityInput {
  seed: number
  faceStyle?: 'calm' | 'focused' | 'smirk' | string
  browWeight?: 'low' | 'medium' | 'high' | string
  faceShape?: 'oval' | 'round' | 'square' | string
  idleTell?: string
}

/** Deterministic pseudo-random in 0..1 (no allocations; reproducible per avatar). */
export function faceHash01(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const IRIS_TONES: FaceIrisTone[] = ['brown', 'dark', 'hazel', 'brown', 'green', 'blue', 'gray', 'hazel']
const TELLS: FaceTell[] = ['brow', 'lip', 'nose', 'squint', 'swallow']

export function getFacePersonality(input: FacePersonalityInput): FacePersonality {
  const seed = Number.isFinite(input.seed) ? input.seed : 0.5
  const r = (salt: number) => faceHash01(seed * 97.13 + salt * 13.7)
  const style = input.faceStyle ?? 'calm'
  const brow = input.browWeight ?? 'medium'
  const shape = input.faceShape ?? 'oval'

  const calm = style === 'calm'
  const focused = style === 'focused'
  const smirk = style === 'smirk'

  const tellByIdle: Record<string, FaceTell> = {
    chip_shuffle: 'lip',
    card_peek: 'squint',
    table_drum: 'brow',
  }
  const tell = tellByIdle[input.idleTell ?? ''] ?? TELLS[Math.floor(r(1) * TELLS.length) % TELLS.length]!

  return {
    expressiveness: (calm ? 0.78 : focused ? 0.92 : 1.12) + (r(2) - 0.5) * 0.28,
    reactivity: 0.86 + r(3) * 0.44,
    blinkPeriod: (focused ? 4.6 : calm ? 3.9 : 3.3) + r(4) * 1.9,
    gazeRestless: THREE_CLAMP((focused ? 0.28 : calm ? 0.42 : 0.6) + (r(5) - 0.5) * 0.4),
    eyeContact: THREE_CLAMP((smirk ? 0.62 : focused ? 0.28 : 0.42) + (r(6) - 0.5) * 0.4),
    smirkSide: r(7) < 0.5 ? 1 : -1,
    baseSmile: (smirk ? 0.16 : calm ? 0.06 : -0.02) + (r(8) - 0.5) * 0.1,
    baseBrow: (brow === 'high' ? 0.1 : brow === 'low' ? -0.16 : -0.02) + (r(9) - 0.5) * 0.06,
    lidHeavy: (focused ? 0.05 : calm ? 0.09 : 0.02) + (shape === 'square' ? 0.03 : 0) + r(10) * 0.05,
    tell,
    tellPeriod: 5.5 + r(11) * 8,
    pokerFace: THREE_CLAMP((calm ? 0.72 : focused ? 0.62 : 0.3) + (r(12) - 0.5) * 0.3),
    iris: IRIS_TONES[Math.floor(r(13) * IRIS_TONES.length) % IRIS_TONES.length]!,
    lipTone: 0.32 + r(14) * 0.4,
    warmth: (r(15) - 0.5) * 2,
    browThickness: (brow === 'high' ? 0.86 : brow === 'low' ? 1.22 : 1.0) + (r(16) - 0.5) * 0.24,
    idle: smirk ? 'smirk' : focused ? 'focused' : 'neutral',
  }
}

function THREE_CLAMP(value: number) {
  return Math.min(1, Math.max(0, value))
}
