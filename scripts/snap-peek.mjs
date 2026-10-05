// Peek-at-your-cards visual check: records the hero hand squeeze on desktop
// (1440x900) and phone (390x844) and saves stills plus a video per viewport.
// Quick click/tap = brief squeeze that settles by itself; press-and-hold (or
// holding Space) = full lift for as long as it's held.
// Usage: node scripts/snap-peek.mjs <outDir> [desktop|mobile]
import { chromium, devices } from '@playwright/test'
import { mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/peek'
const only = process.argv[3]
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

async function openTable(browser, name, contextOptions) {
  const dir = path.join(outDir, name)
  await mkdir(dir, { recursive: true })
  const context = await browser.newContext({
    ...contextOptions,
    recordVideo: { dir, size: contextOptions.viewport },
  })
  const page = await context.newPage()
  page.on('pageerror', error => console.log(`${name} pageerror:`, error.message))
  await page.goto(appUrl, { waitUntil: 'networkidle' })
  await page.getByLabel('Your nickname').fill('Peeker')
  await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
  await page.waitForURL(/\/room\//)
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (await page.locator('.own-card-row.is-concealed').count()) break
    if (!(await clickVisible(page, /^Start game$/))) await clickVisible(page, 'Fill seats')
    await sleep(1200)
  }
  try {
    await page.waitForSelector('.own-card-row.is-concealed', { timeout: 10000 })
  } catch (error) {
    await page.screenshot({ path: path.join(dir, 'error.png') })
    throw error
  }
  await sleep(1400)
  return { context, page, dir }
}

async function finish(context, page, dir, name) {
  const video = page.video()
  await context.close()
  if (video) {
    const source = await video.path()
    await rename(source, path.join(dir, `${name}.webm`)).catch(() => {})
  }
}

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })

if (only !== 'mobile') {
  const { context, page, dir } = await openTable(browser, 'desktop', { viewport: { width: 1440, height: 900 } })
  const row = page.locator('.own-card-row.is-concealed').first()
  const box = await row.boundingBox()
  const clip = { x: Math.max(0, box.x - 180), y: Math.max(0, box.y - 170), width: box.width + 360, height: box.height + 230 }
  const shot = name => page.screenshot({ path: path.join(dir, name), clip })
  await shot('01-face-down.png')
  await page.screenshot({ path: path.join(dir, '00-full-face-down.png') })

  // Quick click: a brief squeeze that settles by itself.
  await row.click()
  await sleep(70)
  await shot('02-quick-70ms.png')
  await sleep(130)
  await shot('03-quick-200ms.png')
  await sleep(350)
  await shot('04-quick-550ms.png')
  await page.screenshot({ path: path.join(dir, '04-full-quick.png') })
  await sleep(550)
  await shot('05-quick-settling-1100ms.png')
  await sleep(700)
  await shot('06-quick-settled.png')

  // Press and hold: lifts fully and stays while held.
  const center = await row.boundingBox()
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2)
  await page.mouse.down()
  await sleep(1500)
  await shot('07-hold-1500ms.png')
  await page.screenshot({ path: path.join(dir, '07-full-hold.png') })
  await page.mouse.up()
  await sleep(90)
  await shot('08-hold-release-90ms.png')
  await sleep(800)

  // Hold Space (auto-repeat must not re-trigger or scroll).
  await page.mouse.move(20, 450)
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.keyboard.down(' ')
  for (let index = 0; index < 8; index += 1) {
    await sleep(120)
    await page.keyboard.down(' ') // repeat keydown, like a held key
  }
  await shot('09-space-held.png')
  const scrollAfter = await page.evaluate(() => window.scrollY)
  await page.keyboard.up(' ')
  await sleep(800)
  await shot('10-space-released.png')
  console.log('space scroll delta', scrollAfter - scrollBefore)

  // Quick Space tap.
  await page.keyboard.press(' ')
  await sleep(450)
  await shot('11-space-tap.png')
  await sleep(1400)
  await finish(context, page, dir, 'desktop-peek')
}

if (only !== 'desktop') {
  const { context, page, dir } = await openTable(browser, 'mobile', {
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  })
  await page.screenshot({ path: path.join(dir, '01-face-down.png') })
  const row = page.locator('.own-card-row.is-concealed').first()
  await row.tap()
  await sleep(450)
  await page.screenshot({ path: path.join(dir, '02-tap-450ms.png') })
  await sleep(1400)
  await page.screenshot({ path: path.join(dir, '03-tap-settled.png') })
  // Touch press-and-hold via CDP touch events.
  const box = await row.boundingBox()
  const client = await context.newCDPSession(page)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await sleep(1300)
  await page.screenshot({ path: path.join(dir, '04-touch-hold.png') })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(900)
  await page.screenshot({ path: path.join(dir, '05-touch-released.png') })
  await finish(context, page, dir, 'mobile-peek')
}

await browser.close()
console.log('saved to', outDir, await readdir(outDir))
