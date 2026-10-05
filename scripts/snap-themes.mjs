// Table theme review: seats a table, deals a hand, then for each theme saves a
// gameplay-camera shot, a wide shot and (optionally) close-ups, and reports
// draw calls per frame and shader compile hitch for the switch.
//
// Usage: node scripts/snap-themes.mjs [outDir] [--closeups]
// Env: THEMES=lounge,highroller,basement,rooftop (default all), SNAP_WIDTH, SNAP_HEIGHT,
//      WIDE=<json {position,lookAt,fov}>, VIA_UI=1 to switch through the Settings modal.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'output/v2/themes'
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
const themes = (process.env.THEMES ?? 'lounge,highroller,basement,rooftop').split(',')
const closeups = process.argv.includes('--closeups')
const wide = process.env.WIDE ? JSON.parse(process.env.WIDE) : { position: [0, 6.2, 9.5], lookAt: [0, 1.2, -3], fov: 58 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500 }).then(() => true, () => false)) return true
    }
  }
  return false
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width, height } })
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => {
  if (['error', 'warning', 'info'].includes(message.type()) && (message.type() !== 'warning' || !/WebGL|Program Info/.test(message.text()))) console.log(`console ${message.type()}:`, message.text().slice(0, 300))
})
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill(process.env.NICK ?? `Theme${Math.floor(Math.random() * 9000 + 100)}`)
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
await clickVisible(page, /^Start game$/)
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(5000)

for (const theme of themes) {
  const switchMs = await page.evaluate(async id => {
    const start = performance.now()
    window.__pokerSetTableTheme(id)
    // Two frames: the effect runs after commit.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return Math.round(performance.now() - start)
  }, theme)
  await sleep(2500)
  const stats = await page.evaluate(async () => {
    const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const renderer = runtime.renderer
    renderer.info.autoReset = false
    renderer.info.reset()
    let frames = 0
    await new Promise(resolve => {
      const tick = () => { frames += 1; if (frames >= 90) resolve(); else requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    })
    const calls = renderer.info.render.calls / frames
    const triangles = renderer.info.render.triangles / frames
    renderer.info.autoReset = true
    return {
      theme: runtime.theme?.applied ?? 'lounge (untouched)',
      callsPerFrame: Math.round(calls),
      trianglesPerFrame: Math.round(triangles),
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length,
    }
  })
  console.log(theme, 'switchMs', switchMs, JSON.stringify(stats))
  await page.screenshot({ path: path.join(outDir, `${theme}-gameplay.png`) })
  // Fixed seated-hero camera, so themes compare like for like (the native camera follows the action).
  await page.evaluate(camera => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = camera }, { position: [0, 1.95, 6.05], lookAt: [0, 0.5, -1.4], fov: 60 })
  await sleep(900)
  await page.screenshot({ path: path.join(outDir, `${theme}-hero.png`) })
  await page.evaluate(camera => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = camera }, wide)
  await sleep(900)
  await page.screenshot({ path: path.join(outDir, `${theme}-wide.png`) })
  if (closeups) {
    const shots = [
      { name: 'closeup-board', position: [0, 2.6, 2.2], lookAt: [0, 0.5, -0.6], fov: 38 },
      { name: 'closeup-far', position: [0, 2.6, 0.6], lookAt: [0, 1.5, -4.1], fov: 40 },
      { name: 'closeup-right-far', position: [1.4, 2.5, 0.2], lookAt: [4.3, 1.3, -2.8], fov: 42 },
    ]
    for (const shot of shots) {
      await page.evaluate(camera => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = camera }, shot)
      await sleep(700)
      await page.screenshot({ path: path.join(outDir, `${theme}-${shot.name}.png`) })
    }
  }
  await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = null })
  await sleep(600)
}
await browser.close()
