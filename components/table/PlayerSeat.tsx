'use client'

import type { SeatPlayer } from '@/lib/poker/types'
import clsx from 'clsx'
import { PlayingCard } from '@/components/ui/PlayingCard'

interface PlayerSeatProps {
  player: SeatPlayer
  isActing: boolean
  depthClass: 'seat-depth-near' | 'seat-depth-mid' | 'seat-depth-far' | 'seat-depth-top'
  opacityValue: number
  socialMessage?: string
  socialEmote?: string
  socialMessageExpiresAt?: number
  socialEmoteExpiresAt?: number
  socialEmoteFrom?: string
  targetedSocialEmote?: string
  targetedSocialEmoteExpiresAt?: number
  targetedSocialEmoteFrom?: string
  onNameClick?: (playerId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  folded: 'Folded',
  all_in: 'All-in',
  sitting_out: 'Sitting Out',
  disconnected: 'Away',
}

export function PlayerSeat({
  player,
  isActing,
  depthClass,
  opacityValue,
  socialMessage,
  socialEmote,
  socialMessageExpiresAt,
  socialEmoteExpiresAt,
  socialEmoteFrom,
  targetedSocialEmote,
  targetedSocialEmoteExpiresAt,
  targetedSocialEmoteFrom,
  onNameClick,
}: PlayerSeatProps) {
  const isFolded = player.status === 'folded'
  const isDisconnected = player.status === 'disconnected' || !player.isConnected
  const isAllIn = player.status === 'all_in'
  const displayAction = player.lastAction ?? STATUS_LABELS[player.status] ?? null
  const showAction = displayAction && player.status !== 'active' && player.status !== 'waiting'

  const socialBubbleTtl = Math.max(0, socialMessageExpiresAt ? socialMessageExpiresAt - Date.now() : 0)
  const socialEmoteTtl = Math.max(0, socialEmoteExpiresAt ? socialEmoteExpiresAt - Date.now() : 0)
  const targetedSocialEmoteTtl = Math.max(
    0,
    targetedSocialEmoteExpiresAt ? targetedSocialEmoteExpiresAt - Date.now() : 0
  )
  const holeCards = player.holeCards ?? []
  const holeCardCount = holeCards.length
  const visibleLeftCard = (() => {
    if (holeCardCount === 0) {
      return null
    }

    if (player.showCards === 'left' || player.showCards === 'both') {
      return holeCards[0] ?? null
    }

    if (player.showCards === 'right' && holeCardCount === 1) {
      return holeCards[0]
    }

    return null
  })()

  const visibleRightCard = (() => {
    if (holeCardCount === 0) {
      return null
    }

    if (player.showCards === 'both') {
      return holeCards[1] ?? holeCards[0] ?? null
    }

    if (player.showCards === 'right') {
      return holeCards[1] ?? holeCards[0] ?? null
    }

    return null
  })()

  const initials = player.nickname
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className={clsx('player-seat', depthClass, isFolded && 'is-folded')}
      style={{ opacity: isFolded ? opacityValue * 0.5 : opacityValue }}
    >
      {(socialMessage || socialEmote || targetedSocialEmote) && (
        <div className="player-social-stack">
          {socialMessage && (
            <div
              key={`${socialMessage}-${socialMessageExpiresAt}`}
              className="player-chat-bubble"
              style={{ ['--chat-ttl' as any]: `${socialBubbleTtl}ms` }}
            >
              {socialMessage}
            </div>
          )}
          {socialEmote && (
            <div
              key={`${socialEmote}-${socialEmoteExpiresAt}`}
              className="player-emote-badge"
              title={socialEmoteFrom ? `${socialEmoteFrom} sent ${socialEmote}` : undefined}
              aria-label={`Emote ${socialEmote}`}
              style={{ ['--chat-ttl' as any]: `${socialEmoteTtl}ms` }}
            >
              {socialEmote}
            </div>
          )}
          {targetedSocialEmote && (
            <div
              key={`${targetedSocialEmote}-${targetedSocialEmoteExpiresAt}`}
              className="player-emote-badge player-emote-badge-targeted"
              title={
                targetedSocialEmoteFrom
                  ? `${targetedSocialEmoteFrom} aimed this at ${player.nickname}: ${targetedSocialEmote}`
                  : undefined
              }
              aria-label={`Emote ${targetedSocialEmote}`}
              style={{ ['--chat-ttl' as any]: `${targetedSocialEmoteTtl}ms` }}
            >
              {targetedSocialEmote}
            </div>
          )}
        </div>
      )}

      {player.hasCards && (
        <div className={clsx('player-held-cards', holeCardCount > 0 && 'is-revealed')}>
          {holeCardCount > 0 ? (
            <>
              {visibleLeftCard ? (
                <div className="player-card-face player-card-face-left">
                  <PlayingCard card={visibleLeftCard} size="sm" />
                </div>
              ) : (
                <div className="player-card-back player-card-back-left" />
              )}

              {visibleRightCard ? (
                <div className="player-card-face player-card-face-right">
                  <PlayingCard card={visibleRightCard} size="sm" />
                </div>
              ) : (
                <div className="player-card-back player-card-back-right" />
              )}
            </>
          ) : (
            <>
              <div className="player-card-back player-card-back-left" />
              <div className="player-card-back player-card-back-right" />
            </>
          )}
        </div>
      )}

      {player.bet > 0 && (
        <div key={`${player.id}-${player.bet}`} className="player-bet-stack-anchor">
          <div className="chip-stack player-bet-stack">
            <span className="chip chip-red" />
            <span className="chip chip-white" />
            <span className="chip chip-blue" />
          </div>
        </div>
      )}

      <div className={clsx('player-seat-marker', isActing && 'is-acting', isDisconnected && 'is-disconnected')}>
        <span>{initials}</span>
        {player.isDealer && <div className="dealer-button">D</div>}
        {player.isSB && !player.isDealer && <div className="blind-badge sb">SB</div>}
        {player.isBB && <div className="blind-badge bb">BB</div>}
      </div>

      <div className="player-name-container">
        {onNameClick ? (
          <button
            type="button"
            className="player-name player-name-clickable"
            onClick={() => onNameClick(player.id)}
            title={`Send an emoji to ${player.nickname}`}
          >
            {player.nickname}
          </button>
        ) : (
          <div className="player-name">{player.nickname}</div>
        )}
      </div>

      {!isFolded && (
        <div className={clsx('player-stack', isAllIn && 'text-yellow-400')}>
          ${player.stack.toLocaleString()}
        </div>
      )}

      {player.bet > 0 && <div className="player-bet">Bet ${player.bet.toLocaleString()}</div>}

      {showAction && (
        <div
          className="player-action-badge"
          style={{
            color: isFolded ? '#888' : isAllIn ? '#ffd700' : 'rgba(255,255,255,0.8)',
          }}
        >
          {displayAction}
        </div>
      )}

      {isActing && <div className="player-acting-label">Acting</div>}
    </div>
  )
}
