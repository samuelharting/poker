// Forces showdown cinematics on an idle table (hero win, split pot, opponent win,
// fold-out) by feeding the director scripted views, and films them (development
// builds only). One browser, one video, one contact sheet per scenario.
//
// Usage: node scripts/snap-showdown-forced.mjs [outDir] [scenarios=hero,split,opp,foldout]
// Env: SNAP_WIDTH/SNAP_HEIGHT (default 1280x720), POKER_APP_URL, FFMPEG.
import { chromium } from '@playwright/test'
import { sheet as cutSheet } from './anim-sheet.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/showdown/forced'
const scenarios = (process.argv[3] ?? 'hero,split,opp,foldout').split(',')
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
const t0 = Date.now()
const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: outDir, size: VIEW } })
const page = await context.newPage()
const marks = []
let video = null
let wallEnd = 0
try {
  page.on('pageerror', error => console.log('pageerror:', error.message))
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
  await sleep(2500)

  for (const name of scenarios) {
    const wall = Date.now()
    const outcome = await page.evaluate(scenario => new Promise(resolve => {
      const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
      const now = () => (performance.now() - rt.startTime) / 1000
      // The near seat plays the hero (the real hero may be a spectator on a full table).
      const seats = [...rt.seats.values()].filter(seat => seat.root.visible || seat.isHero).map(seat => ({ id: seat.playerId, seat: seat.visualSeat, hero: seat.visualSeat === 0 }))
      const opponents = seats.filter(seat => !seat.hero).sort((a, b) => a.seat - b.seat)
      const pickIndex = scenario === 'hero' ? -1 : scenario === 'split' ? [1, Math.max(1, opponents.length - 2)] : Math.floor(opponents.length / 2)
      const winnerIds = scenario === 'hero' ? [seats.find(seat => seat.hero)?.id]
        : scenario === 'split' ? [opponents[pickIndex[0]]?.id, opponents[pickIndex[1]]?.id]
        : [opponents[pickIndex]?.id]
      const live = scenario === 'foldout' ? seats.filter(seat => winnerIds.includes(seat.id)) : seats
      const snap = (phase, revealed, winners) => ({
        __forced: true, handKey: 9000 + Math.floor(wallKey), phase, communityCount: 5,
        players: seats.map(seat => ({
          id: seat.id, visualSeat: seat.seat, isHero: seat.hero,
          isWinner: winners.includes(seat.id), live: live.some(l => l.id === seat.id), allIn: false,
          revealed: seat.hero ? 2 : (revealed.get(seat.id) ?? 0),
        })),
      })
      const wallKey = Date.now() % 100000
      const d = rt.showdown
      // Live views keep arriving from the server; only scripted snapshots may reach the director.
      if (!d.__wrapped) {
        const original = d.sync.bind(d)
        d.sync = (snapshot, at) => { if (snapshot.__forced) original(snapshot, at) }
        d.__wrapped = true
      }
      d.sync(snap('in_hand', new Map(), []), now())
      const revealed = new Map()
      if (scenario === 'foldout') {
        d.sync(snap('between_hands', revealed, winnerIds), now())
      } else {
        d.sync(snap('between_hands', revealed, []), now())
        let step = 0
        opponents.forEach((opp, index) => {
          const at = 900 + index * 270
          setTimeout(() => { revealed.set(opp.id, 1); d.sync(snap('between_hands', revealed, []), now()) }, at)
          setTimeout(() => { revealed.set(opp.id, 2); d.sync(snap('between_hands', revealed, []), now()) }, at + 137)
          step = at + 137
        })
        setTimeout(() => d.sync(snap('between_hands', revealed, winnerIds), now()), Math.max(1600, step + 150))
      }
      setTimeout(() => resolve({ scenario, plan: d.describe() }), 7000)
    }), name)
    marks.push({ name, wall })
    console.log(name, JSON.stringify(outcome.plan.stops), 'winnersMask', outcome.plan.winnersMask, 'scenes', outcome.plan.scenes.map(s => `${s.kind[0]}${s.seat}@${s.start.toFixed(2)}`).join(' '))
    await sleep(1500)
  }
  wallEnd = Date.now()
} finally {
  video = page.video()
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
const videoPath = await video.path()
const finalVideo = path.join(outDir, 'forced.webm')
await rename(videoPath, finalVideo)
const probe = (process.env.FFMPEG ?? 'ffmpeg').replace(/ffmpeg(\.exe)?$/, 'ffprobe')
const videoSeconds = Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', finalVideo]).toString())
for (const mark of marks) {
  const start = videoSeconds - (wallEnd - mark.wall) / 1000
  const out = path.join(outDir, `sheet-${mark.name}.png`)
  cutSheet(finalVideo, Math.max(0, start - 2.5), 8, out, { fps: 2, width: 400, cols: 4 })
  console.log('sheet', out)
}
await writeFile(path.join(outDir, 'marks.json'), JSON.stringify({ marks, videoSeconds, wallEnd }))
