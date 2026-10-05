// Screenshot matrix for design audits: plays real hands against bots at every
// layout breakpoint and captures each phase.
//
// Usage: node scripts/design-capture.mjs <outDir> [viewportName,...]
// Requires `npm run dev` (Next on :3000, PartyKit on :1999).
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/design-audit/before'
const only = process.argv[3]?.split(',')

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'tablet-900', width: 900, height: 1200, mobile: true },
  { name: 'phone-430', width: 430, height: 932, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'phone-375', width: 375, height: 667, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
].filter(viewport => !only || only.includes(viewport.name))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function shot(page, dir, label, log) {
  const file = path.join(dir, `${label}.png`)
  await page.screenshot({ path: file })
  log.push(label)
}

async function fillProfile(page, nickname) {
  await page.getByLabel('Your nickname').fill(nickname)
}

async function clickIfVisible(locator) {
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index)
    if (await target.isVisible().catch(() => false) && await target.isEnabled().catch(() => false)) {
      const clicked = await target.click({ timeout: 2500 }).then(() => true, () => false)
      if (clicked) {
        return true
      }
    }
  }
  return false
}

async function captureViewport(browser, viewport) {
  const dir = path.join(outDir, viewport.name)
  await mkdir(dir, { recursive: true })
  const log = []
  const contextOptions = {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: Boolean(viewport.mobile),
    hasTouch: Boolean(viewport.mobile),
  }
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  const fps = {}

  try {
    await page.goto(appUrl, { waitUntil: 'networkidle' })
    await sleep(800)
    await shot(page, dir, '01-landing', log)

    await fillProfile(page, 'Hero')
    await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
    await page.waitForURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 60000 })
    const roomUrl = page.url()

    const guestContext = await browser.newContext(contextOptions)
    const guest = await guestContext.newPage()
    await guest.goto(roomUrl, { waitUntil: 'networkidle' })
    await sleep(800)
    await shot(guest, dir, '02-profile-gate', log)
    await guestContext.close()

    await page.waitForSelector('.table-scene', { timeout: 60000 })
    await sleep(3500)
    await shot(page, dir, '03-waiting-empty', log)

    await clickIfVisible(page.getByRole('button', { name: 'Fill seats' }))
    await sleep(3000)
    await shot(page, dir, '04-waiting-full', log)

    if (await clickIfVisible(page.getByRole('button', { name: 'Open settings' }))) {
      await sleep(900)
      await shot(page, dir, '05-settings', log)
      if (!await clickIfVisible(page.getByRole('button', { name: /^Close( settings)?$/ }))) {
        await page.keyboard.press('Escape')
      }
      await sleep(700)
    }

    await clickIfVisible(page.getByRole('button', { name: /^(Start game|Deal next hand)$/ }))

    const seenPhases = new Set()
    let heroTurnShot = false
    const deadline = Date.now() + 150000
    const streetNames = ['preflop', 'x1', 'x2', 'flop', 'turn', 'river']
    while (Date.now() < deadline) {
      const scene = page.locator('.table-scene')
      const phase = await scene.getAttribute('data-phase').catch(() => null)
      const showdown = await scene.getAttribute('data-showdown-stage').catch(() => null)
      const runItTwice = await scene.getAttribute('data-run-it-twice').catch(() => null)
      const boardCount = Number(await page.locator('.community-cards').first().getAttribute('data-visible-count').catch(() => 0)) || 0
      let key = phase
      if (showdown && !['idle', 'none', 'hidden'].includes(showdown)) {
        key = `showdown-${showdown}`
      } else if (runItTwice && runItTwice !== 'none') {
        key = `run-it-twice-${runItTwice}`
      } else if (phase === 'in_hand') {
        key = streetNames[boardCount] ?? `board-${boardCount}`
      }
      if (key && !seenPhases.has(key)) {
        seenPhases.add(key)
        await sleep(key.startsWith('showdown') ? 150 : 700)
        await shot(page, dir, `10-phase-${key}`, log)
      }

      const actionButtons = page.locator(
        '[data-action="check"], [data-action="call"], [data-action="check-call"]',
      )
      const actionCount = await actionButtons.count().catch(() => 0)
      let visibleAction = null
      for (let index = 0; index < actionCount; index += 1) {
        const candidate = actionButtons.nth(index)
        if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
          visibleAction = candidate
          break
        }
      }
      if (visibleAction) {
        if (!heroTurnShot) {
          heroTurnShot = true
          await sleep(500)
          await shot(page, dir, '06-hero-turn', log)
        }
        await visibleAction.click({ timeout: 3000 }).catch(() => {})
      }

      await clickIfVisible(page.getByRole('button', { name: /^(Start game|Deal next hand)$/ }))

      const doneShowdown = ['showdown-payout', 'showdown-result', 'showdown-complete'].some(value => seenPhases.has(value))
      if (doneShowdown && seenPhases.has('river') && seenPhases.has('flop')) {
        break
      }
      await sleep(400)
    }

    if (!viewport.mobile && viewport.width >= 1024) {
      fps.value = await page.evaluate(() => new Promise(resolve => {
        let frames = 0
        const start = performance.now()
        function tick() {
          frames += 1
          if (performance.now() - start >= 3000) {
            resolve(Math.round((frames * 1000) / (performance.now() - start)))
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }))
    }

    if (await clickIfVisible(page.getByRole('button', { name: /Open table chat/ }))) {
      await sleep(700)
      await shot(page, dir, '20-social-dock', log)
    }
  } catch (error) {
    log.push(`ERROR: ${error.message.split('\n')[0]}`)
    await page.screenshot({ path: path.join(dir, 'zz-error.png') }).catch(() => {})
  } finally {
    await context.close()
  }

  return { viewport: viewport.name, shots: log, fps: fps.value ?? null }
}

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const results = []
const queue = [...VIEWPORTS]
async function worker() {
  while (queue.length) {
    const viewport = queue.shift()
    const result = await captureViewport(browser, viewport)
    console.log(`${result.viewport}: ${result.shots.length} shots${result.fps ? `, ~${result.fps}fps` : ''}`)
    results.push(result)
  }
}
await Promise.all([worker(), worker(), worker()])
await browser.close()
await writeFile(path.join(outDir, 'capture-summary.json'), JSON.stringify(results, null, 2))
