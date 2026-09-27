// CPU profile of the desktop room mid-hand: seats a full table, starts the
// game, then records a CDP CPU profile while clicking Check/Call and prints
// the top functions by self time (plus GC / style / layout from the trace
// categories the profiler exposes as "(garbage collector)", "(program)").
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-profile.mjs [seconds]
import { chromium, devices } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 20)
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
const mobile = process.argv.includes('--mobile')
const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width, height } })
const page = await context.newPage()
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
if (!mobile) await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.table-scene')?.getAttribute('data-player-count') ?? 0))
  if (seated >= 6) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
if (!mobile) await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(2000)
// START_IN_PROFILE=1 profiles the deal itself (the Start game click) instead of steady play.
const profileStart = process.env.START_IN_PROFILE === '1'
if (!profileStart) {
  await clickVisible(page, /^Start game$/)
  await sleep(2000)
}
const cdp = await context.newCDPSession(page)
if (process.env.THROTTLE) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) })
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
if (profileStart) await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Start game')?.click())
const end = Date.now() + seconds * 1000
while (Date.now() < end) {
  await clickVisible(page, /^(Check|Call)\b/)
  await sleep(400)
}
const { profile } = await cdp.send('Profiler.stop')
writeFileSync(process.env.PROFILE_OUT ?? join(tmpdir(), 'poker-profile.cpuprofile'), JSON.stringify(profile))
const byId = new Map(profile.nodes.map(node => [node.id, node]))
const self = new Map()
const deltas = profile.timeDeltas
for (let index = 0; index < profile.samples.length; index += 1) {
  const node = byId.get(profile.samples[index])
  const frame = node.callFrame
  const url = frame.url.split('/').pop()
  const key = `${frame.functionName || '(anon)'} ${url}:${frame.lineNumber}`
  self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000)
}
// Inclusive time: every function on the sampled stack (counted once per sample).
const parent = new Map()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const inclusive = new Map()
for (let index = 0; index < profile.samples.length; index += 1) {
  const seen = new Set()
  let id = profile.samples[index]
  while (id !== undefined) {
    const frame = byId.get(id).callFrame
    const key = `${frame.functionName || '(anon)'} ${frame.url.split('/').pop()}:${frame.lineNumber}`
    if (!seen.has(key)) {
      seen.add(key)
      inclusive.set(key, (inclusive.get(key) ?? 0) + (deltas[index] ?? 0) / 1000)
    }
    id = parent.get(id)
  }
}
if (process.env.INCLUSIVE) {
  console.log('--- inclusive')
  for (const [key, ms] of [...inclusive.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.INCLUSIVE))) {
    console.log(`${(ms / seconds).toFixed(1).padStart(6)} ms/s  ${key}`)
  }
  console.log('--- self')
}
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`total ${total.toFixed(0)}ms over ${seconds}s`)
for (const [key, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 40))) {
  console.log(`${(ms / seconds).toFixed(1).padStart(6)} ms/s  ${key}`)
}
await browser.close()
