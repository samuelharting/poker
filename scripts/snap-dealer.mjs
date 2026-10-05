// Dealer avatar deal capture (development builds only).
// Usage: node scripts/snap-dealer.mjs <outDir> <mode>   (options via env)
//   mode: probe | deal | board
//   env:  SLOW=0.2 (scene clock speed; makes frames dense), CAM=front|side|over|none, DEALER_SEATS=6,
//         STEP=0.1 (scene seconds between sheet tiles), SPAN=3 (scene seconds captured), COLS=6, WIDTH=480
// Joins as Hero, fills seats, starts the game, follows the dealer with a debug camera and writes
// numbered frames plus a contact sheet labelled with scene time and card releases.
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { makeRoomId, usePrivateRoom } from './qa-lib.mjs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/dealer'
const mode = process.argv[3] ?? 'probe'
const slow = Number(process.env.SLOW ?? 0.2)
const camMode = process.env.CAM ?? 'front'
const wantSeats = Number(process.env.DEALER_SEATS ?? 6)
const stepSec = Number(process.env.STEP ?? 0.1)
const spanSec = Number(process.env.SPAN ?? 3)
const cols = Number(process.env.COLS ?? 6)
const tileWidth = Number(process.env.WIDTH ?? 480)
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
for (const old of await readdir(outDir)) if (old.startsWith(`${mode}-`) && old.endsWith('.png')) await rm(path.join(outDir, old))
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
// Never leave a browser running (the machine is slow): close on any failure or interrupt.
const bail = async error => { if (error) console.log(error); await browser.close().catch(() => {}); process.exit(1) }
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)
process.on('SIGINT', () => bail())
const page = await browser.newPage({ viewport: { width: Number(process.env.SNAP_WIDTH ?? 1440), height: Number(process.env.SNAP_HEIGHT ?? 900) } })
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('navigated:', frame.url()) })
page.on('console', msg => { if (msg.type() === 'error') console.log('console error:', msg.text().slice(0, 300)) })
// A private PartyKit room: the default table is shared with everyone.
await usePrivateRoom(page, makeRoomId('dl'))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: /Take a seat|Sit down as|Enter Room/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= wantSeats - 1) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await sleep(1500)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 4, null, { timeout: 60000 }).catch(() => {})

// Follow whoever holds the button with a debug camera (re-installed after any dev-server reload).
async function installFollow() {
  // Slow the scene clock from here on (continuous with the old one; animations only, the server keeps real time).
  await page.evaluate(factor => {
    if (window.__slowApplied || factor === 1) return
    window.__slowApplied = true
    const orig = performance.now.bind(performance)
    const t0 = orig()
    performance.now = () => t0 + (orig() - t0) * factor
  }, slow)
  await page.evaluate(cam => {
    if (window.__dealerFollow) return
    window.__dealerFollow = true
    const follow = () => {
      const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
      if (!rt) return requestAnimationFrame(follow)
      const seat = [...rt.seats.values()].find(s => s.dealerButton.visible && s.avatar && !s.isHero)
      if (seat && cam !== 'none') {
        const p = seat.root.position
        const len = Math.hypot(p.x, p.z) || 1
        const ux = p.x / len
        const uz = p.z / len
        // Sideways direction (perpendicular, on the floor).
        const sx = -uz
        const sz = ux
        if (cam === 'front') {
          rt.debugCamera = { position: [p.x - ux * 2.3, 1.95, p.z - uz * 2.3], lookAt: [p.x - ux * 0.35, 1.15, p.z - uz * 0.35], fov: 42 }
        } else if (cam === 'top') {
          rt.debugCamera = { position: [p.x - ux * 1.2 + sx * 0.15, 3.3, p.z - uz * 1.2 + sz * 0.15], lookAt: [p.x - ux * 0.95, 0.5, p.z - uz * 0.95], fov: 40 }
        } else if (cam === 'hands') {
          rt.debugCamera = { position: [p.x - ux * 1.95, 1.35, p.z - uz * 1.95], lookAt: [p.x - ux * 0.75, 0.85, p.z - uz * 0.75], fov: 34 }
        } else if (cam === 'three') {
          rt.debugCamera = { position: [p.x - ux * 1.7 + sx * 1.0, 1.75, p.z - uz * 1.7 + sz * 1.0], lookAt: [p.x - ux * 0.75, 0.95, p.z - uz * 0.75], fov: 46 }
        } else if (cam === 'side') {
          rt.debugCamera = { position: [p.x - ux * 1.0 + sx * 1.9, 1.9, p.z - uz * 1.0 + sz * 1.9], lookAt: [p.x - ux * 0.6, 1.0, p.z - uz * 0.6], fov: 42 }
        } else {
          rt.debugCamera = { position: [p.x + ux * 1.6, 2.7, p.z + uz * 1.6], lookAt: [p.x * 0.2, 0.5, p.z * 0.2], fov: 60 }
        }
      }
      requestAnimationFrame(follow)
    }
    follow()
  }, camMode)
}
async function ready() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ok = await page.evaluate(() => Boolean(document.querySelector('.desktop-3d-stage')?.__pokerRuntime)).catch(() => false)
    if (ok) {
      await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 4, null, { timeout: 30000 }).catch(() => {})
      await installFollow().catch(() => {})
      return
    }
    await sleep(500)
  }
}
await ready()

