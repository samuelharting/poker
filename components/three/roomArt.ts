import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { drawSuit, getWalnutTexture } from './sceneTextures'

/**
 * Speakeasy lounge dressing for the desktop room: painted wall treatments,
 * an art-deco carpet, the lit back bar, velvet drapes and potted palms.
 * Everything static is merged per material so the whole room stays a handful
 * of draw calls, and detail lives in canvas textures rather than meshes.
 */

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function canvasTexture(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  repeat?: [number, number]
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...repeat)
  }
  return texture
}

/**
 * One 3.2-wide bay of the upper wall (the full 14-unit wall height, y -2..12):
 * shadowy frieze, a gilt crown line, then deep teal wallpaper with a faint
 * spade-and-club damask lattice and soft pilaster shading at the bay edges.
 */
export function createLoungeWallTexture() {
  return canvasTexture(512, 1024, (context, width, height) => {
    const toY = (worldY: number) => ((12 - worldY) / 14) * height
    const paper = context.createLinearGradient(0, toY(7), 0, toY(0.8))
    paper.addColorStop(0, '#0a2224')
    paper.addColorStop(1, '#0f3131')
    context.fillStyle = paper
    context.fillRect(0, 0, width, height)

    // Damask lattice of tiny suit motifs.
    const cellX = width / 4
    const cellY = cellX * 1.3
    for (let row = 0; row * cellY < toY(0.8); row += 1) {
      for (let column = 0; column <= 4; column += 1) {
        const x = column * cellX + (row % 2 ? cellX / 2 : 0)
        const y = toY(6.6) + row * cellY
        if (y > toY(0.9)) continue
        drawSuit(context, row % 2 ? 'clubs' : 'spades', x, y, cellX * 0.28, 'rgba(214, 178, 104, 0.075)')
        context.strokeStyle = 'rgba(214, 178, 104, 0.05)'
        context.lineWidth = 2
        context.beginPath()
        context.moveTo(x, y - cellY * 0.36)
        context.lineTo(x + cellX * 0.32, y)
        context.lineTo(x, y + cellY * 0.36)
        context.lineTo(x - cellX * 0.32, y)
        context.closePath()
        context.stroke()
      }
    }

    // Pilaster shading at the bay edges so the wall reads as panelled.
    for (const [x0, x1] of [[0, 26], [width - 26, width]] as const) {
      const edge = context.createLinearGradient(x0, 0, x1, 0)
      edge.addColorStop(0, x0 === 0 ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)')
      edge.addColorStop(1, x0 === 0 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.4)')
      context.fillStyle = edge
      context.fillRect(x0, toY(6.5), x1 - x0, toY(0.9) - toY(6.5))
    }

    // Frieze above the crown line fades into the ceiling shadow.
    const frieze = context.createLinearGradient(0, 0, 0, toY(6.5))
    frieze.addColorStop(0, '#040a0b')
    frieze.addColorStop(1, '#0a1a1b')
    context.fillStyle = frieze
    context.fillRect(0, 0, width, toY(6.5))
    context.fillStyle = '#2a1810'
    context.fillRect(0, toY(6.62), width, toY(6.3) - toY(6.62))
    context.fillStyle = 'rgba(226, 184, 102, 0.75)'
    context.fillRect(0, toY(6.3), width, 3)
    context.fillRect(0, toY(6.62), width, 2)

    // Lower wall (behind the wainscot box) stays dark wood.
    context.fillStyle = '#24140c'
    context.fillRect(0, toY(0.95), width, height - toY(0.95))
  }, [10, 1])
}

