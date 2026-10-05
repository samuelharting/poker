// Which shader programs get compiled mid-game (dev server: needs __pokerRuntime)?
// Plays a few hands and logs every program that appears after the table is up,
// with the frame time it cost and the materials that use it.
// Usage: node scripts/probe-programs.mjs [seconds]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 60)
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
page.on('console', message => { if (message.text().startsWith('[program]')) console.log(message.text()) })
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 90000 })
await page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  const known = new Set(runtime.renderer.info.programs.map(program => program.id))
  let last = performance.now()
  const started = performance.now()
  const tick = now => {
    const gap = now - last
    last = now
    for (const program of runtime.renderer.info.programs) {
      if (known.has(program.id)) continue
      known.add(program.id)
      const users = []
      runtime.scene.traverse(object => {
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
        for (const material of materials) {
          const key = runtime.renderer.properties.get(material)?.currentProgram
          if (key === program) users.push(`${object.name || object.type}:${material.type}${material.name ? `(${material.name})` : ''}`)
        }
      })
      console.log(`[program] t=${((now - started) / 1000).toFixed(1)}s frame=${gap.toFixed(0)}ms ${program.name} used by ${[...new Set(users)].slice(0, 4).join(', ') || '(post/shadow)'}`)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await clickVisible(page, /^Start game$/)
const end = Date.now() + seconds * 1000
while (Date.now() < end) {
  await page.evaluate(() => document.querySelector('button[data-action="check"]:not(:disabled), button[data-action="call"]:not(:disabled)')?.click())
  await sleep(700)
}
await browser.close()
