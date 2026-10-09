import { afterEach, describe, it, vi } from 'vitest'
import type { Connection } from 'partykit/server'
import { AUTO_FOLD_GRACE_MS } from '@/partykit/room'
import { isBettingClosed, toTableState } from '@/lib/poker/engine'
import { calculateMinRaise } from '@/lib/poker/betting'
import type { Card, HandHistoryEntry, InternalGameState, InternalPlayer } from '@/lib/poker/types'
import type { LedgerSnapshot } from '@/lib/poker/ledger'
import { createThreeTableViewModel } from '@/components/three/tableViewModel'
import { createHarness, disconnect, joinPlayer, lastMessage, send } from './helpers/roomHarness'
import { bestReferenceHand, cardKey, compareReference, scoreFive, type ReferenceScore } from './helpers/bruteForceHand'

type ProcessAction = typeof import('@/lib/poker/engine').processAction
type ActionArgs = Parameters<ProcessAction>

/**
 * Every player action the room sends to the engine (humans, bots, timeouts,
 * host chip changes) passes through this audit hook, which judges it against
 * an independent model of the No-Limit betting rules.
 */
const actionAudit = vi.hoisted(() => ({
  hook: null as null | ((original: ProcessAction, ...args: ActionArgs) => ReturnType<ProcessAction>),
}))

vi.mock('@/lib/poker/engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/poker/engine')>()
  return {
    ...actual,
    processAction: (...args: ActionArgs) => (
      actionAudit.hook ? actionAudit.hook(actual.processAction, ...args) : actual.processAction(...args)
    ),
  }
})

/**
 * Fuzz: thousands of random hands through the real PokerRoom (fake timers,
 * seeded RNG) with all-ins, timeouts, disconnects, sit-outs, rebuys, run it
 * twice, host chip changes, spectating, kicks and leaves. Every hand is checked
 * against an independent brute-force evaluator and independent side pots.
 *
 * Reproduce a failure: FUZZ_SEED=<seed> FUZZ_HANDS=<n> npx vitest run tests/room-fuzz.test.ts
 */

const DEFAULT_SEEDS = [20261008, 7, 424242, 31337]
const HANDS_PER_SEED = Number(process.env.FUZZ_HANDS ?? 250)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface FuzzInternals {
  data: {
    gameState: InternalGameState
    hostId: string | null
    handHistory: HandHistoryEntry[]
    spectatorIds: Record<string, true>
    spectatorStacks: Record<string, number>
    pendingRemovals: Record<string, true>
    membership: { dealtIn: string[] }
  }
  autoFoldDeadline: number | null
  autoFoldPlayerId: string | null
  buildLedgerSnapshot: () => LedgerSnapshot
  recordCompletedHandStats: () => void
  recordDealtIn: () => void
}

interface Human {
  name: string
  conn: Connection | null
  token: string
  playerId: string
}

interface EndedHand {
  state: InternalGameState
  dealtIn: string[]
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const LIVE = new Set(['active', 'all_in'])

/** Independent side pots: slice by every contribution level, live players with enough in share a slice. */
function referencePots(players: InternalPlayer[]): Array<{ amount: number; eligible: string[] }> {
  const levels = Array.from(new Set(players.map(player => player.totalInPot).filter(amount => amount > 0))).sort((a, b) => a - b)
  const pots: Array<{ amount: number; eligible: string[] }> = []
  let previous = 0
  for (const level of levels) {
    const amount = players.reduce((sum, player) => sum + Math.max(0, Math.min(player.totalInPot, level) - Math.min(player.totalInPot, previous)), 0)
    const eligible = players
      .filter(player => player.status !== 'folded' && player.holeCards.length === 2 && player.totalInPot >= level)
      .map(player => player.id)
    const previousPot = pots[pots.length - 1]
    if (eligible.length === 0 && previousPot) {
      previousPot.amount += amount
    } else if (previousPot && previousPot.eligible.join() === eligible.join()) {
      // Same contenders: one pot (odd chips are split once per pot).
      previousPot.amount += amount
    } else if (amount > 0) {
      pots.push({ amount, eligible })
    }
    previous = level
  }
  return pots
}

function bestOf(player: InternalPlayer, board: Card[]): ReferenceScore {
  return bestReferenceHand([...player.holeCards, ...board])
}

describe('fuzz: random hands through the real room', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const seeds = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : DEFAULT_SEEDS
  for (const seed of seeds) {
    // Big runs (FUZZ_HANDS=20000) take roughly 50 ms a hand.
    it(`keeps every hand correct (seed ${seed})`, { timeout: Math.max(600_000, HANDS_PER_SEED * 200) }, () => {
      const summary = runFuzz(seed, HANDS_PER_SEED)
      console.log(`[fuzz] seed=${seed} ${JSON.stringify(summary)}`)
    })
  }
})

