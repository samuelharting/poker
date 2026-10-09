'use client'

import { normalizeSceneMode, type SceneMode } from '@/components/three/sceneMode'
import { useThreeFallback } from '@/components/three/threeFallback'
import { useState, useEffect, useCallback } from 'react'
import { PokerTable } from '@/components/table/PokerTable'
import { RoomHud } from '@/components/ui/RoomHud'
import { LandingHeroArt } from '@/components/ui/LandingHeroArt'
import { NicknameField } from '@/components/ui/NicknameField'
import { clearStoredReconnectToken, loadStoredReconnectToken, useRoom } from '@/hooks/useRoom'
import { useIsTwoDLayout } from '@/lib/layoutMode'
import { isAllowedEmote, sanitizeText } from '@/shared/protocol'
import {
  DEFAULT_PLAYER_AVATAR_CUSTOMIZATION,
  applyTabNickname,
  loadStoredPlayerProfile,
  normalizePlayerAvatarCustomization,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerAvatarCustomization,
  type PlayerProfile,
} from '@/lib/profile'
import { TABLE_ROOM_CODE } from '@/lib/roomCode'
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
import { FunLayer } from '@/components/table/FunLayer'
import { MembershipLayer } from '@/components/ui/MembershipLayer'
import { LedgerLayer } from '@/components/ui/LedgerLayer'
import type { LedgerC2SMessage } from '@/components/table/LedgerPanel'

const ignoreFeedback = () => {}

