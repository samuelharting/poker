'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeatPlayer, TableState } from '@/lib/poker/types'
import type { PokerSoundCueKind } from '@/lib/poker/soundscape'
import {
  getShowdownPresentation,
  type ShowdownPresentation,
} from '@/lib/poker/showdown'
import { ChipStack } from '@/components/ui/ChipStack'

export interface ShowdownPresentationView {
  participants: SeatPlayer[]
  presentation: ShowdownPresentation
}

interface ShowdownCinematicProps {
  state: TableState
  presentation: ShowdownPresentation
  onSoundCue?: (cue: PokerSoundCueKind) => void
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function useShowdownPresentation(state: TableState): ShowdownPresentationView {
  const participants = useMemo(() => {
    const eligiblePlayerIds = new Set(state.pots.flatMap(pot => pot.eligiblePlayerIds))

    return state.players
      .filter(player => (
        player.hasCards &&
        (
          eligiblePlayerIds.has(player.id) ||
          player.status === 'active' ||
          player.status === 'all_in'
        )
      ))
      .sort((left, right) => left.seatIndex - right.seatIndex)
  }, [state.players, state.pots])
  const participantIds = useMemo(
    () => participants.map(player => player.id),
    [participants]
  )
  const anchorRef = useRef({
    key: '',
    serverNow: state.serverNow,
    receivedAt: monotonicNow(),
  })
  const snapshotKey = `${state.roomCode}:${state.handNumber}:${state.showdownAt ?? 'none'}:${state.serverNow}`

  if (anchorRef.current.key !== snapshotKey) {
    anchorRef.current = {
      key: snapshotKey,
      serverNow: state.serverNow,
      receivedAt: monotonicNow(),
    }
  }

  const [clock, setClock] = useState(() => monotonicNow())
  const presentation = getShowdownPresentation({
    phase: state.phase,
    round: state.round,
    winners: state.winners,
    showdownAt: state.showdownAt,
    serverNow: anchorRef.current.serverNow,
    timeSinceSnapshotMs: Math.max(0, clock - anchorRef.current.receivedAt),
    participantIds,
  })

  useEffect(() => {
    if (!presentation.isShowdown || presentation.nextTransitionAtMs === null) {
      return
    }

    const delay = Math.max(16, presentation.nextTransitionAtMs - presentation.elapsedMs + 8)
    const timer = window.setTimeout(() => setClock(monotonicNow()), delay)
    return () => window.clearTimeout(timer)
  }, [presentation.elapsedMs, presentation.isShowdown, presentation.nextTransitionAtMs])

  return { participants, presentation }
}

function getStageCopy(presentation: ShowdownPresentation): string {
  if (presentation.stage === 'intro') return 'Cards on their backs'
  if (presentation.stage === 'reveal') return 'Revealing hands'
  if (presentation.stage === 'highlight') return 'Winning five'
  if (presentation.stage === 'payout') return 'Pot awarded'
  return 'Hand complete'
}

export function ShowdownCinematic({
  state,
  presentation,
  onSoundCue = () => {},
}: ShowdownCinematicProps) {
  const winners = state.winners ?? []
  const soundProgressRef = useRef({
    key: '',
    revealedCards: 0,
    highlighted: false,
    payout: false,
  })
  const showdownKey = `${state.roomCode}:${state.handNumber}:${state.showdownAt ?? 'none'}`
  const revealedCards = Object.values(presentation.revealedCardCounts)
    .reduce<number>((sum, count) => sum + count, 0)

  useEffect(() => {
    if (!presentation.isShowdown) {
      soundProgressRef.current = {
        key: '',
        revealedCards: 0,
        highlighted: false,
        payout: false,
      }
      return
    }

    const previous = soundProgressRef.current
    if (previous.key !== showdownKey) {
      soundProgressRef.current = {
        key: showdownKey,
        revealedCards,
        highlighted: presentation.winningHandHighlighted,
        payout: presentation.payoutStarted,
      }
      return
    }

    const newlyRevealedCards = Math.max(0, revealedCards - previous.revealedCards)
    const newlyHighlighted = presentation.winningHandHighlighted && !previous.highlighted
    const newlyStartedPayout = presentation.payoutStarted && !previous.payout
    const skippedMultipleTransitions = (
      newlyRevealedCards > 1 ||
      [newlyRevealedCards > 0, newlyHighlighted, newlyStartedPayout].filter(Boolean).length > 1
    )

    // Browser throttling can jump over several stages at once. Treat those as
    // stale rather than stacking a burst of catch-up audio after the fact.
    if (!skippedMultipleTransitions) {
      if (newlyRevealedCards === 1) {
        onSoundCue('showdown_card')
      }
      if (newlyHighlighted) {
        onSoundCue('showdown_winner')
      }
      if (newlyStartedPayout) {
        onSoundCue('pot_payout')
      }
    }

    soundProgressRef.current = {
      key: showdownKey,
      revealedCards,
      highlighted: presentation.winningHandHighlighted,
      payout: presentation.payoutStarted,
    }
  }, [
    onSoundCue,
    presentation.isShowdown,
    presentation.payoutStarted,
    presentation.winningHandHighlighted,
    revealedCards,
    showdownKey,
  ])

  if (!presentation.isShowdown || presentation.resultsVisible) {
    return null
  }

  const payoutAmount = winners.reduce((sum, winner) => sum + winner.amount, 0)

  return (
    <aside
      className="showdown-table-sequence"
      data-stage={presentation.stage}
      aria-label="Showdown in progress"
    >
      <div className="showdown-table-sequence-copy" role="status" aria-live="polite" aria-atomic="true">
        <span>Showdown</span>
        <strong>{getStageCopy(presentation)}</strong>
      </div>

      {presentation.payoutStarted && (
        <div className="showdown-table-payout" aria-hidden="true">
          <ChipStack amount={payoutAmount || state.totalPot} compact showAmount={false} />
          <span>Pot awarded</span>
        </div>
      )}
    </aside>
  )
}
