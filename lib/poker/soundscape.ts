import type { SeatPlayer, TableState } from './types'

export const POKER_SOUND_PREFERENCES_STORAGE_KEY = 'poker-night:sound-preferences'

export interface PokerSoundPreferences {
  muted: boolean
  volume: number
}

export const DEFAULT_POKER_SOUND_PREFERENCES: Readonly<PokerSoundPreferences> = {
  muted: false,
  volume: 0.65,
}

export interface PokerSoundPreferenceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export type PokerSoundEventKind =
  | 'hand_start'
  | 'board_flop'
  | 'board_turn'
  | 'board_river'
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all_in'
  | 'your_turn'
  | 'fold_win'

/** Cues reserved for an explicit cinematic timeline rather than snapshot diffing. */
export type PokerSoundTimelineCueKind =
  | 'showdown_card'
  | 'showdown_winner'
  | 'pot_payout'

export type PokerSoundCueKind = PokerSoundEventKind | PokerSoundTimelineCueKind

export interface PokerSoundEvent {
  id: string
  kind: PokerSoundEventKind
  delayMs: number
  playerId?: string
}

export interface PokerSoundEventCursor {
  previous?: TableState
  seenEventIds: readonly string[]
}

export interface PokerSoundEventFrame {
  cursor: PokerSoundEventCursor
  events: PokerSoundEvent[]
}

const MAX_REMEMBERED_EVENT_IDS = 256

export function normalizePokerSoundPreferences(
  value: unknown,
  fallback: PokerSoundPreferences = DEFAULT_POKER_SOUND_PREFERENCES
): PokerSoundPreferences {
  const safeFallback = {
    muted: typeof fallback.muted === 'boolean'
      ? fallback.muted
      : DEFAULT_POKER_SOUND_PREFERENCES.muted,
    volume: clampVolume(fallback.volume),
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return safeFallback
  }

  const candidate = value as Partial<PokerSoundPreferences>
  return {
    muted: typeof candidate.muted === 'boolean' ? candidate.muted : safeFallback.muted,
    volume: typeof candidate.volume === 'number' && Number.isFinite(candidate.volume)
      ? clampVolume(candidate.volume)
      : safeFallback.volume,
  }
}

export function loadPokerSoundPreferences(
  storage?: PokerSoundPreferenceStorage | null
): PokerSoundPreferences {
  const target = storage === undefined ? getBrowserStorage() : storage
  if (!target) {
    return { ...DEFAULT_POKER_SOUND_PREFERENCES }
  }

  try {
    const stored = target.getItem(POKER_SOUND_PREFERENCES_STORAGE_KEY)
    if (!stored) {
      return { ...DEFAULT_POKER_SOUND_PREFERENCES }
    }

    return normalizePokerSoundPreferences(JSON.parse(stored))
  } catch {
    return { ...DEFAULT_POKER_SOUND_PREFERENCES }
  }
}

export function savePokerSoundPreferences(
  preferences: PokerSoundPreferences,
  storage?: PokerSoundPreferenceStorage | null
): boolean {
  const target = storage === undefined ? getBrowserStorage() : storage
  if (!target) {
    return false
  }

  try {
    target.setItem(
      POKER_SOUND_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizePokerSoundPreferences(preferences))
    )
    return true
  } catch {
    return false
  }
}

export function createPokerSoundEventCursor(): PokerSoundEventCursor {
  return {
    previous: undefined,
    seenEventIds: [],
  }
}

/**
 * Advance the sound event stream without mutating the prior cursor. Passing no
 * snapshot resets the baseline, so the first snapshot after a disconnect or
 * remount is intentionally silent.
 */
