export const PROFILE_STORAGE_KEY = 'poker_player_profile'

export interface PlayerProfile {
  nickname: string
  email: string
  venmoUsername: string
}

export type PlayerProfileValidation =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VENMO_RE = /^@?[A-Za-z0-9_-]{2,30}$/

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeVenmoUsername(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

export function validatePlayerProfile(input: {
  nickname: string
  email: string
  venmoUsername: string
}): PlayerProfileValidation {
  const nickname = input.nickname.trim().slice(0, 20)
  if (!nickname) {
    return { ok: false, error: 'Please enter your nickname' }
  }

  const email = normalizeEmail(input.email)
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please enter a valid email' }
  }

  const venmoUsername = normalizeVenmoUsername(input.venmoUsername)
  if (!VENMO_RE.test(venmoUsername)) {
    return { ok: false, error: 'Please enter a valid Venmo username' }
  }

  return {
    ok: true,
    profile: {
      nickname,
      email,
      venmoUsername,
    },
  }
}

export function loadStoredPlayerProfile(storage = getBrowserStorage()): PlayerProfile | null {
  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<PlayerProfile>
    const result = validatePlayerProfile({
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      venmoUsername: typeof parsed.venmoUsername === 'string' ? parsed.venmoUsername : '',
    })

    return result.ok ? result.profile : null
  } catch {
    return null
  }
}

export function saveStoredPlayerProfile(
  profile: PlayerProfile,
  storage = getBrowserStorage()
): PlayerProfile | null {
  if (!storage) {
    return null
  }

  const result = validatePlayerProfile(profile)
  if (!result.ok) {
    return null
  }

  storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(result.profile))
  return result.profile
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}
