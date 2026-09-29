import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { drawSuit, getCarpetWeaveTexture, getWalnutTexture } from './sceneTextures'
import { TABLE_SEAT_POSITIONS } from './tableWagerLayout'

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
    paper.addColorStop(0, '#0f3234')
    paper.addColorStop(1, '#16463f')
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
        drawSuit(context, row % 2 ? 'clubs' : 'spades', x, y, cellX * 0.28, 'rgba(214, 178, 104, 0.115)')
        context.strokeStyle = 'rgba(214, 178, 104, 0.075)'
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
    frieze.addColorStop(0, '#081416')
    frieze.addColorStop(1, '#10282a')
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
    base.addColorStop(0, '#1a4a46')
    base.addColorStop(1, '#236058')
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
    // Reflected bottles: faint warm ghosts of every bottle, standing on the
    // reflected shelf line, so the glass reads as a mirror and not a dark panel.
    shelfVs.forEach((v, rowIndex) => {
      const count = rowIndex === 2 ? 10 : 13
      const baseY = (1 - v) * height + 6
      for (let index = 0; index < count; index += 1) {
        const worldX = -2.85 + index * (5.7 / (count - 1))
        const x = ((worldX + 3.14) / 6.28) * width
        const bottleHeight = (rowIndex === 2 ? 0.3 : 0.5) / 2.6 * height
        context.fillStyle = 'rgba(255, 200, 140, 0.13)'
        context.beginPath()
        context.roundRect(x - 4.5, baseY - bottleHeight * 0.62, 9, bottleHeight * 0.62, 2)
        context.fill()
        context.fillRect(x - 1.6, baseY - bottleHeight, 3.2, bottleHeight * 0.4)
      }
    })
    // Glassy mirror: two long diagonal sheen bands and the seams between panes.
    for (const [x, band, alpha] of [[0.24, 0.07, 0.17], [0.62, 0.035, 0.11]] as const) {
      const sheen = context.createLinearGradient((x - band) * width, 0, (x + band) * width, 0)
      sheen.addColorStop(0, 'rgba(255,255,255,0)')
      sheen.addColorStop(0.5, `rgba(255,255,255,${alpha})`)
      sheen.addColorStop(1, 'rgba(255,255,255,0)')
      context.save()
      context.translate(width / 2, height / 2)
      context.rotate(0.32)
      context.translate(-width / 2, -height / 2)
      context.fillStyle = sheen
      context.fillRect(-width, -height, width * 3, height * 3)
      context.restore()
    }
    context.fillStyle = 'rgba(0, 0, 0, 0.45)'
    for (const x of [1 / 3, 2 / 3]) context.fillRect(x * width - 1, 0, 2, height)
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

