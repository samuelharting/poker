import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeAvatarTargetPose,
  createAvatarAnimatorState,
  updateAvatarAnimator,
  type AvatarAnimatorInput,
} from '@/components/three/avatarAnimator'
import { getArmChain, solveArmIK } from '@/components/three/avatarIK'

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
}

function input(overrides: Partial<AvatarAnimatorInput> = {}): AvatarAnimatorInput {
  return {
    time: 10,
    delta: 1 / 60,
    reducedMotion: true,
    acting: false,
    folded: false,
    winner: false,
    loser: false,
    hasCards: false,
    cue: 'ready',
    cueElapsedMs: 0,
    cueActive: false,
    actionKey: '',
    playerId: 'p1',
    wagerIntensity: 0,
    lookYaw: 0,
    lookPitch: -0.035,
    tableHeat: 0,
    idleTell: 'calm',
    celebration: 'victory',
    anchors,
    ...overrides,
  }
}

describe('avatar animator', () => {
  it('rests both hands on the rail when idle', () => {
    const pose = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input())
    expect(pose.handR[2]).toBeCloseTo(anchors.railR[2], 1)
    expect(pose.handL[0]).toBeLessThan(0)
    expect(pose.handR[0]).toBeGreaterThan(0)
  })

  it('throws both hands above the shoulders for a victory celebration', () => {
    const state = createAvatarAnimatorState('p1')
    computeAvatarTargetPose(state, input({ winner: true, time: 0 }))
    const pose = computeAvatarTargetPose(state, input({ winner: true, time: 2 }))
    expect(pose.handR[1]).toBeGreaterThan(anchors.shoulderR[1] + 0.4)
    expect(pose.handL[1]).toBeGreaterThan(anchors.shoulderL[1] + 0.4)
    expect(pose.bodyPosition[1]).toBeGreaterThan(0.1)
  })

  it('folds the arms and sits back after folding', () => {
    const state = createAvatarAnimatorState('p1')
    computeAvatarTargetPose(state, input({ folded: true, time: 0 }))
    const pose = computeAvatarTargetPose(state, input({ folded: true, time: 3 }))
    // Hands cross the body: right hand ends up left of centre and vice versa.
    expect(pose.handR[0]).toBeLessThan(0)
    expect(pose.handL[0]).toBeGreaterThan(0)
    expect(pose.bodyPosition[2]).toBeGreaterThan(0)
  })

  it('brings a hand to the chin or the rail while thinking on their turn', () => {
    const state = createAvatarAnimatorState('p1')
    computeAvatarTargetPose(state, input({ acting: true, time: 0 }))
    const pose = computeAvatarTargetPose(state, input({ acting: true, time: 2 }))
    const nearChin = Math.hypot(pose.handR[1] - anchors.chin[1], pose.handR[2] - anchors.chin[2]) < 0.25
    const nearRail = Math.abs(pose.handR[1] - anchors.railR[1]) < 0.25
    expect(nearChin || nearRail).toBe(true)
  })

  it('smooths state changes with springs instead of snapping', () => {
    const state = createAvatarAnimatorState('p1')
    const base = { reducedMotion: false }
    updateAvatarAnimator(state, input({ ...base, time: 0 }))
    const first = updateAvatarAnimator(state, input({ ...base, winner: true, time: 0.016 }))
    // One frame after winning the hand has only started to rise.
    expect(first.handR[1]).toBeLessThan(anchors.shoulderR[1] + 0.2)
    let pose = first
    for (let frame = 0; frame < 120; frame += 1) {
      pose = updateAvatarAnimator(state, input({ ...base, winner: true, time: 0.016 * (frame + 2) }))
    }
    expect(pose.handR[1]).toBeGreaterThan(anchors.shoulderR[1] + 0.3)
  })
})

describe('animator stability', () => {
  it('never launches the avatar at low frame rates during actions', () => {
    const state = createAvatarAnimatorState('slow-frames')
    let time = 0
    for (let frame = 0; frame < 400; frame += 1) {
      const delta = frame % 7 === 0 ? 0.1 : 0.05
      time += delta
      const cue = (['call', 'raise', 'all_in', 'check', 'fold'] as const)[Math.floor(frame / 40) % 5]!
      const pose = updateAvatarAnimator(state, input({
        reducedMotion: false,
        time,
        delta,
        cue,
        cueActive: frame % 40 < 20,
        cueElapsedMs: (frame % 40) * delta * 1000,
        acting: frame % 80 < 40,
      }))
      for (const value of [...pose.bodyPosition, ...pose.handR, ...pose.handL]) {
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThan(6)
      }
      expect(Math.abs(pose.bodyPosition[2])).toBeLessThanOrEqual(0.45)
    }
  })
})

describe('arm IK', () => {
  it('places the wrist on a reachable target', () => {
    const upper = new THREE.Bone()
    const lower = new THREE.Bone()
    const hand = new THREE.Bone()
    upper.add(lower)
    lower.add(hand)
    lower.position.set(0, -0.35, 0)
    hand.position.set(0, -0.4, 0)
    const root = new THREE.Group()
    root.add(upper)
    root.updateMatrixWorld(true)

    const chain = getArmChain(upper, lower, hand)!
    const target = new THREE.Vector3(0.2, -0.3, -0.45)
    solveArmIK(chain, target, new THREE.Vector3(1, -1, 1))
    root.updateMatrixWorld(true)
    const wrist = hand.getWorldPosition(new THREE.Vector3())
    expect(wrist.distanceTo(target)).toBeLessThan(0.01)
  })

  it('stretches toward unreachable targets without breaking the chain', () => {
    const upper = new THREE.Bone()
    const lower = new THREE.Bone()
    const hand = new THREE.Bone()
    upper.add(lower)
    lower.add(hand)
    lower.position.set(0, -0.35, 0)
    hand.position.set(0, -0.4, 0)
    upper.updateMatrixWorld(true)

    solveArmIK(getArmChain(upper, lower, hand)!, new THREE.Vector3(0, 0, -3), new THREE.Vector3(1, 0, 0))
    upper.updateMatrixWorld(true)
    const wrist = hand.getWorldPosition(new THREE.Vector3())
    expect(wrist.length()).toBeGreaterThan(0.7)
    expect(wrist.z).toBeLessThan(-0.7)
  })
})
