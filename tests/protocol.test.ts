import { describe, expect, it } from 'vitest'
import { parseC2S } from '@/shared/protocol'

describe('join_room profile protocol', () => {
  it('accepts sanitized profile fields on join', () => {
    expect(parseC2S(JSON.stringify({
      type: 'join_room',
      nickname: ' Sam ',
      email: 'SAM@example.COM',
      venmoUsername: 'samvenmo',
    }))).toEqual({
      type: 'join_room',
      nickname: ' Sam ',
      email: 'sam@example.com',
      venmoUsername: '@samvenmo',
      reconnectToken: undefined,
    })
  })

  it('rejects invalid email or venmo on join', () => {
    expect(parseC2S(JSON.stringify({
      type: 'join_room',
      nickname: 'Sam',
      email: 'bad',
      venmoUsername: '@sam',
    }))).toBeNull()

    expect(parseC2S(JSON.stringify({
      type: 'join_room',
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '$bad',
    }))).toBeNull()
  })
})
