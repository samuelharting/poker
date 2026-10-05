'use client'

import clsx from 'clsx'
import React from 'react'
import { TABLE_THEMES, TABLE_THEME_IDS } from '@/components/three/tableThemes'
import { useTableTheme } from '@/components/three/useTableTheme'

/**
 * Settings row: pick the look of the 3D table room. The choice is saved in this
 * browser only and changes this player's own view, never anyone else's.
 */
export function TableThemePicker() {
  const [theme, setTheme] = useTableTheme()

  return (
    <div className="settings-rule-row peek-style-row table-theme-row">
      <div className="peek-style-head">
        <div>
          <div className="settings-rule-name">Table theme</div>
          <div className="settings-rule-copy">{TABLE_THEMES[theme].blurb} Changes only your own view of the 3D table.</div>
        </div>
      </div>
      <div className="peek-style-options table-theme-options" role="radiogroup" aria-label="Table theme">
        {TABLE_THEME_IDS.map(id => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme === id}
            className={clsx('settings-pill', theme === id && 'is-active')}
            data-table-theme-option={id}
            onClick={() => setTheme(id)}
          >
            {TABLE_THEMES[id].label}
          </button>
        ))}
      </div>
    </div>
  )
}
