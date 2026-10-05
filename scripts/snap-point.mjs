// Close-ups of one bot's hands in the moments that matter (development builds only).
// Forces the seat's animator inputs (frozen at a chosen time) and photographs the hand
// from several angles.
//
// Usage: node scripts/snap-hand-moments.mjs <outDir>
// Env: MOMENTS=peek,think0,cue:raise:0.5   (see MOMENT_DEFS in the page script)
//      HAND=R|L|both  VIEWS=front,side,top,behind  SEAT=<bot index>  DIST=0.55
//      SNAP_WIDTH/SNAP_HEIGHT, POKER_APP_URL, PRE_JS (run in page before shots)
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
const outDir = process.argv[2] ?? 'output/v2/hands/moments'
const width = Number(process.env.SNAP_WIDTH ?? 1440)
const height = Number(process.env.SNAP_HEIGHT ?? 900)
const moments = (process.env.MOMENTS ?? 'rail,peek,think0,think1,think2,cue:check:0.3,cue:check:0.45,cue:call:0.4,cue:raise:0.5,cue:all_in:0.45,cue:fold:0.36,drink:1.1,drink:1.6,flip:1.0,big:1:2.0,clap').split(',')
const views = (process.env.VIEWS ?? 'front,side,top').split(',')
const hands = (process.env.HAND ?? 'auto').split(',')
const seatIndex = Number(process.env.SEAT ?? 1)
const dist = Number(process.env.DIST ?? 0.55)
const fov = Number(process.env.FOV ?? 32)
const settleMs = Number(process.env.SETTLE ?? 1100)
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

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
let page = null
async function setup() {
  if (page) await page.close().catch(() => {})
  page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', error => console.log('pageerror:', error.message))
  await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
  await page.getByLabel('Your nickname').fill('Hero')
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
  await sleep(3000)
  await page.addStyleTag({ content: '.table-stage, .social-dock, .table-side-panels, .room-hud, .drink-controls, .drink-toasts, .drunk-vision, .cinematic-seat { display: none !important }' })
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } .desktop-3d-stage, .desktop-3d-stage * { visibility: visible !important }' })

  // In-page moment driver: re-asserts the forced state every animation frame.
  await page.evaluate(seatIdx => {
    const stage = document.querySelector('.desktop-3d-stage')
    let rt = stage.__pokerRuntime
    globalThis.__animQuiet = !globalThis.__hmAllowIdle
    const bots0 = [...rt.seats.values()].filter(s => s.root.visible && s.avatar && !s.isHero).sort((a, b) => a.visualSeat - b.visualSeat)
    const seatId = bots0[Math.min(seatIdx, bots0.length - 1)].playerId
    const otherId = bots0.find(b => b.playerId !== seatId).playerId
    let seat = rt.seats.get(seatId)
    let other = rt.seats.get(otherId)
    const hm = { seat, moment: null, seatId, rt0: rt }
    globalThis.__hm = hm
    const refresh = () => {
      rt = stage.__pokerRuntime
      seat = rt.seats.get(seatId)
      other = rt.seats.get(otherId)
      hm.seat = seat
    }
    const nowS = () => (performance.now() - rt.startTime) / 1000
    const INF = Number.POSITIVE_INFINITY
    function clear() {
      refresh()
      seat.acting = false
      seat.winner = false
      seat.loser = false
      seat.peeking = false
      seat.folded = false
      seat.flipOff = null
      seat.playback = { key: '', cue: 'ready', startedAtMs: -INF }
      seat.actionKey = ''
      seat.drinkStartedAt = -100
      const a = seat.animator
      a.reactionSince = -INF
      a.bigIdleStartedAt = -INF
      a.nextBigIdleAt = INF
      a.nextPeekAt = INF
      a.nextMicroAt = INF
      a.peekStartedAt = -INF
      a.microStartedAt = -INF
      rt.anyWinner = false
    }
    hm.clear = clear
    hm.set = spec => {
      clear()
      refresh()
      hm.moment = spec
    globalThis.__animQuiet = spec.kind !== 'big'
      if (spec.kind === 'drink') {
        seat.drinkId = 'hm-' + Math.random()
        if (!seat.drinkProp) globalThis.__hmDrinkNeeded = true
      }
    }
    function apply() {
      refresh()
      hm.ticks = (hm.ticks ?? 0) + 1
      if (!globalThis.__fphHidden) {
        const root = rt.firstPersonHands?.root
        if (root) { Object.defineProperty(root, 'visible', { get: () => false, set: () => {} }); globalThis.__fphHidden = true }
      }
      const m = hm.moment
      if (m) {
        const now = nowS()
        const a = seat.animator
        a.nextBigIdleAt = INF
        a.nextPeekAt = INF
        a.nextMicroAt = INF
        seat.hadCards = true
        seat.cards.visible = true
        if (m.kind !== 'fold') seat.folded = false
        if (m.kind !== 'think') seat.acting = false
        if (m.kind !== 'win') seat.winner = false
        if (m.kind !== 'loser') seat.loser = false
        if (m.kind !== 'clap') { rt.anyWinner = false; a.reactionSince = Number.NEGATIVE_INFINITY }
        switch (m.kind) {
          case 'peek': seat.peeking = true; break
          case 'think': seat.acting = true; a.thinkingStyle = m.style; break
          case 'cue':
            seat.playback = { key: 'hm', cue: m.cue, startedAtMs: now * 1000 - m.t * 980 }
            seat.actionKey = 'hm'
            seat.wagerIntensity = m.big ?? 0.3
            break
          case 'win':
            seat.winner = true
            if (Number.isFinite(a.winnerSince)) a.winnerSince = now - 1.0 - m.e
            a.winFlair = m.flair
            seat.avatarProfile.celebration = m.celebration
            break
          case 'loser':
            seat.loser = true
            if (Number.isFinite(a.loserSince)) a.loserSince = now - m.e - seat.animator.seed * 0.7
            a.loserStyle = m.style
            break
          case 'flip':
            seat.flipOff = { startedAt: now - m.e, targetId: other.playerId }
            break
          case 'drink':
            seat.drinkStartedAt = now - m.e
            break
          case 'big':
            a.bigIdleStartedAt = now - m.e
            a.bigIdleKind = m.kind2
            break
          case 'clap':
            rt.anyWinner = true
            a.reactionKind = m.reaction
            if (!Number.isFinite(a.reactionSince)) a.reactionSince = now
            else a.reactionSince = now - m.e
            break
          case 'fold':
            seat.folded = true
            break
          default: break
        }
      }
      requestAnimationFrame(apply)
    }
    requestAnimationFrame(apply)
  }, seatIndex)


}
function parseMoment(text) {
  const [kind, a, b, c] = text.split(':')
  switch (kind) {
    case 'rail': return { kind: 'rail' }
    case 'peek': return { kind: 'peek' }
    case 'think0': return { kind: 'think', style: 0 }
    case 'think1': return { kind: 'think', style: 1 }
    case 'think2': return { kind: 'think', style: 2 }
    case 'cue': return { kind: 'cue', cue: a, t: Number(b ?? 0.5), big: Number(c ?? 0.3) }
    case 'drink': return { kind: 'drink', e: Number(a ?? 1.1) }
    case 'flip': return { kind: 'flip', e: Number(a ?? 1.0) }
    case 'big': return { kind: 'big', kind2: Number(a ?? 1), e: Number(b ?? 2) }
    case 'win': return { kind: 'win', celebration: a ?? 'victory', flair: Number(b ?? 0), e: Number(c ?? 1.0) }
    case 'loser': return { kind: 'loser', style: Number(a ?? 3), e: Number(b ?? 1.5) }
    case 'clap': return { kind: 'clap', reaction: Number(a ?? 0), e: Number(b ?? 1.0) }
    case 'fold': return { kind: 'fold' }
    default: throw new Error('unknown moment ' + text)
  }
}

