/**
 * The Pill 💊 (internally still "the mushroom"): a rare, secret prank. Exactly one mushroom exists at the
 * whole table at a time. Every ~MUSHROOM_SPAWN_EVERY_HANDS hands (fun mode
 * on, nothing active) it turns up in a random player's pocket. The holder
 * slips it into someone's water; only the spiker knows. The victim's NEXT
 * water does nothing but start a ~90s trip, and the table finds out who did
 * it the moment it kicks in.
 *
 * Anti-cheat, same principle as every drink: the trip never touches a live
 * hand. If the spiked water kicks in while the victim still holds live cards,
 * the trip is queued and starts once they fold or the hand ends. Nothing here
 * ever folds, skips or sits anyone out; a trip is visual only.
 *
 * Pure state machine so the PartyKit room and the tests share one source of
 * truth. The room owns timers and messaging.
 */

export const MUSHROOM_SPAWN_EVERY_HANDS = 30
/** Spawn lands within +/- this many hands of the cadence, so it isn't clockwork. */
export const MUSHROOM_SPAWN_JITTER_HANDS = 3
/** A holder who sits on it this many hands loses it (it goes bad). */
export const MUSHROOM_HOLD_EXPIRES_HANDS = 20
/** A spiked glass nobody drinks within this many hands fizzles out. */
export const MUSHROOM_SPIKE_EXPIRES_HANDS = 25
/** The trip lasts the rest of the hand it starts in plus this many full hands. */
export const TRIP_HANDS = 3
/** Safety net for an idle table: a trip never lasts longer than this. */
export const TRIP_MAX_MS = 6 * 60_000
/** Chance a new mushroom goes to a human when bots are also seated. */
export const MUSHROOM_HUMAN_HOLDER_CHANCE = 0.75
/**
 * The holder gets this long (once it is not their turn) to pick a victim;
 * then the pre-selected random target is spiked automatically, so the
 * mushroom can never be stalled.
 */
export const MUSHROOM_AUTO_SPIKE_MS = 15_000
/** Bots don't need the full window. */
export const MUSHROOM_BOT_SPIKE_MIN_MS = 3_000
export const MUSHROOM_BOT_SPIKE_MAX_MS = 12_000

export type MushroomState =
  | {
    status: 'held'
    holderId: string
    sinceHand: number
    /** Random pre-selected victim (null while nobody eligible is seated). */
    suggestedVictimId: string | null
    /** Server time the suggested victim gets spiked if the holder does nothing (null = not armed yet). */
    autoSpikeAt: number | null
  }
  | { status: 'spiked'; spikerId: string; spikerNickname: string; victimId: string; sinceHand: number }

export interface TripState {
  victimId: string
  spikerId: string
  spikerNickname: string
  /** Waiting for the victim to be out of the live hand. */
  queued: boolean
  startedAt: number | null
  /** The trip ends once this hand is over (TRIP_HANDS full hands after it started). */
  endsAfterHand: number | null
  /** Idle-table safety net (server time). */
  endsAt: number | null
}

export interface MushroomTable {
  mushroom: MushroomState | null
  trip: TripState | null
  /** First hand number at which a new mushroom may appear. */
  nextSpawnHand: number
}

/** What the trip looks like to everyone once it has kicked in. */
export interface PublicTripState {
  startedAt: number
  /** Ends when this hand is over. */
  endsAfterHand: number
}

/** What a single player privately knows about the mushroom. */
export type PrivateMushroomState =
  | { status: 'holding'; suggestedVictimId: string | null; autoSpikeAt: number | null }
  | { status: 'spiked'; victimId: string }

export interface MushroomCandidate {
  id: string
  isBot: boolean
}

function jitteredGap(random: () => number): number {
  const jitter = Math.floor(random() * (MUSHROOM_SPAWN_JITTER_HANDS * 2 + 1)) - MUSHROOM_SPAWN_JITTER_HANDS
  return MUSHROOM_SPAWN_EVERY_HANDS + jitter
}

export function createMushroomTable(random: () => number = Math.random, handNumber = 0): MushroomTable {
  return { mushroom: null, trip: null, nextSpawnHand: handNumber + jitteredGap(random) }
}

/** The mushroom is gone (eaten, lost, gone bad): the next one is ~30 hands out. */
export function scheduleNextMushroom(table: MushroomTable, handNumber: number, random: () => number = Math.random) {
  table.nextSpawnHand = handNumber + jitteredGap(random)
}

