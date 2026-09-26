import * as THREE from 'three'
import {
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_WAGER_SEMI_AXIS_X,
  TABLE_WAGER_SEMI_AXIS_Z,
} from './tableWagerLayout'
import { getFeltTexture, getLeatherBumpTexture, type FeltLayout } from './sceneTextures'

/** Top of the felt surface. Chips, wagers and board cards rest on this plane. */
export const FELT_TOP_Y = 0.4
export const RAIL_WIDTH = 0.66
export const RAIL_PEAK_Y = FELT_TOP_Y + 0.26

export const BOARD_CARD_WIDTH = 0.62
export const BOARD_CARD_DEPTH = BOARD_CARD_WIDTH * (88 / 63)
export const BOARD_CARD_GAP = 0.12
export const BOARD_Z = -0.12
export const BOARD_XS = [-2, -1, 0, 1, 2].map(index => index * (BOARD_CARD_WIDTH + BOARD_CARD_GAP))

export const FELT_LAYOUT: FeltLayout = {
  semiX: TABLE_FELT_SEMI_AXIS_X,
  semiZ: TABLE_FELT_SEMI_AXIS_Z,
  lineX: TABLE_WAGER_SEMI_AXIS_X * 1.02,
  lineZ: TABLE_WAGER_SEMI_AXIS_Z * 1.02,
  boardXs: BOARD_XS,
  boardZ: BOARD_Z,
  cardWidth: BOARD_CARD_WIDTH,
  cardDepth: BOARD_CARD_DEPTH,
}

type Profile = ReadonlyArray<readonly [number, number]>

/**
 * The felt-edge point facing a seat and the rail's outward normal there, in
 * world XZ. Seats use it to rest hands on the rail and place hole cards.
 */
export function getFeltEdgeToward(seatX: number, seatZ: number) {
  const angle = Math.atan2(seatZ / TABLE_FELT_SEMI_AXIS_Z, seatX / TABLE_FELT_SEMI_AXIS_X)
  const edge = new THREE.Vector2(
    Math.cos(angle) * TABLE_FELT_SEMI_AXIS_X,
    Math.sin(angle) * TABLE_FELT_SEMI_AXIS_Z
  )
  const normal = new THREE.Vector2(
    Math.cos(angle) / TABLE_FELT_SEMI_AXIS_X,
    Math.sin(angle) / TABLE_FELT_SEMI_AXIS_Z
  ).normalize()
  return { edge, normal }
}

/**
 * Sweeps a 2D cross-section around the felt ellipse. Profile points are
 * (outward offset from the felt edge, height). Normals come from the mesh so
 * the padded rail shades as one smooth cushion.
 */