if (mode === 'probe') {
  await clickVisible(page, /^Start game$/)
  await sleep(3000)
  const info = await page.evaluate(() => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    return [...rt.seats.values()].map(s => ({ vs: s.visualSeat, dealer: s.dealerButton.visible, hero: s.isHero, hasAvatar: Boolean(s.avatar), status: s.avatarLoadStatus, hadCards: s.hadCards, dealOrder: s.dealOrder, dealStartedAt: s.dealStartedAt, rtDealer: Boolean(rt.dealer) }))
  })
  console.log(JSON.stringify(info))
  await browser.close()
  process.exit(0)
}

const frames = []
const probe = () => page.evaluate(() => {
  const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  if (!rt) return { time: 0, dealer: null, lost: true }
  const time = (performance.now() - rt.startTime) / 1000
  const d = rt.dealer
  const ds = [...rt.seats.values()].find(x => x.dealerButton.visible)
  const dbg = ds ? { w: ds.dealPose?.weight, hr: ds.dealPose?.handR?.map(v => +v.toFixed(2)), lp: ds.lastPose?.handR?.map(v => +v.toFixed(2)), drink: +(time - ds.drinkStartedAt).toFixed(2), folded: ds.folded, passed: ds.passedOut, acting: ds.acting, hero: ds.isHero, pb: ds.playback?.cue } : null
  return { time, dbg, dealer: d ? { kind: d.kind, startedAt: d.schedule.startedAt, releases: d.schedule.cards.map(c => [c.kind, c.releaseAt]) } : null }
})

// The table is a shared crew room: keep pressing the buttons that move a hand along until the deal we want begins.
async function advance() {
  if (await clickVisible(page, /^Deal next hand$/)) return
  if (await clickVisible(page, /^Start game$/)) return
  await clickVisible(page, /^(Check|Call)/)
}
if (mode === 'deal' || mode === 'board') {
  const want = mode === 'deal' ? 'hole' : 'board'
  const deadline = Date.now() + 150000
  let state = await probe()
  const fresh = s => s.dealer && s.dealer.kind === want && s.time - s.dealer.startedAt < 0.35
  while (!fresh(state) && Date.now() < deadline) {
    await advance().catch(() => {})
    await sleep(60)
    state = await probe().catch(() => ({ time: 0, dealer: null, lost: true }))
    if (state.lost) await ready()
  }
  if (!fresh(state)) {
    console.log(`no ${want} deal observed`)
    console.log(JSON.stringify(await page.evaluate(() => { const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime; return [...rt.seats.values()].map(s => ({ vs: s.visualSeat, dealer: s.dealerButton.visible, hero: s.isHero, hasAvatar: Boolean(s.avatar), status: s.avatarLoadStatus, hadCards: s.hadCards, dealOrder: s.dealOrder })) })))
    await browser.close(); process.exit(1)
  }
}
if (process.env.HIDE_UI !== '0') await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
const t0 = (await probe()).time
const captureUntil = t0 + spanSec
for (let n = 0; n < 300; n += 1) {
  const before = await probe()
  const file = path.join(outDir, `${mode}-${String(n).padStart(3, '0')}.png`)
  await page.screenshot({ path: file })
  const after = await probe()
  frames.push({ file, time: (before.time + after.time) / 2, dealer: after.dealer })
  if (process.env.DEBUG) console.log(after.time.toFixed(2), JSON.stringify(after.dbg))
  if (after.time > captureUntil) break
}
// Contact sheet: the frame nearest to each STEP of scene time, labelled with the time since the deal began.
const first = frames.find(f => f.dealer)
const startedAt = first?.dealer?.startedAt ?? frames[0].time
const releases = first?.dealer?.releases ?? []
const picks = []
for (let t = frames[0].time; t <= captureUntil; t += stepSec) {
  let best = frames[0]
  for (const f of frames) if (Math.abs(f.time - t) < Math.abs(best.time - t)) best = f
  if (!picks.includes(best)) picks.push(best)
}
const shots = await Promise.all(picks.map(async f => {
  const resized = await sharp(f.file).resize({ width: tileWidth }).png().toBuffer({ resolveWithObject: true })
  const rel = f.time - startedAt
  const near = releases.filter(([, at]) => Math.abs(at - rel) < stepSec * 0.6).map(([kind, at]) => `${kind} ${at.toFixed(2)}`)
  const label = `t=${rel.toFixed(2)}s${near.length ? '  RELEASE ' + near.join(',') : ''}`
  const svg = Buffer.from(`<svg width="${resized.info.width}" height="${resized.info.height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${resized.info.width}" height="22" fill="black" fill-opacity="0.6"/><text x="6" y="16" font-family="Arial" font-size="14" fill="${near.length ? '#ffd24a' : 'white'}">${label}</text></svg>`)
  return { input: await sharp(resized.data).composite([{ input: svg }]).png().toBuffer(), width: resized.info.width, height: resized.info.height }
}))
const tileW = shots[0].width
const tileH = shots[0].height
const rows = Math.ceil(shots.length / cols)
await sharp({ create: { width: tileW * cols, height: tileH * rows, channels: 3, background: '#000' } })
  .composite(shots.map((s, i) => ({ input: s.input, left: (i % cols) * tileW, top: Math.floor(i / cols) * tileH })))
  .png()
  .toFile(path.join(outDir, `sheet-${mode}-${camMode}.png`))
console.log(`frames ${frames.length}, sheet tiles ${shots.length}, deal releases`, releases.slice(0, 6))
await browser.close()