function colorize(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
  labelFrom = -1,
  labelTo = -1,
  label?: THREE.Color,
  capFrom = Infinity,
  cap?: THREE.Color
) {
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    const tint = cap && y >= capFrom ? cap : label && y >= labelFrom && y <= labelTo ? label : color
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
      emissiveIntensity: 0.85,
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
  // Deep glass tints (the liquid inside darkens the body); the shine comes
  // from the clearcoat reflecting the room, not from a flat bright colour.
  const glassColors = ['#6a3208', '#1d4a1f', '#6f9a94', '#560a18', '#8a5412', '#123c37', '#3e1e0a']
  const capColors = ['#c9a24a', '#15110e', '#a02830', '#d8d2c0']
  const labelColors = ['#f1e6c8', '#1c1a18', '#e9d6a0', '#f4efe2']
  const random = seededRandom(0x0b0771e5)
  const geometries: THREE.BufferGeometry[] = []
  const tint = new THREE.Color()
  const labelTint = new THREE.Color()
  const capTint = new THREE.Color()
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
      const geometry = new THREE.LatheGeometry(profile, 16)
      tint.set(glassColors[(index * 3 + rowIndex * 5) % glassColors.length]!)
      capTint.set(capColors[(index + rowIndex * 2) % capColors.length]!)
      labelTint.set(labelColors[(index + rowIndex) % labelColors.length]!)
      const hasLabel = !(decanter && index % 3 === 1)
      colorize(geometry, tint, height * 0.215, height * (shoulder - 0.11), hasLabel ? labelTint : undefined, decanter ? Infinity : height * 0.9, capTint)
      geometry.translate(x, shelfY + 0.03, 0.44 + (random() - 0.5) * 0.08)
      geometries.push(geometry)
    }
  }
  const bottles = mergeGeometries(geometries, false)
  geometries.forEach(geometry => geometry.dispose())
  if (bottles) {
    const mesh = new THREE.Mesh(bottles, new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      emissive: '#3a2210',
      emissiveIntensity: 0.28,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 2.4,
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
      gradient.addColorStop(0, '#3a0c18')
      gradient.addColorStop(0.35, '#86203a')
      gradient.addColorStop(1, '#4c1220')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    })
    // Velvet: a soft sheen lobe that lights the folds' crests at grazing angles.
    const mesh = new THREE.Mesh(drapes, new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: sheen,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.4,
      sheen: 1,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color('#d0506e'),
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
      // A pinnate frond: an arched rachis with paired drooping leaflets that
      // shorten toward the tip (reads as a palm, not a green ribbon).
      const leaflets = 15
      const positions: number[] = []
      const colors: number[] = []
      const base = new THREE.Color('#1c4a2a')
      const tip = new THREE.Color('#4f9a4e')
      const shade = new THREE.Color()
      const rib = (t: number) => {
        const radial = t * length
        return {
          x: Math.cos(angle) * radial,
          y: Math.sin(t * Math.PI * 0.75) * droop + t * 0.9,
          z: Math.sin(angle) * radial,
        }
      }
      for (let step = 1; step <= leaflets; step += 1) {
        const t = 0.12 + (step / leaflets) * 0.88
        const point = rib(t)
        const ahead = rib(Math.min(1, t + 0.04))
        const leafLength = (0.16 + Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.34) * (0.9 + random() * 0.2)
        const along = 0.11 + (1 - t) * 0.05
        shade.copy(base).lerp(tip, t)
        for (const side of [-1, 1]) {
          // Leaflet tip: out sideways, forward along the rib, drooping down.
          const tx = point.x + (-Math.sin(angle) * side) * leafLength + (ahead.x - point.x) * (along / 0.04) * 0.6
          const tz = point.z + (Math.cos(angle) * side) * leafLength + (ahead.z - point.z) * (along / 0.04) * 0.6
          const ty = point.y - leafLength * (0.35 + 0.25 * t)
          const wx = (ahead.x - point.x) * 0.9
          const wz = (ahead.z - point.z) * 0.9
          positions.push(point.x, point.y, point.z, point.x + wx, point.y + (ahead.y - point.y) * 0.9, point.z + wz, tx, ty, tz)
          for (const k of [0, 0, 1]) {
            const c = k ? shade.clone().offsetHSL(0, 0, 0.08) : shade
            colors.push(c.r, c.g, c.b)
          }
        }
      }
      const frond = new THREE.BufferGeometry()
      frond.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      frond.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
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
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.5,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
    })))
  }
  return group
}

function radialGlowTexture(rgb: string, alpha: number) {
  return canvasTexture(128, 128, (context, width, height) => {
    const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2)
    gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`)
    gradient.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.4})`)
    gradient.addColorStop(1, `rgba(${rgb}, 0)`)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  })
}

/** Remaps a geometry's 0..1 UVs into one tile of a horizontal texture atlas. */
function toAtlasTile(geometry: THREE.BufferGeometry, tile: number, tiles: number) {
  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index += 1) {
    uv.setX(index, (tile + 0.02 + uv.getX(index) * 0.96) / tiles)
    uv.setY(index, 0.02 + uv.getY(index) * 0.96)
  }
  return geometry
}

