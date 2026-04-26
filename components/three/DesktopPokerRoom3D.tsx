'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Clone, ContactShadows, RoundedBox, Text, useAnimations, useGLTF } from '@react-three/drei'
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Vector3, type Group } from 'three'
import {
  getHeroCardActionPose,
  getHeroChipActionPose,
  getHeroHandActionPose,
  getSeatedAvatarActionPose,
} from './pokerActionPose'
import {
  advanceActionPlaybackState,
  createActionPlaybackState,
  getActionPlaybackSnapshot,
  type ThreeActionPlaybackSnapshot,
} from './actionPlayback'
import type { ThreeActionCue, ThreePlayerView, ThreeTableViewModel } from './tableViewModel'
import { getAvatarHeadTurn, getTurnCameraPose } from './turnFocus'
import { getAvatarModelConfig, REALISTIC_AVATAR_MODEL_KEYS } from './avatarModelCatalog'

type Vec3 = [number, number, number]

interface DesktopPokerRoom3DProps {
  view: ThreeTableViewModel
}

const tableTopY = 1.02
const heroCardBasePosition: Vec3 = [-0.26, tableTopY + 0.105, 1.14]

REALISTIC_AVATAR_MODEL_KEYS.forEach(key => {
  useGLTF.preload(getAvatarModelConfig(key).path)
})

interface SeatLayout {
  position: Vec3
  rotation: number
  scale: number
}

const seat = (position: Vec3, scale = 1): SeatLayout => ({
  position,
  rotation: Math.atan2(position[0], position[2]),
  scale,
})

const seatLayout: Record<number, SeatLayout> = {
  0: seat([0, 0, 2.98], 0.78),
  1: seat([-2.54, 0, 1.34], 0.9),
  2: seat([-3.06, 0, -0.9], 0.97),
  3: seat([-1.78, 0, -2.62], 0.96),
  4: seat([0, 0, -2.94], 0.94),
  5: seat([1.78, 0, -2.62], 0.96),
  6: seat([3.06, 0, -0.9], 0.97),
  7: seat([2.54, 0, 1.34], 0.9),
}

export function DesktopPokerRoom3D({ view }: DesktopPokerRoom3DProps) {
  return (
    <div className="desktop-3d-stage" aria-hidden="true">
      <Canvas
        className="desktop-3d-canvas"
        shadows
        camera={{ position: [0, 3.58, 5.72], fov: 42, near: 0.1, far: 80 }}
        dpr={[1, 1.65]}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      >
        <PokerRoomScene view={view} />
      </Canvas>
    </div>
  )
}

function PokerRoomScene({ view }: { view: ThreeTableViewModel }) {
  return (
    <>
      <CameraRig actingVisualSeat={view.actingVisualSeat} />
      <color attach="background" args={['#211816']} />
      <fog attach="fog" args={['#211816', 11.5, 27]} />
      <ambientLight intensity={0.96} />
      <hemisphereLight color="#fff0c8" groundColor="#241916" intensity={1.05} />
      <directionalLight position={[-2.8, 5.6, 4.9]} intensity={1.8} color="#ffe0a5" />
      <spotLight
        castShadow
        position={[0, 7.6, 2.05]}
        angle={0.7}
        penumbra={0.84}
        intensity={48}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00008}
      />
      <spotLight position={[0, 4.7, -3.35]} angle={0.76} penumbra={0.8} intensity={10.4} color="#7bd2bc" />
      <pointLight position={[-4.1, 2.95, 2.9]} intensity={7.1} color="#f3b56d" />
      <pointLight position={[4.1, 2.95, -2.65]} intensity={5.5} color="#d8c68f" />
      <pointLight position={[0, 2.35, 3.55]} intensity={6.2} color="#ffd28a" />
      <pointLight position={[0, 2.45, -3.7]} intensity={3.5} color="#88d2c5" />
      <Room />
      <PokerTableModel />
      <DealerChipArea pot={view.pot} currentBet={view.currentBet} />
      <HeroActionProps view={view} />
      {view.players.map(player => (
        <PlayerStation key={player.id} player={player} actingVisualSeat={view.actingVisualSeat} />
      ))}
      <ContactShadows opacity={0.55} scale={9.4} blur={2.8} far={5.2} resolution={1024} color="#000000" />
    </>
  )
}

function CameraRig({ actingVisualSeat }: { actingVisualSeat: number | null }) {
  const { camera } = useThree()
  const pose = useMemo(() => getTurnCameraPose(actingVisualSeat), [actingVisualSeat])
  const targetPosition = useMemo(() => new Vector3(...pose.position), [pose])
  const targetLookAt = useMemo(() => new Vector3(...pose.lookAt), [pose])
  const lookAtRef = useRef(new Vector3(...pose.lookAt))

  useLayoutEffect(() => {
    camera.position.set(...pose.position)
    lookAtRef.current.set(...pose.lookAt)
    camera.lookAt(lookAtRef.current)
    camera.updateProjectionMatrix()
  }, [camera])

  useFrame((_, delta) => {
    const followStrength = 1 - Math.exp(-delta * 2.8)

    camera.position.lerp(targetPosition, followStrength)
    lookAtRef.current.lerp(targetLookAt, followStrength)
    camera.lookAt(lookAtRef.current)
  })

  return null
}

function Room() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[11.6, 10.4]} />
        <meshStandardMaterial color="#35251f" roughness={0.82} metalness={0.04} />
      </mesh>
      <CarpetPattern />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0.1]} scale={[1.15, 0.86, 1]}>
        <ringGeometry args={[2.72, 2.92, 160]} />
        <meshStandardMaterial color="#6d442b" roughness={0.66} metalness={0.16} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0.1]} scale={[1.05, 0.78, 1]}>
        <ringGeometry args={[2.88, 2.9, 160]} />
        <meshStandardMaterial color="#e0b969" roughness={0.28} metalness={0.62} />
      </mesh>
      <mesh receiveShadow position={[0, 2.1, -4.35]}>
        <boxGeometry args={[11, 4.2, 0.16]} />
        <meshStandardMaterial color="#3c302d" roughness={0.68} metalness={0.04} />
      </mesh>
      <mesh receiveShadow position={[-5.45, 2.1, 0]}>
        <boxGeometry args={[0.16, 4.2, 9]} />
        <meshStandardMaterial color="#302827" roughness={0.75} metalness={0.03} />
      </mesh>
      <mesh receiveShadow position={[5.45, 2.1, 0]}>
        <boxGeometry args={[0.16, 4.2, 9]} />
        <meshStandardMaterial color="#302827" roughness={0.75} metalness={0.03} />
      </mesh>
      <RoomTrim />
      <CeilingCanopy />
      <mesh position={[0, 3.95, 0.1]}>
        <boxGeometry args={[3.9, 0.08, 2.55]} />
        <meshStandardMaterial color="#8a5c36" emissive="#6c3f18" emissiveIntensity={0.82} roughness={0.34} metalness={0.14} />
      </mesh>
      <mesh position={[0, 3.88, 0.1]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 0.92, 1]}>
        <ringGeometry args={[0.82, 0.86, 96]} />
        <meshStandardMaterial color="#f0d591" emissive="#d89b3a" emissiveIntensity={0.52} roughness={0.22} metalness={0.58} />
      </mesh>
      {[-3.4, 3.4].map(x => (
        <group key={x} position={[x, 2.45, -4.22]}>
          <mesh>
            <boxGeometry args={[0.18, 0.92, 0.05]} />
            <meshStandardMaterial color="#5a3a28" roughness={0.4} metalness={0.16} />
          </mesh>
          <pointLight position={[0, -0.18, 0.18]} intensity={0.85} color="#e0aa68" distance={2.6} />
        </group>
      ))}
      <BackBar />
      <SideTable position={[-4.42, 0.02, 1.9]} rotation={0.42} />
      <SideTable position={[4.42, 0.02, 1.9]} rotation={-0.42} />
      {[-2.2, 0, 2.2].map(x => (
        <group key={`wall-panel-${x}`} position={[x, 2.1, -4.255]}>
          <mesh receiveShadow>
            <boxGeometry args={[1.08, 1.76, 0.035]} />
            <meshStandardMaterial color="#342622" roughness={0.7} metalness={0.06} />
          </mesh>
          <mesh position={[0, 0.93, 0.022]}>
            <boxGeometry args={[0.9, 0.035, 0.03]} />
            <meshStandardMaterial color="#9d7242" roughness={0.34} metalness={0.35} />
          </mesh>
        </group>
      ))}
      {[-4.25, -1.35, 1.35, 4.25].map(x => (
        <WallSconce key={`sconce-${x}`} position={[x, 2.76, -4.18]} />
      ))}
    </group>
  )
}

