// Drinks visual check: a guest orders beers while the host films their seat.
// Usage: node scripts/snap-drinks.mjs <outDir> [beers]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/drinks'
const beers = Number(process.argv[3] ?? 3)
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
const host = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await host.goto(appUrl, { waitUntil: 'networkidle' })
await host.getByLabel('Your nickname').fill('Host')
await host.getByRole('button', { name: 'Create Table' }).click()
await host.waitForURL(/\/room\//)
const roomUrl = host.url()

const guest = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await guest.goto(roomUrl, { waitUntil: 'networkidle' })
await sleep(1500)
await guest.screenshot({ path: path.join(outDir, 'guest-gate.png') })
await guest.getByLabel('Your nickname').fill('Drinker')
await guest.getByRole('button', { name: 'Enter Room' }).click()
await sleep(4000)
await clickVisible(host, 'Fill seats')
await sleep(1500)
await clickVisible(host, /^Start game$/)
await host.waitForFunction(
  () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
  null,
  { timeout: 60000 }
).catch(() => {})
await sleep(2000)

// Point the host's camera at the drinker's seat.
await host.evaluate(() => {
  const stage = document.querySelector('.desktop-3d-stage')
  const runtime = stage?.__pokerRuntime
  const plate = [...document.querySelectorAll('[data-seat-player]')].find(el => el.textContent?.includes('Drinker'))
  const seat = plate && runtime?.seats.get(plate.getAttribute('data-seat-player'))
  if (!seat) return
  const p = seat.root.position
  const toward = Math.hypot(p.x, p.z) || 1
  runtime.debugCamera = {
    position: [p.x - (p.x / toward) * 2.6, 2.3, p.z - (p.z / toward) * 2.6],
    lookAt: [p.x, 1.2, p.z],
    fov: 40,
  }
})

const probe = () => host.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  if (!runtime) return 'no runtime'
  runtime.__id ??= Math.random().toString(36).slice(2, 6)
  const plate = [...document.querySelectorAll('[data-seat-player]')].find(el => el.textContent?.includes('Drinker'))
  const seat = plate && runtime.seats.get(plate.getAttribute('data-seat-player'))
  if (!seat) return 'no seat'
  const time = (performance.now() - runtime.startTime) / 1000
  return JSON.stringify({
    rt: runtime.__id,
    elapsed: +(time - seat.drinkStartedAt).toFixed(2),
    visible: seat.drinkProp?.group.visible,
    inScene: Boolean(seat.drinkProp?.group.parent),
    lift: +(seat.lastPose?.drinkLift ?? 0).toFixed(2),
    acting: seat.acting,
    camera: Boolean(runtime.debugCamera),
  })
})

for (let beer = 0; beer < beers; beer += 1) {
  await clickVisible(guest, /beer/i)
  for (let frame = 0; frame < 4; frame += 1) {
    await sleep(550)
    if (process.env.PROBE) console.log('probe', beer, frame, await probe())
    await host.screenshot({ path: path.join(outDir, `beer${beer + 1}-f${frame}.png`) })
  }
  await sleep(2600)
}
await host.screenshot({ path: path.join(outDir, 'after.png') })
await guest.screenshot({ path: path.join(outDir, 'drinker-view.png') })
console.log('done')
await browser.close()
