'use client'

import clsx from 'clsx'

export const ISRAEL_FLAG_EMOJI = '\uD83C\uDDEE\uD83C\uDDF1'

export function EmojiGlyph({
  emoji,
  className,
}: {
  emoji: string
  className?: string
}) {
  if (emoji === ISRAEL_FLAG_EMOJI) {
    return (
      <span className={clsx('emoji-glyph emoji-glyph-israel', className)} aria-hidden="true">
        <svg viewBox="0 0 36 26" focusable="false">
          <rect x="0.5" y="0.5" width="35" height="25" rx="2.5" fill="#fff" stroke="rgba(0,0,0,0.2)" />
          <rect x="1" y="4" width="34" height="3" fill="#1746a2" />
          <rect x="1" y="19" width="34" height="3" fill="#1746a2" />
          <path d="M18 8.2 22.2 15.4H13.8L18 8.2Z" fill="none" stroke="#1746a2" strokeWidth="1.45" />
          <path d="m18 17.8-4.2-7.2h8.4L18 17.8Z" fill="none" stroke="#1746a2" strokeWidth="1.45" />
        </svg>
      </span>
    )
  }

  return <span className={clsx('emoji-glyph', className)} aria-hidden="true">{emoji}</span>
}
