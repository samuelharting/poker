import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createAvatarAnimatorState, updateAvatarAnimator } from '@/components/three/avatarAnimator'
import { blendHandShape, createAvatarHandsState, createHandTarget, updateAvatarHands } from '@/components/three/avatarHands'
import { createHeroHandsAnchors, createHeroHandsPose, evaluateHeroHands, DEAL_LEFT_Y, DEAL_RIGHT_Y } from '@/components/three/firstPersonHandPose'
import { getHeroDealTipWorld, type FirstPersonHands } from '@/components/three/firstPersonHands'
import { getPokerActionMotionProfile } from '@/components/three/pokerActionPose'

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const

function createRig() {
  const bones = new Map<string, THREE.Bone>()
  for (const side of ['R', 'L'] as const) {
    for (const finger of FINGERS) {
      let parent: THREE.Object3D = new THREE.Bone()
      const count = finger === 'Thumb' ? 3 : 4
      for (let joint = 1; joint <= count; joint += 1) {
        const bone = new THREE.Bone()
        bone.name = `${finger}${joint}${side}`
        parent.add(bone)
        bones.set(bone.name, bone)
        parent = bone
      }
    }
  }
  return bones as ReadonlyMap<string, THREE.Bone>
}

function settle(bones: ReadonlyMap<string, THREE.Bone>, shape: Parameters<typeof blendHandShape>[1]) {
  const target = createHandTarget()
  blendHandShape(target, shape, 1)
  const state = createAvatarHandsState()
  for (let frame = 0; frame < 120; frame += 1) {
    updateAvatarHands(state, bones, target, target, { time: frame / 60, delta: 1 / 60, reducedMotion: false, seed: 0.3, idle: 0 })
  }
}

describe('thumbs lie against the hand', () => {
  it('tucks the thumb in (adducts it) for relaxed, fist and flick-off shapes instead of leaving it stuck out', () => {
    const bones = createRig()
    // Bind pose is all zeros here, so the rotation is the raw delta.
    for (const shape of ['relaxed', 'card', 'cup', 'fist', 'middle', 'loose'] as const) {
      settle(bones, shape)
      expect(bones.get('Thumb1R')!.rotation.z, shape).toBeLessThan(-0.3)
      expect(bones.get('Thumb1L')!.rotation.z, shape).toBeGreaterThan(0.3)
    }
    // A fist's thumb also folds at its knuckle and tip so it wraps rather than juts.
    settle(bones, 'fist')
    expect(bones.get('Thumb2R')!.rotation.x).toBeLessThan(-0.8)
    expect(bones.get('Thumb3R')!.rotation.x).toBeLessThan(-0.8)
  })
})

describe('thinking with both fists', () => {
  it('keeps the two fists a fist-width apart so they never overlap', () => {
    const anchors = {
      railR: [0.3, 0.9, -0.9] as [number, number, number],
      railL: [-0.3, 0.9, -0.9] as [number, number, number],
      cards: [0, 0.5, -1.6] as [number, number, number],
      chest: [0, 1.1, -0.3] as [number, number, number],
      chin: [0, 1.5, -0.35] as [number, number, number],
      shoulderR: [0.25, 1.35, -0.15] as [number, number, number],
      shoulderL: [-0.25, 1.35, -0.15] as [number, number, number],
      stack: [0.5, 0.5, -1.5] as [number, number, number],
      betSpot: [0, 0.5, -2.4] as [number, number, number],
      tap: [0.15, 0.5, -1.3] as [number, number, number],
      board: [0, 0.5, -4] as [number, number, number],
      drinkRest: [-0.5, 0.5, -1.5] as [number, number, number],
    }
    {
      const id = 'a'
      const state = createAvatarAnimatorState(id)
      let pose = updateAvatarAnimator(state, {
        time: 0, delta: 1 / 60, reducedMotion: true, acting: true, folded: false, winner: false, loser: false, hasCards: true,
        cue: 'ready', cueElapsedMs: 0, cueActive: false, actionKey: '', playerId: id, wagerIntensity: 0, lookYaw: 0, lookPitch: -0.035,
        tableHeat: 0, idleTell: 'calm', celebration: 'victory', anchors,
      })
      // (The thinking style is picked as the turn starts: force the two-fists one.)
      state.thinkingStyle = 2
      for (let frame = 1; frame < 90; frame += 1) {
        pose = updateAvatarAnimator(state, {
          time: frame / 60, delta: 1 / 60, reducedMotion: true, acting: true, folded: false, winner: false, loser: false, hasCards: true,
          cue: 'ready', cueElapsedMs: 0, cueActive: false, actionKey: '', playerId: id, wagerIntensity: 0, lookYaw: 0, lookPitch: -0.035,
          tableHeat: 0, idleTell: 'calm', celebration: 'victory', anchors,
        })
      }
      expect(pose.handR[0] - pose.handL[0]).toBeGreaterThan(0.24)
    }
  })
})

