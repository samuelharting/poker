import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeAvatarTargetPose,
  createAvatarAnimatorState,
  restingHands,
  FLIP_OFF_SECONDS,
  getFlipOffHand,
  updateAvatarAnimator,
  type AvatarAnimatorInput,
} from '@/components/three/avatarAnimator'
import { ARM_MAX_EXTENSION, getArmChain, getArmOvershoot, orientBoneFrame, solveArmIK } from '@/components/three/avatarIK'

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
    // Forearms out on the crown of the cushion, in front of the shoulders.
    expect(pose.handR[1]).toBeCloseTo(anchors.railR[1], 1)
    expect(pose.handR[2]).toBeLessThan(anchors.railR[2] - 0.05)
    expect(pose.handR[2]).toBeGreaterThan(anchors.railR[2] - 0.35)
    expect(pose.handR[2]).toBeLessThan(anchors.shoulderR[2] - 0.2)
    expect(pose.handL[0]).toBeLessThan(0)
    expect(pose.handR[0]).toBeGreaterThan(0)
  })

  it('varies the resting hands between players', () => {
    const styles = new Set<number>()
    for (let index = 0; index < 40; index += 1) styles.add(restingHands(anchors, index / 40).style)
    expect(styles.size).toBe(4)
    for (let index = 0; index < 40; index += 1) {
      const rest = restingHands(anchors, index / 40)
      // Hands never overlap: the wrists stay well apart.
      expect(rest.right[0] - rest.left[0]).toBeGreaterThan(0.26)
      // Wrists on the player's side of the crown (never down its inner
      // slope), with a relaxed curl.
      for (const wrist of [rest.right, rest.left]) {
        expect(wrist[2]).toBeLessThan(anchors.railR[2] - 0.04)
        expect(wrist[2]).toBeGreaterThan(anchors.railR[2] - 0.2)
      }
      expect(rest.curlR).toBeLessThanOrEqual(0.2)
      expect(rest.curlL).toBeLessThanOrEqual(0.2)
    }
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
    // Soft elbows: the arm reaches ~90% of its length, never locked straight.
    expect(wrist.length()).toBeGreaterThan(0.75 * ARM_MAX_EXTENSION - 0.01)
    expect(wrist.length()).toBeLessThan(0.75 * 0.97)
    expect(wrist.z).toBeLessThan(-0.6)
    // ...and reports how far it fell short so the torso can lean in.
    expect(getArmOvershoot(getArmChain(upper, lower, hand)!, new THREE.Vector3(0, 0, -3))).toBeGreaterThan(2)
  })

  it('turns a hand so its fingers point up with the knuckles facing a target', () => {
    const wrist = new THREE.Bone()
    const middle = new THREE.Bone()
    const index = new THREE.Bone()
    const pinky = new THREE.Bone()
    wrist.add(middle, index, pinky)
    middle.position.set(0, 0, -0.1)
    index.position.set(0.03, 0, -0.1)
    pinky.position.set(-0.03, 0, -0.1)
    const root = new THREE.Group()
    root.add(wrist)
    root.updateMatrixWorld(true)
    orientBoneFrame(wrist, middle, index, pinky, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))
    root.updateMatrixWorld(true)
    const up = middle.getWorldPosition(new THREE.Vector3()).sub(wrist.getWorldPosition(new THREE.Vector3())).normalize()
    const side = pinky.getWorldPosition(new THREE.Vector3()).sub(index.getWorldPosition(new THREE.Vector3())).normalize()
    expect(up.y).toBeGreaterThan(0.99)
    expect(side.x).toBeGreaterThan(0.99)
  })
})

