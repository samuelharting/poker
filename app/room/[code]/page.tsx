'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { PokerTable } from '@/components/table/PokerTable'
import { RoomHud } from '@/components/ui/RoomHud'
import { SystemToasts, type SystemToast, type SystemToastTone } from '@/components/ui/SystemToasts'
import { useRoom } from '@/hooks/useRoom'
import { isAllowedEmote, sanitizeText } from '@/shared/protocol'
import {
  loadStoredPlayerProfile,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerProfile,
} from '@/lib/profile'
import { normalizeRoomCode } from '@/lib/roomCode'
import type { ShowCardsMode } from '@/lib/poker/types'
import {
  DEFAULT_POKER_SOUND_PREFERENCES,
  loadPokerSoundPreferences,
  normalizePokerSoundPreferences,
  savePokerSoundPreferences,
  type PokerSoundPreferences,
} from '@/lib/poker/soundscape'
import { usePokerSoundscape } from '@/hooks/usePokerSoundscape'

export default function RoomPage() {
  const params = useParams()
  const code = normalizeRoomCode(typeof params.code === 'string' ? params.code : '')

  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileInput, setProfileInput] = useState<PlayerProfile>({
    nickname: '',
    email: '',
    venmoUsername: '',
  })
  const [profileError, setProfileError] = useState('')

  useEffect(() => {
    const storedProfile = loadStoredPlayerProfile()
    if (storedProfile) {
      setProfile(storedProfile)
      setProfileInput(storedProfile)
      return
    }

    const stored = sessionStorage.getItem('poker_nickname')
    if (stored) {
      setProfileInput(current => ({ ...current, nickname: stored }))
    }
  }, [])

  const handleSetProfile = useCallback(() => {
    const result = validatePlayerProfile(profileInput)
    if (!result.ok) {
      setProfileError(result.error)
      return
    }

    saveStoredPlayerProfile(result.profile)
    sessionStorage.setItem('poker_nickname', result.profile.nickname)
    setProfile(result.profile)
  }, [profileInput])

  if (!code) {
    return (
      <div className="landing-bg">
        <div className="card-panel entry-panel entry-panel-compact">
          <div className="entry-panel-header">
            <span className="entry-panel-kicker">Room unavailable</span>
            <h2>Invalid room code</h2>
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="landing-bg">
        <div className="landing-panel-wrap entry-panel-compact">
          <div className="card-panel entry-panel">
            <div className="entry-panel-header">
              <span className="entry-panel-kicker">Room {code}</span>
              <h2>Take your seat</h2>
            </div>

            {profileError && (
              <div className="entry-error" role="alert">{profileError}</div>
            )}

            <label className="entry-field">
              <span>Your nickname</span>
              <input
                type="text"
                className="input-dark"
                placeholder="e.g. PhilIvey"
                value={profileInput.nickname}
                onChange={e => setProfileInput(current => ({ ...current, nickname: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSetProfile()}
                maxLength={20}
                autoComplete="nickname"
                autoFocus
                suppressHydrationWarning
              />
            </label>

            <label className="entry-field">
              <span>Email</span>
              <input
                type="email"
                className="input-dark"
                placeholder="you@example.com"
                value={profileInput.email}
                onChange={e => setProfileInput(current => ({ ...current, email: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSetProfile()}
                autoComplete="email"
                suppressHydrationWarning
              />
            </label>

            <label className="entry-field">
              <span>Venmo username <em>Optional</em></span>
              <input
                type="text"
                className="input-dark"
                placeholder="@samvenmo"
                value={profileInput.venmoUsername}
                onChange={e => setProfileInput(current => ({ ...current, venmoUsername: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSetProfile()}
                maxLength={31}
                autoComplete="username"
                suppressHydrationWarning
              />
            </label>

            <button className="btn-gold" onClick={handleSetProfile}>
              Enter Room
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <GameRoom roomCode={code} profile={profile} />
}

function GameRoom({ roomCode, profile }: { roomCode: string; profile: PlayerProfile }) {
  const [shareUrl, setShareUrl] = useState('')
  const [startingStackSetting, setStartingStackSetting] = useState(1000)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [suitColorMode, setSuitColorMode] = useState<'two' | 'four'>('two')
  const [soundPreferences, setSoundPreferences] = useState<PokerSoundPreferences>({
    ...DEFAULT_POKER_SOUND_PREFERENCES,
  })
  const [soundPreferencesReady, setSoundPreferencesReady] = useState(false)
  const [systemToasts, setSystemToasts] = useState<SystemToast[]>([])

  const dismissSystemMessage = useCallback((id: string) => {
    setSystemToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  const pushSystemMessage = useCallback((message: string, tone: SystemToastTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setSystemToasts(current => [
      ...current.slice(-2),
      { id, message, tone },
    ])
    window.setTimeout(() => {
      dismissSystemMessage(id)
    }, tone === 'error' ? 7000 : 4500)
  }, [dismissSystemMessage])

  const { tableState, socialState, yourId, isHost, sendAction, seatMe, sendMessage, isConnected, connectionIssue } = useRoom(
    roomCode,
    profile,
    { onSystemMessage: pushSystemMessage }
  )
  const { playCue: playSoundCue } = usePokerSoundscape(tableState ?? undefined, yourId, {
    enabled: soundPreferencesReady,
    connected: isConnected,
    muted: soundPreferences.muted,
    volume: soundPreferences.volume,
  })

  useEffect(() => {
    setShareUrl(window.location.href)
  }, [])

  useEffect(() => {
    const storedStack = sessionStorage.getItem(`poker_starting_stack_${roomCode}`)
    const parsed = storedStack ? Number(storedStack) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      setStartingStackSetting(parsed)
    } else {
      setStartingStackSetting(1000)
    }
  }, [roomCode])

  useEffect(() => {
    const storedSuitMode = sessionStorage.getItem('poker_suit_color_mode')
    if (storedSuitMode === 'four' || storedSuitMode === 'two') {
      setSuitColorMode(storedSuitMode)
    }
  }, [])

  useEffect(() => {
    setSoundPreferences(loadPokerSoundPreferences())
    setSoundPreferencesReady(true)
  }, [])

  const canShareRoom = typeof navigator !== 'undefined' && (
    typeof navigator.share === 'function' ||
    typeof navigator.clipboard?.writeText === 'function'
  )

  const rememberStartingStack = useCallback((value: number) => {
    setStartingStackSetting(value)
    sessionStorage.setItem(`poker_starting_stack_${roomCode}`, String(value))
  }, [roomCode])

  const handleSuitColorMode = useCallback((mode: 'two' | 'four') => {
    setSuitColorMode(mode)
    sessionStorage.setItem('poker_suit_color_mode', mode)
  }, [])

  const updateSoundPreferences = useCallback((update: Partial<PokerSoundPreferences>) => {
    setSoundPreferences(current => {
      const next = normalizePokerSoundPreferences({ ...current, ...update })
      savePokerSoundPreferences(next)
      return next
    })
  }, [])

  const handleCopyRoom = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      pushSystemMessage('Room code copied.', 'success')
    } catch {
      pushSystemMessage('Unable to copy the room code.', 'error')
    }
  }, [pushSystemMessage, roomCode])

  const handleShareRoom = useCallback(async () => {
    if (!shareUrl) {
      return
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Poker room ${roomCode}`,
          text: `Join my poker table in room ${roomCode}.`,
          url: shareUrl,
        })
        pushSystemMessage('Room invite shared.', 'success')
        return
      }

      await navigator.clipboard.writeText(shareUrl)
      pushSystemMessage('Room link copied.', 'success')
    } catch {
      pushSystemMessage('Unable to share the room link.', 'error')
    }
  }, [pushSystemMessage, roomCode, shareUrl])

  const handleUpdateSettings = useCallback((settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => {
    if (typeof settings.startingStack === 'number' && Number.isFinite(settings.startingStack)) {
      rememberStartingStack(settings.startingStack)
    }
    sendMessage({ type: 'update_table_settings', ...settings })
  }, [rememberStartingStack, sendMessage])

  const handleSendChat = useCallback((message: string) => {
    const sanitized = sanitizeText(message)
    if (!sanitized) {
      return
    }
    sendMessage({ type: 'table_chat', message: sanitized })
  }, [sendMessage])

  const handleSendEmote = useCallback((emote: string) => {
    if (!isAllowedEmote(emote)) {
      return
    }
    sendMessage({ type: 'table_emote', emote })
  }, [sendMessage])

  return (
    <div className="room-shell">
      <RoomHud
        roomCode={roomCode}
        isConnected={isConnected}
        isHost={isHost}
        playerCount={tableState?.players.length ?? 0}
        smallBlind={tableState?.smallBlind ?? 10}
        bigBlind={tableState?.bigBlind ?? 20}
        phase={tableState?.phase ?? null}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen(current => !current)}
        soundMuted={soundPreferences.muted}
        onToggleSound={() => updateSoundPreferences({ muted: !soundPreferences.muted })}
      />

      <SystemToasts toasts={systemToasts} onDismiss={dismissSystemMessage} />

      {!isConnected && tableState && (
        <div className="room-connection-banner">
          Rejoining the table. Your seat and chips stay reserved while we reconnect.
        </div>
      )}

      {tableState ? (
        <PokerTable
          state={tableState}
          socialState={socialState}
          yourId={yourId}
          isHost={isHost}
          isConnected={isConnected}
          startingStackSetting={startingStackSetting}
          settingsOpen={settingsOpen}
          suitColorMode={suitColorMode}
          soundMuted={soundPreferences.muted}
          soundVolume={soundPreferences.volume}
          roomCode={roomCode}
          canShareRoom={canShareRoom}
          onAction={sendAction}
          onStartGame={() => sendMessage({ type: 'start_game' })}
          onAddBots={(count: number) => sendMessage({ type: 'add_bots', count })}
          onRabbitHunt={() => sendMessage({ type: 'rabbit_hunt' })}
          autoStartEnabled={tableState.autoStartEnabled ?? true}
          onSetAutoStart={enabled => sendMessage({ type: 'set_auto_start', enabled })}
          onUpdateSettings={handleUpdateSettings}
          onRemovePlayer={(targetId: string) => sendMessage({ type: 'remove_player', targetId })}
          onAdjustPlayerStack={(targetId: string, amount: number) =>
            sendMessage({ type: 'adjust_player_stack', targetId, amount })}
          onSetPlayerSpectator={(targetId: string, spectator: boolean) =>
            sendMessage({ type: 'set_player_spectator', targetId, spectator })}
          onSeatMe={seatMe}
          onSetShowCards={(mode: ShowCardsMode) => sendMessage({ type: 'set_show_cards', mode })}
          onSetSuitColorMode={handleSuitColorMode}
          onSetSoundMuted={muted => updateSoundPreferences({ muted })}
          onSetSoundVolume={volume => updateSoundPreferences({ volume })}
          onSoundCue={playSoundCue}
          onCloseSettings={() => setSettingsOpen(false)}
          onCopyRoom={handleCopyRoom}
          onShareRoom={handleShareRoom}
          onSendChat={handleSendChat}
          onSendTargetChat={(targetId: string, message: string) => {
            const sanitized = sanitizeText(message)
            if (!sanitized) {
              return
            }
            sendMessage({ type: 'table_chat', targetId, message: sanitized })
          }}
          onSendEmote={handleSendEmote}
          onSendTargetEmote={(targetId: string, emote: string) => {
            if (!isAllowedEmote(emote)) {
              return
            }
            sendMessage({ type: 'table_emote', targetId, emote })
          }}
          onFeedback={pushSystemMessage}
        />
      ) : (
        <div className="room-loading-state">
          <div className="room-loading-orb" />
          <div className="room-loading-copy">
            {connectionIssue
              ? 'Live table unavailable'
              : isConnected
                ? 'Loading table...'
                : 'Connecting...'}
          </div>
          <div className="room-loading-subcopy">
            {connectionIssue
              ? connectionIssue
              : isConnected
                ? 'Pulling the latest room snapshot.'
                : 'Opening a seat and restoring your last state.'}
          </div>
          {connectionIssue && (
            <button
              className="btn-gold"
              style={{ marginTop: '1.5rem' }}
              onClick={() => window.location.reload()}
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

    </div>
  )
}
