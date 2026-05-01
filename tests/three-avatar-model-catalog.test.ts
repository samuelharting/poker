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
      expect(model.scale).toHaveLength(3)
      expect(model.scale.every(value => value > 0)).toBe(true)
      expect(model.position).toHaveLength(3)
      expect(model.rotation).toHaveLength(3)
      expect(existsSync(join(process.cwd(), 'public', model.path))).toBe(true)
    }
  })

  it('keeps GLB table-player avatars calibrated as large normal-proportion low busts', () => {
    for (const model of Object.values(REALISTIC_AVATAR_MODELS)) {
      const [scaleX, scaleY, scaleZ] = model.scale
      const largestScale = Math.max(scaleX, scaleY, scaleZ)
      const smallestScale = Math.min(scaleX, scaleY, scaleZ)

      expect(scaleX).toBeGreaterThanOrEqual(2)
      expect(scaleY).toBeGreaterThanOrEqual(2)
      expect(scaleZ).toBeGreaterThanOrEqual(2)
      expect(largestScale).toBeLessThanOrEqual(3)
      expect(largestScale / smallestScale).toBeLessThanOrEqual(1.04)
      expect(model.position[1]).toBeLessThanOrEqual(-2)
      expect(model.position[2]).toBeGreaterThanOrEqual(0.18)
      expect(model.position[2]).toBeLessThanOrEqual(0.42)
      expect(model.rotation).toEqual([0, Math.PI, 0])
    }
  })

  it('keeps seated procedural avatars decomposed into polished face and body pieces', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('function AvatarSuitTorso')
    expect(renderer).toContain('function AvatarSeatedLegs')
    expect(renderer).toContain('function AvatarFaceDetails')
    expect(renderer).toContain('<AvatarSuitTorso')
    expect(renderer).toContain('<AvatarFaceDetails')
    expect(renderer).not.toContain('function AvatarTableArms')
    expect(renderer).not.toContain('function HumanHand')
  })

  it('renders normal table opponents as realistic GLB avatars with procedural fallback', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('class AvatarAssetBoundary')
    expect(renderer).toContain('function Avatar(')
    expect(renderer).toContain('function RealisticSeatedAvatar')
    expect(renderer).toContain('function OpponentTableProps')
    expect(renderer).toContain('function OpponentHoleCards3D')
    expect(renderer).toContain('overlayMaterialRef={setMaterialRef(2)}')
    expect(renderer).toContain('overlayMaterialRef={setMaterialRef(5)}')
    expect(renderer).toContain('function SeatedTableAvatar')
    expect(renderer).toContain('useGLTF')
    expect(renderer).toContain('useAnimations')
    expect(renderer).toContain('getOpponentTableActionPose')
    expect(renderer).toContain('getSeatedAvatarActionPose')
    expect(renderer).not.toContain('getProceduralOpponentArmPose')
    expect(renderer).not.toContain('function ProceduralOpponentActionArms')
    expect(renderer).not.toContain('<ProceduralOpponentActionArms')
    expect(renderer).not.toContain('function ProceduralOpponentArm')
    expect(renderer).not.toContain('getRiggedOpponentArmPose')
    expect(renderer).not.toContain('createRiggedAvatarArmRig')
    expect(renderer).not.toContain('applyRiggedOpponentArmPose')
    expect(renderer).toContain('<primitive object={modelScene} />')
    expect(renderer).not.toContain('function OpponentTableHand')
    expect(renderer).not.toContain('<OpponentTableHand')
    expect(renderer).toContain('scale={model.scale}')
    expect(renderer).not.toContain('scale={[model.scale, model.scale, model.scale]}')
    expect(renderer).toContain('function AvatarBustOccluder')
    expect(renderer).toContain('<AvatarBustOccluder />')
    expect(renderer).toContain('<boxGeometry args={[2.65, 1.05, 0.62]} />')
    expect(renderer).toContain('colorWrite={false}')
    expect(renderer).toContain('<Suspense fallback={fallback}>')
    expect(renderer).toContain('const usesRealisticOpponent = !isHero')
    expect(renderer).toContain('isBustSeat={usesRealisticOpponent}')
    expect(renderer).toContain('{!isHero && <OpponentTableProps player={player} layout={layout} />}')
    expect(renderer).toContain('{player.isOutOfHand && <FoldedSeatGhost />}')
    expect(renderer).toContain('<Chair')
    expect(renderer).not.toContain('StandingSeatMarker')
  })

  it('keeps action animations without custom procedural arm meshes', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('useActionPlayback(player.actionKey, player.actionCue)')
    expect(renderer).toContain('getSeatedAvatarActionPose(playback.cue, playback.elapsedMs)')
    expect(renderer).toContain('getOpponentTableActionPose(playback.cue, playback.elapsedMs)')
    expect(renderer).toContain('<OpponentTableProps player={player} layout={layout} />')
    expect(renderer).not.toContain('setProceduralOpponentArmPose')
    expect(renderer).not.toContain('actionArmSide === side ? pose.active : pose.inactive')
    expect(renderer).not.toContain('HumanHand')
    expect(renderer).not.toContain('opponentArmUpperY')
    expect(renderer).not.toContain('opponentArmForearmY')
    expect(renderer).not.toContain('opponentArmHandY')
    expect(renderer).not.toContain('RiggedArmBones')
    expect(renderer).not.toContain('RiggedAvatarArmRig')
    expect(renderer).not.toContain('collectRiggedArmBones')
    expect(renderer).not.toContain('getRiggedBone')
  })

  it('renders player name and chip-stack labels above 3D seats', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('function PlayerNameplate')
    expect(renderer).toContain('<PlayerNameplate')
    expect(renderer).toContain('const opponentNameplateY = 2.18')
    expect(renderer).toContain('const plateY = player.isOutOfHand ? 1.18 : isHero ? 1.16 : opponentNameplateY')
    expect(renderer).toContain('const opponentNameplateScale = 1.08')
    expect(renderer).toContain('scale={[nameplateScale, nameplateScale, nameplateScale]}')
    expect(renderer).toContain('const opponentNameplateWidth = 1.2')
    expect(renderer).toContain('const opponentNameplateHeight = 0.48')
    expect(renderer).toContain('const plateWidth = isHero ? 0.52 : opponentNameplateWidth')
    expect(renderer).toContain('const plateHeight = isHero ? 0.17 : opponentNameplateHeight')
    expect(renderer).toContain('const opponentLabelFontSize = 0.156')
    expect(renderer).toContain('const opponentStackFontSize = 0.138')
    expect(renderer).toContain('const labelFontSize = isHero ? 0.062 : opponentLabelFontSize')
    expect(renderer).toContain('const stackFontSize = isHero ? 0.054 : opponentStackFontSize')
    expect(renderer).toContain('args={[plateWidth, plateHeight, 0.022]}')
    expect(renderer).toContain('opacity={compactPlateOpacity}')
    expect(renderer).toContain('{player.nickname}')
    expect(renderer).toContain('{`$${player.stack.toLocaleString()}`}')
  })

  it('replaces opponent turn halos with face-down cards in front of avatar faces', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('function TurnFaceCards')
    expect(renderer).toContain('{!isHero && player.isActing && !player.isOutOfHand && <TurnFaceCards />}')
    expect(renderer).toContain('position={[0, 1.56, -0.54]}')
    expect(renderer).toContain('args={[0.21, 0.3, 0.012]}')
    expect(renderer).toContain('args={[0.146, 0.219, 0.004]}')
    expect(renderer).toContain('color="#8f1d2e"')
    expect(renderer).toContain('color="#b73a45"')
    expect(renderer).not.toContain('function TurnBeacon')
    expect(renderer).not.toContain('heroTurnBeaconY')
    expect(renderer).not.toContain('opponentTurnBeaconY')
  })

  it('uses the same red card-back language for fold-motion cards', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('<FoldActionCardBack position={[0, 0, 0]} rotation={[0, 0, -0.08]} />')
    expect(renderer).toContain('<FoldActionCardBack position={[0.38, 0, -0.035]} rotation={[0, 0, 0.08]} />')
    expect(renderer).toContain('function FoldActionCardBack')
    expect(renderer).toContain('color="#8f1d2e"')
    expect(renderer).toContain('color="#b73a45"')
    expect(renderer).not.toContain('function CardGhost')
    expect(renderer).not.toContain('color="#22324b"')
    expect(renderer).not.toContain('color="#324b75"')
  })

  it('wires clickable 3D emote targets and native emoji reactions', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('emoteReactions')
    expect(renderer).toContain('selectedTargetId')
    expect(renderer).toContain('onSelectPlayer')
    expect(renderer).toContain('function PlayerInteractionHitTarget')
    expect(renderer).toContain('<PlayerInteractionHitTarget')
    expect(renderer).toContain('onPointerDown')
    expect(renderer).toContain('function ThreeEmoteReactionLayer')
    expect(renderer).toContain('function ThreeEmoteReactionSprite')
    expect(renderer).toContain('<Html')
    expect(renderer).toContain('className="three-emote-reaction"')
  })

  it('anchors targeted 3D emotes at opponent face height instead of above the head', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).toContain('const opponentEmoteFacePopY = 1.56')
    expect(renderer).toContain('const opponentEmoteFaceZ = -0.54')
    expect(renderer).toContain('const faceOffsetX = Math.sin(layout.rotation) * opponentEmoteFaceZ * layout.scale')
    expect(renderer).toContain('const faceOffsetZ = Math.cos(layout.rotation) * opponentEmoteFaceZ * layout.scale')
    expect(renderer).toContain('pop: new Vector3(popX, popY, popZ)')
    expect(renderer).not.toContain('const popY = isHero ? 1.55 : player.isOutOfHand ? 1.7 : 2.62')
  })

  it('does not render a win-streak companion avatar path', () => {
    const renderer = readFileSync(
      join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'),
      'utf8'
    )

    expect(renderer).not.toContain('companionPlayers')
    expect(renderer).not.toContain('data-companion-count')
    expect(renderer).not.toContain('data-companion-player-ids')
    expect(renderer).not.toContain('StreakCompanion')
    expect(renderer).not.toContain("getAvatarModelConfig('adventurer')")
  })
})
