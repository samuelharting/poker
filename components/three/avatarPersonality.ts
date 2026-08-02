import type {
  PlayerAvatarCelebration,
  PlayerAvatarIdleTell,
} from '@/lib/profile'
import type { Vec3 } from './pokerActionPose'

export interface AvatarPersonalityPose {
  bodyPosition: Vec3
  bodyRotation: Vec3
  headRotation: Vec3
  rightUpperArm: Vec3
  rightLowerArm: Vec3
  rightWrist: Vec3
  leftUpperArm: Vec3
  leftLowerArm: Vec3
  leftWrist: Vec3
  fingerCurl: number
}

export interface AvatarPersonalityPoseInput {
  idleTell: PlayerAvatarIdleTell
  celebration: PlayerAvatarCelebration
  winner: boolean
  actionActive: boolean
  acting: boolean
  folded: boolean
  time: number
  phase: number
  reducedMotion: boolean
}

const REST_POSE: AvatarPersonalityPose = {
  bodyPosition: [0, 0, 0],
  bodyRotation: [0, 0, 0],
  headRotation: [0, 0, 0],
  rightUpperArm: [0, 0, 0],
  rightLowerArm: [0, 0, 0],
  rightWrist: [0, 0, 0],
  leftUpperArm: [0, 0, 0],
  leftLowerArm: [0, 0, 0],
  leftWrist: [0, 0, 0],
  fingerCurl: 0,
}

export function getAvatarPersonalityPose(
  input: AvatarPersonalityPoseInput
): AvatarPersonalityPose {
  if (input.winner) {
    return getCelebrationPose(input.celebration, input.time, input.phase, input.reducedMotion)
  }

  if (input.actionActive || input.acting || input.folded || input.reducedMotion) {
    return REST_POSE
  }

  return getIdleTellPose(input.idleTell, input.time, input.phase)
}

function getIdleTellPose(
  idleTell: PlayerAvatarIdleTell,
  time: number,
  phase: number
): AvatarPersonalityPose {
  if (idleTell === 'calm') return REST_POSE

  // Tells appear in short, repeatable windows so a full table never moves at once.
  const cycle = positiveModulo(time + phase * 0.83, 6.4)
  const window = smoothPulse(cycle, 3.9, 6.15)
  if (window <= 0.001) return REST_POSE

  const beat = Math.sin((time * 8.6 + phase) * Math.PI)

  switch (idleTell) {
    case 'chip_shuffle': {
      const shuffle = Math.sin(time * 12 + phase * 2.1) * window
      return {
        ...REST_POSE,
        bodyRotation: [0.018 * window, 0.012 * shuffle, 0],
        headRotation: [0.025 * window, -0.025 * shuffle, 0],
        rightUpperArm: [-0.18 * window, 0.04 * window, 0.06 * window],
        rightLowerArm: [-0.34 * window, 0, 0.08 * shuffle],
        rightWrist: [0.08 * window, 0.18 * shuffle, 0.22 * shuffle],
        leftUpperArm: [-0.13 * window, -0.03 * window, -0.04 * window],
        leftLowerArm: [-0.27 * window, 0, -0.06 * shuffle],
        leftWrist: [0.06 * window, -0.14 * shuffle, -0.18 * shuffle],
        fingerCurl: 0.35 * window,
      }
    }
    case 'card_peek':
      return {
        ...REST_POSE,
        bodyPosition: [0, -0.018 * window, -0.03 * window],
        bodyRotation: [0.055 * window, 0, 0],
        headRotation: [0.16 * window, 0.018 * Math.sin(time * 2.2 + phase) * window, 0],
        rightUpperArm: [-0.24 * window, 0.04 * window, 0.06 * window],
        rightLowerArm: [-0.38 * window, 0, 0.03 * window],
        leftUpperArm: [-0.24 * window, -0.04 * window, -0.06 * window],
        leftLowerArm: [-0.38 * window, 0, -0.03 * window],
        fingerCurl: 0.46 * window,
      }
    case 'table_drum': {
      const tap = Math.max(0, beat) * window
      return {
        ...REST_POSE,
        bodyRotation: [0.018 * window, 0, 0.012 * window],
        headRotation: [0.018 * window, 0.035 * window, 0],
        rightUpperArm: [-0.13 * window, 0, 0.05 * window],
        rightLowerArm: [-0.3 * window + 0.08 * tap, 0, 0],
        rightWrist: [0.24 * tap, 0, -0.06 * tap],
        fingerCurl: (0.18 + 0.3 * tap) * window,
      }
    }
    default:
      return REST_POSE
  }
}

