import type { ThreeActionCue } from './tableViewModel'

export type HeroHandSide = 'left' | 'right'
export type Vec3 = [number, number, number]
export type PokerActionVariant = 0 | 1 | 2
export type FoldMotionStyle = 'slide' | 'snap' | 'toss'
export type CheckMotionStyle = 'single' | 'double' | 'knuckle'
export type WagerMotionStyle = 'slide' | 'flick' | 'shove'

export interface PokerActionPoseOptions {
  /** A server action id/key. Combined with playerId to keep repeats deterministic. */
  actionKey?: string | number
  /** The acting player. Combined with actionKey so different seats do not move alike. */
  playerId?: string
  /** Explicitly select one of the three motion personalities. */
  variant?: PokerActionVariant
  /** Normalized size/importance of a wager, from 0 (tiny) to 1 (huge). */
  wagerIntensity?: number
}

export interface PokerActionMotionProfile {
  variant: PokerActionVariant
  foldStyle: FoldMotionStyle
  checkStyle: CheckMotionStyle
  wagerStyle: WagerMotionStyle
  wagerIntensity: number
}

export interface HeroHandActionPose {
  position: Vec3
  rotation: Vec3
  fingerCurl: number
}

export interface PropActionPose {
  visible: boolean
  position: Vec3
  rotation: Vec3
  opacity: number
}

export interface SeatedAvatarActionPose {
  bodyPosition: Vec3
  bodyRotation: Vec3
  armPosition: Vec3
  armRotation: Vec3
  headRotation: Vec3
}

export interface OpponentTableHandPose {
  position: Vec3
  rotation: Vec3
  fingerCurl: number
}

export interface OpponentTableActionPose {
  hand: OpponentTableHandPose
  cards: PropActionPose
  chipPush: PropActionPose
}

export const ACTION_ANIMATION_DURATION_MS = 980

const FOLD_MOTION_STYLES: readonly FoldMotionStyle[] = ['slide', 'snap', 'toss']
const CHECK_MOTION_STYLES: readonly CheckMotionStyle[] = ['single', 'double', 'knuckle']
const WAGER_MOTION_STYLES: readonly WagerMotionStyle[] = ['slide', 'flick', 'shove']

/**
 * Pick a repeatable motion personality without storing extra UI state.
 * Supplying neither value intentionally returns the legacy/default variant.
 */
export function derivePokerActionVariant(
  actionKey?: string | number,
  playerId = ''
): PokerActionVariant {
  if ((actionKey === undefined || actionKey === '') && !playerId) {
    return 0
  }

  const seed = `${playerId}:${actionKey ?? ''}`
  let hash = 2166136261

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) % 3 as PokerActionVariant
}

/**
 * Converts a wager into a normalized dramatic-intensity value. A pot-sized bet
 * reads strongly while smaller blind-sized actions stay restrained.
 */
export function deriveWagerIntensity(amount: number, bigBlind: number, pot = 0): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0
  }

  const blindReference = Number.isFinite(bigBlind) && bigBlind > 0 ? bigBlind : 1
  const potReference = Number.isFinite(pot) && pot > 0 ? pot * 0.45 : 0
  const reference = Math.max(blindReference, potReference)
  const ratio = amount / reference

  return clamp01(Math.log2(1 + ratio) / 2.6)
}

export function getPokerActionMotionProfile(
  cue: ThreeActionCue,
  options: PokerActionPoseOptions = {}
): PokerActionMotionProfile {
  const variant = options.variant ?? derivePokerActionVariant(options.actionKey, options.playerId)

  return {
    variant,
    foldStyle: FOLD_MOTION_STYLES[variant],
    checkStyle: CHECK_MOTION_STYLES[variant],
    wagerStyle: WAGER_MOTION_STYLES[variant],
    wagerIntensity: resolveWagerIntensity(cue, options.wagerIntensity),
  }
}