/** Vertex-colour a geometry so one additive material can carry many tints. */
function tinted(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, strength = 1) {
  const tint = new THREE.Color(color).multiplyScalar(strength)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = tint.r
    colors[index * 3 + 1] = tint.g
    colors[index * 3 + 2] = tint.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** Additive light atlas: [0] round halo, [1] wall wash (up + down fans), [2] top-lit downward wash. */
function createLightAtlasTexture() {
  return canvasTexture(1536, 512, context => {
    context.clearRect(0, 0, 1536, 512)
    // Tile 0: soft halo with a hot core.
    const halo = context.createRadialGradient(256, 256, 0, 256, 256, 250)
    halo.addColorStop(0, 'rgba(255,255,255,1)')
    halo.addColorStop(0.08, 'rgba(255,255,255,0.75)')
    halo.addColorStop(0.28, 'rgba(255,255,255,0.28)')
    halo.addColorStop(0.6, 'rgba(255,255,255,0.07)')
    halo.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = halo
    context.fillRect(0, 0, 512, 512)

    // Tile 1: a scalloped wall wash, like a sconce with an open top and bottom.
    const fan = (x0: number, up: boolean) => {
      const layer = document.createElement('canvas')
      layer.width = 512
      layer.height = 512
      const lc = layer.getContext('2d')!
      const gradient = lc.createLinearGradient(0, 256, 0, up ? 0 : 512)
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.32)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      lc.fillStyle = gradient
      lc.beginPath()
      lc.moveTo(256 - 26, 256)
      lc.lineTo(256 + 26, 256)
      lc.lineTo(256 + 120, up ? 8 : 504)
      lc.lineTo(256 - 120, up ? 8 : 504)
      lc.closePath()
      lc.fill()
      lc.globalCompositeOperation = 'destination-in'
      const soft = lc.createLinearGradient(0, 0, 512, 0)
      soft.addColorStop(0, 'rgba(255,255,255,0)')
      soft.addColorStop(0.5, 'rgba(255,255,255,1)')
      soft.addColorStop(1, 'rgba(255,255,255,0)')
      lc.fillStyle = soft
      lc.fillRect(0, 0, 512, 512)
      context.save()
      context.filter = 'blur(26px)'
      context.drawImage(layer, x0, 0)
      context.restore()
    }
    fan(512, true)
    fan(512, false)
    const core = context.createRadialGradient(768, 256, 0, 768, 256, 130)
    core.addColorStop(0, 'rgba(255,255,255,0.55)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = core
    context.fillRect(512, 0, 512, 512)

    // Tile 2: light raked down a wall from a picture light above: bright at the top.
    const wash = context.createLinearGradient(0, 0, 0, 512)
    wash.addColorStop(0, 'rgba(255,255,255,0.9)')
    wash.addColorStop(0.3, 'rgba(255,255,255,0.4)')
    wash.addColorStop(1, 'rgba(255,255,255,0)')
    const layer = document.createElement('canvas')
    layer.width = 512
    layer.height = 512
    const lc = layer.getContext('2d')!
    lc.fillStyle = wash
    lc.fillRect(0, 0, 512, 512)
    lc.globalCompositeOperation = 'destination-in'
    const side = lc.createLinearGradient(0, 0, 512, 0)
    side.addColorStop(0, 'rgba(255,255,255,0)')
    side.addColorStop(0.18, 'rgba(255,255,255,0.8)')
    side.addColorStop(0.5, 'rgba(255,255,255,1)')
    side.addColorStop(0.82, 'rgba(255,255,255,0.8)')
    side.addColorStop(1, 'rgba(255,255,255,0)')
    lc.fillStyle = side
    lc.fillRect(0, 0, 512, 512)
    context.drawImage(layer, 1024, 0)
  })
}

/** Dark alpha atlas for ambient occlusion on the carpet: [0] soft blob, [1] tight blob, [2] wall-edge gradient. */
function createContactAtlasTexture() {
  return canvasTexture(768, 256, context => {
    context.clearRect(0, 0, 768, 256)
    for (const [tile, peak, feather] of [[0, 0.5, 0.35], [1, 0.9, 0.18]] as const) {
      const x = tile * 256 + 128
      const blob = context.createRadialGradient(x, 128, 0, x, 128, 126)
      blob.addColorStop(0, `rgba(0,0,0,${peak})`)
      blob.addColorStop(feather, `rgba(0,0,0,${peak * 0.8})`)
      blob.addColorStop(0.62, `rgba(0,0,0,${peak * 0.32})`)
      blob.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = blob
      context.fillRect(tile * 256, 0, 256, 256)
    }
    const edge = context.createLinearGradient(512, 0, 768, 0)
    edge.addColorStop(0, 'rgba(0,0,0,0.85)')
    edge.addColorStop(0.35, 'rgba(0,0,0,0.42)')
    edge.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = edge
    context.fillRect(512, 0, 256, 256)
  })
}

/** Coffered ceiling plaster: dark stucco with a recessed, gilt-edged panel per tile. */
function createCeilingTexture() {
  return canvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = '#211d1a'
    context.fillRect(0, 0, width, height)
    const random = seededRandom(0xce11)
    for (let speck = 0; speck < 4200; speck += 1) {
      context.fillStyle = random() > 0.5 ? 'rgba(255, 235, 205, 0.045)' : 'rgba(0, 0, 0, 0.14)'
      context.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 2)
    }
    const inset = 34
    const panel = context.createLinearGradient(0, inset, 0, height - inset)
    panel.addColorStop(0, 'rgba(0, 0, 0, 0.32)')
    panel.addColorStop(1, 'rgba(0, 0, 0, 0.12)')
    context.fillStyle = panel
    context.fillRect(inset, inset, width - inset * 2, height - inset * 2)
    context.strokeStyle = 'rgba(214, 168, 80, 0.32)'
    context.lineWidth = 3
    context.strokeRect(inset + 10, inset + 10, width - (inset + 10) * 2, height - (inset + 10) * 2)
    context.lineWidth = 1.5
    context.strokeRect(inset + 22, inset + 22, width - (inset + 22) * 2, height - (inset + 22) * 2)
    // Centre medallion.
    context.strokeStyle = 'rgba(214, 168, 80, 0.28)'
    for (const radius of [64, 46, 20]) {
      context.beginPath()
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2)
      context.stroke()
    }
  }, [6, 5])
}

