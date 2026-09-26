import { expect, test, type Browser } from '@playwright/test'
import {
  actionButton,
  clickStartGame,
  closeAll,
  closeSettings,
  createTable,
  joinTable,
  newPlayer,
  openTargetPanel,
  otherViewport,
  saveTableSettings,
  seatRevealedCards,
  snap,
  tableScene,
  visible,
  waitForPhase,
  waitForSnapshot,
  waitForTurn,
  type Player,
  type TableSettingsInput,
  type ViewportName,
} from './helpers'

async function startHeadsUp(
  browser: Browser,
  viewport: ViewportName,
  prefix: string,
  settings: TableSettingsInput
): Promise<{ host: Player; guest: Player }> {
  const tag = viewport === 'desktop' ? 'D' : 'M'
  const host = await newPlayer(browser, `${prefix}Host${tag}`, viewport)
  const guest = await newPlayer(browser, `${prefix}Gst${tag}`, otherViewport(viewport))
  const { roomUrl } = await createTable(host)
  await joinTable(guest, roomUrl)
  await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')
  await saveTableSettings(host.page, settings)
  await closeSettings(host.page)
  return { host, guest }
}

/** Size a raise with the viewport's own controls (desktop number input / mobile stepper). */
async function sizeRaise(player: Player, amount: number, bigBlind: number) {
  const page = player.page
  if (player.viewport === 'desktop') {
    const input = visible(page.getByRole('spinbutton')).first()
    await input.fill(String(amount))
    await expect(actionButton(page, 'raise')).toHaveAttribute('aria-label', `Raise to $${amount.toLocaleString()}`)
    return
  }
  await visible(page.getByRole('button', { name: 'Min', exact: true })).first().click()
  const minAmount: number = player.tap.snapshot.minRaise
  const steps = Math.round((amount - minAmount) / bigBlind)
  for (let index = 0; index < steps; index += 1) {
    await visible(page.getByRole('button', { name: 'Increase bet' })).first().click()
  }
  await expect(actionButton(page, 'raise')).toContainText(`$${amount.toLocaleString()}`)
}

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test.describe(`hand flow (${viewport} host)`, () => {
    test('raise, call, check, queued check/fold, bet, fold, show cards, rabbit hunt, auto-deal', async ({ browser }) => {
      const { host, guest } = await startHeadsUp(browser, viewport, 'Flow', {
        actionTimerSeconds: 60,
        nextHandDelaySeconds: 20,
        rabbitHunting: false,
      })
      const players = [host, guest]
      try {
        await clickStartGame(host.page)
        await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
        await waitForSnapshot(host, state => state.handNumber === 1 && state.pots !== undefined, 'hand #1 dealt')

        // Both players are dealt two private cards.
        for (const player of players) {
          await waitForSnapshot(player, (_, tap) => tap.me()?.holeCards?.length === 2, 'own hole cards')
          const opponent = player === host ? guest : host
          await waitForSnapshot(player, (_, tap) => tap.player(opponent.tap.yourId)?.holeCards === undefined, 'opponent cards hidden')
        }

        const first = await waitForTurn(players)
        const second = first === host ? guest : host
        // Heads-up: the button posts the small blind and acts first preflop.
        await waitForSnapshot(first, (_, tap) => tap.me()?.isDealer === true && tap.me()?.isSB === true, 'button is the small blind')

        // Pre-action queue toggles for the waiting player.
        const queue = visible(second.page.getByRole('button', { name: 'Queue check if possible, otherwise fold' })).first()
        await expect(queue).toBeVisible()
        await queue.click()
        const cancel = visible(second.page.getByRole('button', { name: 'Cancel queued check or fold' })).first()
        await expect(cancel).toHaveAttribute('aria-pressed', 'true')
        await cancel.click()
        await expect(queue).toHaveAttribute('aria-pressed', 'false')

        // Preflop: first raises to $100 with their viewport's sizing control.
        await sizeRaise(first, 100, 20)
        await actionButton(first.page, 'raise').click()
        await waitForSnapshot(first, (state, tap) => state.currentBet === 100 && tap.me()?.lastAction === 'Raised $100', 'raise to $100')

        // Second calls $80.
        await expect.poll(() => second.page.evaluate(() => Boolean(document.querySelector('[data-action="call"]')))).toBe(true)
        if (second.viewport === 'desktop') {
          await expect(actionButton(second.page, 'call')).toHaveAttribute('aria-label', 'Call $80')
        } else {
          await expect(actionButton(second.page, 'call')).toContainText('$80')
        }
        await actionButton(second.page, 'call').click()
        await waitForSnapshot(host, state => state.round === 'flop' && state.communityCards.length === 3, 'flop dealt')
        for (const player of players) {
          await expect(player.page.locator('.community-cards').first()).toHaveAttribute('data-visible-count', '3')
        }

        // Flop: the big blind acts first. The button queues check/fold, which must fire on its own.
        const flopFirst = await waitForTurn(players)
        const flopSecond = flopFirst === host ? guest : host
        expect(flopFirst).toBe(second)
        const queueAgain = visible(flopSecond.page.getByRole('button', { name: 'Queue check if possible, otherwise fold' })).first()
        await queueAgain.click()
        await expect(visible(flopSecond.page.getByRole('button', { name: 'Cancel queued check or fold' })).first()).toBeVisible()
        await actionButton(flopFirst.page, 'check').click()
        await waitForSnapshot(flopSecond, (state, tap) => (
          state.round === 'turn' && state.communityCards.length === 4 && tap.me()?.lastAction === 'Checked'
        ), 'queued check fired on its own and advanced to the turn')

        // Turn: check, then a half-pot bet via quick bet, then fold.
        const turnFirst = await waitForTurn(players)
        const turnSecond = turnFirst === host ? guest : host
        await actionButton(turnFirst.page, 'check').click()
        await expect.poll(() => turnSecond.page.evaluate(() => Boolean(document.querySelector('[data-action="check"]')))).toBe(true)
        await visible(turnSecond.page.getByRole('button', { name: turnSecond.viewport === 'desktop' ? '1/2 Pot' : '½ Pot', exact: true })).first().click()
        if (turnSecond.viewport === 'desktop') {
          await expect(actionButton(turnSecond.page, 'raise')).toHaveAttribute('aria-label', 'Raise to $100')
        } else {
          await expect(actionButton(turnSecond.page, 'raise')).toContainText('$100')
        }
        await actionButton(turnSecond.page, 'raise').click()
        await expect.poll(() => turnFirst.page.evaluate(() => Boolean(document.querySelector('[data-action="fold"]')))).toBe(true)
        await actionButton(turnFirst.page, 'fold').click()

        const winner = turnSecond
        const loser = turnFirst
        await Promise.all(players.map(player => waitForPhase(player.page, 'between_hands')))
        await waitForSnapshot(host, state => state.winners?.[0]?.playerId === winner.tap.yourId, 'fold winner recorded')

        // Winner chooses which cards to show; the loser sees exactly that.
        const showGroup = visible(winner.page.getByRole('group', { name: 'Choose which cards to reveal after this hand' })).first()
        await expect(showGroup).toBeVisible()
        const winnerSeat = { id: winner.tap.yourId, name: winner.name }
        await showGroup.getByRole('button', { name: 'Show left card' }).click()
        await waitForSnapshot(loser, (_, tap) => tap.player(winnerSeat.id)?.holeCards?.length === 1, 'left card shown')
        await expect(seatRevealedCards(loser, winnerSeat)).toHaveCount(1)
        await showGroup.getByRole('button', { name: 'Show both cards' }).click()
        await waitForSnapshot(loser, (_, tap) => tap.player(winnerSeat.id)?.holeCards?.length === 2, 'both cards shown')
        await expect(seatRevealedCards(loser, winnerSeat)).toHaveCount(2)
        await showGroup.getByRole('button', { name: 'Muck both cards' }).click()
        await waitForSnapshot(loser, (_, tap) => tap.player(winnerSeat.id)?.holeCards === undefined, 'cards mucked')
        await expect(seatRevealedCards(loser, winnerSeat)).toHaveCount(0)

        // Rabbit hunt after a fold before the river.
        const rabbit = visible(loser.page.getByRole('button', { name: 'Rabbit hunt' })).first()
        await expect(rabbit).toBeVisible()
        await rabbit.click()
        await waitForSnapshot(loser, state => (
          state.communityCards.length === 5 && String(state.recentActions[0]).startsWith('Rabbit hunt:')
        ), 'rabbit hunt ran out the river')
        await expect(loser.page.locator('.community-cards').first()).toHaveAttribute('data-visible-count', '5')
        await expect(visible(winner.page.getByRole('button', { name: 'Rabbit hunt' }))).toHaveCount(0)

        // The next hand auto-deals without anyone pressing a button.
        await waitForSnapshot(host, state => state.handNumber === 2 && state.phase === 'in_hand', 'hand #2 auto-dealt', 60_000)
        expect([...host.tap.failures, ...guest.tap.failures]).toEqual([])
      } catch (error) {
        await snap(host.page, `hand-flow-${viewport}-host-failure`)
        await snap(guest.page, `hand-flow-${viewport}-guest-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })

    test('reload mid-hand keeps the seat, host role, own cards and opponent privacy', async ({ browser }) => {
      const { host, guest } = await startHeadsUp(browser, viewport, 'Rel', { actionTimerSeconds: 60 })
      const players = [host, guest]
      try {
        await clickStartGame(host.page)
        await waitForSnapshot(host, (_, tap) => tap.me()?.holeCards?.length === 2, 'host dealt in')
        const before = {
          id: host.tap.yourId,
          seat: host.tap.me().seatIndex,
          stack: host.tap.me().stack,
          cards: JSON.stringify(host.tap.me().holeCards),
          token: host.tap.session.reconnectToken,
        }

        host.tap.reset()
        await host.page.reload({ waitUntil: 'domcontentloaded' })
        await waitForSnapshot(host, (_, tap) => tap.session?.yourId === before.id && tap.me()?.holeCards?.length === 2, 'host rejoined same seat')
        expect(host.tap.session.isHost).toBe(true)
        expect(host.tap.session.reconnectToken).toBe(before.token)
        expect(host.tap.me().seatIndex).toBe(before.seat)
        expect(host.tap.me().stack).toBe(before.stack)
        expect(JSON.stringify(host.tap.me().holeCards)).toBe(before.cards)
        expect(host.tap.player(guest.tap.yourId).holeCards).toBeUndefined()
        await expect(tableScene(host.page)).toHaveAttribute('data-phase', 'in_hand')
        await expect(tableScene(host.page)).toHaveAttribute('data-hero-seat', 'true')

        // The rejoined player can still act (or the other player can act on them).
        const actor = await waitForTurn(players, 90_000)
        const legal = (await actor.page.locator('[data-action="check"]').count()) > 0 ? 'check' : 'call'
        // The desktop room re-warms WebGL after a reload; give the click room to land.
        await actionButton(actor.page, legal).click({ timeout: 60_000 })
        await waitForSnapshot(actor, (_, tap) => Boolean(tap.me()?.lastAction), 'post-reload action accepted')
        expect([...host.tap.failures, ...guest.tap.failures]).toEqual([])
      } catch (error) {
        await snap(host.page, `reconnect-${viewport}-host-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })

    test('table chat, quick reactions, targeted emotes with emoji search and targeted messages', async ({ browser }) => {
      const tag = viewport === 'desktop' ? 'D' : 'M'
      const host = await newPlayer(browser, `Talk${tag}`, viewport)
      const guest = await newPlayer(browser, `Hear${tag}`, otherViewport(viewport))
      const players = [host, guest]
      try {
        const { roomUrl } = await createTable(host)
        await joinTable(guest, roomUrl)
        await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '2')
        const hostId = host.tap.yourId
        const guestId = guest.tap.yourId

        // Table chat.
        await visible(host.page.getByRole('button', { name: 'Open table chat and reactions' })).first().click()
        const message = `gl all ${Date.now() % 10000}`
        await host.page.getByLabel('Table message').fill(message)
        await host.page.getByLabel('Table message').press('Enter')
        await expect.poll(() => (guest.tap.social?.chatLog ?? []).some((entry: { message: string }) => entry.message === message)).toBe(true)
        await visible(guest.page.getByRole('button', { name: 'Open table chat and reactions' })).first().click()
        await expect(guest.page.locator('.social-dock-messages')).toContainText(message)

        // Quick reaction (thumbs up) lands on the sender's seat for everyone else.
        await host.page.getByRole('button', { name: 'Send thumbs up reaction' }).click()
        await expect.poll(() => (guest.tap.social?.active ?? []).find((entry: { playerId: string }) => entry.playerId === hostId)?.emote).toBe('\u{1F44D}')
        const hostSeatOnGuest = guest.viewport === 'desktop'
          ? guest.page.locator(`[data-seat-player="${hostId}"] .cinematic-seat-reaction`)
          : guest.page.locator('.mobile-edge-social')
        await expect(visible(hostSeatOnGuest).first()).toContainText('\u{1F44D}')
        // Every quick reaction in the dock sends its emoji.
        const quickReactions: Array<[string, string]> = [
          ['wave', '\u{1F44B}'], ['laugh', '\u{1F602}'], ['cool', '\u{1F60E}'], ['skull', '\u{1F480}'],
          ['cry', '\u{1F62D}'], ['angry', '\u{1F621}'], ['middle finger', '\u{1F595}'], ['thumbs up', '\u{1F44D}'],
        ]
        for (const [label, glyph] of quickReactions) {
          await host.page.getByRole('button', { name: `Send ${label} reaction` }).click()
          await expect.poll(() => (guest.tap.social?.active ?? []).find((entry: { playerId: string }) => entry.playerId === hostId)?.emote, { message: label }).toBe(glyph)
        }
        await guest.page.getByRole('button', { name: 'Close table chat' }).first().click()
        // Close our own chat panel too: an open panel intentionally covers the table.
        await host.page.getByRole('button', { name: 'Close table chat' }).first().click()

        // Targeted quick emote.
        let panel = await openTargetPanel(host, guest.name)
        await expect(panel.getByLabel(`${guest.name} stats`)).toBeVisible()
        await panel.getByRole('button', { name: `Send middle finger to ${guest.name}` }).click()
        await expect(panel).toBeHidden()
        await expect.poll(() => {
          const entry = (guest.tap.social?.active ?? []).find((item: { playerId: string }) => item.playerId === hostId)
          return entry ? `${entry.emote}|${entry.targetPlayerId}` : ''
        }).toBe(`\u{1F595}|${guestId}`)

        // Full emoji picker with search.
        panel = await openTargetPanel(host, guest.name)
        await panel.getByRole('button', { name: 'More emojis' }).click()
        const search = panel.getByPlaceholder(`Search emojis for ${guest.name}`)
        await expect(search).toBeVisible()
        await search.fill('fire')
        const fire = panel.locator('button[data-unified="1f525"]').first()
        await expect(fire).toBeVisible()
        await fire.click()
        await expect.poll(() => (guest.tap.social?.active ?? []).find((item: { playerId: string }) => item.playerId === hostId)?.emote).toBe('\u{1F525}')
        // The picked emoji becomes a quick emote next time.
        panel = await openTargetPanel(host, guest.name)
        await expect(panel.getByRole('button', { name: `Send emoji to ${guest.name}` }).first()).toBeVisible()

        // Targeted message.
        const whisper = `nice hand ${Date.now() % 1000}`
        await panel.getByLabel(`Message ${guest.name}`).fill(whisper)
        await panel.getByRole('button', { name: 'Send', exact: true }).click()
        await expect.poll(() => (guest.tap.social?.chatLog ?? []).find((entry: { message: string }) => entry.message === whisper)?.targetPlayerId).toBe(guestId)

        // Escape closes the targeted panel.
        panel = await openTargetPanel(host, guest.name)
        await host.page.keyboard.press('Escape')
        await expect(panel).toBeHidden()

        // Chat flows the other way too.
        await visible(guest.page.getByRole('button', { name: 'Open table chat and reactions' })).first().click()
        await guest.page.getByLabel('Table message').fill('ty')
        await guest.page.getByRole('button', { name: 'Send', exact: true }).click()
        await expect.poll(() => (host.tap.social?.chatLog ?? []).some((entry: { message: string; playerId: string }) => entry.message === 'ty' && entry.playerId === guestId)).toBe(true)
        expect([...host.tap.failures, ...guest.tap.failures]).toEqual([])
      } catch (error) {
        await snap(host.page, `social-${viewport}-host-failure`)
        await snap(guest.page, `social-${viewport}-guest-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })
  })
}
