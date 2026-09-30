/**
 * The night's money ledger: who bought in for how much, what they hold now,
 * and the fewest payments that square everyone up at the end.
 *
 * Chips are only ever minted by a buy-in (sitting down, a rebuy) or a host
 * adjustment, and every one of those is recorded here, so the sum of every
 * account's net is always zero: the house never keeps anything.
 */

export type LedgerEventKind = 'buy_in' | 'rebuy' | 'host_add' | 'host_remove'

export interface LedgerAccount {
  /** Same identity as stats: normalized nickname for humans, `bot:<id>` for bots. */
  key: string
  name: string
  isBot: boolean
  /** Chips issued when they first sat down. */
  buyIn: number
  rebuys: number
  rebuyChips: number
  hostAdded: number
  hostRemoved: number
  /** Chips carried off by a seat that no longer exists anywhere (a removed bot). */
  cashedOut: number
  venmoUsername?: string
  firstSeenAt: number
}

export interface LedgerEvent {
  id: string
  at: number
  key: string
  name: string
  kind: LedgerEventKind
  amount: number
  /** Who did it, for host adjustments. */
  byName?: string
}

export interface LedgerData {
  accounts: Record<string, LedgerAccount>
  events: LedgerEvent[]
  /** Rebuys requested mid-hand, applied once the hand is over. Keyed by account. */
  pendingRebuys: Record<string, true>
  /** Last time the host asked the whole table to settle up. */
  settleUpAt: number | null
}

export interface LedgerSettings {
  allowRebuys: boolean
  /** 0 = unlimited. */
  maxRebuys: number
  /** Dollars per chip for the settle-up (1 = chips are dollars). */
  chipValue: number
}

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = {
  allowRebuys: true,
  maxRebuys: 0,
  chipValue: 1,
}

/** Real money one starting stack costs unless the host picks another buy-in. */
export const DEFAULT_BUY_IN_DOLLARS = 5

export const MAX_LEDGER_EVENTS = 60
export const MAX_REBUYS_LIMIT = 99
export const MIN_CHIP_VALUE = 0.0001
export const MAX_CHIP_VALUE = 1000

export function createLedger(): LedgerData {
  return { accounts: {}, events: [], pendingRebuys: {}, settleUpAt: null }
}

export function ensureAccount(
  ledger: LedgerData,
  key: string,
  name: string,
  isBot: boolean,
  now = Date.now()
): LedgerAccount {
  const existing = ledger.accounts[key]
  if (existing) {
    existing.name = name || existing.name
    return existing
  }
  const account: LedgerAccount = {
    key,
    name,
    isBot,
    buyIn: 0,
    rebuys: 0,
    rebuyChips: 0,
    hostAdded: 0,
    hostRemoved: 0,
    cashedOut: 0,
    firstSeenAt: now,
  }
  ledger.accounts[key] = account
  return account
}

/** Everything this account has put on the books (can go below zero if the host removed a lot). */
export function totalBoughtIn(account: LedgerAccount): number {
  return account.buyIn + account.rebuyChips + account.hostAdded - account.hostRemoved
}

function pushEvent(ledger: LedgerData, event: Omit<LedgerEvent, 'id'>) {
  ledger.events.push({ ...event, id: `${event.at.toString(36)}-${ledger.events.length}-${Math.random().toString(36).slice(2, 6)}` })
  if (ledger.events.length > MAX_LEDGER_EVENTS) {
    ledger.events.splice(0, ledger.events.length - MAX_LEDGER_EVENTS)
  }
}

export function recordBuyIn(ledger: LedgerData, account: LedgerAccount, amount: number, now = Date.now()) {
  const chips = Math.max(0, Math.floor(amount))
  if (chips <= 0) return
  account.buyIn += chips
  pushEvent(ledger, { at: now, key: account.key, name: account.name, kind: 'buy_in', amount: chips })
}

export function recordRebuy(ledger: LedgerData, account: LedgerAccount, amount: number, now = Date.now()) {
  const chips = Math.max(0, Math.floor(amount))
  if (chips <= 0) return
  account.rebuys += 1
  account.rebuyChips += chips
  pushEvent(ledger, { at: now, key: account.key, name: account.name, kind: 'rebuy', amount: chips })
}

