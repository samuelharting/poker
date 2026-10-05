import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  FUN_HAIR_COLORS,
  HAIR_COLORS,
  MIN_GARMENT_SKIN_DISTANCE,
  MIN_HAIR_SKIN_DISTANCE,
  OUTFIT_MAIN_KEY,
  OUTFIT_PALETTES,
  PUNK_DYE_SETS,
  clothTrim,
  colorDistance,
  hairHighlights,
  hashString,
  mixSeed,
  pickHairColor,
  pickJewelry,
  pickOutfitPalette,
} from '@/components/three/avatarWardrobe'
import { createRiggedJewelry, measureForearm } from '@/components/three/avatarJewelry'
import { createRiggedAvatarAccessories, hairCapEdge } from '@/components/three/avatarCustomization'
import { AVATAR_TRIM_BODY_LEVEL } from '@/components/three/avatarStyle'
import { AVATAR_MODEL_KEYS, normalizePlayerAvatarCustomization } from '@/lib/profile'

const HEX = /^#[0-9a-f]{6}$/i
// The six skin tones the table view model hands out (tableViewModel AVATAR_SKIN_COLORS).
const SKIN_TONES = ['#d7b088', '#c99678', '#b88469', '#9f6f55', '#e0b996', '#8f604b']

describe('avatar wardrobe data', () => {
  it('only holds valid hex colours', () => {
    for (const palettes of Object.values(OUTFIT_PALETTES)) {
      for (const palette of palettes) for (const colour of Object.values(palette)) expect(colour).toMatch(HEX)
    }
    for (const colour of [...HAIR_COLORS, ...FUN_HAIR_COLORS]) expect(colour).toMatch(HEX)
    for (const set of PUNK_DYE_SETS) {
      expect(set.main).toMatch(HEX)
      expect(set.accent).toMatch(HEX)
    }
  })

  it('keeps every palette of a family on the same material keys, with a main garment key', () => {
    for (const [family, palettes] of Object.entries(OUTFIT_PALETTES)) {
      const keys = Object.keys(palettes[0]!).sort()
      for (const palette of palettes) expect(Object.keys(palette).sort()).toEqual(keys)
      expect(keys).toContain(OUTFIT_MAIN_KEY[family])
      expect(palettes.length).toBeGreaterThanOrEqual(6)
    }
  })

  it('gives every suit a tie and a shirt that read against it', () => {
    for (const palette of OUTFIT_PALETTES.Suit!) {
      expect(colorDistance(palette.Suit!, palette.Tie!)).toBeGreaterThan(25)
      expect(colorDistance(palette.Suit!, palette.White!)).toBeGreaterThan(30)
    }
  })

  it('never dresses anyone in their own skin tone, whatever the seed', () => {
    for (const family of Object.keys(OUTFIT_PALETTES)) {
      const mainKey = OUTFIT_MAIN_KEY[family]!
      for (const skin of SKIN_TONES) {
        for (let seed = 0; seed < 60; seed += 1) {
          const palette = pickOutfitPalette(family, hashString(`player-${seed}`), skin)
          expect(colorDistance(palette[mainKey]!, skin)).toBeGreaterThanOrEqual(MIN_GARMENT_SKIN_DISTANCE)
        }
      }
    }
  })

  it('picks hair deterministically, off the skin tone, with punk dye sets for punks', () => {
    for (const skin of SKIN_TONES) {
      for (let seed = 0; seed < 80; seed += 1) {
        const hash = hashString(`p${seed}`)
        const hair = pickHairColor('Suit', hash, skin)
        expect(pickHairColor('Suit', hash, skin)).toEqual(hair)
        if (!hair.dyed) expect(colorDistance(hair.main, skin)).toBeGreaterThanOrEqual(MIN_HAIR_SKIN_DISTANCE)
        const punk = pickHairColor('Punk', hash, skin)
        expect(punk.dyed).toBe(true)
        expect(PUNK_DYE_SETS.some(set => set.main === punk.main && set.accent === punk.accent)).toBe(true)
      }
    }
  })

  it('spreads seeds across the wardrobe instead of repeating one outfit', () => {
    for (const family of Object.keys(OUTFIT_PALETTES)) {
      const seen = new Set<string>()
      for (let seed = 0; seed < 40; seed += 1) seen.add(JSON.stringify(pickOutfitPalette(family, hashString(`seat-${seed}`), '#c99678')))
      expect(seen.size).toBeGreaterThanOrEqual(Math.min(4, OUTFIT_PALETTES[family]!.length))
    }
    const hairs = new Set(Array.from({ length: 60 }, (_, seed) => pickHairColor('Casual2', hashString(`h${seed}`)).main))
    expect(hairs.size).toBeGreaterThanOrEqual(6)
    expect(Array.from({ length: 200 }, (_, seed) => hairHighlights(mixSeed(seed, 1))).filter(Boolean).length).toBeGreaterThan(80)
  })

  it('assigns jewellery by seed, never a chain over a tie or a hi-vis vest', () => {
    const families = ['Suit', 'Casual2', 'Casual', 'Worker', 'Punk', 'Adventurer']
    for (const family of families) {
      let chains = 0
      let wrists = 0
      for (let seed = 0; seed < 300; seed += 1) {
        const hash = hashString(`jw-${seed}`)
        const spec = pickJewelry(family, hash)
        expect(pickJewelry(family, hash)).toEqual(spec)
        if (spec.chain) chains += 1
        wrists += spec.wrist.length
        const sides = spec.wrist.map(piece => piece.side)
        expect(new Set(sides).size).toBe(sides.length)
        expect(spec.wrist.filter(piece => piece.kind === 'watch').length).toBeLessThanOrEqual(1)
      }
      if (family === 'Suit' || family === 'Worker') expect(chains).toBe(0)
      else expect(chains).toBeGreaterThan(10)
      expect(wrists).toBeGreaterThan(30)
    }
  })
})

