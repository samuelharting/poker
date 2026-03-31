'use client'

import type { Pot } from '@/lib/poker/types'

interface PotDisplayProps {
  totalPot: number
  pots: Pot[]
  currentBet: number
  toCall: number
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`
  if (amount >= 10000) return `$${(amount / 1000).toFixed(1)}K`
  return `$${amount.toLocaleString()}`
}

export function PotDisplay({ totalPot, pots, currentBet, toCall }: PotDisplayProps) {
  if (totalPot === 0 && currentBet === 0) return null

  return (
    <div className="pot-display">
      <div className="pot-display-card">
        <div className="pot-display-label">
          {pots.length > 1 ? 'Total Pot' : 'Pot'}
        </div>
        <div className="pot-display-value">
          {formatAmount(totalPot)}
        </div>

        {pots.length > 1 && (
          <div className="pot-side-list">
            {pots.map((pot, i) => (
              <div key={i} className="pot-side-row">
                {i === 0 ? 'Main' : `Side ${i}`}: {formatAmount(pot.amount)}
              </div>
            ))}
          </div>
        )}
      </div>

      {toCall > 0 && (
        <div className="pot-to-call">
          To call: {formatAmount(toCall)}
        </div>
      )}
    </div>
  )
}
