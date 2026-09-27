'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PokerTable } from '@/components/table/PokerTable'
import { RoomHud } from '@/components/ui/RoomHud'
import { LandingHeroArt } from '@/components/ui/LandingHeroArt'
import { NicknameField } from '@/components/ui/NicknameField'
import { clearStoredReconnectToken, loadStoredReconnectToken, useRoom } from '@/hooks/useRoom'
import { useIsTwoDLayout } from '@/lib/layoutMode'
import { isAllowedEmote, sanitizeText } from '@/shared/protocol'
import {
  DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  loadStoredPlayerProfile,
  normalizePlayerAvatarCustomization,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerAvatarCustomization,
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
import { useDrunkHallucination } from '@/hooks/useDrunkHallucination'
import { DrinkProvider } from '@/components/table/DrinkContext'
import { DrinkControls } from '@/components/table/DrinkControls'
import { DrinkToasts } from '@/components/table/DrinkToasts'
import { DrunkVisionLayer } from '@/components/table/DrunkVisionLayer'
import { MembershipLayer } from '@/components/ui/MembershipLayer'

const ignoreFeedback = () => {}

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
  // Until the stored profile has been read, show a neutral "Rejoining" screen
  // instead of flashing the nickname gate on reload.
  const [profileChecked, setProfileChecked] = useState(false)

  useEffect(() => {
    const storedProfile = loadStoredPlayerProfile()
    setProfileChecked(true)
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
      <main className="landing-bg landing-gate">
        <section className="card-panel gate-panel" aria-labelledby="gate-title">
          <span className="landing-kicker">Room unavailable</span>
          <h1 id="gate-title" className="gate-title">Invalid room code</h1>
          <p className="gate-copy">Double-check the code with your host, or start a new table.</p>
          <Link className="btn-gold entry-submit" href="/">Back to Poker Night</Link>
        </section>
      </main>
    )
  }

  if (!profile && !profileChecked) {
    return (
      <main className="landing-bg landing-gate" aria-busy="true">
        <div className="room-loading-state">
          <div className="room-loading-deal" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="landing-bg landing-gate">
        <section className="card-panel gate-panel" aria-labelledby="gate-title">
          <LandingHeroArt compact />
          <span className="landing-kicker">Poker Night</span>
          <h1 id="gate-title" className="gate-title">Take your seat</h1>
          <div className="gate-room-code" role="group" aria-label={`Room ${code}`}>
            <span className="gate-room-code-label" aria-hidden="true">Room</span>
            <span className="gate-room-code-tiles" aria-hidden="true">
              {code.split('').map((character, index) => (
                <b key={`${character}-${index}`}>{character}</b>
              ))}
            </span>
          </div>

          <div className="entry-panel">
            <NicknameField
              value={profileInput.nickname}
              placeholder="e.g. PhilIvey"
              autoFocus
              onChange={nickname => setProfileInput(current => ({ ...current, nickname }))}
              onSubmit={handleSetProfile}
            />

            {profileError && (
              <div className="entry-error" role="alert">{profileError}</div>
            )}

            <button className="btn-gold entry-submit" onClick={handleSetProfile}>
              Enter Room
            </button>
          </div>
          <p className="landing-footnote">
            <span>No sign-up</span>
            <span>Play money</span>
          </p>
        </section>
      </main>
    )
  }

  return <GameRoom roomCode={code} profile={profile} />
}

