// First-person drink check: the host orders drinks and films their own view.
// Usage: node scripts/snap-hero-drink.mjs <outDir> [beer|water]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/hero-drink'
const kind = process.argv[3] ?? 'beer'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2000 }).then(() => true, () => false)) return true
    }
  }
  return false
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'networkidle' })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
await sleep(1500)
await clickVisible(page, 'Fill seats')
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await clickVisible(page, /^Start game$/)
await sleep(4000)
const ordered = await clickVisible(page, kind === 'water' ? /water/i : /beer/i)
console.log('ordered', ordered)
await sleep(250)
console.log('hero drink', await page.evaluate(() => { const r = document.querySelector('.desktop-3d-stage')?.__pokerRuntime; const seat = r && [...r.seats.values()].find(s => s.isHero); return seat ? { kind: seat.drinkProp?.kind, since: +((performance.now() - r.startTime) / 1000 - seat.drinkStartedAt).toFixed(2), fp: r.firstPersonDrink.root.visible } : 'no hero seat' }))
console.log('failed toast', await page.locator('[role=alert], .feedback-toast').allInnerTexts().catch(() => []))
const started = Date.now()
for (let frame = 0; frame < 14; frame += 1) {
  const at = ((Date.now() - started) / 1000).toFixed(2)
  await page.screenshot({ path: path.join(outDir, `f${String(frame).padStart(2, '0')}-${at}s.png`) })
}
console.log('done')
await browser.close()
