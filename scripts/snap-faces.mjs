// Close-ups of every seated avatar's face and hands (development builds only).
//
// Usage: node scripts/snap-faces.mjs <outDir> [waitSeconds]
// Env: SNAP_WIDTH/SNAP_HEIGHT, POKER_APP_URL, FACE_DIST (camera distance, default 1.05)
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/faces'
const waitSeconds = Number(process.argv[3] ?? 5)
const width = Number(process.env.SNAP_WIDTH ?? 1000)
const height = Number(process.env.SNAP_HEIGHT ?? 700)
const faceDist = Number(process.env.FACE_DIST ?? 1.7)

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
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Hero')
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
await page.waitForFunction(
  () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
  null,
  { timeout: 60000 }
).catch(() => {})
await sleep(waitSeconds * 1000)

// Hide the DOM overlay so the shots are clean 3D.
await page.addStyleTag({ content: '.table-stage, .social-dock, .table-side-panels, .room-hud, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })

await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
const targets = await page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const out = []
  for (const seat of runtime.seats.values()) {
    if (!seat.root.visible || !seat.avatar) continue
    const bones = seat.avatar.bones
    const world = name => {
      const bone = bones.get(name)
      if (!bone) return null
      const v = bone.getWorldPosition(new bone.position.constructor())
      return [v.x, v.y, v.z]
    }
    out.push({
      id: seat.playerId,
      head: world('Head'),
      handR: world('WristR'),
      handL: world('WristL'),
      neck: world('Neck'),
    })
  }
  return out
})
console.log('avatars', targets.length)

if (process.env.TWEAK) {
  await page.evaluate(tweak => { globalThis.__avatarTweak = tweak }, JSON.parse(process.env.TWEAK))
  await sleep(600)
}
const only = process.env.ONLY === undefined ? null : Number(process.env.ONLY)
const kinds = (process.env.KINDS ?? 'face,hands').split(',')
let index = 0
async function runShots(suffix) {
  index = 0
  for (const target of targets) {
    if (only !== null && targets.indexOf(target) !== only) continue
    if (!target.head) continue
    // Camera sits in front of the face, toward the table centre (origin).
    const [hx, hy, hz] = target.head
    const toCenter = [-hx, 0, -hz]
    const length = Math.hypot(toCenter[0], toCenter[2]) || 1
    const dir = [toCenter[0] / length, 0, toCenter[2] / length]
    const shots = [
      { name: 'face', position: [hx + dir[0] * faceDist, hy + 0.3, hz + dir[2] * faceDist], lookAt: [hx, hy + 0.26, hz], fov: 30 },
      { name: 'hands', position: [hx + dir[0] * 1.9, hy - 0.2, hz + dir[2] * 1.9 + 0.2], lookAt: [(target.handR?.[0] ?? hx), (target.handR?.[1] ?? hy) , (target.handR?.[2] ?? hz)], fov: 36 },
      { name: 'wrist', position: [(target.handR?.[0] ?? hx) + dir[0] * 0.55, (target.handR?.[1] ?? hy) + 0.42, (target.handR?.[2] ?? hz) + dir[2] * 0.55], lookAt: [(target.handR?.[0] ?? hx), (target.handR?.[1] ?? hy) + 0.02, (target.handR?.[2] ?? hz)], fov: 30 },
      { name: 'hand', position: [(target.handR?.[0] ?? hx) + dir[0] * 1.0, (target.handR?.[1] ?? hy) + 0.62, (target.handR?.[2] ?? hz) + dir[2] * 1.0], lookAt: [(target.handR?.[0] ?? hx), (target.handR?.[1] ?? hy) - 0.04, (target.handR?.[2] ?? hz)], fov: 34 },
    ]
    for (const shot of shots) {
      if (!kinds.includes(shot.name)) continue
      await page.evaluate(camera => {
        document.querySelector('.desktop-3d-stage').__pokerRuntime.debugCamera = camera
      }, shot)
      await sleep(500)
      await page.screenshot({ path: path.join(outDir, `${String(index).padStart(2, '0')}-${shot.name}${suffix}.png`) })
    }
    index += 1
  }

}
if (process.env.AB && process.env.PRE_JS) {
  await runShots('-a')
  await page.evaluate(process.env.PRE_JS)
  await sleep(700)
  await runShots('-b')
} else {
  if (process.env.PRE_JS) { await page.evaluate(process.env.PRE_JS); await sleep(600) }
  await runShots('')
}
console.log('saved', index, 'avatars')
await browser.close()
