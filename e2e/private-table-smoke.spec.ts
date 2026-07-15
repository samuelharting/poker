import { expect, test } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'

test.setTimeout(150000)

test('private table create, guest join, feedback, and live hand smoke', async ({ browser }) => {
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

    await hostPage.getByLabel('Your nickname').fill('HostSam')
    await hostPage.getByLabel('Email').fill('host@example.com')
    await hostPage.getByLabel('Venmo username').fill('@hostsam')
    await hostPage.getByRole('button', { name: 'Create Table' }).click()

    await expect(hostPage).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/, { timeout: 60000 })
    const roomUrl = hostPage.url()
    const roomCode = roomUrl.split('/').pop() ?? ''
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)

    await expect(hostPage.getByText(roomCode).first()).toBeVisible({ timeout: 60000 })
    await hostPage.getByRole('button', { name: 'Open settings' }).last().click()
    await expect(hostPage.getByRole('button', { name: 'Copy code' })).toBeVisible()
    await hostPage.getByRole('button', { name: 'Copy code' }).click({ force: true })
    await expect(hostPage.getByText('Room code copied.')).toBeVisible()
    await hostPage.getByRole('button', { name: 'Close settings' }).last().click()
    await expect(hostPage.getByRole('button', { name: 'Copy code' })).toBeHidden()

    await guestPage.goto(roomUrl, { waitUntil: 'domcontentloaded' })
    await guestPage.waitForLoadState('networkidle')
    await expect(guestPage.getByRole('heading', { name: 'Take your seat' })).toBeVisible()
    await guestPage.getByLabel('Your nickname').fill('GuestAva')
    await guestPage.getByLabel('Email').fill('guest@example.com')
    await guestPage.getByLabel('Venmo username').fill('@guestava')
    await guestPage.getByRole('button', { name: 'Enter Room' }).click()

    await expect(guestPage.getByText(roomCode).first()).toBeVisible({ timeout: 60000 })

    await expect.poll(async () => hostPage.evaluate(() => document.body.innerText), {
      timeout: 45000,
    }).toMatch(/2 seated|POT \$|Your turn|Fold timer/i)

    // Fresh private tables auto-start after the second player sits. Waiting for
    // the hand avoids racing the transient Start game button as the countdown
    // replaces the lobby controls.
    await Promise.all([
      expect.poll(async () => hostPage.evaluate(() => document.body.innerText), {
        timeout: 45000,
      }).toMatch(/Your turn|Fold timer|FOLD|CHECK \/ CALL|CALL \$|POT \$/i),
      expect.poll(async () => guestPage.evaluate(() => document.body.innerText), {
        timeout: 45000,
      }).toMatch(/GuestAva|Your turn|Fold timer|POT \$/i),
    ])
  } finally {
    await Promise.allSettled([hostContext.close(), guestContext.close()])
  }
})
