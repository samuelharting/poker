'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  DEFAULT_TABLE_THEME,
  TABLE_THEME_STORAGE_KEY,
  normalizeTableTheme,
  readStoredTableTheme,
  writeStoredTableTheme,
  type TableThemeId,
} from './tableThemes'

/**
 * The local player's table theme as a tiny external store: the Settings modal
 * writes it and the 3D room reads it, with no prop plumbing through the table
 * tree. It lives in this browser's localStorage only (per player, never sent to
 * the server) and is read lazily so server rendering always sees the lounge.
 */

let current: TableThemeId | null = null
const listeners = new Set<() => void>()
let storageHooked = false

function emit() {
  listeners.forEach(listener => listener())
}

function handleStorage(event: StorageEvent) {
  if (event.key !== TABLE_THEME_STORAGE_KEY && event.key !== null) return
  const next = readStoredTableTheme()
  if (next === current) return
  current = next
  emit()
}

function getSnapshot(): TableThemeId {
  if (current === null) current = readStoredTableTheme()
  return current
}

function getServerSnapshot(): TableThemeId {
  return DEFAULT_TABLE_THEME
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!storageHooked && typeof window !== 'undefined') {
    storageHooked = true
    // Another tab of the same player changed the choice.
    window.addEventListener('storage', handleStorage)
  }
  return () => { listeners.delete(listener) }
}

/** Sets and saves the theme. An unknown id is treated as the lounge. */
export function setTableTheme(id: unknown) {
  const next = normalizeTableTheme(id)
  writeStoredTableTheme(next)
  if (next === current) return
  current = next
  emit()
}

/** Development handle for scripts (scripts/snap-themes.mjs): window.__pokerSetTableTheme('basement'). */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __pokerSetTableTheme?: (id: unknown) => void }).__pokerSetTableTheme = setTableTheme
}

export function useTableThemeId(): TableThemeId {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useTableTheme(): readonly [TableThemeId, (id: TableThemeId) => void] {
  const id = useTableThemeId()
  const set = useCallback((next: TableThemeId) => setTableTheme(next), [])
  return [id, set] as const
}
