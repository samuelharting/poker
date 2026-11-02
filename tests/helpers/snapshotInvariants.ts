import type { Card, InternalGameState, TableState } from '@/lib/poker/types'
import { getVisibleOwnHandDescription } from '@/lib/poker/handLabel'
import { createThreeTableViewModel, getThreeBoardCards, getThreeVisibleCardSlots } from '@/components/three/tableViewModel'
import { bestReferenceHand, cardKey } from './bruteForceHand'

/**
 * What one connection was sent must agree with the server's truth and with
 * itself: no card on screen twice, a real board size, every visible card the
 * one the server dealt, and every hand name the brute-force evaluator's.
 * Returns a list of problems (empty when the snapshot is sound).
 */
export function findSnapshotProblems(state: TableState, truth?: InternalGameState): string[] {
  const problems: string[] = []
  const board = state.communityCards
  if (![0, 3, 4, 5].includes(board.length)) problems.push(`board has ${board.length} cards`)

  const runItTwice = state.runItTwice?.status === 'accepted' ? state.runItTwice : null
  const shared = runItTwice?.sharedCardCount ?? 0
  const runBoards = runItTwice?.boards?.map(run => run.cards) ?? []

  // Every distinct physical card that could be on screen at once.
  const onScreen: Array<{ card: Card; where: string }> = []
  board.forEach(card => onScreen.push({ card, where: 'board' }))
  if (runBoards[1]) runBoards[1].slice(shared).forEach(card => onScreen.push({ card, where: 'run 2' }))
  ;(state.rabbitCards ?? []).forEach(card => onScreen.push({ card, where: 'rabbit' }))
  for (const player of state.players) {
    ;(player.holeCards ?? []).forEach(card => onScreen.push({ card, where: player.nickname }))
    if ((player.holeCards?.length ?? 0) > 2) problems.push(`${player.nickname} shows ${player.holeCards!.length} hole cards`)
  }
  const seen = new Map<string, string>()
  for (const { card, where } of onScreen) {
    const key = cardKey(card)
    const first = seen.get(key)
    if (first) problems.push(`${key} is visible twice (${first} and ${where})`)
    else seen.set(key, where)
  }
  if (state.rabbitCards?.length && board.length + state.rabbitCards.length > 5) {
    problems.push(`rabbit hunt makes a ${board.length + state.rabbitCards.length}-card board`)
  }

  if (runItTwice) {
    if (runBoards.length !== 2) problems.push(`run it twice with ${runBoards.length} boards`)
    runBoards.forEach((run, index) => {
      if (run.length !== 5) problems.push(`run ${index + 1} has ${run.length} cards`)
    })
    if (runBoards[0] && runBoards[0].map(cardKey).join() !== board.map(cardKey).join()) problems.push('run 1 differs from the board')
    if (runBoards[1] && runBoards[1].slice(0, shared).map(cardKey).join() !== board.slice(0, shared).map(cardKey).join()) {
      problems.push('run 2 shared cards differ from the board')
    }
  }

  if (truth) {
    if (truth.handNumber !== state.handNumber) problems.push(`snapshot hand ${state.handNumber}, server hand ${truth.handNumber}`)
    if (board.map(cardKey).join() !== truth.communityCards.map(cardKey).join()) {
      problems.push(`board ${board.map(cardKey).join(' ')} is not the server board ${truth.communityCards.map(cardKey).join(' ')}`)
    }
    for (const player of state.players) {
      const internal = truth.players.find(candidate => candidate.id === player.id)
      if (!internal) continue
      const real = new Set(internal.holeCards.map(cardKey))
      for (const card of player.holeCards ?? []) {
        if (!real.has(cardKey(card))) problems.push(`${player.nickname} shown holding ${cardKey(card)}, which they were not dealt`)
      }
    }
  }

  // Winner labels: exactly the brute-force best hand on the board that was played.
  const holeCardsOf = (playerId: string): Card[] | undefined => (
    truth?.players.find(player => player.id === playerId)?.holeCards ??
    state.players.find(player => player.id === playerId)?.holeCards
  )
  const describe = (playerId: string, onBoard: readonly Card[]): string | null => {
    const hole = holeCardsOf(playerId)
    if (!hole || hole.length !== 2 || onBoard.length < 3) return null
    return bestReferenceHand([...hole, ...onBoard]).description
  }
  if (runItTwice) {
    runItTwice.boards?.forEach((run, index) => {
      for (const winner of run.winners) {
        const expected = describe(winner.playerId, run.cards)
        if (winner.handDescription && expected && winner.handDescription !== expected) {
          problems.push(`run ${index + 1} names ${winner.playerId}'s hand "${winner.handDescription}", it is "${expected}"`)
        }
      }
    })
  } else {
    for (const winner of state.winners ?? []) {
      if (!winner.handDescription) continue
      const expected = describe(winner.playerId, board)
      if (expected && winner.handDescription !== expected) {
        problems.push(`winner ${winner.playerId} named "${winner.handDescription}", holds "${expected}"`)
      }
    }
  }

  // The viewer's own hand label, as the 2D and 3D tables compute it.
  const viewer = state.viewerId ? state.players.find(player => player.id === state.viewerId) : undefined
  if (viewer?.holeCards?.length === 2) {
    const label = getVisibleOwnHandDescription(viewer.holeCards, board)
    const expected = board.length >= 3 ? bestReferenceHand([...viewer.holeCards, ...board]).description : null
    if (expected && label !== expected) problems.push(`own hand labelled "${label}", it is "${expected}"`)
  }

  problems.push(...findViewModelProblems(state))
  return problems
}

