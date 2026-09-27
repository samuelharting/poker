import { expect, test } from '@playwright/test'
import {
  clickStartGame,
  closeAll,
  closeSettings,
  createTable,
  joinTable,
  newPlayer,
  saveTableSettings,
  tableScene,
  visible,
  waitForPhase,
  waitForSnapshot,
  type ViewportName,
} from './helpers'

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test(`own cards are shown on deal, flip down, and peeking shows at the table (${viewport})`, async ({ browser }) => {
    const tag = viewport === 'desktop' ? 'D' : 'M'
    const host = await newPlayer(browser, `PeekHost${tag}`, viewport)
    const guest = await newPlayer(browser, `PeekGst${tag}`, 'desktop')
    const players = [host, guest]
    try {
      const { roomUrl } = await createTable(host)
      await joinTable(guest, roomUrl)
      await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')
      await saveTableSettings(host.page, { actionTimerSeconds: 60 })
      await closeSettings(host.page)
      // Record every peek mode the hero's cards go through (the deal-time
      // reveal is time-boxed, so asserting it at one instant would be racy).
      await host.page.evaluate(() => {
        const w = window as unknown as { __peekModes: string[] }
        w.__peekModes = []
        const record = (row: Element) => {
          requestAnimationFrame(() => {
            const strength = [...document.querySelectorAll('.own-hand-strength')].some(el => (el as HTMLElement).offsetParent)
            w.__peekModes.push(`${row.getAttribute('data-peek')}:${strength ? 'strength' : 'none'}`)
          })
        }
        new MutationObserver(records => {
          for (const record_ of records) {
            const target = record_.target as Element
            if (record_.type === 'attributes' && target.matches('.own-card-row')) record(target)
            record_.addedNodes.forEach(node => {
              if (node instanceof Element) node.querySelectorAll('.own-card-row[data-peek]').forEach(record)
            })
          }
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-peek'] })
      })
      await clickStartGame(host.page)
      await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
      await waitForSnapshot(host, (_, tap) => tap.me()?.holeCards?.length === 2, 'host dealt in')

      const row = visible(host.page.locator('.own-card-row.is-concealed')).first()
      await expect(row).toBeVisible()
      // Freshly dealt: face-up with the hand strength, and the table sees you look...
      await expect.poll(() => host.page.evaluate(() => (window as unknown as { __peekModes: string[] }).__peekModes))
        .toContain('deal:strength')
      await expect.poll(() => guest.tap.everPeeking.has(host.tap.yourId), { timeout: 15_000 }).toBe(true)
      // ...then they flip face-down on their own.
      await expect(row).toHaveAttribute('data-peek', 'idle', { timeout: 8000 })
      await expect(visible(host.page.locator('.own-hand-strength'))).toHaveCount(0)
      await waitForSnapshot(guest, (_, tap) => !tap.player(host.tap.yourId)?.isPeeking, 'deal-time look cleared')

      // Press and hold: the cards lift and stay up while held; the table sees the peek.
      const box = await row.boundingBox()
      if (!box) throw new Error('no card row box')
      await host.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await host.page.mouse.down()
      await expect(row).toHaveAttribute('data-peek', 'held')
      await waitForSnapshot(guest, (_, tap) => tap.player(host.tap.yourId)?.isPeeking === true, 'guest sees the host peeking')
      expect(guest.tap.player(host.tap.yourId)?.holeCards).toBeUndefined()
      await host.page.mouse.up()
      await expect(row).toHaveAttribute('data-peek', 'idle')
      await waitForSnapshot(guest, (_, tap) => !tap.player(host.tap.yourId)?.isPeeking, 'peek cleared on release')

      // Quick click: a brief squeeze that settles by itself.
      await row.click()
      await expect(row).toHaveAttribute('data-peek', 'quick')
      await expect(row).toHaveAttribute('data-peek', 'idle', { timeout: 3000 })
    } finally {
      await closeAll(players)
    }
  })
}
