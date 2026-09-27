// Scene diagnostics (dev server only: needs the __pokerRuntime handle): object
// counts, how many objects recompute their matrices every frame, and which
// textures are re-uploaded every frame (with the uploading call stack).
// Usage: node scripts/probe-scene.mjs
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__uploads = new Map()
  const patch = proto => {
    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) {
      const original = proto[name]
      if (!original) continue
      proto[name] = function (...args) {
        if (window.__traceUploads) {
          const stack = new Error().stack.split('\n').slice(2, 9).map(line => line.trim().replace(/\(.*\/_next\//, '(').slice(0, 110)).join(' < ')
          window.__uploads.set(stack, (window.__uploads.get(stack) ?? 0) + 1)
        }
        return original.apply(this, args)
      }
    }
  }
  patch(WebGL2RenderingContext.prototype)
})
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 90000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 90000 }).catch(() => {})
await clickVisible(page, /^Start game$/)
await sleep(6000)
const report = await page.evaluate(async () => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  let objects = 0
  let autoUpdate = 0
  let meshes = 0
  let visibleMeshes = 0
  let staticAuto = 0
  const byTop = {}
  runtime.scene.traverse(object => {
    objects += 1
    if (object.matrixAutoUpdate) autoUpdate += 1
    if (object.isMesh) meshes += 1
    let top = object
    while (top.parent && top.parent !== runtime.scene) top = top.parent
    const key = top === object && object.parent === runtime.scene ? object.name || object.type : top.name || top.type
    byTop[key] = (byTop[key] ?? 0) + 1
  })
  runtime.scene.traverseVisible(object => { if (object.isMesh) visibleMeshes += 1 })
  window.__traceUploads = true
  const frames = 60
  await new Promise(resolve => {
    let count = 0
    const tick = () => { count += 1; if (count >= frames) resolve(); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  window.__traceUploads = false
  const uploads = [...window.__uploads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([stack, count]) => `${(count / frames).toFixed(2)}/frame  ${stack}`)
  return {
    objects, autoUpdate, meshes, visibleMeshes, staticAuto,
    topGroups: Object.entries(byTop).sort((a, b) => b[1] - a[1]).slice(0, 15),
    textures: runtime.renderer.info.memory.textures,
    geometries: runtime.renderer.info.memory.geometries,
    programs: runtime.renderer.info.programs?.length,
    uploads,
  }
})
console.log(JSON.stringify(report, null, 1))
await browser.close()
