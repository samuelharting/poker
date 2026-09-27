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
  computeServeSpot,
  hitsLuckyText,
  irisTextureData,
  isClearOfTable,
  pickCompanionGesture,
  SEAT_ONLY_GESTURES,
  solveTwoBoneElbow,
  springStep,
  WAISTBAND_COLORS,
  waistbandTextureData,
  updateCompanion,
  type CompanionState,
} from '@/components/three/companion3D'
import { countLadyLuckWords, LADY_LUCK_LINES } from '@/lib/ladyLuckLines'
import { FELT_TOP_Y } from '@/components/three/tableArt'
import {
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_SEAT_POSITIONS,
  TABLE_SEAT_SCALES,
  type TableVisualSeat,
} from '@/components/three/tableWagerLayout'
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

const LEGACY_OVERVIEW = { fov: 40, position: [0, 5.9, 12.2], lookAt: [0, 0.4, -0.6] } as const
const CAMERAS = [
  ['current desktop framing', DESKTOP_CAMERA_FRAMING],
  ['high overview framing', LEGACY_OVERVIEW],
] as const

function makeFramedCamera(framing: { fov: number; position: readonly number[]; lookAt: readonly number[] }) {
  const camera = new THREE.PerspectiveCamera(framing.fov, 1440 / 900, 0.1, 60)
  camera.position.set(framing.position[0]!, framing.position[1]!, framing.position[2]!)
  camera.lookAt(new THREE.Vector3(framing.lookAt[0]!, framing.lookAt[1]!, framing.lookAt[2]!))
  camera.updateMatrixWorld()
  return camera
}

describe.each(CAMERAS)('companion3D placement (%s)', (_label, framing) => {
  it('stands her beside the owner seat at the seat scale, apart from his head on screen', () => {
    const camera = makeFramedCamera(framing)
    for (const visualSeat of [1, 2, 3, 4, 5, 6, 7] as TableVisualSeat[]) {
      const seat = makeSeat(visualSeat)
      const side = chooseCompanionSide(seat, camera)
      const placement = computeSeatCompanionPlacement(seat, camera, side)
      expect(placement.scale).toBeCloseTo(TABLE_SEAT_SCALES[visualSeat])
      const seatPosition = seat.getWorldPosition(new THREE.Vector3())
      const offset = placement.position.clone().sub(seatPosition)
      expect(offset.length()).toBeGreaterThan(0.7)
      expect(offset.length()).toBeLessThan(1.3)
      const head = placement.head!.clone().project(camera)
      if (Math.abs(head.x) > 0.85 || head.z > 1) continue // the seat itself is off screen
      const ndc = placement.position.clone().setY(placement.position.y + 1.3).project(camera)
      expect(Math.abs(ndc.x)).toBeLessThan(1)
      expect(Math.abs(ndc.x - head.x)).toBeGreaterThan(0.02)
    }
  })

  it.each([['with the hero seat', true], ['camera only', false]] as const)(
    'stands the hero companion on the floor by the hero chair, left of view, clear of the table (%s)',
    (_mode, withSeat) => {
      const camera = makeFramedCamera(framing)
      const seat = withSeat ? makeSeat(0) : null
      const placement = computeHeroCompanionPlacement(camera, seat)
      const at = (height: number) => placement.position.clone().setY(placement.position.y + height * placement.scale)
      const chest = at(1.6).project(camera)
      const head = at(2.45).project(camera)
      // World space, believable size: ~0.85 of the hero's seat scale, feet on the floor.
      expect(placement.screenLocked).toBe(false)
      expect(placement.scale).toBeCloseTo((withSeat ? TABLE_SEAT_SCALES[0] : 1) * 0.85)
      expect(placement.position.y).toBeCloseTo(withSeat ? TABLE_SEAT_POSITIONS[0][1] : 0)
      // Never on the felt or rail.
      expect(isClearOfTable(placement.position, 0.3)).toBe(true)
      if (seat) {
        const seatPosition = seat.getWorldPosition(new THREE.Vector3())
        expect(Math.hypot(placement.position.x - seatPosition.x, placement.position.z - seatPosition.z)).toBeGreaterThan(0.8)
      }
      // Left side of the view (the DOM action tray lives bottom-right), chest and head on screen.
      expect(chest.x).toBeGreaterThan(-0.9)
      expect(chest.x).toBeLessThan(-0.3)
      expect(chest.y).toBeGreaterThan(-0.8)
      expect(head.y).toBeLessThan(1)
      expect(head.y).toBeGreaterThan(chest.y)
      // Turned 3/4 toward the lens.
      const towardCamera = Math.atan2(camera.position.x - placement.position.x, camera.position.z - placement.position.z)
      const turn = Math.abs(angleDelta(towardCamera, placement.yaw))
      expect(turn).toBeGreaterThan(0.2)
      expect(turn).toBeLessThan(0.9)
    }
  )
})

