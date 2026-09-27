'use client'

import { useEffect, useRef, useState } from 'react'
import { describeDrinkEvent, type DrinkEvent } from '@/lib/drinks'
import { useDrinks } from './DrinkContext'

const TOAST_DURATION_MS = 3800
const MAX_VISIBLE_TOASTS = 3

/** Table-wide "🍺 Sam cracked a beer (3)" announcements. */
export function DrinkToasts() {
  const drinks = useDrinks()
  const events = drinks?.events
  const yourId = drinks?.yourId ?? ''
  const [visible, setVisible] = useState<DrinkEvent[]>([])
  const seenRef = useRef(new Set<string>())
  const timersRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (!events?.length) {
      return
    }

    const fresh = events.filter(event => {
      if (seenRef.current.has(event.id)) {
        return false
      }
      seenRef.current.add(event.id)
      // Owner rule: drinking is shown with pictures (the 3D drink, the meter,
      // seat icons), never as text. No "cracked a beer" / "passed out" /
      // "water kicked in" toasts.
      void event
      return false

    })
    if (fresh.length === 0) {
      return
    }

    setVisible(current => [...current, ...fresh].slice(-MAX_VISIBLE_TOASTS))
    for (const event of fresh) {
      const timer = window.setTimeout(() => {
        timersRef.current.delete(event.id)
        setVisible(current => current.filter(entry => entry.id !== event.id))
      }, TOAST_DURATION_MS)
      timersRef.current.set(event.id, timer)
    }
  }, [events, yourId])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of Array.from(timers.values())) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  if (!drinks) {
    return null
  }

  return (
    <div className="drink-toasts" role="status" aria-live="polite">
      {visible.map(event => {
        const isSelf = event.playerId === yourId
        const copy = describeDrinkEvent(event, isSelf)
        return (
          <div
            key={event.id}
            className={`drink-toast is-${event.kind.replace(/_/g, '-')} ${isSelf ? 'is-self' : ''}`}
            style={{ ['--toast-life' as string]: `${TOAST_DURATION_MS}ms` }}
          >
            <span className="drink-toast-icon" aria-hidden="true">{copy.icon}</span>
            <span className="drink-toast-text">{copy.text}</span>
          </div>
        )
      })}
    </div>
  )
}
