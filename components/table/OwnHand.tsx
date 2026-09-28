'use client'

import type { Card } from '@/lib/poker/types'
import type { ShowCardsMode } from '@/lib/poker/types'
import type { PokerSoundCueKind } from '@/lib/poker/soundscape'
import clsx from 'clsx'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PlayingCard } from '@/components/ui/PlayingCard'
import { EmojiGlyph } from '@/components/ui/EmojiGlyph'
import { usePeekStyle, type PeekStyle } from '@/lib/peekStyle'

interface OwnHandProps {
  cards: Card[]
  isActing: boolean
  isFolded?: boolean
  isWinner?: boolean
  winningCards?: Card[]
  handDescription?: string | null
  showCardsMode?: ShowCardsMode
  revealChoiceActive?: boolean
  /**
   * Live hand: your cards are shown face-up for a few seconds when dealt, then
   * lie face-down; a quick click/tap/Space peeks briefly, holding keeps them up.
   */
  concealed?: boolean
  /** Fired when your peek starts/stops so the table can see you looking. */
  onPeekChange?: (peeking: boolean) => void
  onSoundCue?: (cue: PokerSoundCueKind) => void
  socialMessage?: string
  socialMessageExpiresAt?: number
  socialEmote?: string
  socialEmoteExpiresAt?: number
  socialEmoteTargeted?: boolean
  /** Sender of a targeted emote, shown as "Name →". */
  socialEmoteFrom?: string
  showCardsControl?: React.ReactNode
  /**
   * Which reveal animation the cards use (card-peek.css). Defaults to the
   * player's saved preference from Settings.
   */
  peekStyle?: PeekStyle
}

/** Holding longer than this turns a quick squeeze into a full look that lasts while held. */
export const PEEK_HOLD_THRESHOLD_MS = 240
/** A quick click/tap/Space tap squeezes the cards up this long, then they settle on their own. */
export const QUICK_PEEK_MS = 900
/** Freshly dealt cards stay face-up this long before flipping down on their own. */
export const DEAL_REVEAL_MS = 3000
const PEEKED_ONCE_STORAGE_KEY = 'poker-night:peeked-once'
let peekedThisSession = false

function hasPeekedBefore(): boolean {
  if (peekedThisSession) return true
  if (typeof window === 'undefined') return false
  try {
    peekedThisSession = window.sessionStorage.getItem(PEEKED_ONCE_STORAGE_KEY) === '1'
  } catch {
    // Storage can be blocked; the hint simply shows again.
  }
  return peekedThisSession
}

