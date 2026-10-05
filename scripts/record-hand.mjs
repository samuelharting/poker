// Records a full desktop hand as video from the host's seat while a guest
// drinks twice and flicks the host off, then extracts a frame contact sheet.
// Usage: node scripts/record-hand.mjs <outDir>
// Needs ffmpeg on PATH or FFMPEG=<path>.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/video'
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
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
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
})
const host = await hostContext.newPage()
host.on('pageerror', error => console.log('host pageerror:', error.message))
await host.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await host.getByLabel('Your nickname').fill('Host')
await host.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await host.waitForURL(/\/room\//)
const roomUrl = host.url()

const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const guest = await guestContext.newPage()
await guest.goto(roomUrl, { waitUntil: 'load', timeout: 120000 })
await guest.getByLabel('Your nickname').fill('Drinker')
await guest.getByRole('button', { name: 'Enter Room' }).click()
await sleep(3000)
// Seat restoration can briefly disable Fill seats; retry until the bots sit.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await host.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 6) break
  await clickVisible(host, 'Fill seats')
  await sleep(700)
}
await host.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(1500)
await host.evaluate(() => { window.__recordStart = performance.now() })
// The table may be between hands (auto-deal off): either button starts play.
for (let attempt = 0; attempt < 20; attempt += 1) {
  const phase = await host.locator('.desktop-3d-stage').first().getAttribute('data-phase').catch(() => '')
  if (phase === 'in_hand') break
  await clickVisible(host, /^(Start game|Deal next hand)$/i)
  await sleep(600)
}

const events = []
const mark = label => events.push({ label, at: Date.now() })
const t0 = Date.now()
mark('start')
let drank = 0
let flipped = false
const deadline = Date.now() + 70000
while (Date.now() < deadline) {
  const elapsed = Date.now() - t0
  if (drank === 0 && elapsed > 5000) { await clickVisible(guest, /beer/i); drank = 1; mark('beer 1') }
  if (!flipped && elapsed > 11000) {
    const plate = guest.locator('[data-seat-player]').filter({ hasText: 'Host' }).first()
    await plate.click({ timeout: 1500 }).catch(() => {})
    await sleep(300)
    flipped = await clickVisible(guest, /Send middle finger to Host/)
    if (!flipped) flipped = await clickVisible(guest, /🖕/)
    await guest.keyboard.press('Escape').catch(() => {})
    mark(flipped ? 'flip' : 'flip failed')
    flipped = true
  }
  if (drank === 1 && elapsed > 18000) { await clickVisible(guest, /beer/i); drank = 2; mark('beer 2') }
  await clickVisible(host, /^(Check|Call)/)
  await clickVisible(guest, /^(Check|Call)/)
  const phase = await host.locator('[data-phase]').first().getAttribute('data-phase').catch(() => '')
  if (phase === 'between_hands' && elapsed > 20000) { mark('showdown'); await sleep(6000); break }
  await sleep(350)
}
mark('end')
const video = host.video()
await hostContext.close()
await guestContext.close()
await browser.close()

const videoPath = await video.path()
const finalPath = path.join(outDir, 'hand.webm')
await rename(videoPath, finalPath)
for (const event of events) console.log(`${((event.at - t0) / 1000).toFixed(1)}s ${event.label}`)

// Contact sheets: 2 fps, 4x3 tiles, 640px wide frames.
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', finalPath, '-vf', 'fps=2,scale=640:-1,tile=4x3', path.join(outDir, 'sheet-%02d.png')])
console.log('sheets', (await readdir(outDir)).filter(name => name.startsWith('sheet')).length)
