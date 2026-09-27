'use client'

import { useEffect, useRef, useState } from 'react'
import type { LadyLuckCompanionState } from '@/lib/poker/types'
import {
  describeLadyLuckChange,
  getLadyLuckMoodLine,
  pickLadyLuckLine,
  requestLadyLuckMute,
  type LadyLuckToast,
} from '@/lib/ladyLuckLines'

const BUBBLE_MS = 3600
const QUIP_MIN_MS = 9000
const QUIP_SPREAD_MS = 5000
const TOAST_MS = 3800

/** Tiny cartoon Lady Luck bust: blonde waves, sunglasses up, hibiscus, red top. */
function LadyLuckBust() {
  return (
    <svg className="lady-luck-bust" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {/* Back hair */}
      <path d="M8 30c-4-10 1-24 16-24s20 14 16 24c2 6-1 12-5 13-2-6-3-10-3-10H16s-1 4-3 10c-4-1-7-7-5-13z" fill="#f5c243" stroke="#1a0d12" strokeWidth="1.4" />
      {/* Shirt + red top with gold trim */}
      <path d="M11 48c0-7 5-11 13-11s13 4 13 11z" fill="#fffaf0" stroke="#1a0d12" strokeWidth="1.3" />
      <path d="M17 48v-7.5c2-1.2 4.4-1.8 7-1.8s5 .6 7 1.8V48z" fill="#e2162c" stroke="#ffc93c" strokeWidth="1" />
      <circle cx="14" cy="44" r="1.5" fill="#e8223a" /><circle cx="34" cy="43" r="1.5" fill="#e8223a" />
      {/* Neck + face */}
      <rect x="21.5" y="30" width="5" height="7" rx="2" fill="#ffc9a4" />
      <ellipse cx="24" cy="23" rx="9" ry="10" fill="#ffc9a4" stroke="#1a0d12" strokeWidth="1.3" />
      {/* Eyes */}
      <g className="lady-luck-eye">
        <ellipse cx="20.2" cy="22" rx="2.3" ry="2.8" fill="#fff" />
        <circle cx="20.4" cy="22.3" r="1.6" fill="#1f8fe8" /><circle cx="20.4" cy="22.4" r="0.8" fill="#141018" />
        <circle cx="19.8" cy="21.5" r="0.5" fill="#fff" />
        <path d="M17.6 20.2q2.6-2.2 5.2 0" stroke="#1b0f14" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
      <g className="lady-luck-eye lady-luck-eye-wink">
        <ellipse cx="27.8" cy="22" rx="2.3" ry="2.8" fill="#fff" />
        <circle cx="27.6" cy="22.3" r="1.6" fill="#1f8fe8" /><circle cx="27.6" cy="22.4" r="0.8" fill="#141018" />
        <circle cx="27" cy="21.5" r="0.5" fill="#fff" />
        <path d="M25.2 20.2q2.6-2.2 5.2 0" stroke="#1b0f14" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
      <ellipse cx="17.6" cy="26.2" rx="1.9" ry="1.1" fill="#ff7aa2" opacity="0.6" />
      <ellipse cx="30.4" cy="26.2" rx="1.9" ry="1.1" fill="#ff7aa2" opacity="0.6" />
      {/* Lips */}
      <path className="lady-luck-lips" d="M21.2 28.1q1.4-1.3 2.8-.3q1.4-1 2.8.3q-1.4 1.9-2.8 1.9t-2.8-1.9z" fill="#e8175d" />
      {/* Side-swept bang */}
      <path d="M15 20c1-8 9-11 15-8 3 1 5 5 4 9-3-5-8-7-12-6-3 1-5 3-7 5z" fill="#f5c243" stroke="#1a0d12" strokeWidth="1.2" />
      {/* Sunglasses pushed up */}
      <g stroke="#ffc93c" strokeWidth="0.9">
        <ellipse cx="19.5" cy="10.5" rx="3.6" ry="2.4" fill="#2a1330" />
        <ellipse cx="28.5" cy="10.5" rx="3.6" ry="2.4" fill="#2a1330" />
        <path d="M23 10.3h2" fill="none" />
      </g>
      <circle cx="18.4" cy="9.8" r="0.8" fill="#fff" /><circle cx="27.4" cy="9.8" r="0.8" fill="#fff" />
      {/* Hibiscus behind the ear */}
      <g fill="#ff3d6e" stroke="#1a0d12" strokeWidth="0.5">
        <circle cx="11" cy="21" r="2.2" /><circle cx="13" cy="18.6" r="2.2" /><circle cx="14.4" cy="21.6" r="2.2" /><circle cx="11.8" cy="24" r="2.2" />
      </g>
      <circle cx="12.6" cy="21.2" r="1" fill="#ffc93c" />
      {/* Hoop earrings */}
      <circle cx="32.6" cy="28" r="1.8" fill="none" stroke="#ffc93c" strokeWidth="0.9" />
    </svg>
  )
}

