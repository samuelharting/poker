// First-person hands check: sits the hero at the 3D table, waits for the hero's
// turn and films each action. Usage: node scripts/snap-fp-hands.mjs <outDir> [actions...]
// actions: rest, peek, check, call, raise, allin, fold, drink, win, force:<cue>
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/fp-hands/run'
const wanted = process.argv.slice(3)
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true
  }
  return false
}
async function burst(page, prefix, frames, gapMs = 0) {
  const started = Date.now()
  for (let frame = 0; frame < frames; frame += 1) {
    const at = Date.now() - started
    await page.screenshot({ path: path.join(outDir, `${prefix}-${String(frame).padStart(2, '0')}-${at}ms.png`) })
    if (gapMs) await sleep(gapMs)
  }
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
process.on('uncaughtException', async error => { console.log('fatal', error.message); await browser.close().catch(() => {}); process.exit(1) })
process.on('unhandledRejection', async error => { console.log('fatal', String(error)); await browser.close().catch(() => {}); process.exit(1) })
const video = process.env.VIDEO === '1'
const context = await browser.newContext({ viewport: { width, height }, ...(video ? { recordVideo: { dir: path.join(outDir, 'vid'), size: { width, height } } } : {}) })
const page = await context.newPage()
if (process.env.REDUCED === '1') await page.emulateMedia({ reducedMotion: 'reduce' })
const t0 = Date.now()
const marks = []
const roomId = 'fp' + Math.random().toString(36).slice(2, 8)
await page.addInitScript(id => {
  // Private PartyKit room so other sessions sharing the dev server cannot fill the seats.
  const Native = window.WebSocket
  window.WebSocket = class extends Native { constructor(url, protocols) { super(String(url).replace(/crew22/i, id), protocols) } }
}, roomId)
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => { if (message.type() === 'error') console.log('console:', message.text().slice(0, 300)) })
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hand' + Math.floor(Math.random() * 900 + 100))
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
await clickVisible(page, /^Start game$/)
await sleep(5000)

// force:<cue>@<ms>[:peek|win|flick]  e.g. force:check@300  force:ready@0:peek  force:ready@0:win=0.8
const forceFrame = async (spec, label) => {
  if (!process.env.NOENSURE) await ensureHand()
  const [head, extra] = spec.split(':').length > 1 ? [spec.split(':')[0], spec.split(':').slice(1).join(':')] : [spec, '']
  const [cue, ms] = head.split('@')
  const force = { cue, elapsedMs: Number(ms ?? 1e9) }
  for (const part of extra.split(',').filter(Boolean)) {
    const [k, v] = part.split('=')
    if (k === 'peek') force.peeking = true
    if (k === 'win') force.winnerSeconds = Number(v ?? 1)
    if (k === 'flick') force.flickSeconds = Number(v ?? 0.3)
  }
  await page.evaluate(force => { document.querySelector('.desktop-3d-stage').__pokerRuntime.firstPersonHands.debugForce = force }, force)
  await sleep(450)
  await page.screenshot({ path: path.join(outDir, label + '.png') })
  if (process.env.DUMP) console.log(label, JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.desktop-3d-stage').__pokerRuntime; const h = r.firstPersonHands; const hero = [...r.seats.values()].find(x => x.isHero); const w = hero && r.wagers.get(hero.playerId); const p = hero?.stack.group.getWorldPosition(new h.root.position.constructor()); return { a: h.anchors, shown: h.shown.right, stack: p && [p.x, p.y, p.z], start: w && w.start.toArray(), target: w && w.target.toArray() } }), (k, v) => typeof v === 'number' ? +v.toFixed(2) : v))
}

// Keep a hand in progress so the hole cards, tray and chips are on screen.
async function ensureHand() {
  if (await page.locator('.own-card-row').count()) return
  await clickVisible(page, /^Start game$/)
  await page.waitForSelector('.own-card-row', { timeout: 8000 }).catch(() => {})
  await sleep(2500)
}

async function waitHeroTurn(timeout = 45000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await isVisibleButton(page, /^(Check|Call)/)) return true
    await clickVisible(page, /^Start game$/)
    await sleep(300)
  }
  return false
}

