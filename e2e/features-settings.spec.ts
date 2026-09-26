import { expect, test } from '@playwright/test'
import {
  addBots,
  appUrl,
  closeAll,
  closeSettings,
  createTable,
  fillHydrated,
  joinByCode,
  newPlayer,
  openSettings,
  openSettingsTab,
  otherViewport,
  ruleRow,
  saveTableSettings,
  snap,
  tableScene,
  visible,
  waitForSnapshot,
  type Player,
  type ViewportName,
} from './helpers'

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test.describe(`settings and room controls (${viewport})`, () => {
    test('room actions, card colors, sound, game setup, rules and outfit', async ({ browser }) => {
      const host = await newPlayer(browser, `Set${viewport === 'desktop' ? 'Desk' : 'Mob'}`, viewport)
      const players: Player[] = [host]
      try {
        // Capture Web Share calls instead of opening a native share sheet.
        await host.page.addInitScript(() => {
          Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (data: unknown) => {
              (window as unknown as { __qaShare?: unknown }).__qaShare = data
            },
          })
        })
        const { roomCode, roomUrl } = await createTable(host)
        const page = host.page

        // Room actions: copy code + share link.
        const menu = await openSettings(page)
        await expect(menu.getByText(`Room code: ${roomCode}`)).toBeVisible()
        await menu.getByRole('button', { name: 'Copy code' }).click()
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(roomCode)
        await menu.getByRole('button', { name: 'Share link' }).click()
        await expect.poll(() => page.evaluate(() => (
          (window as unknown as { __qaShare?: { url?: string } }).__qaShare?.url ?? ''
        ))).toBe(roomUrl)

        // Cards: 2-color / 4-color suits.
        await menu.getByRole('button', { name: '4-color suits' }).click()
        await expect(tableScene(page)).toHaveAttribute('data-suit-colors', 'four')
        await expect(menu.getByRole('button', { name: '4-color suits' })).toHaveAttribute('aria-pressed', 'true')
        await menu.getByRole('button', { name: '2-color suits' }).click()
        await expect(tableScene(page)).toHaveAttribute('data-suit-colors', 'two')

        // Soundscape: mute / sound on / volume + the HUD mute toggle stays in sync.
        await menu.getByRole('button', { name: 'Muted', exact: true }).click()
        await expect(menu.getByRole('button', { name: 'Muted', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(visible(page.getByRole('button', { name: 'Unmute table sounds' })).first()).toBeVisible()
        await menu.getByRole('button', { name: 'Sound on' }).click()
        await expect(menu.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'true')
        await menu.getByLabel('Table sound volume').fill('30')
        await expect(menu.getByText('Volume 30%')).toBeVisible()
        await closeSettings(page)
        await visible(page.getByRole('button', { name: 'Mute table sounds' })).first().click()
        await expect(visible(page.getByRole('button', { name: 'Unmute table sounds' })).first()).toBeVisible()
        await visible(page.getByRole('button', { name: 'Unmute table sounds' })).first().click()
        await expect(visible(page.getByRole('button', { name: 'Mute table sounds' })).first()).toBeVisible()

        // Game setup: raise the blinds, buy-in, timers and both house rules.
        await saveTableSettings(page, {
          smallBlind: 25,
          bigBlind: 50,
          startingStack: 5000,
          actionTimerSeconds: 45,
          nextHandDelaySeconds: 4,
          rabbitHunting: true,
          sevenTwo: false,
        })
        await waitForSnapshot(host, state => (
          state.smallBlind === 25 &&
          state.bigBlind === 50 &&
          state.startingStack === 5000 &&
          state.actionTimerDuration === 45_000 &&
          state.autoStartDelay === 4_000 &&
          state.rabbitHuntingEnabled === true &&
          state.sevenTwoRuleEnabled === false
        ), 'table settings applied')
        await expect(page.getByText(/\$25\s*\/\s*\$50/).filter({ visible: true }).first()).toBeVisible()
        // Blinds shown on the table itself must follow the new stakes.
        await expect.poll(async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' '))
          .toMatch(/\$?25 ?\/ ?\$?50/)

        // 7-2 bounty: re-enable and customize the percentage.
        await saveTableSettings(page, { sevenTwo: true, bountyPercent: 7.5 })
        await waitForSnapshot(host, state => (
          state.sevenTwoRuleEnabled === true && state.sevenTwoBountyPercent === 7.5
        ), '7-2 bounty settings applied')

        // Settings dialog re-hydrates from the live table values.
        await closeSettings(page)
        const reopened = await openSettingsTab(page, 'Settings')
        await expect(reopened.getByLabel('Small blind')).toHaveValue('25')
        await expect(reopened.getByLabel('Big blind')).toHaveValue('50')
        await expect(reopened.getByLabel('Starting stack')).toHaveValue('5000')
        await expect(reopened.getByLabel('Action timer (seconds)')).toHaveValue('45')
        await expect(ruleRow(reopened, 'Rabbit hunting').getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(ruleRow(reopened, '7 / 2 rule').getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true')

        // A too-small buy-in is clamped to 10 big blinds before it is sent.
        await reopened.getByLabel('Starting stack').fill('100')
        await reopened.getByRole('button', { name: 'Save table settings' }).click()
        await waitForSnapshot(host, state => state.startingStack === 500, 'buy-in clamped to 10 BB')

        // Outfit tab: change a hat, save, and see it on the server.
        const outfit = await openSettingsTab(page, 'Outfit')
        const hatGroup = outfit.locator('fieldset', { hasText: 'Hat' }).first()
        const inactiveHat = hatGroup.locator('button[aria-pressed="false"]').first()
        const hatOption = await inactiveHat.getAttribute('data-option')
        await inactiveHat.click()
        await expect(outfit.getByText('Previewing unsaved changes.')).toBeVisible()
        await outfit.getByRole('button', { name: 'Save avatar' }).click()
        await expect(outfit.getByRole('button', { name: 'Avatar saved' })).toBeDisabled()
        await waitForSnapshot(host, (state, tap) => (
          state.lobbyPlayers.find((player: { id: string }) => player.id === tap.yourId)?.avatar?.hat === hatOption
        ), 'avatar hat saved on the server')

        // Leave game returns home and forgets the seat.
        const general = await openSettingsTab(page, 'Settings')
        await general.getByRole('button', { name: 'Leave game' }).click()
        await expect(page).toHaveURL(new RegExp(`^${appUrl}/?$`), { timeout: 30_000 })
      } catch (error) {
        await snap(host.page, `settings-${viewport}-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })

    test('players tab: bots, chips, spectator rail, kick, fill seats; guests cannot manage', async ({ browser }) => {
      const host = await newPlayer(browser, `Boss${viewport === 'desktop' ? 'D' : 'M'}`, viewport)
      const guest = await newPlayer(browser, `Rail${viewport === 'desktop' ? 'D' : 'M'}`, otherViewport(viewport))
      const players = [host, guest]
      try {
        const { roomCode } = await createTable(host)
        await joinByCode(guest, roomCode)
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')

        // Guest sees read-only settings and roster.
        const guestMenu = await openSettingsTab(guest.page, 'Settings')
        await expect(guestMenu.getByText('Only the game creator can change blinds, stacks, timing, and table rules.')).toBeVisible()
        await expect(guestMenu.getByRole('button', { name: 'Save table settings' })).toHaveCount(0)
        await guestMenu.getByRole('button', { name: /^Players \(\d+\)$/ }).click()
        await expect(guestMenu.getByText('Only the game creator can manage players')).toBeVisible()
        await expect(guestMenu.getByRole('button', { name: 'Add chips' })).toHaveCount(0)
        await closeSettings(guest.page)
        await expect(visible(guest.page.getByRole('button', { name: 'Add bot', exact: true }))).toHaveCount(0)

        // Add bot.
        await addBots(host.page, 'Add bot')
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '3')
        await waitForSnapshot(host, state => state.players.some((p: { isBot?: boolean }) => p.isBot), 'bot seated')
        const botName: string = host.tap.snapshot.players.find((p: { isBot?: boolean }) => p.isBot).nickname

        const roster = await openSettingsTab(host.page, 'Players')
        const botRow = roster.locator('.settings-player-row').filter({ hasText: botName })
        await expect(botRow).toContainText('Bot')
        await expect(botRow).toContainText('$1,000')

        // Add / remove chips.
        await botRow.getByLabel('Chip amount').fill('250')
        await botRow.getByRole('button', { name: `Add $250 chips to ${botName}` }).click()
        await expect(botRow).toContainText('$1,250')
        await botRow.getByRole('button', { name: `Remove $250 chips from ${botName}` }).click()
        await expect(botRow).toContainText('$1,000')

        // Spectate / seat.
        await botRow.getByRole('button', { name: `Move ${botName} to spectator mode` }).click()
        await expect(botRow).toContainText('Spectator')
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')
        await botRow.getByRole('button', { name: `Seat ${botName}` }).click()
        await expect(botRow).toContainText('Seated')
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '3')

        // Kick.
        await botRow.getByRole('button', { name: `Kick ${botName} from the table` }).click()
        await expect(roster.locator('.settings-player-row').filter({ hasText: botName })).toHaveCount(0)
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')

        // Move the guest to the rail; the guest takes their seat back from the spectator rail.
        const guestRow = roster.locator('.settings-player-row').filter({ hasText: guest.name })
        await guestRow.getByRole('button', { name: `Move ${guest.name} to spectator mode` }).click()
        await expect(guestRow).toContainText('Spectator')
        await closeSettings(host.page)
        await expect(tableScene(guest.page)).toHaveAttribute('data-player-count', '1')
        const takeSeat = visible(guest.page.getByRole('button', { name: 'Take seat' })).first()
        await expect(takeSeat).toBeVisible()
        await takeSeat.click()
        await expect(tableScene(guest.page)).toHaveAttribute('data-player-count', '2')

        // Fill seats puts bots in every open chair.
        await addBots(host.page, 'Fill seats')
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '8')
        await expect(visible(host.page.getByRole('button', { name: 'Add bot', exact: true }))).toHaveCount(0)

        // Kick the human guest.
        const roster2 = await openSettingsTab(host.page, 'Players')
        await roster2.getByRole('button', { name: `Kick ${guest.name} from the table` }).click()
        await expect(roster2.locator('.settings-player-row').filter({ hasText: guest.name })).toHaveCount(0)
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '7')
        expect(host.tap.failures).toEqual([])
      } catch (error) {
        await snap(host.page, `players-${viewport}-host-failure`)
        await snap(guest.page, `players-${viewport}-guest-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })
  })
}

test('landing join validates the room code and nickname', async ({ browser }) => {
  const player = await newPlayer(browser, 'Validator', 'mobile')
  try {
    await player.page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await expect(async () => {
      await player.page.getByRole('tab', { name: 'Join' }).click()
      await player.page.getByRole('button', { name: 'Join Table' }).click()
      await expect(player.page.locator('.entry-error')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 60_000 })
    await expect(player.page.locator('.entry-error')).toHaveText('Please enter a valid room code')
    await fillHydrated(player.page.getByLabel('Room code'), 'ABC234')
    await player.page.getByRole('button', { name: 'Join Table' }).click()
    await expect(player.page.locator('.entry-error')).toHaveText('Please enter your nickname')
    await player.page.getByRole('tab', { name: 'Create' }).click()
    await player.page.getByRole('button', { name: 'Create Table' }).click()
    await expect(player.page.locator('.entry-error')).toHaveText('Please enter your nickname')
  } finally {
    await closeAll([player])
  }
})