/** Raised-panel walnut wainscot, one panel per repeat. */
export function createWainscotTexture(repeatX: number) {
  return canvasTexture(256, 256, (context, width, height) => {
    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#4a2a18')
    base.addColorStop(1, '#2e190e')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0x3a15c07)
    for (let line = 0; line < 50; line += 1) {
      context.strokeStyle = random() > 0.5 ? 'rgba(20, 8, 2, 0.25)' : 'rgba(140, 86, 48, 0.12)'
      context.lineWidth = 1 + random()
      const y = random() * height
      context.beginPath()
      context.moveTo(0, y)
      context.bezierCurveTo(width * 0.3, y + random() * 6 - 3, width * 0.7, y + random() * 6 - 3, width, y)
      context.stroke()
    }
    const inset = 26
    // Bevel: light top/left, dark bottom/right, then a gilt bead.
    context.lineWidth = 6
    context.strokeStyle = 'rgba(255, 210, 160, 0.14)'
    context.beginPath()
    context.moveTo(inset, height - inset)
    context.lineTo(inset, inset)
    context.lineTo(width - inset, inset)
    context.stroke()
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    context.beginPath()
    context.moveTo(width - inset, inset)
    context.lineTo(width - inset, height - inset)
    context.lineTo(inset, height - inset)
    context.stroke()
    context.strokeStyle = 'rgba(226, 184, 102, 0.35)'
    context.lineWidth = 1.5
    context.strokeRect(inset + 8, inset + 8, width - (inset + 8) * 2, height - (inset + 8) * 2)
  }, [repeatX, 1])
}

/** Art-deco lounge carpet: teal field, burgundy medallions, gilt fans. */
export function createDecoCarpetTexture() {
  return canvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = '#0d2124'
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0x3344524f)
    context.globalAlpha = 0.2
    for (let index = 0; index < 6000; index += 1) {
      context.fillStyle = random() > 0.5 ? '#1c3f43' : '#06100f'
      context.fillRect(random() * width, random() * height, 2, 2)
    }
    context.globalAlpha = 1

    const cells: Array<[number, number]> = [[0, 0], [width, 0], [0, height], [width, height], [width / 2, height / 2]]
    for (const [x, y] of cells) {
      // Burgundy medallion with stepped gilt rings.
      context.fillStyle = 'rgba(86, 22, 34, 0.4)'
      context.beginPath()
      context.arc(x, y, 70, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(214, 168, 80, 0.26)'
      context.lineWidth = 3
      for (const radius of [64, 50, 20]) {
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.stroke()
      }
      // Fan rays.
      context.strokeStyle = 'rgba(214, 168, 80, 0.22)'
      context.lineWidth = 2
      for (let ray = 0; ray < 16; ray += 1) {
        const angle = (ray / 16) * Math.PI * 2
        context.beginPath()
        context.moveTo(x + Math.cos(angle) * 24, y + Math.sin(angle) * 24)
        context.lineTo(x + Math.cos(angle) * 52, y + Math.sin(angle) * 52)
        context.stroke()
      }
    }
    // Diamond trellis linking the medallions.
    context.strokeStyle = 'rgba(214, 168, 80, 0.16)'
    context.lineWidth = 2
    for (const [x, y] of [[width / 2, 0], [0, height / 2], [width, height / 2], [width / 2, height]] as const) {
      context.beginPath()
      context.moveTo(x, y - 60)
      context.lineTo(x + 60, y)
      context.lineTo(x, y + 60)
      context.lineTo(x - 60, y)
      context.closePath()
      context.stroke()
      context.fillStyle = 'rgba(42, 110, 104, 0.35)'
      context.fill()
    }
  }, [7, 7])
}

/** Smoky mirror behind the bottles, glowing warm where each shelf's strip light hits it. */
function createBarGlowTexture(shelfVs: readonly number[]) {
  return canvasTexture(512, 256, (context, width, height) => {
    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#0c1f1e')
    base.addColorStop(1, '#10302b')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)
    for (const v of shelfVs) {
      const y = (1 - v) * height
      const glow = context.createLinearGradient(0, y - 60, 0, y)
      glow.addColorStop(0, 'rgba(255, 170, 80, 0)')
      glow.addColorStop(0.75, 'rgba(255, 170, 80, 0.35)')
      glow.addColorStop(1, 'rgba(255, 214, 150, 0.9)')
      context.fillStyle = glow
      context.fillRect(0, y - 60, width, 60)
    }
    // Soft vignette at the cabinet edges.
    const sides = context.createLinearGradient(0, 0, width, 0)
    sides.addColorStop(0, 'rgba(0,0,0,0.55)')
    sides.addColorStop(0.18, 'rgba(0,0,0,0)')
    sides.addColorStop(0.82, 'rgba(0,0,0,0)')
    sides.addColorStop(1, 'rgba(0,0,0,0.55)')
    context.fillStyle = sides
    context.fillRect(0, 0, width, height)
  })
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number) {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate(x, y, z)
  return geometry
}

