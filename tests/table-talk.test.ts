import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeAvatarTargetPose,
  createAvatarAnimatorState,
  type AvatarAnimatorInput,
  type AvatarAnimatorState,
} from '@/components/three/avatarAnimator'
import { CH, createEmotionState, createFaceContext, updateEmotion } from '@/components/three/avatarFaceEmotion'
import { getFacePersonality } from '@/components/three/avatarPersonality'
import {
  CHAT_WINDOW_SECONDS,
  chatLaughAmount,
  chatSmileAmount,
  chatTalkAmount,
  chatWeight,
  createTableChat,
  fillSeatChat,
  planTableTalk,
  yawnAmount,
  type TableChat,
  type TalkCandidate,
} from '@/components/three/tableTalk'
import { getSeatTableChat, type TableTalkSeat } from '@/components/three/tableTalkSeats'
import { animateSconceFlames, flameFlicker, neonBuzz, NEON_CYCLE_SECONDS } from '@/components/three/roomLifeMotion'

const anchors = {
  railR: [0.3, 0.9, -0.9] as [number, number, number],
  railL: [-0.3, 0.9, -0.9] as [number, number, number],
  cards: [0, 0.5, -1.6] as [number, number, number],
  chest: [0, 1.1, -0.3] as [number, number, number],
  chin: [0, 1.5, -0.35] as [number, number, number],
  shoulderR: [0.25, 1.35, -0.15] as [number, number, number],
  shoulderL: [-0.25, 1.35, -0.15] as [number, number, number],
  stack: [0.5, 0.5, -1.5] as [number, number, number],
  betSpot: [0, 0.5, -2.4] as [number, number, number],
  tap: [0.15, 0.5, -1.3] as [number, number, number],
  board: [0, 0.5, -4] as [number, number, number],
  drinkRest: [-0.5, 0.5, -1.5] as [number, number, number],
}

function input(overrides: Partial<AvatarAnimatorInput> = {}): AvatarAnimatorInput {
  return {
    time: 10,
    delta: 1 / 60,
    reducedMotion: false,
    acting: false,
    folded: false,
    winner: false,
    loser: false,
    hasCards: false,
    cue: 'ready',
    cueElapsedMs: 0,
    cueActive: false,
    actionKey: '',
    playerId: 'p1',
    wagerIntensity: 0,
    lookYaw: 0,
    lookPitch: -0.035,
    tableHeat: 0,
    idleTell: 'calm',
    celebration: 'victory',
    anchors,
    ...overrides,
  }
}

/** Keeps the random idle clocks out of the way so only the chat (or the staged idle) moves the pose. */
function quietState(seed: string): AvatarAnimatorState {
  const state = createAvatarAnimatorState(seed)
  state.nextPeekAt = Number.POSITIVE_INFINITY
  state.nextBigIdleAt = Number.POSITIVE_INFINITY
  state.nextMicroAt = Number.POSITIVE_INFINITY
  return state
}

function chatOf(overrides: Partial<TableChat> = {}): TableChat {
  return { ...createTableChat(), role: 'speak', partnerId: 'p2', yaw: 0.9, elapsed: 1.6, duration: 3.6, talkEnd: 3.2, laugh: false, ...overrides }
}

const seatsOf = (count: number): TalkCandidate[] =>
  Array.from({ length: count }, (_, index) => ({ playerId: `p${index + 1}`, visualSeat: index + 1 }))

