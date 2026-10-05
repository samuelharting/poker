// First-person drink sequence: sits the hero, starts a hand, presses the real Beer / Water / Shot
// buttons and scrubs the sip cycle at fixed elapsed times (so frames are comparable before/after).
// Usage: node scripts/snap-drink-seq.mjs <outDir> [beer] [water] [shot]
// Env: SNAP_WIDTH, SNAP_HEIGHT, FULL=1 (full frames instead of the lower-left crop)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launch, usePrivateRoom, makeRoomId, enterRoom, fillSeats, waitForModels, clickVisible, sleep } from './qa-lib.mjs'

const outDir = process.argv[2] ?? 'output/v4/drink/run'
const kinds = process.argv.slice(3).length ? process.argv.slice(3) : ['beer', 'water', 'shot']
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const SIP_TIMES = [0.1, 0.22, 0.36, 0.5, 0.62, 0.75, 0.9, 1.1, 1.3, 1.5, 1.65, 1.8]
const SHOT_TIMES = [1.15, 1.25, 1.38, 1.5, 1.6, 1.72, 1.85, 1.98, 2.1, 2.25]

await mkdir(outDir, { recursive: true })
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width, height } })
  await usePrivateRoom(page, makeRoomId('dk'))
  page.on('pageerror', error => console.log('pageerror:', error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) console.log('console:', message.text().slice(0, 240)) })
  await enterRoom(page, 'Hero')
  await sleep(1200)
  await fillSeats(page, 5)
  await waitForModels(page, 6)
  await clickVisible(page, /^Start game$/)
  await sleep(4500)

  for (const kind of kinds) {
    const label = kind === 'shot' ? /take a shot/i : kind === 'water' ? /water/i : /beer/i
    const ordered = await clickVisible(page, label, 3000)
    console.log(kind, 'ordered', ordered)
    await sleep(350)
    const state = await page.evaluate(kind => {
      const r = document.querySelector('.desktop-3d-stage').__pokerRuntime
      const seat = [...r.seats.values()].find(s => s.isHero)
      const hold = { value: 0 }
      window.__frz = hold
      if (kind === 'shot') {
        const shot = r.pranks.heroShot
        if (!shot) return { ok: false, why: 'no heroShot' }
        Object.defineProperty(shot, 'startedAt', { configurable: true, get: () => (performance.now() - r.startTime) / 1000 - hold.value, set() {} })
        return { ok: true }
      }
      Object.defineProperty(seat, 'drinkStartedAt', { configurable: true, get: () => (performance.now() - r.startTime) / 1000 - hold.value, set() {} })
      return { ok: true, prop: seat.drinkProp?.kind, fp: r.firstPersonDrink.root.visible }
    }, kind)
    console.log(kind, JSON.stringify(state))
    if (state.ok) {
      const times = kind === 'shot' ? SHOT_TIMES : SIP_TIMES
      for (let index = 0; index < times.length; index += 1) {
        await page.evaluate(t => { window.__frz.value = t }, times[index])
        await sleep(330)
        if (process.env.DEBUG_FP) console.log(kind, times[index], JSON.stringify(await page.evaluate(k => { const r = document.querySelector('.desktop-3d-stage').__pokerRuntime; const fp = k === 'shot' ? r.pranks.firstPerson : r.firstPersonDrink; const v = fp.root.position.clone(); r.camera.updateMatrixWorld(); const w = fp.root.getWorldPosition(v.clone()).project(r.camera); return { vis: fp.root.visible, pos: fp.root.position.toArray().map(n => +n.toFixed(3)), ndc: [+w.x.toFixed(2), +w.y.toFixed(2)], rot: fp.root.rotation.x.toFixed(2), kids: fp.root.children.length } }, kind)))
        const file = path.join(outDir, `${kind}-${String(index).padStart(2, '0')}-${times[index].toFixed(2)}.png`)
        if (process.env.FULL === '1') await page.screenshot({ path: file })
        else await page.screenshot({ path: file, clip: { x: 0, y: Math.round(height * 0.28), width: Math.round(width * 0.78), height: Math.round(height * 0.72) } })
      }
    }
    // Let go of the clock (the drink ends on its own) and wait out the order cooldown.
    await page.evaluate(kind => {
      const r = document.querySelector('.desktop-3d-stage').__pokerRuntime
      const seat = [...r.seats.values()].find(s => s.isHero)
      if (kind === 'shot') {
        if (r.pranks.heroShot) Object.defineProperty(r.pranks.heroShot, 'startedAt', { value: -1e6, writable: true, configurable: true })
      } else {
        Object.defineProperty(seat, 'drinkStartedAt', { value: -1e6, writable: true, configurable: true })
      }
    }, kind)
    await sleep(7000)
  }
  console.log('done')
} finally {
  await browser.close()
}
