import * as THREE from 'three'
import { sparkleTextureData } from './companion3D'

/**
 * The player's own chips on the felt. The stack "flexes" with the player's
 * fortunes relative to the starting stack:
 *
 *  - short  (< 0.75x): one modest column that shrinks as they bleed chips
 *  - neat   (< 1.6x):  a tidy 3-column stack (red, blue, green)
 *  - rich   (< 3x):    a 2x2 block sorted by denomination, low at the front
 *  - tower  (>= 3x):   the block evens out into a plinth and a purple tower
 *                      rises from the middle of it, crowned with gold-spot blacks
 *
 * Everything stays inside one compact footprint just right of the player's
 * hole cards and short of the neighbour's drink spot, so the bet/call hands
 * still land on it. Chips are proxies drawn by the shared chip instancer, so
 * the stack costs no extra draw calls however tall it gets. Chips joining the
 * stack drop in with a bounce and a gold flash; chips leaving lift and shrink
 * away (no pops).
 */

/** Hard cap on visible chips per seat. */
export const PERSONAL_STACK_MAX_CHIPS = 60

/** Denomination indices into CHIP_DENOMINATIONS, low value to high. */
const RED = 0
const BLUE = 1
const GREEN = 2
const BLACK = 3
const PURPLE = 4

/** Centre-to-centre spacing of neighbouring columns. */
const PITCH = 0.272
/** Block centre: right of the stack anchor and in from the felt edge. */
const BLOCK_X = 0.14
const BLOCK_Z = -0.17
const LEFT = BLOCK_X - PITCH / 2
const RIGHT = BLOCK_X + PITCH / 2
const FRONT = BLOCK_Z + PITCH / 2
const BACK = BLOCK_Z - PITCH / 2

export type PersonalStackTier = 'empty' | 'short' | 'neat' | 'rich' | 'tower'

export interface PersonalStackColumn {
  /** Stable within a tier, so a column that grows keeps its chips. */
  key: string
  /** Stack-local position: +x is the player's right, -z is toward the table centre. */
  x: number
  z: number
  /** Levels below the first chip (the tower rests on top of the block). */
  base: number
  /** Denomination of each chip, bottom to top. */
  denominations: number[]
}

export interface PersonalStackLayout {
  tier: PersonalStackTier
  ratio: number
  columns: PersonalStackColumn[]
  total: number
}

export interface PersonalStackLayoutOptions {
  /** Height cap in chip levels (the hero's own stack sits right under the camera). */
  maxLevels?: number
}

function column(
  key: string,
  x: number,
  z: number,
  count: number,
  denomination: (level: number, count: number) => number,
  base = 0
): PersonalStackColumn {
  const levels = Math.max(0, Math.round(count))
  return {
    key,
    x,
    z,
    base,
    denominations: Array.from({ length: levels }, (_, level) => denomination(level, levels)),
  }
}

const solid = (denomination: number) => () => denomination

