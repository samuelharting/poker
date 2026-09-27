'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BUZZ, isSober, normalizeDrinkState, projectNextSoberTax } from '@/lib/drinks'
import { useShotLaggedDrinks } from './useShotLag'
import {
  describeMushroomEvent,
  MUSHROOM_AUTO_SPIKE_MS,
  type MushroomEvent,
  type PrivateMushroomState,
} from '@/lib/mushroom'
import type { Card, SeatPlayer, TableState } from '@/lib/poker/types'
import { useDrinks } from './DrinkContext'

/**
 * The drinking game's first-person layer for the desktop 3D table (phones
 * get none of this): blackout beat, hangover, the sober look and tax chip,
 * the pill prompt, its reveal, and the trip's legible board strip.
 *
 * Fairness floor: everything that darkens, blurs or warps lives on the 3D
 * stage (`.fun-vision-3d` inside it, or the canvas), which sits BELOW every
 * HUD layer. Action buttons, bet amounts, the timer, your 2D cards and the
 * board strip stay crisp on top.
 */

const TRIP_SUIT_EMOJI = ['🐸', '🍩', '🦄', '🌵', '🍄', '👽', '🐙', '🌈', '🦩', '🍕', '🪐', '🐝', '🍭', '🦖', '🌻', '🐌']
const SUITS: Array<Card['suit']> = ['spades', 'hearts', 'diamonds', 'clubs']
const RANK_LABEL: Record<string, string> = { T: '10' }
const REVEAL_TOAST_MS = 5200
const TRIP_DRAIN_MS = 5000

type Root = HTMLElement

function setFlag(root: Root, name: string, value: string | null) {
  if (value === null) delete root.dataset[name]
  else if (root.dataset[name] !== value) root.dataset[name] = value
}

function pickTripSuits(): Record<Card['suit'], string> {
  const pool = [...TRIP_SUIT_EMOJI]
  const picked = {} as Record<Card['suit'], string>
  for (const suit of SUITS) {
    const index = Math.floor(Math.random() * pool.length)
    picked[suit] = pool.splice(index, 1)[0]!
  }
  return picked
}

/** A dull cartoon "bonk" (only if sound is on). */
function playThud() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const now = context.currentTime
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(140, now)
    oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.22)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.34)
    oscillator.onended = () => void context.close()
  } catch {
    // Sound is a garnish.
  }
}

interface FunLayerProps {
  tableState: TableState
  yourId: string
  privateMushroom: PrivateMushroomState | null
  mushroomEvents: readonly MushroomEvent[]
  onSpike: (targetId: string) => void
  soundMuted: boolean
}

