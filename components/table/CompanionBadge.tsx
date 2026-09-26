'use client'

import { useEffect, useRef, useState } from 'react'
import type { LadyLuckCompanionState } from '@/lib/poker/types'
import {
  describeLadyLuckChange,
  getLadyLuckMoodLine,
  type LadyLuckToast,
} from '@/lib/ladyLuckLines'

const BUBBLE_MS = 4200
const TOAST_MS = 3800

/** Tiny cartoon Lady Luck bust (red glam waves, green eyes, pink boa). */
function LadyLuckBust() {
  return (
    <svg className="lady-luck-bust" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ll-sequin" cx="50%" cy="30%" r="70%">
          <stop offset="0" stopColor="#b46cff" />
          <stop offset="1" stopColor="#5b1a9e" />
        </radialGradient>
      </defs>
      {/* Back hair */}
      <path d="M8 30c-4-10 1-24 16-24s20 14 16 24c2 6-1 12-5 13-2-6-3-10-3-10H16s-1 4-3 10c-4-1-7-7-5-13z" fill="#d42a2f" stroke="#1a0d12" strokeWidth="1.4" />
      {/* Dress + boa */}
      <path d="M13 48c0-7 4-11 11-11s11 4 11 11z" fill="url(#ll-sequin)" stroke="#1a0d12" strokeWidth="1.4" />
      <g fill="#ff7ec4" stroke="#1a0d12" strokeWidth="0.8">
        <circle cx="14" cy="40" r="3" /><circle cx="17" cy="37.5" r="3" /><circle cx="21" cy="36.5" r="2.6" />
        <circle cx="34" cy="40" r="3" /><circle cx="31" cy="37.5" r="3" /><circle cx="27" cy="36.5" r="2.6" />
      </g>
      <circle cx="19" cy="44" r="0.9" fill="#fff" /><circle cx="28" cy="45" r="0.9" fill="#fff" />
      {/* Neck + face */}
      <rect x="21.5" y="30" width="5" height="6" rx="2" fill="#ffc9a4" />
      <ellipse cx="24" cy="23" rx="9" ry="10" fill="#ffc9a4" stroke="#1a0d12" strokeWidth="1.3" />
      {/* Eyes */}
      <g className="lady-luck-eye">
        <ellipse cx="20.2" cy="22" rx="2.3" ry="2.8" fill="#fff" />
        <circle cx="20.4" cy="22.3" r="1.6" fill="#18b37a" /><circle cx="20.4" cy="22.4" r="0.8" fill="#141018" />
        <circle cx="19.8" cy="21.5" r="0.5" fill="#fff" />
        <path d="M17.6 20.2q2.6-2.2 5.2 0" stroke="#1b0f14" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
      <g className="lady-luck-eye lady-luck-eye-wink">
        <ellipse cx="27.8" cy="22" rx="2.3" ry="2.8" fill="#fff" />
        <circle cx="27.6" cy="22.3" r="1.6" fill="#18b37a" /><circle cx="27.6" cy="22.4" r="0.8" fill="#141018" />
        <circle cx="27" cy="21.5" r="0.5" fill="#fff" />
        <path d="M25.2 20.2q2.6-2.2 5.2 0" stroke="#1b0f14" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
      <ellipse cx="17.6" cy="26.2" rx="1.9" ry="1.1" fill="#ff7aa2" opacity="0.6" />
      <ellipse cx="30.4" cy="26.2" rx="1.9" ry="1.1" fill="#ff7aa2" opacity="0.6" />
      {/* Lips */}
      <path className="lady-luck-lips" d="M21.2 28.1q1.4-1.3 2.8-.3q1.4-1 2.8.3q-1.4 1.9-2.8 1.9t-2.8-1.9z" fill="#e8175d" />
      {/* Side-swept bang + clip */}
      <path d="M15 20c1-8 9-11 15-8 3 1 5 5 4 9-3-5-8-7-12-6-3 1-5 3-7 5z" fill="#d42a2f" stroke="#1a0d12" strokeWidth="1.2" />
      <path d="M13 13l1.6 1.6 2.2-.6-.6 2.2 1.6 1.6-2.2.4-.6 2.2-1.4-1.8-2.2.3 1-2-1.2-1.9z" fill="#ffc93c" stroke="#1a0d12" strokeWidth="0.6" />
      {/* Hoop earrings */}
      <circle cx="15.4" cy="28" r="1.6" fill="none" stroke="#ffc93c" strokeWidth="0.9" />
      <circle cx="32.6" cy="28" r="1.6" fill="none" stroke="#ffc93c" strokeWidth="0.9" />
    </svg>
  )
}

