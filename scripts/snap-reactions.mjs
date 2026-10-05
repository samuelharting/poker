// Social reactions review (development builds only): forces an event and photographs the reacting seats.
// Usage: node scripts/snap-reactions.mjs <scenario> <outDir> [frames] [intervalMs] [wide|close]
//   scenarios: hero-raise, hero-allin, bot-allin, bad-beat, sweat, nervous, fold-shrug, hero-win
// Close mode follows the seat with the strongest matching weight; wide mode keeps the hero camera.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const scenario = process.argv[2] ?? 'hero-allin'
const outDir = process.argv[3] ?? `output/v2/reactions/${scenario}`
const frames = Number(process.argv[4] ?? 10)
const interval = Number(process.argv[5] ?? 250)
const mode = process.argv[6] ?? 'close'
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
const page = await browser.newPage({ viewport: { width: Number(process.env.SNAP_WIDTH ?? 1280), height: Number(process.env.SNAP_HEIGHT ?? 800) } })
page.on('pageerror', error => console.log('pageerror:', error.message))
// Slow-motion clock: the page's performance.now runs at SLOW x real speed, so a loaded machine
// (few frames per second) still steps the animation in small, even slices.
const slow = Number(process.env.SLOW ?? 0.2)
await page.addInitScript(scale => {
  const real = performance.now.bind(performance)
  const base = real()
  performance.now = () => base + (real() - base) * scale
}, slow)
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
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
await clickVisible(page, /^Start game$/)
await sleep(3500)

// Wait for the table to settle so nothing re-syncs the seats mid-scenario.
const info = await page.evaluate(() => {
  const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
  return [...rt.seats.values()].map(s => ({ id: s.playerId, seat: s.visualSeat, hero: s.isHero, visible: s.root.visible }))
})
console.log('seats', JSON.stringify(info))

await page.evaluate(({ scenario }) => {
  const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const seats = [...rt.seats.values()]
  const hero = seats.find(s => s.isHero)
  const bots = seats.filter(s => !s.isHero && s.root.visible && s.avatar).sort((a, b) => a.visualSeat - b.visualSeat)
  const now = performance.now() - rt.startTime
  const fire = (seat, cue) => {
    seat.playback = { key: `dbg-${cue}-${Math.round(now)}`, cue, startedAtMs: now }
    seat.wagerIntensity = cue === 'all_in' ? 1 : 0.8
  }
  window.__rx = { rt, seats, hero, bots, scenario, t0: now }
  if (scenario === 'hero-raise') fire(hero, 'raise')
  if (scenario === 'hero-allin') fire(hero, 'all_in')
  if (scenario === 'bot-allin') fire(bots[Math.min(2, bots.length - 1)], 'all_in')
  if (scenario === 'hero-win') {
    hero.winner = true
    window.__rx.endWin = () => { hero.winner = false }
    setTimeout(() => { hero.winner = false }, 4000)
  }
  if (scenario === 'bad-beat' || scenario === 'sweat') {
    for (const bot of bots) {
      bot.social.allIn = true
      bot.social.atRisk = 1
      bot.social.oddsWin = scenario === 'bad-beat' ? 88 : -1
    }
    if (scenario === 'bad-beat') {
      setTimeout(() => { for (const bot of bots) bot.social.oddsWin = 3 }, 1800)
    }
  }
  if (scenario === 'nervous') {
    for (const bot of bots) { bot.social.atRisk = 0.9 }
  }
  if (scenario === 'fold-shrug') {
    for (const bot of bots) {
      bot.folded = true
      bot.playback = { key: `dbg-fold-${Math.round(now)}`, cue: 'fold', startedAtMs: now }
      bot.social.facingBet = 0.95
    }
  }
}, { scenario })

const keyOf = { 'hero-raise': 'look', 'hero-allin': 'gasp', 'bot-allin': 'gasp', 'hero-win': 'look', 'bad-beat': 'badBeat', sweat: 'sweat', nervous: 'nervous', 'fold-shrug': 'shrug' }[scenario] ?? 'look'
for (let frame = 0; frame < frames; frame += 1) {
  const picked = await page.evaluate(({ key, mode }) => {
    const { rt, bots } = window.__rx
    let best = bots[0]
    let bestW = -1
    for (const bot of bots) {
      const w = bot.animator.reactions.weights
      const value = Math.abs(w[key] ?? 0)
      if (value > bestW) { bestW = value; best = bot }
    }
    // Re-assert the forced hand state (a table update may have re-synced the seats).
    if (mode === 'close') {
      const p = best.root.position
      const toward = Math.hypot(p.x, p.z) || 1
      const dist = 2.4
      rt.debugCamera = {
        position: [p.x - (p.x / toward) * dist, 1.85, p.z - (p.z / toward) * dist],
        lookAt: [p.x - (p.x / toward) * 0.3, 1.15, p.z - (p.z / toward) * 0.3],
        fov: 44,
      }
    } else {
      rt.debugCamera = null
    }
    const w = best.animator.reactions.weights
    return { seat: best.visualSeat, bestW, weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])), t: ((performance.now() - rt.startTime) - window.__rx.t0) / 1000 }
  }, { key: keyOf, mode })
  console.log(frame, JSON.stringify(picked))
  await page.screenshot({ path: path.join(outDir, `f-${String(frame).padStart(3, '0')}.png`) })
  await sleep(interval)
}
await browser.close()
