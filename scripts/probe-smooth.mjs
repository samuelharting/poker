// Smoothness probe: plays full hands at an 8-seat table (hero + bots) and
// reports what a player feels as glitches, without touching app internals so
// it works against a production build:
//  - frame pacing (rAF gaps: p50/p95/p99/max, count > 50ms and > 100ms)
//  - long tasks (PerformanceObserver) and their total
//  - style recalcs / layouts per second (CDP Performance metrics)
//  - websocket traffic from the table server (messages/s, bytes/s, biggest)
//  - layout shift score
// Usage: POKER_APP_URL=http://localhost:3100 SNAP_WIDTH=1920 SNAP_HEIGHT=1080 \
//        node scripts/probe-smooth.mjs [hands] [--mobile] [--throttle=4]
import { chromium, devices } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const hands = Number(process.argv.find(arg => /^\d+$/.test(arg)) ?? 3)
const mobile = process.argv.includes('--mobile')
const throttle = Number(process.argv.find(arg => arg.startsWith('--throttle='))?.split('=')[1] ?? 1)
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
const context = await browser.newContext(mobile
  ? { ...devices[process.env.DEVICE ?? 'iPhone 13'] }
  : { viewport: { width, height } })
const page = await context.newPage()
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => { if (message.type() === 'error') console.log('console.error:', message.text().slice(0, 200)) })
await page.addInitScript(() => {
  const socketStats = { messages: 0, bytes: 0, biggest: 0, byType: {} }
  window.__socketStats = socketStats
  const NativeSocket = window.WebSocket
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', event => {
        if (typeof event.data === 'string' && event.data.startsWith('{"type":"room_snapshot"')) {
          try { window.__handNumber = JSON.parse(event.data).state.handNumber } catch {}
        }
        if (!window.__measuring) return
        const size = typeof event.data === 'string' ? event.data.length : 0
        socketStats.messages += 1
        socketStats.bytes += size
        socketStats.biggest = Math.max(socketStats.biggest, size)
        const type = typeof event.data === 'string' ? (event.data.match(/"type":"([a-z_]+)"/)?.[1] ?? '?') : '?'
        const entry = socketStats.byType[type] ??= { count: 0, bytes: 0, same: 0 }
        entry.count += 1
        entry.bytes += size
        // Identical to the previous message of its type (ignoring the server clock)?
        const comparable = typeof event.data === 'string' ? event.data.replace(/"serverNow":\d+/, '') : ''
        if (entry.last === comparable) entry.same += 1
        entry.last = comparable
      })
    }
  }
  window.__longTasks = []
  window.__cls = 0
  try {
    new PerformanceObserver(list => {
      if (!window.__measuring) return
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration))
    }).observe({ type: 'longtask', buffered: false })
    new PerformanceObserver(list => {
      if (!window.__measuring) return
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        window.__cls += entry.value
        const nodes = (entry.sources ?? []).map(source => source.node?.className?.toString?.().split(' ')[0] || source.node?.nodeName || '?').join('+')
        const scene = document.querySelector('.table-scene')
        const first = entry.sources?.[0]
        const move = first ? `${Math.round(first.previousRect.y)}->${Math.round(first.currentRect.y)}` : ''
        ;(window.__shifts ??= []).push(`${entry.value.toFixed(3)} ${nodes} dy:${move} tray=${scene?.getAttribute('data-tray-open')} phase=${scene?.getAttribute('data-phase')} dock=${Boolean(document.querySelector('.mobile-between-hands-dock, .check-fold-pre-action-dock, .rabbit-hunt-dock'))} trayH=${scene?.style.getPropertyValue('--mobile-tray-h')} hero=${scene?.getAttribute('data-hero-seat')} fieldPad=${getComputedStyle(document.querySelector('.mobile-poker-field') ?? document.body).paddingBottom} vh=${innerHeight}`)
      }
    }).observe({ type: 'layout-shift', buffered: false })
  } catch {}
})
if (process.env.INJECT_CSS) {
  // Experiment hook: add CSS to test a hypothesis without a rebuild.
  await page.addInitScript(css => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
    })
  }, process.env.INJECT_CSS)
}
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')

