import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CELEBRATION_OPTIONS,
  AVATAR_GLASSES_OPTIONS,
  AVATAR_HAT_OPTIONS,
  AVATAR_IDLE_TELL_OPTIONS,
  AVATAR_JACKET_COLOR_OPTIONS,
  AVATAR_JACKET_OPTIONS,
  AVATAR_MODEL_KEYS,
  DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  PROFILE_STORAGE_KEY,
  loadStoredPlayerProfile,
  normalizeEmail,
  normalizePlayerUsername,
  normalizePlayerAvatarCustomization,
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

  it('rejects missing required fields and malformed optional payment handles', () => {
    expect(validatePlayerProfile({ nickname: '', email: 'sam@example.com', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'bad', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'sam@example.com', venmoUsername: '@' }).ok).toBe(false)
  })

  it('normalizes fold-stat usernames without changing display casing', () => {
    expect(normalizePlayerUsername('  SaM Hart  ')).toBe('sam hart')
  })

  it('accepts a nickname-only profile for table entry', () => {
    expect(validatePlayerProfile({ nickname: 'River' })).toEqual({
      ok: true,
      profile: {
        nickname: 'River',
        email: '',
        venmoUsername: '',
      },
    })
  })

  it('exports every supported avatar customization option', () => {
    expect(AVATAR_MODEL_KEYS).toEqual([
      'business_man', 'casual', 'hoodie', 'worker', 'punk', 'adventurer',
    ])
    expect(AVATAR_HAT_OPTIONS).toEqual(['none', 'fedora', 'cowboy', 'beanie', 'visor', 'crown'])
    expect(AVATAR_GLASSES_OPTIONS).toEqual(['none', 'round', 'aviator', 'shades'])
    expect(AVATAR_JACKET_OPTIONS).toEqual([
      'none', 'tuxedo', 'leather', 'varsity', 'western', 'smoking',
    ])
    expect(AVATAR_JACKET_COLOR_OPTIONS).toEqual([
      'burgundy', 'midnight', 'emerald', 'ivory', 'gold', 'violet',
    ])
    expect(AVATAR_IDLE_TELL_OPTIONS).toEqual(['calm', 'chip_shuffle', 'card_peek', 'table_drum'])
    expect(AVATAR_CELEBRATION_OPTIONS).toEqual(['wave', 'fist_pump', 'victory', 'slow_clap'])
  })

  it('normalizes partial or untrusted avatar customization', () => {
    expect(normalizePlayerAvatarCustomization({
      modelKey: 'punk',
      hat: 'crown',
      glasses: 'not-real',
      jacketColor: 'violet',
      idleTell: 'table_drum',
    })).toEqual({
      ...DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
      modelKey: 'punk',
      hat: 'crown',
      jacketColor: 'violet',
      idleTell: 'table_drum',
    })

    expect(normalizePlayerAvatarCustomization(null)).toEqual(
      DEFAULT_PLAYER_AVATAR_CUSTOMIZATION
    )
  })

  it('accepts an empty optional Venmo username', () => {
    expect(validatePlayerProfile({
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '',
    })).toEqual({
      ok: true,
      profile: {
        nickname: 'Sam',
        email: 'sam@example.com',
        venmoUsername: '',
      },
    })
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

  it('persists normalized avatar customization without breaking legacy profiles', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
    } as unknown as Storage

    saveStoredPlayerProfile({
      nickname: 'Sam',
      email: 'sam@example.com',
      venmoUsername: '',
      avatar: {
        modelKey: 'adventurer',
        hat: 'cowboy',
        glasses: 'aviator',
        jacket: 'western',
        jacketColor: 'gold',
        idleTell: 'card_peek',
        celebration: 'victory',
      },
    }, storage)

    expect(loadStoredPlayerProfile(storage)?.avatar).toEqual({
      modelKey: 'adventurer',
      hat: 'cowboy',
      glasses: 'aviator',
      jacket: 'western',
      jacketColor: 'gold',
      idleTell: 'card_peek',
      celebration: 'victory',
    })

    store.set(PROFILE_STORAGE_KEY, JSON.stringify({
      nickname: 'Legacy',
      email: 'legacy@example.com',
      venmoUsername: '',
    }))
    expect(loadStoredPlayerProfile(storage)).toEqual({
      nickname: 'Legacy',
      email: 'legacy@example.com',
      venmoUsername: '',
    })
  })
})
