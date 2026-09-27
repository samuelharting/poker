import { devices, expect, test, type Browser, type Page } from '@playwright/test'
import {
  addBots,
  clickStartGame,
  closeAll,
  closeSettings,
  createTable,
  fillHydrated,
  newPlayer,
  openSettingsTab,
  RoomTap,
  snap,
  tableScene,
  visible,
  waitForPhase,
  waitForSnapshot,
  type Player,
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

/** A phone on the rail: the real iPhone 13 profile (touch, mobile UA), in Chromium. */
async function newIphonePlayer(browser: Browser, name: string): Promise<Player> {
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13']
  const context = await browser.newContext({ ...iphone, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('dialog', dialog => { void dialog.accept() })
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal { display: none !important; }'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })
  const tap = new RoomTap()
  tap.attach(page)
  page.on('pageerror', error => tap.pageErrors.push(String(error?.message ?? error)))
  return { name, viewport: 'mobile', context, page, tap }
}

function lobbyEntry(player: Player, name: string): Json {
  return player.tap.snapshot?.lobbyPlayers?.find((entry: Json) => entry.nickname === name)
}

/** "Enter Room" at a table that is already full: they land on the rail. */
async function joinFullTable(player: Player, roomUrl: string) {
  const { page, name } = player
  await page.goto(roomUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Take your seat' })).toBeVisible({ timeout: 60_000 })
  const nickname = page.getByLabel('Your nickname')
  await expect(async () => {
    await fillHydrated(nickname, name)
    await page.getByRole('button', { name: 'Enter Room' }).click()
    await expect(nickname).toBeHidden({ timeout: 8_000 })
  }).toPass({ timeout: 90_000 })
  await expect(tableScene(page)).toBeVisible({ timeout: 60_000 })
  await waitForSnapshot(player, () => lobbyEntry(player, name)?.isSpectator === true, 'lands on the rail')
}

/** Every hole card a seated player's socket received for someone else mid-hand. */
function watchForLeaks(player: Player) {
  const leaks: string[] = []
  const timer = setInterval(() => {
    const state = player.tap.snapshot
    if (!state || state.phase !== 'in_hand' || state.handOdds?.mode === 'all_in') return
    for (const seat of state.players ?? []) {
      if (seat.id !== player.tap.yourId && seat.holeCards?.length) leaks.push(`${seat.nickname} hand ${state.handNumber}`)
    }
  }, 50)
  return { leaks, stop: () => clearInterval(timer) }
}

async function railControls(page: Page) {
  return {
    actions: await visible(page.locator('[data-action]')).count(),
    drinks: await visible(page.getByRole('button', { name: /^Beer|Crack a beer/ })).count(),
  }
}

test('a full table: desktop and iPhone spectators watch every hand with the hole-card cam and odds, react, and reconnect', async ({ browser }) => {
  test.setTimeout(240_000)
  const host = await newPlayer(browser, 'RailHostD', 'desktop')
  const railD = await newPlayer(browser, 'RailWatchD', 'desktop')
  const railM = await newIphonePlayer(browser, 'RailWatchM')
  const everyone = [host, railD, railM]
  try {
    const { roomUrl } = await createTable(host)
    await addBots(host.page, 'Fill seats')
    await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '8', { timeout: 30_000 })

    await joinFullTable(railD, roomUrl)
    await joinFullTable(railM, roomUrl)
    expect(railD.tap.results.join(' ')).toMatch(/Table is full/)
    for (const rail of [railD, railM]) {
      expect(rail.tap.me()).toBeUndefined()
      expect(lobbyEntry(rail, rail.name).stack).toBeGreaterThan(0)
    }

    // A clear watching state; no Take seat while every chair is taken.
    const watchBar = railD.page.locator('.spectator-watch-bar')
    await expect(watchBar).toBeVisible()
    await expect(watchBar).toContainText('Table is full')
    await expect(watchBar.getByRole('button', { name: 'Take seat' })).toHaveCount(0)
    await expect(railM.page.locator('.mobile-between-hands-dock')).toContainText('Watching')
    await expect(visible(railM.page.getByRole('button', { name: 'Take seat' }))).toHaveCount(0)
    await snap(railD.page, 'spectator-desktop-full-table-waiting')
    await snap(railM.page, 'spectator-iphone-full-table-waiting')

    const leakWatch = watchForLeaks(host)
    await clickStartGame(host.page)
    await Promise.all(everyone.map(player => waitForPhase(player.page, 'in_hand')))

    // Hole-card cam: every live hand and the odds, but no seat, tray or drinks.
    for (const rail of [railD, railM]) {
      await waitForSnapshot(rail, state => state.handOdds?.mode === 'spectator', 'spectator odds')
      const state = rail.tap.snapshot
      expect(state.players.map((seat: Json) => seat.id)).not.toContain(rail.tap.yourId)
      expect(state.actingPlayerId).not.toBe(rail.tap.yourId)
      expect(state.players.filter((seat: Json) => seat.status === 'active').every((seat: Json) => seat.holeCards?.length === 2)).toBe(true)
      expect(await railControls(rail.page)).toEqual({ actions: 0, drinks: 0 })
    }
    await expect(railD.page.locator('.hand-odds-panel[data-hand-odds="spectator"]')).toBeVisible()
    await expect(watchBar).toBeVisible()
    await expect(railM.page.locator('.mobile-hero-seat')).toHaveCount(0)
    await expect(railM.page.locator('.mobile-edge-seat')).toHaveCount(8)
    await expect.poll(() => railM.page.locator('.mobile-seat-odds').count()).toBeGreaterThan(1)
    await snap(railD.page, 'spectator-desktop-in-hand')
    await snap(railM.page, 'spectator-iphone-in-hand')

    // The iPhone rail throws a reaction at the host; the host's table shows it.
    await visible(railM.page.getByRole('button', { name: `Target ${host.name} for emojis` })).first().click()
    const panel = railM.page.getByRole('dialog', { name: `Message or react to ${host.name}` })
    await expect(panel).toBeVisible()
    await visible(panel.getByRole('button', { name: new RegExp(`^Send .+ to ${host.name}$`) })).first().click()
    await waitForSnapshot(host, (_, tap) => (tap.social?.active ?? []).some((entry: Json) => (
      entry.playerId === railM.tap.yourId && entry.targetPlayerId === host.tap.yourId && entry.emote
    )), 'rail emote reaches the host')
    expect(railM.tap.failures).toEqual([])
    await snap(host.page, 'spectator-emote-seen-by-host')

    // Reload on the phone: still on the rail, still watching the live hands.
    railM.tap.reset()
    await railM.page.reload({ waitUntil: 'domcontentloaded' })
    await expect(tableScene(railM.page)).toBeVisible({ timeout: 60_000 })
    await waitForSnapshot(railM, () => lobbyEntry(railM, railM.name)?.isSpectator === true, 'still a spectator after reload')
    expect(railM.tap.me()).toBeUndefined()
    await snap(railM.page, 'spectator-iphone-after-reload')

    // Let the hand finish: the host folds whenever the action reaches them.
    await expect(async () => {
      const fold = visible(host.page.locator('[data-action="fold"]'))
      if (await fold.count()) await fold.first().click().catch(() => undefined)
      expect(host.tap.snapshot.phase).not.toBe('in_hand')
    }).toPass({ timeout: 120_000, intervals: [500] })
    leakWatch.stop()
    expect(leakWatch.leaks, 'seated players never see live hands').toEqual([])
    for (const player of everyone) expect(player.tap.pageErrors).toEqual([])
  } finally {
    await closeAll(everyone)
  }
})

test('from the rail to a seat and back: take a free seat for the next hand, then stand up after it', async ({ browser }) => {
  test.setTimeout(300_000)
  const host = await newPlayer(browser, 'SeatHostD', 'desktop')
  const rail = await newPlayer(browser, 'SeatRailD', 'desktop')
  const everyone = [host, rail]
  try {
    const { roomUrl } = await createTable(host)
    await addBots(host.page, 'Fill seats')
    await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '8', { timeout: 30_000 })
    await joinFullTable(rail, roomUrl)
    await clickStartGame(host.page)
    await waitForPhase(host.page, 'in_hand')

    // The host benches a bot mid-hand: the chair frees up once the hand ends.
    const bot = host.tap.snapshot.players.find((seat: Json) => seat.isBot)
    const players = await openSettingsTab(host.page, 'Players')
    await players.getByRole('button', { name: `Move ${bot.nickname} to spectator mode` }).click()
    await closeSettings(host.page)

    const takeSeat = rail.page.locator('.spectator-watch-bar').getByRole('button', { name: 'Take seat' })
    await expect(takeSeat).toBeVisible({ timeout: 90_000 })
    await snap(rail.page, 'spectator-desktop-seat-free')
    const handWhenSeated = rail.tap.snapshot.handNumber
    await takeSeat.click()
    await waitForSnapshot(rail, (_, tap) => Boolean(tap.me()), 'rail took the seat')
    await expect(rail.page.locator('.spectator-watch-bar')).toHaveCount(0)
    // Dealt in from the next hand, never into one already running.
    await waitForSnapshot(rail, (state, tap) => (
      state.phase === 'in_hand' && state.handNumber > handWhenSeated && tap.me()?.holeCards?.length === 2
    ), 'dealt in next hand', 120_000)
    await snap(rail.page, 'spectator-seated-playing')

    // Stand up without folding: finish this hand, then back to the rail.
    const standUp = await openSettingsTab(rail.page, 'Players')
    await standUp.getByRole('button', { name: 'Stand up and watch' }).click()
    await closeSettings(rail.page)
    const standHand = rail.tap.snapshot.handNumber
    if (rail.tap.snapshot.phase === 'in_hand') {
      expect(rail.tap.me()?.status === 'folded').toBe(false)
    }
    await waitForSnapshot(rail, (state, tap) => (
      !tap.me() && lobbyEntry(rail, rail.name)?.isSpectator === true && state.handNumber >= standHand
    ), 'back on the rail after the hand', 120_000)
    await expect(rail.page.locator('.spectator-watch-bar')).toBeVisible()
    await snap(rail.page, 'spectator-back-on-rail')
    for (const player of everyone) expect(player.tap.pageErrors).toEqual([])
  } finally {
    await closeAll(everyone)
  }
})