const restHandPose: HeroHandActionPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  fingerCurl: 0,
}

const hiddenPropPose: PropActionPose = {
  visible: false,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  opacity: 0,
}

const restAvatarPose: SeatedAvatarActionPose = {
  bodyPosition: [0, 0, 0],
  bodyRotation: [0, 0, 0],
  armPosition: [0, 0, 0],
  armRotation: [0, 0, 0],
  headRotation: [0, 0, 0],
}

const restOpponentHandPose: OpponentTableHandPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  fingerCurl: 0.18,
}

const visibleOpponentCardsPose: PropActionPose = {
  visible: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  opacity: 1,
}

export function getHeroHandActionPose(
  cue: ThreeActionCue,
  side: HeroHandSide,
  elapsedMs: number,
  options: PokerActionPoseOptions = {}
): HeroHandActionPose {
  const progress = getProgress(elapsedMs)
  const profile = getPokerActionMotionProfile(cue, options)

  if (progress >= 1 || side === 'left') {
    return restHandPose
  }

  switch (cue) {
    case 'fold': {
      const styledProgress = profile.foldStyle === 'snap'
        ? clamp01(progress * 1.18)
        : profile.foldStyle === 'toss'
          ? clamp01(progress * 1.04)
          : progress
      const windup = easeOutCubic(clamp01(styledProgress / 0.16))
      const reach = easeInOut(clamp01((styledProgress - 0.12) / 0.36))
      const sweep = easeInOut(clamp01((styledProgress - 0.44) / 0.32))
      const settle = easeInOut(clamp01((styledProgress - 0.72) / 0.2))
      const lift = Math.sin(clamp01((styledProgress - 0.06) / 0.7) * Math.PI)
      const snapScale = profile.foldStyle === 'snap' ? 1.14 : 1
      const tossScale = profile.foldStyle === 'toss' ? 0.9 : 1
      const tossArc = profile.foldStyle === 'toss'
        ? Math.sin(clamp01((styledProgress - 0.1) / 0.62) * Math.PI)
        : 0

      return {
        position: [
          0.12 * windup - 1.6 * reach * snapScale * tossScale - 0.28 * sweep + 0.1 * settle,
          0.025 * windup + 0.07 * lift + 0.12 * tossArc - 0.045 * settle,
          0.055 * windup - 0.82 * reach * snapScale * tossScale - 0.48 * sweep + 0.04 * settle,
        ],
        rotation: [
          -0.08 * windup + 0.26 * reach + 0.16 * tossArc - 0.05 * settle,
          0.08 * windup - 0.22 * reach - 0.08 * sweep,
          0.08 * windup - 0.22 * reach - 0.34 * sweep - 0.3 * tossArc,
        ],
        fingerCurl: 0.86 * reach * (1 - 0.38 * sweep),
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.14))
      const firstStrike = Math.sin(clamp01((progress - 0.1) / 0.2) * Math.PI)
      const secondStrike = profile.checkStyle === 'double'
        ? Math.sin(clamp01((progress - 0.39) / 0.2) * Math.PI)
        : 0
      const strike = Math.max(firstStrike, secondStrike * 0.9)
      const rebound = Math.sin(clamp01((progress - 0.28) / 0.24) * Math.PI)
      const settle = easeOutCubic(clamp01((progress - 0.46) / 0.26))
      const release = 1 - easeOutCubic(clamp01((progress - 0.42) / 0.28))
      const curled = Math.max(strike, windup * (1 - settle))
      const knuckleScale = profile.checkStyle === 'knuckle' ? 1.16 : 1
      const reachScale = profile.checkStyle === 'knuckle' ? 0.78 : 1

      return {
        position: [
          (-0.034 * strike + 0.012 * rebound) * reachScale,
          0.034 * windup - 0.136 * strike * knuckleScale + 0.024 * rebound - 0.006 * settle,
          (-0.052 * strike + 0.014 * rebound) * reachScale,
        ],
        rotation: [
          0.07 * windup + 0.22 * strike * knuckleScale - 0.045 * rebound,
          -0.025 * strike + 0.012 * rebound,
          -0.085 * strike * knuckleScale + 0.024 * rebound,
        ],
        fingerCurl: Math.min(1, 0.94 * curled * release * knuckleScale),
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const wagerScale = getWagerPoseScale(profile, options)
      const styleReach = profile.wagerStyle === 'flick' ? 0.84 : profile.wagerStyle === 'shove' ? 1.17 : 1
      const styleLift = profile.wagerStyle === 'flick' ? 1.48 : profile.wagerStyle === 'shove' ? 0.78 : 1
      const styleTempo = profile.wagerStyle === 'flick' ? 1.2 : profile.wagerStyle === 'shove' ? 0.94 : 1
      const styledProgress = clamp01(progress * styleTempo)
      const windup = easeOutCubic(clamp01(styledProgress / 0.16))
      const grab = easeOutCubic(clamp01((styledProgress - 0.08) / 0.2))
      const carry = easeInOut(clamp01((styledProgress - 0.17) / 0.57))
      const settle = easeOutCubic(clamp01((styledProgress - 0.74) / 0.2))
      const release = styledProgress < 0.78 ? 1 : 1 - clamp01((styledProgress - 0.78) / 0.18)
      const lift = Math.sin(clamp01((styledProgress - 0.07) / 0.74) * Math.PI)
      const shoveScale = cue === 'all_in' ? 1.34 : cue === 'raise' ? 1.08 : 1
      const liftScale = cue === 'all_in' ? 1.32 : cue === 'raise' ? 1.08 : 1
      const commitLift = cue === 'all_in' ? 0.04 * carry : 0
      const reachScale = shoveScale * styleReach * wagerScale

      return {
        position: [
          0.14 * windup + 0.08 * grab - 1.78 * carry * reachScale + 0.08 * settle,
          0.026 * windup + 0.064 * lift * liftScale * styleLift + commitLift - 0.012 * settle,
          0.08 * windup - 0.24 * grab - 1.54 * carry * reachScale + 0.06 * settle,
        ],
        rotation: [
          0.08 * windup + 0.15 * grab + 0.2 * carry * liftScale * styleLift - 0.04 * settle,
          -0.14 * carry * reachScale,
          -0.25 * carry * reachScale + 0.04 * settle,
        ],
        fingerCurl: 0.78 * grab * release,
      }
    }
    default:
      return restHandPose
  }
}