function rememberPeeked() {
  peekedThisSession = true
  try {
    window.sessionStorage.setItem(PEEKED_ONCE_STORAGE_KEY, '1')
  } catch {
    // Ignore blocked storage.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  // Inside a dialog (settings, emoji picker) Space keeps its normal meaning.
  if (target.closest('[role="dialog"], dialog, [aria-modal="true"]')) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isPeekKey(event: KeyboardEvent): boolean {
  return (event.key === ' ' || event.code === 'Space' || event.key === 'p' || event.key === 'P') &&
    !event.altKey && !event.ctrlKey && !event.metaKey
}

function buzz(touch: boolean, ms: number) {
  if (!touch || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(ms)
  } catch {
    // Some browsers throw without a user activation.
  }
}

export type PeekMode = 'idle' | 'deal' | 'quick' | 'held'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface PeekPress {
  at: number
  touch: boolean
}

/**
 * Dealt: the cards flip face-up for DEAL_REVEAL_MS, then down on their own.
 * Quick click / tap / Space tap: the cards squeeze up briefly, then settle by
 * themselves. Press and hold (mouse, touch or Space): they lift all the way and
 * stay up for as long as you hold, settling when you let go.
 */
function useCardPeek(
  enabled: boolean,
  handKey: string,
  onPeekChange?: (peeking: boolean) => void,
  onSoundCue?: (cue: PokerSoundCueKind) => void
) {
  const [mode, setModeState] = useState<PeekMode>('idle')
  const [peekedOnce, setPeekedOnce] = useState(hasPeekedBefore)
  const modeRef = useRef<PeekMode>('idle')
  const pressRef = useRef<PeekPress | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbacksRef = useRef({ onPeekChange, onSoundCue })
  callbacksRef.current = { onPeekChange, onSoundCue }

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    holdTimerRef.current = null
    settleTimerRef.current = null
  }, [])

  const setMode = useCallback((next: PeekMode, touch = false) => {
    const previous = modeRef.current
    if (previous === next) return
    modeRef.current = next
    setModeState(next)
    if (previous === 'idle') {
      callbacksRef.current.onPeekChange?.(true)
      callbacksRef.current.onSoundCue?.('card_peek')
      buzz(touch, 10)
    } else if (next === 'idle') {
      callbacksRef.current.onPeekChange?.(false)
      callbacksRef.current.onSoundCue?.('card_settle')
      buzz(touch, 6)
    } else if (next === 'held') {
      buzz(touch, 8)
    }
  }, [])

  // A new hand deals the cards face-up for a moment (the table sees you look),
  // then they flip down. The hand ending puts them down (the server clears the
  // peek itself). Layout effect: no face-down frame before the reveal.
  const revealedHandRef = useRef<string | null>(null)
  const revealStartedAtRef = useRef(0)
  useIsomorphicLayoutEffect(() => {
    clearTimers()
    pressRef.current = null
    if (!enabled || !handKey) {
      revealedHandRef.current = null
      if (modeRef.current !== 'idle') {
        modeRef.current = 'idle'
        setModeState('idle')
      }
      return
    }
    if (revealedHandRef.current !== handKey) {
      revealedHandRef.current = handKey
      revealStartedAtRef.current = Date.now()
      if (modeRef.current === 'idle') setMode('deal')
    }
    // Re-run for the same hand (e.g. React re-mounting effects): keep the
    // reveal going for whatever is left of it.
    if (modeRef.current === 'deal') {
      const left = Math.max(0, DEAL_REVEAL_MS - (Date.now() - revealStartedAtRef.current))
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        if (!pressRef.current && modeRef.current === 'deal') setMode('idle')
      }, left)
    }
  }, [clearTimers, enabled, handKey, setMode])

  // Leaving mid-peek: tell the table you stopped looking.
  // Deferred a tick: React re-mounting effects (StrictMode) must not cancel
  // the deal-time look it immediately resumes.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      setTimeout(() => {
        if (!mountedRef.current && modeRef.current !== 'idle') callbacksRef.current.onPeekChange?.(false)
      }, 0)
    }
  }, [clearTimers])

  const press = useCallback((touch: boolean) => {
    if (!enabled || pressRef.current) return
    clearTimers()
    pressRef.current = { at: Date.now(), touch }
    rememberPeeked()
    setPeekedOnce(true)
    if (modeRef.current === 'idle') setMode('quick', touch)
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      if (pressRef.current) setMode('held', touch)
    }, PEEK_HOLD_THRESHOLD_MS)
  }, [clearTimers, enabled, setMode])

  const release = useCallback((cancelled = false) => {
    const current = pressRef.current
    pressRef.current = null
    if (!current) return
    clearTimers()
    const held = Date.now() - current.at
    if (cancelled || modeRef.current === 'held' || held >= PEEK_HOLD_THRESHOLD_MS) {
      setMode('idle', current.touch)
      return
    }
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      if (!pressRef.current) setMode('idle', current.touch)
    }, Math.max(0, QUICK_PEEK_MS - held))
  }, [clearTimers, setMode])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPeekKey(event) || isTypingTarget(event.target)) return
      // Space must never scroll the page or press a focused action button,
      // and its auto-repeat must not re-trigger the peek.
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) press(false)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isPeekKey(event) || isTypingTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      release()
    }
    const handleBlur = () => {
      if (pressRef.current) release(true)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled, press, release])

  const pointerHandlers = enabled
    ? {
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return
          event.preventDefault()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Synthetic events have no capturable pointer.
          }
          press(event.pointerType === 'touch')
        },
        onPointerUp: () => release(),
        onPointerCancel: () => release(true),
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      }
    : {}

  return { mode: enabled ? mode : ('idle' as PeekMode), peekedOnce, pointerHandlers }
}

