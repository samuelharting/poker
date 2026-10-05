// Logs every WebGL program link after the table is up (works on production
// builds): time, SHADER_NAME and a few telling #defines, so mid-hand shader
// compiles (a classic 100ms+ hitch) can be traced to the material behind them.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-compiles.mjs [seconds]
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
page.on('console', message => { if (message.text().startsWith('[link]')) console.log(message.text()) })
await page.addInitScript(() => {
  const proto = WebGL2RenderingContext.prototype
  const sources = new WeakMap()
  const shaders = new WeakMap()
  const originalSource = proto.shaderSource
  proto.shaderSource = function (shader, source) {
    sources.set(shader, source)
    return originalSource.call(this, shader, source)
  }
  const originalAttach = proto.attachShader
  proto.attachShader = function (program, shader) {
    const list = shaders.get(program) ?? []
    list.push(shader)
    shaders.set(program, list)
    return originalAttach.call(this, program, shader)
  }
  for (const name of ['texImage2D', 'texImage3D', 'compressedTexImage2D', 'bufferData']) {
    const original = proto[name]
    proto[name] = function (...args) {
      const start = performance.now()
      const result = original.apply(this, args)
      const cost = performance.now() - start
      const bytes = name === 'bufferData' ? (args[1]?.byteLength ?? args[1]) : (args.find(arg => arg && typeof arg === 'object' && ('width' in arg || 'byteLength' in arg)))
      const size = bytes && typeof bytes === 'object' ? ('width' in bytes ? `${bytes.width}x${bytes.height}` : `${bytes.byteLength}b`) : `${bytes ?? ''}`
      if (window.__logLinks && (name !== 'bufferData' || Number(bytes?.byteLength ?? bytes) > 200000)) {
        console.log(`[link] t=${((performance.now() - window.__logLinks) / 1000).toFixed(1)}s ${cost.toFixed(0)}ms ${name} ${size} :: ${new Error().stack.split('\n').slice(3, 7).map(line => line.trim().split(' ')[1]).join('<')}`)
      }
      return result
    }
  }
  const originalLink = proto.linkProgram
  proto.linkProgram = function (program) {
    const start = performance.now()
    const result = originalLink.call(this, program)
    // Three reads the link status right away (checkShaderErrors): that is the blocking part.
    this.getProgramParameter(program, this.LINK_STATUS)
    const cost = performance.now() - start
    if (window.__logLinks) {
      const source = (shaders.get(program) ?? []).map(shader => sources.get(shader) ?? '').join('\n')
      const name = source.match(/#define SHADER_NAME (\S+)/)?.[1] ?? '?'
      const type = source.match(/#define SHADER_TYPE (\S+)/)?.[1] ?? ''
      const flags = ['USE_SKINNING', 'USE_SHADOWMAP', 'USE_MAP', 'USE_INSTANCING', 'DEPTH_PACKING', 'TOON', 'PHYSICAL', 'USE_FOG', 'USE_ALPHAHASH', 'USE_TRANSMISSION']
        .filter(flag => source.includes(`#define ${flag}`)).join(',')
      console.log(`[link] t=${((performance.now() - window.__logLinks) / 1000).toFixed(1)}s ${cost.toFixed(0)}ms ${name} ${type} ${flags} :: ${new Error().stack.split('\n').slice(3, 8).map(line => line.trim().split(' ')[1]).join('<')}`)
    }
    return result
  }
})
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 90000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(3000)
await page.evaluate(() => {
  window.__logLinks = performance.now()
  // Frame gaps on the same clock, to line stalls up with what was uploaded/compiled.
  let last = performance.now()
  const tick = now => {
    if (now - last > 100) console.log(`[link] t=${((now - window.__logLinks) / 1000).toFixed(1)}s FRAME GAP ${Math.round(now - last)}ms`)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
console.log('--- game starts')
await clickVisible(page, /^Start game$/)
const end = Date.now() + seconds * 1000
while (Date.now() < end) {
  await page.evaluate(() => document.querySelector('button[data-action="check"]:not(:disabled), button[data-action="call"]:not(:disabled)')?.click())
  await sleep(700)
}
await browser.close()