export function FunLayer({ tableState, yourId, privateMushroom, mushroomEvents, onSpike, soundMuted }: FunLayerProps) {
  const drinks = useDrinks()
  const me = tableState.players.find(player => player.id === yourId)
  const serverDrinks = useMemo(() => normalizeDrinkState(me?.drinks), [me?.drinks])
  // A shot blackout starts once the glass is down, not when it's poured.
  const myDrinks = useShotLaggedDrinks(serverDrinks)
  const funOn = tableState.funModeEnabled !== false
  const capable = me?.drinkCapable === true
  const isMyTurn = tableState.phase === 'in_hand' && tableState.actingPlayerId === yourId
  const tripping = Boolean(me?.trip) && funOn
  const [tripSuits, setTripSuits] = useState<Record<Card['suit'], string> | null>(null)
  const [draining, setDraining] = useState(false)
  const wasTrippingRef = useRef(false)

  // --- Root flags: every visual reads these from CSS -----------------------
  useEffect(() => {
    const root = document.documentElement
    setFlag(root, 'funBlackout', myDrinks.passedOut && funOn ? 'on' : null)
    setFlag(root, 'funHangover', myDrinks.hungover && !myDrinks.passedOut && funOn ? 'on' : null)
    setFlag(root, 'funSober', BUZZ.soberPenaltiesEnabled && funOn && capable && me && isSober(myDrinks.level) && !myDrinks.passedOut && !myDrinks.hungover && !tripping ? 'on' : null)
    setFlag(root, 'funTrip', tripping ? 'on' : draining ? 'ending' : null)
    setFlag(root, 'funMyTurn', isMyTurn ? 'on' : null)
  }, [capable, draining, funOn, isMyTurn, me, myDrinks.hungover, myDrinks.level, myDrinks.passedOut, tripping])

  useEffect(() => () => {
    const root = document.documentElement
    for (const name of ['funBlackout', 'funHangover', 'funSober', 'funTrip', 'funMyTurn']) delete root.dataset[name]
    for (const suit of SUITS) root.style.removeProperty(`--trip-suit-${suit}`)
  }, [])

  // --- Trip: consistent emoji per suit for the whole trip, and a slow drain at the end.
  useEffect(() => {
    if (tripping && !wasTrippingRef.current) {
      setTripSuits(pickTripSuits())
      setDraining(false)
    }
    if (!tripping && wasTrippingRef.current) {
      setDraining(true)
      const timer = window.setTimeout(() => {
        setDraining(false)
        setTripSuits(null)
      }, TRIP_DRAIN_MS)
      wasTrippingRef.current = tripping
      return () => window.clearTimeout(timer)
    }
    wasTrippingRef.current = tripping
  }, [tripping])

  useEffect(() => {
    const root = document.documentElement
    for (const suit of SUITS) {
      if (tripSuits && tripping) root.style.setProperty(`--trip-suit-${suit}`, `"${tripSuits[suit]}"`)
      else root.style.removeProperty(`--trip-suit-${suit}`)
    }
  }, [tripSuits, tripping])

  // --- Blackout: the thud lands as the head hits the table.
  const passedOut = myDrinks.passedOut
  useEffect(() => {
    if (!passedOut || soundMuted) return
    const timer = window.setTimeout(playThud, 640)
    return () => window.clearTimeout(timer)
  }, [passedOut, soundMuted])

  // --- Sober tax chip: posted this hand, or coming next hand.
  const dealtIn = Boolean(me?.hasCards) && tableState.phase === 'in_hand'
  const taxThisHand = tableState.phase === 'in_hand' ? myDrinks.soberTax : 0
  const taxNext = funOn && capable && me
    ? projectNextSoberTax(myDrinks, {
      smallBlind: tableState.smallBlind,
      bigBlind: tableState.bigBlind,
      stack: me.stack,
      dealtIn,
    })
    : 0

  if (!drinks || !me || !funOn || !capable) {
    return <PillReveal events={mushroomEvents} yourId={yourId} />
  }

  return (
    <>
      {(taxThisHand > 0 || taxNext > 0) && (
        <SoberTaxChip
          key={`${tableState.handNumber}:${taxThisHand}`}
          amount={taxThisHand > 0 ? taxThisHand : taxNext}
          upcoming={taxThisHand <= 0}
        />
      )}
      {tripping && tripSuits && tableState.communityCards.length > 0 && (
        <TripBoardStrip cards={tableState.communityCards} suits={tripSuits} />
      )}
      <PillPrompt
        state={privateMushroom}
        players={tableState.players}
        yourId={yourId}
        isMyTurn={isMyTurn}
        serverOffsetMs={drinks.serverOffsetMs}
        onSpike={onSpike}
      />
      {privateMushroom?.status === 'spiked' && (
        <span className="pill-secret-marker" aria-label="You slipped a pill into someone's water" title="Your secret">
          💊
        </span>
      )}
      <PillReveal events={mushroomEvents} yourId={yourId} />
    </>
  )
}

