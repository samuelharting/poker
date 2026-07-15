import { describe, expect, it } from 'vitest'
import {
  ROOM_CODE_LENGTH,
  createRoomCode,
  formatRoomCodeInput,
  isValidRoomCode,
  normalizeRoomCode,
} from '@/lib/roomCode'

describe('room code helpers', () => {
  it('creates non-sequential private room codes from safe uppercase characters', () => {
    const code = createRoomCode(length => Uint8Array.from(
      Array.from({ length }, (_, index) => index * 17)
    ))

    expect(code).toHaveLength(ROOM_CODE_LENGTH)
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(code).not.toMatch(/^\d+$/)
  })

  it('normalizes pasted room codes while keeping legacy numeric rooms joinable', () => {
    expect(normalizeRoomCode(' ab23-cd ')).toBe('AB23CD')
    expect(isValidRoomCode('AB23CD')).toBe(true)
    expect(isValidRoomCode('123')).toBe(true)
    expect(isValidRoomCode('ABC1O0')).toBe(false)
    expect(isValidRoomCode('bad code!')).toBe(false)
  })

  it('formats join input without dropping safe letter codes or legacy numeric rooms', () => {
    expect(formatRoomCodeInput(' ab23-cd ')).toBe('AB23CD')
    expect(formatRoomCodeInput('00123')).toBe('00123')
    expect(formatRoomCodeInput('abc!def!12345678901234567890')).toBe('ABCDEF12345678901234')
  })
})