function colorize(geometry: THREE.BufferGeometry, color: THREE.Color, labelFrom = -1, labelTo = -1, label?: THREE.Color) {
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    const tint = label && y >= labelFrom && y <= labelTo ? label : color
    colors[index * 3] = tint.r
    colors[index * 3 + 1] = tint.g
    colors[index * 3 + 2] = tint.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/**
 * Lit back bar: walnut cabinet with pilasters and a cornice, a smoky mirror
 * glowing under three brass shelves, and ~40 labelled bottles and glasses.
 * Five draws: cabinet, mirror, shelves, bottles, and nothing else.
 */
export function createLoungeBackBar(scene: THREE.Scene, brassMaterial: THREE.Material) {
  const bar = new THREE.Group()
  bar.name = 'emerald-back-bar'
  bar.position.set(0, 1.5, -9.2)
  scene.add(bar)

  const walnut = getWalnutTexture()
  const cabinetMaterial = new THREE.MeshStandardMaterial({
    color: '#b89078',
    map: walnut,
    roughness: 0.42,
    metalness: 0.06,
    envMapIntensity: 0.6,
  })
  const cabinet = mergeGeometries([
    box(6.8, 3.2, 0.3, 0, 0, 0),
    // Pilasters and plinths.
    box(0.36, 3.5, 0.62, -3.34, -0.05, 0.2),
    box(0.36, 3.5, 0.62, 3.34, -0.05, 0.2),
    // Cornice with a stepped lip.
    box(7.3, 0.16, 0.74, 0, 1.62, 0.22),
    box(7.0, 0.1, 0.62, 0, 1.5, 0.2),
    // Low back-bar counter at the base.
    box(6.4, 0.34, 0.7, 0, -1.34, 0.28),
  ], false)
  if (cabinet) {
    const mesh = new THREE.Mesh(cabinet, cabinetMaterial)
    mesh.name = 'back-bar-cabinet'
    mesh.receiveShadow = true
    bar.add(mesh)
  }

  const shelfYs = [-0.78, 0.04, 0.86]
  const mirrorHeight = 2.6
  const mirrorBottom = -1.17
  const shelfVs = shelfYs.map(y => (y - mirrorBottom) / mirrorHeight)
  const glowTexture = createBarGlowTexture(shelfVs)
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(6.28, mirrorHeight),
    new THREE.MeshStandardMaterial({
      color: '#0d2422',
      emissive: '#ffffff',
      emissiveMap: glowTexture,
      emissiveIntensity: 0.55,
      roughness: 0.18,
      metalness: 0.4,
      envMapIntensity: 0.8,
    })
  )
  mirror.name = 'back-bar-mirror'
  mirror.position.set(0, mirrorBottom + mirrorHeight / 2, 0.16)
  bar.add(mirror)

  const shelves = mergeGeometries(shelfYs.map(y => box(6.2, 0.06, 0.44, 0, y, 0.38)), false)
  if (shelves) {
    const mesh = new THREE.Mesh(shelves, brassMaterial)
    mesh.name = 'back-bar-shelves'
    bar.add(mesh)
  }

  // Bottles: amber whisky, green gin, clear vodka, ruby liqueur, with cream or
  // black labels; the top shelf holds squat decanters and rocks glasses.
  const glassColors = ['#9a4a10', '#2c6a2a', '#8fb8b0', '#7a1224', '#b8741a', '#1f5a52', '#5a2c10']
  const labelColors = ['#f1e6c8', '#1c1a18', '#e9d6a0', '#f4efe2']
  const random = seededRandom(0x0b0771e5)
  const geometries: THREE.BufferGeometry[] = []
  const tint = new THREE.Color()
  const labelTint = new THREE.Color()
  for (const [rowIndex, shelfY] of shelfYs.entries()) {
    const count = rowIndex === 2 ? 10 : 13
    for (let index = 0; index < count; index += 1) {
      const x = -2.85 + index * (5.7 / (count - 1)) + (random() - 0.5) * 0.08
      const decanter = rowIndex === 2
      const height = decanter ? 0.22 + random() * 0.14 : 0.34 + random() * 0.34
      const shoulder = decanter ? 0.7 : 0.45 + random() * 0.25
      const width = decanter ? 0.1 + random() * 0.04 : 0.065 + random() * 0.05
      const profile = decanter && index % 3 === 1
        ? [
            new THREE.Vector2(0, 0),
            new THREE.Vector2(width * 0.62, 0),
            new THREE.Vector2(width * 0.72, height * 0.5),
            new THREE.Vector2(width * 0.68, height * 0.52),
            new THREE.Vector2(0, height * 0.52),
          ]
        : [
            new THREE.Vector2(0, 0),
            new THREE.Vector2(width, 0),
            new THREE.Vector2(width * 1.03, height * 0.2),
            new THREE.Vector2(width * 1.04, height * 0.22),
            new THREE.Vector2(width * 1.05, height * (shoulder - 0.12)),
            new THREE.Vector2(width * 1.06, height * (shoulder - 0.1)),
            new THREE.Vector2(width * 1.08, height * shoulder),
            new THREE.Vector2(width * 0.4, height * (shoulder + 0.16)),
            new THREE.Vector2(width * 0.34, height * 0.92),
            new THREE.Vector2(width * 0.4, height),
            new THREE.Vector2(0, height),
          ]
      const geometry = new THREE.LatheGeometry(profile, 12)
      tint.set(glassColors[(index * 3 + rowIndex * 5) % glassColors.length]!)
      labelTint.set(labelColors[(index + rowIndex) % labelColors.length]!)
      const hasLabel = !(decanter && index % 3 === 1)
      colorize(geometry, tint, height * 0.215, height * (shoulder - 0.11), hasLabel ? labelTint : undefined)
      geometry.translate(x, shelfY + 0.03, 0.44 + (random() - 0.5) * 0.08)
      geometries.push(geometry)
    }
  }
  const bottles = mergeGeometries(geometries, false)
  geometries.forEach(geometry => geometry.dispose())
  if (bottles) {
    const mesh = new THREE.Mesh(bottles, new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: '#4a2c12',
      emissiveIntensity: 0.4,
      roughness: 0.08,
      metalness: 0.1,
      envMapIntensity: 1.2,
    }))
    mesh.name = 'back-bar-bottles'
    bar.add(mesh)
  }
  return bar
}

