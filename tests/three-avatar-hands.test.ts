import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { stripFingerTracks } from '@/components/three/avatarAssetLoader'
import { blendFrame, computeAvatarTargetPose, createAvatarAnimatorState, updateAvatarAnimator } from '@/components/three/avatarAnimator'
import {
  HAND_SHAPE_COUNT,
  blendHandShape,
  createAvatarHandsState,
  createHandTarget,
  neutralizeHand,
  getHandRig,
  resetHandTarget,
  updateAvatarHands,
} from '@/components/three/avatarHands'

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const

/** A minimal two-hand rig: every finger bone under a wrist, bound at a small pose. */
function createRig() {
  const bones = new Map<string, THREE.Bone>()
  for (const side of ['R', 'L'] as const) {
    const wrist = new THREE.Bone()
    wrist.name = `Wrist${side}`
    bones.set(wrist.name, wrist)
    for (const finger of FINGERS) {
      let parent: THREE.Bone = wrist
      const count = finger === 'Thumb' ? 3 : 4
      for (let joint = 1; joint <= count; joint += 1) {
        const bone = new THREE.Bone()
        bone.name = `${finger}${joint}${side}`
        bone.rotation.set(-0.02, side === 'R' ? 0.05 : -0.05, side === 'R' ? 0.1 : -0.1)
        parent.add(bone)
        bones.set(bone.name, bone)
        parent = bone
      }
    }
  }
  return bones as ReadonlyMap<string, THREE.Bone>
}

function settle(bones: ReadonlyMap<string, THREE.Bone>, targetR = createHandTarget(), targetL = createHandTarget(), frames = 120) {
  const state = createAvatarHandsState()
  for (let frame = 0; frame < frames; frame += 1) {
    updateAvatarHands(state, bones, targetR, targetL, { time: frame / 60, delta: 1 / 60, reducedMotion: false, seed: 0.3, idle: 0 })
  }
  return state
}