function getCelebrationPose(
  celebration: PlayerAvatarCelebration,
  time: number,
  phase: number,
  reducedMotion: boolean
): AvatarPersonalityPose {
  const motion = reducedMotion ? 0 : 1
  const pulse = Math.sin(time * 5.4 + phase) * motion

  switch (celebration) {
    case 'fist_pump': {
      const pump = 0.5 + 0.5 * Math.sin(time * 7.2 + phase)
      return {
        ...REST_POSE,
        bodyPosition: [0, 0.035 * pump * motion, 0],
        bodyRotation: [-0.04, 0.04, -0.06],
        headRotation: [-0.08, 0.03, -0.04],
        rightUpperArm: [-0.92 - 0.14 * pump * motion, -0.08, 0.28],
        rightLowerArm: [-1.08 + 0.18 * pump * motion, 0.02, 0.08],
        rightWrist: [0.12, 0, 0.08 * pulse],
        fingerCurl: 0.94,
      }
    }
    case 'victory':
      return {
        ...REST_POSE,
        bodyPosition: [0, 0.045 + 0.012 * pulse, 0],
        bodyRotation: [-0.055, 0, 0],
        headRotation: [-0.11, 0, 0],
        rightUpperArm: [-1.04, -0.12, 0.48],
        rightLowerArm: [-0.48, 0, 0.18],
        rightWrist: [0.1, 0, 0.08],
        leftUpperArm: [-1.04, 0.12, -0.48],
        leftLowerArm: [-0.48, 0, -0.18],
        leftWrist: [0.1, 0, -0.08],
        fingerCurl: 0.2,
      }
    case 'slow_clap': {
      const clap = reducedMotion ? 0.65 : 0.5 + 0.5 * Math.sin(time * 3.8 + phase)
      return {
        ...REST_POSE,
        bodyRotation: [0.035, 0, 0],
        headRotation: [-0.025, 0.02 * pulse, 0],
        rightUpperArm: [-0.56, -0.12 - 0.18 * clap, 0.08],
        rightLowerArm: [-0.72, 0, 0.12 + 0.16 * clap],
        rightWrist: [0.18, 0, 0.12 * clap],
        leftUpperArm: [-0.56, 0.12 + 0.18 * clap, -0.08],
        leftLowerArm: [-0.72, 0, -0.12 - 0.16 * clap],
        leftWrist: [0.18, 0, -0.12 * clap],
        fingerCurl: 0.16,
      }
    }
    case 'wave':
    default:
      return {
        ...REST_POSE,
        bodyRotation: [-0.025, 0.025, -0.025],
        headRotation: [-0.045, 0.05, -0.025],
        rightUpperArm: [-0.88, -0.08, 0.36],
        rightLowerArm: [-0.82, 0, 0.16],
        rightWrist: [0, 0, 0.28 * Math.sin(time * 7.5 + phase) * motion],
        fingerCurl: 0.12,
      }
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function smoothPulse(value: number, start: number, end: number): number {
  const fade = 0.32
  const fadeIn = clamp01((value - start) / fade)
  const fadeOut = clamp01((end - value) / fade)
  return smoothStep(Math.min(fadeIn, fadeOut))
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