/** True while a mushroom is in someone's pocket, in someone's glass, or being tripped on. */
export function isMushroomActive(table: MushroomTable): boolean {
  return table.mushroom !== null || table.trip !== null
}

/**
 * Call when a hand starts. Gives the mushroom to a random seated player when
 * it is due. Needs at least one human (the whole point is friends pranking
 * friends); humans are favoured when bots are seated too. Returns the new
 * holder's id, or null.
 */
export function maybeSpawnMushroom(
  table: MushroomTable,
  handNumber: number,
  candidates: readonly MushroomCandidate[],
  random: () => number = Math.random
): string | null {
  if (isMushroomActive(table) || handNumber < table.nextSpawnHand) {
    return null
  }
  const humans = candidates.filter(candidate => !candidate.isBot)
  if (humans.length === 0) {
    return null
  }
  const bots = candidates.filter(candidate => candidate.isBot)
  const pool = bots.length === 0 || random() < MUSHROOM_HUMAN_HOLDER_CHANCE ? humans : bots
  const holder = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!
  table.mushroom = { status: 'held', holderId: holder.id, sinceHand: handNumber, suggestedVictimId: null, autoSpikeAt: null }
  return holder.id
}

/** Gives a freshly found mushroom straight to `holderId` (dev tools). */
export function giveMushroom(table: MushroomTable, holderId: string, handNumber: number) {
  table.trip = null
  table.mushroom = { status: 'held', holderId, sinceHand: handNumber, suggestedVictimId: null, autoSpikeAt: null }
}

/**
 * Keeps the holder's pre-selected victim valid: picks a random eligible
 * target when there is none (bots prefer humans), drops one who left. Returns
 * true when the suggestion changed.
 */
export function refreshSuggestedVictim(
  table: MushroomTable,
  eligible: readonly MushroomCandidate[],
  holderIsBot: boolean,
  random: () => number = Math.random
): boolean {
  const mushroom = table.mushroom
  if (!mushroom || mushroom.status !== 'held') return false
  const targets = eligible.filter(candidate => candidate.id !== mushroom.holderId)
  if (mushroom.suggestedVictimId && targets.some(candidate => candidate.id === mushroom.suggestedVictimId)) {
    return false
  }
  const humans = targets.filter(candidate => !candidate.isBot)
  const pool = holderIsBot && humans.length > 0 ? humans : targets
  const next = pool.length > 0 ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!.id : null
  const changed = next !== mushroom.suggestedVictimId
  mushroom.suggestedVictimId = next
  if (!next) mushroom.autoSpikeAt = null
  return changed
}

/**
 * Starts the auto-spike countdown once there is someone to spike and the
 * holder is free to look at the prompt (not their turn). Returns true when armed now.
 */
export function armAutoSpike(table: MushroomTable, now: number, delayMs: number, holderIsActing: boolean): boolean {
  const mushroom = table.mushroom
  if (!mushroom || mushroom.status !== 'held' || mushroom.autoSpikeAt !== null) return false
  if (!mushroom.suggestedVictimId || holderIsActing) return false
  mushroom.autoSpikeAt = now + delayMs
  return true
}

/** The countdown ran out: who to spike (the pre-selected victim), or null. */
export function getDueAutoSpike(table: MushroomTable, now: number): { holderId: string; victimId: string } | null {
  const mushroom = table.mushroom
  if (!mushroom || mushroom.status !== 'held' || mushroom.autoSpikeAt === null || !mushroom.suggestedVictimId) return null
  return now >= mushroom.autoSpikeAt ? { holderId: mushroom.holderId, victimId: mushroom.suggestedVictimId } : null
}

/** Hands a mushroom may sit around before it is lost. Returns who lost it (for a private note). */
export function expireStaleMushroom(
  table: MushroomTable,
  handNumber: number,
  random: () => number = Math.random
): { kind: 'held'; holderId: string } | { kind: 'spiked'; spikerId: string } | null {
  const mushroom = table.mushroom
  if (!mushroom) return null
  const age = handNumber - mushroom.sinceHand
  if (mushroom.status === 'held' && age >= MUSHROOM_HOLD_EXPIRES_HANDS) {
    table.mushroom = null
    scheduleNextMushroom(table, handNumber, random)
    return { kind: 'held', holderId: mushroom.holderId }
  }
  if (mushroom.status === 'spiked' && age >= MUSHROOM_SPIKE_EXPIRES_HANDS) {
    table.mushroom = null
    scheduleNextMushroom(table, handNumber, random)
    return { kind: 'spiked', spikerId: mushroom.spikerId }
  }
  return null
}

