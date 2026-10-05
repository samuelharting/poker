import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildGripHandGeometry, buildHandGeometry, GRIP_MORPH, solveGripWrap, type GripSpec } from '@/components/three/firstPersonHandMesh'
import { createGripHand, setGripInk, setGripPose } from '@/components/three/firstPersonGripHand'

// The drink props paint canvas textures; the node test environment has no canvas.
vi.mock('@/components/three/sceneTextures', () => {
  const texture = () => new THREE.Texture()
  return {
    getBeerFoamTexture: texture,
    getBeerLiquidTexture: texture,
    getGlassDropletTexture: texture,
    getLemonWheelTexture: texture,
    getWaterLiquidTexture: texture,
  }
})

const thumb = { yaw: [0.8, -0.25, 0] as [number, number, number], curl: [0.6, 0.45, 0.3] as [number, number, number] }
const WATER: GripSpec = { radius: 0.04375, axis: [-0.065, -0.07], thumb, wristBend: 0.5 }
const SHOT: GripSpec = { radius: 0.0436, axis: [-0.0646, -0.07], thumb, wristBend: 0.5 }
const MUG_HANDLE: GripSpec = { radius: 0.0074, axis: [-0.027, -0.054], thumb, wristBend: 0.5 }

describe('the glass grip finger solver', () => {
  for (const [name, spec] of [['the water glass', WATER], ['the shot glass', SHOT], ['the mug handle', MUG_HANDLE]] as const) {
    it(`wraps all four fingers around ${name} without going through it`, () => {
      const wraps = solveGripWrap(spec)
      expect(wraps).toHaveLength(4)
      for (const wrap of wraps) {
        expect(wrap.curl.every(curl => curl >= 0 && curl < 2.6)).toBe(true)
        // Joints after the knuckle lie on the circle the finger wraps (within a few mm), never inside it.
        for (const joint of wrap.points.slice(1)) {
          const gap = Math.hypot(joint[0] - spec.axis[0], joint[1] - spec.axis[1]) - wrap.distance
          expect(gap).toBeGreaterThan(-0.002)
          expect(gap).toBeLessThan(0.006)
        }
      }
    })
  }

  it('curls the fingers more around a thin handle than around a glass', () => {
    const glass = solveGripWrap(WATER)[1]!.curl.reduce((a, b) => a + b, 0)
    const handle = solveGripWrap(MUG_HANDLE)[1]!.curl.reduce((a, b) => a + b, 0)
    expect(handle).toBeGreaterThan(glass + 1)
  })
})

describe('the grip hand mesh', () => {
  const resting = buildHandGeometry()
  const grip = buildGripHandGeometry(WATER)

  it('is built from the same pieces as the resting hand, with four morph targets (one shader program)', () => {
    expect(grip.getAttribute('position').count).toBe(resting.getAttribute('position').count)
    expect(grip.index!.count).toBe(resting.index!.count)
    for (const name of ['normal', 'color', 'shade', 'ink']) expect(grip.getAttribute(name)).toBeDefined()
    expect(grip.morphAttributes.position).toHaveLength(resting.morphAttributes.position!.length)
    expect(grip.morphAttributes.normal).toHaveLength(4)
    expect(grip.morphTargetsRelative).toBe(true)
    expect(GRIP_MORPH).toEqual({ loose: 0, tight: 1, lift: 2, tap: 3 })
    for (const target of grip.morphAttributes.position!) expect(target.count).toBe(grip.getAttribute('position').count)
  })

  it('bends the wrist: the sleeve leaves the hand sideways, not straight back', () => {
    const straight = buildGripHandGeometry({ ...WATER, wristBend: 0 })
    const far = (geometry: THREE.BufferGeometry) => {
      const position = geometry.getAttribute('position')
      let x = 0
      for (let index = 0; index < position.count; index += 1) if (position.getZ(index) > 0.2) x = Math.max(x, position.getX(index))
      return x
    }
    expect(far(straight)).toBeLessThan(0.07)
    expect(far(grip)).toBeGreaterThan(0.12)
    straight.dispose()
  })

  it('squeezes and loosens: tight and loose targets move the fingertips in opposite directions', () => {
    const position = grip.getAttribute('position')
    const loose = grip.morphAttributes.position![GRIP_MORPH.loose]!
    const tight = grip.morphAttributes.position![GRIP_MORPH.tight]!
    let looseMove = 0
    let tightMove = 0
    for (let index = 0; index < position.count; index += 1) {
      looseMove += Math.abs(loose.getX(index)) + Math.abs(loose.getY(index)) + Math.abs(loose.getZ(index))
      tightMove += Math.abs(tight.getX(index)) + Math.abs(tight.getY(index)) + Math.abs(tight.getZ(index))
    }
    expect(looseMove).toBeGreaterThan(0.1)
    expect(tightMove).toBeGreaterThan(0.01)
    expect(looseMove).toBeGreaterThan(tightMove)
  })
})