export default function RoomPage() {
  // One table for the crew: any /room/<code> link opens it.
  const code = TABLE_ROOM_CODE

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
      // The profile is shared by every tab of this browser, but a tab keeps
      // the nickname it joined with: reloading it must not turn it into
      // whoever typed a name last in another tab.
      const tabProfile = applyTabNickname(storedProfile, sessionStorage.getItem('poker_nickname'))
      setProfile(tabProfile)
      setProfileInput(tabProfile)
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
  const [startingStackSetting, setStartingStackSetting] = useState(1000)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [suitColorMode, setSuitColorMode] = useState<'two' | 'four'>('two')
  const [sceneMode, setSceneMode] = useState<SceneMode>('classic')
  const [soundPreferences, setSoundPreferences] = useState<PokerSoundPreferences>({
    ...DEFAULT_POKER_SOUND_PREFERENCES,
  })
  const [soundPreferencesReady, setSoundPreferencesReady] = useState(false)
  // A stored seat token means this is a reload or return: say so while we reconnect.
  const [isRejoining, setIsRejoining] = useState(false)
  useEffect(() => {
    setIsRejoining(Boolean(loadStoredReconnectToken(roomCode)))
  }, [roomCode])

  const { tableState, socialState, yourId, isHost, sendAction, seatMe, sendMessage, isConnected, connectionIssue, drinkEvents, orderDrink, prankEvents, buyShot, flickChip, stickyNote, mushroomEvents, privateMushroom, spikeWater, sessionEnded, notices, dismissNotice } = useRoom(
    roomCode,
    currentProfile
  )
  // Drinks are a 3D-table feature: the 2D layout (phones, tablets) never shows them.
  // The Chill room is the same simple 2D table, even on a wide screen.
  // So is the fallback when this GPU cannot hold the 3D room (see threeFallback.ts).
  const threeFallback = useThreeFallback()
  const isTwoDLayout = useIsTwoDLayout() || sceneMode === 'chill' || threeFallback !== null
  // Drunk players occasionally misread a freshly dealt card on their own screen only.
  const hallucinatedTableState = useDrunkHallucination(tableState, yourId)
  const displayTableState = isTwoDLayout ? tableState : hallucinatedTableState
  const { playCue: playSoundCue } = usePokerSoundscape(tableState ?? undefined, yourId, {
    enabled: soundPreferencesReady,
    connected: isConnected,
    muted: soundPreferences.muted,
    volume: soundPreferences.volume,
  })

  // Only the desktop 3D table has drink controls; phones get none of the drinking or prank features.
  useEffect(() => {
    if (!yourId || !isConnected) return
    sendMessage({ type: 'set_drink_capable', capable: !isTwoDLayout })
  }, [isConnected, isTwoDLayout, sendMessage, yourId])

  const handleLeaveGame = useCallback(() => {
    if (!window.confirm('Leave this game and return home?')) {
      return
    }

    sendMessage({ type: 'leave_room' })
    clearStoredReconnectToken(roomCode)
    window.setTimeout(() => window.location.assign('/'), 100)
  }, [roomCode, sendMessage])

  const handleResetTable = useCallback(() => {
    sendMessage({ type: 'reset_table' })
  }, [sendMessage])

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
    setSceneMode(normalizeSceneMode(sessionStorage.getItem('poker_scene_mode')))
  }, [])

  useEffect(() => {
    setSoundPreferences(loadPokerSoundPreferences())
    setSoundPreferencesReady(true)
  }, [])

  const rememberStartingStack = useCallback((value: number) => {
    setStartingStackSetting(value)
    sessionStorage.setItem(`poker_starting_stack_${roomCode}`, String(value))
  }, [roomCode])

  // Mirror the setting on <html> too, so cards rendered outside the table scene
  // (portals, modals, toasts) get the same four-color suits.
  useEffect(() => {
    document.documentElement.dataset.suitColors = suitColorMode
    return () => { delete document.documentElement.dataset.suitColors }
  }, [suitColorMode])

  const handleSuitColorMode = useCallback((mode: 'two' | 'four') => {
    setSuitColorMode(mode)
    sessionStorage.setItem('poker_suit_color_mode', mode)
  }, [])

  const handleSceneMode = useCallback((mode: SceneMode) => {
    setSceneMode(mode)
    sessionStorage.setItem('poker_scene_mode', mode)
  }, [])

  const updateSoundPreferences = useCallback((update: Partial<PokerSoundPreferences>) => {
    setSoundPreferences(current => {
      const next = normalizePokerSoundPreferences({ ...current, ...update })
      savePokerSoundPreferences(next)
      return next
    })
  }, [])

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
    blindSchedule?: import('@/lib/poker/blindSchedule').BlindScheduleId
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

  const handleLedgerMessage = useCallback((message: LedgerC2SMessage) => {
    if (message.type === 'set_venmo') {
      // Remember the handle on this device so the next table knows it too.
      const savedProfile = saveStoredPlayerProfile({ ...currentProfile, venmoUsername: message.venmoUsername })
      if (savedProfile) {
        setCurrentProfile(savedProfile)
      }
    }
    sendMessage(message)
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
      serverNow={tableState?.serverNow}
      isConnected={isConnected}
      drinkingEnabled={tableState?.funModeEnabled !== false}
      onOrder={orderDrink}
      onTakeShot={() => sendMessage({ type: 'take_shot' })}
    >
    <div className="room-shell">
      <RoomHud
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
          sceneMode={sceneMode}
          soundMuted={soundPreferences.muted}
          soundVolume={soundPreferences.volume}
          avatarCustomization={currentProfile.avatar ?? DEFAULT_PLAYER_AVATAR_CUSTOMIZATION}
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
          onSetSceneMode={handleSceneMode}
          onSetSoundMuted={muted => updateSoundPreferences({ muted })}
          onSetSoundVolume={volume => updateSoundPreferences({ volume })}
          onUpdateAvatar={handleUpdateAvatar}
          onSoundCue={playSoundCue}
          onPeekCards={peeking => sendMessage({ type: 'peek_cards', peeking })}
          onCloseSettings={() => setSettingsOpen(false)}
          onLeaveGame={handleLeaveGame}
          onResetTable={handleResetTable}
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
          prankEvents={prankEvents}
          onBuyShot={buyShot}
          onFlickChip={flickChip}
          onStickyNote={stickyNote}
          onFeedback={ignoreFeedback}
          onSendLedgerMessage={handleLedgerMessage}
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
          <FunLayer
            tableState={tableState}
            yourId={yourId}
            privateMushroom={privateMushroom}
            mushroomEvents={mushroomEvents}
            onSpike={spikeWater}
            soundMuted={soundPreferences.muted}
          />

          <DrinkControls variant="desktop" handNumber={tableState.handNumber} />
          <DrinkToasts />
        </>
      )}

      <LedgerLayer
        tableState={tableState}
        yourId={yourId}
        roomCode={roomCode}
        isConnected={isConnected}
        isTwoDLayout={isTwoDLayout}
        settingsOpen={settingsOpen}
        onSendLedgerMessage={handleLedgerMessage}
      />

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
