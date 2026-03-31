'use client'

import type { GamePhase } from '@/lib/poker/types'

interface RoomHudProps {
  roomCode: string
  isConnected: boolean
  isHost: boolean
  playerCount: number
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
  phase,
  settingsOpen,
  onCopyRoom,
  onShareRoom,
  onToggleSettings,
  canShare,
}: RoomHudProps) {
  return (
    <div className="room-hud">
      <div className="room-hud-main">
        <div className="room-hud-label">Room</div>
        <div className="room-hud-code-row">
          <span className="room-code">{roomCode}</span>
          <button type="button" className="hud-button" onClick={onCopyRoom}>
            Copy
          </button>
          <button
            type="button"
            className="hud-button"
            onClick={onShareRoom}
            disabled={!canShare}
          >
            Share
          </button>
          <button
            type="button"
            className="hud-button"
            onClick={onToggleSettings}
          >
            {settingsOpen ? 'Close settings' : 'Settings'}
          </button>
        </div>
      </div>

      <div className="room-hud-meta">
        <span className={`connection-pill ${isConnected ? 'is-live' : 'is-reconnecting'}`}>
          {isConnected ? 'Connected' : 'Reconnecting'}
        </span>
        <span className="room-hud-chip">{isHost ? 'Host' : 'Player'}</span>
        <span className="room-hud-chip">{playerCount} seated</span>
        <span className="room-hud-chip">{getPhaseLabel(phase)}</span>
      </div>
    </div>
  )
}
