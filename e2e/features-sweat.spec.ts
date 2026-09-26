import { expect, test } from '@playwright/test'
import {
  actionButton,
  addBots,
  checkOrCall,
  clickStartGame,
  closeAll,
  otherViewport,
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

const askName = (name: string) => `Ask ${name} for permission to see their cards`

for (const viewport of ['desktop', 'mobile'] as ViewportName[]) {
  test(`folded player asks to sweat hands: consent, allow, deny, badges, privacy, expiry (${viewport} folder)`, async ({ browser }) => {
    // Seats 0,1,2 in join order. Three-handed, the button (seat 1) acts first preflop.
    const players = await startTable(browser, 'Sw', [otherViewport(viewport), viewport, otherViewport(viewport)], {
      actionTimerSeconds: 60,
      nextHandDelaySeconds: 4,
    })
    const [host, folderSeat, third] = players as [Player, Player, Player]
    try {
      await clickStartGame(host.page)
      await Promise.all(players.map(player => waitForPhase(player.page, 'in_hand')))
      const folder = await waitForTurn(players)
      expect(folder, 'the button (seat 1) acts first three-handed').toBe(folderSeat)
      const [allow, deny] = players.filter(player => player !== folder) as [Player, Player]

      // Nobody sees ask buttons before folding.
      for (const player of players) {
        await expect(visible(player.page.getByRole('button', { name: /for permission to see their cards/ }))).toHaveCount(0)
      }

      await actionButton(folder.page, 'fold').click()
      await waitForSnapshot(folder, (_, tap) => tap.me()?.status === 'folded', 'folded')

      // Folder can ask both live players; live players get no ask buttons.
      const askAllow = visible(folder.page.getByRole('button', { name: askName(allow.name) })).first()
      const askDeny = visible(folder.page.getByRole('button', { name: askName(deny.name) })).first()
      await expect(askAllow).toBeVisible()
      await expect(askDeny).toBeVisible()
      for (const live of [allow, deny]) {
        await expect(visible(live.page.getByRole('button', { name: /for permission to see their cards/ }))).toHaveCount(0)
      }

      // Ask -> pending badge -> consent prompt only for the target -> allow -> shown.
      await askAllow.click()
      await expect(visible(folder.page.getByRole('button', { name: `${allow.name}: Waiting` })).first()).toBeDisabled()
      const prompt = allow.page.getByRole('alertdialog', { name: `${folder.name} wants to see your cards` })
      await expect(prompt).toBeVisible()
      await expect(prompt).toContainText(`Only ${folder.name} will see them`)
      await expect(deny.page.getByRole('alertdialog')).toHaveCount(0)
      await prompt.getByRole('button', { name: 'Allow this hand' }).click()
      await expect(prompt).toBeHidden()
      await expect(visible(folder.page.getByRole('button', { name: `${allow.name}: Shown` })).first()).toBeDisabled()
      await waitForSnapshot(folder, (_, tap) => tap.player(allow.tap.yourId)?.holeCards?.length === 2, 'approved cards delivered to the folder')
      await expect(seatRevealedCards(folder, { id: allow.tap.yourId, name: allow.name })).toHaveCount(2)
      const approvedCards = JSON.stringify(allow.tap.me().holeCards)
      expect(JSON.stringify(folder.tap.player(allow.tap.yourId).holeCards)).toBe(approvedCards)
      // Privacy: the other live player still cannot see them.
      expect(deny.tap.player(allow.tap.yourId)?.holeCards).toBeUndefined()
      await expect(seatRevealedCards(deny, { id: allow.tap.yourId, name: allow.name })).toHaveCount(0)

      // Ask -> deny -> hidden.
      await askDeny.click()
      const denyPrompt = deny.page.getByRole('alertdialog', { name: `${folder.name} wants to see your cards` })
      await expect(denyPrompt).toBeVisible()
      await denyPrompt.getByRole('button', { name: 'Keep hidden' }).click()
      await expect(visible(folder.page.getByRole('button', { name: `${deny.name}: Hidden` })).first()).toBeDisabled()
      await waitForSnapshot(folder, state => state.cardRevealRequests?.some((request: { targetId: string; status: string }) => (
        request.targetId === deny.tap.yourId && request.status === 'denied'
      )), 'denied request recorded')
      expect(folder.tap.player(deny.tap.yourId)?.holeCards).toBeUndefined()

      // Play the hand out; the approval lasts through the reveal window only.
      while (true) {
        const phase = await tableScene(host.page).getAttribute('data-phase')
        if (phase !== 'in_hand') break
        const actor = await waitForTurn([allow, deny], 60_000).catch(() => null)
        if (!actor) break
        await checkOrCall(actor)
        await actor.page.waitForTimeout(300)
      }
      await waitForSnapshot(folder, state => state.handNumber === 2 && state.phase === 'in_hand', 'next hand dealt', 90_000)
      expect(folder.tap.player(allow.tap.yourId)?.holeCards).toBeUndefined()
      expect(folder.tap.snapshot.cardRevealRequests ?? []).toEqual([])
      expect(players.flatMap(player => player.tap.failures)).toEqual([])
    } catch (error) {
      for (const player of players) await snap(player.page, `sweat-${viewport}-${player.name}-failure`)
      throw error
    } finally {
      await closeAll(players)
    }
  })

  test(`folded player instantly sees a bot's cards (${viewport} folder)`, async ({ browser }) => {
    const players = await startTable(browser, 'Bs', [otherViewport(viewport), viewport], {
      actionTimerSeconds: 60,
    })
    const [host, folderSeat] = players as [Player, Player]
    try {
      await addBots(host.page, 'Add bot')
      await expect(tableScene(host.page)).toHaveAttribute('data-player-count', '3')
      await waitForSnapshot(host, state => state.players.some((p: { isBot?: boolean }) => p.isBot), 'bot seated')
      const bot = host.tap.snapshot.players.find((p: { isBot?: boolean }) => p.isBot) as { id: string; nickname: string }

      await clickStartGame(host.page)
      const folder = await waitForTurn(players)
      expect(folder).toBe(folderSeat)
      await actionButton(folder.page, 'fold').click()

      const see = visible(folder.page.getByRole('button', { name: `See ${bot.nickname}'s cards` })).first()
      await expect(see).toBeVisible()
      await see.click()
      await expect(visible(folder.page.getByRole('button', { name: `${bot.nickname}: Shown` })).first()).toBeVisible()
      await waitForSnapshot(folder, (_, tap) => tap.player(bot.id)?.holeCards?.length === 2, 'bot cards visible')
      await expect(seatRevealedCards(folder, { id: bot.id, name: bot.nickname })).toHaveCount(2)
      expect(host.tap.player(bot.id)?.holeCards).toBeUndefined()
      expect(players.flatMap(player => player.tap.failures)).toEqual([])
    } catch (error) {
      for (const player of players) await snap(player.page, `sweat-bot-${viewport}-${player.name}-failure`)
      throw error
    } finally {
      await closeAll(players)
    }
  })
}
