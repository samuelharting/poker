'use client'

/**
 * The 2D table's top bar (phones and the Chill room): plain white icon
 * buttons with tiny labels. Options opens the existing settings, Leave seat
 * moves you to the rail, Away sits you out; sound sits top right.
 */
interface TwoDToolbarProps {
  settingsOpen: boolean
  onToggleSettings: () => void
  isSeated: boolean
  isAway: boolean
  isConnected: boolean
  onLeaveSeat: () => void
  onToggleAway: () => void
  soundMuted: boolean
  onToggleSound: () => void
}

function MenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

function LeaveGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 9h5V5.5L21.5 12 16 18.5V15h-5z" fill="currentColor" />
    </svg>
  )
}

function AwayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="4.6" r="2.6" fill="currentColor" />
      <path d="M8.6 8.6h6.8a1.6 1.6 0 0 1 1.6 1.6v5.2h-2.3V22h-2.2v-5.6h-1V22H9.3v-6.6H7v-5.2a1.6 1.6 0 0 1 1.6-1.6Z" fill="currentColor" />
    </svg>
  )
}

function SoundGlyph({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 9.2h3.4L12.5 5.5v13L7.9 14.8H4.5z" fill="currentColor" />
      {muted ? (
        <path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      ) : (
        <>
          <path d="M15.8 9.2c1.2 1.5 1.2 4.1 0 5.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M18.6 6.6c2.8 2.9 2.8 7.9 0 10.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </>
      )}
    </svg>
  )
}

export function TwoDToolbar({
  settingsOpen,
  onToggleSettings,
  isSeated,
  isAway,
  isConnected,
  onLeaveSeat,
  onToggleAway,
  soundMuted,
  onToggleSound,
}: TwoDToolbarProps) {
  return (
    <nav className="pn-toolbar" aria-label="Table controls">
      <div className="pn-toolbar-left">
        <button
          type="button"
          className={`pn-tool ${settingsOpen ? 'is-active' : ''}`}
          aria-label={settingsOpen ? 'Close options' : 'Open options'}
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <MenuGlyph />
          <span>Options</span>
        </button>
        {isSeated && (
          <button
            type="button"
            className="pn-tool"
            disabled={!isConnected}
            onClick={onLeaveSeat}
          >
            <LeaveGlyph />
            <span>Leave seat</span>
          </button>
        )}
        {isSeated && (
          <button
            type="button"
            className={`pn-tool ${isAway ? 'is-active' : ''}`}
            aria-pressed={isAway}
            disabled={!isConnected}
            onClick={onToggleAway}
          >
            <AwayGlyph />
            <span>{isAway ? "I'm back" : 'Away'}</span>
          </button>
        )}
      </div>
      <button
        type="button"
        className={`pn-sound ${soundMuted ? 'is-muted' : ''}`}
        aria-label={soundMuted ? 'Unmute table sounds' : 'Mute table sounds'}
        aria-pressed={soundMuted}
        onClick={onToggleSound}
      >
        <SoundGlyph muted={soundMuted} />
      </button>
    </nav>
  )
}
