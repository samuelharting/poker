'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import type { Card, RunItTwiceState, SeatPlayer } from '@/lib/poker/types'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface RunItTwicePromptProps {
  runItTwice: RunItTwiceState
  players: SeatPlayer[]
  yourId: string
  isConnected: boolean
  onVote: (vote: 'yes' | 'no') => void
}

type RunoutCardStyle = CSSProperties & {
  '--runout-card-delay': string
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

export function RunItTwicePrompt({
  runItTwice,
  players,
  yourId,
  isConnected,
  onVote,
}: RunItTwicePromptProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (runItTwice.status !== 'voting') {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [runItTwice.status])

  const eligiblePlayers = useMemo(
    () => runItTwice.eligiblePlayerIds
      .map(playerId => players.find(player => player.id === playerId))
      .filter((player): player is SeatPlayer => Boolean(player)),
    [players, runItTwice.eligiblePlayerIds]
  )
  const isEligible = runItTwice.eligiblePlayerIds.includes(yourId)
  const myVote = runItTwice.votes[yourId]
  const secondsLeft = Math.max(
    0,
    Math.ceil(((runItTwice.expiresAt ?? now) - now) / 1000)
  )

  return (
    <section
      className="run-it-twice-prompt"
      role="dialog"
      aria-labelledby="run-it-twice-title"
      aria-describedby="run-it-twice-description"
      data-voted={myVote ? 'true' : 'false'}
    >
      <div className="run-it-twice-prompt-glow" aria-hidden="true" />
      <div className="run-it-twice-mark" aria-hidden="true">
        <span>I</span><span>II</span>
      </div>
      <div className="run-it-twice-copy">
        <span className="run-it-twice-kicker">Heads-up all-in</span>
        <h2 id="run-it-twice-title">Run it twice?</h2>
        <p id="run-it-twice-description">
          Split the pot across two runouts. Both players must say yes.
        </p>
      </div>

      <div className="run-it-twice-voters" aria-label="Player votes">
        {eligiblePlayers.map(player => {
          const vote = runItTwice.votes[player.id]
          return (
            <div
              key={player.id}
              className={`run-it-twice-voter ${vote ? `is-${vote}` : 'is-waiting'}`}
            >
              <span>{player.id === yourId ? 'You' : player.nickname}</span>
              <strong>{vote === 'yes' ? 'Yes' : vote === 'no' ? 'No' : 'Waiting'}</strong>
            </div>
          )
        })}
      </div>

      <div className="run-it-twice-footer">
        {isEligible && !myVote ? (
          <div className="run-it-twice-actions" role="group" aria-label="Run it twice vote">
            <button
              type="button"
              className="run-it-twice-no"
              disabled={!isConnected || secondsLeft === 0}
              onClick={() => onVote('no')}
            >
              Once
            </button>
            <button
              type="button"
              className="run-it-twice-yes"
              disabled={!isConnected || secondsLeft === 0}
              onClick={() => onVote('yes')}
            >
              Yes, twice
            </button>
          </div>
        ) : (
          <span className="run-it-twice-waiting">
            {myVote === 'yes'
              ? 'Yes locked in — waiting for the other player'
              : myVote === 'no'
                ? 'Running it once'
                : 'Waiting for both players'}
          </span>
        )}
        <span className="run-it-twice-countdown" aria-label={`${secondsLeft} seconds left`}>
          {secondsLeft}s
        </span>
      </div>
    </section>
  )
}

function isHighlighted(card: Card, highlightedCards: Card[]): boolean {
  return highlightedCards.some(
    highlighted => highlighted.rank === card.rank && highlighted.suit === card.suit
  )
}

export function RunItTwiceBoards({
  runItTwice,
  players,
}: {
  runItTwice: RunItTwiceState
  players: SeatPlayer[]
}) {
  if (runItTwice.status !== 'accepted' || runItTwice.boards?.length !== 2) {
    return null
  }

  const sharedCardCount = runItTwice.sharedCardCount ?? 0

  return (
    <section className="run-it-twice-boards" aria-label="Run it twice boards">
      <div className="run-it-twice-boards-heading" aria-hidden="true">
        <span>Run it twice</span>
        <i />
      </div>
      {runItTwice.boards.map((board, boardIndex) => {
        const highlightedCards = board.winners.flatMap(winner => winner.winningCards ?? [])
        return (
          <div className="run-it-twice-board" key={`run-${boardIndex + 1}`}>
            <div className="run-it-twice-board-label">
              <span>Run</span>
              <strong>{boardIndex + 1}</strong>
            </div>
            <div className="run-it-twice-board-cards">
              {board.cards.map((card, cardIndex) => {
                const newCardIndex = Math.max(0, cardIndex - sharedCardCount)
                const delayMs = cardIndex < sharedCardCount
                  ? 80 + cardIndex * 55
                  : 360 + boardIndex * 720 + newCardIndex * 180
                const style: RunoutCardStyle = {
                  '--runout-card-delay': `${delayMs}ms`,
                }

                return (
                  <div
                    key={`${card.rank}-${card.suit}-${cardIndex}`}
                    className={`run-it-twice-card ${cardIndex < sharedCardCount ? 'is-shared' : 'is-runout'}`}
                    style={style}
                  >
                    <PlayingCard
                      card={card}
                      size="xl"
                      className="community-card"
                      highlighted={isHighlighted(card, highlightedCards)}
                    />
                  </div>
                )
              })}
            </div>
            <div className="run-it-twice-board-result" aria-live="polite">
              {board.winners.map(winner => {
                const player = players.find(candidate => candidate.id === winner.playerId)
                return (
                  <span key={winner.playerId}>
                    <b>{player?.nickname ?? 'Player'}</b>
                    <strong>+{formatAmount(winner.amount)}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