function runFuzz(seed: number, targetHands: number) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T20:00:00.000Z'))
  const rng = mulberry32(seed)
  vi.spyOn(Math, 'random').mockImplementation(rng)
  const rand = () => rng()
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  const chance = (p: number) => rand() < p

  const summary = {
    hands: 0, showdowns: 0, foldWins: 0, runItTwice: 0, sidePotHands: 0, timeouts: 0, timeoutChecks: 0, tables: 0, steps: 0,
    raises: 0, shortAllIns: 0, closedToRaise: 0, illegalRejected: 0,
  }

  while (summary.hands < targetHands) {
    summary.tables += 1
    runTable(summary.tables)
  }
  return summary

  function runTable(tableNumber: number) {
    const harness = createHarness()
    const { room, server } = harness
    const srv = server as unknown as FuzzInternals
    // Snapshots are rebuilt from server state by the checks; skip parsing them per socket.
    const addConnection = room.addConnection.bind(room)
    room.addConnection = (id: string) => {
      const connection = addConnection(id)
      const mock = connection as unknown as { send: (message: string) => void }
      const original = mock.send.bind(mock)
      mock.send = (message: string) => {
        if (message.startsWith('{"type":"room_snapshot"') || message.startsWith('{"type":"social_snapshot"')) return
        original(message)
      }
      return connection
    }
    const humans: Human[] = []
    let lastOp = ''
    const op = (conn: Connection, message: Parameters<typeof send>[2]) => {
      const sender = humans.find(human => human.conn === conn)?.name ?? '?'
      lastOp = `${sender}: ${JSON.stringify(message)}`
      send(server, conn, message)
    }
    const fail = (message: string): never => {
      const state = srv.data.gameState
      throw new Error(`[fuzz seed=${seed} table=${tableNumber} hand=${state.handNumber} phase=${state.phase} round=${state.round}] ${message}`)
    }

    /** Independent street model: bet to match, last full raise, and the bet each player last answered. */
    let street: { key: string; currentBet: number; fullRaise: number; actedAt: Map<string, number> } | null = null
    // The room swallows engine errors, so a rules violation is parked here and raised by checkStep.
    let auditFailure: string | null = null
    const auditFail = (message: string): never => {
      auditFailure ??= `${message} (last op ${lastOp})`
      throw new Error(message)
    }
    actionAudit.hook = (original, state, playerId, action, amount) => {
      const key = `${state.handNumber}:${state.round}`
      if (!street || street.key !== key) {
        street = { key, currentBet: state.round === 'preflop' ? state.bigBlind : 0, fullRaise: state.bigBlind, actedAt: new Map() }
      }
      const model = street
      const player = state.players.find(candidate => candidate.id === playerId)
      const isTurn = state.phase === 'in_hand' && state.actingPlayerId === playerId && player?.status === 'active'
      if (isTurn && state.currentBet !== model.currentBet) {
        auditFail(`engine bet to match is ${state.currentBet}, the rules model says ${model.currentBet}`)
      }
      const maxTotal = player ? player.stack + player.bet : 0
      const othersCanAnswer = state.players.some(other => other.id !== playerId && other.status === 'active' && other.stack > 0)
      const answered = model.actedAt.get(playerId)
      const reopened = answered === undefined || model.currentBet - answered >= model.fullRaise
      const mayRaise = isTurn && maxTotal > model.currentBet && othersCanAnswer && reopened
      if (isTurn && maxTotal > model.currentBet && !mayRaise) summary.closedToRaise += 1

      let after: InternalGameState
      try {
        after = original(state, playerId, action, amount)
      } catch (error) {
        if (isTurn) {
          const toCall = model.currentBet - player!.bet
          const legalRaise = action === 'raise' && mayRaise && Number.isInteger(amount) &&
            amount! >= model.currentBet + model.fullRaise && amount! <= maxTotal
          const legal = action === 'fold' || action === 'call' || (action === 'check' && toCall <= 0) || legalRaise ||
            (action === 'all_in' && (maxTotal <= model.currentBet || mayRaise))
          if (legal) auditFail(`legal ${action}${amount !== undefined ? ` ${amount}` : ''} by ${player!.nickname} was rejected: ${(error as Error).message}`)
          summary.illegalRejected += 1
        }
        throw error
      }

      const playerAfter = after.players.find(candidate => candidate.id === playerId)!
      // Betting goes on in the same street only while someone holds the action
      // (a paced all-in runout or a run-it-twice vote keeps the round name but closes it).
      const sameStreet = after.phase === 'in_hand' && after.handNumber === state.handNumber &&
        after.round === state.round && after.actingPlayerId !== null
      const newBet = sameStreet
        ? playerAfter.bet
        : action === 'fold' || action === 'check' ? player!.bet : Math.min(maxTotal, model.currentBet)
      if (!sameStreet && (action === 'raise' || action === 'all_in') && maxTotal > model.currentBet && playerAfter.status !== 'folded') {
        auditFail(`${player!.nickname}'s raise closed the street with nobody left to answer it`)
      }
      if (newBet > model.currentBet) {
        const raiseBy = newBet - model.currentBet
        if (!mayRaise) {
          auditFail(`${player!.nickname} raised to ${newBet} although betting was not reopened to them (answered ${answered}, bet ${model.currentBet}, full raise ${model.fullRaise})`)
        }
        if (raiseBy < model.fullRaise && playerAfter.stack > 0) {
          auditFail(`${player!.nickname} raised by ${raiseBy}, less than the minimum ${model.fullRaise}, without being all-in`)
        }
        summary.raises += 1
        if (raiseBy >= model.fullRaise) model.fullRaise = raiseBy
        else summary.shortAllIns += 1
        model.currentBet = newBet
      }
      if (playerAfter.status !== 'folded') model.actedAt.set(playerId, model.currentBet)
      if (sameStreet && after.currentBet !== model.currentBet) {
        auditFail(`after ${player!.nickname}'s ${action} the engine bet is ${after.currentBet}, the rules model says ${model.currentBet}`)
      }
      return after
    }

    const ended = new Map<number, EndedHand>()
    const toValidate: number[] = []
    const historyChecks: number[] = []
    let dealtIn: string[] = []
    let track: { handNumber: number; statuses: Map<string, string> } | null = null
    /** What the current step did, to attribute any fold it caused. */
    let opKind = 'other'
    /** Per hand: why each player folded, as the harness caused it. */
    const expectedExits = new Map<number, Map<string, string>>()

    const originalRecord = srv.recordCompletedHandStats.bind(srv)
    srv.recordCompletedHandStats = () => {
      const state = srv.data.gameState
      if (state.phase === 'between_hands' && state.winners?.length && !ended.has(state.handNumber)) {
        ended.set(state.handNumber, { state: clone(state), dealtIn: [...dealtIn] })
        toValidate.push(state.handNumber)
      }
      originalRecord()
    }
    const originalDealt = srv.recordDealtIn.bind(srv)
    srv.recordDealtIn = () => {
      // The previous hand may have ended in this same step: judge its last transitions first.
      if (track) {
        const previous = ended.get(track.handNumber)
        if (previous) checkTransitions(track, previous.state.players)
      }
      originalDealt()
      const state = srv.data.gameState
      dealtIn = state.players.filter(player => player.holeCards.length === 2).map(player => player.id)
      checkBlinds(state)
      track = { handNumber: state.handNumber, statuses: new Map(state.players.filter(p => p.holeCards.length === 2).map(p => [p.id, p.status])) }
    }

    let previousBlinds: { handNumber: number; bbSeat: number; dealt: number } | null = null
    /** Button and blinds: one big blind, never a double blind, heads-up button = small blind, the big blind moves one seat at a time. */
    function checkBlinds(state: InternalGameState) {
      const dealt = state.players.filter(player => player.holeCards.length === 2)
      const sbs = state.players.filter(player => player.isSB)
      const bbs = state.players.filter(player => player.isBB)
      const dealer = state.players.filter(player => player.isDealer)
      if (bbs.length !== 1) fail(`${bbs.length} big blinds posted`)
      if (sbs.length > 1) fail(`${sbs.length} small blinds posted`)
      if (dealer.length !== 1 || dealer[0]!.seatIndex !== state.dealerSeatIndex) fail('the button is not on exactly one dealt-in player')
      if (state.players.some(player => player.isSB && player.isBB)) fail('a player posted both blinds')
      for (const blind of [...sbs, ...bbs, ...dealer]) {
        if (blind.holeCards.length !== 2) fail(`${blind.nickname} holds a blind or the button without being dealt in`)
      }
      const bb = bbs[0]!
      if (dealt.length === 2) {
        if (sbs.length !== 1 || !sbs[0]!.isDealer) fail('heads-up the button must post the small blind')
      } else if (sbs[0]?.isDealer) {
        fail('the button posted the small blind with more than two players')
      }
      // Preflop action starts left of the big blind with the first player able to act.
      const preflopOrder = (player: InternalPlayer) => (player.seatIndex - bb.seatIndex + 8) % 8
      const canAct = dealt.filter(player => player.status === 'active' && player.stack > 0 && player.id !== bb.id)
      if (state.phase === 'in_hand' && state.actingPlayerId && canAct.length > 0) {
        const first = [...canAct].sort((a, b) => preflopOrder(a) - preflopOrder(b))[0]!
        if (state.actingPlayerId !== first.id) {
          fail(`preflop action starts with ${state.players.find(p => p.id === state.actingPlayerId)?.nickname}, not ${first.nickname} left of the big blind`)
        }
      }
      if (previousBlinds && previousBlinds.handNumber === state.handNumber - 1 && previousBlinds.dealt >= 2) {
        if (bb.seatIndex === previousBlinds.bbSeat) fail(`${bb.nickname} posted the big blind two hands in a row`)
        // Nobody dealt in sits between last hand's big blind and this one: no one skipped it.
        const lastBb = previousBlinds.bbSeat
        const gap = (bb.seatIndex - lastBb + 8) % 8
        const skipped = dealt.find(player => {
          const offset = (player.seatIndex - lastBb + 8) % 8
          return offset > 0 && offset < gap
        })
        if (skipped) fail(`${skipped.nickname} skipped the big blind (it moved from seat ${lastBb} to ${bb.seatIndex})`)
      }
      previousBlinds = { handNumber: state.handNumber, bbSeat: bb.seatIndex, dealt: dealt.length }
    }

    let connCounter = 0
    const playerCount = 2 + Math.floor(rand() * 7)
    const names = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].slice(0, playerCount)
    for (const name of names) {
      connCounter += 1
      const joined = joinPlayer(server, room, `t${tableNumber}-c${connCounter}`, name)
      humans.push({ name, conn: joined.connection, token: joined.reconnectToken, playerId: joined.playerId })
      op(joined.connection, { type: 'seat_me' })
    }
    const hostHuman = () => humans.find(human => human.conn && human.playerId === srv.data.hostId) ?? null
    if (playerCount < 8 && chance(0.3)) {
      op(humans[0]!.conn!, { type: 'add_bots', count: 1 + Math.floor(rand() * Math.min(2, 8 - playerCount)) })
    }
    const handsHere = 40 + Math.floor(rand() * 80)
    const startHands = summary.hands
    op(humans[0]!.conn!, { type: 'start_game' })

    const humanById = (id: string | null | undefined) => humans.find(human => human.playerId === id)
    const getPlayer = (id: string) => srv.data.gameState.players.find(player => player.id === id)

    let idleSteps = 0
    let lastHandSeen = srv.data.gameState.handNumber
    for (let step = 0; summary.hands - startHands < handsHere && step < handsHere * 120; step += 1) {
      summary.steps += 1
      const state = srv.data.gameState
      const actor = state.phase === 'in_hand' && state.actingPlayerId ? getPlayer(state.actingPlayerId) : undefined
      const actorHuman = actor ? humanById(actor.id) : undefined
      const voting = state.runItTwice?.status === 'voting' ? state.runItTwice : null
      opKind = 'other'

      if (voting && chance(0.6)) {
        opKind = 'vote'
        const voter = humans.find(human => human.conn && voting.eligiblePlayerIds.includes(human.playerId) && !voting.votes[human.playerId])
        if (voter) op(voter.conn!, { type: 'run_it_twice_vote', vote: chance(0.65) ? 'yes' : 'no' })
        else {
          opKind = 'advance'
          vi.advanceTimersByTime(1_000 + Math.floor(rand() * 4_000))
        }
      } else if (actor && actorHuman?.conn && chance(0.8)) {
        opKind = `action:${actor.id}`
        playRandomAction(actor, actorHuman.conn)
      } else if (actor && actorHuman && chance(0.25)) {
        opKind = 'timeout'
        runTimeout(actor)
      } else {
        randomMembershipOp()
      }

      checkStep()
      while (toValidate.length > 0) {
        const handNumber = toValidate.shift()!
        validateEndedHand(handNumber)
        historyChecks.push(handNumber)
        summary.hands += 1
      }
      for (const handNumber of historyChecks.splice(0)) validateHistory(handNumber)

      if (srv.data.gameState.handNumber !== lastHandSeen) {
        lastHandSeen = srv.data.gameState.handNumber
        idleSteps = 0
      } else {
        idleSteps += 1
      }
      if (idleSteps > 0 && idleSteps % 60 === 0) {
        opKind = 'recover'
        recoverTable()
        checkStep()
      }
      if (idleSteps > 400) {
        const st = srv.data.gameState
        fail(`no hand progress for 400 steps (stalled table): host ${srv.data.hostId} players ${JSON.stringify(st.players.map(p => [p.nickname, p.id, p.status, p.stack, p.isConnected]))} humans ${JSON.stringify(humans.map(h => [h.name, h.playerId, Boolean(h.conn)]))} away ${JSON.stringify((srv.data.membership as unknown as { awayIds: unknown }).awayIds)} spect ${JSON.stringify(srv.data.spectatorIds)} stacks ${JSON.stringify(srv.data.spectatorStacks)} pendingSpect ${JSON.stringify((srv.data as unknown as { pendingSpectators: unknown }).pendingSpectators)} failures ${JSON.stringify(humans.filter(h => h.conn).map(h => [h.name, lastMessage(h.conn!, 'action_failed')?.message, lastMessage(h.conn!, 'session_ended')?.message]))}`)
      }
    }

    for (const human of humans) {
      if (human.conn) disconnect(server, room, human.conn)
    }
    vi.clearAllTimers()
    actionAudit.hook = null

    // -------------------------------------------------------------------------

    /** Liveness, not a check: bring everyone back so the table keeps dealing. */
    function recoverTable() {
      for (const human of humans) {
        if (!human.conn) {
          connCounter += 1
          const joined = joinPlayer(server, room, `t${tableNumber}-c${connCounter}`, human.name, human.token)
          if (!joined.playerId) continue
          human.conn = joined.connection
          human.token = joined.reconnectToken
          human.playerId = joined.playerId
        }
        op(human.conn, { type: 'set_sitting_out', sittingOut: false })
        if (!getPlayer(human.playerId)) {
          if ((srv.data.spectatorStacks[human.playerId] ?? 1) <= 0) op(human.conn, { type: 'rebuy' })
          op(human.conn, { type: 'seat_me' })
        }
      }
      const host = hostHuman()
      if (host) op(host.conn!, { type: 'start_game' })
    }

    function playRandomAction(player: InternalPlayer, conn: Connection) {
      const state = srv.data.gameState
      const toCall = state.currentBet - player.bet
      const minRaise = calculateMinRaise(state.currentBet, state.lastRaiseSize, state.bigBlind)
      const maxTotal = player.stack + player.bet
      const roll = rand()
      if (roll < 0.1) {
        op(conn, { type: 'player_action', action: 'fold' })
      } else if (roll < 0.5) {
        op(conn, { type: 'player_action', action: toCall > 0 ? 'call' : 'check' })
      } else if (roll < 0.62) {
        op(conn, { type: 'player_action', action: 'raise', amount: Math.min(minRaise, maxTotal) })
      } else if (roll < 0.7) {
        const amount = minRaise + Math.floor(rand() * Math.max(1, maxTotal - minRaise))
        op(conn, { type: 'player_action', action: 'raise', amount: Math.min(amount, maxTotal) })
      } else if (roll < 0.76) {
        // The slider's max: a raise for the whole stack (often an incomplete raise or a call for less).
        op(conn, { type: 'player_action', action: 'raise', amount: maxTotal })
      } else if (roll < 0.84) {
        op(conn, { type: 'player_action', action: 'all_in' })
      } else if (roll < 0.9) {
        // Illegal tries must be rejected without side effects.
        op(conn, toCall > 0
          ? { type: 'player_action', action: 'check' }
          : { type: 'player_action', action: 'raise', amount: Math.max(1, state.currentBet + 1) })
      } else {
        op(conn, { type: 'player_action', action: 'call' })
      }
    }

    function runTimeout(player: InternalPlayer) {
      const state = srv.data.gameState
      const deadline = srv.autoFoldDeadline
      if (!deadline || srv.autoFoldPlayerId !== player.id) {
        vi.advanceTimersByTime(500)
        return
      }
      const canCheck = player.bet >= state.currentBet
      const handNumber = state.handNumber
      vi.advanceTimersByTime(Math.max(0, deadline + AUTO_FOLD_GRACE_MS - Date.now()) + 5)
      summary.timeouts += 1
      // Once the hand is over, post-hand bookkeeping may relabel seats: judge the end snapshot.
      const endState = ended.get(handNumber)?.state
      const after = (endState ?? srv.data.gameState).players.find(candidate => candidate.id === player.id)
      const sameHand = srv.data.gameState.handNumber === handNumber || Boolean(endState)
      if (!after || !sameHand) return
      if (canCheck) {
        summary.timeoutChecks += 1
        if (after.status === 'folded') fail(`${player.nickname} timed out with a free check and was folded`)
      } else if (after.status !== 'folded') {
        fail(`${player.nickname} timed out facing a bet but was not folded (status ${after.status})`)
      }
    }

    function randomMembershipOp() {
      const state = srv.data.gameState
      const human = pick(humans)
      const host = hostHuman()
      const roll = rand()
      if (roll < 0.3) {
        opKind = 'advance'
        vi.advanceTimersByTime(300 + Math.floor(rand() * 4_000))
      } else if (roll < 0.36) {
        if (human.conn) {
          disconnect(server, room, human.conn)
          human.conn = null
        }
      } else if (roll < 0.46) {
        if (!human.conn) {
          connCounter += 1
          const joined = joinPlayer(server, room, `t${tableNumber}-c${connCounter}`, human.name, chance(0.7) ? human.token : undefined)
          if (joined.playerId) {
            human.conn = joined.connection
            human.token = joined.reconnectToken
            human.playerId = joined.playerId
          }
        }
      } else if (roll < 0.49) {
        if (human.conn) op(human.conn, { type: 'set_sitting_out', sittingOut: true })
      } else if (roll < 0.56) {
        if (human.conn) op(human.conn, { type: 'set_sitting_out', sittingOut: false })
      } else if (roll < 0.6) {
        if (human.conn) op(human.conn, { type: 'rebuy' })
      } else if (roll < 0.64) {
        if (host) {
          const target = pick(state.players)
          if (target) {
            const amount = chance(0.5) ? -(1 + Math.floor(rand() * 400)) : 1 + Math.floor(rand() * 600)
            op(host.conn!, { type: 'adjust_player_stack', targetId: target.id, amount })
          }
        }
      } else if (roll < 0.66) {
        if (host && human.playerId !== host.playerId) {
          opKind = `spectate:${human.playerId}`
          op(host.conn!, { type: 'set_player_spectator', targetId: human.playerId, spectator: chance(0.6) })
        }
      } else if (roll < 0.68) {
        if (human.conn) op(human.conn, { type: 'set_player_spectator', targetId: human.playerId, spectator: chance(0.6) })
      } else if (roll < 0.75) {
        if (human.conn && !getPlayer(human.playerId)) {
          if ((srv.data.spectatorStacks[human.playerId] ?? 1) <= 0) op(human.conn, { type: 'rebuy' })
          op(human.conn, { type: 'seat_me' })
        }
      } else if (roll < 0.765) {
        if (host && human.conn && human.playerId !== host.playerId) {
          opKind = `kick:${human.playerId}`
          op(host.conn!, { type: 'remove_player', targetId: human.playerId })
          disconnect(server, room, human.conn)
          human.conn = null
        }
      } else if (roll < 0.785) {
        if (human.conn) {
          opKind = `leave:${human.playerId}`
          op(human.conn, { type: 'leave_room' })
          disconnect(server, room, human.conn)
          human.conn = null
        }
      } else if (roll < 0.85) {
        if (human.conn) op(human.conn, { type: 'set_show_cards', mode: pick(['both', 'left', 'right', 'none'] as const) })
      } else if (roll < 0.87) {
        if (human.conn) op(human.conn, { type: 'rabbit_hunt' })
      } else if (roll < 0.9) {
        if (host) op(host.conn!, { type: 'start_game' })
      } else {
        opKind = 'advance'
        vi.advanceTimersByTime(1_000 + Math.floor(rand() * 12_000))
      }
    }

    /**
     * Status may only go active -> all_in / folded (all_in and folded are final),
     * and every fold must come from something that is allowed to fold a hand.
     */
    function checkTransitions(current: { handNumber: number; statuses: Map<string, string> }, players: InternalPlayer[]) {
      for (const [id, before] of current.statuses) {
        const player = players.find(candidate => candidate.id === id)
        if (!player) fail(`dealt-in player ${id} vanished from the table mid-hand`)
        const now = player!.status
        const ok = before === now ||
          (before === 'active' && (now === 'all_in' || now === 'folded'))
        if (!ok) fail(`${player!.nickname} went ${before} -> ${now} mid-hand (last op ${lastOp})`)
        if (player!.holeCards.length !== 2) fail(`${player!.nickname} lost their hole cards mid-hand`)
        if (before === 'active' && now === 'folded') {
          const isBot = Boolean(player!.isBot) || id.startsWith('bot_')
          let reason: string | null = null
          if (opKind === `action:${id}`) reason = 'fold'
          else if (opKind === 'timeout' || opKind === 'advance') reason = isBot ? 'fold' : 'timeout'
          else if (opKind === `leave:${id}`) reason = 'left'
          else if (opKind === `kick:${id}`) reason = 'kicked'
          else if (opKind === `spectate:${id}`) reason = 'moved_to_rail'
          if (!reason) fail(`${player!.nickname} was folded by an action that must never fold a hand: ${opKind} (${lastOp})`)
          if (!expectedExits.has(current.handNumber)) expectedExits.set(current.handNumber, new Map())
          expectedExits.get(current.handNumber)!.set(id, reason!)
        }
        current.statuses.set(id, now)
      }
    }

    function checkStep() {
      const state = srv.data.gameState
      if (auditFailure) fail(`rules audit: ${auditFailure}`)
      if (track) {
        const endedTrack = ended.get(track.handNumber)
        if (endedTrack) {
          checkTransitions(track, endedTrack.state.players)
          track = null
        }
      }
      const ledger = srv.buildLedgerSnapshot()
      if (ledger.totalChips !== ledger.totalBoughtIn) {
        fail(`chips not conserved: ${ledger.totalChips} on the books vs ${ledger.totalBoughtIn} bought in; last op ${lastOp}; rows ${JSON.stringify(ledger.rows.map(row => [row.name, row.where, row.boughtIn, row.chips]))}; players ${JSON.stringify(state.players.map(p => [p.nickname, p.status, p.stack, p.totalInPot]))} spectators ${JSON.stringify(srv.data.spectatorStacks)} actions ${JSON.stringify(state.recentActions.slice(0, 14))}`)
      }
      for (const player of state.players) {
        if (player.stack < 0 || player.totalInPot < 0 || player.bet < 0) fail(`${player.nickname} has negative chips`)
      }

      if (state.phase === 'in_hand') {
        if (state.actingPlayerId) {
          const actor = state.players[state.actingPlayerIndex]
          if (!actor || actor.id !== state.actingPlayerId) fail('acting index and id disagree')
          if (actor.status !== 'active' || actor.stack <= 0) fail(`acting player ${actor.nickname} cannot act (${actor.status}, stack ${actor.stack})`)
        } else if (!state.allInRunout && state.runItTwice?.status !== 'voting') {
          fail('hand stalled: nobody to act, no runout, no vote')
        }

        if (track && track.handNumber === state.handNumber) checkTransitions(track, state.players)

        // Nobody else's cards are public mid-hand, except tabled hands once betting is closed.
        const publicView = toTableState(state, '')
        const tabled = isBettingClosed(state)
        for (const seat of publicView.players) {
          const internal = state.players.find(candidate => candidate.id === seat.id)!
          const visible = (seat.holeCards?.length ?? 0) > 0
          const allowed = tabled && LIVE.has(internal.status) && internal.holeCards.length === 2
          if (visible && !allowed) fail(`${seat.nickname}'s cards are public mid-hand`)
        }
      }

      if (state.phase === 'between_hands' && state.winners?.length) {
        const endedHand = ended.get(state.handNumber)
        if (!endedHand) fail('hand ended without being recorded (stats / history skipped)')
        // Revealed = showdown participants (never folded) plus voluntary shows.
        const publicView = toTableState(state, '')
        const showdown = state.round === 'showdown'
        for (const seat of publicView.players) {
          const internal = state.players.find(candidate => candidate.id === seat.id)!
          const atEnd = endedHand!.state.players.find(candidate => candidate.id === seat.id)
          const visibleCount = seat.holeCards?.length ?? 0
          const participant = showdown && Boolean(atEnd) && atEnd!.status !== 'folded' && atEnd!.holeCards.length === 2
          const expected = internal.holeCards.length === 0
            ? 0
            : participant || internal.showCards === 'both'
              ? 2
              : internal.showCards === 'left' || internal.showCards === 'right' ? 1 : 0
          if (visibleCount !== expected) {
            fail(`${seat.nickname} shows ${visibleCount} cards after the hand, expected ${expected} (status at end ${atEnd?.status}, showCards ${internal.showCards})`)
          }
        }
      }
    }

    function validateEndedHand(handNumber: number) {
      const { state } = ended.get(handNumber)!
      const failHand = (message: string): never => {
        throw new Error(`[fuzz seed=${seed} table=${tableNumber} hand=${handNumber}] ${message}\nboard=${state.communityCards.map(cardKey).join(' ')} players=${state.players.map(p => `${p.nickname}:${p.status}:${p.holeCards.map(cardKey).join('')}:in${p.totalInPot}`).join(', ')} winners=${JSON.stringify(state.winners)} actions=${JSON.stringify(state.recentActions.slice(0, 12))}`)
      }
      const dealt = state.players.filter(player => player.holeCards.length === 2)
      const live = dealt.filter(player => player.status !== 'folded')
      for (const player of dealt) {
        if (!['active', 'all_in', 'folded'].includes(player.status)) failHand(`${player.nickname} ended the hand as ${player.status}`)
      }

      // Every card is unique.
      const runBoards = state.runItTwice?.status === 'accepted' ? (state.runItTwice.boards ?? []).map(board => board.cards) : []
      const shared = state.runItTwice?.sharedCardCount ?? 0
      const allCards = [
        ...dealt.flatMap(player => player.holeCards),
        ...(runBoards.length ? [...runBoards[0]!, ...runBoards[1]!.slice(shared)] : state.communityCards),
        ...(state.rabbitCards ?? []),
      ].map(cardKey)
      if (new Set(allCards).size !== allCards.length) failHand('a card was dealt twice')

      const winners = state.winners ?? []
      const totals = new Map<string, number>()
      for (const winner of winners) totals.set(winner.playerId, (totals.get(winner.playerId) ?? 0) + winner.amount)
      const pot = state.players.reduce((sum, player) => sum + player.totalInPot, 0)
      const paid = [...totals.values()].reduce((sum, amount) => sum + amount, 0)
      if (paid !== pot) failHand(`paid ${paid} of a ${pot} pot`)
      for (const id of totals.keys()) {
        const player = state.players.find(candidate => candidate.id === id)
        if (!player || player.status === 'folded' || player.holeCards.length !== 2) failHand(`winner ${player?.nickname ?? id} folded or was never dealt in`)
      }

      const pots = referencePots(state.players)
      if (pots.length > 1) summary.sidePotHands += 1

      if (state.round !== 'showdown') {
        // Uncontested: exactly one player never folded and takes it all.
        summary.foldWins += 1
        if (live.length !== 1) failHand(`fold-ended hand with ${live.length} live players`)
        if (totals.get(live[0]!.id) !== pot) failHand('the last player standing did not get the whole pot')
        const winner = winners[0]!
        if (state.communityCards.length >= 3) {
          const best = bestOf(live[0]!, state.communityCards)
          if (winner.handDescription !== best.description) failHand(`fold winner described as ${winner.handDescription}, holds ${best.description}`)
        }
        return
      }

      summary.showdowns += 1
      // What the table UI shows next to each winner is the engine's (checked) description.
      const publicState = toTableState(state, '')
      const view = createThreeTableViewModel(publicState, '')
      for (const winner of publicState.winners ?? []) {
        const seat = view.players.find(player => player.id === winner.playerId)
        if (!winner.handDescription) failHand(`showdown winner ${winner.playerId} has no public hand description`)
        if (seat && seat.winnerHandDescription !== winner.handDescription) {
          failHand(`table view labels ${seat.nickname} "${seat.winnerHandDescription}", engine says "${winner.handDescription}"`)
        }
      }
      // Betting integrity: live players who are not all-in matched the biggest stake.
      const maxIn = Math.max(...live.map(player => player.totalInPot))
      for (const player of live) {
        if (player.status === 'active' && player.totalInPot !== maxIn) {
          failHand(`${player.nickname} reached showdown with ${player.totalInPot} in while another live stake is ${maxIn}`)
        }
      }

      if (runBoards.length === 2) {
        summary.runItTwice += 1
        const expected = new Map<string, number>()
        runBoards.forEach((board, boardIndex) => {
          if (board.length !== 5) failHand(`run ${boardIndex + 1} has ${board.length} cards`)
          const boardResult = state.runItTwice!.boards![boardIndex]!
          for (const winner of boardResult.winners) {
            const player = state.players.find(candidate => candidate.id === winner.playerId)!
            const best = bestOf(player, board)
            if (winner.handDescription !== best.description) failHand(`run ${boardIndex + 1}: ${player.nickname} described as ${winner.handDescription}, holds ${best.description}`)
            checkWinningCards(player, board, winner.winningCards, best, failHand)
          }
          for (const pot of pots) {
            const share = boardIndex === 0 ? Math.ceil(pot.amount / 2) : Math.floor(pot.amount / 2)
            distribute(share, pot.eligible, board, expected)
          }
        })
        comparePayouts(expected, totals, 0, failHand)
        for (const winner of winners) {
          const runs = runBoards.map((_, index) => state.runItTwice!.boards![index]!.winners.find(entry => entry.playerId === winner.playerId)?.handDescription)
          const description = winner.handDescription ?? ''
          for (const [index, run] of runs.entries()) {
            if (run && !description.includes(run)) failHand(`combined description "${description}" leaves out run ${index + 1} (${run})`)
          }
          if (runs[0] === undefined && runs[1] && !description.startsWith('Run 2')) failHand(`run-2-only winner described as "${description}"`)
        }
        return
      }

      if (state.communityCards.length !== 5) failHand(`showdown with ${state.communityCards.length} board cards`)
      const expected = new Map<string, number>()
      for (const pot of pots) distribute(pot.amount, pot.eligible, state.communityCards, expected)
      comparePayouts(expected, totals, 0, failHand)
      for (const winner of winners) {
        const player = state.players.find(candidate => candidate.id === winner.playerId)!
        const best = bestOf(player, state.communityCards)
        if (winner.handDescription !== best.description) failHand(`${player.nickname} described as ${winner.handDescription}, holds ${best.description}`)
        checkWinningCards(player, state.communityCards, winner.winningCards, best, failHand)
      }

      function distribute(amount: number, eligible: string[], board: Card[], into: Map<string, number>) {
        if (amount <= 0 || eligible.length === 0) return
        const scored = eligible.map(id => ({ id, score: bestOf(state.players.find(candidate => candidate.id === id)!, board) }))
        const top = scored.reduce((best, entry) => (compareReference(entry.score, best.score) > 0 ? entry : best))
        const fromButton = (id: string) => (state.players.find(candidate => candidate.id === id)!.seatIndex - state.dealerSeatIndex - 1 + 16) % 8
        const tied = scored
          .filter(entry => compareReference(entry.score, top.score) === 0)
          .sort((a, b) => fromButton(a.id) - fromButton(b.id))
        const share = Math.floor(amount / tied.length)
        let remainder = amount - share * tied.length
        for (const entry of tied) {
          into.set(entry.id, (into.get(entry.id) ?? 0) + share + (remainder > 0 ? 1 : 0))
          remainder = Math.max(0, remainder - 1)
        }
      }
    }

    function comparePayouts(expected: Map<string, number>, actual: Map<string, number>, tolerance: number, failHand: (message: string) => never) {
      const ids = new Set([...expected.keys(), ...actual.keys()])
      for (const id of ids) {
        const want = expected.get(id) ?? 0
        const got = actual.get(id) ?? 0
        // Exact: odd chips go one at a time to the first tied winners left of the button.
        if (Math.abs(want - got) > tolerance) {
          const name = srv.data.gameState.players.find(player => player.id === id)?.nickname ?? id
          failHand(`${name} was paid ${got}, the reference evaluator pays ${want}`)
        }
      }
    }

    function checkWinningCards(player: InternalPlayer, board: Card[], cards: Card[] | undefined, best: ReferenceScore, failHand: (message: string) => never) {
      if (!cards) return
      const pool = new Set([...player.holeCards, ...board].map(cardKey))
      if (cards.length !== 5 || cards.some(card => !pool.has(cardKey(card)))) failHand(`${player.nickname}'s highlighted cards ${cards.map(cardKey).join(' ')} are not five of their cards`)
      if (compareReference(scoreFive(cards), best) !== 0) failHand(`${player.nickname}'s highlighted cards are not their best hand (${best.description})`)
    }

    function validateHistory(handNumber: number) {
      const { state } = ended.get(handNumber)!
      const entry = srv.data.handHistory.find(candidate => candidate.handNumber === handNumber)
      if (!entry) fail(`hand ${handNumber} missing from the hand history`)
      const showdown = state.round === 'showdown'
      if (entry!.endedBy !== (showdown ? 'showdown' : 'fold')) fail(`hand ${handNumber} history says ${entry!.endedBy}`)
      // Forensics: one outcome per dealt-in player, matching what really happened.
      const outcomes = new Map((entry!.outcomes ?? []).map(outcome => [outcome.playerId, outcome]))
      const won = new Map<string, number>()
      for (const winner of state.winners ?? []) won.set(winner.playerId, (won.get(winner.playerId) ?? 0) + winner.amount)
      const dealtPlayers = state.players.filter(candidate => candidate.holeCards.length === 2)
      for (const player of dealtPlayers) {
        const outcome = outcomes.get(player.id)
        if (!outcome) fail(`hand ${handNumber} history has no outcome for ${player.nickname}`)
        const expectedResult = player.status === 'folded' ? 'folded' : won.has(player.id) ? 'won' : 'lost'
        if (outcome!.result !== expectedResult) fail(`hand ${handNumber}: ${player.nickname} recorded as ${outcome!.result}, really ${expectedResult}`)
        if (outcome!.stake !== player.totalInPot) fail(`hand ${handNumber}: ${player.nickname} stake ${outcome!.stake}, really ${player.totalInPot}`)
        const exit = expectedExits.get(handNumber)?.get(player.id)
        if (player.status === 'folded' && exit && outcome!.reason !== exit) {
          fail(`hand ${handNumber}: ${player.nickname} recorded as ${outcome!.reason} ${outcome!.street ?? ''}, really ${exit}`)
        }
        if (player.status === 'folded' && !outcome!.street) fail(`hand ${handNumber}: ${player.nickname}'s fold has no street`)
      }
      if (outcomes.size !== dealtPlayers.length) fail(`hand ${handNumber}: outcomes for players who were not dealt in`)
      const pot = state.players.reduce((sum, player) => sum + player.totalInPot, 0)
      if (entry!.pot !== pot) fail(`hand ${handNumber} history pot ${entry!.pot}, real pot ${pot}`)
      if (showdown) {
        for (const winner of state.winners ?? []) {
          const recorded = entry!.winners.find(candidate => candidate.playerId === winner.playerId)
          if (recorded?.handDescription !== winner.handDescription) {
            fail(`hand ${handNumber} history describes ${recorded?.nickname} as ${recorded?.handDescription}, engine says ${winner.handDescription}`)
          }
        }
        const runBoards = state.runItTwice?.status === 'accepted'
        if (!runBoards && entry!.board.map(cardKey).join() !== state.communityCards.map(cardKey).join()) {
          fail(`hand ${handNumber} history board differs from the played board`)
        }
      }
    }
  }
}