export function getHeroChipActionPose(
  cue: ThreeActionCue,
  elapsedMs: number,
  options: PokerActionPoseOptions = {}
): PropActionPose {
  if (!isWagerCue(cue)) {
    return hiddenPropPose
  }

  const progress = getProgress(elapsedMs)
  const profile = getPokerActionMotionProfile(cue, options)

  if (progress >= 0.96) {
    return hiddenPropPose
  }

  const styleTempo = profile.wagerStyle === 'flick' ? 1.24 : profile.wagerStyle === 'shove' ? 0.92 : 1
  const styledProgress = clamp01(progress * styleTempo)
  const travel = easeOutCubic(clamp01((styledProgress - 0.12) / 0.62))
  const arc = Math.sin(clamp01((styledProgress - 0.03) / 0.76) * Math.PI)
  const settle = Math.sin(clamp01((progress - 0.78) / 0.18) * Math.PI) * 0.018
  const wagerScale = getWagerPoseScale(profile, options)
  const travelScale = profile.wagerStyle === 'flick' ? 0.88 : profile.wagerStyle === 'shove' ? 1.2 : 1
  const arcScale = profile.wagerStyle === 'flick' ? 1.72 : profile.wagerStyle === 'shove' ? 0.54 : 1
  const spinScale = profile.wagerStyle === 'flick' ? 1.85 : profile.wagerStyle === 'shove' ? 0.62 : 1

  return {
    visible: true,
    position: [
      -1.72 * travel * travelScale * wagerScale,
      0.16 * arc * arcScale + 0.035 * arc * (wagerScale - 1) - settle,
      -1.3 * travel * travelScale * wagerScale,
    ],
    rotation: [
      profile.wagerStyle === 'flick' ? progress * Math.PI * 0.7 : 0,
      progress * Math.PI * 3.2 * spinScale,
      0.08 * arc * arcScale,
    ],
    opacity: Math.max(0, 1 - Math.max(0, progress - 0.86) / 0.1),
  }
}

