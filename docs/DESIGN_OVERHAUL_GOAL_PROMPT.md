# Goal: full design audit + visual overhaul of the poker game

Paste everything below the line into Claude Code (or another agent) started in
`C:\Users\samue\Coding_projects\Random\poker`.

---

## Goal

Make this multiplayer poker game look like a polished, premium product on every
screen size. Right now it looks amateur. Do a full design audit first, then
carry out the redesign end to end: desktop 3D room, tablet table, mobile 2D
table, landing page, and all HUD/overlays. Work autonomously until the
Definition of Done below is met. Don't stop after the audit.

This is a play-money game. Gameplay, multiplayer sync, reconnect/privacy
behaviour, and the existing features (run it twice, rabbit hunt, showdown
cinematic, emotes, card-reveal consent, settings, avatars, profiles/stats) must
keep working exactly as they do now. This is a visual and UX pass, not a
rules or networking change.

## Codebase facts (verified; don't rediscover from scratch)

- **Stack:** Next 15 App Router, React 19, raw `three` r184 (imperative, **no**
  react-three-fiber), Tailwind 3 (barely used), PartyKit for realtime. No
  framer-motion, no icon library, no web fonts.
- **Run locally:** `npm run dev` starts Next on :3000 and PartyKit on :1999
  (`NEXT_PUBLIC_PARTYKIT_HOST` in `.env`). Create a table on `/`, then use
  **Add bot** in the room to fill seats and play real hands.
- **Checks:** `npm test` (vitest, `tests/`), `npm run typecheck`,
  `npm run build`, `npm run smoke:e2e` (Playwright,
  `e2e/private-table-smoke.spec.ts`, needs the dev server up). `npm run check`
  runs most of them together.
- **Routes:** `app/page.tsx` (landing: create/join), `app/room/[code]/page.tsx`
  (profile gate "Take your seat", then `RoomHud` + `PokerTable`). Lobby,
  settings and avatar customisation live inside `PokerTable`.
- **Layout switching** is pure `matchMedia` in
  `components/table/PokerTable.tsx` (~L967-968):
  - `>= 1024px`: desktop 3D (`components/three/DesktopPokerRoom3D.tsx`,
    dynamically imported).
  - `769-1023px`: a DOM "tablet" table (`.table-wrapper`, `PlayerSeat.tsx`).
  - `<= 768px`: mobile 2D (`.mobile-edge-arena`, `MobileEdgeSeat`,
    `MobileHeroSeat`, the inline mobile betting panel).
- **3D scene** (`DesktopPokerRoom3D.tsx`, ~2,500 lines). Everything is
  procedural geometry except the avatars:
  - `createRoom` builds box walls, a back bar, sconces and dust particles.
  - `createPokerTable` is scaled cylinders with a 64px procedural felt texture.
  - `createLighting` has one shadow caster.
  - Rendering uses ACES tone mapping at exposure 1.22. There is no environment
    map and no postprocessing.
  - Box chairs, flat maroon box card backs, cylinder chips (`createChipSet`).
  - Six Quaternius CC0 GLB avatars in `public/models/avatars/` (~9 MB),
    loaded by `avatarAssetLoader.ts`.
  - Camera is in `cameraFraming.ts`.
  - Poses and animation: `pokerActionPose.ts`, `actionPlayback.ts`,
    `turnFocus.ts`.
  - **Community cards are DOM elements floating over the canvas**, not 3D, so
    their perspective and lighting don't match the table.
- **Shared 2D pieces:** `components/ui/PlayingCard.tsx` (CSS cards with SVG
  suits), `ChipStack.tsx`, `RoomHud.tsx`, `table/CommunityCards.tsx`,
  `OwnHand.tsx`, `PotDisplay.tsx`, `ShowdownCinematic.tsx`, `RunItTwice.tsx`.
- **Inside the 3,900-line `PokerTable.tsx`:**
  - Desktop betting tray and raise slider.
  - Social dock and emotes.
  - Settings modal (~750 lines).
  - Waiting panel.
  - Winner summary.
  - All-in announcement.
  - Rabbit hunt dock.
  - Turn timer.
- **Styling is the root cause of the mess:**
  - `app/globals.css` is ~15,400 lines of stacked "final polish pass" layers.
    It holds 262 unique hex colours, ~1,100 `rgba()` values, 77 media queries
    and 34 `!important`.
  - `app/poker-polish.css` (~5,000 lines) is layered on top with its own
    `--pn-*` tokens.
  - Tokens are duplicated three ways: `globals.css :root`,
    `poker-polish.css :root`, and `tailwind.config.ts`.
  - Fonts are Georgia plus assorted monospace fonts, and none are loaded.
