import { expect, test, type Page } from '@playwright/test'
import {
  addBots,
  checkOrCall,
  clickStartGame,
  closeAll,
  closeSettings,
  isMyTurn,
  newPlayer,
  openSettings,
  openSettingsTab,
  snap,
  startTable,
  tableScene,
  waitForPhase,
  waitForSnapshot,
  type Player,
} from './helpers'

/**
 * Table membership end to end: kicks, host succession, two tabs, duplicate
 * names, and sitting out after missed hands. Desktop (3D) and mobile (2D)
 * clients share each table so both renderers see the seat changes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

/** Membership messages the shared RoomTap does not record. */
function tapMembership(page: Page) {
  const seen = { notices: [] as Json[], sessionEnded: null as Json }
  page.on('websocket', ws => {
    if (!ws.url().includes('/parties/')) return
    ws.on('framereceived', frame => {
      const raw = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
      try {
        const message = JSON.parse(raw)
        if (message?.type === 'notice') seen.notices.push(message)
        if (message?.type === 'session_ended') seen.sessionEnded = message
      } catch {
        // not JSON
      }
    })
  })
  return seen
}

/** Chips on the table from one client's snapshot (stacks + live pot). */
function tableChips(state: Json): number {
  const stacks = state.players.reduce((sum: number, player: Json) => sum + player.stack, 0)
  const committed = state.phase === 'in_hand'
    ? state.players.reduce((sum: number, player: Json) => sum + player.totalInPot, 0)
    : 0
  return stacks + committed
}

/** Keep the listed humans acting (check/call) until the predicate holds. */
async function playUntil(players: Player[], done: () => boolean, timeout = 90_000) {
  const deadline = Date.now() + timeout
  while (!done()) {
    if (Date.now() > deadline) throw new Error('playUntil timed out')
    for (const player of players) {
      if (await isMyTurn(player.page).catch(() => false)) {
        await checkOrCall(player).catch(() => undefined)
      }
    }
    await players[0]!.page.waitForTimeout(250)
  }
}

async function kickFromPlayersTab(host: Player, targetName: string) {
  const dialog = await openSettingsTab(host.page, 'Players')
  await dialog.getByRole('button', { name: `Kick ${targetName} from the table` }).click()
  await closeSettings(host.page)
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('kick mid-hand, rejoin with the same chips, and host hand-off when the host leaves', async ({ browser }) => {
  const players = await startTable(browser, 'Mem', ['desktop', 'mobile', 'desktop'], {
    actionTimerSeconds: 30,
    nextHandDelaySeconds: 3,
  })
  const [host, mobile, kicked] = players as [Player, Player, Player]
  const hostErrors = consoleErrors(host.page)
  const mobileErrors = consoleErrors(mobile.page)
  try {
    await addBots(host.page, 'Add bot')
    await waitForSnapshot(host, state => state.players.length === 4, 'bot seated')
    await clickStartGame(host.page)
    await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
    const chipsAtDeal = tableChips(host.tap.snapshot)
    const kickedId = kicked.tap.yourId

    // Kick the third player mid-hand, whether or not it is their turn.
    await kickFromPlayersTab(host, kicked.name)
    await expect(kicked.page.locator('.membership-ended')).toContainText('You were removed from the table')
    await snap(kicked.page, 'membership-kicked-dialog-desktop')
    await waitForSnapshot(host, state => (
      state.players.find((p: Json) => p.id === kickedId)?.status !== 'active'
    ), 'kicked player folded at once')
    expect(tableChips(host.tap.snapshot)).toBe(chipsAtDeal)

    // Finish the hand; the kicked chair empties and nobody's avatar lingers.
    await playUntil([host, mobile], () => host.tap.snapshot?.phase !== 'in_hand')
    await waitForSnapshot(host, state => !state.players.some((p: Json) => p.id === kickedId), 'kicked seat cleared', 60_000)
    await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '3')
    await expect(tableScene(mobile.page)).toHaveAttribute('data-player-count', '3')
    await snap(host.page, 'membership-after-kick-host-3d')
    await snap(mobile.page, 'membership-after-kick-mobile-2d')

    // The kicked player can come back from the dialog: to the rail, with their chips.
    kicked.tap.reset()
    await kicked.page.getByRole('button', { name: 'Rejoin table' }).click()
    await waitForSnapshot(kicked, (state, tap) => Boolean(tap.yourId) && (
      state.lobbyPlayers.some((p: Json) => p.nickname === kicked.name && p.isSpectator && p.stack > 0)
    ), 'kicked player back on the rail', 60_000)
    expect(kicked.tap.snapshot.players.some((p: Json) => p.nickname === kicked.name)).toBe(false)
    await snap(kicked.page, 'membership-kicked-rejoined-rail-desktop')

    // Host leaves: the longest-seated connected human (mobile) takes over.
    const dialog = await openSettings(host.page)
    await dialog.getByRole('button', { name: 'Leave game' }).click()
    await expect(host.page).toHaveURL(/\/$/, { timeout: 30_000 })
    await waitForSnapshot(mobile, (_state, tap) => tap.session?.isHost === true, 'mobile promoted to host')
    await expect(mobile.page.locator('.membership-notice')).toContainText('You are now the host')
    await snap(mobile.page, 'membership-new-host-notice-mobile')
    // The new host can use host controls.
    const players2 = await openSettingsTab(mobile.page, 'Players')
    await expect(players2.getByRole('button', { name: `Kick ${kicked.name} from the table` })).toBeVisible()
    await snap(mobile.page, 'membership-new-host-players-tab-mobile')
    await closeSettings(mobile.page)

    const relevant = (errors: string[]) => errors.filter(text => !/favicon|Download the React DevTools|WebGL|GPU stall/i.test(text))
    expect(relevant(hostErrors), 'host console errors').toEqual([])
    expect(relevant(mobileErrors), 'mobile console errors').toEqual([])
    expect(host.tap.pageErrors).toEqual([])
    expect(mobile.tap.pageErrors).toEqual([])
  } catch (error) {
    for (const player of players) await snap(player.page, `membership-kick-${player.name}-failure`)
    throw error
  } finally {
    await closeAll(players)
  }
})