export function getHeroCardActionPose(
  cue: ThreeActionCue,
  elapsedMs: number,
  options: PokerActionPoseOptions = {}
): PropActionPose {
  if (cue !== 'fold') {
    return hiddenPropPose
  }

  const progress = getProgress(elapsedMs)
  const profile = getPokerActionMotionProfile(cue, options)

  if (progress >= 0.94) {
    return hiddenPropPose
  }

  const styleTempo = profile.foldStyle === 'snap' ? 1.32 : profile.foldStyle === 'toss' ? 1.06 : 1
  const styledProgress = clamp01(progress * styleTempo)
  const gather = easeOutCubic(clamp01(styledProgress / 0.22))
  const slide = easeOutCubic(clamp01((styledProgress - 0.12) / 0.66))
  const fade = easeInOut(clamp01((styledProgress - 0.55) / 0.34))
  const distanceScale = profile.foldStyle === 'snap' ? 1.17 : profile.foldStyle === 'toss' ? 0.92 : 1
  const tossArc = profile.foldStyle === 'toss'
    ? Math.sin(clamp01((styledProgress - 0.08) / 0.72) * Math.PI)
    : 0
  const snapSkitter = profile.foldStyle === 'snap'
    ? Math.sin(clamp01((styledProgress - 0.5) / 0.26) * Math.PI) * 0.018
    : 0

  return {
    visible: true,
    position: [
      -0.92 * slide * distanceScale,
      0.07 * Math.sin(clamp01(styledProgress / 0.68) * Math.PI) + 0.2 * tossArc - snapSkitter,
      -0.78 * slide * distanceScale,
    ],
    rotation: [
      0.035 * gather + 0.18 * tossArc,
      -0.08 * slide + 0.24 * tossArc,
      -0.38 * slide - 0.9 * tossArc,
    ],
    opacity: Math.max(0.08, 1 - fade * 0.9),
  }
}