function CarpetPattern() {
  const longLines = [-4.4, -3.3, -2.2, -1.1, 1.1, 2.2, 3.3, 4.4]
  const crossLines = [-3.6, -2.4, -1.2, 1.2, 2.4, 3.6]

  return (
    <group>
      {longLines.map(x => (
        <mesh key={`floor-long-${x}`} receiveShadow position={[x, 0.025, 0.1]}>
          <boxGeometry args={[0.018, 0.012, 8.7]} />
          <meshStandardMaterial color="#49302a" roughness={0.9} metalness={0.02} transparent opacity={0.52} />
        </mesh>
      ))}
      {crossLines.map(z => (
        <mesh key={`floor-cross-${z}`} receiveShadow position={[0, 0.027, z]}>
          <boxGeometry args={[10.6, 0.012, 0.018]} />
          <meshStandardMaterial color="#1c5f55" roughness={0.86} metalness={0.02} transparent opacity={0.24} />
        </mesh>
      ))}
      {[-1, 1].map(x => (
        <mesh key={`floor-diamond-${x}`} position={[x * 3.78, 0.035, -1.55]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <ringGeometry args={[0.22, 0.235, 4]} />
          <meshStandardMaterial color="#b98548" roughness={0.38} metalness={0.46} />
        </mesh>
      ))}
    </group>
  )
}

function RoomTrim() {
  return (
    <group>
      <RoundedBox args={[10.7, 0.13, 0.16]} radius={0.025} smoothness={4} position={[0, 0.54, -4.21]} receiveShadow>
        <meshStandardMaterial color="#6a442b" roughness={0.42} metalness={0.18} />
      </RoundedBox>
      <RoundedBox args={[10.7, 0.09, 0.14]} radius={0.025} smoothness={4} position={[0, 3.62, -4.2]} receiveShadow>
        <meshStandardMaterial color="#8f633c" roughness={0.36} metalness={0.24} />
      </RoundedBox>
      {[-5.32, 5.32].map(x => (
        <RoundedBox
          key={`side-base-${x}`}
          args={[0.14, 0.13, 8.45]}
          radius={0.025}
          smoothness={4}
          position={[x, 0.54, 0]}
          receiveShadow
        >
          <meshStandardMaterial color="#5e3c28" roughness={0.46} metalness={0.18} />
        </RoundedBox>
      ))}
      {[-4.95, -2.48, 0, 2.48, 4.95].map(x => (
        <RoundedBox key={`wall-pilaster-${x}`} args={[0.16, 2.72, 0.09]} radius={0.03} smoothness={4} position={[x, 2.02, -4.17]}>
          <meshStandardMaterial color="#5b3c2b" roughness={0.52} metalness={0.12} />
        </RoundedBox>
      ))}
    </group>
  )
}

function CeilingCanopy() {
  return (
    <group position={[0, 3.72, 0.02]}>
      <RoundedBox args={[5.15, 0.08, 3.12]} radius={0.08} smoothness={6} castShadow>
        <meshStandardMaterial color="#2a201b" roughness={0.48} metalness={0.18} />
      </RoundedBox>
      <RoundedBox args={[4.34, 0.05, 2.42]} radius={0.08} smoothness={6} position={[0, -0.055, 0]}>
        <meshStandardMaterial color="#725135" emissive="#3d2514" emissiveIntensity={0.3} roughness={0.34} metalness={0.28} />
      </RoundedBox>
      {[0, Math.PI / 2].map(rotation => (
        <mesh key={`ceiling-inlay-${rotation}`} position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, rotation]} scale={[1.9, 1.08, 1]}>
          <ringGeometry args={[0.78, 0.8, 96]} />
          <meshStandardMaterial color="#edce84" emissive="#9a6429" emissiveIntensity={0.28} roughness={0.24} metalness={0.68} />
        </mesh>
      ))}
      {[-1.72, 1.72].map(x => (
        <group key={`ceiling-lantern-${x}`} position={[x, -0.24, 0.12]}>
          <mesh>
            <cylinderGeometry args={[0.16, 0.2, 0.16, 28]} />
            <meshStandardMaterial color="#f1d49a" emissive="#d39b4b" emissiveIntensity={0.68} roughness={0.24} metalness={0.18} />
          </mesh>
          <pointLight position={[0, -0.18, 0]} intensity={1.1} color="#efc987" distance={2.4} />
        </group>
      ))}
    </group>
  )
}

function BackBar() {
  const bottles = [
    { x: -1.12, y: 0.52, color: '#6a1f36', height: 0.34 },
    { x: -0.84, y: 0.52, color: '#b47a31', height: 0.42 },
    { x: -0.52, y: 0.52, color: '#225d54', height: 0.38 },
    { x: 0.56, y: 0.52, color: '#54325d', height: 0.36 },
    { x: 0.9, y: 0.52, color: '#9a5d26', height: 0.44 },
    { x: 1.18, y: 0.52, color: '#1f4e68', height: 0.34 },
    { x: -0.98, y: 1.06, color: '#d2b16d', height: 0.3 },
    { x: -0.22, y: 1.06, color: '#7b2132', height: 0.38 },
    { x: 0.18, y: 1.06, color: '#2b6a58', height: 0.34 },
    { x: 0.96, y: 1.06, color: '#d6c5a0', height: 0.3 },
  ]

  return (
    <group position={[0, 1.18, -4.08]}>
      <RoundedBox args={[3.1, 0.72, 0.18]} radius={0.05} smoothness={5} position={[0, 0.04, 0]} receiveShadow>
        <meshStandardMaterial color="#211a18" roughness={0.54} metalness={0.12} />
      </RoundedBox>
      {[0.26, 0.8, 1.34].map(y => (
        <RoundedBox key={`bar-shelf-${y}`} args={[2.82, 0.065, 0.25]} radius={0.025} smoothness={4} position={[0, y, 0.08]}>
          <meshStandardMaterial color="#91643e" roughness={0.34} metalness={0.28} />
        </RoundedBox>
      ))}
      {bottles.map(bottle => (
        <group key={`${bottle.x}-${bottle.y}`} position={[bottle.x, bottle.y, 0.2]}>
          <mesh castShadow position={[0, bottle.height / 2, 0]}>
            <cylinderGeometry args={[0.055, 0.072, bottle.height, 18]} />
            <meshStandardMaterial color={bottle.color} roughness={0.2} metalness={0.18} transparent opacity={0.82} />
          </mesh>
          <mesh castShadow position={[0, bottle.height + 0.05, 0]}>
            <cylinderGeometry args={[0.028, 0.035, 0.1, 14]} />
            <meshStandardMaterial color="#d7b56f" roughness={0.28} metalness={0.5} />
          </mesh>
        </group>
      ))}
      <pointLight position={[0, 1.34, 0.4]} intensity={1.3} color="#81d0bb" distance={3.1} />
    </group>
  )
}

function WallSconce({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.18, 0.52, 0.08]} radius={0.035} smoothness={4} castShadow>
        <meshStandardMaterial color="#8e633b" roughness={0.28} metalness={0.5} />
      </RoundedBox>
      <mesh position={[0, -0.08, 0.12]} scale={[0.74, 1, 0.5]}>
        <sphereGeometry args={[0.2, 24, 12]} />
        <meshStandardMaterial color="#f5d99a" emissive="#e2a84f" emissiveIntensity={0.58} roughness={0.22} />
      </mesh>
      <pointLight position={[0, -0.14, 0.32]} intensity={1.45} color="#f3c47a" distance={2.2} />
    </group>
  )
}

function SideTable({ position, rotation }: { position: Vec3; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.42, 0]} scale={[0.62, 1, 0.46]}>
        <cylinderGeometry args={[1, 1, 0.08, 48]} />
        <meshStandardMaterial color="#3b2b22" roughness={0.42} metalness={0.16} />
      </mesh>
      <mesh castShadow position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.055, 0.08, 0.42, 16]} />
        <meshStandardMaterial color="#8f633c" roughness={0.32} metalness={0.44} />
      </mesh>
      <mesh castShadow position={[0.16, 0.5, -0.08]}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 22]} />
        <meshStandardMaterial color="#f3eee0" roughness={0.34} metalness={0.04} />
      </mesh>
      <pointLight position={[0, 0.9, 0.1]} intensity={0.45} color="#f3c47a" distance={1.5} />
    </group>
  )
}

function PokerTableModel() {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.84, 0]} scale={[3.28, 1, 2.02]}>
        <cylinderGeometry args={[1, 1, 0.22, 96]} />
        <meshStandardMaterial color="#533423" roughness={0.32} metalness={0.3} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, tableTopY - 0.02, 0]} scale={[3.1, 1, 1.8]}>
        <cylinderGeometry args={[1, 1, 0.12, 128]} />
        <meshStandardMaterial color="#d08a45" roughness={0.2} metalness={0.42} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, tableTopY + 0.05, 0]} scale={[2.72, 1, 1.56]}>
        <cylinderGeometry args={[1, 1, 0.055, 96]} />
        <meshStandardMaterial color="#159268" roughness={0.78} metalness={0.02} />
      </mesh>
      <mesh
        castShadow
        receiveShadow
        position={[0, tableTopY + 0.095, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[3.04, 1.74, 1]}
      >
        <torusGeometry args={[1, 0.045, 14, 128]} />
        <meshStandardMaterial color="#211613" roughness={0.34} metalness={0.28} />
      </mesh>
      <mesh position={[0, tableTopY + 0.084, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.68, 1.54, 1]}>
        <ringGeometry args={[0.96, 1, 128]} />
        <meshStandardMaterial color="#e2bd72" emissive="#6e4317" emissiveIntensity={0.12} roughness={0.2} metalness={0.72} />
      </mesh>
      <mesh position={[0, tableTopY + 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.24, 1.28, 1]}>
        <ringGeometry args={[0.52, 0.54, 128]} />
        <meshStandardMaterial color="#11604d" roughness={0.84} metalness={0.08} />
      </mesh>
      <mesh position={[0, tableTopY + 0.094, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.78, 0.98, 1]}>
        <ringGeometry args={[0.68, 0.69, 128]} />
        <meshStandardMaterial color="#4dc38c" emissive="#14543d" emissiveIntensity={0.18} roughness={0.7} metalness={0.04} />
      </mesh>
      <mesh castShadow position={[0, 0.46, 0]}>
        <cylinderGeometry args={[0.42, 0.58, 0.86, 32]} />
        <meshStandardMaterial color="#31211b" roughness={0.48} metalness={0.14} />
      </mesh>
      <TableLegs />
      <TableDetails />
      <FeltDetails />
    </group>
  )
}