describe('flick-off, pass-out and reactions', () => {
  const target: [number, number, number] = [0.4, 1.5, -3.5]

  it('throws the arm out toward the target at face height and holds it', () => {
    const state = createAvatarAnimatorState('p1')
    const holdPose = computeAvatarTargetPose(state, input({ flipOff: { elapsed: 1.2, target } }))
    const shoulder = anchors.shoulderR
    const reach = Math.hypot(holdPose.handR[0] - shoulder[0], holdPose.handR[2] - shoulder[2])
    expect(reach).toBeGreaterThan(0.5)
    expect(holdPose.handR[1]).toBeGreaterThan(shoulder[1])
    expect(holdPose.middleFinger).toBeCloseTo(1, 2)
    expect(holdPose.fingerCurlR).toBeCloseTo(1, 2)
    // Head and chest turn toward the target (target is to the right: negative yaw).
    expect(Math.sign(holdPose.bones.Head[1])).toBe(Math.sign(Math.atan2(-(target[0] - shoulder[0]), -(target[2] - shoulder[2]))))
    // Still readable for most of the gesture, then released.
    const late = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ flipOff: { elapsed: 2.3, target } }))
    expect(late.middleFinger).toBeGreaterThan(0.9)
    const done = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ flipOff: { elapsed: FLIP_OFF_SECONDS + 0.01, target } }))
    expect(done.middleFinger).toBe(0)
  })

  it('uses the hand on the target side so the arm never crosses the body', () => {
    expect(getFlipOffHand([2, 1.5, -1])).toBe('R')
    expect(getFlipOffHand([-2, 1.5, -1])).toBe('L')
    const pose = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ flipOff: { elapsed: 1.2, target: [-2, 1.5, -1] } }))
    expect(pose.handL[0]).toBeLessThan(anchors.shoulderL[0] - 0.3)
  })

  it('never flicks anyone off while passed out', () => {
    const pose = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ passedOut: true, flipOff: { elapsed: 1.2, target } }))
    expect(pose.middleFinger).toBe(0)
  })

  it('passes out with forearms folded on the rail and elbows splayed', () => {
    const pose = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ passedOut: true }))
    expect(pose.elbowOut).toBe(1)
    // Wrists cross toward the middle, resting at rail height.
    expect(pose.handR[0]).toBeLessThan(anchors.railR[0])
    expect(pose.handL[0]).toBeGreaterThan(anchors.railL[0])
    expect(Math.abs(pose.handR[1] - anchors.railR[1])).toBeLessThan(0.12)
    // Slumped forward over them, head rolled onto a cheek.
    expect(pose.bones.Chest[0]).toBeGreaterThan(0.5)
    expect(Math.abs(pose.bones.Head[2])).toBeGreaterThan(0.5)
  })

  it('sways more the drunker they are', () => {
    const swayAt = (drunkLevel: number) => {
      let max = 0
      for (let step = 0; step < 120; step += 1) {
        const pose = computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ reducedMotion: false, drunkLevel, time: step * 0.1 }))
        max = Math.max(max, Math.abs(pose.bones.Torso[2]))
      }
      return max
    }
    expect(swayAt(8)).toBeGreaterThan(swayAt(2) * 2)
  })

  it('rakes the pot in, then crouches before popping up to celebrate', () => {
    const state = createAvatarAnimatorState('p1')
    computeAvatarTargetPose(state, input({ reducedMotion: false, winner: true, time: 0 }))
    const rake = computeAvatarTargetPose(state, input({ reducedMotion: false, winner: true, time: 0.4 }))
    // Both hands reach out over the felt toward the pot.
    expect(rake.handR[2]).toBeLessThan(anchors.cards[2])
    expect(rake.handL[2]).toBeLessThan(anchors.cards[2])
    const antic = computeAvatarTargetPose(state, input({ reducedMotion: false, winner: true, time: 1.12 }))
    const up = computeAvatarTargetPose(state, input({ reducedMotion: false, winner: true, time: 1.9 }))
    expect(antic.bodyPosition[1]).toBeLessThan(up.bodyPosition[1])
    expect(up.bodyPosition[1]).toBeGreaterThan(0.1)
  })

  it('pushes chips with the chips: hand at the stack as they leave, out front as they land', () => {
    const cueInput = (cue: 'bet' | 'call' | 'raise' | 'all_in', ms: number, wagerIntensity = 0) =>
      computeAvatarTargetPose(createAvatarAnimatorState('p1'), input({ cue, cueActive: true, cueElapsedMs: ms, wagerIntensity }))
    const atGrab = cueInput('bet', 250)
    expect(Math.hypot(atGrab.handR[0] - anchors.stack[0], atGrab.handR[2] - anchors.stack[2])).toBeLessThan(0.15)
    const atLand = cueInput('bet', 780)
    expect(atLand.handR[2]).toBeLessThan(anchors.stack[2] - 0.3)
    // A big raise brings the second hand in and leans further.
    const small = cueInput('raise', 550, 0)
    const huge = cueInput('raise', 550, 1)
    expect(huge.bones.Chest[0]).toBeGreaterThan(small.bones.Chest[0])
    expect(huge.handL[2]).toBeLessThan(small.handL[2] - 0.3)
    // A call is a flat hand, not a grab.
    expect(cueInput('call', 500).fingerCurlR).toBeLessThan(0.3)
    // All-in: both arms sweep forward and the chin comes up at the hold.
    const shove = cueInput('all_in', 700)
    expect(shove.handR[2]).toBeLessThan(anchors.stack[2])
    expect(shove.handL[2]).toBeLessThan(anchors.stack[2])
  })
})
