import { expect, test, type Page } from '@playwright/test'
import {
  actionButton,
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
  waitForTurn,
} from './helpers'

/**
 * The pill (internally "the mushroom") and the blackout, end to end.
 * The dev-only `window.__pokerDev.fun(...)` hook (development builds talking
 * to a local PartyKit server) hands out a pill / blacks someone out so the
 * test doesn't have to play ~30 hands.
 */

async function devFun(page: Page, action: 'mushroom' | 'trip' | 'blackout' | 'hangover' | 'sober', targetId?: string) {
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __pokerDev?: unknown }).__pokerDev)), {
    timeout: 30_000,
  }).toBe(true)
  await page.evaluate(({ action, targetId }) => {
    const dev = (window as unknown as { __pokerDev: { fun: (action: string, targetId?: string) => void } }).__pokerDev
    dev.fun(action, targetId)
  }, { action, targetId })
}

function rootFlag(page: Page, name: string) {
  return page.evaluate(flag => document.documentElement.dataset[flag] ?? null, name)
}

test('the pill: a private pick card, a secret spike, then a table-wide reveal and a trip that never folds anyone', async ({ browser }) => {
  const host = await newPlayer(browser, 'PillHost', 'desktop')
  const guest = await newPlayer(browser, 'PillGuest', 'desktop')
  const phone = await newPlayer(browser, 'PillPhone', 'mobile')
  const players = [host, guest, phone]
  try {
    const { roomUrl } = await createTable(host)
    await joinTable(guest, roomUrl)
    await joinTable(phone, roomUrl)
    await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '3')
    await saveTableSettings(host.page, { actionTimerSeconds: 60 })
    await closeSettings(host.page)
    await waitForSnapshot(host, state => state.players.filter((p: { drinkCapable?: boolean }) => p.drinkCapable).length === 2, 'desktop clients report they can drink')

    await devFun(host.page, 'mushroom')
    const prompt = host.page.getByTestId('pill-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('You found a pill! Pick whose water gets it.')
    // Only desktop players are offered; the phone player can't drink.
    const guestId = guest.tap.yourId
    await expect(prompt.locator(`[data-pill-target="${guestId}"]`)).toBeVisible()
    await expect(prompt.locator(`[data-pill-target="${phone.tap.yourId}"]`)).toHaveCount(0)
    // Nobody else knows.
    await expect(guest.page.getByTestId('pill-prompt')).toHaveCount(0)
    expect(guest.tap.session?.mushroom).toBeUndefined()

    await prompt.locator(`[data-pill-target="${guestId}"]`).click()
    await prompt.getByRole('button', { name: /OK/ }).click()
    await expect(prompt).toBeHidden()
    await expect.poll(() => host.tap.session?.mushroom).toEqual({ status: 'spiked', victimId: guestId })
    await expect(host.page.locator('.pill-secret-marker')).toBeVisible()
    expect(guest.tap.session?.mushroom).toBeUndefined()
    expect(JSON.stringify(guest.tap.snapshot)).not.toContain('"trip"')

    // The guest's next water is the spiked one.
    await visible(guest.page.locator('.drink-button.is-water')).first().click()
    await waitForSnapshot(guest, (_, tap) => Boolean(tap.me()?.trip), 'the trip kicks in after the sip', 15_000)
    await expect(guest.page.locator('.pill-reveal')).toContainText(/PillHost spiked your water!/)
    await expect(host.page.locator('.pill-reveal')).toContainText(/You spiked PillGuest's water!/)
    await expect.poll(() => rootFlag(guest.page, 'funTrip')).toBe('on')
    // The victim's level never moved: that water did nothing else.
    expect(guest.tap.me()?.drinks?.level ?? 0).toBe(0)
    // Phones see none of it.
    await expect(phone.page.locator('.pill-reveal')).toBeHidden()
    expect(await rootFlag(phone.page, 'funTrip')).toBeNull()

    // Tripping never folds or skips anyone: the guest plays their hand.
    await clickStartGame(host.page)
    await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
    await waitForSnapshot(host, state => state.players.every((p: { hasCards: boolean }) => p.hasCards), 'everyone dealt in')
    const actor = await waitForTurn([host, guest, phone])
    expect(actor.tap.me()?.status).toBe('active')
    if (actor === guest) {
      await expect(actionButton(guest.page, 'fold')).toBeVisible()
    }
    expect(guest.tap.me()?.status).not.toBe('folded')
    expect(guest.tap.me()?.trip).toBeTruthy()
  } finally {
    await closeAll(players)
  }
})

test('a blackout is a quick first-person beat that never folds you or hides your action', async ({ browser }) => {
  const host = await newPlayer(browser, 'BlackHost', 'desktop')
  const guest = await newPlayer(browser, 'BlackGuest', 'desktop')
  const players = [host, guest]
  try {
    const { roomUrl } = await createTable(host)
    await joinTable(guest, roomUrl)
    await saveTableSettings(host.page, { actionTimerSeconds: 60 })
    await closeSettings(host.page)
    await clickStartGame(host.page)
    await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
    const actor = await waitForTurn(players)

    await devFun(actor.page, 'blackout')
    await waitForSnapshot(actor, (_, tap) => tap.me()?.drinks?.passedOut === true, 'blacked out')
    await expect.poll(() => rootFlag(actor.page, 'funBlackout')).toBe('on')
    // The action tray stays up and usable mid-blackout; no text anywhere.
    const fold = actionButton(actor.page, 'fold')
    await expect(fold).toBeVisible()
    expect(await actor.page.evaluate(() => document.body.innerText)).not.toMatch(/passed out/i)
    expect(actor.tap.me()?.status).toBe('active')
    await fold.click()
    await waitForSnapshot(actor, (_, tap) => tap.me()?.status === 'folded', 'folded by their own choice')

    // They come to on their own a few seconds later, hungover.
    await waitForSnapshot(actor, (_, tap) => tap.me()?.drinks?.passedOut === false, 'came to', 15_000)
    expect(actor.tap.me()?.drinks?.hungover).toBe(true)
    expect(actor.tap.me()?.drinks?.level).toBe(1)
  } finally {
    await closeAll(players)
  }
})
