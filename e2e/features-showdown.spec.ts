import { expect, test } from '@playwright/test'
import {
  actionButton,
  clickStartGame,
  closeAll,
  goAllIn,
  otherViewport,
  recordAttribute,
  recordedAttribute,
  seatRevealedCards,
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

async function recordAnimations(player: Player) {
  const page = player.page
  await recordAttribute(page, '.table-scene', 'data-showdown-stage', 'stage')
  await recordAttribute(page, '.table-scene', 'data-run-it-twice', 'rit')
  await recordAttribute(page, '.community-cards', 'data-visible-count', 'board')
  await recordAttribute(page, '.all-in-announcement', 'aria-label', 'allin')
  if (player.viewport === 'desktop') {
    await page.evaluate(() => {
      const store = ((window as unknown as { __qaLongTasks?: number[] }).__qaLongTasks = [])
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) store.push(Math.round(entry.duration))
        }).observe({ type: 'longtask', buffered: false })
      } catch {
        // longtask timing is Chromium-only; absence just skips the diagnostic.
      }
    })
    await recordAttribute(page, '.desktop-3d-stage', 'data-winner-ids', 'winners')
    await recordAttribute(page, '.desktop-3d-stage', 'data-pot-amount', 'pot')
  }
}

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  for (const choice of ['twice', 'once'] as const) {
    test(`heads-up all-in, run it ${choice}, showdown cinematic and winner (${viewport} host)`, async ({ browser }) => {
      const players = await startTable(browser, choice === 'twice' ? 'Rit' : 'Sd', [viewport, otherViewport(viewport)], {
        actionTimerSeconds: 60,
        nextHandDelaySeconds: 30,
      })
      const [host, guest] = players as [Player, Player]
      try {
        for (const player of players) {
          await recordAnimations(player)
        }
        await clickStartGame(host.page)
        await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))

        const shover = await waitForTurn(players)
        const caller = shover === host ? guest : host
        await goAllIn(shover)
        await waitForSnapshot(caller, (_, tap) => tap.player(shover.tap.yourId)?.status === 'all_in', 'shove registered')

        // Caller sees the all-in announcement and calls off their stack.
        await expect.poll(() => caller.page.evaluate(() => Boolean(document.querySelector('[data-action="call"]')))).toBe(true)
        await actionButton(caller.page, 'call').click()

        // Both players get the run-it-twice consent prompt.
        for (const player of players) {
          const prompt = player.page.getByRole('dialog', { name: 'Run it twice?' })
          await expect(prompt).toBeVisible()
          await expect(tableScene(player.page)).toHaveAttribute('data-run-it-twice', 'voting')
        }
        // Cards stay hidden while the vote is open.
        expect(host.tap.player(guest.tap.yourId)?.holeCards).toBeUndefined()

        if (choice === 'twice') {
          const firstPrompt = shover.page.getByRole('dialog', { name: 'Run it twice?' })
          await firstPrompt.getByRole('button', { name: 'Yes, twice' }).click()
          await expect(firstPrompt).toContainText('Yes locked in')
          await expect(caller.page.getByRole('dialog', { name: 'Run it twice?' }).locator('.run-it-twice-voter.is-yes')).toHaveCount(1)
          await caller.page.getByRole('dialog', { name: 'Run it twice?' }).getByRole('button', { name: 'Yes, twice' }).click()
          for (const player of players) {
            await expect(tableScene(player.page)).toHaveAttribute('data-run-it-twice', 'accepted')
            await expect(visible(player.page.getByRole('region', { name: 'Run it twice boards' })).first()).toBeVisible()
            await waitForSnapshot(player, state => (
              state.runItTwice?.boards?.length === 2 &&
              state.runItTwice.boards.every((board: { cards: unknown[] }) => board.cards.length === 5)
            ), 'two full boards')
          }
        } else {
          await shover.page.getByRole('dialog', { name: 'Run it twice?' }).getByRole('button', { name: 'Once' }).click()
          for (const player of players) {
            await expect(tableScene(player.page)).toHaveAttribute('data-run-it-twice', 'declined')
            await waitForSnapshot(player, state => state.communityCards.length === 5, 'single board ran out')
          }
        }

        // Showdown: both hands are revealed to the opponent, a winner is paid, chips are conserved.
        for (const player of players) {
          await waitForSnapshot(player, state => state.phase === 'between_hands' && state.round === 'showdown' && state.winners?.length > 0, 'showdown resolved')
          const opponent = player === host ? guest : host
          await waitForSnapshot(player, (_, tap) => tap.player(opponent.tap.yourId)?.holeCards?.length === 2, 'opponent hand revealed at showdown')
          const stacks = player.tap.snapshot.players.reduce((sum: number, p: { stack: number }) => sum + p.stack, 0)
          expect(stacks).toBe(2000)
        }
        for (const player of players) {
          await expect(tableScene(player.page)).toHaveAttribute('data-showdown-stage', 'complete', { timeout: 30_000 })
          // Nothing in the flow should have scrolled the fixed-height table.
          const scroll = await player.page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTop)
          if (scroll > 0) {
            const file = await snap(player.page, `ui-issue-page-scrolled-after-showdown-${player.viewport}`)
            test.info().annotations.push({ type: 'ui-issue', description: `${player.viewport} page scrolled by ${scroll}px during the showdown flow; screenshot ${file}` })
          }
        }

        for (const player of players) {
          const opponent = player === host ? guest : host
          await expect(seatRevealedCards(player, { id: opponent.tap.yourId, name: opponent.name })).toHaveCount(2)

          const stages = await recordedAttribute(player.page, 'stage')
          const order = ['idle', 'intro', 'reveal', 'highlight', 'payout', 'result', 'complete']
          const played = stages.filter(stage => stage !== '(none)' && stage !== 'idle')
          const indexes = played.map(stage => order.indexOf(stage))
          // The cinematic always moves forward and finishes.
          expect(indexes.every((value, index) => value >= 0 && (index === 0 || value >= indexes[index - 1]!)), `${player.name} stages: ${stages.join(' > ')}`).toBe(true)
          expect(played[0], `${player.name} stages: ${stages.join(' > ')}`).toBe('intro')
          expect(played.at(-1)).toBe('complete')
          const missed = ['reveal', 'highlight', 'payout'].filter(stage => !played.includes(stage))
          if (player.viewport === 'mobile') {
            // The 2D table has no WebGL work competing with the timeline: every beat must render.
            expect(missed, `${player.name} stages: ${stages.join(' > ')}`).toEqual([])
          } else if (missed.length) {
            const longTasks = await player.page.evaluate(() => (window as unknown as { __qaLongTasks?: number[] }).__qaLongTasks ?? [])
            test.info().annotations.push({
              type: 'ui-issue',
              description: `Desktop 3D showdown skipped stage(s) ${missed.join(', ')} (${stages.join(' > ')}); longest main-thread tasks ms: ${[...longTasks].sort((a, b) => b - a).slice(0, 5).join(', ')}`,
            })
          }

          const allIn = await recordedAttribute(player.page, 'allin')
          expect(allIn, `${player.name} all-in announcements`).toContain(`${shover.name} is all in`)

          if (choice === 'once') {
            const board = await recordedAttribute(player.page, 'board')
            expect(board[0], `${player.name} board: ${board.join(' > ')}`).toBe('0')
            expect(board.at(-1)).toBe('5')
          }

          const winnerIds: string[] = player.tap.snapshot.winners.map((winner: { playerId: string }) => winner.playerId)
          if (player.viewport === 'desktop') {
            const winners = await recordedAttribute(player.page, 'winners')
            expect(winners.some(value => value !== '' && value !== '(none)' && value.split(',').some(id => winnerIds.includes(id))), `desktop winner ids: ${winners.join(' > ')}`).toBe(true)
            const pots = await recordedAttribute(player.page, 'pot')
            expect(pots.some(value => Number(value) >= 2000), `desktop pot: ${pots.join(' > ')}`).toBe(true)
          }
          if (choice === 'once') {
            // Winner call-out: 2D result line (+$X), hero "Won $X" chip, or the 3D seat's "Hand winner" label.
            await expect(visible(player.page.locator('[aria-label^="Hand winner"]'))
              .or(visible(player.page.getByText(/\+\$[\d,]+|Won \$[\d,]+/)))
              .first()).toBeVisible()
          }
        }
        expect([...host.tap.failures, ...guest.tap.failures]).toEqual([])
        expect([...host.tap.pageErrors, ...guest.tap.pageErrors]).toEqual([])
      } catch (error) {
        await snap(host.page, `showdown-${choice}-${viewport}-host-failure`)
        await snap(guest.page, `showdown-${choice}-${viewport}-guest-failure`)
        throw error
      } finally {
        await closeAll(players)
      }
    })
  }
}
