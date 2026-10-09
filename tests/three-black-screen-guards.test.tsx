import React, { act } from 'react'
import { create } from 'react-test-renderer'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateThreeFallback,
  clearThreeFallback,
  createRenderFailureTracker,
  getThreeFallback,
  isWebGLUnavailableError,
  resetThreeFallbackForTests,
  subscribeThreeFallback,
} from '@/components/three/threeFallback'
import { ThreeErrorBoundary } from '@/components/three/ThreeErrorBoundary'
import {
  ensureSafeCamera,
  getSafePixelRatio,
  getSafeViewportSize,
  isCameraUsable,
} from '@/components/three/cameraSafety'
import { disposeObject, getChipVisibility } from '@/components/three/DesktopPokerRoom3D'
import { FunFx, type FunSeat } from '@/components/three/funFx'
import type { ThreeTableViewModel } from '@/components/three/tableViewModel'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

describe('render failure tracker', () => {
  it('rebuilds after one or two failures and falls back on the third inside the window', () => {
    const tracker = createRenderFailureTracker({ limit: 3, windowMs: 60_000 })
    expect(tracker.record(0)).toBe(false)
    expect(tracker.record(10_000)).toBe(false)
    expect(tracker.record(20_000)).toBe(true)
  })

  it('forgets failures older than the window (one bad night does not doom the next hour)', () => {
    const tracker = createRenderFailureTracker({ limit: 3, windowMs: 60_000 })
    tracker.record(0)
    tracker.record(1_000)
    expect(tracker.record(120_000)).toBe(false)
    expect(tracker.count(120_000)).toBe(1)
  })

  it('treats a missing WebGL context as unrecoverable and other start errors as transient', () => {
    expect(isWebGLUnavailableError(new Error('Error creating WebGL context.'))).toBe(true)
    expect(isWebGLUnavailableError(new Error('THREE.WebGLRenderer: WebGL 1 is not supported since r163.'))).toBe(true)
    expect(isWebGLUnavailableError(new Error('Cannot read properties of undefined (reading "bones")'))).toBe(false)
  })
})

describe('2D fallback switch', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('window', { sessionStorage: storage })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    resetThreeFallbackForTests()
  })

  afterEach(() => {
    resetThreeFallbackForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('switches once, notifies listeners, survives a reload of the module state, and clears', () => {
    const listener = vi.fn()
    subscribeThreeFallback(listener)
    expect(getThreeFallback()).toBeNull()

    activateThreeFallback('context-lost')
    activateThreeFallback('black-frame')
    expect(getThreeFallback()?.reason).toBe('context-lost')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.values.size).toBe(1)

    // A page reload starts with empty module state but the same tab storage.
    resetThreeFallbackForTests()
    expect(getThreeFallback()?.reason).toBe('context-lost')

    clearThreeFallback()
    expect(getThreeFallback()).toBeNull()
    expect(storage.values.size).toBe(0)
  })

  it('ignores garbage in storage instead of trapping the tab in 2D', () => {
    storage.setItem('poker-night:3d-fallback', '{"reason":"nope"}')
    expect(getThreeFallback()).toBeNull()
  })

  it('an error boundary around the 3D view renders nothing and switches to 2D instead of blanking the page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Exploding(): React.ReactElement {
      throw new Error('bone lookup failed')
    }
    let renderer: ReturnType<typeof create> | undefined
    act(() => {
      renderer = create(
        <div>
          <ThreeErrorBoundary>
            <Exploding />
          </ThreeErrorBoundary>
          <span>2D table</span>
        </div>
      )
    })
    expect(JSON.stringify(renderer!.toJSON())).toContain('2D table')
    expect(getThreeFallback()?.reason).toBe('render-error')
    act(() => renderer!.unmount())
  })
})

describe('camera safety', () => {
  const safe = { position: { x: 0, y: 2, z: 6 }, lookAt: { x: 0, y: 1, z: 0 }, fov: 55 }

  it('leaves a healthy seat camera alone', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 60)
    camera.position.set(0.01, 2, 6)
    const lookAt = new THREE.Vector3(0, 1, 0)
    camera.lookAt(lookAt)
    expect(ensureSafeCamera(camera, lookAt, safe)).toBe(false)
    expect(camera.position.x).toBeCloseTo(0.01)
  })

  it('puts a NaN camera (a seat lookup for someone who just left) back on the seat', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 60)
    const lookAt = new THREE.Vector3(Number.NaN, 1, 0)
    camera.position.set(Number.NaN, 2, 6)
    expect(isCameraUsable(camera)).toBe(false)
    expect(ensureSafeCamera(camera, lookAt, safe)).toBe(true)
    expect(isCameraUsable(camera)).toBe(true)
    expect(camera.position.toArray()).toEqual([0, 2, 6])
    expect(lookAt.toArray()).toEqual([0, 1, 0])
  })

  it('resets a NaN lens and a camera that wandered into the walls', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 60)
    const lookAt = new THREE.Vector3(0, 1, 0)
    camera.fov = Number.NaN
    expect(ensureSafeCamera(camera, lookAt, safe)).toBe(true)
    expect(camera.fov).toBe(55)
    camera.position.set(40, 2, 6)
    expect(ensureSafeCamera(camera, lookAt, safe)).toBe(true)
    expect(camera.position.x).toBe(0)
  })

  it('never sizes the canvas to 0 and caps the pixel ratio', () => {
    expect(getSafeViewportSize(0, 0, { width: 1440, height: 900 })).toEqual({ width: 1440, height: 900 })
    expect(getSafeViewportSize(Number.NaN, 800, null)).toBeNull()
    expect(getSafeViewportSize(1280, 720, null)).toEqual({ width: 1280, height: 720 })
    expect(getSafePixelRatio(3, 1280 * 720, false)).toBe(1.5)
    expect(getSafePixelRatio(2, 2560 * 1440, false)).toBe(1.15)
    expect(getSafePixelRatio(Number.NaN, 1280 * 720, false)).toBe(1)
    expect(getSafePixelRatio(0.5, 1280 * 720, true)).toBe(0.75)
  })
})

