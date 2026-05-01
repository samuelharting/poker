import type { ThreeActionCue } from './tableViewModel'

export type HeroHandSide = 'left' | 'right'
export type Vec3 = [number, number, number]

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
  elapsedMs: number
): HeroHandActionPose {
  const progress = getProgress(elapsedMs)

  if (progress >= 1 || side === 'left') {
    return restHandPose
  }

  switch (cue) {
    case 'fold': {
      const windup = easeOutCubic(clamp01(progress / 0.16))
      const reach = easeInOut(clamp01((progress - 0.12) / 0.36))
      const sweep = easeInOut(clamp01((progress - 0.44) / 0.32))
      const settle = easeInOut(clamp01((progress - 0.72) / 0.2))
      const lift = Math.sin(clamp01((progress - 0.06) / 0.7) * Math.PI)

      return {
        position: [
          0.12 * windup - 1.6 * reach - 0.28 * sweep + 0.1 * settle,
          0.025 * windup + 0.07 * lift - 0.045 * settle,
          0.055 * windup - 0.82 * reach - 0.48 * sweep + 0.04 * settle,
        ],
        rotation: [
          -0.08 * windup + 0.26 * reach - 0.05 * settle,
          0.08 * windup - 0.22 * reach - 0.08 * sweep,
          0.08 * windup - 0.22 * reach - 0.34 * sweep,
        ],
        fingerCurl: 0.86 * reach * (1 - 0.38 * sweep),
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.14))
      const strike = Math.sin(clamp01((progress - 0.1) / 0.2) * Math.PI)
      const rebound = Math.sin(clamp01((progress - 0.28) / 0.24) * Math.PI)
      const settle = easeOutCubic(clamp01((progress - 0.46) / 0.26))
      const release = 1 - easeOutCubic(clamp01((progress - 0.42) / 0.28))
      const curled = Math.max(strike, windup * (1 - settle))

      return {
        position: [
          -0.034 * strike + 0.012 * rebound,
          0.034 * windup - 0.136 * strike + 0.024 * rebound - 0.006 * settle,
          -0.052 * strike + 0.014 * rebound,
        ],
        rotation: [
          0.07 * windup + 0.22 * strike - 0.045 * rebound,
          -0.025 * strike + 0.012 * rebound,
          -0.085 * strike + 0.024 * rebound,
        ],
        fingerCurl: 0.94 * curled * release,
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const windup = easeOutCubic(clamp01(progress / 0.16))
      const grab = easeOutCubic(clamp01((progress - 0.08) / 0.2))
      const carry = easeInOut(clamp01((progress - 0.17) / 0.57))
      const settle = easeOutCubic(clamp01((progress - 0.74) / 0.2))
      const release = progress < 0.78 ? 1 : 1 - clamp01((progress - 0.78) / 0.18)
      const lift = Math.sin(clamp01((progress - 0.07) / 0.74) * Math.PI)
      const shoveScale = cue === 'all_in' ? 1.34 : cue === 'raise' ? 1.08 : 1
      const liftScale = cue === 'all_in' ? 1.32 : cue === 'raise' ? 1.08 : 1
      const commitLift = cue === 'all_in' ? 0.04 * carry : 0

      return {
        position: [
          0.14 * windup + 0.08 * grab - 1.78 * carry * shoveScale + 0.08 * settle,
          0.026 * windup + 0.064 * lift * liftScale + commitLift - 0.012 * settle,
          0.08 * windup - 0.24 * grab - 1.54 * carry * shoveScale + 0.06 * settle,
        ],
        rotation: [
          0.08 * windup + 0.15 * grab + 0.2 * carry * liftScale - 0.04 * settle,
          -0.14 * carry * shoveScale,
          -0.25 * carry * shoveScale + 0.04 * settle,
        ],
        fingerCurl: 0.78 * grab * release,
      }
    }
    default:
      return restHandPose
  }
}