export function getPersonalStackLayout(
  stack: number,
  startingStack: number,
  options: PersonalStackLayoutOptions = {}
): PersonalStackLayout {
  if (!(stack > 0)) return { tier: 'empty', ratio: 0, columns: [], total: 0 }
  const ratio = stack / Math.max(1, startingStack)
  const maxLevels = Math.max(4, options.maxLevels ?? Number.POSITIVE_INFINITY)
  const capped = (count: number) => Math.min(maxLevels, count)
  let tier: PersonalStackTier
  let columns: PersonalStackColumn[]
  if (ratio < 0.75) {
    tier = 'short'
    // One column, 1-8 chips; the top couple turn blue as it recovers.
    const count = THREE.MathUtils.clamp(Math.round(1.5 + ratio * 9), 1, 8)
    columns = [column('short:0', LEFT, FRONT, capped(count), (level, levels) => (ratio >= 0.4 && level >= levels - 2 ? BLUE : RED))]
  } else if (ratio < 1.6) {
    tier = 'neat'
    const t = (ratio - 0.75) / 0.85
    columns = [
      column('block:red', LEFT, FRONT, capped(6 + 3 * t), solid(RED)),
      column('block:blue', RIGHT, FRONT, capped(5 + 3 * t), solid(BLUE)),
      column('block:green', LEFT, BACK, capped(4 + 3 * t), solid(GREEN)),
    ]
  } else if (ratio < 3) {
    tier = 'rich'
    // The block fills in: low chips at the front, the big ones behind.
    const t = (ratio - 1.6) / 1.4
    columns = [
      column('block:red', LEFT, FRONT, capped(8 + 2 * t), solid(RED)),
      column('block:blue', RIGHT, FRONT, capped(7 + 3 * t), solid(BLUE)),
      column('block:green', LEFT, BACK, capped(7 + 3 * t), solid(GREEN)),
      column('block:black', RIGHT, BACK, capped(5 + 5 * t), solid(BLACK)),
    ]
  } else {
    tier = 'tower'
    // An even plinth (so the tower sits flat) with a purple column rising from
    // its middle, resting on all four stacks, crowned with gold-spot blacks.
    const t = THREE.MathUtils.clamp((ratio - 3) / 3, 0, 1)
    let plinth = Math.round(9 + 2 * t)
    let crown = Math.round(8 + 5 * t)
    if (plinth + crown > maxLevels) {
      const scale = maxLevels / (plinth + crown)
      plinth = Math.max(3, Math.round(plinth * scale))
      crown = Math.max(3, maxLevels - plinth)
    }
    columns = [
      column('block:red', LEFT, FRONT, plinth, solid(RED)),
      column('block:blue', RIGHT, FRONT, plinth, solid(BLUE)),
      column('block:green', LEFT, BACK, plinth, solid(GREEN)),
      column('block:black', RIGHT, BACK, plinth, solid(BLACK)),
      column('tower:crown', BLOCK_X, BLOCK_Z, crown, (level, levels) => (level >= levels - 3 ? BLACK : PURPLE), plinth),
    ]
  }
  columns = columns.filter(entry => entry.denominations.length > 0)
  const total = columns.reduce((sum, entry) => sum + entry.denominations.length, 0)
  return { tier, ratio, columns, total }
}

