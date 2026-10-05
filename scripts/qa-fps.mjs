// Repeatable render-cost probe: private table (see qa-lib.mjs), full seats,
// waits for every rigged avatar, then takes N back-to-back samples and prints
// the per-metric median. Draw calls and triangles are load independent; GPU ms
// and fps are not (other processes share the GPU), so compare medians only.
//
// Usage: SNAP_WIDTH=1440 SNAP_HEIGHT=900 node scripts/qa-fps.mjs [seconds=6] [samples=3] [label]
// Appends one JSON line to output/v2/qa/fps-log.jsonl.
import { appendFile, mkdir } from 'node:fs/promises'
import { launch, usePrivateRoom, makeRoomId, enterRoom, fillSeats, waitForModels, clickVisible, sleep, sampleRender } from './qa-lib.mjs'

const seconds = Number(process.argv[2] ?? 6)
const samples = Number(process.argv[3] ?? 3)
const label = process.argv[4] ?? process.env.QA_LABEL ?? 'run'
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)

const browser = await launch()
const page = await browser.newPage({ viewport: { width, height } })
const errors = []
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`) })
await usePrivateRoom(page, makeRoomId('fp'))
await enterRoom(page, 'FpProbe')
await fillSeats(page, 5)
await waitForModels(page, 6)
await clickVisible(page, /^Start game$/)
await sleep(7000)

const runs = []
for (let i = 0; i < samples; i += 1) runs.push(await sampleRender(page, seconds))
const median = key => {
  const values = runs.map(run => run[key]).filter(Number.isFinite).sort((a, b) => a - b)
  return values.length ? values[values.length >> 1] : null
}
const summary = {
  label,
  at: new Date().toISOString(),
  size: `${width}x${height}`,
  samples,
  fps: median('fps'),
  frameP95: median('frameP95'),
  drawCalls: median('drawCallsAvg'),
  drawCallsMax: Math.max(...runs.map(run => run.drawCallsMax ?? 0)),
  triangles: median('trianglesAvg'),
  gpuMs: median('gpuMsAvg'),
  skinned: median('skinned'),
  errors: errors.length,
}
console.log(JSON.stringify(summary))
if (errors.length) console.log(errors.slice(0, 5).join('\n'))
await mkdir('output/v2/qa', { recursive: true })
await appendFile('output/v2/qa/fps-log.jsonl', JSON.stringify({ ...summary, runs }) + '\n')
await browser.close()
