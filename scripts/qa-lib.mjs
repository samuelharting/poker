// Shared helpers for the QA scripts (qa-states.mjs, qa-fps.mjs).
//
// The client hard-codes one table (TABLE_ROOM_CODE = CREW22), so everybody who
// opens the app lands in the same PartyKit room. For repeatable runs we rewrite
// the websocket URL in the page (init script) so each run gets its own private
// room with its own bots and its own hand history.
import { chromium } from '@playwright/test'

export const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function makeRoomId(prefix = 'qa') {
  let id = prefix
  for (let i = 0; i < 6; i += 1) id += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
  return id
}

export async function launch() {
  return chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
}

/** Route the page's table socket to a private PartyKit room. */
export async function usePrivateRoom(page, roomId) {
  await page.addInitScript(id => {
    const Native = window.WebSocket
    window.__qaRoom = id
    function Patched(url, protocols) {
      const next = typeof url === 'string' ? url.replace(/\/crew22(\?|$)/i, `/${id}$1`) : url
      return protocols === undefined ? new Native(next) : new Native(next, protocols)
    }
    Patched.prototype = Native.prototype
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[key] = Native[key]
    window.WebSocket = Patched
  }, roomId)
}

export async function clickVisible(page, name, timeout = 1500) {
  const locator = page.getByRole('button', { name })
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      if (await candidate.click({ timeout }).then(() => true, () => false)) return true
    }
  }
  return false
}

/** Landing page -> table; returns once the 3D stage is ready. */
export async function enterRoom(page, nickname) {
  await page.goto(appUrl, { waitUntil: 'load', timeout: 120000 })
  await page.getByLabel('Your nickname').fill(nickname)
  await page.getByRole('button', { name: /Take a seat|Sit down as/ }).click()
  await page.waitForURL(/\/room\//)
  await page.waitForSelector('.desktop-3d-stage[data-webgl-status="ready"]', { timeout: 90000 })
}

/** Host presses Fill seats until the bots sit. */
export async function fillSeats(page, want = 5) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const seated = await page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
    if (seated >= want) return seated
    await clickVisible(page, 'Fill seats')
    await sleep(700)
  }
  return page.evaluate(() => Number(document.querySelector('.desktop-3d-stage')?.dataset.riggedAvatarTargets ?? 0))
}

export async function waitForModels(page, count = 6, timeout = 90000) {
  await page.waitForFunction(
    n => Number(document.querySelector('.desktop-3d-stage')?.dataset.avatarModelsLoaded ?? 0) >= n,
    count,
    { timeout }
  ).catch(() => {})
}

/**
 * Walks the whole scene and reports non-finite transforms. Seat roots are
 * walked in detail (bones, skeleton matrices, skinned bone inverses).
 */
export function scanNaNInPage() {
  const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
  if (!runtime) return { error: 'no runtime' }
  const bad = []
  const finite = arr => {
    for (let i = 0; i < arr.length; i += 1) if (!Number.isFinite(arr[i])) return false
    return true
  }
  const label = object => {
    const names = []
    let node = object
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parent) names.push(node.name || node.type)
    return names.join('<')
  }
  const check = object => {
    if (!finite(object.matrixWorld.elements) || !finite(object.matrix.elements)) {
      bad.push({ kind: 'matrix', at: label(object) })
      return
    }
    const p = object.position
    const q = object.quaternion
    const s = object.scale
    if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].every(Number.isFinite)) bad.push({ kind: 'trs', at: label(object) })
  }
  let checked = 0
  runtime.scene.traverse(object => {
    checked += 1
    check(object)
    if (object.isSkinnedMesh && object.skeleton) {
      const { boneMatrices } = object.skeleton
      if (boneMatrices && !finite(boneMatrices)) bad.push({ kind: 'boneMatrices', at: label(object) })
      for (const bone of object.skeleton.bones) {
        if (!finite(bone.matrixWorld.elements)) { bad.push({ kind: 'bone', at: `${bone.name}@${label(object)}` }); break }
      }
    }
    if (object.isMesh && object.geometry?.boundingSphere && !Number.isFinite(object.geometry.boundingSphere.radius)) {
      bad.push({ kind: 'boundingSphere', at: label(object) })
    }
  })
  const cam = runtime.camera
  if (![cam.position.x, cam.position.y, cam.position.z].every(Number.isFinite)) bad.push({ kind: 'camera', at: 'camera' })
  return { checked, bad: bad.slice(0, 20), badCount: bad.length }
}

/** Samples draw calls / GPU / JS per frame for `seconds`; mirrors scripts/probe-fps.mjs. */
export async function sampleRender(page, seconds) {
  return page.evaluate(async sampleSeconds => {
    const runtime = document.querySelector('.desktop-3d-stage')?.__pokerRuntime
    if (!runtime) return { error: 'no runtime' }
    const renderer = runtime.renderer
    const gl = renderer.getContext()
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    renderer.info.autoReset = false
    const frames = []
    const calls = []
    const tris = []
    const gpu = []
    const pending = []
    let query = null
    let last = performance.now()
    const start = last
    await new Promise(resolve => {
      const tick = now => {
        if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); query = null }
        calls.push(renderer.info.render.calls)
        tris.push(renderer.info.render.triangles)
        renderer.info.reset()
        frames.push(now - last)
        last = now
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (gl.getQueryParameter(pending[i], gl.QUERY_RESULT_AVAILABLE)) {
            gpu.push(gl.getQueryParameter(pending[i], gl.QUERY_RESULT) / 1e6)
            gl.deleteQuery(pending[i])
            pending.splice(i, 1)
          }
        }
        if (now - start >= sampleSeconds * 1000) { resolve(); return }
        if (ext) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query) }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    renderer.info.autoReset = true
    frames.shift(); calls.shift(); tris.shift()
    const avg = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)
    const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0 }
    let skinned = 0
    runtime.scene.traverseVisible(object => { if (object.isSkinnedMesh && object.layers.mask !== 8) skinned += 1 })
    return {
      frames: frames.length,
      fps: +(frames.length / sampleSeconds).toFixed(1),
      frameP50: +pct(frames, 0.5).toFixed(1),
      frameP95: +pct(frames, 0.95).toFixed(1),
      drawCallsAvg: Math.round(avg(calls)),
      drawCallsMax: Math.max(0, ...calls),
      trianglesAvg: Math.round(avg(tris)),
      gpuMsAvg: +avg(gpu).toFixed(2),
      gpuMsP50: +pct(gpu, 0.5).toFixed(2),
      skinned,
    }
  }, seconds)
}
