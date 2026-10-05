import type { ThreeActionCue } from './tableViewModel'

/**
 * Social reactions: how a seated player responds to what the people around
 * them just did, beyond the per-seat states the animator already knows.
 *
 *   - eye contact and a nod toward the hero (the camera) when the hero acts,
 *     goes all-in or wins the pot, and a turn toward whoever just won
 *   - a gasp (hand over the mouth) and a head shake or nod at somebody else's
 *     all-in or big raise
 *   - sweating a run-out when all-in (hand at the mouth in bursts)
 *   - a bad beat (broadcast win odds collapse) or a hit out (they jump)
 *   - nervous tells that grow with the share of the stack at risk
 *   - a shrug on folding to a big bet
 *
 * Everything here is pure math: deterministic from the seat's seed, the clock
 * and the action keys (no shared state, no randomness), smoothly enveloped,
 * allocation-free per frame. The animator turns the resulting weights into
 * bone and hand targets (section 23 of computeAvatarTargetPose); the room fills
 * `AvatarSocialInput` (see avatarSocialFeed.ts). Purely expressive.
 */

/** What this seat can see of the table's social moment (filled by the room each frame). */
export interface AvatarSocialInput {
  /** 0..1 share of this player's stack committed to the hand (1 = all-in). */
  atRisk: number
  /** 0..1 how big the bet they are facing is (log of the call over the big blind). */
  facingBet: number
  allIn: boolean
  /** Broadcast win chance 0..100, or -1 when the table is not showing odds for them. */
  oddsWin: number
  /** This player's own last action cue and how long ago it started (seconds), with its id. */
  selfCue: ThreeActionCue
  selfCueAge: number
  selfKey: number
  /** The latest action by somebody else ('ready' = none recent). */
  actorCue: ThreeActionCue
  actorAge: number
  /** Unique id of that action (its start time in ms). */
  actorKey: number
  /** 0..1 how big that wager was. */
  actorWager: number
  /** The actor is the human at the camera: eye contact is with the viewer. */
  actorIsHero: boolean
  /** Seats between this player and the actor (1 = neighbour). */
  actorSteps: number
  /** Head yaw / pitch (radians, +pitch looks down) that points the face at the actor. */
  actorYaw: number
  actorPitch: number
  /** The hero is on the clock: the head bearing to the camera. */
  heroActing: boolean
  heroYaw: number
  heroPitch: number
  /** Somebody else just won the pot. */
  winnerAge: number
  winnerKey: number
  winnerIsHero: boolean
  winnerSteps: number
  winnerYaw: number
  winnerPitch: number
}

export function createAvatarSocialInput(): AvatarSocialInput {
  return {
    atRisk: 0,
    facingBet: 0,
    allIn: false,
    oddsWin: -1,
    selfCue: 'ready',
    selfCueAge: Number.POSITIVE_INFINITY,
    selfKey: 0,
    actorCue: 'ready',
    actorAge: Number.POSITIVE_INFINITY,
    actorKey: 0,
    actorWager: 0,
    actorIsHero: false,
    actorSteps: 4,
    actorYaw: 0,
    actorPitch: 0,
    heroActing: false,
    heroYaw: 0,
    heroPitch: 0,
    winnerAge: Number.POSITIVE_INFINITY,
    winnerKey: 0,
    winnerIsHero: false,
    winnerSteps: 4,
    winnerYaw: 0,
    winnerPitch: 0,
  }
}

/** What the animator tells this module about the seat this frame. */
export interface ReactionContext {
  time: number
  seed: number
  /** 1 normally, 0 for reduced motion (every weight is then zero). */
  motion: number
  /** Not acting, passed out, winning or owned by a prank / drink pose: reactions that may carry on into a loss. */
  beatFree: boolean
  /** Head-only reactions allowed (beatFree, and not mid action or mid showdown loss). */
  headFree: boolean
  /** Hands may leave the rail for a reaction too (not peeking, drinking, in a big idle ...). */
  handsFree: boolean
  folded: boolean
  acting: boolean
  /** Seconds since a showdown loss began (the bad-beat pose hands over to the loss reaction); Infinity when not a loser. */
  loserAge: number
  /** Seconds since the last community card landed. */
  boardAge: number
}

export function createReactionContext(): ReactionContext {
  return {
    time: 0,
    seed: 0,
    motion: 1,
    beatFree: true,
    headFree: true,
    handsFree: true,
    folded: false,
    acting: false,
    loserAge: Number.POSITIVE_INFINITY,
    boardAge: Number.POSITIVE_INFINITY,
  }
}

