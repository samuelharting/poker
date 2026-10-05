// Showdown cinematic review: plays check/call hands against bots on the desktop
// 3D table while filming, logs the camera every frame, and cuts a timestamped
// contact sheet around each true showdown (development builds only).
//
// Usage: node scripts/snap-showdown.mjs [outDir] [showdowns=3]
// Env: FFMPEG, FPS (sheet frames per second, default 5), SNAP_WIDTH/SNAP_HEIGHT,
//      WANT_HERO_WIN=1 keeps playing until the hero has won a showdown,
//      REDUCED_MOTION=1 emulates prefers-reduced-motion, SKIP_AT=<seconds> clicks the
//      table that long after the showdown starts (tests the skip), POKER_APP_URL.
import { chromium } from '@playwright/test'
import { sheet as cutSheet } from './anim-sheet.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/showdown'
const wanted = Number(process.argv[3] ?? 3)
const fps = Number(process.env.FPS ?? 2)
const VIEW = { width: Number(process.env.SNAP_WIDTH ?? 1280), height: Number(process.env.SNAP_HEIGHT ?? 720) }
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

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
// The recording starts when the context opens, so that is the video clock's zero.
const t0 = Date.now()
const context = await browser.newContext({
  viewport: VIEW,
  recordVideo: { dir: outDir, size: VIEW },
  reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference',
})
const page = await context.newPage()
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => { if (message.type() === 'error') console.log('console:', message.text().slice(0, 300)) })
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero' + String(Date.now() % 1000))
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(1500)

// Per-frame camera telemetry from inside the page.
await page.evaluate(() => {
  window.__camLog = []
  const loop = () => {
    // Read the live runtime each frame: the scene is rebuilt if the GPU context is lost.
    const host = document.querySelector('.desktop-3d-stage')
    const runtime = host?.__pokerRuntime
    const scene = document.querySelector('.table-scene')
    const c = runtime?.camera
    const l = runtime?.cameraLookAt
    if (c && l && window.__camLog.length < 60000) {
      window.__camLog.push([
        performance.now(), c.position.x, c.position.y, c.position.z, l.x, l.y, l.z, c.fov,
        scene?.dataset.showdownStage ?? '', host.dataset.winnerIds ?? '', host.dataset.phase ?? '',
      ])
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  window.__camLogStart = performance.now()
  window.__camLogWall = Date.now()
})

const stage = () => page.evaluate(() => ({
  phase: document.querySelector('.desktop-3d-stage')?.dataset.phase ?? '',
  showdown: document.querySelector('.table-scene')?.dataset.showdown === 'true',
  winners: document.querySelector('.desktop-3d-stage')?.dataset.winnerIds ?? '',
  hero: document.querySelector('.is-local-player')?.getAttribute('data-seat-player') ?? '',
})).catch(() => ({ phase: '', showdown: false, winners: '', hero: '' }))

const results = []
let handsPlayed = 0
let log = []
let video = null
let wallEnd = 0
let logStart = 0
let logWall = 0
try {
const deadline = Date.now() + 7 * 60_000
async function waitFor(predicate, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await predicate()) return true
    await sleep(120)
  }
  return false
}

// Start the game.
for (let attempt = 0; attempt < 30; attempt += 1) {
  if ((await stage()).phase === 'in_hand') break
  await clickVisible(page, /^(Start game|Deal next hand)$/i)
  await sleep(500)
}

while (Date.now() < deadline && results.length < wanted) {
  // Play the hand: check/call to the end.
  let state = await stage()
  while (state.phase === 'in_hand' && Date.now() < deadline) {
    if (!await clickVisible(page, /^(Check|Call)/)) await clickVisible(page, /I'M BACK/i)
    await sleep(250)
    state = await stage()
  }
  handsPlayed += 1
  // Wait for the table to settle, then film what follows.
  const showdownStartedAt = Date.now()
  const isShowdown = await waitFor(async () => (await stage()).showdown, 1800)
  let winners = ''
  let hero = ''
  if (isShowdown) {
    if (process.env.SKIP_AT) {
      await sleep(Number(process.env.SKIP_AT) * 1000)
      await page.mouse.click(40, 450)
    }
    await sleep(7500)
    const final = await stage()
    winners = final.winners
    hero = final.hero
    const heroWon = Boolean(hero) && winners.split(',').includes(hero)
    const split = winners.split(',').filter(Boolean).length > 1
    results.push({ start: 0, wall: showdownStartedAt, heroWon, split })
    console.log(`showdown ${results.length}: hero ${heroWon ? 'won' : 'lost'}${split ? ' (split)' : ''}`)
  } else {
    await sleep(2500)
  }
  // Next hand.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await stage()).phase === 'in_hand') break
    await clickVisible(page, /I'M BACK/i)
    await clickVisible(page, /^(Start game|Deal next hand)$/i)
    await sleep(500)
  }
  if (process.env.WANT_HERO_WIN && results.length >= wanted && !results.some(result => result.heroWon)) {
    results.length = Math.max(0, wanted - 1)
  }
}

  log = await page.evaluate(() => window.__camLog)
  logStart = await page.evaluate(() => window.__camLogStart)
  logWall = await page.evaluate(() => window.__camLogWall)
  wallEnd = Date.now()
} finally {
  // Always close the browser (even on an error) so no headless Chrome is left running.
  video = page.video()
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
await writeFile(path.join(outDir, 'camera-log.json'), JSON.stringify({ logStart, logWall, log }))
const videoPath = await video.path()
const finalVideo = path.join(outDir, 'showdown.webm')
await rename(videoPath, finalVideo)
console.log('hands played', handsPlayed, 'showdowns', results.length)

// Align sheets to the camera log: a true showdown starts when the phase flips to between_hands.
// The video's zero is not exactly the context creation, so anchor on its end instead.
const probe = (process.env.FFMPEG ?? 'ffmpeg').replace(/ffmpeg(\.exe)?$/, 'ffprobe')
const videoSeconds = Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', finalVideo]).toString())
const starts = []
for (let index = 1; index < log.length; index += 1) {
  if (log[index][10] === 'between_hands' && log[index - 1][10] === 'in_hand') {
    const wall = logWall + (log[index][0] - logStart)
    starts.push({ wall, video: videoSeconds - (wallEnd - wall) / 1000 })
  }
}
results.forEach((result, index) => {
  result.start = videoSeconds - (wallEnd - result.wall) / 1000 - 1.5
  const aligned = [...starts].sort((a, b) => Math.abs(a.wall - result.wall) - Math.abs(b.wall - result.wall))[0]
  if (aligned) result.start = aligned.video
  const tag = `${index + 1}${result.heroWon ? '-hero-wins' : '-hero-loses'}${result.split ? '-split' : ''}`
  const out = path.join(outDir, `sheet-${tag}.png`)
  // The recording starts when the context opens; start the sheet a moment before the showdown.
  cutSheet(finalVideo, Math.max(0, result.start - 2.5), 8, out, { fps: 2, width: 400, cols: 4 })
  console.log('sheet', out)
})
await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
const files = await readdir(outDir)
console.log(files.join(', '))