describe('hero dealing hands', () => {
  const deal = { weight: 1, rightX: 0.02, rightY: -1, leftX: -0.05, leftY: -1, pinch: 0.6, cock: 0.3, snap: 0.2, holdLeft: 1 }
  const input = (weight: number, d = deal) => ({
    cue: 'ready' as const,
    elapsedMs: 99999,
    profile: getPokerActionMotionProfile('ready', { variant: 0, wagerIntensity: 0 }),
    peeking: false, winnerSeconds: -1, flickSeconds: -1,
    deal: { ...d, weight }, time: 1, drunkLevel: 0, reducedMotion: false, anchors: createHeroHandsAnchors(),
  })

  it('works above the hole-card tray even when the gesture point projects off the bottom of the screen', () => {
    const out = evaluateHeroHands(input(1), createHeroHandsPose())
    expect(out.right.y).toBeGreaterThan(-0.5)
    expect(out.left.y).toBeGreaterThan(-0.55)
    expect(out.right.y).toBeCloseTo(DEAL_RIGHT_Y, 0)
    expect(out.left.y).toBeCloseTo(DEAL_LEFT_Y, 0)
    expect(out.right.x).toBeGreaterThan(out.left.x + 0.1)
  })

  it('launches the card from the drawn fingertips, ahead of and above the wrist', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100)
    camera.position.set(0, 1.5, 3)
    camera.updateMatrixWorld(true)
    const shown = createHeroHandsPose()
    shown.right.y = -0.3
    shown.right.x = 0.1
    const hands = { root: { visible: true }, deal: { weight: 1 }, shown } as unknown as FirstPersonHands
    const tip = new THREE.Vector3()
    expect(getHeroDealTipWorld(hands, camera, tip)).toBe(true)
    // In front of the camera (it looks down -Z) and a hand's length beyond the wrist plane.
    expect(tip.z).toBeLessThan(camera.position.z - shown.right.depth)
    const wristY = camera.position.y + shown.right.y * shown.right.depth * Math.tan(THREE.MathUtils.degToRad(22.5))
    expect(tip.y).toBeGreaterThan(wristY)
    ;(hands as unknown as { deal: { weight: number } }).deal.weight = 0
    expect(getHeroDealTipWorld(hands, camera, tip)).toBe(false)
  })
})

describe('hero win pose', () => {
  it('is not a mirror image: the lead hand sits higher, holds a tighter fist, and the hands pump out of step', () => {
    const win = (seconds: number) => evaluateHeroHands({
      cue: 'ready', elapsedMs: 99999,
      profile: getPokerActionMotionProfile('ready', { variant: 0, wagerIntensity: 0 }),
      peeking: false, winnerSeconds: seconds, flickSeconds: -1, deal: null, time: 1, drunkLevel: 0, reducedMotion: false,
      anchors: createHeroHandsAnchors(),
    }, createHeroHandsPose())
    let asymmetric = 0
    const ysRight = new Set<number>()
    for (let t = 0.8; t < 3; t += 0.05) {
      const p = win(t)
      expect(p.right.y).toBeLessThan(0)
      expect(p.left.y).toBeLessThan(0)
      expect(p.right.depth).toBeGreaterThanOrEqual(0.65)
      expect(p.right.fist).toBeGreaterThan(p.left.fist)
      if (Math.abs(p.right.y - p.left.y) > 0.04) asymmetric += 1
      ysRight.add(Math.round(p.right.y * 100))
    }
    expect(asymmetric).toBeGreaterThan(20)
    // It pumps (the hand keeps travelling), it does not hold still.
    expect(ysRight.size).toBeGreaterThan(6)
  })
})
