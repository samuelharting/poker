'use client'

import { useEffect, useRef, useState } from 'react'
import { STICKY_NOTE_MAX_LENGTH, sanitizeStickyText } from '@/lib/stickyNote'

/**
 * "Sticky note" in the targeted player panel (desktop and phone): a button that
 * opens a one-line composer. Enter sticks it on, Escape cancels just the
 * composer. When the note is on cooldown the button is disabled and its
 * tooltip says why. The server enforces every rule.
 */
export function StickyNoteControl({
  targetName,
  isConnected,
  blockedReason,
  onSend,
}: {
  targetName: string
  isConnected: boolean
  /** Why a note can't be stuck right now (cooldown / one per hand), or null. */
  blockedReason: string | null
  onSend: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const blocked = !isConnected || Boolean(blockedReason)
  const count = Array.from(draft).length
  const clean = sanitizeStickyText(draft)

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    // A cooldown that starts (e.g. after sending) folds the composer away.
    if (blocked) setOpen(false)
  }, [blocked])

  const submit = () => {
    if (blocked || !clean.ok) return
    onSend(clean.text)
    setDraft('')
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="prank-controls" role="group" aria-label={`Sticky note for ${targetName}`}>
        <button
          type="button"
          className="prank-button is-sticky"
          disabled={blocked}
          onClick={() => setOpen(true)}
          title={blockedReason ?? `Stick a note on ${targetName}'s forehead until the hand ends`}
          aria-label={`Sticky note on ${targetName}. ${blockedReason ?? ''}`.trim()}
        >
          <span className="prank-button-icon" aria-hidden="true">📝</span>
          <span className="prank-button-copy">
            <strong>Sticky note</strong>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="sticky-note-composer" role="group" aria-label={`Sticky note for ${targetName}`}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder="One word…"
        aria-label={`Sticky note text for ${targetName}, ${STICKY_NOTE_MAX_LENGTH} characters max`}
        autoComplete="off"
        onChange={event => setDraft(Array.from(event.target.value).slice(0, STICKY_NOTE_MAX_LENGTH).join(''))}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') {
            // Only cancel the composer, not the whole panel behind it.
            event.preventDefault()
            event.nativeEvent.stopPropagation()
            setOpen(false)
          }
        }}
      />
      <span className={`sticky-note-composer-count ${count >= STICKY_NOTE_MAX_LENGTH ? 'is-full' : ''}`} aria-live="off">
        {count}/{STICKY_NOTE_MAX_LENGTH}
      </span>
      <button type="button" disabled={blocked || !clean.ok} onClick={submit}>
        Stick
      </button>
    </div>
  )
}
