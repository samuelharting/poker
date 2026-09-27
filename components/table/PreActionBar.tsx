'use client'

import React from 'react'
import {
  isPreActionOptionActive,
  type PreActionKind,
  type PreActionOption,
  type QueuedPreAction,
} from '@/lib/poker/turnGuidance'

/** Desktop keys for the pre-action chips, in chip order. */
export const PRE_ACTION_SHORTCUT_KEYS = ['1', '2', '3'] as const

/**
 * Compact row of pre-action toggles shown while someone else is deciding.
 * One tap queues (one at a time), a second tap cancels.
 */
export function PreActionBar({
  options,
  queued,
  onToggle,
  showShortcuts = false,
}: {
  options: PreActionOption[]
  queued: QueuedPreAction | null
  onToggle: (kind: PreActionKind) => void
  showShortcuts?: boolean
}) {
  const activeOption = options.find(option => isPreActionOptionActive(queued, option.kind))

  return (
    <div className="pre-action-bar" role="group" aria-label="Pre-actions: act automatically when it is your turn">
      <div className="pre-action-bar-head" aria-live="polite">
        {activeOption ? (
          <>
            <span className="pre-action-bar-kicker is-queued">Queued</span>
            <span className="pre-action-bar-hint">tap again to cancel</span>
          </>
        ) : (
          <>
            <span className="pre-action-bar-kicker">Pre-action</span>
            <span className="pre-action-bar-hint">acts for you on your turn</span>
          </>
        )}
      </div>
      <div className="pre-action-chips" data-count={options.length}>
        {options.map((option, index) => {
          const active = isPreActionOptionActive(queued, option.kind)
          const shortcut = showShortcuts ? PRE_ACTION_SHORTCUT_KEYS[index] : undefined
          return (
            <button
              key={option.kind}
              type="button"
              className={`pre-action-chip is-${option.kind.replace('_', '-')} ${active ? 'is-active' : ''}`}
              data-pre-action={option.kind}
              aria-pressed={active}
              aria-label={active ? `Cancel pre-action: ${option.description}` : `Pre-action: ${option.description}`}
              aria-keyshortcuts={shortcut}
              title={shortcut ? `${option.description} (key ${shortcut})` : option.description}
              onClick={() => onToggle(option.kind)}
            >
              <span className="pre-action-chip-box" aria-hidden="true" />
              <span className="pre-action-chip-label">{option.label}</span>
              {shortcut && <kbd className="pre-action-chip-key" aria-hidden="true">{shortcut}</kbd>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
