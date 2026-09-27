'use client'

import { useEffect, useState } from 'react'
import type { LobbyPlayer, SeatPlayer, TableState } from '@/lib/poker/types'
import type { C2SMessage } from '@/shared/protocol'
import {
  DEFAULT_LEDGER_SETTINGS,
  MAX_REBUYS_LIMIT,
  buildVenmoPayLink,
  describeRebuyBlock,
  formatCents,
  formatSettlementSummary,
  getRebuyBlockReason,
  venmoHandle,
  type LedgerEvent,
  type LedgerRow,
  type LedgerSnapshot,
} from '@/lib/poker/ledger'
import './ledger.css'

/** The ledger messages a client can send (rebuy, settle-up, Venmo, money rules). */
export type LedgerC2SMessage =
  | Extract<C2SMessage, { type: 'rebuy' | 'settle_up' | 'set_venmo' }>
  | { type: 'update_table_settings'; allowRebuys?: boolean; maxRebuys?: number; chipValue?: number }

/** Any button can ask for a rebuy; the LedgerLayer owns the confirmation. */
export const REBUY_REQUEST_EVENT = 'poker:rebuy-request'

export function requestRebuy() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REBUY_REQUEST_EVENT))
  }
}

const EMPTY_LEDGER: LedgerSnapshot = {
  settings: DEFAULT_LEDGER_SETTINGS,
  buyInAmount: 0,
  rows: [],
  payments: [],
  totalBoughtIn: 0,
  totalChips: 0,
  events: [],
  settleUpAt: null,
}

export function formatChips(amount: number): string {
  return `$${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`
}

function formatNetChips(amount: number): string {
  if (amount === 0) return '$0'
  return `${amount > 0 ? '+' : '-'}$${Math.abs(Math.round(amount)).toLocaleString('en-US')}`
}

export interface RebuyStatus {
  /** Ledger row for this viewer, if they have bought in. */
  row?: LedgerRow
  canRebuy: boolean
  /** The rebuy would wait for the hand in progress to end. */
  queues: boolean
  reason: string | null
  amount: number
  rebuysLeft: number | null
}

/** What the viewer's Rebuy button should do, mirroring the server rule. */
export function getRebuyStatus(state: TableState, yourId: string): RebuyStatus {
  const ledger = state.ledger ?? EMPTY_LEDGER
  const amount = ledger.buyInAmount || state.startingStack
  const row = ledger.rows.find(candidate => candidate.playerId === yourId)
  const me: SeatPlayer | undefined = state.players.find(player => player.id === yourId)
  const lobbyMe: LobbyPlayer | undefined = state.lobbyPlayers.find(player => player.id === yourId)
  const settings = ledger.settings
  const rebuysUsed = row?.rebuys ?? 0
  const rebuysLeft = settings.maxRebuys > 0 ? Math.max(0, settings.maxRebuys - rebuysUsed) : null
  if (!yourId || (!me && !lobbyMe?.isSpectator)) {
    return { row, canRebuy: false, queues: false, reason: 'Take a seat first.', amount, rebuysLeft }
  }
  const chips = me ? me.stack : Math.max(0, lobbyMe?.stack ?? 0)
  const blocked = getRebuyBlockReason({
    settings,
    rebuysUsed,
    chips,
    startingStack: amount,
    queued: Boolean(row?.rebuyQueued),
  })
  const queues = state.phase === 'in_hand' && Boolean(me) && (me!.status === 'active' || me!.status === 'all_in')
  return {
    row,
    canRebuy: !blocked,
    queues,
    reason: blocked ? describeRebuyBlock(blocked, amount, settings.maxRebuys) : null,
    amount,
    rebuysLeft,
  }
}

function describeEvent(event: LedgerEvent): string {
  switch (event.kind) {
    case 'buy_in':
      return `${event.name} bought in ${formatChips(event.amount)}`
    case 'rebuy':
      return `${event.name} rebought ${formatChips(event.amount)}`
    case 'host_add':
      return event.byName === event.name
        ? `${event.name} (host) added ${formatChips(event.amount)} to their stack`
        : `${event.byName ?? 'Host'} added ${formatChips(event.amount)} to ${event.name}`
    case 'host_remove':
      return event.byName === event.name
        ? `${event.name} (host) took ${formatChips(event.amount)} off their stack`
        : `${event.byName ?? 'Host'} removed ${formatChips(event.amount)} from ${event.name}`
  }
}

