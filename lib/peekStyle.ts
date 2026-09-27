'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * How your own hole cards animate when you look at them. Purely a per-player
 * look preference (localStorage); timing and behaviour are shared.
 */
// Owner picked Light wipe as the default; hinge lift and fan squeeze were cut.
export const PEEK_STYLES = ['wipe', 'curl', 'spin', 'slide'] as const
export type PeekStyle = typeof PEEK_STYLES[number]
export const DEFAULT_PEEK_STYLE: PeekStyle = 'wipe'

export const PEEK_STYLE_LABELS: Record<PeekStyle, { name: string; blurb: string }> = {
  curl: { name: 'Corner curl', blurb: 'The near corner curls, then the back lifts' },
  spin: { name: 'Quick spin', blurb: 'A fast flip over the long edge with a pop' },
  slide: { name: 'Slide reveal', blurb: 'The back slides up off the face' },
  wipe: { name: 'Light wipe', blurb: 'A bright sweep wipes the back away' },
}

const STORAGE_KEY = 'poker-night:peek-style'
const CHANGE_EVENT = 'poker-night:peek-style-change'

export function normalizePeekStyle(value: unknown): PeekStyle {
  return typeof value === 'string' && (PEEK_STYLES as readonly string[]).includes(value)
    ? value as PeekStyle
    : DEFAULT_PEEK_STYLE
}

export function readPeekStyle(): PeekStyle {
  if (typeof window === 'undefined') return DEFAULT_PEEK_STYLE
  try {
    return normalizePeekStyle(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PEEK_STYLE
  }
}

let memoryStyle: PeekStyle | null = null

function getSnapshot(): PeekStyle {
  return memoryStyle ?? readPeekStyle()
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      memoryStyle = null
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

export function writePeekStyle(style: PeekStyle) {
  memoryStyle = style
  try {
    window.localStorage.setItem(STORAGE_KEY, style)
  } catch {
    // Blocked storage: the choice still applies for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** The saved peek style, kept in sync across every hand on the page. */
export function usePeekStyle(): [PeekStyle, (style: PeekStyle) => void] {
  const style = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PEEK_STYLE)
  const setStyle = useCallback((next: PeekStyle) => writePeekStyle(next), [])
  return [style, setStyle]
}
