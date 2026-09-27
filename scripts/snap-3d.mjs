// Fast desktop 3D iteration: creates a table with bots, deals a hand, and saves
// an overview plus optional debug-camera close-ups (development builds only).
//
// Usage: node scripts/snap-3d.mjs <outDir> [waitSeconds] [--closeups]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap'
const waitSeconds = Number(process.argv[3] ?? 6)
const closeups = process.argv.includes('--closeups')
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)

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
  if (message.type() === 'error') console.log('console:', message.text().slice(0, 300))
})
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
// Seat restoration can briefly disable Fill seats; retry until the bots sit.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await sleep(1500)
if (process.argv.includes('--deal')) {
  await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
  await sleep(1500)
}
await clickVisible(page, /^Start game$/)
if (process.argv.includes('--deal')) {
  // Burst of frames to review the deal animation.
  for (let frame = 0; frame < 6; frame += 1) {
    await page.screenshot({ path: path.join(outDir, `deal-${frame}.png`) })
  }
}
await page.waitForFunction(
  () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
  null,
  { timeout: 60000 }
).catch(() => {})
await sleep(waitSeconds * 1000)
if (process.argv.includes('--advance')) {
  // Play check/call until the board shows at least the flop.
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    const board = Number(await page.locator('.community-cards').first().getAttribute('data-visible-count').catch(() => 0))
    if (board >= 3) break
    await clickVisible(page, /^(Check|Call)/)
    await sleep(600)
  }
  await sleep(1800)
}
await page.screenshot({ path: path.join(outDir, 'overview.png') })
console.log('saved overview')
console.log('overlay vars', await page.evaluate(() => ({
  potX: document.querySelector('.table-scene')?.style.getPropertyValue('--pot-x'),
  seatX: document.querySelector('.cinematic-seat')?.style.getPropertyValue('--seat-x'),
  postFx: document.querySelector('.desktop-3d-stage')?.dataset.postFx ?? 'on',
  drawCalls: document.querySelector('.desktop-3d-stage')?.__pokerRuntime?.renderer.info.render.calls,
  triangles: document.querySelector('.desktop-3d-stage')?.__pokerRuntime?.renderer.info.render.triangles,
})))
if (process.env.MESH_BREAKDOWN) console.log('meshBreakdown', await page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  const counts = {}
  runtime.scene.traverseVisible(object => {
    if (!object.isMesh && !object.isPoints) return
    if (object.layers.mask === 8) return
    let label = object.name || object.type
    let node = object.parent
    while (node && !/^(player-|stylized|board|emerald|art-deco|pendant|framed|chip-instances|neon|light-cone|confetti)/.test(node.name || '')) node = node.parent
    const key = node ? node.name.replace(/-[a-z0-9_]{6,}$/i, '') : 'root'
    counts[key] = (counts[key] ?? 0) + (Array.isArray(object.material) ? object.material.length : 1)
  })
  return counts
}))
if (process.env.MESH_BREAKDOWN) console.log('seatBreakdown', await page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  const seat = [...runtime.seats.values()].find(s => s.root.visible && s.avatar)
  const counts = {}
  seat.root.traverseVisible(object => {
    if (!object.isMesh) return
    if (object.layers.mask === 8) return
    const key = (object.name || object.type).replace(/[-_]?[0-9]+$/, '')
    counts[key] = (counts[key] ?? 0) + (Array.isArray(object.material) ? object.material.length : 1)
  })
  return counts
}))
console.log('fps', await page.evaluate(() => new Promise(resolve => {
  let frames = 0
  const start = performance.now()
  const tick = () => { frames += 1; if (performance.now() - start > 3000) resolve(Math.round(frames / 3)); else requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})))

if (process.argv.includes('--sequence')) {
  // Frame sequence to review motion over time (SEQ_CAMERA overrides the view).
  const camera = process.env.SEQ_CAMERA
    ? JSON.parse(process.env.SEQ_CAMERA)
    : { position: [0, 3.6, 3.2], lookAt: [0, 1.0, -3.2], fov: 50 }
  await page.evaluate(cameraSetting => {
    const host = document.querySelector('.desktop-3d-stage')
    if (host?.__pokerRuntime) host.__pokerRuntime.debugCamera = cameraSetting
  }, camera)
  for (let frame = 0; frame < 16; frame += 1) {
    await clickVisible(page, /^(Check|Call)/)
    await clickVisible(page, /^Deal next hand$/)
    await sleep(900)
    await page.screenshot({ path: path.join(outDir, `seq-${String(frame).padStart(2, '0')}.png`) })
  }
  console.log('saved sequence')
}

if (closeups) {
  const shots = [
    { name: 'closeup-far', position: [0, 2.6, 0.6], lookAt: [0, 1.5, -4.1], fov: 40 },
    { name: 'closeup-left', position: [-1.4, 2.4, 1.8], lookAt: [-4.6, 1.3, 1.8], fov: 42 },
    { name: 'closeup-right-far', position: [1.4, 2.5, 0.2], lookAt: [4.3, 1.3, -2.8], fov: 42 },
  ]
  for (const shot of shots) {
    await page.evaluate(camera => {
      const host = document.querySelector('.desktop-3d-stage')
      if (host?.__pokerRuntime) host.__pokerRuntime.debugCamera = camera
    }, shot)
    await sleep(700)
    await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) })
    console.log(`saved ${shot.name}`)
  }
}
await browser.close()
