// Animation review recorder: films a scenario on the desktop 3D table as real
// video (host and guest), then cuts dense frame contact sheets around every
// marked moment so timing, easing and interpenetration can be judged frame by
// frame. Development builds only (uses the dev hooks).
//
// Usage: node scripts/record-anim.mjs <scenario> [outDir]
//   scenarios: hand | pranks | fun | lady | peek | turn
// Env: FFMPEG=<path to ffmpeg>, FPS (default 12), POKER_APP_URL.
import { chromium } from '@playwright/test'
import { sheet as cutSheet } from './anim-sheet.mjs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const scenario = process.argv[2] ?? 'hand'
const outDir = process.argv[3] ?? path.join('output/anim-polish', scenario)
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const fps = Number(process.env.FPS ?? 12)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const VIEW = { width: Number(process.env.VIEW_W ?? 1280), height: Number(process.env.VIEW_H ?? 800) }

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

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })

async function film(name) {
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: outDir, size: VIEW } })
  const page = await context.newPage()
  const t0 = Date.now()
  page.on('pageerror', error => console.log(`${name} pageerror:`, error.message))
  return { name, context, page, t0 }
}

const host = await film('host')
await host.page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
await host.page.getByLabel('Your nickname').fill('Host')
await host.page.getByRole('button', { name: 'Create Table' }).click()
await host.page.waitForURL(/\/room\//)
const roomUrl = host.page.url()

const guest = await film('guest')
await guest.page.goto(roomUrl, { waitUntil: 'load', timeout: 120000 })
await guest.page.getByLabel('Your nickname').fill('Guest')
await guest.page.getByRole('button', { name: 'Enter Room' }).click()
await sleep(3000)
for (let attempt = 0; attempt < 40; attempt += 1) {
  const seated = await host.page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
  if (seated >= 6) break
  await clickVisible(host.page, 'Fill seats')
  await sleep(700)
}
await host.page.waitForFunction(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6, null, { timeout: 60000 }).catch(() => {})
await sleep(1500)

const marks = []
/** Marks a moment to review: `seconds` of video after it go on a sheet. */
const mark = (label, seconds = 3, who = 'host') => {
  marks.push({ label, at: Date.now(), seconds, who })
  console.log(`mark ${label}`)
}

const phase = page => page.locator('.desktop-3d-stage').first().getAttribute('data-phase').catch(() => '')
async function startHand() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await phase(host.page) === 'in_hand') return true
    await clickVisible(host.page, /^(Start game|Deal next hand)$/i)
    await sleep(500)
  }
  return false
}
const idOf = (page, name) => page.evaluate(nick => {
  const plate = [...document.querySelectorAll('[data-seat-player]')].find(el => el.textContent?.includes(nick))
  return plate?.getAttribute('data-seat-player') ?? null
}, name)
const botName = page => page.evaluate(() => {
  const plates = [...document.querySelectorAll('[data-seat-player] strong')].map(el => el.textContent ?? '')
  return plates.find(name => name && name !== 'Host' && name !== 'Guest') ?? null
})
/** Aim the debug camera at a seat from the side, or clear it. */
async function aimAt(page, playerId, options = {}) {
  await page.evaluate(({ playerId, options }) => {
    const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
    if (!runtime) return
    if (!playerId) { runtime.debugCamera = null; return }
    const seat = runtime.seats.get(playerId)
    if (!seat) return
    const p = seat.root.position
    const toward = Math.hypot(p.x, p.z) || 1
    const tx = -p.z / toward
    const tz = p.x / toward
    // From over the felt, looking out at the seat (3/4 view): never inside a neighbour.
    const dist = options.dist ?? 2.3
    const side = options.side ?? 0.7
    runtime.debugCamera = {
      position: [p.x - (p.x / toward) * dist + tx * side, options.y ?? 1.7, p.z - (p.z / toward) * dist + tz * side],
      lookAt: [p.x - (p.x / toward) * 0.35, options.lookY ?? 0.95, p.z - (p.z / toward) * 0.35],
      fov: options.fov ?? 45,
    }
  }, { playerId, options })
}
async function playHost(ms, pattern = /^(Check|Call)/) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await clickVisible(host.page, pattern)
    await clickVisible(guest.page, /^(Check|Call)/)
    await sleep(300)
  }
}

