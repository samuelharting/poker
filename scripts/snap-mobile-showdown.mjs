// Phone showdown check: iPhone 13 viewport, full table, the hero folds and we
// screenshot the hand result (between hands) to confirm the table still fits
// while the action tray's footprint is held.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/snap-mobile-showdown.mjs [out.png]
import { chromium, devices } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'output/mobile-showdown.png'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await chromium.launch()
const context = await browser.newContext({ ...devices[process.env.DEVICE ?? 'iPhone 13'] })
const page = await context.newPage()
await page.goto(appUrl)
await page.getByLabel('Your nickname').fill('Phone')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
for (let attempt = 0; attempt < 30; attempt += 1) {
  const seats = await page.evaluate(() => Number(document.querySelector('.table-scene')?.getAttribute('data-player-count') ?? 0))
  if (seats >= 6) break
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Fill seats')?.click())
  await sleep(800)
}
await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Start game')?.click())
const deadline = Date.now() + 150_000
while (Date.now() < deadline) {
  const done = await page.evaluate(() => {
    const scene = document.querySelector('.table-scene')
    document.querySelector('button[data-action="fold"]:not(:disabled)')?.click()
    return scene?.getAttribute('data-phase') === 'between_hands'
  })
  if (done) break
  await sleep(500)
}
await sleep(2500)
await page.screenshot({ path: out })
console.log(out)
await browser.close()
