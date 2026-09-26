import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  angleDelta,
  chooseCompanionSide,
  companionLineFor,
  computeCompanionYaw,
  computeHeroCompanionPlacement,
  computeSeatCompanionPlacement,
  createCompanion,
  createCompanionRandom,
  disposeCompanion,
  gestureEnvelope,
  getCompanionBubbleAnchor,
  getCompanionLine,
  heartTextureData,
  keyframe,
  pickCompanionGesture,
  solveTwoBoneElbow,
  springStep,
  updateCompanion,
  type CompanionState,
} from '@/components/three/companion3D'
import { LADY_LUCK_LINES } from '@/lib/ladyLuckLines'
import { TABLE_SEAT_POSITIONS, TABLE_SEAT_SCALES, type TableVisualSeat } from '@/components/three/tableWagerLayout'
import { DESKTOP_CAMERA_FRAMING } from '@/components/three/cameraFraming'

function makeCamera() {
  const camera = new THREE.PerspectiveCamera(DESKTOP_CAMERA_FRAMING.fov, 1440 / 900, 0.1, 60)
  camera.position.set(...DESKTOP_CAMERA_FRAMING.position)
  camera.lookAt(new THREE.Vector3(...DESKTOP_CAMERA_FRAMING.lookAt))
  camera.updateMatrixWorld()
  return camera
}

function makeSeat(visualSeat: TableVisualSeat) {
  const root = new THREE.Group()
  const position = TABLE_SEAT_POSITIONS[visualSeat]
  root.position.set(position[0], position[1], position[2])
  root.scale.setScalar(TABLE_SEAT_SCALES[visualSeat])
  root.rotation.y = Math.atan2(position[0], position[2])
  root.updateMatrixWorld(true)
  return root
}

describe('companion3D math helpers', () => {
  it('wraps angle deltas to the shortest arc', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(angleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2)
  })

  it('blends her facing between the player and the camera', () => {
    const at = new THREE.Vector3(0, 0, 0)
    const player = new THREE.Vector3(-1, 0, 0)
    const camera = new THREE.Vector3(0, 0, 1)
    expect(computeCompanionYaw(at, player, camera, 0)).toBeCloseTo(-Math.PI / 2)
    expect(computeCompanionYaw(at, player, camera, 1)).toBeCloseTo(0)
    expect(computeCompanionYaw(at, player, camera, 0.5)).toBeCloseTo(-Math.PI / 4)
  })

  it('eases keyframes and envelopes', () => {
    const keys = [[0, 0], [0.5, 1], [1, 0]] as const
    expect(keyframe(-1, keys)).toBe(0)
    expect(keyframe(0.5, keys)).toBe(1)
    expect(keyframe(0.25, keys)).toBeCloseTo(0.5)
    expect(gestureEnvelope(0)).toBe(0)
    expect(gestureEnvelope(0.5)).toBe(1)
    expect(gestureEnvelope(1)).toBe(0)
  })

  it('settles springs on their target', () => {
    let value = 0
    let velocity = 0
    for (let frame = 0; frame < 120; frame += 1) {
      ;[value, velocity] = springStep(value, velocity, 1, 1 / 60)
    }
    expect(value).toBeCloseTo(1, 2)
  })

  it('solves two-bone IK with bones of the right length', () => {
    const target = new THREE.Vector3(0.1, -0.3, 0.25)
    const elbow = solveTwoBoneElbow(target, new THREE.Vector3(0, 0, -1), 0.3, 0.27)
    expect(elbow.length()).toBeCloseTo(0.3, 5)
    expect(elbow.distanceTo(target)).toBeCloseTo(0.27, 5)
    // Pole pulls the elbow backward.
    expect(elbow.z).toBeLessThan(target.z * (0.3 / target.length()))
  })

  it('draws a heart texture that is solid in the middle and clear in the corners', () => {
    const size = 32
    const data = heartTextureData(size)
    const alpha = (x: number, y: number) => data[(y * size + x) * 4 + 3]!
    expect(alpha(16, 14)).toBeGreaterThan(200)
    expect(alpha(0, 0)).toBe(0)
    expect(alpha(size - 1, size - 1)).toBe(0)
  })
})