- **Prior design material:**
  - `.superpowers/brainstorm/*/content/` (`visual-direction.html`,
    `three-room-focus.html`, `avatar-directions.html`).
  - `docs/superpowers/plans/`.
  - Older screenshots in `output/playwright/` (`audit-*`, `baseline-*`).

## Phase 1: Audit (evidence first)

1. Start the app and play several real hands with bots. Capture screenshots
   into `output/design-audit/before/` at:
   - 1920x1080, 1440x900, 1280x800 and 1024x768 (3D).
   - 900x1200 (tablet).
   - 430x932, 390x844 and 375x667 portrait, plus one phone landscape.
2. For each viewport, capture these states:
   - Landing page and profile gate.
   - Empty or waiting table.
   - Pre-flop with your turn active and the bet slider open.
   - Flop, turn and river.
   - All-in.
   - Showdown cinematic and winner/payout.
   - Run it twice and rabbit hunt.
   - Settings modal and avatar customisation.
   - Emote/social dock.
   - A 2-player table and a full table.
3. Write `docs/design-audit/AUDIT.md`. Rank findings by visual impact, and give
   each a screenshot reference and the responsible file or selector. Cover:
   - Hierarchy and legibility (can you instantly read pot, your cards, whose
     turn it is, the amount to call?).
   - Typography, colour and token consistency.
   - Spacing and alignment.
   - The 3D art direction (materials, lighting, geometry, camera, the DOM-cards
     mismatch, avatar fallbacks).
   - Motion and feedback (deal, bet, win, turn timer).
   - Mobile ergonomics (thumb reach, tap targets of at least 44px, safe areas,
     nothing overlapping at 375px).
   - Consistency between the three layouts.
   - Accessibility: contrast, focus states, reduced motion.
   - Performance: FPS, GLB weight, first load.
   - Anything that simply looks cheap.
4. Choose **one** art direction (for example, a modern high-stakes lounge: deep
   felt, warm brass, crisp card faces, restrained glow) and write it into the
   audit as a short design spec. It must include colour tokens, a type scale
   with chosen web fonts, spacing, radii and shadows, a motion language, and
   3D material and lighting targets. Decide it yourself, record why, and move
   on. Don't wait for approval.

## Phase 2: Foundation

- Create **one** design-token source of truth (CSS custom properties, mirrored
  in `tailwind.config.ts` if you use Tailwind), and load fonts with
  `next/font`. Map the old `--felt-*`, `--gold*`, `--navy*`, `--card-*` and
  `--pn-*` tokens onto it, then remove the duplicates.
- Collapse the stacked "final pass" CSS layers. Delete dead and overridden
  rules, and kill `!important` wars. Aim for a large net reduction in
  `globals.css` + `poker-polish.css` lines, and report before and after
  numbers.
  - Do this incrementally, verifying with screenshots as you go.
  - Don't do a blind rewrite.
  - Splitting CSS per component (CSS modules or co-located files) is fine.
- Extract HUD pieces out of `PokerTable.tsx` into their own components where
  that makes restyling cleaner:
  - Betting tray and mobile betting panel.
  - Settings modal.
  - Social dock.
  - Winner summary.
  - Waiting panel.

  Pure moves only. Keep behaviour, props and accessible names identical.

## Phase 3: Redesign

- **Desktop 3D:**
  - Add image-based lighting: use `RoomEnvironment` + `PMREMGenerator` from
    `three/examples` (no external asset needed) or a small HDRI.
  - Build a real table: a padded, beveled rail (`LatheGeometry` / extruded
    stadium shape), a proper felt texture or normal map at a sensible
    resolution, and a printed betting line or logo.
  - Softer, better shadows with a proper key/fill/rim setup.
  - Tasteful postprocessing via `three/examples` `EffectComposer` (subtle
    bloom on highlights, vignette, SMAA/FXAA). It must be optional or
    auto-disabled on weak GPUs.
  - Better chairs, chips with edge spots, and card backs with a real design.
  - Retune camera framing so the hero's cards, the board and the pot are the
    focal point.
  - Fix the community cards so they read as sitting *on* the felt: either
    render them in 3D or match the DOM overlay's perspective and lighting to
    the table. Pick one and justify it.
  - Keep avatars coherent: no primitive fallback avatar showing next to GLB
    ones in normal play.
  - Keep 60fps on a mid-range laptop. Report FPS and draw calls before and
    after.
