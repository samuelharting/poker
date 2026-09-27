import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEDGER_SETTINGS,
  buildLedgerPayments,
  buildVenmoPayLink,
  computeSettlement,
  createLedger,
  ensureAccount,
  formatCents,
  formatSettlementSummary,
  getRebuyBlockReason,
  netsToCents,
  recordBuyIn,
  recordHostAdjustment,
  recordRebuy,
  totalBoughtIn,
  type LedgerRow,
  type SettlementBalance,
} from '@/lib/poker/ledger'

function balances(entries: Record<string, number>): SettlementBalance[] {
  return Object.entries(entries).map(([name, net]) => ({ key: name.toLowerCase(), name, net }))
}

/** Every payer pays exactly what they owe and every payee gets exactly what they are owed. */
function expectSettles(input: SettlementBalance[]) {
  const transfers = computeSettlement(input)
  const flow = new Map<string, number>()
  for (const transfer of transfers) {
    expect(transfer.amount).toBeGreaterThan(0)
    expect(transfer.fromKey).not.toBe(transfer.toKey)
    flow.set(transfer.fromKey, (flow.get(transfer.fromKey) ?? 0) - transfer.amount)
    flow.set(transfer.toKey, (flow.get(transfer.toKey) ?? 0) + transfer.amount)
  }
  for (const balance of input) {
    expect(flow.get(balance.key) ?? 0).toBe(balance.net)
  }
  const nonZero = input.filter(balance => balance.net !== 0).length
  expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1))
  return transfers
}

describe('computeSettlement (greedy min transfers)', () => {
  it('settles a simple heads-up night with one payment', () => {
    const transfers = expectSettles(balances({ Sam: 340, Alex: -340 }))
    expect(transfers).toEqual([
      { fromKey: 'alex', fromName: 'Alex', toKey: 'sam', toName: 'Sam', amount: 340 },
    ])
  })

  it('pays nobody when everyone broke even', () => {
    expect(expectSettles(balances({ Ann: 0, Ben: 0, Cat: 0 }))).toEqual([])
  })

  it('matches the biggest loser with the biggest winner first', () => {
    const transfers = expectSettles(balances({ Ann: 500, Ben: 100, Cat: -300, Dan: -300 }))
    expect(transfers.map(t => `${t.fromName}->${t.toName}:${t.amount}`)).toEqual([
      'Cat->Ann:300',
      'Dan->Ann:200',
      'Dan->Ben:100',
    ])
  })

  it('uses a single payment when one loss exactly covers one win', () => {
    const transfers = expectSettles(balances({ Ann: 700, Ben: 200, Cat: -700, Dan: -200 }))
    expect(transfers).toHaveLength(2)
    expect(transfers[0]).toMatchObject({ fromName: 'Cat', toName: 'Ann', amount: 700 })
    expect(transfers[1]).toMatchObject({ fromName: 'Dan', toName: 'Ben', amount: 200 })
  })

  it('handles one big winner and many small losers', () => {
    const transfers = expectSettles(balances({ Ann: 1500, Ben: -500, Cat: -500, Dan: -250, Eve: -250 }))
    expect(transfers.every(transfer => transfer.toName === 'Ann')).toBe(true)
    expect(transfers).toHaveLength(4)
  })

  it('settles random zero-sum nights with at most n-1 payments', () => {
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let run = 0; run < 200; run += 1) {
      const count = 2 + Math.floor(random() * 8)
      const nets = Array.from({ length: count - 1 }, () => Math.round((random() - 0.5) * 4000))
      nets.push(-nets.reduce((sum, net) => sum + net, 0))
      expectSettles(nets.map((net, index) => ({ key: `p${index}`, name: `P${index}`, net })))
    }
  })
})

describe('money conversion', () => {
  it('converts chips to cents at the chip value and keeps the books at zero', () => {
    const cents = netsToCents(balances({ Ann: 333, Ben: 333, Cat: -666 }), 0.01)
    expect(cents.reduce((sum, balance) => sum + balance.net, 0)).toBe(0)
    expect(cents.find(balance => balance.name === 'Cat')?.net).toBe(-666)
  })

  it('absorbs rounding drift into the largest balance', () => {
    // 1/3 cent per chip: 1 chip rounds to 0 cents each for the winners.
    const cents = netsToCents(balances({ Ann: 1, Ben: 1, Cat: -2 }), 1 / 300)
    expect(cents.reduce((sum, balance) => sum + balance.net, 0)).toBe(0)
  })

  it('formats cents as dollars', () => {
    expect(formatCents(34000)).toBe('$340')
    expect(formatCents(1250)).toBe('$12.50')
    expect(formatCents(-705)).toBe('-$7.05')
    expect(formatCents(123456700)).toBe('$1,234,567')
  })

  it('builds a Venmo pay link for a payee with a handle', () => {
    expect(buildVenmoPayLink('@sam-venmo', 34000)).toBe(
      'https://venmo.com/u/sam-venmo?txn=pay&amount=340&note=Poker'
    )
    expect(buildVenmoPayLink('sam_v', 1250)).toBe('https://venmo.com/u/sam_v?txn=pay&amount=12.50&note=Poker')
    expect(buildVenmoPayLink('', 1000)).toBeNull()
    expect(buildVenmoPayLink('bad handle!', 1000)).toBeNull()
  })
})