function TableLegs() {
  const legs = [
    [-1.65, -0.72],
    [1.65, -0.72],
    [-1.65, 0.72],
    [1.65, 0.72],
  ] as const

  return (
    <group>
      {legs.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0.44, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.09, 0.13, 0.72, 18]} />
            <meshStandardMaterial color="#251812" roughness={0.42} metalness={0.22} />
          </mesh>
          <mesh castShadow position={[0, -0.39, 0]} scale={[1.25, 0.36, 0.86]}>
            <cylinderGeometry args={[0.12, 0.14, 0.08, 20]} />
            <meshStandardMaterial color="#7c5733" roughness={0.3} metalness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function TableDetails() {
  return (
    <group>
      <mesh position={[0, tableTopY + 0.121, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.24, 1.28, 1]}>
        <ringGeometry args={[0.88, 0.895, 160]} />
        <meshStandardMaterial
          color="#efc778"
          emissive="#5a3513"
          emissiveIntensity={0.06}
          roughness={0.22}
          metalness={0.7}
          transparent
          opacity={0.62}
        />
      </mesh>
    </group>
  )
}

function FeltDetails() {
  const feltThreads = [-1.32, 0, 1.32]

  return (
    <group>
      {feltThreads.map(x => (
        <mesh key={`felt-thread-x-${x}`} position={[x, tableTopY + 0.137, -0.08]}>
          <boxGeometry args={[0.012, 0.008, 2.08]} />
          <meshStandardMaterial color="#7ed1aa" roughness={0.9} transparent opacity={0.12} />
        </mesh>
      ))}
      {[-0.55, 0.55].map(z => (
        <mesh key={`felt-thread-z-${z}`} position={[0, tableTopY + 0.139, z]}>
          <boxGeometry args={[2.78, 0.008, 0.01]} />
          <meshStandardMaterial color="#0b6a53" roughness={0.9} transparent opacity={0.14} />
        </mesh>
      ))}

      <mesh position={[0, tableTopY + 0.165, 0.42]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.88, 0.38, 1]}>
        <ringGeometry args={[0.42, 0.435, 96]} />
        <meshStandardMaterial
          color="#e7c174"
          emissive="#5a3513"
          emissiveIntensity={0.06}
          roughness={0.24}
          metalness={0.66}
          transparent
          opacity={0.36}
        />
      </mesh>
    </group>
  )
}

function DealerChipArea({ pot, currentBet }: { pot: number; currentBet: number }) {
  const visibleChipCount = Math.min(5, getChipCount(Math.max(pot, currentBet)))

  if (visibleChipCount === 0) {
    return null
  }

  return (
    <group position={[0, tableTopY + 0.088, -0.24]}>
      <ChipStack position={[0, 0.06, 0]} colors={['#d9b56d', '#151515']} count={visibleChipCount} />
    </group>
  )
}

function HeroActionProps({ view }: { view: ThreeTableViewModel }) {
  const getPlayback = useActionPlayback(view.actionKey, view.actionCue)

  return (
    <group>
      <HeroSeatPresence hero={view.hero} />
      <HeroHand
        position={[-1.08, tableTopY + 0.14, 1.43]}
        side="left"
        getPlayback={getPlayback}
      />
      <HeroHand
        position={[1.2, tableTopY + 0.14, 1.43]}
        side="right"
        getPlayback={getPlayback}
      />
      <HeroChips betAmount={view.hero?.bet ?? 0} getPlayback={getPlayback} />
      <AnimatedFoldCards getPlayback={getPlayback} />
    </group>
  )
}

function HeroSeatPresence({ hero }: { hero: ThreePlayerView | null }) {
  const accentColor = hero?.isActing ? '#d9b56d' : hero?.accentColor ?? '#151820'
  const stackLabel = hero ? `$${hero.stack.toLocaleString()}` : '$0'

  return (
    <group>
      <group position={[0, 0.57, 2.62]}>
        <RoundedBox args={[1.12, 0.36, 0.54]} radius={0.12} smoothness={6} position={[0, 0.15, 0.04]} castShadow>
          <meshStandardMaterial color={accentColor} roughness={0.58} metalness={0.08} />
        </RoundedBox>
        <RoundedBox args={[1.36, 0.2, 0.38]} radius={0.11} smoothness={6} position={[0, 0.28, -0.08]} castShadow>
          <meshStandardMaterial color="#22201d" roughness={0.62} metalness={0.04} />
        </RoundedBox>
        <RoundedBox args={[0.86, 0.035, 0.07]} radius={0.018} smoothness={4} position={[0, 0.49, -0.29]} castShadow>
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={hero?.isActing ? 0.28 : 0.12}
            roughness={0.36}
            metalness={0.18}
          />
        </RoundedBox>
      </group>

      <group position={[0, tableTopY + 0.123, 1.84]}>
        <RoundedBox args={[1.48, 0.046, 0.28]} radius={0.05} smoothness={6} castShadow receiveShadow>
          <meshStandardMaterial
            color={hero?.isActing ? '#332812' : '#171615'}
            roughness={0.42}
            metalness={0.12}
          />
        </RoundedBox>
        <Text
          position={[-0.38, 0.04, -0.018]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.067}
          maxWidth={0.52}
          anchorX="center"
          anchorY="middle"
          color="#f5e8c9"
        >
          YOU
        </Text>
        <Text
          position={[0.32, 0.04, -0.018]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.067}
          maxWidth={0.52}
          anchorX="center"
          anchorY="middle"
          color="#d9b56d"
        >
          {stackLabel}
        </Text>
      </group>

      <mesh position={[0, tableTopY + 0.075, 1.34]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.9, 0.2, 1]}>
        <ringGeometry args={[0.88, 0.9, 80]} />
        <meshStandardMaterial
          color="#d9b56d"
          emissive="#6b4317"
          emissiveIntensity={hero?.isActing ? 0.18 : 0.08}
          roughness={0.32}
          metalness={0.5}
        />
      </mesh>
    </group>
  )
}

type GetActionPlayback = (nowMs: number) => ThreeActionPlaybackSnapshot

function useActionPlayback(
  actionKey: string,
  actionCue: ThreeActionCue
): GetActionPlayback {
  const playbackRef = useRef(createActionPlaybackState(actionKey, actionCue))

  return (nowMs: number) => {
    playbackRef.current = advanceActionPlaybackState(
      playbackRef.current,
      actionKey,
      actionCue,
      nowMs
    )

    return getActionPlaybackSnapshot(playbackRef.current, nowMs)
  }
}

