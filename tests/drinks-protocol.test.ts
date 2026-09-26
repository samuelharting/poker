import { describe, expect, it } from 'vitest'
import { parseC2S, parseS2C } from '@/shared/protocol'

describe('drink protocol validation', () => {
  it('accepts beer and water orders', () => {
    expect(parseC2S(JSON.stringify({ type: 'order_drink', kind: 'beer' })))
      .toEqual({ type: 'order_drink', kind: 'beer' })
    expect(parseC2S(JSON.stringify({ type: 'order_drink', kind: 'water' })))
      .toEqual({ type: 'order_drink', kind: 'water' })
  })

  it('rejects unknown or malformed drink orders', () => {
    expect(parseC2S(JSON.stringify({ type: 'order_drink', kind: 'vodka' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'order_drink' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'order_drink', kind: ['beer'] }))).toBeNull()
    expect(parseC2S('{"type":"order_drink","kind":')).toBeNull()
  })

  it('drops extra fields from drink orders', () => {
    expect(parseC2S(JSON.stringify({ type: 'order_drink', kind: 'beer', level: 10, targetId: 'x' })))
      .toEqual({ type: 'order_drink', kind: 'beer' })
  })

  const validEvent = {
    id: 'evt-1',
    kind: 'beer',
    playerId: 'p1',
    nickname: 'Sam',
    level: 3,
    beers: 3,
    at: 1_700_000_000_000,
  }

  it('parses valid drink events from the server', () => {
    expect(parseS2C(JSON.stringify({ type: 'drink_event', event: validEvent })))
      .toEqual({ type: 'drink_event', event: validEvent })
  })

  it('rejects malformed drink events', () => {
    const cases = [
      { ...validEvent, kind: 'shot' },
      { ...validEvent, level: 11 },
      { ...validEvent, level: -1 },
      { ...validEvent, beers: 1.5 },
      { ...validEvent, playerId: '' },
      { ...validEvent, id: 7 },
      { ...validEvent, at: 'now' },
      null,
    ]
    for (const event of cases) {
      expect(parseS2C(JSON.stringify({ type: 'drink_event', event }))).toBeNull()
    }
  })

  it('sanitizes control characters out of event nicknames', () => {
    const parsed = parseS2C(JSON.stringify({
      type: 'drink_event',
      event: { ...validEvent, nickname: 'Sam\u0000\u0007 ' },
    }))
    expect(parsed?.type === 'drink_event' && parsed.event.nickname).toBe('Sam')
  })
})
