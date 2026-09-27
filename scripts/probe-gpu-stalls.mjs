// Frame gaps with an idle main thread are GPU-side stalls. Plays a full desktop
// table while tracing the GPU process too, then for every rAF gap over the
// threshold lists the longest GPU-process / compositor events inside it.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-gpu-stalls.mjs [seconds] [gapMs]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 90)
const threshold = Number(process.argv[3] ?? 300)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(appUrl)
await page.getByLabel('Your nickname').fill('Gpu')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 30; attempt += 1) {
  const seats = await page.evaluate(() => Number(document.querySelector('.table-scene')?.getAttribute('data-player-count') ?? 0))
  if (seats >= 6) break
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Fill seats')?.click())
  await sleep(800)
}
await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(2000)

const cdp = await context.newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
await cdp.send('Tracing.start', {
  categories: ['toplevel', 'gpu', 'disabled-by-default-gpu.service', 'viz', 'blink.user_timing', 'devtools.timeline'].join(','),
  transferMode: 'ReportEvents',
})
await page.evaluate(() => {
  let last = performance.now()
  const tick = now => {
    if (now - last > 100) performance.measure(`gap ${Math.round(now - last)}`, { start: last, end: now })
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Start game')?.click())
const end = Date.now() + seconds * 1000
while (Date.now() < end) {
  await page.evaluate(() => document.querySelector('button[data-action="check"]:not(:disabled), button[data-action="call"]:not(:disabled)')?.click())
  await sleep(700)
}
await cdp.send('Tracing.end')
await done
await browser.close()

const names = new Map()
for (const event of events) {
  if (event.name === 'process_name') names.set(`p${event.pid}`, event.args?.name)
  if (event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args?.name)
}
const gaps = events.filter(event => event.cat?.includes('blink.user_timing') && event.name.startsWith('gap ') && event.ph === 'b')
console.log(`${gaps.length} gaps > 100ms`)
for (const gap of gaps) {
  const ms = Number(gap.name.slice(4))
  if (ms < threshold) continue
  const endEvent = events.find(event => event.name === gap.name && event.ph === 'e' && event.id2?.local === gap.id2?.local && event.ts >= gap.ts) ?? { ts: gap.ts + ms * 1000 }
  const inside = events.filter(event => event.ph === 'X' && event.dur > 20000 && event.ts < endEvent.ts && event.ts + event.dur > gap.ts)
  inside.sort((a, b) => b.dur - a.dur)
  console.log(`\nGAP ${ms}ms`)
  for (const event of inside.slice(0, 10)) {
    console.log(`  ${(event.dur / 1000).toFixed(0)}ms ${names.get(`p${event.pid}`) ?? event.pid}/${names.get(`${event.pid}:${event.tid}`) ?? event.tid} ${event.name} ${JSON.stringify(event.args?.src_func ?? event.args?.data?.name ?? '')}`)
  }
}
