# Desktop 3D Poker UI Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop visual table with the existing 3D poker-room scene while preserving this app's real PartyKit poker logic, cards, pot, and action controls.

**Architecture:** Port the standalone `C:\Users\samue\Coding_projects\3d` React Three scene into this Next app as desktop-only client components. Add a small mapper that converts live `TableState` plus `yourId` into a 3D view model. Render the 3D canvas behind the current room/card/action UI on desktop; keep the existing mobile UI unchanged.

**Tech Stack:** Next.js 14, React 18, PartyKit, TypeScript, Vitest, Three.js, `@react-three/fiber`, `@react-three/drei`.

---

### Task 1: Live State To 3D View Model

**Files:**
- Create: `components/three/tableViewModel.ts`
- Test: `tests/three-table-view-model.test.ts`

- [ ] **Step 1: Write the failing mapper tests**

```ts
import { describe, expect, it } from 'vitest'
import { createThreeTableViewModel } from '@/components/three/tableViewModel'
import type { SeatPlayer, TableState } from '@/lib/poker/types'

function player(overrides: Partial<SeatPlayer>): SeatPlayer {
  return {
    id: 'p1',
    nickname: 'Player',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    ...overrides,
  }
}

function table(overrides: Partial<TableState>): TableState {
  return {
    roomCode: '123',
    phase: 'in_hand',
    serverNow: 1,
    round: 'flop',
    players: [],
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: true,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
    ...overrides,
  }
}

describe('createThreeTableViewModel', () => {
  it('keeps the current player at hero seat and rotates opponents around them', () => {
    const state = table({
      players: [
        player({ id: 'hero', nickname: 'Hero', seatIndex: 5 }),
        player({ id: 'left', nickname: 'Left', seatIndex: 6 }),
        player({ id: 'across', nickname: 'Across', seatIndex: 1 }),
      ],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.hero?.id).toBe('hero')
    expect(view.players.map(player => [player.id, player.visualSeat])).toEqual([
      ['hero', 0],
      ['left', 1],
      ['across', 4],
    ])
  })

  it('derives action cue from the latest hero action', () => {
    const state = table({
      players: [
        player({ id: 'hero', lastAction: 'Raised $120', bet: 120 }),
      ],
      recentActions: ['Hero raised to $120'],
    })

    const view = createThreeTableViewModel(state, 'hero')

    expect(view.actionCue).toBe('raise')
    expect(view.actionKey).toContain('hero:Raised $120:120')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/three-table-view-model.test.ts`
Expected: FAIL because `components/three/tableViewModel` does not exist.

- [ ] **Step 3: Implement the mapper**

Create typed `ThreeTableViewModel`, `ThreePlayerView`, `ThreeCardView`, and `createThreeTableViewModel`.

- [ ] **Step 4: Run mapper test**

Run: `npm test -- tests/three-table-view-model.test.ts`
Expected: PASS.

### Task 2: Port Desktop 3D Scene

**Files:**
- Create: `components/three/DesktopPokerRoom3D.tsx`
- Create: `components/three/pokerActionPose.ts`
- Modify: `app/globals.css`
- Modify: `package.json`

- [ ] **Step 1: Install compatible Three dependencies**

Run: `npm install three @react-three/fiber@8 @react-three/drei@9`
Expected: package install succeeds and lockfile updates.

- [ ] **Step 2: Port animation helpers**

Copy the tested action-pose math from `C:\Users\samue\Coding_projects\3d\src\animation\pokerActionPose.ts`, changing imports to local `tableViewModel` types.

- [ ] **Step 3: Port the scene as desktop-only client UI**

Create `DesktopPokerRoom3D.tsx` with a fullscreen `<Canvas>` and a scene that consumes `ThreeTableViewModel`. Use 3D room/table/chair/avatar/chip elements from the 3D project, but do not port fake reducer state.

- [ ] **Step 4: Add scoped CSS**

Add `.desktop-3d-stage`, `.desktop-3d-canvas`, `.three-table-card`, and responsive desktop-only rules. Hide this layer at `max-width: 1099px`.

### Task 3: Integrate With The Live Poker Table

**Files:**
- Modify: `components/table/PokerTable.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Render 3D layer before the current table stage**

Inside `PokerTable`, compute `const threeView = createThreeTableViewModel(state, yourId)` and render `<DesktopPokerRoom3D view={threeView} />` before `.table-stage`.

- [ ] **Step 2: Desktop CSS handoff**

For `min-width: 1100px`, let the 3D canvas own the room/table/player visuals while current cards, pot, HUD, and action controls remain readable above it.

### Task 4: Verify

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/three-table-view-model.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Start desktop local app and capture screenshots**

Run Next and PartyKit locally, open a desktop viewport, and verify the canvas is nonblank with the current cards/pot/action controls still visible. Mobile should continue using the existing non-3D table.