describe('table talk schedule', () => {
  it('is deterministic: the same window and seats always give the same plan', () => {
    for (let window = 0; window < 60; window += 1) {
      expect(planTableTalk(window, seatsOf(7))).toEqual(planTableTalk(window, seatsOf(7)))
    }
  })

  it('does not have a conversation in every window, but has plenty', () => {
    let quiet = 0
    let busy = 0
    for (let window = 0; window < 400; window += 1) {
      if (planTableTalk(window, seatsOf(7)).conversations.length === 0) quiet += 1
      else busy += 1
    }
    expect(quiet).toBeGreaterThan(80)
    expect(busy).toBeGreaterThan(120)
  })

  it('needs two people; one lone opponent never talks to themselves', () => {
    for (let window = 0; window < 80; window += 1) {
      expect(planTableTalk(window, seatsOf(1)).conversations).toHaveLength(0)
      expect(planTableTalk(window, seatsOf(0)).conversations).toHaveLength(0)
    }
  })

  it('pairs two different neighbours, and never reuses a person within a window', () => {
    for (let window = 0; window < 400; window += 1) {
      const used = new Set<string>()
      for (const talk of planTableTalk(window, seatsOf(7)).conversations) {
        expect(talk.speakerId).not.toBe(talk.listenerId)
        const gap = Math.abs(Number(talk.speakerId.slice(1)) - Number(talk.listenerId.slice(1)))
        expect(gap).toBeGreaterThanOrEqual(1)
        expect(gap).toBeLessThanOrEqual(2)
        expect(used.has(talk.speakerId) || used.has(talk.listenerId)).toBe(false)
        used.add(talk.speakerId)
        used.add(talk.listenerId)
        // The whole exchange fits inside its window.
        expect(talk.start + talk.duration).toBeLessThan(CHAT_WINDOW_SECONDS)
        expect(talk.talkEnd).toBeLessThan(talk.duration)
      }
    }
  })

  it('does not pair opponents who sit far apart (across the empty hero seat)', () => {
    const wide: TalkCandidate[] = [
      { playerId: 'p1', visualSeat: 1 },
      { playerId: 'p7', visualSeat: 7 },
    ]
    for (let window = 0; window < 200; window += 1) expect(planTableTalk(window, wide).conversations).toHaveLength(0)
  })

  it('every seat agrees: the speaker and the listener see mirrored roles at the same moment', () => {
    let checked = 0
    for (let window = 0; window < 120; window += 1) {
      const plan = planTableTalk(window, seatsOf(7))
      for (const talk of plan.conversations) {
        const time = window * CHAT_WINDOW_SECONDS + talk.start + talk.duration * 0.5
        const speaker = createTableChat()
        const listener = createTableChat()
        expect(fillSeatChat(plan, talk.speakerId, time, speaker)).toBe(true)
        expect(fillSeatChat(plan, talk.listenerId, time, listener)).toBe(true)
        expect(speaker.role).toBe('speak')
        expect(listener.role).toBe('listen')
        expect(speaker.partnerId).toBe(talk.listenerId)
        expect(listener.partnerId).toBe(talk.speakerId)
        expect(speaker.elapsed).toBeCloseTo(listener.elapsed, 9)
        expect(speaker.duration).toBe(listener.duration)
        // Bystanders are not in it, and nobody is before the start or after the end.
        const bystander = createTableChat()
        const others = seatsOf(7).map(seat => seat.playerId).filter(id => id !== talk.speakerId && id !== talk.listenerId)
        for (const id of others) {
          const inOther = plan.conversations.some(c => c !== talk && (c.speakerId === id || c.listenerId === id))
          expect(fillSeatChat(plan, id, time, bystander) && !inOther).toBe(false)
        }
        expect(fillSeatChat(plan, talk.speakerId, window * CHAT_WINDOW_SECONDS + talk.start - 0.05, speaker)).toBe(false)
        expect(fillSeatChat(plan, talk.speakerId, window * CHAT_WINDOW_SECONDS + talk.start + talk.duration + 0.05, speaker)).toBe(false)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(40)
  })

  it('a plan for one window says nothing about another window', () => {
    const plan = planTableTalk(3, seatsOf(7))
    expect(fillSeatChat(plan, 'p1', 5 * CHAT_WINDOW_SECONDS + 2, createTableChat())).toBe(false)
  })

  it('speaks first then stops, smiles while listening, and only laughs when the plan ends in a joke', () => {
    const joke = chatOf({ laugh: true, duration: 4, talkEnd: 2.5 })
    expect(chatTalkAmount({ ...joke, elapsed: 1.5 })).toBeGreaterThan(0.9)
    expect(chatTalkAmount({ ...joke, elapsed: 3 })).toBe(0)
    expect(chatTalkAmount({ ...joke, role: 'listen', elapsed: 1.5 })).toBe(0)
    expect(chatSmileAmount({ ...joke, role: 'listen', elapsed: 1.8 })).toBeGreaterThan(0.8)
    expect(chatLaughAmount({ ...joke, elapsed: 1.5 })).toBe(0)
    expect(chatLaughAmount({ ...joke, elapsed: 3.2 })).toBeGreaterThan(0.9)
    expect(chatLaughAmount({ ...joke, laugh: false, elapsed: 3.2 })).toBe(0)
    expect(chatWeight({ ...joke, elapsed: 0 })).toBe(0)
    expect(chatWeight({ ...joke, elapsed: 2 })).toBe(1)
    expect(chatWeight({ ...joke, elapsed: 4 })).toBe(0)
  })
})

describe('table talk seats', () => {
  function makeSeat(playerId: string, visualSeat: number, x: number, z: number, extra: Partial<TableTalkSeat> = {}): TableTalkSeat {
    const root = new THREE.Group()
    root.position.set(x, 0, z)
    // Faces the table centre like the real seats (-Z toward the middle).
    root.rotation.y = Math.atan2(x, z)
    root.updateMatrixWorld(true)
    return { playerId, visualSeat, isHero: false, passedOut: false, root, avatar: {}, ...extra }
  }

  function table(passedOutId?: string) {
    const seats = new Map<string, TableTalkSeat>()
    const positions: Array<[number, number]> = [[0, 4.5], [-5.3, -1.3], [-4.1, -2.7], [-2.3, -3.7], [0, -4.1], [2.3, -3.7], [4.1, -2.7], [5.3, -1.3]]
    positions.forEach(([x, z], visualSeat) => {
      const id = `p${visualSeat}`
      seats.set(id, makeSeat(id, visualSeat, x, z, visualSeat === 0 ? { isHero: true } : { passedOut: id === passedOutId }))
    })
    seats.get('p0')!.root.visible = false
    return seats
  }

  function findConversation(seats: Map<string, TableTalkSeat>) {
    for (let time = 0; time < 3000; time += 0.25) {
      for (const seat of seats.values()) {
        const chat = getSeatTableChat(seat, seats, time)
        if (chat?.role === 'speak') return { time, speakerId: seat.playerId, listenerId: chat.partnerId }
      }
    }
    throw new Error('no conversation found')
  }

  it('never includes the hidden hero seat', () => {
    const seats = table()
    for (let time = 0; time < 600; time += 0.5) {
      expect(getSeatTableChat(seats.get('p0')!, seats, time)).toBeNull()
      for (const seat of seats.values()) {
        const chat = getSeatTableChat(seat, seats, time)
        if (chat) expect(chat.partnerId).not.toBe('p0')
      }
    }
  })

  it('points the speaker at the listener and the listener back, on the correct side', () => {
    const seats = table()
    const { time, speakerId, listenerId } = findConversation(seats)
    const speaker = getSeatTableChat(seats.get(speakerId)!, seats, time)!
    const listener = { ...getSeatTableChat(seats.get(listenerId)!, seats, time)! }
    const speakerSeat = seats.get(speakerId)!
    const listenerSeat = seats.get(listenerId)!
    expect(speaker.role).toBe('speak')
    expect(listener.role).toBe('listen')
    // Positive yaw turns toward the seat's -x side (its left): the partner really is on that side.
    const local = speakerSeat.root.worldToLocal(listenerSeat.root.position.clone())
    expect(Math.sign(speaker.yaw)).toBe(Math.sign(-local.x))
    expect(Math.abs(speaker.yaw)).toBeGreaterThan(0.4)
    // The two face opposite ways around the table.
    expect(Math.sign(speaker.yaw)).toBe(-Math.sign(listener.yaw))
  })

  it('leaves out anyone passed out at the start of the window', () => {
    const seats = table('p3')
    for (let time = 0; time < 600; time += 0.5) {
      for (const seat of seats.values()) {
        const chat = getSeatTableChat(seat, seats, time)
        if (!chat) continue
        expect(seat.playerId).not.toBe('p3')
        expect(chat.partnerId).not.toBe('p3')
      }
    }
  })

  it('ends the chat if the partner leaves or passes out mid-window', () => {
    const seats = table()
    const { time, speakerId, listenerId } = findConversation(seats)
    expect(getSeatTableChat(seats.get(speakerId)!, seats, time)).not.toBeNull()
    seats.get(listenerId)!.passedOut = true
    expect(getSeatTableChat(seats.get(speakerId)!, seats, time)).toBeNull()
    seats.get(listenerId)!.passedOut = false
    seats.delete(listenerId)
    expect(getSeatTableChat(seats.get(speakerId)!, seats, time)).toBeNull()
  })
})

describe('table talk body language', () => {
  const speak = chatOf({ role: 'speak', yaw: 0.9 })
  const listen = chatOf({ role: 'listen', yaw: 0.9 })
  const pose = (seed: string, overrides: Partial<AvatarAnimatorInput> = {}, state = quietState(seed)) => {
    const out = computeAvatarTargetPose(state, input(overrides))
    return { out, state }
  }

  it('turns the speaker toward the listener, whichever side they are on', () => {
    const left = pose('p1', { chat: speak })
    const right = pose('p1', { chat: { ...speak, yaw: -0.9 } })
    const plain = pose('p1')
    expect(left.state.chatOn).toBe(true)
    expect(left.out.bones.Head[1]).toBeGreaterThan(plain.out.bones.Head[1] + 0.15)
    expect(right.out.bones.Head[1]).toBeLessThan(plain.out.bones.Head[1] - 0.15)
    expect(left.out.bones.Chest[1]).toBeGreaterThan(plain.out.bones.Chest[1] + 0.05)
  })

  it('nods the speaker on the syllable beats', () => {
    const pitches: number[] = []
    for (let time = 10; time < 12; time += 0.05) pitches.push(pose('p1', { chat: { ...speak, elapsed: 1.5 }, time }).out.bones.Head[0])
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.05)
  })

  it('lifts one hand off the rail, palm up, while talking', () => {
    const plain = pose('p2')
    let best = 0
    for (let time = 10; time < 12; time += 0.1) {
      const talking = pose('p2', { chat: { ...speak, elapsed: 1.6 }, time }).out
      best = Math.max(best, talking.handR[1] - plain.out.handR[1], talking.handL[1] - plain.out.handL[1])
    }
    expect(best).toBeGreaterThan(0.12)
    // Only one hand: the other stays on the rail.
    const talking = pose('p2', { chat: { ...speak, elapsed: 1.6 } }).out
    const lifts = [talking.handR[1] - plain.out.handR[1], talking.handL[1] - plain.out.handL[1]].sort((a, b) => a - b)
    expect(lifts[0]).toBeLessThan(0.03)
    expect(lifts[1]).toBeGreaterThan(0.12)
  })

  it('keeps the listener turned toward the speaker with both hands down', () => {
    const plain = pose('p1')
    const listening = pose('p1', { chat: listen })
    expect(listening.out.bones.Head[1]).toBeGreaterThan(plain.out.bones.Head[1] + 0.15)
    expect(listening.out.handR[1]).toBeCloseTo(plain.out.handR[1], 2)
    expect(listening.out.handL[1]).toBeCloseTo(plain.out.handL[1], 2)
    expect(listening.out.handR[2]).toBeCloseTo(plain.out.handR[2], 2)
  })

  it('nods the listener along now and then', () => {
    const pitches: number[] = []
    for (let time = 10; time < 14; time += 0.05) pitches.push(pose('p1', { chat: { ...listen, elapsed: 1.5 }, time }).out.bones.Head[0])
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.05)
  })

  it('shakes the listener\'s shoulders with a laugh at the end of a joke, and not otherwise', () => {
    const joke = { ...listen, laugh: true, duration: 4, talkEnd: 2.5 }
    const spread = (chat: TableChat) => {
      const values: number[] = []
      for (let step = 0; step < 40; step += 1) {
        const elapsed = chat.elapsed + step * 0.02
        values.push(pose('p1', { chat: { ...chat, elapsed } }).out.bones.ShoulderR[2])
      }
      return Math.max(...values) - Math.min(...values)
    }
    expect(spread({ ...joke, elapsed: 3.0 })).toBeGreaterThan(0.05)
    expect(spread({ ...joke, laugh: false, elapsed: 3.0 })).toBeLessThan(0.01)
    expect(spread({ ...joke, elapsed: 1.0 })).toBeLessThan(0.01)
  })

  it('keeps folded arms folded but still turns and talks', () => {
    const plain = pose('p1', { folded: true, time: 20 })
    const chatting = pose('p1', { folded: true, chat: speak, time: 20 })
    expect(chatting.state.chatOn).toBe(true)
    expect(chatting.out.bones.Head[1]).toBeGreaterThan(plain.out.bones.Head[1] + 0.15)
    for (let time = 20; time < 22; time += 0.1) {
      const folded = pose('p1', { folded: true, chat: { ...speak, elapsed: 1.6 }, time }).out
      const still = pose('p1', { folded: true, time }).out
      expect(folded.handR[1]).toBeCloseTo(still.handR[1], 2)
      expect(folded.handL[1]).toBeCloseTo(still.handL[1], 2)
    }
  })

  const busy: Array<[string, Partial<AvatarAnimatorInput>]> = [
    ['acting', { acting: true }],
    ['peeking', { peeking: true, hasCards: true }],
    ['drinking', { drinkElapsed: 1.2 }],
    ['flipping someone off', { flipOff: { elapsed: 1, target: [-1.4, 1.4, -1.2] } }],
    ['winning', { winner: true }],
    ['losing', { loser: true }],
    ['passed out', { passedOut: true }],
    ['taking a shot', { shotElapsed: 1 }],
    ['bonked', { bonkElapsed: 0.5 }],
    ['flicking a chip', { chipFlick: { elapsed: 0.3, target: [-1, 1, -1] } }],
    ['tripping', { tripping: true }],
    ['dazed', { dazedElapsed: 0.5 }],
    ['reacting to a pot', { otherWinner: true }],
    ['reacting to a big bet', { tableHeat: 0.8 }],
    ['looking at new board cards', { boardRevealAge: 0.5 }],
    ['mid action', { cueActive: true, cue: 'call', cueElapsedMs: 300 }],
  ]
  it.each(busy)('does not chat while %s', (_name, overrides) => {
    const speaking = pose('p1', { ...overrides, chat: speak })
    const same = pose('p1', overrides)
    expect(speaking.state.chatOn).toBe(false)
    expect(speaking.out.bones.Head[1]).toBeCloseTo(same.out.bones.Head[1], 5)
    expect(speaking.out.handR[1]).toBeCloseTo(same.out.handR[1], 5)
    expect(speaking.out.handL[1]).toBeCloseTo(same.out.handL[1], 5)
  })

  it('does nothing under reduced motion', () => {
    const reduced = pose('p1', { reducedMotion: true, chat: speak })
    const plain = pose('p1', { reducedMotion: true })
    expect(reduced.state.chatOn).toBe(false)
    expect(reduced.out.bones.Head[1]).toBeCloseTo(plain.out.bones.Head[1], 6)
    expect(reduced.out.handR[1]).toBeCloseTo(plain.out.handR[1], 6)
    expect(reduced.out.handL[1]).toBeCloseTo(plain.out.handL[1], 6)
  })

  it('waits for a big idle already under way, and blocks new ones while it lasts', () => {
    const idling = quietState('p1')
    idling.bigIdleStartedAt = 9.5
    idling.bigIdleKind = 6
    computeAvatarTargetPose(idling, input({ chat: speak, time: 10 }))
    expect(idling.chatOn).toBe(false)

    const chatting = quietState('p1')
    chatting.nextBigIdleAt = 0
    chatting.nextPeekAt = 0
    chatting.nextMicroAt = 0
    computeAvatarTargetPose(chatting, input({ chat: speak, time: 10, hasCards: true }))
    expect(chatting.chatOn).toBe(true)
    expect(Number.isFinite(chatting.bigIdleStartedAt)).toBe(false)
    expect(Number.isFinite(chatting.peekStartedAt)).toBe(false)
    expect(Number.isFinite(chatting.microStartedAt)).toBe(false)
  })

  it('fades in and out instead of snapping', () => {
    const start = pose('p1', { chat: { ...listen, elapsed: 0 } }).out.bones.Head[1]
    const end = pose('p1', { chat: { ...listen, elapsed: listen.duration } }).out.bones.Head[1]
    const plain = pose('p1').out.bones.Head[1]
    expect(Math.abs(start - plain)).toBeLessThan(0.02)
    expect(Math.abs(end - plain)).toBeLessThan(0.02)
  })
})

