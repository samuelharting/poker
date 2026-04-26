# Player Profiles and Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight local user profiles, room-local player stats, and Venmo handles in winner displays.

**Architecture:** Keep profiles browser-local and send sanitized profile data over the existing PartyKit `join_room` protocol. Store private email only in PartyKit server memory, expose public Venmo and stats through `TableState`, and update stats from room events.

**Tech Stack:** Next.js app router, React client components, PartyKit room server, TypeScript shared protocol/types, Vitest.

---

## File Structure

- Create `lib/profile.ts`: profile validation, normalization, and `localStorage` helpers.
- Modify `shared/protocol.ts`: join payload parsing and shared profile sanitizers.
- Modify `lib/poker/types.ts`: public Venmo and stats fields on `SeatPlayer`, `LobbyPlayer`, and winners.
- Modify `partykit/room.ts`: store profiles, track stats, enrich snapshots and winner metadata.
- Modify `app/page.tsx` and `app/room/[code]/page.tsx`: collect and remember profile fields.
- Modify `components/table/PlayerSeat.tsx` and `components/table/PokerTable.tsx`: show Venmo in winner UI and compact stats where low-risk.
- Add/modify tests under `tests/`.

---

### Task 1: Profile Helpers and Protocol

**Files:**
- Create: `lib/profile.ts`
- Modify: `shared/protocol.ts`
- Test: `tests/profile.test.ts`
- Test: `tests/protocol.test.ts`

- [ ] **Step 1: Write failing profile tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_STORAGE_KEY,
  normalizeEmail,
  normalizeVenmoUsername,
  validatePlayerProfile,
  loadStoredPlayerProfile,
  saveStoredPlayerProfile,
} from '@/lib/profile'

