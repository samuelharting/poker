// Evaluated inside the page by scripts/snap-avatar-sheet.mjs: helpers for avatar close-ups.
const sleep = ms => new Promise(r => setTimeout(r, ms))
globalThis.lab = {
  ids() { return [...rt().seats.values()].filter(s => s.root.visible && s.avatar).map(s => s.playerId) },
  seat(i) { return rt().seats.get(lab.ids()[i]) },
  async set(i, patch) {
    const id = lab.ids()[i]
    stage().__setAvatarProfile(id, patch)
    for (let n = 0; n < 200; n += 1) {
      const s = rt().seats.get(id)
      if (s && s.avatar && (!patch.modelKey || s.avatar.modelKey === patch.modelKey) && s.avatarLoadStatus === 'loaded') break
      await sleep(100)
    }
    await sleep(300)
  },
  /** Holds every lab seat in one big idle (kind, seconds into it) by re-asserting it each frame; null releases. */
  force(kind, elapsed = 2) {
    globalThis.__labForce = kind === null ? null : { kind, elapsed }
    globalThis.__animQuiet = false
    if (globalThis.__labLoop) return
    globalThis.__labLoop = true
    const INF = Number.POSITIVE_INFINITY
    const tick = () => {
      const f = globalThis.__labForce
      if (f) {
        const now = (performance.now() - rt().startTime) / 1000
        for (const id of lab.ids()) {
          const s = rt().seats.get(id)
          const a = s.animator
          s.acting = false; s.winner = false; s.loser = false; s.folded = false; s.peeking = false
          a.reactionSince = -INF; a.nextBigIdleAt = INF; a.nextPeekAt = INF; a.nextMicroAt = INF; a.peekStartedAt = -INF; a.microStartedAt = -INF
          a.bigIdleStartedAt = now - f.elapsed
          a.bigIdleKind = f.kind
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  },
  /** A/B helper: puts every trimmed garment back to flat colour (what avatars looked like before collar/cuff trim). */
  stripTrim(i) {
    const s = lab.seat(i)
    s.avatar.root.traverse(o => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : []
      for (const m of mats) {
        if (m.vertexColors && !/^(hair|red)$/i.test(m.name) && !m.userData.labStripped) {
          m.userData.labStripped = true
          m.vertexColors = false
          m.color.multiplyScalar(0.72)
          m.needsUpdate = true
        }
      }
    })
  },
  cam(i, kind = 'face', dist = 2.4) {
    const s = lab.seat(i)
    if (globalThis.__noTrim) lab.stripTrim(i)
    const head = s.avatar.bones.get('Head')
    const v = head.getWorldPosition(new head.position.constructor())
    const len = Math.hypot(v.x, v.z) || 1
    const dir = [-v.x / len, -v.z / len]
    let cam
    if (kind === 'back') cam = { position: [v.x - dir[0] * dist * 0.7 + dir[1] * dist * 0.35, v.y + 0.35, v.z - dir[1] * dist * 0.7 - dir[0] * dist * 0.35], lookAt: [v.x, v.y + 0.1, v.z], fov: 32 }
    else if (kind === 'top') cam = { position: [v.x + dir[0] * dist, v.y + 1.1, v.z + dir[1] * dist], lookAt: [v.x, v.y + 0.3, v.z], fov: 30 }
    else if (kind === 'side') cam = { position: [v.x - dir[1] * dist, v.y + 0.3, v.z + dir[0] * dist], lookAt: [v.x, v.y + 0.26, v.z], fov: 30 }
    else if (kind === 'wrist') {
      const w = s.avatar.bones.get('WristR'); const p = w.getWorldPosition(new w.position.constructor())
      cam = { position: [p.x + dir[0] * dist * 0.4, p.y + 0.5, p.z + dir[1] * dist * 0.4], lookAt: [p.x, p.y, p.z], fov: 30 }
    } else if (kind === 'upper') cam = { position: [v.x + dir[0] * dist * 1.1, v.y - 0.15, v.z + dir[1] * dist * 1.1], lookAt: [v.x, v.y - 0.6, v.z], fov: 38 }
    else if (kind === 'chest') cam = { position: [v.x + dir[0] * dist * 0.75, v.y - 0.05, v.z + dir[1] * dist * 0.75], lookAt: [v.x, v.y - 0.3, v.z], fov: 30 }
    else cam = { position: [v.x + dir[0] * dist, v.y + 0.3, v.z + dir[1] * dist], lookAt: [v.x, v.y + 0.26, v.z], fov: 30 }
    // The local player's first-person hands ride the camera: keep them out of close-ups.
    const fp = rt().firstPersonHands?.root
    if (fp && !fp.userData.labHidden) { fp.userData.labHidden = true; Object.defineProperty(fp, 'visible', { get: () => false, set() {} }) }
    rt().debugCamera = cam
    return cam
  },
}
return Object.keys(lab)