async function setCamera(handName, view) {
  await page.evaluate(({ handName, view, dist, fov }) => {
    const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
    const seat = rt.seats.get(globalThis.__hm.seatId)
    const bone = seat.avatar.bones.get(handName === 'L' ? 'WristL' : 'WristR')
    const world = bone.getWorldPosition(new bone.position.constructor())
    // Look at the palm centre (a bit beyond the wrist along the hand).
    const mid = seat.avatar.bones.get((handName === 'L' ? 'Middle2L' : 'Middle2R'))
    const palm = mid ? mid.getWorldPosition(new bone.position.constructor()) : world
    const target = world.clone().lerp(palm, 0.9)
    const head = seat.avatar.bones.get('Head').getWorldPosition(new bone.position.constructor())
    const len = Math.hypot(head.x, head.z) || 1
    const f = { x: -head.x / len, z: -head.z / len }
    // Right-hand side of the avatar as seen from above: perpendicular to f.
    const r = { x: -f.z, z: f.x }
    const side = handName === 'L' ? -1 : 1
    let pos
    if (view === 'front') pos = [target.x + f.x * dist, target.y + dist * 0.55, target.z + f.z * dist]
    else if (view === 'side') pos = [target.x + r.x * side * dist, target.y + dist * 0.22, target.z + r.z * side * dist]
    else if (view === 'top') pos = [target.x + f.x * dist * 0.25, target.y + Math.min(0.7, dist * 0.8), target.z + f.z * dist * 0.25]
    else if (view === 'behind') pos = [target.x - f.x * dist, target.y + dist * 0.6, target.z - f.z * dist]
    else if (view === 'inner') pos = [target.x - r.x * side * dist, target.y + dist * 0.22, target.z - r.z * side * dist]
    else if (view === 'wide') pos = [head.x + f.x * 2.6, head.y + 0.9, head.z + f.z * 2.6]
    else if (view === 'fl' || view === 'fr') {
      const ang = (view === 'fr' ? 1 : -1) * 0.95 * (handName === 'L' ? -1 : 1)
      const c = Math.cos(ang), sn = Math.sin(ang)
      pos = [target.x + (f.x * c - f.z * sn) * dist, target.y + dist * 0.4, target.z + (f.x * sn + f.z * c) * dist]
    }
    else if (view === 'q') pos = [head.x + f.x * 2.6 + r.x * side * 1.6, head.y + 0.4, head.z + f.z * 2.6 + r.z * side * 1.6]
    else if (view === 'over') pos = [head.x + f.x * 0.5, head.y + 2.3, head.z + f.z * 0.5]
    else if (view === 'upper') pos = [head.x + f.x * 1.7, head.y + 0.1, head.z + f.z * 1.7]
    else pos = [target.x + f.x * dist, target.y + dist * 0.4, target.z + f.z * dist]
    const lookAt = view === 'q' ? [head.x + f.x * 0.2, head.y - 0.45, head.z + f.z * 0.2] : view === 'over' ? [head.x + f.x * 0.9, head.y - 1.0, head.z + f.z * 0.9] : view === 'upper' ? [head.x, head.y - 0.35, head.z] : view === 'wide' ? [head.x, head.y - 0.45, head.z] : [target.x, target.y, target.z]
    rt.debugCamera = { position: pos, lookAt, fov: view === 'upper' || view === 'wide' ? 38 : view === 'q' ? 40 : view === 'over' ? 50 : fov }
  }, { handName, view, dist, fov })
}

