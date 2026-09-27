import { describe, expect, it } from 'vitest'
import { isQuietRejection } from '@/hooks/useRoom'

describe('server rejections shown to the player', () => {
  it('keeps expected races quiet', () => {
    expect(isQuietRejection('Join the room before acting')).toBe(true)
    expect(isQuietRejection('Already seated')).toBe(true)
    expect(isQuietRejection('Not your turn')).toBe(true)
    expect(isQuietRejection('Hand already in progress')).toBe(true)
  })

  it('surfaces the ones that explain a failed action', () => {
    expect(isQuietRejection('Table is full')).toBe(false)
    expect(isQuietRejection('Only the game creator can start the game.')).toBe(false)
    expect(isQuietRejection('Reloading. Next chip in 5s.')).toBe(false)
    expect(isQuietRejection('Need at least 2 players with chips who are at the table')).toBe(false)
  })
})
