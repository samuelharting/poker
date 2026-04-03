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

function MenuGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="6.5" y="10" width="11" height="8.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 10V8.2a3 3 0 0 1 6 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
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
        <div className="room-hud-mobile-browser">
          <button
            type="button"
            className={`room-hud-mobile-settings ${settingsOpen ? 'is-open' : ''}`}
            aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
            onClick={onToggleSettings}
          >
            <span className="room-hud-mobile-settings-icon-wrap" aria-hidden="true">
              <MenuGlyph className="room-hud-mobile-settings-icon" />
            </span>
            <span className="room-hud-mobile-settings-label">Options</span>
          </button>

          <div className="room-hud-mobile-address">
            <span className="room-hud-mobile-address-lock" aria-hidden="true">
              <LockGlyph className="room-hud-mobile-address-lock-icon" />
            </span>
            <div className="room-hud-mobile-address-copy">
              <div className="room-hud-mobile-address-site">pokernight.app</div>
              <div className="room-hud-mobile-room">{roomCode}</div>
            </div>
          </div>

          <div className={`room-hud-mobile-status ${isConnected ? 'is-live' : 'is-reconnecting'}`}>
            <span className="room-hud-mobile-status-dot" />
            <span>{isConnected ? 'Live' : 'Syncing'}</span>
          </div>
        </div>

        <div className="room-hud-mobile-toolbar">
          <span className="room-hud-mobile-pill">{isHost ? 'Host view' : 'Player view'}</span>
          <span className="room-hud-mobile-pill">{playerCount} seated</span>
          <span className="room-hud-mobile-pill">{getPhaseLabel(phase)}</span>
          <span className="room-hud-mobile-pill room-hud-mobile-pill-strong">
            NLH {smallBlind}/{bigBlind}
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
