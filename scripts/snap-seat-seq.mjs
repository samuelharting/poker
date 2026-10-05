// Frame sequence of one bot's upper body through a hand (development builds only).
// Usage: node scripts/snap-seat-seq.mjs <outDir> [frames] [intervalMs] [seatIndex]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/seat-seq'
const frames = Number(process.argv[3] ?? 30)
const interval = Number(process.argv[4] ?? 600)
const seatIndex = Number(process.argv[5] ?? 2)
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
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await sleep(1500)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
await clickVisible(page, /^Start game$/)
await sleep(2500)
const cam = await page.evaluate(index => {
  const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const seats = [...rt.seats.values()].filter(s => s.root.visible && s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
  const seat = seats[Math.min(index, seats.length - 1)]
  const p = seat.root.position
  const toward = Math.hypot(p.x, p.z) || 1
  const dist = 2.5
  return {
    position: [p.x - (p.x / toward) * dist, 1.95, p.z - (p.z / toward) * dist],
    lookAt: [p.x - (p.x / toward) * 0.3, 1.2, p.z - (p.z / toward) * 0.3],
    fov: 42,
  }
}, seatIndex)
await page.evaluate(c => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = c }, cam)
for (let frame = 0; frame < frames; frame += 1) {
  await clickVisible(page, /^(Check|Call)/)
  await clickVisible(page, /^Deal next hand$/)
  await page.screenshot({ path: path.join(outDir, `f-${String(frame).padStart(3, '0')}.png`) })
  await sleep(interval)
}
await browser.close()