function formatClock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Who is up, who is down, and the fewest payments that square the night.
 * Shared by the Settings "Ledger" tab and the end-of-night card.
 */
export function SettleUpSummary({
  ledger,
  yourId,
  inHand = false,
}: {
  ledger: LedgerSnapshot
  yourId: string
  inHand?: boolean
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const chipValue = ledger.settings.chipValue
  const showMoney = chipValue !== 1
  const humanRows = ledger.rows

  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(formatSettlementSummary(ledger))
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }

  if (humanRows.length === 0) {
    return <div className="ledger-empty">Nobody has bought in yet. Buy-ins show up here once players sit down.</div>
  }

  return (
    <div className="ledger-summary">
      <table className="ledger-table">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">In</th>
            <th scope="col">Now</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {humanRows.map(row => {
            const isYou = Boolean(yourId) && row.playerId === yourId
            return (
              <tr key={row.key} data-you={isYou ? 'true' : 'false'} data-where={row.where}>
                <th scope="row">
                  <span className="ledger-name">{isYou ? `${row.name} (you)` : row.name}</span>
                  <span className="ledger-name-meta">
                    {row.isBot && <span className="ledger-tag">bot</span>}
                    {row.where === 'left' && <span className="ledger-tag">left</span>}
                    {row.where === 'rail' && <span className="ledger-tag">rail</span>}
                    {row.rebuys > 0 && <span className="ledger-tag">{row.rebuys} rebuy{row.rebuys === 1 ? '' : 's'}</span>}
                    {row.rebuyQueued && <span className="ledger-tag is-queued">rebuy next hand</span>}
                  </span>
                </th>
                <td>{formatChips(row.boughtIn)}</td>
                <td>{formatChips(row.chips)}</td>
                <td className="ledger-net" data-sign={row.net > 0 ? 'up' : row.net < 0 ? 'down' : 'even'}>
                  {formatNetChips(row.net)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Table</th>
            <td>{formatChips(ledger.totalBoughtIn)}</td>
            <td>{formatChips(ledger.totalChips)}</td>
            <td className="ledger-net" data-sign="even">$0</td>
          </tr>
        </tfoot>
      </table>

      <div className="ledger-payments" aria-label="Payments to settle up">
        <div className="ledger-payments-head">
          <span className="ledger-subtitle">Who pays who</span>
          {showMoney && <span className="ledger-rate">1 chip = ${chipValue}</span>}
        </div>
        {ledger.payments.length === 0 ? (
          <div className="ledger-even">Everyone is square. Nobody owes anybody.</div>
        ) : (
          <ol className="ledger-payment-list">
            {ledger.payments.map(payment => {
              const fromYou = ledger.rows.find(row => row.key === payment.fromKey)?.playerId === yourId && Boolean(yourId)
              const toYou = ledger.rows.find(row => row.key === payment.toKey)?.playerId === yourId && Boolean(yourId)
              const handle = venmoHandle(payment.toVenmoUsername)
              const link = buildVenmoPayLink(payment.toVenmoUsername, payment.cents)
              return (
                <li key={`${payment.fromKey}-${payment.toKey}`} className="ledger-payment" data-you={fromYou || toYou ? 'true' : 'false'}>
                  <span className="ledger-payment-copy">
                    <strong>{fromYou ? 'You' : payment.fromName}</strong>
                    {fromYou ? ' pay ' : ' pays '}
                    <strong>{toYou ? 'you' : payment.toName}</strong>{' '}
                    <span className="ledger-payment-amount">{formatCents(payment.cents)}</span>
                    {showMoney && <span className="ledger-payment-chips"> ({formatChips(payment.chips)} in chips)</span>}
                  </span>
                  {link ? (
                    <a
                      className={`ledger-venmo ${fromYou ? 'is-primary' : ''}`}
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Pay ${payment.toName} ${formatCents(payment.cents)} on Venmo (@${handle})`}
                    >
                      @{handle}
                    </a>
                  ) : (
                    <span className="ledger-venmo-missing">no Venmo</span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {inHand && <div className="ledger-note">Hand in progress: chips in the pot still count for whoever bet them.</div>}
        <button type="button" className="btn-subtle ledger-copy" onClick={copySummary}>
          {copied === 'done' ? 'Copied for the group chat' : copied === 'failed' ? 'Copy failed' : 'Copy settle-up'}
        </button>
      </div>
    </div>
  )
}

/** Settings > Ledger: your buy-in, the table's books, the settle-up and the host's money rules. */
export function LedgerPanel({
  state,
  yourId,
  isHost,
  isConnected,
  onSendLedgerMessage,
}: {
  state: TableState
  yourId: string
  isHost: boolean
  isConnected: boolean
  onSendLedgerMessage?: (message: LedgerC2SMessage) => void
}) {
  const ledger = state.ledger ?? EMPTY_LEDGER
  const rebuy = getRebuyStatus(state, yourId)
  const lobbyMe = state.lobbyPlayers.find(player => player.id === yourId)
  const savedVenmo = lobbyMe?.venmoUsername ?? rebuy.row?.venmoUsername ?? ''
  const [venmoDraft, setVenmoDraft] = useState(savedVenmo.replace(/^@/, ''))
  const [allowRebuys, setAllowRebuys] = useState(ledger.settings.allowRebuys)
  const [maxRebuys, setMaxRebuys] = useState<number | ''>(ledger.settings.maxRebuys)
  const [chipValue, setChipValue] = useState<number | ''>(ledger.settings.chipValue)

  useEffect(() => {
    setVenmoDraft(savedVenmo.replace(/^@/, ''))
  }, [savedVenmo])
  useEffect(() => {
    setAllowRebuys(ledger.settings.allowRebuys)
    setMaxRebuys(ledger.settings.maxRebuys)
    setChipValue(ledger.settings.chipValue)
  }, [ledger.settings.allowRebuys, ledger.settings.maxRebuys, ledger.settings.chipValue])

  const venmoValid = venmoDraft.trim() === '' || /^@?[A-Za-z0-9_-]{2,30}$/.test(venmoDraft.trim())
  const venmoChanged = venmoDraft.trim().replace(/^@/, '') !== savedVenmo.replace(/^@/, '')
  const rulesValid = maxRebuys !== '' && maxRebuys >= 0 && maxRebuys <= MAX_REBUYS_LIMIT &&
    chipValue !== '' && chipValue > 0 && chipValue <= 1000
  const rulesChanged = allowRebuys !== ledger.settings.allowRebuys ||
    maxRebuys !== ledger.settings.maxRebuys ||
    chipValue !== ledger.settings.chipValue

  return (
    <div className="settings-modal-body ledger-panel">
      <section className="settings-section ledger-you">
        <div className="ledger-you-copy">
          <div className="settings-section-title">Your night</div>
          <div className="settings-section-copy">
            {rebuy.row
              ? <>In for <strong>{formatChips(rebuy.row.boughtIn)}</strong>{rebuy.row.rebuys > 0 ? ` (${rebuy.row.rebuys} rebuy${rebuy.row.rebuys === 1 ? '' : 's'})` : ''} {'·'} holding <strong>{formatChips(rebuy.row.chips)}</strong> {'·'} net <strong className="ledger-net" data-sign={rebuy.row.net > 0 ? 'up' : rebuy.row.net < 0 ? 'down' : 'even'}>{formatNetChips(rebuy.row.net)}</strong></>
              : 'You have not bought in yet. Take a seat to get a starting stack.'}
          </div>
          <div className="ledger-rule">
            {ledger.settings.allowRebuys
              ? `A rebuy adds one ${formatChips(rebuy.amount)} buy-in whenever you are below ${formatChips(rebuy.amount)}${rebuy.rebuysLeft !== null ? ` (${rebuy.rebuysLeft} left tonight)` : ''}.`
              : 'Rebuys are off at this table. The host can still add chips.'}
          </div>
        </div>
        <div className="ledger-you-action">
          <button
            type="button"
            className="btn-gold ledger-rebuy-btn"
            disabled={!isConnected || !rebuy.canRebuy}
            onClick={requestRebuy}
          >
            {rebuy.row?.rebuyQueued ? 'Rebuy queued' : `Rebuy ${formatChips(rebuy.amount)}`}
          </button>
          {!rebuy.canRebuy && rebuy.reason && rebuy.row && <span className="ledger-rebuy-reason">{rebuy.reason}</span>}
          {rebuy.canRebuy && rebuy.queues && <span className="ledger-rebuy-reason">Lands when this hand ends.</span>}
        </div>
      </section>

      <section className="settings-section">
        <div className="ledger-section-head">
          <div className="settings-section-title">Settle up</div>
          {isHost && (
            <button
              type="button"
              className="btn-subtle btn-subtle-gold ledger-settle-btn"
              disabled={!isConnected || ledger.rows.length === 0}
              onClick={() => onSendLedgerMessage?.({ type: 'settle_up' })}
            >
              End night: show everyone
            </button>
          )}
        </div>
        <SettleUpSummary ledger={ledger} yourId={yourId} inHand={state.phase === 'in_hand'} />
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Your Venmo</div>
        <div className="settings-section-copy">Winners with a Venmo handle get a one-tap pay link on the settle-up.</div>
        <form
          className="ledger-venmo-form"
          onSubmit={event => {
            event.preventDefault()
            if (!venmoValid || !venmoChanged) return
            onSendLedgerMessage?.({ type: 'set_venmo', venmoUsername: venmoDraft.trim() })
          }}
        >
          <label className="settings-field ledger-venmo-field">
            <span>Venmo username</span>
            <span className="ledger-venmo-input">
              <span aria-hidden="true">@</span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={31}
                placeholder="your-handle"
                value={venmoDraft}
                aria-invalid={!venmoValid}
                onChange={event => setVenmoDraft(event.target.value.replace(/^@/, ''))}
              />
            </span>
          </label>
          <button type="submit" className="btn-subtle btn-subtle-gold" disabled={!isConnected || !venmoValid || !venmoChanged}>
            {venmoChanged ? 'Save Venmo' : 'Saved'}
          </button>
        </form>
      </section>

      {isHost && (
        <section className="settings-section">
          <div className="settings-section-title">Money rules</div>
          <div className="settings-rule-row">
            <div>
              <div className="settings-rule-name">Self-serve rebuys</div>
              <div className="settings-rule-copy">Players below the buy-in can rebuy themselves. Only you can add or remove other chips.</div>
            </div>
            <div className="settings-toggle-row">
              <button type="button" className={`settings-pill ${allowRebuys ? 'is-active' : ''}`} aria-pressed={allowRebuys} onClick={() => setAllowRebuys(true)}>
                On
              </button>
              <button type="button" className={`settings-pill ${!allowRebuys ? 'is-active' : ''}`} aria-pressed={!allowRebuys} onClick={() => setAllowRebuys(false)}>
                Off
              </button>
            </div>
          </div>
          <div className="settings-grid settings-grid-modal">
            <label className="settings-field">
              <span>Max rebuys per player (0 = no limit)</span>
              <input
                type="number"
                min={0}
                max={MAX_REBUYS_LIMIT}
                step={1}
                value={maxRebuys}
                onChange={event => setMaxRebuys(event.target.value === '' ? '' : Math.max(0, Math.floor(Number(event.target.value))))}
              />
            </label>
            <label className="settings-field">
              <span>Chip value ($ per chip)</span>
              <input
                type="number"
                min={0.0001}
                step={0.01}
                value={chipValue}
                onChange={event => setChipValue(event.target.value === '' ? '' : Number(event.target.value))}
              />
            </label>
          </div>
          <div className="settings-footer">
            <span className="settings-save-status" role="status">
              {!rulesValid ? 'Use 0-99 rebuys and a chip value above $0.' : rulesChanged ? 'Unsaved changes.' : 'Saved. Applies right away.'}
            </span>
            <button
              type="button"
              className="btn-subtle btn-subtle-gold"
              disabled={!isConnected || !rulesValid || !rulesChanged}
              onClick={() => onSendLedgerMessage?.({
                type: 'update_table_settings',
                allowRebuys,
                maxRebuys: Number(maxRebuys),
                chipValue: Number(chipValue),
              })}
            >
              Save money rules
            </button>
          </div>
        </section>
      )}

      {ledger.events.length > 0 && (
        <section className="settings-section">
          <div className="settings-section-title">Chip log</div>
          <ol className="ledger-events">
            {ledger.events.slice(0, 12).map(event => (
              <li key={event.id} data-kind={event.kind}>
                <span>{describeEvent(event)}</span>
                <time dateTime={new Date(event.at).toISOString()}>{formatClock(event.at)}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