async function healthy() {
  return page.evaluate(() => {
    const rt = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
    const hm = globalThis.__hm
    return Boolean(rt && hm && hm.rt0 === rt && hm.seat && hm.seat.avatar && document.querySelector('.desktop-3d-stage').dataset.webglStatus === 'ready')
  }).catch(() => false)
}

async function shootMoment(text) {
  const spec = parseMoment(text)
  if (!(await healthy())) throw new Error('page reloaded')
  await page.evaluate(spec => {
    if (spec) globalThis.__hm.set(spec)
    else { globalThis.__hm.clear(); globalThis.__hm.moment = null }
  }, spec)
  const needsDrink = await page.evaluate(() => Boolean(globalThis.__hmDrinkNeeded))
  if (needsDrink) {
    await page.evaluate(() => {
      document.querySelector('.desktop-3d-stage').__playDrink(globalThis.__hm.seat.playerId, 'beer')
      globalThis.__hmDrinkNeeded = false
    })
  }
  await sleep(settleMs)
  if (process.env.DEBUG) {
    console.log(text, JSON.stringify(await page.evaluate(() => {
      const hm = globalThis.__hm
      const seat = hm.seat
      const a = seat.animator
      const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
      return { ticks: hm.ticks, folded: seat.folded, hadCards: seat.hadCards, peeking: seat.peeking, acting: seat.acting, any: rt.anyWinner, reaction: a.reactionSince, kind: a.reactionKind, playerId: seat.playerId, handR: seat.lastPose?.handR, shapeR: Array.from(seat.lastPose?.handShapeR.weights ?? []).map(v => +v.toFixed(2)) }
    })))
  }
  if (process.env.PRINT) {
    console.log(text, JSON.stringify(await page.evaluate(() => {
      const seat = globalThis.__hm.seat
      const bones = seat.avatar.bones
      const loc = n => { const b = bones.get(n); if (!b) return null; const p = seat.root.worldToLocal(b.getWorldPosition(new b.position.constructor())); return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] }
      const r = v => v && v.map(x => +x.toFixed(2))
      return { vs: seat.visualSeat, board: r(seat.anchors.board), shR: r(seat.anchors.shoulderR), shL: r(seat.anchors.shoulderL), handR: r(seat.lastPose?.handR), handL: r(seat.lastPose?.handL), armL: loc('UpperArmL'), foreL: loc('LowerArmL'), wristL: loc('WristL'), idxL: loc('Index2L'), armR: loc('UpperArmR'), wristR: loc('WristR'), head: loc('Head'), frameR: r(seat.lastPose?.frameR) }
    })))
  }
  let handList = hands
  if (hands[0] === 'point') {
    const bx = await page.evaluate(() => { const a = globalThis.__hm.seat.anchors; return a.board[0] - (a.shoulderR[0] + a.shoulderL[0]) / 2 })
    handList = [Math.abs(bx) < 0.08 ? (await page.evaluate(() => globalThis.__hm.seat.animator.seed >= 0.5)) ? 'L' : 'R' : bx < 0 ? 'L' : 'R']
    console.log('board sideways', bx.toFixed(2), '->', handList[0])
  }
  if (hands[0] === 'auto') {
    const left = ['drink'].includes(spec?.kind)
    const both = ['think2', 'clap', 'peek'].includes(text) || ['clap', 'win'].includes(spec?.kind) || (spec?.kind === 'big' && [1, 2].includes(spec.kind2)) || (spec?.kind === 'cue' && spec.cue === 'all_in')
    handList = both ? ['R', 'L'] : left ? ['L'] : ['R']
  }
  let shots = 0
  for (const handName of handList) {
    for (const view of views) {
      await setCamera(handName, view)
      await sleep(260)
      if (!(await healthy())) throw new Error('page reloaded mid-moment')
      const safe = text.replace(/[:.]/g, '_')
      await page.screenshot({ path: path.join(outDir, `${safe}-${handName}-${view}.png`) })
      shots += 1
    }
  }
  return shots
}

