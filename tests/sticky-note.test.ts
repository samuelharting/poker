import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import {
  isValidStickyNote,
  sanitizeStickyText,
  STICKY_NOTE_COOLDOWN_MS,
  STICKY_NOTE_MAX_LENGTH,
} from '@/lib/stickyNote'
import { parseC2S, parseS2C, type C2SMessage, type S2CMessage } from '@/shared/protocol'
import { connect, createHarness, MockConnection, send as sendTo, type TypedMessage } from './helpers/roomHarness'

interface Seat {
  connection: Connection
  playerId: string
  send: (message: C2SMessage) => void
}

function messagesOf(connection: Connection): S2CMessage[] {
  return (connection as unknown as MockConnection).messages
}

function last<T extends S2CMessage['type']>(connection: Connection, type: T): TypedMessage<T> | undefined {
  const messages = messagesOf(connection)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === type) return messages[index] as TypedMessage<T>
  }
  return undefined
}

function createTable() {
  const { room, server } = createHarness()
  const join = (id: string, nickname: string, seatIndex?: number): Seat => {
    const connection = connect(server, room, id)
    const send = (message: C2SMessage) => sendTo(server, connection, message)
    send({ type: 'join_room', nickname })
    if (seatIndex !== undefined) send({ type: 'seat_me', seatIndex })
    const session = last(connection, 'private_session')
    if (!session) throw new Error('missing session')
    return { connection, playerId: session.yourId, send }
  }
  return { room, server, join }
}

const state = (viewer: Seat) => last(viewer.connection, 'room_snapshot')!.state
const noteOf = (viewer: Seat, playerId: string) => state(viewer).players.find(player => player.id === playerId)?.stickyNote
const failure = (seat: Seat) => last(seat.connection, 'action_failed')?.message ?? ''

/** Folds the current hand out so the table sits between hands. */
function finishHand(host: Seat, seats: Seat[]) {
  let guard = 0
  while (state(host).phase === 'in_hand' && guard < 20) {
    const acting = state(host).actingPlayerId
    seats.find(seat => seat.playerId === acting)?.send({ type: 'player_action', action: 'fold' })
    guard += 1
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sanitizeStickyText (pure)', () => {
  it('trims, collapses whitespace and keeps ordinary words', () => {
    expect(sanitizeStickyText('  LOSER  ')).toEqual({ ok: true, text: 'LOSER' })
    expect(sanitizeStickyText('big \n\t  dummy')).toEqual({ ok: true, text: 'big dummy' })
    expect(sanitizeStickyText("Nova's #1!")).toEqual({ ok: true, text: "Nova's #1!" })
  })

  it('counts code points, not UTF-16 units', () => {
    expect(sanitizeStickyText('1234567890').ok).toBe(true)
    expect(sanitizeStickyText('12345678901')).toMatchObject({ ok: false })
    expect(sanitizeStickyText('\u{1F600}'.repeat(STICKY_NOTE_MAX_LENGTH)).ok).toBe(true)
    expect(sanitizeStickyText('\u{1F600}'.repeat(STICKY_NOTE_MAX_LENGTH + 1)).ok).toBe(false)
  })

  it('rejects empty and non-string input', () => {
    expect(sanitizeStickyText('')).toMatchObject({ ok: false })
    expect(sanitizeStickyText('   \n ')).toMatchObject({ ok: false })
    expect(sanitizeStickyText(42)).toMatchObject({ ok: false })
    expect(sanitizeStickyText('​‮')).toMatchObject({ ok: false })
  })

  it('strips control, zero-width and bidi-override characters', () => {
    expect(sanitizeStickyText('LO​SER‮')).toEqual({ ok: true, text: 'LOSER' })
    expect(sanitizeStickyText('A\u0000B\u0007C')).toEqual({ ok: true, text: 'A B C' })
    expect(sanitizeStickyText('x⁦y⁩')).toEqual({ ok: true, text: 'xy' })
  })

  it('caps stacked combining marks (zalgo)', () => {
    const zalgo = 'é̂̃̄̅'
    expect(Array.from((sanitizeStickyText(zalgo) as { text: string }).text).length).toBeLessThanOrEqual(2)
  })

  it('validates public notes', () => {
    expect(isValidStickyNote({ text: 'HI', fromId: 'a', fromNickname: 'Sam', at: 1 })).toBe(true)
    expect(isValidStickyNote({ text: '', fromId: 'a', fromNickname: 'Sam', at: 1 })).toBe(false)
    expect(isValidStickyNote({ text: 'x'.repeat(11), fromId: 'a', fromNickname: 'Sam', at: 1 })).toBe(false)
    expect(isValidStickyNote(null)).toBe(false)
  })
})