function HeroHand({
  position,
  side,
  getPlayback,
}: {
  position: Vec3
  side: 'left' | 'right'
  getPlayback: GetActionPlayback
}) {
  const handRef = useRef<Group>(null)
  const fingersRef = useRef<Group>(null)
  const thumbRef = useRef<Group>(null)
  const armOffset = side === 'left' ? -0.16 : 0.16
  const wristAngle = side === 'left' ? -0.16 : 0.16
  const sideFactor = side === 'left' ? -1 : 1

  useFrame(({ clock }) => {
    if (!handRef.current) {
      return
    }

    const idle = Math.sin(clock.elapsedTime * 1.4 + 0.8)
    const playback = getPlayback(clock.elapsedTime * 1000)
    const pose = getHeroHandActionPose(playback.cue, side, playback.elapsedMs)

    handRef.current.position.set(
      position[0] + pose.position[0],
      position[1] + idle * 0.01 + pose.position[1],
      position[2] + pose.position[2]
    )
    handRef.current.rotation.set(
      pose.rotation[0],
      pose.rotation[1],
      wristAngle + idle * 0.018 + pose.rotation[2]
    )

    if (fingersRef.current) {
      fingersRef.current.rotation.x = -pose.fingerCurl * 0.72
      fingersRef.current.position.y = -pose.fingerCurl * 0.025
      fingersRef.current.position.z = -pose.fingerCurl * 0.035
    }

    if (thumbRef.current) {
      thumbRef.current.rotation.x = pose.fingerCurl * 0.34
      thumbRef.current.rotation.z = sideFactor * (0.1 + pose.fingerCurl * 0.3)
    }
  })

  return (
    <group ref={handRef} position={position}>
      <mesh castShadow rotation={[Math.PI / 2, 0, wristAngle]} position={[armOffset, -0.035, 0.47]}>
        <cylinderGeometry args={[0.092, 0.112, 0.92, 28]} />
        <meshStandardMaterial color="#201d1a" roughness={0.66} metalness={0.04} />
      </mesh>
      <RoundedBox
        args={[0.18, 0.05, 0.105]}
        radius={0.02}
        smoothness={4}
        position={[sideFactor * 0.08, -0.025, 0.185]}
        rotation={[0, 0, wristAngle]}
        castShadow
      >
        <meshStandardMaterial color="#e8dcc8" roughness={0.48} metalness={0.03} />
      </RoundedBox>
      <RoundedBox args={[0.33, 0.11, 0.285]} radius={0.065} smoothness={6} position={[0, 0, -0.035]} castShadow>
        <meshStandardMaterial color="#d4a482" roughness={0.58} />
      </RoundedBox>
      <group ref={fingersRef}>
        {Array.from({ length: 4 }).map((_, index) => (
          <RoundedBox
            key={index}
            args={[0.047, 0.042, 0.24 - index * 0.018]}
            radius={0.021}
            smoothness={4}
            position={[sideFactor * (-0.115 + index * 0.072), -0.006, -0.18 - index * 0.012]}
            rotation={[0, 0, sideFactor * (0.03 + index * 0.018)]}
            castShadow
          >
            <meshStandardMaterial color="#d9aa87" roughness={0.64} />
          </RoundedBox>
        ))}
      </group>
      <group ref={thumbRef}>
        <RoundedBox
          castShadow
          args={[0.07, 0.05, 0.22]}
          radius={0.024}
          smoothness={4}
          position={[sideFactor * 0.16, -0.012, -0.055]}
          rotation={[0.68, 0, sideFactor * 0.58]}
        >
          <meshStandardMaterial color="#d8aa88" roughness={0.64} />
        </RoundedBox>
      </group>
      {[-0.105, -0.035, 0.035, 0.105].map((x, index) => (
        <mesh key={x} position={[sideFactor * x, 0.018, -0.31 + index * 0.005]} rotation={[0.12, 0, 0]}>
          <boxGeometry args={[0.026, 0.006, 0.014]} />
          <meshStandardMaterial color="#f1ddc7" roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function HeroChips({
  betAmount,
  getPlayback,
}: {
  betAmount: number
  getPlayback: GetActionPlayback
}) {
  const liveStackCount = Math.min(5, getChipCount(betAmount))

  return (
    <group position={[1.56, tableTopY + 0.03, 0.98]}>
      {liveStackCount > 0 && (
        <ChipStack position={[0, 0.04, 0]} colors={['#101318', '#f3eee0']} count={liveStackCount} />
      )}
      <CommittedWagerChips getPlayback={getPlayback} />
    </group>
  )
}

function CommittedWagerChips({
  getPlayback,
}: {
  getPlayback: GetActionPlayback
}) {
  const chipsRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    if (!chipsRef.current) {
      return
    }

    const playback = getPlayback(clock.elapsedTime * 1000)
    const pose = getHeroChipActionPose(playback.cue, playback.elapsedMs)
    chipsRef.current.visible = pose.visible
    chipsRef.current.position.set(pose.position[0], 0.17 + pose.position[1], pose.position[2])
    chipsRef.current.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2])
  })

  return (
    <group ref={chipsRef} visible={false}>
      <ChipStack position={[0, 0, 0]} colors={['#d9b56d', '#151515']} count={3} />
    </group>
  )
}

function AnimatedFoldCards({
  getPlayback,
}: {
  getPlayback: GetActionPlayback
}) {
  const cardsRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    if (!cardsRef.current) {
      return
    }

    const playback = getPlayback(clock.elapsedTime * 1000)
    const pose = getHeroCardActionPose(playback.cue, playback.elapsedMs)
    cardsRef.current.visible = pose.visible
    cardsRef.current.position.set(
      heroCardBasePosition[0] + pose.position[0],
      heroCardBasePosition[1] + pose.position[1],
      heroCardBasePosition[2] + pose.position[2]
    )
    cardsRef.current.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2])
  })

  return (
    <group ref={cardsRef} visible={false}>
      <CardGhost position={[0, 0, 0]} rotation={[0, 0, -0.08]} />
      <CardGhost position={[0.38, 0, -0.035]} rotation={[0, 0, 0.08]} />
    </group>
  )
}

function PlayerStation({
  player,
  actingVisualSeat,
}: {
  player: ThreePlayerView
  actingVisualSeat: number | null
}) {
  const layout = seatLayout[player.visualSeat]

  if (!layout) {
    return null
  }

  const isHero = player.visualSeat === 0

  return (
    <group position={layout.position} rotation={[0, layout.rotation, 0]}>
      <group scale={[layout.scale, layout.scale, layout.scale]}>
        {!isHero && (
          <pointLight
            position={[0, 1.42, -0.22]}
            intensity={player.isActing ? 1.35 : 0.52}
            color={player.isActing ? '#f0d89e' : player.accentColor}
            distance={2.15}
          />
        )}
        <Chair
          accentColor={player.isActing ? '#d9b56d' : player.accentColor}
          profile={player.avatarProfile}
          isActing={player.isActing}
          isHero={isHero}
        />
        {!isHero && <Avatar player={player} actingVisualSeat={actingVisualSeat} />}
        {player.isActing && <TurnBeacon isHero={isHero} />}
      </group>
      {player.isDealer && <DealerButton3D position={[-0.36, tableTopY + 0.075, -0.86]} />}
      {player.bet > 0 && !isHero && (
        <ChipStack
          position={[0.42, tableTopY - layout.position[1] + 0.05, -0.98]}
          colors={['#151515', '#f3eee0']}
          count={getChipCount(player.bet)}
        />
      )}
      {player.hasCards && !isHero && <OpponentHoleCards isActing={player.isActing} />}
      {!isHero && <SeatPlaque player={player} />}
    </group>
  )
}

function TurnBeacon({ isHero }: { isHero: boolean }) {
  return (
    <group position={[0, isHero ? 0.98 : 1.58, -0.42]}>
      <pointLight position={[0, 0.18, 0]} intensity={0.95} color="#f0d89e" distance={1.25} />
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.42, 0.72, 1]}>
        <torusGeometry args={[0.28, 0.012, 10, 56]} />
        <meshStandardMaterial
          color="#f0d89e"
          emissive="#d9b56d"
          emissiveIntensity={0.34}
          roughness={0.28}
          transparent
          opacity={0.72}
        />
      </mesh>
    </group>
  )
}

function OpponentHoleCards({ isActing }: { isActing: boolean }) {
  return (
    <group position={[0, tableTopY + 0.086, -0.88]} scale={[0.82, 0.82, 0.82]}>
      <CardBack3D position={[-0.105, 0, 0]} rotation={[0.02, 0.05, -0.08]} isActing={isActing} />
      <CardBack3D position={[0.105, 0.004, 0]} rotation={[0.02, -0.05, 0.08]} isActing={isActing} />
    </group>
  )
}

