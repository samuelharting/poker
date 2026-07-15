import { expect, test } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'

test.setTimeout(120000)

test('targeted emoji panel owns focus and restores it to the invoking player', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Your nickname').fill('FocusHost')
    await page.getByLabel('Email').fill('focus@example.com')
    await page.getByLabel('Venmo username').fill('@focushost')
    await page.getByRole('button', { name: 'Create Table' }).click()

    await expect(page).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/, { timeout: 60000 })
    const addBot = page.getByRole('button', { name: 'Add bot' }).first()
    await expect(addBot).toBeEnabled({ timeout: 60000 })
    await addBot.click()

    const playerTrigger = page.getByRole('button', { name: /Send a reaction to Bot/i }).first()
    await expect(playerTrigger).toBeVisible({ timeout: 60000 })
    await playerTrigger.focus()
    await playerTrigger.press('Enter')

    const closeButton = page.getByRole('button', { name: 'Close target emote panel' })
    await expect(closeButton).toBeFocused()

    await page.getByRole('button', { name: 'Search all emojis' }).click()
    const emojiSearch = page.getByPlaceholder(/Search emojis for Bot/i)
    await expect(emojiSearch).toBeFocused({ timeout: 30000 })
    await page.keyboard.press('Escape')

    await expect(closeButton).toHaveCount(0)
    await expect(playerTrigger).toBeFocused()

    await playerTrigger.press('Enter')
    await expect(closeButton).toBeFocused()
    await closeButton.click()
    await expect(playerTrigger).toBeFocused()
  } finally {
    await context.close()
  }
})