- **Mobile 2D:** redesign it as a first-class layout, not a shrunk desktop.
  - Your hole cards and the action bar sit in the thumb zone with large targets.
  - The bet slider has quick-bet chips (½ pot, pot, all-in) that are easy to hit.
  - Seats are compact but legible, with a clear active-turn indicator and
    timer.
  - The pot and board are readable at 375px.
  - Respects `env(safe-area-inset-*)`.
  - No overlap or clipping in any state, including run it twice with two
    boards.
- **Tablet (769-1023px):** make it match the new visual system. Consider
  whether it should simply reuse the mobile or desktop 2D layout rather than
  staying a third bespoke layout. Decide and document.
- **Everywhere:**
  - Redesign playing cards (crisp faces, a readable four-colour-deck option if
    it fits the direction) and chips.
  - Unify buttons, inputs, modals, pills and toasts on the tokens.
  - Add purposeful motion: dealing, chips sliding to the pot, the win sweep,
    the turn pulse.
  - Honour `prefers-reduced-motion`.
  - Restyle the landing page and profile gate to match the table so the first
    impression is premium.

## Guardrails

- Don't change game logic, PartyKit server code, the message protocol, or
  privacy/reconnect behaviour. If a visual change seems to need one, stop
  and note it in the audit instead.
- Keep every accessible name and label the E2E uses:
  - Headings "Poker Night" and "Take your seat".
  - Buttons "Create Table", "Enter Room", "Open settings", "Copy code",
    "Close settings", "Add bot", "Send a reaction to Bot…" and
    "Search all emojis".
  - Labels "Your nickname", "Email" and "Venmo username".
- Many vitest tests grep source strings or CSS selectors, for example:
  - `tests/layout-layering.test.ts`
  - `three-room-floor-stability`
  - `three-board-cards`
  - `three-nameplate-readability`
  - `poker-table-desktop-3d-gating`

  If a redesign intentionally changes what one of these asserts, update the
  test to assert the *new intended behaviour*. Never delete a test just to go
  green, and list every test you changed with the reason.
- There's a test that bans `@react-three/fiber`, `ContactShadows` and
  `useGLTF`. Stay on raw three.js. Using `three/examples/jsm` addons is fine.
- Keep total new asset weight reasonable (target < 5 MB added). Compress any
  textures (KTX2/WebP) and models (Draco/Meshopt) you add, and only use
  assets with a licence that allows it (CC0 preferred). Record sources in
  `docs/design-audit/ASSETS.md`.
- Commit in small, logical commits on a feature branch (`design-overhaul`),
  not on `main`. Don't push or deploy.

## Loop until done

After each meaningful chunk:

1. Re-run the screenshot matrix into `output/design-audit/after/`.
2. Look at every screenshot yourself and compare it against the spec.
3. Fix anything off.
4. Run `npm test`, `npm run typecheck` and `npm run build`.

Run `npm run smoke:e2e` at the end of each phase.

## Definition of Done

- [ ] `docs/design-audit/AUDIT.md` exists, with ranked findings and the chosen
      design spec.
- [ ] One token source; fonts loaded via `next/font`; duplicate token sets
      removed; CSS line count substantially reduced (before and after
      reported).
- [ ] Desktop 3D has environment lighting, a redesigned table, cards, chips
      and chairs, board cards that read as part of the scene, and
      postprocessing with a low-end fallback. It holds ~60fps (numbers
      reported).
- [ ] Mobile has no overlap or clipping at 375x667 in any game state, tap
      targets are at least 44px, and it is safe-area aware.
- [ ] Tablet is consistent with the new system.
- [ ] Landing page, profile gate, settings, showdown, run it twice, rabbit
      hunt, emotes and winner UI are all restyled on the shared tokens.
- [ ] Text contrast meets WCAG AA, visible focus states, reduced motion
      respected.
- [ ] `npm test`, `npm run typecheck`, `npm run build` and `npm run smoke:e2e`
      all pass.
- [ ] Before and after screenshots are side by side in
      `docs/design-audit/RESULTS.md`, with a summary of what changed, every
      test modified (with reasons), and any open issues or follow-ups.
