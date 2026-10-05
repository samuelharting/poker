import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_CAMERA_FRAMING } from '@/components/three/cameraFraming'
import {
  SHOWDOWN_CAMERA_TUNING as TUNING,
  ShowdownDirector,
  blendShowdownShot,
  constrainShowdownCamera,
  createShowdownShot,
  type ShowdownShot,
  type ShowdownSnapshot,
  type ShowdownSnapshotPlayer,
} from '@/components/three/showdownCamera'
import { TABLE_SEAT_POSITIONS } from '@/components/three/tableWagerLayout'

vi.setConfig({ testTimeout: 60_000 })

const FPS = 60
const FRAME = 1 / FPS
const BASE_POSITION = { x: DESKTOP_CAMERA_FRAMING.position[0], y: DESKTOP_CAMERA_FRAMING.position[1], z: DESKTOP_CAMERA_FRAMING.position[2] }
const BASE_LOOK = { x: DESKTOP_CAMERA_FRAMING.lookAt[0], y: DESKTOP_CAMERA_FRAMING.lookAt[1], z: DESKTOP_CAMERA_FRAMING.lookAt[2] }

function player(id: string, seat: number, extra: Partial<ShowdownSnapshotPlayer> = {}): ShowdownSnapshotPlayer {
  return { id, visualSeat: seat, isHero: false, isWinner: false, live: true, allIn: false, revealed: 0, ...extra }
}

function snapshot(
  phase: string,
  players: ShowdownSnapshotPlayer[],
  extra: Partial<ShowdownSnapshot> = {}
): ShowdownSnapshot {
  return { handKey: 7, phase, communityCount: 5, players, ...extra }
}

interface Frame {
  t: number
  shot: ShowdownShot
  active: boolean
  position: { x: number; y: number; z: number }
  look: { x: number; y: number; z: number }
  zoom: number
}

type Timeline = Array<{ at: number; snap: ShowdownSnapshot }>

/** Runs the director against a scripted sequence of table views at 60 fps. */
function run(
  director: ShowdownDirector,
  timeline: Timeline,
  seconds = 12,
  options: { reducedMotion?: boolean; cancelAt?: number } = {}
): Frame[] {
  const frames: Frame[] = []
  let next = 0
  let cancelled = false
  for (let step = 0; step * FRAME <= seconds; step += 1) {
    const t = step * FRAME
    while (next < timeline.length && timeline[next]!.at <= t + 1e-9) {
      director.sync(timeline[next]!.snap, timeline[next]!.at)
      next += 1
    }
    if (options.cancelAt !== undefined && !cancelled && t >= options.cancelAt) {
      director.cancel(t)
      cancelled = true
    }
    const shot = createShowdownShot()
    const active = director.sample(t, options.reducedMotion ?? false, shot)
    const position = { ...BASE_POSITION }
    const look = { ...BASE_LOOK }
    const zoom = active ? blendShowdownShot(shot, position, look) : 1
    frames.push({ t, shot, active, position, look, zoom })
  }
  return frames
}

/** hero (seat 0) plus opponents; `reveals` are seat -> seconds after the showdown starts. */
function showdownTimeline(opts: {
  seats: number[]
  winners?: number[]
  heroWins?: boolean
  reveals?: Record<number, number>
  winnersAt?: number
  hero?: boolean
  start?: number
}): Timeline {
  const start = opts.start ?? 1
  const seats = opts.seats
  const reveals = opts.reveals ?? Object.fromEntries(seats.map((seat, index) => [seat, 0.9 + index * 0.32]))
  const winners = new Set([...(opts.winners ?? []), ...(opts.heroWins ? [0] : [])])
  const build = (elapsed: number, withWinners: boolean) => {
    const players = [
      ...(opts.hero === false ? [] : [player('hero', 0, { isHero: true, isWinner: withWinners && winners.has(0), revealed: 2 })]),
      ...seats.filter(seat => seat !== 0).map(seat => player(
        `p${seat}`,
        seat,
        { isWinner: withWinners && winners.has(seat), revealed: elapsed >= reveals[seat]! + 0.16 ? 2 : elapsed >= reveals[seat]! ? 1 : 0 }
      )),
    ]
    return players
  }
  const timeline: Timeline = [{ at: start - 0.5, snap: snapshot('in_hand', build(0, false)) }]
  const times = new Set<number>([0, ...Object.values(reveals).flatMap(at => [at, at + 0.16])])
  for (const at of [...times].sort((a, b) => a - b)) {
    timeline.push({ at: start + at, snap: snapshot('between_hands', build(at, false)) })
  }
  const highlight = opts.winnersAt ?? 1.7
  timeline.push({ at: start + highlight, snap: snapshot('between_hands', build(99, true)) })
  return timeline.sort((a, b) => a.at - b.at)
}

