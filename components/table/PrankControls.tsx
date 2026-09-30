'use client'

import { useEffect, useState } from 'react'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'

/**
 * "Mess with your friends" buttons in the targeted player panel (desktop
 * only): buy them a shot, flick a chip at them, flip them off (their avatar
 * reacts on the 3D table, so it lives here rather than with the emojis). The server enforces every
 * rule; a disabled button explains itself in its tooltip, and cooldowns show
 * as a small number on the icon. No sentences on the table.
 */
export function PrankControls({
  targetName,
  showShot,
  shotBlocked,
  shotNote,
  shotBadge,
  shotPrice = 0,
  flickReadyAt,
  isConnected,
  onBuyShot,
  onFlickChip,
  onFlipOff,
}: {
  targetName: string
  showShot: boolean
  shotBlocked: boolean
  /** Tooltip: why a shot is blocked, or what it will do. */
  shotNote: string
  /** Small number on the icon (hands of cooldown), or null. */
  shotBadge: number | null
  /** Chips the buyer pays (the current small blind); 0 hides the price. */
  shotPrice?: number
  /** Date.now() timestamp when the next chip is loaded (0 = ready). */
  flickReadyAt: number
  isConnected: boolean
  onBuyShot: () => void
  onFlickChip: () => void
  onFlipOff?: () => void
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
          aria-label={`Buy ${targetName} a shot${shotPrice > 0 ? ` for ${shotPrice} chips` : ''}. ${shotNote}`}
        >
          <span className="prank-button-icon" aria-hidden="true">
            🥃
            {shotBadge !== null && <span className="prank-button-badge">{shotBadge}</span>}
          </span>
          <span className="prank-button-copy">
            <strong>{shotPrice > 0 ? `Shot $${shotPrice.toLocaleString()}` : 'Buy a shot'}</strong>
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
      {onFlipOff && (
        <button
          type="button"
          className="prank-button is-flip"
          disabled={!isConnected}
          onClick={onFlipOff}
          title={`Flip off ${targetName}`}
          aria-label={`Flip off ${targetName}`}
        >
          <span className="prank-button-icon" aria-hidden="true">
            <EmojiGlyph emoji="🖕" />
          </span>
          <span className="prank-button-copy">
            <strong>Flip off</strong>
          </span>
        </button>
      )}
    </div>
  )
}
