import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SystemToasts, type SystemToast } from '@/components/ui/SystemToasts'

describe('SystemToasts', () => {
  it('renders visible status and error feedback for table actions', () => {
    const toasts: SystemToast[] = [
      { id: '1', message: 'Table settings saved', tone: 'success' },
      { id: '2', message: 'You need at least two connected players with chips to deal.', tone: 'error' },
    ]

    const markup = renderToStaticMarkup(
      React.createElement(SystemToasts, { toasts, onDismiss: () => {} })
    )

    expect(markup).toContain('system-toasts')
    expect(markup).toContain('Table settings saved')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('You need at least two connected players with chips to deal.')
    expect(markup).toContain('role="alert"')
  })
})
