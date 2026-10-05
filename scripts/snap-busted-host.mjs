// Repro for the busted desktop host: the host zeroes their own stack between
// hands (host chip adjust) and we count the rebuy prompts on screen.
// Usage: POKER_APP_URL=http://localhost:3000 node scripts/snap-busted-host.mjs [out.png]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'output/busted-host.png'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  const NativeSocket = window.WebSocket
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args)
      window.__socket = this
      this.addEventListener('message', event => {
        const id = String(event.data).match(/"type":"private_session","yourId":"([^"]+)"/)
        if (id) window.__yourId = id[1]
        const state = String(event.data).startsWith('{"type":"room_snapshot"') ? JSON.parse(event.data).state : null
        if (state) window.__state = state
      })
    }
  }
})
await page.goto(appUrl)
await page.getByLabel('Your nickname').fill('Host')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForFunction(() => window.__yourId && window.__state?.players?.some(player => player.id === window.__yourId), null, { timeout: 30000 })
await page.getByRole('button', { name: 'Add bot' }).first().click().catch(() => {})
await sleep(1500)
const yourId = await page.evaluate(() => window.__yourId)
const stack = await page.evaluate(() => window.__state.players.find(player => player.id === window.__yourId).stack)
await page.evaluate(({ targetId, amount }) => window.__socket.send(JSON.stringify({ type: 'adjust_player_stack', targetId, amount })), { targetId: yourId, amount: -stack })
await sleep(2500)
const prompts = await page.evaluate(() => {
  const visible = element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
  }
  return {
    rebuyButtons: [...document.querySelectorAll('button')].filter(button => /^Rebuy/.test(button.textContent.trim()) && visible(button)).map(button => button.textContent.trim()),
    outOfChips: [...document.querySelectorAll('body *')].filter(element => element.children.length === 0 && /out of chips/i.test(element.textContent) && visible(element)).map(element => `${element.className}: ${element.textContent.trim()}`),
  }
})
console.log(JSON.stringify(prompts, null, 1))
await page.screenshot({ path: out })
await browser.close()
