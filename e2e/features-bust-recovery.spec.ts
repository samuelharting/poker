import { expect, test } from '@playwright/test'
import {
  actionButton,
  clickStartGame,
  closeAll,
  goAllIn,
  otherViewport,
  snap,
  startTable,
  tableScene,
  visible,
  waitForPhase,
  waitForSnapshot,
  waitForTurn,
  type Player,
  type ViewportName,
} from './helpers'

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test(`after a heads-up bust the host can keep the table going (${viewport} host)`, async ({ browser }) => {
    const players = await startTable(browser, 'Bust', [viewport, otherViewport(viewport)], {
      actionTimerSeconds: 60,
      nextHandDelaySeconds: 3,
    })
    const [host, guest] = players as [Player, Player]
    try {
      await clickStartGame(host.page)
      await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
      const shover = await waitForTurn(players)
      const caller = shover === host ? guest : host
      await goAllIn(shover)
      await expect.poll(() => caller.page.evaluate(() => Boolean(document.querySelector('[data-action="call"]')))).toBe(true)
      await actionButton(caller.page, 'call').click()
      await shover.page.getByRole('dialog', { name: 'Run it twice?' }).getByRole('button', { name: 'Once' }).click()
      await waitForSnapshot(host, state => state.phase === 'between_hands' && state.winners?.length > 0, 'showdown resolved')
      test.skip(host.tap.snapshot.winners.length > 1, 'chopped pot: nobody busted this run')

      // Showdown presentation + next-hand delay have both elapsed.
      await expect(tableScene(host.page)).toHaveAttribute('data-showdown-stage', 'complete', { timeout: 30_000 })
      await host.page.waitForTimeout(5_000)
      expect(host.tap.snapshot.phase).toBe('between_hands')

      // Only one funded player is left, so auto-deal cannot continue. The host
      // must still be offered a way forward (add a bot / deal) on the table.
      const controls = visible(host.page.getByRole('button', { name: /^(Add bot|Fill seats|Start game|Deal next hand)$/ }))
      const count = await controls.count()
      if (count === 0) {
        await snap(host.page, `ui-issue-bust-dead-end-${viewport}-host`)
        await snap(guest.page, `ui-issue-bust-dead-end-${viewport}-guest`)
      }
      expect(count, 'host has table controls after a bust').toBeGreaterThan(0)

      await controls.filter({ hasText: 'Add bot' }).first().click()
      await waitForSnapshot(host, state => state.handNumber === 2 && state.phase === 'in_hand', 'table continued with a bot', 60_000)
    } catch (error) {
      for (const player of players) await snap(player.page, `bust-${viewport}-${player.name}-failure`)
      throw error
    } finally {
      await closeAll(players)
    }
  })
}
