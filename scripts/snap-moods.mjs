// Expression sheet: pins one avatar's face to each mood in turn and photographs it (development builds only).
// Usage: node scripts/snap-moods.mjs <outDir> [seatIndex]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/moods'
const seatIndex = Number(process.argv[3] ?? 2)
const MOODS = (process.env.MOODS ?? 'neutral,focused,stern,happy,laugh,smirk,surprised,worried,sad,bored,grimace,yawn,asleep').split(',')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500 }).then(() => true, () => false)) return true
    }
  }
  return false
}
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } })
await page.setViewportSize({ width: 1440, height: 900 })
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
// The chosen seat; the camera re-aims at its live head before every shot.
const setup = await page.evaluate(index => {
  const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const seats = [...rt.seats.values()].filter(s => s.root.visible && s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
  return seats[Math.min(index, seats.length - 1)].playerId
}, seatIndex)
const aim = id => page.evaluate(id => {
  const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const seat = rt.seats.get(id)
  const head = seat.avatar.bones.get('Head')
  const v = head.getWorldPosition(new head.position.constructor())
  const toward = Math.hypot(v.x, v.z) || 1
  rt.debugCamera = { position: [v.x - (v.x / toward) * 1.55, v.y + 0.34, v.z - (v.z / toward) * 1.55], lookAt: [v.x, v.y + 0.12, v.z], fov: 30 }
}, id)
for (const mood of MOODS) {
  await page.evaluate(({ id, mood }) => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const seat = rt.seats.get(id)
    seat.debugMood = mood
  }, { id: setup, mood })
  await sleep(900)
  await aim(setup)
  await sleep(250)
  await page.screenshot({ path: path.join(outDir, `${mood}.png`) })
  console.log('saved', mood)
}
await browser.close()
