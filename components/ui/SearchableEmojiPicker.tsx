'use client'

import dynamic from 'next/dynamic'
import clsx from 'clsx'
// Type-only: a value import (even of the Theme / EmojiStyle enums) pulls the
// whole ~300 kB picker into the room's first-load bundle and defeats the
// dynamic import below. The enum values are plain strings.
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'

const DARK_THEME = 'dark' as Theme
const NATIVE_EMOJI_STYLE = 'native' as EmojiStyle

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
})

interface SearchableEmojiPickerProps {
  isConnected: boolean
  onSelect: (emoji: string) => void
  className?: string
  searchPlaceholder?: string
  height?: string | number
}

export function SearchableEmojiPicker({
  isConnected,
  onSelect,
  className,
  searchPlaceholder = 'Search all emojis',
  height = 360,
}: SearchableEmojiPickerProps) {
  return (
    <div className={clsx('emoji-picker-shell', className)}>
      <EmojiPicker
        open
        lazyLoadEmojis
        autoFocusSearch
        theme={DARK_THEME}
        emojiStyle={NATIVE_EMOJI_STYLE}
        width="100%"
        height={height}
        searchPlaceholder={searchPlaceholder}
        previewConfig={{ showPreview: false }}
        onEmojiClick={(emojiData: EmojiClickData) => {
          if (!isConnected) {
            return
          }

          onSelect(emojiData.emoji)
        }}
      />
    </div>
  )
}