function Chair({
  accentColor,
  profile,
  isActing,
  isHero,
}: {
  accentColor: string
  profile: ThreePlayerView['avatarProfile']
  isActing: boolean
  isHero: boolean
}) {
  const backHeight = isHero ? 0.58 : 0.92
  const backY = isHero ? 0.8 : 0.99
  const cushionColor = isActing ? '#4a3319' : profile.chairColor
  const trimColor = isActing ? '#f0d89e' : profile.chairTrimColor
  const shadowColor = isHero ? '#171311' : '#120f0e'

  return (
    <group>
      <RoundedBox args={[0.92, 0.14, 0.82]} radius={0.11} smoothness={7} position={[0, 0.37, 0.38]} castShadow>
        <meshStandardMaterial color={shadowColor} roughness={0.58} metalness={0.08} />
      </RoundedBox>
      <RoundedBox args={[0.76, 0.2, 0.72]} radius={0.11} smoothness={7} position={[0, 0.49, 0.36]} castShadow receiveShadow>
        <meshStandardMaterial color={cushionColor} roughness={0.48} metalness={0.08} />
      </RoundedBox>
      <RoundedBox args={[0.58, 0.026, 0.035]} radius={0.012} smoothness={3} position={[0, 0.61, 0.08]} castShadow>
        <meshStandardMaterial color={trimColor} roughness={0.32} metalness={0.36} transparent opacity={0.88} />
      </RoundedBox>
      {[-0.24, 0.24].map(x => (
        <RoundedBox key={`seat-tuft-${x}`} args={[0.04, 0.028, 0.46]} radius={0.012} smoothness={3} position={[x, 0.61, 0.35]} castShadow>
          <meshStandardMaterial color="#120f0e" roughness={0.55} metalness={0.08} transparent opacity={0.54} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.84, backHeight, 0.18]} radius={0.11} smoothness={7} position={[0, backY, 0.76]} castShadow receiveShadow>
        <meshStandardMaterial color={cushionColor} roughness={0.5} metalness={0.08} />
      </RoundedBox>
      {[-0.26, 0, 0.26].map(x => (
        <RoundedBox
          key={`chair-back-channel-${x}`}
          args={[0.035, backHeight * 0.62, 0.026]}
          radius={0.014}
          smoothness={3}
          position={[x, backY + 0.02, 0.655]}
          castShadow
        >
          <meshStandardMaterial color="#100d0c" roughness={0.56} metalness={0.08} transparent opacity={0.52} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.92, 0.07, 0.08]} radius={0.03} smoothness={5} position={[0, backY + backHeight / 2 - 0.08, 0.65]} castShadow>
        <meshStandardMaterial color={trimColor} roughness={0.24} metalness={0.58} />
      </RoundedBox>
      <RoundedBox args={[0.66, 0.044, 0.065]} radius={0.02} smoothness={4} position={[0, 0.61, 0.02]} castShadow>
        <meshStandardMaterial color={trimColor} roughness={0.28} metalness={0.5} />
      </RoundedBox>
      {[-1, 1].map(side => (
        <RoundedBox
          key={`chair-wing-${side}`}
          args={[0.09, backHeight * 0.84, 0.16]}
          radius={0.045}
          smoothness={5}
          position={[side * 0.45, backY - 0.02, 0.68]}
          rotation={[0, side * 0.1, 0]}
          castShadow
        >
          <meshStandardMaterial color="#181412" roughness={0.46} metalness={0.12} />
        </RoundedBox>
      ))}
      {[-0.2, 0.2].map(x => (
        <mesh key={`chair-button-${x}`} position={[x, backY + 0.05, 0.655]} castShadow>
          <sphereGeometry args={[0.035, 16, 10]} />
          <meshStandardMaterial color={trimColor} roughness={0.28} metalness={0.46} />
        </mesh>
      ))}
      {[-1, 1].map(side => (
        <RoundedBox
          key={`chair-arm-${side}`}
          args={[0.16, 0.13, 0.62]}
          radius={0.06}
          smoothness={5}
          position={[side * 0.51, 0.52, 0.28]}
          rotation={[0, side * 0.04, 0]}
          castShadow
        >
          <meshStandardMaterial color="#191412" roughness={0.46} metalness={0.16} />
        </RoundedBox>
      ))}
      <mesh position={[0, 0.5, 0.38]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.78, 0.54, 1]}>
        <ringGeometry args={[0.74, 0.756, 96]} />
        <meshStandardMaterial color={trimColor} emissive={accentColor} emissiveIntensity={isActing ? 0.22 : 0.06} roughness={0.3} metalness={0.55} />
      </mesh>
      <mesh castShadow position={[0, 0.3, 0.16]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.08, 0.72, 1]}>
        <torusGeometry args={[0.24, 0.012, 8, 48]} />
        <meshStandardMaterial color="#9b7043" roughness={0.3} metalness={0.46} />
      </mesh>
      <mesh castShadow position={[0, 0.24, 0.18]}>
        <cylinderGeometry args={[0.055, 0.065, 0.42, 16]} />
        <meshStandardMaterial color="#141211" roughness={0.4} metalness={0.28} />
      </mesh>
      <mesh castShadow position={[-0.25, 0.24, 0.18]}>
        <cylinderGeometry args={[0.035, 0.035, 0.45, 12]} />
        <meshStandardMaterial color="#171717" roughness={0.42} metalness={0.35} />
      </mesh>
      <mesh castShadow position={[0.25, 0.24, 0.18]}>
        <cylinderGeometry args={[0.035, 0.035, 0.45, 12]} />
        <meshStandardMaterial color="#171717" roughness={0.42} metalness={0.35} />
      </mesh>
    </group>
  )
}

function SeatPlaque({ player }: { player: ThreePlayerView }) {
  const detail = player.isWinner ? 'Winner' : player.isActing ? 'Thinking' : player.bet > 0 ? `$${player.bet}` : null
  const labelColor = player.isActing ? '#f0d89e' : '#d7e6df'

  return (
    <group position={[0, tableTopY + 0.078, -1.1]}>
      <RoundedBox args={[0.64, 0.03, 0.18]} radius={0.032} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial
          color={player.isActing ? '#2f2818' : '#111815'}
          roughness={0.58}
          metalness={0.08}
          transparent
          opacity={0.9}
        />
      </RoundedBox>
      <Text
        position={[0, 0.025, detail ? -0.034 : 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.058}
        maxWidth={0.52}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color={labelColor}
      >
        {truncateLabel(player.nickname, 12)}
      </Text>
      {detail && (
        <Text
          position={[0, 0.027, 0.052]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.038}
          maxWidth={0.52}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          color="#d0b889"
        >
          {truncateLabel(detail, 11)}
        </Text>
      )}
    </group>
  )
}

function DealerButton3D({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh castShadow rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.026, 32]} />
        <meshStandardMaterial color="#f3eee0" roughness={0.34} metalness={0.06} />
      </mesh>
      <Text
        position={[0, 0.022, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.09}
        anchorX="center"
        anchorY="middle"
        color="#2b211c"
      >
        D
      </Text>
    </group>
  )
}

interface AvatarProps {
  player: ThreePlayerView
  actingVisualSeat: number | null
}

class AvatarAssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }

    return this.props.children
  }
}

function Avatar(props: AvatarProps) {
  const fallback = <ProceduralAvatarFallback {...props} />

  return (
    <AvatarAssetBoundary key={props.player.avatarProfile.modelKey} fallback={fallback}>
      <Suspense fallback={fallback}>
        <RealisticAvatar {...props} />
      </Suspense>
    </AvatarAssetBoundary>
  )
}

function RealisticAvatar({ player, actingVisualSeat }: AvatarProps) {
  const avatarRef = useRef<Group>(null)
  const modelRef = useRef<Group>(null)
  const profile = player.avatarProfile
  const model = getAvatarModelConfig(profile.modelKey)
  const gltf = useGLTF(model.path)
  const { actions } = useAnimations(gltf.animations, modelRef)
  const getPlayback = useActionPlayback(player.actionKey, player.actionCue)
  const headTurn = useMemo(
    () => getAvatarHeadTurn(player.visualSeat, actingVisualSeat),
    [actingVisualSeat, player.visualSeat]
  )
  const isSubdued = player.status === 'folded' || player.status === 'disconnected'

  useEffect(() => {
    const idleAction = actions['CharacterArmature|Idle'] ?? Object.values(actions).find(Boolean)

    idleAction?.reset().fadeIn(0.18).play()

    return () => {
      idleAction?.fadeOut(0.18)
    }
  }, [actions])

  useFrame(({ clock }) => {
    const time = clock.elapsedTime + player.visualSeat * 0.37
    const breath = Math.sin(time * 1.2)
    const alertLift = player.isActing ? Math.sin(time * 2.7) * 0.01 : 0
    const trackingNoise = player.isActing ? Math.sin(time * 0.68) * 0.018 : Math.sin(time * 0.42) * 0.024
    const playback = getPlayback(clock.elapsedTime * 1000)
    const actionPose = getSeatedAvatarActionPose(playback.cue, playback.elapsedMs)

    if (avatarRef.current) {
      avatarRef.current.position.set(
        actionPose.bodyPosition[0],
        breath * 0.012 + alertLift + (player.isWinner ? 0.018 : 0) + actionPose.bodyPosition[1],
        actionPose.bodyPosition[2]
      )
      avatarRef.current.rotation.x = breath * 0.005 + (player.isActing ? -0.012 : 0) + (isSubdued ? 0.035 : 0) + actionPose.bodyRotation[0] * 0.45
      avatarRef.current.rotation.y = actionPose.bodyRotation[1] * 0.35
      avatarRef.current.rotation.z = Math.sin(time * 0.72) * 0.006 + actionPose.bodyRotation[2] * 0.35
    }

    if (modelRef.current) {
      modelRef.current.rotation.set(
        model.rotation[0] + headTurn.pitch * 0.24 + actionPose.headRotation[0] * 0.18,
        model.rotation[1] + headTurn.yaw * 0.18 + trackingNoise + actionPose.headRotation[1] * 0.16,
        model.rotation[2] + (player.isActing ? Math.sin(time * 1.1) * 0.006 : 0) + actionPose.headRotation[2] * 0.16
      )
    }
  })

  return (
    <group ref={avatarRef}>
      <mesh position={[0, 0.52, -0.42]} rotation={[Math.PI / 2, 0, 0]} scale={[1.02, 0.62, 1]}>
        <torusGeometry args={[0.3, 0.009, 10, 72]} />
        <meshStandardMaterial
          color={player.isWinner ? '#f3df97' : player.isActing ? '#d9b56d' : profile.accentColor}
          emissive={player.isWinner ? '#f3df97' : player.isActing ? '#d9b56d' : profile.accentColor}
          emissiveIntensity={player.isWinner ? 0.56 : player.isActing ? 0.46 : 0.12}
          roughness={0.32}
          metalness={0.28}
          transparent
          opacity={isSubdued ? 0.42 : 0.78}
        />
      </mesh>
      {player.isWinner && (
        <pointLight position={[0, 1.45, -0.12]} intensity={1.1} color="#f3df97" distance={1.4} />
      )}
      <group
        ref={modelRef}
        position={model.position}
        rotation={model.rotation}
        scale={[model.scale, model.scale, model.scale]}
      >
        <Clone object={gltf.scene} castShadow receiveShadow />
      </group>
    </group>
  )
}

