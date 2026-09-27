// Style-cost bisect (dev server): pauses the 3D loop mid-hand, then times a
// forced style recalc of one nameplate after moving it, with each stylesheet
// disabled in turn. Shows which CSS file makes per-element styling expensive.
// Usage: node scripts/probe-style-cost.mjs
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
await clickVisible(page, /^Start game$/)
await sleep(5000)
const result = await page.evaluate(() => {
  document.querySelector('.desktop-3d-stage').__pokerRuntime?.pause()
  const seats = [...document.querySelectorAll('.cinematic-seat:not(.is-local-player)')]
  const time = () => {
    const samples = []
    for (let round = 0; round < 40; round += 1) {
      const start = performance.now()
      for (const seat of seats) seat.style.setProperty('--seat-x', `${100 + round + Math.random()}px`)
      getComputedStyle(seats[0]).transform
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    return +samples[samples.length >> 1].toFixed(2)
  }
  const sheets = [...document.styleSheets]
  const label = sheet => (sheet.ownerNode?.getAttribute?.('data-n-href') || sheet.href || sheet.ownerNode?.textContent?.slice(0, 80) || '?').replace(/\s+/g, ' ')
  const baseline = time()
  const rows = []
  for (const sheet of sheets) {
    let rules = 0
    try { rules = sheet.cssRules.length } catch {}
    sheet.disabled = true
    const without = time()
    sheet.disabled = false
    rows.push({ sheet: label(sheet).slice(0, 90), rules, without })
  }
  for (const sheet of sheets) sheet.disabled = true
  const none = time()
  for (const sheet of sheets) sheet.disabled = false
  return { seats: seats.length, elementsPerSeat: seats[0]?.querySelectorAll('*').length, baseline, none, rows: rows.sort((a, b) => a.without - b.without).slice(0, 12) }
})
console.log(JSON.stringify(result, null, 1))
await browser.close()
