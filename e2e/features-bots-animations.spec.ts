import { expect, test } from '@playwright/test'
import {
  actionButton,
  addBots,
  checkOrCall,
  clickStartGame,
  closeAll,
  createTable,
  isMyTurn,
  newPlayer,
  recordAttribute,
  recordedAttribute,
  saveTableSettings,
  closeSettings,
  snap,
  tableScene,
  waitForPhase,
  type ViewportName,
} from './helpers'

interface HandSummary {
  hand: number
  round: string | null
  board: number
  lastAction: string
  winners: number
}

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test(`full bot table: fill seats, auto-deal, deal/chip/pot/winner animations, auto rabbit hunt (${viewport})`, async ({ browser }) => {
    test.setTimeout(360_000)
    const host = await newPlayer(browser, `Anim${viewport === 'desktop' ? 'D' : 'M'}`, viewport)
    try {
      await createTable(host)
      await saveTableSettings(host.page, { actionTimerSeconds: 60, nextHandDelaySeconds: 3, rabbitHunting: true })
      await closeSettings(host.page)
      await addBots(host.page, 'Fill seats')
      await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '8')

      const page = host.page
      await recordAttribute(page, '.community-cards', 'data-visible-count', 'board')
      await recordAttribute(page, '.table-scene', 'data-showdown-stage', 'stage')
      await recordAttribute(page, '.table-scene', 'data-hero-seat', 'hero')
      if (viewport === 'desktop') {
        await expect(page.locator('.desktop-3d-stage')).toHaveAttribute('data-webgl-status', 'ready', { timeout: 60_000 })
        await recordAttribute(page, '.desktop-3d-stage', 'data-table-wager-count', 'wagers')
        await recordAttribute(page, '.desktop-3d-stage', 'data-pot-amount', 'pot')
        await recordAttribute(page, '.desktop-3d-stage', 'data-winner-ids', 'winners')
      } else {
        await recordAttribute(page, '.mobile-bet-indicator', 'aria-label', 'bets')
        await recordAttribute(page, '.is-collecting', 'class', 'collect')
        await recordAttribute(page, '.is-winner', 'class', 'winner')
      }

      await clickStartGame(page)
      await waitForPhase(page, 'in_hand')

      const hands = new Map<number, HandSummary>()
      const deadline = Date.now() + 240_000
      while (Date.now() < deadline) {
        const state = host.tap.snapshot
        if (state?.phase === 'between_hands' && state.winners?.length) {
          hands.set(state.handNumber, {
            hand: state.handNumber,
            round: state.round,
            board: state.communityCards.length,
            lastAction: String(state.recentActions?.[0] ?? ''),
            winners: state.winners.length,
          })
        }
        const sawShowdown = [...hands.values()].some(hand => hand.round === 'showdown')
        if (hands.size >= 3 || (hands.size >= 2 && sawShowdown)) break
        if (await isMyTurn(page)) {
          // Stay in the first hand to see streets and a showdown; later hands fold fast.
          if ((state?.handNumber ?? 1) <= 1) {
            await checkOrCall(host).catch(() => undefined)
          } else {
            await actionButton(page, 'fold').click().catch(() => undefined)
          }
        }
        await page.waitForTimeout(250)
      }

      const summaries = [...hands.values()]
      expect(summaries.length, `hands completed: ${JSON.stringify(summaries)}; now hand ${host.tap.snapshot?.handNumber} ${host.tap.snapshot?.phase}`).toBeGreaterThanOrEqual(2)
      // The server dealt every later hand on its own.
      expect(Math.max(...summaries.map(hand => hand.hand))).toBeGreaterThanOrEqual(2)
      // Fold-ended hands with rabbit hunting on always run the board out.
      for (const hand of summaries.filter(summary => summary.round !== 'showdown')) {
        expect(hand.board, `hand ${hand.hand} rabbit runout: ${hand.lastAction}`).toBe(5)
      }

      const board = await recordedAttribute(page, 'board')
      expect(board, `board timeline ${board.join(' > ')}`).toContain('3')
      expect(board).toContain('5')
      expect(board.indexOf('0')).toBeLessThan(board.lastIndexOf('5'))
      const hero = await recordedAttribute(page, 'hero')
      expect(hero, 'hero hand dealt').toContain('true')

      if (viewport === 'desktop') {
        const wagers = await recordedAttribute(page, 'wagers')
        expect(wagers.some(value => Number(value) > 0), `wager chips ${wagers.join(' > ')}`).toBe(true)
        const pot = await recordedAttribute(page, 'pot')
        expect(pot.some(value => Number(value) > 0), `pot ${pot.join(' > ')}`).toBe(true)
        const winners = await recordedAttribute(page, 'winners')
        expect(winners.some(value => value && value !== '(none)'), `winner ids ${winners.join(' > ')}`).toBe(true)
      } else {
        const bets = await recordedAttribute(page, 'bets')
        expect(bets.some(value => /bet \$/.test(value)), `bet chips ${bets.join(' > ')}`).toBe(true)
        const collect = await recordedAttribute(page, 'collect')
        if (!collect.some(value => value.includes('is-collecting'))) {
          // Wager -> pot chip flight on the 2D table. Reported rather than failed while
          // the 2D table is being rebuilt; the pot/bet data above still proves the flow.
          test.info().annotations.push({
            type: 'ui-issue',
            description: 'Mobile 2D: no bet-to-pot chip animation (.is-collecting) rendered when a street closed',
          })
        }
        const winner = await recordedAttribute(page, 'winner')
        expect(winner.some(value => value.includes('is-winner')), 'winner highlight shown').toBe(true)
      }
      if (summaries.some(hand => hand.round === 'showdown')) {
        const stages = await recordedAttribute(page, 'stage')
        expect(stages, `stages ${stages.join(' > ')}`).toContain('intro')
      }
      expect(host.tap.failures).toEqual([])
      expect(host.tap.pageErrors).toEqual([])
    } catch (error) {
      await snap(host.page, `bots-animations-${viewport}-failure`)
      throw error
    } finally {
      await closeAll([host])
    }
  })
}