function ProceduralAvatarFallback({
  player,
  actingVisualSeat,
}: AvatarProps) {
  const avatarRef = useRef<Group>(null)
  const headRef = useRef<Group>(null)
  const armRef = useRef<Group>(null)
  const profile = player.avatarProfile
  const build = useMemo(() => getAvatarBuildShape(profile.build), [profile.build])
  const faceShape = useMemo(() => getAvatarFaceShape(profile.faceShape), [profile.faceShape])
  const brow = useMemo(() => getAvatarBrowMetrics(profile.browWeight), [profile.browWeight])
  const getPlayback = useActionPlayback(player.actionKey, player.actionCue)
  const headTurn = useMemo(
    () => getAvatarHeadTurn(player.visualSeat, actingVisualSeat),
    [actingVisualSeat, player.visualSeat]
  )
  const isSubdued = player.status === 'folded' || player.status === 'disconnected'
  const faceColor = isSubdued ? '#8f8178' : profile.skinColor
  const skinShadowColor = isSubdued ? '#6f635d' : '#b98568'
  const shirtColor = isSubdued ? '#242321' : profile.shirtColor
  const sleeveColor = isSubdued ? '#1b1a18' : profile.sleeveColor
  const lapelColor = isSubdued ? '#191715' : profile.lapelColor
  const jacketColor = isSubdued ? '#26221f' : profile.shirtColor
  const pantsColor = isSubdued ? '#191817' : '#161b24'

  useFrame(({ clock }) => {
    const time = clock.elapsedTime + player.visualSeat * 0.37
    const breath = Math.sin(time * 1.2)
    const alertLift = player.isActing ? Math.sin(time * 2.7) * 0.01 : 0
    const playback = getPlayback(clock.elapsedTime * 1000)
    const actionPose = getSeatedAvatarActionPose(playback.cue, playback.elapsedMs)

    if (avatarRef.current) {
      avatarRef.current.position.set(
        actionPose.bodyPosition[0],
        0.68 + breath * 0.012 + alertLift + (player.isWinner ? 0.018 : 0) + actionPose.bodyPosition[1],
        0.2 + actionPose.bodyPosition[2]
      )
      avatarRef.current.rotation.x = -0.11 + breath * 0.008 + (player.isActing ? -0.018 : 0) + (isSubdued ? 0.045 : 0) + actionPose.bodyRotation[0]
      avatarRef.current.rotation.y = actionPose.bodyRotation[1]
      avatarRef.current.rotation.z = Math.sin(time * 0.72) * 0.008 + actionPose.bodyRotation[2]
    }

    if (headRef.current) {
      const trackingNoise = player.isActing ? Math.sin(time * 0.68) * 0.022 : Math.sin(time * 0.42) * 0.032
      headRef.current.rotation.x = headTurn.pitch + Math.sin(time * 0.88) * 0.012 + actionPose.headRotation[0]
      headRef.current.rotation.y = headTurn.yaw + trackingNoise + actionPose.headRotation[1]
      headRef.current.rotation.z = (player.isActing ? Math.sin(time * 1.1) * 0.01 : 0) + actionPose.headRotation[2]
    }

    if (armRef.current) {
      armRef.current.position.set(
        actionPose.armPosition[0],
        actionPose.armPosition[1],
        actionPose.armPosition[2]
      )
      armRef.current.rotation.set(
        breath * 0.012 + actionPose.armRotation[0],
        actionPose.armRotation[1],
        actionPose.armRotation[2]
      )
    }
  })

  return (
    <group ref={avatarRef} position={[0, 0.68, 0.2]}>
      <mesh position={[0, 0.47, -0.5]} rotation={[Math.PI / 2, 0, 0]} scale={[1.2, 0.78, 1]}>
        <torusGeometry args={[0.31, 0.01, 10, 72]} />
        <meshStandardMaterial
          color={player.isWinner ? '#f3df97' : player.isActing ? '#d9b56d' : profile.accentColor}
          emissive={player.isWinner ? '#f3df97' : player.isActing ? '#d9b56d' : profile.accentColor}
          emissiveIntensity={player.isWinner ? 0.7 : player.isActing ? 0.62 : 0.18}
          roughness={0.32}
          metalness={0.28}
        />
      </mesh>
      {player.isWinner && (
        <pointLight position={[0, 1.34, -0.2]} intensity={1.1} color="#f3df97" distance={1.2} />
      )}

      <RoundedBox
        args={[0.8 * build.shoulderScale, 0.17, 0.34]}
        radius={0.07}
        smoothness={5}
        position={[0, 0.75, 0.02]}
        castShadow
      >
        <meshStandardMaterial color={jacketColor} roughness={0.52} metalness={0.08} />
      </RoundedBox>
      <RoundedBox args={[0.54 * build.shoulderScale, 0.07, 0.065]} radius={0.02} smoothness={4} position={[0, 0.97, -0.22]} castShadow>
        <meshStandardMaterial color="#f2e5d6" roughness={0.52} metalness={0.02} />
      </RoundedBox>
      <mesh castShadow position={[0, 0.9, 0]} scale={[build.torsoScale, 1.08, 0.92]}>
        <capsuleGeometry args={[0.255, 0.58, 8, 28]} />
        <meshStandardMaterial color={shirtColor} roughness={0.5} metalness={0.12} />
      </mesh>
      <RoundedBox args={[0.22, 0.41, 0.045]} radius={0.025} smoothness={4} position={[-0.13, 0.91, -0.235]} rotation={[0.08, 0, -0.18]} castShadow>
        <meshStandardMaterial color={lapelColor} roughness={0.48} metalness={0.14} />
      </RoundedBox>
      <RoundedBox args={[0.22, 0.41, 0.045]} radius={0.025} smoothness={4} position={[0.13, 0.91, -0.235]} rotation={[0.08, 0, 0.18]} castShadow>
        <meshStandardMaterial color={lapelColor} roughness={0.48} metalness={0.14} />
      </RoundedBox>
      <RoundedBox args={[0.2, 0.36, 0.04]} radius={0.018} smoothness={4} position={[0, 0.88, -0.255]} castShadow>
        <meshStandardMaterial color="#f3ead7" roughness={0.52} metalness={0.02} />
      </RoundedBox>
      {[0.79, 0.9, 1.01].map(y => (
        <mesh key={`avatar-button-${y}`} position={[0, y, -0.278]} castShadow>
          <sphereGeometry args={[0.016, 12, 8]} />
          <meshStandardMaterial color="#d9b56d" roughness={0.28} metalness={0.5} />
        </mesh>
      ))}
      <RoundedBox args={[0.082, 0.042, 0.012]} radius={0.004} smoothness={2} position={[0.19, 0.965, -0.281]} rotation={[0, 0, -0.12]} castShadow>
        <meshStandardMaterial color={profile.accentColor} emissive={profile.accentColor} emissiveIntensity={isSubdued ? 0.02 : 0.08} roughness={0.44} metalness={0.16} />
      </RoundedBox>
      <RoundedBox args={[0.31, 0.058, 0.095]} radius={0.022} smoothness={4} position={[0, 1.12, -0.055]} castShadow>
        <meshStandardMaterial color={faceColor} roughness={0.58} />
      </RoundedBox>

      <group position={[0, 1.035, -0.25]}>
        <RoundedBox args={[0.34, 0.032, 0.035]} radius={0.012} smoothness={3} position={[-0.02, 0, 0]} castShadow>
          <meshStandardMaterial color="#f3ead7" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, -0.035, -0.01]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.07, 0.018, 0.022]} />
          <meshStandardMaterial color={profile.accentColor} roughness={0.38} metalness={0.18} />
        </mesh>
      </group>

      <group>
        {([-1, 1] as const).map(side => (
          <group key={`avatar-leg-${side}`}>
            <mesh castShadow position={[side * 0.12, 0.44, 0.04]} rotation={[0.18, 0, side * 0.06]}>
              <cylinderGeometry args={[0.07, 0.085, 0.4, 18]} />
              <meshStandardMaterial color={pantsColor} roughness={0.58} metalness={0.08} />
            </mesh>
            <RoundedBox args={[0.2, 0.055, 0.11]} radius={0.025} smoothness={4} position={[side * 0.16, 0.24, -0.14]} rotation={[0.02, side * 0.12, 0]} castShadow>
              <meshStandardMaterial color="#11100f" roughness={0.48} metalness={0.16} />
            </RoundedBox>
          </group>
        ))}
      </group>

      <group ref={armRef}>
        {([-1, 1] as const).map(side => (
          <group key={side}>
            <mesh castShadow position={[side * 0.31 * build.shoulderScale, 0.84, -0.17]} rotation={[0.96, side * 0.11, -side * 0.55]}>
              <cylinderGeometry args={[0.085, 0.102, 0.48, 22]} />
              <meshStandardMaterial color={sleeveColor} roughness={0.6} metalness={0.08} />
            </mesh>
            <mesh castShadow position={[side * 0.42, 0.58, -0.5]} rotation={[1.4, side * 0.08, -side * 0.22]}>
              <cylinderGeometry args={[0.057, 0.073, 0.42, 20]} />
              <meshStandardMaterial color={faceColor} roughness={0.62} />
            </mesh>
            <HumanHand side={side} faceColor={faceColor} />
          </group>
        ))}
      </group>

      <mesh castShadow position={[0, 1.11, -0.035]}>
        <cylinderGeometry args={[0.086, 0.108, 0.22, 22]} />
        <meshStandardMaterial color={faceColor} roughness={0.6} />
      </mesh>
      <RoundedBox args={[0.58 * build.shoulderScale, 0.04, 0.055]} radius={0.014} smoothness={3} position={[0, 1.06, -0.19]} castShadow>
        <meshStandardMaterial color="#f3ead7" roughness={0.5} />
      </RoundedBox>
      {[-1, 1].map(side => (
        <RoundedBox
          key={`avatar-clavicle-${side}`}
          args={[0.17, 0.013, 0.012]}
          radius={0.006}
          smoothness={2}
          position={[side * 0.13, 1.065, -0.205]}
          rotation={[0, 0, -side * 0.18]}
        >
          <meshStandardMaterial color="#d3b298" roughness={0.58} transparent opacity={isSubdued ? 0.16 : 0.34} />
        </RoundedBox>
      ))}

      <group ref={headRef} position={[0, 1.22, -0.02]}>
        <mesh castShadow position={[-0.216, 0.018, -0.018]} scale={[0.5, 0.76, 0.42]}>
          <sphereGeometry args={[0.064, 16, 12]} />
          <meshStandardMaterial color={faceColor} roughness={0.62} />
        </mesh>
        <mesh castShadow position={[0.216, 0.018, -0.018]} scale={[0.5, 0.76, 0.42]}>
          <sphereGeometry args={[0.064, 16, 12]} />
          <meshStandardMaterial color={faceColor} roughness={0.62} />
        </mesh>
        <mesh castShadow position={[0, 0.038, -0.012]} scale={faceShape.headScale}>
          <sphereGeometry args={[0.228, 48, 30]} />
          <meshStandardMaterial color={faceColor} roughness={0.52} />
        </mesh>
        <mesh position={[-0.072, 0.01, -0.224]} scale={[1.1, 0.62, 0.36]}>
          <sphereGeometry args={[0.04, 14, 8]} />
          <meshStandardMaterial color="#e7b198" roughness={0.58} transparent opacity={isSubdued ? 0.1 : 0.24} />
        </mesh>
        <mesh position={[0.072, 0.01, -0.224]} scale={[1.1, 0.62, 0.36]}>
          <sphereGeometry args={[0.04, 14, 8]} />
          <meshStandardMaterial color="#e7b198" roughness={0.58} transparent opacity={isSubdued ? 0.1 : 0.24} />
        </mesh>
        <RoundedBox
          args={[faceShape.jawWidth, 0.08, 0.105]}
          radius={0.04}
          smoothness={5}
          position={[0, -0.1, -0.062]}
          castShadow
        >
          <meshStandardMaterial color={faceColor} roughness={0.61} />
        </RoundedBox>
        <RoundedBox
          args={[faceShape.chinWidth, 0.04, 0.04]}
          radius={0.018}
          smoothness={3}
          position={[0, -0.146, -0.208]}
          castShadow
        >
          <meshStandardMaterial color={faceColor} roughness={0.64} />
        </RoundedBox>

        <AvatarHair profile={profile} isSubdued={isSubdued} />

        <RoundedBox args={[0.038, 0.086, 0.028]} radius={0.012} smoothness={3} position={[0, 0.054, -0.236]} rotation={[0.15, 0, 0]} castShadow>
          <meshStandardMaterial color={skinShadowColor} roughness={0.62} />
        </RoundedBox>
        <mesh castShadow position={[0, 0.01, -0.253]} scale={[1.08, 0.72, 0.62]}>
          <sphereGeometry args={[0.03, 16, 10]} />
          <meshStandardMaterial color={skinShadowColor} roughness={0.64} />
        </mesh>

        {([-1, 1] as const).map(side => (
          <group key={side}>
            <mesh castShadow position={[side * 0.082, 0.052, -0.231]} scale={[1.32, 0.74, 0.52]}>
              <sphereGeometry args={[0.025, 18, 10]} />
              <meshStandardMaterial color="#f6ead7" roughness={0.34} />
            </mesh>
            <mesh castShadow position={[side * 0.084, 0.049, -0.246]} scale={[0.86, 0.86, 0.52]}>
              <sphereGeometry args={[0.013, 12, 8]} />
              <meshStandardMaterial color="#15110f" roughness={0.32} />
            </mesh>
            <mesh position={[side * 0.09, 0.054, -0.256]} scale={[0.42, 0.42, 0.42]}>
              <sphereGeometry args={[0.008, 8, 6]} />
              <meshStandardMaterial color="#fff2d9" emissive="#fff2d9" emissiveIntensity={0.22} roughness={0.18} />
            </mesh>
            <RoundedBox
              args={[0.072, brow.height, 0.014]}
              radius={0.005}
              smoothness={2}
              position={[side * 0.083, brow.y + 0.006, -0.222]}
              rotation={[0, 0, -side * brow.slant]}
            >
              <meshStandardMaterial color={profile.hairColor} roughness={0.64} />
            </RoundedBox>
            <mesh position={[side * 0.126, -0.008, -0.216]} scale={[1.24, 0.6, 0.68]}>
              <sphereGeometry args={[0.028, 12, 8]} />
              <meshStandardMaterial color="#ca8371" roughness={0.58} transparent opacity={isSubdued ? 0.12 : 0.26} />
            </mesh>
          </group>
        ))}

        <AvatarEyelids
          faceColor={faceColor}
          isSubdued={isSubdued}
          seed={player.visualSeat * 0.61}
        />

        <AvatarAccessory profile={profile} hairColor={profile.hairColor} />

        <RoundedBox args={[getAvatarMouthWidth(profile.faceStyle), 0.014, 0.012]} radius={0.006} smoothness={2} position={[0, -0.064, -0.229]}>
          <meshStandardMaterial color={profile.faceStyle === 'smirk' ? '#6d2b28' : '#532222'} roughness={0.5} />
        </RoundedBox>
        <RoundedBox args={[0.05, 0.007, 0.01]} radius={0.003} smoothness={2} position={[0, -0.088, -0.227]}>
          <meshStandardMaterial color="#d59a90" roughness={0.55} transparent opacity={isSubdued ? 0.08 : 0.26} />
        </RoundedBox>

        {player.isWinner && (
          <mesh position={[0, 0.26, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.22, 0.008, 8, 48]} />
            <meshStandardMaterial color="#f3df97" emissive="#d9b56d" emissiveIntensity={0.45} roughness={0.25} />
          </mesh>
        )}
      </group>
    </group>
  )
}

