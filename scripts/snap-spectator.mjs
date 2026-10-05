// Spectator check: a host fills a table (8 seats), a second player joins the
// full table as a spectator on the desktop 3D view mid-hand. Reports console
// errors, the WebGL status, whether the canvas shows the scene (not black) and
// saves a screenshot.
// Usage: POKER_APP_URL=http://localhost:3000 node scripts/snap-spectator.mjs [out.png]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'output/spectator.png'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await host.goto(appUrl)
await host.getByLabel('Your nickname').fill('Host')
await host.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await host.waitForURL(/\/room\//)
await sleep(3000)
await host.getByRole('button', { name: 'Fill seats' }).first().click({ timeout: 15000 })
await sleep(2500)
await host.getByRole('button', { name: /^Start game$/ }).first().click({ timeout: 15000 })
await sleep(2000)

const watcherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const watcher = await watcherContext.newPage()
const errors = []
watcher.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
watcher.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text().slice(0, 200)}`) })
await watcher.goto(host.url())
await watcher.getByLabel('Your nickname').fill('Watcher')
await watcher.getByRole('button', { name: 'Enter Room' }).click()
await watcher.waitForSelector('.desktop-3d-stage', { timeout: 60000 })
await sleep(9000)
const state = await watcher.evaluate(() => {
  const stage = document.querySelector('.desktop-3d-stage')
  const canvas = stage?.querySelector('canvas')
  return {
    webgl: stage?.getAttribute('data-webgl-status'),
    sceneReady: stage?.getAttribute('data-scene-ready'),
    canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
    watching: Boolean(document.querySelector('.spectator-watch-bar, [class*="spectator-watch"]')),
  }
})
await watcher.screenshot({ path: out })
// Mean brightness of the screenshot's centre, from a canvas readback of the page image.
const brightness = await watcher.evaluate(async () => {
  const canvas = document.querySelector('.desktop-3d-stage canvas')
  if (!canvas) return null
  const copy = document.createElement('canvas')
  copy.width = 64
  copy.height = 40
  const context = copy.getContext('2d')
  await new Promise(resolve => requestAnimationFrame(() => { context.drawImage(canvas, 0, 0, 64, 40); resolve() }))
  const pixels = context.getImageData(0, 0, 64, 40).data
  let sum = 0
  for (let index = 0; index < pixels.length; index += 4) sum += pixels[index] + pixels[index + 1] + pixels[index + 2]
  return Math.round(sum / (pixels.length / 4) / 3)
})
console.log(JSON.stringify({ ...state, brightness, errors: errors.slice(0, 12) }, null, 1))
await browser.close()