function sweepAroundEllipse(profile: Profile, segments = 192, closeProfile = false) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const columns = profile.length
  let perimeter = 0
  let previous: THREE.Vector2 | null = null
  const perimeterAt: number[] = []

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = (segment / segments) * Math.PI * 2
    const x = Math.cos(t) * TABLE_FELT_SEMI_AXIS_X
    const z = Math.sin(t) * TABLE_FELT_SEMI_AXIS_Z
    const point = new THREE.Vector2(x, z)
    if (previous) perimeter += point.distanceTo(previous)
    previous = point
    perimeterAt.push(perimeter)
  }

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = (segment / segments) * Math.PI * 2
    const x = Math.cos(t) * TABLE_FELT_SEMI_AXIS_X
    const z = Math.sin(t) * TABLE_FELT_SEMI_AXIS_Z
    const normal = new THREE.Vector2(
      Math.cos(t) / TABLE_FELT_SEMI_AXIS_X,
      Math.sin(t) / TABLE_FELT_SEMI_AXIS_Z
    ).normalize()
    profile.forEach(([offset, height], column) => {
      positions.push(x + normal.x * offset, height, z + normal.y * offset)
      uvs.push(perimeterAt[segment]! / 1.6, column / Math.max(1, columns - 1))
    })
  }

  const rows = closeProfile ? columns : columns - 1
  for (let segment = 0; segment < segments; segment += 1) {
    for (let column = 0; column < rows; column += 1) {
      const nextColumn = (column + 1) % columns
      const a = segment * columns + column
      const b = (segment + 1) * columns + column
      const c = (segment + 1) * columns + nextColumn
      const d = segment * columns + nextColumn
      indices.push(a, b, d, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function railCushionProfile(): Profile {
  const points: Array<readonly [number, number]> = []
  const inner = 0.06
  const outer = RAIL_WIDTH
  const base = FELT_TOP_Y + 0.02
  const steps = 18
  for (let step = 0; step <= steps; step += 1) {
    const angle = Math.PI - (step / steps) * Math.PI
    const u = (Math.cos(angle) + 1) / 2
    const offset = inner + u * (outer - inner)
    // Slightly asymmetric: a fuller outer shoulder where players rest arms.
    const bulge = Math.sin((step / steps) * Math.PI)
    const height = base + bulge * (RAIL_PEAK_Y - base) * (0.92 + 0.08 * u)
    points.push([offset, height])
  }
  points.push([outer + 0.02, base - 0.08])
  points.push([outer - 0.02, base - 0.16])
  return points
}

export interface TableArt {
  group: THREE.Group
  feltMaterial: THREE.MeshStandardMaterial
  brassMaterial: THREE.MeshStandardMaterial
}

export function createStylizedTable(): TableArt {
  const group = new THREE.Group()
  group.name = 'stylized-poker-table'

  const feltShape = new THREE.Shape()
  feltShape.absellipse(0, 0, TABLE_FELT_SEMI_AXIS_X, TABLE_FELT_SEMI_AXIS_Z, 0, Math.PI * 2, false, 0)
  const feltGeometry = new THREE.ShapeGeometry(feltShape, 96)
  feltGeometry.rotateX(-Math.PI / 2)
  // ShapeGeometry lies in XY; after rotation shape-Y becomes world -Z. Rebuild
  // UVs from world positions so the printed layout lines up with world space.
  const feltPositions = feltGeometry.getAttribute('position')
  const feltUvs = new Float32Array(feltPositions.count * 2)
  for (let index = 0; index < feltPositions.count; index += 1) {
    const x = feltPositions.getX(index)
    const z = feltPositions.getZ(index)
    feltUvs[index * 2] = (x + TABLE_FELT_SEMI_AXIS_X) / (TABLE_FELT_SEMI_AXIS_X * 2)
    feltUvs[index * 2 + 1] = 1 - (z + TABLE_FELT_SEMI_AXIS_Z) / (TABLE_FELT_SEMI_AXIS_Z * 2)
  }
  feltGeometry.setAttribute('uv', new THREE.BufferAttribute(feltUvs, 2))
  feltGeometry.translate(0, FELT_TOP_Y, 0)

  const feltTexture = getFeltTexture(FELT_LAYOUT)
  feltTexture.flipY = true
  const feltMaterial = new THREE.MeshStandardMaterial({
    map: feltTexture,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.35,
  })
  const felt = new THREE.Mesh(feltGeometry, feltMaterial)
  felt.name = 'printed-felt'
  felt.receiveShadow = true
  group.add(felt)

  const leatherBump = getLeatherBumpTexture()
  leatherBump.repeat.set(1, 1)
  const railMaterial = new THREE.MeshStandardMaterial({
    color: '#3a1f19',
    roughness: 0.46,
    metalness: 0.02,
    bumpMap: leatherBump,
    bumpScale: 0.6,
    envMapIntensity: 0.9,
  })
  const rail = new THREE.Mesh(sweepAroundEllipse(railCushionProfile()), railMaterial)
  rail.name = 'padded-leather-rail'
  rail.castShadow = true
  rail.receiveShadow = true
  group.add(rail)

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: '#e0b25a',
    roughness: 0.26,
    metalness: 1,
    envMapIntensity: 1.25,
  })
  const inlay = new THREE.Mesh(
    sweepAroundEllipse([
      [-0.02, FELT_TOP_Y + 0.002],
      [0.0, FELT_TOP_Y + 0.05],
      [0.07, FELT_TOP_Y + 0.055],
      [0.08, FELT_TOP_Y + 0.02],
    ]),
    brassMaterial
  )
  inlay.name = 'brass-felt-inlay'
  inlay.receiveShadow = true
  group.add(inlay)

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: '#5c351f',
    roughness: 0.5,
    metalness: 0.05,
    envMapIntensity: 0.7,
  })
  const apron = new THREE.Mesh(
    // A deep wooden skirt: hides the players' legs and grounds the table.
    sweepAroundEllipse([
      [RAIL_WIDTH - 0.02, FELT_TOP_Y - 0.14],
      [RAIL_WIDTH - 0.04, FELT_TOP_Y - 0.32],
      [RAIL_WIDTH - 0.1, FELT_TOP_Y - 0.36],
      [RAIL_WIDTH - 0.12, FELT_TOP_Y - 1.5],
      [RAIL_WIDTH - 0.02, FELT_TOP_Y - 1.58],
      [RAIL_WIDTH - 0.02, FELT_TOP_Y - 1.66],
      [0.2, FELT_TOP_Y - 1.7],
    ]),
    woodMaterial
  )
  apron.name = 'wood-apron'
  apron.castShadow = true
  apron.receiveShadow = true
  group.add(apron)

  const underside = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ color: '#1a0f0a', roughness: 0.9 })
  )
  underside.rotation.x = Math.PI / 2
  underside.scale.set(TABLE_FELT_SEMI_AXIS_X + 0.2, TABLE_FELT_SEMI_AXIS_Z + 0.2, 1)
  underside.position.y = FELT_TOP_Y - 1.7
  group.add(underside)

  const pedestalMaterial = new THREE.MeshStandardMaterial({
    color: '#241611',
    roughness: 0.4,
    metalness: 0.2,
    envMapIntensity: 0.8,
  })
  const pedestal = new THREE.Mesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0.9, -1.98),
      new THREE.Vector2(1.9, -1.96),
      new THREE.Vector2(1.96, -1.84),
      new THREE.Vector2(1.1, -1.7),
      new THREE.Vector2(0.62, -1.2),
      new THREE.Vector2(0.58, -0.6),
      new THREE.Vector2(0.9, -0.24),
    ], 48),
    pedestalMaterial
  )
  pedestal.scale.x = 1.5
  pedestal.name = 'table-pedestal'
  pedestal.castShadow = true
  pedestal.receiveShadow = true
  group.add(pedestal)

  return { group, feltMaterial, brassMaterial }
}

