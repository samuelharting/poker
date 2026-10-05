// Photographs the idle social behaviours (development builds only): a table-talk exchange or a yawn.
// Usage: node scripts/snap-social.mjs chat|yawn <outDir> [frames] [intervalMs]
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const mode = process.argv[2] ?? 'chat'
const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[3] ?? `output/v2/social/${mode}`
const frames = Number(process.argv[4] ?? 10)
const interval = Number(process.argv[5] ?? 300)
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
/** Records the page for `seconds` with the CDP screencast (a screenshot per frame is far too slow) and saves the jpeg frames. */
async function recordBurst(page, seconds, prefix, every = 1) {
  const client = await page.context().newCDPSession(page)
  const saved = []
  let index = 0
  client.on('Page.screencastFrame', async frame => {
    const name = `${prefix}-${String(index).padStart(3, '0')}.jpg`
    index += 1
    if (index % every === 0 || every === 1) {
      saved.push(writeFile(path.join(outDir, name), Buffer.from(frame.data, 'base64')))
    }
    client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 })
  await sleep(seconds * 1000)
  await client.send('Page.stopScreencast')
  await Promise.all(saved)
  return index
}
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
// Never leave a browser running: close it on any failure.
for (const signal of ['uncaughtException', 'unhandledRejection']) process.on(signal, async error => { console.log('failed:', error?.message ?? error); await browser.close().catch(() => {}); process.exit(1) })
const page = await browser.newPage({ viewport: { width: Number(process.env.SNAP_WIDTH ?? 1440), height: Number(process.env.SNAP_HEIGHT ?? 900) } })
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => { if (message.text().startsWith('seats ')) console.log(message.text()) })
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
await page.addStyleTag({ content: '.table-stage, .social-dock, .table-side-panels, .room-hud, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })
await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })

if (mode === 'chat') {
  // Watch every animation frame in the page (a round trip per poll is far too slow) and frame the
  // first conversation in which both sides are taking part. PREFER_ACTIVE=1 waits for a pair that
  // has not folded (for up to two minutes) so the talking hand can be seen.
  const preferActive = process.env.PREFER_ACTIVE === '1'
  await page.evaluate(preferActive => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const started = performance.now()
    const head = s => { const v = s.avatar.bones.get('Head').getWorldPosition(new (s.avatar.bones.get('Head').position.constructor)()); return [v.x, v.y, v.z] }
    const watch = () => {
      if (window.__chatPair) return
      const seats = [...rt.seats.values()]
      const speaker = seats.find(s => s.chat?.role === 'speak')
      const listener = seats.find(s => s.chat?.role === 'listen' && s.chat.partnerId === speaker?.playerId)
      const wait = preferActive && performance.now() - started < 120000
      if (speaker && listener && speaker.chat.elapsed < 1.2 && (!wait || (!speaker.folded && !listener.folded))) {
        const a = head(speaker)
        const b = head(listener)
        const mid = a.map((v, i) => (v + b[i]) / 2)
        const span = Math.hypot(a[0] - b[0], a[2] - b[2])
        const toward = Math.hypot(mid[0], mid[2]) || 1
        const dist = 1.3 + span * 0.7
        rt.debugCamera = { position: [mid[0] - (mid[0] / toward) * dist, mid[1] + 0.35, mid[2] - (mid[2] / toward) * dist], lookAt: [mid[0], mid[1] - 0.2, mid[2]], fov: 40 }
        window.__chatPair = { speaker: speaker.playerId, listener: listener.playerId, duration: speaker.chat.duration, laugh: speaker.chat.laugh, folded: [speaker.folded, listener.folded] }
        return
      }
      requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  }, preferActive)
  let pair = null
  for (let attempt = 0; attempt < 1500 && !pair; attempt += 1) {
    pair = await page.evaluate(() => window.__chatPair ?? null)
    if (!pair) await sleep(150)
  }
  console.log('pair', JSON.stringify(pair))
  if (pair) {
    const count = await recordBurst(page, pair.duration + 1, 'chat')
    console.log('frames recorded', count)
  }
} else {
  // Force one calm (not folded, not acting) player into the stretch idle, frame the head, and record
  // through the whole stretch (the yawn is in its middle). A frame-by-frame log of the animator's yawn
  // channel is kept in the page as numeric evidence.
  const arm = async () => page.evaluate(dist => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const seats = [...rt.seats.values()].filter(s => s.root.visible && s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
    const calm = s => !s.folded && !s.acting && !s.passedOut
    // A bare face (no glasses, no moustache) shows the yawn best.
    const bare = s => s.face && !s.face.mouth.facialHair && s.face.eyewear === 'none'
    const noShades = s => s.face && s.face.eyewear === 'none'
    const seat = seats.find(s => calm(s) && bare(s)) ?? seats.find(s => calm(s) && noShades(s)) ?? seats.find(calm) ?? seats[0]
    const head = seat.avatar.bones.get('Head')
    const v = head.getWorldPosition(new head.position.constructor())
    const p = seat.root.position
    const len = Math.hypot(p.x, p.z) || 1
    // From the table side (the seat faces the centre), a little above eye level, close on the head.
    rt.debugCamera = { position: [v.x - (p.x / len) * dist, v.y + 0.25, v.z - (p.z / len) * dist], lookAt: [v.x, v.y + 0.05, v.z], fov: 32 }
    seat.animator.bigIdleStartedAt = Number.NEGATIVE_INFINITY
    seat.animator.microStartedAt = Number.NEGATIVE_INFINITY
    seat.animator.peekStartedAt = Number.NEGATIVE_INFINITY
    seat.animator.nextBigIdleAt = 0
    const real = seat.animator.random
    // The first draws pick the stretch (kind 0) instead of a random big idle.
    seat.animator.random = () => 0.01
    const log = (window.__yawnLog = [])
    const t0 = performance.now()
    const tick = () => {
      if (Number.isFinite(seat.animator.bigIdleStartedAt)) seat.animator.random = real
      log.push([Math.round(performance.now() - t0), seat.animator.bigIdleKind, Number.isFinite(seat.animator.bigIdleStartedAt) ? 1 : 0, +seat.animator.yawn.toFixed(2), +seat.face.context.yawn.toFixed(2), +seat.face.emotion.params[11].toFixed(2)])
      if (performance.now() - t0 < 7000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return seat.playerId
  }, Number(process.env.YAWN_DIST ?? 1.3))
  const recording = recordBurst(page, 4.6, 'yawn')
  await sleep(500)
  console.log('yawn seat', await arm())
  console.log('frames recorded', await recording)
  const log = await page.evaluate(() => window.__yawnLog)
  const peak = log.reduce((best, row) => (row[3] > best[3] ? row : best), [0, 0, 0, 0, 0, 0])
  console.log('yawn peak [ms, kind, idleOn, yawn, faceYawn, mouthOpen]', JSON.stringify(peak), 'samples', log.length)
  console.log('yawn timeline', JSON.stringify(log.filter((row, index) => index % 12 === 0)))
}
await browser.close()