/**
 * Pleated linen sconce shade lit from inside: a warm, slightly darker
 * shoulder, a bright waist, gilt trim bands and fine vertical pleats. The same
 * map drives the emissive so the fabric glows with its own weave.
 */
export function createSconceShadeMaterial() {
  const map = canvasTexture(256, 128, (context, width, height) => {
    const body = context.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#d98f45')
    body.addColorStop(0.35, '#f7bd6e')
    body.addColorStop(0.75, '#ffd699')
    body.addColorStop(1, '#ffe6bd')
    context.fillStyle = body
    context.fillRect(0, 0, width, height)
    // Light from the bulb shows through most strongly in a soft vertical column.
    const glow = context.createLinearGradient(0, 0, width, 0)
    for (let stop = 0; stop <= 4; stop += 1) glow.addColorStop(stop / 4, stop % 2 ? 'rgba(255, 246, 220, 0.22)' : 'rgba(150, 70, 10, 0.16)')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)
    for (let x = 0; x < width; x += 8) {
      context.fillStyle = 'rgba(120, 60, 10, 0.16)'
      context.fillRect(x, 0, 2, height)
      context.fillStyle = 'rgba(255, 245, 220, 0.12)'
      context.fillRect(x + 3, 0, 2, height)
    }
    const random = seededRandom(0x51c0)
    for (let fleck = 0; fleck < 500; fleck += 1) {
      context.fillStyle = random() > 0.5 ? 'rgba(255, 240, 210, 0.1)' : 'rgba(110, 60, 20, 0.1)'
      context.fillRect(random() * width, random() * height, 1 + random() * 3, 1)
    }
    context.fillStyle = '#c99a4c'
    context.fillRect(0, 0, width, 6)
    context.fillRect(0, height - 6, width, 6)
    context.fillStyle = 'rgba(255, 230, 170, 0.6)'
    context.fillRect(0, 6, width, 1.5)
    context.fillRect(0, height - 7.5, width, 1.5)
  })
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map,
    emissive: '#ffffff',
    emissiveMap: map,
    emissiveIntensity: 1.15,
    side: THREE.DoubleSide,
    roughness: 0.8,
  })
}