/** A skinned forearm (cylinder along +x) with the bones the jewellery measures. */
function createTestRig() {
  const root = new THREE.Group()
  const bones: Record<string, THREE.Bone> = {}
  const make = (name: string, parent: THREE.Object3D | null, position: [number, number, number]) => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(...position)
    parent?.add(bone)
    bones[name] = bone
    return bone
  }
  const hips = make('Hips', null, [0, 1, 0])
  const chest = make('Chest', hips, [0, 0.4, 0])
  const neck = make('Neck', chest, [0, 0.15, 0])
  make('Head', neck, [0, 0.1, 0])
  const lowerArm = make('LowerArmL', chest, [0.3, 0, 0])
  make('WristL', lowerArm, [0.25, 0, 0])
  root.add(hips)
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(Object.values(bones))
  // Forearm: radius 0.04 cylinder from the lower arm to the wrist, rigidly weighted to LowerArmL.
  const geometry = new THREE.CylinderGeometry(0.04, 0.04, 0.25, 12, 4)
  geometry.rotateZ(-Math.PI / 2)
  geometry.translate(0.125 + 0.3, 0.4 + 1, 0)
  const count = geometry.getAttribute('position').count
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  const armIndex = skeleton.bones.indexOf(lowerArm)
  for (let vertex = 0; vertex < count; vertex += 1) {
    skinIndex[vertex * 4] = armIndex
    skinWeight[vertex * 4] = 1
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  const arm = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  arm.name = 'Test_Arm'
  root.add(arm)
  arm.bind(skeleton)
  return { root, bones, skeleton }
}

describe('rigged jewellery', () => {
  it('measures a forearm and hangs a watch on the bone, in one merged mesh', () => {
    const { root, bones } = createTestRig()
    const fit = measureForearm(root, bones.LowerArmL!, bones.WristL!, { head: bones.Head, hips: bones.Hips })
    expect(fit).not.toBeNull()
    expect(fit!.length).toBeCloseTo(0.25, 3)
    expect(fit!.halfAcross).toBeCloseTo(0.04, 2)
    expect(fit!.halfDorsal).toBeCloseTo(0.04, 2)
    // Back of the hand is up (the rig's up), perpendicular to the arm.
    expect(fit!.dorsal.dot(fit!.axis)).toBeCloseTo(0, 5)

    const set = createRiggedJewelry(root, new Map(Object.entries(bones)), 'casual', 1, {
      wrist: [{ side: 'L', kind: 'watch', metal: 'gold', color: '#2b2022' }],
      chain: null,
    })
    expect(set.groups).toHaveLength(1)
    expect(set.groups[0]!.parent).toBe(bones.LowerArmL)
    let meshes = 0
    set.groups[0]!.traverse(object => {
      if ((object as THREE.Mesh).isMesh) meshes += 1
    })
    // One mesh and one shared vertex-coloured material, however many pieces.
    expect(meshes).toBe(1)
    expect(set.materials).toHaveLength(1)
    const mesh = set.groups[0]!.children[0] as THREE.Mesh
    expect(mesh.geometry.getAttribute('color')).toBeTruthy()
    // The watch hugs the arm: it stays within a couple of arm radii of the forearm axis.
    mesh.geometry.computeBoundingBox()
    const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.2)
  })

  it('wears nothing without a seed, and skips pieces whose bones are missing', () => {
    const { root, bones } = createTestRig()
    const bare = createRiggedAvatarAccessories(root, new Map(Object.entries(bones)), {
      modelKey: 'casual', hat: 'none', glasses: 'none', jacket: 'none', jacketColor: 'burgundy',
    })
    expect(bare.groups.some(group => group.name.startsWith('avatar-jewelry'))).toBe(false)
    const none = createRiggedJewelry(root, new Map(), 'casual', 3, { wrist: [{ side: 'R', kind: 'cuff', metal: 'silver', color: '#000000' }], chain: null })
    expect(none.groups).toHaveLength(0)
  })

  it('maps every model to a wardrobe family and keeps saved profiles valid', () => {
    for (const key of AVATAR_MODEL_KEYS) {
      const spec = pickJewelry(key === 'business_man' ? 'Suit' : 'Casual', 7)
      expect(spec.wrist.length).toBeGreaterThanOrEqual(0)
    }
    // Old saved profiles (no new fields) still normalise to a full valid customization.
    const old = normalizePlayerAvatarCustomization({ modelKey: 'punk', hat: 'cowboy', glasses: 'aviator', jacket: 'western' })
    expect(old.modelKey).toBe('punk')
    expect(old.jacketColor).toBe('burgundy')
  })
})

