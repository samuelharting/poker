import { expect, test, type Page } from '@playwright/test'
import { SHOT_COOLDOWN_HANDS } from '../lib/drinks'
import {
  closeAll,
  createTable,
  joinTable,
  newPlayer,
  openTargetPanel,
  snap,
  waitForSnapshot,
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Prank events this client received from the room. */
function recordPranks(page: Page): any[] {
  const events: any[] = []
  page.on('websocket', ws => {
    if (!ws.url().includes('/parties/')) return
    ws.on('framereceived', frame => {
      try {
        const message = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'))
        if (message?.type === 'prank_event') events.push(message.event)
      } catch {
        // not JSON
      }
    })
  })
  return events
}

test('desktop players flick a chip and buy a shot at each other', async ({ browser }) => {
  const sam = await newPlayer(browser, 'PrankSam', 'desktop')
  const alex = await newPlayer(browser, 'PrankAlex', 'desktop')
  const players = [sam, alex]
  const alexPranks = recordPranks(alex.page)
  try {
    const { roomUrl } = await createTable(sam)
    await joinTable(alex, roomUrl)
    // Both desktop clients report drink controls.
    await waitForSnapshot(sam, state => state.players.length === 2 && state.players.every((player: any) => player.drinkCapable === true), 'both players drink-capable')

    // Chip flick: purely cosmetic, stacks untouched.
    const stacksBefore = sam.tap.snapshot.players.map((player: any) => player.stack)
    let panel = await openTargetPanel(sam, 'PrankAlex')
    await expect(panel.getByRole('group', { name: 'Mess with PrankAlex' })).toBeVisible()
    await panel.getByRole('button', { name: /Flick a chip at PrankAlex/ }).click()
    await expect.poll(() => alexPranks.some(event => event.kind === 'chip_flick'), { message: 'Alex receives the flick' }).toBe(true)
    // Alex sees a bonk pop (hero-target first-person hit); Sam sees one over Alex's seat.
    // Pops live ~1.3s, so assert on the stage's persistent pop counter rather
    // than racing the transient element (the old source of flakes under load).
    await Promise.all([
      expect(alex.page.locator('.desktop-3d-stage[data-pops-bonk]')).toBeAttached({ timeout: 8_000 }),
      expect(sam.page.locator('.desktop-3d-stage[data-pops-bonk]')).toBeAttached({ timeout: 8_000 }),
    ])
    expect(sam.tap.snapshot.players.map((player: any) => player.stack)).toEqual(stacksBefore)

    // Shot between hands: poured straight away, +3, chaser ring on Alex's Water button.
    panel = await openTargetPanel(sam, 'PrankAlex')
    await panel.getByRole('button', { name: /Buy PrankAlex a shot/ }).click()
    await waitForSnapshot(alex, (_, tap) => tap.me()?.drinks?.shots === 1 && tap.me()?.drinks?.level >= 3, 'Alex got the shot')
    expect(alexPranks.some(event => event.kind === 'shot' && event.levelAdded === 3)).toBe(true)
    await expect(alex.page.locator('.drink-button.is-water.is-chaser')).toBeVisible()
    await expect(alex.page.locator('.drink-chaser-ring')).toBeVisible()
    // First-person: the warm burn once the glass is slammed.
    await expect(alex.page.locator('.desktop-3d-stage[data-flashes-shot]')).toBeAttached({ timeout: 10_000 })
    await snap(alex.page, 'pranks-alex-after-shot')

    // Buyer cooldown: the shot button is disabled with a hands-left badge.
    panel = await openTargetPanel(sam, 'PrankAlex')
    const shotButton = panel.getByRole('button', { name: /Buy PrankAlex a shot/ })
    await expect(shotButton).toBeDisabled()
    // One bought shot per hand (SHOT_COOLDOWN_HANDS, was 5 hands).
    await expect(shotButton.locator('.prank-button-badge')).toHaveText(String(SHOT_COOLDOWN_HANDS))
    await snap(sam.page, 'pranks-sam-cooldown')

    // A chaser water is instant (-2), not queued.
    const levelBefore = alex.tap.me().drinks.level
    await alex.page.locator('.drink-button.is-water').click()
    await waitForSnapshot(alex, (_, tap) => tap.me()?.drinks?.level === Math.max(0, levelBefore - 2) && tap.me()?.drinks?.sobering === 0, 'chaser applied instantly')
  } finally {
    await closeAll(players)
  }
})

test('phones get none of it: no prank buttons, and cannot be targeted', async ({ browser }) => {
  const desk = await newPlayer(browser, 'PrankDesk', 'desktop')
  const phone = await newPlayer(browser, 'PrankPhone', 'mobile')
  const players = [desk, phone]
  try {
    const { roomUrl } = await createTable(desk)
    await joinTable(phone, roomUrl)
    await waitForSnapshot(desk, state => state.players.some((player: any) => player.nickname === 'PrankPhone' && player.drinkCapable === false), 'phone is not drink-capable')

    // Desktop viewing the phone player: the panel has no prank controls.
    const deskPanel = await openTargetPanel(desk, 'PrankPhone')
    await expect(deskPanel.getByRole('group', { name: /Mess with/ })).toHaveCount(0)

    // Phone viewing the desktop player: no prank controls either.
    const phonePanel = await openTargetPanel(phone, 'PrankDesk')
    await expect(phonePanel).toBeVisible()
    await expect(phonePanel.getByRole('group', { name: /Mess with/ })).toHaveCount(0)
    await expect(phone.page.locator('.drink-controls')).toHaveCount(0)
    await snap(phone.page, 'pranks-phone-panel')
  } finally {
    await closeAll(players)
  }
})
