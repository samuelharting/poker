'use client'

import { useEffect, useId, useRef } from 'react'

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
  }
  return (words[0] ?? '?').slice(0, 1).toUpperCase()
}

/**
 * Nickname entry for the landing page and the profile gate. With a saved name
 * it collapses to a "Playing as" chip so returning players sit down in one tap;
 * "Change name" reveals the input again.
 */
export function NicknameField({
  savedName = '',
  value,
  placeholder,
  autoFocus = false,
  onChange,
  onSubmit,
  onChangeName,
}: {
  savedName?: string
  value: string
  placeholder: string
  autoFocus?: boolean
  onChange: (nickname: string) => void
  onSubmit: () => void
  onChangeName?: () => void
}) {
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const wasSaved = useRef(Boolean(savedName))

  useEffect(() => {
    // "Change name" swaps the chip for the input: put the caret straight in it.
    if (wasSaved.current && !savedName) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    wasSaved.current = Boolean(savedName)
  }, [savedName])

  if (savedName) {
    return (
      <div className="entry-saved">
        <span className="entry-saved-avatar" aria-hidden="true">{getInitials(savedName)}</span>
        <div className="entry-saved-copy">
          <span>Playing as</span>
          <strong>{savedName}</strong>
        </div>
        <button type="button" className="entry-change-name" onClick={onChangeName}>
          Not {savedName}? Change name
        </button>
      </div>
    )
  }

  return (
    <div className="entry-field">
      <label htmlFor={inputId}>Your nickname</label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        className="input-dark"
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit()
          }
        }}
        maxLength={20}
        autoComplete="nickname"
        autoFocus={autoFocus}
        aria-describedby={hintId}
        enterKeyHint="go"
        suppressHydrationWarning
      />
      <p id={hintId} className="entry-hint">
        <span aria-hidden="true">🏆</span>
        Use the same name every time — your wins, win % and stats follow your name.
      </p>
    </div>
  )
}
