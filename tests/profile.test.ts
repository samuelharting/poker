import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_STORAGE_KEY,
  loadStoredPlayerProfile,
  normalizeEmail,
  normalizeVenmoUsername,
  saveStoredPlayerProfile,
  validatePlayerProfile,
} from '@/lib/profile'

describe('player profile helpers', () => {
  it('normalizes email and venmo values', () => {
    expect(normalizeEmail(' SAM@Example.COM ')).toBe('sam@example.com')
    expect(normalizeVenmoUsername(' @sam-h_12 ')).toBe('@sam-h_12')
    expect(normalizeVenmoUsername('samvenmo')).toBe('@samvenmo')
  })

  it('rejects missing or invalid profile fields', () => {
    expect(validatePlayerProfile({ nickname: '', email: 'sam@example.com', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'bad', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'sam@example.com', venmoUsername: '' }).ok).toBe(false)
  })

  it('returns a normalized profile for valid input', () => {
    expect(validatePlayerProfile({
      nickname: ' Sam ',
      email: 'SAM@example.COM',
      venmoUsername: 'samvenmo',
    })).toEqual({
      ok: true,
      profile: {
        nickname: 'Sam',
        email: 'sam@example.com',
        venmoUsername: '@samvenmo',
      },
    })
  })

  it('saves and loads a browser-local profile', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
    } as unknown as Storage

    saveStoredPlayerProfile(
      { nickname: 'Sam', email: 'SAM@example.com', venmoUsername: 'samvenmo' },
      storage
    )

    expect(store.has(PROFILE_STORAGE_KEY)).toBe(true)
    expect(loadStoredPlayerProfile(storage)).toEqual({
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '@samvenmo',
    })
  })
})
