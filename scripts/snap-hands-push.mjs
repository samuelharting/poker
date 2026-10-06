// Stop-motion capture of the hero's chip push (wager gesture) on a frozen, hand-stepped scene clock.
// Usage: node scripts/snap-hands-push.mjs <outDir> [tag]
//   env: SNAP_WIDTH/SNAP_HEIGHT, SIZES=min,half,pot,allin, STEP_MS=40, ELS=0,150,... (gesture ms to put on the sheet)
//        CROP=x:y:w:h (page px), COLS=4, TILE=520
// One browser, always closed. A real private room is played until the hero is to act while already holding a
// bet in front of them; then the scene clock is frozen and stepped by hand, the wager flight and the hands'
// gesture clock are driven together (exactly the pairing the room has when it plays the action), and every
// wanted instant is screenshotted. Prints, per size, how much of the hand each DOM overlay covers and how far
// the hand follows the pile.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v5/hands'
const tag = process.argv[3] ?? 'run'
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const sizes = (process.env.SIZES ?? 'min,half,pot,allin').split(',')
const stepMs = Number(process.env.STEP_MS ?? 50)
const els = (process.env.ELS ?? '0,200,300,400,500,600,700,800,900,1000,1150,1400').split(',').map(Number)
const cols = Number(process.env.COLS ?? 4)
const tileW = Number(process.env.TILE ?? 520)
const crop = (process.env.CROP ?? `${Math.round(width * 0.22)}:${Math.round(height * 0.5)}:${Math.round(width * 0.66)}:${Math.round(height * 0.5)}`).split(':').map(Number)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const SIZE = { min: { cue: 'raise', intensity: 0.45 }, half: { cue: 'raise', intensity: 0.65 }, pot: { cue: 'raise', intensity: 0.86 }, allin: { cue: 'all_in', intensity: 1 }, call: { cue: 'call', intensity: 0.2 } }

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500, force: true }).then(() => true, () => false)) return true
    }
  }
  return false
}
async function isVisibleButton(page, name) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) if (await locator.nth(index).isVisible().catch(() => false)) return true
  return false
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const bail = async error => { console.log('fatal', error?.message ?? String(error)); await browser.close().catch(() => {}); process.exit(1) }
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)
try {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  const roomId = 'fq' + Math.random().toString(36).slice(2, 8)
  await page.addInitScript(id => {
    const Native = window.WebSocket
    window.WebSocket = class extends Native { constructor(url, protocols) { super(String(url).replace(/crew22/i, id), protocols) } }
    const base = performance.now.bind(performance)
    let lastReal = base(), virtual = lastReal
    window.__manual = false
    performance.now = () => { const real = base(); if (!window.__manual) virtual += real - lastReal; lastReal = real; return virtual }
    window.__advance = ms => { virtual += ms }
  }, roomId)
  page.on('pageerror', error => console.log('pageerror:', error.message))
  await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
  await page.getByLabel('Your nickname').fill('Hand' + Math.floor(Math.random() * 900 + 100))
  await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
  await page.waitForURL(/\/room\//)
  await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
  for (let attempt = 0; attempt < 2; attempt += 1) { await clickVisible(page, /^Add bot$/); await sleep(500) }
  await page.waitForFunction(n => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= n, 2, { timeout: 60000 }).catch(() => {})
  await clickVisible(page, /^Start game$/)
  await sleep(3000)

  // Play until the hero is to act with chips already in front of them (a blind): the pile then exists on the felt.
  const heroState = () => page.evaluate(() => {
    const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
    const hero = rt && [...rt.seats.values()].find(s => s.isHero)
    const w = hero && rt.wagers.get(hero.playerId)
    return { amount: w ? w.amount : 0, visible: w ? w.group.visible : false }
  })
  async function findHand() {
    await page.evaluate(() => { window.__manual = false })
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (await isVisibleButton(page, /^Fold/)) {
        await sleep(700)
        const state = await heroState()
        if (attempt % 5 === 0) console.log('  hero turn, bet', JSON.stringify(state))
        if (state.amount > 0 && state.visible) return true
        await clickVisible(page, /^Fold/)
        await sleep(500)
      } else {
        await clickVisible(page, /^Deal next hand$/) || await clickVisible(page, /^Start game$/) || await clickVisible(page, /^I.?M BACK$/i)
        await sleep(400)
      }
    }
    console.log('buttons', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12))))
    await page.screenshot({ path: path.join(outDir, 'push-fail.png') })
    return false
  }
  // One evaluate per step (set the gesture clock and the flight, advance the scene clock, wait two frames, read back).
  const stepAt = (cfg, t, stepMsNow) => page.evaluate(({ cue, intensity, t, stepMsNow }) => new Promise(resolve => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const hero = [...rt.seats.values()].find(s => s.isHero)
    hero.wagerIntensity = intensity
    rt.firstPersonHands.debugForce = { cue, elapsedMs: t }
    const now = (performance.now() - rt.startTime) / 1000
    const w = rt.wagers.get(hero.playerId)
    w.handPushed = true
    w.motionProfile = { ...w.motionProfile, ...rt.firstPersonHands.input.profile, variant: 0 }
    w.collectStartedAt = -1e9
    w.group.visible = true
    w.animating = t < 3000
    w.startedAt = now - (t / 1000 - 0.25)
    window.__advance(stepMsNow)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const hands = rt.firstPersonHands
      const v = rt.camera.position.clone()
      w.group.getWorldPosition(v); v.project(rt.camera)
      const rectOf = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round) }
      const r = hands.shown.right, l = hands.shown.left
      resolve({
        R: [r.x, r.y, r.show, r.pitch, r.yaw, r.roll, r.fist, r.open], L: [l.x, l.y, l.show, l.pitch, l.yaw, l.roll, l.fist, l.open],
        chips: [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight],
        style: hands.input.profile.wagerStyle, intensity: hands.input.profile.wagerIntensity, seatIntensity: hero.wagerIntensity, cueNow: hands.input.cue,
        pot: rectOf('.pot-display'), cardRow: rectOf('.own-card-row'), tray: rectOf('.betting-tray'), pre: rectOf('.pre-action-bar'), bet: rectOf('.hero-table-bet'),
      })
    }))
  }), { cue: cfg.cue, intensity: cfg.intensity, t, stepMsNow })
  await page.addStyleTag({ content: '.betting-tray{opacity:0 !important}' })

  const results = {}
  for (const size of sizes) {
    const cfg = SIZE[size]
    if (!cfg) continue
    const T_END = 1.7
    if (!(await findHand())) throw new Error('no suitable hand for ' + size)
    await sleep(500)
    await page.evaluate(() => { window.__manual = true })
    await stepAt({ cue: 'ready', intensity: 0.5 }, 1e9, 400)
    const frames = []
    const trace = []
    for (let t = 0; t <= T_END * 1000 + 1; t += stepMs) {
      const info = await stepAt(cfg, t, stepMs)
      trace.push({ t, ...info })
      if (els.some(want => Math.abs(want - t) < stepMs / 2)) {
        const buf = await page.screenshot({ clip: { x: crop[0], y: crop[1], width: crop[2], height: crop[3] }, type: 'png' })
        frames.push({ t, buf })
      }
    }
    await page.evaluate(() => { const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime; rt.firstPersonHands.debugForce = null; window.__manual = false })
    // Contact sheet.
    const tiles = []
    for (const f of frames) {
      const resized = await sharp(f.buf).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true })
      const svg = Buffer.from(`<svg width="${resized.info.width}" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="20" fill="black" fill-opacity="0.65"/><text x="5" y="14" font-family="Arial" font-size="13" fill="#ffd24a">${size} ${f.t}ms</text></svg>`)
      tiles.push({ input: await sharp(resized.data).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer(), w: resized.info.width, h: resized.info.height })
    }
    const rows = Math.ceil(tiles.length / cols)
    await sharp({ create: { width: tiles[0].w * cols, height: tiles[0].h * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((t, i) => ({ input: t.input, left: (i % cols) * t.w, top: Math.floor(i / cols) * t.h })))
      .png().toFile(path.join(outDir, `push-${size}-${tag}.png`))

    // Numbers: hand coverage by overlays, follow distance.
    const px = hand => [(hand[0] + 1) / 2 * width, (1 - hand[1]) / 2 * height]
    const cover = (hand, box) => {
      if (!box || hand[2] < 0.5) return 0
      const [cx, wy] = px(hand)
      const hw = 0.0375 * width, hh = 0.115 * height
      const w = Math.max(0, Math.min(cx + hw, box[2]) - Math.max(cx - hw, box[0]))
      const h = Math.max(0, Math.min(wy, box[3]) - Math.max(wy - hh, box[1]))
      return (w * h) / (2 * hw * hh)
    }
    const worst = {}
    let framesCovered = 0
    for (const s of trace) {
      let any = 0
      for (const [name, hand] of [['R', s.R], ['L', s.L]]) {
        for (const [label, box] of [['pot', s.pot], ['cardRow', s.cardRow], ['pre', s.pre], ['bet', s.bet]]) {
          const c = cover(hand, box)
          any = Math.max(any, c)
          const key = name + ':' + label
          if (c > (worst[key]?.c ?? 0.001)) worst[key] = { c: +c.toFixed(2), t: s.t }
        }
      }
      if (any > 0.35) framesCovered += 1
    }
    const sample = trace.filter(s => s.t % 100 === 0 && s.t <= 1500).map(s => [s.t, ...px(s.R).map(Math.round), ...s.chips.map(Math.round)])
    console.log(size, 'style', trace[0].style, 'intensity', trace[5].intensity, trace[5].seatIntensity, trace[5].cueNow, 'worst overlay cover', JSON.stringify(worst), 'frames >35% covered', framesCovered, 'of', trace.length)
    console.log('  [t, wristX, wristY, chipX, chipY]', JSON.stringify(sample))
    results[size] = { trace }
  }
  await writeFile(path.join(outDir, `push-${tag}.json`), JSON.stringify(results))
  await context.close()
} catch (error) {
  console.log('error', error?.message ?? String(error))
} finally {
  await browser.close().catch(() => {})
}