/** Height of a column's top, in chip levels. */
export function getColumnTop(entry: PersonalStackColumn) {
  return entry.base + entry.denominations.length
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const FREE = 0
const ARRIVING = 1
const LIVE = 2
const LEAVING = 3

const DROP_HEIGHT = 0.42
const FALL_SECONDS = 0.3
const BOUNCE_SECONDS = 0.14
const LEAVE_SECONDS = 0.26
const GLOW_SECONDS = 0.75

interface Slot {
  key: string
  column: number
  level: number
  denomination: number
  x: number
  z: number
  top: boolean
}

const sparkleWorld = new THREE.Vector3()

/**
 * Drives one seat's chip proxies (created by the room's chip-set factory and
 * drawn by the chip instancer). `levelHeight` is the chip pitch, `chipHeight`
 * the chip thickness.
 */
export class PersonalChipStack {
  readonly chips: THREE.Mesh[]
  private readonly state: Uint8Array
  private readonly startAt: Float32Array
  private readonly slotKey: string[]
  private readonly targets: THREE.Vector3[]
  private readonly yaw: Float32Array
  private readonly landed: Uint8Array
  layout: PersonalStackLayout = { tier: 'empty', ratio: 0, columns: [], total: 0 }
  private layoutSignature = ''
  /** The table's chip leader gets a slow gold glint running up the stack. */
  private leader = false
  private busyUntil = Number.NEGATIVE_INFINITY
  private readonly glintPhase: number

  constructor(
    chips: THREE.Mesh[],
    private readonly levelHeight: number,
    private readonly chipHeight: number,
    seed = 1
  ) {
    this.chips = chips
    const count = chips.length
    this.state = new Uint8Array(count)
    this.startAt = new Float32Array(count)
    this.landed = new Uint8Array(count)
    this.slotKey = Array.from({ length: count }, () => '')
    this.targets = chips.map(() => new THREE.Vector3())
    this.yaw = new Float32Array(count)
    let random = seed * 9301 + 49297
    const next = () => {
      random = (random * 9301 + 49297) % 233280
      return random / 233280
    }
    chips.forEach((chip, index) => {
      this.yaw[index] = next() * Math.PI * 2
      chip.visible = false
      chip.userData.glow = 0
    })
    this.glintPhase = next()
    // Every player stacks a little differently: some keep the block mirrored,
    // and each column sits a few millimetres off the grid with its own lean.
    this.mirrored = next() < 0.5
    this.placementSeed = Math.floor(next() * 100000)
  }

  private readonly mirrored: boolean
  private readonly placementSeed: number
  private readonly columnPlacements = new Map<string, readonly [number, number, number, number]>()

  /** Stack-local x/z of a column's chip at `level`, with this player's own slop. */
  private place(key: string, x: number, z: number, level: number, out: THREE.Vector3) {
    let placement = this.columnPlacements.get(key)
    if (!placement) {
      let hash = this.placementSeed
      for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) % 1000003
      const unit = (salt: number) => {
        const value = Math.sin(hash * 12.9898 + salt * 78.233) * 43758.5453
        return (value - Math.floor(value)) * 2 - 1
      }
      // Offset (±12mm) and a per-level lean (±1.2mm per chip).
      placement = [unit(1) * 0.012, unit(2) * 0.012, unit(3) * 0.0012, unit(4) * 0.0012] as const
      this.columnPlacements.set(key, placement)
    }
    const baseX = this.mirrored ? BLOCK_X * 2 - x : x
    out.x = baseX + placement[0] + placement[2] * level
    out.z = z + placement[1] + placement[3] * level
    return out
  }

  setLeader(leader: boolean, time: number) {
    if (leader === this.leader) return
    this.leader = leader
    // Let the last glint fade out rather than freezing mid-sweep.
    this.busyUntil = Math.max(this.busyUntil, time + 0.5)
  }

  /** Total chips standing (or on their way in). */
  get count() {
    return this.layout.total
  }

  /** Height in levels of the tallest column, for payouts landing on top. */
  get tallestLevels() {
    return this.layout.columns.reduce((best, entry) => Math.max(best, getColumnTop(entry)), 0)
  }

  /** Stack-local point on top of the tallest column (payout chips land here). */
  getLandingPoint(out: THREE.Vector3) {
    const tallest = this.layout.columns.reduce<PersonalStackColumn | null>(
      (best, entry) => (!best || getColumnTop(entry) > getColumnTop(best) ? entry : best),
      null
    )
    const top = tallest ? getColumnTop(tallest) : 0
    if (tallest) this.place(tallest.key, tallest.x, tallest.z, top, out)
    else out.set(0, 0, 0)
    out.y = top * this.levelHeight + this.chipHeight / 2
    return out
  }

  /**
   * Re-lays the stack for a new chip count. Chips whose slot survives stay put,
   * chips of a denomination that is still wanted glide to their new slot,
   * surplus chips leave from the top down and new ones drop in bottom first
   * (after `delay` seconds, e.g. while payout chips are still in the air).
   */
  sync(stack: number, startingStack: number, time: number, options: { delay?: number; maxLevels?: number; reducedMotion?: boolean } = {}) {
    const layout = getPersonalStackLayout(stack, startingStack, { maxLevels: options.maxLevels })
    const signature = layout.columns.map(entry => `${entry.key}=${entry.denominations.join('')}`).join('|')
    if (signature === this.layoutSignature) return
    this.layoutSignature = signature
    this.layout = layout

    const slots: Slot[] = []
    layout.columns.forEach((entry, columnIndex) => {
      entry.denominations.forEach((denomination, level) => {
        slots.push({
          key: `${entry.key}:${level}`,
          column: columnIndex,
          level: entry.base + level,
          denomination,
          x: entry.x,
          z: entry.z,
          top: level === entry.denominations.length - 1,
        })
      })
    })

    const chips = this.chips
    const assigned = new Int16Array(slots.length).fill(-1)
    const claimed = new Uint8Array(chips.length)
    const slotIndexByKey = new Map(slots.map((slot, index) => [slot.key, index]))
    // 1) Chips whose exact slot is still wanted (same column, level, colour) stay.
    chips.forEach((chip, index) => {
      if (this.state[index] !== LIVE && this.state[index] !== ARRIVING) return
      const slotIndex = slotIndexByKey.get(this.slotKey[index]!)
      if (slotIndex === undefined || assigned[slotIndex]! >= 0) return
      if (slots[slotIndex]!.denomination !== chip.userData.denomination) return
      assigned[slotIndex] = index
      claimed[index] = 1
    })
    // 2) Other standing chips of a wanted colour glide over (lowest first).
    const standing = chips
      .map((chip, index) => ({ chip, index }))
      .filter(({ index }) => !claimed[index] && (this.state[index] === LIVE || this.state[index] === ARRIVING))
      .sort((a, b) => this.targets[a.index]!.y - this.targets[b.index]!.y)
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (assigned[slotIndex]! >= 0) continue
      const match = standing.find(({ chip, index }) => !claimed[index] && chip.userData.denomination === slots[slotIndex]!.denomination)
      if (!match) continue
      assigned[slotIndex] = match.index
      claimed[match.index] = 1
    }
    // 3) Standing chips nobody wants leave, top of the stack first.
    const leaving = standing.filter(({ index }) => !claimed[index]).sort((a, b) => this.targets[b.index]!.y - this.targets[a.index]!.y)
    const leaveStep = Math.min(0.03, 0.35 / Math.max(1, leaving.length))
    leaving.forEach(({ chip, index }, rank) => {
      this.state[index] = LEAVING
      this.startAt[index] = time + rank * leaveStep
      this.slotKey[index] = ''
      chip.userData.level = -1
    })
    // 4) Empty slots are filled by free chips dropping in, bottom first.
    // (Chips still on their way out are recycled only if the pool runs dry.)
    const free = chips.map((_, index) => index).filter(index => this.state[index] === FREE)
    free.push(...leaving.map(({ index }) => index).reverse())
    const arrivals: number[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (assigned[slotIndex]! >= 0) continue
      const index = free.shift()
      if (index === undefined) break
      assigned[slotIndex] = index
      arrivals.push(slotIndex)
    }
    arrivals.sort((a, b) => slots[a]!.level - slots[b]!.level || slots[a]!.column - slots[b]!.column)
    const arriveStep = Math.min(0.04, 0.6 / Math.max(1, arrivals.length))
    const delay = options.delay ?? 0
    arrivals.forEach((slotIndex, rank) => {
      const index = assigned[slotIndex]!
      this.state[index] = ARRIVING
      this.startAt[index] = time + delay + rank * arriveStep
      this.landed[index] = 0
    })

    // Point every assigned chip at its slot.
    slots.forEach((slot, slotIndex) => {
      const index = assigned[slotIndex]!
      if (index < 0) return
      const chip = chips[index]!
      // A hand-placed wobble, fixed per chip so it doesn't shimmer.
      const wobble = (this.yaw[index]! / (Math.PI * 2) - 0.5) * 0.01
      const target = this.place(slot.key.slice(0, slot.key.lastIndexOf(':')), slot.x, slot.z, slot.level, this.targets[index]!)
      target.set(
        target.x + wobble,
        this.chipHeight / 2 + slot.level * this.levelHeight,
        target.z - wobble * 0.7
      )
      this.slotKey[index] = slot.key
      chip.userData.denomination = slot.denomination
      chip.userData.level = slot.level
      chip.userData.stackTop = slot.top
    })

    if (options.reducedMotion) this.settle()
    this.busyUntil = Math.max(
      this.busyUntil,
      time + delay + arrivals.length * arriveStep + FALL_SECONDS + BOUNCE_SECONDS + GLOW_SECONDS,
      time + leaving.length * leaveStep + LEAVE_SECONDS,
      time + 1
    )
  }

  /** Snaps every chip to its final state (reduced motion). */
  settle() {
    this.chips.forEach((chip, index) => {
      if (this.state[index] === LEAVING) this.state[index] = FREE
      if (this.state[index] === ARRIVING) this.state[index] = LIVE
      if (this.state[index] === FREE) {
        chip.visible = false
        return
      }
      chip.visible = true
      chip.position.copy(this.targets[index]!)
      chip.rotation.set(0, this.yaw[index]!, 0)
      chip.scale.setScalar(1)
      chip.userData.glow = 0
    })
  }

  /**
   * Per-frame animation. `group` is the stack's world-space group (for
   * sparkle positions); `sparkles` is the table-wide sparkle pool.
   */
  update(time: number, delta: number, reducedMotion: boolean, group: THREE.Object3D, sparkles: StackSparkles | null) {
    const glinting = this.leader && !reducedMotion && this.layout.total > 0
    if (time > this.busyUntil && !glinting) return
    if (reducedMotion) {
      this.settle()
      return
    }
    const glide = 1 - Math.exp(-delta * 12)
    // Leader glint: a band of gold light runs up the stack every few seconds.
    const cycle = (time * 0.32 + this.glintPhase) % 1
    const glintHeight = cycle * 1.6 - 0.2
    const tallest = Math.max(1, this.tallestLevels)
    let glintSpark = false
    this.chips.forEach((chip, index) => {
      const state = this.state[index]
      if (state === FREE) {
        chip.visible = false
        return
      }
      const target = this.targets[index]!
      let glow = 0
      if (state === ARRIVING) {
        const elapsed = time - this.startAt[index]!
        if (elapsed < 0) {
          chip.visible = false
          return
        }
        chip.visible = true
        chip.scale.setScalar(1)
        if (elapsed < FALL_SECONDS) {
          const p = elapsed / FALL_SECONDS
          chip.position.set(target.x, target.y + DROP_HEIGHT * (1 - p * p), target.z)
          chip.rotation.set(Math.sin(p * Math.PI) * 0.35, this.yaw[index]! + (1 - p) * 2.2, 0)
        } else {
          const q = Math.min(1, (elapsed - FALL_SECONDS) / BOUNCE_SECONDS)
          chip.position.set(target.x, target.y + Math.sin(q * Math.PI) * 0.022, target.z)
          chip.rotation.set(0, this.yaw[index]!, 0)
          if (!this.landed[index]) {
            this.landed[index] = 1
            // A glint on the new top of each column as it lands.
            if (chip.userData.stackTop && sparkles) {
              sparkleWorld.copy(target)
              sparkleWorld.y += this.chipHeight * 0.8
              group.localToWorld(sparkleWorld)
              sparkles.spawn(sparkleWorld, time, 1)
            }
          }
          if (q >= 1 && elapsed - FALL_SECONDS - BOUNCE_SECONDS > GLOW_SECONDS) this.state[index] = LIVE
        }
        const sinceLanding = elapsed - FALL_SECONDS
        glow = sinceLanding < 0 ? 0 : Math.max(0, 1 - sinceLanding / GLOW_SECONDS) ** 1.5
      } else if (state === LEAVING) {
        const p = (time - this.startAt[index]!) / LEAVE_SECONDS
        if (p >= 1) {
          this.state[index] = FREE
          chip.visible = false
          chip.scale.setScalar(1)
          chip.userData.glow = 0
          return
        }
        chip.visible = true
        const eased = Math.max(0, p) ** 2
        chip.position.set(chip.position.x, target.y + Math.max(0, p) * 0.06, chip.position.z)
        chip.scale.setScalar(Math.max(0.001, 1 - eased))
      } else {
        chip.visible = true
        chip.scale.setScalar(1)
        chip.position.lerp(target, glide)
        chip.rotation.set(0, this.yaw[index]!, 0)
      }
      if (glinting && state !== LEAVING) {
        const level = Number(chip.userData.level ?? 0)
        const band = level / tallest - glintHeight
        const glint = Math.exp(-(band * band) / 0.006) * 0.55
        glow = Math.max(glow, glint)
        if (glint > 0.4 && chip.userData.stackTop && level === tallest - 1) glintSpark = true
      }
      chip.userData.glow = glow
    })
    if (glintSpark && sparkles && time - sparkles.lastLeaderSpark > 1.2) {
      this.getLandingPoint(sparkleWorld)
      group.localToWorld(sparkleWorld)
      sparkles.spawn(sparkleWorld, time, 0.8)
      sparkles.lastLeaderSpark = time
    }
  }
}

