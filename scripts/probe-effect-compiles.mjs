// Fires every one-off 3D effect (drinks, pranks, fun FX) at a seated table on
// the dev server and logs each shader link it causes and the frame it cost.
// Anything listed here compiled mid-game the first time it happened (a hitch).
// Usage: node scripts/probe-effect-compiles.mjs
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
page.on('console', message => { if (message.text().startsWith('[link]')) console.log(message.text()) })
page.on('pageerror', error => console.log('pageerror', error.message))
await page.addInitScript(() => {
  const proto = WebGL2RenderingContext.prototype
  const sources = new WeakMap()
  const shaders = new WeakMap()
  const originalSource = proto.shaderSource
  proto.shaderSource = function (shader, source) { sources.set(shader, source); return originalSource.call(this, shader, source) }
  const originalAttach = proto.attachShader
  proto.attachShader = function (program, shader) { const list = shaders.get(program) ?? []; list.push(shader); shaders.set(program, list); return originalAttach.call(this, program, shader) }
  const originalLink = proto.linkProgram
  proto.linkProgram = function (program) {
    const result = originalLink.call(this, program)
    if (window.__label) {
      const source = (shaders.get(program) ?? []).map(shader => sources.get(shader) ?? '').join('\n')
      const name = source.match(/#define SHADER_NAME (\S+)/)?.[1] ?? '?'
      const flags = ['USE_SKINNING', 'USE_SHADOWMAP', 'USE_MAP', 'USE_INSTANCING', 'DEPTH_PACKING', 'USE_FOG', 'USE_TRANSMISSION', 'TONE_MAPPING']
        .filter(flag => source.includes(`#define ${flag}`)).join(',')
      console.log(`[link] ${window.__label}: ${name} ${flags}`)
    }
    return result
  }
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
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 7, null, { timeout: 90000 }).catch(() => {})
await sleep(4000)
const ids = await page.evaluate(() => [...document.querySelector('.desktop-3d-stage').__pokerRuntime.seats.keys()])
const heroId = await page.evaluate(() => [...document.querySelector('.desktop-3d-stage').__pokerRuntime.seats.values()].find(seat => seat.isHero)?.playerId)
const botId = ids.find(id => id !== heroId)
const step = async (label, action) => {
  await page.evaluate(value => { window.__label = value }, label)
  const worst = await page.evaluate(async source => {
    let worst = 0
    let last = performance.now()
    let running = true
    const tick = now => { worst = Math.max(worst, now - last); last = now; if (running) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    // eslint-disable-next-line no-new-func
    await new Function('return (async () => {' + source + '})()')()
    await new Promise(resolve => setTimeout(resolve, 2500))
    running = false
    return Math.round(worst)
  }, action)
  console.log(`${label}: worst frame ${worst}ms`)
}
const host = "document.querySelector('.desktop-3d-stage')"
const prank = (kind, from, to) => `${host}.__playPrank({ id: 'p' + Math.random(), kind: '${kind}', fromId: '${from}', fromNickname: 'A', targetId: '${to}', targetNickname: 'B', at: Date.now(), level: 3, added: 1 })`
await step('idle', '')
await step('bot beer', `${host}.__playDrink('${botId}', 'beer')`)
await step('bot water', `${host}.__playDrink('${botId}', 'water')`)
await step('hero beer', `${host}.__playDrink('${heroId}', 'beer')`)
await step('shot at bot', prank('shot', heroId, botId))
await step('shot at hero', prank('shot', botId, heroId))
await step('house shot', prank('house_shot', 'house', botId))
await step('chip flick at bot', prank('chip_flick', heroId, botId))
await step('chip flick at hero', prank('chip_flick', botId, heroId))
for (const fun of ['mushroom', 'trip', 'blackout', 'hangover', 'sober']) {
  await step(`fun ${fun}`, `window.__pokerDev?.fun('${fun}', '${heroId}')`)
}
await browser.close()
