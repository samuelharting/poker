'use client'

import React from 'react'
import type { Card, SeatPlayer } from '@/lib/poker/types'
import clsx from 'clsx'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { ChipStack } from '@/components/ui/ChipStack'

interface PlayerSeatProps {
  player: SeatPlayer
  isActing: boolean
  isWinner?: boolean
  winnerAmount?: number
  winnerVenmoUsername?: string
  depthClass: 'seat-depth-near' | 'seat-depth-mid' | 'seat-depth-far' | 'seat-depth-top'
  opacityValue: number
  socialMessage?: string
  socialMessageExpiresAt?: number
  socialEmote?: string
  socialEmoteExpiresAt?: number
  socialEmoteTargeted?: boolean
  onNameClick?: (playerId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  folded: 'Folded',
  all_in: 'All-in',
  sitting_out: 'Sitting Out',
  disconnected: 'Away',
}

function formatEquityPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatWinnerPaymentLabel(nickname: string, venmoUsername?: string): string {
  return venmoUsername ? `${nickname} ${venmoUsername}` : nickname
}

export function getVisibleSeatCards(
  showCards: SeatPlayer['showCards'],
  holeCards: Card[] | undefined
): { left: Card | null; right: Card | null } {
  const cards = holeCards ?? []

  if (cards.length === 0) {
    return { left: null, right: null }
  }

  if (showCards === 'both') {
    return {
      left: cards[0] ?? null,
      right: cards[1] ?? cards[0] ?? null,
    }
  }

  if (showCards === 'left') {
    return {
      left: cards[0] ?? null,
      right: null,
    }
  }

  if (showCards === 'right') {
    return {
      left: null,
      right: cards.length === 1 ? cards[0] ?? null : cards[1] ?? null,
    }
  }

  return { left: null, right: null }
}

export function PlayerSeat({
  player,
  isActing,
  isWinner = false,
  winnerAmount,
  winnerVenmoUsername,
  depthClass,
  opacityValue,
  socialMessage,
  socialMessageExpiresAt,
  socialEmote,
  socialEmoteExpiresAt,
  socialEmoteTargeted = false,
  onNameClick,
}: PlayerSeatProps) {
  const isFolded = player.status === 'folded'
  const isDisconnected = player.status === 'disconnected' || !player.isConnected
  const isAllIn = player.status === 'all_in'
  const displayAction = player.lastAction ?? STATUS_LABELS[player.status] ?? null
  const showAction = displayAction && player.status !== 'active' && player.status !== 'waiting'
  const showEquity = typeof player.equityPercent === 'number' && isFolded === false && isDisconnected === false

  const socialBubbleTtl = Math.max(0, socialMessageExpiresAt ? socialMessageExpiresAt - Date.now() : 0)
  const socialEmoteTtl = Math.max(0, socialEmoteExpiresAt ? socialEmoteExpiresAt - Date.now() : 0)
  const holeCards = player.holeCards ?? []
  const holeCardCount = holeCards.length
  const { left: visibleLeftCard, right: visibleRightCard } = getVisibleSeatCards(
    player.showCards,
    holeCards
  )

  const initials = player.nickname
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const targetTitle = `Target ${player.nickname} for emojis`
  const markerContent = (
    <>
      <span className="player-seat-initials">{initials}</span>
      {player.isDealer && <span className="dealer-button">D</span>}
      {player.isSB && !player.isDealer && <span className="blind-badge sb">SB</span>}
      {player.isBB && <span className="blind-badge bb">BB</span>}
    </>
  )

  return (
    <div
      className={clsx(
        'player-seat',
        depthClass,
        isFolded && 'is-folded',
        isWinner && 'is-winner',
        isActing && 'is-acting',
        isActing && 'is-current-turn',
        isDisconnected && 'is-disconnected'
      )}
      style={{ opacity: isFolded ? opacityValue * 0.34 : opacityValue }}
      data-player-status={player.status}
    >
      {(socialMessage || socialEmote) && (
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
              className={clsx(
                'player-emote-badge',
                socialEmoteTargeted && 'player-emote-badge-targeted'
              )}
              style={{ ['--chat-ttl' as any]: `${socialEmoteTtl}ms` }}
            >
              {socialEmote}
            </div>
          )}
        </div>
      )}

      {player.hasCards && (
        <div className={clsx('player-held-cards', holeCardCount > 0 && 'is-revealed', isWinner && 'is-winner')}>
          {holeCardCount > 0 ? (
            <>
              {visibleLeftCard ? (
                <div className="player-card-face player-card-face-left">
                  <PlayingCard card={visibleLeftCard} size="xs" highlighted={isWinner} />
                </div>
              ) : (
                <div className="player-card-back player-card-back-left" />
              )}

              {visibleRightCard ? (
                <div className="player-card-face player-card-face-right">
                  <PlayingCard card={visibleRightCard} size="xs" highlighted={isWinner} />
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
          <div className="player-bet-stack">
            <ChipStack amount={player.bet} compact />
          </div>
        </div>
      )}

      {onNameClick ? (
        <button
          type="button"
          className={clsx('player-seat-marker', isActing && 'is-acting', isDisconnected && 'is-disconnected', isWinner && 'is-winner')}
          onClick={() => onNameClick(player.id)}
          title={targetTitle}
          aria-label={targetTitle}
          data-player-target-trigger="avatar"
        >
          {markerContent}
        </button>
      ) : (
        <div className={clsx('player-seat-marker', isActing && 'is-acting', isDisconnected && 'is-disconnected', isWinner && 'is-winner')}>
          {markerContent}
        </div>
      )}

      <div className="player-name-container">
        {onNameClick ? (
          <button
            type="button"
            className="player-name player-name-clickable"
            onClick={() => onNameClick(player.id)}
            title={targetTitle}
            data-player-target-trigger="username"
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

      {isWinner && typeof winnerAmount === 'number' && winnerAmount > 0 && (
        <div className="winner-payout-chip">
          Won ${winnerAmount.toLocaleString()}{winnerVenmoUsername ? ` ${winnerVenmoUsername}` : ''}
        </div>
      )}

      {showEquity && (
        <div
          className="player-equity-badge"
          title={`Live hand equity: ${formatEquityPercent(player.equityPercent!)}`}
        >
          Eq {formatEquityPercent(player.equityPercent!)}
        </div>
      )}

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

      {isActing && <div className="player-acting-label">Turn</div>}
    </div>
  )
}