export function getSeatedAvatarActionPose(
  cue: ThreeActionCue,
  elapsedMs: number,
  options: PokerActionPoseOptions = {}
): SeatedAvatarActionPose {
  const progress = getProgress(elapsedMs)
  const profile = getPokerActionMotionProfile(cue, options)

  if (progress >= 1 || cue === 'ready') {
    return restAvatarPose
  }

  switch (cue) {
    case 'fold': {
      const styleTempo = profile.foldStyle === 'snap' ? 1.18 : profile.foldStyle === 'toss' ? 1.04 : 1
      const styledProgress = clamp01(progress * styleTempo)
      const lean = easeInOut(clamp01((styledProgress - 0.08) / 0.54))
      const drop = easeInOut(clamp01((styledProgress - 0.16) / 0.44))
      const recoil = 1 - easeOutCubic(clamp01((styledProgress - 0.7) / 0.22))
      const snapScale = profile.foldStyle === 'snap' ? 1.14 : 1
      const tossTurn = profile.foldStyle === 'toss'
        ? Math.sin(clamp01((styledProgress - 0.1) / 0.66) * Math.PI)
        : 0

      return {
        bodyPosition: [0, -0.065 * lean * recoil * snapScale, 0.045 * lean * recoil],
        bodyRotation: [
          0.22 * lean * recoil * snapScale,
          -0.03 * lean * recoil - 0.055 * tossTurn,
          -0.035 * lean * recoil - 0.04 * tossTurn,
        ],
        armPosition: [0, -0.04 * drop * recoil + 0.03 * tossTurn, 0.025 * drop * recoil],
        armRotation: [
          -0.34 * drop * recoil + 0.12 * tossTurn,
          0.05 * drop * recoil + 0.08 * tossTurn,
          -0.04 * drop * recoil - 0.12 * tossTurn,
        ],
        headRotation: [0.1 * lean * recoil, 0.035 * lean * recoil + 0.03 * tossTurn, 0.02 * lean * recoil],
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.15))
      const firstStrike = Math.sin(clamp01((progress - 0.14) / 0.22) * Math.PI)
      const secondStrike = profile.checkStyle === 'double'
        ? Math.sin(clamp01((progress - 0.42) / 0.2) * Math.PI)
        : 0
      const strike = Math.max(firstStrike, secondStrike * 0.9)
      const rebound = Math.sin(clamp01((progress - 0.34) / 0.2) * Math.PI)
      const settle = 1 - easeOutCubic(clamp01((progress - 0.5) / 0.3))
      const active = Math.max(strike, rebound * 0.45, windup * settle)
      const knuckleScale = profile.checkStyle === 'knuckle' ? 1.2 : 1
      const reachScale = profile.checkStyle === 'knuckle' ? 0.82 : 1

      return {
        bodyPosition: [0, -0.01 * strike, -0.016 * strike],
        bodyRotation: [0.055 * strike * knuckleScale, -0.018 * strike, 0.036 * strike],
        armPosition: [
          0,
          0.034 * windup - 0.1 * strike * knuckleScale + 0.022 * rebound,
          -0.045 * strike * reachScale,
        ],
        armRotation: [
          0.34 * strike * knuckleScale - 0.07 * rebound,
          -0.025 * strike,
          -0.08 * strike * knuckleScale,
        ],
        headRotation: [0.035 * active, 0.018 * strike, 0.012 * strike],
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const styleTempo = profile.wagerStyle === 'flick' ? 1.18 : profile.wagerStyle === 'shove' ? 0.94 : 1
      const styledProgress = clamp01(progress * styleTempo)
      const gather = easeOutCubic(clamp01(styledProgress / 0.2))
      const push = easeInOut(clamp01((styledProgress - 0.16) / 0.54))
      const settle = 1 - easeOutCubic(clamp01((styledProgress - 0.76) / 0.18))
      const reachScale = cue === 'all_in' ? 1.42 : cue === 'raise' ? 1.14 : 1
      const postureScale = cue === 'all_in' ? 1.3 : cue === 'raise' ? 1.1 : 1
      const wagerScale = getWagerPoseScale(profile, options)
      const styleReach = profile.wagerStyle === 'flick' ? 0.82 : profile.wagerStyle === 'shove' ? 1.2 : 1
      const stylePosture = profile.wagerStyle === 'flick' ? 0.72 : profile.wagerStyle === 'shove' ? 1.18 : 1
      const activePush = push * settle
      const committedReach = reachScale * wagerScale * styleReach

      return {
        bodyPosition: [0, 0.012 * gather * settle, -0.048 * activePush * committedReach],
        bodyRotation: [
          0.1 * activePush * committedReach * postureScale * stylePosture,
          -0.035 * activePush * postureScale * stylePosture,
          0.028 * activePush * stylePosture,
        ],
        armPosition: [0, 0.03 * gather * settle, -0.15 * activePush * committedReach],
        armRotation: [
          0.28 * activePush * committedReach,
          -0.048 * activePush * postureScale * stylePosture,
          -0.14 * activePush * stylePosture,
        ],
        headRotation: [
          -0.032 * activePush * postureScale * stylePosture,
          0.024 * activePush,
          0.014 * activePush,
        ],
      }
    }
    default:
      return restAvatarPose
  }
}