export function advancePokerSoundEventCursor(
  cursor: PokerSoundEventCursor,
  next: TableState | undefined,
  yourId: string
): PokerSoundEventFrame {
  if (!next) {
    return {
      cursor: createPokerSoundEventCursor(),
      events: [],
    }
  }

  if (!cursor.previous || cursor.previous.roomCode !== next.roomCode) {
    return {
      cursor: {
        previous: next,
        seenEventIds: getSnapshotEventIds(next, yourId),
      },
      events: [],
    }
  }

  const derived = derivePokerSoundEvents(cursor.previous, next, yourId)
  const seen = new Set(cursor.seenEventIds)
  const events = derived.filter(event => !seen.has(event.id))
  const seenEventIds = rememberEventIds(cursor.seenEventIds, events.map(event => event.id))

  return {
    cursor: {
      previous: next,
      seenEventIds,
    },
    events,
  }
}

/**
 * Derive deterministic cues from two authoritative table snapshots. A missing
 * previous snapshot (initial load/reconnect) is always silent. True showdown
 * winner and payout cues are intentionally omitted so a visual showdown
 * timeline can trigger those sounds at the correct reveal moments.
 */
export function derivePokerSoundEvents(
  previous: TableState | undefined,
  next: TableState | undefined,
  yourId: string
): PokerSoundEvent[] {
  if (!previous || !next || previous.roomCode !== next.roomCode) {
    return []
  }

  const events: PokerSoundEvent[] = []
  const roomHandKey = `${next.roomCode}:${next.handNumber}`
  const sameHand = previous.handNumber === next.handNumber
  let delayMs = 0

  const handStarted = next.phase === 'in_hand' && (
    previous.phase !== 'in_hand' || !sameHand
  )
  if (handStarted) {
    events.push({
      id: `${roomHandKey}:hand-start`,
      kind: 'hand_start',
      delayMs,
    })
    delayMs += 360
  }

  const previousActionIds = new Set(
    previous.players.flatMap(player => player.lastActionId
      ? [`${player.id}:${player.lastActionId}`]
      : [])
  )
  const actionEvents = next.players
    .flatMap(player => createPlayerActionEvent(next.roomCode, player, previousActionIds))
    .sort(compareActionEvents)

  for (const actionEvent of actionEvents) {
    events.push({ ...actionEvent, delayMs })
    delayMs += actionEvent.kind === 'all_in' ? 170 : 85
  }

  const previousFoldWinId = sameHand ? getFoldWinEventId(previous) : null
  const foldWinId = getFoldWinEventId(next)
  if (foldWinId && foldWinId !== previousFoldWinId) {
    delayMs += actionEvents.length > 0 ? 90 : 0
    events.push({
      id: foldWinId,
      kind: 'fold_win',
      delayMs,
    })
    delayMs += 360
  }

  const previousBoardCount = sameHand ? previous.communityCards.length : 0
  const nextBoardCount = next.communityCards.length
  const boardEvents: Array<{ threshold: number; kind: PokerSoundEventKind; street: string }> = [
    { threshold: 3, kind: 'board_flop', street: 'flop' },
    { threshold: 4, kind: 'board_turn', street: 'turn' },
    { threshold: 5, kind: 'board_river', street: 'river' },
  ]

  for (const boardEvent of boardEvents) {
    if (previousBoardCount < boardEvent.threshold && nextBoardCount >= boardEvent.threshold) {
      events.push({
        id: `${roomHandKey}:board:${boardEvent.street}`,
        kind: boardEvent.kind,
        delayMs,
      })
      delayMs += 190
    }
  }

  if (isNewHeroTurn(previous, next, yourId)) {
    events.push({
      id: getHeroTurnEventId(next, yourId),
      kind: 'your_turn',
      delayMs: delayMs + 70,
      playerId: yourId,
    })
  }

  return events
}

export function getPokerSoundActionKind(lastAction: string): PokerSoundEventKind | null {
  const normalized = lastAction.trim().toLowerCase()

  if (normalized.includes('fold')) return 'fold'
  if (normalized.includes('check')) return 'check'
  if (normalized.includes('all-in') || normalized.includes('all in')) return 'all_in'
  if (normalized.includes('call')) return 'call'
  if (normalized.includes('raise')) return 'raise'
  if (normalized.includes('bet')) return 'bet'

  return null
}