/** Wooden club chair with a curved padded back, sized to the seat root. */
export function createStylizedChair(
  upholstery: THREE.ColorRepresentation,
  trim: THREE.ColorRepresentation
) {
  const group = new THREE.Group()
  group.name = 'club-chair'
  const upholsteryMaterial = new THREE.MeshStandardMaterial({
    color: upholstery,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.7,
  })
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: trim,
    roughness: 0.38,
    metalness: 0.35,
    envMapIntensity: 1,
  })

  const backShape = new THREE.Shape()
  backShape.moveTo(-0.7, 0)
  backShape.lineTo(0.7, 0)
  backShape.quadraticCurveTo(0.76, 0.9, 0.52, 1.46)
  backShape.quadraticCurveTo(0, 1.72, -0.52, 1.46)
  backShape.quadraticCurveTo(-0.76, 0.9, -0.7, 0)
  const back = new THREE.Mesh(
    new THREE.ExtrudeGeometry(backShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 4,
      curveSegments: 18,
    }),
    upholsteryMaterial
  )
  back.position.set(0, -0.02, 0.5)
  back.rotation.x = -0.12
  back.castShadow = true
  back.receiveShadow = true
  group.add(back)

  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.66, 0.62, 0.2, 32),
    upholsteryMaterial
  )
  seat.scale.z = 0.72
  seat.position.set(0, -0.06, 0.18)
  seat.castShadow = true
  seat.receiveShadow = true
  group.add(seat)

  const skirt = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.045, 10, 40), woodMaterial)
  skirt.rotation.x = Math.PI / 2
  skirt.scale.y = 0.72
  skirt.position.set(0, -0.16, 0.18)
  group.add(skirt)

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 16), woodMaterial)
  stem.position.set(0, -0.52, 0.2)
  stem.castShadow = true
  group.add(stem)

  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.06, 28), woodMaterial)
  foot.position.set(0, -0.86, 0.2)
  foot.receiveShadow = true
  group.add(foot)

  return { group, materials: [upholsteryMaterial, woodMaterial] }
}