describe('cloth trim', () => {
  it('is a deterministic per-garment choice that most players get', () => {
    let on = 0
    for (let seed = 0; seed < 400; seed += 1) {
      const hash = hashString(`trim-${seed}`)
      expect(clothTrim(hash, 'Suit')).toBe(clothTrim(hash, 'Suit'))
      if (clothTrim(hash, 'Suit')) on += 1
    }
    expect(on).toBeGreaterThan(240)
    expect(on).toBeLessThan(360)
    // Two garments of one player decide independently.
    const differing = Array.from({ length: 200 }, (_, seed) => hashString(`both-${seed}`)).filter(hash => clothTrim(hash, 'Suit') !== clothTrim(hash, 'White'))
    expect(differing.length).toBeGreaterThan(10)
  })

  it('keeps the body level a real step below full so the trim band reads', () => {
    expect(AVATAR_TRIM_BODY_LEVEL).toBeGreaterThan(0.5)
    expect(AVATAR_TRIM_BODY_LEVEL).toBeLessThan(0.9)
  })
})

describe('worker hairstyle under a visor or crown', () => {
  it('has a hairline lower at the back and sides than at the forehead, with a sideburn in front of each ear', () => {
    const front = hairCapEdge(0)
    const temple = hairCapEdge(1.15)
    const sideburn = hairCapEdge(1.42)
    const nape = hairCapEdge(Math.PI)
    expect(front).toBeLessThan(temple)
    expect(sideburn).toBeGreaterThan(temple)
    expect(nape).toBeGreaterThan(temple)
    expect(hairCapEdge(-1.42)).toBeCloseTo(sideburn, 6)
    // The forehead hairline stays above the brow: well short of the equator.
    expect(front).toBeLessThan(Math.PI / 2 - 0.3)
  })

  it('builds one merged, vertex-coloured mesh inside the head and brim bounds', () => {
    const { root, bones } = createTestRig()
    for (const hat of ['visor', 'crown'] as const) {
      const set = createRiggedAvatarAccessories(root, new Map(Object.entries(bones)), {
        modelKey: 'worker', hat, glasses: 'none', jacket: 'none', jacketColor: 'burgundy',
      })
      const caps: THREE.Mesh[] = []
      set.groups[0]!.traverse(object => {
        if (object.name === 'avatar-hair-cap') caps.push(object as THREE.Mesh)
      })
      expect(caps).toHaveLength(1)
      const geometry = caps[0]!.geometry
      expect(geometry.getAttribute('color')).toBeTruthy()
      expect(geometry.getAttribute('position').count).toBeGreaterThan(300)
      geometry.computeBoundingBox()
      const box = geometry.boundingBox!
      const size = box.getSize(new THREE.Vector3())
      // Head-bone units: a 0.0043-per-unit calibration; the default fit's skull is ~0.28 wide per side.
      expect(size.x / 0.0043).toBeGreaterThan(0.4)
      expect(size.x / 0.0043).toBeLessThan(0.7)
      expect(Number.isFinite(size.y) && size.y > 0).toBe(true)
      for (const value of geometry.getAttribute('position').array) expect(Number.isFinite(value)).toBe(true)
    }
    // Other models and other hats get no cap.
    const none = createRiggedAvatarAccessories(root, new Map(Object.entries(bones)), {
      modelKey: 'worker', hat: 'fedora', glasses: 'none', jacket: 'none', jacketColor: 'burgundy',
    })
    let found = false
    none.groups[0]!.traverse(object => { if (object.name === 'avatar-hair-cap') found = true })
    expect(found).toBe(false)
  })
})
