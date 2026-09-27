// Films another player's avatar peeking at their hole cards in the desktop 3D
// room: a guest press-and-holds their cards, then quick-peeks, while the host's
// camera watches the guest's seat from the side (and from across the table).
// Usage: node scripts/snap-peek-3d.mjs <outDir>
import { chromium } from '@playwright/test'
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/peek-3d'
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
const hostContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
})
const host = await hostContext.newPage()
host.on('pageerror', error => console.log('host pageerror:', error.message))
await host.goto(appUrl, { waitUntil: 'networkidle' })
await host.getByLabel('Your nickname').fill('Host')
await host.getByRole('button', { name: 'Create Table' }).click()
await host.waitForURL(/\/room\//)
const roomUrl = host.url()

const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const guest = await guestContext.newPage()
await guest.goto(roomUrl, { waitUntil: 'networkidle' })
await guest.getByLabel('Your nickname').fill('Squeezer')
await guest.getByRole('button', { name: 'Enter Room' }).click()
await sleep(3000)
await clickVisible(host, 'Fill seats')
await host.waitForFunction(
  () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
  null,
  { timeout: 60000 }
).catch(() => {})
await sleep(1000)
const startDeadline = Date.now() + 30000
while (Date.now() < startDeadline && !(await guest.locator('.own-card-row.is-concealed').count())) {
  await clickVisible(host, /^Start game$/)
  await sleep(1000)
}
await guest.waitForSelector('.own-card-row.is-concealed', { timeout: 15000 })
await sleep(3500)

async function aimAt(view) {
  return host.evaluate(view => {
    const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
    const plate = [...document.querySelectorAll('[data-seat-player]')].find(el => el.textContent?.includes('Squeezer'))
    const seat = plate && runtime?.seats.get(plate.getAttribute('data-seat-player'))
    if (!seat) return 'no seat'
    const p = seat.root.position
    const toward = Math.hypot(p.x, p.z) || 1
    const ox = p.x / toward
    const oz = p.z / toward
    if (view === 'side') {
      const tx = -oz
      const tz = ox
      runtime.debugCamera = {
        position: [p.x + tx * 2.1 - ox * 1.0, 1.75, p.z + tz * 2.1 - oz * 1.0],
        lookAt: [p.x - ox * 0.55, 0.95, p.z - oz * 0.55],
        fov: 42,
      }
    } else if (view === 'across') {
      runtime.debugCamera = {
        position: [-ox * 2.4, 1.85, -oz * 2.4],
        lookAt: [p.x - ox * 0.4, 1.0, p.z - oz * 0.4],
        fov: 38,
      }
    } else {
      runtime.debugCamera = null
    }
    return 'ok'
  }, view)
}

const peekState = () => host.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  const plate = [...document.querySelectorAll('[data-seat-player]')].find(el => el.textContent?.includes('Squeezer'))
  const seat = plate && runtime?.seats.get(plate.getAttribute('data-seat-player'))
  return seat ? JSON.stringify({ peeking: seat.peeking, lift: +(seat.lastPose?.cardLift ?? 0).toFixed(2), folded: seat.folded }) : 'no seat'
})

for (const view of ['side', 'across']) {
  console.log('aim', view, await aimAt(view))
  await sleep(600)
  await host.screenshot({ path: path.join(outDir, `${view}-0-rest.png`) })
  const row = guest.locator('.own-card-row.is-concealed').first()
  const box = await row.boundingBox()
  await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await guest.mouse.down()
  for (const [index, ms] of [250, 450, 700, 1400].entries()) {
    await sleep(index === 0 ? ms : ms - [250, 450, 700, 1400][index - 1])
    console.log(view, 'hold', ms, await peekState())
    await host.screenshot({ path: path.join(outDir, `${view}-${index + 1}-hold-${ms}ms.png`) })
  }
  await sleep(600)
  await guest.mouse.up()
  await sleep(350)
  await host.screenshot({ path: path.join(outDir, `${view}-5-release-350ms.png`) })
  await sleep(900)
  await host.screenshot({ path: path.join(outDir, `${view}-6-settled.png`) })
  // Quick click peek.
  await row.click().catch(() => {})
  await sleep(600)
  console.log(view, 'quick', await peekState())
  await host.screenshot({ path: path.join(outDir, `${view}-7-quick.png`) })
  await sleep(1800)
}
await aimAt('none')

const video = host.video()
await hostContext.close()
await guestContext.close()
if (video) await rename(await video.path(), path.join(outDir, 'host-watching-peek.webm')).catch(() => {})
await browser.close()
console.log('done', outDir)
