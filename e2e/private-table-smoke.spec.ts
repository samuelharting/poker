import { expect, test } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'

test.setTimeout(150000)

test('private table create, guest join, room code copy, and live hand smoke', async ({ browser }) => {
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const guestContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
  })

  const hostPage = await hostContext.newPage()
  const guestPage = await guestContext.newPage()

  try {
    await hostPage.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await hostPage.waitForLoadState('networkidle')
    await expect(hostPage.getByRole('heading', { name: 'Poker Night' })).toBeVisible()

    // Sign-in is nickname-only; the old Email / Venmo fields are gone.
    await expect(hostPage.getByLabel('Email')).toHaveCount(0)
    await hostPage.getByLabel('Your nickname').fill('HostSam')
    await hostPage.getByRole('button', { name: 'Create Table' }).click()

    await expect(hostPage).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/, { timeout: 60000 })
    const roomUrl = hostPage.url()
    const roomCode = roomUrl.split('/').pop() ?? ''
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)

    await expect(hostPage.getByText(roomCode).first()).toBeVisible({ timeout: 60000 })
    await hostPage.getByRole('button', { name: 'Open settings' }).filter({ visible: true }).first().click()
    const menu = hostPage.getByRole('dialog', { name: 'Table menu' })
    await expect(menu.getByRole('button', { name: 'Copy code' })).toBeVisible()
    await menu.getByRole('button', { name: 'Copy code' }).click()
    // Copy feedback is intentionally silent in the room; verify the clipboard instead.
    await expect.poll(() => hostPage.evaluate(() => navigator.clipboard.readText())).toBe(roomCode)
    await menu.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(hostPage.getByRole('button', { name: 'Copy code' })).toBeHidden()

    await guestPage.goto(roomUrl, { waitUntil: 'domcontentloaded' })
    await guestPage.waitForLoadState('networkidle')
    await expect(guestPage.getByRole('heading', { name: 'Take your seat' })).toBeVisible()
    await guestPage.getByLabel('Your nickname').fill('GuestAva')
    await guestPage.getByRole('button', { name: 'Enter Room' }).click()

    await expect(guestPage.locator('.table-scene')).toBeVisible({ timeout: 60000 })
    await expect(hostPage.locator('.table-scene')).toHaveAttribute('data-player-count', '2', { timeout: 45000 })

    // The creator must deal the first hand explicitly; later hands auto-deal.
    const start = hostPage.getByRole('button', { name: 'Start game' }).filter({ visible: true }).first()
    await expect(start).toBeEnabled({ timeout: 45000 })
    await start.click()

    await Promise.all([
      expect(hostPage.locator('.table-scene')).toHaveAttribute('data-phase', 'in_hand', { timeout: 45000 }),
      expect(guestPage.locator('.table-scene')).toHaveAttribute('data-phase', 'in_hand', { timeout: 45000 }),
    ])
    await expect.poll(async () => (
      await hostPage.locator('[data-action="fold"]').filter({ visible: true }).count() +
      await guestPage.locator('[data-action="fold"]').filter({ visible: true }).count()
    ), { timeout: 45000 }).toBe(1)
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()])
  }
})
