import { expect, test, type Page } from '@playwright/test'
import {
  actionButton,
  clickStartGame,
  closeAll,
  closeSettings,
  goAllIn,
  joinTable,
  newPlayer,
  openSettingsTab,
  recordAttribute,
  recordedAttribute,
  snap,
  startTable,
  waitForPhase,
  waitForSnapshot,
  waitForTurn,
  type Player,
} from './helpers'

/** Every board size and river win % the broadcast odds showed this client. */
async function recordOdds(page: Page) {
  await page.evaluate(() => {
    const store = { boards: [] as string[], river: [] as string[], pills: 0 }
    ;(window as unknown as { __qaOdds?: typeof store }).__qaOdds = store
    const read = () => {
      const panel = document.querySelector('.hand-odds-panel')
      const board = panel?.getAttribute('data-board-count')
        ?? (document.querySelector('.odds-pill') ? 'pill' : null)
      if (board && store.boards[store.boards.length - 1] !== board) store.boards.push(board)
      store.pills = Math.max(store.pills, document.querySelectorAll('.odds-pill').length)
      if (board === '5') {
        store.river = Array.from(document.querySelectorAll('.hand-odds-row'))
          .map(row => row.getAttribute('data-odds-win') ?? '')
      }
    }
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true })
    read()
  })
}

/** Every broadcast-odds street this client's socket received (streets move faster than polling screenshots). */
function recordSnapshotOdds(player: Player) {
  const seen: Array<{ board: number; mode: string; wins: number[] }> = []
  const timer = setInterval(() => {
    const odds = player.tap.snapshot?.handOdds
    if (!odds) return
    const last = seen[seen.length - 1]
    if (last && last.board === odds.boardCount && last.mode === odds.mode) return
    seen.push({
      board: odds.boardCount,
      mode: odds.mode,
      wins: odds.players.map((row: { winPercent: number }) => row.winPercent),
    })
  }, 40)
  return { seen, stop: () => clearInterval(timer) }
}

async function recordedOdds(page: Page) {
  return page.evaluate(() => (window as unknown as { __qaOdds?: { boards: string[]; river: string[]; pills: number } }).__qaOdds!)
}

