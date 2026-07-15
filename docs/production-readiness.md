# Production Readiness

## Current Product Boundary

Poker Night is productionized as a private, play-money table for friends. It stores player profile details in browser storage and room state in PartyKit. Venmo handles are shown only as settlement hints after a winner is known; the app does not collect money, hold balances, process payments, or provide regulated gambling controls.

## Release Gates

Run these before sharing or deploying:

```powershell
npm run check
```

That command runs:

- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run audit:prod`

`npm run audit:prod` uses `npm audit --omit=dev --audit-level=high`. The full audit still reports dev-only PartyKit/Miniflare issues and the current moderate nested PostCSS warning inside Next. Do not use `npm audit fix --force`; npm currently suggests breaking downgrade paths for both Next and PartyKit.

For browser-level verification, start the app plus PartyKit, then run:

```powershell
npm run smoke:e2e
```

If Next is running on a fallback port, set `POKER_APP_URL` to that URL before running the smoke.

## Manual Smoke Flow

1. Create a room from `/` with a complete player profile.
2. Join the same room in a second browser context with a different profile.
3. Verify both players seat, can add bots if needed, and can start a hand.
4. Play fold/check/call/raise/all-in paths.
5. Confirm visible feedback appears for invalid actions, settings saves, copy/share actions, and server errors.
6. Confirm winner display includes the Venmo handle when present.
7. Confirm refresh/reconnect preserves the seated player state.

## Known External Follow-Ups

- Re-run full `npm audit` after PartyKit publishes patched transitive dependencies for Miniflare/Undici/esbuild.
- Re-check the Next nested PostCSS audit after the Next release line updates its private bundled PostCSS dependency.
- Production deploy still requires a real `NEXT_PUBLIC_PARTYKIT_HOST` in Vercel and a deployed PartyKit room server.
