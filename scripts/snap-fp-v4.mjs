// First-person hands, real-click verification (fold toss clearance, hero dealing, real raises).
// Usage: node scripts/snap-fp-v4.mjs <outDir> <mode> [tag]
//   mode: fold | deal | raise
//   env:  SNAP_WIDTH/SNAP_HEIGHT (default 1280x720), BOTS=2, FRAMES=12, RAISES=min,half,pot,allin
// One browser, always closed. Real clicks only (Fold / Raise / quick-size buttons / All-in), a private room,
// an in-page per-frame trace (hand poses, toss cards, overlay rectangles, chips) and a CDP screencast
// that becomes a contact sheet labelled with the gesture clock.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v4/fp'
const mode = process.argv[3] ?? 'fold'
const tag = process.argv[4] ?? 'run'
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const bots = Number(process.env.BOTS ?? 2)
const sheetFrames = Number(process.env.FRAMES ?? 12)
const slowmo = Number(process.env.SLOWMO ?? 1)
const pickEls = process.env.ELS ? process.env.ELS.split(',').map(Number) : null
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name, force = true) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500, force }).then(() => true, () => false)) return true
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
  }, roomId)
  // SLOWMO=0.2: a controllable scene clock (window.__tscale) so the gestures can be sampled densely on a slow machine.
  await page.addInitScript(() => {
    const base = performance.now.bind(performance)
    let lastReal = base(), virtual = lastReal
    window.__tscale = 1
    performance.now = () => { const real = base(); virtual += (real - lastReal) * window.__tscale; lastReal = real; return virtual }
  })
  page.on('pageerror', error => console.log('pageerror:', error.message))
  await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
  await page.getByLabel('Your nickname').fill('Hand' + Math.floor(Math.random() * 900 + 100))
  await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
  await page.waitForURL(/\/room\//)
  await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
  for (let attempt = 0; attempt < bots; attempt += 1) {
    await clickVisible(page, /^Add bot$/)
    await sleep(500)
  }
  await page.waitForFunction(n => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= n, bots, { timeout: 60000 }).catch(() => {})
  await clickVisible(page, /^Start game$/)
  await sleep(4000)

  // Per-frame trace, kept in the page (re-installed if a dev-server reload wipes the page).
  const installTrace = () => page.evaluate(() => {
    if (window.__traceInstalled) return
    window.__traceInstalled = true
    const stage = document.querySelector('.desktop-3d-stage')
    const rt = stage.__pokerRuntime
    const hands = rt.firstPersonHands
    const hero = () => [...rt.seats.values()].find(s => s.isHero)
    window.__trace = []
    window.__traceOn = false
    window.__origins = []
    const seen = new Set()
    const v = new (rt.camera.position.constructor)()
    const rectOf = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
    const proj = (x, y, z) => { v.set(x, y, z).project(rt.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] }
    const tick = () => {
      requestAnimationFrame(tick)
      if (!window.__traceOn) return
      const h = hero()
      const r = hands.shown.right, l = hands.shown.left
      const cams = rt.camera
      const tanHalf = Math.tan(cams.fov * Math.PI / 360)
      const cardPx = []
      if (hands.cards[0].group.visible) {
        for (const c of hands.cards) {
          c.group.getWorldPosition(v)
          const local = c.group.position
          const depth = -local.z
          v.project(cams)
          cardPx.push([(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, depth > 0 ? 0.062 * hands.shown.cards.scale * (innerHeight / 2) / (depth * tanHalf) : 0])
        }
      }
      const wager = h && rt.wagers.get(h.playerId)
      let chips = null
      if (wager && wager.group.visible) { wager.group.getWorldPosition(v); v.project(cams); chips = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, wager.animating ? 1 : 0, wager.amount] }
      const dp = h && h.dealPose
      const scene = stage.closest('.table-scene') ?? stage
      if (window.__ring && window.__trace.length > window.__ring) window.__trace.splice(0, 200)
      window.__trace.push({
        t: Date.now(),
        cue: hands.input.cue, el: Math.round(hands.input.elapsedMs),
        R: [r.x, r.y, r.show, r.pitch, r.fist, r.depth, r.open, r.pinch], L: [l.x, l.y, l.show, l.pitch, l.fist, l.depth],
        cards: cardPx,
        chips,
        deal: dp ? [dp.weight, dp.released, dp.index] : null,
        dealer: rt.dealer ? [rt.dealer.seatId === (h && h.playerId) ? 1 : 0, rt.dealer.kind] : null,
        heroDealer: h ? Boolean(h.dealerButton.visible) : false,
        pot: rectOf(scene.querySelector('.pot-display')), actionTray: rectOf(document.querySelector('.betting-tray')), cardRow: rectOf(document.querySelector('.own-card-row')),
        heroBet: rectOf(scene.querySelector('.hero-table-bet')),
        preBar: rectOf(scene.querySelector('.pre-action-bar')),
        mark: window.__mark ?? null,
      })
      // Where each dealt card actually left the hand vs the drawn right fingertips.
      for (const s of rt.seats.values()) {
        const o = s.dealOrigins
        if (!o) continue
        o.forEach((origin, index) => {
          const key = s.playerId + ':' + index + ':' + (rt.dealer ? rt.dealer.schedule.startedAt : 0)
          if (!origin || seen.has(key)) return
          seen.add(key)
          s.root.updateWorldMatrix(true, false)
          v.set(origin[0], origin[1], origin[2])
          s.root.localToWorld(v)
          v.project(cams)
          // The drawn fingertips of the hand that is pitching (right normally, left when the right is busy folding; 0 = the deck's spot).
          const side = hands.target.dealHand
          const hp = side === -1 ? l : r
          const depth = side === 0 ? 0.72 : Math.max(0.45, hp.depth)
          const px = side === 0 ? hands.anchors.dealLeftX : hp.x, py = side === 0 ? hands.anchors.dealLeftY : hp.y, pitch = side === 0 ? 0.5 : hp.pitch
          const tipLocal = new (cams.position.constructor)(px * depth * tanHalf * cams.aspect, py * depth * tanHalf + 0.12 * Math.sin(pitch), -depth - 0.12 * Math.cos(pitch))
          cams.updateMatrixWorld()
          cams.localToWorld(tipLocal)
          tipLocal.project(cams)
          window.__origins.push({ t: Date.now(), seat: s.playerId.slice(0, 6), index, side, origin: [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight], tip: [(tipLocal.x + 1) / 2 * innerWidth, (1 - tipLocal.y) / 2 * innerHeight], wrist: [(px + 1) / 2 * innerWidth, (1 - py) / 2 * innerHeight] })
        })
      }
    }
    requestAnimationFrame(tick)
  })
  await installTrace()

  const startRecording = async () => {
    await installTrace().catch(() => {})
    const cdp = await context.newCDPSession(page)
    const frames = []
    cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      frames.push({ at: Date.now(), data })
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await page.evaluate(() => { window.__trace = []; window.__origins = []; window.__traceOn = true })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 })
    return {
      async stop() {
        await cdp.send('Page.stopScreencast').catch(() => {})
        await page.evaluate(() => { window.__traceOn = false })
        const trace = await page.evaluate(() => window.__trace)
        const origins = await page.evaluate(() => window.__origins)
        await cdp.detach().catch(() => {})
        return { frames, trace, origins }
      },
    }
  }

  async function sheet(name, frames, trace, startAt, pickCount, cropBox) {
    const useful = frames.filter(f => f.at >= startAt - 150)
    const pick = []
    if (pickEls) {
      // Frames whose gesture clock is nearest each wanted time (ms since the action began).
      for (const want of pickEls) {
        let best = null, bestGap = Infinity
        for (const f of useful) {
          const near = trace.reduce((b, s) => (!b || Math.abs(s.t - f.at) < Math.abs(b.t - f.at) ? s : b), null)
          if (!near || near.cue === 'ready') continue
          const gap = Math.abs(near.el - want)
          if (gap < bestGap) { bestGap = gap; best = f }
        }
        if (best) pick.push(best)
      }
    } else for (let i = 0; i < pickCount && useful.length; i += 1) pick.push(useful[Math.min(useful.length - 1, Math.round((i * (useful.length - 1)) / Math.max(1, pickCount - 1)))])
    const cols = Number(process.env.COLS ?? 3)
    const tiles = []
    for (const f of pick) {
      const buf = Buffer.from(f.data, 'base64')
      const meta = await sharp(buf).metadata()
      const k = meta.width / width
      const [cx, cy, cw, ch] = cropBox
      const tileW = 520
      const near = trace.reduce((best, s) => (!best || Math.abs(s.t - f.at) < Math.abs(best.t - f.at) ? s : best), null)
      const label = `${((f.at - startAt) / 1000).toFixed(2)}s  ${near ? near.cue + ' el=' + near.el : ''}`
      const resized = await sharp(buf).extract({ left: Math.round(cx * k), top: Math.round(cy * k), width: Math.round(cw * k), height: Math.round(ch * k) }).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true })
      const svg = Buffer.from(`<svg width="${resized.info.width}" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="20" fill="black" fill-opacity="0.65"/><text x="5" y="14" font-family="Arial" font-size="13" fill="#ffd24a">${label}</text></svg>`)
      tiles.push({ input: await sharp(resized.data).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer(), w: resized.info.width, h: resized.info.height })
    }
    if (!tiles.length) return
    const rows = Math.ceil(tiles.length / cols)
    await sharp({ create: { width: tiles[0].w * cols, height: tiles[0].h * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((t, i) => ({ input: t.input, left: (i % cols) * t.w, top: Math.floor(i / cols) * t.h })))
      .png().toFile(path.join(outDir, name))
  }

  // Advance the hand when it is not the one we want: Deal next hand / Start, otherwise check or fold on the hero's turn.
  async function advance(preferFold = true) {
    if (await clickVisible(page, /^Deal next hand$/)) return 'deal'
    if (await clickVisible(page, /^Start game$/)) return 'start'
    if (preferFold && await clickVisible(page, /^Fold/)) return 'fold'
    if (await clickVisible(page, /^(Check|Call)/)) return 'play'
    return null
  }
  async function waitHeroTurn(timeout = 60000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await isVisibleButton(page, /^Fold/)) return true
      await advance(false)
      await sleep(350)
    }
    return false
  }

  // Fraction of the drawn hand (wrist +-0.075, up 0.23 NDC) that a DOM box covers.
  const coverage = (hand, box) => {
    if (!box || hand[2] < 0.5) return 0
    const hw = 0.0375 * width, hh = 0.115 * height
    const cx = (hand[0] + 1) / 2 * width, wy = (1 - hand[1]) / 2 * height
    const hl = cx - hw, hr = cx + hw, ht = wy - hh, hb = wy
    const w = Math.max(0, Math.min(hr, box[2]) - Math.max(hl, box[0]))
    const h = Math.max(0, Math.min(hb, box[3]) - Math.max(ht, box[1]))
    return (w * h) / (4 * hw * hh / 2)
  }
  const crop = (process.env.CROP ?? `${Math.round(width * 0.1)}:${Math.round(height * 0.32)}:${Math.round(width * 0.8)}:${Math.round(height * 0.68)}`).split(':').map(Number)

  if (mode === 'fold') {
    const runs = Number(process.env.RUNS ?? 1)
    for (let run = 0; run < runs; run += 1) {
      const got = await waitHeroTurn()
      console.log('fold hero turn', got)
      if (!got) break
      await sleep(700)
      const rec = await startRecording()
      const startAt = Date.now()
      await clickVisible(page, /^Fold/)
      await sleep(Number(process.env.HOLD_MS ?? 1900))
      const { frames, trace } = await rec.stop()
      await sheet(`fold-${tag}-${run}.png`, frames, trace, startAt, sheetFrames, crop)
      // Clearance between the flying cards and the pot label (px; negative = overlapping).
      let worst = Infinity, worstAt = null, tossFrames = 0
      let potBox = null
      for (const s of trace) {
        if (!s.cards.length) continue
        tossFrames += 1
        potBox = s.pot ?? potBox
        if (!s.pot) continue
        for (const [cx, cy, rad] of s.cards) {
          const dx = Math.max(s.pot[0] - cx, 0, cx - s.pot[2])
          const dy = Math.max(s.pot[1] - cy, 0, cy - s.pot[3])
          const gap = Math.hypot(dx, dy) - rad
          if (gap < worst) { worst = gap; worstAt = { el: s.el, card: [Math.round(cx), Math.round(cy), Math.round(rad)], pot: s.pot } }
        }
      }
      console.log('fold toss frames', tossFrames, 'pot', JSON.stringify(potBox), 'min gap to pot label px', worst.toFixed(1), JSON.stringify(worstAt))
      const last = trace.filter(s => s.cards.length)
      const pathOut = last.filter((_, i) => i % Math.max(1, Math.floor(last.length / 14)) === 0).map(s => [s.el, ...s.cards.slice(0, 1).map(c => c.map(n => Math.round(n)))])
      console.log('card path [el, x, y, radius]', JSON.stringify(pathOut))
      await writeFile(path.join(outDir, `fold-${tag}-${run}.json`), JSON.stringify({ worst, worstAt, potBox, trace: last }, null, 0))
      await sleep(2500)
    }
  }


  if (mode === 'probe') {
    for (let handIndex = 0; handIndex < 8; handIndex += 1) {
      await page.evaluate(() => { window.__trace = []; window.__traceOn = true })
      for (let i = 0; i < 40; i += 1) { if ((await clickVisible(page, /^Deal next hand$/)) || (await clickVisible(page, /^Start game$/))) break; await sleep(250) }
      await sleep(4500)
      const trace = await page.evaluate(() => { window.__traceOn = false; return window.__trace })
      const info = await page.evaluate(() => { const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime; return [...rt.seats.values()].map(s => ({ hero: s.isHero, button: s.dealerButton.visible, hadCards: s.hadCards })) })
      const heroDealer = trace.filter(s => s.heroDealer).length
      const dealerRuntime = trace.filter(s => s.dealer).length
      const heroDeal = trace.filter(s => s.dealer && s.dealer[0] === 1).length
      const weighted = trace.filter(s => s.deal && s.deal[0] > 0.01).length
      console.log('hand', handIndex, 'frames', trace.length, 'heroButtonFrames', heroDealer, 'dealerRuntimeFrames', dealerRuntime, 'heroDealFrames', heroDeal, 'weighted', weighted, JSON.stringify(info))
      for (let i = 0; i < 60; i += 1) {
        if (await isVisibleButton(page, /^Deal next hand$/)) break
        if (await clickVisible(page, /^Fold/)) { await sleep(500); continue }
        await clickVisible(page, /^(Check|Call)/)
        await sleep(400)
      }
    }
  }


  if (mode === 'poll') {
    const end = Date.now() + Number(process.env.POLL_MS ?? 70000)
    let last = ''
    while (Date.now() < end) {
      const info = await page.evaluate(() => {
        const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
        const seats = [...rt.seats.values()]
        const t = (performance.now() - rt.startTime) / 1000
        const names = [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
        return { t: +t.toFixed(1), btn: seats.map(s => (s.isHero ? 'H' : 'b') + (s.dealerButton.visible ? 'D' : '-') + (s.hadCards ? 'c' : '-') + (s.folded ? 'f' : '')).join(' '), dealer: rt.dealer ? rt.dealer.kind + '@' + rt.dealer.schedule.startedAt.toFixed(1) + ' seat=' + (seats.find(s => s.playerId === rt.dealer.seatId)?.isHero ? 'hero' : 'bot') : null, hands: window.__w ?? null, names }
      })
      const line = JSON.stringify({ ...info, t: undefined })
      if (line !== last) { console.log(info.t, line); last = line }
      if (await isVisibleButton(page, /^Fold/)) { await clickVisible(page, /^Fold/); console.log('  clicked fold') }
      else if (await clickVisible(page, /^Deal next hand$/)) console.log('  clicked deal next')
      await sleep(300)
    }
  }


  if (mode === 'btns') {
    await waitHeroTurn()
    await sleep(800)
    console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /raise|bet|all-in|check|call|fold/i.test((b.getAttribute('aria-label') || '') + b.innerText)).map(b => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2)); return { t: (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ').slice(0, 30), rect: [r.left, r.top, r.right, r.bottom].map(Math.round), dis: b.disabled, vis: b.offsetParent !== null, hit: top === b || b.contains(top) } }))))
  }

  if (mode === 'deal') {
    // Continuous screencast + trace ring buffers. Auto-start is on, so just fold whenever it is the hero's turn
    // (never during the hero's own deal) until a hole deal with the hero as dealer has played out.
    const wantKind = process.env.DEAL_KIND ?? 'hole'
    await page.evaluate(() => { window.__traceOn = true; window.__ring = 1800 })
    const cdp = await context.newCDPSession(page)
    const frames = []
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      frames.push({ at: Date.now(), data })
      if (frames.length > 420) frames.shift()
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: Number(process.env.JPEG ?? 80), everyNthFrame: Number(process.env.NTH ?? 2) })
    const deadline = Date.now() + Number(process.env.DEAL_WAIT_MS ?? 240000)
    let detected = 0
    // FOLD_AT_MS: the hero folds this many scene ms after their own deal starts (a real click on Fold).
    const foldAt = process.env.FOLD_AT_MS !== undefined ? Number(process.env.FOLD_AT_MS) : null
    let folded = false, foldClickedAt = 0
    while (Date.now() < deadline) {
      await installTrace().catch(() => {})
      await page.evaluate(() => { if (window.__traceInstalled && window.__traceOn === false && !window.__done) window.__traceOn = true; window.__ring = 1800 }).catch(() => {})
      // NO_DRINK=1: the house rules hand the hero a forced drink right after a fold, and the glass takes the left hand
      // away; keep the hands free so the left-hand deal can be seen (the drink is only hidden, the game is untouched).
      if (process.env.NO_DRINK) await page.evaluate(() => {
        const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
        if (!rt) return
        for (const root of [rt.firstPersonDrink.root, rt.pranks.firstPerson.root]) {
          if (!root.__noDrink) { root.__noDrink = true; Object.defineProperty(root, 'visible', { get: () => false, set: () => {}, configurable: true }) }
        }
      }).catch(() => {})
      const st = await page.evaluate(() => {
        const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
        if (!rt) return { hero: false, kind: null, any: true }
        const hero = [...rt.seats.values()].find(x => x.isHero)
        return { hero: Boolean(rt.dealer && hero && rt.dealer.seatId === hero.playerId), kind: rt.dealer?.kind ?? null, any: Boolean(rt.dealer) }
      })
      if (st.hero && st.kind === wantKind) {
        if (!detected) { detected = Date.now(); console.log('hero', wantKind, 'deal detected'); if (slowmo !== 1) await page.evaluate(k => { window.__tscale = k }, slowmo) }
        if (foldAt !== null && !folded && Date.now() - detected >= foldAt / slowmo) {
          if (await clickVisible(page, /^Fold/)) { folded = true; foldClickedAt = Date.now(); console.log('clicked Fold', foldAt, 'scene ms into the deal') }
        }
      } else if (detected && !st.any) { await sleep(1200); break }
      else if (!st.any) {
        if (await clickVisible(page, wantKind === 'board' ? /^(Check|Call)/ : /^Fold/)) await sleep(300)
        else if (await clickVisible(page, /^Deal next hand$/)) await sleep(300)
      }
      await sleep(120)
    }
    await cdp.send('Page.stopScreencast').catch(() => {})
    await page.evaluate(() => { window.__tscale = 1 })
    const trace = await page.evaluate(() => { window.__traceOn = false; return window.__trace })
    const origins = await page.evaluate(() => window.__origins)
    if (!detected) console.log('hero never dealt')
    else if (foldAt !== null) {
      // Fold during the hero's own deal: every dealt card against the drawn fingertips, the sheet around the whole deal.
      const inDeal = trace.filter(s => s.dealer && s.dealer[0] === 1 && s.dealer[1] === wantKind)
      const first = inDeal[0]?.t ?? detected
      const lastT = inDeal[inDeal.length - 1]?.t ?? detected
      console.log('hero deal frames', inDeal.length, 'span ms', lastT - first, 'fold clicked at ms', foldClickedAt ? foldClickedAt - first : null)
      const pick = Number(process.env.FRAMES ?? 15)
      // PICK_MS=0,200,...: frames nearest those offsets (ms after the hero's deal starts); otherwise evenly spread.
      const pickMs = process.env.PICK_MS ? process.env.PICK_MS.split(',').map(Number) : null
      const inSpan = frames.filter(f => f.at >= first - 300 && f.at <= lastT + 900)
      const chosen = pickMs ? pickMs.map(ms => inSpan.reduce((b, f) => (!b || Math.abs(f.at - first - ms) < Math.abs(b.at - first - ms) ? f : b), null)).filter(Boolean) : inSpan
      await sheet(`folddeal-${tag}.png`, chosen, trace, first - 300, pickMs ? chosen.length : pick, crop)
      const cues = inDeal.filter((_, i) => i % Math.max(1, Math.floor(inDeal.length / 40)) === 0).map(s => [s.t - first, s.cue, s.el, s.deal ? +s.deal[0].toFixed(2) : null, s.deal ? s.deal[1] : null, +s.R[0].toFixed(2), +s.R[1].toFixed(2), +s.R[2].toFixed(2)])
      console.log('trace [ms, cue, el, dealWeight, released, Rx, Ry, Rshow]', JSON.stringify(cues))
      console.log('card origins (px) vs drawn pitching-hand fingertip (px) vs wrist', JSON.stringify(origins.filter(o => o.t > first - 100).map(o => ({ idx: o.index, seat: o.seat, side: o.side, ms: o.t - first, origin: o.origin.map(Math.round), tip: o.tip.map(Math.round), wrist: o.wrist.map(Math.round), off: Math.round(Math.hypot(o.origin[0] - o.tip[0], o.origin[1] - o.tip[1])) }))))
      await writeFile(path.join(outDir, `folddeal-${tag}.json`), JSON.stringify({ foldAt, foldClickedMs: foldClickedAt - first, origins: origins.map(o => ({ ...o, ms: o.t - first })), trace: inDeal.map(s => ({ ms: s.t - first, cue: s.cue, el: s.el, deal: s.deal, R: s.R, L: s.L })) }))
    } else {
      const dealing = trace.filter(s => s.deal && s.deal[0] > 0.001 && s.dealer && s.dealer[0] === 1)
      const first = dealing[0]?.t ?? detected
      const lastT = dealing[dealing.length - 1]?.t ?? detected
      console.log('deal span ms', lastT - first, 'weighted frames', dealing.length)
      await sheet(`deal-${tag}.png`, frames.filter(f => f.at >= first - 400 && f.at <= lastT + 600), trace, first - 400, Number(process.env.FRAMES ?? 15), crop)
      const rows = dealing.filter((_, i) => i % Math.max(1, Math.floor(dealing.length / 36)) === 0).map(s => [s.t - first, +s.deal[0].toFixed(2), s.deal[1], +s.R[0].toFixed(2), +s.R[1].toFixed(2), +s.R[2].toFixed(2), +s.L[0].toFixed(2), +s.L[1].toFixed(2), s.cue])
      console.log('deal trace [ms, weight, released, Rx, Ry, Rshow, Lx, Ly, cue]', JSON.stringify(rows))
      const inHole = trace.filter(s => s.dealer && s.dealer[0] === 1 && s.dealer[1] === wantKind)
      const zeroW = inHole.filter(s => !s.deal || s.deal[0] < 0.01).length
      console.log('hero-dealer frames', inHole.length, 'of which weight~0:', zeroW, 'weight range', Math.min(...dealing.map(s => s.deal[0])).toFixed(2), Math.max(...dealing.map(s => s.deal[0])).toFixed(2))
      let jump = 0, jumpAt = null
      for (let i = 1; i < dealing.length; i += 1) {
        const d = Math.hypot(dealing[i].R[0] - dealing[i - 1].R[0], dealing[i].R[1] - dealing[i - 1].R[1])
        if (d > jump) { jump = d; jumpAt = dealing[i].t - first }
      }
      console.log('largest right-wrist step between frames (NDC)', jump.toFixed(3), 'at ms', jumpAt)
      const minY = { R: Math.min(...dealing.map(s => s.R[1])), L: Math.min(...dealing.map(s => s.L[1])) }
      console.log('lowest wrist y during deal R/L', minY.R.toFixed(2), minY.L.toFixed(2), '(rest is -0.8)')
      const overlaps = []
      for (const s of dealing) {
        for (const [name, hand] of [['R', s.R], ['L', s.L]]) {
          const px = (hand[0] + 1) / 2 * width
          const wy = (1 - hand[1]) / 2 * height
          const ty = wy - 0.23 * height / 2
          for (const [label, box] of [['pot', s.pot], ['cards', s.cardRow], ['heroBet', s.heroBet], ['actionTray', s.actionTray]]) {
            if (!box) continue
            const inside = y => px > box[0] - 20 && px < box[2] + 20 && y > box[1] && y < box[3]
            if (inside(wy) || inside(ty) || inside((wy + ty) / 2)) overlaps.push(`${name}:${label}@${s.t - first}`)
          }
        }
      }
      console.log('hand/overlay overlaps (wrist, mid or fingertip inside a DOM box +-20px)', overlaps.length, [...new Set(overlaps.map(o => o.split('@')[0]))].join(','))
      const dealCover = {}
      for (const s2 of dealing) for (const [name, hand] of [['R', s2.R], ['L', s2.L]]) for (const [label2, box] of [['pot', s2.pot], ['cardRow', s2.cardRow], ['actionTray', s2.actionTray], ['preBar', s2.preBar]]) { const c = coverage(hand, box); const key = name + ':' + label2; if (c > (dealCover[key]?.c ?? 0.001)) dealCover[key] = { c: +c.toFixed(2), ms: s2.t - first } }
      console.log('deal: hand area covered by overlays (max fraction)', JSON.stringify(dealCover))
      // Timing: the right hand's open (snap) peak against each card's launch.
      const firstOrigin = origins.filter(o => o.t > first)
      const timing = firstOrigin.map(o => {
        const near = dealing.filter(s => Math.abs(s.t - o.t) < 330)
        const peak = near.reduce((b, s) => (!b || s.R[6] > b.R[6] ? s : b), null)
        const at = near.reduce((b, s) => (!b || Math.abs(s.t - o.t) < Math.abs(b.t - o.t) ? s : b), null)
        return { idx: o.index, launchMs: o.t - first, openAtLaunch: at ? +at.R[6].toFixed(2) : null, peakOpenMs: peak ? peak.t - first : null, peakOpen: peak ? +peak.R[6].toFixed(2) : null }
      })
      console.log('snap timing (launch vs open peak)', JSON.stringify(timing))
      console.log('card origins vs drawn fingertip px', JSON.stringify(origins.map(o => ({ idx: o.index, seat: o.seat, origin: o.origin.map(Math.round), tip: o.tip.map(Math.round), wrist: o.wrist.map(Math.round), dt: o.t - first }))))
      await writeFile(path.join(outDir, `deal-${tag}.json`), JSON.stringify({ rows, origins: origins.filter(o => o.t > first).map(o => ({ idx: o.index, ms: o.t - first, origin: o.origin, tip: o.tip })), series: dealing.map(s => [s.t - first, +s.R[6].toFixed(3), +s.R[7].toFixed(3), +s.R[0].toFixed(3), +s.R[1].toFixed(3), +s.deal[0].toFixed(3), s.deal[1]]) }, null, 0))
    }
  }

  if (mode === 'raise') {
    const sizes = (process.env.RAISES ?? 'min,half,pot,allin').split(',')
    for (const size of sizes) {
      const got = await waitHeroTurn()
      console.log('raise', size, 'hero turn', got)
      if (!got) continue
      await sleep(900)
      const has = await isVisibleButton(page, /^(Raise to|Bet) \$\d/)
      const hasAll = await isVisibleButton(page, /All-in/i)
      let label = size
      if (size === 'allin') {
        if (!hasAll) { console.log('no all-in button'); await clickVisible(page, /^Fold/); continue }
      } else {
        if (!has) { console.log('no raise button'); await clickVisible(page, /^Fold/); continue }
        if (size === 'min') await page.getByRole('button', { name: 'Min', exact: true }).first().click({ force: true }).catch(() => {})
        else if (size === 'half') await page.getByRole('button', { name: '1/2 Pot' }).first().click({ force: true }).catch(() => {})
        else if (size === 'pot') await page.getByRole('button', { name: /^Pot$/ }).first().click({ force: true }).catch(() => {})
        else if (size === 'quarter') await page.getByRole('button', { name: '1/4 Pot' }).first().click({ force: true }).catch(() => {})
        else if (size === 'slider') {
          const slider = page.locator('input.raise-slider').first()
          await slider.evaluate(el => { const max = Number(el.max), min = Number(el.min); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(Math.round(min + (max - min) * 0.35))); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })
        }
        await sleep(300)
        label = size + ' ' + await page.locator('.btn-raise').first().innerText().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '?')
      }
      const rec = await startRecording()
      const startAt = Date.now()
      await page.evaluate(k => { window.__tscale = k }, slowmo)
      const clicked = size === 'allin' ? await clickVisible(page, /All-in/i) : await clickVisible(page, /^(Raise to|Bet) \$\d/)
      console.log('clicked', clicked, label)
      await sleep(2800 / slowmo)
      await page.evaluate(() => { window.__tscale = 1 })
      const { frames, trace } = await rec.stop()
      await sheet(`raise-${size}-${tag}.png`, frames, trace, startAt, sheetFrames, crop)
      // How the gesture was shaped, and whether the hands ever hid.
      const act = trace.filter(s => s.cue !== 'ready' && s.el >= 0 && s.el < 2000)
      const cue = act[0]?.cue
      let minShowR = 1, minShowL = 1, maxLeftTravel = 0, maxRightTravel = 0
      const restL = act[0]?.L, restR = act[0]?.R
      for (const s of act) {
        minShowR = Math.min(minShowR, s.R[2]); minShowL = Math.min(minShowL, s.L[2])
        if (restL) maxLeftTravel = Math.max(maxLeftTravel, Math.hypot(s.L[0] - restL[0], s.L[1] - restL[1]))
        if (restR) maxRightTravel = Math.max(maxRightTravel, Math.hypot(s.R[0] - restR[0], s.R[1] - restR[1]))
      }
      console.log('raise', size, 'cue', cue, 'right travel', maxRightTravel.toFixed(2), 'left travel', maxLeftTravel.toFixed(2), 'min show', minShowR.toFixed(2), minShowL.toFixed(2))
      // Hands vs chips: gap between the right wrist and the pile on screen over the push.
      const sync = act.filter(s => s.chips && s.chips[2] === 1).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 10)) === 0).map(s => [s.el, Math.round((s.R[0] + 1) / 2 * width), Math.round((1 - s.R[1]) / 2 * height), Math.round(s.chips[0]), Math.round(s.chips[1])])
      console.log('push sync [el, wristX, wristY, chipsX, chipsY]', JSON.stringify(sync))
      const worstCover = {}
      for (const s2 of act) {
        for (const [name, hand] of [['R', s2.R], ['L', s2.L]]) {
          for (const [label2, box] of [['pot', s2.pot], ['cardRow', s2.cardRow], ['actionTray', s2.actionTray], ['preBar', s2.preBar], ['heroBet', s2.heroBet]]) {
            const c = coverage(hand, box)
            const key = name + ':' + label2
            if (c > (worstCover[key]?.c ?? 0.001)) worstCover[key] = { c: +c.toFixed(2), el: s2.el }
          }
        }
      }
      console.log('hand area covered by overlays (max fraction, at el ms)', JSON.stringify(worstCover))
      await writeFile(path.join(outDir, `raise-${size}-${tag}.json`), JSON.stringify({ cue, trace: act }, null, 0))
      // Finish the hand quickly.
      for (let i = 0; i < 40; i += 1) {
        if (await isVisibleButton(page, /^Deal next hand$/)) break
        if (await clickVisible(page, /^Fold/)) { await sleep(400); continue }
        await sleep(400)
      }
    }
  }
  await context.close()
} catch (error) {
  console.log('error', error?.message ?? String(error))
} finally {
  await browser.close().catch(() => {})
}
