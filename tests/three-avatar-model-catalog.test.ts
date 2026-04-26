import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getAvatarModelConfig,
  REALISTIC_AVATAR_MODELS,
  REALISTIC_AVATAR_MODEL_KEYS,
} from '@/components/three/avatarModelCatalog'

describe('realistic 3D avatar model catalog', () => {
  it('uses stable local GLB paths for every model key', () => {
    expect(REALISTIC_AVATAR_MODEL_KEYS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(REALISTIC_AVATAR_MODEL_KEYS).size).toBe(REALISTIC_AVATAR_MODEL_KEYS.length)

    for (const key of REALISTIC_AVATAR_MODEL_KEYS) {
      const model = getAvatarModelConfig(key)

      expect(model).toBe(REALISTIC_AVATAR_MODELS[key])
      expect(model.path).toMatch(/^\/models\/avatars\/.+\.glb$/)
      expect(model.scale).toBeGreaterThan(0)
      expect(model.position).toHaveLength(3)
      expect(model.rotation).toHaveLength(3)
      expect(existsSync(join(process.cwd(), 'public', model.path))).toBe(true)
    }
  })

  it('keeps the desktop renderer wired to realistic models with procedural fallback', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('function RealisticAvatar')
    expect(renderer).toContain('function ProceduralAvatarFallback')
    expect(renderer).toContain('useGLTF')
    expect(renderer).toContain('AvatarAssetBoundary')
  })
})
