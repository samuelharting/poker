// The winner's point beat in the real room with the real game camera (development builds only).
// Replays the real winner sequence on chosen bot seats (forces seat.winner on one seat at a time,
// restarts its winner clock, forces the point flair) and photographs the table view at set times.
// Usage: node scripts/snap-point-live.mjs <outDir>
// Env: SEATS=0,1,2,4 (bot index by visual seat)  AT=3.2,3.6,4.0,4.5,5.1,5.7 (seconds since the win, rake included; frozen there)  CAM=table|front
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v5/point/live'
const seats = (process.env.SEATS ?? '0,1,2,4').split(',').map(Number)
const at = (process.env.AT ?? '3.2,3.6,4.0,4.5,5.1,5.7').split(',').map(Number)
const camMode = process.env.CAM ?? 'table'
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
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.SNAP_WIDTH ?? 1280), height: Number(process.env.SNAP_HEIGHT ?? 720) } })
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
  await sleep(3000)
  await page.addStyleTag({ content: '.table-side-panels, .social-dock, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })
  if (process.env.REAL) await page.evaluate(() => { globalThis.__real = true })
  await page.evaluate(() => {
    const stage = document.querySelector('.desktop-3d-stage')
    const hm = { idx: 0, restart: true, real: Boolean(globalThis.__real) }
    globalThis.__hm = hm
    globalThis.__animQuiet = true
    const bots = () => [...stage.__pokerRuntime.seats.values()].filter(s => s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
    hm.bots = bots
    const tick = () => {
      const rt = stage.__pokerRuntime
      const now = (performance.now() - rt.startTime) / 1000
      for (const [i, seat] of bots().entries()) {
        const a = seat.animator
        a.nextBigIdleAt = Infinity
        a.nextPeekAt = Infinity
        a.nextMicroAt = Infinity
        if (i === hm.idx) {
          seat.acting = false
          seat.loser = false
          seat.folded = false
          if (hm.restart) { if (!hm.real) seat.winner = false; a.winnerSince = Number.NEGATIVE_INFINITY; hm.restart = false; hm.startedAt = now + 0.05 } else if (!hm.real) seat.winner = true
          a.winFlair = 2
          if (hm.freeze != null && Number.isFinite(a.winnerSince)) a.winnerSince = now - hm.freeze
          hm.since = Number.isFinite(a.winnerSince) ? now - a.winnerSince : -1
        } else if (!hm.real) seat.winner = false
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  let count = 0
  for (const idx of seats) {
    await page.evaluate(idx => { globalThis.__hm.freeze = null; globalThis.__hm.idx = idx; globalThis.__hm.restart = true }, idx)
    await sleep(500)
    for (const t of at) {
      if (!process.env.REAL) await page.evaluate(t => { globalThis.__hm.freeze = t }, t)
      await sleep(Number(process.env.SETTLE ?? 1000))
      if (process.env.POLL) {
        for (let i = 0; i < 40; i += 1) {
          console.log(JSON.stringify(await page.evaluate(() => { const w = globalThis.__hm.bots()[globalThis.__hm.idx]; const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime; const r = v => v && Array.from(v).map(x => +x.toFixed(2)); return { w: w.winner, f: w.animator.winFlair, since: +((performance.now() - rt.startTime) / 1000 - w.animator.winnerSince).toFixed(2), hR: r(w.lastPose?.handR), eUp: +(w.lastPose?.elbowUp ?? 0).toFixed(2) } })))
          await sleep(120)
        }
      }
      if (camMode === 'front') {
        await page.evaluate(() => {
          const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
          const w = globalThis.__hm.bots()[globalThis.__hm.idx]
          const p = w.root.position
          const toward = Math.hypot(p.x, p.z) || 1
          rt.debugCamera = { position: [p.x - (p.x / toward) * 2.6, 2.0, p.z - (p.z / toward) * 2.6], lookAt: [p.x - (p.x / toward) * 0.3, 1.25, p.z - (p.z / toward) * 0.3], fov: 44 }
        })
      }
      const since = await page.evaluate(() => globalThis.__hm.since)
      await page.screenshot({ path: path.join(outDir, `b${idx}-t${t.toFixed(1)}.png`) })
      if (process.env.PRINT) console.log(JSON.stringify(await page.evaluate(() => { const w = globalThis.__hm.bots()[globalThis.__hm.idx]; const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime; const r = v => v && Array.from(v).map(x => +x.toFixed(2)); return { winner: w.winner, flair: w.animator.winFlair, since: (performance.now() - rt.startTime) / 1000 - w.animator.winnerSince, handR: r(w.lastPose?.handR), handL: r(w.lastPose?.handL), elbowUp: w.lastPose?.elbowUp } })))
      console.log('bot', idx, 'wanted', t, 'got', since.toFixed(2))
      count += 1
    }
  }
  console.log('saved', count, 'shots to', outDir)
} finally {
  await browser.close().catch(() => {})
}
