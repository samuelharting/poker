import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  TABLE_SEAT_POSITIONS,
  TABLE_FELT_SEMI_AXIS_X,
  TABLE_FELT_SEMI_AXIS_Z,
  TABLE_WAGER_SEMI_AXIS_X,
  TABLE_WAGER_SEMI_AXIS_Z,
} from './tableWagerLayout'
import {
  getFeltTexture,
  getFeltWeaveTexture,
  getLeatherBumpTexture,
  getRailLeatherTexture,
  getTuftedLeatherTexture,
  getWalnutTexture,
  type FeltLayout,
} from './sceneTextures'

/** Top of the felt surface. Chips, wagers and board cards rest on this plane. */
export const FELT_TOP_Y = 0.4
export const RAIL_WIDTH = 0.66
export const RAIL_PEAK_Y = FELT_TOP_Y + 0.26

export const BOARD_CARD_WIDTH = 0.68
export const BOARD_CARD_DEPTH = BOARD_CARD_WIDTH * (88 / 63)
export const BOARD_CARD_GAP = 0.1
/** Radians the board cards lean back from flat (~50 degrees) so they face the camera. */
export const BOARD_CARD_TILT = 0.88
/** The little stand each board card is seated in (depth along Z, height above the felt). */
export const BOARD_STAND_DEPTH = 0.15
export const BOARD_STAND_HEIGHT = 0.07
/** Felt area a propped card really covers: its slanted footprint plus the stand lip. */
export const BOARD_CARD_FOOTPRINT_DEPTH = BOARD_CARD_DEPTH * Math.cos(BOARD_CARD_TILT) + BOARD_STAND_DEPTH
export const BOARD_Z = -0.3
export const BOARD_XS = [-2, -1, 0, 1, 2].map(index => index * (BOARD_CARD_WIDTH + BOARD_CARD_GAP))