/** A host add (delta > 0) or removal (delta < 0) that actually changed the stack by `delta`. */
export function recordHostAdjustment(
  ledger: LedgerData,
  account: LedgerAccount,
  delta: number,
  byName: string,
  now = Date.now()
) {
  const chips = Math.trunc(delta)
  if (chips === 0) return
  if (chips > 0) {
    account.hostAdded += chips
  } else {
    account.hostRemoved += -chips
  }
  pushEvent(ledger, {
    at: now,
    key: account.key,
    name: account.name,
    kind: chips > 0 ? 'host_add' : 'host_remove',
    amount: Math.abs(chips),
    byName,
  })
}

export type RebuyBlockReason =
  | 'disabled'
  | 'max_reached'
  | 'not_below_start'
  | 'already_queued'

/**
 * House rule: a rebuy adds one full buy-in (the table's starting stack) and is
 * allowed whenever you hold less than a starting stack.
 */
export function getRebuyBlockReason(input: {
  settings: LedgerSettings
  rebuysUsed: number
  chips: number
  startingStack: number
  queued: boolean
}): RebuyBlockReason | null {
  if (!input.settings.allowRebuys) return 'disabled'
  if (input.queued) return 'already_queued'
  if (input.settings.maxRebuys > 0 && input.rebuysUsed >= input.settings.maxRebuys) return 'max_reached'
  if (input.chips >= input.startingStack) return 'not_below_start'
  return null
}

export function describeRebuyBlock(reason: RebuyBlockReason, startingStack: number, maxRebuys: number): string {
  switch (reason) {
    case 'disabled':
      return 'The host has turned rebuys off.'
    case 'already_queued':
      return 'Your rebuy is already queued for the end of this hand.'
    case 'max_reached':
      return `You have used all ${maxRebuys} rebuy${maxRebuys === 1 ? '' : 's'} for tonight.`
    case 'not_below_start':
      return `You can rebuy once you are below the $${startingStack.toLocaleString()} buy-in.`
  }
}

export interface SettlementBalance {
  key: string
  name: string
  /** Positive: they are owed. Negative: they owe. */
  net: number
}

export interface SettlementTransfer {
  fromKey: string
  fromName: string
  toKey: string
  toName: string
  amount: number
}

/**
 * Greedy settle-up: the biggest loser pays the biggest winner as much as one
 * of them needs, repeat. At most n - 1 payments. Balances must sum to zero
 * (any stray remainder is ignored rather than invented).
 */
export function computeSettlement(balances: readonly SettlementBalance[]): SettlementTransfer[] {
  const byNameThenKey = (a: SettlementBalance, b: SettlementBalance) =>
    a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
  const creditors = balances
    .filter(balance => balance.net > 0)
    .map(balance => ({ ...balance }))
  const debtors = balances
    .filter(balance => balance.net < 0)
    .map(balance => ({ ...balance, net: -balance.net }))
  const transfers: SettlementTransfer[] = []

  for (let guard = 0; guard < balances.length * 2 + 2; guard += 1) {
    creditors.sort((a, b) => b.net - a.net || byNameThenKey(a, b))
    debtors.sort((a, b) => b.net - a.net || byNameThenKey(a, b))
    const creditor = creditors[0]
    const debtor = debtors[0]
    if (!creditor || !debtor || creditor.net <= 0 || debtor.net <= 0) break
    const amount = Math.min(creditor.net, debtor.net)
    transfers.push({
      fromKey: debtor.key,
      fromName: debtor.name,
      toKey: creditor.key,
      toName: creditor.name,
      amount,
    })
    creditor.net -= amount
    debtor.net -= amount
    if (creditor.net <= 0) creditors.shift()
    if (debtor.net <= 0) debtors.shift()
  }

  return transfers
}

/**
 * Chip nets to whole cents at `chipValue` dollars a chip. Rounding can leave
 * a cent or two over; the largest balance absorbs it so money still sums to 0.
 */