export function OwnHand({
  cards,
  isActing,
  isFolded = false,
  isWinner = false,
  winningCards = [],
  handDescription = null,
  showCardsMode = 'none',
  revealChoiceActive = false,
  concealed = false,
  onPeekChange,
  onSoundCue,
  socialMessage,
  socialMessageExpiresAt,
  socialEmote,
  socialEmoteExpiresAt,
  socialEmoteTargeted = false,
  socialEmoteFrom,
  showCardsControl = null,
  peekStyle: peekStyleProp,
}: OwnHandProps) {
  const [savedPeekStyle] = usePeekStyle()
  const peekStyle = peekStyleProp ?? savedPeekStyle
  const canPeek = concealed && cards.length > 0
  const handKey = cards.map(card => `${card.rank}${card.suit}`).join('-')
  const { mode: peekMode, peekedOnce, pointerHandlers } = useCardPeek(canPeek, handKey, onPeekChange, onSoundCue)
  const peeking = peekMode !== 'idle'

  if (cards.length === 0) {
    return null
  }

  const isFaceHidden = canPeek && !peeking
  const visibleHandDescription = isFaceHidden ? null : handDescription

  // Your own cards are always face up to you. After a hand, the ones the table
  // cannot see are marked instead of flipped over.
  const isShownToTable = (index: number) => (
    showCardsMode === 'both' ||
    (showCardsMode === 'left' && index === 0) ||
    (showCardsMode === 'right' && index === 1)
  )
  const isHiddenFromTable = revealChoiceActive && showCardsMode === 'none'

  const socialBubbleTtl = Math.max(0, socialMessageExpiresAt ? socialMessageExpiresAt - Date.now() : 0)
  const socialEmoteTtl = Math.max(0, socialEmoteExpiresAt ? socialEmoteExpiresAt - Date.now() : 0)

  return (
    <div
      className={clsx(
        'own-hand-area',
        visibleHandDescription && 'has-strength',
        isActing && 'is-acting',
        isFolded && 'is-folded',
        isWinner && 'is-winner',
        canPeek && 'is-concealable'
      )}
      aria-label={visibleHandDescription ? `Your hand: ${visibleHandDescription}` : 'Your hand'}
    >
      {(socialMessage || socialEmote) && (
        <div className="own-hand-social" aria-live="polite">
          {socialMessage && (
            <div
              key={`${socialMessage}-${socialMessageExpiresAt}`}
              className="player-chat-bubble"
              style={{ ['--chat-ttl' as any]: `${socialBubbleTtl}ms` }}
            >
              {socialMessage}
            </div>
          )}
          {socialEmote && (
            <div
              key={`${socialEmote}-${socialEmoteExpiresAt}`}
              className={clsx(
                'player-emote-badge',
                socialEmoteTargeted && 'player-emote-badge-targeted'
              )}
              style={{ ['--chat-ttl' as any]: `${socialEmoteTtl}ms` }}
            >
              {socialEmoteFrom && <span className="player-emote-from">{socialEmoteFrom} →</span>}
              <EmojiGlyph emoji={socialEmote} />
            </div>
          )}
        </div>
      )}
      {isActing && <div className="own-hand-turn-chip">Act now</div>}
      {visibleHandDescription && (
        <div
          className={clsx('own-hand-strength', canPeek && 'is-peek-strength')}
          role="status"
          aria-live="polite"
        >
          <span className="own-hand-strength-value">{visibleHandDescription}</span>
        </div>
      )}
      <div
        className={clsx(
          'own-card-row',
          isWinner && 'is-winner',
          isFolded && 'is-folded',
          canPeek && 'is-concealed',
          peeking && 'is-peeking',
          peekMode === 'held' && 'is-peek-held',
          peekMode === 'deal' && 'is-peek-open'
        )}
        {...(canPeek
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': peeking,
              'aria-label': 'Look at your cards (hold to keep looking)',
              'data-peek': peekMode,
              'data-peek-style': peekStyle,
            }
          : {})}
        {...pointerHandlers}
      >
        {cards.map((card, index) => (
          <div
            key={`${card.rank}-${card.suit}-${index}`}
            className={clsx(
              'own-card-slot',
              index === 0 ? 'own-card-slot-left' : 'own-card-slot-right',
              revealChoiceActive && (isShownToTable(index) ? 'is-shown' : 'is-private')
            )}
          >
            <div className={clsx('own-card-peek', canPeek && 'card-deal-anim')}>
              <div className="own-card-peek-body">
                {/* Turns the card on its side for the 'peel' style; plain wrapper otherwise. */}
                <div className="own-card-peek-turn">
                  <div className="own-card-peek-face" aria-hidden={isFaceHidden || undefined}>
                    <PlayingCard
                      card={card}
                      size="xl"
                      animateIn={!canPeek}
                      highlighted={isWinner && (
                        winningCards.length === 0 || winningCards.some(
                          winningCard => winningCard.rank === card.rank && winningCard.suit === card.suit
                        )
                      )}
                    />
                  </div>
                  {canPeek && (
                    <>
                      <span className="own-card-peek-shade" aria-hidden="true" />
                      <div className="own-card-cover" aria-hidden="true">
                        <div className="own-card-cover-curl">
                          <div className="own-card-cover-back" />
                          <span className="own-card-cover-sheen" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        {isHiddenFromTable && (
          <span className="own-hand-private-mark">Hidden from table</span>
        )}
        {canPeek && !peekedOnce && (
          <span className="own-hand-peek-hint" aria-hidden="true">
            <span className="own-hand-peek-hint-touch">Hold or tap to look</span>
            <span className="own-hand-peek-hint-mouse">Hold Space or click to look</span>
          </span>
        )}
      </div>
      {showCardsControl && <div className="own-hand-show-cards">{showCardsControl}</div>}
    </div>
  )
}
