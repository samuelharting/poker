import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getAvatarModelConfig,
  REALISTIC_AVATAR_MODELS,
  REALISTIC_AVATAR_MODEL_KEYS,
} from '@/components/three/avatarModelCatalog'

describe('avatar model catalog', () => {
  it('keeps stable local GLB paths for saved avatar model keys', () => {
    expect(REALISTIC_AVATAR_MODEL_KEYS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(REALISTIC_AVATAR_MODEL_KEYS).size).toBe(REALISTIC_AVATAR_MODEL_KEYS.length)

    for (const key of REALISTIC_AVATAR_MODEL_KEYS) {
      const model = getAvatarModelConfig(key)

      expect(model).toBe(REALISTIC_AVATAR_MODELS[key])
      expect(model.path).toMatch(/^\/models\/avatars\/.+\.glb$/)
      expect(existsSync(join(process.cwd(), 'public', model.path))).toBe(true)
    }
  })

  it('keeps legacy model calibration data internally consistent', () => {
    for (const model of Object.values(REALISTIC_AVATAR_MODELS)) {
      expect(model.scale).toHaveLength(3)
      expect(model.position).toHaveLength(3)
      expect(model.rotation).toHaveLength(3)
      expect(model.scale.every(value => value > 0)).toBe(true)
    }
  })
})

describe('animated WebGL desktop player presentation', () => {
  const renderer = readFileSync(
    join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
    'utf8'
  )

  it('renders real Three.js geometry with readable HTML player panels', () => {
    expect(renderer).toContain("import * as THREE from 'three'")
    expect(renderer).toContain('new THREE.WebGLRenderer')
    expect(renderer).toContain('className="desktop-3d-canvas"')
    expect(renderer).toContain('data-renderer="three-webgl"')
    expect(renderer).toContain('createPokerTable(scene)')
    expect(renderer).toContain('createSeatRuntime(player, now)')
    expect(renderer).toContain('createAvatarAssetInstance')
    expect(renderer).toContain('new THREE.AnimationMixer')
    expect(renderer).toContain('className="cinematic-avatar"')
    expect(renderer).toContain('className="cinematic-seat-panel"')
    expect(renderer).toContain('{player.nickname}')
    expect(renderer).toContain('player.stack.toLocaleString()')
    expect(renderer).not.toContain('@react-three/fiber')
    expect(renderer).not.toContain('useGLTF')
  })

  it('supports acting, winner, folded, blind, and wager states at every seat', () => {
    expect(renderer).toContain("player.isActing ? 'is-acting' : ''")
    expect(renderer).toContain("player.isWinner ? 'is-winner' : ''")
    expect(renderer).toContain("player.isOutOfHand ? 'is-folded' : ''")
    expect(renderer).toContain("player.blindRole === 'big' ? 'BB' : 'SB'")
    expect(renderer).toContain('className="cinematic-seat-bet"')
    expect(renderer).toContain('syncWagers(runtimeRef.current, view)')
    expect(renderer).toContain('data-table-wager-count')
  })

  it('wires accessible player targeting and native emoji reactions', () => {
    expect(renderer).toContain('emoteReactions.find')
    expect(renderer).toContain('selectedTargetId === player.id')
    expect(renderer).toContain('onClick={() => onSelectPlayer(player.id)}')
    expect(renderer).toContain('aria-label={`Send a reaction to ${player.nickname}`}')
    expect(renderer).toContain('className="cinematic-seat-reaction"')
  })

  it('animates player actions, cards, table light, and all-in camera impact', () => {
    expect(renderer).toContain('function animateSeat')
    expect(renderer).toContain("playback.cue === 'all_in'")
    expect(renderer).toContain('getSeatedAvatarActionPose')
    expect(renderer).toContain('getOpponentTableActionPose')
    expect(renderer).toContain('seat.cards.position.set')
    expect(renderer).toContain('seat.avatarMixer.update(reducedMotion ? 0 : delta)')
    expect(renderer).toContain('runtime.feltMaterial.emissiveIntensity')
    expect(renderer).toContain('targetCamera.copy(baseCameraPosition)')
    expect(renderer).toContain('getAllInCameraImpact')
    expect(renderer).toContain('camera.position.lerp')
    expect(renderer).toContain('window.requestAnimationFrame(animate)')
  })

  it('does not render a win-streak companion path', () => {
    expect(renderer).not.toContain('companionPlayers')
    expect(renderer).not.toContain('StreakCompanion')
  })
})
