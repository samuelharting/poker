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
  onToggleSettings: () => void
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

function SettingsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.8v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 18.2v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M2.8 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18.2 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.5 5.5l2.1 2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.4 16.4l2.1 2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18.5 5.5l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.6 16.4l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
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
  onToggleSettings,
}: RoomHudProps) {
  return (
    <div className="room-hud">
      <div className="room-hud-mobile-bar">
        <div className="room-hud-mobile-topline">
          <button
            type="button"
            className={`room-hud-mobile-settings ${settingsOpen ? 'is-open' : ''}`}
            aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
            onClick={onToggleSettings}
          >
            <span className="room-hud-mobile-settings-icon-wrap" aria-hidden="true">
              <SettingsGlyph className="room-hud-mobile-settings-icon" />
            </span>
            <span className="room-hud-mobile-settings-label">
              {settingsOpen ? 'Close' : 'Options'}
            </span>
          </button>

          <div className="room-hud-mobile-identity">
            <div className="room-hud-mobile-title-row">
              <span className="room-hud-mobile-brand">Poker Night</span>
              <span className="room-hud-mobile-seated">{playerCount} seated</span>
            </div>
            <div className="room-hud-mobile-room-row">
              <span className="room-hud-mobile-room-label">Room</span>
              <span className="room-hud-mobile-room-code">{roomCode}</span>
            </div>
          </div>

          <div className={`room-hud-mobile-status ${isConnected ? 'is-live' : 'is-reconnecting'}`}>
            <span className="room-hud-mobile-status-dot" />
            <span>{isConnected ? 'Live' : 'Syncing'}</span>
          </div>
        </div>

        <div className="room-hud-mobile-toolbar">
          <span className="room-hud-mobile-pill">{isHost ? 'Host' : 'Player'}</span>
          <span className="room-hud-mobile-pill">{getPhaseLabel(phase)}</span>
          <span className="room-hud-mobile-pill room-hud-mobile-pill-strong">
            Blinds {smallBlind}/{bigBlind}
          </span>
        </div>
      </div>

      <div className="room-hud-main room-hud-share-panel">
        <div className="room-hud-code-row">
          <span className="room-brand-wordmark">Poker Night</span>
          <span className="room-code">{roomCode}</span>
        </div>
        <div className="room-hud-label">Table controls</div>
        <button
          type="button"
          className={`hud-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          onClick={onToggleSettings}
        >
          <span className="hud-settings-trigger-icon" aria-hidden="true">
            <SettingsGlyph className="hud-settings-trigger-glyph" />
          </span>
          <span className="hud-settings-trigger-label">
            {settingsOpen ? 'Close' : 'Settings'}
          </span>
        </button>
      </div>
    </div>
  )
}