let count = 0
// SHAPES=fist,card,...: hold both hands out in front of the chest (hand lab) in each shape.
// LABFRAME='[yaw,pitch,roll]' sets the wrist frame (roll 0 = palms down).
async function shootShapes() {
  // PATCHES='[{"n":"t1","s":"relaxed","p":{"2":-60}}]' (joint index -> degrees; thumb abduct = index 2)
  const patches = process.env.PATCHES ? JSON.parse(process.env.PATCHES) : null
  const list = patches ? patches.map(entry => entry.n) : process.env.SHAPES.split(',')
  const frame = JSON.parse(process.env.LABFRAME ?? '[0,0,0]')
  const labMoment = process.env.LABMOMENT ? parseMoment(process.env.LABMOMENT) : { kind: 'rail' }
  const sideName = hands[0] === 'auto' ? 'R' : hands[0]
  if (labMoment.kind === 'drink') await page.evaluate(() => { document.querySelector('.desktop-3d-stage').__playDrink(globalThis.__hm.seat.playerId, 'beer') })
  await page.evaluate(({ spec, side }) => {
    globalThis.__hmSide = side
    globalThis.__hm.set(spec)
  }, { spec: labMoment, side: sideName })
  for (const name of list) {
    const entry = patches ? patches.find(e => e.n === name) : null
    await page.evaluate(({ name, frame, entry, noLab }) => {
      const shapeName = entry ? entry.s : name
      globalThis.__handDebug = noLab ? { [globalThis.__hmSide]: shapeName } : { R: shapeName, L: shapeName }
      globalThis.__handDebugPatch = entry ? Object.fromEntries(Object.entries(entry.p ?? {}).map(([k, v]) => [k, v * Math.PI / 180])) : undefined
      globalThis.__handLab = noLab ? undefined : { forward: 0.5, sep: 0.32, up: 0.1, frame }
    }, { name, frame, entry, noLab: Boolean(process.env.LABMOMENT) })
    await sleep(900)
    for (const view of views) {
      await setCamera(sideName, view)
      await sleep(240)
      if (!(await healthy())) throw new Error('page reloaded mid-shape')
      await page.screenshot({ path: path.join(outDir, `shape-${name}-${view}.png`) })
      count += 1
    }
  }
}
try {
await setup()
if (process.env.PRE_JS) await page.evaluate(process.env.PRE_JS)
if (process.env.FPWIN) {
  // First-person win pose (debugForce): WINSECS='0.6,1,1.4' seconds since the win.
  for (const sec of process.env.WINSECS.split(',')) {
    await page.evaluate(sec => {
      const rt = document.querySelector('.desktop-3d-stage').__pokerRuntime
      rt.debugCamera = null
      rt.firstPersonHands.debugForce = { cue: 'ready', elapsedMs: 1e9, winnerSeconds: Number(sec) }
    }, sec)
    await sleep(700)
    await page.screenshot({ path: path.join(outDir, `fpwin-${sec}.png`) })
    count += 1
  }
}
if (process.env.SHAPES || process.env.PATCHES) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await shootShapes(); break } catch (error) { console.log('retry', String(error.message).slice(0, 80)); await setup() }
  }
}
for (const text of (process.env.SHAPES || process.env.PATCHES || process.env.FPWIN) ? [] : moments) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      count += await shootMoment(text)
      break
    } catch (error) {
      console.log('retry after', String(error.message).slice(0, 80))
      await setup()
      if (process.env.PRE_JS) await page.evaluate(process.env.PRE_JS)
    }
  }
}
console.log('saved', count, 'shots to', outDir)
} finally {
  await browser.close().catch(() => {})
}