test('heads-up all-in: every seat and the rail watch TV odds street by street, ending 100 / 0', async ({ browser }) => {
  const players = await startTable(browser, 'Odds', ['desktop', 'mobile'], {
    actionTimerSeconds: 60,
    nextHandDelaySeconds: 30,
  })
  const [host, guest] = players as [Player, Player]
  const rail = await newPlayer(browser, 'OddsRailD', 'desktop')
  const everyone = [host, guest, rail]
  try {
    const { roomUrl } = { roomUrl: host.page.url() }
    await joinTable(rail, roomUrl)
    const dialog = await openSettingsTab(host.page, 'Players')
    await dialog.getByRole('button', { name: `Move ${rail.name} to spectator mode` }).click()
    await waitForSnapshot(host, state => state.lobbyPlayers.some((player: { nickname: string; isSpectator: boolean }) => (
      player.nickname === rail.name && player.isSpectator
    )), 'rail moved to spectators')
    await closeSettings(host.page)

    for (const player of everyone) await recordOdds(player.page)
    await clickStartGame(host.page)
    await Promise.all(everyone.map(player => waitForPhase(player.page, 'in_hand')))

    // The rail's hole-card cam: live odds before anyone is all-in.
    await expect(rail.page.locator('.hand-odds-panel[data-hand-odds="spectator"]')).toBeVisible()
    await expect(rail.page.locator('.cinematic-odds-pill')).toHaveCount(2)
    await snap(rail.page, 'odds-spectator-preflop-desktop')
    // Seated players see no odds while betting is open.
    await expect(host.page.locator('.hand-odds-panel')).toHaveCount(0)
    await expect(guest.page.locator('.odds-pill')).toHaveCount(0)

    const shover = await waitForTurn([host, guest])
    const caller = shover === host ? guest : host
    await goAllIn(shover)
    await waitForSnapshot(caller, (_, tap) => tap.player(shover.tap.yourId)?.status === 'all_in', 'shove registered')
    // Still open: nobody's cards or odds leak to the caller.
    expect(caller.tap.snapshot.handOdds).toBeUndefined()
    expect(caller.tap.player(shover.tap.yourId)?.holeCards).toBeUndefined()
    await expect(actionButton(caller.page, 'call')).toBeVisible()
    await actionButton(caller.page, 'call').click()

    // Action closed: both hands are tabled and the odds are up for everyone.
    for (const player of everyone) {
      await waitForSnapshot(player, state => state.handOdds?.mode === 'all_in', 'all-in odds arrive')
      expect(player.tap.snapshot.players.every((seat: { holeCards?: unknown[] }) => seat.holeCards?.length === 2)).toBe(true)
    }
    await expect(host.page.locator('.hand-odds-panel[data-hand-odds="all_in"]')).toBeVisible()
    await expect(guest.page.locator('.mobile-seat-odds')).toHaveCount(1)
    await expect(guest.page.locator('.mobile-hero-odds')).toHaveCount(1)
    await snap(host.page, 'odds-all-in-tabled-desktop')
    await snap(guest.page, 'odds-all-in-tabled-mobile')

    const recorders = everyone.map(recordSnapshotOdds)
    const vote = shover.page.getByRole('dialog', { name: 'Run it twice?' })
    if (await vote.isVisible().catch(() => false)) {
      await vote.getByRole('button', { name: 'Once' }).click()
    }

    await waitForSnapshot(host, state => state.handOdds?.boardCount === 3, 'flop odds', 30_000)
    await snap(host.page, 'odds-flop-desktop')
    await snap(guest.page, 'odds-flop-mobile')
    await waitForSnapshot(host, state => (state.handOdds?.boardCount ?? 0) >= 4, 'turn odds', 30_000)
    await snap(rail.page, 'odds-turn-spectator-desktop')
    await waitForSnapshot(host, state => state.handOdds?.boardCount === 5 || state.phase !== 'in_hand', 'river odds', 30_000)
    await snap(host.page, 'odds-river-desktop')
    await snap(guest.page, 'odds-river-mobile')

    await Promise.all(everyone.map(player => waitForPhase(player.page, 'between_hands', 30_000)))
    recorders.forEach(recorder => recorder.stop())
    for (const recorder of recorders) {
      // Every client got the same street-by-street sequence, all in all-in mode.
      expect(recorder.seen.map(entry => entry.board)).toEqual(expect.arrayContaining([3, 4, 5]))
      expect(recorder.seen.every(entry => entry.mode === 'all_in')).toBe(true)
      const riverWins = recorder.seen.find(entry => entry.board === 5)!.wins.sort((a, b) => b - a)
      expect([[100, 0], [0, 0]]).toContainEqual(riverWins)
    }
    // The desktop panel itself walked through every street in order.
    const hostOdds = await recordedOdds(host.page)
    const boardOrder = hostOdds.boards.filter(board => ['0', '3', '4', '5'].includes(board))
    expect(boardOrder).toEqual(['0', '3', '4', '5'])
    const river = hostOdds.river.map(Number).sort((a, b) => b - a)
    expect([[100, 0], [0, 0]]).toContainEqual(river)
    const guestOdds = await recordedOdds(guest.page)
    expect(guestOdds.pills).toBeGreaterThanOrEqual(2)
    expect((await recordedOdds(rail.page)).boards).toEqual(expect.arrayContaining(['3', '4', '5']))

    // The odds clear once the hand is over.
    await expect(host.page.locator('.hand-odds-panel')).toHaveCount(0)
    for (const player of everyone) {
      expect(player.tap.pageErrors).toEqual([])
    }
  } finally {
    await closeAll(everyone)
  }
})