describe('ledger accounts', () => {
  it('counts buy-ins, rebuys and host adjustments into the total bought in', () => {
    const ledger = createLedger()
    const sam = ensureAccount(ledger, 'sam', 'Sam', false)
    recordBuyIn(ledger, sam, 1000)
    recordRebuy(ledger, sam, 1000)
    recordHostAdjustment(ledger, sam, 500, 'Host')
    recordHostAdjustment(ledger, sam, -200, 'Host')
    expect(totalBoughtIn(sam)).toBe(2300)
    expect(sam.rebuys).toBe(1)
    expect(ledger.events.map(event => event.kind)).toEqual(['buy_in', 'rebuy', 'host_add', 'host_remove'])
    expect(ledger.events[2]).toMatchObject({ byName: 'Host', amount: 500 })
    expect(ledger.events[3]).toMatchObject({ amount: 200 })
  })

  it('applies the rebuy rule: below the buy-in, rebuys on, under the cap, not already queued', () => {
    const base = { settings: DEFAULT_LEDGER_SETTINGS, rebuysUsed: 0, chips: 0, startingStack: 1000, queued: false }
    expect(getRebuyBlockReason(base)).toBeNull()
    expect(getRebuyBlockReason({ ...base, chips: 999 })).toBeNull()
    expect(getRebuyBlockReason({ ...base, chips: 1000 })).toBe('not_below_start')
    expect(getRebuyBlockReason({ ...base, queued: true })).toBe('already_queued')
    expect(getRebuyBlockReason({ ...base, settings: { ...DEFAULT_LEDGER_SETTINGS, allowRebuys: false } })).toBe('disabled')
    expect(getRebuyBlockReason({ ...base, rebuysUsed: 2, settings: { ...DEFAULT_LEDGER_SETTINGS, maxRebuys: 2 } })).toBe('max_reached')
    expect(getRebuyBlockReason({ ...base, rebuysUsed: 50, settings: { ...DEFAULT_LEDGER_SETTINGS, maxRebuys: 0 } })).toBeNull()
  })

  it('builds payments with payee Venmo handles and a group-chat summary', () => {
    const rows: LedgerRow[] = [
      { key: 'sam', name: 'Sam', isBot: false, where: 'seated', venmoUsername: '@sam-venmo', boughtIn: 1000, chips: 1340, net: 340, rebuys: 0, rebuyQueued: false },
      { key: 'alex', name: 'Alex', isBot: false, where: 'left', boughtIn: 2000, chips: 1660, net: -340, rebuys: 1, rebuyQueued: false },
    ]
    const payments = buildLedgerPayments(rows, 1)
    expect(payments).toEqual([
      { fromKey: 'alex', fromName: 'Alex', toKey: 'sam', toName: 'Sam', cents: 34000, chips: 340, toVenmoUsername: '@sam-venmo' },
    ])
    const summary = formatSettlementSummary({ rows, payments, settings: DEFAULT_LEDGER_SETTINGS })
    expect(summary).toContain('Alex pays Sam $340 - @sam-venmo')
    expect(summary).toContain('Sam: +$340')

    const quarters = buildLedgerPayments(rows, 0.25)
    expect(quarters[0]).toMatchObject({ cents: 8500, chips: 340 })
  })
})

describe('ledger protocol messages', () => {
  it('parses rebuy, settle-up, Venmo and the ledger settings', async () => {
    const { parseC2S, parseS2C } = await import('@/shared/protocol')
    expect(parseC2S(JSON.stringify({ type: 'rebuy', amount: 999_999 }))).toEqual({ type: 'rebuy' })
    expect(parseC2S(JSON.stringify({ type: 'settle_up' }))).toEqual({ type: 'settle_up' })
    expect(parseC2S(JSON.stringify({ type: 'set_venmo', venmoUsername: 'sam-v' }))).toEqual({ type: 'set_venmo', venmoUsername: '@sam-v' })
    expect(parseC2S(JSON.stringify({ type: 'set_venmo', venmoUsername: '' }))).toEqual({ type: 'set_venmo', venmoUsername: '' })
    expect(parseC2S(JSON.stringify({ type: 'set_venmo', venmoUsername: 'not a handle' }))).toBeNull()
    expect(parseC2S(JSON.stringify({ type: 'update_table_settings', allowRebuys: false, maxRebuys: 2.7, chipValue: 0.05 }))).toEqual({
      type: 'update_table_settings',
      allowRebuys: false,
      maxRebuys: 2,
      chipValue: 0.05,
    })
    expect(parseS2C(JSON.stringify({ type: 'notice', kind: 'ledger', message: 'Sam rebought $1,000', playerId: 'p1' }))).toEqual({
      type: 'notice',
      kind: 'ledger',
      message: 'Sam rebought $1,000',
      playerId: 'p1',
    })
  })
})