test('a second tab takes over the seat and a duplicate nickname is turned away', async ({ browser }) => {
  const players = await startTable(browser, 'Tab', ['desktop', 'mobile'], {
    actionTimerSeconds: 30,
    nextHandDelaySeconds: 3,
  })
  const [host, guest] = players as [Player, Player]
  const extras: Player[] = []
  try {
    // Same browser profile, second tab: it reclaims the seat, the first tab steps aside.
    const secondTab = await guest.context.newPage()
    secondTab.on('dialog', d => { void d.accept() })
    await secondTab.goto(guest.page.url(), { waitUntil: 'domcontentloaded' })
    await expect(tableScene(secondTab)).toBeVisible({ timeout: 60_000 })
    await expect(guest.page.locator('.membership-ended')).toContainText('Open in another tab')
    await snap(guest.page, 'membership-replaced-tab-mobile')
    await waitForSnapshot(host, state => state.players.filter((p: Json) => p.nickname === guest.name).length === 1, 'still one seat')

    // Another device trying the same nickname while the guest is live.
    const twin = await newPlayer(browser, guest.name, 'desktop')
    extras.push(twin)
    const twinSeen = tapMembership(twin.page)
    await twin.page.goto(host.page.url(), { waitUntil: 'domcontentloaded' })
    const nickname = twin.page.getByLabel('Your nickname')
    await expect(async () => {
      await nickname.fill(guest.name)
      await twin.page.getByRole('button', { name: 'Enter Room' }).click()
      await expect(nickname).toBeHidden({ timeout: 8_000 })
    }).toPass({ timeout: 90_000 })
    await expect(twin.page.locator('.membership-ended')).toContainText('That nickname is taken', { timeout: 30_000 })
    expect(twinSeen.sessionEnded?.reason).toBe('name_taken')
    await snap(twin.page, 'membership-name-taken-desktop')
    await waitForSnapshot(host, state => (
      state.lobbyPlayers.filter((p: Json) => p.nickname.toLowerCase() === guest.name.toLowerCase()).length === 1
    ), 'no twin created')
  } catch (error) {
    for (const player of [...players, ...extras]) await snap(player.page, `membership-tabs-${player.name}-failure`)
    throw error
  } finally {
    await closeAll([...players, ...extras])
  }
})

test('a player who closes the app is sat out after missing two hands and comes back with "I\'m back"', async ({ browser }) => {
  const players = await startTable(browser, 'Away', ['desktop', 'mobile'], {
    actionTimerSeconds: 5,
    nextHandDelaySeconds: 2,
  })
  const [host, guest] = players as [Player, Player]
  try {
    await addBots(host.page, 'Add bot')
    await waitForSnapshot(host, state => state.players.length === 3, 'bot seated')
    const guestId = guest.tap.yourId
    const guestUrl = guest.page.url()
    await clickStartGame(host.page)
    await waitForPhase(host.page, 'in_hand')
    await playUntil([host, guest], () => host.tap.snapshot?.phase !== 'in_hand')
    const chipsBefore = host.tap.snapshot.players.find((p: Json) => p.id === guestId).stack

    // The guest closes the app (tab gone, socket dropped).
    await guest.page.close()
    const startHand = host.tap.snapshot.handNumber
    await playUntil([host], () => (
      host.tap.snapshot?.handNumber >= startHand + 2 && host.tap.snapshot?.phase === 'in_hand'
    ), 120_000)
    const awaySeat = host.tap.snapshot.players.find((p: Json) => p.id === guestId)
    expect(awaySeat, 'guest keeps the seat').toBeTruthy()
    expect(awaySeat.isAway).toBe(true)
    expect(awaySeat.stack).toBe(chipsBefore)
    expect(awaySeat.hasCards).toBe(false)
    await snap(host.page, 'membership-away-seat-host-3d')

    // They come back in the same browser profile: same seat, same chips, sitting out.
    const back = await guest.context.newPage()
    back.on('dialog', d => { void d.accept() })
    guest.page = back
    guest.tap.reset()
    guest.tap.attach(back)
    await back.goto(guestUrl, { waitUntil: 'domcontentloaded' })
    await expect(back.locator('.membership-sitout')).toBeVisible({ timeout: 60_000 })
    await snap(back, 'membership-sitting-out-mobile')
    expect(guest.tap.me()?.stack).toBe(chipsBefore)
    await back.getByRole('button', { name: "I'm back" }).click()
    await expect(back.locator('.membership-sitout')).toBeHidden({ timeout: 15_000 })

    const handAtReturn = host.tap.snapshot.handNumber
    await playUntil([host, guest], () => (
      host.tap.snapshot?.handNumber > handAtReturn && host.tap.snapshot?.phase === 'in_hand'
    ), 120_000)
    await waitForSnapshot(host, state => state.players.find((p: Json) => p.id === guestId)?.hasCards === true, 'guest dealt back in')
  } catch (error) {
    for (const player of players) await snap(player.page, `membership-away-${player.name}-failure`)
    throw error
  } finally {
    await closeAll(players)
  }
})
