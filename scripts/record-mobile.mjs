// Animation review recorder for the mobile 2D table: films a real hand on a
// phone/tablet viewport (host) while a second phone plays along (guest), then
// cuts dense contact sheets around every marked moment: seats arriving and
// leaving, the deal, board flips, the your-turn prompt, the raise drawer,
// pre-action chips, a touch peek, showdown and payout.
//
// Usage: node scripts/record-mobile.mjs <viewport> [outDir]
//   viewports: phone-390 | phone-375 | phone-landscape | tablet-900
// Env: FFMPEG=<path to ffmpeg>, FPS (default 15), POKER_APP_URL.
import { chromium } from '@playwright/test'
import { sheet as cutSheet } from './anim-sheet.mjs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VIEWPORTS = {
  'phone-390': { width: 390, height: 844 },
  'phone-375': { width: 375, height: 667 },
  'phone-landscape': { width: 844, height: 390 },
  'tablet-900': { width: 900, height: 1200 },
}
const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const viewportName = process.argv[2] ?? 'phone-390'
const view = VIEWPORTS[viewportName]
if (!view) throw new Error(`unknown viewport ${viewportName}`)
const outDir = process.argv[3] ?? path.join('output/anim-polish-2/mobile', viewportName)
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const fps = Number(process.env.FPS ?? 15)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const mobile = { viewport: view, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

async function clickVisible(page, locator) {
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
      if (await candidate.click({ timeout: 1500 }).then(() => true, () => false)) return true
    }
  }
  return false
}
const button = (page, name) => clickVisible(page, page.getByRole('button', { name }))
const action = (page, selector) => clickVisible(page, page.locator(selector))

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const hostContext = await browser.newContext({ ...mobile, recordVideo: { dir: outDir, size: view } })
// The Next dev-tools badge sits over the bottom-left of the tray in dev builds.
await hostContext.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal { display: none !important }'
    document.head.appendChild(style)
  })
})
const host = await hostContext.newPage()
const t0 = Date.now()
host.on('pageerror', error => console.log('host pageerror:', error.message))

const marks = []
const mark = (label, seconds = 3) => { marks.push({ label, at: Date.now(), seconds }); console.log(`mark ${label}`) }

await host.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await host.getByLabel('Your nickname').fill('Host')
await host.getByRole('button', { name: 'Create Table' }).click()
await host.waitForURL(/\/room\//)
const roomUrl = host.url()
await host.waitForSelector('.table-scene', { timeout: 60000 })
await sleep(2500)

const guestContext = await browser.newContext(mobile)
const guest = await guestContext.newPage()
mark('guest-enter', 3.5)
await guest.goto(roomUrl, { waitUntil: 'load', timeout: 120000 })
await guest.getByLabel('Your nickname').fill('Guest')
await guest.getByRole('button', { name: 'Enter Room' }).click()
await sleep(3500)

mark('bots-enter', 4)
for (let attempt = 0; attempt < 10; attempt += 1) {
  if (await host.locator('[data-seat-player]').count() >= 6) break
  await button(host, /^Fill seats$/)
  await sleep(900)
}
await sleep(3000)

const phase = () => host.locator('.table-scene').first().getAttribute('data-phase').catch(() => '')
const board = () => host.locator('.community-cards').first().getAttribute('data-visible-count').then(Number).catch(() => 0)
const hostCanAct = async () => {
  const locator = host.locator('[data-action="check"], [data-action="call"], [data-action="check-call"]')
  for (let index = 0; index < await locator.count(); index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true
  }
  return false
}

async function playHand(hand) {
  mark(`h${hand}-deal`, 5)
  for (let attempt = 0; attempt < 20 && await phase() !== 'in_hand'; attempt += 1) {
    await button(host, /^(Start game|Deal next hand)$/)
    await sleep(500)
  }
  let lastBoard = 0
  let turns = 0
  let queued = false
  let peeked = false
  let wasTurn = false
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const count = await board()
    if (count > lastBoard) { mark(`h${hand}-board-${count}`, 2.5); lastBoard = count }
    const canAct = await hostCanAct()
    if (canAct && !wasTurn) {
      turns += 1
      mark(`h${hand}-your-turn-${turns}${queued ? '-after-preaction' : ''}`, 3)
      await sleep(1600)
      if (hand === 1 && turns === 1) {
        mark(`h${hand}-raise-drawer`, 4)
        await action(host, '[data-action="open-raise"]')
        await sleep(900)
        await button(host, /^Increase bet$/)
        await sleep(300)
        await button(host, /^Increase bet$/)
        await sleep(700)
        await button(host, /^Close raise sizing$/)
        await sleep(900)
      }
      if (hand === 2 && turns === 1) {
        mark(`h${hand}-hero-fold`, 3)
        await action(host, '[data-action="fold"]')
      } else {
        await action(host, '[data-action="check"], [data-action="call"], [data-action="check-call"]')
      }
      queued = false
    }
    wasTurn = canAct
    if (!canAct && await phase() === 'in_hand') {
      if (!peeked && hand === 1) {
        const row = host.locator('.own-card-row.is-concealed').first()
        const box = await row.boundingBox().catch(() => null)
        if (box) {
          peeked = true
          mark(`h${hand}-touch-peek`, 3)
          await host.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})
          await sleep(1500)
        }
      }
      if (!queued && hand === 1 && turns >= 1) {
        const chip = host.locator('.pre-action-chip').first()
        if (await chip.isVisible().catch(() => false)) {
          queued = true
          mark(`h${hand}-preaction-select`, 3)
          await chip.click({ timeout: 1500 }).catch(() => {})
        }
      }
    }
    await action(guest, '[data-action="check"], [data-action="call"], [data-action="check-call"]')
    if (await phase() === 'between_hands') {
      mark(`h${hand}-showdown`, 9)
      await sleep(9000)
      return
    }
    await sleep(250)
  }
}

await playHand(1)
await playHand(2)
await sleep(2000)
mark('guest-leave', 8)
await guestContext.close()
await sleep(8000)

await hostContext.close()
const source = await host.video().path()
const video = path.join(outDir, 'host.webm')
await rename(source, video)
await browser.close()

const cuts = marks.map((item, index) => ({
  name: `${String(index + 1).padStart(2, '0')}-${item.label}`,
  start: Math.max(0, (item.at - t0) / 1000 - 0.25),
  seconds: item.seconds,
}))
await writeFile(path.join(outDir, 'marks.json'), JSON.stringify(cuts, null, 2))
const landscape = view.width > view.height
for (const cut of cuts) {
  cutSheet(video, cut.start, cut.seconds, path.join(outDir, `${cut.name}.png`), {
    fps, ffmpeg, width: landscape ? 420 : Math.min(260, view.width), cols: landscape ? 4 : 8,
  })
  console.log('sheet', cut.name, `@${cut.start.toFixed(1)}s`)
}
