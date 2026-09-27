// Frame sampler: creates a bot table, installs a per-frame sampler, runs an
// action, and prints how chosen values moved frame by frame (spot pops/snaps).
// Usage: node scripts/anim-probe.mjs <probeName>
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const name = process.argv[2] ?? 'start'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function clickVisible(page, label) {
  const locator = page.getByRole('button', { name: label })
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 1500 }).then(() => true, () => false)) return true
    }
  }
  return false
}
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(1500)
await page.evaluate(() => {
  window.__samples = []
  const stage = document.querySelector('.desktop-3d-stage')
  const tick = () => {
    const runtime = stage.__pokerRuntime
    const cam = runtime.camera
    window.__samples.push({
      t: +(performance.now() / 1000).toFixed(3),
      w: stage.clientWidth, h: stage.clientHeight,
      fov: +cam.fov.toFixed(2),
      cx: +cam.position.x.toFixed(3), cy: +cam.position.y.toFixed(3), cz: +cam.position.z.toFixed(3),
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await sleep(500)
await clickVisible(page, /^(Start game|Deal next hand)$/i)
await sleep(3000)
const samples = await page.evaluate(() => window.__samples)
let prev = null
for (const s of samples) {
  if (!prev || s.w !== prev.w || s.h !== prev.h || s.fov !== prev.fov || Math.abs(s.cz - prev.cz) > 0.02 || Math.abs(s.cy - prev.cy) > 0.02) console.log(JSON.stringify(s))
  prev = s
}
console.log('frames', samples.length)
await browser.close()
