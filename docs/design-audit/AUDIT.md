# Poker Night design audit (2026-09-26)

## How this audit was run

- Screenshots come from `scripts/design-capture.mjs`, which plays real hands
  against bots at nine viewports and captures every phase. They're saved to
  `output/design-audit/before/<viewport>/`.
- Viewports: 1920×1080, 1440×900, 1280×800, 1024×768, 900×1200, 430×932,
  390×844, 375×667 and 844×390 (phone landscape).
- States captured: landing, profile gate, empty and full waiting table,
  settings, hero turn, preflop/flop/turn/river, the showdown stages, and the
  social dock.
- Code reviewed: `DesktopPokerRoom3D.tsx`, `pokerActionPose.ts`,
  `avatarAssetLoader.ts`, `PokerTable.tsx`, both global stylesheets and the
  source-string tests.

Findings are ranked by visual impact. **P0** means it makes the game look
broken or amateur. **P1** hurts quality. **P2** is polish.

## P0: looks broken

| # | Finding | Evidence | Source |
|---|---------|----------|--------|
| 1 | **Mobile has no table.** Seats are small text labels floating on flat black, the pot floats in the middle, and nothing reads as a poker table. The waiting screen shows 8 names in a void. | `phone-390/04-waiting-full`, `phone-430/06-hero-turn` | `.mobile-edge-arena` in `globals.css` / `poker-polish.css` |
| 2 | **Tablet (769–1023px) is broken.** The table is shoved into the left half and clipped. Seats overlap each other and the board, the hero's cards overlap seats, and half the screen is empty. | `tablet-900/10-phase-flop` | `.table-wrapper` tablet bridge in `poker-polish.css` |
| 3 | **3D board cards are flat HTML pasted over the canvas.** They have no perspective or shadow, and they sit over a translucent box that reads as a UI panel rather than the felt. | `desktop-1440/10-phase-flop` | `CommunityCards` fixed overlay; `boardPlinth` in `createPokerTable` |
| 4 | **Desktop nameplates are pinned by CSS percentages, not attached to the avatars.** They cover faces (seat 4 plate over the back wall, seat 1 over the chair), names truncate to "B…" when a blind badge shows, and edge seats are cropped by the viewport. Because the plates are fixed, the camera can never move. | `desktop-1440/06-hero-turn` | `.cinematic-seat-N` rules; camera lock in `animate()` |
| 5 | **Muddy 3D lighting.** No environment map, heavy emissive fill on every material, and fog crushes the room to green-black. Brass has nothing to reflect, so it reads as flat mustard. | All desktop shots | `createLighting`, `createStandardMaterial` emissive usage |

## P1: hurts quality

| # | Finding | Evidence | Source |
|---|---------|----------|--------|
| 6 | The table is scaled cylinders: no padded rail, no bevel, a flat unprinted felt and a 64px noise texture. The pedestal is invisible. | Desktop shots | `createPokerTable` |
| 7 | Opponent hole cards are large flat maroon slabs with a ring decal, far bigger than real cards next to the avatars. Chips are tiny single discs in a grid. | `desktop-1440/06-hero-turn` | `createSeatRuntime` card meshes, `createChipSet` |
| 8 | **Avatar animation is stiff.** A standing idle clip is bent into a seated pose. Arms clip into the rail, there's no card peeking, thinking, glancing or breathing beyond a sine bob, and there's no stand-up win celebration. Action clips (`Interact`) are generic and fold uses `HitRecieve` (a flinch). | Code review | `animateSeat`, `playAvatarOneShot` |
| 9 | Chairs are boxes with a flat back, and the chair backs occlude the edge avatars. | Desktop shots | `createSeatRuntime` |
| 10 | Showdown collides: the "Pot awarded" banner stacks over the pot pill ("$1 440" is half hidden), a chip icon floats over the hero's cards, and the card-visibility control is low contrast. The winner has no in-scene celebration beyond a faint halo. | `desktop-1440/10-phase-showdown-payout` | `ShowdownCinematic`, `.table-hand-result-*` |
| 11 | **Typography.** No web fonts load. Georgia serif, Trebuchet, Courier and system sans all appear on one screen, and numbers aren't tabular, so the pot jitters as it counts. | All | `globals.css` body, `.room-shell` |
| 12 | **Token chaos.** 262 hex colours plus 88 in the polish file, three token systems (`--felt-*`, `--pn-*`, Tailwind), ~1,100 `rgba()` literals and 34 `!important`. | Code | `globals.css`, `poker-polish.css` |
| 13 | **Mobile action bar.** Three equal buttons, with Fold as large as Call. The Next.js dev badge sits on Fold (dev only). The raise quick-bets are small (≈40px), and seat numbers ("1", "2"…) are noise. | `phone-430/06-hero-turn` | Mobile betting panel |
| 14 | **Landing page.** The "table preview" is a CSS blob with overlapping cards and pot, and it's positioned below the fold. The Create/Join tabs and the panel read as two stacked boxes, and the input focus ring is a double gold border. | `desktop-1440/01-landing` | `app/page.tsx`, `.landing-*` |

## P2: polish

- The waiting-state glass card ("Ready for the next hand") sits over the
  board with low-contrast body text, and the pill chips inside are
  unreadable.
- The Settings modal is a long scroll of same-weight cards. The title is
  bold but section labels are tiny all-caps.
- There's no hover or pressed feedback on the desktop action buttons beyond
  a colour change. Fold/Call/Raise/All-in all have equal weight.
- The dust particle field and the rotating floor and ceiling rings are
  invisible at normal exposure, so they cost draw time without adding
  anything.
- The turn timer is a thin bar in the tray header, and opponents' timers
  aren't visible on desktop.

## Accessibility and performance notes