export type SpikeResult = { ok: true } | { ok: false; reason: string }

/** Why `spikerId` can't spike `victimId` right now, or null. Seat / fun-mode checks belong to the caller. */
export function getSpikeBlockReason(table: MushroomTable, spikerId: string, victimId: string): string | null {
  const mushroom = table.mushroom
  if (!mushroom || mushroom.status !== 'held' || mushroom.holderId !== spikerId) {
    return "You don't have a pill."
  }
  if (spikerId === victimId) {
    return 'Taking your own pill is not the prank.'
  }
  return null
}

export function spikeWater(
  table: MushroomTable,
  spikerId: string,
  spikerNickname: string,
  victimId: string,
  handNumber: number
): SpikeResult {
  const reason = getSpikeBlockReason(table, spikerId, victimId)
  if (reason) return { ok: false, reason }
  table.mushroom = { status: 'spiked', spikerId, spikerNickname, victimId, sinceHand: handNumber }
  return { ok: true }
}

/**
 * The victim ordered a water. Returns true when this is the spiked glass:
 * the mushroom is used up (nobody else can find one) and the room should make
 * that water start a trip instead of sobering them when it kicks in.
 */
export function drinkSpikedWater(table: MushroomTable, playerId: string): { spikerId: string; spikerNickname: string } | null {
  const mushroom = table.mushroom
  if (!mushroom || mushroom.status !== 'spiked' || mushroom.victimId !== playerId) {
    return null
  }
  table.mushroom = null
  // Reserve the one-mushroom slot for this trip until the water kicks in.
  table.trip = {
    victimId: playerId,
    spikerId: mushroom.spikerId,
    spikerNickname: mushroom.spikerNickname,
    queued: true,
    startedAt: null,
    endsAfterHand: null,
    endsAt: null,
  }
  return { spikerId: mushroom.spikerId, spikerNickname: mushroom.spikerNickname }
}

/**
 * The spiked water kicked in, or the victim's hand situation changed: starts
 * a queued trip once the victim is no longer live in a hand. Returns true
 * exactly when the trip starts (the moment to reveal the spiker to the table).
 */
export function startTripIfReady(table: MushroomTable, victimIsLive: boolean, now: number, handNumber: number): boolean {
  const trip = table.trip
  if (!trip || !trip.queued || victimIsLive) {
    return false
  }
  trip.queued = false
  trip.startedAt = now
  // The rest of this hand (or the gap before the next one) plus TRIP_HANDS full hands.
  trip.endsAfterHand = handNumber + TRIP_HANDS
  trip.endsAt = now + TRIP_MAX_MS
  return true
}

/**
 * Ends a finished trip: once hand `endsAfterHand` is over (`handOver` says
 * the current hand is finished), or at the idle-table safety net. Returns the
 * victim id when it ended.
 */
export function endTripIfOver(
  table: MushroomTable,
  now: number,
  handNumber: number,
  handOver: boolean,
  random: () => number = Math.random
): string | null {
  const trip = table.trip
  if (!trip || trip.queued || trip.endsAfterHand === null) {
    return null
  }
  const handsDone = handNumber > trip.endsAfterHand || (handNumber === trip.endsAfterHand && handOver)
  if (!handsDone && (trip.endsAt === null || now < trip.endsAt)) {
    return null
  }
  table.trip = null
  scheduleNextMushroom(table, handNumber, random)
  return trip.victimId
}

/**
 * Someone left the table. If they held the mushroom, were the spiked victim or
 * were tripping, the mushroom returns to nobody and a new one turns up later.
 * (A spiker leaving changes nothing: the glass is already spiked.)
 */
export function removeMushroomPlayer(
  table: MushroomTable,
  playerId: string,
  handNumber: number,
  random: () => number = Math.random
): boolean {
  const mushroom = table.mushroom
  let changed = false
  if (mushroom && (
    (mushroom.status === 'held' && mushroom.holderId === playerId) ||
    (mushroom.status === 'spiked' && mushroom.victimId === playerId)
  )) {
    table.mushroom = null
    changed = true
  }
  if (table.trip?.victimId === playerId) {
    table.trip = null
    changed = true
  }
  if (changed && !isMushroomActive(table)) {
    scheduleNextMushroom(table, handNumber, random)
  }
  return changed
}