export function getHeroChipActionPose(cue: ThreeActionCue, elapsedMs: number): PropActionPose {
  if (!isWagerCue(cue)) {
    return hiddenPropPose
  }

  const progress = getProgress(elapsedMs)

  if (progress >= 0.96) {
    return hiddenPropPose
  }

  const travel = easeOutCubic(clamp01((progress - 0.12) / 0.62))
  const arc = Math.sin(clamp01((progress - 0.03) / 0.76) * Math.PI)
  const settle = Math.sin(clamp01((progress - 0.78) / 0.18) * Math.PI) * 0.018

  return {
    visible: true,
    position: [-1.72 * travel, 0.16 * arc - settle, -1.3 * travel],
    rotation: [0, progress * Math.PI * 3.2, 0.08 * arc],
    opacity: Math.max(0, 1 - Math.max(0, progress - 0.86) / 0.1),
  }
}

export function getHeroCardActionPose(cue: ThreeActionCue, elapsedMs: number): PropActionPose {
  if (cue !== 'fold') {
    return hiddenPropPose
  }

  const progress = getProgress(elapsedMs)

  if (progress >= 0.94) {
    return hiddenPropPose
  }

  const gather = easeOutCubic(clamp01(progress / 0.22))
  const slide = easeOutCubic(clamp01((progress - 0.12) / 0.66))
  const fade = easeInOut(clamp01((progress - 0.55) / 0.34))

  return {
    visible: true,
    position: [-0.92 * slide, 0.07 * Math.sin(clamp01(progress / 0.68) * Math.PI), -0.78 * slide],
    rotation: [0.035 * gather, -0.08 * slide, -0.38 * slide],
    opacity: Math.max(0.08, 1 - fade * 0.9),
  }
}

export function getSeatedAvatarActionPose(
  cue: ThreeActionCue,
  elapsedMs: number
): SeatedAvatarActionPose {
  const progress = getProgress(elapsedMs)

  if (progress >= 1 || cue === 'ready') {
    return restAvatarPose
  }

  switch (cue) {
    case 'fold': {
      const lean = easeInOut(clamp01((progress - 0.08) / 0.54))
      const drop = easeInOut(clamp01((progress - 0.16) / 0.44))
      const recoil = 1 - easeOutCubic(clamp01((progress - 0.7) / 0.22))

      return {
        bodyPosition: [0, -0.065 * lean * recoil, 0.045 * lean * recoil],
        bodyRotation: [0.22 * lean * recoil, -0.03 * lean * recoil, -0.035 * lean * recoil],
        armPosition: [0, -0.04 * drop * recoil, 0.025 * drop * recoil],
        armRotation: [-0.34 * drop * recoil, 0.05 * drop * recoil, -0.04 * drop * recoil],
        headRotation: [0.1 * lean * recoil, 0.035 * lean * recoil, 0.02 * lean * recoil],
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.15))
      const strike = Math.sin(clamp01((progress - 0.14) / 0.22) * Math.PI)
      const rebound = Math.sin(clamp01((progress - 0.34) / 0.2) * Math.PI)
      const settle = 1 - easeOutCubic(clamp01((progress - 0.5) / 0.3))
      const active = Math.max(strike, rebound * 0.45, windup * settle)

      return {
        bodyPosition: [0, -0.01 * strike, -0.016 * strike],
        bodyRotation: [0.055 * strike, -0.018 * strike, 0.036 * strike],
        armPosition: [0, 0.034 * windup - 0.1 * strike + 0.022 * rebound, -0.045 * strike],
        armRotation: [0.34 * strike - 0.07 * rebound, -0.025 * strike, -0.08 * strike],
        headRotation: [0.035 * active, 0.018 * strike, 0.012 * strike],
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const gather = easeOutCubic(clamp01(progress / 0.2))
      const push = easeInOut(clamp01((progress - 0.16) / 0.54))
      const settle = 1 - easeOutCubic(clamp01((progress - 0.76) / 0.18))
      const reachScale = cue === 'all_in' ? 1.42 : cue === 'raise' ? 1.14 : 1
      const postureScale = cue === 'all_in' ? 1.3 : cue === 'raise' ? 1.1 : 1
      const activePush = push * settle

      return {
        bodyPosition: [0, 0.012 * gather * settle, -0.048 * activePush * reachScale],
        bodyRotation: [0.1 * activePush * reachScale * postureScale, -0.035 * activePush * postureScale, 0.028 * activePush],
        armPosition: [0, 0.03 * gather * settle, -0.15 * activePush * reachScale],
        armRotation: [0.28 * activePush * reachScale, -0.048 * activePush * postureScale, -0.14 * activePush],
        headRotation: [-0.032 * activePush * postureScale, 0.024 * activePush, 0.014 * activePush],
      }
    }
    default:
      return restAvatarPose
  }
}