describe('yawn', () => {
  const stretch = (kind: number, elapsed: number, overrides: Partial<AvatarAnimatorInput> = {}) => {
    const state = quietState('p1')
    state.bigIdleStartedAt = 10
    state.bigIdleKind = kind
    computeAvatarTargetPose(state, input({ time: 10 + elapsed, ...overrides }))
    return state.yawn
  }

  it('opens wide through the middle of the stretch, and only there', () => {
    expect(stretch(0, 0.2)).toBe(0)
    expect(stretch(0, 1.2)).toBeGreaterThan(0.9)
    expect(stretch(0, 1.4)).toBeGreaterThan(0.9)
    expect(stretch(0, 0.8)).toBeGreaterThan(0.2)
    expect(stretch(0, 2.5)).toBe(0)
    expect(yawnAmount(0.4)).toBe(0)
    expect(yawnAmount(2.4)).toBe(0)
  })

  it('belongs to the stretch alone, not to the other big idles', () => {
    for (let kind = 1; kind < 8; kind += 1) expect(stretch(kind, 1.2)).toBe(0)
  })

  it('does not happen without a stretch, or under reduced motion', () => {
    const idle = quietState('p1')
    computeAvatarTargetPose(idle, input({ time: 11 }))
    expect(idle.yawn).toBe(0)
    expect(stretch(0, 1.2, { reducedMotion: true })).toBe(0)
  })

  it('goes away when something takes the seat out of its idle', () => {
    expect(stretch(0, 1.2, { acting: true })).toBe(0)
    expect(stretch(0, 1.2, { winner: true })).toBe(0)
    expect(stretch(0, 1.2, { passedOut: true })).toBe(0)
  })
})

