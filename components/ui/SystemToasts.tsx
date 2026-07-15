'use client'

import React from 'react'

export type SystemToastTone = 'info' | 'success' | 'error'

export interface SystemToast {
  id: string
  message: string
  tone: SystemToastTone
}

interface SystemToastsProps {
  toasts: SystemToast[]
  onDismiss: (id: string) => void
}

export function SystemToasts({ toasts, onDismiss }: SystemToastsProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="system-toasts" aria-live="polite" aria-label="Table notifications">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`system-toast system-toast-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <div className="system-toast-message">{toast.message}</div>
          <button
            type="button"
            className="system-toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  )
}