export function getOpponentTableActionPose(
  cue: ThreeActionCue,
  elapsedMs: number,
  options: PokerActionPoseOptions = {}
): OpponentTableActionPose {
  const progress = getProgress(elapsedMs)
  const profile = getPokerActionMotionProfile(cue, options)

  if (cue === 'fold' && progress >= 1) {
    return {
      hand: restOpponentHandPose,
      cards: hiddenPropPose,
      chipPush: hiddenPropPose,
    }
  }

  if (progress >= 1 || cue === 'ready') {
    return {
      hand: restOpponentHandPose,
      cards: visibleOpponentCardsPose,
      chipPush: hiddenPropPose,
    }
  }

  switch (cue) {
    case 'fold': {
      const styleTempo = profile.foldStyle === 'snap' ? 1.28 : profile.foldStyle === 'toss' ? 1.05 : 1
      const styledProgress = clamp01(progress * styleTempo)
      const reach = easeOutCubic(clamp01(styledProgress / 0.32))
      const slide = easeInOut(clamp01((styledProgress - 0.18) / 0.56))
      const fade = easeInOut(clamp01((styledProgress - 0.52) / 0.36))
      const recoil = 1 - easeOutCubic(clamp01((styledProgress - 0.78) / 0.18))
      const lift = Math.sin(clamp01(styledProgress / 0.74) * Math.PI)
      const distanceScale = profile.foldStyle === 'snap' ? 1.18 : profile.foldStyle === 'toss' ? 0.92 : 1
      const tossArc = profile.foldStyle === 'toss'
        ? Math.sin(clamp01((styledProgress - 0.08) / 0.7) * Math.PI)
        : 0

      return {
        hand: {
          position: [
            -0.06 * reach * recoil - 0.12 * slide * distanceScale,
            0.05 * reach + 0.038 * lift + 0.08 * tossArc - 0.02 * slide,
            -0.34 * reach + 0.12 * slide * distanceScale,
          ],
          rotation: [
            0.2 * reach + 0.14 * tossArc - 0.06 * slide,
            -0.04 * reach - 0.06 * slide,
            -0.12 * reach - 0.16 * slide - 0.22 * tossArc,
          ],
          fingerCurl: 0.86 * reach * (1 - 0.36 * slide) * Math.max(0.22, recoil),
        },
        cards: {
          visible: progress < 0.94,
          position: [
            -0.18 * slide * distanceScale,
            0.054 * lift + 0.18 * tossArc - 0.022 * fade,
            -0.96 * slide * distanceScale,
          ],
          rotation: [
            0.05 * reach + 0.16 * tossArc,
            -0.06 * slide + 0.2 * tossArc,
            -0.18 * slide - 0.78 * tossArc,
          ],
          opacity: Math.max(0, 1 - fade),
        },
        chipPush: hiddenPropPose,
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.15))
      const firstTap = Math.sin(clamp01((progress - 0.14) / 0.22) * Math.PI)
      const secondTap = profile.checkStyle === 'double'
        ? Math.sin(clamp01((progress - 0.42) / 0.2) * Math.PI)
        : 0
      const tap = Math.max(firstTap, secondTap * 0.9)
      const rebound = Math.sin(clamp01((progress - 0.34) / 0.22) * Math.PI)
      const settle = 1 - easeOutCubic(clamp01((progress - 0.52) / 0.28))
      const active = Math.max(tap, rebound * 0.5, windup * settle)
      const knuckleScale = profile.checkStyle === 'knuckle' ? 1.18 : 1
      const reachScale = profile.checkStyle === 'knuckle' ? 0.8 : 1

      return {
        hand: {
          position: [
            -0.012 * tap * reachScale,
            0.054 * windup - 0.11 * tap * knuckleScale + 0.024 * rebound,
            -0.035 * tap * reachScale,
          ],
          rotation: [
            0.32 * tap * knuckleScale - 0.06 * rebound,
            -0.028 * tap,
            -0.08 * tap * knuckleScale,
          ],
          fingerCurl: Math.min(1, 0.24 + 0.52 * active * knuckleScale),
        },
        cards: visibleOpponentCardsPose,
        chipPush: hiddenPropPose,
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const styleTempo = profile.wagerStyle === 'flick' ? 1.2 : profile.wagerStyle === 'shove' ? 0.93 : 1
      const styledProgress = clamp01(progress * styleTempo)
      const gather = easeOutCubic(clamp01(styledProgress / 0.18))
      const push = easeInOut(clamp01((styledProgress - 0.14) / 0.58))
      const fade = easeInOut(clamp01((styledProgress - 0.78) / 0.16))
      const lift = Math.sin(clamp01((styledProgress - 0.08) / 0.7) * Math.PI)
      const reachScale = cue === 'all_in' ? 1.5 : cue === 'raise' ? 1.2 : cue === 'bet' ? 1.08 : 1
      const wagerScale = getWagerPoseScale(profile, options)
      const styleReach = profile.wagerStyle === 'flick' ? 0.84 : profile.wagerStyle === 'shove' ? 1.22 : 1
      const styleArc = profile.wagerStyle === 'flick' ? 1.65 : profile.wagerStyle === 'shove' ? 0.64 : 1
      const committedReach = reachScale * wagerScale * styleReach

      return {
        hand: {
          position: [
            0.06 * gather,
            0.04 * gather + 0.034 * lift * styleArc,
            -0.4 * push * committedReach,
          ],
          rotation: [
            0.1 * gather + 0.22 * push * committedReach,
            -0.04 * push,
            -0.18 * push * committedReach,
          ],
          fingerCurl: 0.28 + 0.46 * gather * (1 - 0.55 * fade),
        },
        cards: visibleOpponentCardsPose,
        chipPush: {
          visible: progress < 0.94,
          position: [
            0.02 * gather,
            0.06 * lift * styleArc + 0.025 * lift * (wagerScale - 1) - 0.02 * fade,
            -0.66 * push * committedReach,
          ],
          rotation: [
            profile.wagerStyle === 'flick' ? progress * Math.PI * 0.6 : 0,
            progress * Math.PI * (profile.wagerStyle === 'flick' ? 4.1 : profile.wagerStyle === 'shove' ? 1.5 : 2.4),
            0.08 * lift * styleArc,
          ],
          opacity: Math.max(0, 1 - fade * 0.72),
        },
      }
    }
    default:
      return {
        hand: restOpponentHandPose,
        cards: visibleOpponentCardsPose,
        chipPush: hiddenPropPose,
      }
  }
}

function resolveWagerIntensity(cue: ThreeActionCue, requested?: number) {
  if (requested !== undefined && Number.isFinite(requested)) {
    return clamp01(requested)
  }

  switch (cue) {
    case 'call':
      return 0.24
    case 'bet':
      return 0.48
    case 'raise':
      return 0.72
    case 'all_in':
      return 1
    default:
      return 0
  }
}

function getWagerPoseScale(
  profile: PokerActionMotionProfile,
  options: PokerActionPoseOptions
) {
  // No explicit intensity keeps legacy call sites pixel-for-pixel compatible.
  if (options.wagerIntensity === undefined || !Number.isFinite(options.wagerIntensity)) {
    return 1
  }

  return 0.72 + profile.wagerIntensity * 0.56
}

function isWagerCue(cue: ThreeActionCue): cue is 'call' | 'bet' | 'raise' | 'all_in' {
  return cue === 'call' || cue === 'bet' || cue === 'raise' || cue === 'all_in'
}

function getProgress(elapsedMs: number) {
  return clamp01(elapsedMs / ACTION_ANIMATION_DURATION_MS)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function easeInOut(progress: number) {
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2
}

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3)
}
