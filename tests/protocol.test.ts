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

describe('table action protocol', () => {
  it('accepts a manual rabbit hunt request', () => {
    expect(parseC2S(JSON.stringify({
      type: 'rabbit_hunt',
    }))).toEqual({
      type: 'rabbit_hunt',
    })
  })
})

describe('targeted table chat protocol', () => {
  it('keeps a sanitized player target on chat messages', () => {
    expect(parseC2S(JSON.stringify({
      type: 'table_chat',
      message: '  nice hand  ',
      targetId: ' bob ',
    }))).toEqual({
      type: 'table_chat',
      message: 'nice hand',
      targetId: 'bob',
    })
  })

  it('normalizes optional avatar data on join and avatar updates', () => {
    const expectedAvatar = {
      modelKey: 'hoodie',
      hat: 'beanie',
      glasses: 'none',
      jacket: 'none',
      jacketColor: 'emerald',
      idleTell: 'chip_shuffle',
      celebration: 'wave',
    }

    expect(parseC2S(JSON.stringify({
      type: 'join_room',
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '',
      avatar: {
        modelKey: 'hoodie',
        hat: 'beanie',
        jacketColor: 'emerald',
        idleTell: 'chip_shuffle',
      },
    }))).toEqual({
      type: 'join_room',
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '',
      avatar: expectedAvatar,
      reconnectToken: undefined,
    })

    expect(parseC2S(JSON.stringify({
      type: 'update_avatar',
      avatar: {
        modelKey: 'hoodie',
        hat: 'beanie',
        jacketColor: 'emerald',
        idleTell: 'chip_shuffle',
      },
    }))).toEqual({
      type: 'update_avatar',
      avatar: expectedAvatar,
    })

    expect(parseC2S(JSON.stringify({
      type: 'update_avatar',
      avatar: 'hoodie',
    }))).toBeNull()
  })

  it('only accepts explicit yes or no run-it-twice votes', () => {
    expect(parseC2S(JSON.stringify({
      type: 'run_it_twice_vote',
      vote: 'yes',
    }))).toEqual({
      type: 'run_it_twice_vote',
      vote: 'yes',
    })

    expect(parseC2S(JSON.stringify({
      type: 'run_it_twice_vote',
      vote: true,
    }))).toBeNull()
  })

  it('accepts card reveal requests and explicit consent responses', () => {
    expect(parseC2S(JSON.stringify({
      type: 'request_card_reveal',
      targetId: ' player-2 ',
    }))).toEqual({
      type: 'request_card_reveal',
      targetId: 'player-2',
    })

    expect(parseC2S(JSON.stringify({
      type: 'respond_card_reveal',
      requesterId: 'player-1',
      allow: true,
    }))).toEqual({
      type: 'respond_card_reveal',
      requesterId: 'player-1',
      allow: true,
    })

    expect(parseC2S(JSON.stringify({
      type: 'respond_card_reveal',
      requesterId: 'player-1',
      allow: 'yes',
    }))).toBeNull()
  })
})