export function getOpponentTableActionPose(
  cue: ThreeActionCue,
  elapsedMs: number
): OpponentTableActionPose {
  const progress = getProgress(elapsedMs)

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
      const reach = easeOutCubic(clamp01(progress / 0.32))
      const slide = easeInOut(clamp01((progress - 0.18) / 0.56))
      const fade = easeInOut(clamp01((progress - 0.52) / 0.36))
      const recoil = 1 - easeOutCubic(clamp01((progress - 0.78) / 0.18))
      const lift = Math.sin(clamp01(progress / 0.74) * Math.PI)

      return {
        hand: {
          position: [
            -0.06 * reach * recoil - 0.12 * slide,
            0.05 * reach + 0.038 * lift - 0.02 * slide,
            -0.34 * reach + 0.12 * slide,
          ],
          rotation: [
            0.2 * reach - 0.06 * slide,
            -0.04 * reach - 0.06 * slide,
            -0.12 * reach - 0.16 * slide,
          ],
          fingerCurl: 0.86 * reach * (1 - 0.36 * slide) * Math.max(0.22, recoil),
        },
        cards: {
          visible: progress < 0.94,
          position: [
            -0.18 * slide,
            0.054 * lift - 0.022 * fade,
            -0.96 * slide,
          ],
          rotation: [0.05 * reach, -0.06 * slide, -0.18 * slide],
          opacity: Math.max(0, 1 - fade),
        },
        chipPush: hiddenPropPose,
      }
    }
    case 'check': {
      const windup = easeOutCubic(clamp01(progress / 0.15))
      const tap = Math.sin(clamp01((progress - 0.14) / 0.22) * Math.PI)
      const rebound = Math.sin(clamp01((progress - 0.34) / 0.22) * Math.PI)
      const settle = 1 - easeOutCubic(clamp01((progress - 0.52) / 0.28))
      const active = Math.max(tap, rebound * 0.5, windup * settle)

      return {
        hand: {
          position: [
            -0.012 * tap,
            0.054 * windup - 0.11 * tap + 0.024 * rebound,
            -0.035 * tap,
          ],
          rotation: [
            0.32 * tap - 0.06 * rebound,
            -0.028 * tap,
            -0.08 * tap,
          ],
          fingerCurl: 0.24 + 0.52 * active,
        },
        cards: visibleOpponentCardsPose,
        chipPush: hiddenPropPose,
      }
    }
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in': {
      const gather = easeOutCubic(clamp01(progress / 0.18))
      const push = easeInOut(clamp01((progress - 0.14) / 0.58))
      const fade = easeInOut(clamp01((progress - 0.78) / 0.16))
      const lift = Math.sin(clamp01((progress - 0.08) / 0.7) * Math.PI)
      const reachScale = cue === 'all_in' ? 1.5 : cue === 'raise' ? 1.2 : cue === 'bet' ? 1.08 : 1

      return {
        hand: {
          position: [
            0.06 * gather,
            0.04 * gather + 0.034 * lift,
            -0.4 * push * reachScale,
          ],
          rotation: [
            0.1 * gather + 0.22 * push * reachScale,
            -0.04 * push,
            -0.18 * push * reachScale,
          ],
          fingerCurl: 0.28 + 0.46 * gather * (1 - 0.55 * fade),
        },
        cards: visibleOpponentCardsPose,
        chipPush: {
          visible: progress < 0.94,
          position: [
            0.02 * gather,
            0.06 * lift - 0.02 * fade,
            -0.66 * push * reachScale,
          ],
          rotation: [0, progress * Math.PI * 2.4, 0.08 * lift],
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