describe('companion3D serving', () => {
  it('sets the served cocktail on the felt just inside the rail, on her side of the seat', () => {
    const seat = makeSeat(4)
    const seatWorld = seat.getWorldPosition(new THREE.Vector3())
    const leftOf = computeServeSpot(seatWorld, seatWorld.clone().add(new THREE.Vector3(1, 0, 0)))
    const rightOf = computeServeSpot(seatWorld, seatWorld.clone().add(new THREE.Vector3(-1, 0, 0)))
    expect(leftOf.y).toBeCloseTo(FELT_TOP_Y)
    expect((leftOf.x / TABLE_FELT_SEMI_AXIS_X) ** 2 + (leftOf.z / TABLE_FELT_SEMI_AXIS_Z) ** 2).toBeLessThan(1)
    expect(leftOf.x).toBeGreaterThan(rightOf.x)
  })

  it('letters "LUCKY" in pink across the front of her black waistband', () => {
    expect(hitsLuckyText('LUCKY', -0.13 + 0.001, 0.66, 0.26, 0.32, 0.68)).toBe(true) // top-left of the L
    expect(hitsLuckyText('LUCKY', 0.2, 0.5, 0.26, 0.32, 0.68)).toBe(false)
    const width = 512
    const height = 32
    const data = waistbandTextureData(width, height)
    const pixel = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3))
    const { black, pink } = WAISTBAND_COLORS
    expect(pixel(10, 1)).toEqual([...pink]) // trim
    expect(pixel(10, 16)).toEqual([...black]) // plain black at the back
    let lettered = 0
    for (let x = Math.round(width * 0.45); x < width * 0.55; x += 1) if (pixel(x, 16).join() === pink.join()) lettered += 1
    expect(lettered).toBeGreaterThan(4)
  })

  it('draws an iris with a dark pupil and a catchlight', () => {
    const size = 64
    const data = irisTextureData(size)
    const pixel = (x: number, y: number) => Array.from(data.slice((y * size + x) * 4, (y * size + x) * 4 + 3))
    expect(Math.max(...pixel(32, 32))).toBeLessThan(40) // pupil
    const catchlight = pixel(Math.round((1 - 0.3) * size / 2), Math.round((1 + 0.36) * size / 2))
    expect(Math.min(...catchlight)).toBe(255)
  })
})

describe('companion3D gestures and lines', () => {
  it('never repeats the previous gesture, respects exclusions and keeps reduced motion to winks', () => {
    const random = createCompanionRandom(5)
    let previous = pickCompanionGesture('flirt', random, null)
    for (let index = 0; index < 40; index += 1) {
      const next = pickCompanionGesture('flirt', random, previous, false, SEAT_ONLY_GESTURES)
      expect(next).not.toBe(previous)
      expect(SEAT_ONLY_GESTURES).not.toContain(next)
      previous = next
    }
    expect(pickCompanionGesture('cheer', random, null, true)).toBe('wink')
  })

  it('picks deterministic lines from the right pool and fills in names', () => {
    const line = companionLineFor('sulk_leave', 'll-3-1', 1)
    expect(LADY_LUCK_LINES.sulk_leave).toContain(line)
    expect(companionLineFor('sulk_leave', 'll-3-1', 1)).toBe(line)
    expect(companionLineFor('sass_other', 'll-3-1', 2, 'Nova')).toContain('Nova')
  })
})

describe('companion3D runtime', () => {
  const baseState = (): NonNullable<CompanionState> => ({
    id: 'll-2-1', ownerId: 'bob', reason: 'streak', streak: 2, mood: 'arrive', since: 1, muted: false,
  })

  it('builds, enters, cheers, sulks off and disposes without WebGL, and never says a word', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const seat = makeSeat(4)
    scene.add(seat)
    const runtime = createCompanion(scene)
    expect(runtime.group.visible).toBe(false)

    let time = 0
    let state: CompanionState = baseState()
    const lines = new Set<string>()
    const run = (seconds: number) => {
      for (let frame = 0; frame < seconds * 30; frame += 1) {
        time += 1 / 30
        updateCompanion(runtime, {
          time, delta: 1 / 30, reducedMotion: false, state, ownerSeat: seat, ownerIsHero: false, camera,
          table: { otherPlayerNames: ['Nova'] },
        })
        const line = getCompanionLine(runtime)
        if (line) lines.add(line)
      }
    }

    run(2.5)
    expect(runtime.group.visible).toBe(true)
    expect(runtime.group.position.distanceTo(seat.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1.3)
    run(40)
    state = { ...state, mood: 'cheer', streak: 3, since: 2 }
    run(0.5)
    state = { ...state, mood: 'sulk_leave', since: 3 }
    run(2.7)
    expect(runtime.group.visible).toBe(false)
    // Owner: Lady Luck never talks.
    expect(lines.size).toBe(0)

    disposeCompanion(runtime)
    expect(runtime.group.parent).toBeNull()
  })

  it('hides when the owner seat is unknown and supports the hero placement', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const runtime = createCompanion(scene)
    const state: CompanionState = { ...baseState(), ownerId: 'me' }
    updateCompanion(runtime, { time: 0.1, delta: 0.1, reducedMotion: true, state, ownerSeat: null, ownerIsHero: false, camera })
    expect(runtime.group.visible).toBe(false)
    updateCompanion(runtime, { time: 0.2, delta: 0.1, reducedMotion: true, state, ownerSeat: null, ownerIsHero: true, camera })
    expect(runtime.group.visible).toBe(true)
    disposeCompanion(runtime)
  })
})