function createPlayerActionEvent(
  roomCode: string,
  player: SeatPlayer,
  previousActionIds: Set<string>
): PokerSoundEvent[] {
  if (!player.lastActionId || !player.lastAction) {
    return []
  }

  const actionIdentity = `${player.id}:${player.lastActionId}`
  if (previousActionIds.has(actionIdentity)) {
    return []
  }

  const kind = getPokerSoundActionKind(player.lastAction)
  if (!kind) {
    return []
  }

  return [{
    id: `${roomCode}:action:${actionIdentity}`,
    kind,
    delayMs: 0,
    playerId: player.id,
  }]
}

function compareActionEvents(left: PokerSoundEvent, right: PokerSoundEvent): number {
  const leftSequence = getTrailingSequence(left.id)
  const rightSequence = getTrailingSequence(right.id)
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence
  }

  return left.id.localeCompare(right.id)
}

function getTrailingSequence(value: string): number {
  const match = value.match(/:(\d+)$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function isNewHeroTurn(previous: TableState, next: TableState, yourId: string): boolean {
  if (!yourId || next.phase !== 'in_hand' || next.actingPlayerId !== yourId) {
    return false
  }

  return (
    previous.phase !== 'in_hand' ||
    previous.handNumber !== next.handNumber ||
    previous.actingPlayerId !== yourId ||
    previous.round !== next.round ||
    (previous.actionSequence ?? 0) !== (next.actionSequence ?? 0)
  )
}

function getHeroTurnEventId(state: TableState, yourId: string): string {
  return [
    state.roomCode,
    state.handNumber,
    'turn',
    state.round ?? 'none',
    state.actionSequence ?? 0,
    yourId,
  ].join(':')
}

function getFoldWinEventId(state: TableState): string | null {
  if (
    state.phase !== 'between_hands' ||
    state.round === 'showdown' ||
    !state.winners?.length
  ) {
    return null
  }

  const winners = state.winners
    .map(winner => `${winner.playerId}-${winner.amount}`)
    .sort()
    .join(',')

  return `${state.roomCode}:${state.handNumber}:fold-win:${winners}`
}

function getSnapshotEventIds(state: TableState, yourId: string): string[] {
  const roomHandKey = `${state.roomCode}:${state.handNumber}`
  const ids = state.players.flatMap(player => {
    if (!player.lastActionId || !player.lastAction || !getPokerSoundActionKind(player.lastAction)) {
      return []
    }
    return [`${state.roomCode}:action:${player.id}:${player.lastActionId}`]
  })

  if (state.phase === 'in_hand') {
    ids.push(`${roomHandKey}:hand-start`)
  }
  if (state.communityCards.length >= 3) ids.push(`${roomHandKey}:board:flop`)
  if (state.communityCards.length >= 4) ids.push(`${roomHandKey}:board:turn`)
  if (state.communityCards.length >= 5) ids.push(`${roomHandKey}:board:river`)
  if (yourId && state.phase === 'in_hand' && state.actingPlayerId === yourId) {
    ids.push(getHeroTurnEventId(state, yourId))
  }

  const foldWinId = getFoldWinEventId(state)
  if (foldWinId) ids.push(foldWinId)

  return ids.slice(-MAX_REMEMBERED_EVENT_IDS)
}

function rememberEventIds(current: readonly string[], additions: readonly string[]): string[] {
  const next = [...current]
  const existing = new Set(current)

  for (const id of additions) {
    if (!existing.has(id)) {
      existing.add(id)
      next.push(id)
    }
  }

  return next.slice(-MAX_REMEMBERED_EVENT_IDS)
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_POKER_SOUND_PREFERENCES.volume
  }
  return Math.min(1, Math.max(0, volume))
}

function getBrowserStorage(): PokerSoundPreferenceStorage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}
