// Table theme cost probe: alternates the lounge and each theme in one live room
// and reports, per theme, the visible drawable count delta vs the lounge
// (deterministic), average draw calls per frame (all passes, noisy: it moves
// with the hand being played), and median rAF JS time / frame time.
//
// Usage: SNAP_WIDTH=1440 SNAP_HEIGHT=900 node scripts/probe-theme-cost.mjs [rounds]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const rounds = Number(process.argv[2] ?? 3)
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
const themes = (process.env.THEMES ?? 'highroller,basement,rooftop').split(',')
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

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width, height } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill(`Cost${Math.floor(Math.random() * 9000 + 100)}`)
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await clickVisible(page, /^Start game$/)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(6000)
await page.evaluate(() => {
  document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = { position: [0, 1.95, 6.05], lookAt: [0, 0.5, -1.4], fov: 60 }
})

async function sample(id) {
  await page.evaluate(theme => window.__pokerSetTableTheme(theme), id)
  await sleep(3500)
  return page.evaluate(async () => {
    const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const renderer = runtime.renderer
    let drawables = 0
    runtime.scene.traverseVisible(object => {
      if (!(object.isMesh || object.isPoints || object.isSprite || object.isLine)) return
      if (object.layers.mask === 8) return
      drawables += Array.isArray(object.material) ? object.material.length : 1
    })
    renderer.info.autoReset = false
    renderer.info.reset()
    const frames = []
    let last = performance.now()
    let count = 0
    await new Promise(resolve => {
      const tick = now => {
        frames.push(now - last)
        last = now
        count += 1
        if (count >= 150) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const calls = renderer.info.render.calls / count
    renderer.info.autoReset = true
    frames.sort((a, b) => a - b)
    return { drawables, calls: Math.round(calls), medianFrameMs: Number(frames[frames.length >> 1].toFixed(1)) }
  })
}

const results = { lounge: [] }
for (const theme of themes) results[theme] = []
for (let round = 0; round < rounds; round += 1) {
  for (const theme of ['lounge', ...themes]) {
    const stats = await sample(theme)
    results[theme].push(stats)
    console.log(`round ${round + 1} ${theme.padEnd(10)}`, JSON.stringify(stats))
  }
}
const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1]
const summarize = list => ({
  drawables: median(list.map(item => item.drawables)),
  calls: median(list.map(item => item.calls)),
  frameMs: median(list.map(item => item.medianFrameMs)),
})
const base = summarize(results.lounge)
console.log('lounge', JSON.stringify(base))
for (const theme of themes) {
  const summary = summarize(results[theme])
  console.log(theme.padEnd(10), JSON.stringify(summary), 'drawables vs lounge', summary.drawables - base.drawables, 'calls vs lounge', summary.calls - base.calls)
}
await browser.close()
