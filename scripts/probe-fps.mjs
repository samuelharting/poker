// Steady-state render probe for the desktop 3D room: seats a full table,
// deals, waits for the rigs, then samples per-frame cost. Besides fps (which
// depends on whatever else the machine is doing) it reports load-independent
// numbers: draw calls per frame (all passes), shadow casters, skinned meshes,
// GPU time per frame (EXT_disjoint_timer_query_webgl2) and JS time per frame.
// Usage: SNAP_WIDTH=1920 SNAP_HEIGHT=1080 node scripts/probe-fps.mjs [seconds]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 6)
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
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
await page.addInitScript(() => {
  // Time every rAF callback (the 3D loop dominates) without touching app code.
  const raf = window.requestAnimationFrame.bind(window)
  window.__jsFrameMs = []
  window.requestAnimationFrame = callback => raf(now => {
    const start = performance.now()
    try { callback(now) } finally { window.__jsFrameMs.push(performance.now() - start) }
  })
})
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
// Seat restoration can briefly disable Fill seats; retry until the bots sit.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await clickVisible(page, /^Start game$/)
await sleep(7000)

const stats = await page.evaluate(async sampleSeconds => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  if (!runtime) return { error: 'no runtime' }
  const renderer = runtime.renderer
  const gl = renderer.getContext()
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  renderer.info.autoReset = false
  const frames = []
  const calls = []
  const gpu = []
  const pending = []
  window.__jsFrameMs.length = 0
  let query = null
  let last = performance.now()
  const start = last
  await new Promise(resolve => {
    const tick = now => {
      // Close the previous frame's measurements.
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); query = null }
      calls.push(renderer.info.render.calls)
      renderer.info.reset()
      frames.push(now - last)
      last = now
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (gl.getQueryParameter(pending[i], gl.QUERY_RESULT_AVAILABLE)) {
          gpu.push(gl.getQueryParameter(pending[i], gl.QUERY_RESULT) / 1e6)
          gl.deleteQuery(pending[i])
          pending.splice(i, 1)
        }
      }
      if (now - start >= sampleSeconds * 1000) { resolve(); return }
      if (ext) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query) }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  renderer.info.autoReset = true
  frames.shift()
  calls.shift()
  const sorted = [...frames].sort((a, b) => a - b)
  const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0 }
  const avg = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)
  let skinned = 0
  let casters = 0
  let outlines = 0
  runtime.scene.traverseVisible(object => {
    if (!object.isMesh || object.layers.mask === 8) return
    if (object.isSkinnedMesh) skinned += 1
    if (/-outline$/.test(object.name)) outlines += 1
    if (object.castShadow) casters += Array.isArray(object.material) ? object.material.length : 1
  })
  return {
    fps: +(frames.length / sampleSeconds).toFixed(1),
    frameP50: +sorted[sorted.length >> 1].toFixed(1),
    frameP95: +pct(frames, 0.95).toFixed(1),
    drawCallsAvg: Math.round(avg(calls)),
    drawCallsMax: Math.max(...calls),
    gpuMsAvg: +avg(gpu).toFixed(2),
    gpuMsP95: +pct(gpu, 0.95).toFixed(2),
    jsMsAvg: +avg(window.__jsFrameMs).toFixed(2),
    jsMsP95: +pct(window.__jsFrameMs, 0.95).toFixed(2),
    skinned,
    outlines,
    shadowCasterDraws: casters,
    postFx: document.querySelector('.desktop-3d-stage')?.dataset.postFx ?? 'on',
    pixelRatio: renderer.getPixelRatio(),
  }
}, seconds)
console.log(`${width}x${height}`, JSON.stringify(stats))
await browser.close()
