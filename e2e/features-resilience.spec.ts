import { expect, test } from '@playwright/test'
import {
  actionButton,
  addBots,
  clickStartGame,
  closeAll,
  createTable,
  joinTable,
  newPlayer,
  waitForPhase,
  type Player,
} from './helpers'

/** Keep a handle on the page's PartyKit socket so a test can speak raw protocol. */
async function captureSocket(player: Player) {
  await player.context.addInitScript(() => {
    const NativeSocket = window.WebSocket
    window.WebSocket = class extends NativeSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args)
        if (String(args[0]).includes('/parties/')) {
          ;(window as unknown as { __roomSocket?: WebSocket }).__roomSocket = this
        }
      }
    }
  })
}

test('a lost WebGL context rebuilds the 3D table by itself', async ({ browser }) => {
  const host = await newPlayer(browser, 'GlHostD', 'desktop')
  try {
    await createTable(host)
    const stage = host.page.locator('.desktop-3d-stage')
    await expect(stage).toHaveAttribute('data-webgl-status', 'ready', { timeout: 60_000 })
    await expect(stage).toHaveAttribute('data-scene-ready', 'true', { timeout: 60_000 })
    const lost = await host.page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.desktop-3d-canvas')
      const gl = canvas?.getContext('webgl2')
      const extension = gl?.getExtension('WEBGL_lose_context')
      if (!extension) return false
      ;(canvas as HTMLCanvasElement & { __old?: boolean }).__old = true
      extension.loseContext()
      return true
    })
    test.skip(!lost, 'WEBGL_lose_context unavailable')
    // A fresh canvas (the lost one can never make a new context) comes up rendering.
    await expect.poll(() => host.page.evaluate(() => {
      const canvas = document.querySelector('.desktop-3d-canvas') as (HTMLCanvasElement & { __old?: boolean }) | null
      return Boolean(canvas && !canvas.__old)
    }), { timeout: 15_000 }).toBe(true)
    await expect(stage).toHaveAttribute('data-webgl-status', 'ready', { timeout: 15_000 })
    await expect(host.page.locator('.three-webgl-status.is-error')).toHaveCount(0)
    expect(host.tap.pageErrors).toEqual([])
  } finally {
    await closeAll([host])
  }
})

test('a server rejection shows a small notice instead of vanishing', async ({ browser }) => {
  const host = await newPlayer(browser, 'RejHostD', 'desktop')
  const guest = await newPlayer(browser, 'RejP1M', 'mobile')
  await captureSocket(guest)
  try {
    const { roomUrl } = await createTable(host)
    await joinTable(guest, roomUrl)
    // Only the host may deal: the guest's raw start_game is refused.
    await guest.page.evaluate(() => {
      ;(window as unknown as { __roomSocket: WebSocket }).__roomSocket.send(JSON.stringify({ type: 'start_game' }))
    })
    const notice = guest.page.locator('.membership-notice[data-kind="error"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/Only the game creator can/)
    // And it clears itself.
    await expect(notice).toBeHidden({ timeout: 10_000 })
  } finally {
    await closeAll([host, guest])
  }
})

test('a double-clicked action is sent once', async ({ browser }) => {
  const host = await newPlayer(browser, 'DblHostD', 'desktop')
  // Each action is keyed to the turn it was sent in (per the latest snapshot):
  // a turn may only ever get one, and only when it is ours.
  const sent: string[] = []
  host.page.on('websocket', ws => {
    if (!ws.url().includes('/parties/')) return
    ws.on('framesent', frame => {
      const raw = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
      if (!raw.includes('"player_action"')) return
      const state = host.tap.snapshot
      sent.push(`${state?.handNumber}:${state?.round}:${state?.actingPlayerId === host.tap.yourId ? 'mine' : 'NOT MINE'}:${state?.currentBet}`)
    })
  })
  try {
    await createTable(host)
    await addBots(host.page, 'Add bot')
    await expect.poll(() => host.tap.snapshot?.players?.length ?? 0).toBe(2)
    await clickStartGame(host.page)
    await waitForPhase(host.page, 'in_hand')
    await expect.poll(() => host.tap.snapshot?.actingPlayerId === host.tap.yourId, { timeout: 45_000 }).toBe(true)
    const button = actionButton(host.page, host.tap.snapshot.currentBet > (host.tap.me()?.bet ?? 0) ? 'call' : 'check')
    await button.dblclick()
    await host.page.keyboard.press('c')
    await host.page.waitForTimeout(1_500)
    expect(sent.length).toBeGreaterThanOrEqual(1)
    expect(sent.filter(key => key.includes('NOT MINE'))).toEqual([])
    expect(new Set(sent).size, `one action per turn: ${sent.join(' | ')}`).toBe(sent.length)
  } finally {
    await closeAll([host])
  }
})
