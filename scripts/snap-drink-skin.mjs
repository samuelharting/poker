// First-person drink / shot glass x hero skin tone: orders the real Beer / Water / Shot, freezes the sip clock at a few
// fixed instants and re-colours the hero's hands, the grip hand on the glass and the sleeve for every tone in turn
// (the room reads these from the hero profile; this overrides them live), so the same frame is compared across tones.
// Usage: node scripts/snap-drink-skin.mjs <outDir> [tag] [beer] [water] [shot]
// Env: SNAP_WIDTH, SNAP_HEIGHT, TONES=pale:#f1d2b8,tan:#d7b088,brown:#8f604b,dark:#43291f, SLEEVE=#172131, TIMES_*=csv
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { launch, usePrivateRoom, makeRoomId, enterRoom, fillSeats, waitForModels, clickVisible, sleep } from './qa-lib.mjs'

const outDir = process.argv[2] ?? 'output/v5/hands'
const tag = process.argv[3] ?? 'run'
const kinds = process.argv.slice(4).length ? process.argv.slice(4) : ['beer', 'water', 'shot']
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const tones = (process.env.TONES ?? 'pale:#f1d2b8,tan:#d7b088,brown:#8f604b,dark:#43291f').split(',').map(entry => {
  const [name, hex] = entry.split(':')
  return { name, hex }
})
const sleeve = process.env.SLEEVE
const TIMES = {
  beer: (process.env.TIMES_BEER ?? '0.5,0.75,1.1,1.5').split(',').map(Number),
  water: (process.env.TIMES_WATER ?? '0.5,0.75,1.1,1.5').split(',').map(Number),
  shot: (process.env.TIMES_SHOT ?? '1.3,1.5,1.72,1.98').split(',').map(Number),
}

await mkdir(outDir, { recursive: true })
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width, height } })
  await usePrivateRoom(page, makeRoomId('dk'))
  page.on('pageerror', error => console.log('pageerror:', error.message))
  await enterRoom(page, 'Hero')
  await sleep(1200)
  await fillSeats(page, 5)
  await waitForModels(page, 6)
  await clickVisible(page, /^Start game$/)
  await sleep(4500)

  const apply = (hex, sleeveHex) => page.evaluate(({ hex, sleeveHex }) => {
    const r = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const lifted = color => color.set(hex).offsetHSL(0, 0.04, 0.02)
    const hands = r.firstPersonHands
    lifted(hands.colors.skin)
    if (sleeveHex) hands.colors.sleeve.set(sleeveHex)
    for (const fp of [r.firstPersonDrink, r.pranks.firstPerson]) {
      if (!fp.grip) continue
      lifted(fp.grip.colors.skin)
      if (sleeveHex) fp.grip.colors.sleeve.set(sleeveHex)
    }
  }, { hex, sleeveHex })

  for (const kind of kinds) {
    const label = kind === 'shot' ? /take a shot/i : kind === 'water' ? /water/i : /beer/i
    const ordered = await clickVisible(page, label, 3000)
    console.log(kind, 'ordered', ordered)
    // A shot is poured and slid across first: wait for the hero's own to start.
    for (let wait = 0; wait < 40 && kind === 'shot'; wait += 1) {
      if (await page.evaluate(() => Boolean(document.querySelector('.desktop-3d-stage').__pokerRuntime.pranks.heroShot))) break
      await sleep(250)
    }
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
      return { ok: true }
    }, kind)
    if (state.ok) {
      const rows = []
      for (const tone of tones) {
        const tiles = []
        for (const time of TIMES[kind]) {
          await page.evaluate(t => { window.__frz.value = t }, time)
          await apply(tone.hex, sleeve)
          await sleep(300)
          await apply(tone.hex, sleeve)
          await sleep(120)
          if (tone === tones[0]) {
            // How far the glass's lowest point (and the hand's) sits above the HUD bar with the drink buttons, in px.
            const gap = await page.evaluate(kind => {
              const r = document.querySelector('.desktop-3d-stage').__pokerRuntime
              const fp = kind === 'shot' ? r.pranks.firstPerson : r.firstPersonDrink
              const v = r.camera.position.clone()
              let lowest = -Infinity
              fp.root.updateMatrixWorld(true)
              r.camera.updateMatrixWorld(true)
              const gripRoot = fp.grip ? fp.grip.group : null
              fp.root.traverse(o => {
                if (!o.isMesh || !o.geometry || o.name.includes('ink') || o.isSprite) return
                for (let p = o; p; p = p.parent) if (p === gripRoot) return
                if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
                const b = o.geometry.boundingBox
                for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
                  v.set(x, y, z); o.localToWorld(v); v.project(r.camera)
                  lowest = Math.max(lowest, (1 - v.y) / 2 * innerHeight)
                }
              })
              const barEl = document.querySelector('.drink-buttons')
              const rect = barEl ? barEl.getBoundingClientRect() : null
              const bar = barEl
              return { lowest: Math.round(lowest), barTop: rect ? Math.round(rect.top) : null, barClass: bar ? bar.className : null, vis: fp.root.visible }
            }, kind)
            console.log('  ', kind, 't', time, 'lowest drawn px', gap.lowest, 'hud bar top', gap.barTop, 'gap', gap.barTop === null ? null : gap.barTop - gap.lowest, gap.barClass)
          }
          const buf = await page.screenshot({ clip: { x: 0, y: Math.round(height * 0.34), width: Math.round(width * 0.62), height: Math.round(height * 0.66) } })
          tiles.push(buf)
        }
        rows.push({ tone, tiles })
      }
      const tileW = 440
      const composed = []
      let rowTop = 0
      let rowH = 0
      for (const row of rows) {
        let left = 0
        for (const buf of row.tiles) {
          const resized = await sharp(buf).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true })
          rowH = resized.info.height
          composed.push({ input: resized.data, left, top: rowTop })
          left += tileW
        }
        const svg = Buffer.from(`<svg width="260" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="20" fill="black" fill-opacity="0.7"/><text x="5" y="14" font-family="Arial" font-size="13" fill="#ffd24a">${kind} ${row.tone.name} ${row.tone.hex}</text></svg>`)
        composed.push({ input: svg, left: 0, top: rowTop })
        rowTop += rowH
      }
      await sharp({ create: { width: tileW * TIMES[kind].length, height: rowTop, channels: 3, background: '#000' } })
        .composite(composed).png().toFile(path.join(outDir, `skin-${kind}-${tag}.png`))
      console.log('wrote', `skin-${kind}-${tag}.png`)
    }
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