/**
 * Lady Luck sticker beside a seat puck on the 2D table. Renders nothing unless
 * the server-side companion belongs to `playerId`.
 */
export function CompanionBadge({
  companion,
  playerId,
  placement = 'seat',
}: {
  companion: LadyLuckCompanionState | null | undefined
  playerId: string | null | undefined
  placement?: 'seat' | 'hero'
}) {
  const mine = companion && playerId && companion.ownerId === playerId ? companion : null
  const moodKey = mine ? `${mine.id}:${mine.mood}:${mine.since}` : ''
  const [bubbleKey, setBubbleKey] = useState('')

  useEffect(() => {
    if (!moodKey) return
    setBubbleKey(moodKey)
    const timeout = window.setTimeout(() => setBubbleKey(current => (current === moodKey ? '' : current)), BUBBLE_MS)
    return () => window.clearTimeout(timeout)
  }, [moodKey])

  if (!mine) return null
  const showBubble = bubbleKey === moodKey
  const label = mine.reason === 'big_win'
    ? 'Lady Luck is here after a big win'
    : `Lady Luck is here: ${mine.streak} wins in a row`

  return (
    <div
      className={`lady-luck-badge is-${placement}`}
      data-mood={mine.mood}
      data-reason={mine.reason}
      role="img"
      aria-label={label}
      key={mine.id}
    >
      <span className="lady-luck-sticker">
        <LadyLuckBust />
        {mine.streak >= 2 && mine.mood !== 'sulk_leave' && (
          <span className="lady-luck-streak" aria-hidden="true">×{mine.streak}</span>
        )}
      </span>
      <span className="lady-luck-hearts" aria-hidden="true">
        <span>{mine.mood === 'sulk_leave' ? '💔' : '💖'}</span>
        <span>{mine.mood === 'sulk_leave' ? '💨' : '💕'}</span>
        <span>{mine.mood === 'cheer' ? '💸' : '✨'}</span>
      </span>
      {showBubble && (
        <span className="lady-luck-bubble" aria-live="polite">
          {getLadyLuckMoodLine(mine)}
        </span>
      )}
    </div>
  )
}

/**
 * Table-wide announcement when Lady Luck arrives, switches players or storms
 * off. Works on both the 2D and 3D tables.
 */
export function CompanionToast({
  companion,
  nameOf,
  yourId,
}: {
  companion: LadyLuckCompanionState | null | undefined
  nameOf: (playerId: string) => string
  yourId?: string | null
}) {
  const previousRef = useRef<LadyLuckCompanionState | null | undefined>(undefined)
  const nameOfRef = useRef(nameOf)
  nameOfRef.current = nameOf
  const timerRef = useRef<number | null>(null)
  const [toast, setToast] = useState<LadyLuckToast | null>(null)
  const current = companion ?? null
  const signature = current ? `${current.id}:${current.mood}:${current.ownerId}` : 'none'

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = current
    // Do not announce whatever was already true when we joined.
    if (previous === undefined) return
    const next = describeLadyLuckChange(previous, current, id => nameOfRef.current(id), yourId)
    if (!next) return
    setToast(next)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setToast(active => (active?.key === next.key ? null : active))
    }, TOAST_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  if (!toast) return null
  return (
    <div className="lady-luck-toast" data-kind={toast.kind} role="status" aria-live="polite" key={toast.key}>
      {toast.text}
    </div>
  )
}