function HumanHand({ side, faceColor }: { side: -1 | 1; faceColor: string }) {
  return (
    <group position={[side * 0.49, 0.445, -0.69]} rotation={[0.06, side * 0.08, side * 0.14]}>
      <RoundedBox args={[0.14, 0.052, 0.112]} radius={0.034} smoothness={5} scale={[1.15, 0.82, 0.95]} castShadow>
        <meshStandardMaterial color={faceColor} roughness={0.62} />
      </RoundedBox>
      {[-0.045, -0.015, 0.015, 0.045].map((x, index) => (
        <RoundedBox
          key={`finger-${x}`}
          args={[0.023, 0.026, 0.116 - index * 0.01]}
          radius={0.012}
          smoothness={3}
          position={[side * x, -0.004, -0.076 - index * 0.004]}
          rotation={[0.16, 0, side * (0.02 + index * 0.014)]}
          castShadow
        >
          <meshStandardMaterial color={faceColor} roughness={0.64} />
        </RoundedBox>
      ))}
      <RoundedBox
        args={[0.032, 0.028, 0.094]}
        radius={0.014}
        smoothness={3}
        position={[side * 0.092, -0.002, -0.012]}
        rotation={[0.5, 0, side * 0.68]}
        castShadow
      >
        <meshStandardMaterial color={faceColor} roughness={0.64} />
      </RoundedBox>
    </group>
  )
}

function AvatarEyelids({
  faceColor,
  isSubdued,
  seed,
}: {
  faceColor: string
  isSubdued: boolean
  seed: number
}) {
  const lidRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    if (!lidRef.current) {
      return
    }

    const blink = Math.pow(Math.max(0, Math.sin((clock.elapsedTime + seed) * 2.4)), 28)
    lidRef.current.scale.y = 1 + blink * 2.9
    lidRef.current.position.y = -blink * 0.014
  })

  return (
    <group ref={lidRef}>
      {([-1, 1] as const).map(side => (
        <group key={`eyelid-${side}`}>
          <RoundedBox
            args={[0.078, 0.012, 0.012]}
            radius={0.005}
            smoothness={2}
            position={[side * 0.082, 0.078, -0.257]}
          >
            <meshStandardMaterial color={faceColor} roughness={0.58} transparent opacity={isSubdued ? 0.58 : 0.88} />
          </RoundedBox>
          <RoundedBox
            args={[0.062, 0.006, 0.01]}
            radius={0.003}
            smoothness={2}
            position={[side * 0.082, 0.028, -0.258]}
          >
            <meshStandardMaterial color={faceColor} roughness={0.62} transparent opacity={isSubdued ? 0.28 : 0.45} />
          </RoundedBox>
        </group>
      ))}
    </group>
  )
}

