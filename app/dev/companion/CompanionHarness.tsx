'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  createCompanion,
  disposeCompanion,
  getCompanionBubbleAnchor,
  getCompanionLine,
  triggerCompanionGesture,
  updateCompanion,
  type CompanionGesture,
  type CompanionState,
} from '@/components/three/companion3D'
import { applyEnvironmentLighting, createPostFx, createStageLights } from '@/components/three/sceneLighting'
import { DESKTOP_CAMERA_FRAMING } from '@/components/three/cameraFraming'
import {
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_SEAT_POSITIONS,
  TABLE_SEAT_SCALES,
  type TableVisualSeat,
} from '@/components/three/tableWagerLayout'

type View = 'closeup' | 'turntable' | 'table' | 'face'

interface HarnessApi {
  setState: (mood: 'arrive' | 'flirt' | 'cheer' | 'sulk_leave' | null, reason?: 'big_win' | 'streak') => void
  newCompanion: (reason?: 'big_win' | 'streak') => void
  gesture: (name: CompanionGesture) => void
  step: (seconds: number) => void
  pause: (paused: boolean) => void
  view: (view: View, angle?: number) => void
  seat: (seat: number) => void
  hero: (isHero: boolean) => void
  fold: (folded: boolean) => void
  line: () => string | null
}

declare global {
  interface Window {
    __lady?: HarnessApi
  }
}

const GESTURES: CompanionGesture[] = ['wink', 'blowKiss', 'hairFlip', 'lean', 'fan', 'chaChing', 'cheekKiss', 'cheer', 'eyeRoll']

function toonMaterial(color: string) {
  const ramp = new THREE.DataTexture(new Uint8Array([80, 150, 210, 255]), 4, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp })
}

/** A stand-in seated player + chair in seat-root space (faces -Z). */
function createPlaceholderSeat(color: string) {
  const root = new THREE.Group()
  const chairMaterial = toonMaterial('#3a1f1a')
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.7), chairMaterial)
  seat.position.set(0, 0.62, 0.05)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.12), chairMaterial)
  back.position.set(0, 1.15, 0.5)
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 6, 14), toonMaterial(color))
  body.position.set(0, 1.1, -0.05)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), toonMaterial('#d9a07c'))
  head.position.set(0, 1.6, -0.15)
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.6), toonMaterial('#1c2230'))
  legs.position.set(0, 0.74, -0.3)
  for (const mesh of [seat, back, body, head, legs]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
  return root
}