describe('companion3D placement', () => {
  it('stands her beside the owner seat at the seat scale, on the side away from his head on screen', () => {
    const camera = makeCamera()
    for (const visualSeat of [1, 2, 3, 4, 5, 6, 7] as TableVisualSeat[]) {
      const seat = makeSeat(visualSeat)
      const side = chooseCompanionSide(seat, camera)
      const placement = computeSeatCompanionPlacement(seat, camera, side)
      expect(placement.scale).toBeCloseTo(TABLE_SEAT_SCALES[visualSeat])
      const seatPosition = seat.getWorldPosition(new THREE.Vector3())
      const offset = placement.position.clone().sub(seatPosition)
      expect(offset.length()).toBeGreaterThan(0.7)
      expect(offset.length()).toBeLessThan(1.3)
      const ndc = placement.position.clone().setY(placement.position.y + 1.3).project(camera)
      expect(Math.abs(ndc.x)).toBeLessThan(1)
      const head = placement.head!.clone().project(camera)
      expect(Math.abs(ndc.x - head.x)).toBeGreaterThan(0.02)
    }
  })

  it('puts the hero companion in the lower-left of the frame, clear of the action panel', () => {
    const camera = makeCamera()
    const placement = computeHeroCompanionPlacement(camera)
    const chest = placement.position.clone().setY(placement.position.y + 1.55).project(camera)
    expect(chest.x).toBeCloseTo(-0.8, 1)
    expect(chest.y).toBeCloseTo(-0.42, 1)
    const head = placement.position.clone().setY(placement.position.y + 2.5).project(camera)
    expect(head.y).toBeLessThan(0.6)
  })
})

describe('companion3D gestures and lines', () => {
  it('never repeats the previous gesture and keeps reduced motion to winks', () => {
    const random = createCompanionRandom(5)
    let previous = pickCompanionGesture('flirt', random, null)
    for (let index = 0; index < 30; index += 1) {
      const next = pickCompanionGesture('flirt', random, previous)
      expect(next).not.toBe(previous)
      previous = next
    }
    expect(pickCompanionGesture('cheer', random, null, true)).toBe('wink')
  })

  it('picks deterministic lines from the right pool', () => {
    const line = companionLineFor('sulk_leave', 'll-3-1', 1)
    expect(LADY_LUCK_LINES.sulk_leave).toContain(line)
    expect(companionLineFor('sulk_leave', 'll-3-1', 1)).toBe(line)
  })
})

describe('companion3D runtime', () => {
  it('builds, enters, talks, sulks off and disposes without WebGL', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const seat = makeSeat(4)
    scene.add(seat)
    const runtime = createCompanion(scene)
    expect(runtime.group.visible).toBe(false)

    let time = 0
    let state: CompanionState = {
      id: 'll-2-1', ownerId: 'bob', reason: 'streak', streak: 2, mood: 'arrive', since: 1,
    }
    const run = (seconds: number) => {
      for (let frame = 0; frame < seconds * 30; frame += 1) {
        time += 1 / 30
        updateCompanion(runtime, {
          time, delta: 1 / 30, reducedMotion: false, state, ownerSeat: seat, ownerIsHero: false, camera,
        })
      }
    }

    run(2.5)
    expect(runtime.group.visible).toBe(true)
    expect(runtime.group.position.distanceTo(seat.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1.3)
    expect(getCompanionLine(runtime)).toBeTypeOf('string')
    expect(getCompanionBubbleAnchor(runtime, new THREE.Vector3())).toBe(true)

    state = { ...state, mood: 'cheer', streak: 3, since: 2 }
    run(1)
    expect(LADY_LUCK_LINES.cheer).toContain(getCompanionLine(runtime))

    state = { ...state, mood: 'sulk_leave', since: 3 }
    run(0.2)
    expect(LADY_LUCK_LINES.sulk_leave).toContain(getCompanionLine(runtime))
    run(2.5)
    expect(runtime.group.visible).toBe(false)

    disposeCompanion(runtime)
    expect(runtime.group.parent).toBeNull()
  })

  it('hides when the owner seat is unknown and supports the hero placement', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const runtime = createCompanion(scene)
    const state: CompanionState = { id: 'x', ownerId: 'me', reason: 'big_win', streak: 1, mood: 'arrive', since: 1 }
    updateCompanion(runtime, { time: 0.1, delta: 0.1, reducedMotion: true, state, ownerSeat: null, ownerIsHero: false, camera })
    expect(runtime.group.visible).toBe(false)
    updateCompanion(runtime, { time: 0.2, delta: 0.1, reducedMotion: true, state, ownerSeat: null, ownerIsHero: true, camera })
    expect(runtime.group.visible).toBe(true)
    disposeCompanion(runtime)
  })
})
