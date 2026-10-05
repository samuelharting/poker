// Waits for a table-talk exchange and photographs the speaker and listener (development builds only).
// Usage: node scripts/snap-chat.mjs <outDir> [frames]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/chat'
const frames = Number(process.argv[3] ?? 8)
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
await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
// Wait for a conversation with both sides present.
let pair = null
for (let attempt = 0; attempt < 120 && !pair; attempt += 1) {
  pair = await page.evaluate(() => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const seats = [...rt.seats.values()]
    const speaker = seats.find(s => s.chat?.role === 'speak')
    const listener = seats.find(s => s.chat?.role === 'listen')
    if (!speaker || !listener) return null
    const head = s => { const v = s.avatar.bones.get('Head').getWorldPosition(new (s.avatar.bones.get('Head').position.constructor)()); return [v.x, v.y, v.z] }
    return { speaker: speaker.playerId, listener: listener.playerId, a: head(speaker), b: head(listener), d: speaker.chat.duration }
  })
  if (!pair) await sleep(500)
}
console.log('pair', JSON.stringify(pair))
if (pair) {
  const mid = pair.a.map((v, i) => (v + pair.b[i]) / 2)
  const span = Math.hypot(pair.a[0] - pair.b[0], pair.a[2] - pair.b[2])
  const toward = Math.hypot(mid[0], mid[2]) || 1
  const dist = 2.2 + span * 0.9
  const cam = { position: [mid[0] - (mid[0] / toward) * dist, mid[1] + 0.35, mid[2] - (mid[2] / toward) * dist], lookAt: [mid[0], mid[1] - 0.25, mid[2]], fov: 42 }
  await page.evaluate(c => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = c }, cam)
  for (let frame = 0; frame < frames; frame += 1) {
    await page.screenshot({ path: path.join(outDir, `chat-${String(frame).padStart(2, '0')}.png`) })
    await sleep(450)
  }
}
await browser.close()
