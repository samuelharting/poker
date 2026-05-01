import type { Vec3 } from './pokerActionPose'

export const REALISTIC_AVATAR_MODEL_KEYS = [
  'business_man',
  'casual',
  'hoodie',
  'worker',
  'punk',
  'adventurer',
] as const

export type RealisticAvatarModelKey = (typeof REALISTIC_AVATAR_MODEL_KEYS)[number]

export interface RealisticAvatarModelConfig {
  label: string
  path: string
  scale: Vec3
  position: Vec3
  rotation: Vec3
}

export const REALISTIC_AVATAR_MODELS: Record<RealisticAvatarModelKey, RealisticAvatarModelConfig> = {
  business_man: {
    label: 'Business Man',
    path: '/models/avatars/business-man.glb',
    scale: [2.34, 2.34, 2.34],
    position: [0, -2.42, 0.28],
    rotation: [0, Math.PI, 0],
  },
  casual: {
    label: 'Casual Character',
    path: '/models/avatars/casual-character.glb',
    scale: [2.34, 2.34, 2.34],
    position: [0, -2.42, 0.28],
    rotation: [0, Math.PI, 0],
  },
  hoodie: {
    label: 'Hoodie Character',
    path: '/models/avatars/hoodie-character.glb',
    scale: [2.34, 2.34, 2.34],
    position: [0, -2.42, 0.28],
    rotation: [0, Math.PI, 0],
  },
  worker: {
    label: 'Worker',
    path: '/models/avatars/worker.glb',
    scale: [2.34, 2.34, 2.34],
    position: [0, -2.42, 0.28],
    rotation: [0, Math.PI, 0],
  },
  punk: {
    label: 'Punk',
    path: '/models/avatars/punk.glb',
    scale: [2.3, 2.3, 2.3],
    position: [0, -2.5, 0.28],
    rotation: [0, Math.PI, 0],
  },
  adventurer: {
    label: 'Adventurer',
    path: '/models/avatars/adventurer.glb',
    scale: [2.26, 2.26, 2.26],
    position: [0, -2.36, 0.28],
    rotation: [0, Math.PI, 0],
  },
}

export function getAvatarModelConfig(key: RealisticAvatarModelKey) {
  return REALISTIC_AVATAR_MODELS[key]
}