/** The 3D view model must carry the snapshot's cards and labels untouched. */
export function findViewModelProblems(state: TableState): string[] {
  const problems: string[] = []
  const viewerId = state.viewerId ?? ''
  const view = createThreeTableViewModel(state, viewerId)
  const expectedBoard = getThreeBoardCards(state)
  const shownBoard = view.communityCards.map(card => `${card.rank}${card.suit}`).join()
  if (shownBoard !== expectedBoard.map(card => `${card.rank}${card.suit}`).join()) problems.push(`3D board ${shownBoard} differs from the snapshot`)
  if (state.runItTwice?.status !== 'accepted' && expectedBoard.length !== state.communityCards.length) problems.push('3D board drops cards')
  const hero = state.players.find(player => player.id === viewerId)
  const heroCards = view.heroCards.map(card => `${card.rank}${card.suit}`).join()
  if (heroCards !== (hero?.holeCards ?? []).map(card => `${card.rank}${card.suit}`).join()) problems.push('3D hero cards differ from the snapshot')
  const winners = new Map((state.winners ?? []).map(winner => [winner.playerId, winner.handDescription]))
  for (const seat of view.players) {
    const player = state.players.find(candidate => candidate.id === seat.id)!
    const real = (player.holeCards ?? []).map(card => `${card.rank}${card.suit}`)
    const shown = seat.visibleCards.map(card => `${card.rank}${card.suit}`)
    if (shown.join() !== real.join()) problems.push(`3D seat ${seat.nickname} shows ${shown.join()} for ${real.join()}`)
    const slots = getThreeVisibleCardSlots(seat.showCards, seat.visibleCards)
    for (const slot of [slots.left, slots.right]) {
      if (slot && !real.includes(`${slot.rank}${slot.suit}`)) problems.push(`3D seat ${seat.nickname} face-up ${slot.rank}${slot.suit} is not theirs`)
    }
    if (seat.winnerHandDescription !== winners.get(seat.id)) problems.push(`3D nameplate for ${seat.nickname} reads "${seat.winnerHandDescription}"`)
    if (seat.stack !== player.stack) problems.push(`3D stack for ${seat.nickname} is ${seat.stack}, snapshot ${player.stack}`)
  }
  return problems
}
