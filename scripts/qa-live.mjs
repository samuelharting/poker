// Live checks of features that were only unit tested. ONE headless browser at a time, always closed.
//   node scripts/qa-live.mjs hero <outDir>   heads-up table: hero holds the button (first-person deal), then hero wins (fist pump, showdown camera)
//   node scripts/qa-live.mjs talk <outDir>   full table: photographs a conversation between two non-folded bots
// Env: SNAP_WIDTH/SNAP_HEIGHT (default 1280x720), SLOW (scene clock factor for dense frames, default 0.35)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launch, usePrivateRoom, makeRoomId, enterRoom, clickVisible, sleep, fillSeats, waitForModels } from './qa-lib.mjs'

const mode = process.argv[2] ?? 'hero'
const outDir = process.argv[3] ?? `output/v2/qa/live-${mode}`
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const slow = Number(process.env.SLOW ?? 0.35)
const maxMs = Number(process.env.QA_MAX_MS ?? 360000)
await mkdir(outDir, { recursive: true })

const browser = await launch()
const errors = []
let exitCode = 0
try {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
  await usePrivateRoom(page, makeRoomId('lv'))
  await enterRoom(page, 'Hero')
  if (mode === 'hero') {
    await clickVisible(page, /^Add bot$/)
    await sleep(800)
  } else {
    await fillSeats(page, 7)
  }
  await waitForModels(page, mode === 'hero' ? 2 : 7)
  await sleep(1000)
  // Slow the scene clock (animations only) so a slow machine still catches dense frames.
  await page.evaluate(factor => {
    const orig = performance.now.bind(performance)
    const t0 = orig()
    performance.now = () => t0 + (orig() - t0) * factor
  }, slow)

  const probe = () => page.evaluate(() => {
    const stage = document.querySelector('.desktop-3d-stage')
    const rt = stage?.__pokerRuntime
    if (!rt) return { lost: true }
    const time = (performance.now() - rt.startTime) / 1000
    const hero = [...rt.seats.values()].find(s => s.isHero)
    const h = rt.firstPersonHands
    const round = v => typeof v === 'number' ? +v.toFixed(2) : v
    const d = h.input?.deal
    return {
      time,
      phase: stage.dataset.phase,
      winners: (stage.dataset.winnerIds || '').split(',').filter(Boolean),
      heroId: hero?.playerId ?? null,
      heroDealer: Boolean(hero?.dealerButton?.visible),
      dealer: rt.dealer ? { seatId: rt.dealer.seatId, kind: rt.dealer.kind, age: time - rt.dealer.schedule.startedAt, dur: rt.dealer.schedule.duration } : null,
      heroWinner: Boolean(hero?.winner),
      handsVisible: h.root.visible,
      deal: d ? { w: round(d.weight), rx: round(d.rightX), ry: round(d.rightY), lx: round(d.leftX), ly: round(d.leftY), pinch: round(d.pinch), snap: round(d.snap) } : null,
      handR: h.shown?.right ? [h.shown.right.x, h.shown.right.y, h.shown.right.z].map(round) : null,
      handL: h.shown?.left ? [h.shown.left.x, h.shown.left.y, h.shown.left.z].map(round) : null,
      showdownActive: Boolean(rt.showdown?.active),
      heroPoseWinner: hero?.winner,
    }
  })
  const snap = async (name, quality = 75) => {
    await page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: 'jpeg', quality })
  }
  const buttonState = () => page.evaluate(() => {
    const vis = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled).map(b => b.innerText.replace(/\s+/g, ' ').trim())
    return { call: vis.some(t => /^(Call|Check)/i.test(t)), fold: vis.some(t => /^Fold/i.test(t)), deal: vis.some(t => /^Deal next hand$/i.test(t)), start: vis.some(t => /^Start game$/i.test(t)), back: vis.some(t => /^I.?M BACK$/i.test(t)) }
  })
  const advance = async () => {
    const b = await buttonState()
    if (b.back) return clickVisible(page, /^I.?M BACK$/i)
    if (b.call) return clickVisible(page, /^(Check|Call)/i)
    if (b.start) return clickVisible(page, /^Start game$/i)
    if (b.deal) return clickVisible(page, /^Deal next hand$/i)
    return false
  }

  const deadline = Date.now() + maxMs
  if (mode === 'board') {
    // Dim check: play heads-up until a showdown with winning board cards, then look at the board.
    await clickVisible(page, /^Start game$/i)
    let done = false
    while (Date.now() < deadline && !done) {
      const s = await probe().catch(() => ({ lost: true }))
      if (!s.lost && s.phase === 'between_hands' && s.winners.length > 0) {
        await sleep(3500)
        const info = await page.evaluate(() => {
          const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
          rt.debugCamera = { position: [0, 2.6, 1.3], lookAt: [0, 0.85, -0.5], fov: 45 }
          return rt.board.slots.map(sl => ({ key: sl.key, hi: sl.highlighted, dim: +sl.dim.toFixed(2), vis: sl.card.group.visible }))
        })
        console.log('board slots', JSON.stringify(info))
        await sleep(600)
        await snap('board-dim')
        if (info.filter(i => i.vis).length === 5 && info.some(i => i.hi)) done = true
        await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = null })
      }
      await advance()
      await sleep(200)
    }
    console.log('result: dim shot', done)
  } else if (mode === 'hero') {
    let gotDeal = false
    let gotWin = process.env.SKIP_WIN === '1'
    const frames = Number(process.env.DEAL_FRAMES ?? 9)
    let lastHandKey = ''
    let hands = 0
    await clickVisible(page, /^Start game$/i)
    while (Date.now() < deadline && !(gotDeal && gotWin)) {
      const s = await probe().catch(() => ({ lost: true }))
      if (s.lost) { await sleep(500); continue }
      if (!gotDeal && s.dealer && s.dealer.seatId === s.heroId && s.dealer.kind === 'hole' && s.dealer.age < 0.6) {
        console.log('HERO DEAL started', JSON.stringify(s))
        gotDeal = true
        if (process.env.HIDE_UI === '1') await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
        for (let i = 0; i < frames; i += 1) {
          await snap(`${process.env.HIDE_UI === '1' ? 'bare-' : ''}hero-deal-${i}`)
          const t = await probe()
          console.log(`  deal frame ${i}: age=${t.dealer ? t.dealer.age.toFixed(2) : 'done'} hands=${t.handsVisible} deal=${JSON.stringify(t.deal)} R=${JSON.stringify(t.handR)} L=${JSON.stringify(t.handL)}`)
        }
        continue
      }
      if (gotDeal && !gotWin && s.phase === 'between_hands' && s.winners.includes(s.heroId)) {
        console.log('HERO WON', JSON.stringify(s))
        gotWin = true
        for (let i = 0; i < 10; i += 1) {
          await sleep(i < 3 ? 250 : 700)
          await snap(`hero-win-${i}`)
          const t = await probe()
          console.log(`  win frame ${i}: showdownActive=${t.showdownActive} winnerSecs hands=${t.handsVisible} R=${JSON.stringify(t.handR)} L=${JSON.stringify(t.handL)}`)
        }
        continue
      }
      if (s.phase === 'in_hand' && s.heroDealer && !gotDeal) lastHandKey = 'hero-is-dealer-but-no-hand-deal-seen'
      const advanced = await advance()
      if (advanced && s.phase === 'between_hands') hands += 1
      await sleep(advanced ? 150 : 120)
    }
    console.log(`result: deal=${gotDeal} win=${gotWin} hands~${hands} ${lastHandKey}`)
    if (!gotDeal) exitCode = 2
  } else {
    // talk: wait for a conversation between two non-folded bots, then film it.
    const findTalk = () => page.evaluate(() => {
      const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
      if (!rt) return null
      for (const s of rt.seats.values()) {
        const c = s.chatSlot
        if (!c || !s.animator?.chatOn || c.role !== 'speak' || s.folded || s.isHero) continue
        const partner = rt.seats.get(c.partnerId)
        if (!partner || partner.folded) continue
        const talk = Math.min(1, Math.max(0, (c.elapsed - 0.3) / 0.3)) * Math.min(1, Math.max(0, (c.talkEnd - c.elapsed) / 0.3))
        const p = s.root.position
        const q = partner.root.position
        return { speaker: s.playerId, partner: c.partnerId, elapsed: c.elapsed, talk, sp: [p.x, p.z], pp: [q.x, q.z], phase: document.querySelector('.desktop-3d-stage').dataset.phase }
      }
      return null
    })
    let shots = 0
    await clickVisible(page, /^Start game$/i)
    while (Date.now() < deadline && shots < 4) {
      const t = await findTalk().catch(() => null)
      if (t && t.talk > 0.8) {
        console.log('TALK', JSON.stringify(t))
        // Camera: from the table centre toward the speaker, offset a little toward the listener.
        const [x, z] = t.sp
        const r = Math.hypot(x, z) || 1
        const ux = x / r, uz = z / r
        const mx = (x + t.pp[0]) / 2, mz = (z + t.pp[1]) / 2
        const cams = [
          { position: [x - ux * 3.6, 2.2, z - uz * 3.6], lookAt: [x, 1.1, z], fov: 30 },
          { position: [mx - ux * 4.2, 2.4, mz - uz * 4.2], lookAt: [mx, 1.1, mz], fov: 38 },
          { position: [x - ux * 2.4 - uz * 2.2, 1.9, z - uz * 2.4 + ux * 2.2], lookAt: [x - ux * 0.3, 1.0, z - uz * 0.3], fov: 34 },
        ]
        const cam = cams[process.env.TALK_CAM ? Number(process.env.TALK_CAM) : shots % cams.length]
        await page.evaluate(c => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = c }, cam)
        await sleep(400)
        await snap(`talk-${shots}-${t.phase}`)
        shots += 1
        await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = null })
        await sleep(600)
        continue
      }
      await advance()
      await sleep(250)
    }
    console.log(`result: talk shots=${shots}`)
    if (shots === 0) exitCode = 2
  }
  await snap('final')
  console.log('errors:', errors.length ? errors.slice(0, 8) : 'none')
} catch (error) {
  console.log('FATAL', error?.message ?? error)
  exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
process.exit(exitCode)
