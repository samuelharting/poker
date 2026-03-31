'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { TableState, SeatPlayer, LobbyPlayer, ShowCardsMode } from '@/lib/poker/types'
import type { SocialSnapshot } from '@/shared/protocol'
import { PlayerSeat } from './PlayerSeat'
import { CommunityCards } from './CommunityCards'
import { OwnHand } from './OwnHand'
import { PotDisplay } from './PotDisplay'

type FeedbackTone = 'info' | 'success' | 'error'

interface PokerTableProps {
  state: TableState
  socialState: SocialSnapshot
  yourId: string
  isHost: boolean
  isConnected: boolean
  startingStackSetting: number
  settingsOpen: boolean
  suitColorMode: 'two' | 'four'
  onAction: (
    action: 'fold' | 'check' | 'call' | 'raise' | 'all_in',
    amount?: number
  ) => void
  onStartGame: () => void
  onAddBots: (count: number) => void
  autoStartEnabled: boolean
  onSetAutoStart: (enabled: boolean) => void
  onUpdateSettings: (settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRebuy: (amount: number) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onSetShowCards: (mode: ShowCardsMode) => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onCloseSettings: () => void
  onSendChat: (message: string) => void
  onSendEmote: (emote: string) => void
  onSendTargetEmote: (targetId: string, emote: string) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}

interface SeatLayout {
  cssClass: string
  depthClass: 'seat-depth-near' | 'seat-depth-mid' | 'seat-depth-far' | 'seat-depth-top'
  opacity: number
}

interface OpponentSeat extends SeatPlayer {
  visualSeat: number
}

const SEAT_LAYOUTS: SeatLayout[] = [
  { cssClass: 'seat-0', depthClass: 'seat-depth-near', opacity: 1.0 },
  { cssClass: 'seat-1', depthClass: 'seat-depth-near', opacity: 0.97 },
  { cssClass: 'seat-2', depthClass: 'seat-depth-mid', opacity: 0.94 },
  { cssClass: 'seat-3', depthClass: 'seat-depth-far', opacity: 0.92 },
  { cssClass: 'seat-4', depthClass: 'seat-depth-top', opacity: 0.9 },
  { cssClass: 'seat-5', depthClass: 'seat-depth-far', opacity: 0.92 },
  { cssClass: 'seat-6', depthClass: 'seat-depth-mid', opacity: 0.94 },
  { cssClass: 'seat-7', depthClass: 'seat-depth-near', opacity: 0.97 },
]

const EMOTE_OPTIONS = [
  { id: 'wave', glyph: '\uD83D\uDC4B', label: 'Wave' },
  { id: 'thumbs_up', glyph: '\uD83D\uDC4D', label: 'Thumbs up' },
  { id: 'laugh', glyph: '\uD83D\uDE02', label: 'Laugh' },
  { id: 'middle_finger', glyph: '\uD83E\uDD95', label: 'Middle finger' },
] as const

const EMOJI_PICKER_OPTIONS = [
  '\uD83D\uDC4B', '\uD83D\uDC4D', '\uD83D\uDE02', '\uD83D\uDE0E', '\uD83D\uDE0F', '\uD83D\uDE31',
  '\uD83D\uDE2D', '\uD83D\uDE21', '\uD83D\uDE08', '\uD83D\uDC40', '\uD83E\uDD14', '\uD83E\uDEE1',
  '\uD83D\uDCB0', '\uD83D\uDCA5', '\uD83D\uDD25', '\uD83C\uDF89', '\uD83C\uDFC6', '\uD83E\uDD73',
  '\uD83E\uDD20', '\uD83E\uDD21', '\uD83D\uDC7B', '\uD83D\uDC7D', '\uD83E\uDD16', '\uD83D\uDC0D',
  '\uD83D\uDC2C', '\uD83D\uDC3A', '\uD83E\uDD8A', '\uD83D\uDC18', '\uD83D\uDC05', '\uD83E\uDD81',
  '\uD83D\uDC08', '\uD83D\uDC31', '\uD83D\uDC36', '\uD83E\uDD95', '\uD83C\uDF40', '\uD83C\uDFB2',
  '\uD83C\uDF0A', '\u2B50', '\uD83D\uDC8E', '\uD83C\uDFAF', '\uD83D\uDE80', '\uD83C\uDF1F',
  '\uD83E\uDEC0', '\uD83C\uDF55', '\uD83C\uDF7B', '\u2615', '\uD83C\uDF89', '\uD83D\uDC4F',
  '\uD83E\uDEF6', '\uD83E\uDEC7', '\uD83D\uDE4C', '\uD83D\uDE4F', '\uD83D\uDC8B', '\u2764\uFE0F',
  '\uD83E\uDDE0', '\uD83D\uDCAF', '\uD83C\uDF1A', '\uD83C\uDF1E', '\uD83D\uDCAB', '\uD83E\uDEAA',
] as const

type EmoteId = (typeof EMOTE_OPTIONS)[number]['id']

const SHOW_CARD_OPTIONS: Array<{ mode: ShowCardsMode; label: string }> = [
  { mode: 'none', label: 'Hide' },
  { mode: 'left', label: 'Show left' },
  { mode: 'right', label: 'Show right' },
  { mode: 'both', label: 'Show both' },
]

function getEmoteGlyph(emote?: string): string | undefined {
  return EMOTE_OPTIONS.find(option => option.id === emote)?.glyph ?? emote
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

export function PokerTable({
  state,
  socialState,
  yourId,
  isHost,
  isConnected,
  startingStackSetting,
  settingsOpen,
  suitColorMode,
  onAction,
  onStartGame,
  onAddBots,
  autoStartEnabled,
  onSetAutoStart,
  onUpdateSettings,
  onRebuy,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onSetShowCards,
  onSetSuitColorMode,
  onCloseSettings,
  onSendChat,
  onSendEmote,
  onSendTargetEmote,
  onFeedback,
}: PokerTableProps) {
  const me = state.players.find(player => player.id === yourId)
  const lobbyMe = state.lobbyPlayers.find(player => player.id === yourId)
  const isMyTurn = state.actingPlayerId === yourId
  const isInHand = state.phase === 'in_hand'
  const betweenHands = !isInHand
  const isSpectator = Boolean(lobbyMe?.isSpectator)
  const [socialTick, setSocialTick] = useState(() => Date.now())
  const [chatInput, setChatInput] = useState('')
  const [targetEmotePlayerId, setTargetEmotePlayerId] = useState<string | null>(null)
  const [targetEmotePickerOpen, setTargetEmotePickerOpen] = useState(false)

  const orderedOpponents = useMemo<OpponentSeat[]>(() => {
    if (!me) {
      return []
    }

    const mySeat = me.seatIndex
    return state.players
      .filter(player => player.id !== yourId)
      .map(player => ({
        ...player,
        visualSeat: (player.seatIndex - mySeat + 8) % 8,
      }))
      .sort((a, b) => a.visualSeat - b.visualSeat)
  }, [me, state.players, yourId])

  const toCall = me ? Math.min(state.currentBet - me.bet, me.stack) : 0
  const canCheck = me ? me.bet >= state.currentBet : false

  const legalActions = useMemo(() => {
    if (!isMyTurn || !me || me.status !== 'active' || !isConnected) {
      return []
    }

    const actions: Array<'fold' | 'check' | 'call' | 'raise' | 'all_in'> = ['fold']
    if (canCheck) {
      actions.push('check')
    } else if (toCall > 0) {
      actions.push('call')
    }
    if (me.stack > toCall) {
      actions.push('raise')
    }
    actions.push('all_in')
    return actions
  }, [canCheck, isConnected, isMyTurn, me, toCall])

  const maxRaise = me ? me.stack + me.bet : 0
  const effectiveMin = Math.min(state.minRaise, maxRaise)
  const [raiseAmount, setRaiseAmount] = useState(effectiveMin)

  useEffect(() => {
    if (maxRaise <= 0) {
      return
    }

    setRaiseAmount(current => {
      const nextAmount = Number.isFinite(current) ? current : effectiveMin
      return Math.max(effectiveMin, Math.min(maxRaise, nextAmount))
    })
  }, [effectiveMin, maxRaise])

  const quickBets = useMemo(() => {
    const bets: Array<{ label: string; amount: number }> = []
    if (!me || effectiveMin <= 0 || maxRaise <= 0) {
      return bets
    }

    const halfPot = Math.max(effectiveMin, Math.floor(state.totalPot / 2))
    const fullPot = Math.max(effectiveMin, state.totalPot)

    if (halfPot <= maxRaise) {
      bets.push({ label: 'Half pot', amount: halfPot })
    }

    if (fullPot <= maxRaise && fullPot !== halfPot) {
      bets.push({ label: 'Pot', amount: fullPot })
    }

    return bets
  }, [effectiveMin, maxRaise, me, state.totalPot])

  const handleRaise = useCallback(() => {
    if (!isConnected) {
      onFeedback('You are reconnecting. Raise is disabled until the table is live again.', 'error')
      return
    }

    onAction('raise', raiseAmount)
  }, [isConnected, onAction, onFeedback, raiseAmount])

  const timerPercent = useTimerPercent(
    state.actionTimerStart,
    state.actionTimerDuration
  )

  const showWinners =
    state.phase === 'between_hands' &&
    Array.isArray(state.winners) &&
    state.winners.length > 0

  useEffect(() => {
    const activeExpiries = socialState.active.flatMap(entry =>
      [entry.messageExpiresAt, entry.emoteExpiresAt].filter(
        (value): value is number => typeof value === 'number' && value > Date.now()
      )
    )

    if (activeExpiries.length === 0) {
      return
    }

    const nextExpiry = Math.min(...activeExpiries)
    const timeout = window.setTimeout(() => {
      setSocialTick(Date.now())
    }, Math.max(50, nextExpiry - Date.now() + 50))

    return () => window.clearTimeout(timeout)
  }, [socialState])

  const activeSocialByPlayer = useMemo(() => {
    const entries = new Map<string, {
      message?: string
      emote?: string
      messageExpiresAt?: number
      emoteExpiresAt?: number
    }>()

    for (const entry of socialState.active) {
      const nextEntry: {
        message?: string
        emote?: string
        messageExpiresAt?: number
        emoteExpiresAt?: number
      } = {}

      if (entry.message && entry.messageExpiresAt && entry.messageExpiresAt > socialTick) {
        nextEntry.message = entry.message
        nextEntry.messageExpiresAt = entry.messageExpiresAt
      }

      if (entry.emote && entry.emoteExpiresAt && entry.emoteExpiresAt > socialTick) {
        nextEntry.emote = getEmoteGlyph(entry.emote)
        nextEntry.emoteExpiresAt = entry.emoteExpiresAt
      }

      if (nextEntry.message || nextEntry.emote) {
        entries.set(entry.playerId, nextEntry)
      }
    }

    return entries
  }, [socialState.active, socialTick])

  const activeEmoteByPlayer = useMemo(() => {
    const entries = new Map<string, {
      emote?: string
      emoteExpiresAt?: number
      from?: string
    }>()

    for (const entry of socialState.active) {
      if (!entry.emote || !entry.emoteExpiresAt || entry.emoteExpiresAt <= socialTick) {
        continue
      }

      const targetId = (entry.targetPlayerId && entry.targetPlayerId.trim()) || entry.playerId
      if (!targetId) {
        continue
      }

      entries.set(targetId, {
        emote: getEmoteGlyph(entry.emote),
        emoteExpiresAt: entry.emoteExpiresAt,
        from: state.players.find(player => player.id === entry.playerId)?.nickname ?? 'Player',
      })
    }

    return entries
  }, [socialState.active, socialTick, state.players])

  const mySocial = activeSocialByPlayer.get(yourId)
  const targetedPlayer = targetEmotePlayerId
    ? state.players.find(player => player.id === targetEmotePlayerId)
    : null

  const latestChat = useMemo(() => socialState.chatLog.slice(-20), [socialState.chatLog])

  const handleTargetedEmote = useCallback((emote: string) => {
    if (!targetedPlayer) {
      onFeedback('Select a player before sending a targeted emote.', 'error')
      return
    }

    onSendTargetEmote(targetedPlayer.id, emote)
    onFeedback(`Sent ${emote} to ${targetedPlayer.nickname}`, 'success')
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [onFeedback, onSendTargetEmote, targetedPlayer])

  const closeTargetedEmote = useCallback(() => {
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [])

  return (
    <div className="table-scene" data-suit-colors={suitColorMode}>
      <div className="table-wrapper">
        <div className="table-surface">
          <CommunityCards cards={state.communityCards} round={state.round} />

          <PotDisplay
            totalPot={state.totalPot}
            pots={state.pots}
            currentBet={state.currentBet}
            toCall={isMyTurn ? Math.max(0, toCall) : 0}
          />

          {orderedOpponents.map(player => {
            const layout = SEAT_LAYOUTS[player.visualSeat] ?? SEAT_LAYOUTS[1]
            const seatSocial = activeSocialByPlayer.get(player.id) ?? {}
            const seatTargetEmote = activeEmoteByPlayer.get(player.id)
            return (
              <div
                key={player.id}
                className={`seat-position ${layout.cssClass}`}
              >
                <PlayerSeat
                  player={player}
                  isActing={state.actingPlayerId === player.id}
                  depthClass={layout.depthClass}
                  opacityValue={layout.opacity}
                  socialMessage={seatSocial.message}
                  socialEmote={seatSocial.emote}
                  socialMessageExpiresAt={seatSocial.messageExpiresAt}
                  socialEmoteExpiresAt={seatSocial.emoteExpiresAt}
                  socialEmoteFrom={seatTargetEmote?.from}
                  targetedSocialEmote={seatTargetEmote?.emote}
                  targetedSocialEmoteFrom={seatTargetEmote?.from}
                  targetedSocialEmoteExpiresAt={seatTargetEmote?.emoteExpiresAt}
                  onNameClick={playerId => {
                    setTargetEmotePlayerId(playerId)
                    setTargetEmotePickerOpen(false)
                  }}
                />
              </div>
            )
          })}

        {showWinners && (
          <WinnersOverlay
            winners={state.winners ?? []}
            players={state.players}
            yourId={yourId}
            handNumber={state.handNumber}
            bounty={state.bounty}
          />
        )}
        </div>

        {me && me.holeCards && me.holeCards.length > 0 && (
          <OwnHand cards={me.holeCards} isActing={isMyTurn} />
        )}

        {me && (
          <div className="hero-inline-status">
            <span className="table-chip table-chip-soft">{formatAmount(me.stack)}</span>
            {me.isDealer && <span className="table-chip">Dealer</span>}
            {me.isSB && <span className="table-chip">SB</span>}
            {me.isBB && <span className="table-chip">BB</span>}
            {isMyTurn && <span className="table-chip table-chip-soft">Your action</span>}
            {!isConnected && <span className="table-chip chip-warning">Reconnecting</span>}
            {!isInHand && me.holeCards && me.holeCards.length > 0 && (
              <ShowCardsControl
                mode={me.showCards}
                isConnected={isConnected}
                onChangeMode={onSetShowCards}
              />
            )}
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          state={state}
          yourId={yourId}
          isHost={isHost}
          isConnected={isConnected}
          suitColorMode={suitColorMode}
          onClose={onCloseSettings}
          onSetSuitColorMode={onSetSuitColorMode}
          onUpdateSettings={onUpdateSettings}
          onRemovePlayer={onRemovePlayer}
          onAdjustPlayerStack={onAdjustPlayerStack}
          onSetPlayerSpectator={onSetPlayerSpectator}
          onFeedback={onFeedback}
        />
      )}

      {isInHand && isMyTurn && me && legalActions.length > 0 && (
        <div className="betting-tray">
          <div className="timer-bar">
            <div
              className={`timer-bar-fill ${timerPercent < 20 ? 'timer-low' : ''}`}
              style={{ width: `${timerPercent}%` }}
            />
          </div>

          {legalActions.includes('raise') && effectiveMin > 0 && (
            <div className="raise-slider-row">
              <div className="raise-quick-btns">
                <button
                  type="button"
                  className="btn-quick"
                  onClick={() => setRaiseAmount(effectiveMin)}
                >
                  Min
                </button>
                {quickBets.map(quickBet => (
                  <button
                    key={quickBet.label}
                    type="button"
                    className="btn-quick"
                    onClick={() => setRaiseAmount(quickBet.amount)}
                  >
                    {quickBet.label}
                  </button>
                ))}
              </div>

              <input
                type="range"
                className="raise-slider"
                min={effectiveMin}
                max={maxRaise}
                step={Math.max(state.bigBlind, 1)}
                value={raiseAmount}
                onChange={event => setRaiseAmount(Number(event.target.value))}
              />

              <input
                type="number"
                className="raise-input"
                min={effectiveMin}
                max={maxRaise}
                value={raiseAmount}
                onChange={event => {
                  const nextValue = Number(event.target.value)
                  if (!Number.isFinite(nextValue)) {
                    return
                  }

                  setRaiseAmount(Math.max(effectiveMin, Math.min(maxRaise, nextValue)))
                }}
              />
            </div>
          )}

          <div className="bet-action-row">
            {legalActions.includes('fold') && (
              <button
                type="button"
                className="btn-action btn-fold"
                onClick={() => onAction('fold')}
              >
                Fold
              </button>
            )}

            {legalActions.includes('check') && (
              <button
                type="button"
                className="btn-action btn-check"
                onClick={() => onAction('check')}
              >
                Check
              </button>
            )}

            {legalActions.includes('call') && (
              <button
                type="button"
                className="btn-action btn-call"
                onClick={() => onAction('call')}
              >
                Call {formatAmount(toCall)}
              </button>
            )}

            {legalActions.includes('raise') && (
              <button
                type="button"
                className="btn-action btn-raise"
                onClick={handleRaise}
              >
                Raise {formatAmount(raiseAmount)}
              </button>
            )}

            {legalActions.includes('all_in') && (
              <button
                type="button"
                className="btn-action btn-raise"
                onClick={() => onAction('all_in')}
              >
                All-in {formatAmount(me.stack + me.bet)}
              </button>
            )}
          </div>
        </div>
      )}

          {betweenHands && (
            <div className="table-side-panels">
              {isHost ? (
                <HostControls
                  state={state}
                  yourId={yourId}
                  isConnected={isConnected}
                  startingStackSetting={startingStackSetting}
                  onStartGame={onStartGame}
                  onAddBots={onAddBots}
                  onFeedback={onFeedback}
                />
              ) : (
            <WaitingPanel
              state={state}
              me={me}
              lobbyMe={lobbyMe}
              isConnected={isConnected}
            />
          )}

              {me && (
                <RebuyPanel
                  me={me}
                  bigBlind={state.bigBlind}
                  startingStackSetting={startingStackSetting}
              canInteract={isConnected}
              onRebuy={onRebuy}
              onFeedback={onFeedback}
                />
              )}
            </div>
          )}

          <div className="table-side-panels chat-dock">
            <ChatPanel
              entries={latestChat}
              chatInput={chatInput}
              isConnected={isConnected}
              mySeatId={yourId}
              mySocial={mySocial}
              onSubmit={value => {
                const trimmed = value.trim()
                if (!trimmed) {
                  onFeedback('Type a message before sending.', 'error')
                  return
                }
                onSendChat(trimmed)
                setChatInput('')
              }}
              onChange={setChatInput}
              onSendEmote={onSendEmote}
              emotes={EMOTE_OPTIONS}
            />

            {targetedPlayer && (
              <TargetedEmotePanel
                target={targetedPlayer}
                isConnected={isConnected}
                onSendEmote={handleTargetedEmote}
                onClose={closeTargetedEmote}
                fullPickerOpen={targetEmotePickerOpen}
                onToggleFullPicker={() => setTargetEmotePickerOpen(current => !current)}
              />
            )}
          </div>
    </div>
  )
}

function ChatPanel({
  entries,
  chatInput,
  mySeatId,
  isConnected,
  mySocial,
  onSubmit,
  onChange,
  onSendEmote,
  emotes,
}: {
  entries: Array<{ id: string; playerId: string; nickname: string; message: string; createdAt: number }>
  chatInput: string
  mySeatId: string
  isConnected: boolean
  mySocial?: { message?: string; emote?: string }
  onSubmit: (value: string) => void
  onChange: (value: string) => void
  onSendEmote: (emote: string) => void
  emotes: readonly { id: EmoteId; glyph: string; label: string }[]
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const hasInput = chatInput.trim().length > 0

  return (
    <aside className="table-panel chat-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Table chat</div>
          <div className="table-panel-title">Social</div>
        </div>
        {mySocial?.message || mySocial?.emote ? (
          <span className="table-chip table-chip-soft">Your message is visible overhead</span>
        ) : null}
      </div>

      <div className="chat-log">
        {entries.length === 0 && <div className="chat-empty">No messages yet.</div>}
        {entries.map(entry => (
          <div key={entry.id} className="chat-entry">
            <div className="chat-entry-name">
              {entry.playerId === mySeatId ? 'You' : entry.nickname}
            </div>
            <div className="chat-entry-body">{entry.message}</div>
          </div>
        ))}
      </div>

      <form
        className="chat-compose"
        onSubmit={event => {
          event.preventDefault()
          onSubmit(chatInput)
        }}
      >
        <input
          type="text"
          value={chatInput}
          maxLength={140}
          placeholder={isConnected ? 'Send a table chat...' : 'Reconnecting...'}
          onChange={event => onChange(event.target.value)}
          disabled={!isConnected}
        />
        <button
          type="submit"
          className="btn-subtle btn-subtle-gold"
          disabled={!isConnected || !hasInput}
        >
          Send
        </button>
      </form>

      <div className="chat-emotes">
        {emotes.map(item => (
          <button
            key={item.id}
            type="button"
            className="emote-button"
            title={item.label}
            onClick={() => onSendEmote(item.glyph)}
            disabled={!isConnected}
          >
            {item.glyph}
          </button>
        ))}
        <button
          type="button"
          className={`emote-picker-toggle ${emojiPickerOpen ? 'is-open' : ''}`}
          disabled={!isConnected}
          onClick={() => setEmojiPickerOpen(current => !current)}
        >
          Choose emoji
        </button>
      </div>

      {emojiPickerOpen && (
        <div className="emoji-picker-panel" role="listbox" aria-label="Choose an emoji">
          {EMOJI_PICKER_OPTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              className="emoji-picker-option"
              onClick={() => {
                onSendEmote(emoji)
                setEmojiPickerOpen(false)
              }}
              disabled={!isConnected}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

function ShowCardsControl({
  mode,
  isConnected,
  onChangeMode,
}: {
  mode: ShowCardsMode
  isConnected: boolean
  onChangeMode: (mode: ShowCardsMode) => void
}) {
  return (
    <div className="hero-card-toggle" role="radiogroup" aria-label="Select card visibility">
      {SHOW_CARD_OPTIONS.map(option => (
        <button
          key={option.mode}
          type="button"
          className={`hero-inline-button ${mode === option.mode ? 'btn-subtle-gold' : 'btn-subtle'}`}
          onClick={() => onChangeMode(option.mode)}
          disabled={!isConnected}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TargetedEmotePanel({
  target,
  isConnected,
  onSendEmote,
  onClose,
  fullPickerOpen,
  onToggleFullPicker,
}: {
  target: SeatPlayer
  isConnected: boolean
  onSendEmote: (emote: string) => void
  onClose: () => void
  fullPickerOpen: boolean
  onToggleFullPicker: () => void
}) {
  return (
    <aside className="table-panel targeted-emote-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Target emoji</div>
          <div className="table-panel-title">Send to {target.nickname}</div>
        </div>
        <button
          type="button"
          className="targeted-emote-close"
          onClick={onClose}
          aria-label="Close target emote panel"
        >
          ×
        </button>
      </div>

      <div className="chat-emotes">
        {EMOJI_PICKER_OPTIONS.slice(0, 10).map(emoji => (
          <button
            key={emoji}
            type="button"
            className="emote-button"
            onClick={() => onSendEmote(emoji)}
            disabled={!isConnected}
            title={`Send ${emoji} to ${target.nickname}`}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className={`emote-picker-toggle ${fullPickerOpen ? 'is-open' : ''}`}
          disabled={!isConnected}
          onClick={onToggleFullPicker}
        >
          {fullPickerOpen ? 'Hide all emojis' : 'Choose any emoji'}
        </button>
      </div>

      {fullPickerOpen && (
        <div className="emoji-picker-panel targeted-emote-picker" role="listbox" aria-label="Choose an emoji">
          {EMOJI_PICKER_OPTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              className="emoji-picker-option"
              onClick={() => onSendEmote(emoji)}
              disabled={!isConnected}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

function useTimerPercent(timerStart: number | null, duration: number): number {
  const [percent, setPercent] = useState(100)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!timerStart) {
      setPercent(100)
      return
    }

    const tick = () => {
      const elapsed = Date.now() - timerStart
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setPercent(remaining)
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [duration, timerStart])

  return percent
}

function WinnersOverlay({
  winners,
  players,
  yourId,
  handNumber,
  bounty,
}: {
  winners: Array<{ playerId: string; amount: number; handDescription?: string }>
  players: SeatPlayer[]
  yourId: string
  handNumber: number
  bounty?: {
    active: boolean
    amount: number
    contributors: string[]
    recipientPlayerIds: string[]
    reason: string
  }
}) {
  const totalAwarded = winners.reduce((sum, winner) => sum + winner.amount, 0)
  const heroWon = winners.some(winner => winner.playerId === yourId)
  const title =
    winners.length === 1
      ? heroWon
        ? 'You scoop the pot'
        : 'Hand complete'
      : heroWon
        ? 'You share the pot'
        : 'Split pot'

  return (
    <div className="winners-overlay">
      <div className="winners-card">
        <div className="winners-kicker">Hand #{handNumber} complete</div>
        <div className="winners-title">{title}</div>
        <div className="winners-total">{formatAmount(totalAwarded)} awarded</div>

        <div className="winners-list">
          {winners.map(winner => {
            const player = players.find(playerEntry => playerEntry.id === winner.playerId)
            const isHero = winner.playerId === yourId

            return (
              <div
                key={winner.playerId}
                className={`winner-row ${isHero ? 'is-hero' : ''}`}
              >
                <div>
                  <div className="winner-name">
                    {isHero ? 'You' : player?.nickname ?? 'Unknown player'}
                  </div>
                  {winner.handDescription && (
                    <div className="winner-hand">{winner.handDescription}</div>
                  )}
                </div>
                <div className="winner-amount">{formatAmount(winner.amount)}</div>
              </div>
            )
          })}
        </div>

        {bounty?.active && bounty.reason ? (
          <div className="winners-footnote">
            {bounty.reason}
          </div>
        ) : null}

        <div className="winners-footnote">
          Host can adjust blinds or deal again when everyone is ready.
        </div>
      </div>
    </div>
  )
}

function SettingsModal({
  state,
  yourId,
  isHost,
  isConnected,
  suitColorMode,
  onClose,
  onSetSuitColorMode,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onFeedback,
}: {
  state: TableState
  yourId: string
  isHost: boolean
  isConnected: boolean
  suitColorMode: 'two' | 'four'
  onClose: () => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onUpdateSettings: (settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'players'>(isHost ? 'general' : 'general')
  const [showSevenTwoCustomize, setShowSevenTwoCustomize] = useState(false)
  const [chipDrafts, setChipDrafts] = useState<Record<string, number>>({})
  const [draft, setDraft] = useState(() => ({
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    startingStack: state.startingStack,
    actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
    autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
    sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
    sevenTwoBountyPercent: state.sevenTwoBountyPercent,
  }))

  useEffect(() => {
    setDraft({
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      startingStack: state.startingStack,
      actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
      autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
      sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
      sevenTwoBountyPercent: state.sevenTwoBountyPercent,
    })
  }, [
    state.actionTimerDuration,
    state.autoStartDelay,
    state.bigBlind,
    state.sevenTwoBountyPercent,
    state.sevenTwoRuleEnabled,
    state.smallBlind,
    state.startingStack,
  ])

  const hasSettingsChanges =
    draft.smallBlind !== state.smallBlind ||
    draft.bigBlind !== state.bigBlind ||
    draft.startingStack !== state.startingStack ||
    draft.actionTimerSeconds * 1000 !== state.actionTimerDuration ||
    draft.autoStartDelaySeconds * 1000 !== (state.autoStartDelay ?? 5000) ||
    draft.sevenTwoRuleEnabled !== state.sevenTwoRuleEnabled ||
    draft.sevenTwoBountyPercent !== state.sevenTwoBountyPercent

  const getPlayerChipDraft = (playerId: string) => {
    const draftValue = chipDrafts[playerId]
    if (typeof draftValue === 'number' && Number.isFinite(draftValue) && draftValue > 0) {
      return draftValue
    }

    return Math.max(state.bigBlind, 100)
  }

  const saveGeneralSettings = () => {
    const smallBlind = Math.max(1, Math.floor(draft.smallBlind))
    const bigBlind = Math.max(smallBlind, Math.floor(draft.bigBlind))
    const startingStack = Math.max(bigBlind * 10, Math.floor(draft.startingStack))
    const actionTimerDuration = Math.min(60000, Math.max(5000, Math.floor(draft.actionTimerSeconds) * 1000))
    const autoStartDelay = Math.min(30000, Math.max(1000, Math.floor(draft.autoStartDelaySeconds) * 1000))
    const sevenTwoBountyPercent = Math.min(100, Math.max(0, Number(draft.sevenTwoBountyPercent)))

    if (!Number.isFinite(smallBlind) || !Number.isFinite(bigBlind) || !Number.isFinite(startingStack)) {
      onFeedback('Enter valid blinds and stack sizes before saving.', 'error')
      return
    }

    onUpdateSettings({
      smallBlind,
      bigBlind,
      startingStack,
      actionTimerDuration,
      autoStartDelay,
      sevenTwoRuleEnabled: draft.sevenTwoRuleEnabled,
      sevenTwoBountyPercent,
    })
    onFeedback('Updated table settings for upcoming action.', 'success')
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={event => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div>
            <div className="table-panel-kicker">Table settings</div>
            <div className="table-panel-title">{isHost ? 'Host controls and personal preferences' : 'Personal preferences'}</div>
          </div>
          <button type="button" className="btn-subtle" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-tabs">
          <button
            type="button"
            className={`settings-tab ${activeTab === 'general' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          {isHost && (
            <button
              type="button"
              className={`settings-tab ${activeTab === 'players' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('players')}
            >
              Players
            </button>
          )}
        </div>

        {activeTab === 'general' && (
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Cards</div>
              <div className="settings-section-copy">
                Suit colors are personal, so every player can choose the card palette they like.
              </div>
              <div className="settings-toggle-row">
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'two' ? 'is-active' : ''}`}
                  onClick={() => onSetSuitColorMode('two')}
                >
                  2-color suits
                </button>
                <button
                  type="button"
                  className={`settings-pill ${suitColorMode === 'four' ? 'is-active' : ''}`}
                  onClick={() => onSetSuitColorMode('four')}
                >
                  4-color suits
                </button>
              </div>
            </div>

            {isHost && (
              <>
                <div className="settings-section">
                  <div className="settings-section-title">Blinds and buy-in</div>
                  <div className="settings-grid settings-grid-modal">
                    <label className="settings-field">
                      <span>Small blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.smallBlind}
                        onChange={event => setDraft(current => ({ ...current, smallBlind: Number(event.target.value) || current.smallBlind }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Big blind</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.bigBlind}
                        onChange={event => setDraft(current => ({ ...current, bigBlind: Number(event.target.value) || current.bigBlind }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Starting stack</span>
                      <input
                        type="number"
                        min={10}
                        step={10}
                        value={draft.startingStack}
                        onChange={event => setDraft(current => ({ ...current, startingStack: Number(event.target.value) || current.startingStack }))}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Timing</div>
                  <div className="settings-grid settings-grid-modal">
                    <label className="settings-field">
                      <span>Action timer (seconds)</span>
                      <input
                        type="number"
                        min={5}
                        max={60}
                        step={1}
                        value={draft.actionTimerSeconds}
                        onChange={event => setDraft(current => ({ ...current, actionTimerSeconds: Number(event.target.value) || current.actionTimerSeconds }))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Next hand delay (seconds)</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        step={1}
                        value={draft.autoStartDelaySeconds}
                        onChange={event => setDraft(current => ({ ...current, autoStartDelaySeconds: Number(event.target.value) || current.autoStartDelaySeconds }))}
                      />
                    </label>
                  </div>
                  <div className="settings-section-copy">
                    If time runs out the acting player auto-checks when possible, otherwise auto-folds. New hands always auto-deal after the delay above.
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">7 / 2 rule</div>
                  <div className="settings-toggle-row">
                    <button
                      type="button"
                      className={`settings-pill ${draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, sevenTwoRuleEnabled: true }))}
                    >
                      On
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${!draft.sevenTwoRuleEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, sevenTwoRuleEnabled: false }))}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${showSevenTwoCustomize ? 'is-active' : ''}`}
                      onClick={() => setShowSevenTwoCustomize(current => !current)}
                    >
                      Customize
                    </button>
                  </div>
                  {showSevenTwoCustomize && (
                    <div className="settings-grid settings-grid-modal">
                      <label className="settings-field">
                        <span>Bounty % of original buy-in</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={draft.sevenTwoBountyPercent}
                          onChange={event => setDraft(current => ({
                            ...current,
                            sevenTwoBountyPercent: Number(event.target.value) || 0,
                          }))}
                        />
                      </label>
                    </div>
                  )}
                  <div className="settings-section-copy">
                    When active, each eligible opponent pays this percent of the table starting stack to any winning 7/2 hand.
                  </div>
                </div>

                <div className="settings-footer">
                  <button
                    type="button"
                    className="btn-subtle"
                    disabled={!hasSettingsChanges || !isConnected}
                    onClick={() => setDraft({
                      smallBlind: state.smallBlind,
                      bigBlind: state.bigBlind,
                      startingStack: state.startingStack,
                      actionTimerSeconds: Math.max(1, Math.floor(state.actionTimerDuration / 1000)),
                      autoStartDelaySeconds: Math.max(1, Math.floor((state.autoStartDelay ?? 5000) / 1000)),
                      sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
                      sevenTwoBountyPercent: state.sevenTwoBountyPercent,
                    })}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn-subtle btn-subtle-gold"
                    disabled={!hasSettingsChanges || !isConnected}
                    onClick={saveGeneralSettings}
                  >
                    Save host settings
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'players' && isHost && (
          <div className="settings-modal-body">
            <div className="settings-section">
              <div className="settings-section-title">Player list</div>
              <div className="settings-section-copy">
                Change chips, kick players, or move them in and out of spectator mode any time. Mid-hand spectator moves fold the player out and seat them in the rail for the next deal.
              </div>
            </div>

            <div className="settings-player-list">
              {state.lobbyPlayers.map(player => {
                const manageAmount = Math.max(state.bigBlind, Math.floor(getPlayerChipDraft(player.id)))

                return (
                <div key={player.id} className="settings-player-row">
                  <div>
                    <div className="host-player-name">
                      {player.id === yourId ? `${player.nickname} (you)` : player.nickname}
                    </div>
                    <div className="host-player-meta">
                      {formatAmount(player.stack)} {'\u00b7'} {player.status.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="settings-player-actions">
                    <label className="settings-field settings-player-chip-input">
                      <span>Chips</span>
                      <input
                        type="number"
                        min={state.bigBlind}
                        step={state.bigBlind}
                        value={getPlayerChipDraft(player.id)}
                        onChange={event => {
                          const nextValue = Number(event.target.value)
                          setChipDrafts(current => ({
                            ...current,
                            [player.id]: Number.isFinite(nextValue) && nextValue > 0
                              ? nextValue
                              : state.bigBlind,
                          }))
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => {
                        onAdjustPlayerStack(player.id, manageAmount)
                        onFeedback(`Added ${formatAmount(manageAmount)} to ${player.nickname}.`, 'info')
                      }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => {
                        onAdjustPlayerStack(player.id, -manageAmount)
                        onFeedback(`Removed ${formatAmount(manageAmount)} from ${player.nickname}.`, 'info')
                      }}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => {
                        onSetPlayerSpectator(player.id, !player.isSpectator)
                        onFeedback(
                          player.isSpectator
                            ? `Moved ${player.nickname} back toward a seat.`
                            : `Moved ${player.nickname} to spectator mode.`,
                          'info'
                        )
                      }}
                    >
                      {player.isSpectator ? 'Seat back' : 'Spectate'}
                    </button>
                    {player.id !== yourId ? (
                      <button
                        type="button"
                        className="btn-subtle btn-subtle-danger"
                        disabled={!isConnected}
                        onClick={() => {
                          onRemovePlayer(player.id)
                          onFeedback(`Requested removal for ${player.nickname}.`, 'info')
                        }}
                      >
                        Kick
                      </button>
                    ) : (
                      <span className="table-chip">Host</span>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function HostControls({
  state,
  yourId,
  isConnected,
  startingStackSetting,
  onStartGame,
  onAddBots,
  onFeedback,
}: {
  state: TableState
  yourId: string
  isConnected: boolean
  startingStackSetting: number
  onStartGame: () => void
  onAddBots: (count: number) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const seatedCount = state.players.length
  const canStart = seatedCount >= 2 && isConnected

  return (
    <div className="table-panel host-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Host controls</div>
          <div className="table-panel-title">Table flow</div>
        </div>
        <div className="table-chip">{seatedCount} seated</div>
      </div>

      <div className="table-panel-note">
        Auto-deal is always on now. Use Settings for blinds, player management, 7/2 rules, suit colors, and timers.
      </div>

      <div className="table-panel-note">
        Current buy-in baseline: {formatAmount(startingStackSetting)}. Auto-deal restarts once at least two seated players have chips.
      </div>

      <div className="table-panel-actions">
        <button
          type="button"
          className="btn-subtle btn-subtle-gold"
          disabled={!isConnected || seatedCount >= 8}
          onClick={() => {
            onAddBots(1)
            onFeedback('Added 1 local bot.', 'info')
          }}
        >
          Add bot
        </button>
        <button
          type="button"
          className="btn-subtle btn-subtle-gold"
          disabled={!isConnected || seatedCount >= 8}
          onClick={() => {
            onAddBots(8 - seatedCount)
            onFeedback('Added local bots for testing.', 'info')
          }}
        >
          Fill with bots
        </button>
      </div>

      <button
        type="button"
        className="btn-gold host-start-button"
        disabled={!canStart}
        onClick={() => {
          if (!canStart) {
            onFeedback('You need at least two connected players with chips to deal.', 'error')
            return
          }
          onStartGame()
        }}
      >
        {state.phase === 'between_hands' ? 'Deal next hand' : 'Start game'}
      </button>

      <div className="table-panel-note">
        Host controls stay in between-hands mode.
      </div>

      <div className="table-panel-note">
        {canStart
          ? 'Table is ready when you are.'
          : isConnected
            ? `Waiting for ${Math.max(0, 2 - seatedCount)} more seated player${seatedCount === 1 ? '' : 's'}.`
            : 'Controls unlock once the table reconnects.'}
      </div>
    </div>
  )
}

function WaitingPanel({
  state,
  me,
  lobbyMe,
  isConnected,
}: {
  state: TableState
  me?: SeatPlayer
  lobbyMe?: LobbyPlayer
  isConnected: boolean
}) {
  const hasEnoughPlayers = state.players.length >= 2
  const statusText = !isConnected
    ? 'Rejoining your seat and waiting for the table snapshot.'
    : lobbyMe?.isSpectator
      ? 'You are in spectator mode and watching the table.'
    : !hasEnoughPlayers
      ? 'Waiting for at least one more player to sit down.'
      : state.winners && state.winners.length > 0
        ? 'Host is setting up the next hand after showdown.'
        : 'Waiting for the host to deal the next hand.'

  return (
    <div className="table-panel status-panel">
      <div className="table-panel-kicker">Table status</div>
      <div className="table-panel-title">{statusText}</div>
      <div className="table-panel-note">
        {lobbyMe?.isSpectator
          ? 'Open Settings if the host wants to seat you back into the game.'
          : me
          ? `You are seated with ${formatAmount(me.stack)} and blinds are ${formatAmount(state.smallBlind)}/${formatAmount(state.bigBlind)}.`
          : 'Seat assignment is being restored.'}
      </div>
    </div>
  )
}

function RebuyPanel({
  me,
  bigBlind,
  startingStackSetting,
  canInteract,
  onRebuy,
  onFeedback,
}: {
  me: SeatPlayer
  bigBlind: number
  startingStackSetting: number
  canInteract: boolean
  onRebuy: (amount: number) => void
  onFeedback: (message: string, tone?: FeedbackTone) => void
}) {
  const recommended = Math.max(bigBlind, startingStackSetting - me.stack)
  const quickAmounts = Array.from(
    new Set(
      [recommended, bigBlind * 25, bigBlind * 50]
        .map(amount => Math.max(bigBlind, Math.floor(amount)))
        .filter(amount => amount > 0)
    )
  ).slice(0, 3)

  const [rebuyAmount, setRebuyAmount] = useState(Math.max(bigBlind, recommended))

  useEffect(() => {
    setRebuyAmount(Math.max(bigBlind, recommended))
  }, [bigBlind, recommended])

  const handleRebuy = () => {
    const amount = Math.max(bigBlind, Math.floor(rebuyAmount))

    if (!Number.isFinite(amount) || amount <= 0) {
      onFeedback('Enter a valid rebuy amount first.', 'error')
      return
    }

    if (!canInteract) {
      onFeedback('Rebuy is disabled while the table reconnects.', 'error')
      return
    }

    onRebuy(amount)
    onFeedback(`Requested a ${formatAmount(amount)} rebuy.`, 'info')
  }

  return (
    <div className="table-panel rebuy-panel">
      <div className="table-panel-header">
        <div>
          <div className="table-panel-kicker">Your stack</div>
          <div className="table-panel-title">{formatAmount(me.stack)}</div>
        </div>
        {(me.status === 'sitting_out' || me.stack === 0) && (
          <div className="table-chip chip-warning">Needs chips</div>
        )}
      </div>

      <div className="table-panel-note">
        Add chips between hands. Recommended top-up: {formatAmount(Math.max(bigBlind, recommended))}.
      </div>

      <div className="raise-quick-btns rebuy-quick-row">
        {quickAmounts.map(amount => (
          <button
            key={amount}
            type="button"
            className="btn-quick"
            onClick={() => setRebuyAmount(amount)}
          >
            {formatAmount(amount)}
          </button>
        ))}
      </div>

      <div className="rebuy-input-row">
        <input
          type="number"
          min={bigBlind}
          step={Math.max(bigBlind, 1)}
          className="raise-input"
          value={rebuyAmount}
          onChange={event => {
            const value = Number(event.target.value)
            if (!Number.isFinite(value)) {
              return
            }
            setRebuyAmount(Math.max(bigBlind, value))
          }}
        />

        <button
          type="button"
          className="btn-subtle btn-subtle-gold"
          disabled={!canInteract}
          onClick={handleRebuy}
        >
          Rebuy
        </button>
      </div>
    </div>
  )
}

