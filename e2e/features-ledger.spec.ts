import { expect, test } from '@playwright/test'
import {
  actionButton,
  clickStartGame,
  closeAll,
  closeSettings,
  openSettings,
  openSettingsTab,
  snap,
  startTable,
  visible,
  waitForSnapshot,
  waitForTurn,
  type Player,
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

function ledgerRow(player: Player, name: string) {
  return player.tap.snapshot?.ledger?.rows?.find((row: any) => row.name === name)
}

test('a player rebuys themselves and everyone gets the settle-up at the end of the night', async ({ browser }) => {
  const players = await startTable(browser, 'Ldg', ['desktop', 'mobile'], {
    actionTimerSeconds: 60,
    nextHandDelaySeconds: 3,
  })
  const [host, guest] = players as [Player, Player]
  try {
    // Only the host moves arbitrary chips: take 600 off the guest.
    const players_ = await openSettingsTab(host.page, 'Players')
    const guestRow = players_.locator('.settings-player-row').filter({ hasText: guest.name })
    await guestRow.getByLabel('Chip amount').fill('600')
    await guestRow.getByRole('button', { name: `Remove $600 chips from ${guest.name}` }).click()
    await waitForSnapshot(guest, state => state.players.find((p: any) => p.nickname === guest.name)?.stack === 400, 'host removed chips')
    await closeSettings(host.page)

    // The guest is below the buy-in, so they can rebuy themselves from Settings > Ledger.
    const dialog = await openSettings(guest.page)
    await dialog.getByRole('button', { name: 'Ledger', exact: true }).click()
    await expect(dialog.getByText('Your night')).toBeVisible()
    await dialog.getByRole('button', { name: 'Rebuy $1,000' }).click()
    const confirm = guest.page.getByRole('alertdialog', { name: 'Rebuy for $1,000?' })
    await expect(confirm).toBeVisible()
    await snap(guest.page, 'ledger-rebuy-confirm-mobile')
    await confirm.getByRole('button', { name: 'Rebuy $1,000' }).click()
    await expect(confirm).toHaveCount(0)
    await waitForSnapshot(guest, state => state.players.find((p: any) => p.nickname === guest.name)?.stack === 1400, 'rebuy landed')
    await expect(host.page.getByRole('status').filter({ hasText: `${guest.name} rebought $1,000` })).toBeVisible()
    expect(ledgerRow(guest, guest.name)).toMatchObject({ boughtIn: 1400, chips: 1400, net: 0, rebuys: 1 })

    // At the full stack another rebuy is refused, with the reason on screen.
    await expect(dialog.getByRole('button', { name: 'Rebuy $1,000' })).toBeDisabled()

    // Winners get a Venmo pay link.
    await dialog.getByLabel('Venmo username').fill('ldg-guest')
    await dialog.getByRole('button', { name: 'Save Venmo' }).click()
    await waitForSnapshot(guest, () => ledgerRow(guest, guest.name)?.venmoUsername === '@ldg-guest', 'venmo saved')
    await closeSettings(guest.page)

    // Play one hand so somebody is up and somebody is down.
    await clickStartGame(host.page)
    const actor = await waitForTurn(players)
    await actionButton(actor.page, 'fold').click()
    await waitForSnapshot(host, state => state.phase !== 'in_hand' && state.handNumber >= 1, 'hand over')

    // The host ends the night: everyone sees the settle-up card.
    const hostDialog = await openSettings(host.page)
    await hostDialog.getByRole('button', { name: 'Ledger', exact: true }).click()
    await hostDialog.getByRole('button', { name: 'End night: show everyone' }).click()
    const card = guest.page.getByRole('dialog', { name: 'Settle up' })
    await expect(card).toBeVisible()
    await expect(card.locator('.ledger-payment')).toHaveCount(1)
    await expect(card.locator('.ledger-payment')).toContainText(/pays?/)
    const ledger = guest.tap.snapshot.ledger
    expect(ledger.rows.reduce((sum: number, row: any) => sum + row.net, 0)).toBe(0)
    expect(ledger.payments).toHaveLength(1)
    if (ledger.payments[0].toName === guest.name) {
      await expect(card.getByRole('link', { name: /on Venmo/ })).toHaveAttribute('href', /venmo\.com\/u\/ldg-guest\?txn=pay&amount=\d+&note=Poker/)
    }
    await snap(guest.page, 'ledger-settle-card-mobile')
    await snap(host.page, 'ledger-settle-tab-desktop')
    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toHaveCount(0)
  } catch (error) {
    for (const player of players) await snap(player.page, `ledger-${player.name}-failure`)
    throw error
  } finally {
    await closeAll(players)
  }
})
