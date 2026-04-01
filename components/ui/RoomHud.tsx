'use client'

import type { GamePhase } from '@/lib/poker/types'

interface RoomHudProps {
  roomCode: string
  isConnected: boolean
  isHost: boolean
  playerCount: number
  smallBlind: number
  bigBlind: number
  phase: GamePhase | null
  settingsOpen: boolean
  onCopyRoom: () => void
  onShareRoom: () => void
  onToggleSettings: () => void
  canShare: boolean
}

function getPhaseLabel(phase: GamePhase | null): string {
  switch (phase) {
    case 'in_hand':
      return 'Hand live'
    case 'between_hands':
      return 'Between hands'
    case 'waiting':
    default:
      return 'Waiting'
  }
}

export function RoomHud({
  roomCode,
  isConnected,
  isHost,
  playerCount,
  smallBlind,
  bigBlind,
  phase,
  settingsOpen,
  onCopyRoom,
  onShareRoom,
  onToggleSettings,
  canShare,
}: RoomHudProps) {
  return (
    <div className="room-hud">
      <div className="room-hud-main room-hud-share-panel">
        <div className="room-hud-code-row">
          <span className="room-brand-wordmark">Poker Night</span>
          <span className="room-code">{roomCode}</span>
        </div>
        <div className="room-hud-label">Table controls</div>
        <div className="room-hud-actions room-hud-actions-rail">
          <button
            type="button"
            className="hud-button"
            onClick={onToggleSettings}
          >
            {settingsOpen ? 'Close menu' : 'Options'}
          </button>
          <button type="button" className="hud-button" onClick={onCopyRoom}>
            Copy code
          </button>
          <button
            type="button"
            className="hud-button"
            onClick={onShareRoom}
            disabled={!canShare}
          >
            Share link
          </button>
        </div>
      </div>

      <div className="room-hud-meta room-hud-meta-card">
        <div className="room-hud-owner">{isHost ? 'OWNER VIEW' : 'TABLE VIEW'}</div>
        <div className="room-hud-blinds">NLH ~ {smallBlind} / {bigBlind}</div>
        <div className="room-hud-chip-row">
          <span className={`connection-pill ${isConnected ? 'is-live' : 'is-reconnecting'}`}>
            {isConnected ? 'Connected' : 'Reconnecting'}
          </span>
          <span className="room-hud-chip room-hud-chip-role">{isHost ? 'Host' : 'Player'}</span>
          <span className="room-hud-chip room-hud-chip-count">{playerCount} seated</span>
          <span className="room-hud-chip room-hud-chip-phase">{getPhaseLabel(phase)}</span>
        </div>
        <button
          type="button"
          className="room-hud-mobile-toggle"
          onClick={onToggleSettings}
        >
          {settingsOpen ? 'Close' : 'Settings'}
        </button>
      </div>
    </div>
  )
}