export function netsToCents(balances: readonly SettlementBalance[], chipValue: number): SettlementBalance[] {
  const value = Number.isFinite(chipValue) && chipValue > 0 ? chipValue : 1
  const cents = balances.map(balance => ({ ...balance, net: Math.round(balance.net * value * 100) }))
  const drift = cents.reduce((sum, balance) => sum + balance.net, 0)
  if (drift !== 0 && cents.length > 0) {
    const largest = cents.reduce((best, balance) => (Math.abs(balance.net) > Math.abs(best.net) ? balance : best))
    largest.net -= drift
  }
  return cents
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const rest = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`
}

/** Venmo handle without the @, or '' when it is not a plausible handle. */
export function venmoHandle(username: string | undefined): string {
  const handle = (username ?? '').trim().replace(/^@/, '')
  return /^[A-Za-z0-9_-]{2,30}$/.test(handle) ? handle : ''
}

export function buildVenmoPayLink(username: string | undefined, cents: number, note = 'Poker'): string | null {
  const handle = venmoHandle(username)
  if (!handle || cents <= 0) return null
  const amount = (cents / 100).toFixed(2).replace(/\.00$/, '')
  return `https://venmo.com/u/${encodeURIComponent(handle)}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`
}

/** Public, per-viewer-agnostic ledger view sent with every snapshot. */
export interface LedgerRow {
  key: string
  name: string
  isBot: boolean
  /** The player's current id at this table, if they are still here. */
  playerId?: string
  where: 'seated' | 'rail' | 'left'
  venmoUsername?: string
  boughtIn: number
  chips: number
  net: number
  rebuys: number
  rebuyQueued: boolean
}

export interface LedgerPayment {
  fromKey: string
  fromName: string
  toKey: string
  toName: string
  /** Chips, before the chip value is applied. */
  chips: number
  cents: number
  toVenmoUsername?: string
}

export interface LedgerSnapshot {
  settings: LedgerSettings
  buyInAmount: number
  rows: LedgerRow[]
  payments: LedgerPayment[]
  totalBoughtIn: number
  totalChips: number
  events: LedgerEvent[]
  settleUpAt: number | null
}

export function buildLedgerPayments(rows: readonly LedgerRow[], chipValue: number): LedgerPayment[] {
  const balances = rows.map(row => ({ key: row.key, name: row.name, net: row.net }))
  const centsByKey = new Map(netsToCents(balances, chipValue).map(balance => [balance.key, balance]))
  const venmoByKey = new Map(rows.map(row => [row.key, row.venmoUsername]))
  const value = Number.isFinite(chipValue) && chipValue > 0 ? chipValue : 1
  return computeSettlement([...centsByKey.values()]).map(transfer => ({
    fromKey: transfer.fromKey,
    fromName: transfer.fromName,
    toKey: transfer.toKey,
    toName: transfer.toName,
    cents: transfer.amount,
    chips: Math.round(transfer.amount / 100 / value),
    ...(venmoByKey.get(transfer.toKey) ? { toVenmoUsername: venmoByKey.get(transfer.toKey) } : {}),
  }))
}

/** Plain-text summary for the group chat. */
export function formatSettlementSummary(snapshot: Pick<LedgerSnapshot, 'rows' | 'payments' | 'settings'>): string {
  const lines: string[] = ['Poker night - settle up']
  const chipValue = snapshot.settings.chipValue
  const money = (chips: number) => formatCents(Math.round(chips * chipValue * 100))
  for (const row of [...snapshot.rows].sort((a, b) => b.net - a.net)) {
    const net = money(row.net)
    lines.push(`${row.name}: ${row.net > 0 ? '+' : ''}${net} (in ${money(row.boughtIn)}, out ${money(row.chips)})`)
  }
  lines.push('')
  if (snapshot.payments.length === 0) {
    lines.push('Nobody owes anybody.')
  } else {
    for (const payment of snapshot.payments) {
      const handle = venmoHandle(payment.toVenmoUsername)
      lines.push(`${payment.fromName} pays ${payment.toName} ${formatCents(payment.cents)}${handle ? ` - @${handle}` : ''}`)
    }
  }
  return lines.join('\n')
}
