// Lists every CSS animation/transition running on the table mid-hand (desktop
// or --mobile): infinite, non-composited ones re-style (and repaint) every frame.
// Usage: POKER_APP_URL=http://localhost:3100 node scripts/probe-animations.mjs [--mobile]
import { chromium, devices } from '@playwright/test'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const mobile = process.argv.includes('--mobile')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(appUrl)
await page.getByLabel('Your nickname').fill('Anim')
await page.getByRole('button', { name: 'Create Table' }).click()
await page.waitForURL(/\/room\//)
for (let attempt = 0; attempt < 30; attempt += 1) {
  const seats = await page.evaluate(() => Number(document.querySelector('.table-scene')?.getAttribute('data-player-count') ?? 0))
  if (seats >= 6) break
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Fill seats')?.click())
  await sleep(800)
}
await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Start game')?.click())
for (const label of ['in hand', 'my turn']) {
  if (label === 'my turn') {
    await page.waitForFunction(() => document.querySelector('button[data-action="fold"]'), null, { timeout: 60000 }).catch(() => {})
  } else {
    await sleep(5000)
  }
  const list = await page.evaluate(() => document.getAnimations().map(animation => {
    const target = animation.effect?.target
    const name = animation.animationName ?? animation.transitionProperty ?? animation.constructor.name
    const timing = animation.effect?.getTiming?.()
    const cls = target ? `${target.tagName?.toLowerCase?.() ?? ''}.${String(target.className?.baseVal ?? target.className ?? '').split(' ').slice(0, 2).join('.')}` : '?'
    return `${timing?.iterations === Infinity ? 'INFINITE ' : ''}${name} on ${cls} (${animation.playState})`
  }))
  const counts = new Map()
  for (const entry of list) counts.set(entry, (counts.get(entry) ?? 0) + 1)
  console.log(`--- ${label}: ${list.length} animations`)
  for (const [entry, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(3), entry)
}
await browser.close()
