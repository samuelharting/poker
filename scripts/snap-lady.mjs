// Lady Luck visual check: drives the dev-only /dev/companion harness (window.__lady)
// and saves full-body, 3/4, face and gesture close-ups.
//
// Usage: node scripts/snap-lady.mjs <outDir> [--gestures]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/snap/lady'
const withGestures = process.argv.includes('--gestures')

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', error => console.log('pageerror:', error.message))
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') console.log(`console.${message.type()}:`, message.text().slice(0, 300))
})
await page.goto(`${appUrl}/dev/companion`, { waitUntil: 'networkidle' })
await page.waitForSelector('.lady-harness-canvas[data-status="ready"]', { timeout: 60000 })
await page.addStyleTag({ content: '.lady-harness-controls { display: none !important; }' })

const lady = (script, arg) => page.evaluate(script, arg)
await lady(() => {
  window.__lady.pause(true)
  window.__lady.newCompanion('streak')
  window.__lady.step(3.2)
})

// Full-body frames: the harness 'closeup' view frames her head to toe.
const bodyClip = { x: 420, y: 0, width: 600, height: 900 }
const shots = [
  ['front', 'closeup', 0, bodyClip],
  ['three-quarter', 'closeup', 0.75, bodyClip],
  ['side', 'closeup', 1.45, bodyClip],
  ['back', 'closeup', Math.PI, bodyClip],
  ['face', 'face', 0, { x: 320, y: 60, width: 800, height: 780 }],
  ['face-three-quarter', 'face', 0.6, { x: 320, y: 60, width: 800, height: 780 }],
]
for (const [name, view, angle, clip] of shots) {
  await lady(([v, a]) => {
    window.__lady.view(v, a)
    window.__lady.step(0.05)
  }, [view, angle])
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip })
  console.log('saved', name)
}

// Table context shot.
await lady(() => {
  window.__lady.view('table')
  window.__lady.step(0.05)
})
await page.screenshot({ path: path.join(outDir, 'table.png') })

// First-person hero view: she stands by "your" chair, lower-left.
await lady(() => {
  window.__lady.hero(true)
  window.__lady.newCompanion('streak')
  window.__lady.step(3.2)
})
await page.screenshot({ path: path.join(outDir, 'hero.png') })
await lady(() => {
  window.__lady.hero(false)
  window.__lady.newCompanion('streak')
  window.__lady.step(3.2)
})

if (withGestures) {
  const gestures = [
    ['wink', [0.45]],
    ['blowKiss', [0.35, 0.65]],
    ['hairFlip', [0.3, 0.46]],
    ['lean', [0.5]],
    ['shoulderRub', [0.5]],
    ['serve', [0.4]],
    ['cheer', [0.4]],
    ['fingerGuns', [0.4]],
    ['fan', [0.5]],
    ['cheekKiss', [0.45]],
    ['chaChing', [0.5]],
    ['eyeRoll', [0.5]],
  ]
  const durations = {
    wink: 1.3, fingerGuns: 1.9, blowKiss: 2.1, hairFlip: 1.8, lean: 3.6, fan: 2.6,
    chaChing: 2.0, cheekKiss: 3.0, cheer: 2.8, eyeRoll: 1.9, serve: 3.4, shoulderRub: 4.4,
  }
  for (const [gesture, fractions] of gestures) {
    await lady(() => {
      window.__lady.view('closeup', 0.45)
      window.__lady.step(3)
    })
    await lady(name => window.__lady.gesture(name), gesture)
    let elapsed = 0
    for (const fraction of fractions) {
      const target = fraction * durations[gesture]
      await lady(seconds => window.__lady.step(seconds), target - elapsed)
      elapsed = target
      await page.screenshot({ path: path.join(outDir, `g-${gesture}-${Math.round(fraction * 100)}.png`), clip: { x: 220, y: 0, width: 1000, height: 900 } })
    }
    await lady(seconds => window.__lady.step(seconds), durations[gesture] - elapsed + 0.5)
    console.log('saved gesture', gesture)
  }
}

console.log('done')
await browser.close()