describe('avatar hand shapes', () => {
  it('starts relaxed and keeps the shape weights normalised through blends', () => {
    const target = createHandTarget()
    expect(target.weights[0]).toBe(1)
    blendHandShape(target, 'fist', 0.4)
    blendHandShape(target, 'pinch', 0.5)
    blendHandShape(target, 'flat', 0.25)
    const sum = Array.from(target.weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
    expect(target.weights.length).toBe(HAND_SHAPE_COUNT)
    resetHandTarget(target)
    expect(Array.from(target.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })

  it('curls the fingertip bone too, and a fist bends every knuckle more than a relaxed hand', () => {
    const bones = createRig()
    const relaxedState = settle(bones)
    void relaxedState
    const relaxedMcp = bones.get('Index2R')!.rotation.x
    const relaxedTip = bones.get('Index4R')!.rotation.x
    const fist = createHandTarget()
    blendHandShape(fist, 'fist', 1)
    settle(bones, fist, fist)
    expect(bones.get('Index2R')!.rotation.x).toBeLessThan(relaxedMcp - 0.6)
    expect(bones.get('Index3R')!.rotation.x).toBeLessThan(-1.0)
    // Fingertip joint curls in the fist (the old hands never bent it).
    expect(bones.get('Index4R')!.rotation.x).toBeLessThan(relaxedTip - 0.4)
    // Thumb wraps: its joints flex too.
    expect(bones.get('Thumb2R')!.rotation.x).toBeLessThan(-0.2)
  })

  it('curls from index to pinky in a relaxed hand and mirrors splay between the hands', () => {
    const bones = createRig()
    settle(bones)
    const index = bones.get('Index3R')!.rotation.x
    const pinky = bones.get('Pinky3R')!.rotation.x
    expect(pinky).toBeLessThan(index)
    const open = createHandTarget()
    blendHandShape(open, 'open', 1)
    settle(bones, open, open)
    // Index splay rotates about Z: mirrored signs on the left hand.
    const right = bones.get('Index2R')!.rotation.z - 0.1
    const left = bones.get('Index2L')!.rotation.z + 0.1
    expect(Math.sign(right)).toBe(-Math.sign(left))
    expect(Math.abs(right)).toBeGreaterThan(0.05)
    expect(Math.abs(right)).toBeCloseTo(Math.abs(left), 3)
  })

  it('eases into a shape instead of snapping (critically damped, pinky trailing index)', () => {
    const bones = createRig()
    const state = createAvatarHandsState()
    const fist = createHandTarget()
    blendHandShape(fist, 'fist', 1)
    const neutral = createHandTarget()
    // Warm up relaxed, then ask for a fist and look at the very next frames.
    for (let frame = 0; frame < 30; frame += 1) {
      updateAvatarHands(state, bones, neutral, neutral, { time: frame / 60, delta: 1 / 60, reducedMotion: false, seed: 0, idle: 0 })
    }
    const before = bones.get('Index2R')!.rotation.x
    updateAvatarHands(state, bones, fist, neutral, { time: 0.6, delta: 1 / 60, reducedMotion: false, seed: 0, idle: 0 })
    const oneFrame = bones.get('Index2R')!.rotation.x
    expect(before - oneFrame).toBeGreaterThan(0)
    expect(before - oneFrame).toBeLessThan(0.15)
    const pinkyBefore = bones.get('Pinky2R')!.rotation.x
    for (let frame = 0; frame < 6; frame += 1) {
      updateAvatarHands(state, bones, fist, neutral, { time: 0.6 + frame / 60, delta: 1 / 60, reducedMotion: false, seed: 0, idle: 0 })
    }
    const indexDrop = before - bones.get('Index2R')!.rotation.x
    const pinkyDrop = pinkyBefore - bones.get('Pinky2R')!.rotation.x
    expect(indexDrop).toBeGreaterThan(0)
    expect(pinkyDrop).toBeGreaterThan(0)
  })

  it('snaps straight to the target with reduced motion and neutralises to the bind pose', () => {
    const bones = createRig()
    const rigs = getHandRig(bones)
    const bind = bones.get('Index2R')!.rotation.x
    const fist = createHandTarget()
    blendHandShape(fist, 'fist', 1)
    const state = createAvatarHandsState()
    updateAvatarHands(state, bones, fist, fist, { time: 0, delta: 1 / 60, reducedMotion: true, seed: 0 })
    expect(bones.get('Index2R')!.rotation.x).toBeLessThan(bind - 1)
    neutralizeHand(rigs.R)
    expect(bones.get('Index2R')!.rotation.x).toBeCloseTo(bind, 6)
    // The left hand was not neutralised.
    expect(bones.get('Index2L')!.rotation.x).toBeLessThan(bind - 1)
  })
})

describe('hand frames and pose targets', () => {
  it('weights gesture angles by how much of the frame each contributor owns', () => {
    const frame = [0, 0, 0, 0]
    blendFrame(frame, 0.5, 0.4, 1.0, 1.2)
    expect(frame[0]).toBeCloseTo(0.5, 5)
    // The first gesture owns the angles outright, not blended with the unused zeros.
    expect(frame[2]).toBeCloseTo(1.0, 5)
    blendFrame(frame, 0.5, 0.0, 0.0, 0.0)
    expect(frame[0]).toBeCloseTo(0.75, 5)
    expect(frame[2]).toBeCloseTo(1.0 * 0.25 / 0.75, 5)
  })

  it('lets the animator pick a shape for the action being performed', () => {
    const state = createAvatarAnimatorState('p1')
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
    const base = {
      time: 10,
      delta: 1 / 60,
      reducedMotion: true,
      acting: false,
      folded: false,
      winner: false,
      loser: false,
      hasCards: false,
      cue: 'bet' as const,
      cueElapsedMs: 200,
      cueActive: true,
      actionKey: 'a',
      playerId: 'p1',
      wagerIntensity: 0.3,
      lookYaw: 0,
      lookPitch: -0.035,
      tableHeat: 0,
      idleTell: 'calm' as const,
      celebration: 'victory' as const,
      anchors,
    }
    const bet = computeAvatarTargetPose(state, base)
    const grab = bet.handShapeR.weights[6]!
    expect(grab).toBeGreaterThan(0.5)
    const idle = computeAvatarTargetPose(state, { ...base, cue: 'ready', cueActive: false, cueElapsedMs: 0 })
    expect(idle.handShapeR.weights[0]).toBeGreaterThan(0.95)
    // A bet gives the hand a gesture frame; idle leaves it natural.
    expect(bet.frameR[0]).toBeGreaterThan(0.5)
    expect(idle.frameR[0]).toBe(0)
  })
})

describe('finger clip tracks', () => {
  it('strips the idle clip finger tracks so the hands own the fingers', () => {
    const clip = new THREE.AnimationClip('idle', 1, [
      new THREE.QuaternionKeyframeTrack('Index2L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.QuaternionKeyframeTrack('Thumb3R.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.QuaternionKeyframeTrack('LowerArmR.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ])
    stripFingerTracks([clip])
    expect(clip.tracks.map(track => track.name)).toEqual(['LowerArmR.quaternion'])
  })
})

describe('animator motion limits', () => {
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
  const base = {
    time: 10, delta: 1 / 60, reducedMotion: false, acting: false, folded: false, winner: false, loser: false,
    hasCards: false, cue: 'ready' as const, cueElapsedMs: 0, cueActive: false, actionKey: '', playerId: 'p1',
    wagerIntensity: 0, lookYaw: 0, lookPitch: -0.035, tableHeat: 0, idleTell: 'calm' as const,
    celebration: 'victory' as const, anchors,
  }

  it('never whips a wrist faster than the hand speed cap when the pose jumps (chin rest to chips)', () => {
    const state = createAvatarAnimatorState('cap')
    // Settle thinking with the fist at the chin.
    let time = 0
    let pose = updateAvatarAnimator(state, { ...base, time, acting: true })
    for (let frame = 0; frame < 120; frame += 1) {
      time += 1 / 60
      pose = updateAvatarAnimator(state, { ...base, time, acting: true })
    }
    let previous = [...pose.handR]
    let fastest = 0
    for (let frame = 0; frame < 90; frame += 1) {
      time += 1 / 60
      pose = updateAvatarAnimator(state, { ...base, time, cue: 'bet', cueActive: true, cueElapsedMs: frame * (1000 / 60), actionKey: 'k', wagerIntensity: 0.6 })
      const step = Math.hypot(pose.handR[0]! - previous[0]!, pose.handR[1]! - previous[1]!, pose.handR[2]! - previous[2]!)
      fastest = Math.max(fastest, step * 60)
      previous = [...pose.handR]
    }
    // 5.5 seat units/s is the cue cap (plus a little integration slack).
    expect(fastest).toBeLessThan(6.5)
  })

  it('returns the same pose object every frame instead of allocating a new one', () => {
    const state = createAvatarAnimatorState('reuse')
    updateAvatarAnimator(state, { ...base, time: 0 })
    const a = updateAvatarAnimator(state, { ...base, time: 0.02 })
    const b = updateAvatarAnimator(state, { ...base, time: 0.04 })
    expect(a).toBe(b)
    expect(a.handR.every(Number.isFinite)).toBe(true)
  })
})
