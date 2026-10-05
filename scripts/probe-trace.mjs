// Chrome trace of the desktop room mid-hand: where does main-thread time go
// outside JS? Summarises UpdateLayoutTree (style recalc) element counts,
// Layout, Paint, GC and the style-invalidation reasons/nodes that triggered them.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-trace.mjs [seconds]
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 6)
const mobile = process.argv.includes('--mobile')
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
const { devices } = await import('@playwright/test')
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 } : { viewport: { width, height } })
const page = await context.newPage()
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
await page.waitForURL(/\/room\//)
if (!mobile) await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  if (await page.getByRole('button', { name: /^Start game$/ }).isVisible().catch(() => false)) {
    const seated = mobile ? 8 : await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
    if (seated >= 5) break
  }
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
if (!mobile) await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(2000)
await clickVisible(page, /^Start game$/)
await sleep(3000)

// Phone runs use a phone-sized viewport (device emulation hides the renderer from the trace).
const cdp = await context.newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
await cdp.send('Tracing.start', {
  categories: [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.invalidationTracking',
    'v8',
    'blink.user_timing',
  ].join(','),
  transferMode: 'ReportEvents',
})
await sleep(seconds * 1000)
await cdp.send('Tracing.end')
await done
if (process.env.TRACE_OUT) writeFileSync(process.env.TRACE_OUT, JSON.stringify({ traceEvents: events }))

// The renderer doing the style work (TracingStartedInBrowser's first frame is not always it).
const pidCounts = new Map()
for (const event of events) if (event.name === 'UpdateLayoutTree' || event.name === 'FireAnimationFrame') pidCounts.set(event.pid, (pidCounts.get(event.pid) ?? 0) + 1)
const mainPid = [...pidCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
const main = events.filter(event => !mainPid || event.pid === mainPid)
const sum = (name) => {
  const list = main.filter(event => event.name === name && event.ph === 'X')
  return { count: list.length, ms: +(list.reduce((total, event) => total + (event.dur ?? 0), 0) / 1000).toFixed(0) }
}
const recalc = main.filter(event => event.name === 'UpdateLayoutTree' && event.ph === 'X')
const elementCounts = recalc.map(event => event.args?.elementCount ?? event.args?.endData?.elementCount ?? 0)
console.log(JSON.stringify({
  seconds,
  UpdateLayoutTree: sum('UpdateLayoutTree'),
  avgElements: Math.round(elementCounts.reduce((a, b) => a + b, 0) / Math.max(1, elementCounts.length)),
  maxElements: Math.max(0, ...elementCounts),
  Layout: sum('Layout'),
  Paint: sum('Paint'),
  PrePaint: sum('PrePaint'),
  Layerize: sum('Layerize'),
  MinorGC: sum('MinorGC'),
  MajorGC: sum('MajorGC'),
  FunctionCall: sum('FunctionCall'),
  FireAnimationFrame: sum('FireAnimationFrame'),
  EventDispatch: sum('EventDispatch'),
}))
const reasons = new Map()
for (const event of main) {
  if (!/InvalidationTracking/.test(event.name)) continue
  const data = event.args?.data ?? {}
  const key = `${event.name.replace('InvalidationTracking', '')} | ${data.reason ?? data.changedAttribute ?? data.changedClass ?? data.changedPseudo ?? data.changedId ?? ''} | ${(data.nodeName ?? '').slice(0, 70)}`
  reasons.set(key, (reasons.get(key) ?? 0) + 1)
}
for (const [key, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(String(count).padStart(6), key)
}
await browser.close()
