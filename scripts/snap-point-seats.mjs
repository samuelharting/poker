// The winner's "point at the pot" beat from several seats and angles (development builds only).
// One browser, one hand: freezes each chosen bot seat in the win flair (kind 2) at chosen
// times and photographs it from the table (front), the side, over the shoulder and above.
//
// Usage: node scripts/snap-point-seats.mjs <outDir>
// Env: SEATS=0,1,2,4  TIMES=2.2,2.6,3.0,3.5,4.2 (seconds since the rake ended = celebration clock;
//      the flair starts at 2.5)  VIEWS=front,side,back,over  SETTLE=900  CELEB=victory
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v5/point/seats'
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const seats = (process.env.SEATS ?? '0,1,2,4').split(',').map(Number)
const times = (process.env.TIMES ?? '2.2,2.7,3.1,3.6,4.3').split(',').map(Number)
const views = (process.env.VIEWS ?? 'front,side,back,over').split(',')
const settleMs = Number(process.env.SETTLE ?? 900)
const celebration = process.env.CELEB ?? 'victory'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500 }).then(() => true, () => false)) return true
    }
  }
  return false
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
try {
  const page = await browser.newPage({ viewport: { width, height } })
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
  await page.waitForFunction(
    () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
    null,
    { timeout: 60000 }
  ).catch(() => {})
  await sleep(3000)
  await page.addStyleTag({ content: '.table-stage, .social-dock, .table-side-panels, .room-hud, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })

  await page.evaluate(({ celebration }) => {
    const stage = document.querySelector('.desktop-3d-stage')
    globalThis.__animQuiet = true
    const INF = Number.POSITIVE_INFINITY
    const hm = { idx: 0, elapsed: 3, ticks: 0 }
    globalThis.__hm = hm
    const bots = () => [...stage.__pokerRuntime.seats.values()].filter(s => s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
    hm.bots = bots
    const nowS = rt => (performance.now() - rt.startTime) / 1000
    function apply() {
      const rt = stage.__pokerRuntime
      const list = bots()
      for (const [i, seat] of list.entries()) {
        const a = seat.animator
        a.nextBigIdleAt = INF
        a.nextPeekAt = INF
        a.nextMicroAt = INF
        if (i !== hm.idx) continue
        seat.acting = false
        seat.loser = false
        seat.peeking = false
        seat.folded = false
        seat.hadCards = true
        seat.cards.visible = true
        seat.winner = true
        if (Number.isFinite(a.winnerSince)) a.winnerSince = nowS(rt) - 1.0 - hm.elapsed
        a.winFlair = 2
        seat.avatarProfile.celebration = celebration
      }
      // Everyone else is a plain bystander.
      for (const [i, seat] of list.entries()) if (i !== hm.idx) seat.winner = false
      requestAnimationFrame(apply)
    }
    requestAnimationFrame(apply)
  }, { celebration })

  async function setCamera(view) {
    await page.evaluate(view => {
      const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
      const seat = globalThis.__hm.bots()[globalThis.__hm.idx]
      const V = seat.avatar.bones.get('Head').position.constructor
      const head = seat.avatar.bones.get('Head').getWorldPosition(new V())
      const board = seat.root.localToWorld(new V(...seat.anchors.board))
      const len = Math.hypot(head.x, head.z) || 1
      const f = { x: -head.x / len, z: -head.z / len }
      const r = { x: -f.z, z: f.x }
      // Which side is the pointing hand? The pot's side of the body.
      const sideways = seat.anchors.board[0] - (seat.anchors.shoulderR[0] + seat.anchors.shoulderL[0]) * 0.5
      const left = Math.abs(sideways) < 0.08 ? seat.animator.seed >= 0.5 : sideways < 0
      const hs = left ? -1 : 1
      let pos
      let look
      let fov = 40
      if (view === 'front') { pos = [head.x + f.x * 2.4, head.y + 0.35, head.z + f.z * 2.4]; look = [head.x, head.y - 0.45, head.z] }
      else if (view === 'side') { pos = [head.x + r.x * hs * 2.0, head.y + 0.1, head.z + r.z * hs * 2.0]; look = [head.x + f.x * 0.45, head.y - 0.5, head.z + f.z * 0.45]; fov = 42 }
      else if (view === 'back') { pos = [head.x - f.x * 0.9 + r.x * hs * 0.55, head.y + 0.45, head.z - f.z * 0.9 + r.z * hs * 0.55]; look = [head.x + f.x * 1.4, head.y - 0.35, head.z + f.z * 1.4]; fov = 55 }
      else { pos = [head.x + f.x * 0.4, head.y + 2.3, head.z + f.z * 0.4]; look = [head.x + f.x * 0.8, head.y - 1.0, head.z + f.z * 0.8]; fov = 50 }
      rt.debugCamera = { position: pos, lookAt: look, fov }
      return board
    }, view)
  }

  let count = 0
  for (const seatIdx of seats) {
    await page.evaluate(idx => { globalThis.__hm.idx = idx }, seatIdx)
    const info = await page.evaluate(() => {
      const seat = globalThis.__hm.bots()[globalThis.__hm.idx]
      const r = v => v.map(x => +x.toFixed(2))
      return { n: globalThis.__hm.bots().length, vis: seat.root.visible, vs: seat.visualSeat, board: r(seat.anchors.board), shR: r(seat.anchors.shoulderR), shL: r(seat.anchors.shoulderL), cards: r(seat.anchors.cards) }
    })
    console.log('seat', seatIdx, JSON.stringify(info))
    for (const t of times) {
      await page.evaluate(t => { globalThis.__hm.elapsed = t }, t)
      await sleep(settleMs)
      for (const view of views) {
        await setCamera(view)
        await sleep(220)
        await page.screenshot({ path: path.join(outDir, `s${seatIdx}-t${t.toFixed(1)}-${view}.png`) })
        count += 1
      }
    }
  }
  console.log('saved', count, 'shots to', outDir)
} finally {
  await browser.close().catch(() => {})
}
