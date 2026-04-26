import { describe, expect, it } from 'vitest'
import { buildActionButtonDescriptors } from '@/components/table/PokerTable'

describe('PokerTable action button descriptors', () => {
  it('keeps wager actions easy to scan without changing legal action order', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      toCall: 40,
      raiseAmount: 120,
      allInAmount: 940,
    })).toEqual([
      { key: 'call', label: 'Call', amountLabel: '$40', className: 'btn-call' },
      { key: 'raise', label: 'Raise to', amountLabel: '$120', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$940', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })

  it('shows check as the primary no-cost action when call is not legal', () => {
    expect(buildActionButtonDescriptors({
      legalActions: ['fold', 'check', 'raise', 'all_in'],
      toCall: 0,
      raiseAmount: 80,
      allInAmount: 1000,
    })).toEqual([
      { key: 'check', label: 'Check', className: 'btn-check' },
      { key: 'raise', label: 'Raise to', amountLabel: '$80', className: 'btn-raise' },
      { key: 'all_in', label: 'All-in', amountLabel: '$1,000', className: 'btn-all-in' },
      { key: 'fold', label: 'Fold', className: 'btn-fold' },
    ])
  })
})
