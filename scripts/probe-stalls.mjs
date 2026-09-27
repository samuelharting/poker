// Frame-stall probe: plays check/call through a few hands and reports every
// main-thread gap longer than 150ms, tagged with the hand phase it hit.
// Usage: node scripts/probe-stalls.mjs [hands]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const hands = Number(process.argv[2] ?? 2)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 1500 }).then(() => true, () => false)) return true
    }
  }
  return false
}

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
// Seat restoration can briefly disable Fill seats; retry until the bots sit.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await sleep(1500)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(2500)
await page.evaluate(() => {
  window.__stalls = []
  let last = performance.now()
  const tick = now => {
    const gap = now - last
    if (gap > 150) {
      const phase = document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? '?'
      const board = document.querySelector('.community-cards')?.getAttribute('data-visible-count') ?? '?'
      const winner = Boolean(document.querySelector('.winner-toast, .showdown-pill, [data-winner="true"]'))
      window.__stalls.push({ gap: Math.round(gap), phase, board, winner })
    }
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await clickVisible(page, /^Start game$/)

let handsSeen = 0
let lastBoard = 0
const deadline = Date.now() + 60000 * hands
while (Date.now() < deadline && handsSeen < hands) {
  const board = Number(await page.locator('.community-cards').first().getAttribute('data-visible-count').catch(() => 0))
  if (board < lastBoard) handsSeen += 1
  lastBoard = board
  await clickVisible(page, /^(Check|Call)/)
  await clickVisible(page, /^(Next hand|Deal next hand)/)
  await sleep(400)
}
await sleep(3000)
const stalls = await page.evaluate(() => window.__stalls)
console.log('hands', handsSeen, 'stalls', stalls.length)
for (const stall of stalls) console.log(JSON.stringify(stall))
console.log('max', Math.max(0, ...stalls.map(stall => stall.gap)))
await browser.close()
