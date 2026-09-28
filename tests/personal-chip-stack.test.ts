import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  PERSONAL_STACK_MAX_CHIPS,
  PersonalChipStack,
  getColumnTop,
  getPersonalStackLayout,
} from '@/components/three/personalChipStack'

const START = 1000

describe('getPersonalStackLayout', () => {
  it('shows nothing for a busted player', () => {
    expect(getPersonalStackLayout(0, START)).toMatchObject({ tier: 'empty', total: 0, columns: [] })
  })

  it('grows through the tiers as the stack grows', () => {
    const tiers = [100, 500, 1000, 2000, 4000].map(stack => getPersonalStackLayout(stack, START).tier)
    expect(tiers).toEqual(['short', 'short', 'neat', 'rich', 'tower'])
  })

  it('keeps a short stack to one modest column that shrinks', () => {
    const small = getPersonalStackLayout(100, START)
    const bigger = getPersonalStackLayout(600, START)
    expect(small.columns).toHaveLength(1)
    expect(bigger.columns).toHaveLength(1)
    expect(small.total).toBeLessThan(bigger.total)
    expect(bigger.total).toBeLessThanOrEqual(8)
  })

  it('never shrinks as the stack grows and caps the chip count', () => {
    let previous = 0
    for (let stack = 50; stack <= 20000; stack += 50) {
      const { total } = getPersonalStackLayout(stack, START)
      expect(total).toBeLessThanOrEqual(PERSONAL_STACK_MAX_CHIPS)
      // Tier changes may re-shuffle, but the pile never visibly loses much.
      expect(total).toBeGreaterThanOrEqual(previous - 2)
      previous = Math.max(previous, total)
    }
  })

  it('builds a tower on an even plinth, crowned with black chips, when up big', () => {
    const tower = getPersonalStackLayout(4000, START)
    const crown = tower.columns.find(entry => entry.key === 'tower:crown')!
    const plinth = tower.columns.filter(entry => entry !== crown)
    expect(plinth).toHaveLength(4)
    // The plinth is flat, and the crown rests right on top of it.
    expect(new Set(plinth.map(getColumnTop)).size).toBe(1)
    expect(crown.base).toBe(getColumnTop(plinth[0]!))
    expect(getColumnTop(crown)).toBeGreaterThanOrEqual(18)
    expect(crown.denominations.slice(-3)).toEqual([3, 3, 3])
    // Much taller than the richest non-tower stack.
    const rich = getPersonalStackLayout(2990, START)
    expect(getColumnTop(crown)).toBeGreaterThan(Math.max(...rich.columns.map(getColumnTop)) + 5)
  })

  it('sorts rich stacks by denomination', () => {
    const rich = getPersonalStackLayout(2200, START)
    const denominations = rich.columns.map(entry => entry.denominations[0])
    expect(denominations).toEqual([...denominations].sort((a, b) => a! - b!))
  })

  it('respects a height cap without losing the crown', () => {
    const capped = getPersonalStackLayout(8000, START, { maxLevels: 11 })
    expect(Math.max(...capped.columns.map(getColumnTop))).toBeLessThanOrEqual(11)
    const tallest = capped.columns.find(entry => entry.key === 'tower:crown')!
    expect(tallest.denominations.at(-1)).toBe(3)
  })
})

function makeChips(count: number) {
  const group = new THREE.Group()
  return Array.from({ length: count }, () => {
    const chip = new THREE.Mesh()
    group.add(chip)
    return chip
  })
}

describe('PersonalChipStack', () => {
  it('drops new chips in and lifts spent chips away without popping', () => {
    const chips = makeChips(PERSONAL_STACK_MAX_CHIPS + 12)
    const stack = new PersonalChipStack(chips, 0.044, 0.042)
    const group = new THREE.Group()
    stack.sync(START, START, 0)
    stack.update(0.001, 0.016, false, group, null)
    // Nothing is visible before its staggered drop starts... then all land.
    for (let time = 0; time < 3; time += 0.05) stack.update(time, 0.05, false, group, null)
    const shown = () => chips.filter(chip => chip.visible).length
    expect(shown()).toBe(stack.count)

    // A bet: the stack shrinks; the leaving chips fade out over a few frames.
    stack.sync(600, START, 3)
    stack.update(3.02, 0.02, false, group, null)
    expect(shown()).toBeGreaterThan(stack.count)
    for (let time = 3.02; time < 5; time += 0.05) stack.update(time, 0.05, false, group, null)
    expect(shown()).toBe(stack.count)
  })

  it('stacks a little differently for every player (no cloned stacks)', () => {
    const placements = [3, 11, 29].map(seed => {
      const chips = makeChips(PERSONAL_STACK_MAX_CHIPS + 12)
      const stack = new PersonalChipStack(chips, 0.044, 0.042, seed)
      stack.sync(1000, START, 0, { reducedMotion: true })
      return chips.filter(chip => chip.visible).map(chip => `${chip.position.x.toFixed(3)},${chip.position.z.toFixed(3)}`).sort().join('|')
    })
    expect(new Set(placements).size).toBe(placements.length)
  })

  it('keeps chips that still have a place when the stack grows', () => {
    const chips = makeChips(PERSONAL_STACK_MAX_CHIPS + 12)
    const stack = new PersonalChipStack(chips, 0.044, 0.042)
    const group = new THREE.Group()
    stack.sync(1000, START, 0, { reducedMotion: true })
    const before = chips.filter(chip => chip.visible)
    stack.sync(1200, START, 1)
    stack.update(1.01, 0.01, false, group, null)
    // Every chip that was standing is still standing (the new ones are queued).
    expect(before.every(chip => chip.visible)).toBe(true)
  })
})
