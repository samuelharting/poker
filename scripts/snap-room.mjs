// Wide room shots from a set of debug cameras (development builds only).
// Usage: node scripts/snap-room.mjs <outDir> [waitSeconds]   Env: SHOTS=<json array of {name,position,lookAt,fov}>
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/room'
const waitSeconds = Number(process.argv[3] ?? 4)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const DEFAULT_SHOTS = [
  { name: 'wide-high', position: [0, 7.5, 8], lookAt: [0, 1, -2], fov: 55 },
  { name: 'left-wall', position: [0, 2.6, 2.5], lookAt: [-9, 2.2, -1], fov: 60 },
  { name: 'right-wall', position: [0, 2.6, 2.5], lookAt: [9, 2.2, -1], fov: 60 },
  { name: 'back-wall', position: [0, 2.8, 3.5], lookAt: [0, 2.4, -10], fov: 62 },
  { name: 'ceiling', position: [0, 2.2, 1], lookAt: [0, 6.5, -3], fov: 70 },
  { name: 'table-edge', position: [3.4, 1.5, 3.4], lookAt: [0, 0.7, 0], fov: 50 },
  { name: 'floor', position: [0, 3.2, 3], lookAt: [0, -0.5, -3], fov: 65 },
]
const shots = process.env.SHOTS ? JSON.parse(process.env.SHOTS) : DEFAULT_SHOTS

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
await clickVisible(page, /^Start game$/)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(waitSeconds * 1000)
await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
for (const shot of shots) {
  await page.evaluate(camera => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = camera }, shot)
  await sleep(700)
  await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) })
  console.log('saved', shot.name)
}
await browser.close()
