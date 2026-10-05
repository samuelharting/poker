// Lady Luck in the real desktop 3D table: plays (folds) hands with bots until
// somebody's win streak summons her, then frames her with the dev-only
// runtime.debugCamera for front and 3/4 close-ups.
//
// Usage: node scripts/snap-lady-live.mjs <outDir> [maxMinutes]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/lady-live'
const maxMinutes = Number(process.argv[3] ?? 10)
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'networkidle' })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
await sleep(2500)
await clickVisible(page, 'Fill seats')
await sleep(1500)
await clickVisible(page, /^Start game$/)

const visible = () => page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  return Boolean(runtime?.companion?.group.visible)
}).catch(() => false)

const deadline = Date.now() + maxMinutes * 60000
let found = false
while (Date.now() < deadline) {
  if (await visible()) {
    found = true
    break
  }
  // Stay out of the way (fold when it's our turn) so the bots settle hands fast.
  await clickVisible(page, /^Fold/)
  await clickVisible(page, /^(Next hand|Deal|Continue)/)
  await sleep(700)
}
if (!found) {
  console.log('Lady Luck never showed up')
  await page.screenshot({ path: path.join(outDir, 'timeout.png') })
  await browser.close()
  process.exit(1)
}
await sleep(3500) // let her finish the entrance
await page.screenshot({ path: path.join(outDir, 'live-overview.png') })

const info = await page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const group = runtime.companion.group
  let meshes = 0
  group.traverse(object => { if (object.isMesh && object.visible) meshes += 1 })
  return { position: group.position.toArray(), yaw: group.rotation.y, scale: group.scale.x, meshes, calls: runtime.renderer.info.render.calls }
})
console.log('lady', JSON.stringify(info))

const frame = (name, orbit, distance, height, fov) => page.evaluate(({ orbit, distance, height, fov }) => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const group = runtime.companion.group
  const p = group.position
  const s = group.scale.x
  const yaw = group.rotation.y + orbit
  runtime.debugCamera = {
    position: [p.x + Math.sin(yaw) * distance * s, p.y + (height + 0.25) * s, p.z + Math.cos(yaw) * distance * s],
    lookAt: [p.x, p.y + height * s, p.z],
    fov,
  }
}, { orbit, distance, height, fov }).then(() => sleep(700)).then(() => page.screenshot({ path: path.join(outDir, `${name}.png`) }))

await frame('live-front', 0, 4.4, 1.3, 36)
await frame('live-three-quarter', 0.75, 4.4, 1.3, 36)
await frame('live-face', 0.25, 1.4, 2.2, 32)
await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = null })
await sleep(800)
await page.screenshot({ path: path.join(outDir, 'live-table.png') })
console.log('done')
await browser.close()
