'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { formatOddsPercent, type HandOddsView, type SeatOddsView } from '@/lib/poker/handOddsView'

const COUNT_DURATION_MS = 700

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Counts a percentage up or down to its new value (TV odds ticker). */
export function useAnimatedNumber(target: number, durationMs = COUNT_DURATION_MS): number {
  const [value, setValue] = useState(target)
  const valueRef = useRef(target)

  useEffect(() => {
    const from = valueRef.current
    if (
      from === target ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      prefersReducedMotion()
    ) {
      valueRef.current = target
      setValue(target)
      return
    }

    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = from + (target - from) * eased
      valueRef.current = next
      setValue(next)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [durationMs, target])

  return value
}

type OddsStyle = CSSProperties & { '--odds-pct'?: string }

function oddsTone(odds: SeatOddsView): 'leader' | 'dead' | 'trail' {
  if (odds.isDrawingDead) return 'dead'
  return odds.isLeader ? 'leader' : 'trail'
}

/** Compact "72%" pill with a fill bar, for a nameplate or seat chip. */
export function OddsPill({
  odds,
  playerName,
  className = '',
}: {
  odds: SeatOddsView
  playerName: string
  className?: string
}) {
  const shown = useAnimatedNumber(odds.winPercent)
  const style: OddsStyle = { '--odds-pct': `${Math.max(0, Math.min(100, shown)).toFixed(1)}%` }
  const tieLabel = odds.tiePercent >= 0.5 ? `, ${formatOddsPercent(odds.tiePercent)} to split` : ''

  return (
    <span
      className={`odds-pill is-${oddsTone(odds)} ${className}`.trim()}
      style={style}
      role="status"
      aria-label={`${playerName} ${formatOddsPercent(odds.winPercent)} to win${tieLabel}`}
      data-odds-player={odds.playerId}
      data-odds-win={odds.winPercent}
    >
      <span className="odds-pill-fill" aria-hidden="true" />
      <span className="odds-pill-value" aria-hidden="true">{formatOddsPercent(shown)}</span>
    </span>
  )
}

function OddsRow({ odds, name, isYou, showTies }: {
  odds: SeatOddsView
  name: string
  isYou: boolean
  showTies: boolean
}) {
  const shown = useAnimatedNumber(odds.winPercent)
  const style: OddsStyle = { '--odds-pct': `${Math.max(0, Math.min(100, shown)).toFixed(1)}%` }

  return (
    <li
      className={`hand-odds-row is-${oddsTone(odds)} ${isYou ? 'is-you' : ''}`.trim()}
      style={style}
      data-odds-player={odds.playerId}
      data-odds-win={odds.winPercent}
    >
      <span className="hand-odds-name">{name}{isYou ? <em> (you)</em> : null}</span>
      <span className="hand-odds-bar" aria-hidden="true"><span /></span>
      <span className="hand-odds-value">{formatOddsPercent(shown)}</span>
      {showTies && (
        <span className="hand-odds-tie" title="Chance to split">
          {odds.tiePercent >= 0.5 ? `tie ${formatOddsPercent(odds.tiePercent)}` : ''}
        </span>
      )}
    </li>
  )
}

/**
 * Broadcast lower-third: every live hand's chance to win on this street.
 * All-in runouts show it to the whole table; spectators see it every street.
 */
export function HandOddsPanel({
  view,
  names,
  yourId,
  className = '',
}: {
  view: HandOddsView
  names: ReadonlyMap<string, string>
  yourId: string
  className?: string
}) {
  const title = view.mode === 'all_in' ? 'All-in odds' : 'Live odds'

  return (
    <section
      className={`hand-odds-panel is-${view.mode} ${className}`.trim()}
      aria-label={`${title}, ${view.street}`}
      data-hand-odds={view.mode}
      data-board-count={view.boardCount}
    >
      <header className="hand-odds-head">
        <span className="hand-odds-live" aria-hidden="true" />
        <strong>{title}</strong>
        <span className="hand-odds-street" key={view.street}>{view.street}</span>
      </header>
      <ol className="hand-odds-rows">
        {view.players.map(odds => (
          <OddsRow
            key={odds.playerId}
            odds={odds}
            name={names.get(odds.playerId) ?? 'Player'}
            isYou={odds.playerId === yourId}
            showTies={view.showTies}
          />
        ))}
      </ol>
    </section>
  )
}
