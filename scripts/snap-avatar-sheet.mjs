// Contact sheets of avatar model x hat x glasses x jacket combinations (development builds only).
// Foreground, one headless browser, always closed. Uses the dev-only host.__setAvatarProfile hook
// (DesktopPokerRoom3D) and the helpers in scripts/avatar-lab-client.js.
//
// Usage: node scripts/snap-avatar-sheet.mjs <outDir>
// Env: SHEETS=hats,glasses,combo,jackets,colors,wrist,chain,custom (default hats), MODELS=a,b (subset),
//      DIST (camera distance, default 2.4), SHOT=face|top|side|wrist|upper, SHEET_PREFIX, SEATS (default 6),
//      CROP (square px of the screenshot centre, default 600), JOBS_JSON (for SHEETS=custom: [{label, patch}]),
//      FORCE_IDLE=<big idle kind> FORCE_ELAPSED=<s> (hold every seat in that idle, e.g. 1 = hands behind head),
//      SNAP_WIDTH/SNAP_HEIGHT (default 1280x720)
import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/variety'
const width = Number(process.env.SNAP_WIDTH ?? 1280)
const height = Number(process.env.SNAP_HEIGHT ?? 720)
const dist = Number(process.env.DIST ?? 2.4)
const crop = Math.min(Number(process.env.CROP ?? 600), width, height)
const shotKind = process.env.SHOT ?? 'face'
const seatLimit = Number(process.env.SEATS ?? 6)
const sheets = (process.env.SHEETS ?? 'hats').split(',')
const LAYOUT = { hats: [3, 400], glasses: [4, 300], combo: [5, 260], jackets: [3, 400], colors: [6, 220], wrist: [3, 400], chain: [3, 400], custom: [4, 320] }

const ALL_MODELS = ['business_man', 'casual', 'hoodie', 'worker', 'punk', 'adventurer']
const models = process.env.MODELS ? process.env.MODELS.split(',') : ALL_MODELS
const HATS = ['none', 'fedora', 'cowboy', 'beanie', 'visor', 'crown']
const GLASSES = ['none', 'round', 'aviator', 'shades']
const JACKETS = ['none', 'tuxedo', 'leather', 'varsity', 'western', 'smoking']
const JACKET_COLORS = ['burgundy', 'midnight', 'emerald', 'ivory', 'gold', 'violet']

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function clickVisible(page, name) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout: 2500 }).then(() => true, () => false)) return true
    }
  }
  return false
}

const base = { hat: 'none', glasses: 'none', jacket: 'none', jacketColor: 'burgundy' }
const jobs = {}
jobs.hats = models.flatMap(modelKey => HATS.map(hat => ({ label: `${modelKey} ${hat}`, patch: { ...base, modelKey, hat } })))
jobs.glasses = models.flatMap(modelKey => GLASSES.map(glasses => ({ label: `${modelKey} ${glasses}`, patch: { ...base, modelKey, glasses } })))
jobs.combo = models.flatMap(modelKey => HATS.filter(hat => hat !== 'none').flatMap(hat =>
  ['round', 'shades'].map(glasses => ({ label: `${modelKey} ${hat} ${glasses}`, patch: { ...base, modelKey, hat, glasses } }))))
jobs.jackets = models.flatMap(modelKey => JACKETS.map(jacket => ({ label: `${modelKey} ${jacket}`, patch: { ...base, modelKey, jacket } })))
jobs.colors = models.flatMap(modelKey => ['leather', 'western'].flatMap(jacket =>
  JACKET_COLORS.map(jacketColor => ({ label: `${modelKey} ${jacket} ${jacketColor}`, patch: { ...base, modelKey, jacket, jacketColor } }))))
jobs.wrist = models.flatMap(modelKey => [0, 1, 2, 3, 4, 5].map(n => ({ label: `${modelKey} ${n}`, patch: { ...base, modelKey } })))
jobs.chain = jobs.wrist
jobs.custom = process.env.JOBS_JSON ? JSON.parse(process.env.JOBS_JSON) : []