function AvatarHair({
  profile,
  isSubdued,
}: {
  profile: ThreePlayerView['avatarProfile']
  isSubdued: boolean
}) {
  const hairColor = isSubdued ? '#2a2825' : profile.hairColor

  if (profile.hairStyle === 'cap') {
    return (
      <>
        <mesh castShadow position={[0, 0.18, -0.018]} scale={[1.08, 0.48, 0.92]}>
          <sphereGeometry args={[0.228, 34, 12]} />
          <meshStandardMaterial color={profile.accentColor} roughness={0.52} metalness={0.04} />
        </mesh>
        <RoundedBox args={[0.27, 0.028, 0.085]} radius={0.012} smoothness={3} position={[0, 0.122, -0.246]} castShadow>
          <meshStandardMaterial color={profile.accentColor} roughness={0.5} metalness={0.06} />
        </RoundedBox>
        <AvatarHairline hairColor={hairColor} isSubdued={isSubdued} />
      </>
    )
  }

  if (profile.hairStyle === 'side_part') {
    return (
      <>
        <mesh castShadow position={[-0.035, 0.18, -0.018]} scale={[1.02, 0.54, 0.88]}>
          <sphereGeometry args={[0.226, 34, 14]} />
          <meshStandardMaterial color={hairColor} roughness={0.68} />
        </mesh>
        <RoundedBox args={[0.21, 0.022, 0.024]} radius={0.008} smoothness={2} position={[-0.052, 0.11, -0.228]}>
          <meshStandardMaterial color={hairColor} roughness={0.64} />
        </RoundedBox>
        <RoundedBox args={[0.11, 0.02, 0.02]} radius={0.008} smoothness={2} position={[0.09, 0.12, -0.226]}>
          <meshStandardMaterial color={hairColor} roughness={0.64} />
        </RoundedBox>
        <AvatarHairline hairColor={hairColor} isSubdued={isSubdued} />
      </>
    )
  }

  if (profile.hairStyle === 'waves') {
    return (
      <>
        <mesh castShadow position={[0, 0.178, -0.018]} scale={[1.06, 0.5, 0.9]}>
          <sphereGeometry args={[0.226, 34, 12]} />
          <meshStandardMaterial color={hairColor} roughness={0.7} />
        </mesh>
        {[-0.105, -0.035, 0.035, 0.105].map((x, index) => (
          <mesh key={x} castShadow position={[x * 1.08, 0.118 + (index % 2) * 0.014, -0.228]} scale={[1.2, 0.56, 0.85]}>
            <sphereGeometry args={[0.037, 12, 8]} />
            <meshStandardMaterial color={hairColor} roughness={0.72} />
          </mesh>
        ))}
        <AvatarHairline hairColor={hairColor} isSubdued={isSubdued} />
      </>
    )
  }

  return (
    <>
      <mesh castShadow position={[0, 0.176, -0.015]} scale={[1.04, 0.5, 0.9]}>
        <sphereGeometry args={[0.224, 32, 12]} />
        <meshStandardMaterial color={hairColor} roughness={0.68} />
      </mesh>
      <RoundedBox args={[0.21, 0.02, 0.018]} radius={0.007} smoothness={2} position={[0, 0.104, -0.224]}>
        <meshStandardMaterial color={hairColor} roughness={0.64} />
      </RoundedBox>
      <AvatarHairline hairColor={hairColor} isSubdued={isSubdued} />
    </>
  )
}

function AvatarHairline({
  hairColor,
  isSubdued,
}: {
  hairColor: string
  isSubdued: boolean
}) {
  return (
    <>
      <RoundedBox args={[0.2, 0.02, 0.02]} radius={0.008} smoothness={2} position={[0, 0.088, -0.235]} castShadow>
        <meshStandardMaterial color={hairColor} roughness={0.68} transparent opacity={isSubdued ? 0.58 : 0.92} />
      </RoundedBox>
      {([-1, 1] as const).map(side => (
        <RoundedBox
          key={`sideburn-${side}`}
          args={[0.036, 0.112, 0.03]}
          radius={0.013}
          smoothness={3}
          position={[side * 0.174, 0.035, -0.158]}
          rotation={[0.06, side * 0.1, side * 0.08]}
          castShadow
        >
          <meshStandardMaterial color={hairColor} roughness={0.7} transparent opacity={isSubdued ? 0.5 : 0.9} />
        </RoundedBox>
      ))}
    </>
  )
}

function AvatarAccessory({
  profile,
  hairColor,
}: {
  profile: ThreePlayerView['avatarProfile']
  hairColor: string
}) {
  if (profile.accessory === 'glasses') {
    return (
      <group position={[0, 0.05, -0.242]}>
        {[-1, 1].map(side => (
          <mesh key={`glasses-lens-${side}`} position={[side * 0.08, 0, 0]} scale={[1.14, 0.8, 1]}>
            <torusGeometry args={[0.038, 0.004, 8, 24]} />
            <meshStandardMaterial color="#181512" roughness={0.24} metalness={0.5} />
          </mesh>
        ))}
        <RoundedBox args={[0.055, 0.006, 0.006]} radius={0.003} smoothness={2} position={[0, 0, 0]} castShadow>
          <meshStandardMaterial color="#181512" roughness={0.24} metalness={0.5} />
        </RoundedBox>
      </group>
    )
  }

  if (profile.accessory === 'mustache') {
    return (
      <group position={[0, -0.026, -0.24]}>
        <RoundedBox args={[0.074, 0.02, 0.012]} radius={0.009} smoothness={3} position={[-0.04, 0, 0]} rotation={[0, 0, -0.16]} castShadow>
          <meshStandardMaterial color={hairColor} roughness={0.68} />
        </RoundedBox>
        <RoundedBox args={[0.074, 0.02, 0.012]} radius={0.009} smoothness={3} position={[0.04, 0, 0]} rotation={[0, 0, 0.16]} castShadow>
          <meshStandardMaterial color={hairColor} roughness={0.68} />
        </RoundedBox>
      </group>
    )
  }

  return null
}

function getAvatarBuildShape(build: ThreePlayerView['avatarProfile']['build']) {
  if (build === 'lean') {
    return { torsoScale: 0.92, shoulderScale: 0.92 }
  }

  if (build === 'broad') {
    return { torsoScale: 1.13, shoulderScale: 1.12 }
  }

  return { torsoScale: 1, shoulderScale: 1 }
}

function getAvatarFaceShape(faceShape: ThreePlayerView['avatarProfile']['faceShape']) {
  if (faceShape === 'round') {
    return {
      headScale: [1.08, 1.02, 0.96] as Vec3,
      jawWidth: 0.235,
      chinWidth: 0.125,
    }
  }

  if (faceShape === 'square') {
    return {
      headScale: [1.02, 1, 0.95] as Vec3,
      jawWidth: 0.285,
      chinWidth: 0.17,
    }
  }

  return {
    headScale: [0.96, 1.14, 0.92] as Vec3,
    jawWidth: 0.21,
    chinWidth: 0.11,
  }
}

function getAvatarBrowMetrics(browWeight: ThreePlayerView['avatarProfile']['browWeight']) {
  if (browWeight === 'high') {
    return { y: 0.094, height: 0.014, slant: 0.16 }
  }

  if (browWeight === 'low') {
    return { y: 0.086, height: 0.008, slant: 0.08 }
  }

  return { y: 0.09, height: 0.011, slant: 0.12 }
}

function getAvatarMouthWidth(faceStyle: ThreePlayerView['avatarProfile']['faceStyle']) {
  if (faceStyle === 'focused') {
    return 0.078
  }

  if (faceStyle === 'smirk') {
    return 0.11
  }

  return 0.09
}

function ChipStack({
  position,
  colors,
  count,
}: {
  position: Vec3
  colors: [string, string]
  count: number
}) {
  return (
    <group position={position}>
      {Array.from({ length: count }).map((_, index) => (
        <Chip3D
          key={index}
          position={[0, index * 0.025, 0]}
          color={index % 2 === 0 ? colors[0] : colors[1]}
          stripeColor={index % 2 === 0 ? colors[1] : colors[0]}
        />
      ))}
    </group>
  )
}

function Chip3D({
  position,
  color,
  stripeColor,
}: {
  position: Vec3
  color: string
  stripeColor: string
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.095, 0.095, 0.022, 32]} />
        <meshStandardMaterial color={color} roughness={0.34} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.013, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.063, 0.006, 6, 28]} />
        <meshStandardMaterial color={stripeColor} roughness={0.28} metalness={0.28} />
      </mesh>
      {[0, Math.PI / 2].map(rotation => (
        <mesh key={rotation} position={[0, 0.014, 0]} rotation={[0, rotation, 0]}>
          <boxGeometry args={[0.018, 0.006, 0.16]} />
          <meshStandardMaterial color={stripeColor} roughness={0.3} metalness={0.24} />
        </mesh>
      ))}
    </group>
  )
}

function CardGhost({ position, rotation }: { position: Vec3; rotation: Vec3 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={[0.34, 0.018, 0.48]} />
      <meshStandardMaterial color="#f4ead3" roughness={0.42} metalness={0.02} />
    </mesh>
  )
}

function CardBack3D({
  position,
  rotation,
  isActing,
}: {
  position: Vec3
  rotation: Vec3
  isActing: boolean
}) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[0.17, 0.014, 0.245]} radius={0.016} smoothness={4} castShadow>
        <meshStandardMaterial
          color={isActing ? '#7b2233' : '#263044'}
          roughness={0.38}
          metalness={0.08}
          transparent
          opacity={0.88}
        />
      </RoundedBox>
      <mesh position={[0, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.62, 0.88, 1]}>
        <ringGeometry args={[0.085, 0.093, 28]} />
        <meshStandardMaterial color="#d9b56d" roughness={0.34} metalness={0.38} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

function getChipCount(amount: number): number {
  if (amount <= 0) {
    return 0
  }

  return Math.min(9, Math.max(2, Math.ceil(Math.log10(amount + 1) * 2)))
}

function truncateLabel(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}.` : value
}