function assertWithinLimits(frames: Frame[]) {
  const B = TUNING.bounds
  let problems = 0
  const note = (ok: boolean) => {
    if (!ok) problems += 1
  }
  for (const frame of frames) {
    for (const value of [frame.position.x, frame.position.y, frame.position.z, frame.look.x, frame.look.y, frame.look.z, frame.zoom, frame.shot.weight]) {
      note(Number.isFinite(value))
    }
    note(frame.shot.weight >= 0 && frame.shot.weight <= 1)
    if (!frame.active) continue
    // Above the felt, inside the room, never through a person.
    note(frame.position.y >= B.minY - 1e-9 && frame.position.y <= B.maxY + 1e-9)
    note(Math.abs(frame.position.x) <= B.halfWidth + 1e-9)
    note(frame.position.z >= B.minZ - 1e-9 && frame.position.z <= B.maxZ + 1e-9)
    note(frame.look.y > 0)
    note(frame.zoom > 0.4 && frame.zoom <= 1.0001)
  }
  expect(problems).toBe(0)
}

function maxStep(frames: Frame[], pick: (frame: Frame) => { x: number; y: number; z: number }) {
  let largest = 0
  for (let index = 1; index < frames.length; index += 1) {
    const a = pick(frames[index - 1]!)
    const b = pick(frames[index]!)
    largest = Math.max(largest, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))
  }
  return largest
}

const lastActive = (frames: Frame[]) => frames.reduce((last, frame, index) => (frame.active ? index : last), -1)