export const FELT_LAYOUT: FeltLayout = {
  semiX: TABLE_FELT_SEMI_AXIS_X,
  semiZ: TABLE_FELT_SEMI_AXIS_Z,
  lineX: TABLE_WAGER_SEMI_AXIS_X * 1.02,
  lineZ: TABLE_WAGER_SEMI_AXIS_Z * 1.02,
  boardXs: BOARD_XS,
  boardZ: BOARD_Z,
  cardWidth: BOARD_CARD_WIDTH,
  cardDepth: BOARD_CARD_FOOTPRINT_DEPTH,
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

/** Height of the cushion at a given outward offset (mirrors railCushionProfile). */
function railHeightAt(offset: number) {
  const inner = 0.06
  const u = THREE.MathUtils.clamp((offset - inner) / (RAIL_WIDTH - inner), 0, 1)
  const angle = Math.acos(2 * u - 1)
  const base = FELT_TOP_Y + 0.02
  return base + Math.sin(angle) * (RAIL_PEAK_Y - base) * (0.92 + 0.08 * u)
}

/**
 * Brass-rimmed drink wells set into the padded rail, one in each gap between
 * neighbouring seats. Two merged meshes for the whole ring of them.
 */
function addCupHolders(group: THREE.Group, brassMaterial: THREE.Material) {
  const angles = Object.values(TABLE_SEAT_POSITIONS)
    .map(([x, , z]) => Math.atan2(z / TABLE_FELT_SEMI_AXIS_Z, x / TABLE_FELT_SEMI_AXIS_X))
    .sort((a, b) => a - b)
  const offset = RAIL_WIDTH * 0.55
  const top = railHeightAt(offset)
  const rings: THREE.BufferGeometry[] = []
  const wells: THREE.BufferGeometry[] = []
  angles.forEach((angle, index) => {
    const next = index === angles.length - 1 ? angles[0]! + Math.PI * 2 : angles[index + 1]!
    const t = (angle + next) / 2
    const normal = new THREE.Vector2(Math.cos(t) / TABLE_FELT_SEMI_AXIS_X, Math.sin(t) / TABLE_FELT_SEMI_AXIS_Z).normalize()
    const x = Math.cos(t) * TABLE_FELT_SEMI_AXIS_X + normal.x * offset
    const z = Math.sin(t) * TABLE_FELT_SEMI_AXIS_Z + normal.y * offset
    const ring = new THREE.TorusGeometry(0.125, 0.016, 8, 32)
    ring.rotateX(Math.PI / 2)
    ring.translate(x, top + 0.006, z)
    rings.push(ring)
    const well = new THREE.CylinderGeometry(0.118, 0.1, 0.03, 28)
    well.translate(x, top - 0.006, z)
    wells.push(well)
  })
  const ringMerged = mergeGeometries(rings, false)
  const wellMerged = mergeGeometries(wells, false)
  rings.forEach(part => part.dispose())
  wells.forEach(part => part.dispose())
  if (ringMerged) {
    const mesh = new THREE.Mesh(ringMerged, brassMaterial)
    mesh.name = 'cup-holder-rims'
    group.add(mesh)
  }
  if (wellMerged) {
    const mesh = new THREE.Mesh(wellMerged, new THREE.MeshStandardMaterial({ color: '#120807', roughness: 0.7, metalness: 0.1 }))
    mesh.name = 'cup-holder-wells'
    group.add(mesh)
  }
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
  // Cloth weave as a finely repeated bump: reads as baize under the key light
  // without touching the printed layout's colours.
  const feltWeave = getFeltWeaveTexture()
  feltWeave.repeat.set(150, 96)
  const feltMaterial = new THREE.MeshStandardMaterial({
    map: feltTexture,
    bumpMap: feltWeave,
    bumpScale: 0.35,
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
  // Oxblood leather with panel seams and saddle stitching painted into the wrap.
  const railMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: getRailLeatherTexture(),
    roughness: 0.4,
    metalness: 0.02,
    bumpMap: leatherBump,
    bumpScale: 0.5,
    envMapIntensity: 1.05,
  })
  const rail = new THREE.Mesh(sweepAroundEllipse(railCushionProfile()), railMaterial)
  rail.name = 'padded-leather-rail'
  rail.castShadow = true
  rail.receiveShadow = true
  group.add(rail)

  // Brushed, slightly aged brass: a polished finish turned the key spot into
  // one blown white streak along the inner rail.
  const brassMaterial = new THREE.MeshStandardMaterial({
    color: '#c99a4c',
    roughness: 0.46,
    metalness: 0.9,
    envMapIntensity: 0.85,
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

  // Brass beading where the leather cushion meets the walnut skirt: a thin
  // rounded bead that catches the key light and finishes the rail edge.
  const railBead = new THREE.Mesh(
    sweepAroundEllipse([
      [RAIL_WIDTH - 0.05, FELT_TOP_Y - 0.1],
      [RAIL_WIDTH - 0.01, FELT_TOP_Y - 0.115],
      [RAIL_WIDTH + 0.025, FELT_TOP_Y - 0.15],
      [RAIL_WIDTH + 0.02, FELT_TOP_Y - 0.19],
      [RAIL_WIDTH - 0.02, FELT_TOP_Y - 0.21],
      [RAIL_WIDTH - 0.06, FELT_TOP_Y - 0.17],
    ], 192, true),
    brassMaterial
  )
  railBead.name = 'brass-rail-bead'
  railBead.castShadow = true
  group.add(railBead)

  addCupHolders(group, brassMaterial)

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: getWalnutTexture(),
    roughness: 0.34,
    metalness: 0.05,
    envMapIntensity: 0.9,
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
  // Map V to real height (one texture tile per 1.6 units, like U) so the
  // walnut grain isn't stretched down the tall skirt.
  const apronPositions = apron.geometry.getAttribute('position')
  const apronUvs = apron.geometry.getAttribute('uv')
  for (let index = 0; index < apronUvs.count; index += 1) {
    apronUvs.setY(index, (FELT_TOP_Y - apronPositions.getY(index)) / 1.6)
  }
  apronUvs.needsUpdate = true
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


/** House leather the per-player chair colours are pulled toward, so the set matches. */
const HOUSE_LEATHER = new THREE.Color('#5a1e22')
const CHAIR_WOOD = new THREE.Color('#3a2217')

/**
 * Padded tub-chair shell: a rounded pillow cross-section swept around the back
 * of the seat. Tall in the middle, sweeping down into low arms at the sides.
 * UVs are in world units (arc length, height) so the tufting tile stays square.
 */
const SHELL = {
  radiusX: 0.66,
  radiusZ: 0.56,
  centerZ: 0.16,
  thickness: 0.2,
  baseY: -0.12,
  backTop: 1.5,
  armTop: 0.36,
} as const
const SHELL_MAX_ANGLE = THREE.MathUtils.degToRad(118)

/** Point on the tub shell: theta around the back, r off the centreline, y absolute or on the pillow cap. */
function shellCapPoint(theta: number, capAngle: number) {
  const { radiusX, radiusZ, centerZ, thickness, backTop, armTop } = SHELL
  const across = Math.abs(theta) / SHELL_MAX_ANGLE
  const height = armTop + (backTop - armTop) * (1 - THREE.MathUtils.smoothstep(across, 0.22, 0.62))
  const lean = 0.1 * (1 - THREE.MathUtils.smoothstep(across, 0.2, 0.6))
  const sin = Math.sin(theta)
  const cos = Math.cos(theta)
  const normal = new THREE.Vector2(sin / radiusX, cos / radiusZ).normalize()
  const y = height - thickness / 2 + Math.sin(capAngle) * (thickness / 2)
  const offset = Math.cos(capAngle) * (thickness / 2) + lean * (y / backTop) * 1
  return new THREE.Vector3(sin * radiusX + normal.x * offset, y, centerZ + cos * radiusZ + normal.y * offset)
}

/** Point on the outer face of the shell at a fixed height (for nailhead trim). */
function shellSidePoint(theta: number, y: number, outward: number) {
  const { radiusX, radiusZ, centerZ, thickness } = SHELL
  const sin = Math.sin(theta)
  const cos = Math.cos(theta)
  const normal = new THREE.Vector2(sin / radiusX, cos / radiusZ).normalize()
  const offset = thickness / 2 + outward
  return new THREE.Vector3(sin * radiusX + normal.x * offset, y, centerZ + cos * radiusZ + normal.y * offset)
}

function createTubShell() {
  const { radiusX, radiusZ, centerZ, thickness, baseY, backTop, armTop } = SHELL
  const maxAngle = SHELL_MAX_ANGLE
  const segments = 40
  const capSteps = 8
  // Profile loop in (radial offset, height fraction of the pillow top).
  const profile: Array<{ r: number; top: boolean; angle: number }> = []
  profile.push({ r: -thickness / 2, top: false, angle: 0 })
  for (let step = 0; step <= capSteps; step += 1) {
    const a = Math.PI - (step / capSteps) * Math.PI
    profile.push({ r: Math.cos(a) * (thickness / 2), top: true, angle: a })
  }
  profile.push({ r: thickness / 2, top: false, angle: 0 })
  const columns = profile.length

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const rows = segments + 1
  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments
    const theta = (t * 2 - 1) * maxAngle
    const across = Math.abs(theta) / maxAngle
    const height = armTop + (backTop - armTop) * (1 - THREE.MathUtils.smoothstep(across, 0.22, 0.62))
    // Roll the top of the back outward a touch for a lounge silhouette.
    const lean = 0.1 * (1 - THREE.MathUtils.smoothstep(across, 0.2, 0.6))
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const normal = new THREE.Vector2(sin / radiusX, cos / radiusZ).normalize()
    for (const point of profile) {
      const y = point.top ? height - thickness / 2 + Math.sin(point.angle) * (thickness / 2) : baseY
      const lift = point.top ? lean * (y / backTop) : 0
      const x = sin * radiusX + normal.x * (point.r + lift)
      const z = centerZ + cos * radiusZ + normal.y * (point.r + lift)
      positions.push(x, y, z)
      uvs.push(theta * 0.62, y)
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    for (let column = 0; column < columns; column += 1) {
      const next = (column + 1) % columns
      const a = segment * columns + column
      const b = (segment + 1) * columns + column
      const c = (segment + 1) * columns + next
      const d = segment * columns + next
      indices.push(a, d, b, b, d, c)
    }
  }
  // Rounded arm ends: fan each end ring into its centroid.
  for (const [ring, flip] of [[0, true], [rows - 1, false]] as const) {
    const centroid = new THREE.Vector3()
    for (let column = 0; column < columns; column += 1) {
      const index = (ring * columns + column) * 3
      centroid.x += positions[index]!
      centroid.y += positions[index + 1]!
      centroid.z += positions[index + 2]!
    }
    centroid.divideScalar(columns)
    const center = positions.length / 3
    positions.push(centroid.x, centroid.y, centroid.z)
    uvs.push(0, 0)
    for (let column = 0; column < columns; column += 1) {
      const a = ring * columns + column
      const b = ring * columns + ((column + 1) % columns)
      if (flip) indices.push(center, b, a)
      else indices.push(center, a, b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function paint(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function prepare(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, keepColor = false) {
  const transformed = geometry.index ? geometry.toNonIndexed() : geometry
  transformed.applyMatrix4(matrix)
  for (const name of Object.keys(transformed.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColor && name === 'color')) {
      transformed.deleteAttribute(name)
    }
  }
  if (!transformed.getAttribute('uv')) {
    transformed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(transformed.getAttribute('position').count * 2), 2))
  }
  return transformed
}

const composeMatrix = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
  scale: readonly [number, number, number] = [1, 1, 1]
) => new THREE.Matrix4().compose(
  new THREE.Vector3(...position),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
  new THREE.Vector3(...scale)
)

/**
 * Button-tufted leather tub chair on four slim walnut legs with a brass foot
 * ring (the table is a high-top, so the seat sits well above the carpet).
 * Everything merges into one mesh with two material groups: upholstery, and a
 * vertex-coloured wood/brass frame.
 */
export function createStylizedChair(
  upholstery: THREE.ColorRepresentation,
  trim: THREE.ColorRepresentation
) {
  const group = new THREE.Group()
  group.name = 'club-chair'

  const leather = new THREE.Color(upholstery).lerp(HOUSE_LEATHER, 0.45)
  const tuftColor = getTuftedLeatherTexture()
  tuftColor.repeat.set(3.4, 3.4)
  const tuftBump = getTuftedLeatherTexture(true)
  tuftBump.repeat.set(3.4, 3.4)
  const upholsteryMaterial = new THREE.MeshStandardMaterial({
    color: leather,
    map: tuftColor,
    bumpMap: tuftBump,
    bumpScale: 1.4,
    roughness: 0.42,
    metalness: 0.04,
    envMapIntensity: 1.1,
  })
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.34,
    metalness: 0.45,
    envMapIntensity: 1.1,
  })

  const brass = new THREE.Color(trim)
  const upholsteryParts: THREE.BufferGeometry[] = []
  const frameParts: THREE.BufferGeometry[] = []

  upholsteryParts.push(prepare(createTubShell(), new THREE.Matrix4()))

  // Plump seat cushion with a rolled front edge.
  const cushion = new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.1),
    new THREE.Vector2(0.5, -0.1),
    new THREE.Vector2(0.6, -0.07),
    new THREE.Vector2(0.64, 0),
    new THREE.Vector2(0.61, 0.07),
    new THREE.Vector2(0.52, 0.1),
    new THREE.Vector2(0, 0.12),
  ], 36)
  upholsteryParts.push(prepare(cushion, composeMatrix([0, -0.06, 0.12], [0, 0, 0], [1, 1, 0.82])))

  // Walnut seat rail under the cushion.
  const apron = paint(new THREE.CylinderGeometry(0.6, 0.56, 0.12, 36, 1, true), CHAIR_WOOD)
  frameParts.push(prepare(apron, composeMatrix([0, -0.2, 0.12], [0, 0, 0], [1, 1, 0.82]), true))
  const piping = paint(new THREE.TorusGeometry(0.61, 0.018, 6, 48), brass)
  frameParts.push(prepare(piping, composeMatrix([0, -0.145, 0.12], [Math.PI / 2, 0, 0], [1, 0.82, 1]), true))

  // Brass piping along both crest edges of the shell, from arm tip over the
  // back to the other arm: the silhouette-defining line of a lounge chair.
  for (const capAngle of [Math.PI * 0.2, Math.PI * 0.8]) {
    const points: THREE.Vector3[] = []
    for (let step = 0; step <= 48; step += 1) {
      points.push(shellCapPoint(((step / 48) * 2 - 1) * SHELL_MAX_ANGLE * 0.985, capAngle))
    }
    const tube = paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, 0.013, 6, false), brass)
    frameParts.push(prepare(tube, new THREE.Matrix4(), true))
  }
  // Row of brass nailheads around the lower outer skirt of the shell.
  const nailGeometry = new THREE.SphereGeometry(0.019, 6, 4)
  for (let step = 0; step <= 34; step += 1) {
    const theta = ((step / 34) * 2 - 1) * SHELL_MAX_ANGLE * 0.96
    const point = shellSidePoint(theta, 0.06, 0.004)
    frameParts.push(prepare(paint(nailGeometry.clone(), brass), composeMatrix([point.x, point.y, point.z]), true))
  }
  nailGeometry.dispose()

  // Four slim, slightly splayed legs down to the carpet (floor is ~2 below the seat root).
  const floorY = -2.02
  const legTopY = -0.24
  const legLength = legTopY - floorY
  for (const [x, z] of [[-0.42, -0.2], [0.42, -0.2], [-0.4, 0.46], [0.4, 0.46]] as const) {
    const splayX = Math.sign(x) * 0.06
    const splayZ = (z > 0.1 ? 1 : -1) * 0.05
    const leg = paint(new THREE.CylinderGeometry(0.048, 0.03, legLength, 10), CHAIR_WOOD)
    const tilt: [number, number, number] = [-splayZ / legLength, 0, splayX / legLength]
    frameParts.push(prepare(leg, composeMatrix([x + splayX / 2, (legTopY + floorY) / 2, z + splayZ / 2], tilt), true))
    const ferrule = paint(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), brass)
    frameParts.push(prepare(ferrule, composeMatrix([x + splayX, floorY + 0.04, z + splayZ]), true))
  }
  // Walnut stretchers tie the legs together so the frame reads as one piece.
  for (const [ax, az, bx, bz] of [[-0.4, 0.46, 0.4, 0.46], [-0.42, -0.2, 0.42, -0.2], [-0.4, 0.46, -0.42, -0.2], [0.4, 0.46, 0.42, -0.2]] as const) {
    const length = Math.hypot(bx - ax, bz - az)
    const bar = paint(new THREE.CylinderGeometry(0.02, 0.02, length, 8), CHAIR_WOOD)
    bar.rotateX(Math.PI / 2)
    bar.rotateY(Math.atan2(bx - ax, bz - az))
    bar.translate((ax + bx) / 2, -1.62, (az + bz) / 2)
    frameParts.push(prepare(bar, new THREE.Matrix4(), true))
  }
  // Brass foot ring where the players rest their feet.
  const footRing = paint(new THREE.TorusGeometry(0.5, 0.022, 8, 48), brass)
  frameParts.push(prepare(footRing, composeMatrix([0, -1.25, 0.13], [Math.PI / 2, 0, 0], [1.04, 0.86, 1]), true))

  const upholsteryGeometry = mergeGeometries(upholsteryParts, false)
  const frameGeometry = mergeGeometries(frameParts, false)
  upholsteryParts.forEach(part => part.dispose())
  frameParts.forEach(part => part.dispose())
  if (upholsteryGeometry && frameGeometry) {
    // Multi-material merge needs matching attributes; upholstery ignores colour.
    paint(upholsteryGeometry, new THREE.Color('#ffffff'))
    const merged = mergeGeometries([upholsteryGeometry, frameGeometry], true)
    upholsteryGeometry.dispose()
    frameGeometry.dispose()
    if (merged) {
      const chairMesh = new THREE.Mesh(merged, [upholsteryMaterial, frameMaterial])
      chairMesh.castShadow = true
      chairMesh.receiveShadow = true
      chairMesh.name = 'club-chair-mesh'
      group.add(chairMesh)
    }
  }

  return { group, materials: [upholsteryMaterial, frameMaterial] }
}
