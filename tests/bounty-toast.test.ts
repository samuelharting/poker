import { describe, expect, it } from 'vitest'
import { getBountyToastCopy } from '@/components/table/BountyToast'

const players = [
  { id: 'a', nickname: 'Ace' },
  { id: 'b', nickname: 'Bee' },
  { id: 'c', nickname: 'Cee' },
]

describe('getBountyToastCopy', () => {
  it('announces the winner, total and per-player charge', () => {
    const copy = getBountyToastCopy(
      { active: true, amount: 300, percentage: 10, contributors: ['b', 'c'], recipientPlayerIds: ['a'], reason: '7-2' },
      players
    )
    expect(copy).toEqual({ title: '7-2 bounty! Ace +$300', detail: '2 players pay $150 each' })
  })

  it('stays hidden when no bounty was paid', () => {
    expect(getBountyToastCopy(undefined, players)).toBeNull()
    expect(
      getBountyToastCopy(
        { active: true, amount: 0, percentage: 0, contributors: [], recipientPlayerIds: ['a'], reason: '' },
        players
      )
    ).toBeNull()
    expect(
      getBountyToastCopy(
        { active: false, amount: 200, percentage: 10, contributors: ['b'], recipientPlayerIds: ['a'], reason: '' },
        players
      )
    ).toBeNull()
  })
})