export default function CompanionHarness() {
  const mountRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('booting')
  const apiRef = useRef<HarnessApi | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#120c14')
    scene.fog = new THREE.Fog('#120c14', 16, 34)
    const environment = applyEnvironmentLighting(renderer, scene)
    createStageLights(scene)

    const camera = new THREE.PerspectiveCamera(DESKTOP_CAMERA_FRAMING.fov, 1, 0.1, 60)
    const postFx = createPostFx(renderer, scene, camera)

    const floor = new THREE.Mesh(new THREE.CircleGeometry(20, 48), new THREE.MeshStandardMaterial({ color: '#2a1a16', roughness: 0.8 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.08
    floor.receiveShadow = true
    scene.add(floor)

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: '#0f6b45', roughness: 0.9 })
    )
    table.scale.set(TABLE_FELT_SEMI_AXIS_X, 1, TABLE_FELT_SEMI_AXIS_Z)
    table.position.y = 0.92
    table.receiveShadow = true
    scene.add(table)
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 12, 96),
      new THREE.MeshStandardMaterial({ color: '#3b2216', roughness: 0.5 })
    )
    rail.rotation.x = Math.PI / 2
    rail.scale.set(TABLE_FELT_SEMI_AXIS_X, TABLE_FELT_SEMI_AXIS_Z, 1)
    rail.position.y = 1.07
    scene.add(rail)

    const seatColors = ['#2b4a7a', '#7a2b3c', '#2f6b4f', '#6b4f2f', '#4b2f6b', '#2f5f6b', '#6b2f2f', '#34406b']
    const seatRoots = ([0, 1, 2, 3, 4, 5, 6, 7] as TableVisualSeat[]).map(visualSeat => {
      const root = createPlaceholderSeat(seatColors[visualSeat]!)
      const position = TABLE_SEAT_POSITIONS[visualSeat]
      root.position.set(position[0], position[1], position[2])
      root.scale.setScalar(TABLE_SEAT_SCALES[visualSeat])
      root.rotation.y = Math.atan2(position[0], position[2])
      scene.add(root)
      return root
    })

    const companion = createCompanion(scene)
    let state: CompanionState = null
    let ownerSeat = 4
    let ownerIsHero = false
    let ownerFolded = false
    let view: View = 'closeup'
    let orbitAngle = 0.35
    let paused = false
    let time = 0
    let serverNow = 1_000
    let counter = 0

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setSize(width, height)
      postFx.setSize(width, height, renderer.getPixelRatio())
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    const placeCamera = (delta: number) => {
      seatRoots.forEach((root, index) => {
        root.visible = !(ownerIsHero && index === 0)
      })
      if (view === 'table' || ownerIsHero) {
        camera.fov = DESKTOP_CAMERA_FRAMING.fov
        camera.position.set(...DESKTOP_CAMERA_FRAMING.position)
        camera.lookAt(new THREE.Vector3(...DESKTOP_CAMERA_FRAMING.lookAt))
        camera.updateProjectionMatrix()
        return
      }
      if (view === 'turntable') orbitAngle += delta * 0.5
      const focus = companion.group.visible ? companion.group.position.clone() : seatRoots[ownerSeat]!.position.clone()
      const scale = companion.group.visible ? companion.group.scale.x : 1
      const isFace = view === 'face'
      const height = (isFace ? 2.12 : 1.35) * scale
      const distance = (isFace ? 1.3 : 4.2) * scale
      camera.fov = isFace ? 30 : 35
      camera.updateProjectionMatrix()
      const yaw = companion.group.rotation.y + orbitAngle
      camera.position.set(focus.x + Math.sin(yaw) * distance, focus.y + height + (isFace ? 0.05 : 0.35), focus.z + Math.cos(yaw) * distance)
      camera.lookAt(focus.x, focus.y + height, focus.z)
    }

    const tick = (delta: number) => {
      time += delta
      placeCamera(delta)
      camera.updateMatrixWorld()
      updateCompanion(companion, {
        time,
        delta,
        reducedMotion: false,
        state,
        ownerSeat: seatRoots[ownerIsHero ? 0 : ownerSeat] ?? null,
        ownerIsHero,
        camera,
        ownerFolded,
      })
      placeCamera(0)
      postFx.composer.render()
      const bubble = bubbleRef.current
      if (bubble) {
        const line = getCompanionLine(companion)
        const anchor = new THREE.Vector3()
        if (line && getCompanionBubbleAnchor(companion, anchor)) {
          const ndc = anchor.project(camera)
          bubble.style.display = 'block'
          bubble.textContent = line
          bubble.style.left = `${((ndc.x + 1) / 2) * mount.clientWidth}px`
          bubble.style.top = `${((1 - ndc.y) / 2) * mount.clientHeight}px`
        } else {
          bubble.style.display = 'none'
        }
      }
    }

    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!paused) tick(delta)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    const api: HarnessApi = {
      setState(mood, reason = 'streak') {
        serverNow += 1000
        if (mood === null) {
          state = null
          return
        }
        if (!state) {
          counter += 1
          state = { id: `dev-${counter}`, ownerId: `seat-${ownerSeat}`, reason, streak: 2, mood, since: serverNow }
          return
        }
        state = { ...state, mood, reason, since: serverNow, streak: mood === 'cheer' ? state.streak + 1 : state.streak }
      },
      newCompanion(reason = 'streak') {
        counter += 1
        serverNow += 1000
        state = { id: `dev-${counter}`, ownerId: `seat-${ownerSeat}`, reason, streak: 2, mood: 'arrive', since: serverNow }
      },
      gesture(name) {
        triggerCompanionGesture(companion, name)
      },
      step(seconds) {
        const steps = Math.max(1, Math.round(seconds * 60))
        for (let index = 0; index < steps; index += 1) tick(1 / 60)
      },
      pause(next) {
        paused = next
        last = performance.now()
      },
      view(next, angle) {
        view = next
        if (typeof angle === 'number') orbitAngle = angle
      },
      seat(next) {
        ownerSeat = Math.max(0, Math.min(7, Math.round(next)))
      },
      hero(next) {
        ownerIsHero = next
      },
      fold(next) {
        ownerFolded = next
      },
      line() {
        return getCompanionLine(companion)
      },
    }
    apiRef.current = api
    window.__lady = api
    setStatus('ready')

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      delete window.__lady
      disposeCompanion(companion)
      postFx.dispose()
      environment.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const button = (label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        background: '#2a1830',
        color: '#ffe9f6',
        border: '1px solid #6d3d7a',
        borderRadius: 8,
        padding: '6px 10px',
        font: '600 12px system-ui',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#120c14' }}>
      <div ref={mountRef} data-status={status} className="lady-harness-canvas" style={{ position: 'absolute', inset: 0 }} />
      <div
        ref={bubbleRef}
        style={{
          position: 'absolute',
          display: 'none',
          transform: 'translate(-50%, -100%)',
          background: '#fff4fb',
          color: '#3b0f2c',
          borderRadius: 14,
          padding: '6px 12px',
          font: '700 14px system-ui',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      />
      <div
        className="lady-harness-controls"
        style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 560 }}
      >
        {button('Arrive (streak)', () => apiRef.current?.newCompanion('streak'))}
        {button('Arrive (big win)', () => apiRef.current?.newCompanion('big_win'))}
        {button('Flirt', () => apiRef.current?.setState('flirt'))}
        {button('Cheer', () => apiRef.current?.setState('cheer'))}
        {button('Sulk leave', () => apiRef.current?.setState('sulk_leave'))}
        {button('Clear', () => apiRef.current?.setState(null))}
        {button('Switch seat', () => {
          const api = apiRef.current
          if (!api) return
          api.seat(Math.floor(Math.random() * 7) + 1)
          api.newCompanion('big_win')
        })}
        {button('Fold', () => apiRef.current?.fold(true))}
        {button('Unfold', () => apiRef.current?.fold(false))}
        {GESTURES.map(name => button(name, () => apiRef.current?.gesture(name)))}
        {button('Close-up', () => apiRef.current?.view('closeup'))}
        {button('Face', () => apiRef.current?.view('face', 0))}
        {button('Turntable', () => apiRef.current?.view('turntable'))}
        {button('Table view', () => apiRef.current?.view('table'))}
        {button('Hero on', () => apiRef.current?.hero(true))}
        {button('Hero off', () => apiRef.current?.hero(false))}
      </div>
    </div>
  )
}