function GameRoom({ roomCode, profile }: { roomCode: string; profile: PlayerProfile }) {
  const [currentProfile, setCurrentProfile] = useState<PlayerProfile>(() => ({
    ...profile,
    avatar: normalizePlayerAvatarCustomization(profile.avatar),
  }))
  const [shareUrl, setShareUrl] = useState('')
  const [startingStackSetting, setStartingStackSetting] = useState(1000)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [suitColorMode, setSuitColorMode] = useState<'two' | 'four'>('two')
  const [soundPreferences, setSoundPreferences] = useState<PokerSoundPreferences>({
    ...DEFAULT_POKER_SOUND_PREFERENCES,
  })
  const [soundPreferencesReady, setSoundPreferencesReady] = useState(false)
  // A stored seat token means this is a reload or return: say so while we reconnect.
  const [isRejoining, setIsRejoining] = useState(false)
  useEffect(() => {
    setIsRejoining(Boolean(loadStoredReconnectToken(roomCode)))
  }, [roomCode])

  const { tableState, socialState, yourId, isHost, sendAction, seatMe, sendMessage, isConnected, connectionIssue, drinkEvents, orderDrink, sessionEnded, notices, dismissNotice } = useRoom(
    roomCode,
    currentProfile
  )
  // Drinks are a 3D-table feature: the 2D layout (phones, tablets) never shows them.
  const isTwoDLayout = useIsTwoDLayout()
  // Drunk players occasionally misread a freshly dealt card on their own screen only.
  const hallucinatedTableState = useDrunkHallucination(tableState, yourId)
  const displayTableState = isTwoDLayout ? tableState : hallucinatedTableState
  const { playCue: playSoundCue } = usePokerSoundscape(tableState ?? undefined, yourId, {
    enabled: soundPreferencesReady,
    connected: isConnected,
    muted: soundPreferences.muted,
    volume: soundPreferences.volume,
  })

  const handleLeaveGame = useCallback(() => {
    if (!window.confirm('Leave this game and return home?')) {
      return
    }

    sendMessage({ type: 'leave_room' })
    clearStoredReconnectToken(roomCode)
    window.setTimeout(() => window.location.assign('/'), 100)
  }, [roomCode, sendMessage])

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
    } catch {
      // Copy failures stay silent so the room never displays popup notifications.
    }
  }, [roomCode])

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
        return
      }

      await navigator.clipboard.writeText(shareUrl)
    } catch {
      // Sharing failures and cancellations stay silent by design.
    }
  }, [roomCode, shareUrl])

  const handleUpdateSettings = useCallback((settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
    funModeEnabled?: boolean
  }) => {
    if (typeof settings.startingStack === 'number' && Number.isFinite(settings.startingStack)) {
      rememberStartingStack(settings.startingStack)
    }
    sendMessage({ type: 'update_table_settings', ...settings })
  }, [rememberStartingStack, sendMessage])

  const handleUpdateAvatar = useCallback((avatar: PlayerAvatarCustomization) => {
    const normalizedAvatar = normalizePlayerAvatarCustomization(avatar)
    const savedProfile = saveStoredPlayerProfile({
      ...currentProfile,
      avatar: normalizedAvatar,
    })

    if (!savedProfile) {
      return
    }

    setCurrentProfile(savedProfile)
    sendMessage({ type: 'update_avatar', avatar: normalizedAvatar })
  }, [currentProfile, sendMessage])

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
    <DrinkProvider
      yourId={yourId}
      players={tableState?.players ?? []}
      events={drinkEvents}
      isConnected={isConnected}
      onOrder={orderDrink}
    >
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

      {tableState ? (
        <PokerTable
          state={displayTableState ?? tableState}
          socialState={socialState}
          yourId={yourId}
          isHost={isHost}
          isConnected={isConnected}
          startingStackSetting={startingStackSetting}
          settingsOpen={settingsOpen}
          suitColorMode={suitColorMode}
          soundMuted={soundPreferences.muted}
          soundVolume={soundPreferences.volume}
          avatarCustomization={currentProfile.avatar ?? DEFAULT_PLAYER_AVATAR_CUSTOMIZATION}
          roomCode={roomCode}
          canShareRoom={canShareRoom}
          onAction={sendAction}
          onStartGame={() => sendMessage({ type: 'start_game' })}
          onAddBots={(count: number) => sendMessage({ type: 'add_bots', count })}
          onRabbitHunt={() => sendMessage({ type: 'rabbit_hunt' })}
          onRunItTwiceVote={vote => sendMessage({ type: 'run_it_twice_vote', vote })}
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
          onRequestCardReveal={(targetId: string) => sendMessage({ type: 'request_card_reveal', targetId })}
          onRespondCardReveal={(requesterId: string, allow: boolean) =>
            sendMessage({ type: 'respond_card_reveal', requesterId, allow })}
          onSetSuitColorMode={handleSuitColorMode}
          onSetSoundMuted={muted => updateSoundPreferences({ muted })}
          onSetSoundVolume={volume => updateSoundPreferences({ volume })}
          onUpdateAvatar={handleUpdateAvatar}
          onSoundCue={playSoundCue}
          onPeekCards={peeking => sendMessage({ type: 'peek_cards', peeking })}
          onCloseSettings={() => setSettingsOpen(false)}
          onCopyRoom={handleCopyRoom}
          onShareRoom={handleShareRoom}
          onLeaveGame={handleLeaveGame}
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
          onFeedback={ignoreFeedback}
        />
      ) : (
        <div className="room-loading-state" data-issue={connectionIssue ? 'true' : 'false'}>
          <div className="room-loading-deal" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="room-loading-copy">
            {connectionIssue
              ? 'Live table unavailable'
              : isRejoining
                ? 'Rejoining…'
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
              className="btn-gold room-loading-retry"
              onClick={() => window.location.reload()}
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {tableState && !isTwoDLayout && (
        <>
          <DrunkVisionLayer />
          <DrinkControls variant="desktop" />
          <DrinkToasts />
        </>
      )}

      <MembershipLayer
        tableState={tableState}
        yourId={yourId}
        isConnected={isConnected}
        sessionEnded={sessionEnded}
        notices={notices}
        onDismissNotice={dismissNotice}
        onSetSittingOut={sittingOut => sendMessage({ type: 'set_sitting_out', sittingOut })}
      />
    </div>
    </DrinkProvider>
  )
}