/** Three art-deco prints for the side walls, one atlas: sunburst, card fan, roulette wheel. */
function createGalleryTexture() {
  return canvasTexture(1152, 512, context => {
    const tile = (index: number, background: [string, string]) => {
      const x0 = index * 384
      const gradient = context.createLinearGradient(0, 0, 0, 512)
      gradient.addColorStop(0, background[0])
      gradient.addColorStop(1, background[1])
      context.fillStyle = gradient
      context.fillRect(x0, 0, 384, 512)
      context.strokeStyle = 'rgba(232, 190, 110, 0.85)'
      context.lineWidth = 5
      context.strokeRect(x0 + 18, 18, 348, 476)
      context.lineWidth = 1.5
      context.strokeRect(x0 + 30, 30, 324, 452)
    }
    const gold = (alpha: number) => `rgba(236, 190, 104, ${alpha})`

    // 0: sunburst rising over a stepped skyline.
    tile(0, ['#3a0f1e', '#12060b'])
    context.save()
    context.translate(192, 330)
    for (let ray = 0; ray < 21; ray += 1) {
      const angle = Math.PI + (ray / 20) * Math.PI
      context.fillStyle = gold(ray % 2 ? 0.55 : 0.28)
      context.beginPath()
      context.moveTo(0, 0)
      context.arc(0, 0, 250, angle - 0.075, angle + 0.075)
      context.closePath()
      context.fill()
    }
    for (const radius of [74, 56]) {
      context.strokeStyle = gold(0.9)
      context.lineWidth = 4
      context.beginPath()
      context.arc(0, 0, radius, Math.PI, 0)
      context.stroke()
    }
    context.restore()
    context.fillStyle = '#0a0406'
    const skyline = [[40, 96], [70, 150], [104, 70], [136, 118], [170, 178], [204, 100], [236, 140], [270, 84], [302, 128], [334, 90]] as const
    for (const [x, h] of skyline) context.fillRect(x, 330 - h + 90, 30, h + 92)

    // 1: a fan of five cards on midnight blue.
    tile(1, ['#0f2038', '#060c16'])
    for (let card = 0; card < 5; card += 1) {
      context.save()
      context.translate(384 + 192, 380)
      context.rotate((card - 2) * 0.24)
      context.fillStyle = '#f2e8cf'
      context.beginPath()
      context.roundRect(-46, -250, 92, 148 + 100, 10)
      context.fill()
      context.strokeStyle = 'rgba(70, 50, 20, 0.5)'
      context.lineWidth = 2
      context.stroke()
      drawSuit(context, (['spades', 'hearts', 'clubs', 'diamonds', 'spades'] as const)[card]!, 0, -190, 30, card % 2 ? '#c83a46' : '#1a1a20')
      context.restore()
    }
    context.fillStyle = gold(0.9)
    context.beginPath()
    context.arc(384 + 192, 380, 16, 0, Math.PI * 2)
    context.fill()

    // 2: roulette wheel on deep teal.
    tile(2, ['#0d3a38', '#051614'])
    context.save()
    context.translate(768 + 192, 256)
    for (let slot = 0; slot < 24; slot += 1) {
      const angle = (slot / 24) * Math.PI * 2
      context.fillStyle = slot % 2 ? '#a02030' : '#101418'
      context.beginPath()
      context.moveTo(0, 0)
      context.arc(0, 0, 130, angle, angle + (Math.PI * 2) / 24)
      context.closePath()
      context.fill()
    }
    context.strokeStyle = gold(0.95)
    context.lineWidth = 4
    for (const radius of [130, 96, 62, 28]) {
      context.beginPath()
      context.arc(0, 0, radius, 0, Math.PI * 2)
      context.stroke()
    }
    context.fillStyle = gold(0.95)
    context.beginPath()
    context.arc(0, 0, 14, 0, Math.PI * 2)
    context.fill()
    context.restore()
  })
}

/** Sconce/lamp positions the baked shadows and glows are keyed to (see DesktopPokerRoom3D createRoom). */
const SCONCE_XS = [-9.4, -4.6, 4.6, 9.4] as const
const PENDANT_XZ = [[-2.6, -0.4], [2.6, -0.4]] as const

/**
 * Chair floor footprints (world XZ) for visual seats 1..7: the chair origin is
 * the seat pushed toward the table by the rail-snug shift, its legs sit a
 * little behind that origin.
 */
function chairFloorCenters() {
  return ([1, 2, 3, 4, 5, 6, 7] as const).map(seat => {
    const [x, , z] = TABLE_SEAT_POSITIONS[seat]
    const yaw = Math.atan2(x, z)
    const shift = seat === 1 || seat === 7 ? -0.3 : -0.45
    const distance = shift + 0.13
    return [x + Math.sin(yaw) * distance, z + Math.cos(yaw) * distance] as const
  })
}

function floorQuad(x0: number, z0: number, x1: number, z1: number, y: number, uv: (x: number, z: number) => [number, number]) {
  const positions = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]
  const uvs: number[] = []
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) uvs.push(...uv(x, z))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Architecture and baked light for the room shell. Everything is one draw per
 * material and uses no real lights: walnut pilasters framing the posters, a
 * crown moulding, a coffered ceiling, wall washes and halos around every lamp,
 * ambient occlusion pooled under the table, chairs and along the walls, and a
 * warm pool on the carpet under the key light so the floor has depth and sheen
 * instead of reading as a flat dark disc.
 */
