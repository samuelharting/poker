export const PROFILE_STORAGE_KEY = 'poker_player_profile'

export const AVATAR_MODEL_KEYS = [
  'business_man',
  'casual',
  'hoodie',
  'worker',
  'punk',
  'adventurer',
] as const

export const AVATAR_HAT_OPTIONS = [
  'none',
  'fedora',
  'cowboy',
  'beanie',
  'visor',
  'crown',
] as const

export const AVATAR_GLASSES_OPTIONS = ['none', 'round', 'aviator', 'shades'] as const

export const AVATAR_JACKET_OPTIONS = [
  'none',
  'tuxedo',
  'leather',
  'varsity',
  'western',
  'smoking',
] as const

export const AVATAR_JACKET_COLOR_OPTIONS = [
  'burgundy',
  'midnight',
  'emerald',
  'ivory',
  'gold',
  'violet',
] as const

export const AVATAR_IDLE_TELL_OPTIONS = [
  'calm',
  'chip_shuffle',
  'card_peek',
  'table_drum',
] as const

export const AVATAR_CELEBRATION_OPTIONS = [
  'wave',
  'fist_pump',
  'victory',
  'slow_clap',
] as const

export type PlayerAvatarModelKey = (typeof AVATAR_MODEL_KEYS)[number]
export type PlayerAvatarHatStyle = (typeof AVATAR_HAT_OPTIONS)[number]
export type PlayerAvatarGlassesStyle = (typeof AVATAR_GLASSES_OPTIONS)[number]
export type PlayerAvatarJacketStyle = (typeof AVATAR_JACKET_OPTIONS)[number]
export type PlayerAvatarJacketColor = (typeof AVATAR_JACKET_COLOR_OPTIONS)[number]
export type PlayerAvatarIdleTell = (typeof AVATAR_IDLE_TELL_OPTIONS)[number]
export type PlayerAvatarCelebration = (typeof AVATAR_CELEBRATION_OPTIONS)[number]

export interface PlayerAvatarCustomization {
  modelKey: PlayerAvatarModelKey
  hat: PlayerAvatarHatStyle
  glasses: PlayerAvatarGlassesStyle
  jacket: PlayerAvatarJacketStyle
  jacketColor: PlayerAvatarJacketColor
  idleTell: PlayerAvatarIdleTell
  celebration: PlayerAvatarCelebration
}

export const DEFAULT_PLAYER_AVATAR_CUSTOMIZATION: PlayerAvatarCustomization = {
  modelKey: 'business_man',
  hat: 'none',
  glasses: 'none',
  jacket: 'none',
  jacketColor: 'burgundy',
  idleTell: 'calm',
  celebration: 'wave',
}

export interface PlayerProfile {
  nickname: string
  email: string
  venmoUsername: string
  avatar?: PlayerAvatarCustomization
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

export function normalizePlayerAvatarCustomization(input: unknown): PlayerAvatarCustomization {
  const candidate = input && typeof input === 'object'
    ? input as Partial<Record<keyof PlayerAvatarCustomization, unknown>>
    : {}

  return {
    modelKey: includesOption(AVATAR_MODEL_KEYS, candidate.modelKey)
      ? candidate.modelKey
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.modelKey,
    hat: includesOption(AVATAR_HAT_OPTIONS, candidate.hat)
      ? candidate.hat
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.hat,
    glasses: includesOption(AVATAR_GLASSES_OPTIONS, candidate.glasses)
      ? candidate.glasses
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.glasses,
    jacket: includesOption(AVATAR_JACKET_OPTIONS, candidate.jacket)
      ? candidate.jacket
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.jacket,
    jacketColor: includesOption(AVATAR_JACKET_COLOR_OPTIONS, candidate.jacketColor)
      ? candidate.jacketColor
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.jacketColor,
    idleTell: includesOption(AVATAR_IDLE_TELL_OPTIONS, candidate.idleTell)
      ? candidate.idleTell
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.idleTell,
    celebration: includesOption(AVATAR_CELEBRATION_OPTIONS, candidate.celebration)
      ? candidate.celebration
      : DEFAULT_PLAYER_AVATAR_CUSTOMIZATION.celebration,
  }
}

function includesOption<const T extends readonly string[]>(
  options: T,
  value: unknown
): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

export function validatePlayerProfile(input: {
  nickname: string
  email: string
  venmoUsername: string
  avatar?: unknown
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
  if (venmoUsername && !VENMO_RE.test(venmoUsername)) {
    return { ok: false, error: 'Please enter a valid Venmo username' }
  }

  return {
    ok: true,
    profile: {
      nickname,
      email,
      venmoUsername,
      ...(input.avatar === undefined
        ? {}
        : { avatar: normalizePlayerAvatarCustomization(input.avatar) }),
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
      avatar: parsed.avatar,
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