describe('constrainShowdownCamera', () => {
  it('keeps any requested position above the felt, inside the room and over every seat', () => {
    const B = TUNING.bounds
    let violations = 0
    let checked = 0
    for (let x = -14; x <= 14; x += 0.9) {
      for (let y = -2; y <= 9; y += 0.7) {
        for (let z = -12; z <= 13; z += 0.9) {
          const p = { x, y, z }
          constrainShowdownCamera(p)
          checked += 1
          if (p.y < B.minY - 1e-9 || p.y > B.maxY + 1e-9) violations += 1
          if (Math.abs(p.x) > B.halfWidth + 1e-9 || p.z < B.minZ - 1e-9 || p.z > B.maxZ + 1e-9) violations += 1
          // Inside a person's core the camera must clear the top of their head.
          for (const seat of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
            const [seatX, , seatZ] = TABLE_SEAT_POSITIONS[seat]
            const length = Math.hypot(seatX, seatZ)
            const personX = seatX - (seatX / length) * 0.35
            const personZ = seatZ - (seatZ / length) * 0.35
            if (Math.hypot(p.x - personX, p.z - personZ) < B.seatCoreRadius && p.y < (seat === 0 ? B.heroSeatTop : B.seatTop) - 1e-9) violations += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000)
    expect(violations).toBe(0)
  })

  it('lifts a camera over a seated player and over the board, and above the rail from below', () => {
    const [seatX, , seatZ] = TABLE_SEAT_POSITIONS[4]
    const inChest = { x: seatX, y: 1.5, z: seatZ + 0.35 }
    constrainShowdownCamera(inChest)
    expect(inChest.y).toBeGreaterThanOrEqual(TUNING.bounds.seatTop - 1e-9)
    const overBoard = { x: 0, y: 0.8, z: -0.3 }
    constrainShowdownCamera(overBoard)
    expect(overBoard.y).toBeGreaterThanOrEqual(TUNING.bounds.boardMinY - 1e-9)
    const underTable = { x: 1, y: -3, z: 2 }
    constrainShowdownCamera(underTable)
    expect(underTable.y).toBeGreaterThanOrEqual(TUNING.bounds.minY)
  })

  it('is continuous: a camera sliding across a limit, even straight through a player, never pops', () => {
    const lines = [
      (s: number) => ({ x: -3 + s * 6, y: 1.4, z: -3.5 }),
      (s: number) => ({ x: 0.2, y: 0.7 + s * 2, z: -0.3 }),
      (s: number) => ({ x: -2 + s * 4, y: 1.2, z: 0.0 }),
      (s: number) => ({ x: -1, y: 2.5, z: 8 + s * 4 }),
      // From the home camera straight through the hero's chair to the board.
      (s: number) => ({ x: 0, y: 1.95 + 0.65 * s, z: 6.05 - 3.05 * s }),
      (s: number) => ({ x: 0, y: 1.6, z: -2.5 - s * 2.5 }),
    ]
    let pops = 0
    for (const line of lines) {
      let previous = line(0)
      constrainShowdownCamera(previous)
      let prevInput = line(0)
      for (let step = 1; step <= 2000; step += 1) {
        const input = line(step / 2000)
        const out = { ...input }
        constrainShowdownCamera(out)
        const inputStep = Math.hypot(input.x - prevInput.x, input.y - prevInput.y, input.z - prevInput.z)
        const outputStep = Math.hypot(out.x - previous.x, out.y - previous.y, out.z - previous.z)
        if (outputStep >= inputStep * 12 + 1e-6) pops += 1
        previous = out
        prevInput = input
      }
    }
    expect(pops).toBe(0)
  })

  it('repairs a non-finite request', () => {
    const p = { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 1 }
    constrainShowdownCamera(p)
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
  })
})

describe('ShowdownDirector showdown', () => {
  it('stays off until a hand we watched ends, then runs the whole story and eases to zero', () => {
    const director = new ShowdownDirector()
    const timeline = showdownTimeline({ seats: [0, 2, 4, 6], winners: [4] })
    const frames = run(director, timeline)
    assertWithinLimits(frames)

    // Nothing before the hand ends.
    expect(frames.filter(frame => frame.t < 1).every(frame => !frame.active)).toBe(true)
    // Starts from zero weight (no jump) and is completely off at the end.
    const first = frames.find(frame => frame.active)!
    expect(first.shot.weight).toBeLessThan(0.01)
    const end = lastActive(frames)
    expect(end).toBeGreaterThan(0)
    expect(end).toBeLessThan(frames.length - 5)
    expect(frames[end]!.shot.weight).toBeLessThan(0.01)
    expect(frames[frames.length - 1]!.active).toBe(false)
    // The last 0.4s of the ease-out are monotone and gentle.
    for (let index = end - 24; index < end; index += 1) {
      const delta = frames[index]!.shot.weight - frames[index + 1]!.shot.weight
      expect(delta).toBeGreaterThanOrEqual(-1e-9)
      expect(delta).toBeLessThan(0.05)
    }
    // Reaches full weight for the middle of the story, and fits the showdown window.
    expect(Math.max(...frames.map(frame => frame.shot.weight))).toBeGreaterThan(0.99)
    const seconds = (end - frames.findIndex(frame => frame.active)) * FRAME
    expect(seconds).toBeLessThan(TUNING.maxShotSeconds + TUNING.release.maxSeconds + 0.1)
    expect(seconds).toBeGreaterThan(3)
  })

  it('fits inside the real showdown window (about 4.2s from the first frame) without lengthening it', () => {
    // Reveal times and highlight follow lib/poker/showdown.ts: first flip at 0.9s, one card per step.
    const cases = [
      { seats: [0, 4], winners: [4], reveals: { 4: 0.9 }, winnersAt: 1.58 },
      { seats: [0, 2, 4, 6], winners: [4], reveals: { 2: 0.9, 4: 1.17, 6: 1.44 }, winnersAt: 1.86 },
      { seats: [0, 1, 2, 3, 4, 5, 6, 7], winners: [7], reveals: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((seat, index) => [seat, 0.9 + index * 0.137])), winnersAt: 2.04 },
    ]
    for (const options of cases) {
      const frames = run(new ShowdownDirector(), showdownTimeline({ ...options, start: 1 }), 10)
      const first = frames.findIndex(frame => frame.active)
      const seconds = (lastActive(frames) - first) * FRAME
      expect(seconds).toBeLessThan(4.35)
    }
  })

  it('moves the camera smoothly at every frame', () => {
    for (const timeline of [
      showdownTimeline({ seats: [0, 4], winners: [4] }),
      showdownTimeline({ seats: [0, 1, 2, 3, 4, 5, 6, 7], winners: [7], reveals: Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((seat, index) => [seat, 0.9 + index * 0.13])) }),
      showdownTimeline({ seats: [0, 2, 6], winners: [2, 6] }),
      showdownTimeline({ seats: [0, 3], heroWins: true }),
    ]) {
      const frames = run(new ShowdownDirector(), timeline)
      assertWithinLimits(frames)
      const active = frames.slice(0, lastActive(frames) + 1).filter(frame => frame.active)
      // Even the quick moves between stops stay bounded per frame (15 units/s at most).
      expect(maxStep(active, frame => frame.position)).toBeLessThan(0.3)
      expect(maxStep(active, frame => frame.look)).toBeLessThan(0.4)
      let largestZoom = 0
      for (let index = 1; index < active.length; index += 1) largestZoom = Math.max(largestZoom, Math.abs(active[index]!.zoom - active[index - 1]!.zoom))
      expect(largestZoom).toBeLessThan(0.05)
    }
  })

  it('visits showing players in the order their cards turn over', () => {
    const director = new ShowdownDirector()
    // Seat 6 flips first, then 2, then 4: the tour must follow, not seat order.
    run(director, showdownTimeline({ seats: [0, 6, 2, 4], winners: [2], reveals: { 6: 0.9, 2: 1.14, 4: 1.4 } }), 3)
    const plan = director.describe()
    expect(plan.mode).toBe('showdown')
    expect(plan.stops).toEqual([6, 2, 4])
    expect(plan.scenes.map(scene => scene.kind)).toEqual(['overview', 'stop', 'stop', 'stop', 'board', 'winner'])
    // Then the board beat, then the winner: strictly later and ordered.
    const starts = plan.scenes.map(scene => scene.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })

  it('holds the board after the winning cards light up, then frames the winner', () => {
    const director = new ShowdownDirector()
    run(director, showdownTimeline({ seats: [0, 4], winners: [4], winnersAt: 1.6 }), 3)
    const plan = director.describe()
    const board = plan.scenes.find(scene => scene.kind === 'board')!
    const winner = plan.scenes.find(scene => scene.kind === 'winner')!
    expect(winner.start - board.start).toBeGreaterThanOrEqual(TUNING.boardMinSeconds - 1e-9)
    // Held at least `boardAfterHighlightSeconds` once the winners are known (1.6s in).
    expect(winner.start).toBeGreaterThanOrEqual(1.6 + TUNING.boardAfterHighlightSeconds - 1e-9)
    expect(plan.winnersMask).toBe(1 << 4)
  })

  it('frames an opponent winner low and from the hero side of the table', () => {
    const director = new ShowdownDirector()
    const frames = run(director, showdownTimeline({ seats: [0, 4], winners: [4] }))
    const hold = frames.reduce((best, frame) => (frame.shot.weight > best.shot.weight ? frame : best))
    // The peak of the shot is the winner hold: a low lens and the camera below the normal eye line.
    const peakFrames = frames.filter(frame => frame.shot.weight > 0.999)
    const winnerHold = peakFrames[peakFrames.length - 5]!
    expect(hold.shot.weight).toBeGreaterThan(0.999)
    expect(winnerHold.position.y).toBeLessThan(BASE_POSITION.y - 0.3)
    expect(winnerHold.zoom).toBeLessThan(0.7)
    // Looking at the winner (far side), camera on the near half.
    expect(winnerHold.look.z).toBeLessThan(-2.5)
    expect(winnerHold.position.z).toBeGreaterThan(winnerHold.look.z + 3)
    assertWithinLimits(frames)
  })

  it('pulls to an over-the-shoulder shot when the hero wins, never into the hero head', () => {
    const director = new ShowdownDirector()
    const frames = run(director, showdownTimeline({ seats: [0, 3], heroWins: true }))
    assertWithinLimits(frames)
    const [heroX, , heroZ] = TABLE_SEAT_POSITIONS[0]
    const heroHead = { x: heroX, y: 1.6, z: heroZ - 0.3 }
    let held: Frame | null = null
    let minAway = Infinity
    for (const frame of frames) {
      if (!frame.active) continue
      const away = Math.hypot(frame.position.x - heroHead.x, frame.position.y - heroHead.y, frame.position.z - heroHead.z)
      // Always clear of the hero's head (a seated head with a hat is well inside this ball).
      minAway = Math.min(minAway, away)
      held = frame
    }
    expect(held).not.toBeNull()
    expect(minAway).toBeGreaterThan(0.8)
    // At the hold the camera is above and behind the hero, looking down at their cards and chips.
    const hold = frames.filter(frame => frame.shot.weight > 0.999).pop()!
    expect(hold.position.z).toBeGreaterThan(5.5)
    expect(hold.position.y).toBeGreaterThan(2.2)
    expect(hold.look.z).toBeGreaterThan(2)
    expect(hold.look.y).toBeLessThan(1)
  })

  it('frames both winners of a split pot, wide, whichever seats they hold', () => {
    const wide = run(new ShowdownDirector(), showdownTimeline({ seats: [0, 1, 7], winners: [1, 7] }))
    assertWithinLimits(wide)
    const hold = wide.filter(frame => frame.shot.weight > 0.999).pop()!
    // Winners flank the table: a hero-side camera, a wide lens, aimed between them.
    expect(hold.zoom).toBeGreaterThan(0.85)
    expect(Math.abs(hold.look.x)).toBeLessThan(0.5)
    const single = run(new ShowdownDirector(), showdownTimeline({ seats: [0, 1, 7], winners: [1] }))
    const singleHold = single.filter(frame => frame.shot.weight > 0.999).pop()!
    expect(hold.zoom).toBeGreaterThan(singleHold.zoom)

    const near = run(new ShowdownDirector(), showdownTimeline({ seats: [0, 3, 5], winners: [3, 5] }))
    assertWithinLimits(near)
    const nearHold = near.filter(frame => frame.shot.weight > 0.999).pop()!
    expect(nearHold.zoom).toBeLessThan(hold.zoom)
  })

  it('tours hands that never flip (already tabled) by seat order', () => {
    const live = (seat: number) => player(`p${seat}`, seat, { revealed: 2 })
    const timeline: Timeline = [
      { at: 0.5, snap: snapshot('in_hand', [player('hero', 0, { isHero: true, revealed: 2 }), live(5), live(2)]) },
      { at: 1, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, revealed: 2 }), live(5), live(2)]) },
      { at: 2.4, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, revealed: 2 }), live(5), { ...live(2), isWinner: true }]) },
    ]
    const director = new ShowdownDirector()
    const frames = run(director, timeline)
    assertWithinLimits(frames)
    expect(director.describe().stops).toEqual([2, 5])
  })

  it('never starts from a showdown that was already underway when the page loaded', () => {
    const director = new ShowdownDirector()
    const frames = run(director, [
      { at: 0.2, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, revealed: 2 }), player('a', 4, { revealed: 2 })]) },
    ], 4)
    expect(frames.some(frame => frame.active)).toBe(false)
  })

  it('skips on cancel with a quick ease back, never a jump, and does not restart', () => {
    const director = new ShowdownDirector()
    const timeline = showdownTimeline({ seats: [0, 2, 4], winners: [2] })
    const cancelAt = 3.0
    const frames = run(director, timeline, 8, { cancelAt })
    assertWithinLimits(frames)
    const before = frames.filter(frame => frame.t < cancelAt)
    expect(before.some(frame => frame.shot.weight > 0.9)).toBe(true)
    const end = lastActive(frames)
    expect(frames[end]!.t - cancelAt).toBeLessThanOrEqual(TUNING.cancelSeconds + 0.1)
    // The weight only goes down after the cancel, smoothly.
    const after = frames.filter(frame => frame.t >= cancelAt && frame.active)
    for (let index = 1; index < after.length; index += 1) {
      const delta = after[index - 1]!.shot.weight - after[index]!.shot.weight
      expect(delta).toBeGreaterThanOrEqual(-1e-9)
      expect(delta).toBeLessThan(0.08)
    }
    // A skip is quick (under 0.4s) but still a continuous glide (at most ~30 units/s).
    expect(maxStep(frames.slice(0, end + 1).filter(frame => frame.active), frame => frame.position)).toBeLessThan(0.55)
    // The same hand keeps reporting its winner: no second cinematic.
    expect(frames.slice(end + 1).some(frame => frame.active)).toBe(false)
  })

  it('cancels when the next hand starts', () => {
    const director = new ShowdownDirector()
    const timeline = showdownTimeline({ seats: [0, 2], winners: [2] })
    timeline.push({ at: 3.2, snap: snapshot('in_hand', [player('hero', 0, { isHero: true }), player('p2', 2)], { handKey: 8, communityCount: 0 }) })
    const frames = run(director, timeline, 8)
    assertWithinLimits(frames)
    const end = lastActive(frames)
    expect(frames[end]!.t - 3.2).toBeLessThanOrEqual(TUNING.cancelSeconds + 0.1)
    expect(frames.slice(end + 1).some(frame => frame.active)).toBe(false)
  })

  it('does nothing under reduced motion', () => {
    const director = new ShowdownDirector()
    const frames = run(director, showdownTimeline({ seats: [0, 2, 4], winners: [4] }), 10, { reducedMotion: true })
    expect(frames.every(frame => !frame.active && frame.shot.weight === 0)).toBe(true)
    expect(frames.every(frame => frame.zoom === 1)).toBe(true)
  })

  it('stops itself even if the winners never arrive', () => {
    const director = new ShowdownDirector()
    const frames = run(director, showdownTimeline({ seats: [0, 2], winners: [], winnersAt: 99 }), 14)
    assertWithinLimits(frames)
    expect(lastActive(frames) * FRAME).toBeLessThan(TUNING.maxShotSeconds + TUNING.release.maxSeconds + 1.5)
    expect(frames[frames.length - 1]!.active).toBe(false)
  })
})