for (const action of wanted) {
  if (action === 'turn') { console.log('hero turn', await waitHeroTurn()); await sleep(600) }
  else if (action === 'play') { console.log('played', await clickVisible(page, /^(Check|Call)/)); await sleep(1500) }
  else if (action === 'deal') {
    await ensureHand()
    await page.evaluate(() => {
      const r = document.querySelector('.desktop-3d-stage').__pokerRuntime
      const hero = [...r.seats.values()].find(x => x.isHero)
      const now = (performance.now() - r.startTime) / 1000
      const cards = []
      for (let i = 0; i < 16; i += 1) cards.push({ kind: 'hole', releaseAt: 0.6 + i * 0.32, target: [Math.sin(i * 0.8) * 3, 0.45, -2.2 - (i % 3) * 0.4], slot: i >= 8 ? 1 : 0 })
      r.dealer = { seatId: hero.playerId, kind: 'hole', count: 8, schedule: { startedAt: now + 0.2, cards, duration: 0.6 + 16 * 0.32 + 1.2 } }
    })
    await sleep(900)
    for (let i = 0; i < 4; i += 1) { await page.screenshot({ path: path.join(outDir, 'deal-' + i + '.png') }); await sleep(250) }
    await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.dealer = null })
  }
  else if (action === 'perf') {
    await ensureHand()
    const measure = () => page.evaluate(() => new Promise(resolve => { let frames = 0; const t = performance.now(); const tick = () => { frames += 1; if (performance.now() - t > 4000) resolve(+(frames / 4).toFixed(1)); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) }))
    const setHands = on => page.evaluate(on => { const r = document.querySelector('.desktop-3d-stage').__pokerRuntime; r.firstPersonHands.root.visible = on; r.firstPersonHands.forceHide = !on }, on)
    const results = []
    for (let round = 0; round < 2; round += 1) {
      await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.firstPersonHands.forceHide = false })
      results.push(['hands', await measure()])
      await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.firstPersonHands.forceHide = true })
      results.push(['no hands', await measure()])
    }
    console.log('fps', JSON.stringify(results))
    console.log('hand meshes visible', await page.evaluate(() => { const r = document.querySelector('.desktop-3d-stage').__pokerRuntime; let n = 0; r.firstPersonHands.root.traverseVisible(o => { if (o.isMesh) n += 1 }); return n }))
  }
  else if (action === 'rest') { await burst(page, 'rest', 1) }
  else if (action.startsWith('force:')) { await forceFrame(action.slice(6), 'force-' + action.slice(6).replace(/[^a-z0-9=@.,-]/gi, '_')) }
  else if (action === 'peek') {
    const ok = await page.evaluate(() => !!document.querySelector('.own-card-row'))
    console.log('own card row', ok)
    const box = await page.locator('.own-card-row').first().boundingBox().catch(() => null)
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await sleep(350)
      await burst(page, 'peek', 4, 100)
      await page.mouse.up()
    }
  } else if (['check', 'call', 'fold', 'raise', 'allin', 'drink', 'flick'].includes(action)) {
    const got = action === 'drink' || action === 'flick' ? true : await waitHeroTurn()
    console.log(action, 'hero turn', got)
    if (!got) { await burst(page, action + '-noturn', 1); continue }
    const label = { check: /^Check/, call: /^Call/, fold: /^Fold/, raise: /^(Raise|Bet)/, allin: /All[- ]in/i, drink: /beer/i, flick: /flick/i }[action]
    if (action === 'flick') {
      await page.locator('[data-seat-player]').filter({ hasText: 'Bot' }).first().click({ force: true }).catch(() => {})
      await sleep(600)
    }
    marks.push({ action, at: (Date.now() - t0) / 1000 })
    // In-page trace of the real gesture (cue, elapsed, hand position) at frame rate.
    await page.evaluate(() => {
      const hands = document.querySelector('.desktop-3d-stage').__pokerRuntime.firstPersonHands
      window.__fpTrace = []
      const start = performance.now()
      const tick = () => {
        const r = hands.shown.right, l = hands.shown.left
        window.__fpTrace.push([Math.round(performance.now() - start), hands.input.cue, Math.round(hands.input.elapsedMs), +r.x.toFixed(2), +r.y.toFixed(2), +r.fist.toFixed(2), +l.x.toFixed(2), +l.y.toFixed(2), hands.cards[0].group.visible ? 1 : 0])
        if (performance.now() - start < 2600) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // CDP screencast: frames at the page's own render rate (page.screenshot is far slower than the 1s gesture).
    const cdp = await context.newCDPSession(page)
    const frames = []
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      frames.push({ at: Date.now(), data })
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })
    const clickedAt = Date.now()
    const clicked = await clickVisible(page, label)
    console.log(action, 'clicked', clicked)
    await sleep(2400)
    await cdp.send('Page.stopScreencast').catch(() => {})
    const useful = frames.filter(frame => frame.at >= clickedAt - 150)
    console.log(action, 'screencast frames', frames.length, 'after click', useful.length)
    const pick = []
    const wantFrames = Number(process.env.SHEET_FRAMES ?? 12)
    for (let i = 0; i < wantFrames && useful.length; i += 1) pick.push(useful[Math.min(useful.length - 1, Math.round((i * (useful.length - 1)) / Math.max(1, wantFrames - 1)))])
    const cropBox = (process.env.CROP ?? '170:340:1100:560').split(':').map(Number)
    const tiles = []
    for (let i = 0; i < pick.length; i += 1) {
      const buf = Buffer.from(pick[i].data, 'base64')
      const meta = await sharp(buf).metadata()
      const k = meta.width / width
      tiles.push(await sharp(buf).extract({ left: Math.round(cropBox[0] * k), top: Math.round(cropBox[1] * k), width: Math.round(cropBox[2] * k), height: Math.round(cropBox[3] * k) }).resize({ width: 480 }).png().toBuffer())
      if (i === 0 || i === pick.length - 1) await sharp(buf).toFile(path.join(outDir, action + '-full-' + i + '.png'))
    }
    if (tiles.length) {
      const th = (await sharp(tiles[0]).metadata()).height
      const cols = 3
      const rows = Math.ceil(tiles.length / cols)
      await sharp({ create: { width: 480 * cols, height: th * rows, channels: 3, background: '#000' } })
        .composite(tiles.map((input, index) => ({ input, left: (index % cols) * 480, top: Math.floor(index / cols) * th })))
        .png().toFile(path.join(outDir, 'real-' + action + '.png'))
    }
    const trace = await page.evaluate(() => window.__fpTrace)
    const step = Math.max(1, Math.floor(trace.length / 14))
    console.log(action, 'trace [ms, cue, elapsedMs, rightX, rightY, rightFist, leftX, leftY, cards]', JSON.stringify(trace.filter((_, i) => i % step === 0)))
  }
}
await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.firstPersonHands.debugForce = null })
console.log('stats', await page.evaluate(() => { const r = document.querySelector('.desktop-3d-stage')?.__pokerRuntime; return { calls: r.renderer.info.render.calls, tris: r.renderer.info.render.triangles } }))
const videoPath = video ? await page.video().path() : null
await context.close()
await browser.close()
if (videoPath) {
  const fps = Number(process.env.FPS ?? 10)
  const crop = process.env.CROP ?? '1100:560:170:340'
  for (const mark of marks) {
    const dir = path.join(outDir, 'frames-' + mark.action)
    await mkdir(dir, { recursive: true })
    const start = Math.max(0, mark.at - 0.4 + Number(process.env.VIDEO_LAG ?? 0))
    execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', '2.4', '-i', videoPath, '-vf', 'fps=' + fps + ',crop=' + crop, path.join(dir, 'f%02d.png')])
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(dir).filter(name => name.startsWith('f')).sort().map(name => path.join(dir, name))
    const [cw, ch] = crop.split(':').map(Number)
    const cols = 4
    const scale = 0.45
    const tw = Math.round(cw * scale), th = Math.round(ch * scale)
    const tiles = await Promise.all(files.slice(0, 24).map(file => sharp(file).resize({ width: tw }).png().toBuffer()))
    const rows = Math.ceil(tiles.length / cols)
    await sharp({ create: { width: tw * cols, height: th * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((input, index) => ({ input, left: (index % cols) * tw, top: Math.floor(index / cols) * th })))
      .png().toFile(path.join(outDir, 'sheet-' + mark.action + '.png'))
  }
}