describe('createGripHand', () => {
  const options = { spec: WATER, scale: 1.6, yaw: 0.45, height: 0.105, axisX: 0, skin: '#d9a27c', sleeve: '#2b2f3a' }

  it('puts the grip axis on the glass axis', () => {
    const hand = createGripHand(options)
    hand.group.updateMatrixWorld(true)
    const axis = new THREE.Vector3(0, WATER.axis[0], WATER.axis[1]).applyMatrix4(hand.group.matrixWorld)
    expect(axis.x).toBeCloseTo(0, 5)
    expect(axis.y).toBeCloseTo(0.105, 5)
    expect(axis.z).toBeCloseTo(0, 5)
    // The palm is on the +X side of the glass (a right hand: the drink mirrors it into a left hand).
    const palm = new THREE.Vector3(0, 0, -0.05).applyMatrix4(hand.group.matrixWorld)
    expect(palm.x).toBeGreaterThan(0.05)
    // Thumb up: the thumb side of the hand is above the little finger.
    const thumbSide = new THREE.Vector3(-0.03, 0, -0.05).applyMatrix4(hand.group.matrixWorld)
    const pinkySide = new THREE.Vector3(0.03, 0, -0.05).applyMatrix4(hand.group.matrixWorld)
    expect(thumbSide.y).toBeGreaterThan(pinkySide.y)
    hand.geometry.dispose()
  })

  it('draws as two calls (hand and ink hull) sharing one geometry, in the hero profile colours', () => {
    const hand = createGripHand(options)
    const meshes: THREE.Mesh[] = []
    hand.group.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh) })
    expect(meshes).toHaveLength(2)
    expect(meshes[0]!.geometry).toBe(meshes[1]!.geometry)
    expect(hand.colors.sleeve.getHexString()).toBe('2b2f3a')
    // The same small lift the resting hands' skin gets.
    const expected = new THREE.Color('#d9a27c').offsetHSL(0, 0.04, 0.02)
    expect(hand.colors.skin.getHex()).toBe(expected.getHex())
    hand.geometry.dispose()
  })

  it('blends morph targets on the hand and its hull together, and sizes the ink for the hand scale', () => {
    const hand = createGripHand(options)
    setGripPose(hand, { loose: 0.4, tight: 0.2 })
    expect(hand.mesh.morphTargetInfluences![GRIP_MORPH.loose]).toBeCloseTo(0.4)
    expect(hand.ink.morphTargetInfluences![GRIP_MORPH.loose]).toBeCloseTo(0.4)
    expect(hand.ink.morphTargetInfluences![GRIP_MORPH.tight]).toBeCloseTo(0.2)
    setGripInk(hand, 1.6 * 0.48, 720, 0.66, Math.tan(THREE.MathUtils.degToRad(25)))
    const small = hand.hull.width.value
    expect(small).toBeGreaterThan(0)
    setGripInk(hand, 0.78, 720, 0.66, Math.tan(THREE.MathUtils.degToRad(25)))
    expect(hand.hull.width.value).toBeLessThan(small)
    hand.geometry.dispose()
  })
})

describe('the first-person drink', () => {
  it('holds beer and water with the grip hand: two hand draw calls, the right colours, no old ring fingers', async () => {
    const { createFirstPersonDrink, updateFirstPersonDrink, disposeFirstPersonDrink } = await import('@/components/three/firstPersonDrink')
    const camera = new THREE.PerspectiveCamera(50, 16 / 9)
    const drink = createFirstPersonDrink(camera)
    const input = { elapsed: 0.8 as number | null, kind: 'beer' as const, skinColor: '#c68642', sleeveColor: '#443322', drunkLevel: 0, time: 1, reducedMotion: false, renderHeight: 720 }
    for (const kind of ['beer', 'water'] as const) {
      updateFirstPersonDrink(drink, { ...input, kind })
      expect(drink.root.visible).toBe(true)
      expect(drink.grip).not.toBeNull()
      let handMeshes = 0
      drink.grip!.group.traverse(object => { if ((object as THREE.Mesh).isMesh) handMeshes += 1 })
      expect(handMeshes).toBe(2)
      // Glass, liquid, foam or lemon, handle, base and rim plus the hand and its hull: far fewer draws than the old ring build.
      let meshes = 0
      drink.root.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes += 1 })
      expect(meshes).toBeLessThanOrEqual(kind === 'beer' ? 10 : 12)
      expect(drink.grip!.colors.sleeve.getHexString()).toBe('443322')
    }
    // Mirrored into a left hand.
    expect(drink.root.scale.x).toBeLessThan(0)
    // Hidden once the sip is over, and the pose never produces NaN.
    for (const elapsed of [0, 0.2, 0.45, 0.6, 0.9, 1.2, 1.45, 1.7, 1.89]) {
      updateFirstPersonDrink(drink, { ...input, elapsed })
      expect(Number.isFinite(drink.root.position.x + drink.root.position.y + drink.root.position.z)).toBe(true)
      expect(drink.grip!.hull.width.value).toBeGreaterThan(0)
    }
    updateFirstPersonDrink(drink, { ...input, elapsed: null })
    expect(drink.root.visible).toBe(false)
    disposeFirstPersonDrink(drink)
  })

  it('keeps the held glass clear of the left screen edge and the HUD drink buttons', async () => {
    const { createFirstPersonDrink, updateFirstPersonDrink, disposeFirstPersonDrink } = await import('@/components/three/firstPersonDrink')
    for (const [width, height] of [[1280, 720], [1440, 900]] as const) {
      const camera = new THREE.PerspectiveCamera(50, width / height)
      camera.updateProjectionMatrix()
      const drink = createFirstPersonDrink(camera)
      updateFirstPersonDrink(drink, { elapsed: 0.6, kind: 'beer', skinColor: '#c68642', sleeveColor: '#443322', drunkLevel: 0, time: 1, reducedMotion: true, renderHeight: height })
      const rim = new THREE.Vector3().copy(drink.root.position).applyMatrix4(camera.projectionMatrix)
      // Rim in normalised device coordinates: well inside the left edge and above the bottom HUD row.
      expect(rim.x).toBeGreaterThan(-0.7)
      expect(rim.y).toBeGreaterThan(-0.75)
      disposeFirstPersonDrink(drink)
    }
  })
})