const scenarios = {
  async hand() {
    mark('deal', 4)
    await startHand()
    await sleep(4500)
    // Play check/call; mark streets as they land.
    let board = 0
    const deadline = Date.now() + 150000
    let raised = false
    while (Date.now() < deadline) {
      const count = await host.page.evaluate(() => document.querySelector('.desktop-3d-stage')?.__pokerRuntime?.board.visibleCount ?? 0).catch(() => 0)
      if (count > board) { mark(`board-${count}`, 2.5); board = count }
      if (!raised && await clickVisible(host.page, /^(Bet|Raise)/)) { mark('host-raise', 2.5); raised = true }
      await clickVisible(host.page, /^(Check|Call)/)
      await clickVisible(guest.page, /^(Call|Check)/)
      if (await phase(host.page) === 'between_hands') { mark('showdown', 8); await sleep(8000); break }
      await sleep(300)
    }
    mark('next-deal', 4)
    await startHand()
    await sleep(3000)
    mark('guest-fold', 3)
    await playHost(4000)
  },
  async pranks() {
    await startHand()
    await sleep(3000)
    const hostId = await idOf(guest.page, 'Host')
    const guestId = await idOf(host.page, 'Guest')
    const bot = await botName(host.page)
    const botId = await idOf(host.page, bot)
    // Bot seats and guest seen by host: chip flick guest -> bot (thrower + bonk).
    await aimAt(host.page, guestId)
    mark('guest-beer-side', 5)
    await clickVisible(guest.page, /beer/i)
    await sleep(5000)
    await aimAt(host.page, null)
    mark('flick-guest-to-host', 3.5)
    mark('flick-guest-to-host', 3.5, 'guest')
    await guest.page.evaluate(([from, to]) => document.querySelector('.desktop-3d-stage').__playPrank({ id: `f${Date.now()}`, kind: 'chip_flick', fromId: from, targetId: to, at: Date.now() }), [guestId, hostId])
    await host.page.evaluate(([from, to]) => document.querySelector('.desktop-3d-stage').__playPrank({ id: `f${Date.now()}`, kind: 'chip_flick', fromId: from, targetId: to, at: Date.now() }), [guestId, hostId])
    await sleep(3800)
    mark('flick-host-to-bot', 3.5)
    await host.page.evaluate(([from, to]) => document.querySelector('.desktop-3d-stage').__playPrank({ id: `f${Date.now()}`, kind: 'chip_flick', fromId: from, targetId: to, at: Date.now() }), [hostId, botId])
    await sleep(3800)
    mark('flick-guest-to-bot', 3.5)
    await host.page.evaluate(([from, to]) => document.querySelector('.desktop-3d-stage').__playPrank({ id: `f${Date.now()}`, kind: 'chip_flick', fromId: from, targetId: to, at: Date.now() }), [guestId, botId])
    await sleep(3800)
    mark('shot-host-to-guest', 7)
    mark('shot-host-to-guest', 7, 'guest')
    const shot = (page, from, to, kind = 'shot', rule) => page.evaluate(([from, to, kind, rule]) => document.querySelector('.desktop-3d-stage').__playPrank({ id: `s${Date.now()}${Math.random()}`, kind, fromId: from, targetId: to, rule, at: Date.now() }), [from, to, kind, rule])
    await shot(host.page, hostId, guestId)
    await shot(guest.page, hostId, guestId)
    await sleep(7500)
    mark('shot-guest-to-bot-closeup', 7)
    await aimAt(host.page, botId)
    await shot(host.page, guestId, botId)
    await sleep(7500)
    await aimAt(host.page, null)
    mark('cheers', 9)
    const ids = await host.page.evaluate(() => [...document.querySelector('.desktop-3d-stage').__pokerRuntime.seats.keys()])
    for (const id of ids) await shot(host.page, null, id, 'house_shot', 'cheers')
    await sleep(9000)
    mark('flip-off', 4)
    const plate = guest.page.locator('[data-seat-player]').filter({ hasText: 'Host' }).first()
    await plate.click({ timeout: 1500 }).catch(() => {})
    await sleep(300)
    if (!await clickVisible(guest.page, /Send middle finger to Host/)) await clickVisible(guest.page, /🖕/)
    await guest.page.keyboard.press('Escape').catch(() => {})
    await sleep(4000)
    mark('guest-water', 5)
    await clickVisible(guest.page, /water/i)
    await sleep(5000)
  },
  async fun() {
    await startHand()
    await sleep(3000)
    const guestId = await idOf(host.page, 'Guest')
    const dev = (page, action, target) => page.evaluate(([action, target]) => window.__pokerDev?.fun(action, target), [action, target])
    mark('blackout-guest-seen-by-host', 6)
    mark('blackout-guest-firstperson', 8, 'guest')
    await dev(guest.page, 'blackout')
    await sleep(9000)
    mark('hangover-guest', 6, 'guest')
    await dev(guest.page, 'hangover')
    await sleep(7000)
    mark('sober-host', 5)
    await dev(host.page, 'sober')
    await sleep(5000)
    mark('mushroom-host', 6)
    await dev(host.page, 'mushroom')
    await sleep(6000)
    mark('trip-host-start', 8)
    mark('trip-guest-sees-aura', 6, 'guest')
    await dev(host.page, 'trip')
    await sleep(8000)
    mark('trip-host-mid', 6)
    await sleep(6000)
    await playHost(20000)
    mark('trip-host-late', 6)
    await sleep(6000)
  },
  /** Close-up on one bot (SEAT_BOT=index among bots) through whole hands; marks each of its actions. */
  async seat() {
    const bots = await host.page.evaluate(() => [...document.querySelectorAll('[data-seat-player] strong')].map(el => el.textContent ?? '').filter(name => name.startsWith('Bot')))
    const bot = bots[Number(process.env.SEAT_BOT ?? 2)] ?? bots[0]
    const botId = await idOf(host.page, bot)
    console.log('filming', bot)
    await aimAt(host.page, botId, { side: Number(process.env.SIDE ?? 1.0), dist: Number(process.env.DIST ?? 3.6), y: Number(process.env.CAM_Y ?? 1.95), lookY: 1.1, fov: 36 })
    let lastKey = ''
    let hands = 0
    mark('deal', 4)
    await startHand()
    const deadline = Date.now() + Number(process.env.SECONDS ?? 90) * 1000
    while (Date.now() < deadline) {
      const state = await host.page.evaluate(id => {
        const seat = document.querySelector('.desktop-3d-stage').__pokerRuntime.seats.get(id)
        return seat ? { key: seat.actionKey, cue: seat.actionCue, peeking: seat.peeking, winner: seat.winner } : null
      }, botId)
      if (state && state.key && state.key !== lastKey) { lastKey = state.key; mark(`${state.cue}`, 2.4) }
      await clickVisible(host.page, /^(Check|Call)/)
      await clickVisible(guest.page, /^(Check|Call)/)
      if (await phase(host.page) === 'between_hands') {
        mark('hand-end', 6)
        await sleep(6500)
        hands += 1
        if (hands >= Number(process.env.HANDS ?? 2)) break
        mark('deal', 4)
        await startHand()
      }
      await sleep(150)
    }
  },
  /** Your turn, all-in, showdown banners, pre-action chips and the reconnect chip (host view). */
  async turn() {
    const trayUp = () => host.page.locator('.betting-tray').first().isVisible().catch(() => false)
    const until = async (check, ms, step = 100) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (await check()) return true
        await clickVisible(guest.page, /^(Check|Call)/)
        await sleep(step)
      }
      return false
    }
    await startHand()
    if (await until(trayUp, 60000)) {
      mark('your-turn-tray', 3)
      await sleep(1800)
      mark('all-in', 6)
      if (!await clickVisible(host.page, /^All-in/i)) console.log('no all-in button')
      await sleep(1500)
      await until(async () => await phase(host.page) === 'between_hands', 60000, 250)
      mark('showdown-winner', 9)
      await sleep(9000)
    }
    mark('next-deal', 3)
    await startHand()
    const chip = host.page.locator('.pre-action-chip').first()
    if (await until(() => chip.isVisible().catch(() => false), 60000)) {
      mark('preaction-select', 2.5)
      await chip.click({ timeout: 1500 }).catch(() => {})
      await sleep(400)
      const note = host.page.locator('.pre-action-note').first()
      if (await until(() => note.isVisible().catch(() => false), 60000)) mark('preaction-auto-exec', 3)
      await sleep(3000)
    }
    mark('reconnect', 9)
    await host.context.setOffline(true)
    await sleep(4000)
    await host.context.setOffline(false)
    await sleep(5000)
  },
  async lady() {
    await startHand()
    await sleep(2000)
    mark('lady-play', 12)
    await playHost(40000, /^(Check|Call)/)
  },
  async peek() {
    mark('deal-faceup-flipdown', 6)
    await startHand()
    await sleep(6000)
    const styles = ['curl', 'hinge', 'spin', 'slide', 'fan', 'wipe']
    for (const style of styles) {
      await host.page.evaluate(style => { localStorage.setItem('poker-night:peek-style', style); window.dispatchEvent(new StorageEvent('storage', { key: 'poker-night:peek-style' })) }, style)
      await sleep(300)
      mark(`peek-${style}`, 2)
      const row = host.page.locator('.own-card-row.is-concealed').first()
      const box = await row.boundingBox().catch(() => null)
      if (!box) { console.log('no concealed row'); continue }
      await host.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await host.page.mouse.down()
      await sleep(900)
      await host.page.mouse.up()
      await host.page.mouse.move(10, 400)
      await sleep(1300)
    }
  },
}

await scenarios[scenario]()
await sleep(500)

const videos = {}
for (const film of [host, guest]) {
  const video = film.page.video()
  await film.context.close()
  const source = await video.path()
  const target = path.join(outDir, `${film.name}.webm`)
  await rename(source, target)
  videos[film.name] = target
}
await browser.close()

const tFor = { host: host.t0, guest: guest.t0 }
const cuts = marks.map((item, index) => ({
  name: `${String(index + 1).padStart(2, '0')}-${item.who}-${item.label}`,
  video: videos[item.who],
  start: Math.max(0, (item.at - tFor[item.who]) / 1000 - 0.25),
  seconds: item.seconds,
}))
await writeFile(path.join(outDir, 'marks.json'), JSON.stringify(cuts, null, 2))
for (const cut of cuts) {
  cutSheet(cut.video, cut.start, cut.seconds, path.join(outDir, `${cut.name}.png`), { fps, ffmpeg, width: Number(process.env.SHEET_W ?? 400), cols: Number(process.env.SHEET_COLS ?? 6) })
  console.log('sheet', cut.name, `@${cut.start.toFixed(1)}s`)
}