describe('GPU resources as players come and go', () => {
  it('per-object disposal frees a seat’s own resources but never the shared chip/card geometry or cached textures', () => {
    const sharedGeometry = new THREE.BoxGeometry()
    sharedGeometry.userData.shared = true
    const sharedTexture = new THREE.Texture()
    sharedTexture.userData.shared = true
    const ownGeometry = new THREE.BoxGeometry()
    const ownTexture = new THREE.Texture()
    const ownMaterial = new THREE.MeshStandardMaterial({ map: ownTexture })
    const sharedMapMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture })
    const disposed = new Set<unknown>()
    for (const item of [sharedGeometry, sharedTexture, ownGeometry, ownTexture, ownMaterial, sharedMapMaterial]) {
      item.addEventListener('dispose', () => disposed.add(item))
    }
    const seat = new THREE.Group()
    seat.add(new THREE.Mesh(sharedGeometry, ownMaterial))
    seat.add(new THREE.Mesh(ownGeometry, sharedMapMaterial))

    disposeObject(seat)

    expect(disposed.has(ownGeometry)).toBe(true)
    expect(disposed.has(ownTexture)).toBe(true)
    expect(disposed.has(ownMaterial)).toBe(true)
    expect(disposed.has(sharedMapMaterial)).toBe(true)
    expect(disposed.has(sharedGeometry)).toBe(false)
    expect(disposed.has(sharedTexture)).toBe(false)
  })

  it('tells a removed seat’s chips (or an old, rebuilt scene’s) apart from hidden ones so they can be dropped', () => {
    const scene = new THREE.Scene()
    const stack = new THREE.Group()
    const chip = new THREE.Mesh()
    stack.add(chip)
    scene.add(stack)
    expect(getChipVisibility(chip, scene)).toBe(1)
    chip.visible = false
    expect(getChipVisibility(chip, scene)).toBe(0)
    stack.removeFromParent()
    expect(getChipVisibility(chip, scene)).toBe(-1)
    const rebuiltScene = new THREE.Scene()
    scene.add(stack)
    expect(getChipVisibility(chip, rebuiltScene)).toBe(-1)
  })

  it('fun effects free each seat’s props when players leave (no growth over many joins)', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    })
    try {
      const scene = new THREE.Scene()
      const fx = new FunFx({
        scene,
        camera: new THREE.PerspectiveCamera(),
        postFx: null,
        feltMaterial: null,
        lights: [],
        chipMaterials: [],
        companionGroup: null,
      })
      fx.reducedMotion = true
      const baseline = fx.getResourceCounts()
      const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')

      let time = 0
      for (let round = 0; round < 40; round += 1) {
        // A fresh table of six hungover guests every round: everyone before them left.
        const players = Array.from({ length: 6 }, (_, index) => ({
          id: `p${round}-${index}`,
          isHero: false,
          drinks: { passedOut: false, hungover: true, tripping: false },
        }))
        const seats = new Map<string, FunSeat>(players.map(player => {
          const root = new THREE.Group()
          const head = new THREE.Group()
          root.add(head)
          scene.add(root)
          return [player.id, { playerId: player.id, root, head, avatar: null, face: null, anchors: { drinkRest: [0, 0, 0] } }]
        }))
        const view = { players } as unknown as ThreeTableViewModel
        time += 0.5
        fx.update(view, seats, time)
        fx.afterSeats(view, seats, time, 0.016)
      }

      const counts = fx.getResourceCounts()
      expect(counts.trackedSeats).toBe(6)
      // Only the six seated guests hold props; the 234 who left freed theirs.
      expect(counts.geometries).toBeLessThanOrEqual(baseline.geometries + 6)
      expect(counts.materials).toBeLessThanOrEqual(baseline.materials + 12)
      expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(39 * 6)
      fx.dispose()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