/**
 * Lady Luck sticker beside a seat puck on the 2D table. Renders nothing unless
 * the server-side companion belongs to `playerId`. `canMute` (the owner's own
 * badge) adds a tiny "shut up" button.
 */
export function CompanionBadge({
  companion,
  playerId,
  placement = 'seat',
  canMute = false,
}: {
  companion: LadyLuckCompanionState | null | undefined
  playerId: string | null | undefined
  placement?: 'seat' | 'hero'
  canMute?: boolean
}) {
  const mine = companion && playerId && companion.ownerId === playerId ? companion : null
  const moodKey = mine && mine.mood !== 'flirt' ? `${mine.id}:${mine.mood}:${mine.since}` : ''
  const muted = Boolean(mine?.muted)
  const [bubble, setBubble] = useState<{ key: string; text: string } | null>(null)
  const timerRef = useRef<number | null>(null)
  const counterRef = useRef(0)

  // Owner: Lady Luck never talks, so the badge never shows a speech bubble.
  const LADY_LUCK_SPEAKS = false
  const show = (key: string, text: string) => {
    if (!LADY_LUCK_SPEAKS) return
    setBubble({ key, text })
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setBubble(current => (current?.key === key ? null : current))
    }, BUBBLE_MS)
  }

  // Mood lines: arrival, cheer, sulky exit.
  useEffect(() => {
    if (!mine || !moodKey) return
    if (mine.muted && mine.mood !== 'sulk_leave') return
    show(moodKey, getLadyLuckMoodLine(mine))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moodKey])

  // One last pout when she is told to shut up.
  const mutedKey = mine && muted ? `${mine.id}:muted` : ''
  useEffect(() => {
    if (!mutedKey) return
    show(mutedKey, pickLadyLuckLine('muted', mutedKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutedKey])

  // Chatty in between: a short quip every ~9-14 s until muted.
  const chattyKey = mine && !muted && mine.mood !== 'sulk_leave' ? mine.id : ''
  useEffect(() => {
    if (!chattyKey) return
    let timeout = 0
    const schedule = () => {
      timeout = window.setTimeout(() => {
        counterRef.current += 1
        const context = counterRef.current % 3 === 0 ? 'serve' : 'flirt'
        show(`${chattyKey}:quip:${counterRef.current}`, pickLadyLuckLine(context, `${chattyKey}:${counterRef.current}`))
        schedule()
      }, QUIP_MIN_MS + Math.random() * QUIP_SPREAD_MS)
    }
    schedule()
    return () => window.clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chattyKey])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  if (!mine) return null
  const label = `Lady Luck is here: ${mine.streak} wins in a row`
  const showMute = canMute && !muted && mine.mood !== 'sulk_leave'

  return (
    <div
      className={`lady-luck-badge is-${placement}`}
      data-mood={mine.mood}
      data-muted={muted ? 'true' : 'false'}
      key={mine.id}
    >
      <span className="lady-luck-sticker" role="img" aria-label={label}>
        <LadyLuckBust />
      </span>
      <span className="lady-luck-hearts" aria-hidden="true">
        <span>{mine.mood === 'sulk_leave' ? '💔' : mine.mood === 'cheer' ? '💸' : '💖'}</span>
      </span>
      {bubble && (
        <span className="lady-luck-bubble" aria-live="polite" key={bubble.key}>
          {bubble.text}
        </span>
      )}
      {showMute && (
        <button
          type="button"
          className="lady-luck-mute is-mini"
          aria-label="Tell Lady Luck to shut up"
          title="Tell Lady Luck to shut up"
          onClick={requestLadyLuckMute}
        >
          🤫
        </button>
      )}
    </div>
  )
}

/**
 * Desktop "🤫 Shut up" button, shown only to Lady Luck's owner while she is
 * present and still talking. The server ignores anyone else.
 */
export function CompanionMuteButton({
  companion,
  yourId,
  hidden = false,
}: {
  companion: LadyLuckCompanionState | null | undefined
  yourId: string | null | undefined
  hidden?: boolean
}) {
  if (hidden || !companion || !yourId || companion.ownerId !== yourId) return null
  if (companion.muted || companion.mood === 'sulk_leave') return null
  return (
    <button
      type="button"
      className="lady-luck-mute is-desktop"
      aria-label="Tell Lady Luck to shut up"
      onClick={requestLadyLuckMute}
    >
      <span aria-hidden="true">🤫</span> Shut up
    </button>
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