function labelSvg(text, size) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="20"><rect width="${size}" height="20" fill="rgba(0,0,0,0.7)"/><text x="5" y="14" font-family="monospace" font-size="12" fill="#fff">${safe}</text></svg>`)
}

await mkdir(path.join(outDir, 'raw'), { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
try {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', error => console.log('pageerror:', error.message))
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log('console', message.type(), message.text().slice(0, 300)) })
  await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
  await page.getByLabel('Your nickname').fill('Lab')
  await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
  await page.waitForURL(/\/room\//)
  await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 60000 })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
    if (seated >= 5) break
    await clickVisible(page, 'Fill seats')
    await sleep(700)
  }
  await sleep(1500)
  await clickVisible(page, /^Start game$/)
  await page.waitForFunction(
    () => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= 6,
    null,
    { timeout: 60000 }
  ).catch(() => {})
  await sleep(2500)
  await page.addStyleTag({ content: '.table-stage, .social-dock, .table-side-panels, .room-hud, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })
  await page.evaluate(() => {
    globalThis.stage = () => document.querySelector('.desktop-3d-stage')
    globalThis.rt = () => globalThis.stage().__pokerRuntime
  })
  const client = await readFile(new URL('./avatar-lab-client.js', import.meta.url), 'utf8')
  await page.evaluate(`(async () => { ${client} })()`)
  if (process.env.FORCE_IDLE) await page.evaluate(`lab.force(${Number(process.env.FORCE_IDLE)}, ${Number(process.env.FORCE_ELAPSED ?? 2)})`)
  if (process.env.PROBE_JS) { await new Promise(r => setTimeout(r, 2500)); console.log('PROBE', JSON.stringify(await page.evaluate(process.env.PROBE_JS))) }
  if (process.env.NO_TRIM) await page.evaluate('globalThis.__noTrim = true')
  const seatCount = Math.min(seatLimit, await page.evaluate('lab.ids().length'))
  console.log('seats', seatCount)

  for (const sheetName of sheets) {
    const list = jobs[sheetName]
    if (!list?.length) continue
    const [cols, tile] = LAYOUT[sheetName] ?? [4, 300]
    const kind = (sheetName === 'wrist' || sheetName === 'chain') && !process.env.SHOT ? (sheetName === 'wrist' ? 'upper' : 'chest') : shotKind
    const tiles = []
    for (let start = 0; start < list.length; start += seatCount) {
      const batch = list.slice(start, start + seatCount)
      await page.evaluate(`(async () => {
        const patches = ${JSON.stringify(batch.map(job => job.patch))}
        const ids = lab.ids()
        patches.forEach((patch, i) => stage().__setAvatarProfile(ids[i], patch))
        for (let n = 0; n < 300; n += 1) {
          if (patches.every((patch, i) => { const s = rt().seats.get(ids[i]); return s && s.avatar && s.avatar.modelKey === patch.modelKey && s.avatarLoadStatus === 'loaded' })) break
          await new Promise(r => setTimeout(r, 100))
        }
        await new Promise(r => setTimeout(r, 800))
      })()`)
      for (let index = 0; index < batch.length; index += 1) {
        const file = path.join(outDir, 'raw', `${sheetName}-${String(start + index).padStart(3, '0')}.png`)
        await page.evaluate(`(async () => { lab.cam(${index}, '${kind}', ${dist}); await new Promise(r => setTimeout(r, 300)) })()`)
        await page.screenshot({ path: file, clip: { x: Math.round((width - crop) / 2), y: Math.round((height - crop) / 2), width: crop, height: crop } })
        tiles.push({ file, label: batch[index].label })
      }
      console.log(sheetName, Math.min(list.length, start + seatCount), '/', list.length)
    }
    const groups = sheetName === 'custom' ? [null] : models
    for (const modelKey of groups) {
      const slice = modelKey ? tiles.filter(info => info.label.startsWith(`${modelKey} `)) : tiles
      if (slice.length === 0) continue
      const rows = Math.ceil(slice.length / cols)
      const composites = []
      for (let index = 0; index < slice.length; index += 1) {
        const x = (index % cols) * tile
        const y = Math.floor(index / cols) * tile
        composites.push({ input: await sharp(slice[index].file).resize(tile, tile).png().toBuffer(), left: x, top: y })
        composites.push({ input: labelSvg(slice[index].label, tile), left: x, top: y })
      }
      const out = path.join(outDir, `${process.env.SHEET_PREFIX ?? ''}${sheetName}${modelKey ? `-${modelKey}` : ''}.png`)
      await sharp({ create: { width: cols * tile, height: rows * tile, channels: 3, background: '#111' } }).composite(composites).png().toFile(out)
      console.log('wrote', out)
    }
  }
} finally {
  await browser.close()
}
