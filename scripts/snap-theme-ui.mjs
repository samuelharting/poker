// Drives the Table theme picker in the Settings modal: picks each theme through
// the UI, checks the live room follows, checks chill + theme, and checks the
// choice survives a reload (localStorage). Saves modal and room screenshots.
//
// Usage: node scripts/snap-theme-ui.mjs [outDir]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/themes'
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const fail = message => { console.log('FAIL:', message); process.exitCode = 1 }
const ok = message => console.log('ok:', message)

await mkdir(outDir, { recursive: true })
let browser
try {
browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width, height } })
page.on('pageerror', error => console.log('pageerror:', error.message))
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill(`UI${Math.floor(Math.random() * 9000 + 100)}`)
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
const roomUrl = page.url()
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
await sleep(3000)

const state = () => page.evaluate(() => {
  const runtime = document.querySelector('.desktop-3d-stage').__pokerRuntime
  return {
    applied: runtime.theme?.applied ?? 'lounge (untouched)',
    stored: localStorage.getItem('poker-night:table-theme'),
    decorVisible: runtime.theme?.build?.decor.visible ?? null,
    fxVisible: runtime.theme?.build?.fx.visible ?? null,
    chill: runtime.chill,
    poster: runtime.scene.getObjectByName('framed-poster')?.visible ?? null,
    pendant: runtime.scene.getObjectByName('pendant-lamp')?.visible ?? null,
    themeGroups: runtime.scene.children.filter(child => child.name === 'theme-props').length,
  }
})

await page.getByRole('button', { name: 'Settings' }).first().click()
await page.waitForSelector('[data-table-theme-option]')
await page.locator('.table-theme-row').scrollIntoViewIfNeeded()
await page.screenshot({ path: path.join(outDir, 'settings-theme-picker.png') })

for (const id of ['basement', 'highroller', 'rooftop', 'lounge']) {
  await page.locator(`[data-table-theme-option="${id}"]`).click()
  await sleep(3500)
  const now = await state()
  if (now.applied !== id && !(id === 'lounge' && now.applied.startsWith('lounge'))) fail(`${id}: runtime shows ${now.applied}`)
  else ok(`${id}: runtime applied, stored=${now.stored}, groups=${now.themeGroups}`)
  if (now.stored !== id) fail(`${id}: localStorage holds ${now.stored}`)
  const pressed = await page.locator(`[data-table-theme-option="${id}"]`).getAttribute('aria-checked')
  if (pressed !== 'true') fail(`${id}: radio not checked`)
}

// Chill with a theme: decor and glows hide, the shell stays.
await page.locator('[data-table-theme-option="basement"]').click()
await sleep(3000)
await page.getByRole('button', { name: 'Chill', exact: true }).click()
await sleep(1500)
const chill = await state()
console.log('chill+basement', JSON.stringify(chill))
if (chill.decorVisible !== false || chill.fxVisible !== false) fail('chill should hide theme decor and fx')
else ok('chill hides theme decor and fx')
await page.getByRole('button', { name: 'Lounge', exact: true }).click()
await sleep(1500)
const back = await state()
console.log('classic+basement', JSON.stringify(back))
if (back.decorVisible !== true || back.poster !== false) fail('leaving chill should show theme decor and keep lounge decor hidden')
else ok('classic again: theme decor shown, lounge poster stays hidden')

// Persistence: reload and expect the theme to come back on its own.
await page.goto(roomUrl, { waitUntil: 'load' })
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
await sleep(4000)
const reloaded = await state()
console.log('after reload', JSON.stringify(reloaded))
if (reloaded.applied !== 'basement') fail(`reload: expected basement, got ${reloaded.applied}`)
else ok('theme persisted across reload')

await page.evaluate(() => localStorage.setItem('poker-night:table-theme', 'not-a-theme'))
await page.goto(roomUrl, { waitUntil: 'load' })
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
await sleep(3000)
const bad = await state()
if (!bad.applied.startsWith('lounge')) fail(`bad stored value should give the lounge, got ${bad.applied}`)
else ok('bad stored value falls back to the lounge')
await page.evaluate(() => localStorage.removeItem('poker-night:table-theme'))
} catch (error) {
  fail(String(error).slice(0, 400))
} finally {
  await browser?.close()
}
