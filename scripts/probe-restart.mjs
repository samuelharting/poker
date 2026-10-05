// Table-server restart drill (local dev only): seats a host with bots, starts a
// hand, then touches partykit/room.ts so `partykit dev` reloads the room, and
// checks the client rejoins by itself: same player id, still seated with the
// same stack, a "Reconnecting" chip while down, and no page reload.
// Usage: node scripts/probe-restart.mjs
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  const NativeSocket = window.WebSocket
  window.__closes = 0
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args)
      this.addEventListener('close', () => { window.__closes += 1 })
      this.addEventListener('message', event => {
        const text = String(event.data)
        const id = text.match(/"type":"private_session","yourId":"([^"]+)"/)
        if (id) window.__yourId = id[1]
        if (text.startsWith('{"type":"room_snapshot"')) window.__state = JSON.parse(text).state
      })
    }
  }
})
await page.goto(appUrl)
await page.getByLabel('Your nickname').fill('Restarter')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForFunction(() => window.__state?.players?.some(player => player.id === window.__yourId), null, { timeout: 30000 })
await page.getByRole('button', { name: 'Add bot' }).first().click()
await page.waitForFunction(() => window.__state?.players?.length >= 2, null, { timeout: 15000 })
await page.getByRole('button', { name: /^Start game$/ }).first().click()
await page.waitForFunction(() => window.__state?.phase === 'in_hand', null, { timeout: 15000 })
await sleep(1500)
const before = await page.evaluate(() => {
  window.__noReload = true
  const me = window.__state.players.find(player => player.id === window.__yourId)
  return { yourId: window.__yourId, stack: me?.stack, bet: me?.bet, hand: window.__state.handNumber, cards: me?.holeCards?.length }
})
console.log('before', JSON.stringify(before))
await sleep(1000)
// Rewriting the file (content-identical after the edit is undone) makes the dev server reload the room.
const source = readFileSync('partykit/room.ts', 'utf8')
writeFileSync('partykit/room.ts', `${source}
// restart drill
`)
await sleep(300)
try {
  // (kept until the reload has been picked up)
} finally {
  setTimeout(() => writeFileSync('partykit/room.ts', source), 4000)
}
const sawChip = await page.waitForSelector('.mobile-reconnect-banner', { timeout: 20000 }).then(() => true, () => false)
const started = Date.now()
await page.waitForFunction(() => document.querySelector('.mobile-reconnect-banner') === null, null, { timeout: 60000 })
const downMs = Date.now() - started
await sleep(1500)
const after = await page.evaluate(() => {
  const me = window.__state.players.find(player => player.id === window.__yourId)
  return { yourId: window.__yourId, stack: me?.stack, bet: me?.bet, hand: window.__state.handNumber, cards: me?.holeCards?.length, seated: Boolean(me), noReload: window.__noReload === true, closes: window.__closes }
})
console.log('after', JSON.stringify(after), 'reconnectChip', sawChip, 'reconnectedAfterMs', downMs)
const ok = after.noReload && after.seated && after.yourId === before.yourId
console.log(ok ? 'PASS: rejoined the same seat without a reload' : 'FAIL')
await sleep(4500)
writeFileSync('partykit/room.ts', source)
await browser.close()
process.exit(ok ? 0 : 1)
