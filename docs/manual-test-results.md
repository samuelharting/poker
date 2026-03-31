# Manual Test Results — 7-2 Bounty + Social Pipeline

Date: 2026-03-31
Reviewer: Codex QA pass

## Notes

- This environment is CLI-only (no browser UI interaction available in-session).
- Automated validation and protocol-level checks were run, and the dev/runtime endpoints were exercised enough to confirm startup behavior, but full two-browser smoke was not executable here.
- Existing regression tests now report `62 passed` (including updated bounty and social coverage).

## Automated checks executed

- `npm run build` (2026-03-31 14:39 UTC): pass
  - Next.js production build succeeds.
- `npm test` (2026-03-31 14:43 UTC): pass (5 files, 62 tests)
- `npx tsc --noEmit` (2026-03-31 14:45 UTC): pass

## Runtime checks (CLI-level smoke preflight)

- `npm run dev` launched with Next + PartyKit (`dev` script).  
  Result (14:37 UTC): services started, but request probing showed Next returning 404/500 under this runner and room route behavior inconsistent for short test window.
- `npm run dev:next` started on local alt port (`3002` because `3000`/`3001` were in use in the environment) and served `/room/ABC` (200) but showed transient errors in compile log for local-only checks.

| # | Scenario | Method | Expected | Result | Timestamp | Notes |
|---|---|---|---|---|---|---|
| 1 | Host create room, share code/link; guest join same room | Manual browser flows | Host and guest both on same room, seated | **BLOCKED** | 2026-03-31 14:40 | Not executed (no two-browser context in this environment). |
| 2 | Seat both players | Manual flow | Both seated, game starts possible | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 3 | Start hand + preflop-only path | Manual hand play | Preflop round resolves correctly | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 4 | Start hand + flop/turn/river showdown | Manual hand play | Full board and showdown resolves with winners | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 5 | Fold / check / call / all-in branches | Manual hand play | Branches enforce legal action flow | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 6 | Forced 7-2 bounty win | Manual hand manipulation | Hero with 7-2 wins and bounty awarded to bounty metadata | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 7 | Forced split-pot with 7-2 winner mix | Manual hand manipulation | Split bounty distributed according to implemented entitlement rule | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 8 | Acting-player reconnect, cards masked correctly, timer recovery | Browser reconnect scenario | Seat/state restored and timer sync | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
| 9 | Host remove player while seated and mid-hand | Host action | Removal updates snapshot and status correctly | **BLOCKED** | 2026-03-31 14:40 | Not executed (no browser interaction possible). |
|10 | Chat + emote: valid/invalid messages | Two clients + social UI | Broadcast/scope works; oversized/invalid payload handling | **PARTIAL** | 2026-03-31 14:43 | Chat/emote protocol checks exist in automated room-server tests; UI rendering pass not performed here. |
|11 | `action_failed`/`error` visible as toast feedback | UI feedback path | Failure surfaced in UI and not console-only | **BLOCKED** | 2026-03-31 14:40 | Not executable without browser; existing UI uses toast path for failures. |

## Gaps requiring follow-up

1. **Priority 1 (High): Full two-client browser smoke validation**  
   - Repro: Run the list in this document across two separate browser contexts (host/guest).  
   - Impact: End-to-end confidence for user-visible behavior (bounty winner UI, reconnect masking, social bubbles, toasts) is not yet manually confirmed in this environment.

2. **Priority 2 (Medium): Reproducible local dev startup for interactive checks**  
   - Repro: run `npm run dev`, open `/room/{6-char}` from two clients and exercise flows.
   - Impact: Current container runner exhibits Next request/route inconsistencies under CLI-only probing; should be verified on a standard local dev machine with browser.

## Next action

- Please run this manual checklist in a local desktop/browser environment using two tabs/contexts to close Priority 1 gap.
- Share any discrepancies with room code, role, and step number so we can patch quickly.