/** "😐 −$10": compact, icon plus money, near the hand. Coins drain toward the pot when posted. */
function SoberTaxChip({ amount, upcoming }: { amount: number; upcoming: boolean }) {
  return (
    <div
      className={`sober-tax-chip ${upcoming ? 'is-upcoming' : 'is-posted'}`}
      role="status"
      aria-label={upcoming ? `Sober tax next hand: $${amount}` : `Sober tax this hand: $${amount}`}
    >
      <span className="sober-tax-face" aria-hidden="true">😐</span>
      <b>−${amount.toLocaleString()}</b>
      {upcoming && <span className="sober-tax-next" aria-hidden="true">⏭</span>}
      {!upcoming && (
        <span className="sober-tax-coins" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  )
}

/** While tripping the 3D board melts, so the ranks sit here, crisp (suits are the trip's emoji). */
function TripBoardStrip({ cards, suits }: { cards: Card[]; suits: Record<Card['suit'], string> }) {
  return (
    <div className="trip-board-strip" aria-label={`Board: ${cards.map(card => `${RANK_LABEL[card.rank] ?? card.rank} of ${card.suit}`).join(', ')}`}>
      {cards.map((card, index) => (
        <span key={`${card.rank}${card.suit}${index}`} className="trip-board-card" style={{ ['--i' as string]: index } as CSSProperties}>
          <b>{RANK_LABEL[card.rank] ?? card.rank}</b>
          <i aria-hidden="true">{suits[card.suit]}</i>
        </span>
      ))}
    </div>
  )
}

/**
 * "You found a pill!": pick whose water gets it. One target is pre-selected
 * at random; OK (or closing the card, or the countdown running out) spikes
 * the selected one. Held back while it's your turn so it never covers the
 * action, and the server keeps the same countdown so it can't be stalled.
 */
const PILL_PROMPT_EXIT_MS = 240

function PillPrompt({
  state,
  players,
  yourId,
  isMyTurn,
  serverOffsetMs,
  onSpike,
}: {
  state: PrivateMushroomState | null
  players: readonly SeatPlayer[]
  yourId: string
  isMyTurn: boolean
  serverOffsetMs: number
  onSpike: (targetId: string) => void
}) {
  const holding = state?.status === 'holding' ? state : null
  const targets = useMemo(
    () => players.filter(player => player.id !== yourId && player.drinkCapable === true),
    [players, yourId]
  )
  const [picked, setPicked] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const suggested = holding?.suggestedVictimId ?? null
  const selected = picked && targets.some(target => target.id === picked) ? picked : suggested

  useEffect(() => {
    if (!holding) {
      setPicked(null)
      setSent(false)
    }
  }, [holding])

  const deadline = holding?.autoSpikeAt ? holding.autoSpikeAt - serverOffsetMs : null
  useEffect(() => {
    if (!deadline) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [deadline])

  const commit = useCallback(() => {
    if (!selected || sent) return
    setSent(true)
    onSpike(selected)
  }, [onSpike, selected, sent])

  // The countdown ran out on this screen: spike the current pick (the server
  // would spike its own pre-selection a moment later anyway).
  const remainingMs = deadline ? Math.max(0, deadline - now) : MUSHROOM_AUTO_SPIKE_MS
  useEffect(() => {
    if (deadline && remainingMs <= 0 && !isMyTurn) commit()
  }, [commit, deadline, isMyTurn, remainingMs])

  const visible = Boolean(holding) && !isMyTurn && targets.length > 0 && !sent
  // Ease out instead of vanishing in one frame (OK, countdown, your turn).
  const [leaving, setLeaving] = useState(false)
  const wasVisible = useRef(false)
  const lastSelected = useRef<string | null>(null)
  if (visible) lastSelected.current = selected
  useEffect(() => {
    if (visible) {
      wasVisible.current = true
      setLeaving(false)
      return
    }
    if (!wasVisible.current) return
    wasVisible.current = false
    setLeaving(true)
    const timer = window.setTimeout(() => setLeaving(false), PILL_PROMPT_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [visible])
  if (!visible && !leaving) return null
  const shownSelected = visible ? selected : lastSelected.current
  const fraction = Math.max(0, Math.min(1, remainingMs / MUSHROOM_AUTO_SPIKE_MS))
  const seconds = Math.ceil(remainingMs / 1000)

  return (
    <section
      className={`pill-prompt ${visible ? '' : 'is-leaving'}`}
      role="dialog"
      aria-label="You found a pill"
      aria-hidden={visible ? undefined : true}
      data-testid={visible ? 'pill-prompt' : undefined}
      inert={visible ? undefined : true}
    >
      <button type="button" className="pill-prompt-close" onClick={commit} aria-label="Close (spikes the selected player)">
        ×
      </button>
      <div className="pill-prompt-hero" aria-hidden="true">💊</div>
      <p className="pill-prompt-copy">You found a pill! Pick whose water gets it.</p>
      <div className="pill-prompt-targets" role="radiogroup" aria-label="Who gets the pill">
        {targets.map(target => (
          <button
            key={target.id}
            type="button"
            role="radio"
            aria-checked={shownSelected === target.id}
            className={`pill-target ${shownSelected === target.id ? 'is-selected' : ''}`}
            onClick={() => setPicked(target.id)}
            data-pill-target={target.id}
          >
            <span className="pill-target-avatar" aria-hidden="true">{initials(target.nickname)}</span>
            <span className="pill-target-name">{target.nickname.replace(/^Bot\s+/i, '')}</span>
          </button>
        ))}
      </div>
      <button type="button" className="pill-prompt-ok" onClick={commit} disabled={!selected}>
        <svg className="pill-prompt-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="pill-prompt-ring-track" cx="18" cy="18" r="15.5" />
          <circle
            className="pill-prompt-ring-fill"
            cx="18"
            cy="18"
            r="15.5"
            pathLength={100}
            strokeDasharray={`${fraction * 100} 100`}
          />
        </svg>
        <span>OK</span>
        <small aria-hidden="true">{seconds}</small>
      </button>
    </section>
  )
}

function initials(name: string) {
  const clean = name.replace(/^Bot\s+/i, '').trim()
  return (clean[0] ?? '?').toUpperCase()
}

/** The table-wide reveal when a pill kicks in ("💊 Sam spiked Alex's water!"). */
function PillReveal({ events, yourId }: { events: readonly MushroomEvent[]; yourId: string }) {
  const [shown, setShown] = useState<MushroomEvent | null>(null)
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (seenRef.current === null) {
      // Don't replay old news after a reconnect.
      seenRef.current = new Set(events.map(event => event.id))
      return
    }
    const fresh = events.filter(event => !seenRef.current!.has(event.id))
    fresh.forEach(event => seenRef.current!.add(event.id))
    const reveal = fresh.filter(event => event.kind === 'trip_started').at(-1)
    if (!reveal) return
    setShown(reveal)
    const timer = window.setTimeout(() => setShown(null), REVEAL_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [events])

  if (!shown) return null
  const copy = describeMushroomEvent(shown, yourId)
  return (
    <div className="pill-reveal" role="status" aria-live="polite" key={shown.id}>
      <span className="pill-reveal-icon" aria-hidden="true">{copy.icon}</span>
      <span className="pill-reveal-text">{copy.text}</span>
    </div>
  )
}