describe('player profile helpers', () => {
  it('normalizes email and venmo values', () => {
    expect(normalizeEmail(' SAM@Example.COM ')).toBe('sam@example.com')
    expect(normalizeVenmoUsername(' @sam-h_12 ')).toBe('@sam-h_12')
  })

  it('rejects missing or invalid profile fields', () => {
    expect(validatePlayerProfile({ nickname: '', email: 'sam@example.com', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'bad', venmoUsername: '@sam' }).ok).toBe(false)
    expect(validatePlayerProfile({ nickname: 'Sam', email: 'sam@example.com', venmoUsername: '' }).ok).toBe(false)
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
```

- [ ] **Step 2: Run profile tests to verify they fail**

Run: `npm test -- tests/profile.test.ts`
Expected: FAIL because `lib/profile.ts` does not exist.

- [ ] **Step 3: Implement profile helpers**

Implement `normalizeEmail`, `normalizeVenmoUsername`, `validatePlayerProfile`, `loadStoredPlayerProfile`, and `saveStoredPlayerProfile` in `lib/profile.ts`. Keep validation simple: non-empty nickname, email containing one `@` and a dot after it, Venmo username matching `@?[A-Za-z0-9_-]{2,30}`.

- [ ] **Step 4: Write failing protocol tests**

```ts
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
```

- [ ] **Step 5: Run protocol tests to verify they fail**

Run: `npm test -- tests/protocol.test.ts`
Expected: FAIL because `join_room` does not parse profile fields yet.

- [ ] **Step 6: Extend protocol parsing**

Update `C2SMessage` `join_room` to include `email` and `venmoUsername`. Reuse profile normalization helpers in `parseC2S`.

- [ ] **Step 7: Verify Task 1**

Run: `npm test -- tests/profile.test.ts tests/protocol.test.ts`
Expected: PASS.

---

### Task 2: Public Types and Room Stats

**Files:**
- Modify: `lib/poker/types.ts`
- Modify: `partykit/room.ts`
- Test: `tests/room-server.test.ts`

- [ ] **Step 1: Write failing room tests**

Add tests that join users with email and Venmo, start a two-player hand, fold the acting player, then assert:

```ts
expect(winnerSeat?.venmoUsername).toBe('@alicepay')
expect(winnerSeat?.stats?.handsPlayed).toBe(1)
expect(winnerSeat?.stats?.wins).toBe(1)
expect(winnerSeat?.stats?.totalWon).toBeGreaterThan(0)
expect(foldedSeat?.stats?.folds).toBe(1)
expect(foldedSeat?.stats?.foldRate).toBe(1)
expect(JSON.stringify(snapshot?.state)).not.toContain('alice@example.com')
```

- [ ] **Step 2: Run room tests to verify they fail**

Run: `npm test -- tests/room-server.test.ts`
Expected: FAIL because `joinPlayer` test helper and room snapshots do not support profile fields.

- [ ] **Step 3: Add public type fields**

Add:

```ts
export interface PlayerStats {
  handsPlayed: number
  folds: number
  wins: number
  totalWon: number
  foldRate: number
}
```

Then add optional `venmoUsername?: string` and `stats?: PlayerStats` to `SeatPlayer` and `LobbyPlayer`. Add `venmoUsername?: string` to `TableState.winners[]` and `InternalGameState.winners[]`.

- [ ] **Step 4: Implement room profile and stats state**

Add `playerProfiles` keyed by player id and `statsByEmail` keyed by normalized email to `RoomData`. On join, store `{ email, venmoUsername }`. On reconnect, preserve the original profile. On `startHand` success, increment `handsPlayed` for dealt non-bot players. On explicit fold and auto/forced folds, increment `folds`. After `processAction`, auto-start, or direct `startHand` produces `between_hands`, record wins once per completed hand.

- [ ] **Step 5: Enrich snapshots**

In `buildSnapshotFor` and `buildLobbyPlayers`, copy public Venmo and stats onto players. Ensure email never appears in `room_snapshot`.

- [ ] **Step 6: Verify Task 2**

Run: `npm test -- tests/room-server.test.ts`
Expected: PASS.

---

### Task 3: Client Profile Forms

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/room/[code]/page.tsx`
- Test: `tests/profile.test.ts`

- [ ] **Step 1: Extend helper tests for form payloads**

Add assertions that `validatePlayerProfile` returns a normalized profile ready for `join_room` and a user-facing error string for missing email or Venmo.

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npm test -- tests/profile.test.ts`
Expected: FAIL until validation result includes the expected normalized payload/errors.

- [ ] **Step 3: Update landing page forms**

Replace separate nickname-only state with profile field state for create and join forms. Prefill from `loadStoredPlayerProfile()` in `useEffect`. On create/join, validate, save with `saveStoredPlayerProfile`, preserve `poker_nickname` for compatibility, and navigate.

- [ ] **Step 4: Update direct room entry**

In `app/room/[code]/page.tsx`, load the stored profile. If complete, enter the room. Otherwise render the same nickname/email/Venmo fields. Pass the full profile into `useRoom`.

- [ ] **Step 5: Update `useRoom` join payload**

Change `useRoom(roomCode, nickname)` to accept a profile object and send `email` and `venmoUsername` in `join_room`.

- [ ] **Step 6: Verify Task 3**

Run: `npm test -- tests/profile.test.ts tests/protocol.test.ts`
Expected: PASS.

---

### Task 4: Winner Venmo UI

**Files:**
- Modify: `components/table/PokerTable.tsx`
- Modify: `components/table/PlayerSeat.tsx`
- Test: `tests/player-seat.test.tsx`

- [ ] **Step 1: Write failing display helper tests**

Add a pure helper such as `formatWinnerPaymentLabel(nickname, venmoUsername)` and test:

```ts
expect(formatWinnerPaymentLabel('Sam', '@samvenmo')).toBe('Sam @samvenmo')
expect(formatWinnerPaymentLabel('Sam')).toBe('Sam')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/player-seat.test.tsx`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Update winner display models**

Carry `venmoUsername` into `winnerDisplays`. Render winner names as `nickname @venmo` in center announcement. Pass `winnerVenmoUsername` into `PlayerSeat` and render the payout chip as `Won $420 @samvenmo` when present.

- [ ] **Step 4: Verify Task 4**

Run: `npm test -- tests/player-seat.test.tsx`
Expected: PASS.

---

### Task 5: Full Verification

**Files:**
- No new files unless fixing uncovered test failures.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/profile.test.ts tests/protocol.test.ts tests/room-server.test.ts tests/player-seat.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