export interface ReactionWeights {
  /** 0..1 turn the face toward (lookYaw, lookPitch) and make eye contact. */
  look: number
  lookYaw: number
  lookPitch: number
  /** 0..1 a nod (head dips) and -1..1 a head shake (yaw swing). */
  nod: number
  shake: number
  /** 0..1 gasp: hand over the mouth, a flinch back. gaspSide +1 right hand, -1 left. */
  gasp: number
  gaspSide: 1 | -1
  /** 0..1 a hand at the mouth, leaning in: sweating a run-out. */
  sweat: number
  /** 0..1 hands on the head, leaning back in disbelief (odds collapsed). */
  badBeat: number
  /** 0..1 sagging in relief (the odds just swung their way). */
  relief: number
  /** 0..1 shoulders up, head tipped: folded to a big bet. */
  shrug: number
  /** 0..1 stack-at-risk jitters (fast drumming, tremor, tense shoulders). */
  nervous: number
  /** 0..1 finger drum burst (rate grows with `nervous`; see nervousDrumRate). */
  drum: number
  /** 0..1 a glance down at their own chips. */
  chipGlance: number
}

export function createReactionWeights(): ReactionWeights {
  return {
    look: 0,
    lookYaw: 0,
    lookPitch: 0,
    nod: 0,
    shake: 0,
    gasp: 0,
    gaspSide: 1,
    sweat: 0,
    badBeat: 0,
    relief: 0,
    shrug: 0,
    nervous: 0,
    drum: 0,
    chipGlance: 0,
  }
}

/** Per-seat memory (owned by the animator state): odds history and the moments reactions began. */
export interface ReactionState {
  weights: ReactionWeights
  ctx: ReactionContext
  oddsKnown: boolean
  /** Slow follower of the win chance: where the odds were a few seconds ago. */
  oddsEma: number
  lastTime: number
  badBeatAt: number
  reliefAt: number
  allInSince: number
  /** The fold being reacted to, and how big the bet it folded to was. */
  foldKey: number
  foldFacing: number
}

export function createReactionState(): ReactionState {
  return {
    weights: createReactionWeights(),
    ctx: createReactionContext(),
    oddsKnown: false,
    oddsEma: 0,
    lastTime: Number.NEGATIVE_INFINITY,
    badBeatAt: Number.NEGATIVE_INFINITY,
    reliefAt: Number.NEGATIVE_INFINITY,
    allInSince: Number.NEGATIVE_INFINITY,
    foldKey: Number.NaN,
    foldFacing: 0,
  }
}

/** How long after an action others still react to it. */
export const SOCIAL_ACTION_WINDOW_SECONDS = 3.2

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothStep(value: number) {
  const c = clamp01(value)
  return c * c * (3 - 2 * c)
}