describe('ShowdownDirector fold-outs and runouts', () => {
  const foldOut = (winnerSeat: number) => [
    { at: 0.5, snap: snapshot('in_hand', [player('hero', 0, { isHero: true }), player('p3', 3), player('p5', 5)]) },
    {
      at: 1,
      snap: snapshot('between_hands', [
        player('hero', 0, { isHero: true, isWinner: winnerSeat === 0, live: winnerSeat === 0 }),
        player('p3', 3, { isWinner: winnerSeat === 3, live: winnerSeat === 3 }),
        player('p5', 5, { live: false }),
      ], { communityCount: 3 }),
    },
  ]

  it('gives a fold-out win only a quick winner beat', () => {
    for (const seat of [3, 0]) {
      const director = new ShowdownDirector()
      const frames = run(director, foldOut(seat), 8)
      assertWithinLimits(frames)
      expect(director.describe().scenes.map(scene => scene.kind)).toEqual(['winner'])
      const active = frames.filter(frame => frame.active)
      const seconds = (lastActive(frames) - frames.findIndex(frame => frame.active)) * FRAME
      expect(active.length).toBeGreaterThan(0)
      expect(seconds).toBeLessThan(TUNING.foldout.enterSeconds + TUNING.foldout.holdSeconds + TUNING.release.maxSeconds + 0.2)
      expect(maxStep(active, frame => frame.position)).toBeLessThan(0.3)
    }
  })

  it('leans toward the board for each street of an all-in runout, mildly, and relaxes', () => {
    const director = new ShowdownDirector()
    const allIn = [player('hero', 0, { isHero: true, allIn: true }), player('p4', 4, { allIn: true })]
    const timeline: Timeline = [
      { at: 0.2, snap: snapshot('in_hand', allIn, { communityCount: 0, handKey: 3 }) },
      { at: 1, snap: snapshot('in_hand', allIn, { communityCount: 3, handKey: 3 }) },
      { at: 4, snap: snapshot('in_hand', allIn, { communityCount: 4, handKey: 3 }) },
      { at: 7, snap: snapshot('in_hand', allIn, { communityCount: 5, handKey: 3 }) },
    ]
    const frames = run(director, timeline, 11)
    assertWithinLimits(frames)
    // Three pulses, each below full weight and back to zero between streets.
    let pulses = 0
    let wasActive = false
    for (const frame of frames) {
      if (frame.active && !wasActive) pulses += 1
      wasActive = frame.active
      expect(frame.shot.weight).toBeLessThan(0.7)
    }
    expect(pulses).toBe(3)
    expect(maxStep(frames.filter(frame => frame.active), frame => frame.position)).toBeLessThan(0.2)
  })

  it('does not lean on an ordinary street when someone can still bet', () => {
    const director = new ShowdownDirector()
    const live = [player('hero', 0, { isHero: true }), player('p4', 4)]
    const frames = run(director, [
      { at: 0.2, snap: snapshot('in_hand', live, { communityCount: 0 }) },
      { at: 1, snap: snapshot('in_hand', live, { communityCount: 3 }) },
      { at: 3, snap: snapshot('in_hand', live, { communityCount: 4 }) },
    ], 6)
    expect(frames.some(frame => frame.active)).toBe(false)
  })

  it('blends a runout lean into the showdown that follows without a jump', () => {
    const director = new ShowdownDirector()
    const allIn = [player('hero', 0, { isHero: true, allIn: true }), player('p4', 4, { allIn: true })]
    const timeline: Timeline = [
      { at: 0.2, snap: snapshot('in_hand', allIn, { communityCount: 4 }) },
      { at: 1, snap: snapshot('in_hand', allIn, { communityCount: 5 }) },
      { at: 1.4, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, allIn: true }), player('p4', 4, { allIn: true })]) },
      { at: 1.6, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, allIn: true }), player('p4', 4, { allIn: true, revealed: 2 })]) },
      { at: 3.4, snap: snapshot('between_hands', [player('hero', 0, { isHero: true, allIn: true, isWinner: true }), player('p4', 4, { allIn: true, revealed: 2 })]) },
    ]
    const frames = run(director, timeline, 12)
    assertWithinLimits(frames)
    const active = frames.slice(0, lastActive(frames) + 1).filter(frame => frame.active)
    expect(maxStep(active, frame => frame.position)).toBeLessThan(0.3)
    expect(frames[frames.length - 1]!.active).toBe(false)
  })
})