export function createRoomDressing(scene: THREE.Scene, brassMaterial: THREE.Material) {
  const group = new THREE.Group()
  group.name = 'room-dressing'
  scene.add(group)

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: '#9a7b66',
    map: getWalnutTexture(),
    roughness: 0.4,
    metalness: 0.06,
    envMapIntensity: 0.7,
  })
  const wood: THREE.BufferGeometry[] = []
  const brass: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    for (const x of [5.8, 8.2]) {
      wood.push(box(0.42, 5.4, 0.22, side * x, 3.6, -9.34))
      wood.push(box(0.56, 0.16, 0.32, side * x, 0.98, -9.3))
      wood.push(box(0.56, 0.2, 0.34, side * x, 6.3, -9.28))
      brass.push(box(0.5, 0.05, 0.36, side * x, 6.42, -9.27))
    }
    // Picture lights over the posters: a brass bar on two short arms.
    brass.push(box(1.15, 0.06, 0.12, side * 7, 3.68, -9.12))
    brass.push(box(0.04, 0.04, 0.3, side * 7 - 0.4, 3.68, -9.28))
    brass.push(box(0.04, 0.04, 0.3, side * 7 + 0.4, 3.68, -9.28))
  }
  // Crown moulding and picture rail along the whole back wall.
  wood.push(box(32, 0.22, 0.4, 0, 6.55, -9.3))
  wood.push(box(32, 0.1, 0.5, 0, 6.72, -9.26))
  brass.push(box(32, 0.04, 0.42, 0, 6.42, -9.28))
  // Skirting boards where the walls meet the carpet.
  wood.push(box(25.2, 0.26, 0.16, 0, -1.87, -9.17))
  for (const side of [-1, 1]) {
    wood.push(box(0.16, 0.26, 20.4, side * 12.0, -1.87, 0.78))
    // Chair rail continues along the side walls.
    brass.push(box(0.34, 0.08, 20.4, side * 12.2, 0.92, 0.78))
  }
  // Gallery wall: three framed prints per side wall, each with a brass picture light.
  const galleryZs = [-4.2, -0.2, 3.8]
  for (const side of [-1, 1]) {
    for (const z of galleryZs) {
      const x = side * 12.33
      brass.push(box(0.08, 2.5, 1.9, x, 3.5, z))
      brass.push(box(0.1, 0.06, 1.1, side * 12.27, 4.98, z))
      brass.push(box(0.3, 0.04, 0.04, side * 12.2, 4.98, z - 0.4))
      brass.push(box(0.3, 0.04, 0.04, side * 12.2, 4.98, z + 0.4))
    }
  }
  // Coffered ceiling: walnut beams on a 4.17-unit grid with a brass edge,
  // a cornice all round, and a rosette where each pendant's cord lands.
  const ceilingY = 10.2
  const gridX = (index: number) => -12.5 + index * (25 / 6)
  const gridZ = (index: number) => -9.45 + index * (20.85 / 5)
  for (let index = 1; index <= 5; index += 1) {
    wood.push(box(0.36, 0.3, 20.85, gridX(index), ceilingY - 0.15, 0.975))
    brass.push(box(0.05, 0.03, 20.85, gridX(index), ceilingY - 0.31, 0.975))
  }
  for (let index = 1; index <= 4; index += 1) {
    wood.push(box(25, 0.3, 0.36, 0, ceilingY - 0.15, gridZ(index)))
    brass.push(box(25, 0.03, 0.05, 0, ceilingY - 0.31, gridZ(index)))
  }
  wood.push(box(25.2, 0.4, 0.3, 0, ceilingY - 0.2, -9.3))
  for (const side of [-1, 1]) wood.push(box(0.3, 0.4, 20.85, side * 12.3, ceilingY - 0.2, 0.975))
  for (const [x, z] of PENDANT_XZ) {
    brass.push(new THREE.CylinderGeometry(0.34, 0.4, 0.09, 24).translate(x, ceilingY - 0.05, z))
    brass.push(new THREE.CylinderGeometry(0.17, 0.2, 0.14, 20).translate(x, ceilingY - 0.14, z))
  }
  const woodMerged = mergeGeometries(wood, false)
  const brassMerged = mergeGeometries(brass, false)
  wood.forEach(part => part.dispose())
  brass.forEach(part => part.dispose())
  if (woodMerged) {
    const mesh = new THREE.Mesh(woodMerged, woodMaterial)
    mesh.name = 'wall-pilasters'
    group.add(mesh)
  }
  if (brassMerged) {
    // A calmer brass for the trim: the shared one is polished enough to clip to a hot line.
    const trimBrass = (brassMaterial as THREE.MeshStandardMaterial).clone()
    trimBrass.envMapIntensity = 0.5
    trimBrass.roughness = 0.5
    group.add(new THREE.Mesh(brassMerged, trimBrass))
  }

  const ceilingTexture = createCeilingTexture()
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 20.85).rotateX(Math.PI / 2).translate(0, ceilingY, 0.975),
    new THREE.MeshStandardMaterial({ map: ceilingTexture, roughness: 0.92, metalness: 0, envMapIntensity: 0.2, emissive: '#5a4634', emissiveMap: ceilingTexture, emissiveIntensity: 0.32 })
  )
  ceiling.name = 'coffered-ceiling'
  group.add(ceiling)

  // Raised-panel wainscot on the side walls too (the back wall already has one).
  const sideWainscotGeometry = mergeGeometries([box(0.3, 2.9, 20.4, -12.23, -0.55, 0.78), box(0.3, 2.9, 20.4, 12.23, -0.55, 0.78)], false)
  if (sideWainscotGeometry) {
    const sideWainscot = new THREE.Mesh(
      sideWainscotGeometry,
      new THREE.MeshStandardMaterial({ map: createWainscotTexture(9), roughness: 0.46, metalness: 0.05, envMapIntensity: 0.5 })
    )
    sideWainscot.name = 'side-wainscot'
    group.add(sideWainscot)
  }

  // Give the carpet a tufted pile: swap the plain floor material for one with a
  // fibre bump at a fine repeat and a soft wool sheen under grazing light.
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    const params = (mesh.geometry as THREE.CircleGeometry | undefined)?.parameters
    if (!mesh.isMesh || mesh.name || mesh.geometry?.type !== 'CircleGeometry' || params?.radius !== 20) return
    const previous = mesh.material as THREE.MeshStandardMaterial
    const weave = getCarpetWeaveTexture()
    weave.repeat.set(560, 560)
    mesh.material = new THREE.MeshPhysicalMaterial({
      map: previous.map,
      color: previous.color,
      roughness: 0.86,
      metalness: 0,
      envMapIntensity: previous.envMapIntensity,
      bumpMap: weave,
      bumpScale: 0.9,
      sheen: 0.7,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color('#5c9c90'),
    })
    previous.dispose()
    mesh.name = 'lounge-carpet'
    mesh.receiveShadow = true
  })

  const prints: THREE.BufferGeometry[] = []
  galleryZs.forEach((z, index) => {
    for (const side of [-1, 1]) {
      const print = new THREE.PlaneGeometry(1.7, 2.3)
      toAtlasTile(print, (index + (side > 0 ? 1 : 0)) % 3, 3)
      print.rotateY(side * -Math.PI / 2)
      print.translate(side * 12.285, 3.5, z)
      prints.push(print)
    }
  })
  const printsMerged = mergeGeometries(prints, false)
  prints.forEach(part => part.dispose())
  if (printsMerged) {
    const gallery = new THREE.Mesh(printsMerged, new THREE.MeshStandardMaterial({
      map: createGalleryTexture(),
      roughness: 0.5,
      metalness: 0.02,
      envMapIntensity: 0.5,
    }))
    gallery.name = 'gallery-prints'
    group.add(gallery)
  }

  // ---- Baked light ---------------------------------------------------------
  const additiveMaterial = (map: THREE.Texture, vertexColors: boolean) => new THREE.MeshBasicMaterial({
    map,
    vertexColors,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const TILES = 3
  const glow: THREE.BufferGeometry[] = []
  const halo = (w: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, strength: number) =>
    glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(w, h).translate(x, y, z), 0, TILES), color, strength))
  const wash = (tile: 1 | 2, w: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, strength: number) =>
    glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(w, h).translate(x, y, z), tile, TILES), color, strength))

  for (const x of SCONCE_XS) {
    // Sconce shade sits at (x, 2.24, -8.69): a halo around it and its fans of light on the wall.
    halo(1.5, 1.5, x, 2.28, -8.6, '#ffb266', 0.62)
    halo(0.55, 0.55, x, 2.28, -8.56, '#ffe2b0', 0.55)
    wash(1, 3.4, 3.4, x, 2.3, -9.41, '#ff9c4c', 0.6)
  }
  // Cove light under the picture rail: a broad warm wash raking down the whole
  // back wall, so the wallpaper above the bar and sign reads as a lit surface.
  wash(2, 30, 3.8, 0, 4.85, -9.42, '#ffb262', 0.25)
  // The same cove light along both side walls.
  for (const side of [-1, 1]) {
    glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(21, 4.4).rotateY(side * -Math.PI / 2).translate(side * 12.3, 4.9, 0.8), 2, TILES), '#ffb262', 0.26))
  }
  for (const side of [-1, 1]) {
    // Picture light on each poster: a downward rake of warm light.
    wash(2, 2.0, 2.9, side * 7, 2.26, -9.2, '#ffc47c', 0.24)
    halo(0.8, 0.8, side * 7, 3.66, -9.02, '#ffcf8c', 0.28)
  }
  for (const side of [-1, 1]) {
    for (const z of galleryZs) {
      glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(1.9, 2.7).rotateY(side * -Math.PI / 2).translate(side * 12.26, 3.4, z), 2, TILES), '#ffc47c', 0.22))
      glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(0.7, 0.7).rotateY(side * -Math.PI / 2).translate(side * 12.15, 4.98, z), 0, TILES), '#ffcf8c', 0.22))
    }
  }
  for (const [x, z] of PENDANT_XZ) {
    // Glow around each pendant, seen from the side, plus the bright underside seen from below.
    halo(2.6, 2.6, x, 7.1, z, '#ffd39a', 0.5)
    glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(2.6, 2.6).rotateY(Math.PI / 2).translate(x, 7.1, z), 0, TILES), '#ffd39a', 0.5))
    glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(1.7, 1.7).rotateX(Math.PI / 2).translate(x, 6.94, z), 0, TILES), '#ffe6b8', 0.85))
  }
  // Felt bounce: the lit green cloth tints the carpet around the table.
  glow.push(tinted(toAtlasTile(new THREE.PlaneGeometry(15, 10.6).rotateX(-Math.PI / 2).translate(0, -1.985, 0), 0, TILES), '#20c48a', 0.16))
  const glowMerged = mergeGeometries(glow, false)
  glow.forEach(part => part.dispose())
  if (glowMerged) {
    const mesh = new THREE.Mesh(glowMerged, additiveMaterial(createLightAtlasTexture(), true))
    mesh.name = 'lamp-halos-and-washes'
    mesh.renderOrder = 1
    group.add(mesh)
  }

  // Ambient occlusion baked into the carpet: a dark bruise under the table and
  // each chair and pot, and along the wall bases, so nothing floats above the floor.
  const shade: THREE.BufferGeometry[] = []
  const blob = (tile: 0 | 1, w: number, d: number, x: number, z: number) =>
    shade.push(toAtlasTile(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, -1.988, z), tile, TILES))
  blob(0, 13.4, 9.6, 0, 0.1)
  blob(1, 8.4, 5.9, 0, 0)
  for (const [x, z] of chairFloorCenters()) {
    blob(0, 3.4, 3.2, x, z)
    blob(1, 1.9, 1.8, x, z)
  }
  for (const x of [-9.7, 9.7]) blob(1, 2.3, 2.3, x, -8.3)
  const wallGradient = (x0: number, z0: number, x1: number, z1: number, along: 'x' | 'z', flip: boolean) => floorQuad(
    Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), -1.99,
    (x, z) => {
      const t = along === 'z'
        ? (z - Math.min(z0, z1)) / Math.abs(z1 - z0)
        : (x - Math.min(x0, x1)) / Math.abs(x1 - x0)
      const u = flip ? 1 - t : t
      return [(2 + 0.02 + u * 0.96) / TILES, 0.5]
    }
  )
  shade.push(wallGradient(-16, -9.25, 16, -7.7, 'z', false))
  shade.push(wallGradient(-12.0, -9.25, -10.5, 11, 'x', false))
  shade.push(wallGradient(10.5, -9.25, 12.0, 11, 'x', true))
  const shadeMerged = mergeGeometries(shade, false)
  shade.forEach(part => part.dispose())
  if (shadeMerged) {
    const mesh = new THREE.Mesh(shadeMerged, new THREE.MeshBasicMaterial({
      map: createContactAtlasTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }))
    mesh.name = 'carpet-ambient-occlusion'
    mesh.renderOrder = 1
    group.add(mesh)
  }

  // Warm pool on the carpet under the key spot.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(19, 14), additiveMaterial(radialGlowTexture('255, 178, 104', 0.3), false))
  pool.name = 'carpet-light-pool'
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, -1.975, -0.4)
  pool.renderOrder = 1
  group.add(pool)
  return group
}