/** Rises over `attack`, holds, then falls over `release` within `duration`. */
function envelope(elapsed: number, duration: number, attack: number, release: number) {
  if (elapsed < 0 || elapsed > duration) return 0
  return Math.min(smoothStep(elapsed / attack), smoothStep((duration - elapsed) / release))
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

/** Deterministic 0..1 from two numbers (an event id and a salt). */
export function hash01(a: number, b: number) {
  const x = Math.sin(a * 12.9898 + b * 78.233 + 0.5) * 43758.5453
  return x - Math.floor(x)
}

function isAggressive(cue: ThreeActionCue) {
  return cue === 'bet' || cue === 'raise' || cue === 'all_in'
}

/**
 * When the hero wins, a friendly table is more likely to applaud or nod than
 * to grumble. Takes the reaction kind the animator rolled (0 clap, 1 nod,
 * 2 look, 3 sour grapes, 4 shrug) and returns the kind to use.
 */
export function pickWinnerReaction(kind: number, social: AvatarSocialInput | undefined, seed: number): number {
  if (!social || !social.winnerIsHero) return kind
  const roll = hash01(social.winnerKey, seed * 97)
  if (roll < 0.45) return 0
  if (roll < 0.72) return 1
  return kind
}

/** Wrist-tap tempo (Hz) of a nervous player's drumming: the more at risk, the faster. */
export function nervousDrumRate(nervous: number) {
  return 3.5 + 4.5 * clamp01(nervous)
}

const TAU = Math.PI * 2

/**
 * Computes this frame's reaction weights into `rx.weights` (and returns them).
 * Call once per target rebuild; `ctx.time` is the animator clock.
 */
export function computeSocialReactions(rx: ReactionState, social: AvatarSocialInput, ctx: ReactionContext): ReactionWeights {
  const out = rx.weights
  out.look = 0
  out.lookYaw = 0
  out.lookPitch = 0
  out.nod = 0
  out.shake = 0
  out.gasp = 0
  out.sweat = 0
  out.badBeat = 0
  out.relief = 0
  out.shrug = 0
  out.nervous = 0
  out.drum = 0
  out.chipGlance = 0
  const { time, seed } = ctx
  const dt = Math.min(0.25, Math.max(0, time - rx.lastTime))
  const first = !Number.isFinite(rx.lastTime)
  rx.lastTime = time

  // Odds history is tracked even while the seat is busy, so a swing that lands
  // mid-gesture is never missed. Reduced motion keeps the memory but zero weights.
  trackOdds(rx, social.oddsWin, time, first ? 0 : dt)
  if (ctx.motion <= 0) return out
  const motion = ctx.motion

  // Latch the size of the bet a fold was made against (the table state moves on after it).
  if (social.selfCue === 'fold') {
    if (rx.foldKey !== social.selfKey) {
      rx.foldKey = social.selfKey
      rx.foldFacing = social.selfCueAge < 1 ? social.facingBet : 0
    }
  } else {
    rx.foldKey = Number.NaN
    rx.foldFacing = 0
  }

  if (social.allIn) {
    if (!Number.isFinite(rx.allInSince)) rx.allInSince = time
  } else {
    rx.allInSince = Number.NEGATIVE_INFINITY
  }

  const head = ctx.headFree
  const hands = ctx.handsFree && !ctx.folded

  // ---- who the face turns toward: the strongest of several attention pulls ----
  let lookW = 0
  let lookYaw = 0
  let lookPitch = 0
  if (head) {
    // (a) The hero is on the clock: everyone has half an eye on them, the head
    // pointed at the real bearing of the camera (not the coarse seat-step turn).
    if (social.heroActing && !ctx.acting) {
      const sway = 0.5 + 0.5 * Math.sin(time * 0.55 + seed * 11)
      const w = (0.5 + 0.25 * sway) * (ctx.folded ? 0.8 : 1)
      if (w > lookW) {
        lookW = w
        lookYaw = social.heroYaw
        lookPitch = social.heroPitch
      }
    }
    // (b) Somebody just acted: the hero's action draws everyone, an all-in or
    // a big raise draws most of the table (each seat by its own bias).
    const aggressive = isAggressive(social.actorCue)
    const heroDraw = social.actorIsHero && social.actorCue !== 'ready' && social.actorCue !== 'fold'
    if ((aggressive || heroDraw) && social.actorAge >= 0 && social.actorAge < SOCIAL_ACTION_WINDOW_SECONDS) {
      const attentive = hash01(social.actorKey, seed * 31 + 1) < (social.actorIsHero ? 0.9 : social.actorCue === 'all_in' ? 0.85 : 0.55)
      if (attentive) {
        const delay = 0.12 + 0.35 * hash01(social.actorKey, seed * 17 + 2)
        const strength = social.actorIsHero ? 0.9 : social.actorCue === 'all_in' ? 0.85 : 0.5 + 0.3 * social.actorWager
        const w = envelope(social.actorAge - delay, SOCIAL_ACTION_WINDOW_SECONDS - delay, 0.28, 0.8) * strength * (ctx.folded ? 0.8 : 1)
        if (w > lookW) {
          lookW = w
          lookYaw = social.actorYaw
          lookPitch = social.actorPitch
        }
      }
    }
    // (c) Somebody else scooped the pot: most of the table turns to them.
    if (social.winnerAge >= 0 && social.winnerAge < 3.6 && hash01(social.winnerKey, seed * 23 + 3) < 0.85) {
      const w = envelope(social.winnerAge - 0.2, 3.2, 0.4, 0.9) * (social.winnerIsHero ? 0.9 : 0.7)
      if (w > lookW) {
        lookW = w
        lookYaw = social.winnerYaw
        lookPitch = social.winnerPitch
      }
    }
  }
  out.look = lookW * motion
  out.lookYaw = lookYaw
  out.lookPitch = lookPitch

  // ---- a head gesture in answer to somebody's action: nod, or shake ----
  if (head && social.actorCue !== 'ready' && social.actorAge >= 0 && social.actorAge < SOCIAL_ACTION_WINDOW_SECONDS) {
    const cue = social.actorCue
    const hero = social.actorIsHero
    let pNod = 0
    let pShake = 0
    if (hero) {
      // An acknowledgement for whatever the hero did; a size-up for a big bet.
      if (cue === 'check' || cue === 'call') pNod = 0.28
      else if (isAggressive(cue)) {
        pNod = 0.42
        pShake = 0.2
      }
    } else if (isAggressive(cue) && social.actorWager >= 0.35) {
      pNod = 0.22
      pShake = 0.3
    }
    if (pNod + pShake > 0) {
      const roll = hash01(social.actorKey, seed * 41 + 4)
      const delay = 0.45 + 0.7 * hash01(social.actorKey, seed * 13 + 5)
      const t = social.actorAge - delay
      const size = 0.55 + 0.45 * (hero ? 1 : social.actorWager)
      if (roll < pNod && t >= 0 && t < 1.1) {
        // A slow double dip of the chin.
        out.nod = Math.max(0, Math.sin(clamp01(t / 1.05) * TAU)) * size * motion
      } else if (roll >= pNod && roll < pNod + pShake && t >= 0 && t < 1.5) {
        // "No way": a small decaying shake.
        const decay = Math.exp(-t * 1.6)
        out.shake = Math.sin(t * 11) * decay * smoothStep(t / 0.08) * size * motion
      }
    }
  }

  // ---- gasp at an all-in (any seat; the neighbours and the hero draw it more) ----
  if (social.actorCue === 'all_in' && social.actorAge >= 0 && social.actorAge < 3.0 && !ctx.acting && (head || ctx.folded)) {
    const near = social.actorIsHero ? 0.45 : social.actorSteps <= 1 ? 0.5 : social.actorSteps <= 2 ? 0.34 : 0.18
    if (hash01(social.actorKey, seed * 53 + 6) < near) {
      const delay = 0.2 + 0.35 * hash01(social.actorKey, seed * 7 + 7)
      out.gasp = envelope(social.actorAge - delay, 2.5, 0.3, 0.8) * motion
      out.gaspSide = hash01(social.actorKey, seed * 19 + 8) < 0.5 ? 1 : -1
    }
  }

  // ---- sweating a run-out: all-in with cards still to come ----
  if (social.allIn && hands && !ctx.acting && !ctx.folded) {
    const since = time - rx.allInSince
    const ramp = smoothStep((since - 1.3) / 0.9)
    // Bursts of a hand at the mouth (3s on of every ~5.4s, each seat on its own clock)...
    const burst = envelope(positiveModulo(time + seed * 7, 5.4), 3.2, 0.7, 0.8)
    // ...and a held breath as every community card lands.
    const reveal = envelope(ctx.boardAge, 2.6, 0.3, 0.8)
    out.sweat = Math.max(burst * 0.85, reveal) * ramp * motion
  }

  // ---- bad beat / hit out: the broadcast odds just swung hard ----
  if (ctx.beatFree) {
    const loserFade = Number.isFinite(ctx.loserAge) ? 1 - smoothStep(ctx.loserAge / 0.6) : 1
    out.badBeat = envelope(time - rx.badBeatAt, 4.2, 0.35, 0.9) * loserFade * motion
    out.relief = envelope(time - rx.reliefAt, 2.4, 0.3, 0.8) * motion
  }

  // ---- fold to a big bet: a shrug ----
  if (ctx.folded && ctx.beatFree && social.selfCue === 'fold' && rx.foldFacing > 0.45) {
    const gate = hash01(social.selfKey, seed * 29 + 9) < 0.75 ? 1 : 0
    out.shrug = envelope(social.selfCueAge - 0.55, 1.9, 0.3, 0.6) * smoothStep((rx.foldFacing - 0.4) / 0.35) * gate * motion
  }

  // ---- nervous tells: grow with the share of the stack at risk ----
  if (head && hands && !ctx.acting && social.atRisk > 0.15) {
    const nervous = smoothStep((social.atRisk - 0.15) / 0.6)
    out.nervous = nervous * motion
    // Drumming comes in bursts (never a constant buzz), longer and more often as the risk grows.
    const burst = smoothStep((Math.sin(time * 0.8 + seed * 9) + 0.3 - 0.5 * nervous) / 0.5)
    out.drum = nervous * burst * motion
    // A glance down at the chips every few seconds; faster the more is at stake.
    const period = 5 - 2.8 * nervous
    out.chipGlance = envelope(positiveModulo(time + seed * 3.1, period), 0.95, 0.2, 0.3) * nervous * motion
  }
  return out
}

/** Odds history: the slow follower and the bad-beat / hit-out detectors (a 35+ point swing in a few seconds). */
function trackOdds(rx: ReactionState, odds: number, time: number, dt: number) {
  if (!(odds >= 0)) {
    rx.oddsKnown = false
    return
  }
  if (!rx.oddsKnown) {
    rx.oddsKnown = true
    rx.oddsEma = odds
    return
  }
  rx.oddsEma += (odds - rx.oddsEma) * (1 - Math.exp(-dt / 3))
  const swing = rx.oddsEma - odds
  if (odds <= 22 && swing >= 35 && time - rx.badBeatAt > 6) {
    rx.badBeatAt = time
    rx.oddsEma = odds
  } else if (odds >= 60 && swing <= -35 && time - rx.reliefAt > 6) {
    rx.reliefAt = time
    rx.oddsEma = odds
  }
}
