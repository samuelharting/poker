'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TableState } from '@/lib/poker/types'
import {
  REBUY_REQUEST_EVENT,
  SettleUpSummary,
  formatChips,
  getRebuyStatus,
  requestRebuy,
  type LedgerC2SMessage,
} from '@/components/table/LedgerPanel'
import '@/components/table/ledger.css'

function settleSeenKey(roomCode: string) {
  return `poker_settle_seen_${roomCode}`
}

function readSeen(roomCode: string): number {
  try {
    return Number(window.sessionStorage.getItem(settleSeenKey(roomCode)) ?? 0) || 0
  } catch {
    return 0
  }
}

function writeSeen(roomCode: string, at: number) {
  try {
    window.sessionStorage.setItem(settleSeenKey(roomCode), String(at))
  } catch {
    // Storage off: the card just shows again after a reload.
  }
}

/**
 * Money moments above both table layouts: the rebuy confirmation, the
 * out-of-chips card on the desktop table (phones use the between-hands dock)
 * and the end-of-night settle-up card the host pops for everyone.
 */
export function LedgerLayer({
  tableState,
  yourId,
  roomCode,
  isConnected,
  isTwoDLayout,
  settingsOpen,
  onSendLedgerMessage,
}: {
  tableState: TableState | null
  yourId: string
  roomCode: string
  isConnected: boolean
  isTwoDLayout: boolean
  settingsOpen: boolean
  onSendLedgerMessage: (message: LedgerC2SMessage) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [seenSettleAt, setSeenSettleAt] = useState<number | null>(null)

  useEffect(() => {
    setSeenSettleAt(readSeen(roomCode))
  }, [roomCode])

  useEffect(() => {
    const open = () => setConfirmOpen(true)
    window.addEventListener(REBUY_REQUEST_EVENT, open)
    return () => window.removeEventListener(REBUY_REQUEST_EVENT, open)
  }, [])

  const settleUpAt = tableState?.ledger?.settleUpAt ?? null
  const showSettle = Boolean(settleUpAt && seenSettleAt !== null && settleUpAt > seenSettleAt)
  const dismissSettle = useCallback(() => {
    if (!settleUpAt) return
    writeSeen(roomCode, settleUpAt)
    setSeenSettleAt(settleUpAt)
  }, [roomCode, settleUpAt])

  useEffect(() => {
    if (!confirmOpen && !showSettle) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (confirmOpen) setConfirmOpen(false)
      else dismissSettle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmOpen, dismissSettle, showSettle])

  if (!tableState || !yourId) {
    return null
  }

  const rebuy = getRebuyStatus(tableState, yourId)
  const me = tableState.players.find(player => player.id === yourId)
  const lobbyMe = tableState.lobbyPlayers.find(player => player.id === yourId)
  const handResultShowing = Boolean(tableState.winners?.length)
  const isBusted = Boolean(
    (lobbyMe?.isSpectator && !me && lobbyMe.stack <= 0 && rebuy.row) ||
    (me && me.stack <= 0 && tableState.phase !== 'in_hand' && !handResultShowing)
  )
  const showBustedCard = !isTwoDLayout && isBusted && !settingsOpen && !confirmOpen && !showSettle
  const ledger = tableState.ledger
  const chipValue = ledger?.settings.chipValue ?? 1
  // Real-money price of one rebuy, when the table uses a buy-in price.
  const buyInDollars = chipValue !== 1 && rebuy.amount > 0
    ? `$${(Math.round(rebuy.amount * chipValue * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : null
  // Chips are counted as chips here, so they never sit next to real money in the same "$".
  const stackChips = `${Math.max(0, Math.round(rebuy.amount)).toLocaleString('en-US')} chips`

  return (
    <>
      {showBustedCard && (
        <div
          className={`ledger-busted-card ${rebuy.canRebuy ? 'is-cashier' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="ledger-busted-chips" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <div className="ledger-busted-copy">
            <small>{rebuy.canRebuy ? 'Out of chips · the cashier is open' : 'Out of chips'}</small>
            <strong>{rebuy.canRebuy ? `Rebuy a fresh stack of ${stackChips}` : "You're out of chips"}</strong>
            <span>
              {rebuy.canRebuy
                ? (buyInDollars
                    ? `Costs ${buyInDollars} cash on the settle-up. You're dealt into the next hand.`
                    : "You're dealt straight into the next hand.")
                : rebuy.reason ?? 'Ask the host for chips to keep playing.'}
            </span>
          </div>
          {rebuy.canRebuy && (
            <button type="button" className="btn-gold ledger-busted-cta" disabled={!isConnected} onClick={requestRebuy}>
              <span>Rebuy</span>
              <b>{buyInDollars ? `${buyInDollars} cash` : stackChips}</b>
            </button>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="ledger-overlay" onClick={() => setConfirmOpen(false)}>
          <div
            className="ledger-dialog ledger-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ledger-confirm-title"
            aria-describedby="ledger-confirm-copy"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="ledger-confirm-title">Rebuy for {formatChips(rebuy.amount)}?</h2>
            <p id="ledger-confirm-copy">
              {rebuy.canRebuy
                ? <>
                    Adds {formatChips(rebuy.amount)} to your stack and to your buy-in on the leaderboard
                    {rebuy.row ? ` (you'd be in for ${formatChips(rebuy.row.boughtIn + rebuy.amount)})` : ''}.
                    {rebuy.queues ? ' You are in a hand, so it lands as soon as this hand ends.' : ''}
                    {buyInDollars ? ` It costs ${buyInDollars} cash, settled at the end of the night.` : ''}
                    {rebuy.rebuysLeft !== null ? ` ${rebuy.rebuysLeft - 1} rebuy${rebuy.rebuysLeft - 1 === 1 ? '' : 's'} left after this.` : ''}
                  </>
                : rebuy.reason}
            </p>
            <div className="ledger-dialog-actions">
              <button type="button" className="btn-subtle" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-gold"
                autoFocus
                disabled={!isConnected || !rebuy.canRebuy}
                onClick={() => {
                  onSendLedgerMessage({ type: 'rebuy' })
                  setConfirmOpen(false)
                }}
              >
                {rebuy.queues ? 'Rebuy after this hand' : `Rebuy ${formatChips(rebuy.amount)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettle && ledger && !confirmOpen && (
        <div className="ledger-overlay" onClick={dismissSettle}>
          <div
            className="ledger-dialog ledger-settle-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-settle-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="ledger-settle-head">
              <div>
                <div className="table-panel-kicker">End of the night</div>
                <h2 id="ledger-settle-title">Settle up</h2>
              </div>
              <button type="button" className="btn-subtle settings-close" onClick={dismissSettle}>
                Close
              </button>
            </div>
            <div className="ledger-settle-body">
              <SettleUpSummary ledger={ledger} yourId={yourId} inHand={tableState.phase === 'in_hand'} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