describe('companion3D model', () => {
  const measure = () => {
    const scene = new THREE.Scene()
    const runtime = createCompanion(scene)
    const { rig } = runtime
    // Pose her once (legs are IK-driven), then measure in her own frame.
    const state: CompanionState = { id: 'll-measure', ownerId: 'me', reason: 'streak', streak: 2, mood: 'arrive', since: 1, muted: false }
    for (let frame = 1; frame <= 90; frame += 1) {
      updateCompanion(runtime, { time: frame / 30, delta: 1 / 30, reducedMotion: true, state, ownerSeat: null, ownerIsHero: true, camera: makeCamera() })
    }
    runtime.group.position.set(0, 0, 0)
    runtime.group.rotation.set(0, 0, 0)
    runtime.group.scale.setScalar(1)
    runtime.group.updateMatrixWorld(true)
    const body = new THREE.Box3()
    for (const child of rig.model.children) {
      if (child.name === 'tray' || child.name === 'cocktail') continue
      body.expandByObject(child)
    }
    // The skull (chin to crown, no hair) measured unrotated, in its own geometry.
    const faceGeometry = (rig.head.getObjectByName('face') as THREE.Mesh).geometry
    faceGeometry.computeBoundingBox()
    const face = faceGeometry.boundingBox!.clone()
    return { runtime, body, face }
  }

  it('has grown-up proportions: about seven heads tall with long legs', () => {
    const { runtime, body, face } = measure()
    const height = body.max.y - body.min.y
    const headHeight = face.max.y - face.min.y
    expect(body.min.y).toBeGreaterThan(-0.02)
    expect(height).toBeGreaterThan(2.4)
    expect(height).toBeLessThan(2.65)
    expect(height / headHeight).toBeGreaterThan(6.8)
    // Hip joints sit at about half her height.
    const hip = runtime.rig.legs[0].thigh.getWorldPosition(new THREE.Vector3())
    expect(hip.y / height).toBeGreaterThan(0.48)
    disposeCompanion(runtime)
  })

  it('wears a sports bra, bike shorts and sneakers, and stays cheap to draw', () => {
    const { runtime } = measure()
    const names = new Set<string>()
    let meshes = 0
    runtime.rig.model.traverse(object => {
      names.add(object.name)
      if ((object as THREE.Mesh).isMesh) meshes += 1
    })
    expect(names.has('sneaker')).toBe(true)
    expect(names.has('shirt')).toBe(false)
    const colors = runtime.rig.materials.all
      .filter((material): material is THREE.MeshToonMaterial => material instanceof THREE.MeshToonMaterial)
      .map(material => `#${material.color.getHexString()}`)
    expect(colors).toContain('#2a2731') // black performance fabric
    expect(colors).toContain('#ff4f9a') // pink accents
    expect(meshes).toBeLessThanOrEqual(93)
    disposeCompanion(runtime)
  })

  it('keeps her heels planted while her hips sway (leg IK)', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const seat = makeSeat(4)
    const runtime = createCompanion(scene)
    const state: CompanionState = { id: 'll-legs', ownerId: 'bob', reason: 'streak', streak: 2, mood: 'arrive', since: 1, muted: false }
    let time = 0
    for (let frame = 0; frame < 150; frame += 1) {
      time += 1 / 30
      updateCompanion(runtime, { time, delta: 1 / 30, reducedMotion: false, state, ownerSeat: seat, ownerIsHero: false, camera })
      if (frame < 90 || frame % 10 !== 0) continue
      runtime.rig.model.updateMatrixWorld(true)
      for (const leg of runtime.rig.legs) {
        const shinEnd = leg.knee.localToWorld(new THREE.Vector3(0, -leg.lowerLength, 0))
        const ankle = leg.foot.getWorldPosition(new THREE.Vector3())
        expect(shinEnd.distanceTo(ankle) / runtime.group.scale.x).toBeLessThan(0.02)
      }
    }
    disposeCompanion(runtime)
  })
})
