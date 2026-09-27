// Hitch hunter: plays hands at a full desktop table while recording a Chrome
// trace and a CPU profile, then explains every main-thread task over the
// threshold: its trace breakdown (style, layout, GC, script) and the hottest
// functions sampled inside it.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-hitches.mjs [seconds] [thresholdMs]
import { chromium } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const seconds = Number(process.argv[2] ?? 40)
const threshold = Number(process.argv[3] ?? 50)
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
const context = await browser.newContext({ viewport: { width, height } })
const page = await context.newPage()
page.on('pageerror', error => console.log('pageerror:', error.message))
const cdp = await context.newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
const fromStart = process.env.FROM_START === '1'
const startTracing = async () => {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
  await cdp.send('Tracing.start', {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'v8.execute', 'blink', 'gpu',
      ...(process.env.INVALIDATIONS ? ['disabled-by-default-devtools.timeline.invalidationTracking'] : [])].join(','),
    transferMode: 'ReportEvents',
  })
  await cdp.send('Profiler.start')
}
if (fromStart) await startTracing()
await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 5) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
if (!fromStart) {
  await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
  await sleep(2000)
  await startTracing()
}
await clickVisible(page, /^Start game$/)
const end = Date.now() + seconds * 1000
while (Date.now() < end) {
  // Cheap in-page click: Playwright role queries walk the accessibility tree and skew the numbers.
  await page.evaluate(() => document.querySelector('button[data-action="check"]:not(:disabled), button[data-action="call"]:not(:disabled), button[data-action="check-call"]:not(:disabled)')?.click())
  await sleep(700)
}
const { profile } = await cdp.send('Profiler.stop')
const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
await cdp.send('Tracing.end')
await done
await browser.close()

const rendererPid = events.find(event => event.name === 'TracingStartedInBrowser')?.args?.data?.frames?.find(frame => !frame.parent)?.processId
const mainTid = events.find(event => event.name === 'thread_name' && event.pid === rendererPid && event.args?.name === 'CrRendererMain')?.tid
const main = events.filter(event => event.pid === rendererPid && event.tid === mainTid)
const tasks = main.filter(event => event.name === 'RunTask' && event.ph === 'X' && event.dur >= threshold * 1000)

// CPU samples on the trace clock.
const byId = new Map(profile.nodes.map(node => [node.id, node]))
const sampleTimes = []
let clock = profile.startTime
for (const delta of profile.timeDeltas) { clock += delta; sampleTimes.push(clock) }

console.log(`${tasks.length} tasks >= ${threshold}ms in ${seconds}s`)
// Big style recalcs: how many elements, and what invalidated them.
const t0 = main.find(event => event.ph === 'X')?.ts ?? 0
for (const recalc of main.filter(event => event.name === 'UpdateLayoutTree' && event.ph === 'X' && event.dur >= 15000)) {
  const count = recalc.args?.elementCount ?? recalc.args?.endData?.elementCount
  const reasons = new Map()
  for (const event of main) {
    if (!/InvalidationTracking/.test(event.name) || event.ts > recalc.ts || event.ts < recalc.ts - 40000) continue
    const data = event.args?.data ?? {}
    const key = `${data.reason ?? data.changedAttribute ?? data.changedClass ?? data.changedPseudo ?? ''} | ${(data.nodeName ?? '').slice(0, 60)}`
    reasons.set(key, (reasons.get(key) ?? 0) + 1)
  }
  console.log(`style ${(recalc.dur / 1000).toFixed(0)}ms elements=${count} @${((recalc.ts - t0) / 1e6).toFixed(1)}s`,
    JSON.stringify([...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)))
}
for (const task of tasks) {
  const start = task.ts
  const finish = task.ts + task.dur
  const inside = main.filter(event => event.ph === 'X' && event.ts >= start && event.ts + (event.dur ?? 0) <= finish && event !== task)
  const buckets = {}
  for (const event of inside) {
    if (!['UpdateLayoutTree', 'Layout', 'MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'Paint', 'CompileScript', 'v8.compile', 'EvaluateScript', 'ParseHTML', 'FireAnimationFrame', 'FunctionCall', 'TimerFire', 'EventDispatch', 'v8.callFunction', 'Decode Image', 'ImageDecodeTask', 'Layerize', 'PrePaint'].includes(event.name)) continue
    buckets[event.name] = (buckets[event.name] ?? 0) + event.dur / 1000
  }
  const self = new Map()
  for (let index = 0; index < sampleTimes.length; index += 1) {
    if (sampleTimes[index] < start || sampleTimes[index] > finish) continue
    let node = byId.get(profile.samples[index])
    // Attribute to the nearest app/three frame for readability.
    const frame = node.callFrame
    const key = `${frame.functionName || '(anon)'} ${frame.url.split('/').pop()}:${frame.lineNumber}`
    self.set(key, (self.get(key) ?? 0) + 0.25)
  }
  const hot = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, ms]) => `${ms.toFixed(0)}ms ${key}`)
  console.log(`\n${(task.dur / 1000).toFixed(0)}ms @${((start - tasks[0].ts) / 1e6).toFixed(1)}s ${JSON.stringify(Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, +v.toFixed(0)])))}`)
  for (const line of hot) console.log('   ', line)
}