/** Fun mode off: no mushrooms, and any trip ends right now. */
export function clearMushrooms(table: MushroomTable, handNumber: number, random: () => number = Math.random) {
  table.mushroom = null
  table.trip = null
  scheduleNextMushroom(table, handNumber, random)
}

/** Everyone sees a trip only once it has actually kicked in (never a queued one). */
export function getPublicTrip(table: MushroomTable, playerId: string): PublicTripState | null {
  const trip = table.trip
  if (!trip || trip.queued || trip.victimId !== playerId || trip.startedAt === null || trip.endsAfterHand === null) {
    return null
  }
  return { startedAt: trip.startedAt, endsAfterHand: trip.endsAfterHand }

}

/** Only the holder (and later the spiker) ever learns anything about the mushroom. */
export function getPrivateMushroomState(table: MushroomTable, playerId: string): PrivateMushroomState | null {
  const mushroom = table.mushroom
  if (!mushroom) return null
  if (mushroom.status === 'held' && mushroom.holderId === playerId) {
    return { status: 'holding', suggestedVictimId: mushroom.suggestedVictimId, autoSpikeAt: mushroom.autoSpikeAt }
  }
  if (mushroom.status === 'spiked' && mushroom.spikerId === playerId) {
    return { status: 'spiked', victimId: mushroom.victimId }
  }
  return null
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type MushroomEventKind = 'found' | 'spiked' | 'lost' | 'trip_started' | 'trip_ended'

export const MUSHROOM_EVENT_KINDS: readonly MushroomEventKind[] = ['found', 'spiked', 'lost', 'trip_started', 'trip_ended']

/**
 * `found`, `spiked` and `lost` are private (sent only to the holder/spiker);
 * `trip_started` and `trip_ended` go to the whole table.
 */
export interface MushroomEvent {
  id: string
  kind: MushroomEventKind
  at: number
  spikerId?: string
  spikerNickname?: string
  victimId?: string
  victimNickname?: string
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= 64)
}

export function isValidMushroomEvent(raw: unknown): raw is MushroomEvent {
  if (!raw || typeof raw !== 'object') return false
  const event = raw as Partial<MushroomEvent>
  return (
    typeof event.id === 'string' && event.id.length > 0 &&
    typeof event.kind === 'string' && (MUSHROOM_EVENT_KINDS as readonly string[]).includes(event.kind) &&
    typeof event.at === 'number' && Number.isFinite(event.at) &&
    isOptionalString(event.spikerId) &&
    isOptionalString(event.spikerNickname) &&
    isOptionalString(event.victimId) &&
    isOptionalString(event.victimNickname)
  )
}

export function isValidPrivateMushroomState(raw: unknown): raw is PrivateMushroomState {
  if (!raw || typeof raw !== 'object') return false
  const state = raw as Partial<{ status: string; victimId: unknown; suggestedVictimId: unknown; autoSpikeAt: unknown }>
  if (state.status === 'spiked') return typeof state.victimId === 'string'
  return state.status === 'holding' &&
    (state.suggestedVictimId === null || typeof state.suggestedVictimId === 'string') &&
    (state.autoSpikeAt === null || (typeof state.autoSpikeAt === 'number' && Number.isFinite(state.autoSpikeAt)))
}

/** Toast copy from `viewerId`'s point of view. */
export function describeMushroomEvent(event: MushroomEvent, viewerId = ''): { icon: string; text: string } {
  const victim = event.victimId === viewerId ? 'your' : `${event.victimNickname ?? 'someone'}'s`
  const spiker = event.spikerId === viewerId ? 'You' : event.spikerNickname ?? 'Someone'
  switch (event.kind) {
    case 'found':
      return { icon: '💊', text: 'You found a pill! Pick whose water gets it.' }

    case 'spiked':
      return {
        icon: '🤫',
        text: `You slipped the pill into ${event.victimNickname ? `${event.victimNickname}'s` : 'their'} water. Act natural.`,
      }
    case 'lost':
      return { icon: '💊', text: 'Your pill dissolved in your pocket. Another one will turn up.' }
    case 'trip_started':
      return { icon: '💊', text: `${spiker} spiked ${victim} water!` }
    case 'trip_ended':
      return {
        icon: '🌈',
        text: event.victimId === viewerId ? 'The walls stop breathing. Welcome back.' : `${event.victimNickname ?? 'Someone'} is back from the trip`,
      }
  }
}
