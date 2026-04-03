'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { TableState, SeatPlayer, LobbyPlayer, ShowCardsMode } from '@/lib/poker/types'
import type { SocialSnapshot } from '@/shared/protocol'
import { PlayerSeat } from './PlayerSeat'
import { CommunityCards } from './CommunityCards'
import { OwnHand } from './OwnHand'
import { PotDisplay } from './PotDisplay'
import { SearchableEmojiPicker } from '@/components/ui/SearchableEmojiPicker'

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
  roomCode: string
  canShareRoom: boolean
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
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onSetShowCards: (mode: ShowCardsMode) => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onCloseSettings: () => void
  onCopyRoom: () => void
  onShareRoom: () => void
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
  { id: 'middle_finger', glyph: '\uD83D\uDD95', label: 'Middle finger' },
  { id: 'israel_flag', glyph: '\uD83C\uDDEE\uD83C\uDDF1', label: 'Israel flag' },
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

function formatEquityPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function getLobbyStatusLabel(state: TableState, player: LobbyPlayer): string {
  if (player.isSpectator) {
    return state.phase === 'in_hand' && state.players.some(seatedPlayer => seatedPlayer.id === player.id)
      ? 'spectating next hand'
      : 'spectating'
  }

  if (!player.isSeated && state.phase === 'in_hand') {
    return 'waiting for next hand'
  }

  return player.status.replace('_', ' ')
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
  roomCode,
  canShareRoom,
  onAction,
  onStartGame,
  onAddBots,
  autoStartEnabled,
  onSetAutoStart,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onSetShowCards,
  onSetSuitColorMode,
  onCloseSettings,
  onCopyRoom,
  onShareRoom,
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
  const canAdjustShownCards = Boolean(me?.holeCards?.length) && (betweenHands || me?.status === 'folded')
  const [socialTick, setSocialTick] = useState(() => Date.now())
  const [targetEmotePlayerId, setTargetEmotePlayerId] = useState<string | null>(null)
  const [targetEmotePickerOpen, setTargetEmotePickerOpen] = useState(false)

  const orderedOpponents = useMemo<OpponentSeat[]>(() => {
    if (isSpectator || !me) {
      return state.players
        .map(player => ({
          ...player,
          visualSeat: player.seatIndex,
        }))
        .sort((a, b) => a.visualSeat - b.visualSeat)
    }

    const mySeat = me.seatIndex
    return state.players
      .map(player => ({
        ...player,
        visualSeat: (player.seatIndex - mySeat + 8) % 8,
      }))
      .sort((a, b) => a.visualSeat - b.visualSeat)
  }, [isSpectator, me, state.players, yourId])

  const occupiedVisualSeats = useMemo(() => {
    const occupied = new Set<number>()

    orderedOpponents.forEach(player => occupied.add(player.visualSeat))

    if (me && !isSpectator) {
      occupied.add(0)
    }

    return occupied
  }, [isSpectator, me, orderedOpponents])

  const emptyVisualSeats = useMemo(() => {
    return SEAT_LAYOUTS
      .map((layout, visualSeat) => ({
        ...layout,
        visualSeat,
      }))
      .filter(layout => !occupiedVisualSeats.has(layout.visualSeat))
  }, [occupiedVisualSeats])

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
  const hasActionTray = isInHand && isMyTurn && Boolean(me) && legalActions.length > 0

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

    const presetBets = [
      { label: '1/4 Pot', amount: Math.max(effectiveMin, Math.floor(state.totalPot / 4)) },
      { label: '1/2 Pot', amount: Math.max(effectiveMin, Math.floor(state.totalPot / 2)) },
      { label: '3/4 Pot', amount: Math.max(effectiveMin, Math.floor((state.totalPot * 3) / 4)) },
      { label: 'Pot', amount: Math.max(effectiveMin, state.totalPot) },
    ]

    for (const presetBet of presetBets) {
      const alreadyAdded = bets.some(bet => bet.amount === presetBet.amount)
      if (!alreadyAdded && presetBet.amount <= maxRaise) {
        bets.push(presetBet)
      }
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

  const turnTimer = useTurnTimer(
    state.actionTimerStart,
    state.actionTimerDuration
  )

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
      emoteTargeted?: boolean
    }>()

    for (const entry of socialState.active) {
      if (entry.message && entry.messageExpiresAt && entry.messageExpiresAt > socialTick) {
        const current = entries.get(entry.playerId) ?? {}
        entries.set(entry.playerId, {
          ...current,
          message: entry.message,
          messageExpiresAt: entry.messageExpiresAt,
        })
      }

      if (entry.emote && entry.emoteExpiresAt && entry.emoteExpiresAt > socialTick) {
        const senderId = entry.playerId
        const targetSeatId = entry.targetPlayerId?.trim() ?? ''
        const emote = getEmoteGlyph(entry.emote)

        const senderCurrent = entries.get(senderId) ?? {}
        entries.set(senderId, {
          ...senderCurrent,
          emote,
          emoteExpiresAt: entry.emoteExpiresAt,
          emoteTargeted: false,
        })

        if (targetSeatId && targetSeatId !== senderId) {
          const targetCurrent = entries.get(targetSeatId) ?? {}
          entries.set(targetSeatId, {
            ...targetCurrent,
            emote,
            emoteExpiresAt: entry.emoteExpiresAt,
            emoteTargeted: true,
          })
        }
      }
    }

    return entries
  }, [socialState.active, socialTick])

  const targetedPlayer = targetEmotePlayerId
    ? state.players.find(player => player.id === targetEmotePlayerId)
    : null
  const winnerAmounts = useMemo(
    () => new Map((state.winners ?? []).map(winner => [winner.playerId, winner.amount])),
    [state.winners]
  )
  const myWinnerAmount = winnerAmounts.get(yourId) ?? 0

  const tableCenterLabel = isHost
    ? 'HOST VIEW'
    : me
      ? me.nickname.toUpperCase()
      : 'TABLE VIEW'
  const mobileHeroStatus = !isConnected
    ? 'Reconnecting'
    : betweenHands
      ? myWinnerAmount > 0
        ? `Won ${formatAmount(myWinnerAmount)}`
        : 'Waiting for next hand'
      : isMyTurn
        ? toCall > 0
          ? `To call ${formatAmount(toCall)}`
          : 'Your turn'
        : 'In hand'

  const actionButtons = useMemo(() => {
    const buttons: Array<{
      key: 'call' | 'check' | 'raise' | 'all_in' | 'fold'
      label: string
      className: string
      onClick: () => void
    }> = []

    if (legalActions.includes('call')) {
      buttons.push({
        key: 'call',
        label: `Call ${formatAmount(toCall)}`,
        className: 'btn-call',
        onClick: () => onAction('call'),
      })
    }

    if (legalActions.includes('check')) {
      buttons.push({
        key: 'check',
        label: 'Check',
        className: 'btn-check',
        onClick: () => onAction('check'),
      })
    }

    if (legalActions.includes('raise')) {
      buttons.push({
        key: 'raise',
        label: `Raise ${formatAmount(raiseAmount)}`,
        className: 'btn-raise',
        onClick: handleRaise,
      })
    }

    if (legalActions.includes('all_in') && me) {
      buttons.push({
        key: 'all_in',
        label: `All-in ${formatAmount(me.stack + me.bet)}`,
        className: 'btn-raise',
        onClick: () => onAction('all_in'),
      })
    }

    if (legalActions.includes('fold')) {
      buttons.push({
        key: 'fold',
        label: 'Fold',
        className: 'btn-fold',
        onClick: () => onAction('fold'),
      })
    }

    return buttons
  }, [handleRaise, legalActions, me, onAction, raiseAmount, toCall])

  const tableWaitingCopy = !isConnected
    ? 'Restoring the room snapshot and reconnecting your seat.'
    : state.players.length < 2
      ? 'Share the room code and fill the open seats to kick off the next hand.'
      : isHost
        ? 'The table is ready. Use the host dock below when you want to deal.'
        : 'Everyone is seated. Waiting for the host to deal the next hand.'

  const handleTargetedEmote = useCallback((emote: string) => {
    if (!targetedPlayer) {
      onFeedback('Select a player before sending a targeted emote.', 'error')
      return
    }

    onSendTargetEmote(targetedPlayer.id, emote)
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [onFeedback, onSendTargetEmote, targetedPlayer])

  const closeTargetedEmote = useCallback(() => {
    setTargetEmotePlayerId(null)
    setTargetEmotePickerOpen(false)
  }, [])

  return (
    <div
      className="table-scene"
      data-phase={state.phase}
      data-suit-colors={suitColorMode}
      data-tray-open={hasActionTray ? 'true' : 'false'}
    >
      <div className="table-stage">
        <div className="table-wrapper">
          <div className="table-seat-ring">
            {emptyVisualSeats.map(layout => (
              <div
                key={`open-seat-${layout.visualSeat}`}
                className={`seat-position table-seat-placeholder ${layout.cssClass}`}
              >
                <div className="table-seat-placeholder-card">
                  <span className="table-seat-placeholder-kicker">Open seat</span>
                  <span className="table-seat-placeholder-label">
                    {state.phase === 'in_hand' ? 'Wait' : 'Sit'}
                  </span>
                </div>
              </div>
            ))}

            {orderedOpponents.map(player => {
              const layout = SEAT_LAYOUTS[player.visualSeat] ?? SEAT_LAYOUTS[1]
              const seatSocial = activeSocialByPlayer.get(player.id) ?? {}
              return (
                <div
                  key={player.id}
                  className={`seat-position ${layout.cssClass}`}
                >
                  <PlayerSeat
                    player={player}
                    isActing={state.actingPlayerId === player.id}
                    isWinner={betweenHands && winnerAmounts.has(player.id)}
                    winnerAmount={winnerAmounts.get(player.id)}
                    depthClass={layout.depthClass}
                    opacityValue={layout.opacity}
                    socialMessage={seatSocial.message}
                    socialMessageExpiresAt={seatSocial.messageExpiresAt}
                    socialEmote={seatSocial.emote}
                    socialEmoteExpiresAt={seatSocial.emoteExpiresAt}
                    socialEmoteTargeted={seatSocial.emoteTargeted}
                    onNameClick={playerId => {
                      setTargetEmotePlayerId(playerId)
                      setTargetEmotePickerOpen(false)
                    }}
                  />
                </div>
              )
            })}
          </div>

          <div className="table-surface">
            <CommunityCards cards={state.communityCards} />

            <PotDisplay
              totalPot={state.totalPot}
              pots={state.pots}
              currentBet={state.currentBet}
              toCall={isMyTurn ? Math.max(0, toCall) : 0}
            />

            <div className="table-surface-center-copy" aria-hidden="true">
              <span className="table-surface-center-owner">{tableCenterLabel}</span>
              <span className="table-surface-center-stakes">
                NLH - {state.smallBlind} / {state.bigBlind}
              </span>
            </div>

            {betweenHands && (
              <TableWaitingBanner
                playerCount={state.players.length}
                isConnected={isConnected}
                copy={tableWaitingCopy}
              />
            )}
          </div>

          {me && !isSpectator && me.holeCards && me.holeCards.length > 0 && (
            <>
              <OwnHand
                cards={me.holeCards}
                bet={me.bet}
                isActing={isMyTurn}
                isWinner={betweenHands && myWinnerAmount > 0}
              />

              <div
                className={`mobile-hero-summary ${isMyTurn ? 'is-acting' : ''} ${betweenHands && myWinnerAmount > 0 ? 'is-winner' : ''}`}
              >
                <div className="mobile-hero-summary-card">
                  <span className="mobile-hero-summary-name">{me.nickname}</span>
                  <span className="mobile-hero-summary-stack">{formatAmount(me.stack)}</span>
                </div>
                <div className="mobile-hero-summary-status">{mobileHeroStatus}</div>
              </div>
            </>
          )}
        </div>

        {me && !isSpectator && (
          <div className="hero-inline-status">
            <span className="table-chip table-chip-soft">{formatAmount(me.stack)}</span>
            {typeof me.equityPercent === 'number' && (
              <span className="table-chip table-chip-soft">
                Eq {formatEquityPercent(me.equityPercent)}
              </span>
            )}
            {betweenHands && myWinnerAmount > 0 && (
              <span className="table-chip winner-chip">Won {formatAmount(myWinnerAmount)}</span>
            )}
            {me.isDealer && <span className="table-chip">Dealer</span>}
            {me.isSB && <span className="table-chip">SB</span>}
            {me.isBB && <span className="table-chip">BB</span>}
            {isMyTurn && <span className="table-chip table-chip-soft">Your action</span>}
            {!isConnected && <span className="table-chip chip-warning">Reconnecting</span>}
            {canAdjustShownCards && (
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
          roomCode={roomCode}
          canShareRoom={canShareRoom}
          onClose={onCloseSettings}
          onSetSuitColorMode={onSetSuitColorMode}
          onUpdateSettings={onUpdateSettings}
          onRemovePlayer={onRemovePlayer}
          onAdjustPlayerStack={onAdjustPlayerStack}
          onSetPlayerSpectator={onSetPlayerSpectator}
          onCopyRoom={onCopyRoom}
          onShareRoom={onShareRoom}
          onFeedback={onFeedback}
        />
      )}

      {hasActionTray && me && (
        <div className="betting-tray">
          <div className="betting-tray-header">
            <span className="betting-tray-kicker">
              {toCall > 0 ? `To call ${formatAmount(toCall)}` : 'Action live'}
            </span>
            <span className="betting-tray-turn">Your turn</span>
          </div>

          <div className="timer-bar-shell">
            <div className="timer-bar-header">
              <span>Fold timer</span>
              <span>{turnTimer.secondsLeft}s left</span>
            </div>
            <div className="timer-bar">
              <div
                className={`timer-bar-fill ${turnTimer.percent < 20 ? 'timer-low' : ''}`}
                style={{ width: `${turnTimer.percent}%` }}
              />
            </div>
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

          <div className="bet-action-row" data-count={actionButtons.length}>
            {actionButtons.map(actionButton => (
              <button
                key={actionButton.key}
                type="button"
                className={`btn-action ${actionButton.className}`}
                onClick={actionButton.onClick}
              >
                {actionButton.label}
              </button>
            ))}
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

            </div>
          )}

          <div className="table-side-panels chat-dock">
            {targetedPlayer && (
              <TargetedEmotePanel
                target={targetedPlayer}
                isConnected={isConnected}
                onSendEmote={handleTargetedEmote}
                onClose={closeTargetedEmote}
                fullPickerOpen={targetEmotePickerOpen}
                onToggleFullPicker={() => setTargetEmotePickerOpen(current => !current)}
                emotes={EMOTE_OPTIONS}
              />
            )}
          </div>
    </div>
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
  emotes,
}: {
  target: SeatPlayer
  isConnected: boolean
  onSendEmote: (emote: string) => void
  onClose: () => void
  fullPickerOpen: boolean
  onToggleFullPicker: () => void
  emotes: readonly { id: EmoteId; glyph: string; label: string }[]
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
          x
        </button>
      </div>

      <div className="chat-emotes">
        {emotes.map(item => (
          <button
            key={item.id}
            type="button"
            className="emote-button"
            onClick={() => onSendEmote(item.glyph)}
            disabled={!isConnected}
            title={`Send ${item.label.toLowerCase()} to ${target.nickname}`}
          >
            {item.glyph}
          </button>
        ))}
        <button
          type="button"
          className={`emote-picker-toggle ${fullPickerOpen ? 'is-open' : ''}`}
          disabled={!isConnected}
          onClick={onToggleFullPicker}
        >
          {fullPickerOpen ? 'Hide picker' : 'Search all emojis'}
        </button>
      </div>

      {fullPickerOpen && (
        <SearchableEmojiPicker
          className="targeted-emote-picker"
          isConnected={isConnected}
          searchPlaceholder={`Search emojis for ${target.nickname}`}
          onSelect={emoji => onSendEmote(emoji)}
        />
      )}
    </aside>
  )
}

function useTurnTimer(timerStart: number | null, duration: number): { percent: number; secondsLeft: number } {
  const [timer, setTimer] = useState({
    percent: 100,
    secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
  })
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!timerStart) {
      setTimer({
        percent: 100,
        secondsLeft: Math.max(0, Math.ceil(duration / 1000)),
      })
      return
    }

    const tick = () => {
      const elapsed = Date.now() - timerStart
      const remainingMs = Math.max(0, duration - elapsed)
      const remainingPercent = duration > 0 ? (remainingMs / duration) * 100 : 0

      setTimer({
        percent: remainingPercent,
        secondsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
      })

      if (remainingMs > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [duration, timerStart])

  return timer
}

function SettingsModal({
  state,
  yourId,
  isHost,
  isConnected,
  suitColorMode,
  roomCode,
  canShareRoom,
  onClose,
  onSetSuitColorMode,
  onUpdateSettings,
  onRemovePlayer,
  onAdjustPlayerStack,
  onSetPlayerSpectator,
  onCopyRoom,
  onShareRoom,
  onFeedback,
}: {
  state: TableState
  yourId: string
  isHost: boolean
  isConnected: boolean
  suitColorMode: 'two' | 'four'
  roomCode: string
  canShareRoom: boolean
  onClose: () => void
  onSetSuitColorMode: (mode: 'two' | 'four') => void
  onUpdateSettings: (settings: {
    smallBlind?: number
    bigBlind?: number
    startingStack?: number
    actionTimerDuration?: number
    autoStartDelay?: number
    rabbitHuntingEnabled?: boolean
    sevenTwoRuleEnabled?: boolean
    sevenTwoBountyPercent?: number
  }) => void
  onRemovePlayer: (targetId: string) => void
  onAdjustPlayerStack: (targetId: string, amount: number) => void
  onSetPlayerSpectator: (targetId: string, spectator: boolean) => void
  onCopyRoom: () => void
  onShareRoom: () => void
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
    rabbitHuntingEnabled: state.rabbitHuntingEnabled,
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
      rabbitHuntingEnabled: state.rabbitHuntingEnabled,
      sevenTwoRuleEnabled: state.sevenTwoRuleEnabled,
      sevenTwoBountyPercent: state.sevenTwoBountyPercent,
    })
  }, [
    state.actionTimerDuration,
    state.autoStartDelay,
    state.bigBlind,
    state.rabbitHuntingEnabled,
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
    draft.rabbitHuntingEnabled !== state.rabbitHuntingEnabled ||
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
      rabbitHuntingEnabled: draft.rabbitHuntingEnabled,
      sevenTwoRuleEnabled: draft.sevenTwoRuleEnabled,
      sevenTwoBountyPercent,
    })
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
              <div className="settings-section-title">Room actions</div>
              <div className="settings-section-copy">
                Keep invites and room sharing tucked in here instead of on the table.
              </div>
              <div className="settings-room-code">Room code: {roomCode}</div>
              <div className="settings-inline-controls">
                <button type="button" className="btn-subtle" onClick={onCopyRoom}>
                  Copy code
                </button>
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={onShareRoom}
                  disabled={!canShareRoom}
                >
                  Share link
                </button>
              </div>
            </div>

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
                  <div className="settings-section-title">Rabbit hunting</div>
                  <div className="settings-toggle-row">
                    <button
                      type="button"
                      className={`settings-pill ${draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, rabbitHuntingEnabled: true }))}
                    >
                      On
                    </button>
                    <button
                      type="button"
                      className={`settings-pill ${!draft.rabbitHuntingEnabled ? 'is-active' : ''}`}
                      onClick={() => setDraft(current => ({ ...current, rabbitHuntingEnabled: false }))}
                    >
                      Off
                    </button>
                  </div>
                  <div className="settings-section-copy">
                    When active, hands that end before showdown automatically run out the rest of the board for a rabbit-hunt reveal without changing the winner.
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
                    When active, every other player who was dealt into the hand pays this percent of the table starting stack to any winning 7/2 hand.
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
                      rabbitHuntingEnabled: state.rabbitHuntingEnabled,
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
                      {formatAmount(player.stack)} {'\u00b7'} {getLobbyStatusLabel(state, player)}
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
                      onClick={() => onAdjustPlayerStack(player.id, manageAmount)}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => onAdjustPlayerStack(player.id, -manageAmount)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={!isConnected}
                      onClick={() => onSetPlayerSpectator(player.id, !player.isSpectator)}
                    >
                      {player.isSpectator ? 'Seat back' : state.phase === 'in_hand' ? 'Spectate now' : 'Spectate'}
                    </button>
                    {player.id !== yourId ? (
                      <button
                        type="button"
                        className="btn-subtle btn-subtle-danger"
                        disabled={!isConnected}
                        onClick={() => onRemovePlayer(player.id)}
                      >
                        {state.phase === 'in_hand' ? 'Kick now' : 'Kick'}
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
          onClick={() => onAddBots(1)}
        >
          Add bot
        </button>
        <button
          type="button"
          className="btn-subtle btn-subtle-gold"
          disabled={!isConnected || seatedCount >= 8}
          onClick={() => onAddBots(8 - seatedCount)}
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

function TableWaitingBanner({
  playerCount,
  isConnected,
  copy,
}: {
  playerCount: number
  isConnected: boolean
  copy: string
}) {
  return (
    <div className="table-waiting-banner">
      <div className="table-waiting-title">
        {isConnected ? 'Waiting for others' : 'Reconnecting'}
      </div>
      <div className="table-waiting-copy">{copy}</div>
      <div className="table-waiting-meta">
        <span>{playerCount} seated</span>
        <span>8 max</span>
      </div>
    </div>
  )
}