// ---------------------------------------------------------------------------
// Sparkles: one Points object for every stack at the table (one draw call).
// ---------------------------------------------------------------------------

const SPARKLE_POOL = 48
const SPARKLE_SECONDS = 0.55

export class StackSparkles {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly born = new Float32Array(SPARKLE_POOL).fill(Number.NEGATIVE_INFINITY)
  private readonly strength = new Float32Array(SPARKLE_POOL)
  private readonly origin = new Float32Array(SPARKLE_POOL * 3)
  private next = 0
  lastLeaderSpark = Number.NEGATIVE_INFINITY

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKLE_POOL * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKLE_POOL * 3), 3))
    const texture = new THREE.DataTexture(sparkleTextureData(64), 64, 64, THREE.RGBAFormat)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: texture,
        // Small and soft: a glint, not a white hot-spot under the bloom.
        size: 0.13,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    )
    this.points.name = 'personal-stack-sparkles'
    this.points.frustumCulled = false
    this.points.renderOrder = 3
    this.points.visible = false
    scene.add(this.points)
  }

  /** A small burst of 2-3 glints around a world point. */
  spawn(world: THREE.Vector3, time: number, strength: number) {
    const burst = strength >= 1 ? 3 : 2
    for (let index = 0; index < burst; index += 1) {
      const slot = this.next
      this.next = (this.next + 1) % SPARKLE_POOL
      const angle = Math.random() * Math.PI * 2
      const radius = 0.03 + Math.random() * 0.1
      this.origin[slot * 3] = world.x + Math.cos(angle) * radius
      this.origin[slot * 3 + 1] = world.y + Math.random() * 0.05
      this.origin[slot * 3 + 2] = world.z + Math.sin(angle) * radius
      this.born[slot] = time + index * 0.06
      this.strength[slot] = strength * (index === 0 ? 1 : 0.7)
    }
  }

  update(time: number) {
    const positions = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = this.points.geometry.getAttribute('color') as THREE.BufferAttribute
    let any = false
    for (let slot = 0; slot < SPARKLE_POOL; slot += 1) {
      const age = time - this.born[slot]!
      const alive = age >= 0 && age < SPARKLE_SECONDS
      // A quick twinkle: flare up, then fade while drifting upward.
      const life = alive ? age / SPARKLE_SECONDS : 1
      const intensity = alive ? Math.sin(Math.min(1, life * 2.2) * Math.PI * 0.5) * (1 - life) * 0.95 * this.strength[slot]! : 0
      any ||= intensity > 0.001
      positions.setXYZ(slot, this.origin[slot * 3]!, this.origin[slot * 3 + 1]! + life * 0.08, this.origin[slot * 3 + 2]!)
      colors.setXYZ(slot, intensity, intensity * 0.8, intensity * 0.42)
    }
    this.points.visible = any
    if (any) {
      positions.needsUpdate = true
      colors.needsUpdate = true
    }
  }
}