await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await page.getByLabel('Your nickname').fill('Prober')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
if (!mobile) {
  await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
}
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seats = await page.evaluate(() => Number(document.querySelector('.table-scene')?.getAttribute('data-player-count') ?? 0))
  if (seats >= 6) break
  await clickVisible(page, 'Fill seats')
  await sleep(700)
}
if (!mobile) {
  await page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
}
await sleep(2500)
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })

const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
await page.evaluate(() => {
  window.__measuring = true
  window.__t0 = performance.now()
  window.__gaps = []
  let last = performance.now()
  const tick = now => {
    window.__gaps.push(now - last)
    if (now - last > 100) (window.__bigGaps ??= []).push(`${Math.round(now - last)}ms@${((now - window.__t0) / 1000).toFixed(1)}s hand${window.__handNumber ?? '?'} ${document.querySelector('[data-showdown-stage]')?.getAttribute('data-showdown-stage') ?? ''}`)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const before = await metric()
const startedAt = Date.now()
await clickVisible(page, /^Start game$/)

let handsSeen = 0
let lastHand = null
const deadline = Date.now() + (process.env.DURATION ? Number(process.env.DURATION) * 1000 : 70000 * hands)
while (Date.now() < deadline && handsSeen < hands) {
  const handNumber = await page.evaluate(() => window.__handNumber ?? null)
  if (handNumber && lastHand && handNumber !== lastHand) handsSeen += 1
  if (handNumber) lastHand = handNumber
  // Cheap in-page click: Playwright role queries walk the accessibility tree and skew the numbers.
  await page.evaluate(() => document.querySelector('button[data-action="check"]:not(:disabled), button[data-action="call"]:not(:disabled), button[data-action="check-call"]:not(:disabled)')?.click())
  await sleep(700)
}
await sleep(1500)
const after = await metric()
const seconds = (Date.now() - startedAt) / 1000
const result = await page.evaluate(() => {
  window.__measuring = false
  const gaps = window.__gaps.slice(5)
  const sorted = [...gaps].sort((a, b) => a - b)
  const pct = p => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(1)
  return {
    frames: gaps.length,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: +(sorted.at(-1) ?? 0).toFixed(0),
    over50: gaps.filter(gap => gap > 50).length,
    over100: gaps.filter(gap => gap > 100).length,
    longTasks: window.__longTasks.length,
    longTaskMs: window.__longTasks.reduce((a, b) => a + b, 0),
    longestTask: Math.max(0, ...window.__longTasks),
    cls: +window.__cls.toFixed(3),
    bigGaps: window.__bigGaps ?? [],
    shifts: (window.__shifts ?? []).sort((a, b) => parseFloat(b) - parseFloat(a)).slice(0, 10),
    socket: window.__socketStats,
  }
})
const perSecond = key => +((after[key] - before[key]) / seconds).toFixed(1)
console.log(JSON.stringify({
  mode: mobile ? `mobile ${process.env.DEVICE ?? 'iPhone 13'} x${throttle}` : `${width}x${height}`,
  hands: handsSeen,
  seconds: +seconds.toFixed(1),
  fps: +(result.frames / seconds).toFixed(1),
  ...result,
  socket: {
    msgPerSec: +(result.socket.messages / seconds).toFixed(1),
    kbPerSec: +(result.socket.bytes / 1024 / seconds).toFixed(1),
    biggestKb: +(result.socket.biggest / 1024).toFixed(1),
    byType: Object.fromEntries(Object.entries(result.socket.byType).map(([type, entry]) => [type, `${entry.count}x ${(entry.bytes / Math.max(1, entry.count) / 1024).toFixed(1)}kb (${entry.same} dup)`])),
  },
  recalcStylePerSec: perSecond('RecalcStyleCount'),
  layoutPerSec: perSecond('LayoutCount'),
  scriptMsPerSec: +(((after.ScriptDuration - before.ScriptDuration) * 1000) / seconds).toFixed(0),
  layoutMsPerSec: +(((after.LayoutDuration - before.LayoutDuration) * 1000) / seconds).toFixed(0),
  styleMsPerSec: +(((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000) / seconds).toFixed(0),
  heapMb: +(after.JSHeapUsedSize / 1048576).toFixed(0),
}))
await browser.close()