- Contrast failures: muted text on the dark glass panels is about 3:1 (for
  example the "CALLED $20" meta, the landing chips and the settings
  descriptions).
- Focus: the global styles have no visible focus ring (only the default
  outline on some buttons).
- Reduced motion: the 3D scene honours it. CSS keyframes mostly don't.
- Performance: headless capture shows ~42–60fps at 1440–1920 with software
  GL. There are 6 GLB avatars (~9 MB), no instancing for chips, and one
  shadow-casting spotlight at 1536px.

## Chosen art direction: "After-Hours Lounge" (stylized, game-like)

The owner asked for **stylized, not realistic, but very good**, with great
avatar animation and fun, juicy feedback. The Quaternius avatars are flat
shaded and low poly, so the whole scene moves toward a clean, toy-like,
lit-from-above look:

- Bold shapes and saturated but controlled colour.
- Warm key light on the table, the room falling off into darkness, and cool
  rim light to separate characters.
- Soft contact shadows and bloom only on things that should glow (brass,
  winner, all-in).

### Colour tokens (`app/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--c-ink-950` / `900` / `800` / `700` / `600` | `#05090a` `#0a1112` `#101a1b` `#172426` `#213134` | Backgrounds and panel stack |
| `--c-felt-700` / `500` / `300` | `#0b5e47` `#12916b` `#39c795` | Felt, success, call |
| `--c-brass-500` / `400` / `200` | `#d9a441` `#f2c766` `#ffe7ad` | Primary accent, bet, highlights |
| `--c-ember-500` | `#ff7a3d` | All-in, heat |
| `--c-ruby-500` | `#e2505c` | Fold, danger, red suits |
| `--c-sky-400` | `#7fd0ff` | Focus ring, info, turn indicator |
| `--c-cream-50` | `#fff8ea` | Card faces, strongest text |
| `--c-text-1` / `2` / `3` | `#f4efe4` `#bdc6c1` `#8a9792` | Text hierarchy (all ≥ 4.5:1 on ink-800) |

### Typography

- **Display: Unbounded** (600/700), loaded with `next/font`. Used for the
  pot, titles, action labels and big numbers. It's chunky and game-like.
- **UI: Plus Jakarta Sans** (500–800). Used for everything else.
- Every number uses `font-variant-numeric: tabular-nums`.
- Type scale: 11 / 12 / 14 / 16 / 20 / 24 / 32 / 44 / 64.

### Spacing, radii, elevation and motion

- **Spacing:** a 4px base (`--sp-1`…`--sp-8` = 4, 8, 12, 16, 20, 24, 32, 48).
- **Radii:** `--r-sm` 8, `--r-md` 12, `--r-lg` 18, `--r-xl` 26, `--r-pill` 999.
- **Elevation:** `--shadow-1` is a hairline plus 8px, `--shadow-2` a 24px
  float, `--shadow-3` a 48px modal, and `--glow-brass` / `--glow-felt` /
  `--glow-ember` are coloured glows for emphasis.
- **Motion:**
  - Durations: `--dur-fast` 120ms, `--dur-base` 220ms, `--dur-slow` 420ms.
  - Easings: `--ease-out` cubic-bezier(.2,.8,.2,1) and `--ease-pop`
    cubic-bezier(.34,1.56,.64,1).
  - Rule: things *arrive* with a pop, *leave* quickly, and big moments
    (all-in, win) get a beat of anticipation first.
  - `prefers-reduced-motion` turns movement into opacity-only transitions.

### 3D targets

- **Lighting:**
  - `RoomEnvironment` IBL through PMREM at low intensity.
  - One warm key spot over the table with soft shadows.
  - A cool rim from behind the far seats.
  - Minimal emissive fill; darkness comes from light falloff, not from
    painting materials black.
- **Table:**
  - A lathe/extruded stadium rail with a padded leather profile, plus a brass
    inlay strip.
  - Felt from a 1024px canvas texture: vignette, printed "POKER NIGHT" crest,
    betting line and community-card guides.
  - A visible wooden apron and pedestal.
- **Cards:** real proportions (63×88), rounded corners and canvas faces
  (rank and suit) with a designed back. Board cards are **true 3D meshes lying
  on the felt**, with a flip reveal. The DOM board is kept for accessibility
  but visually hidden on desktop.
- **Chips:** shared geometry, a canvas edge-spot texture and denominated
  colours, stacked in columns.
- **Characters:**
  - Seated pose built by the procedural layer: hips down, forearms on the
    rail.
  - Idle life: breathing, weight shifts, glances at whoever is acting, and
    card peeks.
  - Thinking pose (hand to chin) while they're the actor.
  - Personality-specific wins: arms-up cheer, fist pump or slow clap.
  - Losses: head shake and slump.
  - Everything is blended with critically damped springs so no pose ever
    snaps.
- **Camera:**
  - A gentle breathing drift.
  - Punch-in on all-ins.
  - A slow push toward the winner at showdown.
  - Nameplates follow their avatar through per-frame screen projection, so
    the camera is free to move.
- **Post:**
  - `EffectComposer` with bloom (threshold high, gold and winner only), a
    vignette and an output pass.
  - Auto-disables if the frame time stays above 22ms.

### 2D targets (mobile + tablet)

- One responsive 2D table for every width under 1024px.
- A drawn felt stadium table with rail and crest.
- Seats as avatar pucks with stack, action chip and timer ring.
- The board and pot centred on the felt.
- The hero's cards large in the thumb zone.
- An action bar weighted Call > Raise > Fold, with a quick-bet row of at least
  44px targets.
- Safe-area insets respected.

## Decision on the tablet layout

The 769–1023px bespoke table is removed. That width band now uses the
redesigned 2D table, which scales up cleanly, because a third layout doubled
the CSS surface and was the most broken screen in the audit.