describe('talking and yawning faces', () => {
  function run(seed: number, patch: Partial<ReturnType<typeof createFaceContext>>, frames = 120) {
    const state = createEmotionState(seed)
    const ctx = { ...createFaceContext(), ...patch }
    const person = getFacePersonality({ seed, faceStyle: 'calm', browWeight: 'medium' })
    const open: number[] = []
    for (let frame = 0; frame < frames; frame += 1) {
      updateEmotion(state, ctx, person, 1 / 60, false, null)
      open.push(state.params[CH.open]!)
    }
    return { state, open }
  }

  it('flaps the jaw while talking, and keeps the mouth quiet otherwise', () => {
    const talking = run(0.4, { talk: 1 }, 180).open.slice(60)
    const silent = run(0.4, {}, 180).open.slice(60)
    expect(Math.max(...talking) - Math.min(...talking)).toBeGreaterThan(0.15)
    expect(Math.max(...silent) - Math.min(...silent)).toBeLessThan(0.08)
    // Not a constant buzz: it closes between syllables.
    expect(Math.min(...talking)).toBeLessThan(0.15)
  })

  it('smiles for a listener and laughs with the open mouth for a joke', () => {
    const idle = run(0.4, {}).state.params
    const smiling = run(0.4, { chatSmile: 1 }).state.params
    const laughing = run(0.4, { chatLaugh: 1 }).state.params
    expect(smiling[CH.smileA]!).toBeGreaterThan(idle[CH.smileA]! + 0.2)
    expect(laughing[CH.open]!).toBeGreaterThan(idle[CH.open]! + 0.4)
    expect(laughing[CH.teeth]!).toBeGreaterThan(0.6)
  })

  it('yawns: mouth wide open, eyes squeezed shut, brows up', () => {
    const idle = run(0.4, {}).state.params
    const yawning = run(0.4, { yawn: 1 }).state.params
    expect(yawning[CH.open]!).toBeGreaterThan(0.85)
    expect(yawning[CH.lidUA]!).toBeLessThan(0.25)
    expect(yawning[CH.lidLA]!).toBeGreaterThan(0.6)
    expect(yawning[CH.browIA]!).toBeGreaterThan(idle[CH.browIA]! + 0.4)
  })

  it('a yawn beats a smile for control of the face, and fades back out', () => {
    const both = run(0.4, { yawn: 1, chatSmile: 1, folded: false }).state.params
    expect(both[CH.open]!).toBeGreaterThan(0.8)
    const state = createEmotionState(0.4)
    const person = getFacePersonality({ seed: 0.4, faceStyle: 'calm', browWeight: 'medium' })
    const ctx = { ...createFaceContext(), yawn: 1 }
    for (let frame = 0; frame < 90; frame += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
    ctx.yawn = 0
    for (let frame = 0; frame < 120; frame += 1) updateEmotion(state, ctx, person, 1 / 60, false, null)
    expect(state.params[CH.open]!).toBeLessThan(0.2)
  })

  it('does not talk or yawn when the emotion state is set instantly (reduced motion)', () => {
    const state = createEmotionState(0.4)
    const person = getFacePersonality({ seed: 0.4, faceStyle: 'calm', browWeight: 'medium' })
    const ctx = { ...createFaceContext(), talk: 1 }
    updateEmotion(state, ctx, person, 1 / 60, true, null)
    // (The director feeds talk = 0 under reduced motion; the procedural jaw is also skipped when instant.)
    expect(state.params[CH.open]!).toBeLessThan(0.15)
  })
})

describe('room life: neon buzz and sconce flames', () => {
  it('hums near full brightness and stutters only briefly each cycle', () => {
    let dim = 0
    let samples = 0
    for (let time = 0; time < NEON_CYCLE_SECONDS * 4; time += 0.01) {
      const level = neonBuzz(time)
      expect(level).toBeGreaterThan(0.25)
      expect(level).toBeLessThan(1.05)
      if (level < 0.9) dim += 1
      samples += 1
    }
    expect(dim / samples).toBeLessThan(0.05)
    expect(dim).toBeGreaterThan(0)
  })

  it('flickers each flame out of step and never dims one to nothing', () => {
    let min = Infinity
    let max = -Infinity
    for (let time = 0; time < 60; time += 0.02) {
      const value = flameFlicker(time, 0.3)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min).toBeGreaterThan(0.75)
    expect(max).toBeLessThan(1.1)
    expect(max - min).toBeGreaterThan(0.06)
    expect(flameFlicker(5, 0.3)).not.toBeCloseTo(flameFlicker(5, 2.0), 3)
  })

  it('drives the sconce shades only, holds them steady under reduced motion, and restores the base level', () => {
    const scene = new THREE.Scene()
    const make = (x: number) => {
      const group = new THREE.Group()
      group.name = 'art-deco-wall-sconce'
      const material = new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity: 1.15 })
      const brass = new THREE.MeshStandardMaterial({ emissive: '#000000', emissiveIntensity: 0 })
      group.add(new THREE.Mesh(new THREE.BoxGeometry(), brass), new THREE.Mesh(new THREE.BoxGeometry(), material))
      group.position.x = x
      scene.add(group)
      return { material, brass }
    }
    const a = make(-4)
    const b = make(4)
    const seen = new Set<number>()
    for (let time = 0; time < 20; time += 0.1) {
      animateSconceFlames(scene, time, false)
      seen.add(Math.round(a.material.emissiveIntensity * 1000))
      expect(a.brass.emissiveIntensity).toBe(0)
    }
    expect(seen.size).toBeGreaterThan(20)
    expect(a.material.emissiveIntensity).not.toBeCloseTo(b.material.emissiveIntensity, 3)
    animateSconceFlames(scene, 7, true)
    expect(a.material.emissiveIntensity).toBeCloseTo(1.15, 6)
    expect(b.material.emissiveIntensity).toBeCloseTo(1.15, 6)
  })
})
