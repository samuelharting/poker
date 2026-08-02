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
  soundMuted?: boolean
  onToggleSound?: () => void
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

function MenuGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SoundGlyph({ muted, className }: { muted: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 9.2h3.2L12.5 6v12l-4.3-3.2H5z" fill="currentColor" />
      {muted ? (
        <>
          <path d="m16.2 9.2 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="m20.4 9.2-4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M16 9.2c1.2 1.5 1.2 4.1 0 5.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M18.8 6.8c2.7 2.8 2.7 7.6 0 10.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

function formatHudAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

export function RoomHud({
  roomCode,
  isConnected,
  smallBlind,
  bigBlind,
  phase,
  settingsOpen,
  onToggleSettings,
  soundMuted = false,
  onToggleSound = () => {},
}: RoomHudProps) {
  return (
    <div className="room-hud" data-phase={phase ?? 'waiting'}>
      <div className="room-hud-mobile-bar">
        <div className="room-hud-mobile-topline">
          <button
            type="button"
            className={`room-hud-mobile-menu ${settingsOpen ? 'is-open' : ''}`}
            aria-label={settingsOpen ? 'Close table menu' : 'Open table menu'}
            onClick={onToggleSettings}
          >
            <span className="room-hud-mobile-menu-icon-wrap" aria-hidden="true">
              <MenuGlyph className="room-hud-mobile-menu-icon" />
            </span>
          </button>

          <div className="room-hud-mobile-identity">
            <div className="room-hud-mobile-game-pill">
              <span>NL Hold&apos;em</span>
              <ChevronGlyph className="room-hud-mobile-game-chevron" />
            </div>
            <div className="room-hud-mobile-stakes">
              {formatHudAmount(smallBlind)} / {formatHudAmount(bigBlind)}
            </div>
          </div>

          <div className="room-hud-mobile-actions">
            <button
              type="button"
              className={`room-hud-mobile-sound ${soundMuted ? 'is-muted' : 'is-on'}`}
              aria-label={soundMuted ? 'Unmute table sounds' : 'Mute table sounds'}
              aria-pressed={soundMuted}
              onClick={onToggleSound}
            >
              <SoundGlyph muted={soundMuted} className="room-hud-mobile-sound-icon" />
            </button>
            <button
              type="button"
              className={`room-hud-mobile-settings ${settingsOpen ? 'is-open' : ''} ${isConnected ? 'is-live' : 'is-reconnecting'}`}
              aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
              onClick={onToggleSettings}
            >
              <span className="room-hud-mobile-settings-icon-wrap" aria-hidden="true">
                <SettingsGlyph className="room-hud-mobile-settings-icon" />
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="room-hud-main room-hud-share-panel">
        <div className="room-hud-code-row">
          <span className="room-brand-wordmark">Poker Night</span>
          <div className="room-hud-room-pill">
            <span className="room-hud-room-label">Room</span>
            <span className="room-code">{roomCode}</span>
          </div>
        </div>
        <div className="room-hud-label">Table controls</div>
        <div className="room-hud-control-row">
          <button
            type="button"
            className={`hud-sound-trigger ${soundMuted ? 'is-muted' : 'is-on'}`}
            aria-label={soundMuted ? 'Unmute table sounds' : 'Mute table sounds'}
            aria-pressed={soundMuted}
            onClick={onToggleSound}
          >
            <SoundGlyph muted={soundMuted} className="hud-sound-trigger-glyph" />
            <span>{soundMuted ? 'Muted' : 'Sound'}</span>
          </button>
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
    </div>
  )
}
