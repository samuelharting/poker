'use client'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast-item toast-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <div className="toast-copy">{toast.message}</div>
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            x
          </button>
        </div>
      ))}
    </div>
  )
}