describe('sticky_note protocol', () => {
  it('parses a note and rejects malformed ones', () => {
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', targetId: ' p2 ', text: 'LOSER' })))
      .toEqual({ type: 'sticky_note', targetId: 'p2', text: 'LOSER' })
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', text: 'LOSER' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', targetId: 'p2' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', targetId: 'p2', text: 5 }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', targetId: 'x'.repeat(65), text: 'hi' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'sticky_note', targetId: 'p2', text: 'x'.repeat(201) }))).toBeNull()
  })

  it('parses the sticky_note notice kind', () => {
    expect(parseS2C(JSON.stringify({ type: 'notice', kind: 'sticky_note', message: 'Nova stuck "HI" on you', playerId: 'a' })))
      .toMatchObject({ type: 'notice', kind: 'sticky_note' })
  })
})

describe('PokerRoom sticky_note', () => {
  it('sticks a note that every viewer sees, and tells only the target', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const rail = join('rail', 'Rail')

    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: '  LOSER ' })

    for (const viewer of [sam, alex, rail]) {
      expect(noteOf(viewer, alex.playerId)).toMatchObject({ text: 'LOSER', fromId: sam.playerId, fromNickname: 'Sam' })
      expect(noteOf(viewer, sam.playerId)).toBeUndefined()
    }
    expect(last(alex.connection, 'notice')).toMatchObject({ kind: 'sticky_note', message: 'Sam stuck "LOSER" on you' })
    expect(last(sam.connection, 'notice')).toBeUndefined()
  })

  it('rejects empty and over-long text with a friendly message, without burning the allowance', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)

    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: '   ' })
    expect(failure(sam)).toMatch(/word/i)
    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: '12345678901' })
    expect(failure(sam)).toContain('10 characters')
    expect(noteOf(sam, alex.playerId)).toBeUndefined()

    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: '1234567890' })
    expect(noteOf(sam, alex.playerId)?.text).toBe('1234567890')
  })

  it('accepts any ordinary word (no filtering) and strips invisible characters', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: 'ba​nana‮' })
    expect(noteOf(sam, alex.playerId)?.text).toBe('banana')
  })

  it('needs a seated target and a joined sender, and still works with drinking off', () => {
    vi.useFakeTimers()
    const { join, room, server } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const rail = join('rail', 'Rail')

    sam.send({ type: 'sticky_note', targetId: 'nobody', text: 'HI' })
    expect(failure(sam)).toBe('That player is not at the table')
    // The rail can't wear one, but a spectator can stick one on a seated player.
    sam.send({ type: 'sticky_note', targetId: rail.playerId, text: 'HI' })
    expect(failure(sam)).toBe('That player is not at the table')
    rail.send({ type: 'sticky_note', targetId: alex.playerId, text: 'HI' })
    expect(noteOf(sam, alex.playerId)?.text).toBe('HI')

    const stranger = connect(server, room, 'stranger')
    sendTo(server, stranger, { type: 'sticky_note', targetId: sam.playerId, text: 'HI' })
    expect(last(stranger, 'action_failed')?.message).toContain('Join the room')

    sam.send({ type: 'update_table_settings', funModeEnabled: false })
    alex.send({ type: 'sticky_note', targetId: sam.playerId, text: 'HI' })
    expect(noteOf(sam, sam.playerId)?.text).toBe('HI')
  })

  it('lets you note yourself and a bot', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    sam.send({ type: 'add_bots', count: 1 })
    const bot = state(sam).players.find(player => player.isBot)!

    sam.send({ type: 'sticky_note', targetId: sam.playerId, text: 'ME' })
    expect(noteOf(sam, sam.playerId)?.text).toBe('ME')
    expect(last(sam.connection, 'notice')).toBeUndefined()

    vi.advanceTimersByTime(STICKY_NOTE_COOLDOWN_MS + 1)
    sam.send({ type: 'start_game' })
    // The new hand cleared the self-note and freed the one-per-hand allowance.
    expect(noteOf(sam, sam.playerId)).toBeUndefined()
    sam.send({ type: 'sticky_note', targetId: bot.id, text: 'ROBOT' })
    expect(noteOf(sam, bot.id)?.text).toBe('ROBOT')
  })

  it('allows one note per sender per hand and an 8s cooldown across hands', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const pip = join('pip', 'Pip', 2)
    sam.send({ type: 'start_game' })

    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: 'ONE' })
    sam.send({ type: 'sticky_note', targetId: pip.playerId, text: 'TWO' })
    expect(failure(sam)).toContain('One sticky note per hand')
    expect(noteOf(sam, pip.playerId)).toBeUndefined()

    finishHand(sam, [sam, alex, pip])
    vi.advanceTimersByTime(1_000)
    sam.send({ type: 'start_game' })
    expect(noteOf(sam, alex.playerId)).toBeUndefined()
    sam.send({ type: 'sticky_note', targetId: pip.playerId, text: 'TWO' })
    expect(failure(sam)).toMatch(/Next one in \d+s/)
    expect(noteOf(sam, pip.playerId)).toBeUndefined()

    vi.advanceTimersByTime(STICKY_NOTE_COOLDOWN_MS)
    sam.send({ type: 'sticky_note', targetId: pip.playerId, text: 'TWO' })
    expect(noteOf(sam, pip.playerId)?.text).toBe('TWO')
  })

  it('a new note replaces the old one, and a target takes at most two per hand', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const pip = join('pip', 'Pip', 2)
    const kit = join('kit', 'Kit', 3)

    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: 'FIRST' })
    pip.send({ type: 'sticky_note', targetId: alex.playerId, text: 'SECOND' })
    expect(noteOf(kit, alex.playerId)).toMatchObject({ text: 'SECOND', fromNickname: 'Pip' })

    kit.send({ type: 'sticky_note', targetId: alex.playerId, text: 'THIRD' })
    expect(failure(kit)).toContain('enough sticky notes')
    expect(noteOf(kit, alex.playerId)?.text).toBe('SECOND')
  })

  it('keeps notes through the end of the hand, clears them at the next deal and when a player leaves', () => {
    vi.useFakeTimers()
    const { join } = createTable()
    const sam = join('sam', 'Sam', 0)
    const alex = join('alex', 'Alex', 1)
    const pip = join('pip', 'Pip', 2)
    sam.send({ type: 'start_game' })
    sam.send({ type: 'sticky_note', targetId: alex.playerId, text: 'HOLD' })
    alex.send({ type: 'sticky_note', targetId: pip.playerId, text: 'METOO' })
    expect(noteOf(sam, alex.playerId)?.text).toBe('HOLD')

    finishHand(sam, [sam, alex, pip])
    expect(noteOf(sam, alex.playerId)?.text).toBe('HOLD')

    pip.send({ type: 'leave_room' })
    expect(noteOf(sam, pip.playerId)).toBeUndefined()

    sam.send({ type: 'start_game' })
    expect(noteOf(sam, alex.playerId)).toBeUndefined()
  })
})
