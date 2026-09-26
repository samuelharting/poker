'use client'

import { useEffect, useState } from 'react'
import type { BountyMetadata, SeatPlayer } from '@/lib/poker/types'

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`
}

const BOUNTY_TOAST_MS = 6000

/** Builds the headline for a paid 7-2 bounty, or null when nothing was paid. */
export function getBountyToastCopy(
  bounty: BountyMetadata | undefined,
  players: ReadonlyArray<Pick<SeatPlayer, 'id' | 'nickname'>>
): { title: string; detail: string } | null {
  if (!bounty?.active || bounty.amount <= 0 || bounty.recipientPlayerIds.length === 0) return null
  const names = bounty.recipientPlayerIds
    .map(id => players.find(player => player.id === id)?.nickname)
    .filter((name): name is string => Boolean(name))
  const who = names.length > 0 ? names.join(' & ') : 'The winner'
  const payers = bounty.contributors.length
  const each = payers > 0 ? Math.round(bounty.amount / payers) : bounty.amount
  return {
    title: `7-2 bounty! ${who} +${formatAmount(bounty.amount)}`,
    detail: `${payers} ${payers === 1 ? 'player pays' : 'players pay'} ${formatAmount(each)} each`,
  }
}

/** Table-wide celebration when someone wins a hand with seven-deuce. */
export function BountyToast({
  bounty,
  players,
}: {
  bounty: BountyMetadata | undefined
  players: ReadonlyArray<Pick<SeatPlayer, 'id' | 'nickname'>>
}) {
  const copy = getBountyToastCopy(bounty, players)
  const key = copy ? `${copy.title}|${bounty?.contributors.join(',')}` : ''
  const [shownKey, setShownKey] = useState('')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!key || key === shownKey) return
    setShownKey(key)
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), BOUNTY_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [key, shownKey])

  if (!copy || !visible) return null

  return (
    <div className="bounty-toast" role="status" aria-live="assertive">
      <span className="bounty-toast-cards" aria-hidden="true">
        <b>7</b>
        <b>2</b>
      </span>
      <span className="bounty-toast-copy">
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </span>
    </div>
  )
}
