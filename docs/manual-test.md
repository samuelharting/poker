# Poker App Manual + Smoke Validation Notes

## Automated checks executed in this pass

- `npm test tests/room-server.test.ts`
  - status: pass (1 file, 7 tests, 0 failed)
  - exact output summary:
    - `Test Files 1 passed`
    - `Tests 7 passed`

## Manual smoke checklist

Use this checklist with two browser clients on the same room:

1. **Create table / join by code + link**
   - Host opens `/room/{CODE}` and enters nickname.
   - Guest opens `/room/{CODE}` and joins with a different nickname.
   - Expected: both receive a room snapshot and are seated when ready.

2. **Seat assignment and spectator rejection**
   - Host and one guest take seats.
   - Attempt to start a new action from a non-seated connection (or join without seating when full).
   - Expected: action result is rejected with a toast and server emits `action_failed` to UI path.

3. **Reconnect flow for seated player**
   - Host disconnects from tab/network.
   - Reopen with same nickname in same room code.
   - Expected: action timer state and hand state continue from server snapshot, seat is restored after reconnect, reconnect token rotates in client session.

4. **Host remove player**
   - Host removes a seated player from the host list.
   - Expected: removed player gets folded/offline in snapshot, host list updates and no reconnect token remains for removed player.

5. **Host leave / transfer**
   - Host calls leave with another active seated player present.
   - Expected: host flag transfers to host list next player and game state remains valid.

6. **Action timer lifecycle after reconnect and timeout**
   - Start hand with at least two seated players.
   - Disconnect acting player and wait for reconnect/timeout behavior.
   - Expected: timer re-syncs on reconnect and clears at hand end.

7. **Action failures shown in UI**
   - Trigger invalid action/emote from UI (e.g., invalid emote or illegal action).
   - Expected: visible toast notification appears, not only console output.

8. **Chat + emote flow (new social UX)**
   - Send short table text and one emote.
   - Expected: chat list grows, latest own and opponent entries appear, and overhead bubbles show above seats then fade out by timeout.

9. **Bot/system spam filtering**
   - Observe social log for non-player / bot-like nicknames.
   - Expected: message rows should not display for sanitized bot/system entries.

## Last execution log

- `tests/room-server.test.ts`: pass, 7/7 tests passed.
- Manual smoke: not executed in this terminal session; run the checklist above on two clients before release.
