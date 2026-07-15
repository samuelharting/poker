import { describe, expect, it } from 'vitest'
import { getAvatarRetryDelayMs } from '@/components/three/DesktopPokerRoom3D'

describe('desktop 3D scene resilience helpers', () => {
  it('backs failed avatar requests off without ever creating a hot retry loop', () => {
    expect(getAvatarRetryDelayMs(0)).toBe(3_000)
    expect(getAvatarRetryDelayMs(1)).toBe(3_000)
    expect(getAvatarRetryDelayMs(2)).toBe(6_000)
    expect(getAvatarRetryDelayMs(4)).toBe(24_000)
    expect(getAvatarRetryDelayMs(5)).toBe(30_000)
    expect(getAvatarRetryDelayMs(99)).toBe(30_000)
  })
})
