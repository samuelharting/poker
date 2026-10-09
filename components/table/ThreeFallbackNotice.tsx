'use client'

import { useEffect, useState } from 'react'
import { clearThreeFallback, type ThreeFallbackState } from '@/components/three/threeFallback'

const AUTO_HIDE_MS = 12_000

/**
 * A small note that the 3D room stepped down to the 2D table (graphics
 * trouble), with a way back. Hides itself after a few seconds.
 */
export function ThreeFallbackNotice({ fallback }: { fallback: ThreeFallbackState }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [fallback.at])

  if (!visible) return null

  return (
    <div className="three-fallback-notice" role="status" aria-live="polite">
      <span>Graphics hiccup: switched to the 2D table.</span>
      <button
        type="button"
        className="three-fallback-retry"
        onClick={() => {
          // A fresh page gets a fresh GPU context (Chrome can refuse new ones after a GPU reset).
          clearThreeFallback()
          window.location.reload()
        }}
      >
        Try 3D again
      </button>
      <button
        type="button"
        className="three-fallback-dismiss"
        aria-label="Dismiss"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  )
}