/** A curtain panel with real folds: a plane corrugated by a few sines. */
function createDrapeGeometry(width: number, height: number, folds: number, seed: number) {
  const geometry = new THREE.PlaneGeometry(width, height, folds * 8, 12)
  const position = geometry.getAttribute('position')
  const random = seededRandom(seed)
  const phase = random() * Math.PI * 2
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const u = x / width + 0.5
    const v = y / height + 0.5
    // Folds deepen toward the hem and gather slightly at the top.
    const depth = 0.08 + 0.1 * (1 - v)
    const z = Math.sin(u * folds * Math.PI * 2 + phase) * depth + Math.sin(u * folds * 5.3 + phase) * 0.025
    position.setZ(index, z)
    position.setX(index, x * (0.92 + 0.08 * (1 - v)))
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Velvet drapes framing the back wall corners, plus potted palms for depth. */
export function createLoungeDecor(scene: THREE.Scene, brassMaterial: THREE.Material) {
  const group = new THREE.Group()
  group.name = 'lounge-decor'
  scene.add(group)

  const drapeParts: THREE.BufferGeometry[] = []
  const placements: Array<{ x: number; z: number; rotation: number; width: number; seed: number }> = [
    { x: -11.2, z: -9.28, rotation: 0, width: 2.4, seed: 11 },
    { x: 11.2, z: -9.28, rotation: 0, width: 2.4, seed: 23 },
    { x: -12.22, z: -6.6, rotation: Math.PI / 2, width: 2.2, seed: 37 },
    { x: 12.22, z: -6.6, rotation: -Math.PI / 2, width: 2.2, seed: 41 },
  ]
  for (const placement of placements) {
    const geometry = createDrapeGeometry(placement.width, 9.4, 4, placement.seed)
    geometry.rotateY(placement.rotation)
    geometry.translate(placement.x, 2.7, placement.z)
    drapeParts.push(geometry)
  }
  const drapes = mergeGeometries(drapeParts, false)
  drapeParts.forEach(part => part.dispose())
  if (drapes) {
    const sheen = canvasTexture(8, 256, (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, '#2a0810')
      gradient.addColorStop(0.35, '#6a1628')
      gradient.addColorStop(1, '#3a0c16')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    })
    const mesh = new THREE.Mesh(drapes, new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: sheen,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.4,
      side: THREE.DoubleSide,
    }))
    mesh.name = 'velvet-drapes'
    group.add(mesh)
  }

  // Brass curtain rods.
  const rods = mergeGeometries([
    new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).rotateZ(Math.PI / 2).translate(-11.2, 7.45, -9.22),
    new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).rotateZ(Math.PI / 2).translate(11.2, 7.45, -9.22),
  ], false)
  if (rods) group.add(new THREE.Mesh(rods, brassMaterial))

  // Potted palms: glazed pot + fanned fronds, both merged across plants.
  const potParts: THREE.BufferGeometry[] = []
  const frondParts: THREE.BufferGeometry[] = []
  const random = seededRandom(0x9a1e)
  for (const [px, pz] of [[-9.7, -8.3], [9.7, -8.3]] as const) {
    const pot = new THREE.LatheGeometry([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.36, 0),
      new THREE.Vector2(0.46, 0.12),
      new THREE.Vector2(0.52, 0.8),
      new THREE.Vector2(0.6, 0.9),
      new THREE.Vector2(0.58, 0.98),
      new THREE.Vector2(0.5, 0.94),
      new THREE.Vector2(0, 0.9),
    ], 24)
    pot.translate(px, -2, pz)
    potParts.push(pot)
    const fronds = 15
    for (let index = 0; index < fronds; index += 1) {
      const angle = (index / fronds) * Math.PI * 2 + random() * 0.4
      const length = 1.7 + random() * 0.9
      const droop = 0.6 + random() * 0.5
      // A frond is a thin, tapered, arched ribbon.
      const segments = 8
      const positions: number[] = []
      const indices: number[] = []
      for (let step = 0; step <= segments; step += 1) {
        const t = step / segments
        const radial = t * length
        const height = Math.sin(t * Math.PI * 0.75) * droop + t * 0.9
        const halfWidth = Math.sin(t * Math.PI) * 0.24 + 0.02
        const cx = Math.cos(angle) * radial
        const cz = Math.sin(angle) * radial
        const sx = -Math.sin(angle) * halfWidth
        const sz = Math.cos(angle) * halfWidth
        positions.push(cx + sx, height + 0.04, cz + sz, cx - sx, height + 0.04, cz - sz, cx, height - 0.05, cz)
        if (step > 0) {
          const a = (step - 1) * 3
          const b = step * 3
          indices.push(a, b, a + 2, b, b + 2, a + 2, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2)
        }
      }
      const frond = new THREE.BufferGeometry()
      frond.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      frond.setIndex(indices)
      frond.computeVertexNormals()
      frond.translate(px, -1.1, pz)
      frondParts.push(frond)
    }
  }
  const pots = mergeGeometries(potParts, false)
  const leaves = mergeGeometries(frondParts, false)
  potParts.forEach(part => part.dispose())
  frondParts.forEach(part => part.dispose())
  if (pots) {
    group.add(new THREE.Mesh(pots, new THREE.MeshStandardMaterial({
      color: '#1d3a3a',
      roughness: 0.3,
      metalness: 0.2,
      envMapIntensity: 1,
    })))
  }
  if (leaves) {
    group.add(new THREE.Mesh(leaves, new THREE.MeshStandardMaterial({
      color: '#2f6b3c',
      roughness: 0.6,
      side: THREE.DoubleSide,
    })))
  }
  return group
}
