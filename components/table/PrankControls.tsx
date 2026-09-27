'use client'

import { useEffect, useState } from 'react'

/**
 * "Mess with your friends" buttons in the targeted player panel (desktop
 * only): buy them a shot, flick a chip at them. The server enforces every
 * rule; a disabled button explains itself in its tooltip, and cooldowns show
 * as a small number on the icon. No sentences on the table.
 */
export function PrankControls({
  targetName,
  showShot,
  shotBlocked,
  shotNote,
  shotBadge,
  flickReadyAt,
  isConnected,
  onBuyShot,
  onFlickChip,
}: {
  targetName: string
  showShot: boolean
  shotBlocked: boolean
  /** Tooltip: why a shot is blocked, or what it will do. */
  shotNote: string
  /** Small number on the icon (hands of cooldown), or null. */
  shotBadge: number | null
  /** Date.now() timestamp when the next chip is loaded (0 = ready). */
  flickReadyAt: number
  isConnected: boolean
  onBuyShot: () => void
  onFlickChip: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const flickCooling = flickReadyAt > now
  useEffect(() => {
    if (!flickCooling) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [flickCooling])
  const reloadSeconds = Math.max(1, Math.ceil((flickReadyAt - now) / 1000))

  return (
    <div className="prank-controls" role="group" aria-label={`Mess with ${targetName}`}>
      {showShot && (
        <button
          type="button"
          className="prank-button is-shot"
          disabled={!isConnected || shotBlocked}
          onClick={onBuyShot}
          title={shotNote}
          aria-label={`Buy ${targetName} a shot. ${shotNote}`}
        >
          <span className="prank-button-icon" aria-hidden="true">
            🥃
            {shotBadge !== null && <span className="prank-button-badge">{shotBadge}</span>}
          </span>
          <span className="prank-button-copy">
            <strong>Buy a shot</strong>
          </span>
        </button>
      )}
      <button
        type="button"
        className="prank-button is-flick"
        disabled={!isConnected || flickCooling}
        onClick={onFlickChip}
        title={flickCooling ? `Reloading (${reloadSeconds}s)` : `Flick a chip at ${targetName}`}
        aria-label={`Flick a chip at ${targetName}`}
      >
        <span className="prank-button-icon" aria-hidden="true">
          🪙
          {flickCooling && <span className="prank-button-badge">{reloadSeconds}</span>}
        </span>
        <span className="prank-button-copy">
          <strong>Flick a chip</strong>
        </span>
      </button>
    </div>
  )
}
